# Ascend AI — Engineering & Agentic Rules

Non-negotiable constraints for all contributors and AI coding agents working in this repository.

---

## 1. Layer Isolation Rules

1. **Frontend (`frontend/`)**: Talks strictly to FastAPI over HTTP/SSE. Never embeds API keys, business prompts, or local file paths.
2. **API Layer (`api/`)**: Handles HTTP validation, CORS, file parsing/export, SQLite reads, and enqueueing to `worker/queue.py`. Never runs LLM calls or blocking CrewAI crews inside request handlers.
3. **Worker Layer (`worker/`)**: Exclusively owns SQLite writes (`save_result`, `update_job_status`, capability status transitions) and calls into `agents/`.
4. **Agents Layer (`agents/`)**: Pure AI/retrieval logic. Never opens `ascend.db` or imports FastAPI/RQ.
5. **Configuration (`config.py`)**: Every path (`SQLITE_DB_PATH`, `CACHE_DB_PATH`, `SCHOLARSHIPS_JSON`, `SALARY_RANGES_JSON`) and every environment variable (`GROQ_API_KEY`, `REDIS_URL`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`) MUST live in `config.py`. Never call `os.getenv()` or hardcode relative `data/...` paths inside feature modules.

---

## 2. LLM & Groq Quota Rules

1. **LiteLLM Routing Prefix**: Every Groq model string MUST use the `groq/` prefix (e.g., `groq/openai/gpt-oss-20b`, `groq/openai/gpt-oss-120b`). Bare `openai/...` routes to OpenAI and fails with `401`.
2. **Do Not Use Decommissioned Models**: `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` are decommissioned by Groq (June 2026). Never reintroduce them.
3. **Strict Model Pool Segregation**:
   - `groq/openai/gpt-oss-120b` is reserved **exclusively** for mandatory eager `profile` extraction so heavy on-demand usage never starves core intake.
   - `groq/openai/gpt-oss-20b` handles **all** on-demand capabilities.
4. **Unified Rate Limiting**:
   - ALL LLM calls (both direct LiteLLM structured calls via `safe_completion()` and CrewAI runs via `safe_kickoff()`) MUST pass through `_DualBucketLimiter` in `agents/common/kickoff.py`.
   - Never call `crew.kickoff()` or `litellm.completion()` raw in an agent module (including `profile_agent.py`).
5. **Token Conservation**:
   - Keep `reasoning_effort="low"` unless explicitly overridden for a justified task.
   - Truncate raw CV/LinkedIn text safely before profile extraction (`[:6000]` chars).
   - Provide accurate `estimated_tokens` to the rate limiter (higher for multi-turn ReAct tool loops, e.g., `4500`).
   - Do not re-run scholarship matching inside capabilities when `rag_matches` is already persisted for that `job_id` in `ascend.db`.

---

## 3. External Search & Caching Rules

1. **Search-Grounded Engine Rule**:
   - Capabilities that require **no external search** (`profile`, `sop_draft`, `sop_review`, `scholarship_analysis`, `career_paths`, `freelance_pack`, `academia_vs_industry`) use direct `safe_completion()` (LiteLLM + Pydantic JSON).
   - Capabilities requiring **external discovery** (`deadline_verification`, `faculty_outreach`, `research_proposal`, `learning_roadmap`, `local_ecosystem`) use `plan_search_queries` + `gather_cached_evidence` + `synthesize_from_evidence` (`agents/capabilities/helpers.py`) instead of brittle ReAct agent loops.
2. **Mandatory Search Caching**: Every external lookup (`search_internet`, `search_arxiv`, `search_youtube`, `scrape_website` in `agents/common/tools.py`) MUST check `result_cache.get(source, query)` in `agents/common/cache.py` before hitting the network, and never cache error responses.
3. **Never Fabricate External Facts**: Synthesis prompts must instruct the model to report `"Unconfirmed"` when live search/scrape evidence does not establish a date, URL, or professor fact.

---

## 4. API, Schema & Error Handling Rules

1. **Structured JSON Over Markdown Walls**: Capabilities return typed Pydantic JSON schemas (`agents/schemas.py`) so the Vite UI renders rich interactive cards, gauges, copyable blocks, and tables (never rely solely on unparsed regex-split Markdown tables for primary UI fields).
2. **Capability Failure Transparency**:
   - Never overwrite a failed capability with a cheerful fake success string like `"Matching Failed."` inside a `"completed"` result.
   - Persist capability status cleanly (`queued` → `running` → `completed` | `failed`) with an explicit `error` message so the frontend can offer a **Retry** button.
3. **Windows Compatibility**:
   - Never assume Unix `os.fork()` exists; RQ worker docs/scripts on Windows MUST specify `rq.SimpleWorker`.
   - Ensure UTF-8 encoding (`encoding="utf-8"`) on all file reads/writes and subprocess outputs.

---

## 5. Agentic Workflow & Code Quality Rules

1. **Follow `Phase-doc.md` Sequentially**: Do not jump ahead to Phase 3 UI code before Phase 1–2 backend contracts pass real end-to-end verification.
2. **Keep Memory Updated**: After any architectural change, bug root-cause discovery, or completed phase, update `memory.md` and mark progress in `Phase-doc.md`.
3. **Real Verification Only**: Never fake or mock away Redis/RQ/SQLite/FastAPI behavior to report a phase complete. Verify live endpoints, DB rows, and SSE streams after the final edit.
4. **No Clutter / Secret Leakage**: Never commit `.env`, `chroma_db/`, `data/*.db*`, `dump.rdb`, or ad-hoc `scratch_test.py` scripts. Keep `.env.example` synced when env vars change.
