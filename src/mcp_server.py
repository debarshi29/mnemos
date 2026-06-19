"""
mnemos MCP server — exposes the memory layer as MCP tools.

Any MCP-compatible client (Claude Desktop, Cursor, etc.) can plug in
and get persistent, consolidated, provenance-tracked memory.

Run:
  python -m src.mcp_server          # stdio transport (for Claude Desktop / Cursor)
  python -m src.mcp_server --http   # HTTP/SSE transport (for web clients)

Claude Desktop config (~/.config/claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "mnemos": {
        "command": "path/to/.venv/Scripts/python",
        "args": ["-m", "src.mcp_server"],
        "cwd": "path/to/mnemos"
      }
    }
  }
"""

from __future__ import annotations
import sys
from datetime import datetime, timezone
from pathlib import Path

# ensure repo root is on sys.path when run as __main__
sys.path.insert(0, str(Path(__file__).parent.parent))

import fastmcp
from fastmcp import FastMCP

from src.config import get
from src.memory import retrieval
from src.memory.consolidation import run_consolidation
from src.schema import Episode
from src.store import sqlite_store

mcp = FastMCP(
    name="mnemos",
    instructions=(
        "mnemos is a persistent memory system. Use it to remember facts about the user "
        "across conversations, recall relevant context, inspect provenance, and trigger "
        "memory consolidation. Always call `recall` before answering questions that might "
        "benefit from prior context."
    ),
)

_USER_ID = get("user.default_user_id", "local_user")


# ── Tools ──────────────────────────────────────────────────────────────────────

@mcp.tool()
def remember(text: str, session_id: str = "mcp_session") -> str:
    """
    Store a conversation turn or observation in episodic memory.
    Call this after every meaningful exchange so the memory system can
    consolidate it into long-term facts later.

    Args:
        text: The content to remember (a conversation turn, note, or observation).
        session_id: Groups turns into a session. Use a consistent ID per conversation.

    Returns:
        The episode_id of the stored memory.
    """
    sqlite_store.init_db()
    ep = Episode(user_id=_USER_ID, session_id=session_id, text=text)
    sqlite_store.save_episode(ep)
    return f"Remembered. episode_id={ep.episode_id}"


@mcp.tool()
def recall(query: str, top_k: int = 5) -> str:
    """
    Retrieve the most relevant facts from long-term memory for a given query.
    Uses decay-ranked semantic search: recent facts rank higher than stale ones
    even at equal similarity. Returns consolidated facts only (not raw episodes).

    Args:
        query: What you want to remember about — a question, topic, or keyword.
        top_k: Maximum number of facts to return (default 5).

    Returns:
        A ranked list of relevant facts with confidence scores.
    """
    sqlite_store.init_db()
    results = retrieval.retrieve(query, top_k=top_k)
    if not results:
        return "No relevant facts found in memory yet."

    lines = []
    for i, (fact, score) in enumerate(results, 1):
        flag = " [FLAGGED — contradicts another fact]" if fact.flagged else ""
        lines.append(
            f"{i}. [{fact.type}] {fact.content}\n"
            f"   confidence={fact.confidence:.2f}  score={score:.3f}  "
            f"last_seen={fact.last_seen.strftime('%Y-%m-%d')}{flag}\n"
            f"   fact_id={fact.fact_id}"
        )
    return "\n\n".join(lines)


@mcp.tool()
def get_provenance(fact_id: str) -> str:
    """
    Show which past conversations support a specific fact — the 'why do you believe this?' tool.
    Traces a fact back to its source episodes, giving full transparency into
    how the memory system arrived at a belief.

    Args:
        fact_id: The fact_id returned by recall().

    Returns:
        The fact content and the source episodes that support it.
    """
    sqlite_store.init_db()
    fact = sqlite_store.get_fact(fact_id)
    if not fact:
        return f"No fact found with id={fact_id}"

    ep_ids = sqlite_store.get_fact_provenance(fact_id)
    if not ep_ids:
        return f"Fact: {fact.content}\n\nNo provenance recorded (fact may have been seeded)."

    all_eps = sqlite_store.get_episodes(user_id=_USER_ID, limit=2000)
    ep_map = {e.episode_id: e for e in all_eps}

    lines = [f"Fact: {fact.content}", f"Type: {fact.type}  Confidence: {fact.confidence:.2f}", ""]
    lines.append(f"Supported by {len(ep_ids)} episode(s):")
    for eid in ep_ids:
        ep = ep_map.get(eid)
        if ep:
            lines.append(
                f"\n  [{ep.timestamp.strftime('%Y-%m-%d %H:%M')}] session={ep.session_id}\n"
                f"  {ep.text[:300]}{'…' if len(ep.text) > 300 else ''}"
            )
        else:
            lines.append(f"\n  episode_id={eid} (not found in store)")

    return "\n".join(lines)


@mcp.tool()
def consolidate() -> str:
    """
    Run the memory consolidation cycle (the 'sleep cycle').
    Extracts facts from recent episodes, dedupes them against existing memory,
    resolves contradictions, and prunes stale facts below the confidence floor.
    Call this periodically or at end of a session.

    Returns:
        A summary of what the consolidation run did.
    """
    sqlite_store.init_db()
    episodes = sqlite_store.get_episodes(user_id=_USER_ID, limit=500)
    if not episodes:
        return "No episodes to consolidate."

    log = run_consolidation(user_id=_USER_ID, episodes=episodes)
    return (
        f"Consolidation complete.\n"
        f"  Episodes processed : {log.episodes_processed}\n"
        f"  Facts created      : {log.facts_created}\n"
        f"  Facts updated      : {log.facts_updated}\n"
        f"  Contradictions     : {log.contradictions_resolved}\n"
        f"  Facts pruned       : {log.facts_pruned}"
    )


@mcp.tool()
def list_facts(include_flagged: bool = True) -> str:
    """
    Browse all consolidated facts currently in long-term memory.
    Useful for auditing what the system believes about the user.

    Args:
        include_flagged: Include facts flagged for contradiction (default True).

    Returns:
        All active facts with type, confidence, and last-seen date.
    """
    sqlite_store.init_db()
    facts = sqlite_store.get_facts(include_superseded=False)
    if not include_flagged:
        facts = [f for f in facts if not f.flagged]
    if not facts:
        return "Memory is empty. Call consolidate() after storing some episodes."

    lines = []
    for f in sorted(facts, key=lambda x: x.confidence, reverse=True):
        flag = " ⚑" if f.flagged else ""
        lines.append(
            f"[{f.type}]{flag} {f.content}\n"
            f"  conf={f.confidence:.2f}  last_seen={f.last_seen.strftime('%Y-%m-%d')}"
            f"  id={f.fact_id}"
        )
    return f"{len(facts)} facts in memory:\n\n" + "\n\n".join(lines)


@mcp.tool()
def plan_learning_roadmap(topic: str, background: str) -> str:
    """
    Generate a phased learning roadmap for a topic given the user's background.
    Searches the web and ArXiv, then produces 4-6 concrete learning milestones
    saved as GoalFacts in memory.

    Args:
        topic: What the user wants to learn (e.g. 'transformer architectures').
        background: What the user already knows (e.g. 'comfortable with Python, new to ML').

    Returns:
        The generated roadmap phases as text.
    """
    from src.planner.roadmap_planner import plan_roadmap
    sqlite_store.init_db()

    goal_facts = plan_roadmap(topic=topic, background=background, user_id=_USER_ID)
    if not goal_facts:
        return "Planner returned no phases. Try a more specific topic."

    lines = [f"Roadmap for: {topic}\n"]
    for gf in sorted(goal_facts, key=lambda g: g.phase_index):
        resources = gf.metadata.get("resources", [])
        res_str = "\n    ".join(resources[:3]) if resources else "—"
        lines.append(
            f"Phase {gf.phase_index + 1}: {gf.phase_content}\n"
            f"  Status: {gf.status}\n"
            f"  Resources:\n    {res_str}\n"
            f"  goal_id={gf.goal_id}"
        )
    return "\n".join(lines)


# ── Resources ──────────────────────────────────────────────────────────────────

@mcp.resource("memory://facts")
def facts_resource() -> str:
    """Live snapshot of all active facts in memory (markdown table)."""
    sqlite_store.init_db()
    facts = sqlite_store.get_facts(include_superseded=False)
    if not facts:
        return "No facts in memory yet."
    rows = ["| Type | Confidence | Last Seen | Content |", "|---|---|---|---|"]
    for f in sorted(facts, key=lambda x: x.confidence, reverse=True):
        rows.append(
            f"| {f.type} | {f.confidence:.2f} | {f.last_seen.strftime('%Y-%m-%d')} "
            f"| {f.content[:80]} |"
        )
    return "\n".join(rows)


@mcp.resource("memory://consolidation-log")
def consolidation_log_resource() -> str:
    """Recent consolidation run history."""
    sqlite_store.init_db()
    entries = sqlite_store.get_consolidation_log(user_id=_USER_ID, limit=10)
    if not entries:
        return "No consolidation runs yet."
    lines = []
    for e in entries:
        lines.append(
            f"[{e.timestamp.strftime('%Y-%m-%d %H:%M')}] "
            f"episodes={e.episodes_processed} created={e.facts_created} "
            f"updated={e.facts_updated} contradictions={e.contradictions_resolved} "
            f"pruned={e.facts_pruned}"
        )
    return "\n".join(lines)


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="mnemos MCP server")
    parser.add_argument("--http", action="store_true", help="Run HTTP/SSE transport instead of stdio")
    parser.add_argument("--port", type=int, default=8001, help="Port for HTTP transport (default 8001)")
    args = parser.parse_args()

    sqlite_store.init_db()

    if args.http:
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.port)
    else:
        mcp.run(transport="stdio")
