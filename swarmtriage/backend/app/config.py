"""Central configuration for the SwarmTriage backend.

All settings are read from environment variables with sensible defaults so the
app runs fully offline with the mock LLM provider out of the box.
"""

from __future__ import annotations

import os
from pathlib import Path

# Base directory of the backend package (backend/).
BASE_DIR = Path(__file__).resolve().parent.parent

# Directory where JSON snapshots are persisted.
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
TICKETS_SNAPSHOT_PATH = DATA_DIR / "tickets.json"
SWARM_MEMORY_PATH = DATA_DIR / "swarm_memory.json"
AUTH_SNAPSHOT_PATH = DATA_DIR / "auth.json"
ONBOARDING_SNAPSHOT_PATH = DATA_DIR / "onboarding.json"

# LLM provider selection: "mock" (default, deterministic, offline), "kimi",
# "gemini" or "zai".
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mock").strip().lower()

# Kimi (Moonshot) settings — only used when LLM_PROVIDER == "kimi".
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.ai/v1")
KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
KIMI_MODEL = os.getenv("KIMI_MODEL", "kimi-k2-0905-preview")

# Gemini (Google) settings — only used when LLM_PROVIDER == "gemini".
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# z-ai GLM settings — only used when LLM_PROVIDER == "zai".
ZAI_BASE_URL = os.getenv("ZAI_BASE_URL", "https://api.z.ai/api/paas/v4")
ZAI_API_KEY = os.getenv("ZAI_API_KEY", "")
ZAI_MODEL = os.getenv("ZAI_MODEL", "glm-5.2")

# Compliance threshold: drafts scoring below this are rejected (SPEC §2.5.5).
COMPLIANCE_THRESHOLD = 80

# Number of RAG feedback items the Drafter retrieves before drafting.
RAG_TOP_K = 3

# CORS origins (SPEC §3): the Vite dev server plus wildcard.
CORS_ORIGINS = ["http://localhost:5173", "*"]

# Approver routing table (SPEC §2.5.3).
ROUTING_TABLE = {
    "Billing": "finance_manager@company.com",
    "Technical Bug": "engineering_lead@company.com",
    "Feature Request": "product_manager@company.com",
}
ESCALATION_CC = "vp_support@company.com"
ESCALATION_SENTIMENT_THRESHOLD = 7.0

VALID_CATEGORIES = ["Billing", "Technical Bug", "Feature Request"]
DRAFT_STYLES = ["formal", "empathetic", "concise"]

# Onboarding coordinator (SPEC_AUTH_ONBOARDING §3).
HR_MANAGER_EMAIL = "hr_manager@company.com"
ONBOARDING_ROLES = [
    "Support Agent",
    "Engineer",
    "Finance Analyst",
    "People Ops",
    "Sales Rep",
]
