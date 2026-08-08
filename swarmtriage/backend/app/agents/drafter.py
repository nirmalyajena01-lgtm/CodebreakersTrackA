"""Agent D — Drafter: RAG-adaptive reply drafting.

The Adaptive Rejection Learning Loop (hackathon requirement): BEFORE drafting,
the Drafter retrieves relevant past rejection reasons from swarm memory. If
feedback exists, the drafts visibly adapt tone/content and each draft's
thought_process mentions the applied feedback.
"""

from __future__ import annotations

from typing import Any

from .. import config
from ..memory.swarm_memory import retrieve_relevant_feedback
from .base import BaseAgent

DRAFT_SYSTEM = (
    "You are Agent D (Drafter) of a support-ticket swarm. Write a customer "
    "reply that complies with company policy: never promise refunds or "
    "resolution times, never admit fault, be empathetic and clear, always "
    "reference the ticket ID."
)


class DrafterAgent(BaseAgent):
    agent_id = "D"
    agent_name = "Drafter"

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        category = ticket.get("category") or "Billing"
        sentiment_score = float(ticket.get("sentiment_score") or 5.0)

        # 1) RAG FIRST: retrieve relevant past rejection feedback.
        feedback = retrieve_relevant_feedback(
            category=category,
            query_text=ticket["raw_text"],
            top_k=config.RAG_TOP_K,
        )
        ticket["rag_feedback_used"] = feedback
        if feedback:
            self.record(
                ticket["ticket_id"],
                "rag_retrieval",
                "Retrieved prior rejection feedback from swarm memory to adapt "
                "drafts: " + " | ".join(repr(f) for f in feedback),
            )
        else:
            self.record(
                ticket["ticket_id"],
                "rag_retrieval",
                "No relevant prior rejection feedback in swarm memory; "
                "drafting from base templates.",
            )

        # 2) Generate exactly 3 drafts (formal / empathetic / concise).
        feedback_block = "\n".join(f"- {f}" for f in feedback) if feedback else "(none)"
        drafts: list[dict[str, Any]] = []
        for style in config.DRAFT_STYLES:
            prompt = (
                "TASK: draft\n"
                f"STYLE: {style}\n"
                f"CATEGORY: {category}\n"
                f"SENTIMENT_SCORE: {sentiment_score}\n"
                f"TICKET_ID: {ticket['ticket_id']}\n"
                "Reply JSON keys: {\"text\": str, \"thought_process\": str}. "
                "If RETRIEVED FEEDBACK lists past rejection reasons, the draft "
                "MUST visibly adapt (avoid the rejected behavior) and the "
                "thought_process MUST mention the applied feedback.\n"
                f'RETRIEVED FEEDBACK: """{feedback_block}"""\n'
                f'TICKET TEXT: """{ticket["raw_text"]}"""'
            )
            result = self.llm.complete_json(DRAFT_SYSTEM, prompt)
            drafts.append(
                {
                    "style": style,
                    "text": str(result.get("text") or "").strip(),
                    "thought_process": str(
                        result.get("thought_process") or "Drafted from template."
                    ),
                    "compliance_score": None,
                    "compliance_reasoning": None,
                    "compliance_passed": None,
                }
            )
        ticket["drafts"] = drafts

        summary = "; ".join(
            f"[{d['style']}] {d['thought_process']}" for d in drafts
        )
        self.record(
            ticket["ticket_id"],
            "drafting",
            f"Generated 3 drafts (formal/empathetic/concise) using "
            f"{len(feedback)} RAG feedback item(s). Thought processes: {summary}",
        )
        return ticket
