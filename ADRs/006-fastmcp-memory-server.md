# ADR 006: mnemos as a FastMCP server (memory-as-MCP)

**Status:** Accepted  
**Date:** 2026-06-19

## Context

MCP (Model Context Protocol) is the emerging standard for plugging tools and memory into AI assistants. The spec originally considered consuming MCP servers (DuckDuckGo, Fetch, ArXiv) as planner inputs.

The more architecturally significant opportunity is the inverse: **expose mnemos' own memory layer as an MCP server**, so any MCP-compatible client can use it as persistent, consolidated, provenance-tracked memory.

## Decision

Build a FastMCP server (`src/mcp_server.py`) that exposes six MCP tools and two resources:

**Tools:**
- `remember(text, session_id)` — store an episode
- `recall(query, top_k)` — decay-ranked semantic retrieval
- `get_provenance(fact_id)` — trace a fact back to source episodes
- `consolidate()` — run the sleep cycle on demand
- `list_facts()` — browse the entire semantic memory
- `plan_learning_roadmap(topic, background)` — trigger the roadmap planner

**Resources (readable context):**
- `memory://facts` — live markdown table of all active facts
- `memory://consolidation-log` — recent consolidation run history

Supports two transports: **stdio** (Claude Desktop / Cursor) and **HTTP/SSE** (web clients).

## Rationale

- **Composability.** Any AI assistant that speaks MCP — Claude Desktop, Cursor, custom agents — instantly gains mnemos' three-tier memory without any integration work beyond adding a config entry.
- **The spec's "generalizes to" pitch becomes real.** Instead of just claiming the memory layer is reskinnable, it is now a standalone service any agent can consume.
- **Provenance via MCP.** `get_provenance` is the demo's centrepiece — a user (or AI) can call it to see exactly which past conversations support a belief. This is as compelling from an MCP client as from the React inspector.
- **FastMCP** was chosen over raw `mcp` SDK because it eliminates boilerplate (schema generation, transport setup) while staying fully spec-compliant. One decorator per tool.

## Consequences

- The MCP server and the FastAPI backend are independent processes serving different clients. They share the same SQLite database (WAL mode handles concurrent reads safely).
- `consolidate()` is exposed as a tool so AI assistants can self-trigger memory consolidation — a genuine agentic memory pattern.
- stdio transport is the default (zero network config); HTTP/SSE is opt-in via `--http` flag.
