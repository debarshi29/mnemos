"""
Roadmap planner — turns "I want to learn X, I know Y" into a phased GoalFact roadmap.

Architecture: two-node LangGraph subgraph
  researcher  — tool-calling agent (web_search, fetch_page, arxiv_search)
  synthesizer — structured output node that converts research into GoalFacts

Interface contract (swappable):
  plan_roadmap(topic: str, background: str) -> list[GoalFact]
"""

from __future__ import annotations
import json
from typing import TypedDict, Annotated
import operator

from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from src.config import get, api_key
from src.schema import GoalFact, GoalFactProvenance, new_id
from src.store import sqlite_store
from src.planner.tools import PLANNER_TOOLS

# ── LLM setup (provider-aware, tool-calling capable) ──────────────────────────

def _get_llm_with_tools():
    provider = get("llm.provider", "groq")
    if provider == "groq":
        from langchain_groq import ChatGroq
        llm = ChatGroq(
            api_key=api_key("groq"),
            model=get("llm.groq_model", "llama-3.1-8b-instant"),
            temperature=0.2,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(
            google_api_key=api_key("gemini"),
            model=get("llm.gemini_model", "gemini-1.5-flash"),
            temperature=0.2,
        )
    else:
        raise ValueError(f"Provider '{provider}' does not support tool calling. Use groq or gemini.")
    return llm.bind_tools(PLANNER_TOOLS)


# ── State ──────────────────────────────────────────────────────────────────────

class PlannerState(TypedDict):
    messages: Annotated[list, operator.add]
    topic: str
    background: str
    raw_plan: str   # JSON string from synthesizer


_RESEARCHER_SYSTEM = """You are a research assistant helping build a personalized learning roadmap.
Given a topic and a learner's background, use the available tools to:
1. Search for authoritative learning resources and curricula for the topic (use web_search)
2. Find MULTIPLE different ArXiv papers covering different aspects of the topic (run arxiv_search at least twice with different queries)
3. Fetch 1-2 pages for richer content if needed

Goal: gather DIVERSE resources — different URLs, different papers, different sites — so each learning phase can have its own unique reference material.
Be efficient — 4 to 6 tool calls total."""

_SYNTHESIZER_SYSTEM = """You are a learning roadmap designer.
Given research about a topic and the learner's background, produce a phased roadmap.

Output ONLY a JSON array (no markdown, no explanation):
[
  {{"phase_index": 0, "phase_content": "...", "resources": ["url1", "url2"], "prerequisites": "..."}},
  ...
]

Rules:
- 4 to 6 phases, ordered from foundational to advanced
- Each phase_content is one concrete milestone (1-2 sentences, actionable)
- Tailor difficulty to the learner's stated background
- CRITICAL: every phase must have DIFFERENT resources — never repeat the same URL across phases
- Assign resources that are most relevant to THAT specific phase's content
- If you only found one ArXiv paper, use web search URLs for the other phases
- Do NOT pad resources with the same link just to fill slots — one good unique URL beats two repeated ones"""


# ── Nodes ──────────────────────────────────────────────────────────────────────

def _researcher(state: PlannerState) -> dict:
    llm = _get_llm_with_tools()
    messages = [
        SystemMessage(content=_RESEARCHER_SYSTEM),
        HumanMessage(content=(
            f"Topic: {state['topic']}\n"
            f"Learner background: {state['background']}\n\n"
            "Research this topic and gather material for a learning roadmap."
        )),
    ] + state["messages"]

    # agentic loop — keep calling tools until the model stops
    for _ in range(8):  # hard cap at 8 iterations
        response = llm.invoke(messages)
        messages.append(response)
        if not getattr(response, "tool_calls", None):
            break
        tool_node = ToolNode(PLANNER_TOOLS)
        tool_results = tool_node.invoke({"messages": messages})
        messages.extend(tool_results["messages"])

    return {"messages": messages[2:]}  # strip system/initial human from state delta


def _synthesizer(state: PlannerState) -> dict:
    provider = get("llm.provider", "groq")
    if provider == "groq":
        from langchain_groq import ChatGroq
        llm = ChatGroq(api_key=api_key("groq"),
                       model=get("llm.groq_model", "llama-3.1-8b-instant"),
                       temperature=0.0)
    else:
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(google_api_key=api_key("gemini"),
                                     model=get("llm.gemini_model", "gemini-1.5-flash"),
                                     temperature=0.0)

    # Build a readable research summary from message history
    research_text = "\n\n".join(
        m.content for m in state["messages"]
        if isinstance(m, (AIMessage, ToolMessage)) and isinstance(m.content, str) and m.content.strip()
    )[-6000:]  # cap context

    response = llm.invoke([
        SystemMessage(content=_SYNTHESIZER_SYSTEM),
        HumanMessage(content=(
            f"Topic: {state['topic']}\n"
            f"Learner background: {state['background']}\n\n"
            f"Research gathered:\n{research_text}\n\n"
            "Now produce the JSON roadmap array."
        )),
    ])
    return {"raw_plan": response.content}


# ── Graph ──────────────────────────────────────────────────────────────────────

def _build_planner():
    g = StateGraph(PlannerState)
    g.add_node("researcher", _researcher)
    g.add_node("synthesizer", _synthesizer)
    g.set_entry_point("researcher")
    g.add_edge("researcher", "synthesizer")
    g.add_edge("synthesizer", END)
    return g.compile()


_planner_graph = None


# ── Public interface ───────────────────────────────────────────────────────────

def plan_roadmap(
    topic: str,
    background: str,
    user_id: str | None = None,
    source_episode_id: str | None = None,
) -> list[GoalFact]:
    """
    Turn "I want to learn X, I know Y" into a list of GoalFacts.
    Saves the GoalFacts to SQLite automatically.
    source_episode_id: if provided, links all GoalFacts to that episode via provenance.
    """
    global _planner_graph
    if _planner_graph is None:
        _planner_graph = _build_planner()

    _uid = user_id or get("user.default_user_id", "local_user")

    result = _planner_graph.invoke({
        "messages": [],
        "topic": topic,
        "background": background,
        "raw_plan": "",
    })

    raw = result.get("raw_plan", "[]").strip()
    # strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        phases = json.loads(raw)
    except json.JSONDecodeError:
        # fallback: try to find JSON array in the text
        import re
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        phases = json.loads(m.group()) if m else []

    # Deduplicate resources across phases — remove any URL that already appeared in an earlier phase
    seen_urls: set[str] = set()
    for phase in phases:
        raw_resources = phase.get("resources", [])
        unique = []
        for url in raw_resources:
            # normalise: strip trailing version suffix (e.g. arxiv.org/abs/1234v2 → /abs/1234)
            normalised = url.rstrip("/").rstrip("v0123456789") if "arxiv.org" in url else url
            if normalised not in seen_urls:
                seen_urls.add(normalised)
                unique.append(url)
        phase["resources"] = unique

    goal_facts: list[GoalFact] = []
    for phase in phases:
        gf = GoalFact(
            user_id=_uid,
            topic=topic,
            phase_index=int(phase.get("phase_index", len(goal_facts))),
            phase_content=phase.get("phase_content", ""),
            status="not_started",
            metadata={
                "resources": phase.get("resources", []),
                "prerequisites": phase.get("prerequisites", ""),
            },
        )
        sqlite_store.save_goal_fact(gf)
        if source_episode_id:
            sqlite_store.save_goalfact_provenance(
                GoalFactProvenance(goal_id=gf.goal_id, episode_id=source_episode_id)
            )
        goal_facts.append(gf)

    return goal_facts
