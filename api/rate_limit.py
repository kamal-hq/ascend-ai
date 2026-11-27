"""
api/rate_limit.py — Proxy-aware sliding-window rate limiter (per IP & per client_id).

Designed for single-instance Render free-tier deployments without external Redis:
  - Extracts real client IP from X-Forwarded-For using TRUSTED_PROXY_HOPS (Render = 1)
    so spoofed left-hand X-Forwarded-For values cannot bypass IP limits.
  - Enforces independent hourly buckets for both client IP and X-Client-Id.
  - Memory-bounded with automatic stale-bucket eviction.
  - Returns HTTP 429 with Retry-After and a clear user-facing error message.
"""

import ipaddress
import math
import threading
import time
from collections import deque

from fastapi import HTTPException, Request

import config
from api.demo import parse_client_id

_MAX_BUCKETS = 10_000


def extract_client_ip(request: Request) -> str:
    """Resolve client IP safely behind TRUSTED_PROXY_HOPS reverse proxies."""
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    hops = config.TRUSTED_PROXY_HOPS
    if xff and hops > 0:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        valid_ips: list[str] = []
        for raw in parts:
            try:
                ipaddress.ip_address(raw)
                valid_ips.append(raw)
            except ValueError:
                continue
        if valid_ips:
            idx = max(0, len(valid_ips) - hops)
            return valid_ips[idx]

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class SlidingWindowLimiter:
    """Thread-safe in-memory sliding-window limiter."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = {}
        self._last_sweep: float = 0.0

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()
            self._last_sweep = 0.0

    def _sweep_locked(self, now: float, window: int) -> None:
        if now - self._last_sweep < 120.0 and len(self._buckets) < _MAX_BUCKETS:
            return
        cutoff = now - window
        stale_keys = [
            key for key, dq in self._buckets.items() if not dq or dq[-1] <= cutoff
        ]
        for key in stale_keys:
            self._buckets.pop(key, None)
        while len(self._buckets) >= _MAX_BUCKETS:
            oldest_key = next(iter(self._buckets))
            self._buckets.pop(oldest_key, None)
        self._last_sweep = now

    def check_and_record(self, keys: list[str], limit: int, window_seconds: int) -> int | None:
        """Return Retry-After seconds if any bucket exceeds *limit*, else record hit & return None."""
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            self._sweep_locked(now, window_seconds)
            max_retry = 0
            for key in keys:
                dq = self._buckets.get(key)
                if dq is None:
                    continue
                while dq and dq[0] <= cutoff:
                    dq.popleft()
                if len(dq) >= limit:
                    retry_after = max(1, int(math.ceil(window_seconds - (now - dq[0]))))
                    if retry_after > max_retry:
                        max_retry = retry_after

            if max_retry > 0:
                return max_retry

            for key in keys:
                dq = self._buckets.setdefault(key, deque())
                dq.append(now)
            return None


rate_limiter = SlidingWindowLimiter()


def enforce_rate_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int | None = None,
    client_id: str | None = None,
) -> None:
    """Enforce per-IP and per-client_id hourly quota; raise HTTP 429 on breach."""
    win = window_seconds or config.RATE_LIMIT_WINDOW_SECONDS
    ip = extract_client_ip(request)
    cid = client_id or parse_client_id(request.headers.get("x-client-id"))

    keys = [f"{bucket}:ip:{ip}"]
    if cid:
        keys.append(f"{bucket}:cid:{cid}")

    retry_after = rate_limiter.check_and_record(keys, limit=limit, window_seconds=win)
    if retry_after is not None:
        mins = max(1, int(math.ceil(retry_after / 60)))
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached (max {limit} requests per hour). "
                f"Please wait about {mins} minute{'s' if mins != 1 else ''} and try again."
            ),
            headers={"Retry-After": str(retry_after)},
        )
