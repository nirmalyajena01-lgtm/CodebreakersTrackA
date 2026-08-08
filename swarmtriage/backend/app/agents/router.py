"""Agent C — Router: assigns the approver, escalates high-anger tickets."""

from __future__ import annotations

from typing import Any

from .. import config
from .base import BaseAgent


class RouterAgent(BaseAgent):
    agent_id = "C"
    agent_name = "Router"

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        category = ticket.get("category") or "Billing"
        approver = config.ROUTING_TABLE.get(category, config.ROUTING_TABLE["Billing"])
        ticket["assigned_approver"] = approver

        score = float(ticket.get("sentiment_score") or 0.0)
        reasoning = (
            f"Category '{category}' routes to {approver} per the routing table "
            f"({'; '.join(f'{k}→{v}' for k, v in config.ROUTING_TABLE.items())})."
        )
        if score >= config.ESCALATION_SENTIMENT_THRESHOLD:
            reasoning += (
                f" ESCALATION: sentiment_score {score} ≥ "
                f"{config.ESCALATION_SENTIMENT_THRESHOLD}, so "
                f"{config.ESCALATION_CC} is CC'd on this ticket."
            )
        ticket["routing_reasoning"] = reasoning
        self.record(ticket["ticket_id"], "routing", reasoning)
        return ticket
