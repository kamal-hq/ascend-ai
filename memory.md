# Ascend AI — Project Memory & Engineering Log

Living record of project history, architectural decisions, verified bugs/quirks, and current repo snapshot. Update after major findings or completed phases.

---

## 1. Timeline & Architecture Evolution

1. **v1 (Committed `HEAD` at `4059a41`) — Streamlit Monolith (`app.py`)**:
   - Single blocking Streamlit script calling `extract_profile` → `run_module_a` → `sleep(12)` → `run_module_b` → `sleep(12)` → `run_module_c`.
   - Took ~15–20 minutes end-to-end, frequently hit Groq rate limits, lost session state on refresh.
2. **v2 (Uncommitted work from Aug 2026) — FastAPI + Redis/RQ + SQLite**:
   - Built async backend separation: `config.py`, `data/db.py`, `api/` (REST + SSE), `worker/` (`eager.py`, `modules.py`, `queue.py`), `agents/common/kickoff.py` (dual RPM+TPM token bucket), `agents/common/cache.py`.
   - Intended HTMX + Jinja2 frontend (`api/templates/`), never implemented.
   - Verified `eager` + `module_a` end-to-end against live Redis/RQ/FastAPI/SQLite (`22` completed eager jobs, `9` `module_a` runs in `data/ascend.db`), while `module_b` and `module_c` remained unverified under v2.
3. **v3 (Active Redesign from `2026-11-18`) — Atomic Capabilities + Hybrid Engine + Figma/Vite SPA**:
   - User returned to modernize infrastructure with 5 standardized docs (`architecture.md`, `rules.md`, `design.md`, `memory.md`, `Phase-doc.md`).
   - Removed former contributor Kinza Irshad from `README.md`.
   - Agreed architectural pivot:
     - **Granular On-Demand Capabilities (~11 atomic triggers)** replacing `module_a`/`b`/`c` mega-bundles.
     - **Hybrid Engine**: Direct LiteLLM + Pydantic JSON for non-tool tasks; CrewAI + 7-day cached tools for live web/ArXiv/YouTube/scraping.
     - **Frontend**: Design in **Figma Pro** first from `design.md`, then implement **Vite + React + TypeScript + Tailwind** SPA.
     - **Scope**: Single-user local tool (SQLite WAL + Redis), DuckDuckGo/ArXiv/YouTube + `cache.db`.

---

## 2. Verified Technical Quirks & Resolved Bugs (Do Not Re-Introduce)

- **Groq Deprecated Models (June 2026)**: `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` are decommissioned. Replaced with `openai/gpt-oss-20b` and `openai/gpt-oss-120b`.
- **LiteLLM Routing Prefix Bug**: Bare `"openai/gpt-oss-20b"` routes to OpenAI (`401`). Must always prefix with `groq/` → `groq/openai/gpt-oss-20b` and `groq/openai/gpt-oss-120b`.
- **Groq Free-Tier Quota Mechanics**:
  - Both `gpt-oss-20b` and `gpt-oss-120b` have `30 RPM`, `1,000 RPD`, `8,000 TPM`, `200,000 TPD` **per model** (separate quota pools!).
  - Keeping `profile_agent` on `120b` and on-demand capabilities on `20b` prevents optional clicks from starving mandatory profile extraction.
  - `reasoning_effort="low"` prevents excessive hidden reasoning tokens on `gpt-oss` models.
  - Groq TPM `retry-after` gives the minimum wait for ~1 token (`1m33.744s` / `12.5s`), so `kickoff.py` parses minutes+seconds and applies a 25-second replenishment floor for TPM 429s.
- **CrewAI Tool-Calling Quirks (Verified Aug 2026)**:
  - **Tool Name Parity**: Mismatched names (`brave_search` vs `internet_search_tool`) caused `module_a` tool loops to fail or ask clarifying questions.
  - **Empty Completions**: `"invalid response from llm"` / `"none or empty"` are transient Groq failures and belong in `_RATE_LIMIT_SIGNALS` (backoff retry), NOT `_ITERATION_LIMIT_SIGNALS`.
  - **`tool_choice="none"` at `max_iter`**: `gpt-oss` sometimes emits a tool call when CrewAI forces final answer at `max_iter`. `safe_kickoff()` retries once (`tool_choice_retries < 1`) then raises cleanly.
  - **`gap_task` Missing Profile Bug**: `module_a.py` previously passed only `schol_raw` without the `profile` dict to `gap_task`, causing the agent to complain it lacked GPA/citizenship info. Fixed to inject full `profile`.
- **Windows RQ Constraint**: RQ requires `rq.SimpleWorker` on Windows because `os.fork()` does not exist (`python -m rq.cli worker eager modules --worker-class rq.SimpleWorker --url redis://localhost:6379/0`).

---

## 3. Resolved Debt in v3

- `agents/common/cache.py` (`result_cache`) is active across all external search/scrape tools (`7-day` TTL in `data/cache.db`).
- `data/salary_ranges.json` is wired into `agents/capabilities/career.py` (`career_paths`).
- `config.py` owns all paths, models, and env vars (`CORS_ORIGINS`, `CORS_ORIGIN_REGEX`, `GROQ_API_KEY`, `REDIS_URL`).
- Legacy v1/v2 artifacts (`app.py`, `ingest.py`, `agents/module_a/b/c.py`, `worker/modules.py`, `utils/key_manager.py`, `chroma_db/`, `scratch_test.py`, `dump.rdb`, test logs) were retired prior to GitHub release.

---

## 4. Active Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| `2026-08` | Separate `120b` (Profile) vs `20b` (On-Demand) | Preserves independent 1,000 RPD / 200k TPD Groq pools |
| `2026-11-18` | Replace `module_a/b/c` with ~11 atomic capabilities | Eliminates multi-minute blocking & wasted LLM tokens |
| `2026-11-18` | Hybrid Engine (`safe_completion` JSON + search-grounded synthesis) | Live profiling showed direct LiteLLM takes 1.4–5.7s vs CrewAI ReAct 120s+ hang (`telemetry.crewai.com` 30s timeout & `Invalid response from LLM call`) |
| `2026-11-18` | Dotted string RQ paths + lazy RAG imports | Prevented 15s `litellm`/`torch` import stalls inside FastAPI `POST /jobs` HTTP handler |
| `2026-11-18` | Figma Pro design (`Design a Project UI/`) → `frontend/` Vite SPA | Built full `frontend/` SPA wired to FastAPI REST, SSE, CV PDF parse, and DOCX export; `vite build` + full-stack E2E verified across all 11 capabilities |
| `2026-11-18` | Direct Groq HTTP + 3ms BM25 matcher + RQ/Thread fallback | Eliminated 21s `litellm` import + 40s PyTorch/ChromaDB cold load + stuck jobs when RQ worker offline; removed LinkedIn URL intake due to authwall blocks; added `DELETE /jobs/{id}` |
| `2026-11-18` | `safe_completion` `json_validate_failed` recovery | Added automatic fallback retry without `response_format=json_object` if Groq's strict server-side JSON validator rejects output; avoided duplicate `full_text` output tokens in `SopDraftResult` |
| `2026-11-18` | Remove Kinza Irshad from `README.md` | Requested cleanup upon project reboot |
| `2026-11-18` | Merge `Scholarship Guide Book.xlsx` → `371` scholarships | Consolidated curated sheets (excluding personal checklists), normalized serial dates/bonds, preserved 301 verified URLs, expanded `_COUNTRY_CODES` |
| `2026-11-18` | Split deploy: Vercel (`frontend/`) + Render/Railway (`api/`) | Vercel hosts static Vite SPA (`frontend/vercel.json`); FastAPI background threads + SQLite + SSE run persistently on Render (`render.yaml`) / Railway (`Procfile`) with `CORS_ORIGIN_REGEX` |
