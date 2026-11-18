"""
Study Abroad & Research atomic capabilities (6 independent triggers).

  Direct LiteLLM (`20b`):
    - sop_draft
    - sop_review
    - scholarship_analysis

  Search-Grounded Structured Synthesis (`20b` + 7-day SQLite cache):
    - deadline_verification
    - faculty_outreach
    - research_proposal
"""

from agents.capabilities.helpers import (
    gather_cached_evidence,
    plan_search_queries,
    synthesize_from_evidence,
)
from agents.common.kickoff import safe_completion
from agents.common.tools import scrape_website, search_arxiv, search_internet
from agents.schemas import (
    DeadlineVerificationResult,
    FacultyOutreachResult,
    ResearchProposalResult,
    ScholarshipAnalysisResult,
    SopDraftResult,
    SopReviewResult,
)
from config import MODEL_CAPABILITIES


def run_sop_draft(
    profile: dict,
    *,
    custom_notes: str = "",
) -> dict:
    """Draft a tailored 3-paragraph (~600-word) Statement of Purpose."""
    extra = f"\nAdditional user focus instructions: {custom_notes.strip()}" if custom_notes.strip() else ""
    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an elite graduate admissions SOP architect. "
                    "Write a compelling, publication-ready 3-to-4 paragraph (~500-600 word) Statement of Purpose "
                    "strictly in the FIRST PERSON ('I', 'my') using the applicant's authentic voice. "
                    "Ground every claim strictly in the student's real profile—never invent fake accuracy percentages, "
                    "fake participant counts, fake publications, or fake grades."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Candidate Profile:\n{profile}{extra}\n\n"
                    "Return JSON matching SopDraftResult with `title`, `target_context`, `paragraphs` (a flat JSON array "
                    "of 3-4 string paragraphs), and `key_themes`. Leave `full_text` empty string `\"\"` and `word_count` as 0 "
                    "(the server populates them automatically)."
                ),
            },
        ],
        response_model=SopDraftResult,
        task_name="SOP Draft",
        model=MODEL_CAPABILITIES,
        estimated_tokens=1600,
    )
    if result.paragraphs and not result.full_text.strip():
        result.full_text = "\n\n".join(result.paragraphs)
    elif result.full_text.strip() and not result.paragraphs:
        result.paragraphs = [p.strip() for p in result.full_text.split("\n\n") if p.strip()]
    result.word_count = len(result.full_text.split())
    return result.model_dump()


def run_sop_review(sop_text: str) -> dict:
    """Score an SOP against a strict 25-point admissions rubric with 3 actionable fixes."""
    clean_sop = str(sop_text or "").strip()
    if not clean_sop:
        raise ValueError("No SOP text available to review. Draft an SOP or paste custom SOP text first.")

    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict graduate admissions committee reviewer. Evaluate the Statement of Purpose "
                    "across 5 standard criteria worth 5 points each (total out of 25): "
                    "1) Clarity & Focus, 2) Structure & Cohesion, 3) Program & Research Fit, "
                    "4) Evidence & Achievements, 5) Tone & Writing Quality. "
                    "Provide 3 concrete revision tips with specific example rewrites."
                ),
            },
            {
                "role": "user",
                "content": f"Evaluate this Statement of Purpose:\n\n{clean_sop[:8000]}",
            },
        ],
        response_model=SopReviewResult,
        task_name="SOP Rubric Review",
        model=MODEL_CAPABILITIES,
        estimated_tokens=1400,
    )
    return result.model_dump()


def run_scholarship_analysis(
    profile: dict,
    rag_matches: list[dict],
    live_rate: float,
) -> dict:
    """Produce deep eligibility, fit rationales, PKR estimates, and requirement gaps for matched scholarships."""
    if not rag_matches:
        raise ValueError("No RAG-matched scholarships found for this job.")

    result = safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an international financial aid and scholarship eligibility advisor. "
                    "Compare the candidate's real profile against each RAG-matched scholarship strictly. "
                    "Flag eligibility realistically (Eligible / Conditional / Ineligible), convert any mentioned "
                    "monetary figures using the live USD-to-PKR rate, and state missing gaps clearly."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Live USD to PKR rate: {live_rate}\n\n"
                    f"Candidate Profile:\n{profile}\n\n"
                    f"Matched Scholarships:\n{rag_matches}"
                ),
            },
        ],
        response_model=ScholarshipAnalysisResult,
        task_name="Scholarship Fit & Gap Matrix",
        model=MODEL_CAPABILITIES,
        estimated_tokens=2000,
    )
    return result.model_dump()


def run_deadline_verification(rag_matches: list[dict]) -> dict:
    """Verify upcoming deadlines for top matched scholarships via cached web search & portal scraping."""
    if not rag_matches:
        raise ValueError("No matched scholarships available to verify deadlines.")

    top_items = rag_matches[:3]
    lookups = []
    for m in top_items:
        name = m.get("name", "")
        url = m.get("url", "")
        if name:
            lookups.append((f"{name} application deadline 2026 2027", search_internet))
        if url:
            lookups.append((url, scrape_website))

    evidence = gather_cached_evidence(lookups)

    return synthesize_from_evidence(
        system_prompt=(
            "You are a diligent scholarship application auditor. Using ONLY the provided web search "
            "snippets and official portal scrapes, report the verified deadline and cycle status "
            "(Open / Upcoming / Closed / Unconfirmed) for each of the 3 scholarships. "
            "Never fabricate dates not supported by evidence; mark unclear dates as Unconfirmed."
        ),
        user_prompt=f"Verify deadlines for these scholarships:\n{[{k: m.get(k) for k in ('name', 'country', 'deadline_month', 'url')} for m in top_items]}",
        evidence_text=evidence,
        response_model=DeadlineVerificationResult,
        task_name="Live Deadline Auditor",
        estimated_tokens=1800,
    )


def run_faculty_outreach(profile: dict) -> dict:
    """Discover 2 real professors aligned with student research and draft a 150-word cold email."""
    interests = profile.get("research_interests") or [profile.get("target_program") or "Data Science"]
    countries = profile.get("target_country") or ["USA", "Germany"]
    topic_str = ", ".join(str(x) for x in interests)
    country_str = ", ".join(str(x) for x in countries)

    queries = plan_search_queries(
        goal_instruction="Find 2 real professors and their active university research labs matching the student's interests and target countries.",
        context_text=f"Research interests: {topic_str}\nTarget countries: {country_str}",
        task_name="Faculty Outreach",
        max_queries=2,
    )
    lookups = [(q, search_internet) for q in queries]
    lookups.append((topic_str, search_arxiv))
    evidence = gather_cached_evidence(lookups)

    data = synthesize_from_evidence(
        system_prompt=(
            "You are an academic networking advisor. Using ONLY the provided web search & ArXiv evidence, "
            "identify 2 REAL professors in the student's target countries who research the student's topics, "
            "including their full name, exact university, department/lab name, and specific focus. "
            "Then draft a thoughtful ~150-word personalized cold email tailored to this student's background."
        ),
        user_prompt=f"Candidate Profile:\n{profile}",
        evidence_text=evidence,
        response_model=FacultyOutreachResult,
        task_name="Professor Matcher & Cold Email",
        estimated_tokens=2000,
    )
    if isinstance(data.get("cold_email"), dict):
        body = data["cold_email"].get("body", "")
        data["cold_email"]["word_count"] = len(str(body).split())
    return data


def run_research_proposal(profile: dict) -> dict:
    """Identify 3 ArXiv-grounded niche research trends and draft a ~500-word proposal."""
    interests = profile.get("research_interests") or [profile.get("target_program") or "Applied Computer Science"]
    topic_str = ", ".join(str(x) for x in interests) if isinstance(interests, list) else str(interests)

    queries = plan_search_queries(
        goal_instruction="Search recent ArXiv papers and cutting-edge niche research directions for this domain.",
        context_text=f"Topic: {topic_str}\nTarget program: {profile.get('target_program')}",
        task_name="Research Proposal",
        max_queries=2,
    )
    lookups = [(q, search_arxiv) for q in queries]
    lookups.append((f"{topic_str} recent survey research challenges 2025 2026", search_internet))
    evidence = gather_cached_evidence(lookups)

    return synthesize_from_evidence(
        system_prompt=(
            "You are a PhD research advisor. Based on the student's background and the provided ArXiv/web evidence:\n"
            "1) Identify 3 highly specific niche research sub-domains (NOT broad labels like 'Machine Learning').\n"
            "2) Author a realistic, ~500-word literature-backed academic research proposal with title, introduction, "
            "3 concrete objectives, literature gap, methodology, expected contributions, and a 3-to-4 phase timeline."
        ),
        user_prompt=f"Candidate Profile:\n{profile}",
        evidence_text=evidence,
        response_model=ResearchProposalResult,
        task_name="Research Proposal Studio",
        estimated_tokens=2200,
    )
