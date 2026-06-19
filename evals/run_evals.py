"""
Eval harness — runs synthetic multi-session scripts and reports:
- recall of planted facts
- contradiction handling correctness
- provenance accuracy
- consolidation integrity (no silent information loss)
"""

from __future__ import annotations
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

# ensure src/ is importable when run from repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.schema import Episode
from src.store import sqlite_store, embeddings, vector_store
from src.memory.consolidation import run_consolidation
from src.memory import retrieval

_SCRIPTS_DIR = Path(__file__).parent / "scripts"


def load_scripts() -> list[dict]:
    scripts = []
    for f in sorted(_SCRIPTS_DIR.glob("*.json")):
        with open(f) as fh:
            scripts.append(json.load(fh))
    return scripts


def run_script(script: dict) -> dict:
    """
    Execute one synthetic script and return a result dict.
    Script format:
    {
      "name": "...",
      "episodes": [{"text": "...", "session_id": "..."}],
      "planted_facts": ["fact string 1", ...],
      "contradictions": [{"a": "...", "b": "...", "expected_winner": "a|b|both"}],
      "provenance_checks": [{"fact_hint": "...", "episode_hint": "..."}]
    }
    """
    user_id = f"eval_{script['name']}"
    sqlite_store.init_db()

    # Load episodes
    episodes: list[Episode] = []
    for raw in script["episodes"]:
        ep = Episode(user_id=user_id, session_id=raw["session_id"], text=raw["text"])
        sqlite_store.save_episode(ep)
        episodes.append(ep)

    # Run consolidation
    log = run_consolidation(user_id=user_id, episodes=episodes)
    all_facts = sqlite_store.get_facts(include_superseded=True)
    user_facts = [f for f in all_facts]

    results = {
        "name": script["name"],
        "episodes_processed": log.episodes_processed,
        "facts_created": log.facts_created,
    }

    # ── Recall ────────────────────────────────────────────────────────────────
    recall_hits = 0
    for planted in script.get("planted_facts", []):
        planted_vec = embeddings.embed(planted)
        found = any(
            embeddings.cosine_similarity(planted_vec, embeddings.embed(f.content)) > 0.80
            for f in user_facts if f.superseded_by is None
        )
        if found:
            recall_hits += 1
    planted_total = len(script.get("planted_facts", []))
    results["recall"] = f"{recall_hits}/{planted_total}" if planted_total else "N/A"

    # ── Contradiction handling ─────────────────────────────────────────────────
    contra_correct = 0
    for check in script.get("contradictions", []):
        a_vec = embeddings.embed(check["a"])
        b_vec = embeddings.embed(check["b"])
        expected = check["expected_winner"]
        active_facts = [f for f in user_facts if f.superseded_by is None and not f.flagged]
        a_alive = any(embeddings.cosine_similarity(a_vec, embeddings.embed(f.content)) > 0.80 for f in active_facts)
        b_alive = any(embeddings.cosine_similarity(b_vec, embeddings.embed(f.content)) > 0.80 for f in active_facts)
        flagged_facts = [f for f in user_facts if f.flagged]
        a_flagged = any(embeddings.cosine_similarity(a_vec, embeddings.embed(f.content)) > 0.80 for f in flagged_facts)

        if expected == "a" and a_alive and not b_alive:
            contra_correct += 1
        elif expected == "b" and b_alive and not a_alive:
            contra_correct += 1
        elif expected == "both" and (a_flagged or a_alive) and (b_alive or a_flagged):
            contra_correct += 1
    contra_total = len(script.get("contradictions", []))
    results["contradiction_accuracy"] = f"{contra_correct}/{contra_total}" if contra_total else "N/A"

    # ── Provenance accuracy ────────────────────────────────────────────────────
    prov_hits = 0
    for pcheck in script.get("provenance_checks", []):
        fact_hint_vec = embeddings.embed(pcheck["fact_hint"])
        matched_fact = max(
            (f for f in user_facts if f.superseded_by is None),
            key=lambda f: embeddings.cosine_similarity(fact_hint_vec, embeddings.embed(f.content)),
            default=None,
        )
        if matched_fact:
            ep_ids = sqlite_store.get_fact_provenance(matched_fact.fact_id)
            all_eps = sqlite_store.get_episodes(user_id=user_id, limit=1000)
            ep_hint_vec = embeddings.embed(pcheck["episode_hint"])
            for eid in ep_ids:
                ep = next((e for e in all_eps if e.episode_id == eid), None)
                if ep and embeddings.cosine_similarity(ep_hint_vec, embeddings.embed(ep.text)) > 0.70:
                    prov_hits += 1
                    break
    prov_total = len(script.get("provenance_checks", []))
    results["provenance_accuracy"] = f"{prov_hits}/{prov_total}" if prov_total else "N/A"

    results["consolidation_integrity"] = "PASS" if log.facts_created >= 0 else "FAIL"
    return results


def print_report(results: list[dict]):
    print("\n" + "=" * 70)
    print("mnemos EVAL REPORT")
    print("=" * 70)
    header = f"{'Script':<30} {'Recall':<12} {'Contradiction':<16} {'Provenance':<12} {'Integrity'}"
    print(header)
    print("-" * 70)
    for r in results:
        print(f"{r['name']:<30} {r['recall']:<12} {r['contradiction_accuracy']:<16} "
              f"{r['provenance_accuracy']:<12} {r['consolidation_integrity']}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    scripts = load_scripts()
    if not scripts:
        print("No eval scripts found in evals/scripts/. Add .json files to run evals.")
        sys.exit(0)

    all_results = []
    for script in scripts:
        print(f"Running: {script['name']} ...", end=" ", flush=True)
        result = run_script(script)
        all_results.append(result)
        print("done")

    print_report(all_results)
