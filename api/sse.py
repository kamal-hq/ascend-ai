"""
api/sse.py — Server-Sent Event streams for live eager & capability progress.

Routes mounted at ``/jobs`` by api/main.py:
    GET /jobs/{job_id}/stream
    GET /jobs/{job_id}/capabilities/{capability_name}/stream
"""

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from api.demo import normalize_client_id
from config import ALLOWED_CAPABILITIES
from data.db import get_job, get_result, get_results

logger = logging.getLogger(__name__)

router = APIRouter()

_POLL_INTERVAL: float = 0.5
_MAX_WAIT: float = 180.0


@router.get(
    "/{job_id}/stream",
    summary="SSE stream of eager phase & capability updates for a job",
)
async def stream_job(job_id: str, client_id: str | None = Query(default=None)):
    cid = normalize_client_id(client_id) if client_id else None
    if get_job(job_id, client_id=cid) is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return EventSourceResponse(
        _job_event_generator(job_id),
        media_type="text/event-stream",
    )


async def _job_event_generator(job_id: str):
    """Yield SSE events as eager slices complete. Terminates when eager completes/fails."""
    seen_completed: set[str] = set()
    elapsed: float = 0.0

    while elapsed < _MAX_WAIT:
        job = get_job(job_id)
        if job is None:
            yield {"event": "error", "data": json.dumps({"error": "job_not_found"})}
            return

        results = get_results(job_id)
        for r in results:
            cap = r["module_name"]
            status = r.get("status", "completed")
            if status == "completed" and cap not in seen_completed:
                seen_completed.add(cap)
                yield {
                    "event": "result",
                    "data": json.dumps(
                        {"module": cap, "capability": cap, "payload": r["payload"]},
                        default=str,
                    ),
                }

        if job["status"] in ("completed", "failed"):
            yield {
                "event": "status",
                "data": json.dumps({"status": job["status"]}),
            }
            yield {"event": "done", "data": "{}"}
            return

        await asyncio.sleep(_POLL_INTERVAL)
        elapsed += _POLL_INTERVAL

    yield {
        "event": "error",
        "data": json.dumps({"error": "stream_timeout", "seconds": _MAX_WAIT}),
    }


@router.get(
    "/{job_id}/capabilities/{capability_name}/stream",
    summary="SSE stream for a single atomic capability run",
)
async def stream_capability(
    job_id: str,
    capability_name: str,
    client_id: str | None = Query(default=None),
):
    if capability_name not in ALLOWED_CAPABILITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown capability '{capability_name}'. Allowed: {sorted(ALLOWED_CAPABILITIES)}",
        )
    cid = normalize_client_id(client_id) if client_id else None
    if get_job(job_id, client_id=cid) is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return EventSourceResponse(
        _capability_event_generator(job_id, capability_name),
        media_type="text/event-stream",
    )


async def _capability_event_generator(job_id: str, capability_name: str):
    """Stream capability status transitions (`queued` -> `running` -> `completed` | `failed`)."""
    last_status: str | None = None
    elapsed: float = 0.0

    while elapsed < _MAX_WAIT:
        row = get_result(job_id, capability_name)
        if row is not None:
            status = row.get("status", "completed")

            if status != last_status:
                last_status = status
                yield {
                    "event": "capability_status",
                    "data": json.dumps({"capability": capability_name, "status": status}),
                }

            if status == "completed":
                yield {
                    "event": "result",
                    "data": json.dumps(
                        {"capability": capability_name, "payload": row["payload"]},
                        default=str,
                    ),
                }
                yield {"event": "done", "data": "{}"}
                return

            if status == "failed":
                err_msg = row.get("error_message") or (row.get("payload") or {}).get("error", "Capability failed")
                yield {
                    "event": "error",
                    "data": json.dumps({"capability": capability_name, "error": err_msg}),
                }
                yield {"event": "done", "data": "{}"}
                return

        else:
            if last_status is None:
                last_status = "waiting"
                yield {
                    "event": "capability_status",
                    "data": json.dumps({"capability": capability_name, "status": "queued"}),
                }

        await asyncio.sleep(_POLL_INTERVAL)
        elapsed += _POLL_INTERVAL

    yield {
        "event": "error",
        "data": json.dumps({"error": "stream_timeout", "seconds": _MAX_WAIT}),
    }
