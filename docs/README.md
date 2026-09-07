# Mnemos — Documentation Index

Design and reference documentation for the mnemos agentic memory system. Start with the
HLD, drop into the LLD or a reference doc as needed.

---

## Design

| Document | What's in it |
|----------|--------------|
| [`HLD.md`](HLD.md) | **High-Level Design** — purpose, goals/non-goals, system context, component overview, data architecture, key runtime flows, technology choices, deployment topology, cross-cutting concerns, risks. |
| [`LLD.md`](LLD.md) | **Low-Level Design** — module-by-module internals: signatures, algorithms (decay, EMA, contradiction policy), the consolidation state machine, error-handling matrix, full config reference. |

## Reference

| Document | What's in it |
|----------|--------------|
| [`data-model.md`](data-model.md) | Field-by-field SQLite schema + Pydantic models, entity relationships, fact lifecycle, invariants, Qdrant payload. |
| [`api-reference.md`](api-reference.md) | Every REST endpoint (request/response/side-effects) and the full MCP tool + resource surface. |
| [`sequence-diagrams.md`](sequence-diagrams.md) | Mermaid sequence diagrams: chat turn, consolidation sleep cycle, roadmap planning, MCP session, contradiction decision tree. |
| [`c4-diagrams.md`](c4-diagrams.md) | C4 context / container / component views + deployment diagram. |
| [`nfr-slo.md`](nfr-slo.md) | Performance budgets, availability/degradation, durability & consistency, correctness objectives, security posture, observability. |

## Decision records

| Document | Decision |
|----------|----------|
| [`../ADRs/001-ema-confidence.md`](../ADRs/001-ema-confidence.md) | EMA for confidence updates (`w = 0.7`). |
| [`../ADRs/002-decay-half-life.md`](../ADRs/002-decay-half-life.md) | Exponential retrieval decay, 30-day half-life. |
| [`../ADRs/003-contradiction-keep-both.md`](../ADRs/003-contradiction-keep-both.md) | On a true tie, keep both facts and flag them. |
| [`../ADRs/004-provider-switch.md`](../ADRs/004-provider-switch.md) | Config-switched LLM provider (Groq / Gemini / Ollama). |
| [`../ADRs/005-planner-langgraph-escape-hatch.md`](../ADRs/005-planner-langgraph-escape-hatch.md) | LangGraph planner behind a stable `plan_roadmap()` contract. |
| [`../ADRs/006-fastmcp-memory-server.md`](../ADRs/006-fastmcp-memory-server.md) | FastMCP for the MCP surface (8 tools, 2 resources). |

## Long-form

| Document | What's in it |
|----------|--------------|
| [`mnemos_documentation.pdf`](mnemos_documentation.pdf) / [`mnemos_documentation.tex`](mnemos_documentation.tex) | Full technical write-up: every data model, algorithm, endpoint, and LangGraph state machine in one PDF. |
| [`medium-deep-dive.md`](medium-deep-dive.md) | Narrative article on the memory design and why it is built this way. |

## Elsewhere in the repo

| Path | What's in it |
|------|--------------|
| [`../README.md`](../README.md) | Project overview, quick start, feature list. |
| [`../ROADMAP.md`](../ROADMAP.md) | Explicitly out-of-scope future work. |
| [`../mnemos_build_spec.md`](../mnemos_build_spec.md) | Original build specification. |
| [`../config.yaml`](../config.yaml) | All runtime tunables, with `[OWNER CALL]` markers. |
| [`../CLAUDE.md`](../CLAUDE.md) | Guidance for AI coding assistants working in this repo. |

---

## Reading paths

- **New to the project:** `../README.md` → `HLD.md` → `sequence-diagrams.md`.
- **Implementing a change:** `LLD.md` (relevant module) → `data-model.md` → `nfr-slo.md` §4 (run the evals).
- **Integrating over MCP:** `api-reference.md` (MCP surface) → `sequence-diagrams.md` §4.
- **Reviewing a design decision:** `HLD.md` §7 → the linked ADR.
