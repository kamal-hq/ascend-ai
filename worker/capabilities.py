"""
Atomic on-demand capability worker — Phase 2 of the execution model.

Reads `profile`, `context`, `rag_matches`, and any completed sibling results
directly from SQLite, executes the single requested capability, and records
per-capability status transitions (`running` -> `completed` | `failed`).
"""

import logging

from agents.capabilities import dispatch_capability
from agents.common.kickoff import GroqQuotaExceededError
from data.db import get_results, save_capability_state

logger = logging.getLogger(__name__)

_FALLBACK_RATE = 278.5


def run_capability_job(
    job_id: str,
    capability_name: str,
    options: dict | None = None,
) -> None:
    """Execute one atomic capability for *job_id* and persist status + payload."""
    save_capability_state(job_id, capability_name, "running")
    try:
        rows = get_results(job_id)
        by_name = {r["module_name"]: r["payload"] for r in rows if r["status"] == "completed"}

        profile = by_name.get("profile")
        if not profile:
            raise ValueError("Eager profile result is required before running capabilities.")

        context = by_name.get("context") or {}
        live_rate = float(context.get("live_rate", _FALLBACK_RATE))

        rag_blob = by_name.get("rag_matches") or {}
        rag_matches = rag_blob.get("matches", [])
        if isinstance(rag_matches, str):
            rag_matches = []

        result = dispatch_capability(
            capability_name,
            profile=profile,
            live_rate=live_rate,
            rag_matches=rag_matches,
            existing_results=by_name,
            options=options or {},
        )

        save_capability_state(job_id, capability_name, "completed", payload=result)
        logger.info("[%s] Capability '%s' completed", job_id[:8], capability_name)

    except (ValueError, GroqQuotaExceededError) as exc:
        safe_msg = str(exc)[:240]
        save_capability_state(
            job_id,
            capability_name,
            "failed",
            payload={"error": safe_msg},
            error_message=safe_msg,
        )
        logger.warning("[%s] Capability '%s' validation error (%s)", job_id[:8], capability_name, type(exc).__name__)
        raise
    except Exception as exc:
        safe_msg = "Capability failed due to a temporary AI or search error. Please retry."
        save_capability_state(
            job_id,
            capability_name,
            "failed",
            payload={"error": safe_msg},
            error_message=safe_msg,
        )
        logger.error("[%s] Capability '%s' failed (%s)", job_id[:8], capability_name, type(exc).__name__)
        raise
