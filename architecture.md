# Ascend AI — Architecture (v3)

> Transitioning from a single-shot blocking Streamlit script (`app.py`) and coarse multi-agent bundles (`module_a/b/c`) to an **atomic, on-demand capability platform** powered by FastAPI, Redis + RQ, a Hybrid AI Engine, and a Vite + React SPA.

---

## 1. High-Level System Layers

```text
Frontend (Vite + React + TypeScript + Tailwind)
    │  REST + File Upload/Export + SSE (EventSource)
    ▼
API Gateway (FastAPI — CORS enabled, Swagger/OpenAPI)
    │  Enqueues jobs; reads SQLite state & streams SSE updates
    ▼
Job Queue (Redis + RQ: `eager` & `capabilities` queues)
    │  Windows local dev uses `rq.SimpleWorker`
    ▼
Worker Layer (`worker/eager.py`, `worker/capabilities.py`)
    │  Owns orchestration, error persistence, and SQLite writes
    ▼
Hybrid AI & Retrieval Engine
    ├─ Direct Groq HTTP + Pydantic (`safe_completion()` pooled session, ~2s)
    ├─ Search-Grounded Synthesis (cached DuckDuckGo/ArXiv/YouTube + `safe_completion`)
    └─ Instant Scholarship Ranker (<5ms domain BM25 over 371 curated awards)
    │
    ▼
Persistence Layer (SQLite WAL `data/ascend.db` + 7-day search cache `data/cache.db`)
```

**Strict Boundary Rule:** Each layer talks only to its neighbor. The frontend never calls LLMs or SQLite directly; FastAPI never runs CrewAI/LiteLLM inline; AI modules never write to `ascend.db` directly (workers own persistence).

---

## 2. Two-Phase Execution Model: Progressive Disclosure

### Phase 1 — Eager Core (Auto-runs on submit, target ~5–10s)
When a user submits text (from raw notes or parsed CV PDF) via `POST /jobs`:
1. **Exchange Rate Context (`context`)**: Fetches live USD→PKR rate (with fallback `278.5`).
2. **Profile Intelligence (`profile`)**: Extracts structured demographics, academic background, `profile_strength_score` (0–100), candid `gap_analysis`, and a 3-step `improvement_roadmap` using **`groq/openai/gpt-oss-120b`**.
3. **Scholarship Matching (`rag_matches`)**: Ranks `data/scholarships.json` (371 curated awards) using domain-weighted BM25/TF-IDF + country/GPA affinity in `<5ms` and returns top-5 structured matches.

The frontend opens an SSE stream (`GET /jobs/{job_id}/stream`) and renders each slice (`context` → `profile` → `rag_matches`) the instant it lands in SQLite. Nothing else runs automatically.

### Phase 2 — Atomic On-Demand Capabilities (Click-triggered only)
Instead of forcing the user to wait for a 15–20 minute monolithic run or an 8-agent `module_a` bundle, every user-facing feature is an independent capability triggered via `POST /jobs/{job_id}/capabilities/{capability_name}`:

| Group | Capability Slug | Engine | Model | Primary Dependencies / Inputs | External Tools / Grounding |
|---|---|---|---|---|---|
| **Study Abroad & Research** | `sop_draft` | LiteLLM + Pydantic | `gpt-oss-20b` | `profile` | Optional custom target angle |
| **Study Abroad & Research** | `sop_review` | LiteLLM + Pydantic | `gpt-oss-20b` | `sop_draft` (or custom SOP text) | Scoring rubric (out of 25) + 3 tips |
| **Study Abroad & Research** | `scholarship_analysis` | LiteLLM + Pydantic | `gpt-oss-20b` | `profile`, `rag_matches`, `context.live_rate` | Fit rationale + PKR + gap matrix |
| **Study Abroad & Research** | `deadline_verification` | Search-Grounded + Cache | `gpt-oss-20b` | `rag_matches` (top 3) | DuckDuckGo + portal scrape |
| **Study Abroad & Research** | `faculty_outreach` | Search-Grounded + Cache | `gpt-oss-20b` | `profile` (`research_interests` / `target_program`) | DuckDuckGo + ArXiv |
| **Study Abroad & Research** | `research_proposal` | Search-Grounded + Cache | `gpt-oss-20b` | `profile` (`research_interests` / `target_program`) | ArXiv + DuckDuckGo |
| **Career & Freelance** | `career_paths` | LiteLLM + Pydantic | `gpt-oss-20b` | `profile` | Grounded with `data/salary_ranges.json` |
| **Career & Freelance** | `learning_roadmap` | Search-Grounded + Cache | `gpt-oss-20b` | `profile` (`target_program`, `work_experience`) | YouTube search |
| **Career & Freelance** | `freelance_pack` | LiteLLM + Pydantic | `gpt-oss-20b` | `profile` (+ optional `career_paths`) | Upwork bio + 3 Fiverr gigs + 14d project |
| **Career & Freelance** | `academia_vs_industry` | LiteLLM + Pydantic | `gpt-oss-20b` | `profile` | Candid tradeoff + 2 uni picks |
| **Local Ecosystem** | `local_ecosystem` | Search-Grounded + Cache | `gpt-oss-20b` | `profile` | DuckDuckGo (PK incubators/grants) |

**Optional Convenience Behavior:** Users can trigger one card at a time, or click a UI group action (e.g., "Run Study Abroad Essentials") which simply dispatches parallel/queued capability requests cleanly without locking the UI.

---

## 3. Hybrid AI Engine & Quota Management

### Model Pool Segregation (Groq Free-Tier Protection)
Groq enforces per-model quotas on its free tier (`openai/gpt-oss-20b` and `openai/gpt-oss-120b` maintain **independent** RPD/TPD pools):

| Pool | Model String (LiteLLM) | RPM | RPD | TPM | TPD | Owned Workloads |
|---|---|---|---|---|---|---|
| **Mandatory Eager Pool** | `groq/openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 | `profile` extraction only |
| **On-Demand Pool** | `groq/openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 | All 11 on-demand capabilities |

- Every LLM call—whether `safe_completion()` (direct LiteLLM) or `safe_kickoff()` (CrewAI)—passes through the shared `_DualBucketLimiter` in `agents/common/kickoff.py` and uses `reasoning_effort="low"` to prevent hidden chain-of-thought token blowups.
- `Retry-After` parsing (`XmYYs` and seconds) applies a 25-second minimum replenishment floor on TPM 429s so multi-turn ReAct loops recover cleanly.

### External Search & Scraping Cache (`agents/common/cache.py`)
- DuckDuckGo, ArXiv, YouTubeSearchTool, and BeautifulSoup web scraping run behind a **7-day TTL SQLite cache (`data/cache.db`)** keyed by `(source, sha256(query))`.
- Optional Tavily / Brave Search API keys can be plugged into the search tool adapter via `config.py` without changing capability prompts.

---

## 4. API Surface (FastAPI Gateway)

### Core Job & Capability Lifecycle (`/jobs`)
- `POST /jobs` — Create job + enqueue eager core (`context`, `profile`, `rag_matches`) on RQ or local async fallback if no RQ worker active. Returns `{job_id, status}`.
- `GET /jobs` — List past sessions/jobs (paginated, newest first, including student name/program summary for the sidebar).
- `GET /jobs/{job_id}` — Snapshot of job status + all capability states and payloads.
- `DELETE /jobs/{job_id}` — Delete a saved session and cascade its results.
- `POST /jobs/{job_id}/capabilities/{capability_name}` — Queue an atomic capability (returns `202` with status `"queued"`, supports optional payload overrides such as custom `sop_text` for `sop_review`).
- `GET /jobs/{job_id}/stream` — Job-wide SSE stream emitting `status` / `result` / `capability_status` events.
- `GET /jobs/{job_id}/capabilities/{capability_name}/stream` — Single-capability SSE stream.

### Intake & Export Utilities
- `POST /inputs/parse-cv` — Accepts PDF upload (`pdfplumber`), returns extracted plain text for user review before `POST /jobs`.
- `POST /export/docx` — Converts SOP, Research Proposal, or Profile Report content into a downloadable `.docx` file (`python-docx`).

---

## 5. Persistence & State Schema (`data/db.py`)

`data/ascend.db` uses SQLite WAL mode:
- **`jobs`**: `id` (PK), `status` (`pending | running | completed | failed`), `input_preview`, `created_at`, `updated_at`.
- **`results`**: `id`, `job_id` (FK), `module_name` (capability slug, e.g., `profile`, `rag_matches`, `sop_draft`), `status` (`queued | running | completed | failed`), `payload` (JSON string matching structured Pydantic schemas), `error_message` (nullable), `completed_at`, `UNIQUE(job_id, module_name)`.

*(Migration note: `module_name` column name may be retained or aliased cleanly for backward compatibility with existing DB rows while storing capability slugs.)*

---

## 6. Target Directory Structure

```text
ascend-ai/
├── architecture.md               # This file (system architecture)
├── rules.md                      # Engineering & agentic guardrails
├── design.md                     # UI/UX system + Figma Pro Design Context Pack
├── memory.md                     # Living engineering memory & decision log
├── Phase-doc.md                  # Phased implementation roadmap
├── config.py                     # Centralized env vars & absolute paths
├── requirements.txt              # Python backend dependencies
├── render.yaml                   # Render Web Service deploy blueprint
├── Procfile                      # Process start command (Render/Railway)
├── README.md                     # Setup & deployment guide
├── api/
│   ├── main.py                   # FastAPI factory, CORSMiddleware, routers
│   ├── sse.py                    # Job & per-capability SSE event generators
│   └── routes/
│       ├── jobs.py               # /jobs & /capabilities endpoints
│       └── utilities.py          # /inputs/parse-cv & /export/docx
├── worker/
│   ├── queue.py                  # Redis + RQ queue + automatic daemon-thread fallback
│   ├── eager.py                  # Phase 1: context + profile + rag_matches
│   └── capabilities.py           # Phase 2: atomic on-demand capability runner
├── agents/
│   ├── common/
│   │   ├── kickoff.py            # Pooled Groq HTTP client, dual-bucket limiter, safe_completion
│   │   ├── cache.py              # 7-day TTL search cache (cache.db)
│   │   └── tools.py              # Cached search, ArXiv, YouTube, scraper tools
│   ├── schemas.py                # Pydantic output models for all capabilities
│   ├── profile_agent.py          # Eager profile extractor (120b)
│   ├── rag_matcher.py            # Instant BM25/domain scholarship ranker
│   └── capabilities/             # Modular capability implementations
├── data/
│   ├── db.py                     # SQLite WAL models & helpers
│   ├── scholarships.json         # 371 curated international scholarships
│   ├── salary_ranges.json        # Digital career PKR salary benchmarks
│   ├── ascend.db                 # Runtime job/result SQLite DB (gitignored)
│   └── cache.db                  # External tool 7-day cache (gitignored)
└── frontend/                     # Vite + React + TypeScript + Tailwind SPA + vercel.json
```
