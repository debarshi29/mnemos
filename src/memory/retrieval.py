"""
Decay-ranked fact retrieval.

score = cosine_similarity * exp(-lambda * age_in_days)

lambda = ln(2) / half_life_days   (so score halves every half_life days)
"""

from __future__ import annotations
import math
from datetime import datetime, timezone

from src.config import get
from src.schema import Fact
from src.store import embeddings, vector_store, sqlite_store


_HALF_LIFE_DAYS: float = get("memory.decay_half_life_days", 30)
_LAMBDA: float = math.log(2) / _HALF_LIFE_DAYS


def _age_days(fact: Fact) -> float:
    now = datetime.now(timezone.utc)
    last = fact.last_seen
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return max((now - last).total_seconds() / 86400, 0)


def retrieve(query: str, top_k: int = 5, include_superseded: bool = False) -> list[tuple[Fact, float]]:
    """
    Return (Fact, score) pairs, sorted by decay-adjusted similarity descending.
    score = similarity * exp(-lambda * age_days)
    Returns empty list if no facts exist yet (before first consolidation).
    """
    query_vec = embeddings.embed(query)
    try:
        candidates = vector_store.search_similar(query_vec, top_k=top_k * 3)
    except Exception:
        return []

    results: list[tuple[Fact, float]] = []
    for c in candidates:
        fact = sqlite_store.get_fact(c["fact_id"])
        if fact is None:
            continue
        if not include_superseded and fact.superseded_by is not None:
            continue
        age = _age_days(fact)
        score = c["score"] * math.exp(-_LAMBDA * age)
        results.append((fact, score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_k]


def retrieve_for_context(query: str, top_k: int = 5) -> list[Fact]:
    """Convenience wrapper — returns just the Facts, ordered by score."""
    return [f for f, _ in retrieve(query, top_k=top_k)]
