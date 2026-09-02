# Mnemos — Low-Level Design (LLD)

**Status:** Baseline for v0.1
**Scope:** Module-by-module internals — signatures, algorithms, state machines, invariants.
**Read first:** [`HLD.md`](HLD.md). **See also:** [`data-model.md`](data-model.md), [`api-reference.md`](api-reference.md), [`sequence-diagrams.md`](sequence-diagrams.md).

---

## 1. Module map

```
src/
├── api.py                    FastAPI app — all endpoints, SSE, auto-consolidation
├── mcp_server.py             FastMCP — 8 tools, 2 resources
├── schema.py                 Pydantic v2 models
├── config.py                 config.yaml loader: get(), api_key()
├── llm_client.py             chat() / stream() over Groq | Gemini | Ollama
├── memory/
│   ├── consolidation.py      LangGraph sleep cycle (4 nodes)
│   ├── contradiction.py      detect (embed → LLM judge) + resolve (policy)
│   └── retrieval.py          decay-ranked vector retrieval
├── planner/
│   ├── roadmap_planner.py    two-node LangGraph (researcher → synthesizer)
│   └── tools.py              web_search, arxiv_search, github_search, fetch_page
└── store/
    ├── sqlite_store.py       CRUD over SQLite WAL
    ├── vector_store.py       embedded Qdrant wrapper
    └── embeddings.py         SentenceTransformer + cosine_similarity
```

---

## 2. `schema.py` — data models

```python
FactType   = Literal["preference", "status", "event", "skill", "goal", "other"]
GoalStatus = Literal["not_started", "in_progress", "done"]

def new_id() -> str:                      # str(uuid.uuid4())

class Episode(BaseModel):
    episode_id: str = Field(default_factory=new_id)
    user_id: str
    session_id: str
    text: str                            # "User: …\nAssistant: …" for chat turns
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class Fact(BaseModel):
    fact_id: str = Field(default_factory=new_id)
    content: str                         # complete sentence, starts with "User"
    type: FactType = "other"
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    last_seen: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict = Field(default_factory=dict)
    superseded_by: Optional[str] = None  # winner fact_id | "pruned" | None (=live)
    flagged: bool = False                # True when a contradiction tied

class GoalFact(BaseModel):
    goal_id: str = Field(default_factory=new_id)
    user_id: str
    topic: str
    phase_index: int                     # 0-based order
    phase_content: str
    status: GoalStatus = "not_started"
    metadata: dict = Field(default_factory=dict)

class FactProvenance(BaseModel):     fact_id: str; episode_id: str
class GoalFactProvenance(BaseModel): goal_id: str; episode_id: str

class ConsolidationLogEntry(BaseModel):
    run_id: str = Field(default_factory=new_id)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    user_id: str
    episodes_processed: int
    facts_created: int
    facts_updated: int
    contradictions_resolved: int
    facts_pruned: int
    details: list[dict] = Field(default_factory=list)
```

**Invariants**

- A `Fact` with `superseded_by is None` is *live*; anything else is archived (still readable
  for provenance, excluded from retrieval and default list queries).
- `superseded_by == "pruned"` is a sentinel, not a real `fact_id`.
- `confidence` is clamped to `[0.0, 1.0]` by Pydantic at construction.
- Timestamps are UTC; `retrieval` defensively coerces naive → UTC.

---

## 3. `config.py`

```python
get(path: str, default=None)     # dotted lookup into config.yaml, e.g. get("memory.ema_new_weight", 0.7)
api_key(provider: str) -> str    # reads GROQ_API_KEY / GOOGLE_API_KEY / … from env
```

Config is read once at import and cached. Every tunable in the system resolves through
`get()` with an inline default, so a missing `config.yaml` key never crashes — it falls
back. Owner-call values: `memory.ema_new_weight`, `memory.decay_half_life_days`,
`consolidation.trigger`.

---

## 4. `llm_client.py`

```python
chat(messages: list[dict], system: str | None = None, temperature: float = 0.2) -> str
stream(messages: list[dict], system: str | None = None, temperature: float = 0.2) -> Iterator[str]
```

- `messages`: `[{"role": "user"|"assistant", "content": str}]`.
- Provider chosen by `get("llm.provider")` → dispatches to `_groq` / `_gemini` / `_ollama`
  (and `_groq_stream` / …).
- `stream()` falls back to yielding one chunk if the provider has no true streaming.
- Callers: chat endpoints, extraction, contradiction judge, roadmap synthesizer.
- Failure modes: provider exceptions propagate to the caller; consolidation nodes catch
  and skip, chat endpoints surface a 500.

---

## 5. `store/embeddings.py`

```python
embed(text: str) -> list[float]                       # 384-d, all-MiniLM-L6-v2, CPU
cosine_similarity(a: list[float], b: list[float]) -> float
```

- Model loaded lazily on first `embed()` and held as a module singleton.
- No batching API in v0.1 — consolidation calls `embed()` per candidate/existing pair,
  which is O(candidates × existing_facts). Acceptable at single-user scale; a batch +
  cache is a known optimisation (see [`nfr-slo.md`](nfr-slo.md)).

---

## 6. `store/sqlite_store.py`

### 6.1 Connection

```python
@contextmanager
def _conn():
    # ensures ./data exists, opens sqlite3 connection
    # PRAGMA journal_mode=WAL ; PRAGMA foreign_keys=ON
    # yields con; commit on success, rollback + re-raise on exception; always close
```

Every write is synchronous and wrapped in this context manager (one transaction per call).

### 6.2 Schema (`init_db()`, idempotent, `CREATE TABLE IF NOT EXISTS`)

| Table | Key | Notes |
|-------|-----|-------|
| `episodes` | `episode_id` | `idx_episodes_user (user_id)` |
| `facts` | `fact_id` | `superseded_by` NULL = live; `flagged INTEGER`; `idx_facts_user_conf (confidence)` |
| `goal_facts` | `goal_id` | `idx_goal_user (user_id)` |
| `fact_provenance` | `(fact_id, episode_id)` | FK → facts, episodes |
| `goalfact_provenance` | `(goal_id, episode_id)` | FK → goal_facts, episodes |
| `consolidation_log` | `run_id` | `details` stored as JSON text |

### 6.3 Function surface

| Function | Purpose |
|----------|---------|
| `init_db()` | Create tables + indexes on startup. |
| `save_episode(ep)` | `INSERT OR REPLACE`. |
| `get_episodes(user_id, limit=200)` | Newest-first. |
| `get_episodes_since(user_id, since)` | Oldest-first, `timestamp > since`. Drives consolidation input. |
| `save_fact(fact)` | `INSERT OR REPLACE` all 8 columns; `metadata` JSON-encoded, `flagged` as int. |
| `get_facts(include_superseded=False)` | Default filters `superseded_by IS NULL`. |
| `get_fact(fact_id)` | Single fact or `None`. |
| `save_fact_provenance(fp)` | `INSERT OR IGNORE` on the composite PK (dup links are no-ops). |
| `get_provenance_episodes(fact_id)` | Join junction → episodes. |
| `save_goal_fact(gf)` / `get_goal_facts(user_id)` | Roadmap CRUD. |
| `update_goal_status(goal_id, status)` | Segmented control in the UI. |
| `save_goalfact_provenance(gfp)` | Planner provenance. |
| `save_consolidation_log(entry)` | `details` JSON-encoded. |
| `get_consolidation_log(limit)` | Sleep panel history. |

**Invariant:** `save_fact` is the only writer of the `facts` table; `resolve()` and every
consolidation node route through it, so `superseded_by` transitions are always persisted
atomically with the row.

---

## 7. `store/vector_store.py` — embedded Qdrant

```python
upsert_fact(fact_id: str, vector: list[float], payload: dict) -> None
search_similar(vector: list[float], top_k: int) -> list[dict]   # [{"fact_id", "score", ...}]
delete_fact(fact_id: str) -> None
```

- Collection `mnemos_facts`, 384-d, cosine distance, persisted at `./data/qdrant`.
- Payload is `{"content": …, "type": …}` — enough to render a result without a SQLite hit,
  though retrieval always re-fetches the authoritative `Fact`.
- `search_similar` raising (cold/empty collection) is caught by `retrieval.retrieve` →
  returns `[]`.

---

## 8. `memory/retrieval.py` — decay-ranked retrieval

### 8.1 Formula

```
score(fact) = cosine_similarity(query, fact) · exp(-λ · age_days)
λ           = ln(2) / half_life_days          # half_life_days = 30 (config)
age_days    = max((now_utc - fact.last_seen) / 1 day, 0)
```

So a fact's contribution **halves every 30 days** since it was last reinforced.

### 8.2 `retrieve(query, top_k=5, include_superseded=False)`

1. `query_vec = embeddings.embed(query)`.
2. `candidates = vector_store.search_similar(query_vec, top_k=top_k*3)` — over-fetch 3×
   because decay re-orders and superseded facts get dropped. On exception → return `[]`.
3. For each candidate: load `Fact` from SQLite (skip if gone; skip if `superseded_by` set
   and not `include_superseded`).
4. `score = candidate.score · exp(-λ · age_days(fact))`.
5. Sort by score desc, return top `top_k` as `list[tuple[Fact, float]]`.

`retrieve_for_context(query, top_k=5) -> list[Fact]` — same, Facts only.

**Edge case:** before the first consolidation there are no vectors → `search_similar`
returns empty/raises → `retrieve` returns `[]` → chat runs with `"(none yet)"` memory
context.

---

## 9. `memory/contradiction.py`

### 9.1 Detection — `find_contradictions(new_fact, existing_facts) -> list[Fact]`

```
for ef in existing_facts:
    if ef.fact_id == new_fact.fact_id: continue
    sim = cosine_similarity(embed(new_fact.content), embed(ef.content))
    if sim >= similarity_threshold (config memory.similarity_threshold, 0.60):
        if _judge_contradiction(new_fact.content, ef.content):   # LLM, temp=0
            conflicts.append(ef)
```

Two-stage by design: the cheap embedding filter keeps the expensive LLM judge call count
proportional to *near-duplicate* pairs, not all pairs.

`_judge_contradiction` uses a fixed system prompt with CONTRADICT/CONSISTENT few-shot
examples and expects exactly one word back; returns `"CONTRADICT" in reply.upper()`.

### 9.2 Resolution — `resolve(new_fact, existing) -> (winner, loser)`

Policy (spec §3.3, [ADR-003](../ADRs/003-contradiction-keep-both.md)):

```
if new.confidence > existing.confidence:      winner = new
elif existing.confidence > new.confidence:    winner = existing
else:                                         # tie on confidence
    if new.last_seen > existing.last_seen:    winner = new
    elif existing.last_seen > new.last_seen:  winner = existing
    else:                                     # true tie
        new.flagged = existing.flagged = True
        save both; return (new, existing)     # keep BOTH, no supersede
winner survives; loser.superseded_by = winner.fact_id
save winner; save loser
```

`_supersede(loser, winner)` only sets the pointer; persistence is the explicit
`sqlite_store.save_fact` calls at the end.

**Invariant:** except in the true-tie branch, exactly one of the pair ends with
`superseded_by` set, and it points at the other's `fact_id`.

---

## 10. `memory/consolidation.py` — the sleep cycle

### 10.1 Graph

```
StateGraph(ConsolidationState)
  entry → extract → dedupe → contradiction_check → prune → END
```

Compiled once, memoised in module global `_graph`.

### 10.2 State

```python
class ConsolidationState(TypedDict):
    user_id: str
    episodes: list[Episode]
    extracted: list[dict]        # {"content","type","episode_ids","episode_timestamp"}
    new_facts: list[Fact]        # created this run, not yet contradiction-checked
    new_fact_ep_ids: dict        # fact_id -> [episode_id]
    log: dict                    # ConsolidationLogEntry.model_dump(), mutated in place
```

### 10.3 Nodes

**`_extract`** — per episode: `llm_client.chat(system=_EXTRACT_SYSTEM, temp=0)` → expect a
JSON array of `{content, type}`. Attach `episode_ids` + `episode_timestamp`. Malformed
JSON / exception → skip that episode silently. Output → `state["extracted"]`.

**`_dedupe`** — load live facts once. For each candidate:
- `best_sim` = max cosine over all existing facts.
- `SIM_DEDUPE = 0.92` (hard-coded, tighter than the contradiction threshold).
- **match ≥ 0.92:** `match.confidence = round(0.7·1.0 + 0.3·prior, 4)`,
  `match.last_seen = now`, `save_fact`, add provenance rows, `log.facts_updated += 1`.
- **else:** build `Fact(content, type, confidence=1.0, last_seen=episode_timestamp)`,
  append to `new_facts`, record `new_fact_ep_ids`, `log.facts_created += 1`.
  *(Not yet written to SQLite/Qdrant — that happens in the next node.)*

**`_contradiction_check`** — load live facts once into a local `existing_facts` list that
is **mutated as we go** so two new facts from the same run can contradict each other
(s1 "Python" vs s2 "Rust" → Rust wins).
For each `new_fact`:
- `conflicts = contra.find_contradictions(new_fact, existing_facts)`.
- **conflicts:** for each, `winner, loser = contra.resolve(...)`;
  `resolved_count += 1`; append a `contradiction_resolved` detail;
  link this run's episodes to the **winner**;
  if `winner is new_fact`, upsert its vector to Qdrant (resolve only wrote SQLite);
  update the local list — drop `loser`, add `winner` if absent.
- **no conflict:** `save_fact(new_fact)` + provenance + `vector_store.upsert_fact(...)`;
  append to local list so later iterations see it.
- `log["contradictions_resolved"] = resolved_count`.

**`_prune`** — over all live facts: `confidence < confidence_floor (0.1)` →
`superseded_by = "pruned"`, `save_fact`, `vector_store.delete_fact`, append a `pruned`
detail, `log.facts_pruned += 1`. No hard delete.

### 10.4 Entry point

```python
run_consolidation(user_id, episodes: list[Episode]) -> ConsolidationLogEntry
```

- Builds a zeroed `ConsolidationLogEntry`, dumps it into `initial_state["log"]`.
- `final_state = _graph.invoke(initial_state)`.
- Reconstructs a `ConsolidationLogEntry` from `final_state["log"]` (splitting `details`
  out and back in), `sqlite_store.save_consolidation_log(...)`, returns it.

**Concurrency:** invoked on a background `threading.Thread` from the chat path. No lock —
two overlapping runs are possible in theory; single-user timing makes it a non-issue for
v0.1. `save_fact` being `INSERT OR REPLACE` makes double-writes idempotent rather than
corrupting.

### 10.5 Ordering guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| A re-observed fact strengthens rather than duplicates | dedupe 0.92 cosine gate before creation |
| A contradicting fact never coexists silently with its opposite | contradiction_check runs after dedupe, before persist |
| Provenance always points at the surviving fact | winner-linking in contradiction_check |
| Low-confidence drift is bounded | prune floor at end of every run |
| SQLite is written before Qdrant | explicit call order in each node |

---

## 11. `planner/roadmap_planner.py`

### 11.1 Contract

```python
plan_roadmap(topic: str, background: str) -> list[GoalFact]
```

Stable, swappable — [ADR-005](../ADRs/005-planner-langgraph-escape-hatch.md) keeps the
graph behind this one function so it can be replaced without touching callers.

### 11.2 Graph

```
PlannerState = {messages: Annotated[list, operator.add], topic, background, raw_plan: str}

researcher ──(tool calls?)──▶ ToolNode(PLANNER_TOOLS) ──▶ researcher
     │ (no more tool calls)
     ▼
synthesizer ──▶ END
```

- `_get_llm_with_tools()` — Groq or Gemini only (`.bind_tools`); Ollama raises
  (`ValueError` — no tool calling).
- **researcher** — system prompt instructs it to gather sources with the tools; loops
  through `ToolNode` until it stops emitting tool calls.
- **synthesizer** — structured-output node; emits a JSON string (`raw_plan`) of 4–6 ordered
  phases; parsed into `GoalFact(topic, phase_index, phase_content, status="not_started")`.
- Persisted by the caller with `GoalFactProvenance` linking every phase to the planning
  episode.

## 12. `planner/tools.py`

| Tool | Backend | Fallback |
|------|---------|----------|
| `web_search(query)` | Tavily (`TAVILY_API_KEY`) | DuckDuckGo if key absent |
| `arxiv_search(query)` | arXiv API | — |
| `github_search(query)` | GitHub search API (`GITHUB_TOKEN` raises 60→5000 req/hr) | unauthenticated |
| `fetch_page(url)` | HTTP GET + text extraction, follows redirects | returns error string |

All tools return plain strings (or string-serialisable) so they slot straight into
`ToolNode` / MCP responses.

---

## 13. `api.py` — endpoint internals

`FastAPI(title="mnemos API", version="0.1.0", lifespan=lifespan)`; CORS for
`localhost:5173` + `localhost:3000`. `lifespan` calls `sqlite_store.init_db()` and,
if `seed_demo`, `_seed_demo()`.

| Endpoint | Internals |
|----------|-----------|
| `GET /health` | `{"status": "ok"}`. |
| `POST /chat` | retrieve top-5 → build memory block → last ≤10 same-session turns → `llm_client.chat` → `save_episode("User: …\nAssistant: …")` → maybe auto-consolidate → return `{reply, session_id, episode_id, memory_used}`. |
| `POST /chat/stream` | same pipeline; `StreamingResponse` of `llm_client.stream`; episode saved after the stream completes. |
| `GET /memory/facts` | `get_facts()` (live only). |
| `GET /memory/fact/{fact_id}` | fact + provenance episodes (full text) + `superseded_by` / `flagged`. |
| `POST /memory/consolidate` | gather episodes (`since_hours` or all unconsolidated) → `run_consolidation` → return the log entry. |
| `GET /memory/log` | `get_consolidation_log(limit)`. |
| `POST /memory/ingest` | `kind="file"` → read + chunk; `kind="github"` → walk repo (redirects followed); each chunk saved as an `Episode`; optional immediate consolidate. |
| `GET /episodes` | recent episodes for the timeline. |
| `GET /goals` | `get_goal_facts(user_id)`. |
| `PATCH /goals/{goal_id}/status` | `update_goal_status`. |
| `POST /plan` | `plan_roadmap(topic, background)` → persist `GoalFact`s + provenance → return them. |

**`_maybe_auto_consolidate`** — runs iff `consolidation.trigger != "manual"` and
`len(episodes_since_last_run) >= min_episodes_to_trigger` (3); spawns a daemon thread so
the chat response is not blocked.

---

## 14. `mcp_server.py` — FastMCP surface

**Tools:** `remember(text, session_id)`, `recall(query, top_k=5)`,
`get_provenance(fact_id)`, `consolidate()`, `list_facts(include_flagged=True)`,
`plan_learning_roadmap(topic, background)`, `ingest_file(path, session_id)`,
`ingest_github(repo_url, session_id)`.

**Resources:** `memory://facts`, `memory://consolidation-log` — both return JSON strings.

Each tool is a thin wrapper: `remember` → `save_episode`; `recall` →
`retrieval.retrieve` formatted as text; `get_provenance` → junction walk;
`consolidate` → `run_consolidation` over unconsolidated episodes; `list_facts` →
`get_facts` (optionally hiding `flagged`); the ingest/plan tools reuse the exact code
paths behind `POST /memory/ingest` and `POST /plan`.

Transport: stdio (`python -m src.mcp_server`) or HTTP/SSE (`--http --port 8001`). Shares
`./data` with the API — running both against one data dir is supported (single-user).

---

## 15. Frontend internals (`frontend/src/`)

| File | Internals |
|------|-----------|
| `App.jsx` | `useState` tab index; renders one panel. No router. |
| `api.js` | axios instance `baseURL: ''`; `chatStream()` uses native `fetch` + `ReadableStream` reader to parse SSE `data:` lines. |
| `panels/Chat.jsx` | optimistic user message; streams assistant tokens; `memory_used` IDs rendered as an expandable recall trace. |
| `panels/MemoryInspector.jsx` | `GET /memory/facts` list; row click → `GET /memory/fact/{id}` detail with provenance; ingest bar POSTs to `/memory/ingest`. |
| `panels/Goals.jsx` | `GET /goals`; segmented control PATCHes `/goals/{id}/status`; phases grouped by `topic`, ordered by `phase_index`. |
| `panels/ConsolidationLog.jsx` | `GET /memory/log`; one row per run with the five counters + expandable `details`. |

**Design system** (`src/index.css`): HSL CSS variables only. Space Grotesk (UI) / IBM Plex
Mono (data + IDs). Accent `--ac` periwinkle for interactive, `--am` amber for data values
only. Type scale 11/12/14/16/20. Radius `--r` 4px or `--rl` 7px only.

---

## 16. Configuration reference (`config.yaml`)

| Key | Default | Used by |
|-----|---------|---------|
| `llm.provider` | `groq` | `llm_client`, planner |
| `llm.groq_model` / `gemini_model` / `ollama_model` | see file | `llm_client` |
| `embeddings.model` / `dimension` | `all-MiniLM-L6-v2` / 384 | `embeddings`, `vector_store` |
| `vector_store.path` / `collection` | `./data/qdrant` / `mnemos_facts` | `vector_store` |
| `database.path` | `./data/mnemos.db` | `sqlite_store` |
| `memory.ema_new_weight` | `0.7` `[OWNER CALL]` | `consolidation._dedupe` |
| `memory.decay_half_life_days` | `30` `[OWNER CALL]` | `retrieval` |
| `memory.confidence_floor` | `0.1` | `consolidation._prune` |
| `memory.similarity_threshold` | `0.60` | `contradiction.find_contradictions` |
| `consolidation.trigger` | `manual` `[OWNER CALL]` | `api._maybe_auto_consolidate` |
| `consolidation.min_episodes_to_trigger` | `3` | `api._maybe_auto_consolidate` |
| `user.default_user_id` | `local_user` | everywhere `user_id` is needed |
| `seed_demo` | `false` | `api.lifespan` |

*(`_dedupe` uses a hard-coded `SIM_DEDUPE = 0.92` that is intentionally **not** in config —
it is an algorithm constant, not an owner tunable.)*

---

## 17. Error handling matrix

| Failure | Where | Behaviour |
|---------|-------|-----------|
| LLM returns non-JSON in extraction | `_extract` | episode skipped, run continues |
| LLM provider throws | chat endpoints | HTTP 500; consolidation nodes swallow + continue |
| Qdrant search on empty collection | `retrieval.retrieve` | caught → `[]` → chat uses `"(none yet)"` |
| Duplicate provenance link | `save_fact_provenance` | `INSERT OR IGNORE` — no-op |
| Crash between SQLite and Qdrant write | consolidation nodes | next run re-embeds + re-indexes the fact |
| Tavily key missing | `web_search` | DuckDuckGo fallback |
| GitHub rate limit | `github_search` / ingest | unauthenticated limit; set `GITHUB_TOKEN` |
| Ollama selected for planner | `_get_llm_with_tools` | `ValueError` — no tool calling on Ollama |

---

## 18. Test surface

- **Unit:** `uv run pytest` — store CRUD, retrieval decay maths, contradiction policy
  branches, consolidation node behaviour with a stub LLM.
- **Single test:** `uv run pytest tests/test_foo.py::test_bar -v`.
- **Evals:** `uv run python evals/run_evals.py [--filter <name>] [--verbose]` — behavioural
  checks on memory quality (extraction precision, contradiction resolution correctness,
  decay ordering).
- **Lint/format:** `uv run ruff check src/`, `uv run ruff format src/` (line length 100).
