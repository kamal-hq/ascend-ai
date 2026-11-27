"""
SQLite persistence layer for jobs and atomic capability results (WAL mode).

Supports seamless automatic schema migration on existing `data/ascend.db` files.
"""

import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from config import SQLITE_DB_PATH

_ALLOWED_TABLES = frozenset({"jobs", "results"})
_SAFE_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


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
    client_id       TEXT NOT NULL DEFAULT 'default',
    thread_id       TEXT NOT NULL DEFAULT '',
    version         INTEGER NOT NULL DEFAULT 1,
    source_text     TEXT NOT NULL DEFAULT '',
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
    if table not in _ALLOWED_TABLES or not _SAFE_IDENT_RE.fullmatch(column):
        raise ValueError(f"Unsafe schema identifier: {table}.{column}")
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
        _ensure_column(conn, "jobs", "client_id", "TEXT NOT NULL DEFAULT 'default'")
        _ensure_column(conn, "jobs", "thread_id", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "version", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(conn, "jobs", "source_text", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "input_preview", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "student_name", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "target_program", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "jobs", "score", "INTEGER")
        _ensure_column(conn, "results", "status", "TEXT NOT NULL DEFAULT 'completed'")
        _ensure_column(conn, "results", "error_message", "TEXT")
        conn.execute("UPDATE jobs SET thread_id = id WHERE thread_id = '' OR thread_id IS NULL")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON jobs(client_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_thread_id ON jobs(thread_id)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Job operations
# ---------------------------------------------------------------------------

def create_job(
    input_preview: str = "",
    client_id: str = "default",
    *,
    thread_id: str | None = None,
    version: int | None = None,
    source_text: str = "",
) -> str:
    """Insert a new pending job owned by *client_id* and return its UUID."""
    job_id = uuid.uuid4().hex
    now = _now()
    full_source = str(source_text or input_preview or "").strip()[:12000]
    preview = str(input_preview or full_source).strip()[:180]
    cid = str(client_id or "default").strip() or "default"
    tid = str(thread_id or "").strip() or job_id

    with _connect() as conn:
        if version is None:
            if thread_id:
                row = conn.execute(
                    "SELECT COALESCE(MAX(version), 0) AS max_v FROM jobs WHERE client_id = ? AND thread_id = ?",
                    (cid, tid),
                ).fetchone()
                ver = int(row["max_v"]) + 1 if row else 1
            else:
                ver = 1
        else:
            ver = max(1, int(version))

        conn.execute(
            """
            INSERT INTO jobs (id, client_id, thread_id, version, source_text, status, input_preview, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
            """,
            (job_id, cid, tid, ver, full_source, preview, now, now),
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


def get_job(job_id: str, client_id: str | None = None) -> dict | None:
    with _connect() as conn:
        if client_id is None:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM jobs WHERE id = ? AND client_id = ?",
                (job_id, client_id),
            ).fetchone()
    return dict(row) if row else None


def delete_job(job_id: str, client_id: str | None = None) -> bool:
    """Delete a job and cascade its results. Returns True if a row was deleted."""
    with _connect() as conn:
        if client_id is None:
            cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        else:
            cur = conn.execute(
                "DELETE FROM jobs WHERE id = ? AND client_id = ?",
                (job_id, client_id),
            )
        return cur.rowcount > 0


def delete_thread(thread_id: str, client_id: str) -> int:
    """Delete every revision belonging to *thread_id* under *client_id*."""
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM jobs WHERE thread_id = ? AND client_id = ?",
            (thread_id, client_id),
        )
        return int(cur.rowcount)


def get_thread_revisions(thread_id: str, client_id: str) -> list[dict]:
    """Return all completed revisions for *thread_id* ordered oldest to latest."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, thread_id, version, student_name, target_program, score, status, created_at, updated_at
            FROM jobs
            WHERE thread_id = ? AND client_id = ? AND status = 'completed'
            ORDER BY version ASC, created_at ASC
            """,
            (thread_id, client_id),
        ).fetchall()
    return [dict(r) for r in rows]


def prune_and_promote_revision(
    job_id: str,
    client_id: str,
    thread_id: str,
    base_version: int,
) -> None:
    """Delete revisions newer than *base_version* and set *job_id* as the new latest."""
    with _connect() as conn:
        conn.execute(
            """
            DELETE FROM jobs
            WHERE client_id = ? AND thread_id = ? AND version > ? AND id != ?
            """,
            (client_id, thread_id, base_version, job_id),
        )
        conn.execute(
            "UPDATE jobs SET version = ?, updated_at = ? WHERE id = ?",
            (base_version + 1, _now(), job_id),
        )


def list_jobs(
    limit: int = 20,
    offset: int = 0,
    client_id: str | None = None,
) -> list[dict]:
    """Return newest jobs first, optionally filtered to a single client workspace."""
    with _connect() as conn:
        if client_id is None:
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
        else:
            rows = conn.execute(
                """
                SELECT j.*, r.payload AS profile_payload
                FROM jobs j
                LEFT JOIN results r
                  ON r.job_id = j.id AND r.module_name = 'profile'
                WHERE j.client_id = ?
                ORDER BY j.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (client_id, limit, offset),
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


def count_jobs(client_id: str | None = None) -> int:
    """Return total stored job rows cleanly, optionally scoped to *client_id*."""
    with _connect() as conn:
        if client_id is None:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM jobs").fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM jobs WHERE client_id = ?",
                (client_id,),
            ).fetchone()
    return int(row["cnt"]) if row else 0


def restore_job_snapshot(
    client_id: str,
    snapshot: dict,
    *,
    thread_id_override: str | None = None,
) -> tuple[str, str]:
    """Restore/append a browser-saved job snapshot into SQLite owned by *client_id*."""
    cid = str(client_id or "default").strip() or "default"
    raw_id = str(snapshot.get("job_id") or "").strip()
    now = _now()
    created_at = str(snapshot.get("created_at") or now)
    updated_at = str(snapshot.get("updated_at") or now)
    results = snapshot.get("results") or {}
    profile_pl = results.get("profile") if isinstance(results, dict) else {}
    if not isinstance(profile_pl, dict):
        profile_pl = {}

    student_name = str(snapshot.get("student_name") or profile_pl.get("name") or "")[:120]
    target_program = str(snapshot.get("target_program") or profile_pl.get("target_program") or "")[:160]
    score = snapshot.get("score")
    if score is None:
        score = profile_pl.get("profile_strength_score")
    preview = str(snapshot.get("input_preview") or profile_pl.get("summary") or "")[:180]
    source_text = str(snapshot.get("source_text") or preview)[:12000]
    version = max(1, int(snapshot.get("version") or 1))

    with _connect() as conn:
        target_id = raw_id or uuid.uuid4().hex
        existing = conn.execute("SELECT client_id, thread_id FROM jobs WHERE id = ?", (target_id,)).fetchone()
        collided = False
        if existing is not None:
            if existing["client_id"] != cid:
                # Collision with another visitor's row — preserve isolation with fresh ID
                target_id = uuid.uuid4().hex
                existing = None
                collided = True

        raw_tid = str(snapshot.get("thread_id") or "").strip()
        if thread_id_override:
            target_tid = thread_id_override
        elif collided or not raw_tid or (raw_tid == raw_id and target_id != raw_id):
            target_tid = target_id
        else:
            other_owner = conn.execute(
                "SELECT 1 FROM jobs WHERE thread_id = ? AND client_id != ? LIMIT 1",
                (raw_tid, cid),
            ).fetchone()
            target_tid = target_id if other_owner is not None else raw_tid

        if existing is None:
            conn.execute(
                """
                INSERT INTO jobs (id, client_id, thread_id, version, source_text, status, input_preview, student_name, target_program, score, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
                """,
                (target_id, cid, target_tid, version, source_text, preview, student_name, target_program, score, created_at, updated_at),
            )
        else:
            target_tid = existing["thread_id"] or target_tid
            conn.execute(
                """
                UPDATE jobs
                SET student_name = COALESCE(NULLIF(student_name, ''), ?),
                    target_program = COALESCE(NULLIF(target_program, ''), ?),
                    source_text = COALESCE(NULLIF(source_text, ''), ?),
                    score = COALESCE(score, ?),
                    updated_at = ?
                WHERE id = ?
                """,
                (student_name, target_program, source_text, score, updated_at, target_id),
            )

        if isinstance(results, dict):
            existing_caps = {
                row["module_name"]
                for row in conn.execute(
                    "SELECT module_name FROM results WHERE job_id = ? AND status = 'completed'",
                    (target_id,),
                ).fetchall()
            }
            for cap_name, payload in results.items():
                if cap_name in existing_caps or not isinstance(payload, dict) or "error" in payload:
                    continue
                serialized = json.dumps(payload, ensure_ascii=False)
                conn.execute(
                    """
                    INSERT INTO results (job_id, module_name, status, payload, error_message, completed_at)
                    VALUES (?, ?, 'completed', ?, NULL, ?)
                    ON CONFLICT (job_id, module_name)
                    DO UPDATE SET
                        status = excluded.status,
                        payload = excluded.payload,
                        error_message = NULL,
                        completed_at = excluded.completed_at
                    """,
                    (target_id, str(cap_name), serialized, updated_at),
                )

    return target_id, target_tid


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
