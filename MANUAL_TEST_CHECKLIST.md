# Manual Pre-Merge Regression Checklist — `security-compliance-audit`

> **Purpose:** Verify zero functional regressions before merging `security-compliance-audit` into `main`.  
> **Scope:** Covers every user-facing feature, every modified security boundary, header enforcement mode by file, automated live verification results, and every user-noticeable behavior change relative to `main` (`84d9c8f`).

---

## 1. Commits on `security-compliance-audit` & What Each Touched

| Commit | Summary | Files Touched |
|---|---|---|
| `6000a16` | Expand env `.gitignore`, refresh `.env.example`, raise patched dep floors | `.gitignore`, `.env.example`, `requirements.txt` |
| `cef428c` | Require validated `client_id` on all job & SSE routes; stop logging client IDs; 128-bit browser ID; cross-client thread isolation | `api/demo.py`, `api/main.py`, `api/routes/jobs.py`, `api/sse.py`, `data/db.py`, `frontend/src/lib/workspaceStore.ts` |
| `5700b9f` | Redact sensitive logs, scrub shared `cache.db` queries (hash-only), sanitize API/worker error strings | `agents/capabilities/ecosystem.py`, `agents/common/cache.py`, `agents/common/kickoff.py`, `agents/common/tools.py`, `api/routes/jobs.py`, `api/routes/utilities.py`, `worker/capabilities.py`, `worker/eager.py` |
| `e36ba0f` | Harden `scrape_website` against SSRF/redirects/size abuse, delimit untrusted LLM evidence, sanitize frontend external links | `agents/capabilities/helpers.py`, `agents/common/tools.py`, `frontend/src/lib/safeUrl.ts`, `frontend/src/components/CapabilityModal.tsx`, `frontend/src/components/OverviewView.tsx`, `frontend/src/components/TrackerView.tsx` |
| `c37e78c` | Add per-IP & per-`client_id` hourly rate limits, Groq daily circuit breaker, PDF magic/page/char caps, payload bounds, FastAPI security headers, graceful DOCX error banners | `config.py`, `api/rate_limit.py`, `api/main.py`, `api/routes/jobs.py`, `api/routes/utilities.py`, `agents/common/kickoff.py`, `worker/capabilities.py`, `worker/eager.py`, `frontend/src/api/client.ts`, `frontend/src/components/OverviewView.tsx`, `frontend/src/components/CapabilityModal.tsx` |
| `a01914c` | Self-host `Lexend` (`@fontsource/lexend`), add enforced Vercel CSP & security headers, add `/privacy` & `/terms` pages, add Groq intake/CV disclosure | `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/vercel.json`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/src/App.tsx`, `frontend/src/components/LegalView.tsx`, `frontend/src/components/IntakeView.tsx`, `frontend/src/components/ReanalyzeModal.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/PrivacyModal.tsx` |
| `390efbd` | Add unit security regression suite & CORS tightening proposal (`NEEDS APPROVAL`) | `tests/test_security.py`, `proposals/cors_tightening.md` |
| `b7d116b` | Add `SECURITY_AUDIT.md` audit report | `SECURITY_AUDIT.md` |
| `8b8043e` | Add live local Uvicorn HTTP/SSE/PDF/DOCX/rate-limit/frontend-artifact regression suite | `tests/test_regression_live.py` |
| *(this commit)* | Add `MANUAL_TEST_CHECKLIST.md` | `MANUAL_TEST_CHECKLIST.md` |

---

## 2. Click-by-Click Manual Verification Checklist

### A. First Load, Pre-Flight Health Check & Self-Hosted Typography
*Tagged commits: `cef428c`, `c37e78c`, `a01914c`*
- [ ] **A1.** Open the app in a fresh incognito window with DevTools → **Network** and **Console** open.
- [ ] **A2.** Confirm the **Free-Tier Pre-Flight Check** modal appears, calls `GET /health?warmup=true` with `X-Client-Id`, shows green checkmarks (`API`, `SQLite`, `371 scholarships`, `AI`), and auto-dismisses cleanly.
- [ ] **A3.** In DevTools → **Network**, filter by `fonts`: confirm `lexend-*.woff2` loads from your own origin (`200 OK`) and **zero** requests go to `fonts.googleapis.com` or `fonts.gstatic.com`.
- [ ] **A4.** In DevTools → **Console**, confirm **zero** Content-Security-Policy violations, CORS errors, or font errors.
- [ ] **A5.** Confirm an isolated **Sara Ahmed** demo session auto-loads in the sidebar and overview dashboard without errors.
- [ ] **A6.** Confirm the personalized arrival greeting toast appears in the bottom-right corner right after the boot modal closes.

### B. New Profile Analysis (Text Notes + Live SSE Streaming)
*Tagged commits: `cef428c`, `5700b9f`, `c37e78c`, `a01914c`*
- [ ] **B1.** Click **New Analysis** in the sidebar (or user icon in the topbar).
- [ ] **B2.** Verify the one-line disclosure under the submit button states that submitted CV text, profile notes, and SOP drafts are sent to Groq and uploaded PDFs may contain contact details.
- [ ] **B3.** Click **Load sample profile**, then click **Analyze profile & match scholarships**.
- [ ] **B4.** Watch the **Live SSE Progress** stepper tick off: (1) Exchange rate, (2) Profile score/gaps/roadmap, (3) 370+ scholarship matches. Confirm it opens the Overview dashboard automatically and shows the `"Analysis Complete"` milestone toast.

### C. PDF CV Upload & Parsing
*Tagged commits: `5700b9f`, `c37e78c`, `a01914c`*
- [ ] **C1.** On New Analysis, switch to the **Upload CV (PDF)** tab and upload a real text-based PDF CV (<= 10 MB, <= 25 pages).
- [ ] **C2.** Confirm extracted text loads cleanly into the Notes tab with a green status banner showing page & character count, and you can edit before clicking Analyze.
- [ ] **C3.** Negative test: rename a `.txt` file to `fake.pdf` and upload it — confirm a clear red banner states the PDF signature is invalid (no crash or raw stack trace).

### D. Overview Dashboard, Synced Roadmap & DOCX Report Export
*Tagged commits: `e36ba0f`, `c37e78c`*
- [ ] **D1.** On **Overview**, verify the Profile card, Lemon conic score ring, 3 Priority Gaps, 6-Month Roadmap, and Top 5 matched scholarships render cleanly in `Lexend`.
- [ ] **D2.** Toggle a roadmap step checkbox → confirm checkmark persists after page refresh (`F5`).
- [ ] **D3.** Click an **Official portal** link on any matched scholarship → confirm it opens in a new tab.
- [ ] **D4.** Click **Export report** → confirm a `.docx` Word document downloads and opens cleanly.

### E. Versioned Re-Analysis, Revision History & Archive Lock
*Tagged commits: `cef428c`, `c37e78c`, `a01914c`*
- [ ] **E1.** Click **Re-analyze** in the revision bar, verify the one-line Groq disclosure appears under the textarea, add a skill/test score, and run re-analysis.
- [ ] **E2.** Confirm **v2 · Latest** becomes active, the `"Revision v2"` toast shows any score change, and your previously tracked scholarships/roadmap checks carried over from `v1`.
- [ ] **E3.** Click **← Prev** (or `v1`) → confirm the amber **Read-only archive** banner appears, capability Run buttons are disabled, and clicking **Jump to Latest (v2)** returns to editable mode.

### F. 371-Scholarship Tracker & Deadline Calendar
*Tagged commits: `cef428c`, `e36ba0f`, `c37e78c`*
- [ ] **F1.** Click **Tracker & calendar** in the topbar. Confirm the KPI header shows `371` ranked scholarships and `Auto-saved`.
- [ ] **F2.** Check a scholarship's working box, change a status dropdown to **Working on it** (verify `"Deadline Watch Active"` toast), change another to **Applied** (verify `"Milestone · Applied"` toast), and type a comment.
- [ ] **F3.** Add a custom open task in **Open Tasks**, check/uncheck it, and switch between **Spreadsheet** and **Deadline Calendar** layouts.
- [ ] **F4.** Click a **Portal** link in both Spreadsheet and Calendar views → confirm it opens cleanly.
- [ ] **F5.** Refresh the page (`F5`) → confirm all statuses, comments, and custom tasks are still saved.

### G. Studio Capabilities, Capability SSE, Result Drawers & Portal Scraping
*Tagged commits: `cef428c`, `5700b9f`, `e36ba0f`, `c37e78c`*
- [ ] **G1.** Open **Study abroad & research** and trigger **SOP Draft**. Confirm live status transitions (`Queued` → `Generating` → `Ready`) and the `"Draft Ready"` toast with a working **View output** button.
- [ ] **G2.** Open the SOP result drawer, click **Copy SOP**, and click **Download .docx** → confirm download succeeds.
- [ ] **G3.** Trigger **Deadline Verification** (exercises SSRF-hardened `scrape_website` + `<untrusted_external_evidence>` prompt boundary) → confirm drawer opens cleanly with valid `http(s)` source links and no errors.
- [ ] **G4.** Open **Career & freelance** (test e.g. **Career Paths** or **12-Week Learning Syllabus**) and **Local ecosystem** → confirm rendered external links work cleanly in new tabs.

### H. Notification Center & Personalized Greetings
*Tagged commits: `a01914c`*
- [ ] **H1.** Click the **Bell** icon in the topbar → confirm popover opens, shows your visit persona banner (`Night Owl` / `Early Start` / `Morning Check-in` / etc.), and lists upcoming deadlines for your tracked scholarships.
- [ ] **H2.** Click **Open in Tracker** on a deadline alert → confirm it jumps to Tracker filtered to that scholarship.
- [ ] **H3.** Test **All / Deadlines / Updates** tabs, **Mark all read**, individual dismiss `×`, and **Clear**.

### I. Browser Workspace Backup, Import & Deletion
*Tagged commits: `cef428c`, `c37e78c`, `a01914c`*
- [ ] **I1.** In the sidebar **Your browser workspace** card, click **Save backup** → confirm an `ascend-workspace-YYYY-MM-DD.json` file downloads.
- [ ] **I2.** Click **Privacy** badge in the sidebar card → verify modal shows workspace ID suffix, updated Groq disclosure, and clickable **Full Privacy Policy** and **Terms** links.
- [ ] **I3.** Click **Import** and upload the saved `.json` backup → confirm sessions append cleanly with no errors.
- [ ] **I4.** Delete a single profile thread via its sidebar `×` button → confirm it disappears and stays gone after refresh.

### J. Compliance Pages (`/privacy`, `/terms`) & In-App Data Deletion
*Tagged commits: `a01914c`*
- [ ] **J1.** Click **Privacy Policy** in the sidebar footer (and test direct navigation to `/privacy`). Confirm:
  - URL updates to `/privacy` cleanly and reloads without a 404 on Vercel.
  - States clearly: no accounts, browser random ID is the sole isolation mechanism, clearing browser data loses access, temporary Render server resets on restarts, shared 7-day `cache.db` (hash-only public results, no student jobs), Groq receives CV/profile/SOP text (CVs may contain contact details), zero analytics/cookies, self-hosted `Lexend` font, not directed at children under 13, and contact email `muhammad.kamal.hq@gmail.com`.
- [ ] **J2.** Switch to **Terms of Service** (and test direct navigation to `/terms`). Confirm acceptable use, AI advisory disclaimer, "AS IS", limitation of liability, open-source attributions, and `muhammad.kamal.hq@gmail.com`.
- [ ] **J3.** On Privacy Policy, click **Delete my workspace data** → click **Confirm delete all data** → confirm all sessions, notifications, and localStorage entries clear cleanly and you return to a fresh Intake screen.

---

## 3. Security Boundary Risk Matrix & Under-2-Minute Quick Tests

| Boundary Changed | Commits | What Could Break | How It Would Look to a User | Quick Test (< 2 min) |
|---|---|---|---|---|
| **API `X-Client-Id` bearer enforcement** (`api/demo.py`, `api/routes/jobs.py`, `api/routes/utilities.py`, `workspaceStore.ts`) | `cef428c`, `c37e78c` | Direct curl/scripts omitting `X-Client-Id` or sending `"default"` fail; browsers with an old `<8`-char custom ID get a newly generated ID. | Browser user: transparent (auto-generates valid 36-char ID). Unauthenticated script/API caller: receives HTTP `404`. | Run `curl -i http://127.0.0.1:8000/jobs` → expect `404`; with `-H "X-Client-Id: usr_test_12345678"` → expect `200`. |
| **SSE `client_id` enforcement** (`api/sse.py`) | `cef428c` | If `EventSource` ever omitted `?client_id=...`, live progress streaming would fail with `404` immediately. | Eager stepper or capability card would stall or show `"Stream failed"`. | Run `.\venv\Scripts\python -m unittest tests/test_regression_live.py -k test_03 -v` (~4s): confirms missing/wrong `client_id` gets `404` and valid `client_id` streams `result` + `done`. |
| **Vercel CSP & security headers** (`frontend/vercel.json`) | `a01914c` | Overly strict CSP could block Vite scripts, self-hosted `.woff2` fonts, inline SVG favicon, Render API `fetch`/`EventSource`, or `.docx`/`.json` blob downloads. | Blank page, fallback system font instead of `Lexend`, broken favicon, or blocked API calls with red CSP errors in Console. | Load preview/deployed app with DevTools Console open; confirm `Lexend` renders, favicon shows Lemon badge, `/health` & SSE succeed, and `0` CSP console errors appear. |
| **FastAPI security headers & `Cache-Control: no-store`** (`api/main.py`) | `c37e78c` | Embedding the API in an `<iframe>` is blocked (`X-Frame-Options: DENY`); browser won't cache `/jobs` responses across back/forward. | Normal users notice nothing (App is not iframed; React manages state + `localStorage`). | Run `curl -I http://127.0.0.1:8000/health` and inspect headers: confirm `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. |
| **Hourly rate limits + `X-Forwarded-For` proxy extraction** (`api/rate_limit.py`, `config.py`) | `c37e78c` | Behind a shared campus/office NAT IP, >20 job creations/hr or >10 CV parses/hr from the same public IP would throttle users; wrong `TRUSTED_PROXY_HOPS` could bucket everyone under Render's proxy IP. | Red inline error banner: `"Rate limit reached (max N requests per hour). Please wait about M minute(s) and try again."` | Run `.\venv\Scripts\python -m unittest tests/test_regression_live.py -k test_04 -v` (~2s): confirms 10th passes and 11th returns `429` + `Retry-After` even when spoofing left-hand `X-Forwarded-For`. |
| **Groq global daily cap & circuit breaker** (`agents/common/kickoff.py`) | `c37e78c` | Heavy traffic (>500 LLM calls/UTC day) or 5 consecutive Groq 5xx errors pauses new AI calls for 60s (or until UTC midnight). | Eager stepper or capability card displays `"Daily AI capacity limit reached..."` or `"AI service circuit breaker is temporarily open..."`. | Run `.\venv\Scripts\python -m unittest tests/test_security.py -k test_rate_limits_and_groq_circuit_breaker -v` (<1s). |
| **PDF upload & Pydantic payload bounds** (`api/routes/utilities.py`, `api/routes/jobs.py`) | `c37e78c` | Academic CVs >25 pages rejected; extracted text >50k chars truncated; pasted notes >25k chars or DOCX >120k chars rejected with `422`. | Clear inline red message explaining the exact limit (e.g., `"PDF exceeds maximum 25-page CV limit."`). | Run `.\venv\Scripts\python -m unittest tests/test_security.py -k test_pdf_upload -v` (<1s), or upload a renamed `.txt` as `.pdf` in the UI. |
| **Scraper SSRF, redirect & size caps** (`agents/common/tools.py`) | `e36ba0f` | Scholarship portals hosted on non-standard ports (not 80/443), behind >3 redirects, or returning binary/PDF responses instead of HTML will be skipped by `scrape_website` (DuckDuckGo snippets still supply evidence). | `Deadline Verification` still completes via DuckDuckGo snippets; unscrapeable portals simply fall back to search results or `Unconfirmed`. | Run `.\venv\Scripts\python -m unittest tests/test_security.py -k test_scraper_ssrf -v` (<1s) + click **Deadline Verification** on a live job. |
| **Prompt untrusted-evidence boundary** (`agents/capabilities/helpers.py`) | `e36ba0f` | Negligible risk; wraps external text in `<untrusted_external_evidence>` tags and instructs model not to obey instructions inside. | Identical structured JSON outputs; lower prompt-injection risk. | Run `.\venv\Scripts\python -m unittest tests/test_security.py -k test_prompt_evidence -v` (<1s). |
| **Frontend URL sanitizer** (`frontend/src/lib/safeUrl.ts`) | `e36ba0f` | If an LLM emits a URL missing `https://` (e.g. `daad.de` instead of `https://daad.de`), the link button will be omitted rather than rendered broken. | Portal/source link disappears for malformed URLs; all valid `http://` / `https://` links work identically. | Run `node --experimental-strip-types -e "import { toSafeHttpUrl } from './frontend/src/lib/safeUrl.ts'; console.log(toSafeHttpUrl('https://daad.de'), toSafeHttpUrl('javascript:alert(1)'))"` (<1s). |
| **Shared cache `cache.db` hash-only keys & log redaction** (`agents/common/cache.py`, `tools.py`, `kickoff.py`) | `5700b9f` | Debugging cache entries via raw SQL `query_raw` shows empty string; verbose internal exception traces no longer appear in UI error boxes. | Cleaner user-friendly error messages; faster/identical cached lookups. | Run `.\venv\Scripts\python -m unittest tests/test_security.py -k test_logs_and_shared_cache -v` (<1s). |
| **SPA `/privacy` & `/terms` navigation** (`App.tsx`, `LegalView.tsx`) | `a01914c` | Refreshing `/privacy` or `/terms` relies on `vercel.json` SPA rewrite (`/(.*) -> /index.html`); clicking Back button relies on `popstate`. | Clicking Privacy Policy/Terms or browser Back/Forward switches cleanly without losing workspace state. | Open `/privacy`, click **Terms of Service**, press browser Back, click **Back to workspace** (<30s). |

---

## 4. Automated Regression Results (Executed on `security-compliance-audit`)

All automated checks below were executed on the current branch with **zero application code changes**:

| Suite | Command | Result | What It Proved |
|---|---|---|---|
| **Live HTTP End-to-End Server Suite** (`tests/test_regression_live.py`) | `.\venv\Scripts\python -m unittest tests/test_regression_live.py -v` | **6 / 6 passed** (`12.138s`) | Started real local Uvicorn over TCP; verified `/health` + headers + unchanged CORS preflight, auto-demo seed + 371-scholarship ranking + tracker CRUD + cross-client `404` + restore isolation, live job creation + real SSE stream + SSE `404` bypass block + v2 re-analysis tracker carry-over + v1 `409` archive lock + capability SSE stream, real `pdfplumber` PDF parse + bad PDF rejections (`422`/`413`/`404`) + real DOCX export (`PK\x03\x04`) + live `429` rate limit with spoofed `X-Forwarded-For`, enforced `vercel.json` headers, and self-hosted `Lexend` in `dist/`. |
| **Security & Smoke Unit Suite** (`tests/test_security.py`) | `.\venv\Scripts\python -m unittest tests/test_security.py -v` | **7 / 7 passed** (`1.557s`) | Verified SSE/route `404` isolation, UUIDv4 IDs, SSRF IPv4/IPv6/redirect blocks, prompt delimiting, hash-only `cache.db` + PII scrub + client-ID log absence, proxy-safe rate limits + Groq daily breaker, PDF magic/page/50k-char caps, and FastAPI security headers. |
| **Frontend Production Build** | `pnpm --dir frontend run build` | **Passed** (`36` modules, `467ms`) | Zero TypeScript or Vite errors; bundled 16 self-hosted `lexend-*.woff2`/`.woff` assets. |
| **Frontend Dependencies Audit** | `pnpm --dir frontend audit --json` | **0 vulnerabilities** (`82` deps) | `@fontsource/lexend@5.3.0` clean with zero advisories. |
| **Frontend Logic & CSS Audits** | `test_notifications.mjs`, `safeUrl.ts`, `css_audit.py`, placeholder email grep | **All passed** | Notifications OK, URL sanitizer OK, `0` missing static CSS classes, `0` font CDN refs, `0` placeholder email tokens. |

---

## 5. Header Enforcement Audit (ENFORCED vs. Report-Only, by File)

**Summary:** **100% of configured security headers are ENFORCED. Zero headers are Report-Only.**

### `frontend/vercel.json` (Vercel Edge / Frontend Static & SPA Routes `/(.*)`)

| Header | Mode | Exact Configured Value |
|---|---|---|
| `Content-Security-Policy` | **ENFORCED** *(not `Content-Security-Policy-Report-Only`)* | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | **ENFORCED** | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | **ENFORCED** | `nosniff` |
| `X-Frame-Options` | **ENFORCED** | `DENY` |
| `Referrer-Policy` | **ENFORCED** | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | **ENFORCED** | `camera=(), microphone=(), geolocation=()` |

### `api/main.py` (FastAPI HTTP Middleware `add_security_headers`, lines 52–63)

| Header | Mode | Scope & Exact Configured Value |
|---|---|---|
| `X-Content-Type-Options` | **ENFORCED** | All API responses: `nosniff` |
| `X-Frame-Options` | **ENFORCED** | All API responses: `DENY` |
| `Referrer-Policy` | **ENFORCED** | All API responses: `strict-origin-when-cross-origin` |
| `Permissions-Policy` | **ENFORCED** | All API responses: `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | **ENFORCED** | All API responses: `max-age=31536000; includeSubDomains` |
| `Cache-Control` | **ENFORCED** | `/jobs*`, `/inputs*`, `/export*` API responses: `no-store` |

*(Note: `CORSMiddleware` in `api/main.py:42-49` and `config.py:46` is **unchanged** from `main`; tightening proposal is in [proposals/cors_tightening.md](proposals/cors_tightening.md).)*

---

## 6. Every User-Noticeable Behavior Difference (`main` → `security-compliance-audit`)

1. **New Compliance Pages & Links (`a01914c`):**
   - Sidebar footer now displays **Privacy Policy · Terms of Service**.
   - Intake privacy strip and Privacy modal now include links to **Privacy Policy** (`/privacy`) and **Terms of Service** (`/terms`), both listing `muhammad.kamal.hq@gmail.com` and an in-app **Delete my workspace data** control.
2. **New Groq & CV Contact-Details Disclosure (`a01914c`):**
   - A non-blocking one-line notice appears below the intake form and inside the Re-analyze modal stating that submitted CV text, profile notes, and SOP drafts are sent to Groq for AI processing and that uploaded PDF CVs may contain contact details.
3. **Removed External Network Calls (`a01914c`):**
   - Frontend no longer contacts `fonts.googleapis.com` or `fonts.gstatic.com`. The `Lexend` typeface (`400/500/600/700`) is self-hosted directly from your Vercel deployment and renders identically.
4. **Hourly Rate Limits & Global Daily AI Cap (`c37e78c`):**
   - Normal usage is unaffected, but heavy bursts now return HTTP `429` with a friendly wait message and `Retry-After` header:
     - `20/hr` job creations (`POST /jobs`), `10/hr` PDF CV parses (`POST /inputs/parse-cv`), `20/hr` DOCX exports (`POST /export/docx`), `60/hr` capability triggers, `30/hr` workspace restores (per IP and per workspace ID).
   - If the free-tier instance hits `500` Groq calls in a UTC day (or 5 consecutive upstream Groq errors), users see a clean capacity/circuit-breaker message instead of silent retries burning quota.
5. **Stricter Upload & Input Caps (`c37e78c`):**
   - PDF uploads now verify `%PDF-` magic bytes (renamed non-PDF files fail with `"invalid file signature"`), reject PDFs over **25 pages**, cap extracted text at **50,000 characters**, and abort uploads exceeding **10 MB** mid-stream.
   - Input limits enforced cleanly: profile notes `25,000` chars, SOP review text `15,000` chars, custom SOP notes `4,000` chars, DOCX export `120,000` chars, tracker entries `450` scholarships, workspace restore batch `2 MB`.
6. **Cleaner Error Messages & Graceful Export Errors (`5700b9f`, `c37e78c`):**
   - Internal exception text (such as raw Redis/queue or `pdfplumber` traces) is replaced with plain user-friendly messages.
   - DOCX export failures (including `429` rate limits) now render an inline red error banner in **Overview** and **Capability Drawer** instead of failing silently.
7. **Strict Workspace ID Handling (`cef428c`):**
   - Transparent to browser users (new browsers now generate a 36-char 128-bit ID instead of 20-char 64-bit; existing 20-char browser IDs continue working seamlessly; browsers with `localStorage` blocked receive a unique in-memory per-tab ID instead of sharing `"default"`).
   - Direct API/SSE requests missing a valid 8–64 char `X-Client-Id` (or passing `"default"`) now receive `404` instead of accessing shared/other-user jobs.
8. **External Link & Portal Scraping Guards (`e36ba0f`):**
   - Malformed or non-`http(s)` URLs returned by AI outputs are not rendered as clickable links.
   - `Deadline Verification` skips non-public, non-80/443, or excessive-redirect URLs and falls back cleanly to cached DuckDuckGo snippets.
