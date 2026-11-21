export type CapabilityName =
  | "sop_draft"
  | "sop_review"
  | "scholarship_analysis"
  | "deadline_verification"
  | "faculty_outreach"
  | "research_proposal"
  | "career_paths"
  | "learning_roadmap"
  | "freelance_pack"
  | "academia_vs_industry"
  | "local_ecosystem";

export type CapabilityStatus = "not_started" | "queued" | "running" | "completed" | "failed";

export interface GapItem {
  title: string;
  detail: string;
  severity: "HIGH IMPACT" | "REQUIRED" | "MEDIUM";
}

export interface RoadmapStep {
  timeframe: string;
  title: string;
  detail: string;
}

export interface ProfileResult {
  name: string;
  degree: string;
  university: string;
  cgpa: string;
  graduation_year: string;
  summary?: string;
  research_interests: string[];
  work_experience: string[];
  extracurriculars: string[];
  target_country: string[];
  target_program: string;
  target_scholarships: string[];
  career_goal: string;
  key_strengths: string[];
  special_skills: string[];
  is_research_track: boolean;
  profile_strength_score: number;
  strength_label?: string;
  gap_analysis: string;
  gap_items?: GapItem[];
  improvement_roadmap: string[];
  roadmap_steps?: RoadmapStep[];
}

export interface RagScholarshipMatch {
  rank: number;
  name: string;
  country: string;
  country_code?: string;
  fields: string;
  gpa_min: string;
  deadline_month: string;
  deadline_month_num?: number;
  deadline_bucket?: string;
  bond: string;
  url: string;
  note: string;
  match_score?: number;
  similarity_match?: string;
}

export type ScholarshipTrackerStatus =
  | "not_started"
  | "shortlisted"
  | "working"
  | "applied"
  | "awarded"
  | "skipped";

export interface TrackerScholarshipEntry {
  status: ScholarshipTrackerStatus;
  comment: string;
  updated_at?: string;
}

export interface TrackerTaskItem {
  id: string;
  title: string;
  timeframe: string;
  scholarship_name: string;
  done: boolean;
  created_at?: string;
}

export interface TrackerState {
  scholarships: Record<string, TrackerScholarshipEntry>;
  tasks: TrackerTaskItem[];
  roadmap_checked: number[];
}

export interface RankedScholarshipsResponse {
  job_id: string;
  total: number;
  scholarships: RagScholarshipMatch[];
}

export interface ContextResult {
  live_rate: number;
}

export interface RagMatchesResult {
  matches: RagScholarshipMatch[];
}

export interface SopDraftResult {
  title: string;
  target_context: string;
  word_count: number;
  paragraphs: string[];
  key_themes: string[];
  full_text: string;
}

export interface RubricCriterion {
  name: string;
  score: number;
  max_score: number;
  comment: string;
}

export interface RevisionTip {
  title: string;
  action: string;
  example_fix: string;
}

export interface SopReviewResult {
  total_score: number;
  max_score: number;
  summary: string;
  criteria: RubricCriterion[];
  revision_tips: RevisionTip[];
}

export interface ScholarshipFitItem {
  rank: number;
  scholarship_name: string;
  country: string;
  eligibility_status: "Eligible" | "Conditional" | "Ineligible";
  fit_rationale: string;
  stipend_pkr_estimate: string;
  matched_requirements: string[];
  missing_gaps: string[];
  next_action: string;
}

export interface ScholarshipAnalysisResult {
  overall_summary: string;
  exchange_rate_used: number;
  analyses: ScholarshipFitItem[];
}

export interface DeadlineVerificationItem {
  scholarship_name: string;
  verified_deadline: string;
  cycle_status: "Open" | "Upcoming" | "Closed" | "Unconfirmed";
  source_snippet: string;
  source_url: string;
  checked_note: string;
}

export interface DeadlineVerificationResult {
  summary: string;
  verifications: DeadlineVerificationItem[];
}

export interface ProfessorMatch {
  name: string;
  university: string;
  department: string;
  lab_name: string;
  research_focus: string;
  relevance_to_student: string;
}

export interface ColdEmailDraft {
  subject: string;
  body: string;
  word_count: number;
}

export interface FacultyOutreachResult {
  professors: ProfessorMatch[];
  cold_email: ColdEmailDraft;
}

export interface ResearchTrendItem {
  domain: string;
  explanation: string;
  relevance: string;
}

export interface ProposalTimelinePhase {
  phase: string;
  duration: string;
  milestone: string;
}

export interface ResearchProposalResult {
  trends: ResearchTrendItem[];
  title: string;
  introduction: string;
  objectives: string[];
  literature_gap: string;
  methodology: string;
  expected_contributions: string[];
  timeline: ProposalTimelinePhase[];
}

export interface CareerRoleItem {
  title: string;
  match_reason: string;
  entry_pkr_monthly: string;
  required_skills: string[];
  skill_gaps: string[];
  demand_outlook: string;
}

export interface CareerPathsResult {
  summary: string;
  roles: CareerRoleItem[];
}

export interface LearningWeekItem {
  week_number: number;
  topic: string;
  milestone: string;
  video_title: string;
  video_url: string;
  duration_hours_est: string;
}

export interface LearningRoadmapResult {
  target_field: string;
  skill_level: string;
  weeks: LearningWeekItem[];
}

export interface FiverrGigItem {
  title: string;
  starting_price_pkr: string;
  deliverables: string[];
}

export interface PortfolioProject {
  title: string;
  problem_statement: string;
  tech_stack: string[];
  milestones: string[];
}

export interface FreelancePackResult {
  upwork_bio: string;
  upwork_bio_word_count: number;
  fiverr_gigs: FiverrGigItem[];
  portfolio_project: PortfolioProject;
}

export interface UniversityPick {
  name: string;
  country: string;
  program: string;
  why_fit: string;
}

export interface AcademiaVsIndustryResult {
  verdict: "Industry First" | "Research / PhD Track" | "Hybrid";
  analysis_summary: string;
  academia_pros_cons: string;
  industry_pros_cons: string;
  recommended_universities: UniversityPick[];
}

export interface EcosystemIncubator {
  name: string;
  city: string;
  why_fit: string;
  url: string;
}

export interface EcosystemGrant {
  name: string;
  provider: string;
  funding_focus: string;
  url: string;
}

export interface EcosystemCommunity {
  name: string;
  platform_or_city: string;
  focus: string;
  url: string;
}

export interface LocalEcosystemResult {
  summary: string;
  incubators: EcosystemIncubator[];
  grants: EcosystemGrant[];
  communities: EcosystemCommunity[];
}

export interface CapabilityStateInfo {
  status: string;
  error_message?: string | null;
  completed_at: string;
}

export interface JobRevisionInfo {
  job_id: string;
  version: number;
  score: number | null;
  student_name: string;
  target_program: string;
  created_at: string;
}

export interface JobSummary {
  job_id: string;
  thread_id?: string;
  version?: number;
  status: "pending" | "running" | "completed" | "failed";
  student_name: string;
  target_program: string;
  score: number | null;
  input_preview: string;
  created_at: string;
  updated_at: string;
}

export interface JobStatusResponse {
  job_id: string;
  thread_id?: string;
  version?: number;
  source_text?: string;
  status: "pending" | "running" | "completed" | "failed";
  student_name: string;
  target_program: string;
  score: number | null;
  created_at: string;
  updated_at: string;
  revisions?: JobRevisionInfo[];
  results: {
    context?: ContextResult;
    profile?: ProfileResult;
    rag_matches?: RagMatchesResult;
    sop_draft?: SopDraftResult;
    sop_review?: SopReviewResult;
    scholarship_analysis?: ScholarshipAnalysisResult;
    deadline_verification?: DeadlineVerificationResult;
    faculty_outreach?: FacultyOutreachResult;
    research_proposal?: ResearchProposalResult;
    career_paths?: CareerPathsResult;
    learning_roadmap?: LearningRoadmapResult;
    freelance_pack?: FreelancePackResult;
    academia_vs_industry?: AcademiaVsIndustryResult;
    local_ecosystem?: LocalEcosystemResult;
    tracker?: TrackerState;
    [key: string]: unknown;
  };
  capability_states: Record<string, CapabilityStateInfo>;
}

export interface SystemChecks {
  api: boolean;
  database: boolean;
  scholarships_loaded: number;
  ai_configured: boolean;
  cache_ready: boolean;
}

export interface HealthResponse {
  status: string;
  redis: boolean;
  workers_active?: number;
  execution_mode?: "rq" | "async_threads";
  version: string;
  jobs_count?: number;
  checks?: SystemChecks;
}
