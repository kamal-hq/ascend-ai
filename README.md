# Ascend AI: Career & Scholarship Studio (v3)

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

## Deploying Live (Vercel + Render / Railway)

Because FastAPI runs asynchronous background threads, SQLite (`data/ascend.db`, `data/cache.db`), and persistent SSE streams (which are incompatible with short-lived stateless Vercel Serverless functions), deploy using the standard split setup:

1. **Backend (`api/` + `worker/` + `agents/`) → [Render](https://render.com) or [Railway](https://railway.app):**
   * Root directory: `.` (uses included `render.yaml` / `Procfile`)
   * Build: `pip install -r requirements.txt`
   * Start: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
   * Env vars: `GROQ_API_KEY`, `CORS_ORIGIN_REGEX=https://.*\.vercel\.app` (or set `CORS_ORIGINS` to your exact Vercel domain)
2. **Frontend (`frontend/`) → [Vercel](https://vercel.com):**
   * Root directory: `frontend` (Framework: **Vite**, includes `frontend/vercel.json` SPA rewrites)
   * Env var: `VITE_API_BASE_URL=https://<your-backend-service>.onrender.com`

---

## Developed By

* **Muhammad Kamal**: Lead AI Architect & Product Strategist

---
*Disclaimer: Ascend AI is an AI advisory tool. Users are encouraged to verify all deadlines on official university and scholarship portals.*
