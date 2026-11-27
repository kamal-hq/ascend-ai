# Proposal: Tighten Production CORS Configuration (`NEEDS APPROVAL`)

> **Status:** Proposal only — **NOT applied**, per audit scope (Addition 7: do not change live CORS automatically).

## Current Configuration (Confirmed Issue)

- **Location:** `config.py:46`, `api/main.py:44-51`, `render.yaml:14-15`
- **Current settings:**
  - `CORS_ORIGIN_REGEX = r"https://.*\.vercel\.app"`
  - `allow_credentials = True`
  - `allow_methods = ["*"]`
  - `allow_headers = ["*"]`
- **Risk:** `https://.*\.vercel\.app` matches **any** Vercel deployment hosted by any third party (for example, `https://attacker-app.vercel.app`), not just Ascend AI's deployment (`https://ascend-ai-sandy.vercel.app`). Combined with `allow_credentials=True`, browsers permit any third-party `*.vercel.app` site to make cross-origin API calls to your Render backend and read responses (although note that Ascend AI uses the `X-Client-Id` custom header rather than cookies, so a third-party site cannot read your browser's `X-Client-Id` unless XSS occurs on your origin; it *could* still abuse unauthenticated `/health` or generate its own random `X-Client-Id` to hit your rate-limited Groq API directly from a malicious Vercel page).

## Proposed Safe Tightening

Because Ascend AI uses the `X-Client-Id` request header and **zero cookies** (`withCredentials` is never used by `fetch` or `EventSource`), `allow_credentials` is unnecessary and should be set to `False`.

### 1. Render Environment Variables (Dashboard or `render.yaml`)
- Set `CORS_ORIGINS`:
  ```text
  https://ascend-ai-sandy.vercel.app,http://localhost:5173,http://127.0.0.1:5173
  ```
- Unset / remove `CORS_ORIGIN_REGEX` in production (or narrow it strictly to your own Vercel preview slug, e.g. `^https://ascend-ai(-[a-z0-9-]+)?\.vercel\.app$`, if you rely on Vercel PR preview URLs).

### 2. Proposed Code Change (`config.py` & `api/main.py`)

```python
# config.py
CORS_ORIGIN_REGEX: str | None = os.getenv("CORS_ORIGIN_REGEX") or None

# api/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Client-Id"],
)
```

## Rollout & Verification Test Plan

1. **Before deploying:** Verify your exact production domain (`https://ascend-ai-sandy.vercel.app`, plus any custom domain if you add one later) is listed in `CORS_ORIGINS` on Render.
2. **If you use Vercel Preview deployments:** Set `CORS_ORIGIN_REGEX=^https://ascend-ai(-[a-z0-9-]+)?\.vercel\.app$` on Render instead of leaving it blank.
3. **Test allowed origin (`curl`):**
   ```bash
   curl -i -X OPTIONS https://<your-render-service>.onrender.com/jobs \
     -H "Origin: https://ascend-ai-sandy.vercel.app" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type, X-Client-Id"
   ```
   Confirm response returns `Access-Control-Allow-Origin: https://ascend-ai-sandy.vercel.app` and `200 OK`.
4. **Test disallowed Vercel origin (`curl`):**
   ```bash
   curl -i -X OPTIONS https://<your-render-service>.onrender.com/jobs \
     -H "Origin: https://unrelated-attacker.vercel.app" \
     -H "Access-Control-Request-Method: POST"
   ```
   Confirm response omits `Access-Control-Allow-Origin`.
5. **Browser smoke test:** Open `https://ascend-ai-sandy.vercel.app`, run the boot health check, create/view a demo session, trigger an SSE stream, save a tracker note, and download a `.docx` export with DevTools Network tab open — confirm zero CORS console errors.
6. **Rollback:** Restore `CORS_ORIGIN_REGEX=https://.*\.vercel\.app` in Render Dashboard Environment Variables if any preview URL breaks.
