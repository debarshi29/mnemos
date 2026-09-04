# Mnemos — Data Model

Authoritative field-by-field reference for the SQLite schema and the Pydantic models it
mirrors. See [`LLD.md`](LLD.md) §2 and §6 for behavioural context.

---

## 1. Entity–relationship overview

```
             ┌──────────────┐
             │  episodes    │────────────┐
             │ episode_id PK│            │ (many)
             └──────────────┘            │
                    ▲  ▲                 │
        (many-to-many)  (many-to-many)   │
   ┌────────────────┐    ┌───────────────────────┐
   │ fact_provenance│    │ goalfact_provenance   │
   │ fact_id     FK │    │ goal_id            FK │
   │ episode_id  FK │    │ episode_id         FK │
   └───────┬────────┘    └───────────┬───────────┘
           │                         │
     ┌─────▼──────┐            ┌──────▼───────┐
     │   facts    │            │  goal_facts  │
     │ fact_id PK │            │ goal_id   PK │
     │ superseded │──┐ self-ref│ topic        │
     │   _by      │◀─┘         │ phase_index  │
     └────────────┘            └──────────────┘

     ┌────────────────────┐
     │ consolidation_log  │   (standalone; details = JSON array)
     │ run_id          PK │
     └────────────────────┘
```

---

## 2. `episodes`

Raw, immutable record of everything the system was told. Source of truth for provenance.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `episode_id` | TEXT | no | `uuid4` | PK |
| `user_id` | TEXT | no | — | partition key; `local_user` in v0.1 |
| `session_id` | TEXT | no | — | groups a conversation |
| `text` | TEXT | no | — | chat turn stored as `"User: …\nAssistant: …"`; ingest chunk stored raw |
| `timestamp` | TEXT | no | `utcnow` | ISO-8601 UTC |

Index: `idx_episodes_user (user_id)`.
Writes: `save_episode` (`INSERT OR REPLACE`). Never updated in normal flow, never deleted.

---

## 3. `facts`

Consolidated semantic memory. One row per distinct belief about the user.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `fact_id` | TEXT | no | `uuid4` | PK |
| `content` | TEXT | no | — | complete sentence, starts with `"User"` |
| `type` | TEXT | no | `'other'` | `preference` \| `status` \| `event` \| `skill` \| `goal` \| `other` |
| `confidence` | REAL | no | `1.0` | `[0.0, 1.0]`; EMA-updated on re-observation |
| `last_seen` | TEXT | no | — | ISO-8601 UTC; drives retrieval decay; refreshed on dedupe hit |
| `metadata` | TEXT | no | `'{}'` | JSON; domain-specific attributes live here |
| `superseded_by` | TEXT | yes | `NULL` | `NULL` = live; a `fact_id` = lost a contradiction; `"pruned"` = below floor |
| `flagged` | INTEGER | no | `0` | `1` when a contradiction tied (both kept) |

Index: `idx_facts_user_conf (confidence)`.
Writes: `save_fact` (`INSERT OR REPLACE`) — the **only** writer.

**Lifecycle**

```
create (confidence=1.0, superseded_by=NULL)
  │
  ├─ re-observed (cosine ≥ 0.92) ─▶ confidence = round(0.7·1.0 + 0.3·prior, 4); last_seen = now
  │
  ├─ loses contradiction ─────────▶ superseded_by = winner_fact_id      (archived)
  ├─ ties contradiction ──────────▶ flagged = 1                          (still live)
  │
  └─ confidence < 0.1 at prune ───▶ superseded_by = "pruned"            (archived, vector deleted)
```

Archived rows are retained forever for provenance; excluded from `get_facts()` and
retrieval unless `include_superseded=True`.

---

## 4. `goal_facts`

Phased learning roadmap produced by the planner.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `goal_id` | TEXT | no | `uuid4` | PK |
| `user_id` | TEXT | no | — | partition key |
| `topic` | TEXT | no | — | the thing being learned; groups phases in the UI |
| `phase_index` | INTEGER | no | — | 0-based order within a topic |
| `phase_content` | TEXT | no | — | what this phase covers |
| `status` | TEXT | no | `'not_started'` | `not_started` \| `in_progress` \| `done` |
| `metadata` | TEXT | no | `'{}'` | JSON; sources, resources, notes |

Index: `idx_goal_user (user_id)`.
Writes: `save_goal_fact`; `update_goal_status` (status only).
Re-planning a topic replaces its rows.

---

## 5. `fact_provenance` / `goalfact_provenance`

Many-to-many junctions. A derived row has one provenance row per contributing episode.

| Column | Type | Notes |
|--------|------|-------|
| `fact_id` / `goal_id` | TEXT | FK → `facts` / `goal_facts` |
| `episode_id` | TEXT | FK → `episodes` |
| PK | — | composite `(fact_id, episode_id)` / `(goal_id, episode_id)` |

Writes: `save_fact_provenance` / `save_goalfact_provenance` — `INSERT OR IGNORE`, so
re-linking is a safe no-op. On a contradiction, this run's episodes are linked to the
**winner**, never the loser.

---

## 6. `consolidation_log`

One row per sleep-cycle run.

| Column | Type | Notes |
|--------|------|-------|
| `run_id` | TEXT | PK, `uuid4` |
| `timestamp` | TEXT | ISO-8601 UTC |
| `user_id` | TEXT | — |
| `episodes_processed` | INTEGER | input episode count |
| `facts_created` | INTEGER | new facts this run |
| `facts_updated` | INTEGER | EMA-merged dedupe hits |
| `contradictions_resolved` | INTEGER | `resolve()` calls |
| `facts_pruned` | INTEGER | dropped below floor |
| `details` | TEXT | JSON array; entries: `contradiction_resolved` `{winner_id, loser_id, winner_content, loser_content}`, `pruned` `{fact_id, content, confidence}` |

Writes: `save_consolidation_log`. Read by `GET /memory/log` and `memory://consolidation-log`.

---

## 7. Vector store payload (Qdrant `mnemos_facts`)

Not SQL — one point per **live** fact.

| Field | Notes |
|-------|-------|
| id | `fact_id` |
| vector | 384-d, `all-MiniLM-L6-v2`, cosine distance |
| payload.`content` | fact text (denormalised) |
| payload.`type` | fact type (denormalised) |

Written by `_contradiction_check` (new facts) and `_dedupe`-adjacent paths; deleted by
`_prune`. Rebuildable from `facts` — SQLite is authoritative.

---

## 8. Type + enum reference

| Enum | Values | Storage |
|------|--------|---------|
| `FactType` | `preference`, `status`, `event`, `skill`, `goal`, `other` | `facts.type` TEXT |
| `GoalStatus` | `not_started`, `in_progress`, `done` | `goal_facts.status` TEXT |
| `superseded_by` sentinel | real `fact_id` \| `"pruned"` \| `NULL` | `facts.superseded_by` TEXT |

---

## 9. Invariants (enforced by code, not constraints)

1. `facts.superseded_by IS NULL` ⇔ fact is live ⇔ has a Qdrant vector.
2. Every `fact_provenance.episode_id` exists in `episodes` (FK on, but also guaranteed by
   write order: episode saved before consolidation reads it).
3. `0.0 ≤ facts.confidence ≤ 1.0` — Pydantic clamps at construction; `save_fact` persists
   whatever the model holds.
4. `goal_facts` for one `(user_id, topic)` have contiguous `phase_index` `0..n-1`.
5. `consolidation_log` counters are non-negative and internally consistent with
   `len(details filtered by type)`.
