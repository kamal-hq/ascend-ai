"""
api/main.py — FastAPI application factory (v3).

Launch with:
    uvicorn api.main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.jobs import router as jobs_router
from api.routes.utilities import router as utilities_router
from api.sse import router as sse_router
from config import CORS_ORIGIN_REGEX, CORS_ORIGINS
from data.db import init_db
from worker.queue import count_active_workers, get_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create / migrate SQLite tables once on boot."""
    init_db()
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
def health_check():
    """Quick health check for Vite frontend status indicator."""
    redis_ok = False
    workers_active = 0
    try:
        redis_ok = bool(get_connection().ping())
        if redis_ok:
            workers_active = count_active_workers()
    except Exception:
        redis_ok = False
    return {
        "status": "ok",
        "redis": redis_ok,
        "workers_active": workers_active,
        "version": "3.0.0",
    }


app.include_router(jobs_router, prefix="/jobs", tags=["jobs"])
app.include_router(sse_router, prefix="/jobs", tags=["sse"])
app.include_router(utilities_router, tags=["utilities"])
