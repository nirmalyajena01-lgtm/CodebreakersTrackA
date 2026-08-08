"""Agent B — Classifier: category + sentiment with reasoning strings."""

from __future__ import annotations

from typing import Any

from .base import BaseAgent

CLASSIFY_SYSTEM = (
    "You are Agent B (Classifier) of a support-ticket swarm. Classify the "
    "ticket into exactly one of: Billing, Technical Bug, Feature Request."
)
SENTIMENT_SYSTEM = (
    "You are Agent B (Classifier) of a support-ticket swarm. Score customer "
    "sentiment urgency from 0.0 (delighted) to 10.0 (furious)."
)


class ClassifierAgent(BaseAgent):
    agent_id = "B"
    agent_name = "Classifier"

    def run(self, ticket: dict[str, Any]) -> dict[str, Any]:
        text = ticket["raw_text"]

        classification = self.llm.complete_json(
            CLASSIFY_SYSTEM,
            'TASK: classify\n'
            'Reply JSON keys: {"category": str, "category_reasoning": str}.\n'
            f'TICKET TEXT: """{text}"""',
        )
        category = classification.get("category")
        if category not in ("Billing", "Technical Bug", "Feature Request"):
            category = "Billing"
            category_reasoning = (
                "LLM returned an unrecognized category; defaulted to Billing."
            )
        else:
            category_reasoning = str(
                classification.get("category_reasoning") or "Classified by keyword analysis."
            )
        ticket["category"] = category
        ticket["category_reasoning"] = category_reasoning
        self.record(
            ticket["ticket_id"],
            "classification",
            f"Category={category}. Reasoning: {category_reasoning}",
        )

        sentiment = self.llm.complete_json(
            SENTIMENT_SYSTEM,
            'TASK: sentiment\n'
            'Reply JSON keys: {"sentiment": "Anger"|"Neutral"|"Happy", '
            '"sentiment_score": float 0-10, "sentiment_reasoning": str}.\n'
            f'TICKET TEXT: """{text}"""',
        )
        label = sentiment.get("sentiment")
        if label not in ("Anger", "Neutral", "Happy"):
            label = "Neutral"
        try:
            score = float(sentiment.get("sentiment_score"))
        except (TypeError, ValueError):
            score = 5.0
        score = max(0.0, min(10.0, round(score, 1)))
        reasoning = str(
            sentiment.get("sentiment_reasoning") or "Scored by heuristic analysis."
        )
        ticket["sentiment"] = label
        ticket["sentiment_score"] = score
        ticket["sentiment_reasoning"] = reasoning
        self.record(
            ticket["ticket_id"],
            "sentiment_analysis",
            f"Sentiment={label} score={score}/10. Reasoning: {reasoning}",
        )
        return ticket
