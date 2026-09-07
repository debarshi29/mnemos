# Mnemos — High-Level Design (HLD)

**Status:** Baseline for v0.1
**Audience:** Engineers, reviewers, and integrators evaluating the system
**Companion documents:** [`LLD.md`](LLD.md), [`data-model.md`](data-model.md), [`api-reference.md`](api-reference.md), [`sequence-diagrams.md`](sequence-diagrams.md), [`nfr-slo.md`](nfr-slo.md), [`c4-diagrams.md`](c4-diagrams.md), [`../ADRs`](../ADRs)

---

## 1. Purpose and scope

Mnemos is an **agentic memory system**. It gives an AI assistant persistent memory that
*consolidates* over time, *resolves contradictions* as explicit decisions, and keeps a
*full provenance chain* from every remembered fact back to the raw conversation that
produced it.

The shipped reference application is a learning copilot, but the memory layer is the
product. It is domain-agnostic: domain-specific attributes live in a `metadata` JSON
column, never in the schema.

### In scope for v0.1

- Three-tier memory: episodic → semantic → goal.
- LLM-driven consolidation ("sleep cycle"): extract → dedupe → contradiction-check → prune.
- Decay-ranked vector retrieval.
- Contradiction resolution with archival (never hard-delete).
- REST API (FastAPI) + SSE streaming chat.
- MCP server (FastMCP) exposing memory as tools/resources to Claude Desktop, Cursor, etc.
- React inspector UI: chat, memory browser with provenance, roadmap, consolidation log.
- Single-user, local-first deployment via Docker Compose.

### Out of scope for v0.1 (see [`../ROADMAP.md`](../ROADMAP.md))

- Multi-user auth and tenancy (the `user_id` partition key exists; auth does not).
- Hosted mode (Postgres, Qdrant Cloud).
- Procedural memory tier, associative graph retrieval, background async consolidation.

---

## 2. Design goals and non-goals

| # | Goal | Rationale |
|---|------|-----------|
| G1 | **Provenance is non-negotiable** | Every fact must be traceable to its source episodes. Trust in an AI's memory requires being able to audit it. |
| G2 | **Contradictions are decisions, not averages** | Averaging two conflicting beliefs produces a belief no one holds. Pick a winner, archive the loser with an audit trail. |
| G3 | **Memory decays** | Stale facts should rank lower automatically. Recency is signal. |
| G4 | **Runs for free, locally** | Groq/Gemini free tiers, CPU embeddings, embedded SQLite + Qdrant. No cloud bill to try it. |
| G5 | **Provider-swappable** | One `chat()` / `embed()` signature; provider chosen in `config.yaml`. |
| G6 | **Domain-agnostic core** | Schema carries no domain fields. Re-skinning to CRM / research notes / health journal is configuration, not a migration. |

**Non-goals:** low-latency (<50 ms) retrieval, horizontal scale, exactly-once consolidation
semantics, real-time collaborative editing.

---

## 3. System context

```
                    ┌───────────────────────────┐
   Human user ─────▶│   React inspector UI      │
                    │  chat · memory · roadmap  │
                    │       · sleep log         │
                    └────────────┬──────────────┘
                                 │ REST + SSE (same origin via nginx / Vite proxy)
                                 ▼
   Claude Desktop  ─── MCP ───▶ ┌───────────────────────────┐
   Cursor / other  (stdio/HTTP) │   Mnemos backend          │
   MCP clients                  │   FastAPI + FastMCP        │
                                └───────┬──────────┬────────┘
                                        │          │
                              ┌─────────▼──┐   ┌───▼──────────┐
                              │ SQLite WAL │   │ Qdrant       │
                              │  ./data    │   │ (embedded)   │
                              └────────────┘   └──────────────┘
                                        │
                                        ▼
                       External LLM providers (Groq / Gemini / Ollama)
                       External tools (Tavily, DuckDuckGo, arXiv, GitHub)
```

**Actors**

| Actor | Interaction |
|-------|-------------|
| Human user | Chats, browses memory + provenance, edits roadmap phase status, triggers consolidation. |
| MCP client (Claude Desktop, Cursor) | Calls `remember`, `recall`, `get_provenance`, `consolidate`, `list_facts`, `plan_learning_roadmap`, `ingest_file`, `ingest_github`; reads `memory://facts`, `memory://consolidation-log`. |
| LLM provider | Chat completion, fact extraction, contradiction judging, roadmap synthesis. |
| Search/tool providers | Web, arXiv, GitHub research during roadmap planning and repo ingest. |

---

## 4. Component overview

### 4.1 Backend (`src/`)

| Component | Module | Responsibility |
|-----------|--------|----------------|
| **API layer** | `api.py` | All HTTP endpoints, request/response models, SSE streaming, auto-consolidation trigger. Single file, no routers. |
| **MCP server** | `mcp_server.py` | 8 tools + 2 resources over stdio or HTTP/SSE. Thin adapter over the same store + memory functions the API uses. |
| **Schema** | `schema.py` | Pydantic v2 models: `Episode`, `Fact`, `GoalFact`, provenance junctions, `ConsolidationLogEntry`. |
| **Config** | `config.py` | Loads `config.yaml`; `get("dotted.path", default)` and `api_key(provider)`. |
| **LLM client** | `llm_client.py` | Provider-switchable `chat()` / `stream()` for Groq, Gemini, Ollama. |
| **Consolidation** | `memory/consolidation.py` | LangGraph subgraph: extract → dedupe → contradiction_check → prune. Writes facts, provenance, log entry. |
| **Contradiction** | `memory/contradiction.py` | Embedding pre-filter → LLM judge → resolution policy (confidence → recency → keep-both-flagged). |
| **Retrieval** | `memory/retrieval.py` | Decay-ranked nearest-neighbour: `score = cosine_sim · exp(-λ·age_days)`. |
| **Roadmap planner** | `planner/roadmap_planner.py` | Two-node LangGraph: researcher (tool-calling) → synthesizer (structured GoalFacts). |
| **Planner tools** | `planner/tools.py` | `web_search`, `arxiv_search`, `github_search`, `fetch_page`. |
| **SQLite store** | `store/sqlite_store.py` | Full CRUD over SQLite WAL. Schema created on startup; no migrations. |
| **Vector store** | `store/vector_store.py` | Embedded Qdrant wrapper: upsert / search / delete fact vectors. |
| **Embeddings** | `store/embeddings.py` | SentenceTransformer `all-MiniLM-L6-v2` (384-d, CPU) + cosine similarity. |

### 4.2 Frontend (`frontend/src/`)

React 19 + Vite, JSX only, no CSS framework.

| Component | File | Responsibility |
|-----------|------|----------------|
| Shell | `App.jsx` | Top-bar tab navigation: Chat / Memory / Roadmap / Sleep. |
| API client | `api.js` | axios for REST, native `fetch` for SSE. `baseURL: ''` — same origin everywhere. |
| Chat | `panels/Chat.jsx` | SSE streaming chat, inline expandable memory-recall trace. |
| Memory inspector | `panels/MemoryInspector.jsx` | Fact list, provenance detail, file/GitHub ingest bar. |
| Roadmap | `panels/Goals.jsx` | Phased roadmap with segmented status control. |
| Consolidation log | `panels/ConsolidationLog.jsx` | Run history: episodes processed, facts created/updated, contradictions, prunes. |

---

## 5. Data architecture

Three tiers, each a strict refinement of the one before:

| Tier | Model | Written by | Lifetime |
|------|-------|-----------|----------|
| **Episodic** | `Episode` | Every chat turn, every ingest | Permanent (source of truth for provenance) |
| **Semantic** | `Fact` | Consolidation `dedupe` / `contradiction_check` nodes | Until superseded or pruned (marked, not deleted) |
| **Goal** | `GoalFact` | Roadmap planner | Until replaced by a new roadmap for the same topic |

**Provenance** is modelled as many-to-many junction tables (`fact_provenance`,
`goalfact_provenance`) linking each derived fact to every episode that contributed to it.
A fact re-observed across three sessions has three provenance rows.

**Storage engines**

- **SQLite (WAL mode)** — system of record for all structured data. `./data/mnemos.db`,
  Docker bind-mount. Schema in `init_db()`, created idempotently on startup.
- **Embedded Qdrant** — `./data/qdrant`, collection `mnemos_facts`. Holds one 384-d vector
  per live fact plus `{content, type}` payload. Rebuilt from SQLite if lost (facts are
  re-embedded on next consolidation touch).

The two stores are **eventually consistent within a single consolidation run**: SQLite is
written first, Qdrant second. A crash between the two leaves an un-indexed fact that the
next consolidation run re-indexes.

Full field-by-field detail: [`data-model.md`](data-model.md).

---

## 6. Key runtime flows

### 6.1 Chat turn

1. `POST /chat` (or `/chat/stream`) with `{message, session_id?}`.
2. Retrieval: embed the message, decay-rank top-5 facts, build a memory-context block.
3. Assemble last ≤10 turns of session history + memory context + system prompt.
4. LLM generates the reply (streamed token-by-token for `/chat/stream`).
5. Persist the turn as an `Episode` (`"User: …\nAssistant: …"`).
6. If `consolidation.trigger != manual` and ≥ `min_episodes_to_trigger` new episodes exist,
   fire consolidation on a background thread.
7. Response carries `memory_used` — the fact IDs that shaped the answer.

### 6.2 Consolidation ("sleep cycle")

LangGraph subgraph, invoked by `POST /memory/consolidate` or the auto-trigger:

```
extract ──▶ dedupe ──▶ contradiction_check ──▶ prune ──▶ END
```

- **extract** — LLM pulls atomic `"User …"` sentences + type from each episode.
- **dedupe** — cosine ≥ 0.92 against an existing fact → EMA-merge confidence
  (`new = 0.7·1.0 + 0.3·prior`), refresh `last_seen`, add provenance. Else → new fact.
- **contradiction_check** — for each new fact: cosine ≥ 0.60 pre-filter → LLM judge →
  `resolve()`. Winner by confidence, then recency; true tie → keep both, flag both. Loser
  gets `superseded_by = winner_id`. New facts are indexed in Qdrant here.
- **prune** — facts with `confidence < 0.1` get `superseded_by = "pruned"` and are removed
  from Qdrant. Never hard-deleted from SQLite.

A `ConsolidationLogEntry` records counts + a `details[]` array of every contradiction and prune.

### 6.3 Roadmap planning

`POST /plan` `{topic, background}` → two-node LangGraph:

1. **researcher** — tool-calling agent loops over `web_search` / `arxiv_search` /
   `github_search` / `fetch_page` until it has enough material.
2. **synthesizer** — converts research into 4–6 ordered `GoalFact` phases, persisted with
   provenance to the planning episode.

### 6.4 MCP session

MCP client calls map 1:1 onto store + memory functions — no separate business logic.
`remember` → save episode; `recall` → decay-ranked retrieve; `get_provenance` → junction
walk; `consolidate` → run the sleep cycle; resources stream current facts / log as JSON.

Sequence diagrams for all four: [`sequence-diagrams.md`](sequence-diagrams.md).

---

## 7. Technology choices

| Concern | Choice | Why | ADR |
|---------|--------|-----|-----|
| Confidence update | Exponential moving average, `w=0.7` | Cheap, recency-weighted, no ground-truth needed | [ADR-001](../ADRs/001-ema-confidence.md) |
| Retrieval decay | Exponential, 30-day half-life | Smooth, single tunable, matches intuition of "fades" | [ADR-002](../ADRs/002-decay-half-life.md) |
| Contradiction tie | Keep both, flag both | Never silently drop a user belief; surface the conflict | [ADR-003](../ADRs/003-contradiction-keep-both.md) |
| LLM provider | Groq / Gemini / Ollama, config-switched | Free tiers + local option; avoid vendor lock-in | [ADR-004](../ADRs/004-provider-switch.md) |
| Planner orchestration | LangGraph with a hand-rolled escape hatch | Graph clarity without full framework lock-in | [ADR-005](../ADRs/005-planner-langgraph-escape-hatch.md) |
| MCP surface | FastMCP, 8 tools + 2 resources | Standard protocol; drop-in for Claude Desktop / Cursor | [ADR-006](../ADRs/006-fastmcp-memory-server.md) |
| Structured DB | SQLite WAL | Zero-ops, single-file, good enough for single-user | — |
| Vector DB | Embedded Qdrant | Runs in-process, no server, payload filtering | — |
| Embeddings | `all-MiniLM-L6-v2` (384-d) | Fast on CPU, strong for short sentences | — |
| Frontend | React 19 + Vite, JSX, no CSS framework | Small surface, hand-written design system | — |

---

## 8. Deployment topology

### Docker Compose (primary)

| Service | Port | Notes |
|---------|------|-------|
| `frontend` | 3000 | nginx serving the built SPA; rewrites `/chat`, `/memory`, `/episodes`, `/goals`, `/plan`, `/health` to `backend:8000`. |
| `backend` | 8000 | uvicorn `src.api:app`; Swagger at `/docs`. |
| (volume) | — | `./data` bind-mount holds `mnemos.db` + `qdrant/`. |

MCP server runs as a separate process (`python -m src.mcp_server`), stdio for Claude
Desktop or `--http --port 8001` for networked clients. It shares the same `./data`.

### Local dev

`make dev` runs uvicorn `:8000` (reload) + Vite `:5173` in parallel; Vite proxies API
routes to `:8000`.

---

## 9. Cross-cutting concerns

| Concern | v0.1 approach |
|---------|---------------|
| **Auth** | None. Single `default_user_id` from config. `user_id` threaded through the schema for the future. |
| **Config** | Everything tunable in `config.yaml`; owner-call values (EMA weight, half-life, trigger policy) are marked `[OWNER CALL]`. |
| **Error handling** | LLM/tool failures degrade gracefully — malformed extraction skips the episode, retrieval returns `[]` before first consolidation, DuckDuckGo backs up Tavily. |
| **Consistency** | SQLite-first, Qdrant-second within a consolidation run; next run heals a partial write. |
| **Observability** | `ConsolidationLogEntry` per run + the Sleep panel. LangSmith tracing is roadmap. |
| **Security** | Local-first, no inbound auth surface. API keys via `.env`. `GITHUB_TOKEN` optional (rate-limit only). MCP SDK pinned pending the April 2026 advisory. |
| **Testing** | `uv run pytest` (unit), `evals/run_evals.py` (behavioural evals over memory quality). |

Targets and budgets: [`nfr-slo.md`](nfr-slo.md).

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM extraction noise (fragments, hallucinated facts) | Low-quality memory | Strict `"User …"` sentence rule + type whitelist + "only explicitly stated" instruction; prune floor removes low-confidence drift. |
| Contradiction judge false negatives | Stale belief lingers | Decay pushes it down retrieval ranking over ~30 days even if not superseded. |
| SQLite ↔ Qdrant divergence | Fact missing from retrieval | Re-indexed on next consolidation touch; Qdrant is rebuildable from SQLite. |
| Free-tier rate limits | Consolidation stalls | Provider switch in config; Ollama fully local fallback. |
| Single-file API / no routers | Merge friction as it grows | Acceptable at v0.1 size; router split is a known future refactor. |
| No auth | Not deployable multi-user as-is | Explicitly out of scope; partition key already in schema. |
