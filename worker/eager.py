"""
Eager core worker — Phase 1 of the execution model.

Runs automatically on every user submission (~2-4s total):
  1. Fetch live USD->PKR exchange rate (cached 24h in cache.db) -> `context`
  2. Extract structured profile intelligence (`120b` direct HTTP) -> `profile` + job meta
  3. Match top-5 scholarships (~3ms domain BM25 ranker) -> `rag_matches`
"""

import logging
import time

import requests

from agents.common.cache import result_cache
from agents.profile_agent import extract_profile
from agents.rag_matcher import query_scholarships_structured
from data.db import save_result, update_job_meta, update_job_status

logger = logging.getLogger(__name__)

_EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/USD"
_FALLBACK_RATE = 278.5
_RATE_CACHE_TTL = 24 * 60 * 60


def _fetch_live_rate() -> float:
    cached = result_cache.get("fx_usd_pkr", "latest")
    if isinstance(cached, dict):
        age = time.time() - float(cached.get("ts", 0))
        if age < _RATE_CACHE_TTL and "rate" in cached:
            return float(cached["rate"])

    try:
        resp = requests.get(_EXCHANGE_RATE_URL, timeout=4)
        resp.raise_for_status()
        rate = float(resp.json()["rates"]["PKR"])
        result_cache.put("fx_usd_pkr", "latest", {"rate": rate, "ts": time.time()})
        return rate
    except Exception:
        logger.warning("Exchange rate fetch failed, using fallback %.1f", _FALLBACK_RATE)
        return _FALLBACK_RATE


def run_eager_job(job_id: str, input_data: dict) -> None:
    """Run Phase 1 eager core for *job_id*."""
    try:
        update_job_status(job_id, "running")

        # 1. Exchange rate
        live_rate = _fetch_live_rate()
        save_result(job_id, "context", {"live_rate": live_rate})
        logger.info("[%s] Context saved (live_rate=%.2f)", job_id[:8], live_rate)

        # 2. Structured profile extraction
        input_text = input_data["input_text"]
        profile_data = extract_profile(input_text)
        save_result(job_id, "profile", profile_data)
        update_job_meta(
            job_id,
            student_name=str(profile_data.get("name", "Student") or "Student"),
            target_program=str(profile_data.get("target_program", "") or ""),
            score=profile_data.get("profile_strength_score"),
        )
        logger.info("[%s] Profile saved", job_id[:8])

        # 3. Instant scholarship matching
        matches = query_scholarships_structured(profile_data, n_results=5)
        save_result(job_id, "rag_matches", {"matches": matches})
        logger.info("[%s] RAG matches saved (%d matches)", job_id[:8], len(matches))

        update_job_status(job_id, "completed")

    except Exception as exc:
        logger.exception("[%s] Eager phase failed: %s", job_id[:8], exc)
        save_result(job_id, "eager_error", {"error": str(exc)})
        update_job_status(job_id, "failed")
        raise
