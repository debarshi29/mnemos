"""
Contradiction detection and resolution.

Detection: embedding similarity above threshold → LLM judge confirms.
Resolution: higher confidence wins; ties on recency; equal both → keep-both-flagged.
Losing fact is marked superseded, never hard-deleted (provenance preserved).
"""

from __future__ import annotations
from datetime import datetime

from src.config import get
from src.schema import Fact
from src.store import embeddings, sqlite_store
from src import llm_client

_SIM_THRESHOLD: float = get("memory.similarity_threshold", 0.85)

_JUDGE_SYSTEM = """You are a contradiction detector for a memory system.
Given two statements about the same person, decide if they directly contradict each other.

A contradiction means knowing one statement is true forces the other to be FALSE.

CONTRADICT examples (mutually exclusive — only one can be true):
- "User is a junior engineer" vs "User is a senior engineer"
- "User prefers Python as their favourite language" vs "User prefers Rust as their favourite language"
- "User lives in Mumbai" vs "User lives in Pune"
- "User studies 30 minutes daily" vs "User studies 2 hours daily"
- "User is currently reading DDIA" vs "User has already finished reading DDIA"

CONSISTENT examples (both can be true at the same time — do NOT mark as contradiction):
- "User is vegan" vs "User does not eat meat" (vegan implies no meat — compatible)
- "User switched to a vegan diet" vs "User no longer eats meat" (same lifestyle, different phrasing)
- "User is a senior engineer" vs "User works at a startup" (role and employer are independent)
- "User knows Python" vs "User knows JavaScript" (multiple skills are compatible)

Reply with exactly one word: CONTRADICT or CONSISTENT."""


def _judge_contradiction(fact_a: str, fact_b: str) -> bool:
    reply = llm_client.chat(
        messages=[{"role": "user", "content": f"Statement A: {fact_a}\nStatement B: {fact_b}"}],
        system=_JUDGE_SYSTEM,
        temperature=0.0,
    )
    return "CONTRADICT" in reply.upper()


def find_contradictions(new_fact: Fact, existing_facts: list[Fact]) -> list[Fact]:
    """
    Returns existing facts that semantically contradict new_fact.
    Step 1: embedding similarity filter.
    Step 2: LLM judge for each candidate.
    """
    new_vec = embeddings.embed(new_fact.content)
    conflicts: list[Fact] = []
    for ef in existing_facts:
        if ef.fact_id == new_fact.fact_id:
            continue
        ef_vec = embeddings.embed(ef.content)
        sim = embeddings.cosine_similarity(new_vec, ef_vec)
        if sim >= _SIM_THRESHOLD:
            if _judge_contradiction(new_fact.content, ef.content):
                conflicts.append(ef)
    return conflicts


def resolve(new_fact: Fact, existing: Fact) -> tuple[Fact, Fact]:
    """
    Resolve a contradiction between new_fact and existing.
    Returns (winner, loser) — loser gets superseded_by set to winner's id.

    Policy (spec §3.3):
    - higher confidence wins
    - tie on confidence → more recent wins (last_seen)
    - equal confidence AND equal recency → keep both, flag both
    """
    if new_fact.confidence > existing.confidence:
        winner, loser = new_fact, existing
        _supersede(loser, winner)
    elif existing.confidence > new_fact.confidence:
        winner, loser = existing, new_fact
        _supersede(loser, winner)
    else:
        # tie on confidence → compare recency
        new_age = new_fact.last_seen
        ex_age = existing.last_seen
        if new_age > ex_age:
            winner, loser = new_fact, existing
            _supersede(loser, winner)
        elif ex_age > new_age:
            winner, loser = existing, new_fact
            _supersede(loser, winner)
        else:
            # true tie — flag both, keep both
            new_fact.flagged = True
            existing.flagged = True
            sqlite_store.save_fact(new_fact)
            sqlite_store.save_fact(existing)
            return new_fact, existing

    sqlite_store.save_fact(winner)
    sqlite_store.save_fact(loser)
    return winner, loser


def _supersede(loser: Fact, winner: Fact):
    loser.superseded_by = winner.fact_id
