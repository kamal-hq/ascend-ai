# Ascend AI: Career & Scholarship Studio (v3)

**Live App:** [ascend-ai-sandy.vercel.app](https://ascend-ai-sandy.vercel.app/)

Ascend AI is an async, modular AI platform that analyzes a student's CV (PDF) or background notes in seconds and unlocks **11 independent, on-demand career, scholarship, and research capabilities** streamed live into a Vite + React workspace.

## Architecture & Tech Stack

* **Frontend (`frontend/`):** Vite + React 19 + TypeScript + Tailwind CSS v4 (designed from Figma Make)
* **API Gateway (`api/`):** FastAPI + SSE (`sse-starlette`) + PDF CV parsing (`pdfplumber`) + `.docx` Word export (`python-docx`)
* **Job Queue & Workers (`worker/`):** Redis + RQ (`rq.SimpleWorker` on Windows) with automatic built-in background-thread fallback when Redis/RQ is not running
* **Hybrid AI Engine (`agents/`):** Pooled direct Groq HTTP + Pydantic JSON calls (`safe_completion()`) and search-grounded cached synthesis (`data/cache.db`, 7-day SQLite TTL across DuckDuckGo, ArXiv, YouTube, and portal scraping)
* **Groq Model Segregation:** `groq/openai/gpt-oss-120b` dedicated to mandatory Eager Profile extraction; `groq/openai/gpt-oss-20b` dedicated to all 11 on-demand capabilities
* **Retrieval & State (`data/`):** Instant BM25/domain scholarship ranker over 371 curated scholarships (`data/scholarships.json`) + SQLite WAL (`data/ascend.db`)

---

## Local Setup & Running (v3)

### 1. Python Backend Environment
```bash
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate # macOS/Linux
pip install -r requirements.txt
```

Create `.env` from `.env.example`:
```text
GROQ_API_KEY=gsk_your_groq_key_here
REDIS_URL=redis://localhost:6379/0
```

### 2. Start Services

For **quickest local testing (2 terminals)**, FastAPI automatically executes jobs in background threads when no RQ worker is running:

**Terminal 1 — FastAPI Gateway:**
```powershell
.\venv\Scripts\python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Vite Frontend:**
```powershell
pnpm --dir frontend run dev
```

*(Optional)* For **dedicated Redis + RQ worker execution**, also start Redis and an RQ `SimpleWorker`:
```powershell
redis-server --port 6379
.\venv\Scripts\python -m rq.cli worker eager capabilities --worker-class rq.SimpleWorker --url redis://localhost:6379/0
```

Open `http://127.0.0.1:5173` in your browser.

---

## Key Capabilities

* **Eager Core (Auto-run):** Live USD→PKR rate, Profile Strength Score (`0–100`), 3 Priority Gaps, 6-Month Roadmap, and Top-5 RAG-matched Scholarships.
* **Study Abroad & Research:** `sop_draft`, `sop_review` (25-pt rubric), `scholarship_analysis`, `deadline_verification`, `faculty_outreach`, `research_proposal`.
* **Career & Freelance:** `career_paths` (PKR benchmarks), `learning_roadmap` (12-week YouTube syllabus), `freelance_pack`, `academia_vs_industry`.
* **Local Ecosystem:** `local_ecosystem` (Pakistani incubators, Ignite/HEC grants, developer communities).

---

## Deploying Free ($0/mo: Vercel Hobby + Render Free)

Ascend AI is tuned for **100% free-tier hosting** with zero paid databases or Redis add-ons:
- **Wake-up pre-flight popup:** When a user lands, the frontend runs live `GET /health?warmup=true` retries until the sleeping Render free container wakes up (~25–50s on cold start), warms `data/scholarships.json` (`371` awards) and SQLite, and reports system readiness.
- **Auto-seeded demo & browser-synced workspaces:** Each visitor gets an isolated workspace (`X-Client-Id`) synced with browser `localStorage` (`Save backup` / `Import` `.json`). When Render wakes after idle, the browser automatically restores saved sessions back to SQLite (`POST /jobs/restore`), and brand-new visitors start with an isolated `Sara Ahmed` showcase (`0` Groq tokens burned).

1. **Backend (`api/` + `worker/` + `agents/`) → [Render Free Tier](https://render.com) (`plan: free`):**
   * Use **Blueprint** ([render.yaml](render.yaml)) or **New Web Service** (`Python 3`, root directory `.`)
   * Build: `pip install -r requirements.txt`
   * Start: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
   * Env vars: `GROQ_API_KEY`, `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`, `PYTHON_VERSION=3.12.3`
2. **Frontend (`frontend/`) → [Vercel Hobby (Free)](https://vercel.com):**
   * Root directory: `frontend` (Framework: **Vite**, includes `frontend/vercel.json` SPA rewrites)
   * Env var: `VITE_API_BASE_URL=https://<your-render-service>.onrender.com` (set before build)

---

## Privacy & Local-First Data Storage

* **Saved automatically on your device:** Your CV analyses, profile scores, scholarship matches, and generated SOPs/roadmaps are automatically stored inside **your browser's `localStorage`** under an isolated workspace ID (`X-Client-Id`) — not in a permanent shared multi-user database.
* **Temporary backend compute & transparent re-sync:** The free-tier backend keeps active sessions in temporary SQLite only during live processing (and resets on container sleep/redeploy). When you revisit — or trigger a new capability after idle sleep — the frontend automatically restores your saved JSON snapshots back into the backend for seamless continuation.
* **External LLM & search calls:** Text submitted for analysis is sent to Groq solely to generate your structured response; public search queries (`DuckDuckGo`, `ArXiv`, `YouTube`) use a shared 7-day result cache.
* **User control & portability:** Delete individual sessions (or clear local browser history) anytime, or use **Save backup** / **Import** (`.json`) in the sidebar to move your workspace across browsers or devices.

---

## Developed By

* **Muhammad Kamal**: Lead AI Architect & Product Strategist

---
*Disclaimer: Ascend AI is an AI advisory tool. Users are encouraged to verify all deadlines on official university and scholarship portals.*
