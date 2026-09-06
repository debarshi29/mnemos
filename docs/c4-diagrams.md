# Mnemos — C4 Model

Context → Container → Component views. Mermaid `C4` diagrams render on GitHub.
Narrative: [`HLD.md`](HLD.md) §3–§4.

---

## Level 1 — System context

```mermaid
C4Context
    title Mnemos — System Context

    Person(user, "User", "Wants an assistant that remembers across sessions")
    System(mnemos, "Mnemos", "Agentic memory: consolidation, contradiction resolution, provenance")

    System_Ext(mcpClient, "MCP client", "Claude Desktop / Cursor")
    System_Ext(llm, "LLM provider", "Groq / Gemini / Ollama")
    System_Ext(search, "Research tools", "Tavily / DuckDuckGo / arXiv / GitHub")

    Rel(user, mnemos, "Chats, inspects memory + provenance, edits roadmap", "HTTPS / SSE")
    Rel(mcpClient, mnemos, "remember / recall / consolidate / ingest / plan", "MCP (stdio or HTTP)")
    Rel(mnemos, llm, "Chat, extraction, contradiction judging, synthesis", "HTTPS")
    Rel(mnemos, search, "Roadmap research, repo ingest", "HTTPS")
```

---

## Level 2 — Containers

```mermaid
C4Container
    title Mnemos — Containers

    Person(user, "User")
    System_Ext(mcpClient, "MCP client")
    System_Ext(llm, "LLM provider")
    System_Ext(search, "Research tools")

    Container_Boundary(mnemos, "Mnemos") {
        Container(spa, "Inspector UI", "React 19 + Vite", "Chat, memory inspector, roadmap, sleep log")
        Container(api, "Backend API", "FastAPI + uvicorn", "REST + SSE; consolidation + planner orchestration")
        Container(mcp, "MCP server", "FastMCP", "8 tools + 2 resources over stdio / HTTP-SSE")
        ContainerDb(sqlite, "SQLite (WAL)", "./data/mnemos.db", "Episodes, facts, goals, provenance, log")
        ContainerDb(qdrant, "Qdrant (embedded)", "./data/qdrant", "One 384-d vector per live fact")
    }

    Rel(user, spa, "Uses", "HTTPS")
    Rel(spa, api, "REST + SSE (same origin via nginx / Vite proxy)")
    Rel(mcpClient, mcp, "MCP")
    Rel(api, sqlite, "CRUD", "sqlite3")
    Rel(api, qdrant, "upsert / search / delete", "in-process")
    Rel(mcp, sqlite, "CRUD (shared data dir)")
    Rel(mcp, qdrant, "search / upsert")
    Rel(api, llm, "chat / stream", "HTTPS")
    Rel(api, search, "web / arxiv / github / fetch", "HTTPS")
```

---

## Level 3 — Component view: Backend API

```mermaid
C4Component
    title Mnemos Backend — Components

    Container_Boundary(api, "Backend API (src/)") {
        Component(endpoints, "API layer", "api.py", "Endpoints, request models, SSE, auto-consolidation trigger")
        Component(cons, "Consolidation", "memory/consolidation.py", "LangGraph: extract → dedupe → contradiction_check → prune")
        Component(contra, "Contradiction", "memory/contradiction.py", "Embed pre-filter → LLM judge → resolution policy")
        Component(retr, "Retrieval", "memory/retrieval.py", "score = cosine · exp(-λ·age_days)")
        Component(planner, "Roadmap planner", "planner/roadmap_planner.py", "researcher → synthesizer")
        Component(ptools, "Planner tools", "planner/tools.py", "web_search / arxiv_search / github_search / fetch_page")
        Component(llmc, "LLM client", "llm_client.py", "chat / stream over Groq | Gemini | Ollama")
        Component(sstore, "SQLite store", "store/sqlite_store.py", "CRUD, schema on startup")
        Component(vstore, "Vector store", "store/vector_store.py", "Qdrant wrapper")
        Component(emb, "Embeddings", "store/embeddings.py", "all-MiniLM-L6-v2 + cosine")
        Component(cfg, "Config", "config.py", "config.yaml loader")
        Component(schema, "Schema", "schema.py", "Pydantic v2 models")
    }

    Rel(endpoints, retr, "retrieve_for_context")
    Rel(endpoints, cons, "run_consolidation")
    Rel(endpoints, planner, "plan_roadmap")
    Rel(endpoints, llmc, "chat / stream")
    Rel(endpoints, sstore, "episodes, facts, goals, log")
    Rel(cons, contra, "find_contradictions / resolve")
    Rel(cons, llmc, "extraction")
    Rel(cons, emb, "embed candidates")
    Rel(cons, sstore, "save_fact / provenance / log")
    Rel(cons, vstore, "upsert / delete")
    Rel(contra, emb, "cosine pre-filter")
    Rel(contra, llmc, "judge")
    Rel(retr, emb, "embed query")
    Rel(retr, vstore, "search_similar")
    Rel(retr, sstore, "get_fact")
    Rel(planner, ptools, "tool calls")
    Rel(planner, llmc, "research + synthesis")
    Rel(endpoints, cfg, "get()")
    Rel(cons, cfg, "tunables")
```

---

## Deployment

```mermaid
flowchart LR
    subgraph host["Single host — docker compose"]
        fe["frontend :3000<br/>nginx + built SPA"]
        be["backend :8000<br/>uvicorn src.api:app"]
        vol[("./data volume<br/>mnemos.db + qdrant/")]
        fe -- "path rewrite<br/>/chat /memory /episodes<br/>/goals /plan /health" --> be
        be --- vol
    end
    mcp["mcp_server process<br/>stdio or :8001"] --- vol
    be -- HTTPS --> ext["Groq / Gemini / Ollama<br/>Tavily / arXiv / GitHub"]
```
