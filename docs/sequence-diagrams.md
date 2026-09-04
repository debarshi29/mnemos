# Mnemos — Sequence Diagrams

Runtime interactions for the four core flows. Mermaid source is renderable on GitHub.
Behavioural detail: [`LLD.md`](LLD.md) §8–§13.

---

## 1. Chat turn (`POST /chat` / `POST /chat/stream`)

```mermaid
sequenceDiagram
    actor U as User / UI
    participant API as api.py
    participant R as retrieval.py
    participant EMB as embeddings
    participant VS as Qdrant
    participant DB as sqlite_store
    participant LLM as llm_client

    U->>API: POST /chat {message, session_id?}
    API->>R: retrieve_for_context(message, top_k=5)
    R->>EMB: embed(message)
    R->>VS: search_similar(vec, top_k=15)
    VS-->>R: candidates
    loop each candidate
        R->>DB: get_fact(fact_id)
        R->>R: score = sim · exp(-λ·age_days)
    end
    R-->>API: top-5 Facts
    API->>DB: get_episodes(user_id, 10)  %% same-session history
    API->>LLM: chat(history + memory_context + system)
    LLM-->>API: reply  (streamed for /chat/stream)
    API->>DB: save_episode("User: …\nAssistant: …")
    API->>API: _maybe_auto_consolidate()
    API-->>U: {reply, session_id, episode_id, memory_used}
```

`_maybe_auto_consolidate` spawns a daemon thread only if
`consolidation.trigger != "manual"` and `new_episodes ≥ min_episodes_to_trigger`.

---

## 2. Consolidation — the sleep cycle (`POST /memory/consolidate`)

```mermaid
sequenceDiagram
    participant API as api.py
    participant G as consolidation graph
    participant LLM as llm_client
    participant EMB as embeddings
    participant C as contradiction.py
    participant DB as sqlite_store
    participant VS as Qdrant

    API->>DB: get_episodes_since(user_id, cutoff)
    API->>G: run_consolidation(user_id, episodes)

    rect rgb(240,240,255)
    note over G: extract
    loop each episode
        G->>LLM: chat(_EXTRACT_SYSTEM, episode.text, temp=0)
        LLM-->>G: [{content, type}]  (skip on bad JSON)
    end
    end

    rect rgb(240,255,240)
    note over G: dedupe
    loop each candidate
        G->>EMB: embed(candidate) + embed(each existing)
        alt best cosine ≥ 0.92
            G->>DB: save_fact(match: EMA confidence, last_seen=now)
            G->>DB: save_fact_provenance(match, episode)
        else
            G->>G: stage new Fact (confidence=1.0)
        end
    end
    end

    rect rgb(255,245,235)
    note over G: contradiction_check
    loop each new fact
        G->>C: find_contradictions(new, existing)
        C->>EMB: cosine pre-filter ≥ 0.60
        C->>LLM: _judge_contradiction(a, b) → CONTRADICT / CONSISTENT
        alt conflict
            G->>C: resolve(new, existing)
            C->>DB: save_fact(winner), save_fact(loser: superseded_by=winner)
            G->>DB: save_fact_provenance(winner, episode)
            G->>VS: upsert_fact(winner) if winner is new
        else no conflict
            G->>DB: save_fact(new) + provenance
            G->>VS: upsert_fact(new)
        end
    end
    end

    rect rgb(255,240,240)
    note over G: prune
    loop each live fact
        alt confidence < 0.1
            G->>DB: save_fact(superseded_by="pruned")
            G->>VS: delete_fact(fact_id)
        end
    end
    end

    G->>DB: save_consolidation_log(entry)
    G-->>API: ConsolidationLogEntry
```

---

## 3. Roadmap planning (`POST /plan`)

```mermaid
sequenceDiagram
    actor U as User / UI
    participant API as api.py
    participant P as roadmap_planner
    participant LLM as LLM (+tools)
    participant T as planner tools
    participant DB as sqlite_store

    U->>API: POST /plan {topic, background}
    API->>DB: save_episode(planning turn)
    API->>P: plan_roadmap(topic, background)

    loop researcher (until no tool calls)
        P->>LLM: messages + bound tools
        LLM-->>P: tool call(s)
        P->>T: web_search / arxiv_search / github_search / fetch_page
        T-->>P: results (string)
    end

    P->>LLM: synthesizer — structured output
    LLM-->>P: raw_plan JSON (4–6 phases)
    P-->>API: [GoalFact(phase_index, phase_content, status="not_started")]
    API->>DB: save_goal_fact(...) + save_goalfact_provenance(..., planning episode)
    API-->>U: [GoalFact, …]
```

Provider must be Groq or Gemini (tool calling); Ollama raises `ValueError`.

---

## 4. MCP client session (Claude Desktop / Cursor)

```mermaid
sequenceDiagram
    actor C as MCP client
    participant M as mcp_server.py
    participant DB as sqlite_store
    participant R as retrieval.py
    participant G as consolidation graph

    C->>M: tool remember(text)
    M->>DB: save_episode(text)
    M-->>C: "saved episode <id>"

    C->>M: tool recall(query, top_k)
    M->>R: retrieve(query, top_k)
    R-->>M: [(Fact, score)]
    M-->>C: formatted fact list

    C->>M: tool consolidate()
    M->>G: run_consolidation(unconsolidated episodes)
    G-->>M: ConsolidationLogEntry
    M-->>C: run summary

    C->>M: resource memory://facts
    M->>DB: get_facts()
    M-->>C: JSON array

    C->>M: tool get_provenance(fact_id)
    M->>DB: junction walk → episodes
    M-->>C: source episodes
```

---

## 5. Contradiction resolution decision tree

```mermaid
flowchart TD
    A[new fact vs existing fact<br/>cosine ≥ 0.60] --> B{LLM judge:<br/>CONTRADICT?}
    B -- CONSISTENT --> Z[no action — both live]
    B -- CONTRADICT --> C{confidence compare}
    C -- new > existing --> D[new wins<br/>existing.superseded_by = new]
    C -- existing > new --> E[existing wins<br/>new.superseded_by = existing]
    C -- equal --> F{last_seen compare}
    F -- new newer --> D
    F -- existing newer --> E
    F -- equal --> G[true tie<br/>flag both, keep both]
```
