"""Pipeline: runs agents A→E synchronously and records audit events (SPEC §2.5)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from .. import state
from ..state import append_audit, utc_now
from .classifier import ClassifierAgent
from .compliance import ComplianceAgent
from .drafter import DrafterAgent
from .orchestrator import OrchestratorAgent
from .router import RouterAgent

logger = logging.getLogger("swarmtriage.pipeline")


def new_ticket_state(raw_text: str, customer_email: str) -> dict[str, Any]:
    """Create a fresh TicketState dict (SPEC §2.1)."""
    return {
        "ticket_id": uuid.uuid4().hex,
        "raw_text": raw_text,
        "customer_email": customer_email,
        "ingestion_timestamp": utc_now(),
        "validation": {"valid": False, "errors": []},
        "category": None,
        "category_reasoning": None,
        "sentiment": None,
        "sentiment_score": None,
        "sentiment_reasoning": None,
        "assigned_approver": None,
        "routing_reasoning": None,
        "rag_feedback_used": [],
        "drafts": [],
        "rejection_feedback_log": [],
        "human_approval_timestamp": None,
        "approved_draft_style": None,
        "final_status": "processing",
    }


def run_pipeline(ticket_id: str) -> dict[str, Any]:
    """Run agents A→E on the ticket, sharing the global TicketState dict."""
    ticket = state.tickets[ticket_id]
    append_audit(
        ticket_id,
        "system",
        "pipeline_start",
        f"Pipeline A→E started for ticket {ticket_id}.",
    )
    try:
        OrchestratorAgent().run(ticket)   # A: validate + initialize
        ClassifierAgent().run(ticket)     # B: category + sentiment
        RouterAgent().run(ticket)         # C: route to approver
        DrafterAgent().run(ticket)        # D: RAG retrieval + 3 drafts
        ComplianceAgent().run(ticket)     # E: policy scoring, threshold 80
    except Exception as exc:  # pipeline must never leave a ticket stuck
        logger.exception("Pipeline failed for ticket %s", ticket_id)
        ticket["final_status"] = "escalated"
        append_audit(
            ticket_id,
            "system",
            "pipeline_error",
            f"Pipeline error ({exc!r}); ticket escalated for manual handling.",
        )
    append_audit(
        ticket_id,
        "system",
        "pipeline_complete",
        f"Pipeline finished with final_status={ticket['final_status']}.",
    )
    state.save()
    return ticket


def rerun_drafter_and_compliance(ticket_id: str) -> dict[str, Any]:
    """Re-run agents D→E after a human rejection (RAG now has new feedback)."""
    ticket = state.tickets[ticket_id]
    DrafterAgent().run(ticket)
    ComplianceAgent().run(ticket)
    state.save()
    return ticket
