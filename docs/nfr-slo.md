# Mnemos — Non-Functional Requirements & Service Objectives

Scope: single-user, local-first v0.1. Targets are budgets for a laptop-class machine
(4-core CPU, 16 GB RAM), no GPU, free-tier LLM keys. They are engineering targets, not
contractual SLAs.

---

## 1. Performance budgets

| Operation | Target (p50) | Target (p95) | Dominant cost | Notes |
|-----------|-------------|-------------|---------------|-------|
| `GET /health` | < 5 ms | < 20 ms | — | |
| `GET /memory/facts` | < 30 ms | < 100 ms | SQLite scan | grows linearly with fact count |
| `GET /memory/fact/{id}` | < 40 ms | < 120 ms | junction join | |
| Retrieval (`retrieve`, top-5) | < 150 ms | < 400 ms | 1 embed + Qdrant search + N `get_fact` | over-fetches 3× |
| `POST /chat` (non-stream) | 1–4 s | < 10 s | **LLM completion** | free-tier latency dominates |
| `POST /chat/stream` — first token | < 1.5 s | < 4 s | LLM TTFT | |
| Consolidation per episode | 1–3 s | < 8 s | 1 extract LLM call + O(candidates×facts) embeds | |
| Consolidation, 10 episodes | 15–40 s | < 90 s | serial LLM + embed | background thread; UI not blocked |
| `POST /plan` | 20–90 s | < 180 s | multi-round tool-calling agent | |

**Known scaling cliff:** `_dedupe` and `find_contradictions` embed every
candidate × every existing fact each run — O(n²) in fact count with no cache. Fine to a
few thousand facts; past that, add batch embedding + an embedding cache keyed on
`content` hash. Tracked in [`../ROADMAP.md`](../ROADMAP.md).

---

## 2. Availability & degradation

| Dependency | If unavailable | Degraded behaviour |
|------------|----------------|--------------------|
| LLM provider | chat / consolidation fail | HTTP 500 on chat; consolidation nodes skip the episode and continue; switch provider in `config.yaml`; Ollama is a fully local fallback |
| Tavily | web search | automatic DuckDuckGo fallback |
| GitHub API | repo ingest / search | unauthenticated rate limit (60/hr); set `GITHUB_TOKEN` for 5000/hr |
| Qdrant (cold/empty) | retrieval | `retrieve` returns `[]`; chat proceeds with `"(none yet)"` memory |
| SQLite locked (WAL) | writes | context manager rolls back + re-raises; caller retries |

No process supervisor in v0.1 — `docker compose` restart policy is the recovery
mechanism.

---

## 3. Data durability & consistency

- **Durability:** SQLite WAL + `./data` bind-mount. Survives container restarts. No
  automated backup — copying `./data` while stopped is the backup.
- **Consistency:** SQLite is authoritative; Qdrant is a rebuildable index. Within a
  consolidation run, SQLite is written before Qdrant; a crash between the two leaves an
  un-indexed live fact that the next run re-indexes.
- **No hard deletes:** contradiction losers (`superseded_by = winner_id`) and pruned
  facts (`superseded_by = "pruned"`) stay in `facts` forever for provenance.
- **Idempotency:** `save_fact` / `save_episode` are `INSERT OR REPLACE`;
  `save_fact_provenance` is `INSERT OR IGNORE`. Re-running consolidation over the same
  episodes does not duplicate rows.

---

## 4. Correctness objectives (measured by `evals/run_evals.py`)

| Objective | Intent |
|-----------|--------|
| Extraction precision | Extracted facts are complete `"User …"` sentences, explicitly stated, correctly typed |
| Dedupe recall | Re-stating a known fact strengthens it (EMA) rather than creating a duplicate |
| Contradiction resolution | Genuine contradictions resolve to the correct winner; compatible statements are left alone |
| Decay ordering | Given equal similarity, a fresher fact outranks a staler one |
| Provenance integrity | Every live fact resolves to ≥ 1 source episode; contradiction winners inherit the run's episodes |

Run before declaring any change to retrieval, ranking, consolidation, contradiction
logic, scoring, or prompts complete.

---

## 5. Security & privacy

| Area | v0.1 posture |
|------|--------------|
| Inbound auth | none — local origin only; do not expose the port publicly |
| Secrets | `.env` (git-ignored); `GROQ_API_KEY` / `GOOGLE_API_KEY` / `TAVILY_API_KEY` / `GITHUB_TOKEN` |
| Data at rest | plaintext SQLite + Qdrant on local disk; no encryption |
| Egress | conversation text goes to the configured LLM provider and to `fetch_page` targets during planning/ingest |
| Supply chain | MCP SDK pinned pending the April 2026 RCE advisory; `uv.lock` committed |
| PII | all memory is about the single user by design; deletion = stop the stack, delete `./data` |

---

## 6. Observability

| Signal | Source |
|--------|--------|
| Consolidation outcomes | `ConsolidationLogEntry` per run + the Sleep panel (`GET /memory/log`) |
| Memory state | Memory inspector + `memory://facts` resource |
| Request errors | uvicorn stdout |
| Graph tracing | not wired in v0.1 — LangSmith integration is on the roadmap |

---

## 7. Maintainability constraints

- `api.py` is deliberately single-file / no-routers at v0.1 size; a router split is a
  known future refactor once endpoint count or contributor count grows.
- Every runtime tunable resolves through `config.get("dotted.path", default)` with an
  inline default — a missing config key degrades, never crashes.
- Algorithm constants that are **not** owner tunables (e.g. `SIM_DEDUPE = 0.92`) stay in
  code, not `config.yaml`.
- Lint/format gate: `ruff check` + `ruff format` (line length 100) before commit.

---

## 8. Portability

- Backend: Python 3.11+, `uv`-managed. No OS-specific calls.
- Frontend: Node 18+, Vite build → static assets.
- Embeddings run on CPU; no CUDA requirement.
- Everything ships in two container images + one data volume.
