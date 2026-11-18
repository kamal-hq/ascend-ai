"""
RQ queue setup and enqueue helpers with automatic in-process fallback.

When Redis + an active RQ `SimpleWorker` are listening on the target queue, jobs
go to Redis/RQ as designed. If no RQ worker is active (e.g. forgotten terminal or
Redis offline), jobs run seamlessly in a background daemon thread instead of
hanging indefinitely in `'running'`/`'queued'`.
"""

import logging
import threading

import redis
import rq

from config import ALLOWED_CAPABILITIES, REDIS_URL

logger = logging.getLogger(__name__)


def get_connection() -> redis.Redis:
    """Return a Redis connection parsed from config.REDIS_URL."""
    return redis.Redis.from_url(REDIS_URL, socket_connect_timeout=0.35, socket_timeout=0.5)


def get_queue(name: str = "default") -> rq.Queue:
    """Return an RQ Queue bound to the shared Redis connection."""
    return rq.Queue(name, connection=get_connection())


def count_active_workers(queue_name: str | None = None) -> int:
    """Count live RQ workers (optionally filtered to those listening on *queue_name*)."""
    try:
        conn = get_connection()
        conn.ping()
        workers = rq.Worker.all(connection=conn)
        if queue_name is None:
            return len(workers)
        return sum(1 for w in workers if queue_name in w.queue_names())
    except Exception:
        return 0


def _run_eager_thread(job_id: str, input_data: dict) -> None:
    from worker.eager import run_eager_job
    try:
        run_eager_job(job_id, input_data)
    except Exception:
        logger.exception("[%s] Background eager thread failed", job_id[:8])


def _run_capability_thread(job_id: str, capability_name: str, options: dict) -> None:
    from worker.capabilities import run_capability_job
    try:
        run_capability_job(job_id, capability_name, options)
    except Exception:
        logger.exception("[%s] Background capability '%s' thread failed", job_id[:8], capability_name)


def enqueue_eager(job_id: str, input_data: dict) -> str:
    """Enqueue Phase 1 eager core to RQ or run in background thread if no worker active."""
    if count_active_workers("eager") > 0:
        get_queue("eager").enqueue(
            "worker.eager.run_eager_job",
            job_id,
            input_data,
            job_timeout="5m",
        )
        return "rq"

    logger.warning("[%s] No active RQ worker for 'eager'; running in local background thread.", job_id[:8])
    t = threading.Thread(target=_run_eager_thread, args=(job_id, input_data), daemon=True)
    t.start()
    return "thread"


def enqueue_capability(
    job_id: str,
    capability_name: str,
    options: dict | None = None,
) -> str:
    """Enqueue an atomic capability to RQ or run in background thread if no worker active."""
    if capability_name not in ALLOWED_CAPABILITIES:
        raise ValueError(
            f"Unknown capability {capability_name!r}. Allowed: {sorted(ALLOWED_CAPABILITIES)}"
        )

    opts = options or {}
    if count_active_workers("capabilities") > 0:
        get_queue("capabilities").enqueue(
            "worker.capabilities.run_capability_job",
            job_id,
            capability_name,
            opts,
            job_timeout="5m",
        )
        return "rq"

    logger.warning(
        "[%s] No active RQ worker for 'capabilities'; running '%s' in local background thread.",
        job_id[:8],
        capability_name,
    )
    t = threading.Thread(
        target=_run_capability_thread,
        args=(job_id, capability_name, opts),
        daemon=True,
    )
    t.start()
    return "thread"
