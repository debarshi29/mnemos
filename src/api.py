"""
FastAPI backend — all endpoints the React frontend talks to.
Routes: /chat, /memory/facts, /memory/fact/{id}, /memory/consolidate,
        /memory/ingest, /memory/log, /goals, /episodes, /plan
"""

from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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


class IngestRequest(BaseModel):
    source: str                     # file path or GitHub URL
    kind: str = "file"              # "file" | "github"
    session_id: Optional[str] = None


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    sqlite_store.init_db()
    if get("seed_demo", False):
        _seed_demo()


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


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


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())

    relevant_facts = retrieval.retrieve_for_context(req.message, top_k=5)
    memory_context = "\n".join(f"- {f.content}" for f in relevant_facts) or "(none yet)"
    memory_ids = [f.fact_id for f in relevant_facts]

    history_eps = sqlite_store.get_episodes(user_id=_USER_ID, limit=10)
    messages = []
    for ep in reversed(history_eps):
        if ep.session_id == session_id:
            lines = ep.text.split("\n", 1)
            if lines:
                messages.append({"role": "user", "content": lines[0].replace("User: ", "", 1)})
            if len(lines) > 1:
                messages.append({"role": "assistant", "content": lines[1].replace("Assistant: ", "", 1)})
    messages.append({"role": "user", "content": req.message})

    def generate():
        tokens: list[str] = []
        for token in llm_client.stream(
            messages,
            system=_CHAT_SYSTEM.format(memory_context=memory_context),
        ):
            tokens.append(token)
            yield f"data: {json.dumps({'token': token})}\n\n"

        reply = "".join(tokens)
        turn_text = f"User: {req.message}\nAssistant: {reply}"
        ep = Episode(user_id=_USER_ID, session_id=session_id, text=turn_text)
        sqlite_store.save_episode(ep)

        yield f"data: {json.dumps({'done': True, 'episode_id': ep.episode_id, 'session_id': session_id, 'memory_used': memory_ids})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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


@app.post("/memory/ingest")
def ingest_source(req: IngestRequest):
    """Ingest a local file or GitHub repo as an episodic memory."""
    import os, re, textwrap, httpx as _httpx
    from pathlib import Path as _Path

    session_id = req.session_id or "ingest_session"

    if req.kind == "file":
        p = _Path(req.source).expanduser().resolve()
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {req.source}")
        suffix = p.suffix.lower()
        _TEXT = {".txt",".md",".rst",".py",".js",".ts",".jsx",".tsx",
                 ".json",".yaml",".yml",".toml",".csv",".html",".sh",""}
        if suffix == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(str(p))
                raw = "\n".join(pg.extract_text() or "" for pg in reader.pages)
            except ImportError:
                raise HTTPException(status_code=422, detail="pypdf not installed")
        elif suffix in _TEXT:
            raw = p.read_text(encoding="utf-8", errors="replace")
        else:
            raise HTTPException(status_code=422, detail=f"Unsupported file type: {suffix}")
        if len(raw) > 8000:
            raw = raw[:8000] + f"\n\n[…truncated — {len(raw):,} chars total]"
        text = f"[Ingested file: {p.name}]\n\n{raw}"
        label = p.name

    elif req.kind == "github":
        m = re.search(r"github\.com[/:]([^/\s]+)/([^/\s.]+)", req.source)
        if not m:
            raise HTTPException(status_code=422, detail="Cannot parse GitHub owner/repo from URL")
        owner, repo = m.group(1), m.group(2).removesuffix(".git")
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        token = os.environ.get("GITHUB_TOKEN", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            meta = _httpx.get(f"https://api.github.com/repos/{owner}/{repo}",
                               headers=headers, timeout=10).raise_for_status().json()
            readme_r = _httpx.get(f"https://api.github.com/repos/{owner}/{repo}/readme",
                                   headers={**headers, "Accept": "application/vnd.github.raw+json"},
                                   timeout=10)
            readme = textwrap.shorten(readme_r.text, 4000, placeholder=" …") \
                if readme_r.status_code == 200 else "No README."
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))
        text = (
            f"GitHub Repository: {meta['full_name']}\n"
            f"Description: {meta.get('description') or '—'}\n"
            f"Stars: {meta.get('stargazers_count',0):,}  Language: {meta.get('language','—')}\n"
            f"Topics: {', '.join(meta.get('topics',[])) or '—'}\n"
            f"URL: {meta['html_url']}\n\nREADME:\n{readme}"
        )
        label = meta["full_name"]

    else:
        raise HTTPException(status_code=422, detail="kind must be 'file' or 'github'")

    ep = Episode(user_id=_USER_ID, session_id=session_id, text=text)
    sqlite_store.save_episode(ep)
    return {"episode_id": ep.episode_id, "label": label, "chars": len(text)}


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
    episodes = sqlite_store.get_episodes(user_id=_USER_ID, limit=50)
    run_consolidation(user_id=_USER_ID, episodes=episodes)
