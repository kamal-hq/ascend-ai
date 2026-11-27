"""
Local Ecosystem atomic capability (Search-Grounded Structured Synthesis on `20b`).
"""

from agents.capabilities.helpers import gather_cached_evidence, synthesize_from_evidence
from agents.common.tools import search_internet
from agents.schemas import LocalEcosystemResult


def run_local_ecosystem(profile: dict) -> dict:
    """Identify 2 Pakistani incubators, 1+ funding grant, and active local tech communities."""
    field = str(profile.get("target_program") or profile.get("career_goal") or "AI and software")[:80]

    lookups = [
        ("National Incubation Center NIC Plan9 Pakistan tech incubator", search_internet),
        ("Ignite NGIRI HEC technology startup funding grant Pakistan apply", search_internet),
        (f"Pakistan tech developer AI startup community {field}", search_internet),
    ]
    evidence = gather_cached_evidence(lookups)

    return synthesize_from_evidence(
        system_prompt=(
            "You are a veteran of Pakistan's tech startup and innovation ecosystem. Using the provided "
            "verified web evidence, recommend:\n"
            "1) 2 specific Pakistani incubators or accelerators suited to the student (name, city, why it fits, URL).\n"
            "2) 1-2 active local funding grants (e.g., Ignite NGIRI, HEC grants, NIC grants).\n"
            "3) 1-2 active tech communities in Pakistan.\n"
            "Only include real programs and URLs supported by the evidence or well-known official Pakistani portals."
        ),
        user_prompt=f"Candidate Profile:\n{profile}",
        evidence_text=evidence,
        response_model=LocalEcosystemResult,
        task_name="Pakistan Startup & Grant Hub",
        estimated_tokens=1800,
    )
