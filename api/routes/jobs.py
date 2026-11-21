"""
api/routes/jobs.py — REST endpoints for job lifecycle and atomic on-demand capabilities.

Routes mounted at ``/jobs`` by api/main.py:
    POST /jobs                                       Create job + enqueue eager core
    GET  /jobs                                       List past jobs (newest first)
    GET  /jobs/{job_id}                              Get job status, capability states & payloads
    POST /jobs/{job_id}/capabilities/{capability}    Queue an atomic capability
"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.demo import get_client_id, seed_demo_for_client
from config import ALLOWED_CAPABILITIES
from data.db import (
    count_jobs,
    create_job,
    delete_job,
    get_job,
    get_result,
    get_results,
    list_jobs,
    restore_job_snapshot,
    save_capability_state,
    update_job_status,
)
from worker.queue import enqueue_capability, enqueue_eager

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class JobCreateRequest(BaseModel):
    input_text: str = Field(
        ...,
        min_length=1,
        description="Raw student notes, parsed CV text, or scraped LinkedIn text.",
    )


class JobCreateResponse(BaseModel):
    job_id: str
    status: str


class CapabilityStateInfo(BaseModel):
    status: str
    error_message: str | None = None
    completed_at: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    student_name: str = ""
    target_program: str = ""
    score: int | None = None
    created_at: str
    updated_at: str
    results: dict[str, Any]
    capability_states: dict[str, CapabilityStateInfo]


class CapabilityTriggerRequest(BaseModel):
    custom_notes: str = ""
    sop_text: str = ""


class CapabilityEnqueueResponse(BaseModel):
    job_id: str
    capability: str
    status: Literal["queued"]


class JobSummary(BaseModel):
    job_id: str
    status: str
    student_name: str = ""
    target_program: str = ""
    score: int | None = None
    input_preview: str = ""
    created_at: str
    updated_at: str


class JobListResponse(BaseModel):
    jobs: list[JobSummary]
    limit: int
    offset: int


class JobRestoreItem(BaseModel):
    job_id: str = ""
    student_name: str = ""
    target_program: str = ""
    score: int | None = None
    input_preview: str = ""
    created_at: str = ""
    updated_at: str = ""
    results: dict[str, Any] = Field(default_factory=dict)


class JobsRestoreRequest(BaseModel):
    jobs: list[JobRestoreItem] = Field(default_factory=list, max_length=30)


# ---------------------------------------------------------------------------
# POST /jobs — create job + enqueue eager phase
# ---------------------------------------------------------------------------
@router.post(
    "",
    response_model=JobCreateResponse,
    status_code=201,
    summary="Create a new job and enqueue the eager phase",
)
def create_job_endpoint(
    req: JobCreateRequest,
    client_id: str = Depends(get_client_id),
):
    job_id = create_job(input_preview=req.input_text, client_id=client_id)
    update_job_status(job_id, "running")

    input_data = {"input_text": req.input_text}

    try:
        enqueue_eager(job_id, input_data)
    except Exception as exc:
        logger.exception("Failed to enqueue eager job %s", job_id)
        update_job_status(job_id, "failed")
        raise HTTPException(status_code=500, detail=f"Queue error: {exc}") from exc

    return JobCreateResponse(job_id=job_id, status="running")


# ---------------------------------------------------------------------------
# POST /jobs/restore & POST /jobs/demo — browser workspace sync & isolated demo
# ---------------------------------------------------------------------------
@router.post(
    "/restore",
    status_code=200,
    summary="Restore/append browser-saved sessions into this client workspace",
)
def restore_jobs_endpoint(
    req: JobsRestoreRequest,
    client_id: str = Depends(get_client_id),
):
    restored = []
    for item in req.jobs:
        new_id = restore_job_snapshot(client_id, item.model_dump())
        restored.append({"old_id": item.job_id, "job_id": new_id})
    return {"restored": restored}


@router.post(
    "/demo",
    status_code=201,
    summary="Seed an isolated Sara Ahmed demo session for this client workspace",
)
def create_demo_session_endpoint(client_id: str = Depends(get_client_id)):
    job_id = seed_demo_for_client(client_id)
    return {"seeded": bool(job_id), "job_id": job_id}


# ---------------------------------------------------------------------------
# GET /jobs — list past jobs for history sidebar
# ---------------------------------------------------------------------------
@router.get(
    "",
    response_model=JobListResponse,
    summary="List past sessions/jobs for this client workspace, newest first",
)
def list_jobs_endpoint(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    seed_demo: bool = Query(False),
    client_id: str = Depends(get_client_id),
):
    if seed_demo and count_jobs(client_id=client_id) == 0:
        seed_demo_for_client(client_id)
    rows = list_jobs(limit=limit, offset=offset, client_id=client_id)
    jobs = [
        JobSummary(
            job_id=r["id"],
            status=r["status"],
            student_name=r.get("student_name", "") or "",
            target_program=r.get("target_program", "") or "",
            score=r.get("score"),
            input_preview=r.get("input_preview", "") or "",
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]
    return JobListResponse(jobs=jobs, limit=limit, offset=offset)


# ---------------------------------------------------------------------------
# GET /jobs/{job_id} — full snapshot of status, states & results
# ---------------------------------------------------------------------------
@router.get(
    "/{job_id}",
    response_model=JobStatusResponse,
    summary="Get job status, capability states, and completed payloads",
)
def get_job_endpoint(
    job_id: str,
    client_id: str = Depends(get_client_id),
):
    job = get_job(job_id, client_id=client_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    result_rows = get_results(job_id)
    results: dict[str, Any] = {}
    capability_states: dict[str, CapabilityStateInfo] = {}

    for r in result_rows:
        name = r["module_name"]
        capability_states[name] = CapabilityStateInfo(
            status=r.get("status", "completed"),
            error_message=r.get("error_message"),
            completed_at=r["completed_at"],
        )
        if r.get("status", "completed") == "completed" or r["payload"]:
            results[name] = r["payload"]

    profile_pl = results.get("profile") or {}
    student_name = job.get("student_name") or profile_pl.get("name", "")
    target_program = job.get("target_program") or profile_pl.get("target_program", "")
    score = job.get("score") if job.get("score") is not None else profile_pl.get("profile_strength_score")

    return JobStatusResponse(
        job_id=job["id"],
        status=job["status"],
        student_name=str(student_name or ""),
        target_program=str(target_program or ""),
        score=score,
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        results=results,
        capability_states=capability_states,
    )


@router.delete(
    "/{job_id}",
    status_code=200,
    summary="Delete a saved session/job and all its results",
)
def delete_job_endpoint(
    job_id: str,
    client_id: str = Depends(get_client_id),
):
    if not delete_job(job_id, client_id=client_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"deleted": True, "job_id": job_id}


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/capabilities/{capability_name}
# ---------------------------------------------------------------------------
@router.post(
    "/{job_id}/capabilities/{capability_name}",
    response_model=CapabilityEnqueueResponse,
    status_code=202,
    summary="Trigger a single atomic on-demand capability",
)
def enqueue_capability_endpoint(
    job_id: str,
    capability_name: str,
    req: CapabilityTriggerRequest | None = Body(default=None),
    client_id: str = Depends(get_client_id),
):
    if capability_name not in ALLOWED_CAPABILITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown capability '{capability_name}'. Allowed: {sorted(ALLOWED_CAPABILITIES)}",
        )

    job = get_job(job_id, client_id=client_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    profile_result = get_result(job_id, "profile")
    if profile_result is None or profile_result.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail="Profile result not available yet. Wait for the eager phase to complete.",
        )

    options = req.model_dump() if req else {}
    save_capability_state(job_id, capability_name, "queued", payload={})

    try:
        enqueue_capability(job_id, capability_name, options=options)
    except Exception as exc:
        logger.exception(
            "Failed to enqueue capability %s for job %s", capability_name, job_id
        )
        save_capability_state(
            job_id,
            capability_name,
            "failed",
            payload={"error": f"Queue error: {exc}"},
            error_message=f"Queue error: {exc}",
        )
        raise HTTPException(status_code=500, detail=f"Queue error: {exc}") from exc

    return CapabilityEnqueueResponse(
        job_id=job_id,
        capability=capability_name,
        status="queued",
    )
