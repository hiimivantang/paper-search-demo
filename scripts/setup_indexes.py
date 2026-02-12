"""
Idempotent script to add new indexes to the semantic_scholar_papers collection.

Adds:
- NGRAM index on 'title' field (enables fast substring matching for autocomplete)

Usage:
    MILVUS_URI=... MILVUS_TOKEN=... python scripts/setup_indexes.py
"""

import os
import sys

from pymilvus import MilvusClient


COLLECTION_NAME = "semantic_scholar_papers"

# NGRAM index config: min_gram=2 allows autocomplete to trigger after 2 chars,
# max_gram=3 provides good coverage for substring matching
NGRAM_INDEX_NAME = "title_ngram"
NGRAM_MIN_GRAM = 2
NGRAM_MAX_GRAM = 3


def get_client() -> MilvusClient:
    """Connect to Milvus using environment variables."""
    uri = os.environ.get("MILVUS_URI", "").strip()
    token = os.environ.get("MILVUS_TOKEN", "").strip()

    if not uri:
        print("ERROR: MILVUS_URI environment variable is required")
        sys.exit(1)

    return MilvusClient(uri=uri, token=token)


def add_ngram_index(client: MilvusClient) -> None:
    """Add NGRAM index on the 'title' field if not already present.

    The NGRAM index splits title text into overlapping n-grams, enabling
    fast substring matching for LIKE queries used in autocomplete.
    """
    # Check existing indexes on the title field
    existing_indexes = client.list_indexes(
        collection_name=COLLECTION_NAME,
        field_name="title",
    )

    if NGRAM_INDEX_NAME in existing_indexes:
        print(f"SKIPPED: NGRAM index '{NGRAM_INDEX_NAME}' already exists on 'title' field")
        return

    # Also check if any NGRAM index exists on title under a different name
    for idx_name in existing_indexes:
        try:
            details = client.describe_index(
                collection_name=COLLECTION_NAME,
                index_name=idx_name,
            )
            if details.get("index_type") == "NGRAM":
                print(f"SKIPPED: NGRAM index already exists on 'title' field (name: '{idx_name}')")
                return
        except Exception:
            pass

    # Create the NGRAM index
    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="title",
        index_type="NGRAM",
        index_name=NGRAM_INDEX_NAME,
        # min_gram=2: matches LIKE patterns with 2+ literal chars
        min_gram=NGRAM_MIN_GRAM,
        # max_gram=3: good balance of index size vs match coverage
        max_gram=NGRAM_MAX_GRAM,
    )

    try:
        client.create_index(
            collection_name=COLLECTION_NAME,
            index_params=index_params,
        )
        print(f"ADDED: NGRAM index '{NGRAM_INDEX_NAME}' on 'title' field (min_gram={NGRAM_MIN_GRAM}, max_gram={NGRAM_MAX_GRAM})")
    except Exception as e:
        error_msg = str(e).lower()
        # Handle case where index was created between our check and create call
        if "already" in error_msg or "exists" in error_msg or "duplicate" in error_msg:
            print(f"SKIPPED: NGRAM index on 'title' field already exists (race condition)")
        else:
            raise


def main() -> None:
    print(f"Connecting to Milvus...")
    client = get_client()

    # Verify collection exists
    if not client.has_collection(COLLECTION_NAME):
        print(f"ERROR: Collection '{COLLECTION_NAME}' does not exist")
        sys.exit(1)

    print(f"Collection '{COLLECTION_NAME}' found. Checking indexes...\n")

    add_ngram_index(client)

    # Print summary of all indexes on the collection
    print(f"\nAll indexes on '{COLLECTION_NAME}':")
    all_indexes = client.list_indexes(collection_name=COLLECTION_NAME)
    for idx_name in all_indexes:
        try:
            details = client.describe_index(
                collection_name=COLLECTION_NAME,
                index_name=idx_name,
            )
            idx_type = details.get("index_type", "unknown")
            field = details.get("field_name", "unknown")
            print(f"  - {idx_name}: {idx_type} on '{field}'")
        except Exception:
            print(f"  - {idx_name}")

    print("\nDone.")


if __name__ == "__main__":
    main()
