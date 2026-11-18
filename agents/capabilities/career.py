"""
Career & Freelance atomic capabilities (4 independent triggers).

  Direct LiteLLM (`20b`):
    - career_paths          (grounded with `data/salary_ranges.json`)
    - freelance_pack
    - academia_vs_industry

  Search-Grounded Structured Synthesis (`20b` + 7-day SQLite cache):
    - learning_roadmap      (12-week YouTube syllabus)
"""

import json
import logging

from agents.capabilities.helpers import (
    gather_cached_evidence,
    plan_search_queries,
    synthesize_from_evidence,
)
from agents.common.kickoff import safe_completion
from agents.common.tools import search_youtube
from agents.schemas import (
    AcademiaVsIndustryResult,
    CareerPathsResult,
    FreelancePackResult,
    LearningRoadmapResult,
)
from config import MODEL_CAPABILITIES, SALARY_RANGES_JSON

logger = logging.getLogger(__name__)


def _load_salary_benchmarks() -> dict:
    try:
        with open(SALARY_RANGES_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Could not load salary_ranges.json: %s", exc)
        return {}


def run_career_paths(profile: dict) -> dict:
    """Map student strengths to 5 digital roles grounded in local PKR remote salary data."""
    salary_benchmarks = _load_salary_benchmarks()
    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert career strategist focused on the Pakistani remote tech & digital economy. "
                    "Map the student's skills to 5 realistic high-growth digital roles using the provided PKR monthly "
                    "entry-level salary benchmarks as grounding where roles match or overlap."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Reference PKR Entry-Level Monthly Salary Benchmarks:\n{salary_benchmarks}\n\n"
                    f"Candidate Profile:\n{profile}\n\n"
                    "Return 5 concrete career roles with match reasons, realistic PKR monthly salary ranges, "
                    "required skills, skill gaps, and demand outlook."
                ),
            },
        ],
        response_model=CareerPathsResult,
        task_name="Digital Career Mapper",
        model=MODEL_CAPABILITIES,
        estimated_tokens=1500,
    )
    return result.model_dump()


def run_learning_roadmap(profile: dict) -> dict:
    """Build a 12-week skill syllabus paired with real cached YouTube URLs."""
    skill_level = "intermediate" if profile.get("work_experience") else "beginner"
    target_field = profile.get("target_program") or profile.get("career_goal") or "Data Science & AI"

    queries = plan_search_queries(
        goal_instruction="Find 4 distinct YouTube tutorial courses spanning core fundamentals to advanced project topics for a 12-week learning syllabus.",
        context_text=f"Target field: {target_field}\nCurrent level: {skill_level}\nExisting skills: {profile.get('special_skills')}",
        task_name="12-Week Learning Syllabus",
        max_queries=4,
    )
    evidence = gather_cached_evidence([(q, search_youtube) for q in queries])

    return synthesize_from_evidence(
        system_prompt=(
            "You are a technical curriculum designer. Build a complete 12-week progressive learning syllabus "
            "(weeks 1 through 12) for the student. Assign each week a clear topic, concrete milestone, video_title, "
            "and video_url. Prefer exact `https://www.youtube.com/watch?v=...` URLs from the search evidence when available; "
            "if YouTube search evidence was unavailable or blocked, set `video_url` to a valid YouTube search URL "
            "`https://www.youtube.com/results?search_query=<url-encoded-topic>` so every week always remains valid JSON."
        ),
        user_prompt=(
            f"Target Field: {target_field}\nSkill Level: {skill_level}\n"
            f"Existing Skills: {profile.get('special_skills')}\nTarget Gaps: {profile.get('gap_analysis')}"
        ),
        evidence_text=evidence,
        response_model=LearningRoadmapResult,
        task_name="12-Week Learning Syllabus",
        estimated_tokens=1800,
    )


def run_freelance_pack(profile: dict, *, career_paths: dict | None = None) -> dict:
    """Generate Upwork bio, 3 priced Fiverr gigs (PKR), and a 14-day portfolio project."""
    career_hint = f"\nMatched career context:\n{career_paths}" if career_paths else ""
    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Top-Rated Plus Pakistani freelance strategist on Upwork and Fiverr. "
                    "Convert the student's concrete skills into client-ready freelance assets without hype or fluff."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Candidate Profile:\n{profile}{career_hint}\n\n"
                    "Generate: 1) A converting ~150-word Upwork bio, 2) Three specific Fiverr gigs with "
                    "realistic starting prices in PKR and clear deliverables, 3) One practical 14-day portfolio "
                    "sprint project with tech stack and 3-4 concrete milestones."
                ),
            },
        ],
        response_model=FreelancePackResult,
        task_name="Upwork & Fiverr Launchpad",
        model=MODEL_CAPABILITIES,
        estimated_tokens=1500,
    )
    result.upwork_bio_word_count = len(result.upwork_bio.split())
    return result.model_dump()


def run_academia_vs_industry(profile: dict) -> dict:
    """Deliver a candid PhD/Research vs Industry tradeoff analysis plus 2 university picks."""
    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a pragmatic career & academic advisor. Give an honest, unsentimental tradeoff "
                    "analysis between pursuing a PhD/Research Master's versus entering industry immediately, "
                    "accounting for opportunity cost, missing research output, and stated career goals. "
                    "Recommend 2 specific real universities in the student's target countries if they choose academia."
                ),
            },
            {
                "role": "user",
                "content": f"Candidate Profile:\n{profile}",
            },
        ],
        response_model=AcademiaVsIndustryResult,
        task_name="PhD vs Industry Strategist",
        model=MODEL_CAPABILITIES,
        estimated_tokens=1300,
    )
    return result.model_dump()
