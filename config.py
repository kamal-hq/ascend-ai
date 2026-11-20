"""
Centralized configuration for Ascend AI.

Every env var, path, and constant lives here. Nothing else in the codebase
should call os.getenv() or hardcode a path — import from config instead.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Prevent LiteLLM from attempting slow remote cost-map downloads on offline/cold starts
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

# ---------------------------------------------------------------------------
# Project root — resolved once, used everywhere
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Environment variables
# ---------------------------------------------------------------------------
GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")
REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173,"
    "http://localhost:8443,http://127.0.0.1:8443"
)
CORS_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", _DEFAULT_CORS).split(",")
    if origin.strip()
]

# Optional search API keys (zero-key DuckDuckGo + SQLite cache used by default)
TAVILY_API_KEY: str = os.environ.get("TAVILY_API_KEY", "")
BRAVE_API_KEY: str = os.environ.get("BRAVE_API_KEY", "")

# ---------------------------------------------------------------------------
# Model assignments & Capability Registry
CORS_ORIGIN_REGEX: str | None = os.getenv("CORS_ORIGIN_REGEX") or r"https://.*\.vercel\.app"

# ---------------------------------------------------------------------------
MODEL_EAGER_PROFILE: str = "groq/openai/gpt-oss-120b"
MODEL_CAPABILITIES: str = "groq/openai/gpt-oss-20b"

ALLOWED_CAPABILITIES: frozenset[str] = frozenset({
    "sop_draft",
    "sop_review",
    "scholarship_analysis",
    "deadline_verification",
    "faculty_outreach",
    "research_proposal",
    "career_paths",
    "learning_roadmap",
    "freelance_pack",
    "academia_vs_industry",
    "local_ecosystem",
})

# ---------------------------------------------------------------------------
# Paths — all resolved to absolute so CWD never matters
# ---------------------------------------------------------------------------
DATA_DIR: str = str(_ROOT / "data")
SQLITE_DB_PATH: str = str(_ROOT / "data" / "ascend.db")
CACHE_DB_PATH: str = str(_ROOT / "data" / "cache.db")
SCHOLARSHIPS_JSON: str = str(_ROOT / "data" / "scholarships.json")
SALARY_RANGES_JSON: str = str(_ROOT / "data" / "salary_ranges.json")
DEMO_SEED_JSON: str = str(_ROOT / "data" / "demo_seed.json")
