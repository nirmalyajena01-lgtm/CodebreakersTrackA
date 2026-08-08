# AGENTS.md — SwarmTriage agent constitution

This file is the **agent rules / constitution** for the SwarmTriage
repo. It binds both the runtime agents in `backend/app/agents/` and the
humans/AIs contributing code. Companion documents: `docs/PRD.md`,
`docs/ARCHITECTURE.md`, `SPEC.md`, `SPEC_AUTH_ONBOARDING.md`.

---

## 1. Mission

Triage enterprise support tickets end-to-end — ingest → classify →
route → draft → compliance-check → human review — while learning from
every human rejection, and make every automated decision **traceable and
auditable**.

> **Prime directive:** A judge should be able to follow how a decision
> was made, see where a human approved it, and trust that nothing
> happened silently.

## 2. The Never-Silent Rule

**Every automated action MUST write an audit event.** No exceptions.

- Agents record via `BaseAgent.record()` → `state.append_audit()`
  (`{timestamp, agent, event, detail}`).
- The pipeline brackets every run with `pipeline_start` /
  `pipeline_complete`; a failure records `pipeline_error` and escalates
  the ticket — an error is an event, never a silent gap.
- System-level effects (swarm memory updates, onboarding escalations,
  plan completions) record `system` events.
- Provider or embedding fallbacks MUST emit a log warning. A fallback
  that happens without a trace is a defect.
- Any PR that adds an automated state change without a corresponding
  audit event will be rejected.

## 3. Agent roster and contracts

Agents are single-responsibility. They **never call each other
directly** — the pipeline (`agents/pipeline.py`) sequences them, and all
communication happens through the shared `TicketState` dict
(`backend/app/state.py`) plus the audit log (ADR-2).

### Agent A — Orchestrator (`agents/orchestrator.py`)
- **Responsibility:** intake validation and TicketState initialization.
- **MAY:** trim input; validate text length and email format; write
  `validation`; record `intake_validation`.
- **MAY NOT:** classify, draft, route, or modify any field outside
  `raw_text`, `customer_email`, `validation`.

### Agent B — Classifier (`agents/classifier.py`)
- **Responsibility:** category + sentiment, each with a reasoning string.
- **MAY:** set `category`, `category_reasoning`, `sentiment`,
  `sentiment_score` (clamped 0.0–10.0), `sentiment_reasoning`; default
  unrecognized LLM output to `Billing`/`Neutral` *with an explanatory
  reasoning string*.
- **MAY NOT:** route, draft, or silently accept malformed LLM output —
  every fallback must say so in the stored reasoning.

### Agent C — Router (`agents/router.py`)
- **Responsibility:** assign the approver; escalate high-anger tickets.
- **MAY:** set `assigned_approver` from `config.ROUTING_TABLE`; append
  the CC-vp_support escalation note to `routing_reasoning` when
  `sentiment_score ≥ 7.0`; record `routing`.
- **MAY NOT:** change category/sentiment, send any real email, or
  escalate without writing it into the reasoning.

### Agent D — Drafter (`agents/drafter.py`)
- **Responsibility:** produce exactly 3 drafts (formal / empathetic /
  concise), adapted by past rejection feedback.
- **MUST:** call `retrieve_relevant_feedback()` **before** drafting and
  store results in `rag_feedback_used`; when feedback exists, every
  draft's `thought_process` MUST mention the applied feedback.
- **MAY NOT:** draft before retrieval; drop retrieved feedback; produce
  fewer/more than 3 styles; approve or delete anything.

### Agent E — Compliance (`agents/compliance.py`)
- **Responsibility:** score each draft 0–100 against
  `policy.py::COMPANY_POLICY`; gate at threshold 80.
- **MAY:** set `compliance_score`, `compliance_reasoning`,
  `compliance_passed`; set `final_status` to `pending_review` (≥1 pass)
  or `escalated` (all fail); record `compliance_check` with per-draft
  detail.
- **MAY NOT:** edit or delete drafts; lower the threshold; approve a
  ticket (only humans approve); suppress a failing score from the audit
  detail.

### Onboarding Coordinator (`agents/onboarding.py`)
- **Responsibility:** generate role-specific onboarding plans, track
  task status, escalate blocked/overdue tasks.
- **MAY:** generate tasks from role templates (or Gemini when that
  provider is active, with template fallback); record
  `generation_reasoning`; transition task status; escalate blocked tasks
  immediately and overdue tasks once per task to
  `hr_manager@company.com`; mark plans completed; maintain the per-plan
  timeline (`coordinator`/`system` agents).
- **MAY NOT:** set a task to `blocked` without a `blocker_reason`;
  escalate without an `escalations` entry AND a timeline event;
  auto-escalate the same overdue task twice; touch ticket state.

## 4. Human-in-the-loop rule

**Only humans approve.** `final_status = "approved"` is reachable
exclusively through `POST /api/approve`, which stamps
`human_approval_timestamp` and writes a `human` audit event (including
any human edit of the draft). Agents may recommend, score, and escalate —
they may never approve, send, or delete. Rejection feedback
(`POST /api/reject`) is likewise a `human` event.

## 5. Memory rules

- Every rejection reason is embedded and persisted to
  `backend/data/swarm_memory.json`. **Rejection feedback is never
  silently discarded** — storing it is itself an audit event
  (`swarm_memory_update`).
- Retrieval must prefer same-category feedback ranked by cosine
  similarity; degradation to recency order is allowed only on embedding
  failure and must be logged.
- The Drafter's use of memory must be visible in `rag_feedback_used`
  and in draft `thought_process` strings.

## 6. Provider rules

- `mock` is the default provider; the app must boot and pass the full
  pipeline with `LLM_PROVIDER=mock` and no network.
- Providers (`mock`, `kimi`, `gemini`, `zai`) implement
  `complete_json(system, prompt) -> dict` and **must never raise** — on
  any failure: log a warning, fall back to MockLLM.
- The embedding backend follows the same rule (sentence-transformers →
  hashing fallback, logged).
- No provider or model name may appear in the UI.

## 7. Coding rules for contributors

1. **Contracts are sacred.** `SPEC.md` and `SPEC_AUTH_ONBOARDING.md`
   define exact shapes (TicketState, audit response keys, endpoint
   tables). Code must match them; if reality must change, change the
   SPEC in the same PR.
2. **Never-silent applies to code too:** any new automated behavior
   needs an audit event and, where relevant, a stored reasoning string.
3. **Style:** warm editorial, var-driven palette — all color through CSS
   variables (`index.css`), automatic light/dark via
   `prefers-color-scheme`; **no demo labeling or pills in the UI**.
4. **No placeholders or TODOs in delivered code** (SPEC §7); the backend
   must import cleanly (`python -c "from app.main import app"`).
5. **Persistence** uses the established atomic JSON-snapshot pattern
   (tmp + `replace`), saved on every mutation.
6. Keep changes minimal and within the owning module; docs in `docs/`,
   agents in `backend/app/agents/`, providers in `backend/app/llm/`,
   skills in `skills/`.
