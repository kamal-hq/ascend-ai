"""
Registry and lazy dispatcher for all 11 atomic capabilities.

Lazy imports avoid loading CrewAI/Chroma/Torch in processes that only run
direct LiteLLM structured tasks or validate capability names.
"""

from typing import Any

from config import ALLOWED_CAPABILITIES

__all__ = ["ALLOWED_CAPABILITIES", "dispatch_capability"]


def dispatch_capability(
    capability_name: str,
    *,
    profile: dict,
    live_rate: float = 278.5,
    rag_matches: list[dict] | None = None,
    existing_results: dict[str, Any] | None = None,
    options: dict[str, Any] | None = None,
) -> dict:
    """Execute one atomic capability by name and return its validated JSON dict."""
    if capability_name not in ALLOWED_CAPABILITIES:
        raise ValueError(
            f"Unknown capability {capability_name!r}. Allowed: {sorted(ALLOWED_CAPABILITIES)}"
        )

    existing = existing_results or {}
    opts = options or {}

    if capability_name == "sop_draft":
        from agents.capabilities.study_abroad import run_sop_draft
        return run_sop_draft(
            profile,
            custom_notes=str(opts.get("custom_notes", "")),
        )

    if capability_name == "sop_review":
        from agents.capabilities.study_abroad import run_sop_review
        sop_text = opts.get("sop_text")
        if not sop_text:
            draft = existing.get("sop_draft") or {}
            sop_text = draft.get("full_text") or "\n\n".join(draft.get("paragraphs", []))
        return run_sop_review(str(sop_text or ""))

    if capability_name == "scholarship_analysis":
        from agents.capabilities.study_abroad import run_scholarship_analysis
        return run_scholarship_analysis(profile, rag_matches or [], live_rate)

    if capability_name == "deadline_verification":
        from agents.capabilities.study_abroad import run_deadline_verification
        return run_deadline_verification(rag_matches or [])

    if capability_name == "faculty_outreach":
        from agents.capabilities.study_abroad import run_faculty_outreach
        return run_faculty_outreach(profile)

    if capability_name == "research_proposal":
        from agents.capabilities.study_abroad import run_research_proposal
        return run_research_proposal(profile)

    if capability_name == "career_paths":
        from agents.capabilities.career import run_career_paths
        return run_career_paths(profile)

    if capability_name == "learning_roadmap":
        from agents.capabilities.career import run_learning_roadmap
        return run_learning_roadmap(profile)

    if capability_name == "freelance_pack":
        from agents.capabilities.career import run_freelance_pack
        return run_freelance_pack(
            profile,
            career_paths=existing.get("career_paths"),
        )

    if capability_name == "academia_vs_industry":
        from agents.capabilities.career import run_academia_vs_industry
        return run_academia_vs_industry(profile)

    if capability_name == "local_ecosystem":
        from agents.capabilities.ecosystem import run_local_ecosystem
        return run_local_ecosystem(profile)

    raise ValueError(f"Unhandled capability {capability_name!r}")
