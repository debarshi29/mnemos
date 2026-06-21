"""
Eval harness — runs synthetic multi-session scripts and reports:
- recall of planted facts
- contradiction handling correctness
- provenance accuracy
- consolidation integrity (no silent information loss)
"""

from __future__ import annotations
import json
import sqlite3
import sys
from pathlib import Path

# ensure src/ is importable when run from repo root
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import get
from src.schema import Episode
from src.store import sqlite_store, embeddings, vector_store
from src.memory.consolidation import run_consolidation
from src.memory import retrieval

# Reuse the configured DB path so init_db() and _wipe_user work on the same file
_DB_PATH = sqlite_store._DB_PATH

_SCRIPTS_DIR = Path(__file__).parent / "scripts"

PASS = "PASS"
FAIL = "FAIL"


def _cosine(a: str, b: str) -> float:
    return embeddings.cosine_similarity(embeddings.embed(a), embeddings.embed(b))


def _full_wipe() -> None:
    """Truncate all tables so each eval script starts from a clean slate.

    Avoids cross-contamination between scripts: facts has no user_id, so
    facts from script N would appear as existing_facts for script N+1
    causing spurious dedupe hits and missed contradictions.
    """
    conn = sqlite3.connect(_DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM fact_provenance")
    cur.execute("DELETE FROM facts")
    cur.execute("DELETE FROM episodes")
    cur.execute("DELETE FROM consolidation_log")
    conn.commit()
    conn.close()


def _facts_for_user(episodes: list) -> list:
    """Return all facts linked to these episodes via fact_provenance."""
    if not episodes:
        return []
    ep_ids = [ep.episode_id for ep in episodes]
    conn = sqlite3.connect(_DB_PATH)
    cur = conn.cursor()
    placeholders = ",".join("?" * len(ep_ids))
    cur.execute(
        f"SELECT DISTINCT fact_id FROM fact_provenance WHERE episode_id IN ({placeholders})",
        ep_ids,
    )
    linked_ids = {r[0] for r in cur.fetchall()}
    conn.close()

    all_facts = sqlite_store.get_facts(include_superseded=True)
    return [f for f in all_facts if f.fact_id in linked_ids]


def load_scripts() -> list[dict]:
    scripts = []
    for f in sorted(_SCRIPTS_DIR.glob("*.json")):
        with open(f) as fh:
            scripts.append(json.load(fh))
    return scripts


def run_script(script: dict) -> dict:
    """
    Execute one synthetic script and return a result dict.

    Script schema:
    {
      "name": str,
      "description": str,          # optional, shown in verbose mode
      "episodes": [{"text": str, "session_id": str}],
      "planted_facts": [str],       # strings that should be in active memory
      "absent_facts": [str],        # strings that must NOT be in active memory
      "contradictions": [
        {"a": str, "b": str, "expected_winner": "a" | "b" | "both"}
      ],
      "provenance_checks": [
        {"fact_hint": str, "episode_hint": str}
      ]
    }
    """
    user_id = f"eval_{script['name']}"
    sqlite_store.init_db()
    _full_wipe()

    # Ingest episodes
    episodes: list[Episode] = []
    for raw in script["episodes"]:
        ep = Episode(user_id=user_id, session_id=raw["session_id"], text=raw["text"])
        sqlite_store.save_episode(ep)
        episodes.append(ep)

    # Consolidate
    log = run_consolidation(user_id=user_id, episodes=episodes)

    # Fetch only facts linked to this run's episodes (facts table has no user_id)
    user_facts = _facts_for_user(episodes)
    active_facts = [f for f in user_facts if f.superseded_by is None and not f.flagged]
    flagged_facts = [f for f in user_facts if f.flagged]
    superseded_facts = [f for f in user_facts if f.superseded_by is not None]

    results = {
        "name": script["name"],
        "episodes_ingested": len(episodes),
        "facts_created": log.facts_created,
        "facts_updated": log.facts_updated,
    }

    # ── Recall ────────────────────────────────────────────────────────────────
    planted = script.get("planted_facts", [])
    recall_hits = sum(
        1 for p in planted
        if any(_cosine(p, f.content) > 0.72 for f in active_facts)
    )
    results["recall"] = f"{recall_hits}/{len(planted)}" if planted else "N/A"
    results["recall_pass"] = recall_hits == len(planted) if planted else True

    # ── Absent facts (must NOT appear in active memory) ───────────────────────
    absent = script.get("absent_facts", [])
    absent_hits = sum(
        1 for a in absent
        if any(_cosine(a, f.content) > 0.80 for f in active_facts)
    )
    results["absent_violations"] = f"{absent_hits}/{len(absent)}" if absent else "N/A"
    results["absent_pass"] = absent_hits == 0 if absent else True

    # ── Contradiction handling ─────────────────────────────────────────────────
    contra_correct = 0
    for check in script.get("contradictions", []):
        a_str, b_str, expected = check["a"], check["b"], check["expected_winner"]
        a_active = any(_cosine(a_str, f.content) > 0.72 for f in active_facts)
        b_active = any(_cosine(b_str, f.content) > 0.72 for f in active_facts)
        a_flagged = any(_cosine(a_str, f.content) > 0.78 for f in flagged_facts)
        b_flagged = any(_cosine(b_str, f.content) > 0.78 for f in flagged_facts)
        a_superseded = any(_cosine(a_str, f.content) > 0.78 for f in superseded_facts)
        b_superseded = any(_cosine(b_str, f.content) > 0.78 for f in superseded_facts)

        if expected == "a" and a_active and (b_superseded or not b_active):
            contra_correct += 1
        elif expected == "b" and b_active and (a_superseded or not a_active):
            contra_correct += 1
        elif expected == "both" and (a_flagged or a_active) and (b_flagged or b_active):
            contra_correct += 1

    contra_total = len(script.get("contradictions", []))
    results["contradiction_accuracy"] = f"{contra_correct}/{contra_total}" if contra_total else "N/A"
    results["contradiction_pass"] = contra_correct == contra_total if contra_total else True

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
            all_eps = episodes  # already loaded for this user
            ep_hint = pcheck["episode_hint"].lower()
            ep_hint_vec = embeddings.embed(pcheck["episode_hint"])
            for eid in ep_ids:
                ep = next((e for e in all_eps if e.episode_id == eid), None)  # type: ignore[union-attr]
                if ep:
                    # Substring match is more reliable than embedding sim for short phrases vs long text
                    if ep_hint in ep.text.lower():
                        prov_hits += 1
                        break
                    if embeddings.cosine_similarity(ep_hint_vec, embeddings.embed(ep.text)) > 0.50:
                        prov_hits += 1
                        break

    prov_total = len(script.get("provenance_checks", []))
    results["provenance_accuracy"] = f"{prov_hits}/{prov_total}" if prov_total else "N/A"
    results["provenance_pass"] = prov_hits == prov_total if prov_total else True

    # ── Consolidation integrity ────────────────────────────────────────────────
    # Pass if at least one fact was created or updated (no silent total loss)
    has_output = (log.facts_created + log.facts_updated) > 0 or len(episodes) == 0
    results["consolidation_integrity"] = PASS if has_output else FAIL
    results["integrity_pass"] = has_output

    results["overall"] = PASS if all([
        results["recall_pass"],
        results["absent_pass"],
        results["contradiction_pass"],
        results["provenance_pass"],
        results["integrity_pass"],
    ]) else FAIL

    return results


def print_report(results: list[dict]) -> None:
    W = 100
    print("\n" + "=" * W)
    print("  mnemos EVAL REPORT")
    print("=" * W)
    hdr = f"  {'Script':<32} {'Recall':<10} {'Absent':<10} {'Contra':<10} {'Prov':<10} {'Integrity':<12} {'Overall'}"
    print(hdr)
    print("-" * W)
    passes = 0
    for r in results:
        overall = r["overall"]
        if overall == PASS:
            passes += 1
        print(
            f"  {r['name']:<32} {r['recall']:<10} {r['absent_violations']:<10} "
            f"{r['contradiction_accuracy']:<10} {r['provenance_accuracy']:<10} "
            f"{r['consolidation_integrity']:<12} {overall}"
        )
    print("=" * W)
    total = len(results)
    print(f"  Result: {passes}/{total} scripts passed\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Run mnemos evals")
    parser.add_argument("--filter", help="Only run scripts whose name contains this string")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print raw result dicts")
    args = parser.parse_args()

    scripts = load_scripts()
    if args.filter:
        scripts = [s for s in scripts if args.filter in s["name"]]
    if not scripts:
        print("No eval scripts found. Add .json files to evals/scripts/.")
        sys.exit(0)

    all_results = []
    for script in scripts:
        print(f"  running {script['name']} ...", end=" ", flush=True)
        try:
            result = run_script(script)
            all_results.append(result)
            print(result["overall"])
        except Exception as e:
            print(f"ERROR: {e}")
            all_results.append({"name": script["name"], "overall": "ERROR",
                                 "recall": "—", "absent_violations": "—",
                                 "contradiction_accuracy": "—", "provenance_accuracy": "—",
                                 "consolidation_integrity": "—"})

    if args.verbose:
        import pprint
        for r in all_results:
            pprint.pprint(r)

    print_report(all_results)
