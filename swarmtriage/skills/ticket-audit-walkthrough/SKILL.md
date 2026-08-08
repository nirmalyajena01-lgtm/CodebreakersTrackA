---
name: ticket-audit-walkthrough
description: >-
  Produce a judge-facing audit walkthrough of an automated decision in
  SwarmTriage. Use when asked to explain, demonstrate, or verify how a
  ticket (or onboarding plan) was processed — e.g. "show me how this
  ticket was triaged", "prove nothing happened silently", "walk the
  judge through the decision trail". Turns the raw /api/audit timeline
  into a cited narrative with a marked human-approval checkpoint.
---

# Ticket Audit Walkthrough

Generate a narrative walkthrough of one ticket's (or onboarding plan's)
automated decision trail, grounded strictly in the audit API. Every
claim must cite a timeline event; anything missing is a TRACE GAP, not
an invitation to invent.

## Inputs

- `ticket_id` — a ticket UUID from `GET /api/tickets`, **or**
- `plan_id` — an onboarding plan UUID from `GET /api/onboarding/plans`
- `base_url` — backend URL (default `http://localhost:8000`)

If the caller gives neither id, list available tickets/plans first and
ask them to pick one (a seeded angry billing ticket showcases the full
loop: classification, escalation, rejection, RAG re-draft).

## Procedure

1. **Fetch the audit record.**
   - Ticket: `GET {base_url}/api/audit/{ticket_id}` → narrative fields +
     `timeline`.
   - Plan: `GET {base_url}/api/onboarding/audit/{plan_id}` → `timeline`
     + `escalations` + `status`.
2. **Order the timeline** chronologically by `timestamp` (the API
   returns append order; verify it is monotonic — flag if not).
3. **Annotate each agent's reasoning.** For every event, state: which
   agent acted (`A`–`E`, `coordinator`, `system`, `human`), what it
   decided, and the reasoning it recorded — pull the matching stored
   reasoning field (`category_reasoning`, `sentiment_reasoning`,
   `routing_reasoning`, per-draft `thought_process`,
   `compliance_reasoning`, `generation_reasoning`) rather than
   paraphrasing beyond it.
4. **Mark the human checkpoint(s).** Locate `agent: "human"` events
   (`approval`, `rejection`). State explicitly that no `approved` status
   exists without a human event, and quote `human_approval_timestamp`.
   If `final_status` is `approved` but no human event exists → TRACE
   GAP (this should never happen; NFR3).
5. **Flag escalations.** Highlight: sentiment ≥ 7 CC escalations (in
   `routing_reasoning`), all-drafts-failed compliance escalations
   (`final_status = escalated`), `pipeline_error` events, and onboarding
   blocked/overdue escalations with their `escalated_to` target.
6. **Flag fallbacks.** Note any fallback evidence: mock-provider
   reasoning strings, "defaulted to Billing", template-generation
   reasoning, recency-order retrieval — fallbacks are expected and
   legitimate, but must be visible.
7. **Render the narrative** in the output format below.

## Output format

```markdown
# Audit Walkthrough — <ticket_id|plan_id> (<final_status|status>)

## Decision Summary
One paragraph: what came in, what the swarm decided, where a human
stepped in, final state. Every fact here must reappear cited below.

## Automated Steps
| # | Time | Agent | Event | What it decided | Reasoning (cited) |
|---|------|-------|-------|-----------------|-------------------|
One row per non-human timeline event, in chronological order.

## Human Checkpoints
Each human event with timestamp, action (approve/reject), chosen draft
style or rejection reason, and any edited text / free-text feedback.

## Escalations & Fallbacks
Bulleted: routing escalations, compliance escalations, pipeline errors,
onboarding escalations, provider/embedding fallbacks — each citing its
timeline event.

## Trust Statement
Closing paragraph: assert that each automated step above is backed by a
timestamped audit event, that approval required a human, and that
nothing happened silently — **only if** the walkthrough contains zero
TRACE GAPs. Otherwise state exactly which steps could not be traced.
```

## Quality rules

1. **Every claim cites a timeline event** (by `#` row, timestamp, or
   event name). No uncited assertions about what an agent did.
2. **Never invent.** If an expected event is absent (e.g. no
   `rag_retrieval` event but `rag_feedback_used` is non-empty), write
   `TRACE GAP: <what is missing>` at that point and continue.
3. **Quote reasoning verbatim** where possible; summarize only when the
   detail string is long, and mark summaries as such.
4. **Do not editorialize** about model quality or intent; report what
   the record shows.
5. If any TRACE GAP exists, the Trust Statement must name it — a
   walkthrough with gaps must not conclude "nothing happened silently".
