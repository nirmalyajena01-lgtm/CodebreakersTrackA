"""Shared base class for the five swarm agents.

Every agent reads and writes the SAME global TicketState dict for the ticket
(SPEC §2.1) and records audit events (SPEC §2.2) via `state.append_audit`.
"""

from __future__ import annotations

from typing import Any

from ..llm.factory import get_llm
from ..state import append_audit


class BaseAgent:
    """Base class: shared LLM handle + audit recording."""

    agent_id: str = "?"
    agent_name: str = "BaseAgent"

    def __init__(self) -> None:
        self.llm = get_llm()

    def record(self, ticket_id: str, event: str, detail: str) -> None:
        """Append an audit event attributed to this agent."""
        append_audit(ticket_id, self.agent_id, event, detail)

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        """Mutate the shared TicketState in place and return it."""
        raise NotImplementedError
