"""
Typed Pydantic V2 schemas for Eager Profile Intelligence and all 11 On-Demand Capabilities.

Every schema aligns directly with:
  - Backend structured LLM outputs (`safe_completion`) & tool normalization
  - FastAPI JSON payloads / OpenAPI contracts
  - `Design a Project UI` / Vite React component props (`design.md`)
"""

from typing import Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Phase 1: Eager Profile Intelligence
# ---------------------------------------------------------------------------

class GapItem(BaseModel):
    title: str = Field(..., description="Short actionable headline (5-8 words)")
    detail: str = Field(..., description="Concise explanation of why this gap matters")
    severity: Literal["HIGH IMPACT", "REQUIRED", "MEDIUM"] = "HIGH IMPACT"


class RoadmapStep(BaseModel):
    timeframe: str = Field(..., description="e.g., MONTH 1-2")
    title: str = Field(..., description="Actionable milestone headline")
    detail: str = Field(..., description="Concrete execution detail")


class ProfileResult(BaseModel):
    name: str = "Student"
    degree: str = ""
    university: str = ""
    cgpa: str = ""
    graduation_year: str = ""
    summary: str = Field("", description="2-sentence executive summary of the student's academic & career trajectory")
    research_interests: list[str] = Field(default_factory=list)
    work_experience: list[str] = Field(default_factory=list)
    extracurriculars: list[str] = Field(default_factory=list)
    target_country: list[str] = Field(default_factory=list)
    target_program: str = ""
    target_scholarships: list[str] = Field(default_factory=list)
    career_goal: str = ""
    key_strengths: list[str] = Field(default_factory=list)
    special_skills: list[str] = Field(default_factory=list)
    is_research_track: bool = False
    profile_strength_score: int = Field(50, ge=0, le=100)
    strength_label: str = Field("Needs Focus", description="Competitive | Strong | Developing | Needs Focus")
    gap_analysis: str = Field("", description="Candid narrative summarizing missing credentials")
    gap_items: list[GapItem] = Field(default_factory=list)
    improvement_roadmap: list[str] = Field(default_factory=list)
    roadmap_steps: list[RoadmapStep] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Study Abroad & Research Capabilities (6)
# ---------------------------------------------------------------------------

class SopDraftResult(BaseModel):
    title: str
    target_context: str
    word_count: int = 0
    paragraphs: list[str]
    key_themes: list[str] = Field(default_factory=list)
    full_text: str = ""


class RubricCriterion(BaseModel):
    name: str
    score: int
    max_score: int = 5
    comment: str


class RevisionTip(BaseModel):
    title: str
    action: str
    example_fix: str


class SopReviewResult(BaseModel):
    total_score: int
    max_score: int = 25
    summary: str
    criteria: list[RubricCriterion]
    revision_tips: list[RevisionTip]


class ScholarshipFitItem(BaseModel):
    rank: int
    scholarship_name: str
    country: str
    eligibility_status: Literal["Eligible", "Conditional", "Ineligible"]
    fit_rationale: str
    stipend_pkr_estimate: str
    matched_requirements: list[str] = Field(default_factory=list)
    missing_gaps: list[str] = Field(default_factory=list)
    next_action: str


class ScholarshipAnalysisResult(BaseModel):
    overall_summary: str
    exchange_rate_used: float
    analyses: list[ScholarshipFitItem]


class DeadlineVerificationItem(BaseModel):
    scholarship_name: str
    verified_deadline: str
    cycle_status: Literal["Open", "Upcoming", "Closed", "Unconfirmed"]
    source_snippet: str
    source_url: str = ""
    checked_note: str = ""


class DeadlineVerificationResult(BaseModel):
    summary: str
    verifications: list[DeadlineVerificationItem]


class ProfessorMatch(BaseModel):
    name: str
    university: str
    department: str = ""
    lab_name: str = ""
    research_focus: str
    relevance_to_student: str


class ColdEmailDraft(BaseModel):
    subject: str
    body: str
    word_count: int


class FacultyOutreachResult(BaseModel):
    professors: list[ProfessorMatch]
    cold_email: ColdEmailDraft


class ResearchTrendItem(BaseModel):
    domain: str
    explanation: str
    relevance: str


class ProposalTimelinePhase(BaseModel):
    phase: str
    duration: str
    milestone: str


class ResearchProposalResult(BaseModel):
    trends: list[ResearchTrendItem]
    title: str
    introduction: str
    objectives: list[str]
    literature_gap: str
    methodology: str
    expected_contributions: list[str]
    timeline: list[ProposalTimelinePhase]


# ---------------------------------------------------------------------------
# Career & Freelance Capabilities (4)
# ---------------------------------------------------------------------------

class CareerRoleItem(BaseModel):
    title: str
    match_reason: str
    entry_pkr_monthly: str
    required_skills: list[str] = Field(default_factory=list)
    skill_gaps: list[str] = Field(default_factory=list)
    demand_outlook: str = "High"


class CareerPathsResult(BaseModel):
    summary: str
    roles: list[CareerRoleItem]


class LearningWeekItem(BaseModel):
    week_number: int
    topic: str
    milestone: str
    video_title: str
    video_url: str
    duration_hours_est: str = "4-6 hrs"


class LearningRoadmapResult(BaseModel):
    target_field: str
    skill_level: str
    weeks: list[LearningWeekItem]


class FiverrGigItem(BaseModel):
    title: str
    starting_price_pkr: str
    deliverables: list[str] = Field(default_factory=list)


class PortfolioProject(BaseModel):
    title: str
    problem_statement: str
    tech_stack: list[str] = Field(default_factory=list)
    milestones: list[str] = Field(default_factory=list)


class FreelancePackResult(BaseModel):
    upwork_bio: str
    upwork_bio_word_count: int
    fiverr_gigs: list[FiverrGigItem]
    portfolio_project: PortfolioProject


class UniversityPick(BaseModel):
    name: str
    country: str
    program: str
    why_fit: str


class AcademiaVsIndustryResult(BaseModel):
    verdict: Literal["Industry First", "Research / PhD Track", "Hybrid"]
    analysis_summary: str
    academia_pros_cons: str
    industry_pros_cons: str
    recommended_universities: list[UniversityPick]


# ---------------------------------------------------------------------------
# Local Ecosystem Capability (1)
# ---------------------------------------------------------------------------

class EcosystemIncubator(BaseModel):
    name: str
    city: str
    why_fit: str
    url: str = ""


class EcosystemGrant(BaseModel):
    name: str
    provider: str
    funding_focus: str
    url: str = ""


class EcosystemCommunity(BaseModel):
    name: str
    platform_or_city: str
    focus: str
    url: str = ""


class LocalEcosystemResult(BaseModel):
    summary: str
    incubators: list[EcosystemIncubator]
    grants: list[EcosystemGrant]
    communities: list[EcosystemCommunity]
