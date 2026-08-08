"""MockLLM — deterministic, fully offline rule-based LLM (SPEC §2.3).

This is the DEFAULT provider. It parses the structured prompts produced by the
agents (which embed a ``[TASK: ...]`` marker plus labelled fields) and answers
with keyword heuristics, template drafts, and rule-based compliance scoring.
Good enough to run the full A→E pipeline offline and demo well.
"""

from __future__ import annotations

import re

from .base import BaseLLM

# ---------------------------------------------------------------------------
# Keyword tables
# ---------------------------------------------------------------------------

CATEGORY_KEYWORDS = {
    "Billing": [
        "invoice", "bill", "billing", "charged", "charge", "overcharged",
        "refund", "payment", "subscription", "auto-renew", "auto renew",
        "renewal", "credit card", "price", "pricing", "cost", "double-charged",
        "receipt",
    ],
    "Technical Bug": [
        "bug", "crash", "crashes", "crashed", "error", "broken", "not working",
        "doesn't work", "does not work", "fails", "failing", "failed",
        "exception", "500", "404", "blank screen", "freeze", "froze", "glitch",
        "login", "log in", "can't log", "cannot log", "timeout", "slow",
    ],
    "Feature Request": [
        "feature", "would be nice", "could you add", "please add", "request",
        "wish", "suggestion", "integrate", "integration", "support for",
        "dark mode", "export", "api",
    ],
}

STRONG_ANGER_WORDS = [
    "furious", "outraged", "unacceptable", "ridiculous", "scam", "livid",
    "appalling", "disgrace", "worst", "never again", "lawyer", "sue",
    "cancel my", "demand", "disgusting", "theft", "stealing", "fraud",
]
MILD_ANGER_WORDS = [
    "angry", "terrible", "horrible", "awful", "frustrated", "frustrating",
    "sick of", "fed up", "incompetent", "disappointed", "annoying",
    "annoyed", "upset", "still not", "again",
]
HAPPY_WORDS = [
    "thanks", "thank you", "great", "love", "appreciate", "happy", "awesome",
    "excellent", "pleased", "amazing", "fantastic", "helpful",
]

# Compliance violation patterns (SPEC §2.6 policy rules).
FAULT_PATTERN = re.compile(
    r"\b(our fault|we were wrong|we caused|our mistake|it is our fault|"
    r"we are liable|we accept liability|we messed up)\b",
    re.IGNORECASE,
)
SLA_PATTERN = re.compile(
    r"\b(within \d+ (hours?|days?|minutes?)|guaranteed?|by tomorrow|"
    r"fixed immediately|asap)\b",
    re.IGNORECASE,
)
REFUND_PROMISE_PATTERN = re.compile(
    r"\b(full refund|refund (has been|is being|will be) issued|"
    r"we will refund|money back|refund you)\b",
    re.IGNORECASE,
)
PII_PATTERN = re.compile(
    r"(\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\bpassword\b|\bssn\b|"
    r"\bsecurity code\b|\bcvv\b)",
    re.IGNORECASE,
)
AGGRESSIVE_PATTERN = re.compile(
    r"\b(calm down|your fault|not our problem|deal with it|"
    r"stop complaining|you should have known|obviously)\b",
    re.IGNORECASE,
)
JARGON_PATTERN = re.compile(
    r"\b(stack trace|nullpointer|segfault|traceback|http 5\d\d|core dump)\b",
    re.IGNORECASE,
)


def _field(prompt: str, name: str) -> str:
    """Extract a `NAME: value` single-line field from a structured prompt."""
    match = re.search(rf"^{re.escape(name)}:\s*(.*)$", prompt, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _block(prompt: str, name: str) -> str:
    """Extract a `NAME: \"\"\"...\"\"\"` triple-quoted block from a prompt."""
    match = re.search(
        rf"{re.escape(name)}:\s*\"\"\"(.*?)\"\"\"", prompt, re.DOTALL
    )
    return match.group(1).strip() if match else ""


def _hits(text: str, keywords: list[str]) -> list[str]:
    lowered = text.lower()
    return [
        kw
        for kw in keywords
        if re.search(r"\b" + re.escape(kw) + r"\b", lowered)
    ]


class MockLLM(BaseLLM):
    """Deterministic keyword-heuristic LLM. Zero external calls."""

    name = "mock"

    def complete_json(self, system: str, prompt: str) -> dict:
        task = _field(prompt, "TASK").lower()
        if task == "classify":
            return self._classify(prompt)
        if task == "sentiment":
            return self._sentiment(prompt)
        if task == "draft":
            return self._draft(prompt)
        if task == "compliance":
            return self._compliance(prompt)
        # Unknown task: return an empty object rather than raising.
        return {}

    # ------------------------------------------------------------------
    # Agent B: classification
    # ------------------------------------------------------------------
    def _classify(self, prompt: str) -> dict:
        text = _block(prompt, "TICKET TEXT") or _field(prompt, "TICKET TEXT")
        scores = {
            category: len(_hits(text, keywords))
            for category, keywords in CATEGORY_KEYWORDS.items()
        }
        best = max(scores, key=lambda c: (scores[c], -list(scores).index(c)))
        if scores[best] == 0:
            return {
                "category": "Billing",
                "category_reasoning": (
                    "No strong category keywords detected; defaulting to "
                    "Billing because account/charge questions are the most "
                    "common support intake."
                ),
            }
        matched = _hits(text, CATEGORY_KEYWORDS[best])[:5]
        return {
            "category": best,
            "category_reasoning": (
                f"Matched {scores[best]} keyword(s) for {best} "
                f"({', '.join(repr(m) for m in matched)}); other categories "
                f"scored lower "
                f"(Billing={scores['Billing']}, "
                f"Technical Bug={scores['Technical Bug']}, "
                f"Feature Request={scores['Feature Request']})."
            ),
        }

    # ------------------------------------------------------------------
    # Agent B: sentiment
    # ------------------------------------------------------------------
    def _sentiment(self, prompt: str) -> dict:
        text = _block(prompt, "TICKET TEXT") or _field(prompt, "TICKET TEXT")
        strong = _hits(text, STRONG_ANGER_WORDS)
        mild = _hits(text, MILD_ANGER_WORDS)
        happy = _hits(text, HAPPY_WORDS)
        exclamations = text.count("!") + (1 if text.isupper() and len(text) > 20 else 0)

        if strong:
            score = min(10.0, 8.5 + 0.5 * (len(strong) - 1) + 0.25 * min(exclamations, 2))
            reasoning = (
                f"Strong anger signals detected ({', '.join(repr(w) for w in strong[:5])})"
                + (f" plus {exclamations} exclamation emphasis" if exclamations else "")
                + "; scoring near the top of the urgency scale."
            )
            sentiment = "Anger"
        elif mild:
            score = min(6.9, 4.5 + 0.6 * (len(mild) - 1) + 0.3 * min(exclamations, 2))
            reasoning = (
                f"Moderate frustration signals ({', '.join(repr(w) for w in mild[:5])}); "
                "customer is unhappy but not explosive."
            )
            sentiment = "Anger" if score >= 7.0 else "Neutral"
        elif happy:
            score = max(0.5, 2.0 - 0.3 * (len(happy) - 1))
            reasoning = (
                f"Positive language detected ({', '.join(repr(w) for w in happy[:5])}); "
                "customer appears satisfied."
            )
            sentiment = "Happy"
        else:
            score = 5.0
            reasoning = (
                "No strong emotional keywords detected; treating the ticket "
                "as a neutral, matter-of-fact request."
            )
            sentiment = "Neutral"

        return {
            "sentiment": sentiment,
            "sentiment_score": round(score, 1),
            "sentiment_reasoning": reasoning,
        }

    # ------------------------------------------------------------------
    # Agent D: drafting with RAG adaptation
    # ------------------------------------------------------------------
    def _draft(self, prompt: str) -> dict:
        style = _field(prompt, "STYLE") or "formal"
        category = _field(prompt, "CATEGORY") or "Billing"
        sentiment_score = float(_field(prompt, "SENTIMENT_SCORE") or 5.0)
        ticket_id = _field(prompt, "TICKET_ID") or "unknown"
        raw_text = _block(prompt, "TICKET TEXT")
        feedback = [
            line.strip()[2:] if line.strip().startswith("- ") else line.strip()
            for line in (_block(prompt, "RETRIEVED FEEDBACK") or "").splitlines()
            if line.strip() and line.strip() != "(none)"
        ]

        feedback_blob = " ".join(feedback).lower()
        soften = "too aggressive" in feedback_blob
        simplify = "too complex" in feedback_blob
        be_specific = "too vague" in feedback_blob
        verify_facts = "incorrect info" in feedback_blob

        thought_bits: list[str] = [
            f"Drafting a {style} reply for a {category} ticket "
            f"(sentiment_score={sentiment_score})."
        ]
        if feedback:
            thought_bits.append(
                "Applied feedback from prior human rejections retrieved via "
                "swarm memory: " + "; ".join(f"'{f}'" for f in feedback) + "."
            )
            if soften:
                thought_bits.append(
                    "Because a previous draft was rejected as 'Too aggressive', "
                    "this version deliberately softens the tone: extra empathy, "
                    "no pressure language, no deadlines imposed on the customer."
                )
            if simplify:
                thought_bits.append(
                    "Because a previous draft was rejected as 'Too complex', "
                    "this version uses short plain-language sentences and avoids "
                    "jargon and long paragraphs."
                )
            if be_specific:
                thought_bits.append(
                    "Because a previous draft was rejected as 'Too vague', this "
                    "version states the concrete next step and owning team."
                )
            if verify_facts:
                thought_bits.append(
                    "Because a previous draft was rejected as 'Incorrect info', "
                    "this version avoids unverified claims and says the team is "
                    "verifying the account details."
                )
        else:
            thought_bits.append(
                "No prior rejection feedback found in swarm memory for this "
                "category; using the standard template."
            )

        subject_line = self._subject(category, sentiment_score)
        empathy_line = self._empathy_line(sentiment_score, soften)
        body_line = self._body_line(category, verify_facts)
        next_step = self._next_step(category, ticket_id, sentiment_score, be_specific)

        if style == "formal":
            text = (
                f"Dear Customer,\n\n{subject_line} {empathy_line}\n\n"
                f"{body_line}\n\n{next_step}\n\n"
                f"Kind regards,\nCustomer Support Team\nTicket reference: {ticket_id}"
            )
        elif style == "empathetic":
            text = (
                f"Hello,\n\n{empathy_line} {subject_line}\n\n"
                f"{body_line}\n\n{next_step}\n\n"
                "We truly appreciate your patience while we work on this for you.\n\n"
                f"Warm regards,\nCustomer Care\nTicket reference: {ticket_id}"
            )
        else:  # concise
            text = (
                f"{subject_line}\n"
                f"- {body_line}\n"
                f"- {next_step}\n"
                f"Ticket reference: {ticket_id} — our team will follow up."
            )

        if simplify:
            text = self._simplify(text)
        if soften:
            text = self._soften(text)

        thought_bits.append(
            f"Policy self-check: no refund guarantees, no fault admission, no "
            f"SLA promises; ticket id {ticket_id} referenced for closure."
        )
        return {"text": text.strip(), "thought_process": " ".join(thought_bits)}

    @staticmethod
    def _subject(category: str, sentiment_score: float) -> str:
        topic = {
            "Billing": "your billing inquiry",
            "Technical Bug": "the technical issue you reported",
            "Feature Request": "your feature suggestion",
        }.get(category, "your request")
        prefix = (
            "Thank you for reaching out — we take your message seriously."
            if sentiment_score >= 7
            else "Thank you for contacting us."
        )
        return f"{prefix} This message concerns {topic}."

    @staticmethod
    def _empathy_line(sentiment_score: float, soften: bool) -> str:
        if sentiment_score >= 7:
            base = (
                "We completely understand how frustrating this situation is, "
                "and we are sorry for the inconvenience it has caused you."
            )
        elif sentiment_score >= 4:
            base = "We understand this has been inconvenient, and we want to help."
        else:
            base = "We appreciate you taking the time to write to us."
        if soften:
            base += " Please know there is no pressure on your side — we are here to help at your pace."
        return base

    @staticmethod
    def _body_line(category: str, verify_facts: bool) -> str:
        if verify_facts:
            return (
                "Our team is currently verifying the details of your account "
                "before confirming any specifics, so that we do not give you "
                "inaccurate information."
            )
        return {
            "Billing": (
                "Your billing concern has been logged and will be reviewed by "
                "our billing team, who will check the charges on your account."
            ),
            "Technical Bug": (
                "Our engineering team has been notified and is actively "
                "investigating the behavior you described."
            ),
            "Feature Request": (
                "Your suggestion has been shared with our product team, who "
                "review every request when planning upcoming releases."
            ),
        }.get(category, "Our team is looking into your request.")

    @staticmethod
    def _next_step(
        category: str, ticket_id: str, sentiment_score: float, be_specific: bool
    ) -> str:
        if sentiment_score >= 7:
            step = (
                "Because of the impact this has had on you, your case has been "
                "escalated to a senior specialist who will personally oversee it."
            )
        else:
            step = "A specialist from the responsible team has been assigned to your case."
        if be_specific:
            step += (
                f" Next step: the owning team reviews ticket {ticket_id} and "
                "replies to this email thread with an update; you do not need "
                "to take any action."
            )
        else:
            step += " You will receive an update on this email thread as soon as there is news."
        return step

    @staticmethod
    def _simplify(text: str) -> str:
        replacements = {
            "inconvenience": "trouble",
            "approximately": "about",
            "regarding": "about",
            "investigating": "checking",
            "additionally": "also",
            "personally oversee": "handle",
        }
        for long_word, simple in replacements.items():
            text = re.sub(long_word, simple, text, flags=re.IGNORECASE)
        return text

    @staticmethod
    def _soften(text: str) -> str:
        replacements = {
            "you must": "you may",
            "immediately": "as soon as works for you",
            "as soon as possible": "at a pace that suits you",
        }
        for hard, soft in replacements.items():
            text = re.sub(hard, soft, text, flags=re.IGNORECASE)
        return text

    # ------------------------------------------------------------------
    # Agent E: compliance scoring
    # ------------------------------------------------------------------
    def _compliance(self, prompt: str) -> dict:
        draft = _block(prompt, "DRAFT TEXT")
        ticket_id = _field(prompt, "TICKET_ID")
        sentiment_score = float(_field(prompt, "SENTIMENT_SCORE") or 5.0)

        score = 100
        violations: list[str] = []

        if FAULT_PATTERN.search(draft):
            score -= 40
            violations.append("admits fault/liability (policy rule 2)")
        if REFUND_PROMISE_PATTERN.search(draft):
            score -= 35
            violations.append("promises a refund outcome (policy rule 1)")
        if SLA_PATTERN.search(draft):
            score -= 25
            violations.append("promises a specific resolution time/SLA (policy rule 3)")
        if PII_PATTERN.search(draft):
            score -= 30
            violations.append("contains or requests sensitive PII (policy rule 4)")
        if AGGRESSIVE_PATTERN.search(draft):
            score -= 30
            violations.append("aggressive or dismissive tone (policy rule 6)")
        if JARGON_PATTERN.search(draft):
            score -= 10
            violations.append("technical jargon a layperson cannot follow (policy rule 7)")
        if sentiment_score >= 7.0 and "escalat" not in draft.lower():
            score -= 15
            violations.append(
                "high-anger ticket but draft does not mention escalation (policy rule 5)"
            )
        if ticket_id and ticket_id not in draft:
            score -= 10
            violations.append("does not reference the ticket ID (policy rule 8)")

        score = max(0, score)
        if violations:
            reasoning = (
                f"Score {score}/100. Violations detected: "
                + "; ".join(violations)
                + "."
            )
        else:
            reasoning = (
                f"Score {score}/100. Checked against all 8 policy rules: no "
                "refund guarantees, no fault admission, no SLA promises, no "
                "PII exposure, escalation acknowledged where required, "
                "respectful tone, plain language, and ticket ID referenced."
            )
        return {"score": score, "reasoning": reasoning}
