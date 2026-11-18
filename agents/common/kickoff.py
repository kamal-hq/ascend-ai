"""
agents/common/kickoff.py — Direct Groq HTTP execution with dual-dimension token-bucket limiting.

Replaces heavy `litellm` / `crewai` imports (which added 21s+ cold start) with a
pooled `requests.Session` calling Groq's OpenAI-compatible Chat Completions endpoint
directly (~0.05s import, ~1.5-2.5s request latency).
"""

import json
import logging
import random
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, TypeVar

import requests
from pydantic import BaseModel, ValidationError

from config import GROQ_API_KEY, MODEL_CAPABILITIES, MODEL_EAGER_PROFILE

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_http_session = requests.Session()

# ---------------------------------------------------------------------------
# Model-level rate-limit ceilings (org-wide, per model pool)
# ---------------------------------------------------------------------------
MODEL_LIMITS: dict[str, dict[str, int]] = {
    MODEL_CAPABILITIES: {"rpm": 30, "tpm": 8_000},
    MODEL_EAGER_PROFILE: {"rpm": 30, "tpm": 8_000},
}

_DEFAULT_LIMITS: dict[str, int] = {"rpm": 30, "tpm": 8_000}


# ---------------------------------------------------------------------------
# Token-bucket rate limiter (one bucket per dimension per model)
# ---------------------------------------------------------------------------
@dataclass
class _TokenBucket:
    """Classic token bucket refilling at `capacity / 60` tokens/sec."""

    capacity: float
    tokens: float = field(init=False)
    rate: float = field(init=False)
    _last_refill: float = field(init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        self.tokens = float(self.capacity)
        self.rate = self.capacity / 60.0
        self._last_refill = time.monotonic()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._last_refill = now
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)

    def acquire(self, count: float = 1.0, timeout: float = 90.0) -> None:
        """Block until *count* tokens are available, or raise TimeoutError."""
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                self._refill()
                if self.tokens >= count:
                    self.tokens -= count
                    return
                deficit = count - self.tokens
                wait = deficit / self.rate
            wait = min(wait, deadline - time.monotonic())
            if wait <= 0:
                raise TimeoutError(
                    f"Rate-limiter could not acquire {count} tokens within {timeout}s"
                )
            time.sleep(wait)


class _DualBucketLimiter:
    """Tracks BOTH requests-per-minute and tokens-per-minute for one model."""

    def __init__(self, rpm: int, tpm: int) -> None:
        self.rpm_bucket = _TokenBucket(capacity=float(rpm))
        self.tpm_bucket = _TokenBucket(capacity=float(tpm))

    def acquire(self, estimated_tokens: int = 1) -> None:
        self.rpm_bucket.acquire(1.0)
        if estimated_tokens > 0:
            self.tpm_bucket.acquire(float(estimated_tokens))


_limiters: dict[str, _DualBucketLimiter] = {}
_limiter_lock = threading.Lock()


def _get_limiter(model: str) -> _DualBucketLimiter:
    if model not in _limiters:
        with _limiter_lock:
            if model not in _limiters:
                limits = MODEL_LIMITS.get(model, _DEFAULT_LIMITS)
                _limiters[model] = _DualBucketLimiter(
                    rpm=limits["rpm"], tpm=limits["tpm"]
                )
    return _limiters[model]


# ---------------------------------------------------------------------------
# Backoff & Header Parsing Helpers
# ---------------------------------------------------------------------------
_BASE_DELAY: float = 2.0
_MAX_DELAY: float = 60.0
_MAX_JITTER: float = 1.0


def _compute_backoff(attempt: int) -> float:
    exp = min(_MAX_DELAY, _BASE_DELAY * (2 ** attempt))
    return exp + random.uniform(0, _MAX_JITTER)


def _parse_duration_str(val: str) -> float | None:
    """Parse durations like '1m12.3s', '18.5s', or '12.5' into seconds."""
    if not val:
        return None
    s = val.strip()
    try:
        return float(s)
    except ValueError:
        pass
    m = re.search(r"(?:(\d+)m\s*)?(\d+\.?\d*)s", s, re.IGNORECASE)
    if m:
        mins = float(m.group(1)) if m.group(1) else 0.0
        secs = float(m.group(2)) if m.group(2) else 0.0
        return mins * 60.0 + secs
    return None


def _extract_wait_seconds(resp: requests.Response | None, body_msg: str) -> float | None:
    if resp is not None:
        ra = resp.headers.get("retry-after") or resp.headers.get("Retry-After")
        parsed = _parse_duration_str(ra or "")
        if parsed is not None:
            return parsed + 0.5
        reset_tok = resp.headers.get("x-ratelimit-reset-tokens")
        parsed_tok = _parse_duration_str(reset_tok or "")
        if parsed_tok is not None and resp.status_code == 429:
            return parsed_tok + 0.5

    m_min_sec = re.search(
        r"try again in (?:(\d+)m\s*)?(\d+\.?\d*)s", body_msg, re.IGNORECASE
    )
    if m_min_sec:
        mins = float(m_min_sec.group(1)) if m_min_sec.group(1) else 0.0
        secs = float(m_min_sec.group(2)) if m_min_sec.group(2) else 0.0
        return mins * 60.0 + secs + 0.5

    return None


def _strip_titles(node: Any) -> Any:
    """Recursively strip noisy Pydantic 'title' metadata to shrink prompt tokens."""
    if isinstance(node, dict):
        return {
            k: _strip_titles(v)
            for k, v in node.items()
            if k != "title"
        }
    if isinstance(node, list):
        return [_strip_titles(item) for item in node]
    return node


def _compact_schema(response_model: type[BaseModel]) -> str:
    cleaned = _strip_titles(response_model.model_json_schema())
    return json.dumps(cleaned, separators=(",", ":"))


def _strip_json_fences(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _extract_first_json_object(raw_text: str) -> str:
    """Best-effort extract `{...}` slice when a fallback completion adds prose."""
    cleaned = _strip_json_fences(raw_text)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        return cleaned[start : end + 1]
    return cleaned


# ---------------------------------------------------------------------------
# Direct Groq Structured Completion
# ---------------------------------------------------------------------------
def safe_completion(
    messages: list[dict[str, str]],
    response_model: type[T],
    task_name: str,
    *,
    model: str = MODEL_CAPABILITIES,
    estimated_tokens: int = 1000,
    max_retries: int = 4,
    temperature: float = 0.0,
    reasoning_effort: str = "low",
) -> T:
    """Call Groq Chat Completions directly over HTTP and validate into Pydantic V2."""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not configured.")

    groq_model = model.removeprefix("groq/")
    schema_instruction = (
        "\n\nReturn ONLY one valid JSON object matching this exact JSON Schema "
        "(no markdown, no prose outside JSON):\n"
        f"{_compact_schema(response_model)}"
    )

    prepared = [dict(m) for m in messages]
    if prepared and prepared[0].get("role") == "system":
        prepared[0]["content"] = prepared[0]["content"] + schema_instruction
    else:
        prepared.insert(
            0,
            {
                "role": "system",
                "content": "You are a precise structured AI assistant." + schema_instruction,
            },
        )

    limiter = _get_limiter(model)
    last_exc: Exception | None = None
    use_json_mode = True

    for attempt in range(max_retries):
        try:
            limiter.acquire(estimated_tokens=estimated_tokens)
        except TimeoutError as exc:
            last_exc = exc
            logger.warning(
                "[RATE-LIMIT] Timed out waiting for token budget on %s (attempt %d/%d)",
                task_name, attempt + 1, max_retries,
            )
            continue

        payload: dict[str, Any] = {
            "model": groq_model,
            "messages": prepared,
            "temperature": temperature,
            "reasoning_effort": reasoning_effort,
        }
        if use_json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            resp = _http_session.post(
                _GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=(6, 45),
            )
        except requests.RequestException as exc:
            last_exc = exc
            if attempt + 1 < max_retries:
                delay = _compute_backoff(attempt)
                logger.warning("[HTTP_RETRY] %s network error (%s), sleeping %.1fs", task_name, exc, delay)
                time.sleep(delay)
                continue
            raise

        if resp.status_code == 200:
            try:
                body = resp.json()
                choices = body.get("choices") or []
                content = choices[0]["message"].get("content") if choices else None
                if not content or not str(content).strip():
                    raise ValueError("Empty completion content returned by Groq.")
                parsed = json.loads(_extract_first_json_object(str(content)))
                validated = response_model.model_validate(parsed)
                logger.info("[OK] %s completed on attempt %d", task_name, attempt + 1)
                return validated
            except (json.JSONDecodeError, ValidationError, ValueError, KeyError, IndexError) as exc:
                last_exc = exc
                logger.warning("[JSON_RETRY] %s attempt %d invalid JSON/schema: %s", task_name, attempt + 1, exc)
                if attempt + 1 < max_retries:
                    prepared.append({
                        "role": "user",
                        "content": (
                            f"Previous response failed JSON validation ({exc}). "
                            "Return ONLY a corrected raw JSON object matching the schema."
                        ),
                    })
                    time.sleep(0.6)
                    continue
                raise

        err_text = resp.text[:1000]
        err_lower = err_text.lower()
        logger.warning(
            "[GROQ_HTTP_%d] %s attempt %d: %s",
            resp.status_code, task_name, attempt + 1, err_text,
        )

        if resp.status_code == 400 and "json_validate_failed" in err_lower and attempt + 1 < max_retries:
            use_json_mode = False
            prepared.append({
                "role": "user",
                "content": "Return ONLY a raw valid JSON object matching the schema (no extra brackets or prose).",
            })
            time.sleep(0.5)
            continue

        if resp.status_code in (429, 500, 502, 503, 504) and attempt + 1 < max_retries:
            wait = _extract_wait_seconds(resp, err_text)
            if wait is not None:
                if "tokens per minute" in err_lower or "tpm" in err_lower:
                    wait = max(wait, 12.0)
            else:
                wait = _compute_backoff(attempt)
            logger.info("[RETRY_WAIT] %s sleeping %.1fs before retry", task_name, wait)
            time.sleep(min(wait, 90.0))
            continue

        raise RuntimeError(f"Groq API error ({resp.status_code}) in {task_name}: {err_text}")

    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"{task_name} failed after {max_retries} retries.")


def normalize_to_schema(
    raw_text: str,
    response_model: type[T],
    task_name: str,
    *,
    model: str = MODEL_CAPABILITIES,
    estimated_tokens: int = 900,
) -> T:
    """Parse already-valid JSON or normalize plain text into `response_model`."""
    try:
        return response_model.model_validate(
            json.loads(_extract_first_json_object(raw_text or ""))
        )
    except Exception:
        pass

    return safe_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "Convert the notes below into strict JSON matching the schema. "
                    "Preserve all real URLs, names, dates, and metrics verbatim."
                ),
            },
            {"role": "user", "content": f"Source notes:\n\n{raw_text[:7000]}"},
        ],
        response_model=response_model,
        task_name=f"{task_name} (Normalize)",
        model=model,
        estimated_tokens=estimated_tokens,
    )
