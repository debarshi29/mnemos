"""
Local CPU embeddings via sentence-transformers.
Model is loaded once and cached — first call is slow (~2s), subsequent calls fast.
"""

from __future__ import annotations
from functools import lru_cache
from src.config import get


@lru_cache(maxsize=1)
def _model():
    from sentence_transformers import SentenceTransformer
    model_name = get("embeddings.model", "all-MiniLM-L6-v2")
    return SentenceTransformer(model_name)


def embed(text: str) -> list[float]:
    """Embed a single string; returns a flat float list."""
    vec = _model().encode(text, normalize_embeddings=True)
    return vec.tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple strings efficiently in one pass."""
    vecs = _model().encode(texts, normalize_embeddings=True, batch_size=32)
    return [v.tolist() for v in vecs]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two already-normalized vectors (= dot product)."""
    import numpy as np
    return float(np.dot(a, b))
