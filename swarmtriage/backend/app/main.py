"""FastAPI application entrypoint (SPEC §3/§7)."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, state
from .agents import onboarding
from .api.auth_routes import router as auth_router
from .api.onboarding_routes import router as onboarding_router
from .api.routes import router as api_router
from .auth import store as auth_store
from .memory import swarm_memory

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("swarmtriage")

app = FastAPI(
    title="SwarmTriage — Adaptive Enterprise Support Automation",
    version="0.1.0",
    description=(
        "Five-agent swarm (A–E) that triages support tickets, drafts replies "
        "with RAG over past human rejection feedback, and enforces compliance."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(onboarding_router)


@app.on_event("startup")
def startup() -> None:
    state.load()
    swarm_memory.load()
    auth_store.load()
    auth_store.seed_employee()
    onboarding.load()
    logger.info(
        "SwarmTriage backend up: provider=%s, tickets=%d, memory_entries=%d, "
        "users=%d, onboarding_plans=%d",
        config.LLM_PROVIDER,
        len(state.tickets),
        len(swarm_memory.all_entries()),
        len(auth_store.users),
        len(onboarding.plans),
    )
