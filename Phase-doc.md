# Ascend AI — Phased Implementation Plan

Sequential roadmap from initial v2 baseline to shipped v3 product (Atomic Hybrid Backend + Vite SPA from Figma design).

---

## Phase 0 — Documentation Infrastructure & Repo Baseline
**Goal:** Standardize project docs and capture a clean checkpoint before refactoring.

- [x] Remove Kinza Irshad from `README.md` contributor section
- [x] Align on v3 decisions (Atomic capabilities, Hybrid AI engine, Figma → Vite UI, local SQLite/Redis + cached zero-key search)
- [x] Create/update core docs in root: `architecture.md`, `rules.md`, `design.md`, `memory.md`, `Phase-doc.md`
- [x] Inspect user's Figma Make export (`Design a Project UI/`) and verify 1:1 capability alignment
- [x] Update `.gitignore` for runtime DBs, logs, `dump.rdb`, `scratch_test.py`, and Vite build outputs

---

## Phase 1 — Backend Core Cleanup & Hybrid Capability Engine
**Goal:** Replace slow coarse `module_a/b/c` bundles with fast, structured, cached atomic capabilities.

- [x] **Config Consolidation**: Updated `config.py` (`SALARY_RANGES_JSON`, `CORS_ORIGINS`, `ALLOWED_CAPABILITIES`, `MODEL_*`, `LITELLM_LOCAL_MODEL_COST_MAP`); updated `agents/rag_matcher.py` and `ingest.py` to import paths from `config.py` + calibrated L2→percentage `match_score` + `country_code`
- [x] **Unified Rate Limiter (`agents/common/kickoff.py`)**: Extracted shared `_DualBucketLimiter` + `_sleep_on_rate_limit()` powering `safe_completion()` (direct LiteLLM + Pydantic JSON + `json_validate_failed` fallback recovery) and `safe_kickoff()`
- [x] **Cached Tool Layer (`agents/common/tools.py`)**: Unified DuckDuckGo (with `lite` backend fallback), ArXiv (with jitter), YouTubeSearchTool, and BeautifulSoup scraper wrapped in `result_cache` (7-day TTL in `data/cache.db`)
- [x] **Typed Schemas (`agents/schemas.py`)**: Defined Pydantic V2 output models for Eager Profile (`ProfileResult`) and all 11 on-demand capabilities matching `Design a Project UI`
- [x] **Refactor Eager Profile (`agents/profile_agent.py`)**: Switched to `safe_completion()` (`groq/openai/gpt-oss-120b`) with structured Pydantic output + explicit error surfacing
- [x] **Build 11 Atomic Capabilities (`agents/capabilities/`)**:
  - *Direct LiteLLM + Pydantic (`20b`)*: `sop_draft` (first-person voice), `sop_review`, `scholarship_analysis`, `career_paths` (`salary_ranges.json`), `freelance_pack`, `academia_vs_industry`
  - *Search-Grounded Structured Synthesis (`20b` + `cache.db`)*: `deadline_verification`, `faculty_outreach`, `research_proposal`, `learning_roadmap`, `local_ecosystem`

---

## Phase 2 — FastAPI v3, Worker Queue, Intake/Export & Live Backend Verification
**Goal:** Expose the full atomic API surface required by the Figma/Vite frontend and verify live end-to-end execution.

- [x] **Upgrade `data/db.py`**: Added automatic SQLite schema migration, per-capability status tracking (`queued | running | completed | failed`), `error_message`, and job display metadata (`student_name`, `target_program`, `score`, `input_preview`)
- [x] **Worker Layer (`worker/capabilities.py`, `worker/queue.py`, `worker/eager.py`)**: Dotted-path RQ enqueueing (zero ML imports in web process) + atomic capability execution
- [x] **API Endpoints (`api/routes/jobs.py`, `api/routes/utilities.py`)**: Job lifecycle, capability triggers, `POST /inputs/parse-cv`, `POST /inputs/scrape-linkedin`, `POST /export/docx`
- [x] **SSE & CORS (`api/sse.py`, `api/main.py`)**: Enabled `CORSMiddleware`, `/health`, and per-capability SSE status transitions
- [x] **Live Backend Smoke Verification**: Executed Redis + `rq.SimpleWorker` + `uvicorn` + Groq + ChromaDB end-to-end

---

## Phase 3 — Figma Design Integration & Vite Frontend Build
**Goal:** Convert `Design a Project UI/` into `frontend/` Vite + React + TypeScript + Tailwind SPA wired 1:1 to FastAPI & SSE.

- [x] **Scaffold `frontend/`**: Built clean Vite 8 + React 19 + TypeScript 5.9 + Tailwind v4 app preserving Figma Make design tokens (`DM Serif Display` + `Manrope`)
- [x] **API & SSE Client (`frontend/src/api/client.ts`, `frontend/src/types/api.ts`)**: Typed TypeScript interfaces mirroring `agents/schemas.py`, REST helpers, DOCX blob export, and `EventSource` live hooks
- [x] **Wire Interactive Views (`frontend/src/components/`)**: `Sidebar.tsx`, `IntakeView.tsx` (Notes/Demo, PDF upload, LinkedIn fetch, live Eager SSE stepper), `OverviewView.tsx`, `StudioView.tsx`, `CapabilityModal.tsx` (structured drawers for all 11 capabilities)
- [x] **Verify Frontend Build & Typecheck**: `pnpm --dir frontend run typecheck` & `pnpm --dir frontend run build` clean (0 TS errors, `dist/` built in 542ms)

---

## Phase 4 — Full-Stack QA, Legacy Retirement & Docs Sync
**Goal:** Verify full-stack operation and sync documentation & dependencies.

- [x] Run live full-stack E2E verification across Vite UI (`:4173`), FastAPI CORS (`:8010`), RQ `SimpleWorker`, Redis (`:6379`), SQLite, and all 11 atomic capabilities
- [x] Update `requirements.txt` (removed unused `streamlit`, `crewai`, `litellm`, `chromadb`, `sentence-transformers`, `numpy`)
- [x] Merge `Scholarship Guide Book.xlsx` into `data/scholarships.json` (`371` deduplicated scholarships, `301` verified portal URLs) & expand country-code matching
- [x] Configure deployment (`frontend/vercel.json`, `CORS_ORIGIN_REGEX`, `render.yaml`, `Procfile`)
- [x] Retire legacy files (`app.py`, `ingest.py`, `agents/module_a/b/c.py`, `worker/modules.py`, `utils/key_manager.py`, temp logs/scripts) and sync docs (`README.md`, `architecture.md`, `rules.md`, `memory.md`, `Phase-doc.md`)
