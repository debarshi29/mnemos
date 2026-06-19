"""
Qdrant embedded-mode vector store for fact embeddings.
Handles upsert, similarity search, and deletion by fact_id.
"""

from __future__ import annotations
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, PointStruct, VectorParams,
    Filter, FieldCondition, MatchValue,
)
from src.config import get

_COLLECTION = get("vector_store.collection", "mnemos_facts")
_DIM = get("embeddings.dimension", 384)
_PATH = get("vector_store.path", "./data/qdrant")

_client: QdrantClient | None = None


def _get_client() -> QdrantClient:
    global _client
    if _client is None:
        import os
        os.makedirs(_PATH, exist_ok=True)
        _client = QdrantClient(path=_PATH)
        _ensure_collection(_client)
    return _client


def _ensure_collection(client: QdrantClient):
    existing = [c.name for c in client.get_collections().collections]
    if _COLLECTION not in existing:
        client.create_collection(
            collection_name=_COLLECTION,
            vectors_config=VectorParams(size=_DIM, distance=Distance.COSINE),
        )


def upsert_fact(fact_id: str, embedding: list[float], payload: dict):
    """Insert or overwrite a fact's vector and metadata payload."""
    client = _get_client()
    client.upsert(
        collection_name=_COLLECTION,
        points=[PointStruct(id=_id_to_uint(fact_id), vector=embedding, payload={**payload, "fact_id": fact_id})],
    )


def search_similar(query_embedding: list[float], top_k: int = 10, score_threshold: float = 0.0) -> list[dict]:
    """
    Returns list of {"fact_id", "score", "payload"} sorted by cosine similarity descending.
    """
    client = _get_client()
    results = client.search(
        collection_name=_COLLECTION,
        query_vector=query_embedding,
        limit=top_k,
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [
        {"fact_id": r.payload["fact_id"], "score": r.score, "payload": r.payload}
        for r in results
    ]


def delete_fact(fact_id: str):
    client = _get_client()
    client.delete(
        collection_name=_COLLECTION,
        points_selector=[_id_to_uint(fact_id)],
    )


def _id_to_uint(uuid_str: str) -> int:
    """Qdrant needs integer or UUID point IDs; convert UUID string → int."""
    import uuid
    return uuid.UUID(uuid_str).int % (2**63)  # keep within int64
