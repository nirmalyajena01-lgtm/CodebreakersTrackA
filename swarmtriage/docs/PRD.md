# PRD — SwarmTriage: Adaptive Enterprise Support Automation

BMAD-style Product Requirements Document. Companion documents:
`docs/ARCHITECTURE.md` (technical design + decision log), `AGENTS.md`
(agent constitution), `AGENTS_AND_SKILLS.md` (custom agents/skills
checkpoint). Implementation contracts live in `SPEC.md` and
`SPEC_AUTH_ONBOARDING.md`; every acceptance criterion below maps to
behavior that exists in the repo.

- **Track:** Hackathon Track A — Business Process Automation
- **Status:** All stories complete (see Story Trail, §9)
- **Version:** 0.1.0 (`backend/app/main.py`)

---

## 1. Problem statement

Enterprise support teams drown in inbound tickets. Triage is manual,
replies are inconsistent with company policy, and — worst of all — the
moment any automation is introduced, nobody can answer *"why did the
system do that?"* Existing helpdesk automation fails in three ways:

1. **Opacity.** Automated decisions are invisible; managers cannot audit
   how a reply was produced or who approved it.
2. **No learning.** When a human rejects a machine-drafted reply, the
   feedback evaporates; the same mistake recurs on the next ticket.
3. **Fragility.** Systems hard-depend on a single LLM API; a missing key
   or network error takes the whole pipeline down mid-demo (or
   mid-incident).

SwarmTriage is a five-agent AI swarm that triages tickets end-to-end
(ingest → classify → route → draft → compliance-check → human review)
with an **Adaptive Rejection Learning Loop** and a hard rule:
**nothing happens silently** — every automated step writes a timestamped
audit event a judge or manager can replay.

## 2. Goals and metrics

| # | Goal | Metric | How verified |
|---|---|---|---|
| G1 | Fully automated triage of an inbound ticket | One `POST /api/submit` returns a complete TicketState with category, sentiment, approver, 3 drafts, compliance scores | `POST /api/submit` → fields populated by agents A–E |
| G2 | Learn from every human rejection | Rejected feedback is retrievable by the Drafter on the *next* similar ticket; drafts visibly adapt | `rag_feedback_used` non-empty after a rejection; draft `thought_process` mentions applied feedback (demonstrated by `SEED_DATA.py`) |
| G3 | Total traceability | Every state change has an audit event; a full narrative is one API call away | `GET /api/audit/{ticket_id}` returns reasoning strings + `timeline` |
| G4 | Human-in-the-loop on all outbound replies | No draft reaches "approved" without a human action | `final_status == "approved"` only via `POST /api/approve`, which appends a `human` audit event |
| G5 | Degrade, never die | The stack boots and demos with zero API keys and no model downloads | default `LLM_PROVIDER=mock`; hashing-embedding fallback; `docker compose up --build` works offline |
| G6 | Demo-ability for judges | One command to a seeded, working system | `docker compose up --build` (auto-seeds on first boot) or `python SEED_DATA.py` |

## 3. Personas

| Persona | Needs | Served by |
|---|---|---|
| **Customer** (external, role `customer`) | Submit a ticket, see its status | Auth signup (`POST /api/auth/signup`), New Ticket + My Tickets tabs |
| **Support manager / approver** (role `employee`) | A prioritized review queue, compliant drafts to approve/edit/reject, visible escalation of angry tickets | Review Queue tab; `/api/queue` sorted by `sentiment_score` desc; approve/reject endpoints |
| **HR / onboarding coordinator** (role `employee`) | Role-specific new-hire plans, automatic escalation of blocked/overdue tasks | Onboarding tab; `/api/onboarding/*` endpoints |
| **Hackathon judge** | Proof the system works, proof it is auditable, proof nothing happened silently | Audit Trail tab, `GET /api/audit/{id}`, `docs/ARCHITECTURE.md`, the `ticket-audit-walkthrough` skill |

## 4. Scope

### In scope
- Synchronous five-agent triage pipeline (agents A–E) over a shared
  TicketState.
- Adaptive Rejection Learning Loop: reject → embed → persist → retrieve
  → visibly adapted re-draft.
- Compliance scoring of every draft against an 8-rule company policy
  with an escalation path when all drafts fail.
- Full per-ticket audit timeline + audit narrative endpoint + Audit
  Trail UI.
- Captcha-gated signup/login with bearer sessions and two roles
  (customer / employee).
- Onboarding coordinator: plan generation (template or Gemini), task
  tracking, blocked/overdue escalations to HR, per-plan timeline.
- Pluggable LLM providers (mock default; kimi; gemini; z-ai) with
  automatic fallback to mock.
- Docker Compose deployment; static `demo/` build; CI smoke test.

### Out of scope (explicitly deferred)
- Multi-tenant data isolation, RBAC beyond the two roles.
- Real email delivery (approver routing is recorded, not sent).
- Durable database (JSON snapshots are the persistence layer).
- Async/queued pipeline (pipeline runs synchronously per SPEC §2.5).
- Production-grade password hashing (SHA-256, hackathon-grade, noted in
  README).
- Per-agent LLM model selection (one provider per process).

## 5. Traceability principle (product-level requirement)

> Every automated step is traceable and auditable. A judge should be
> able to follow how a decision was made, see where a human approved it,
> and trust that nothing happened silently.

Product consequences:
- Every agent action appends `{timestamp, agent, event, detail}` to the
  ticket's audit timeline (`state.append_audit`).
- Reasoning is stored as data, not just logs: `category_reasoning`,
  `sentiment_reasoning`, `routing_reasoning`, draft `thought_process`,
  `compliance_reasoning`, onboarding `generation_reasoning`.
- Human actions are first-class timeline events (`agent: "human"` for
  approvals and rejections).
- Provider fallback and embedding fallback emit log warnings; a pipeline
  failure escalates the ticket and records a `pipeline_error` event —
  errors never disappear.
- Rejection feedback is persisted in swarm memory and never silently
  discarded.

## 6. Epics and stories

Acceptance criteria reference concrete endpoints, files, and fields.

### E1 — Ticket triage swarm

**E1.S1 — Intake validation (Agent A).**
*As a manager, malformed tickets are caught and recorded.*
- AC1: `POST /api/submit` with `{raw_text, customer_email}` runs the
  pipeline synchronously and returns a full TicketState.
- AC2: Agent A (`backend/app/agents/orchestrator.py`) flags empty/short
  text (< 10 chars) and malformed emails into
  `validation = {valid, errors}` and records an `intake_validation`
  audit event.

**E1.S2 — Classification + sentiment (Agent B).**
*As a manager, every ticket is categorized and urgency-scored with
visible reasoning.*
- AC1: `category` ∈ {Billing, Technical Bug, Feature Request} with
  `category_reasoning`; unrecognized LLM output defaults to Billing with
  an explanatory reasoning string.
- AC2: `sentiment` ∈ {Anger, Neutral, Happy}, `sentiment_score` clamped
  to 0.0–10.0, with `sentiment_reasoning`; both steps audit-logged by
  `backend/app/agents/classifier.py`.

**E1.S3 — Routing + escalation (Agent C).**
*As a manager, tickets reach the right approver; furious customers are
escalated.*
- AC1: Routing table (Billing→finance_manager@, Technical
  Bug→engineering_lead@, Feature Request→product_manager@company.com)
  sets `assigned_approver` with `routing_reasoning`
  (`backend/app/agents/router.py`, `config.ROUTING_TABLE`).
- AC2: `sentiment_score ≥ 7.0` CCs `vp_support@company.com` and the
  escalation is stated in the routing reasoning.

**E1.S4 — Adaptive drafting (Agent D).**
*As a manager, I get three stylistically distinct, policy-aware replies.*
- AC1: Drafter (`backend/app/agents/drafter.py`) calls
  `retrieve_relevant_feedback()` **before** drafting and stores results
  in `rag_feedback_used`.
- AC2: Exactly 3 drafts — formal / empathetic / concise — each with a
  `thought_process` that mentions any applied feedback.

**E1.S5 — Compliance gate (Agent E).**
*As a manager, non-compliant drafts never reach customers.*
- AC1: Each draft scored 0–100 against `policy.py::COMPANY_POLICY` (8
  rules); `< 80` ⇒ `compliance_passed = False`
  (`backend/app/agents/compliance.py`, `config.COMPLIANCE_THRESHOLD`).
- AC2: All drafts failing ⇒ `final_status = "escalated"`; otherwise
  `"pending_review"`.

**E1.S6 — Review queue.**
- AC1: `GET /api/queue` returns `pending_review` + `escalated` tickets
  sorted by `sentiment_score` descending.
- AC2: Frontend Review Queue tab polls `/api/queue` every 5 s and shows
  sentiment heat badges (red ≥ 7, orange 4–6.9, green < 4).

### E2 — Adaptive rejection learning

**E2.S1 — Feedback capture.**
- AC1: `POST /api/reject` with `{ticket_id, reason, free_text?}` appends
  to `rejection_feedback_log` and writes a `human` audit event.

**E2.S2 — Persistent swarm memory.**
- AC1: Feedback is stored via
  `memory/swarm_memory.py::update_swarm_memory()` and persisted to
  `backend/data/swarm_memory.json` (survives restarts; loaded on
  startup).
- AC2: A `swarm_memory_update` audit event records the embedding.

**E2.S3 — RAG-adapted re-drafting.**
- AC1: Rejection triggers `rerun_drafter_and_compliance()`; retrieval
  ranks same-category entries by cosine similarity and fills remaining
  slots with cross-category entries above a 0.1 similarity threshold
  (top_k = 3).
- AC2: New drafts visibly adapt and their `thought_process` cites the
  feedback — demonstrable via `SEED_DATA.py` (rejects with "Too
  aggressive" and "Too complex", then re-submits a similar angry billing
  ticket).

### E3 — Audit & traceability

**E3.S1 — Audit narrative endpoint.**
- AC1: `GET /api/audit/{ticket_id}` returns the SPEC §3 shape:
  classification/routing reasoning, sentiment score + reasoning, per-draft
  thought processes, per-draft compliance scores/reasoning, human
  approval timestamp, rejection log, final status, and the full
  `timeline`.

**E3.S2 — Never-silent pipeline.**
- AC1: `run_pipeline()` wraps agents A→E in a failure handler: any
  exception ⇒ `final_status = "escalated"` plus a `pipeline_error` audit
  event; `pipeline_start`/`pipeline_complete` events bracket every run.

**E3.S3 — Audit Trail UI.**
- AC1: Employee Audit Trail tab renders the vertical timeline with
  reasoning strings, scores, and timestamps
  (`frontend/src/components/AuditTrail.jsx`).

**E3.S4 — Judge-facing walkthrough skill.**
- AC1: `skills/ticket-audit-walkthrough/SKILL.md` defines a reusable
  procedure turning `/api/audit` output into a cited narrative; missing
  events are marked TRACE GAP, never invented.

### E4 — Auth & roles

**E4.S1 — Captcha-gated accounts.**
- AC1: `GET /api/auth/captcha` returns `{captcha_id, svg}` — 5-char SVG,
  no ambiguous 0/O/1/I, 10-minute validity, single-use, case-insensitive
  verify (`backend/app/auth/captcha.py`).
- AC2: `POST /api/auth/signup` (role always `customer`) and
  `POST /api/auth/login` validate the captcha first (400 bad captcha,
  401 bad credentials, 400 duplicate email).

**E4.S2 — Sessions + roles.**
- AC1: Bearer tokens (`Authorization: Bearer <uuid4>`); `GET
  /api/auth/me` returns the user.
- AC2: Passwords SHA-256-hashed; users + tokens persisted to
  `backend/data/auth.json` (`backend/app/auth/store.py`).
- AC3: Employee `codebreaker@test.com` / `codebreaker` seeded on first
  boot; UI gates tabs by role (customer: New Ticket, My Tickets;
  employee: Review Queue, Audit Trail, Onboarding).

### E5 — Onboarding coordinator

**E5.S1 — Plan generation.**
- AC1: `POST /api/onboarding/plans` `{hire_name, role, start_date,
  notes?}` creates a plan with 8–10 role-specific tasks (templates for
  Support Agent / Engineer / Finance Analyst / People Ops / Sales Rep in
  `backend/app/agents/onboarding.py`).
- AC2: With `LLM_PROVIDER=gemini`, task generation tries the LLM first
  with template fallback; every plan records `generation_reasoning`.

**E5.S2 — Task tracking + escalation.**
- AC1: `POST /api/onboarding/tasks/{task_id}/status` transitions
  pending → in_progress → done; `blocked` requires `blocker_reason`
  (400 otherwise).
- AC2: A task newly set to `blocked` immediately escalates to
  `hr_manager@company.com`; overdue not-done tasks auto-escalate once
  per task on plan reads (`sweep_overdue`).
- AC3: Plan status becomes `completed` when all tasks are done (and
  reopens if a task moves out of done).

**E5.S3 — Plan audit trail.**
- AC1: `GET /api/onboarding/audit/{plan_id}` returns `{plan_id,
  timeline, escalations, status}`; timeline agents labeled
  `coordinator`/`system`.
- AC2: Plans persist to `backend/data/onboarding.json`.

### E6 — Ops & demo-ability

**E6.S1 — One-command deployment.**
- AC1: `docker compose up --build` starts backend (:8000) and frontend
  (:5173) on a shared bridge network; backend auto-seeds via
  `entrypoint.sh` when the ticket DB is empty; browser calls stay
  same-origin via the Vite proxy (`VITE_BACKEND_URL=http://backend:8000`).
- AC2: JSON snapshots live in the `backend-data` volume.

**E6.S2 — Offline determinism.**
- AC1: Default `LLM_PROVIDER=mock` runs the entire pipeline with zero
  external calls (`backend/app/llm/mock.py`).
- AC2: Swarm memory falls back to a deterministic 256-dim pure-numpy
  hashing embedder when sentence-transformers is unavailable
  (`backend/app/memory/embeddings.py`).

**E6.S3 — Real-provider options.**
- AC1: `LLM_PROVIDER=kimi|gemini|zai` select Kimi (Moonshot), Gemini, or
  z-ai GLM providers (`backend/app/llm/kimi.py`, `gemini.py`, `zai.py`);
  any failure logs a warning and falls back to MockLLM.

**E6.S4 — Static demo + seeds.**
- AC1: `demo/` builds a static, backend-free variant whose `src/api.js`
  simulates the full pipeline in-browser (`npm run build` → `demo/dist/`).
- AC2: `python SEED_DATA.py` seeds 5 tickets, 1 approval, 2 rejections
  ("Too aggressive", "Too complex"), a RAG-demo resubmission, and an
  Ava Chen onboarding plan with a blocked task → escalation.

**E6.S5 — Green CI.**
- AC1: `.github/workflows/ci.yml` runs `tests/smoke_test.py` on push —
  backend imports cleanly and the mock pipeline completes end-to-end.

## 7. Non-functional requirements

| ID | Requirement | Implementation |
|---|---|---|
| NFR1 | **No silent actions.** Every automated step writes an audit event; every provider/embedding fallback logs a warning. | `state.append_audit`; logger warnings in `kimi.py`, `gemini.py`, `zai.py`, `embeddings.py` |
| NFR2 | **Degrade, never die.** Any LLM/embedding failure falls back to deterministic behavior; the pipeline escalates rather than crashes. | MockLLM fallback in every provider; hashing embedder; `pipeline_error` handler |
| NFR3 | **Human-only approval.** `final_status = "approved"` is reachable only via `POST /api/approve`, which stamps `human_approval_timestamp` and a `human` audit event. | `api/routes.py::approve_ticket` |
| NFR4 | **Durability of memory.** Rejection feedback, tickets, users, and plans survive restarts via atomic JSON snapshots (tmp + replace). | `state.save`, `swarm_memory._persist`, `auth/store`, `onboarding.save` |
| NFR5 | **Determinism by default.** Mock provider + hashing embeddings make CI, demos, and grading reproducible offline. | `config.LLM_PROVIDER` default `mock` |
| NFR6 | **Single source of truth.** Contracts in `SPEC.md` / `SPEC_AUTH_ONBOARDING.md` are sacred; code and docs must match them. | SPEC files; this PRD's ACs cite them |

## 8. Success criteria for the hackathon entry

All five entry criteria are satisfied — see `README.md` §"Hackathon
entry criteria" for the checkpoint → path map.

## 9. Story trail (implementation status)

BMAD convention: each story carries a final status verified against the
repo (not aspiration). Status values: **Done**.

| Story | Status | Evidence |
|---|---|---|
| E1.S1 Intake validation | Done | `backend/app/agents/orchestrator.py`; `POST /api/submit` |
| E1.S2 Classification + sentiment | Done | `backend/app/agents/classifier.py` (default-to-Billing guard, score clamp) |
| E1.S3 Routing + escalation | Done | `backend/app/agents/router.py`; `config.ROUTING_TABLE`, threshold 7.0 |
| E1.S4 Adaptive drafting | Done | `backend/app/agents/drafter.py` (RAG-first, 3 styles) |
| E1.S5 Compliance gate | Done | `backend/app/agents/compliance.py`; threshold 80; all-fail → escalated |
| E1.S6 Review queue | Done | `GET /api/queue`; `frontend/src/components/ReviewQueue.jsx` (5 s poll) |
| E2.S1 Feedback capture | Done | `POST /api/reject` → `rejection_feedback_log` + human audit event |
| E2.S2 Persistent swarm memory | Done | `backend/app/memory/swarm_memory.py`; `backend/data/swarm_memory.json` |
| E2.S3 RAG-adapted re-drafting | Done | `rerun_drafter_and_compliance()`; `SEED_DATA.py` RAG demo |
| E3.S1 Audit narrative endpoint | Done | `GET /api/audit/{ticket_id}` (SPEC §3 keys) |
| E3.S2 Never-silent pipeline | Done | `backend/app/agents/pipeline.py` (`pipeline_start/error/complete`) |
| E3.S3 Audit Trail UI | Done | `frontend/src/components/AuditTrail.jsx` |
| E3.S4 Walkthrough skill | Done | `skills/ticket-audit-walkthrough/SKILL.md` |
| E4.S1 Captcha-gated accounts | Done | `backend/app/auth/captcha.py`; `api/auth_routes.py` |
| E4.S2 Sessions + roles | Done | `backend/app/auth/store.py`; seeded employee; role-gated tabs |
| E5.S1 Plan generation | Done | `backend/app/agents/onboarding.py` (templates + Gemini path) |
| E5.S2 Task tracking + escalation | Done | `set_task_status`, `_escalate`, `sweep_overdue` |
| E5.S3 Plan audit trail | Done | `GET /api/onboarding/audit/{plan_id}` |
| E6.S1 One-command deployment | Done | `docker-compose.yml`; `backend/entrypoint.sh` |
| E6.S2 Offline determinism | Done | `llm/mock.py`; `memory/embeddings.py` hashing fallback |
| E6.S3 Real-provider options | Done | `llm/kimi.py`, `llm/gemini.py`, `llm/zai.py` |
| E6.S4 Static demo + seeds | Done | `demo/`; `backend/SEED_DATA.py` |
| E6.S5 Green CI | Done | `.github/workflows/ci.yml`; `tests/smoke_test.py` |
