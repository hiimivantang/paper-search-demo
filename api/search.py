"""
Vercel Python serverless function for Milvus paper search.
"""

import json
import os
from http.server import BaseHTTPRequestHandler

# Strip whitespace from environment variables before importing pymilvus
# (pymilvus reads MILVUS_URI at import time)
if 'MILVUS_URI' in os.environ:
    os.environ['MILVUS_URI'] = os.environ['MILVUS_URI'].strip()

from openai import OpenAI
from pymilvus import (
    MilvusClient,
    AnnSearchRequest,
    RRFRanker,
    Function,
    FunctionType,
    FunctionScore,
    LexicalHighlighter,
)

# Configuration from environment variables
COLLECTION_NAME = 'semantic_scholar_papers'
MILVUS_URI = os.environ.get('MILVUS_URI', '').strip()
MILVUS_TOKEN = os.environ.get('MILVUS_TOKEN', '').strip()
CURRENT_YEAR = 2025

# Clients (initialized lazily)
_milvus_client = None
_openai_client = None


def get_milvus_client():
    global _milvus_client
    if _milvus_client is None:
        _milvus_client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN)
    return _milvus_client


def get_openai_client():
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI()
    return _openai_client


def get_embeddings(text: str):
    """Get embeddings from OpenAI."""
    client = get_openai_client()
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return [item.embedding for item in response.data]


def search_papers(request_data: dict) -> dict:
    """Perform the search and return results."""
    query = request_data.get('query', '')
    limit = request_data.get('limit', 10)
    use_time_decay = request_data.get('use_time_decay', False)
    use_boost = request_data.get('use_boost', False)
    use_boost_ranker = request_data.get('use_boost_ranker', False)
    highlight_mode = request_data.get('highlight_mode', 'none')
    filter_expr = request_data.get('filter', '')
    time_decay_params = request_data.get('time_decay_params') or {}
    boost_params = request_data.get('boost_params') or {}

    # Determine search mode: 'semantic', 'keyword', or 'hybrid' (default)
    # Backward compat: if search_mode is not set, infer from highlight_mode
    search_mode = request_data.get('search_mode')
    if search_mode is None:
        if highlight_mode == 'lexical':
            search_mode = 'keyword'
        else:
            search_mode = 'semantic'

    client = get_milvus_client()
    output_fields = ['corpusid', 'title', 'year', 'citationcount', 'url']

    # Build ranker functions
    functions = []

    if use_time_decay:
        origin = time_decay_params.get('origin', CURRENT_YEAR)
        offset = time_decay_params.get('offset', 5)
        decay = time_decay_params.get('decay', 0.8)
        scale = time_decay_params.get('scale', 8)

        ranker_year = Function(
            name="time_decay_exp",
            input_field_names=["year"],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "decay",
                "function": "exp",
                "origin": origin,
                "offset": offset,
                "decay": decay,
                "scale": scale
            }
        )
        functions.append(ranker_year)

    if use_boost:
        thresholds = boost_params.get('citation_thresholds', [10, 100, 1000])
        weights = boost_params.get('weights', [1.1, 1.2, 1.5])

        functions.append(Function(
            name="boost_10",
            input_field_names=[],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "boost",
                "filter": f"citationcount > {thresholds[0]} and citationcount <= {thresholds[1]}",
                "weight": weights[0]
            }
        ))

        functions.append(Function(
            name="boost_100",
            input_field_names=[],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "boost",
                "filter": f"citationcount > {thresholds[1]} and citationcount <= {thresholds[2]}",
                "weight": weights[1]
            }
        ))

        functions.append(Function(
            name="boost_1000",
            input_field_names=[],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "boost",
                "filter": f"citationcount > {thresholds[2]}",
                "weight": weights[2]
            }
        ))

    # Boost Ranker (v2.6): recency boost for year >= 2022, citation boost for citationcount >= 500
    if use_boost_ranker:
        functions.append(Function(
            name="boost_ranker_recency",
            input_field_names=[],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "boost",
                "filter": "year >= 2022",
                "weight": 1.3
            }
        ))
        functions.append(Function(
            name="boost_ranker_citations",
            input_field_names=[],
            function_type=FunctionType.RERANK,
            params={
                "reranker": "boost",
                "filter": "citationcount >= 500",
                "weight": 1.2
            }
        ))

    ranker = None
    if functions:
        ranker = FunctionScore(functions=functions)

    if search_mode == 'hybrid':
        # Hybrid search: combine dense vector + BM25 sparse using RRFRanker
        embeddings = get_embeddings(query)

        dense_req = AnnSearchRequest(
            data=embeddings,
            anns_field='vector',
            param={},
            limit=limit,
        )
        sparse_req = AnnSearchRequest(
            data=[query],
            anns_field='title_sparse',
            param={"metric_type": "BM25"},
            limit=limit,
        )

        hybrid_kwargs: dict = {
            'reqs': [dense_req, sparse_req],
            'ranker': RRFRanker(),
            'limit': limit,
            'output_fields': output_fields,
        }

        if filter_expr:
            hybrid_kwargs['filter'] = filter_expr

        result = client.hybrid_search(COLLECTION_NAME, **hybrid_kwargs)

        # hybrid_search only supports RRFRanker/WeightedRanker, so apply
        # FunctionScore-style boost as post-processing on scores
        if use_boost_ranker and result and result[0]:
            for hit in result[0]:
                entity = hit.get('entity', hit)
                year = entity.get('year', 0)
                citations = entity.get('citationcount', 0)
                multiplier = 1.0
                if year >= 2022:
                    multiplier *= 1.3
                if citations >= 500:
                    multiplier *= 1.2
                hit['score'] = hit.get('score', hit.get('distance', 0)) * multiplier
            result[0] = sorted(result[0], key=lambda h: h.get('score', 0), reverse=True)

    elif search_mode == 'keyword':
        # BM25 lexical search on title_sparse field
        search_kwargs: dict = {
            'data': [query],
            'output_fields': output_fields,
            'anns_field': 'title_sparse',
            'search_params': {"metric_type": "BM25"},
            'limit': limit,
        }

        if filter_expr:
            search_kwargs['filter'] = filter_expr

        if highlight_mode == 'lexical':
            search_kwargs['highlighter'] = LexicalHighlighter(
                pre_tags=["<mark class='lexical'>"],
                post_tags=["</mark>"],
                fragment_offset=100,
                fragment_size=1000,
                highlight_search_text=True
            )

        if ranker:
            search_kwargs['ranker'] = ranker

        result = client.search(COLLECTION_NAME, **search_kwargs)

    else:
        # Semantic (dense vector) search
        embeddings = get_embeddings(query)
        search_kwargs = {
            'data': embeddings,
            'output_fields': output_fields,
            'anns_field': 'vector',
            'limit': limit,
        }

        if filter_expr:
            search_kwargs['filter'] = filter_expr

        if ranker:
            search_kwargs['ranker'] = ranker

        result = client.search(COLLECTION_NAME, **search_kwargs)

    # Format results
    papers = []
    for hit in result[0]:
        entity = hit.get('entity', hit)

        highlighted_title = None
        if 'highlight' in hit and 'title' in hit['highlight']:
            fragments = hit['highlight']['title'].get('fragments', [])
            if fragments:
                highlighted_title = fragments[0]

        papers.append({
            'id': str(hit.get('id', '')),
            'score': float(hit.get('score', hit.get('distance', 0))),
            'corpusid': int(entity.get('corpusid', 0)),
            'title': str(entity.get('title', '')),
            'highlighted_title': highlighted_title,
            'year': int(entity.get('year', 0)),
            'citationcount': int(entity.get('citationcount', 0)),
            'url': str(entity.get('url', ''))
        })

    return {
        'success': True,
        'query': query,
        'papers': papers,
        'options': {
            'use_time_decay': use_time_decay,
            'use_boost': use_boost,
            'use_boost_ranker': use_boost_ranker,
            'highlight_mode': highlight_mode,
            'search_mode': search_mode,
            'limit': limit,
        }
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))

            result = search_papers(request_data)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))

        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
