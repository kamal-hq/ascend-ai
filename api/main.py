"""
api/main.py — FastAPI application factory (v3).

Launch with:
    uvicorn api.main:app --reload
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agents.common.cache import result_cache
from agents.rag_matcher import _load_scholarships
from api.demo import get_optional_client_id
from api.routes.jobs import router as jobs_router
from api.routes.utilities import router as utilities_router
from api.sse import router as sse_router
from config import CORS_ORIGIN_REGEX, CORS_ORIGINS, GROQ_API_KEY
from data.db import count_jobs, init_db
from worker.queue import count_active_workers, get_connection

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create / migrate SQLite tables and preload scholarship index."""
    init_db()
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
def health_check(
    warmup: bool = False,
    client_id: str | None = Depends(get_optional_client_id),
):
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
        jobs_count = count_jobs(client_id=client_id) if client_id else 0
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
