"""
agents/common/cache.py — 7-day TTL SQLite cache for search / ArXiv results.

Goal: repeat queries against DuckDuckGo, Brave, Tavily, or ArXiv hit the
local cache instead of the external API, avoiding both rate limits and
bot-detection blocks (architecture.md §3).

Usage
-----
    from agents.common.cache import result_cache

    # Try the cache first
    hit = result_cache.get("arxiv", "transformer pruning 2025")
    if hit is not None:
        return hit

    # Miss → call the real API, then store
    data = real_arxiv_search("transformer pruning 2025")
    result_cache.put("arxiv", "transformer pruning 2025", data)

The backing SQLite file path comes from ``config.CACHE_DB_PATH``.
"""

import hashlib
import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from config import CACHE_DB_PATH

logger = logging.getLogger(__name__)

_TTL_SECONDS: int = 7 * 24 * 60 * 60  # 7 days


class ResultCache:
    """Thread-safe, TTL-aware SQLite cache for external-API results.

    Each entry is keyed by ``(source, query_hash)`` where *source* is a
    human label like ``"arxiv"`` or ``"brave"`` and *query_hash* is a
    SHA-256 digest of the raw query string (avoids indexing arbitrarily
    long text).
    """

    _CREATE_TABLE = """
        CREATE TABLE IF NOT EXISTS search_cache (
            source     TEXT    NOT NULL,
            query_hash TEXT    NOT NULL,
            query_raw  TEXT    NOT NULL,
            result     TEXT    NOT NULL,
            created_at REAL   NOT NULL,
            PRIMARY KEY (source, query_hash)
        )
    """

    _CREATE_INDEX = """
        CREATE INDEX IF NOT EXISTS idx_cache_created
        ON search_cache (created_at)
    """

    def __init__(self, db_path: str | Path, ttl_seconds: int = _TTL_SECONDS) -> None:
        self._db_path = str(db_path)
        self._ttl = ttl_seconds
        self._local = threading.local()   # one connection per thread
        self._init_done = False
        self._init_lock = threading.Lock()

    # -- connection management ------------------------------------------------

    def _conn(self) -> sqlite3.Connection:
        """Return a per-thread SQLite connection, creating it if needed."""
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            self._local.conn = conn
        # Ensure the schema exists (once per process, not per thread)
        if not self._init_done:
            with self._init_lock:
                if not self._init_done:
                    conn.execute(self._CREATE_TABLE)
                    conn.execute(self._CREATE_INDEX)
                    conn.commit()
                    self._init_done = True
        return conn

    # -- helpers --------------------------------------------------------------

    @staticmethod
    def _hash(query: str) -> str:
        return hashlib.sha256(query.encode("utf-8")).hexdigest()

    # -- public API -----------------------------------------------------------

    def get(self, source: str, query: str) -> Any | None:
        """Return cached result or ``None`` on miss / expiry."""
        conn = self._conn()
        row = conn.execute(
            "SELECT result, created_at FROM search_cache "
            "WHERE source = ? AND query_hash = ?",
            (source, self._hash(query)),
        ).fetchone()

        if row is None:
            return None

        result_json, created_at = row
        age = time.time() - created_at
        if age > self._ttl:
            # Stale — delete and treat as miss
            conn.execute(
                "DELETE FROM search_cache WHERE source = ? AND query_hash = ?",
                (source, self._hash(query)),
            )
            conn.commit()
            logger.debug("Cache EXPIRED for %s:%s (%.0f s old)", source, query[:60], age)
            return None

        logger.debug("Cache HIT for %s:%s (%.0f s old)", source, query[:60], age)
        try:
            return json.loads(result_json)
        except (json.JSONDecodeError, TypeError):
            return result_json  # stored as plain string, return as-is

    def put(self, source: str, query: str, result: Any) -> None:
        """Insert or replace a cache entry."""
        serialized = json.dumps(result, default=str)
        conn = self._conn()
        conn.execute(
            "INSERT OR REPLACE INTO search_cache "
            "(source, query_hash, query_raw, result, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (source, self._hash(query), query, serialized, time.time()),
        )
        conn.commit()
        logger.debug("Cache PUT for %s:%s", source, query[:60])

    def evict_expired(self) -> int:
        """Remove all entries older than the TTL. Returns count deleted."""
        cutoff = time.time() - self._ttl
        conn = self._conn()
        cur = conn.execute(
            "DELETE FROM search_cache WHERE created_at < ?", (cutoff,)
        )
        conn.commit()
        deleted = cur.rowcount
        if deleted:
            logger.info("Cache eviction: removed %d expired entries", deleted)
        return deleted

    def clear(self, source: str | None = None) -> int:
        """Wipe cache entries. If *source* given, only that source."""
        conn = self._conn()
        if source:
            cur = conn.execute(
                "DELETE FROM search_cache WHERE source = ?", (source,)
            )
        else:
            cur = conn.execute("DELETE FROM search_cache")
        conn.commit()
        return cur.rowcount


# ---------------------------------------------------------------------------
# Module-level singleton — importable as ``from agents.common.cache import result_cache``
# ---------------------------------------------------------------------------
result_cache = ResultCache(db_path=CACHE_DB_PATH)
