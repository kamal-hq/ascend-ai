"""
agents/profile_agent.py — Eager Phase structured student profile intelligence.

Uses `groq/openai/gpt-oss-120b` (dedicated pool) via `safe_completion()` to
produce a validated `ProfileResult` matching `design.md` and `Design a Project UI`.
Raises cleanly on failure so workers mark job status as 'failed' instead of
persisting a fake placeholder profile.
"""

from agents.common.kickoff import safe_completion
from agents.schemas import ProfileResult
from config import MODEL_EAGER_PROFILE

_SYSTEM_PROMPT = """You are an elite international university admissions consultant and career strategist.
Analyze the student's raw background notes, CV text, or LinkedIn dump and produce a rigorous,
honest assessment calibrated against competitive global scholarships (Fulbright, Chevening, DAAD, Erasmus Mundus).

Instructions:
1. Extract demographic, academic, experience, skills, and goal fields accurately. Leave unknown numeric/date fields as empty strings, never invent degrees or GPAs.
2. Write a crisp 2-sentence `summary` capturing who the student is and what they are building toward.
3. Score `profile_strength_score` strictly from 0 to 100 (a student with solid coursework but no publications, internships, or leadership typically scores 50-62).
4. Set `strength_label` based on the score:
   - 80-100: "Strong"
   - 65-79: "Competitive"
   - 50-64: "Developing"
   - 0-49: "Needs Focus"
5. Set `is_research_track` to true if `target_program` mentions PhD, MPhil, or Master's by Research.
6. Provide BOTH:
   - `gap_analysis`: candid narrative summary of missing competitiveness signals
   - `gap_items`: exactly 3 structured priority gaps with `severity` ("HIGH IMPACT", "REQUIRED", or "MEDIUM")
7. Provide BOTH:
   - `improvement_roadmap`: 3 concise single-line action bullets
   - `roadmap_steps`: 3 structured 2-month blocks (`MONTH 1-2`, `MONTH 3-4`, `MONTH 5-6`) with clear titles & details."""


def extract_profile(raw_text: str) -> dict:
    """Extract and evaluate student profile into a validated `ProfileResult` dict."""
    safe_text = str(raw_text or "").strip()[:6000]
    if not safe_text:
        raise ValueError("Cannot extract profile from empty input text.")

    result = safe_completion(
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Student raw input:\n\n{safe_text}"},
        ],
        response_model=ProfileResult,
        task_name="Profile Intelligence Extraction",
        model=MODEL_EAGER_PROFILE,
        estimated_tokens=1100,
    )

    # Keep string list and structured step list synced cleanly
    if result.roadmap_steps and not result.improvement_roadmap:
        result.improvement_roadmap = [
            f"{step.timeframe}: {step.title} — {step.detail}"
            for step in result.roadmap_steps
        ]
    if not result.gap_analysis and result.gap_items:
        result.gap_analysis = " ".join(
            f"{item.title}: {item.detail}" for item in result.gap_items
        )

    return result.model_dump()
