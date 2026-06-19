# mnemos

**Agentic memory system with consolidation, contradiction resolution, and provenance.**

A learning copilot as the reference implementation — but the memory layer is the thesis.

```
User ──> Chat (FastAPI) ──> stores Episode
               │
               ├──> Roadmap Planner (deepagents + MCP) ──> GoalFacts
               │
               └──> [sleep cycle] Consolidation Graph
                         ├─ extract facts from episodes
                         ├─ dedupe (EMA confidence update)
                         ├─ contradiction check + resolve
                         └─ prune stale
                               │
                               ▼
                    Three-tier memory store
                    episodic / semantic / goal
                               │
                               ▼
               React FE: chat · memory inspector · consolidation log
```

## Why this exists

Hosted assistants hide memory plumbing. This project makes it visible and inspectable:
- **Click a fact → see its provenance chain** back to exact source episodes
- **Contradictions are decisions**, not averages — the losing fact is retained with history
- **Confidence decays over time** — stale facts rank lower at retrieval

## Quickstart

```bash
# 1. Clone
git clone https://github.com/debarshi29/mnemos.git
cd mnemos

# 2. Create venv and install
uv venv .venv
uv pip install -e ".[dev]"

# 3. Configure
cp .env.example .env
# Edit .env and set at least one of: GROQ_API_KEY, GOOGLE_API_KEY
# Or set llm.provider: ollama in config.yaml and run ollama serve

# 4. Run backend
.venv/Scripts/uvicorn src.api:app --reload

# 5. Run frontend (in a second terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

## Stack

| Concern | Choice |
|---|---|
| LLM | Groq (default) / Gemini / Ollama — switch via `config.yaml` |
| Embeddings | `sentence-transformers` all-MiniLM-L6-v2, CPU |
| Vector store | Qdrant embedded/local |
| Relational | SQLite |
| Orchestration | LangGraph |
| Backend | FastAPI |
| Frontend | React + Vite |

**Zero cost to run.** All providers have free tiers; embeddings are local.

## Memory mechanics

### Confidence — EMA on re-observation
```
new_confidence = 0.7 * new_evidence + 0.3 * prior_confidence
```

### Retrieval — continuous time decay
```
score = similarity * exp(-ln(2)/30 * age_days)
```
Score halves every 30 days (configurable).

### Contradiction resolution
1. Embedding similarity flags candidates
2. LLM judge confirms semantic contradiction
3. Higher confidence wins → lower marked superseded (never deleted)
4. True tie → both flagged for user review

See `ADRs/` for rationale behind each decision.

## Running evals

```bash
.venv/Scripts/python evals/run_evals.py
```

Measures recall, contradiction accuracy, and provenance accuracy against synthetic scripts in `evals/scripts/`.

## Generalizes to

The memory layer reskins by config + system prompt:
reading/research memory · personal CRM · stakeholder memory · decision/ADR memory · health journal

See `ROADMAP.md` for future work.

## Security note
MCP server versions are pinned. See `ROADMAP.md` — update to latest MCP SDK when the April 2026 RCE advisory is resolved upstream.
