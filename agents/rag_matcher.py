"""
agents/rag_matcher.py — Instant domain-aware scholarship ranking (~2-5ms).

Replaces cold-loading PyTorch + SentenceTransformer + ChromaDB on every worker boot
(which added 25-45 seconds of CPU startup overhead for just 48 records) with an
in-process BM25/TF-IDF + country + degree-level + target-scholarship ranker over
`data/scholarships.json`.
"""

import json
import logging
import math
import re

from config import SCHOLARSHIPS_JSON

logger = logging.getLogger(__name__)

_COUNTRY_CODES: dict[str, str] = {
    "Asia/Pacific (Multiple)": "AP",
    "Australia": "AU",
    "Austria": "AT",
    "Azerbaijan": "AZ",
    "Belgium": "BE",
    "Brunei": "BN",
    "Canada": "CA",
    "China": "CN",
    "Commonwealth Countries": "CW",
    "Czech Republic": "CZ",
    "Denmark": "DK",
    "Egypt": "EG",
    "Europe (Multiple)": "EU",
    "Finland": "FI",
    "France": "FR",
    "Germany": "DE",
    "Global": "GL",
    "Global (Multiple)": "GL",
    "Hong Kong": "HK",
    "Hungary": "HU",
    "Italy": "IT",
    "Japan": "JP",
    "Kazakhstan": "KZ",
    "Malaysia": "MY",
    "Netherlands": "NL",
    "New Zealand": "NZ",
    "Norway": "NO",
    "Oman": "OM",
    "Pakistan": "PK",
    "Poland": "PL",
    "Portugal": "PT",
    "Qatar": "QA",
    "Romania": "RO",
    "Russia": "RU",
    "Saudi Arabia": "SA",
    "Singapore": "SG",
    "South Korea": "KR",
    "Spain": "ES",
    "Sweden": "SE",
    "Switzerland": "CH",
    "Taiwan": "TW",
    "Thailand": "TH",
    "Turkey": "TR",
    "UAE": "AE",
    "UK": "UK",
    "USA": "US",
}

_COUNTRY_ALIASES: dict[str, set[str]] = {
    "usa": {"usa", "united states", "us", "america"},
    "uk": {"uk", "united kingdom", "britain", "england", "scotland"},
    "uae": {"uae", "united arab emirates", "dubai", "abu dhabi"},
    "south korea": {"south korea", "korea", "rok"},
    "turkey": {"turkey", "turkiye", "türkiye"},
    "europe (multiple)": {
        "europe", "eu", "germany", "france", "italy", "switzerland", "sweden",
        "austria", "belgium", "finland", "hungary", "netherlands", "denmark",
        "norway", "poland", "portugal", "spain", "czech republic",
    },
    "global": {"global", "international", "worldwide"},
    "global (multiple)": {"global", "international", "worldwide"},
}

_SCHOLARSHIPS_CACHE: list[dict] | None = None


def _load_scholarships() -> list[dict]:
    global _SCHOLARSHIPS_CACHE
    if _SCHOLARSHIPS_CACHE is None:
        with open(SCHOLARSHIPS_JSON, "r", encoding="utf-8") as f:
            _SCHOLARSHIPS_CACHE = json.load(f)
    return _SCHOLARSHIPS_CACHE


def _country_code(country: str) -> str:
    if country in _COUNTRY_CODES:
        return _COUNTRY_CODES[country]
    low = (country or "").lower()
    if low.startswith("pakistan"):
        return "PK"
    if low.startswith("usa"):
        return "US"
    if "europe" in low:
        return "EU"
    if "global" in low or "multiple" in low or "worldwide" in low:
        return "GL"
    cleaned = "".join(ch for ch in country.upper() if ch.isalpha())
    return cleaned[:2] if len(cleaned) >= 2 else "GL"


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _distance_to_match_score(distance: float) -> int:
    """Legacy helper retained for unit compatibility."""
    cos_sim = 1.0 - (float(distance) / 2.0)
    score = round(50.0 + 50.0 * cos_sim)
    return max(1, min(99, score))


def query_scholarships_structured(profile: dict, n_results: int = 5) -> list[dict]:
    """Rank scholarships from `data/scholarships.json` in <5ms with zero ML startup cost."""
    try:
        scholarships = _load_scholarships()
    except Exception:
        logger.exception("[RAG] Failed to load scholarships.json")
        return []

    if not scholarships:
        return []

    query_parts: list[str] = []
    for key in ("degree", "target_program", "career_goal"):
        if profile.get(key):
            query_parts.append(str(profile[key]))
    for key in ("research_interests", "target_country", "target_scholarships", "special_skills"):
        vals = profile.get(key)
        if vals:
            query_parts.extend(str(v) for v in vals)

    query_tokens = set(_tokenize(" ".join(query_parts)))
    if not query_tokens:
        query_tokens = {"graduate", "master", "stem", "data", "science"}

    docs = [
        _tokenize(f"{s.get('name', '')} {s.get('country', '')} {s.get('fields', '')} {s.get('note', '')}")
        for s in scholarships
    ]
    n_docs = len(docs)
    df: dict[str, int] = {}
    for d in docs:
        for tok in set(d):
            df[tok] = df.get(tok, 0) + 1

    target_countries = {str(c).strip().lower() for c in (profile.get("target_country") or []) if c}
    target_schols = {str(s).strip().lower() for s in (profile.get("target_scholarships") or []) if s}
    target_prog = str(profile.get("target_program") or "").lower()
    wants_grad = any(k in target_prog for k in ("ms", "msc", "master", "phd", "mphil", "graduate", "mba"))
    wants_phd = any(k in target_prog for k in ("phd", "doctor"))

    scored: list[tuple[float, int, dict]] = []
    for idx, (item, doc_toks) in enumerate(zip(scholarships, docs)):
        doc_set = set(doc_toks)
        tf_idf = sum(math.log(1.0 + n_docs / (1.0 + df.get(t, 0))) for t in (query_tokens & doc_set))

        bonus = 0.0
        c_low = str(item.get("country", "")).lower()
        name_low = str(item.get("name", "")).lower()
        note_low = str(item.get("note", "")).lower()
        fields_low = str(item.get("fields", "")).lower()

        # Target country affinity
        country_matched = False
        for tc in target_countries:
            aliases = _COUNTRY_ALIASES.get(c_low, {c_low})
            if tc in c_low or c_low in tc or tc in aliases:
                bonus += 6.0
                country_matched = True
                break
        if not country_matched and ("europe" in c_low or "global" in c_low):
            bonus += 2.0

        # Explicit target scholarship mention boost
        if any(ts in name_low or name_low in ts for ts in target_schols):
            bonus += 9.0

        # Broad STEM / all-fields boost
        if "all fields" in fields_low or "interdisciplinary" in fields_low:
            bonus += 1.5

        # Prefer verified application portals on close ties
        if item.get("url"):
            bonus += 1.0

        # Degree-level fit adjustment
        if wants_grad:
            if "master" in note_low or "graduate" in note_low or "all levels" in note_low:
                bonus += 3.0
            if "undergrad" in note_low or "teaching assistant" in name_low:
                bonus -= 4.5
            if "phd" in note_low and "master" not in note_low and not wants_phd:
                bonus -= 1.5

        scored.append((tf_idf + bonus, idx, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    max_score = max(scored[0][0], 1.0)

    out: list[dict] = []
    for rank, (raw_score, _, item) in enumerate(scored[:n_results], start=1):
        pct = min(98, max(62, round(66.0 + 30.0 * (max(raw_score, 0.0) / max_score))))
        out.append({
            "rank": rank,
            "match_score": pct,
            "similarity_match": f"{pct}%",
            "country_code": _country_code(item.get("country", "Global")),
            **item,
        })
    return out


def query_scholarships(profile: dict, n_results: int = 5) -> str:
    matches = query_scholarships_structured(profile, n_results=n_results)
    if not matches:
        return "Scholarship data unavailable."
    return json.dumps(matches, indent=2)
