# mnemos — Agentic Memory System

> **Build brief for Claude Code.** This is the authoritative spec. Build against it in the sequence given under "Build Order." Where a decision is marked `[OWNER CALL]`, a default is provided but the human owner may override — confirm before changing.

---

## 0. What this is (and is not)

**This is a defensible systems artifact whose purpose is to demonstrate a real memory architecture** — consolidation, contradiction resolution, and provenance — using a *learning copilot* as the reference implementation. The memory layer is the thesis; the learning domain is just the skin.

It is **NOT**:
- a multi-user product (single-user, local-only)
- a hosted service (runs on the user's machine; GitHub is the distribution)
- a replacement for a general assistant — its value is the *visible, inspectable memory internals* that a hosted assistant hides

**Why build it over just using an existing assistant:** the value is (a) it teaches the memory plumbing that hosted assistants abstract away, and (b) it is a portfolio artifact that proves understanding of that plumbing. Both require the architecture and its evals to be genuinely sound. This document exists so they are.

**Operating mode:** ship a working spine first, then iterate (document, tweak, deepen). "Done by the deadline" = core loop working end-to-end and demo-able, with rough edges — not polished.

---

## 1. Architecture overview

```
User ──> Learning Tracker (chat) ──> stores Episode
                  │
                  ├──> Roadmap Planner (deepagents + MCP) ──> writes GoalFacts
                  │
                  └──> [between sessions] Consolidation Graph ("sleep cycle")
                            ├─ extract facts from episodes
                            ├─ dedupe
                            ├─ contradiction check + resolve
                            └─ prune stale
                                  │
                                  ▼
                       Three-tier memory store
                       (episodic / semantic / goal)
                                  │
                                  ▼
                  Streamlit FE: chat · memory inspector · consolidation log
```

Three memory tiers:
- **Episodic** — raw interactions (`Episode`)
- **Semantic** — consolidated facts/preferences (`Fact`)
- **Goal** — roadmap structure (`GoalFact`), produced by the planner

---

## 2. Memory schema

### 2.1 Episode (episodic tier)

The atomic unit of raw interaction. **Granularity: one turn** = a single user message plus the agent's response (if any).

| field | type | notes |
|---|---|---|
| `episode_id` | TEXT/UUID, PK | **required** — provenance links point here |
| `user_id` | TEXT | stable partition key (single user, but keep the column) |
| `session_id` | TEXT | segments the timeline within a user |
| `text` | TEXT | the turn content; **text-only, no multimodal** (explicit non-goal) |
| `timestamp` | DATETIME | |

Note on scoping language: `user_id` is the stable partition key; `session_id` segments the timeline within it. Memory **accumulates and evolves** across sessions — it is not "fixed."

### 2.2 Fact (semantic tier)

**Domain-agnostic by design.** Domain-specific data (subject, learning track, etc.) lives in `metadata`, NOT as columns — this is what keeps the memory layer reusable for other domains (fork-and-reskin via config).

| field | type | notes |
|---|---|---|
| `fact_id` | TEXT/UUID, PK | |
| `content` | TEXT | the consolidated statement |
| `type` | TEXT | e.g. preference / status / event — enum, owner-extensible |
| `confidence` | REAL | 0.0–1.0, updated via EMA (see §3.1) |
| `last_seen` | DATETIME | recency for decay (see §3.2) |
| `metadata` | JSON | domain fields go here: `{"subject": "...", "track": "..."}` |

`[OWNER CALL]` Fields and `type` enum confirmed as above unless overridden.

### 2.3 GoalFact (goal tier)

Roadmap output from the planner. Stands alone (does not extend `Fact`) but shares provenance mechanics.

| field | type | notes |
|---|---|---|
| `goal_id` | TEXT/UUID, PK | |
| `user_id` | TEXT | |
| `topic` | TEXT | what's being learned |
| `phase_index` | INT | ordering within the roadmap |
| `phase_content` | TEXT | the milestone/step |
| `status` | TEXT | not_started / in_progress / done |
| `metadata` | JSON | resources, prerequisites, etc. |

### 2.4 Provenance (junction — many-to-many)

One fact may be supported by several episodes; one episode may spawn several facts. Provenance strength = number of supporting episodes.

```
fact_provenance(fact_id FK, episode_id FK)
goalfact_provenance(goal_id FK, episode_id FK)
```

This table powers the "why do you believe this?" feature — the demo's centerpiece.

---

## 3. The three mechanisms

> The owner's original note ("70% new / 30% old") was correctly split into three distinct mechanisms. Do not collapse them back into one number.

### 3.1 Confidence update (on re-observation) — EMA
When an existing fact is re-observed/re-confirmed:
```
new_confidence = 0.7 * new_evidence + 0.3 * prior_confidence
```
`[OWNER CALL]` 0.7/0.3 default. This is an exponential moving average — record it as such in the ADR log.

### 3.2 Retrieval ranking — continuous time-decay
Do **not** use a flat new/old split for retrieval. Rank candidate facts by:
```
score = similarity * exp(-lambda * age)
```
where `age` is time since `last_seen`. `[OWNER CALL]` pick a half-life — **default: 30 days** (set `lambda = ln(2) / half_life`). A week is more aggressive; a month is gentle.

### 3.3 Contradiction resolution
Contradiction is a **decision**, not an average — never blend conflicting facts.

Detection: embedding similarity flags candidates, then an LLM judge confirms semantic contradiction.

Resolution policy:
- higher confidence wins; if confidence ties, more recent wins;
- **equal confidence AND equal recency → keep both, flag for user** `[OWNER CALL — default]`
- losing fact is never hard-deleted within a consolidation run — mark superseded, retain provenance, so the inspector can show the history.

---

## 4. Consolidation graph ("sleep cycle")

A LangGraph subgraph, triggered at end of session OR after N episodes OR manually.

Nodes:
1. **extract** — pull candidate facts from new episodes (LLM)
2. **dedupe** — merge near-duplicates against existing facts
3. **contradiction-check** — run §3.3 detection + resolution
4. **prune** — drop facts below a staleness/confidence floor (mark, don't hard-delete)

Writes: new/updated `Fact` rows, provenance links, a **consolidation log entry** (facts created, contradictions resolved, episodes compressed) for the FE.

`[OWNER CALL]` trigger default: manual button + end-of-session.

---

## 5. Roadmap planner (deepagents + MCP)

Solves cold-start: turns "I want to learn X, I know Y" into a phased roadmap written as `GoalFact`s.

**Hard interface contract (define before wiring deepagents):**
```
plan_roadmap(topic: str, background: str) -> list[GoalFact]
```
Anything satisfying this contract is swappable. **Escape hatch:** if deepagents fights the timeline, fall back to a plain LangGraph planning subgraph behind the same signature — lose nothing.

MCP servers (all free, no paid keys):
- **DuckDuckGo MCP** — web search, no API key (do NOT use Brave; its free tier is discontinued)
- **Fetch MCP** — pull full page content (search snippets alone are too shallow)
- **ArXiv MCP** — academic papers as roadmap milestones

Keep it shallow: planner + at most one researcher sub-agent. Do not go deep on deepagents' virtual filesystem or nested sub-agents — using it, not showcasing it.

**Security note for the repo:** pin MCP server versions; add "update to latest MCP SDK" to README (April 2026 RCE advisory across SDK implementations).

---

## 6. Eval harness

Since the owner is shipping AI-built code and studying after, **evals are the only ground truth that the system works.** Do not compress this.

Build ~20 synthetic multi-session scripts with planted facts and contradictions. Measure:
- **recall** of planted facts
- **contradiction handling** correctness (right winner, both-flagged when tied)
- **provenance accuracy** (fact traces to the correct source episodes)
- **consolidation integrity** (no information silently lost)

Crude numbers beat no numbers. Output a simple report (table to stdout or markdown).

---

## 7. Stack & config (free, zero-cost for owner and every cloner)

| concern | choice |
|---|---|
| LLM | Groq free tier (default) / Google AI Studio / Ollama — **provider-switchable via a single thin client file** |
| Embeddings | local `sentence-transformers` (`all-MiniLM-L6-v2` or `bge-small`), CPU |
| Vector store | Qdrant embedded/local mode |
| Relational store | SQLite (episodes, facts, goals, provenance) |
| Orchestration | LangGraph + LangMem |
| Planner | deepagents + MCP (§5) |
| FE | React + Vite (design system in §8) |
| FE backend | FastAPI — serves `/chat`, memory/provenance reads, consolidation triggers |

Config-driven, nothing personal hardcoded:
- `config.yaml` — tracks, goals, model/provider, decay half-life, EMA weights, triggers
- `.env.example` — API keys
- LLM client is **one file** with a provider switch (makes "bring your own free provider" real)

---

## 8. Frontend (React + Vite) — budget: 1.5 days, after the memory system works

**Stack:** React + Vite, talking to a local FastAPI backend (NOT Streamlit, NOT a standalone Claude artifact). The frontend never calls an LLM provider directly — all model calls go through the backend `/chat` endpoint, which routes to the configured free provider (Groq/Gemini/Ollama). All persistence is backend/SQLite — **do not use browser storage or any artifact-sandbox `window.storage` API.**

Three panels:
1. **Chat** — talk to the copilot; messages persist via the backend
2. **Memory inspector** *(the killer screen)* — browse facts; click a fact → see its provenance chain back to source episodes (the `fact_provenance` junction); show superseded/contradicted history. This is what turns provenance + contradiction from README claims into something a viewer sees in 10 seconds.
3. **Consolidation log** — what the last sleep cycle did

The 2-min demo = ask question → answer from memory → click fact → trace to a real past session.

### Design system (adopt exactly — this is the owner's portfolio aesthetic)

"Organic Literary": dark forest-green ground, muted lime accent, serif display.

```
Colors:
  bg       #101a13   (page ground)
  panel    #16241a   (cards / chat area)
  panel2   #1c2e21   (raised elements / assistant bubbles)
  ink      #e9efe4   (primary text)
  dim      #9ab09a   (secondary text)
  line     #2b4231   (borders)
  lime     #c5e063   (accent: active states, user bubbles, progress)
  limeDeep #8aa83f   (accent deep: labels, gradients)

Fonts:
  Display / body : Fraunces (serif) — 400 / 600 / 700
  Mono / labels  : IBM Plex Mono — 400 / 500
  (import both from Google Fonts)

Signature touches to carry over:
  - lime "vine" progress bar with limeDeep→lime gradient
  - mono uppercase micro-labels with wide letter-spacing (~0.16em)
  - pill-shaped phase selectors
  - lime ::selection highlight
```

Take only the colors, fonts, and these visual motifs from the owner's `RoadmapCopilot.jsx` sketch. **Discard its architecture entirely** — it was a static roadmap tracker with hardcoded phases, prompt-stuffed "memory," artifact-sandbox storage, and direct browser→Anthropic calls. None of that is reused. The roadmap content in `mnemos` is dynamic `GoalFact` data from the backend, not a hardcoded `PHASES` array.

---

## 9. Build order (spine first — if time runs out, it runs out at the bottom)

1. **Episode storage + retrieval** — SQLite + embeddings; dumb loop: chat → store → retrieve
2. **Consolidation** — episodes → facts with confidence EMA (§3.1)
3. **Contradiction + provenance** — §3.3 + junction tables (the differentiators)
4. **Roadmap planner** — deepagents + MCP (§5)
5. **FastAPI backend + React/Vite FE** — chat + memory inspector + consolidation log (§8)
6. **Eval harness** — §6, as proof

Always keep a shippable thing. Features drop from the bottom, never the spine.

---

## 10. Repo hygiene (cloneable — ~half a day, day of packaging)

- `config.yaml`, `.env.example`
- **Seed/demo mode** — flag that loads a few synthetic episodes so consolidation + provenance work on first run (empty first run = abandoned repo)
- 5-minute quickstart in README: clone → install → configure → first session (copy-paste command block)
- architecture diagram (the §1 flow + memory tiers)
- `ADRs/` — one short entry per big decision (why EMA 0.7, why 30-day half-life, why keep-both-on-tie, why deepagents). **These are how the project gets defended in interviews — write them as decisions are made, not after.**
- `ROADMAP.md` — future work parking lot (multi-user, hosted, procedural memory, decay policies)

Suggested repo layout:
```
mnemos/
  config.yaml
  .env.example
  README.md
  ROADMAP.md
  ADRs/
  src/
    llm_client.py        # provider switch (Groq/Gemini/Ollama)
    schema.py            # Episode, Fact, GoalFact, provenance
    store/               # SQLite + Qdrant adapters
    memory/
      consolidation.py   # the sleep-cycle LangGraph subgraph
      contradiction.py
      retrieval.py       # decay-ranked retrieval
    planner/             # deepagents + MCP roadmap planner
    api.py               # FastAPI backend: /chat, memory reads, consolidation triggers
  frontend/              # React + Vite (design system §8: Fraunces, lime-on-forest)
    src/
      App.jsx
      panels/            # Chat, MemoryInspector, ConsolidationLog
      theme.js           # the color/font tokens from §8
  evals/
    scripts/             # ~20 synthetic multi-session scenarios
    run_evals.py
```

---

## 11. "Generalizes to" (README selling point — proof the architecture is decoupled)

The same memory layer reskins by config + system prompt to: reading/research memory, personal CRM, stakeholder/client memory, decision/ADR memory, health journal. The learning copilot is the reference implementation, not the limit. *(Do not build these now — they are evidence the architecture is right, listed for the README.)*

---

## 12. Open decisions for the owner to confirm (`[OWNER CALL]`)

1. Fact table fields + `type` enum (§2.2) — default accepted unless changed
2. EMA weights 0.7/0.3 (§3.1)
3. Retrieval half-life — default 30 days (§3.2)
4. Tie-break on contradiction — default keep-both-flagged (§3.3)
5. Consolidation trigger — default manual + end-of-session (§4)
6. Project name `mnemos` — swappable

Everything else is locked.
