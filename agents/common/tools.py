"""
agents/common/tools.py — Cached external discovery tools (7-day SQLite TTL).

Every external lookup checks `result_cache` (`data/cache.db`) before hitting
DuckDuckGo, ArXiv, YouTube, or direct HTTP scraping.
"""

import ipaddress
import logging
import random
import re
import socket
import threading
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from langchain_community.tools import DuckDuckGoSearchRun, YouTubeSearchTool
from langchain_community.utilities import ArxivAPIWrapper

from agents.common.cache import result_cache

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")

_SCRAPE_SEMAPHORE = threading.BoundedSemaphore(4)
_MAX_SCRAPE_REDIRECTS = 3
_MAX_SCRAPE_BYTES = 512 * 1024  # 512 KB hard cap per scraped page
_ALLOWED_SCRAPE_PORTS = frozenset({80, 443})
_ALLOWED_CONTENT_TYPES = ("text/html", "text/plain", "application/xhtml+xml")
_CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")
_BLOCKED_METADATA_IPS = frozenset({
    ipaddress.ip_address("169.254.169.254"),
    ipaddress.ip_address("100.100.100.200"),
    ipaddress.ip_address("fd00:ec2::254"),
})


def _is_public_ip(raw_ip: str) -> bool:
    """Return True only if *raw_ip* is a globally routable public IPv4 or IPv6 address."""
    try:
        ip = ipaddress.ip_address(raw_ip)
    except ValueError:
        return False

    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped

    if ip in _BLOCKED_METADATA_IPS:
        return False
    if isinstance(ip, ipaddress.IPv4Address) and ip in _CGNAT_NET:
        return False
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    ):
        return False
    return True


def validate_public_http_url(raw_url: str) -> str:
    """Validate scheme, host, port, and DNS-resolved public IPs to prevent SSRF."""
    url = (raw_url or "").strip()
    if not url or len(url) > 2048:
        raise ValueError("Invalid or overly long URL.")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Blocked non-HTTP(S) URL scheme.")
    if parsed.username or parsed.password:
        raise ValueError("Blocked URL containing embedded credentials.")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname or hostname in ("localhost", "localhost.localdomain") or hostname.endswith(".local"):
        raise ValueError("Blocked local hostname.")

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in _ALLOWED_SCRAPE_PORTS:
        raise ValueError("Blocked non-standard port.")

    try:
        addr_infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("Hostname resolution failed.") from exc

    if not addr_infos:
        raise ValueError("Hostname resolved to no addresses.")

    for info in addr_infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        if not _is_public_ip(ip_str):
            raise ValueError("Blocked non-public destination IP.")

    return url


def _scrub_query_pii(query: str) -> str:
    """Remove accidental email addresses or phone numbers before external search/caching."""
    cleaned = _EMAIL_RE.sub("", query)
    cleaned = _PHONE_RE.sub("", cleaned)
    return " ".join(cleaned.split())[:220]


def _cached_run(source: str, query: str, fetcher, *, scrub_pii: bool = True) -> str:
    """Lookup query in SQLite 7-day cache; fetch & cache on miss."""
    clean_query = _scrub_query_pii(query) if scrub_pii else query.strip()
    if not clean_query:
        return "Empty query."

    hit = result_cache.get(source, clean_query)
    if hit is not None:
        return str(hit)

    try:
        result = fetcher(clean_query)
        text = str(result).strip()
        lowered = text.lower()
        if text and not lowered.startswith(("error:", "search error")):
            result_cache.put(source, clean_query, text)
        return text or "No results returned."
    except Exception as exc:
        logger.warning("External lookup '%s' failed (%s)", source, type(exc).__name__)
        return f"Search error ({source}): lookup unavailable."


def search_internet(query: str) -> str:
    """Search the web via DuckDuckGo with short timeout, lite fallback, and 7-day caching."""
    def _fetch_ddg(q: str) -> str:
        from duckduckgo_search import DDGS
        for backend in ("api", "lite"):
            try:
                results = list(DDGS(timeout=6).text(q, max_results=4, backend=backend))
                if results:
                    return "\n".join(
                        f"{r.get('title', '')}: {r.get('body', '')} ({r.get('href', '')})"
                        for r in results
                    )
            except Exception:
                time.sleep(random.uniform(0.2, 0.5))
        return DuckDuckGoSearchRun().run(q)

    return _cached_run("ddg", query, _fetch_ddg)


def search_arxiv(query: str) -> str:
    """Search ArXiv for recent academic papers with polite jitter and 7-day caching."""
    def _fetch_arxiv(q: str) -> str:
        time.sleep(random.uniform(0.3, 0.9))
        return ArxivAPIWrapper(top_k_results=3, doc_content_chars_max=650).run(q)

    return _cached_run("arxiv", query, _fetch_arxiv)


def scrape_website(url: str) -> str:
    """Fetch readable plain text from an untrusted URL with strict SSRF, redirect, and size guards."""
    try:
        validated_initial = validate_public_http_url(url)
    except ValueError:
        return "Blocked unsafe URL."

    def _fetch_url(target_url: str) -> str:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; AscendAI/3.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        }
        with _SCRAPE_SEMAPHORE:
            session = requests.Session()
            session.trust_env = False
            current_url = validate_public_http_url(target_url)
            try:
                for _hop in range(_MAX_SCRAPE_REDIRECTS + 1):
                    with session.get(
                        current_url,
                        headers=headers,
                        timeout=(4, 8),
                        allow_redirects=False,
                        stream=True,
                    ) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("Location")
                            if not location:
                                return "Search error (scrape): invalid redirect."
                            next_url = urljoin(current_url, location)
                            current_url = validate_public_http_url(next_url)
                            continue

                        resp.raise_for_status()
                        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                        if ctype and not any(ctype.startswith(ok) for ok in _ALLOWED_CONTENT_TYPES):
                            return "Search error (scrape): unsupported content type."

                        chunks: list[bytes] = []
                        total = 0
                        for chunk in resp.iter_content(chunk_size=16_384):
                            if not chunk:
                                continue
                            remaining = _MAX_SCRAPE_BYTES - total
                            if remaining <= 0:
                                break
                            chunks.append(chunk[:remaining])
                            total += min(len(chunk), remaining)
                            if total >= _MAX_SCRAPE_BYTES:
                                break

                        raw_body = b"".join(chunks)
                        soup = BeautifulSoup(raw_body, "html.parser")
                        for tag in soup(["script", "style", "noscript"]):
                            tag.decompose()
                        return soup.get_text(separator=" ", strip=True)[:2200]

                return "Search error (scrape): too many redirects."
            finally:
                session.close()

    return _cached_run("scrape", validated_initial, _fetch_url, scrub_pii=False)


def search_youtube(query: str) -> str:
    """Search YouTube for educational videos and playlists, falling back to DDG site:youtube.com."""
    def _fetch_yt(q: str) -> str:
        try:
            return YouTubeSearchTool().run(q)
        except Exception:
            from duckduckgo_search import DDGS
            results = list(DDGS(timeout=6).text(f"site:youtube.com {q}", max_results=3, backend="lite"))
            if not results:
                return "YouTube search temporarily unavailable."
            return "\n".join(
                f"{r.get('title', '')} - {r.get('href', '')}"
                for r in results
            )

    return _cached_run("youtube", query, _fetch_yt)
