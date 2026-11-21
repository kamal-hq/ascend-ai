"""Shared demo-workspace seeder and client-id normalization helpers."""

import json
import logging
import re
from pathlib import Path

from fastapi import Header

from agents.rag_matcher import query_scholarships_structured
from config import DEMO_SEED_JSON
from data.db import (
    count_jobs,
    create_job,
    save_result,
    update_job_meta,
    update_job_status,
)

logger = logging.getLogger(__name__)

_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")


def normalize_client_id(raw: str | None) -> str:
    """Validate/normalize a browser client workspace ID, falling back to 'default'."""
    val = (raw or "").strip()
    if _CLIENT_ID_RE.fullmatch(val):
        return val
    return "default"


def get_client_id(x_client_id: str | None = Header(default=None, alias="X-Client-Id")) -> str:
    """FastAPI dependency extracting sanitized X-Client-Id header."""
    return normalize_client_id(x_client_id)


_DEMO_SOURCE_TEXT = (
    "Sara Ahmed — BS Software Engineering, NUST Islamabad (2025), CGPA 3.58. "
    "1 year experience as Junior Machine Learning Engineer (internship + part-time) building "
    "medical image classifiers and Python/FastAPI microservices. Led Women in Computing chapter (120 members). "
    "Targeting fully funded MS Artificial Intelligence programs in Germany and the UK (DAAD EPOS, Chevening, Erasmus Mundus). "
    "Long-term goal: Healthcare AI research and engineering leadership."
)


def seed_demo_for_client(client_id: str = "default") -> str | None:
    """Seed one realistic Sara Ahmed workspace for *client_id* if they currently have 0 jobs."""
    cid = normalize_client_id(client_id)
    if count_jobs(client_id=cid) > 0:
        return None
    seed_path = Path(DEMO_SEED_JSON)
    if not seed_path.exists():
        return None
    try:
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        results = seed.get("results") or {}
        profile = results.get("profile") or {}
        job_id = create_job(
            seed.get("input_preview", ""),
            client_id=cid,
            source_text=_DEMO_SOURCE_TEXT,
        )
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
        logger.info("Seeded demo workspace (%s) for client %s", job_id[:8], cid[:12])
        return job_id
    except Exception:
        logger.exception("Failed to seed demo workspace for client %s", cid[:12])
        return None
