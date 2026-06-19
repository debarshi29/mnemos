# ROADMAP — future work parking lot

Items below are explicitly out of scope for v0.1 but represent natural next steps.
They are listed here as evidence the architecture generalizes, not as a commitment.

## Memory & intelligence
- **Procedural memory tier** — learned how-to sequences, not just facts
- **Decay policy experiments** — per-fact-type half-lives (e.g. events decay faster than preferences)
- **Confidence calibration** — measure EMA weight empirically against ground truth
- **Associative retrieval** — graph traversal across related facts, not just top-k nearest

## Multi-user & hosting
- **Multi-user support** — partition by `user_id` is already in the schema; add auth
- **Hosted mode** — swap SQLite → PostgreSQL, Qdrant embedded → Qdrant Cloud
- **Session sharing** — export/import memory snapshots

## Planner
- **Deeper deepagents integration** — nested sub-agents for domain-specific research
- **Goal progress auto-detection** — infer phase completion from conversation
- **Adaptive roadmap** — replan when new background facts emerge

## Frontend
- **Timeline view** — visualize memory evolution across sessions
- **Manual fact editor** — let user correct or delete facts directly
- **Export** — download memory as JSON/Markdown

## Domain re-skins (reference implementations)
- **Research memory** — track papers read, claims, open questions
- **Personal CRM** — people, relationships, last contact
- **Decision/ADR memory** — institutional knowledge for teams
- **Health journal** — symptoms, medications, patterns over time

## Infra
- **Update MCP SDK** — April 2026 RCE advisory; pin versions until patched upstream
- **Background consolidation** — async worker, not on-request
- **LangSmith tracing** — plug in for consolidation graph observability
