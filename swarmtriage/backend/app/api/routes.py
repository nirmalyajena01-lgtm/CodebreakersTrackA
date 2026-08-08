"""HTTP API routes, prefix /api (SPEC §3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import config, state
from ..agents.pipeline import new_ticket_state, rerun_drafter_and_compliance, run_pipeline
from ..memory.swarm_memory import update_swarm_memory
from ..schemas import ApproveRequest, RejectRequest, SubmitRequest
from ..state import append_audit, utc_now

router = APIRouter(prefix="/api")


def _get_ticket_or_404(ticket_id: str) -> dict[str, Any]:
    ticket = state.tickets.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id!r} not found")
    return ticket


@router.post("/submit")
def submit_ticket(payload: SubmitRequest) -> dict[str, Any]:
    """Create a ticket and run the full A→E pipeline synchronously."""
    ticket = new_ticket_state(payload.raw_text, payload.customer_email)
    state.tickets[ticket["ticket_id"]] = ticket
    state.save()
    return run_pipeline(ticket["ticket_id"])


@router.get("/queue")
def get_queue() -> dict[str, Any]:
    """Tickets awaiting human review, sorted by sentiment_score desc."""
    queue = [
        ticket
        for ticket in state.tickets.values()
        if ticket["final_status"] in ("pending_review", "escalated")
    ]
    queue.sort(key=lambda t: t.get("sentiment_score") or 0.0, reverse=True)
    return {"tickets": queue}


@router.get("/tickets")
def get_tickets() -> dict[str, Any]:
    """All tickets, newest first."""
    tickets = sorted(
        state.tickets.values(),
        key=lambda t: t.get("ingestion_timestamp") or "",
        reverse=True,
    )
    return {"tickets": tickets}


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str) -> dict[str, Any]:
    return _get_ticket_or_404(ticket_id)


@router.post("/approve")
def approve_ticket(payload: ApproveRequest) -> dict[str, Any]:
    """Human approves one draft (optionally with edited text)."""
    ticket = _get_ticket_or_404(payload.ticket_id)
    draft = next(
        (d for d in ticket.get("drafts", []) if d["style"] == payload.draft_style),
        None,
    )
    if draft is None:
        raise HTTPException(
            status_code=422,
            detail=f"Ticket has no draft with style {payload.draft_style!r}",
        )
    if payload.edited_text is not None:
        draft["text"] = payload.edited_text
        edit_note = f" Human edited the {payload.draft_style} draft before approval."
    else:
        edit_note = ""

    ticket["human_approval_timestamp"] = utc_now()
    ticket["approved_draft_style"] = payload.draft_style
    ticket["final_status"] = "approved"
    append_audit(
        payload.ticket_id,
        "human",
        "approval",
        f"Human approved the '{payload.draft_style}' draft at "
        f"{ticket['human_approval_timestamp']}.{edit_note}",
    )
    state.save()
    return ticket


@router.post("/reject")
def reject_ticket(payload: RejectRequest) -> dict[str, Any]:
    """Human rejects the drafts: log feedback, update swarm memory, re-draft.

    This is the Adaptive Rejection Learning Loop: the feedback is embedded and
    stored, then agents D→E re-run and the new drafts must visibly adapt.
    """
    ticket = _get_ticket_or_404(payload.ticket_id)

    entry = {
        "timestamp": utc_now(),
        "reason": payload.reason,
        "free_text": payload.free_text,
    }
    ticket["rejection_feedback_log"].append(entry)
    append_audit(
        payload.ticket_id,
        "human",
        "rejection",
        f"Human rejected the drafts. Reason: {payload.reason!r}"
        + (f" — details: {payload.free_text}" if payload.free_text else ""),
    )

    # Store feedback in vector swarm memory, then re-run Drafter + Compliance.
    update_swarm_memory(
        ticket_id=payload.ticket_id,
        category=ticket.get("category") or "Unknown",
        reason=payload.reason,
        free_text=payload.free_text,
    )
    append_audit(
        payload.ticket_id,
        "system",
        "swarm_memory_update",
        f"Rejection feedback embedded into swarm memory "
        f"(category={ticket.get('category')}); re-running Drafter (D) and "
        f"Compliance (E) with RAG feedback.",
    )
    rerun_drafter_and_compliance(payload.ticket_id)
    return ticket


@router.get("/audit/{ticket_id}")
def get_audit(ticket_id: str) -> dict[str, Any]:
    """Audit narrative object — exact keys per SPEC §3."""
    ticket = _get_ticket_or_404(ticket_id)
    drafts = ticket.get("drafts", [])
    return {
        "ticket_id": ticket["ticket_id"],
        "ingestion_timestamp": ticket["ingestion_timestamp"],
        "agent_a_classification_reasoning": (
            f"Validation: {'passed' if ticket['validation']['valid'] else 'FAILED'} "
            f"(errors: {ticket['validation']['errors'] or 'none'}). "
            f"Category: {ticket.get('category')}. "
            f"{ticket.get('category_reasoning') or ''} "
            f"Routing: {ticket.get('routing_reasoning') or ''}"
        ).strip(),
        "agent_b_sentiment_score_and_reasoning": {
            "score": ticket.get("sentiment_score"),
            "reasoning": ticket.get("sentiment_reasoning"),
        },
        "agent_c_draft_variations_thought_process": [
            {"style": d["style"], "thought_process": d["thought_process"]}
            for d in drafts
        ],
        "agent_d_compliance_check_score": [
            {
                "style": d["style"],
                "score": d["compliance_score"],
                "passed": d["compliance_passed"],
                "reasoning": d["compliance_reasoning"],
            }
            for d in drafts
        ],
        "human_approval_timestamp": ticket.get("human_approval_timestamp"),
        "rejection_feedback_log": ticket.get("rejection_feedback_log", []),
        "final_status": ticket.get("final_status"),
        "timeline": state.audit_log.get(ticket_id, []),
    }


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "llm_provider": config.LLM_PROVIDER}
