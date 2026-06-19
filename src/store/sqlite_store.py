"""
SQLite adapter — manages Episodes, Facts, GoalFacts, provenance junctions,
and the consolidation log. All writes are synchronous; FastAPI wraps in
run_in_executor if needed.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from src.config import get
from src.schema import (
    ConsolidationLogEntry, Episode, Fact, FactProvenance,
    GoalFact, GoalFactProvenance,
)

_DB_PATH: str = get("database.path", "./data/mnemos.db")


def _ensure_dir(path: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def _conn():
    _ensure_dir(_DB_PATH)
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db():
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS episodes (
                episode_id  TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                session_id  TEXT NOT NULL,
                text        TEXT NOT NULL,
                timestamp   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS facts (
                fact_id         TEXT PRIMARY KEY,
                content         TEXT NOT NULL,
                type            TEXT NOT NULL DEFAULT 'other',
                confidence      REAL NOT NULL DEFAULT 1.0,
                last_seen       TEXT NOT NULL,
                metadata        TEXT NOT NULL DEFAULT '{}',
                superseded_by   TEXT,
                flagged         INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS goal_facts (
                goal_id         TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                topic           TEXT NOT NULL,
                phase_index     INTEGER NOT NULL,
                phase_content   TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'not_started',
                metadata        TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS fact_provenance (
                fact_id     TEXT NOT NULL REFERENCES facts(fact_id),
                episode_id  TEXT NOT NULL REFERENCES episodes(episode_id),
                PRIMARY KEY (fact_id, episode_id)
            );

            CREATE TABLE IF NOT EXISTS goalfact_provenance (
                goal_id     TEXT NOT NULL REFERENCES goal_facts(goal_id),
                episode_id  TEXT NOT NULL REFERENCES episodes(episode_id),
                PRIMARY KEY (goal_id, episode_id)
            );

            CREATE TABLE IF NOT EXISTS consolidation_log (
                run_id                  TEXT PRIMARY KEY,
                timestamp               TEXT NOT NULL,
                user_id                 TEXT NOT NULL,
                episodes_processed      INTEGER NOT NULL DEFAULT 0,
                facts_created           INTEGER NOT NULL DEFAULT 0,
                facts_updated           INTEGER NOT NULL DEFAULT 0,
                contradictions_resolved INTEGER NOT NULL DEFAULT 0,
                facts_pruned            INTEGER NOT NULL DEFAULT 0,
                details                 TEXT NOT NULL DEFAULT '[]'
            );

            CREATE INDEX IF NOT EXISTS idx_episodes_user ON episodes(user_id);
            CREATE INDEX IF NOT EXISTS idx_facts_user_conf ON facts(confidence);
            CREATE INDEX IF NOT EXISTS idx_goal_user ON goal_facts(user_id);
        """)


# ── Episodes ──────────────────────────────────────────────────────────────────

def save_episode(ep: Episode):
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO episodes VALUES (?,?,?,?,?)",
            (ep.episode_id, ep.user_id, ep.session_id, ep.text,
             ep.timestamp.isoformat()),
        )


def get_episodes(user_id: str, limit: int = 200) -> list[Episode]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM episodes WHERE user_id=? ORDER BY timestamp DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [_row_to_episode(r) for r in rows]


def get_episodes_since(user_id: str, since: datetime) -> list[Episode]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM episodes WHERE user_id=? AND timestamp>? ORDER BY timestamp ASC",
            (user_id, since.isoformat()),
        ).fetchall()
    return [_row_to_episode(r) for r in rows]


def _row_to_episode(r) -> Episode:
    return Episode(
        episode_id=r["episode_id"], user_id=r["user_id"],
        session_id=r["session_id"], text=r["text"],
        timestamp=datetime.fromisoformat(r["timestamp"]),
    )


# ── Facts ─────────────────────────────────────────────────────────────────────

def save_fact(fact: Fact):
    with _conn() as con:
        con.execute(
            """INSERT OR REPLACE INTO facts
               (fact_id, content, type, confidence, last_seen, metadata, superseded_by, flagged)
               VALUES (?,?,?,?,?,?,?,?)""",
            (fact.fact_id, fact.content, fact.type, fact.confidence,
             fact.last_seen.isoformat(), json.dumps(fact.metadata),
             fact.superseded_by, int(fact.flagged)),
        )


def get_facts(include_superseded: bool = False) -> list[Fact]:
    with _conn() as con:
        q = "SELECT * FROM facts" if include_superseded else \
            "SELECT * FROM facts WHERE superseded_by IS NULL"
        rows = con.execute(q).fetchall()
    return [_row_to_fact(r) for r in rows]


def get_fact(fact_id: str) -> Fact | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM facts WHERE fact_id=?", (fact_id,)).fetchone()
    return _row_to_fact(row) if row else None


def _row_to_fact(r) -> Fact:
    return Fact(
        fact_id=r["fact_id"], content=r["content"], type=r["type"],
        confidence=r["confidence"],
        last_seen=datetime.fromisoformat(r["last_seen"]),
        metadata=json.loads(r["metadata"]),
        superseded_by=r["superseded_by"],
        flagged=bool(r["flagged"]),
    )


# ── GoalFacts ─────────────────────────────────────────────────────────────────

def save_goal_fact(gf: GoalFact):
    with _conn() as con:
        con.execute(
            """INSERT OR REPLACE INTO goal_facts
               (goal_id, user_id, topic, phase_index, phase_content, status, metadata)
               VALUES (?,?,?,?,?,?,?)""",
            (gf.goal_id, gf.user_id, gf.topic, gf.phase_index,
             gf.phase_content, gf.status, json.dumps(gf.metadata)),
        )


def get_goal_facts(user_id: str) -> list[GoalFact]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM goal_facts WHERE user_id=? ORDER BY topic, phase_index",
            (user_id,),
        ).fetchall()
    return [_row_to_goal_fact(r) for r in rows]


def _row_to_goal_fact(r) -> GoalFact:
    return GoalFact(
        goal_id=r["goal_id"], user_id=r["user_id"], topic=r["topic"],
        phase_index=r["phase_index"], phase_content=r["phase_content"],
        status=r["status"], metadata=json.loads(r["metadata"]),
    )


# ── Provenance ────────────────────────────────────────────────────────────────

def save_fact_provenance(fp: FactProvenance):
    with _conn() as con:
        con.execute(
            "INSERT OR IGNORE INTO fact_provenance VALUES (?,?)",
            (fp.fact_id, fp.episode_id),
        )


def get_fact_provenance(fact_id: str) -> list[str]:
    """Returns episode_ids that support this fact."""
    with _conn() as con:
        rows = con.execute(
            "SELECT episode_id FROM fact_provenance WHERE fact_id=?", (fact_id,)
        ).fetchall()
    return [r["episode_id"] for r in rows]


def save_goalfact_provenance(gp: GoalFactProvenance):
    with _conn() as con:
        con.execute(
            "INSERT OR IGNORE INTO goalfact_provenance VALUES (?,?)",
            (gp.goal_id, gp.episode_id),
        )


# ── Consolidation log ─────────────────────────────────────────────────────────

def save_consolidation_log(entry: ConsolidationLogEntry):
    with _conn() as con:
        con.execute(
            """INSERT OR REPLACE INTO consolidation_log VALUES (?,?,?,?,?,?,?,?,?)""",
            (entry.run_id, entry.timestamp.isoformat(), entry.user_id,
             entry.episodes_processed, entry.facts_created, entry.facts_updated,
             entry.contradictions_resolved, entry.facts_pruned,
             json.dumps(entry.details)),
        )


def get_consolidation_log(user_id: str, limit: int = 20) -> list[ConsolidationLogEntry]:
    with _conn() as con:
        rows = con.execute(
            """SELECT * FROM consolidation_log WHERE user_id=?
               ORDER BY timestamp DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
    return [_row_to_log(r) for r in rows]


def _row_to_log(r) -> ConsolidationLogEntry:
    return ConsolidationLogEntry(
        run_id=r["run_id"],
        timestamp=datetime.fromisoformat(r["timestamp"]),
        user_id=r["user_id"],
        episodes_processed=r["episodes_processed"],
        facts_created=r["facts_created"],
        facts_updated=r["facts_updated"],
        contradictions_resolved=r["contradictions_resolved"],
        facts_pruned=r["facts_pruned"],
        details=json.loads(r["details"]),
    )
