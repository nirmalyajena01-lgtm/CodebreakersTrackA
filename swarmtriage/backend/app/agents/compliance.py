"""Agent E — Compliance: scores drafts against COMPANY_POLICY (threshold 80)."""

from __future__ import annotations

from typing import Any

from .. import config
from ..policy import COMPANY_POLICY
from .base import BaseAgent

COMPLIANCE_SYSTEM = (
    "You are Agent E (Compliance) of a support-ticket swarm. Score drafts "
    "0-100 against the company policy below. Deduct points for every rule "
    "violation. Reply with strict JSON.\n\n" + COMPANY_POLICY
)


class ComplianceAgent(BaseAgent):
    agent_id = "E"
    agent_name = "Compliance"

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        sentiment_score = float(ticket.get("sentiment_score") or 5.0)
        threshold = config.COMPLIANCE_THRESHOLD

        for draft in ticket.get("drafts", []):
            prompt = (
                "TASK: compliance\n"
                'Reply JSON keys: {"score": int 0-100, "reasoning": str}.\n'
                f"TICKET_ID: {ticket['ticket_id']}\n"
                f"SENTIMENT_SCORE: {sentiment_score}\n"
                f'COMPANY POLICY: """{COMPANY_POLICY}"""\n'
                f'DRAFT TEXT: """{draft["text"]}"""'
            )
            result = self.llm.complete_json(COMPLIANCE_SYSTEM, prompt)
            try:
                score = int(round(float(result.get("score"))))
            except (TypeError, ValueError):
                score = 0
            score = max(0, min(100, score))
            reasoning = str(result.get("reasoning") or "Scored against policy rules.")
            draft["compliance_score"] = score
            draft["compliance_reasoning"] = reasoning
            draft["compliance_passed"] = score >= threshold

        passed = [d for d in ticket.get("drafts", []) if d["compliance_passed"]]
        if passed:
            ticket["final_status"] = "pending_review"
            outcome = (
                f"{len(passed)}/{len(ticket['drafts'])} draft(s) passed "
                f"(threshold {threshold}); status → pending_review."
            )
        else:
            ticket["final_status"] = "escalated"
            outcome = (
                f"ALL drafts scored below the compliance threshold "
                f"({threshold}); status → escalated for senior handling."
            )

        detail = " | ".join(
            f"[{d['style']}] score={d['compliance_score']} "
            f"passed={d['compliance_passed']} — {d['compliance_reasoning']}"
            for d in ticket.get("drafts", [])
        )
        self.record(
            ticket["ticket_id"],
            "compliance_check",
            f"{outcome} Per-draft: {detail}",
        )
        return ticket
