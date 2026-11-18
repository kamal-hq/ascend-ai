"""
agents/common/tools.py — Cached external discovery tools (7-day SQLite TTL).

Every external lookup checks `result_cache` (`data/cache.db`) before hitting
DuckDuckGo, ArXiv, YouTube, or direct HTTP scraping.
"""

import logging
import random
import time

import requests
from bs4 import BeautifulSoup
from langchain_community.tools import DuckDuckGoSearchRun, YouTubeSearchTool
from langchain_community.utilities import ArxivAPIWrapper

from agents.common.cache import result_cache

logger = logging.getLogger(__name__)


def _cached_run(source: str, query: str, fetcher) -> str:
    """Lookup query in SQLite 7-day cache; fetch & cache on miss."""
    clean_query = query.strip()
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
        logger.warning("Tool '%s' failed for query '%s': %s", source, clean_query[:80], exc)
        return f"Search error ({source}): {exc}"


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
    """Fetch readable plain text from an official URL with 7-day caching."""
    def _fetch_url(target_url: str) -> str:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; AscendAI/3.0)"}
        resp = requests.get(target_url, headers=headers, timeout=8)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:2200]

    return _cached_run("scrape", url, _fetch_url)


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
