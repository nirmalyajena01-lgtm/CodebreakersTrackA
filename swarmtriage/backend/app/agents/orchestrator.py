"""Agent A — Orchestrator: intake validation and state initialization."""

from __future__ import annotations

import re
from typing import Any

from .base import BaseAgent

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class OrchestratorAgent(BaseAgent):
    """Validates raw intake (non-empty text, email format) and records it."""

    agent_id = "A"
    agent_name = "Orchestrator"

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []
        raw_text = (ticket.get("raw_text") or "").strip()
        email = (ticket.get("customer_email") or "").strip()

        if not raw_text:
            errors.append("raw_text is empty")
        elif len(raw_text) < 10:
            errors.append("raw_text is too short to triage (< 10 characters)")
        if not EMAIL_RE.match(email):
            errors.append(f"customer_email {email!r} is not a valid email address")

        ticket["raw_text"] = raw_text
        ticket["customer_email"] = email
        ticket["validation"] = {"valid": not errors, "errors": errors}

        if errors:
            detail = "Validation FAILED: " + "; ".join(errors)
        else:
            detail = (
                f"Intake validated: {len(raw_text)} chars from {email}. "
                "TicketState initialized; handing off to Classifier (Agent B)."
            )
        self.record(ticket["ticket_id"], "intake_validation", detail)
        return ticket
