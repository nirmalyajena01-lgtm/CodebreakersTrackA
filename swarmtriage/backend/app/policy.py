"""Company policy used by Agent E (Compliance) when scoring drafts (SPEC §2.6)."""

COMPANY_POLICY = """\
COMPANY SUPPORT POLICY — all outbound customer replies MUST comply with every rule:

1. REFUNDS: Never promise or process a refund for purchases older than 90 days.
   For anything within 90 days, say the request "will be reviewed by our billing
   team" — never guarantee an outcome.
2. FAULT: Never admit fault, legal liability, or that the company "caused" a
   problem. Use neutral language such as "we are investigating" instead of
   "this was our fault".
3. SLA: Never promise specific resolution times or SLAs (e.g. "fixed within 24
   hours", "guaranteed by tomorrow"). Say the team is "prioritizing" the issue.
4. PII: Never include or request full card numbers, passwords, government IDs,
   or other sensitive personal data in a reply. Reference tickets and accounts
   only by their IDs.
5. ESCALATION: For customers with high-anger sentiment (score >= 7), the reply
   must acknowledge the frustration explicitly and state that the case has been
   escalated to a senior specialist.
6. TONE: Always be respectful, professional, and empathetic. Never blame the
   customer, never use aggressive, dismissive, or threatening language, and
   never tell the customer to "calm down".
7. CLARITY: Replies must be understandable to a non-technical reader. Avoid
   internal jargon, stack traces, and unexplained acronyms.
8. CLOSURE: Every reply must include a clear next step and reference the
   ticket ID so the customer knows what happens next.
"""
