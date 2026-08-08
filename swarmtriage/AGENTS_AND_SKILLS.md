# AGENTS_AND_SKILLS.md — custom agents & skills checkpoint

Hackathon entry checkpoint #4: at least one custom agent **and** one
custom skill, committed and documented. SwarmTriage ships six custom
agents and one custom skill.

## Custom agents

| Agent | File | Responsibility | Audit behavior |
|---|---|---|---|
| A — Orchestrator | `backend/app/agents/orchestrator.py` | Intake validation (text length, email format) + TicketState init | `intake_validation` event incl. failure details |
| B — Classifier | `backend/app/agents/classifier.py` | Category + sentiment (0–10) with reasoning strings; safe defaults for malformed LLM output | `classification` + `sentiment_analysis` events with full reasoning |
| C — Router | `backend/app/agents/router.py` | Approver assignment per routing table; CC escalation at sentiment ≥ 7 | `routing` event stating table mapping + escalation note |
| D — Drafter | `backend/app/agents/drafter.py` | RAG retrieval FIRST, then 3 drafts (formal/empathetic/concise) adapted to past rejection feedback | `rag_retrieval` + `drafting` events; feedback quoted in `rag_feedback_used` and `thought_process` |
| E — Compliance | `backend/app/agents/compliance.py` | Scores drafts 0–100 vs 8-rule policy; threshold 80; all-fail → escalated | `compliance_check` event with per-draft score/pass/reasoning |
| Onboarding Coordinator | `backend/app/agents/onboarding.py` | Role-specific plan generation (template or Gemini), task tracking, blocked/overdue escalation to hr_manager@company.com | Per-plan `timeline` (agents `coordinator`/`system`) + `escalations` entries + `generation_reasoning` |

All five ticket agents extend `backend/app/agents/base.py`
(`BaseAgent.record()` → `state.append_audit()`), share one TicketState
per ticket, and are sequenced by `backend/app/agents/pipeline.py`
(which adds `pipeline_start` / `pipeline_error` / `pipeline_complete`
system events).

## Custom skill

| Skill | Path | Purpose | How it is exercised |
|---|---|---|---|
| ticket-audit-walkthrough | `skills/ticket-audit-walkthrough/SKILL.md` | Reusable procedure + output template that turns `GET /api/audit/{ticket_id}` (or `/api/onboarding/audit/{plan_id}`) into a judge-facing, fully cited walkthrough with marked human checkpoints, escalations, fallbacks, and a trust statement; missing events are flagged TRACE GAP, never invented | Point it at any seeded ticket (e.g. an angry billing ticket rejected via "Too aggressive"): it walks the timeline produced by the same audit trail the demo's Audit Trail tab renders — classification → routing escalation → drafts → compliance → human rejection → swarm-memory update → RAG-adapted re-draft |

## Verification

```bash
# Agents: full pipeline runs offline with the default mock provider
cd backend && uvicorn app.main:app --port 8000 &
curl -s -X POST localhost:8000/api/submit \
  -H 'Content-Type: application/json' \
  -d '{"raw_text":"I am furious, you charged my credit card twice for this invoice!","customer_email":"jane@example.com"}' \
  | python -m json.tool          # category, sentiment, approver, 3 scored drafts

# Audit trail for that ticket (agents A–E + system events, in order)
curl -s localhost:8000/api/audit/<ticket_id> | python -m json.tool

# Rejection learning loop + coordinator
python SEED_DATA.py              # 5 tickets, 1 approval, 2 rejections, RAG demo, Ava Chen plan
curl -s localhost:8000/api/onboarding/plans | python -m json.tool
curl -s localhost:8000/api/onboarding/audit/<plan_id> | python -m json.tool

# Skill: read the contract, then follow it against a real ticket
cat ../skills/ticket-audit-walkthrough/SKILL.md

# CI runs the equivalent smoke test on every push
cat ../.github/workflows/ci.yml && python ../tests/smoke_test.py
```
