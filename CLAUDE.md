# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mnemos is an agentic memory system — a FastAPI + React app that gives AI assistants persistent, consolidating memory with provenance tracking. It also exposes a FastMCP server for Claude Desktop / Cursor integration.

## Commands

### Docker (primary workflow)
```bash
cp .env.example .env          # first time only — fill in at least one LLM key
docker compose up --build     # frontend :3000, backend :8000, swagger :8000/docs

# Rebuild a single service after code changes:
docker compose build --no-cache frontend && docker compose up -d frontend
docker compose build --no-cache backend  && docker compose up -d backend
```

### Local dev (requires uv + Node)
```bash
make install     # uv sync + npm install
make dev         # runs backend + frontend in parallel (bash required)
make backend     # uv run uvicorn src.api:app --reload  → :8000
make frontend    # cd frontend && npm run dev            → :5173
```

### Backend tasks
```bash
uv run pytest                                   # run all tests
uv run pytest tests/test_foo.py::test_bar -v    # single test
uv run ruff check src/                          # lint
uv run ruff format src/                         # format (line-length 100)
uv run python evals/run_evals.py [--filter <name>] [--verbose]   # evals
```

### MCP server
```bash
uv run python -m src.mcp_server                        # stdio mode (Claude Desktop)
uv run python -m src.mcp_server --http --port 8001     # HTTP/SSE mode
```

### Frontend
```bash
cd frontend && npm run dev      # dev server :5173
cd frontend && npm run build    # production build
cd frontend && npm run lint     # ESLint
```

## Architecture

### Backend (`src/`)

| Module | Purpose |
|---|---|
| `src/api.py` | All FastAPI endpoints — single file, no routers |
| `src/schema.py` | Pydantic v2 models (Episode, Fact, GoalFact, …) |
| `src/config.py` | `config.yaml` loader |
| `src/llm_client.py` | Multi-provider LLM client — Groq / Gemini / Ollama |
| `src/mcp_server.py` | FastMCP server (8 tools, 2 resources) |
| `src/memory/consolidation.py` | LangGraph "sleep cycle": extract → dedupe → contradict → prune |
| `src/memory/contradiction.py` | Contradiction detection and resolution |
| `src/memory/retrieval.py` | Decay-ranked vector retrieval |
| `src/planner/roadmap_planner.py` | LangGraph two-node roadmap planner |
| `src/planner/tools.py` | web_search, arxiv_search, github_search, fetch_page |
| `src/store/sqlite_store.py` | Full CRUD over SQLite WAL |
| `src/store/vector_store.py` | Qdrant embedded wrapper |
| `src/store/embeddings.py` | SentenceTransformer (all-MiniLM-L6-v2) + cosine similarity |

**Storage:** SQLite WAL + embedded Qdrant, both in `./data/` (Docker bind-mount). No migrations — schema is created on startup.

**LLM providers:** Groq (free tier), Gemini (free tier), Ollama (local). Configured via `config.yaml`.

### Frontend (`frontend/src/`)

React 19 + Vite, JSX only (no TypeScript), no CSS framework.

| File | Purpose |
|---|---|
| `App.jsx` | Top-bar tab shell: Chat / Memory / Roadmap / Sleep |
| `api.js` | All API calls — axios for REST, native `fetch` for SSE streaming |
| `panels/Chat.jsx` | SSE streaming chat with memory context |
| `panels/MemoryInspector.jsx` | Facts list, provenance detail, ingest bar (file / GitHub) |
| `panels/Goals.jsx` | Phased roadmap with segmented status control |
| `panels/ConsolidationLog.jsx` | Consolidation run history |

**Routing:** Vite proxies `/chat`, `/memory`, `/episodes`, `/goals`, `/plan`, `/health` → `localhost:8000` in dev. In Docker, nginx handles the same rewrite on the same origin. `api.js` uses `baseURL: ''` throughout.

**Design system** (`src/index.css`): HSL CSS variables only — no Tailwind. Space Grotesk for UI text, IBM Plex Mono for data/IDs. Accent `--ac: hsl(228,76%,72%)` (periwinkle) for interactive elements; `--am: hsl(40,88%,57%)` (amber) for data values only. Strict type scale: 11/12/14/16/20px. Border radius: 4px (`--r`) or 7px (`--rl`) only.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | At least one | Free tier available |
| `GOOGLE_API_KEY` | At least one | Gemini free tier |
| `TAVILY_API_KEY` | Optional | Web search; DuckDuckGo fallback if absent |
| `GITHUB_TOKEN` | Optional | Raises GitHub API rate limit 60 → 5000 req/hr |

Runtime tunables (model names, EMA weight, decay half-life, similarity threshold, confidence floor) live in `config.yaml`.
