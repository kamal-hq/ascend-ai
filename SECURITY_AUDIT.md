# Security & Compliance Audit Report — Ascend AI (v3)

- **Audit Date:** 2026-11-27
- **Audited Branch:** `security-compliance-audit` (branched from `main` at `84d9c8f`; `main` untouched; not pushed)
- **Repository Scope:** Current working directory (`ascend-ai`) only
- **Owner Contact:** `muhammad.kamal.hq@gmail.com`

---

## 1. Executive Summary

- **Pre-Audit Risk Rating:** **High** (unauthenticated SSE cross-client data exposure via optional `client_id`, unguarded SSRF on LLM/search-fed portal scraper, unthrottled Groq LLM / PDF endpoints, permissive wildcard `*.vercel.app` CORS with credentials, raw exception/client-ID logging, and missing compliance disclosures/headers).
- **Post-Audit Risk Rating:** **Low–Moderate** (all confirmed high-severity backend/frontend vulnerabilities fixed and regression-tested; remaining moderate items are intentionally deferred for owner approval — primarily tightening `CORS_ORIGIN_REGEX` and deciding whether to add real accounts later).

### Top 5 Things You Must Do Now
1. **Review & merge `security-compliance-audit` into `main`**, then deploy both Vercel (frontend CSP + self-hosted `Lexend` + Privacy/Terms pages) and Render (SSE isolation, SSRF defense, rate limits, Groq daily cap, PDF bounds, log redaction).
2. **Approve & apply tightened CORS** (see [proposals/cors_tightening.md](proposals/cors_tightening.md)): replace `CORS_ORIGIN_REGEX=https://.*\.vercel\.app` + `allow_credentials=True` with your exact Vercel production URL (`https://ascend-ai-sandy.vercel.app`) plus localhost dev origins and `allow_credentials=False`.
3. **Verify Render environment variables** after merging: confirm `TRUSTED_PROXY_HOPS=1` (matches Render's single ingress proxy hop) and set `GROQ_DAILY_CALL_LIMIT` (defaults to `500` calls/UTC day) to match your free-tier Groq quota comfort level.
4. **Add a root `LICENSE` file** (e.g., MIT or Apache-2.0) to clarify repository reuse rights alongside third-party open-source attributions.
5. **Periodically review `duckduckgo-search==6.2.13`** in `requirements.txt` (kept pinned intentionally to avoid breaking live search behavior) and plan an upgrade test in staging.

---

## 2. Feature Map & Phase Execution Summary

| Feature | Present? | Evidence |
|---|---|---|
| User login (email/password, OAuth, other) | **No** | Zero authentication or cookies; browser-local random `X-Client-Id` bearer ID (`api/demo.py`, `frontend/src/lib/workspaceStore.ts`) |
| Supabase or other database | **Yes (Own Ephemeral SQLite)** | `data/ascend.db` (`jobs`, `results` in `data/db.py`) and `data/cache.db` (`search_cache` in `agents/common/cache.py`). Not Supabase; not shared. |
| File storage / uploads | **Yes (In-memory only)** | `POST /inputs/parse-cv` (`pdfplumber` in-memory PDF parse) and `POST /export/docx` (`python-docx` streaming export) in `api/routes/utilities.py`. No storage buckets. |
| Server-side API routes / functions | **Yes** | FastAPI REST & SSE routes in `api/main.py`, `api/routes/jobs.py`, `api/sse.py`, `api/routes/utilities.py`. |
| Scraping / fetching external sites | **Yes** | `scrape_website()` in `agents/common/tools.py` used by `deadline_verification` (`agents/capabilities/study_abroad.py:143-158`). |
| Third-party APIs | **Yes** | Groq (`api.groq.com`), Open ExchangeRate (`open.er-api.com`), DuckDuckGo, ArXiv, YouTube search. Google Fonts CDN **removed** (now self-hosted `@fontsource/lexend`). |
| Payments | **No** | No billing or payment SDKs. |
| Analytics / non-essential cookies | **No** | Zero analytics libraries and zero cookies; browser `localStorage` only. |
| User-generated content | **Yes** | Profile notes, PDF CV text, custom SOP text/notes, scholarship tracker comments/tasks, JSON workspace import. |

### Phase Applicability

| Phase | Status | Reason / Adaptation |
|---|---|---|
| **Phase 0 — Recon** | **Ran** | Mapped stack, endpoints, third parties, and personal data flows; recorded build & API smoke baseline. |
| **Phase 1 — Secrets & Env Vars** | **Ran** | Scanned working tree + full git history + client bundle; expanded `.gitignore`; refreshed `.env.example`. **Zero leaked secrets found.** |
| **Phase 2 — Auth & Sessions** | **Skipped** | No user login, OAuth, or session cookies exist. `X-Client-Id` bearer isolation & SSE enforcement audited in Phases 3–4. |
| **Phase 3 — Database** | **Ran (Adapted for SQLite)** | Audited `data/db.py` and `data/cache.db` for SQL safety, multi-client isolation, restore hijacking, and cache PII hygiene. *(Supabase/RLS skipped: not present.)* |
| **Phase 4 — Application Security** | **Ran** | Audited dependencies, security headers & CSP, CORS (proposal only), SSRF/redirects/size limits, prompt injection boundaries, PDF/payload validation, rate limits, Groq circuit breaker, log redaction, and frontend URL XSS. |
| **Phase 5 — Compliance Pages** | **Ran (Adapted)** | Built real in-app Privacy Policy & Terms of Service pages (`/privacy`, `/terms`), footer/intake links, Groq intake notice, self-hosted Lexend font, in-app deletion, and attribution check. *(Cookie banner & Google OAuth consent screen skipped: neither exists.)* |
| **Phase 6 — Verify** | **Ran** | Re-ran frontend `tsc + vite build`, `pnpm audit`, CSS audit, notification unit tests, URL sanitizer tests, 7-test backend security & smoke suite, and zero-placeholder grep. |

---

## 3. Findings Table

### Confirmed Issues

| ID | Severity | Location | Issue | Status | How to Verify |
|---|---|---|---|---|---|
| **F-01** | **High** | `api/sse.py:32-35`, `api/sse.py:90-101`, `api/demo.py:25-35` | **SSE `client_id` bypass & fallback to `"default"`**: omitting `?client_id=` set `cid=None`, letting any caller stream another visitor's job results; invalid/missing `X-Client-Id` silently fell back to a shared `"default"` bucket. | **Fixed** (`cef428c`) | Run `.\venv\Scripts\python -m unittest tests/test_security.py -v` (`test_sse_client_id_bypass_regression_and_isolation`) — missing/invalid/mismatched `client_id` returns `404` on all job & SSE routes; `/health` still returns `200` with `jobs_count=0`. |
| **F-02** | **High** | `agents/common/tools.py:72-83` (pre-fix) | **SSRF & unbounded response in `scrape_website()`**: fetched arbitrary URLs from search/match outputs with `requests.get()` allowing redirects, internal/cloud metadata IPs (`169.254.169.254`, `127.0.0.1`, RFC1918, IPv6 equivalents), non-HTTP schemes, proxy env inheritance, and unbounded download sizes. | **Fixed** (`e36ba0f`) | Run `test_scraper_ssrf_and_redirect_defense` — confirms `http`/`https` only, ports 80/443 only, DNS public-IP validation on initial URL and every redirect hop (max 3), `trust_env=False`, 512 KB streaming cap, 4-slot concurrency semaphore. |
| **F-03** | **High** | `api/routes/jobs.py`, `api/routes/utilities.py`, `agents/common/kickoff.py` | **No rate limiting or global Groq spend cap**: unthrottled job creation, PDF parsing, DOCX export, and Groq API calls could exhaust free-tier Groq quota or OOM the Render container. | **Fixed** (`c37e78c`) | Run `test_rate_limits_and_groq_circuit_breaker` — enforces `20/hr` job creation, `10/hr` CV parse, `20/hr` DOCX export, `60/hr` capability triggers, `30/hr` restores (per IP via `TRUSTED_PROXY_HOPS=1` AND per `client_id`) returning `429` + `Retry-After`, plus `500`/UTC-day global Groq cap and 5-error circuit breaker. |
| **F-04** | **Medium** | `config.py:29-59`, `api/main.py:42-49`, `render.yaml:14-17` | **Wildcard `*.vercel.app` CORS with `allow_credentials=True`**: previously matched any third-party Vercel app; approved and tightened to `https://ascend-ai-sandy.vercel.app` + narrow Ascend preview regex `^https://ascend-ai(?:-[a-z0-9-]+)?\.vercel\.app$` + localhost, with `allow_credentials=False` and explicit methods/headers. | **Fixed** *(approved)* | Run `tests/test_regression_live.py -k test_01` — confirms Ascend production, Ascend preview, and localhost succeed (with no `Allow-Credentials`) while `https://unrelated-attacker.vercel.app` is rejected. Remember to update Render Dashboard `CORS_ORIGIN_REGEX` if manually overridden there. |
| **F-05** | **Medium** | `api/routes/utilities.py:29-66` (pre-fix) | **PDF upload validation gaps**: checked only `.pdf` filename extension (no `%PDF-` magic bytes), buffered full body into RAM before checking 10 MB cap, and lacked page-count or extracted-text length caps against decompression/text-bomb PDFs. | **Fixed** (`c37e78c`) | Run `test_pdf_upload_hardening_and_payload_bounds` — verifies 64 KB chunked read (`413` > 10 MB), `%PDF-` signature check (`422`), 25-page cap (`422`), and 50,000-char extraction cap. |
| **F-06** | **Medium** | `frontend/src/components/CapabilityModal.tsx`, `OverviewView.tsx`, `TrackerView.tsx` | **Unsanitized dynamic `<a href>` links from LLM/external data**: rendered external/LLM-produced URLs directly into `href` without enforcing `http:`/`https:` protocol (potential `javascript:` XSS). | **Fixed** (`e36ba0f`) | Run `safeUrl.ts` check — `toSafeHttpUrl()` allows only `http:`/`https:` and blocks `javascript:`, `data:`, `vbscript:`. |
| **F-07** | **Medium** | `agents/capabilities/helpers.py:63-86` (pre-fix) | **Weak prompt-injection boundary for untrusted web text**: scraped HTML and search snippets were concatenated directly under a plain heading without explicit untrusted-data delimiters. | **Fixed** (`e36ba0f`) | Run `test_prompt_evidence_delimiting` — wraps external evidence in `<untrusted_external_evidence>` tags, neutralizes nested closing tags, and adds an explicit system security boundary. |
| **F-08** | **Medium** | `api/demo.py:80,83`, `agents/common/cache.py:121-141`, `agents/common/tools.py:40`, `api/routes/jobs.py:214,442`, `api/routes/utilities.py:66` (pre-fix) | **Sensitive logging, raw cache queries, and internal error leaks**: server logs recorded `client_id` prefixes, raw search queries, filenames, and raw exceptions; `cache.db` persisted `query_raw`; API returned raw `Queue error: {exc}` / PDF parser exception strings. | **Fixed** (`cef428c`, `5700b9f`) | Run `test_logs_and_shared_cache_hygiene` — confirms `client_id` is never logged, `cache.db` stores `query_raw=""` (SHA-256 hash key only), emails/phones are scrubbed before search, secrets in Groq errors are `[REDACTED]`, and API returns safe generic errors. |
| **F-09** | **Medium** | `frontend/vercel.json`, `api/main.py` | **Missing security headers & CSP; external Google Fonts CDN**: no CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`; frontend fetched `Lexend` from `fonts.googleapis.com`. | **Fixed** (`c37e78c`, `a01914c`) | Inspect `frontend/vercel.json`, `api/main.py:55-65`, and `dist/assets/lexend-*.woff2`; run `test_smoke_workflow_and_security_headers` and font-CDN grep (`FONT_CDN_REFS: []`). |
| **F-10** | **Medium** | `data/db.py:337-344`, `frontend/src/lib/workspaceStore.ts:8-27` | **Cross-client `thread_id` collision on restore & 64-bit client ID / `"default"` fallback**: `restore_job_snapshot` did not verify `thread_id` ownership against other clients; `workspaceStore.ts` truncated UUIDs to 64 bits and fell back to `"default"` if `localStorage` threw. | **Fixed** (`cef428c`) | Run `test_sse_client_id_bypass_regression_and_isolation` (checks cross-client `thread_id` isolation) and inspect `workspaceStore.ts` (full 128-bit UUIDv4 + unique in-memory ephemeral fallback). |
| **F-11** | **Low** | `frontend/src/components/LegalView.tsx`, `IntakeView.tsx`, `Sidebar.tsx` | **Missing compliance pages & Groq intake notice**: no standalone Privacy Policy or Terms of Service pages linked from footer/intake, and no explicit intake disclosure that CV/profile/SOP text (including CV contact details) is sent to Groq. | **Fixed** (`a01914c`) | Open `/privacy` and `/terms` (or click footer/intake links); verify Groq notice on Intake & Re-analyze views and in-app deletion button; confirm `muhammad.kamal.hq@gmail.com` appears throughout. |
| **F-12** | **Low** | `.gitignore:1-3`, `requirements.txt:9,22` | **Narrow `.env` ignore & old minimum dependency floors**: `.gitignore` ignored only `.env` (not `.env.local`/`.env.production`); `requirements.txt` permitted older vulnerable `requests>=2.31.0` and `python-multipart>=0.0.9`. | **Fixed** (`6000a16`) | Inspect `.gitignore` (`.env.*` + `!.env.example`, `*.pem`, `*.key`) and `requirements.txt` (`requests>=2.32.4`, `python-multipart>=0.0.18`). |
| **F-13** | **Info** | `config.py:41-42` | **Unused optional API key variables**: `TAVILY_API_KEY` and `BRAVE_API_KEY` are read from env in `config.py` but unused in runtime code (DuckDuckGo is used by default). | **Manual action** (Listed only; not removed) | Listed for inventory awareness only per audit instructions; no code removed. |
| **F-14** | **Info** | `LICENSE` | **Missing `LICENSE` file**: added MIT `LICENSE` (`Copyright (c) 2026 Muhammad Kamal`) in repo root alongside open-source attributions in Terms of Service. | **Fixed** *(approved)* | Inspect root `LICENSE` file. |

### Suspected / Architectural Notes (Not Bugs, Inherent to Free-Tier Zero-Auth Design)

| ID | Severity | Location | Note |
|---|---|---|---|
| **S-01** | **Moderate** | `frontend/src/lib/workspaceStore.ts`, `api/demo.py` | **No accounts / browser-held bearer ID**: `X-Client-Id` in `localStorage` is the sole boundary separating users. Anyone with physical access to the browser profile (or an XSS exploit, mitigated by React escaping + CSP + `toSafeHttpUrl`) could read local snapshots. Acceptable for a zero-login side project and disclosed plainly in the Privacy Policy. |
| **S-02** | **Low** | `agents/common/tools.py:44-101` | **Third-party scraping / search ToS risk**: `scrape_website()` fetches external scholarship portals, and `duckduckgo-search` / `youtube-search` rely on unofficial HTML/web endpoints rather than official paid APIs. Portal owners may block bots via `robots.txt` or ToS, and unofficial search libraries can break or rate-limit unexpectedly. Cached 7 days in `cache.db` with a 4-request concurrency cap to stay polite. |
| **S-03** | **Low** | `api/rate_limit.py`, `agents/common/kickoff.py` | **In-memory rate limits & daily Groq cap reset on Render container restart**: Because Render Free uses ephemeral single-instance memory without Redis, restarting the container resets hourly/daily counters. Still protects live running instances from sustained abuse bursts. |

### Exact Rate Limits & Quotas Implemented (`c37e78c`)

| Endpoint / Resource | Limit | Scope | Status Code / Header |
|---|---|---|---|
| `POST /jobs` | **20 requests / hour** | Per IP (`TRUSTED_PROXY_HOPS=1`) **and** per `X-Client-Id` | `429` + `Retry-After` |
| `POST /inputs/parse-cv` | **10 requests / hour** | Per IP **and** per `X-Client-Id` | `429` + `Retry-After` |
| `POST /export/docx` | **20 requests / hour** | Per IP **and** per `X-Client-Id` | `429` + `Retry-After` |
| `POST /jobs/{job_id}/capabilities/{cap}` | **60 requests / hour** | Per IP **and** per `X-Client-Id` | `429` + `Retry-After` |
| `POST /jobs/restore` | **30 requests / hour** | Per IP **and** per `X-Client-Id` | `429` + `Retry-After` |
| Global Groq LLM calls (`safe_completion`) | **500 calls / UTC day** (`GROQ_DAILY_CALL_LIMIT`) + **60s circuit breaker** after 5 consecutive upstream 401/403/5xx errors | Global across instance | Raises `GroqQuotaExceededError` → clean user error |

### Secrets & Dependency Audit Results
- **Working tree & full git history secret scan:** **0 secrets found** in tracked files or any historical commit diff; `.env` was never committed. Local `.env` contains only `GROQ_API_KEY` (server-side only, gitignored). **No key rotation is required.**
- **Client bundle check (`frontend/src/`):** Only public `VITE_API_BASE_URL` is referenced; zero server secrets exist in client code or `dist/`.
- **Frontend dependencies (`pnpm --dir frontend audit --json`):** **0 vulnerabilities** (`critical: 0, high: 0, moderate: 0, low: 0`) across 82 dependencies (including newly added `@fontsource/lexend@5.3.0`).
- **Python dependencies (`venv` + `requirements.txt`):** Local `venv` uses current patched versions (`fastapi 0.141.1`, `starlette 1.0.0`, `requests 2.33.1`, `python-multipart 0.0.27`, `pydantic 2.12.5`, `pdfplumber 0.11.9`); `requirements.txt` lower bounds raised to `requests>=2.32.4` and `python-multipart>=0.0.18`.

---

## 4. Commits Made on `security-compliance-audit`

| Commit | Summary |
|---|---|
| `6000a16` | `security: expand env gitignore, refresh .env.example, and raise patched dep floors` |
| `cef428c` | `security: require validated client_id on all job and SSE routes, stop logging client IDs` |
| `5700b9f` | `security: redact sensitive logs, scrub shared cache queries, and sanitize API errors` |
| `e36ba0f` | `security: harden scraper against SSRF, delimit untrusted LLM evidence, and sanitize frontend links` |
| `c37e78c` | `security: add rate limiting, Groq daily circuit breaker, PDF bounds, and API security headers` |
| `a01914c` | `compliance: self-host Lexend font, add CSP headers, Privacy/Terms pages, and Groq intake disclosure` |
| `390efbd` | `test: add security regression test suite and CORS tightening proposal` |
| *(this commit)* | `docs: add SECURITY_AUDIT.md audit report` |

---

## 5. Manual Actions For You (Dashboard & Rollout Steps)

1. **Key Rotations:** None required (full git history & client bundle are clean of leaked secrets).
2. **Merge & Deploy (GitHub → Vercel & Render):**
   - Review `git diff main..security-compliance-audit`.
   - Merge `security-compliance-audit` into `main` and push when ready.
   - Vercel will automatically rebuild `frontend/` with self-hosted `Lexend` and the new CSP/security headers from `frontend/vercel.json`.
   - Render will automatically redeploy the Python backend with SSE isolation, SSRF guards, PDF bounds, and rate limits.
3. **Render Dashboard — Optional Env Tuning:**
   - Open **Render Dashboard → `ascend-ai-api` → Environment**.
   - Confirm `TRUSTED_PROXY_HOPS` = `1` (default in code if omitted).
   - Optionally set `GROQ_DAILY_CALL_LIMIT` (default `500`) to cap daily free-tier Groq usage.
4. **Render Dashboard — Tighten CORS (When Approved):**
   - Follow [proposals/cors_tightening.md](proposals/cors_tightening.md):
     - Set `CORS_ORIGINS` = `https://ascend-ai-sandy.vercel.app,http://localhost:5173,http://127.0.0.1:5173`.
     - Remove `CORS_ORIGIN_REGEX` (or narrow it to `^https://ascend-ai(-[a-z0-9-]+)?\.vercel\.app$` if you need Vercel preview URLs).
     - Apply the proposed `allow_credentials=False` change in `api/main.py` and verify with the `curl` + browser smoke plan in the proposal.
5. **Groq Console Spend Guardrail:**
   - In **console.groq.com → Settings / Limits**, confirm your org stays on the free tier / hard usage cap so no surprise billing can occur even if the Render container restarts.
6. **Add Repository `LICENSE`:**
   - Add a `LICENSE` file in the repo root (e.g., MIT) via GitHub UI or locally.

---

## 6. Shared-Database Notes

- **Not applicable — no shared database exists.** Ascend AI uses its own ephemeral local SQLite files (`data/ascend.db` and `data/cache.db`) scoped exclusively to this Render container. No Supabase project, external PostgreSQL database, or cross-project tables/buckets are touched.

---

## 7. Items Deliberately Not Changed (Risk of Breaking Behavior)

1. **Live CORS configuration (`config.py:46`, `api/main.py:44-51`, `render.yaml:15`):** Left unchanged per audit rule (Addition 7) so preview URLs or custom Vercel aliases cannot break unexpectedly. Documented as a ready-to-apply proposal in [proposals/cors_tightening.md](proposals/cors_tightening.md).
2. **`duckduckgo-search==6.2.13` pin (`requirements.txt:6`):** Kept pinned because newer major versions (`8.x` / `ddgs`) changed import paths and backend options; upgrading blindly risks breaking live deadline/faculty/ecosystem search without live staging verification.
3. **Zero-account architecture (`X-Client-Id` instead of OAuth/passwords):** Kept intact per project design (zero paid auth/DB infrastructure).
4. **CSP `style-src 'self' 'unsafe-inline'` (`frontend/vercel.json`):** Kept `'unsafe-inline'` for styles only (never for `script-src`, which is strictly `'self'`) because React components use inline `style={{ width: ... }}` and CSS custom properties (`--score`) for progress bars and score rings.
5. **Unused `TAVILY_API_KEY` and `BRAVE_API_KEY` (`config.py:41-42`):** Kept intact per Addition 9 (listed only, nothing removed).

---

## 8. Remaining Risks & 30-Day Follow-Up Checklist

### Remaining Risks
- **Permissive `*.vercel.app` CORS** remains active until [proposals/cors_tightening.md](proposals/cors_tightening.md) is approved and deployed.
- **In-memory rate limits & daily Groq cap** reset whenever Render restarts the free-tier container.
- **Browser `localStorage` persistence** is vulnerable to user clearing site data (mitigated by clear Privacy Policy warning and `.json` backup/import).
- **DNS rebinding window** during `scrape_website()` (mitigated by pre-connect DNS validation on every hop, standard ports 80/443 only, and 4s connect timeout; full IP-pinned HTTPS SNI socket adapter can be added if the scraper ever accepts arbitrary user-entered URLs directly).

### 30-Day Follow-Up Plan
1. **Week 1:** Approve and roll out [proposals/cors_tightening.md](proposals/cors_tightening.md) on Render; run `curl` + DevTools verification on `https://ascend-ai-sandy.vercel.app`.
2. **Week 2:** Check Render runtime logs after live traffic to verify zero `client_id` / PII leakage and tune hourly rate-limit thresholds if real students hit `429`.
3. **Week 3:** Test upgrading `duckduckgo-search` in a staging branch and add a GitHub Actions CI workflow running `python -m unittest tests/test_security.py` and `pnpm --dir frontend run build` on every PR.
4. **Week 4:** Add a root `LICENSE` file and decide whether to keep the zero-account `localStorage` model or introduce optional passkey/magic-link sync if user volume grows.

---

## 9. Phase 6 Verification Summary (Post-Fix vs. Baseline)

| Check | Baseline | Post-Fix |
|---|---|---|
| Frontend `tsc --noEmit && vite build` | Passed (`30` modules, `606ms`) | **Passed** (`36` modules including self-hosted `lexend-*.woff2`, `467ms`) |
| `pnpm --dir frontend audit --json` | `0` vulnerabilities (`81` deps) | **0 vulnerabilities** (`82` deps) |
| External font CDN check (`fonts.googleapis.com` / `fonts.gstatic.com`) | Present in `index.css` | **0 references** (`FONT_CDN_REFS: []`) |
| CSS class coverage audit (`css_audit.py`) | `0` missing static classes | **0 missing static classes** (`293` CSS classes, `242` static tokens) |
| Backend security & smoke test suite (`tests/test_security.py`) | Reproduced SSE bypass (`EventSourceResponse` with no `client_id`) | **7 / 7 tests passed** (`0.539s`, SSE bypass now returns `404`) |
| Frontend notification & URL sanitizer tests | Passed | **Passed** (`ALL_NOTIFICATION_TESTS_PASSED`, `SAFE_URL_TESTS_OK`) |
| Placeholder email token check | N/A | **0 matches across repo** (all references use `muhammad.kamal.hq@gmail.com`) |
