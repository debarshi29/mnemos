# Mnemos — API Reference

REST surface exposed by `src/api.py` and the MCP surface exposed by `src/mcp_server.py`.
Base URL in all environments: same origin (`baseURL: ''`) — nginx (Docker) or the Vite
proxy (dev) forwards the API paths to the backend on `:8000`. Interactive Swagger:
`http://localhost:8000/docs`.

---

## REST API

### `GET /health`

Liveness probe.

```json
200 → {"status": "ok"}
```

---

### `POST /chat`

Non-streaming chat turn.

**Request**

```json
{ "message": "I'm switching from Python to Rust for systems work", "session_id": "optional-uuid" }
```

**Response** `ChatResponse`

```json
{
  "reply": "Got it — …",
  "session_id": "generated-if-omitted",
  "episode_id": "uuid",
  "memory_used": ["fact_id", "fact_id"]
}
```

- `memory_used` = fact IDs retrieved into the memory-context block (decay-ranked top 5).
- Side effects: saves the turn as an `Episode`; may trigger background consolidation.

---

### `POST /chat/stream`

Same request body as `/chat`. Returns `text/event-stream`; each event `data:` line carries
a reply token. The `Episode` is saved after the stream completes. Frontend parses this with
a native `fetch` + `ReadableStream` reader.

---

### `GET /memory/facts`

All **live** facts (`superseded_by IS NULL`).

```json
200 → [ { "fact_id","content","type","confidence","last_seen","metadata","flagged" }, … ]
```

---

### `GET /memory/fact/{fact_id}`

One fact plus its full provenance chain.

```json
200 → {
  "fact": { …Fact… },
  "provenance": [ { "episode_id","session_id","text","timestamp" }, … ],
  "superseded_by": null,
  "flagged": false
}
404 → fact not found
```

---

### `POST /memory/consolidate`

Run the sleep cycle over unconsolidated episodes.

**Request**

```json
{ "since_hours": 24 }      // omit / null = all unconsolidated episodes
```

**Response** `ConsolidationLogEntry`

```json
{
  "run_id":"uuid","timestamp":"…","user_id":"local_user",
  "episodes_processed":7,"facts_created":3,"facts_updated":2,
  "contradictions_resolved":1,"facts_pruned":0,
  "details":[ { "type":"contradiction_resolved","winner_id":"…","loser_id":"…",
               "winner_content":"…","loser_content":"…" } ]
}
```

---

### `GET /memory/log?limit=N`

Recent consolidation runs, newest first. Array of `ConsolidationLogEntry`.

---

### `POST /memory/ingest`

Feed a local file or a GitHub repo into episodic memory.

**Request**

```json
{ "source": "./notes/ddia-ch5.md", "kind": "file",   "session_id": "optional" }
{ "source": "https://github.com/owner/repo", "kind": "github", "session_id": "optional" }
```

- `file` → read + chunk → one `Episode` per chunk.
- `github` → walk the repo (HTTP redirects followed) → one `Episode` per file/chunk.

**Response**

```json
200 → { "episodes_created": 12, "consolidation": { …ConsolidationLogEntry or null… } }
```

---

### `GET /episodes?limit=N`

Recent raw episodes for the timeline view. Array of `Episode`.

---

### `GET /goals`

All `GoalFact`s for the default user, groupable by `topic`, ordered by `phase_index`.

---

### `PATCH /goals/{goal_id}/status`

```json
{ "status": "in_progress" }        // not_started | in_progress | done
200 → { …updated GoalFact… }
```

---

### `POST /plan`

Generate a phased roadmap.

**Request**

```json
{ "topic": "distributed consensus", "background": "comfortable with Go, read parts of DDIA", "session_id": "optional" }
```

**Response**

```json
200 → [ { "goal_id","topic","phase_index":0,"phase_content":"…","status":"not_started","metadata":{…} }, … ]
```

Side effects: persists the `GoalFact`s and `GoalFactProvenance` to the planning episode.

---

## Error model

| Status | When |
|--------|------|
| `404` | `GET /memory/fact/{id}` unknown id |
| `422` | Pydantic request validation failure |
| `500` | LLM provider / tool exception surfaced from the pipeline |

No auth layer in v0.1 — every endpoint is open on the local origin.

---

## MCP surface (`src/mcp_server.py`)

Transport: stdio (`python -m src.mcp_server`) or HTTP/SSE (`--http --port 8001`). Shares
`./data` with the REST API.

### Tools

| Tool | Signature | Maps to |
|------|-----------|---------|
| `remember` | `(text: str, session_id: str = "mcp_session") -> str` | `save_episode` |
| `recall` | `(query: str, top_k: int = 5) -> str` | `retrieval.retrieve`, formatted as text |
| `get_provenance` | `(fact_id: str) -> str` | junction walk → source episodes |
| `consolidate` | `() -> str` | `run_consolidation` over unconsolidated episodes |
| `list_facts` | `(include_flagged: bool = True) -> str` | `get_facts` |
| `plan_learning_roadmap` | `(topic: str, background: str) -> str` | `plan_roadmap` |
| `ingest_file` | `(path: str, session_id: str = "file_ingest") -> str` | same path as `POST /memory/ingest` (file) |
| `ingest_github` | `(repo_url: str, session_id: str = "github_ingest") -> str` | same path as `POST /memory/ingest` (github) |

### Resources

| URI | Payload |
|-----|---------|
| `memory://facts` | JSON array of live facts |
| `memory://consolidation-log` | JSON array of consolidation runs |

### Example: Claude Desktop config

```json
{
  "mcpServers": {
    "mnemos": { "command": "uv", "args": ["run", "python", "-m", "src.mcp_server"], "cwd": "/path/to/mnemos" }
  }
}
```
