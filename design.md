# Ascend AI — UI/UX System & Figma Design Context Pack

This document serves two purposes:
1. **Figma Pro Context Pack** — everything needed to design the Ascend AI v3 experience cleanly in Figma without guessing flows, states, or API data fields.
2. **Vite Implementation Spec** — exact design tokens, layouts, and API payload bindings for the React + TypeScript + Tailwind SPA (`frontend/`).

---

## 1. Product Vision & UX Shift

- **What we are replacing:** A cluttered vertical Streamlit form that hid behind a 15–20 minute spinner and dumped 8 walls of unstyled Markdown into tabs.
- **What we are building:** **Ascend AI Career & Scholarship Studio** — an editorial, crisp, modular workspace designed around **progressive disclosure**:
  1. **Instant Intake & Triage (5–10s)**: Student drops CV/notes/LinkedIn → immediately receives a structured Profile Scorecard, Gap Analysis, 6-Month Roadmap, and Top-5 Matched Scholarships.
  2. **On-Demand AI Studio**: Every downstream tool (SOP writer, Rubric grader, Live Deadline Auditor, Professor Cold-Emailer, 12-Week YouTube Syllabus, Freelance Kit, Local Pakistani Ecosystem) lives as an **independent modular action card** that the user clicks when needed, watches stream live, copies/exports cleanly, or retries independently.

---

## 2. Design Direction & Aesthetic Tokens

*(Suggested direction for Figma — feel free to refine visually while preserving contrast and semantic token roles.)*

- **Visual Personality:** Crisp academic-tech editorial workspace (think **Linear + Perplexity + Notion** warmth — calm light canvas, high-contrast typography, sharp hairline borders, zero generic neon gradients).
- **Color Tokens (Light Mode Primary):**
  - `bg.canvas`: `#F8FAFC` (app background)
  - `bg.surface`: `#FFFFFF` (cards, drawers, panels)
  - `bg.subtle`: `#F1F5F9` (muted chips, code/email preview blocks, table headers)
  - `border.hairline`: `#E2E8F0`
  - `text.primary`: `#0F172A`
  - `text.secondary`: `#475569`
  - `text.muted`: `#94A3B8`
  - `brand.primary`: `#1E3A8A` (deep academic indigo-navy for primary CTAs & active states)
  - `brand.accent`: `#0D9488` (emerald-teal for verified badges, completion states, live currency/matches)
  - `status.success`: `#15803D` / `#DCFCE7` (Eligible, Passed, Completed)
  - `status.warning`: `#B45309` / `#FEF3C7` (Needs Improvement, Queued/Waiting, Partial Match)
  - `status.danger`: `#B91C1C` / `#FEE2E2` (Gap Alert, Ineligible, Failed/Retry)
- **Typography:**
  - Headings / UI: **Plus Jakarta Sans** or **Inter** (600–700 weight, tight tracking)
  - Long-form SOP / Proposal Preview: **Source Serif 4** or clean readable sans (`16px`, `1.65` line-height) so generated essays feel publication-ready
  - Metrics / Scores / Dates / PKR: **JetBrains Mono** or `tabular-nums`
- **Spacing & Radii:**
  - 8px grid (`8, 12, 16, 24, 32px`), card radius `12px`, pill/badge radius `999px`, `1px solid #E2E8F0` borders over heavy drop shadows.

---

## 3. Global App Shell & Navigation

### Layout Structure (Desktop 1440px)
- **Left Sidebar (`260px`, collapsible on tablet/mobile)**:
  - Brand header: **Ascend AI** logo + version badge
  - Primary CTA button: **`+ New Analysis`** (returns to Intake Studio)
  - **Session History List** (`GET /jobs`): Past profiles showing Student Name, Target Program, Score badge, relative timestamp, status dot (`completed`, `running`, `failed`)
  - Bottom System Footer: Live **USD → PKR** pill (e.g., `1 USD = Rs. 276.30`) + subtle API/Worker health indicator dot.
- **Top Sticky Header (`64px`)**:
  - Active Student context breadcrumb (e.g., `Muhammad Kamal · MS Data Science · USA, Germany`)
  - Primary Workspace Mode Tabs (visible once eager phase completes):
    1. **Overview** (Profile Intelligence + Matched Scholarships)
    2. **Study Abroad & Research** (6 on-demand capabilities)
    3. **Career & Freelance** (4 on-demand capabilities)
    4. **Local Ecosystem** (1 on-demand capability + action tips)
- **Main Content Canvas (`max-width: 1120px`, generous padding)**

---

## 4. Screen-by-Screen & Component Specs (Mapped to API Contracts)

### Screen A — Onboarding & Profile Intake (`New Session`)
**Purpose:** Collect clean student background quickly with zero intimidation.
- **Header:** Headline + concise 1-line subtitle explaining the 5–10 second instant profile analysis.
- **Input Method Switcher (2 clean tabs inside one card):**
  1. **Write or paste** *(Default)*: Large multi-line textarea + **`✨ Load sample profile`** quick-fill button.
  2. **Upload CV (PDF)**: Drag-and-drop PDF dropzone (`POST /inputs/parse-cv`). Shows filename + extracted character count; populates editable text preview so user verifies parsed CV text before submitting.
*(LinkedIn URL scraping removed due to LinkedIn authwall blocks.)*
- **Primary Action:** **`Analyze Profile & Match Scholarships →`** (`POST /jobs`)
- **Live Eager Progress State (immediately after submit, via SSE `GET /jobs/{id}/stream`):**
  - Compact 3-step live progress card replacing or overlaying the submit button:
    - Step 1: `Fetching live USD/PKR rate` (`context`)
    - Step 2: `Analyzing profile & gaps with AI` (`profile`)
    - Step 3: `Matching 370+ curated international scholarships` (`rag_matches`)
  - Transitions smoothly into **Overview Dashboard** as slices arrive (can render Profile immediately even 1s before RAG matches finish).

---

### Screen B — Overview Dashboard (`Profile Intelligence + Top Matches`)
Displays the 3 eager results (`context`, `profile`, `rag_matches`):

1. **Hero Profile Summary Banner**:
   - Fields from `profile`: `name`, `degree`, `university`, `cgpa`, `graduation_year`, `target_program`, `target_country[]`, `target_scholarships[]`, `is_research_track` pill (`Research Track` vs `Coursework / Industry`), `career_goal`.
   - **Radial / Circular Gauge**: `profile_strength_score` (`0–100`) with color band (`<60` Needs Work, `60–79` Competitive, `80+` Strong).
   - **Skill & Interest Chips**: `key_strengths[]`, `special_skills[]`, `research_interests[]`, plus expandable raw details drawer (`work_experience[]`, `extracurriculars[]`).
2. **2-Column Diagnostic Split**:
   - **Left Card — Critical Gap Analysis** (`profile.gap_analysis`): Danger/amber callout styling highlighting concrete missing requirements.
   - **Right Card — 6-Month Improvement Roadmap** (`profile.improvement_roadmap[]`): Numbered interactive checklist of 3 actionable steps.
3. **Top-5 Matched Scholarships Grid/List (`rag_matches.matches[]`)**:
   - Each card displays:
     - `rank` badge (`#1`–`#5`), `name`, `country` badge
     - `similarity_match` chip
     - Key metadata row: `deadline_month`, `gpa_min`, `bond` tag (`No Bond` in green vs bond requirement in amber), `fields`
     - `note` summary + external `Official Portal ↗` (`url`) link button
   - Bottom banner CTA: *"Want deeper fit rationales, live deadline verification, or an SOP tailored to these scholarships?"* → navigates to **Study Abroad & Research Studio**.

---

### Screen C — On-Demand Capability Studio (Workspace Tabs 2, 3, 4)

#### Standard Capability Card Wrapper (Reusable Figma Component!)
Every one of the 11 capabilities shares ONE predictable card/panel shell with **5 clear visual states**:
1. **Idle (`not_started`)**: Title, 1-line value proposition, estimated speed badge (e.g., `~5s Fast AI` vs `~15s Web Search`), and **`Generate`** primary/outline button (`POST /jobs/{job_id}/capabilities/{name}`).
2. **Queued / Running (`queued` | `running`)**: Skeleton shimmer + live SSE status indicator (`Queued in worker...` / `Searching live web sources...`). Never blocks other cards on the screen!
3. **Completed (`completed`)**: Structured content body + top-right toolbar: **`Copy`**, **`Download .docx`** (where applicable), **`Regenerate`** icon button, and timestamp.
4. **Dependency Hint (when applicable)**: e.g., `sop_review` allows scoring either the generated `sop_draft` OR user-pasted SOP text in an editable drawer.
5. **Failed (`failed`)**: Clean inline error banner showing `error_message` (e.g., rate limit or search timeout) + **`Retry`** button.

#### Tab 2: Study Abroad & Research (6 Capabilities)
1. **`sop_draft` — Statement of Purpose Architect** *(Fast AI)*
   - Renders: `title`, `target_program_context`, `word_count` badge, formatted `paragraphs[]` in readable serif typography, `key_themes_highlighted[]`, plus **`Download SOP (.docx)`** (`POST /export/docx`) & **`Edit & Score SOP`** CTA.
2. **`sop_review` — Admissions Rubric Evaluator** *(Fast AI)*
   - Renders: Big `total_score` / `max_score` (`21 / 25`) badge, horizontal score bars per `criteria[]` (`name`, `score`, `max_score`, `comment`), and numbered `revision_tips[]` (`title`, `action`, `example_fix`).
   - Also supports pasting/editing custom SOP text before clicking `Score SOP`.
3. **`scholarship_analysis` — Deep Scholarship Fit & Gap Matrix** *(Fast AI)*
   - Renders per matched scholarship (`analyses[]`): `scholarship_name`, `eligibility_status` pill (`Eligible` | `Conditional` | `Ineligible`), `fit_rationale`, `stipend_pkr_estimate` (converted via `live_rate`), `matched_requirements[]`, `missing_gaps[]`, `next_action`.
   - Plus `overall_summary` callout.
4. **`deadline_verification` — Live Official Deadline Auditor** *(Web Search + Cache)*
   - Renders table/cards (`verifications[]`): `scholarship_name`, `verified_deadline`, `cycle_status` (`Open` | `Upcoming` | `Closed` | `Unconfirmed`), `source_snippet`, `source_url`, `checked_at` timestamp.
5. **`faculty_outreach` — Professor Matcher & Cold Email** *(Web Search + ArXiv + Cache)*
   - Renders 2 Professor Profile Cards (`professors[]`): `name`, `university`, `department`, `lab_name`, `research_focus`, `relevance_to_student`.
   - Plus **Cold Email Composer Card** (`cold_email`: `subject`, `body`, `word_count`) with one-click **`Copy Subject & Body`**.
6. **`research_proposal` — Literature-Backed Research Proposal** *(ArXiv + Cache)*
   - Renders:
     - **3 Hot Research Sub-Domains** (`trends[]`: `domain`, `explanation`, `relevance`)
     - **Proposal Document View** (`proposal`: `title`, `introduction`, `objectives[]`, `literature_gap`, `methodology`, `expected_contributions[]`, `timeline[]`) + **`Download Proposal (.docx)`**.

#### Tab 3: Career & Freelance (4 Capabilities)
7. **`career_paths` — Digital Career Mapper** *(Fast AI + Salary JSON)*
   - Renders 5 Role Cards (`roles[]`): `title`, `match_reason`, `entry_pkr_monthly` (highlighted monospace range from `salary_ranges.json` benchmarks), `required_skills[]`, `skill_gaps[]`, `demand_outlook`.
8. **`learning_roadmap` — 12-Week YouTube Syllabus** *(YouTube Search + Cache)*
   - Renders interactive **Week 1–12 Timeline / Accordion** (`weeks[]`): `week_number`, `topic`, `milestone`, `video_title`, `video_url` (clickable YouTube card/link), `duration_hours_est`.
9. **`freelance_pack` — Upwork & Fiverr Launchpad** *(Fast AI)*
   - Renders 3 sub-blocks:
     - **Upwork Bio Card** (`upwork_bio`, copy button, word count)
     - **3 Fiverr Gig Cards** (`fiverr_gigs[]`: `title`, `starting_price_pkr`, `deliverables[]`)
     - **14-Day Portfolio Sprint** (`portfolio_project`: `title`, `problem_statement`, `tech_stack[]`, `day_by_day_milestones[]`).
10. **`academia_vs_industry` — PhD vs Industry Strategist** *(Fast AI)*
    - Renders: Verdict badge (`Industry First` | `Research / PhD Track` | `Hybrid`), `analysis_summary`, Side-by-Side **Pros / Opportunity Cost Comparison**, and 2 **Recommended Universities** (`recommended_universities[]`: `name`, `country`, `program`, `why_fit`).

#### Tab 4: Local Ecosystem (1 Capability)
11. **`local_ecosystem` — Pakistan Startup, Grant & Community Hub** *(Web Search + Cache)*
    - Renders 3 clean sections:
      - **Incubators & Accelerators (2)** (`incubators[]`: `name`, `city`, `why_fit`, `url`)
      - **Funding Grants (1+)** (`grants[]`: `name`, `provider`, `funding_focus`, `url`)
      - **Active Tech Communities** (`communities[]`: `name`, `platform_or_city`, `focus`, `url`).

---

## 5. Responsive Breakpoints & Edge States for Figma Frames

Prepare Figma frames across:
1. **Desktop (`1440 × 900`)**: Persistent 260px sidebar + 2-column grids for cards.
2. **Mobile (`375 × 812`)**: Drawer sidebar, stacked cards, sticky bottom or top action bar.
3. **Required States to Mock in Figma**:
   - Empty state (first-time visitor before creating a job)
   - Intake CV parsed + LinkedIn Authwall error state
   - Eager Phase live loading stepper
   - Mixed Capability Studio (e.g., 2 cards Completed, 1 Running SSE shimmer, 1 Idle, 1 Failed with Retry button).
