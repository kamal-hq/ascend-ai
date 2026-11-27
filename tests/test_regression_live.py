r"""
Live end-to-end HTTP, SSE, multipart PDF, DOCX, rate-limit, and frontend-artifact
regression verification suite for branch `security-compliance-audit`.

Starts a real local Uvicorn instance on an ephemeral localhost port against an
isolated temporary SQLite DB (with LLM calls stubbed so zero Groq quota is spent)
and exercises both normal user flows AND every new security boundary over real HTTP.

Run with:
    .\venv\Scripts\python -m unittest tests/test_regression_live.py -v
"""

import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

import requests

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

_LIVE_SERVER_HARNESS = r"""
import os, pathlib, sys
sys.path.insert(0, os.environ["ASCEND_REPO_ROOT"])

import agents.common.cache as cache_mod
import data.db as db

tmp_dir = pathlib.Path(os.environ["ASCEND_LIVE_TMP"])
db.SQLITE_DB_PATH = str(tmp_dir / "ascend_live.db")
cache_mod.result_cache = cache_mod.ResultCache(db_path=str(tmp_dir / "cache_live.db"))
db.init_db()

# Stub LLM & external FX calls only so real HTTP/SSE/worker/PDF/DOCX/rate-limit paths run offline
import worker.eager as eager_mod
import worker.capabilities as cap_mod

eager_mod._fetch_live_rate = lambda: 279.25

def _stub_profile(raw_text: str) -> dict:
    return {
        "name": "Amina Tariq",
        "degree": "BS Computer Science",
        "university": "NUST",
        "cgpa": "3.72",
        "graduation_year": "2025",
        "summary": "Strong AI engineering applicant targeting fully funded MS programs in Germany and UK.",
        "research_interests": ["Machine Learning", "Healthcare AI"],
        "work_experience": ["ML Engineer Intern"],
        "extracurriculars": ["IEEE Student Chapter"],
        "target_country": ["Germany", "United Kingdom"],
        "target_program": "MS Artificial Intelligence",
        "target_scholarships": ["DAAD EPOS", "Chevening"],
        "career_goal": "Applied AI Researcher",
        "key_strengths": ["Python", "PyTorch", "FastAPI"],
        "special_skills": ["NLP", "Computer Vision"],
        "is_research_track": True,
        "profile_strength_score": 83,
        "strength_label": "Strong",
        "gap_analysis": "Add one peer-reviewed workshop paper and IELTS Academic.",
        "gap_items": [
            {"title": "IELTS Score", "detail": "Target 7.5 overall", "severity": "REQUIRED"},
            {"title": "Research Publication", "detail": "Submit workshop paper", "severity": "HIGH IMPACT"},
            {"title": "Open-Source Portfolio", "detail": "Document ML projects", "severity": "MEDIUM"},
        ],
        "improvement_roadmap": ["Book IELTS", "Draft SOP", "Contact 3 advisors"],
        "roadmap_steps": [
            {"timeframe": "MONTH 1-2", "title": "Book IELTS", "detail": "Prepare and take exam"},
            {"timeframe": "MONTH 3-4", "title": "Draft SOP", "detail": "Refine statement"},
            {"timeframe": "MONTH 5-6", "title": "Submit Applications", "detail": "Finalize references"},
        ],
    }

eager_mod.extract_profile = _stub_profile

def _stub_dispatch(cap_name, **kwargs):
    if cap_name == "sop_draft":
        text = "I am applying to pursue graduate research in healthcare artificial intelligence."
        return {
            "title": "Statement of Purpose — MS AI",
            "target_context": "MS Artificial Intelligence (Germany / UK)",
            "word_count": len(text.split()),
            "paragraphs": [text],
            "key_themes": ["Healthcare AI", "Research Impact"],
            "full_text": text,
        }
    return {"summary": f"Stubbed output for {cap_name}"}

cap_mod.dispatch_capability = _stub_dispatch

import uvicorn
from api.main import app

uvicorn.run(app, host="127.0.0.1", port=int(os.environ["ASCEND_LIVE_PORT"]), log_level="warning")
"""


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _build_minimal_valid_pdf(text: str = "Sara Ahmed BS Software Engineering NUST CGPA 3.65") -> bytes:
    """Build a tiny standards-compliant single-page PDF readable by pdfplumber."""
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({safe}) Tj ET".encode("latin-1")
    objs = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n",
        f"4 0 obj << /Length {len(stream)} >> stream\n".encode("ascii") + stream + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objs:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )
    return bytes(out)


def _read_sse_events(url: str, timeout: float = 12.0) -> tuple[int, list[tuple[str, str]]]:
    events: list[tuple[str, str]] = []
    cur_event = "message"
    with requests.get(url, stream=True, timeout=timeout) as resp:
        if resp.status_code != 200:
            return resp.status_code, events
        for raw_line in resp.iter_lines(decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.strip()
            if line.startswith("event:"):
                cur_event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line.split(":", 1)[1].strip()
                events.append((cur_event, data))
                if cur_event == "done":
                    break
        return resp.status_code, events


class TestLiveServerRegression(unittest.TestCase):
    proc: subprocess.Popen | None = None
    tmp_dir: pathlib.Path | None = None
    base_url: str = ""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix="ascend_live_reg_"))
        harness_path = cls.tmp_dir / "run_live_server.py"
        harness_path.write_text(_LIVE_SERVER_HARNESS, encoding="utf-8")

        port = _find_free_port()
        cls.base_url = f"http://127.0.0.1:{port}"
        env = os.environ.copy()
        env["ASCEND_REPO_ROOT"] = str(REPO_ROOT)
        env["ASCEND_LIVE_TMP"] = str(cls.tmp_dir)
        env["ASCEND_LIVE_PORT"] = str(port)
        env["TRUSTED_PROXY_HOPS"] = "1"

        cls.proc = subprocess.Popen(
            [sys.executable, str(harness_path)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        deadline = time.time() + 18.0
        last_err = None
        while time.time() < deadline:
            if cls.proc.poll() is not None:
                err_out = cls.proc.stderr.read() if cls.proc.stderr else ""
                raise RuntimeError(f"Live Uvicorn server exited early: {err_out}")
            try:
                r = requests.get(f"{cls.base_url}/health", timeout=1.5)
                if r.status_code == 200:
                    return
            except requests.RequestException as exc:
                last_err = exc
            time.sleep(0.25)
        raise RuntimeError(f"Live Uvicorn server did not become ready: {last_err}")

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.proc is not None:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.proc.kill()
        if cls.tmp_dir is not None:
            shutil.rmtree(cls.tmp_dir, ignore_errors=True)

    def test_01_health_headers_and_cors_unchanged(self) -> None:
        # Unauthenticated /health works for Render healthCheckPath and hides job counts
        r = requests.get(f"{self.base_url}/health", timeout=5)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["jobs_count"], 0)
        self.assertEqual(body["checks"]["scholarships_loaded"], 371)

        # Enforced backend security headers
        self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(r.headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(r.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
        self.assertIn("camera=()", r.headers.get("Permissions-Policy", ""))
        self.assertIn("max-age=31536000", r.headers.get("Strict-Transport-Security", ""))

        # CORS preflight unchanged for production Vercel origin & localhost
        for origin in ("https://ascend-ai-sandy.vercel.app", "http://localhost:5173"):
            pre = requests.options(
                f"{self.base_url}/jobs",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "Content-Type, X-Client-Id",
                },
                timeout=5,
            )
            self.assertEqual(pre.status_code, 200)
            self.assertEqual(pre.headers.get("Access-Control-Allow-Origin"), origin)
            self.assertEqual(pre.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_02_demo_seed_tracker_and_workspace_isolation_over_http(self) -> None:
        alice = {"X-Client-Id": "usr_alice_live_00001"}
        bob = {"X-Client-Id": "usr_bob_live_00002"}

        # Missing or invalid X-Client-Id on /jobs returns 404
        self.assertEqual(requests.get(f"{self.base_url}/jobs", timeout=5).status_code, 404)
        self.assertEqual(
            requests.get(f"{self.base_url}/jobs", headers={"X-Client-Id": "default"}, timeout=5).status_code,
            404,
        )

        # Auto-seed demo session for Alice
        lst = requests.get(f"{self.base_url}/jobs?seed_demo=true", headers=alice, timeout=5)
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(lst.headers.get("Cache-Control"), "no-store")
        jobs = lst.json()["jobs"]
        self.assertEqual(len(jobs), 1)
        jid = jobs[0]["job_id"]

        # Full snapshot & 371 ranked scholarships
        snap = requests.get(f"{self.base_url}/jobs/{jid}", headers=alice, timeout=5)
        self.assertEqual(snap.status_code, 200)
        self.assertEqual(snap.json()["results"]["profile"]["name"], "Sara Ahmed")

        cat = requests.get(f"{self.base_url}/jobs/{jid}/scholarships", headers=alice, timeout=5)
        self.assertEqual(cat.status_code, 200)
        self.assertEqual(cat.json()["total"], 371)

        # Save tracker status, comment, task, and roadmap check
        tracker_body = {
            "scholarships": {
                "DAAD EPOS": {"status": "working", "comment": "Drafting motivation letter", "updated_at": "2026-11-27T00:00:00Z"}
            },
            "tasks": [
                {"id": "tsk_1", "title": "Request professor LOR", "timeframe": "Week 1", "scholarship_name": "DAAD EPOS", "done": False}
            ],
            "roadmap_checked": [0],
        }
        put_tr = requests.put(f"{self.base_url}/jobs/{jid}/tracker", json=tracker_body, headers=alice, timeout=5)
        self.assertEqual(put_tr.status_code, 200)
        self.assertTrue(put_tr.json()["saved"])

        # Cross-client isolation over HTTP returns 404 (never 403)
        self.assertEqual(requests.get(f"{self.base_url}/jobs/{jid}", headers=bob, timeout=5).status_code, 404)
        self.assertEqual(requests.put(f"{self.base_url}/jobs/{jid}/tracker", json=tracker_body, headers=bob, timeout=5).status_code, 404)
        self.assertEqual(requests.delete(f"{self.base_url}/jobs/{jid}", headers=bob, timeout=5).status_code, 404)

        # Bob restoring Alice's exported JSON gets isolated fresh job_id & thread_id
        restore_res = requests.post(
            f"{self.base_url}/jobs/restore",
            json={"jobs": [snap.json()]},
            headers=bob,
            timeout=5,
        )
        self.assertEqual(restore_res.status_code, 200)
        restored = restore_res.json()["restored"][0]
        self.assertNotEqual(restored["job_id"], jid)
        self.assertNotEqual(restored["thread_id"], snap.json()["thread_id"])

    def test_03_live_job_sse_stream_reanalysis_archive_lock_and_capability_sse(self) -> None:
        alice_cid = "usr_alice_sse_00003"
        bob_cid = "usr_bob_sse_00004"
        alice = {"X-Client-Id": alice_cid}

        # Create v1 job over live HTTP
        created = requests.post(
            f"{self.base_url}/jobs",
            json={"input_text": "Amina Tariq — BS CS, NUST, CGPA 3.72, targeting MS AI in Germany."},
            headers=alice,
            timeout=5,
        )
        self.assertEqual(created.status_code, 201)
        v1_id = created.json()["job_id"]

        # Regression: SSE without client_id or with wrong client_id returns 404
        s_none, _ = _read_sse_events(f"{self.base_url}/jobs/{v1_id}/stream")
        self.assertEqual(s_none, 404)
        s_bob, _ = _read_sse_events(f"{self.base_url}/jobs/{v1_id}/stream?client_id={bob_cid}")
        self.assertEqual(s_bob, 404)

        # Real SSE stream with matching client_id succeeds and delivers slices + completion
        s_ok, events = _read_sse_events(f"{self.base_url}/jobs/{v1_id}/stream?client_id={alice_cid}")
        self.assertEqual(s_ok, 200)
        event_names = [ev for ev, _ in events]
        self.assertIn("result", event_names)
        self.assertIn("status", event_names)
        self.assertIn("done", event_names)

        # Save tracker on v1, then re-analyze into v2 -> tracker carries over & v1 becomes 409 read-only
        requests.put(
            f"{self.base_url}/jobs/{v1_id}/tracker",
            json={"scholarships": {"Chevening": {"status": "shortlisted", "comment": "Essay draft"}}, "tasks": [], "roadmap_checked": [1]},
            headers=alice,
            timeout=5,
        )
        v2_res = requests.post(
            f"{self.base_url}/jobs",
            json={"input_text": "Amina Tariq updated with IELTS 8.0 and workshop paper.", "thread_id": v1_id},
            headers=alice,
            timeout=5,
        )
        self.assertEqual(v2_res.status_code, 201)
        v2_id = v2_res.json()["job_id"]
        s2_ok, _ = _read_sse_events(f"{self.base_url}/jobs/{v2_id}/stream?client_id={alice_cid}")
        self.assertEqual(s2_ok, 200)

        v2_snap = requests.get(f"{self.base_url}/jobs/{v2_id}", headers=alice, timeout=5).json()
        self.assertEqual(v2_snap["version"], 2)
        self.assertIn("Chevening", v2_snap["results"]["tracker"]["scholarships"])

        # Archived v1 rejects tracker writes and capability triggers with 409
        self.assertEqual(
            requests.put(f"{self.base_url}/jobs/{v1_id}/tracker", json={"scholarships": {}, "tasks": [], "roadmap_checked": []}, headers=alice, timeout=5).status_code,
            409,
        )
        self.assertEqual(
            requests.post(f"{self.base_url}/jobs/{v1_id}/capabilities/sop_draft", headers=alice, timeout=5).status_code,
            409,
        )

        # Trigger capability on Latest v2 + verify capability SSE stream + bypass block
        trig = requests.post(
            f"{self.base_url}/jobs/{v2_id}/capabilities/sop_draft",
            json={"custom_notes": "Focus on medical imaging"},
            headers=alice,
            timeout=5,
        )
        self.assertEqual(trig.status_code, 202)
        cap_bypass, _ = _read_sse_events(f"{self.base_url}/jobs/{v2_id}/capabilities/sop_draft/stream")
        self.assertEqual(cap_bypass, 404)
        cap_ok, cap_events = _read_sse_events(
            f"{self.base_url}/jobs/{v2_id}/capabilities/sop_draft/stream?client_id={alice_cid}"
        )
        self.assertEqual(cap_ok, 200)
        self.assertIn("result", [ev for ev, _ in cap_events])
        self.assertIn("done", [ev for ev, _ in cap_events])

    def test_04_pdf_upload_docx_export_and_live_429_rate_limiting(self) -> None:
        hdr = {"X-Client-Id": "usr_pdf_live_00005", "X-Forwarded-For": "198.51.100.55"}

        # Valid real PDF succeeds
        valid_pdf = _build_minimal_valid_pdf("Sara Ahmed BS Software Engineering NUST CGPA 3.65")
        ok_pdf = requests.post(
            f"{self.base_url}/inputs/parse-cv",
            files={"file": ("sara_cv.pdf", valid_pdf, "application/pdf")},
            headers=hdr,
            timeout=8,
        )
        self.assertEqual(ok_pdf.status_code, 200)
        self.assertEqual(ok_pdf.json()["page_count"], 1)
        self.assertIn("Sara Ahmed", ok_pdf.json()["text"])

        # Bad uploads rejected over HTTP: wrong extension (422), fake magic bytes (422), missing client_id (404), >10MB (413)
        self.assertEqual(
            requests.post(
                f"{self.base_url}/inputs/parse-cv",
                files={"file": ("notes.txt", b"hello", "text/plain")},
                headers=hdr,
                timeout=5,
            ).status_code,
            422,
        )
        self.assertEqual(
            requests.post(
                f"{self.base_url}/inputs/parse-cv",
                files={"file": ("fake.pdf", b"<html>nope</html>", "application/pdf")},
                headers=hdr,
                timeout=5,
            ).status_code,
            422,
        )
        self.assertEqual(
            requests.post(
                f"{self.base_url}/inputs/parse-cv",
                files={"file": ("sara_cv.pdf", valid_pdf, "application/pdf")},
                timeout=5,
            ).status_code,
            404,
        )
        self.assertEqual(
            requests.post(
                f"{self.base_url}/inputs/parse-cv",
                files={"file": ("big.pdf", b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024 + 64), "application/pdf")},
                headers={"X-Client-Id": "usr_pdf_big_00006", "X-Forwarded-For": "198.51.100.56"},
                timeout=10,
            ).status_code,
            413,
        )

        # Valid DOCX export returns real DOCX bytes; missing X-Client-Id returns 404; >120k chars returns 422
        ok_docx = requests.post(
            f"{self.base_url}/export/docx",
            json={"title": "Test Report", "content": "Paragraph 1\n\nParagraph 2", "filename": "../../evil name.docx"},
            headers=hdr,
            timeout=5,
        )
        self.assertEqual(ok_docx.status_code, 200)
        self.assertTrue(ok_docx.content.startswith(b"PK\x03\x04"))
        self.assertNotIn("/", ok_docx.headers.get("Content-Disposition", ""))
        self.assertNotIn("\\", ok_docx.headers.get("Content-Disposition", ""))
        self.assertEqual(
            requests.post(f"{self.base_url}/export/docx", json={"title": "T", "content": "Hi"}, timeout=5).status_code,
            404,
        )
        self.assertEqual(
            requests.post(
                f"{self.base_url}/export/docx",
                json={"title": "T", "content": "x" * 120_001},
                headers=hdr,
                timeout=5,
            ).status_code,
            422,
        )

        # Live 10/hr CV parse rate-limit test behind simulated Render proxy (spoofed left-hand XFF blocked!)
        real_ip = "203.0.113.88"
        for idx in range(10):
            r = requests.post(
                f"{self.base_url}/inputs/parse-cv",
                files={"file": ("cv.pdf", b"not-a-pdf", "application/pdf")},
                headers={
                    "X-Client-Id": f"usr_rl_rot_{idx:06d}",
                    "X-Forwarded-For": f"10.1.1.{idx}, {real_ip}",
                },
                timeout=5,
            )
            self.assertEqual(r.status_code, 422)

        blocked = requests.post(
            f"{self.base_url}/inputs/parse-cv",
            files={"file": ("cv.pdf", valid_pdf, "application/pdf")},
            headers={
                "X-Client-Id": "usr_rl_rot_000099",
                "X-Forwarded-For": f"9.9.9.9, {real_ip}",
            },
            timeout=5,
        )
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Retry-After", blocked.headers)
        self.assertIn("Rate limit reached", blocked.json().get("detail", ""))


class TestFrontendArtifactsAndHeaders(unittest.TestCase):
    def test_vercel_headers_are_enforced_and_csp_valid(self) -> None:
        cfg = json.loads((REPO_ROOT / "frontend" / "vercel.json").read_text(encoding="utf-8"))
        hdrs = {h["key"]: h["value"] for h in cfg["headers"][0]["headers"]}

        # Enforced CSP (NOT Report-Only)
        self.assertIn("Content-Security-Policy", hdrs)
        self.assertNotIn("Content-Security-Policy-Report-Only", hdrs)
        csp = hdrs["Content-Security-Policy"]
        self.assertIn("font-src 'self' data:", csp)
        self.assertNotIn("fonts.googleapis.com", csp)
        self.assertNotIn("fonts.gstatic.com", csp)
        self.assertIn("script-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)

        # Other enforced headers
        self.assertIn("max-age=31536000", hdrs["Strict-Transport-Security"])
        self.assertEqual(hdrs["X-Content-Type-Options"], "nosniff")
        self.assertEqual(hdrs["X-Frame-Options"], "DENY")
        self.assertEqual(hdrs["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertIn("camera=()", hdrs["Permissions-Policy"])

        # SPA rewrite still intact for /privacy, /terms, etc.
        self.assertEqual(cfg["rewrites"][0]["destination"], "/index.html")

    def test_dist_bundle_has_self_hosted_lexend_and_zero_cdn_or_placeholders(self) -> None:
        dist_dir = REPO_ROOT / "frontend" / "dist"
        self.assertTrue(dist_dir.exists(), "Run `pnpm --dir frontend run build` before artifact check")
        woff2_files = list((dist_dir / "assets").glob("lexend-latin-*.woff2"))
        self.assertGreaterEqual(len(woff2_files), 4, "Expected self-hosted Lexend 400/500/600/700 woff2 files")

        js_css_text = "\n".join(
            p.read_text(encoding="utf-8", errors="ignore")
            for p in (dist_dir / "assets").glob("*")
            if p.suffix in (".js", ".css")
        )
        self.assertNotIn("fonts.googleapis.com", js_css_text)
        self.assertNotIn("fonts.gstatic.com", js_css_text)
        self.assertNotIn("[" + "CONTACT_EMAIL]", js_css_text)
        self.assertIn("muhammad.kamal.hq@gmail.com", js_css_text)


if __name__ == "__main__":
    unittest.main()
