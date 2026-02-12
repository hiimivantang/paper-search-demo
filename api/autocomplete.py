"""
Vercel Python serverless function for title autocomplete using ngram index.
"""

import json
import os
from http.server import BaseHTTPRequestHandler

if 'MILVUS_URI' in os.environ:
    os.environ['MILVUS_URI'] = os.environ['MILVUS_URI'].strip()

from pymilvus import MilvusClient

COLLECTION_NAME = 'semantic_scholar_papers'
MILVUS_URI = os.environ.get('MILVUS_URI', '').strip()
MILVUS_TOKEN = os.environ.get('MILVUS_TOKEN', '').strip()

_milvus_client = None


def get_milvus_client():
    global _milvus_client
    if _milvus_client is None:
        _milvus_client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN)
    return _milvus_client


def autocomplete(substring: str, limit: int = 5) -> list:
    """Autocomplete using LIKE query on title field.

    When the NGRAM index (added by scripts/setup_indexes.py) is present,
    the LIKE query is accelerated automatically by Milvus. If the NGRAM
    index is not available, this falls back to the standard LIKE scan.
    """
    client = get_milvus_client()
    # Escape any percent/underscore characters in user input
    safe = substring.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    result = client.query(
        collection_name=COLLECTION_NAME,
        filter=f'title LIKE "%{safe}%"',
        output_fields=['title'],
        limit=limit,
    )
    return [hit['title'] for hit in result]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))

            substring = request_data.get('query', '').strip()
            limit = request_data.get('limit', 5)

            # Minimum 2 chars — matches NGRAM index min_gram=2 from setup_indexes.py
            if not substring or len(substring) < 2:
                titles = []
            else:
                titles = autocomplete(substring, limit)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'titles': titles}).encode('utf-8'))

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
