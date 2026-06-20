"""
FastAPI backend — all endpoints the React frontend talks to.
Routes: /chat, /memory/facts, /memory/fact/{id}, /memory/consolidate,
        /memory/log, /goals, /episodes, /plan
"""

from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src import llm_client
from src.config import get
from src.memory import retrieval
from src.memory.consolidation import run_consolidation
from src.planner.roadmap_planner import plan_roadmap
from src.schema import Episode, FactProvenance, GoalFact, new_id
from src.store import sqlite_store, embeddings, vector_store

app = FastAPI(title="mnemos API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_USER_ID = get("user.default_user_id", "local_user")

_CHAT_SYSTEM = """You are a personalized learning copilot named Mnemos.
You have access to facts the system has remembered about this user.
Use the memory context below to give relevant, personalized responses.
Be concise and warm. If the memory is empty, just respond helpfully.

--- MEMORY CONTEXT ---
{memory_context}
--- END MEMORY ---"""


# ── Request/Response models ────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    episode_id: str
    memory_used: list[str]   # fact_ids that were retrieved


class ConsolidateRequest(BaseModel):
    since_hours: Optional[int] = None   # None = all unconsolidated episodes


class PlanRequest(BaseModel):
    topic: str
    background: str
    session_id: Optional[str] = None


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    sqlite_store.init_db()
    if get("seed_demo", False):
        _seed_demo()


# ── Chat endpoint ──────────────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())

    # Retrieve relevant memory
    relevant_facts = retrieval.retrieve_for_context(req.message, top_k=5)
    memory_context = "\n".join(f"- {f.content}" for f in relevant_facts) or "(none yet)"
    memory_ids = [f.fact_id for f in relevant_facts]

    # Build conversation history for this session (last 10 turns)
    history_eps = sqlite_store.get_episodes(user_id=_USER_ID, limit=10)
    messages = []
    for ep in reversed(history_eps):
        if ep.session_id == session_id:
            # alternate user/assistant from text (stored as "User: ...\nAssistant: ...")
            lines = ep.text.split("\n", 1)
            if lines:
                messages.append({"role": "user", "content": lines[0].replace("User: ", "", 1)})
            if len(lines) > 1:
                messages.append({"role": "assistant", "content": lines[1].replace("Assistant: ", "", 1)})

    messages.append({"role": "user", "content": req.message})

    reply = llm_client.chat(
        messages=messages,
        system=_CHAT_SYSTEM.format(memory_context=memory_context),
    )

    # Store the turn as an episode
    turn_text = f"User: {req.message}\nAssistant: {reply}"
    ep = Episode(user_id=_USER_ID, session_id=session_id, text=turn_text)
    sqlite_store.save_episode(ep)

    return ChatResponse(
        reply=reply,
        session_id=session_id,
        episode_id=ep.episode_id,
        memory_used=memory_ids,
    )


# ── Memory endpoints ───────────────────────────────────────────────────────────

@app.get("/memory/facts")
def list_facts(include_superseded: bool = False):
    facts = sqlite_store.get_facts(include_superseded=include_superseded)
    return [f.model_dump(mode="json") for f in facts]


@app.get("/memory/fact/{fact_id}")
def get_fact_with_provenance(fact_id: str):
    fact = sqlite_store.get_fact(fact_id)
    if not fact:
        raise HTTPException(status_code=404, detail="Fact not found")
    ep_ids = sqlite_store.get_fact_provenance(fact_id)
    # load episodes once, not once per ep_id
    all_eps = {e.episode_id: e for e in sqlite_store.get_episodes(user_id=_USER_ID, limit=2000)}
    source_episodes = [
        all_eps[eid].model_dump(mode="json")
        for eid in ep_ids
        if eid in all_eps
    ]
    return {"fact": fact.model_dump(mode="json"), "source_episodes": source_episodes}


@app.post("/memory/consolidate")
def consolidate(req: ConsolidateRequest = ConsolidateRequest()):
    episodes = sqlite_store.get_episodes(user_id=_USER_ID, limit=500)
    if not episodes:
        return {"message": "No episodes to consolidate."}
    log = run_consolidation(user_id=_USER_ID, episodes=episodes)
    return log.model_dump(mode="json")


@app.get("/memory/log")
def consolidation_log():
    entries = sqlite_store.get_consolidation_log(user_id=_USER_ID)
    return [e.model_dump(mode="json") for e in entries]


# ── Episodes endpoint ──────────────────────────────────────────────────────────

@app.get("/episodes")
def list_episodes(limit: int = 50):
    eps = sqlite_store.get_episodes(user_id=_USER_ID, limit=limit)
    return [e.model_dump(mode="json") for e in eps]


# ── Goals endpoint ─────────────────────────────────────────────────────────────

@app.get("/goals")
def list_goals():
    goals = sqlite_store.get_goal_facts(user_id=_USER_ID)
    return [g.model_dump(mode="json") for g in goals]


@app.patch("/goals/{goal_id}/status")
def update_goal_status(goal_id: str, status: str):
    goals = sqlite_store.get_goal_facts(user_id=_USER_ID)
    goal = next((g for g in goals if g.goal_id == goal_id), None)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if status not in ("not_started", "in_progress", "done"):
        raise HTTPException(status_code=400, detail="Invalid status")
    goal.status = status
    sqlite_store.save_goal_fact(goal)
    return goal.model_dump(mode="json")


# ── Planner endpoint ──────────────────────────────────────────────────────────

@app.post("/plan")
def create_roadmap(req: PlanRequest):
    """
    Generate a phased learning roadmap for a topic given the user's background.
    Runs the researcher + synthesizer LangGraph subgraph, stores GoalFacts.
    """
    session_id = req.session_id or str(uuid.uuid4())

    # Store the planning request as an episode for provenance
    turn_text = f"User: I want to learn {req.topic}. My background: {req.background}\nAssistant: [generating roadmap]"
    ep = Episode(user_id=_USER_ID, session_id=session_id, text=turn_text)
    sqlite_store.save_episode(ep)

    goal_facts = plan_roadmap(
        topic=req.topic,
        background=req.background,
        user_id=_USER_ID,
        source_episode_id=ep.episode_id,
    )
    return {
        "topic": req.topic,
        "phases": [g.model_dump(mode="json") for g in goal_facts],
        "episode_id": ep.episode_id,
        "session_id": session_id,
    }


# ── Demo seed ──────────────────────────────────────────────────────────────────

def _seed_demo():
    """Load synthetic episodes so consolidation works on first run."""
    demo_episodes = [
        "User: I'm trying to learn Python for data science.\nAssistant: Great choice! Python is the dominant language in that field.",
        "User: I already know JavaScript pretty well.\nAssistant: That's helpful — many concepts transfer over.",
        "User: I prefer learning by doing projects rather than reading docs.\nAssistant: Noted! Let's focus on hands-on exercises.",
        "User: I find statistics challenging.\nAssistant: We can build that up gradually alongside the coding.",
        "User: I have about 1 hour per day to study.\nAssistant: That's workable — consistent daily practice compounds quickly.",
    ]
    existing = sqlite_store.get_episodes(user_id=_USER_ID, limit=10)
    if existing:
        return
    for text in demo_episodes:
        ep = Episode(user_id=_USER_ID, session_id="demo_seed", text=text)
        sqlite_store.save_episode(ep)
