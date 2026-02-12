"""
FastAPI backend for Milvus paper search with highlighting and rankers.
This mirrors the functionality from the Jupyter notebook demo.
"""

import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os

from openai import OpenAI
from pymilvus import (
    MilvusClient,
    Function,
    FunctionType,
    FunctionScore,
)

# Import highlighters
from pymilvus import LexicalHighlighter, SemanticHighlighter

app = FastAPI(title="Paper Search API")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
COLLECTION_NAME = 'semantic_scholar_papers'
MILVUS_URI = os.getenv('MILVUS_URI', 'https://in01-62d9b281022a9f8.aws-us-west-2.vectordb.zillizcloud.com:19541')
MILVUS_TOKEN = os.getenv('MILVUS_TOKEN', 'c09d527d89d16ec55b2fe2d9d33412ef2449dd92e7e259d479917687468da2302399d062fc16830ca19a8d77bc95616ac36ea8bf')
SEMANTIC_HIGHLIGHTER_MODEL_ID = os.getenv('SEMANTIC_HIGHLIGHTER_MODEL_ID', '69709caee4b0e9c6929808b8')
CURRENT_YEAR = 2026

# Initialize clients
milvus_client = None
openai_client = None


def get_milvus_client():
    global milvus_client
    if milvus_client is None:
        milvus_client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN)
    return milvus_client


def get_openai_client():
    global openai_client
    if openai_client is None:
        openai_client = OpenAI()
    return openai_client


def get_embeddings(text: str) -> List[float]:
    """Get embeddings from OpenAI."""
    client = get_openai_client()
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return [item.embedding for item in response.data]


class TimeDecayParams(BaseModel):
    origin: int = CURRENT_YEAR
    offset: int = 5
    decay: float = 0.8
    scale: int = 8


class BoostParams(BaseModel):
    citation_thresholds: List[int] = [10, 100, 1000]
    weights: List[float] = [1.1, 1.2, 1.5]


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    use_time_decay: bool = False
    use_boost: bool = False
    highlight_mode: str = "none"  # "none", "lexical", "semantic"
    time_decay_params: Optional[TimeDecayParams] = None
    boost_params: Optional[BoostParams] = None


class Paper(BaseModel):
    id: str
    score: float
    corpusid: int
    title: str
    highlighted_title: Optional[str] = None
    year: int
    citationcount: int
    url: str


class SearchResponse(BaseModel):
    success: bool
    query: str
    papers: List[Paper]
    options: dict


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    try:
        client = get_milvus_client()

        output_fields = ['corpusid', 'title', 'year', 'citationcount', 'url']

        # Build ranker functions
        functions = []

        if request.use_time_decay:
            params = request.time_decay_params or TimeDecayParams()
            ranker_year = Function(
                name="time_decay_exp",
                input_field_names=["year"],
                function_type=FunctionType.RERANK,
                params={
                    "reranker": "decay",
                    "function": "exp",
                    "origin": params.origin,
                    "offset": params.offset,
                    "decay": params.decay,
                    "scale": params.scale
                }
            )
            functions.append(ranker_year)

        if request.use_boost:
            params = request.boost_params or BoostParams()
            thresholds = params.citation_thresholds
            weights = params.weights

            # Boost for citations > 10 and <= 100
            ranker_boost_10 = Function(
                name="boost_10",
                input_field_names=[],
                function_type=FunctionType.RERANK,
                params={
                    "reranker": "boost",
                    "filter": f"citationcount > {thresholds[0]} and citationcount <= {thresholds[1]}",
                    "weight": weights[0]
                }
            )
            functions.append(ranker_boost_10)

            # Boost for citations > 100 and <= 1000
            ranker_boost_100 = Function(
                name="boost_100",
                input_field_names=[],
                function_type=FunctionType.RERANK,
                params={
                    "reranker": "boost",
                    "filter": f"citationcount > {thresholds[1]} and citationcount <= {thresholds[2]}",
                    "weight": weights[1]
                }
            )
            functions.append(ranker_boost_100)

            # Boost for citations > 1000
            ranker_boost_1000 = Function(
                name="boost_1000",
                input_field_names=[],
                function_type=FunctionType.RERANK,
                params={
                    "reranker": "boost",
                    "filter": f"citationcount > {thresholds[2]}",
                    "weight": weights[2]
                }
            )
            functions.append(ranker_boost_1000)

        # Determine search type based on highlight mode
        # Lexical highlighting requires BM25 sparse search
        # Semantic/None use dense vector search with optional semantic highlighting

        if request.highlight_mode == "lexical":
            # BM25 sparse vector search with lexical highlighting
            highlighter = LexicalHighlighter(
                pre_tags=["<mark class='lexical'>"],
                post_tags=["</mark>"],
                fragment_offset=100,
                fragment_size=1000,
                highlight_search_text=True
            )

            search_kwargs = {
                'data': [request.query],  # Raw text for BM25
                'output_fields': output_fields,
                'anns_field': 'title_sparse',  # Sparse vector field
                'search_params': {"metric_type": "BM25"},
                'limit': request.limit,
                'highlighter': highlighter,
            }
        else:
            # Dense vector search with embeddings
            embeddings = get_embeddings(request.query)
            search_kwargs = {
                'data': embeddings,
                'output_fields': output_fields,
                'anns_field': 'vector',
                'limit': request.limit,
            }

            # Add semantic highlighter if semantic mode is selected
            if request.highlight_mode == "semantic":
                highlighter = SemanticHighlighter(
                    queries=[request.query],
                    input_fields=['title'],
                    pre_tags=["<mark class='semantic'>"],
                    post_tags=["</mark>"],
                    model_deployment_id=SEMANTIC_HIGHLIGHTER_MODEL_ID
                )
                search_kwargs['highlighter'] = highlighter

        # Add ranker if any functions are defined
        if functions:
            combined_ranker = FunctionScore(functions=functions)
            search_kwargs['ranker'] = combined_ranker

        # Log the search request
        logger.info("=" * 60)
        logger.info(f"SEARCH REQUEST to Zilliz Cloud")
        logger.info(f"  Collection: {COLLECTION_NAME}")
        logger.info(f"  Query: {request.query}")
        logger.info(f"  Highlight Mode: {request.highlight_mode}")
        logger.info(f"  Search Field: {search_kwargs.get('anns_field')}")
        logger.info(f"  Limit: {search_kwargs.get('limit')}")
        logger.info(f"  Has Ranker: {functions is not None and len(functions) > 0}")
        logger.info(f"  Has Highlighter: {'highlighter' in search_kwargs}")
        if 'search_params' in search_kwargs:
            logger.info(f"  Search Params: {search_kwargs.get('search_params')}")
        logger.info("=" * 60)

        result = client.search(COLLECTION_NAME, **search_kwargs)

        # Log response summary
        logger.info(f"SEARCH RESPONSE: {len(result[0])} results returned")

        # Format results
        papers = []
        for hit in result[0]:
            entity = hit.get('entity', hit)

            # Get highlighted title if available
            highlighted_title = None
            if 'highlight' in hit and 'title' in hit['highlight']:
                fragments = hit['highlight']['title'].get('fragments', [])
                if fragments:
                    highlighted_title = fragments[0]

            paper = Paper(
                id=str(hit.get('id', '')),
                score=float(hit.get('score', hit.get('distance', 0))),
                corpusid=int(entity.get('corpusid', 0)),
                title=str(entity.get('title', '')),
                highlighted_title=highlighted_title,
                year=int(entity.get('year', 0)),
                citationcount=int(entity.get('citationcount', 0)),
                url=str(entity.get('url', ''))
            )
            papers.append(paper)

        return SearchResponse(
            success=True,
            query=request.query,
            papers=papers,
            options={
                "use_time_decay": request.use_time_decay,
                "use_boost": request.use_boost,
                "highlight_mode": request.highlight_mode,
                "limit": request.limit,
            }
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class AutocompleteRequest(BaseModel):
    query: str
    limit: int = 5


@app.post("/api/autocomplete")
async def autocomplete(request: AutocompleteRequest):
    substring = request.query.strip()
    if not substring or len(substring) < 4:
        return {"titles": []}

    client = get_milvus_client()
    safe = substring.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    result = client.query(
        collection_name=COLLECTION_NAME,
        filter=f'title LIKE "%{safe}%"',
        output_fields=['title'],
        limit=request.limit,
    )
    return {"titles": [hit['title'] for hit in result]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
