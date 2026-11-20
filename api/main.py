"""
api/main.py — FastAPI application factory (v3).

Launch with:
    uvicorn api.main:app --reload
"""

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agents.common.cache import result_cache
from agents.rag_matcher import _load_scholarships, query_scholarships_structured
from api.routes.jobs import router as jobs_router
from api.routes.utilities import router as utilities_router
from api.sse import router as sse_router
from config import CORS_ORIGIN_REGEX, CORS_ORIGINS, DEMO_SEED_JSON, GROQ_API_KEY
from data.db import (
    count_jobs,
    create_job,
    init_db,
    save_result,
    update_job_meta,
    update_job_status,
)
from worker.queue import count_active_workers, get_connection

logger = logging.getLogger(__name__)


def _ensure_demo_seeded() -> None:
    """Seed one realistic demo workspace once when starting from an empty DB."""
    if count_jobs() > 0:
        return
    seed_path = Path(DEMO_SEED_JSON)
    if not seed_path.exists():
        return
    try:
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        results = seed.get("results") or {}
        profile = results.get("profile") or {}
        job_id = create_job(seed.get("input_preview", ""))
        update_job_meta(
            job_id,
            student_name=seed.get("student_name", profile.get("name", "Sara Ahmed")),
            target_program=seed.get("target_program", profile.get("target_program", "")),
            score=seed.get("score", profile.get("profile_strength_score")),
        )
        for mod in ("context", "profile", "sop_draft", "career_paths"):
            if mod in results:
                save_result(job_id, mod, results[mod])
        if profile:
            save_result(
                job_id,
                "rag_matches",
                {"matches": query_scholarships_structured(profile, n_results=5)},
            )
        update_job_status(job_id, "completed")
        logger.info("Seeded default demo workspace (%s)", job_id[:8])
    except Exception:
        logger.exception("Failed to seed default demo workspace")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create / migrate SQLite tables, preload scholarship index, and seed empty DB."""
    init_db()
    _ensure_demo_seeded()
    _load_scholarships()
    yield


app = FastAPI(
    title="Ascend AI",
    version="3.0.0",
    description="Atomic on-demand career & scholarship intelligence API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
def health_check(warmup: bool = False):
    """Readiness & free-tier warm-up check for the Vite frontend."""
    redis_ok = False
    workers_active = 0
    try:
        redis_ok = bool(get_connection().ping())
        if redis_ok:
            workers_active = count_active_workers()
    except Exception:
        redis_ok = False

    db_ok = False
    jobs_count = 0
    try:
        jobs_count = count_jobs()
        db_ok = True
    except Exception:
        db_ok = False

    scholarships_loaded = 0
    try:
        scholarships_loaded = len(_load_scholarships())
    except Exception:
        scholarships_loaded = 0

    cache_ready = False
    try:
        result_cache.get("fx_usd_pkr", "latest")
        cache_ready = True
    except Exception:
        cache_ready = False

    if warmup:
        try:
            import agents.profile_agent  # noqa: F401
            from worker.eager import _fetch_live_rate

            _fetch_live_rate()
        except Exception:
            logger.debug("Optional warmup preload skipped", exc_info=True)

    execution_mode = "rq" if (redis_ok and workers_active > 0) else "async_threads"
    return {
        "status": "ok",
        "redis": redis_ok,
        "workers_active": workers_active,
        "execution_mode": execution_mode,
        "version": "3.0.0",
        "jobs_count": jobs_count,
        "checks": {
            "api": True,
            "database": db_ok,
            "scholarships_loaded": scholarships_loaded,
            "ai_configured": bool(GROQ_API_KEY),
            "cache_ready": cache_ready,
        },
    }


app.include_router(jobs_router, prefix="/jobs", tags=["jobs"])
app.include_router(sse_router, prefix="/jobs", tags=["sse"])
app.include_router(utilities_router, tags=["utilities"])
