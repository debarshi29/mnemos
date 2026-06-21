"""
Consolidation graph — the "sleep cycle".
LangGraph subgraph with four nodes: extract → dedupe → contradiction-check → prune.

Triggered manually or at end-of-session (config: consolidation.trigger).
Writes new/updated Facts, provenance links, and a ConsolidationLogEntry.
"""

from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import StateGraph, END

from src import llm_client
from src.config import get
from src.schema import (
    ConsolidationLogEntry, Fact, FactProvenance,
    Episode, new_id,
)
from src.store import embeddings, sqlite_store, vector_store
from src.memory import contradiction as contra

_EMA_W = get("memory.ema_new_weight", 0.7)
_CONF_FLOOR = get("memory.confidence_floor", 0.1)

_EXTRACT_SYSTEM = """You are a memory extractor for a learning copilot.
Given a conversation turn, extract distinct atomic facts about the user.

Rules:
- Each fact MUST be a complete sentence starting with "User", e.g. "User prefers Python as their main programming language."
- Never return single words, fragments, or bare concepts.
- Fact types: preference, status, event, skill, goal, other.
- Only extract facts explicitly stated — do not infer or guess.

Return a JSON array: [{"content": "User ...", "type": "preference|status|event|skill|goal|other"}]
Return ONLY the JSON array, nothing else."""


# ── State ──────────────────────────────────────────────────────────────────────

class ConsolidationState(TypedDict):
    user_id: str
    episodes: list[Episode]
    extracted: list[dict]          # raw {"content", "type", "episode_ids"}
    new_facts: list[Fact]
    log: ConsolidationLogEntry


# ── Nodes ──────────────────────────────────────────────────────────────────────

def _extract(state: ConsolidationState) -> ConsolidationState:
    """Extract candidate facts from raw episodes using the LLM."""
    episodes = state["episodes"]
    extracted: list[dict] = []

    for ep in episodes:
        try:
            raw = llm_client.chat(
                messages=[{"role": "user", "content": ep.text}],
                system=_EXTRACT_SYSTEM,
                temperature=0.0,
            )
            candidates = json.loads(raw)
            for c in candidates:
                c["episode_ids"] = [ep.episode_id]
                c["episode_timestamp"] = ep.timestamp.isoformat()
            extracted.extend(candidates)
        except Exception:
            pass  # malformed response — skip this episode

    state["extracted"] = extracted
    return state


def _dedupe(state: ConsolidationState) -> ConsolidationState:
    """
    Merge extracted candidates against existing facts via embedding similarity.
    - Near-duplicate of existing → update confidence via EMA, refresh last_seen.
    - Truly new → create a new Fact.
    """
    existing_facts = sqlite_store.get_facts(include_superseded=False)
    new_facts: list[Fact] = []
    log = state["log"]

    for candidate in state["extracted"]:
        content = candidate.get("content", "").strip()
        _raw_type = candidate.get("type", "other")
        _valid = {"preference", "status", "event", "skill", "goal", "other"}
        fact_type = _raw_type if _raw_type in _valid else "other"
        ep_ids: list[str] = candidate.get("episode_ids", [])
        if not content:
            continue

        cand_vec = embeddings.embed(content)
        match: Fact | None = None
        best_sim = 0.0

        for ef in existing_facts:
            ef_vec = embeddings.embed(ef.content)
            sim = embeddings.cosine_similarity(cand_vec, ef_vec)
            if sim > best_sim:
                best_sim = sim
                match = ef

        SIM_DEDUPE = 0.92  # tighter than contradiction threshold

        if match and best_sim >= SIM_DEDUPE:
            # update existing fact with EMA
            old_conf = match.confidence
            match.confidence = round(_EMA_W * 1.0 + (1 - _EMA_W) * old_conf, 4)
            match.last_seen = datetime.now(timezone.utc)
            sqlite_store.save_fact(match)
            for eid in ep_ids:
                sqlite_store.save_fact_provenance(FactProvenance(fact_id=match.fact_id, episode_id=eid))
            log["facts_updated"] = log.get("facts_updated", 0) + 1
        else:
            ep_ts_raw = candidate.get("episode_timestamp")
            ep_ts = datetime.fromisoformat(ep_ts_raw) if ep_ts_raw else datetime.now(timezone.utc)
            new_fact = Fact(content=content, type=fact_type, confidence=1.0, last_seen=ep_ts)
            new_facts.append(new_fact)
            for eid in ep_ids:
                new_fact._episode_ids = getattr(new_fact, "_episode_ids", []) + [eid]
            log["facts_created"] = log.get("facts_created", 0) + 1

    state["new_facts"] = new_facts
    state["log"] = log
    return state


def _contradiction_check(state: ConsolidationState) -> ConsolidationState:
    """Run contradiction detection + resolution for each new fact.

    existing_facts is updated after each iteration so that two new facts
    extracted from the same consolidation run can contradict each other —
    e.g. s1 says Python, s2 says Rust → Rust wins.
    """
    existing_facts = sqlite_store.get_facts(include_superseded=False)
    log = state["log"]
    resolved_count = 0

    for new_fact in state["new_facts"]:
        ep_ids = getattr(new_fact, "_episode_ids", [])
        conflicts = contra.find_contradictions(new_fact, existing_facts)
        if conflicts:
            for conflicting in conflicts:
                winner, loser = contra.resolve(new_fact, conflicting)
                resolved_count += 1
                log.setdefault("details", []).append({
                    "type": "contradiction_resolved",
                    "winner_id": winner.fact_id,
                    "loser_id": loser.fact_id,
                    "winner_content": winner.content,
                    "loser_content": loser.content,
                })
                # Link the new episode to the winner so provenance is correct
                for eid in ep_ids:
                    try:
                        sqlite_store.save_fact_provenance(
                            FactProvenance(fact_id=winner.fact_id, episode_id=eid)
                        )
                    except Exception:
                        pass  # duplicate provenance link — skip
                # If new_fact won, it was saved by resolve() but not yet in vector store
                if winner.fact_id == new_fact.fact_id:
                    vec = embeddings.embed(winner.content)
                    vector_store.upsert_fact(winner.fact_id, vec, {"content": winner.content, "type": winner.type})
                # Update local view: remove loser, add winner if it's new
                existing_facts = [f for f in existing_facts if f.fact_id != loser.fact_id]
                if not any(f.fact_id == winner.fact_id for f in existing_facts):
                    existing_facts.append(winner)
        else:
            # no conflict — persist new fact and index in vector store
            sqlite_store.save_fact(new_fact)
            for eid in ep_ids:
                sqlite_store.save_fact_provenance(FactProvenance(fact_id=new_fact.fact_id, episode_id=eid))
            vec = embeddings.embed(new_fact.content)
            vector_store.upsert_fact(new_fact.fact_id, vec, {"content": new_fact.content, "type": new_fact.type})
            existing_facts.append(new_fact)  # visible to subsequent iterations

    log["contradictions_resolved"] = resolved_count
    state["log"] = log
    return state


def _prune(state: ConsolidationState) -> ConsolidationState:
    """Mark facts below confidence floor as superseded (no hard delete)."""
    all_facts = sqlite_store.get_facts(include_superseded=False)
    log = state["log"]
    pruned = 0

    for fact in all_facts:
        if fact.confidence < _CONF_FLOOR:
            fact.superseded_by = "pruned"
            sqlite_store.save_fact(fact)
            pruned += 1
            log.setdefault("details", []).append({
                "type": "pruned",
                "fact_id": fact.fact_id,
                "content": fact.content,
                "confidence": fact.confidence,
            })

    log["facts_pruned"] = pruned
    state["log"] = log
    return state


# ── Graph assembly ─────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(ConsolidationState)
    g.add_node("extract", _extract)
    g.add_node("dedupe", _dedupe)
    g.add_node("contradiction_check", _contradiction_check)
    g.add_node("prune", _prune)
    g.set_entry_point("extract")
    g.add_edge("extract", "dedupe")
    g.add_edge("dedupe", "contradiction_check")
    g.add_edge("contradiction_check", "prune")
    g.add_edge("prune", END)
    return g.compile()


_graph = None


def run_consolidation(user_id: str, episodes: list[Episode]) -> ConsolidationLogEntry:
    """
    Execute the sleep-cycle graph and return a ConsolidationLogEntry.
    Saves the log entry to the database automatically.
    """
    global _graph
    if _graph is None:
        _graph = _build_graph()

    log_entry = ConsolidationLogEntry(
        user_id=user_id,
        episodes_processed=len(episodes),
        facts_created=0,
        facts_updated=0,
        contradictions_resolved=0,
        facts_pruned=0,
    )

    initial_state: ConsolidationState = {
        "user_id": user_id,
        "episodes": episodes,
        "extracted": [],
        "new_facts": [],
        "log": log_entry.model_dump(),
    }

    final_state = _graph.invoke(initial_state)

    log_dict = final_state["log"]
    log_entry = ConsolidationLogEntry(**{k: v for k, v in log_dict.items() if k != "details"},
                                      details=log_dict.get("details", []))
    sqlite_store.save_consolidation_log(log_entry)
    return log_entry
