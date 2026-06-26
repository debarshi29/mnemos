# mnemos

> Agentic memory with consolidation, contradiction resolution, and full provenance — plug it into any AI assistant via MCP.

[![Python](https://img.shields.io/badge/python-3.11%2B-blue?logo=python&logoColor=white)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangGraph-orchestration-6c3fc4?logo=langchain)](https://github.com/langchain-ai/langgraph)
[![FastMCP](https://img.shields.io/badge/FastMCP-MCP%20server-22c55e)](https://github.com/jlowin/fastmcp)
[![React](https://img.shields.io/badge/React-frontend-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## What is this?

Hosted AI assistants hide their memory plumbing. mnemos makes it visible, inspectable, and composable:

- **Click any fact → see exactly which past conversations created it** (full provenance chain)
- **Contradictions are decisions, not averages** — the losing belief is archived with a full audit trail
- **Memory decays** — stale facts rank lower at retrieval time, fresh ones surface naturally
- **Runs entirely for free** — Groq/Gemini free tiers, CPU embeddings, local SQLite + Qdrant

The reference implementation is a learning copilot. The memory layer is the thesis — it generalises to any domain where an AI needs to know things about you across sessions.

---

## Architecture

```
You ──► Chat (FastAPI) ──► Episode saved to SQLite
              │
              ├──► Roadmap Planner (LangGraph + tools)
              │       ├─ web_search  (Tavily / DuckDuckGo)
              │       ├─ github_search
              │       ├─ arxiv_search
              │       └─ fetch_page
              │                │
              │                ▼
              │         GoalFacts (phased roadmap)
              │
              └──► Sleep Cycle  (LangGraph consolidation subgraph)
                      ├─ extract    — LLM pulls facts from raw episodes
                      ├─ dedupe     — EMA confidence merge on re-observation
                      ├─ contradict — embedding pre-filter → LLM judge → resolve
                      └─ prune      — remove facts below confidence floor
                                │
                                ▼
                   ┌────────────────────────┐
                   │   Three-tier memory    │
                   │  episodic · semantic   │
                   │       · goal           │
                   └────────────────────────┘
                                │
                       FastMCP server  ◄── Claude Desktop / Cursor / any MCP client
                                │
                       React frontend
                  chat · memory inspector · roadmap · sleep log
```

---

## Features

| | |
|---|---|
| 🧠 **Three-tier memory** | Raw episodes → consolidated Facts → phased GoalFacts |
| 🔍 **Provenance inspector** | Click any fact to trace it back to source episodes |
| ⚡ **Decay-ranked retrieval** | Retrieval score halves every 30 days — freshness matters |
| 🔀 **Contradiction resolution** | LLM judge arbitrates; loser is archived, never deleted |
| 🔌 **MCP server** | Drop mnemos memory into Claude Desktop, Cursor, or any MCP client |
| 📥 **File & GitHub ingest** | Feed local files and repos directly into memory |
| 🗺️ **Roadmap planner** | Generates 4–6 phase learning plans with web + ArXiv + GitHub sources |
| 🐳 **Docker ready** | One command to start everything |
| 💸 **Zero cost** | Groq/Gemini free tiers; embeddings run locally on CPU |

---

## Quick start

### Option A — Docker (recommended)

```bash
git clone https://github.com/debarshi29/mnemos.git
cd mnemos

cp .env.example .env
# Edit .env — add at least GROQ_API_KEY or GOOGLE_API_KEY

docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

Data persists in `./data/` on your host machine across restarts and rebuilds.

---

### Option B — Local dev (uv)

```bash
git clone https://github.com/debarshi29/mnemos.git
cd mnemos

# Install uv if you don't have it
pip install uv

# Create venv and install
uv venv .venv
uv pip install -e ".[dev]"

# Configure
cp .env.example .env
# Edit .env — add at least one LLM key

# Terminal 1 — backend
uv run uvicorn src.api:app --reload

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

Frontend: http://localhost:5173 · Backend: http://localhost:8000

---

## Configuration

### `.env` — secrets

```bash
# LLM — at least one required
GROQ_API_KEY=gsk_...          # https://console.groq.com  (free)
GOOGLE_API_KEY=AIza...        # https://aistudio.google.com  (free)
# Ollama: no key — set llm.provider: ollama in config.yaml and run `ollama serve`

# Web search — optional, DuckDuckGo used as fallback
TAVILY_API_KEY=tvly-...       # https://tavily.com  (free: 1 000 searches/mo, no card)

# GitHub — optional, raises rate limit 60 → 5 000 req/hr
GITHUB_TOKEN=ghp_...          # https://github.com/settings/tokens  (no scopes needed)
```

### `config.yaml` — tunables

```yaml
llm:
  provider: groq              # groq | gemini | ollama
  groq_model: llama-3.1-8b-instant
  gemini_model: gemini-1.5-flash

memory:
  ema_new_weight: 0.7         # weight given to new evidence on re-observation
  decay_half_life_days: 30    # retrieval score halves every N days
  similarity_threshold: 0.85  # cosine threshold for contradiction pre-filter
  confidence_floor: 0.15      # facts below this are pruned on consolidation
```

---

## MCP server

mnemos exposes its entire memory layer as a [FastMCP](https://github.com/jlowin/fastmcp) server. Connect Claude Desktop, Cursor, or any MCP-compatible client and get persistent, consolidation-backed memory across all your conversations.

### Tools

| Tool | Description |
|---|---|
| `remember(text, session_id)` | Store a conversation turn in episodic memory |
| `recall(query, top_k)` | Decay-ranked semantic retrieval from long-term memory |
| `get_provenance(fact_id)` | Trace a fact back to its exact source episodes |
| `consolidate()` | Run the sleep cycle — extract, dedupe, resolve, prune |
| `list_facts(include_flagged)` | Browse everything the system believes, sorted by confidence |
| `plan_learning_roadmap(topic, background)` | Generate a phased roadmap saved as GoalFacts |
| `ingest_file(path)` | Read a local file (.md, .py, .pdf, …) into episodic memory |
| `ingest_github(repo_url)` | Fetch a GitHub repo's README + metadata into episodic memory |

### Resources

| URI | Description |
|---|---|
| `memory://facts` | Live markdown table of all active facts |
| `memory://consolidation-log` | Recent consolidation run history |

### Running the server

```bash
# stdio — Claude Desktop / Cursor
uv run python -m src.mcp_server

# HTTP/SSE — web clients
uv run python -m src.mcp_server --http --port 8001
```

### Claude Desktop config

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "mnemos": {
      "command": "C:/path/to/mnemos/.venv/Scripts/python",
      "args": ["-m", "src.mcp_server"],
      "cwd": "C:/path/to/mnemos"
    }
  }
}
```

---

## Memory mechanics

### Confidence — EMA on re-observation

When a fact is observed again in a new episode:

```
new_confidence = 0.7 × new_evidence + 0.3 × prior_confidence
```

`ema_new_weight` is configurable. First observation starts at `0.6`.

### Retrieval — continuous time decay

```
retrieval_score = cosine_similarity × exp(−ln(2) / half_life_days × age_days)
```

A fact seen 30 days ago ranks half as high as an equally similar fact seen today. Half-life is configurable.

### Contradiction resolution

1. **Pre-filter** — embedding cosine similarity above threshold flags candidate pairs
2. **LLM judge** — confirms or dismisses the semantic contradiction
3. **Resolution** — higher confidence wins; loser marked `superseded_by=winner_id`
4. **True tie** — both facts flagged for user review; neither is deleted

Superseded facts are never deleted — they remain queryable with `include_superseded=True`.

---

## Ingesting external sources

### From the Memory panel UI

The ingest bar sits below the filter chips in the Memory tab:

- Select **file** → paste `/path/to/notes.md` or `/path/to/paper.pdf` → **↑ ingest**
- Select **github** → paste `https://github.com/owner/repo` → **↑ ingest**

Then hit **↻ consolidate** to extract facts from the ingested content.

### Via REST API

```bash
# Ingest a local file
curl -X POST http://localhost:8000/memory/ingest \
  -H "Content-Type: application/json" \
  -d '{"source": "/path/to/notes.md", "kind": "file"}'

# Ingest a GitHub repo
curl -X POST http://localhost:8000/memory/ingest \
  -H "Content-Type: application/json" \
  -d '{"source": "https://github.com/karpathy/nanoGPT", "kind": "github"}'
```

### Via MCP

```
ingest_file("/path/to/paper.pdf")
ingest_github("https://github.com/anthropics/anthropic-cookbook")
consolidate()
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Send a message; stores episode, returns reply |
| `GET` | `/memory/facts` | List all active consolidated facts |
| `GET` | `/memory/fact/{id}` | Fact detail with full provenance |
| `POST` | `/memory/consolidate` | Trigger the sleep cycle |
| `POST` | `/memory/ingest` | Ingest a file or GitHub repo as an episode |
| `GET` | `/memory/log` | Consolidation run history |
| `GET` | `/episodes` | Raw episodic memory list |
| `GET` | `/goals` | GoalFact roadmap items |
| `PATCH` | `/goals/{id}/status` | Update status: `not_started` → `in_progress` → `done` |
| `POST` | `/plan` | Generate a phased learning roadmap |
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |

Full interactive docs at http://localhost:8000/docs.

---

## Stack

| Concern | Choice | Notes |
|---|---|---|
| LLM | Groq (llama-3.1) · Gemini 1.5 · Ollama | Switch via `config.yaml`, no code change |
| Embeddings | `all-MiniLM-L6-v2` (sentence-transformers) | CPU-only, baked into Docker image |
| Vector store | Qdrant (embedded) | No separate service needed |
| Relational store | SQLite WAL | Facts, episodes, provenance, goals |
| Memory orchestration | LangGraph | Consolidation subgraph + roadmap planner |
| MCP server | FastMCP | stdio + HTTP/SSE transports |
| Web search | Tavily (optional) · DuckDuckGo · ArXiv · GitHub | All free-tier or keyless |
| Backend | FastAPI + uvicorn | |
| Frontend | React + Vite | Inline styles, no CSS framework |
| Containerisation | Docker + Compose | Multi-stage frontend build; bind-mounted data |

---

## Project structure

```
mnemos/
├── src/
│   ├── api.py                 # FastAPI backend + all endpoints
│   ├── schema.py              # Pydantic v2 models (Episode, Fact, GoalFact, …)
│   ├── config.py              # config.yaml loader with dot-path accessor
│   ├── llm_client.py          # Provider-switching LLM client
│   ├── mcp_server.py          # FastMCP server (8 tools, 2 resources)
│   ├── memory/
│   │   ├── consolidation.py   # LangGraph sleep cycle (extract→dedupe→contradict→prune)
│   │   ├── contradiction.py   # Detection + resolution logic
│   │   └── retrieval.py       # Decay-ranked vector retrieval
│   ├── planner/
│   │   ├── roadmap_planner.py # Two-node LangGraph planner (researcher → synthesizer)
│   │   └── tools.py           # web_search, arxiv_search, github_search, fetch_page
│   └── store/
│       ├── sqlite_store.py    # Full CRUD for all tables
│       ├── vector_store.py    # Qdrant wrapper (qdrant-client 1.18+ API)
│       └── embeddings.py      # SentenceTransformer helpers + cosine similarity
├── frontend/
│   └── src/panels/
│       ├── Chat.jsx           # Chat with memory context
│       ├── MemoryInspector.jsx # Facts list + provenance detail + ingest bar
│       ├── Goals.jsx          # Phased roadmap with status tracking
│       └── ConsolidationLog.jsx
├── ADRs/                      # Architecture decision records (001–006)
├── evals/                     # Evaluation harness + synthetic scripts
├── config.yaml
├── docker-compose.yml
├── Dockerfile                 # Backend image
└── frontend/Dockerfile        # Frontend (node build → nginx)
```

---

## Eval results

The eval harness (`evals/run_evals.py`) runs 20 synthetic multi-session scripts against the live consolidation pipeline and checks recall, contradiction handling, provenance accuracy, and absence of superseded facts.

**Latest score: 20 / 20 scripts passing**

| Dimension | What is checked |
|---|---|
| Recall | Planted facts appear in active memory (cosine sim > 0.72) |
| Absent | Superseded facts do NOT appear in active memory (sim > 0.80) |
| Contradiction | Winner/loser correctly resolved; expected winner is active |
| Provenance | Fact links back to the correct source episode |
| Integrity | At least one fact created or updated (no silent total loss) |

Scenarios covered: basic recall, contradiction resolution, preference updates, multi-session recall, multi-fact episodes, multi-source provenance, skill accumulation, superseded-fact retention, mixed fact types, re-observation confidence, multi-contradiction chains, no-false-contradiction guard, negative preferences, progress tracking, professional background, incremental refinement, dense consolidation (9 facts / episode), learning-goal completion, and contradiction chains.

Run the suite yourself:

```bash
uv run python evals/run_evals.py
# optional: --filter <name>  --verbose
```

---

## Architecture decisions

Key decisions are recorded in `ADRs/`:

| ADR | Decision |
|---|---|
| 001 | EMA weights `0.7 / 0.3` for confidence — favours recency without over-reacting |
| 002 | 30-day half-life for retrieval decay |
| 003 | Keep-both-flagged on contradiction tie — no silent data loss |
| 004 | Groq as default LLM provider — best latency on free tier |
| 005 | LangGraph over deepagents — provider coupling made deepagents unworkable |
| 006 | FastMCP memory-as-MCP-server — composability over tight integration |

---

## Generalises to

The memory layer is domain-agnostic. Swap the chat system prompt and it becomes:

- **Research memory** — track papers, hypotheses, and findings across sessions
- **Personal CRM** — remember people, relationships, context from past conversations
- **Decision log** — store architectural or product decisions with full reasoning trails
- **Health journal** — symptoms, observations, and correlations over time
- **Stakeholder memory** — what each person cares about, past commitments, open questions

---

## License

MIT — see [LICENSE](LICENSE).
