"""
SQLite persistence layer for jobs and atomic capability results (WAL mode).

Supports seamless automatic schema migration on existing `data/ascend.db` files.
"""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from config import SQLITE_DB_PATH


@contextmanager
def _connect():
    """Yield a connection with WAL mode, Row factory, transaction safety, and close on exit."""
    conn = sqlite3.connect(SQLITE_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    input_preview   TEXT NOT NULL DEFAULT '',
    student_name    TEXT NOT NULL DEFAULT '',
    target_program  TEXT NOT NULL DEFAULT '',
    score           INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    module_name     TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'completed',
    payload         TEXT    NOT NULL DEFAULT '{}',
    error_message   TEXT,
    completed_at    TEXT    NOT NULL,
    UNIQUE (job_id, module_name)
);

CREATE INDEX IF NOT EXISTS idx_results_job_id ON results(job_id);
"""


def _ensure_column(
    conn: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    cols = {
        row["name"]
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    """Create tables and migrate any missing v3 columns safely."""
    with _connect() as conn:
        conn.executescript(_SCHEMA)
        _ensure_column(conn, "jobs", "input_preview", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "student_name", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "target_program", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "score", "INTEGER")
        _ensure_column(conn, "results", "status", "TEXT NOT NULL DEFAULT 'completed'")
        _ensure_column(conn, "results", "error_message", "TEXT")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Job operations
# ---------------------------------------------------------------------------

def create_job(input_preview: str = "") -> str:
    """Insert a new pending job and return its UUID."""
    job_id = uuid.uuid4().hex
    now = _now()
    preview = str(input_preview or "").strip()[:180]
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs (id, status, input_preview, created_at, updated_at)
            VALUES (?, 'pending', ?, ?, ?)
            """,
            (job_id, preview, now, now),
        )
    return job_id


def update_job_status(job_id: str, status: str) -> None:
    """Set a job's eager-phase status and bump updated_at."""
    with _connect() as conn:
        conn.execute(
            "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), job_id),
        )


def update_job_meta(
    job_id: str,
    *,
    student_name: str = "",
    target_program: str = "",
    score: int | None = None,
) -> None:
    """Persist quick display metadata on the job row for history sidebar."""
    with _connect() as conn:
        conn.execute(
            """
            UPDATE jobs
            SET student_name = ?, target_program = ?, score = ?, updated_at = ?
            WHERE id = ?
            """,
            (student_name[:120], target_program[:160], score, _now(), job_id),
        )


def get_job(job_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def delete_job(job_id: str) -> bool:
    """Delete a job and cascade its results. Returns True if a row was deleted."""
    with _connect() as conn:
        cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        return cur.rowcount > 0


def list_jobs(limit: int = 20, offset: int = 0) -> list[dict]:
    """Return newest jobs first, backfilling missing display meta from profile row if needed."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT j.*, r.payload AS profile_payload
            FROM jobs j
            LEFT JOIN results r
              ON r.job_id = j.id AND r.module_name = 'profile'
            ORDER BY j.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()

    out = []
    for row in rows:
        item = dict(row)
        profile_raw = item.pop("profile_payload", None)
        if not item.get("student_name") and profile_raw:
            try:
                prof = json.loads(profile_raw)
                item["student_name"] = prof.get("name", "")
                item["target_program"] = prof.get("target_program", "")
                item["score"] = prof.get("profile_strength_score")
            except (json.JSONDecodeError, TypeError):
                pass
        out.append(item)
    return out


def count_jobs() -> int:
    """Return total stored job rows cleanly."""
    with _connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS cnt FROM jobs").fetchone()
    return int(row["cnt"]) if row else 0


# ---------------------------------------------------------------------------
# Capability & Result operations
# ---------------------------------------------------------------------------

def save_capability_state(
    job_id: str,
    capability_name: str,
    status: str,
    payload: dict | None = None,
    error_message: str | None = None,
) -> None:
    """Upsert atomic capability state (`queued | running | completed | failed`) & payload."""
    serialized = json.dumps(payload if payload is not None else {}, ensure_ascii=False)
    now = _now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO results (job_id, module_name, status, payload, error_message, completed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (job_id, module_name)
            DO UPDATE SET
                status = excluded.status,
                payload = excluded.payload,
                error_message = excluded.error_message,
                completed_at = excluded.completed_at
            """,
            (job_id, capability_name, status, serialized, error_message, now),
        )
        conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now, job_id))


def save_result(job_id: str, module_name: str, payload: dict) -> None:
    """Save a completed (or error-carrying) result row cleanly."""
    is_err = isinstance(payload, dict) and "error" in payload
    save_capability_state(
        job_id,
        module_name,
        "failed" if is_err else "completed",
        payload=payload,
        error_message=str(payload["error"]) if is_err else None,
    )


def _deserialize_result_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["capability"] = d["module_name"]
    try:
        d["payload"] = json.loads(d["payload"]) if d["payload"] else {}
    except (json.JSONDecodeError, TypeError):
        d["payload"] = {}
    return d


def get_results(job_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM results WHERE job_id = ? ORDER BY completed_at",
            (job_id,),
        ).fetchall()
    return [_deserialize_result_row(r) for r in rows]


def get_result(job_id: str, module_name: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM results WHERE job_id = ? AND module_name = ?",
            (job_id, module_name),
        ).fetchone()
    return _deserialize_result_row(row) if row is not None else None
