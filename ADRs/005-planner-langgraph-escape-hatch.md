# ADR 005: LangGraph subgraph for roadmap planner (escape hatch)

**Status:** Accepted  
**Date:** 2026-06-19

## Context

The spec calls for `deepagents + MCP` to power the roadmap planner. deepagents is a multi-agent framework, and the three MCP servers specified (DuckDuckGo, Fetch, ArXiv) are designed as pluggable tool providers.

However, two constraints emerged:
1. deepagents' native MCP integration is tightly coupled to Claude's tool-use API format; our LLM layer targets Groq/Gemini/Ollama for zero-cost operation.
2. Running a separate MCP server process per tool adds infra complexity with no benefit at this scale.

The spec explicitly provides for this: *"Escape hatch: if deepagents fights the timeline, fall back to a plain LangGraph planning subgraph behind the same signature — lose nothing."*

## Decision

Implement the planner as a **two-node LangGraph subgraph** (researcher → synthesizer) behind the identical interface contract:

```python
plan_roadmap(topic: str, background: str) -> list[GoalFact]
```

The three MCP server capabilities are replicated as LangChain tools:
- `web_search` → `duckduckgo-search` Python library (same data source as DuckDuckGo MCP)
- `fetch_page` → `httpx` + `beautifulsoup4` (identical to Fetch MCP behavior)
- `arxiv_search` → `arxiv` Python library (same data source as ArXiv MCP)

## Rationale

- **Interface contract is preserved.** Any caller of `plan_roadmap()` is unaffected if we swap the internals for deepagents later.
- **Zero extra processes.** No MCP server daemons to manage; tools run in-process.
- **Same data sources.** DuckDuckGo MCP calls the same DDG API; we call it via the Python SDK. Fetch MCP fetches HTML; we do the same. The spec's intent (real web research, real papers) is fully met.
- **Provider-agnostic tool calling.** LangChain's tool binding works with both Groq and Gemini; deepagents' MCP tooling does not.

## Consequences

- If deepagents becomes provider-agnostic in a future release, swapping in is one file change behind the same signature.
- The researcher node has a hard cap of 8 tool-call iterations to prevent runaway loops.
- Tool output is capped at 3000 chars per page fetch to stay within context limits of smaller free-tier models.
