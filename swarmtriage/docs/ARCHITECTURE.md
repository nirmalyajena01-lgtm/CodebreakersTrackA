# ARCHITECTURE.md — SwarmTriage architecture checkpoint

Architecture document for the hackathon entry checkpoint. Contracts:
`SPEC.md` (core), `SPEC_AUTH_ONBOARDING.md` (auth/onboarding/Gemini).
Product rationale: `docs/PRD.md`. Agent rules: `AGENTS.md`.

---

## 1. High-level design

```
                        ┌──────────────────────────────────────────────┐
 Browser (same-origin)  │  frontend/  React 18 + Vite 5 + Tailwind 3   │
   /api ──────────────► │  role-gated dashboard: New Ticket / My       │
   (Vite dev proxy to   │  Tickets / Review Queue / Audit Trail /      │
   VITE_BACKEND_URL)    │  Onboarding + AuthScreen (captcha)           │
                        └──────────────┬───────────────────────────────┘
                                       │ HTTP, prefix /api
                        ┌──────────────▼───────────────────────────────┐
                        │  backend/  FastAPI + Uvicorn (app/main.py)   │
                        │  api/routes.py  api/auth_routes.py           │
                        │  api/onboarding_routes.py                    │
                        └───────┬───────────────────┬──────────────────┘
                                │                   │
              ┌─────────────────▼───────┐   ┌───────▼──────────────────┐
              │   SWARM CORE            │   │  ONBOARDING COORDINATOR  │
              │   agents/pipeline.py    │   │  agents/onboarding.py    │
              │   A orchestrator.py     │   │  templates / Gemini gen  │
              │   B classifier.py       │   │  task tracking, blocked/ │
              │   C router.py           │   │  overdue escalations,    │
              │   D drafter.py          │   │  per-plan timeline       │
              │   E compliance.py       │   └───────┬──────────────────┘
              └───────┬────────────┬────┘           │
                      │            │                │
        ┌─────────────▼──┐   ┌─────▼────────────────▼───┐
        │ LLM PROVIDERS  │   │  SHARED STATE + MEMORY   │
        │ llm/factory.py │   │  state.py: tickets +     │
        │ mock (default) │   │  audit_log (per ticket)  │
        │ kimi  gemini   │   │  memory/swarm_memory.py: │
        │ zai  ── all    │   │  rejection feedback +    │
        │ fall back to   │   │  embeddings (MiniLM /    │
        │ mock, logged   │   │  numpy hashing fallback) │
        └────────────────┘   └───────────┬──────────────┘
                                         │ atomic JSON snapshots
                             ┌───────────▼──────────────┐
                             │ backend/data/:           │
                             │ tickets.json             │
                             │ swarm_memory.json        │
                             │ auth.json                │
                             │ onboarding.json          │
                             └──────────────────────────┘
```

One request lifecycle: `POST /api/submit` → `new_ticket_state()` →
`run_pipeline()` runs agents A→E **synchronously**, each mutating the
same TicketState dict and appending audit events → snapshot saved → full
TicketState returned. Rejection re-runs D→E only
(`rerun_drafter_and_compliance()`).

## 2. Stack

| Layer | Technology | Where |
|---|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn, Pydantic v2 | `backend/app/` |
| LLM | Pluggable providers behind `complete_json(system, prompt) -> dict`: `mock` (deterministic, default), `kimi` (OpenAI-compatible, Moonshot), `gemini` (REST, no SDK), `zai` (GLM) | `backend/app/llm/` |
| Vector memory | sentence-transformers `all-MiniLM-L6-v2` (lazy import, optional) with pure-numpy 256-dim hashing fallback | `backend/app/memory/embeddings.py` |
| Frontend | React 18, Vite 5, Tailwind CSS 3 | `frontend/` |
| Static demo | Same UI, in-browser simulated pipeline (no server) | `demo/` |
| Auth | SHA-256 password hashes (hackathon-grade), uuid4 bearer tokens, SVG captcha | `backend/app/auth/` |
| Persistence | Atomic JSON snapshots (write tmp + `replace`) | `backend/data/` |
| Orchestration | docker-compose: backend :8000, frontend :5173, `backend-data` volume, `swarmnet` bridge | `docker-compose.yml` |
| CI | GitHub Actions smoke test | `.github/workflows/ci.yml`, `tests/smoke_test.py` |

## 3. Data model

### 3.1 TicketState (SPEC §2.1 — one dict per ticket in `state.tickets`)

| Field | Type | Meaning |
|---|---|---|
| `ticket_id` | str (uuid4 hex) | Primary key; referenced in every reply draft (policy rule 8) |
| `raw_text` | str | Customer message (trimmed by Agent A) |
| `customer_email` | str | Submitter email (format-validated by Agent A) |
| `ingestion_timestamp` | str (ISO 8601 UTC) | Creation time; used for newest-first sorting |
| `validation` | `{valid: bool, errors: [str]}` | Agent A intake result (empty/short text, bad email) |
| `category` | str \| None | `Billing` / `Technical Bug` / `Feature Request` (unrecognized LLM output → `Billing` + explanatory reasoning) |
| `category_reasoning` | str \| None | Agent B's why |
| `sentiment` | str \| None | `Anger` / `Neutral` / `Happy` |
| `sentiment_score` | float \| None | 0.0–10.0 (clamped, 1 decimal); higher = angrier; drives queue order and escalation |
| `sentiment_reasoning` | str \| None | Agent B's why |
| `assigned_approver` | str \| None | Email from `config.ROUTING_TABLE` |
| `routing_reasoning` | str \| None | Includes escalation note when score ≥ 7.0 (CC vp_support@company.com) |
| `rag_feedback_used` | [str] | Rejection-reason texts the Drafter retrieved before drafting |
| `drafts` | [obj] (exactly 3) | `{style: formal|empathetic|concise, text, thought_process, compliance_score: int|None, compliance_reasoning, compliance_passed: bool|None}` — threshold 80 |
| `rejection_feedback_log` | [obj] | `{timestamp, reason, free_text|None}` — one per human rejection |
| `human_approval_timestamp` | str \| None | Set only by `POST /api/approve` |
| `approved_draft_style` | str \| None | Which draft the human approved |
| `final_status` | str | `processing` → `pending_review` \| `escalated` → `approved` (rejection re-runs D→E and returns to `pending_review`/`escalated`) |

### 3.2 Audit event (SPEC §2.2 — `state.audit_log[ticket_id]`)

```python
{"timestamp": str,          # ISO 8601 UTC
 "agent": "A"|"B"|"C"|"D"|"E"|"human"|"system",   # onboarding adds "coordinator"
 "event": str,              # e.g. intake_validation, classification, routing,
                            # rag_retrieval, drafting, compliance_check,
                            # approval, rejection, swarm_memory_update,
                            # pipeline_start|pipeline_error|pipeline_complete
 "detail": str}             # human-readable reasoning, incl. scores
```

Written exclusively through `state.append_audit()`; persisted with the
ticket snapshot. The onboarding coordinator keeps an equivalent
per-plan `timeline` with agents `coordinator` / `system`.

### 3.3 User (SPEC_AUTH_ONBOARDING §1)

```python
{"user_id": "uuid4hex", "name": str, "email": str,
 "role": "customer"|"employee",
 "password_hash": str}      # SHA-256, hackathon-grade; never returned by the API
```

Tokens: `token (uuid4 hex) -> user_id`, sent as `Authorization: Bearer`.
Captchas: `{captcha_id, svg}` — 5 chars from A–Z0–9 excluding 0/O/1/I,
per-char jitter + noise lines, 10-minute validity, single-use,
case-insensitive comparison. Seeded employee: `codebreaker@test.com` /
`codebreaker` ("Code Breaker"), created on startup.

### 3.4 Onboarding plan (SPEC_AUTH_ONBOARDING §3)

```python
{"plan_id": "uuid4hex", "hire_name": str,
 "role": "Support Agent|Engineer|Finance Analyst|People Ops|Sales Rep",
 "start_date": "YYYY-MM-DD", "notes": str|None, "created_at": ISO,
 "status": "active"|"completed",        # completed when all tasks done
 "tasks": [{"task_id": "uuid4hex", "title": str, "owner": str,
            "offset_days": int,        # due = start_date + offset_days
            "status": "pending|in_progress|done|blocked",
            "blocker_reason": str|None,  # mandatory when blocked
            "completed_at": ISO|None}],
 "escalations": [{"timestamp": ISO, "task_id": str, "task_title": str,
                  "reason": str,        # blocker reason or "overdue"
                  "escalated_to": "hr_manager@company.com"}],
 "generation_reasoning": str,           # template vs LLM rationale
 "timeline": [audit event]}             # agents "coordinator"/"system"
```

### 3.5 Swarm memory entry (SPEC §2.4)

```python
{"ticket_id": str, "category": str, "reason": str,
 "free_text": str|None,
 "text": str,              # "reason. free_text" — the embedded string
 "timestamp": str}         # embeddings computed on demand at retrieval
```

Retrieval (`retrieve_relevant_feedback`, top_k = 3): same-category
entries ranked by cosine similarity first; remaining slots filled by
cross-category entries with similarity > 0.1; embedding failure degrades
to recency order with a logged warning — retrieval never breaks the
pipeline.

## 4. Provider fallback design (degrade, never die)

```
              LLM_PROVIDER env (default "mock")
                        │
        ┌───────┬───────┼────────┐
        ▼       ▼       ▼        ▼
      mock    kimi    gemini    zai        ← llm/factory.py cached singleton
      (pure   (Moonshot (REST,  (GLM,
      rules)  OpenAI-   no SDK) OpenAI-compatible)
                compat)
        ▲       │       │        │
        └───────┴── on ANY failure (missing key, network, HTTP, parse):
                    log warning → fall back to MockLLM
```

- All providers implement `BaseLLM.complete_json(system, prompt) -> dict`
  and **must not raise**; strict-JSON instructions, fence-stripping
  parse.
- MockLLM (`llm/mock.py`) is deterministic: keyword tables for
  category/sentiment, template drafts per style, regex/rule-based
  compliance scoring — the full pipeline runs offline and demos well.
- Embeddings mirror the same pattern: lazy sentence-transformers import;
  on any failure → deterministic 256-dim hashing bag-of-words (+ bigram
  signal) in pure numpy, with a logged warning.
- Onboarding task generation: template by default; Gemini attempt only
  when `LLM_PROVIDER=gemini`, template fallback on any failure.

## 5. Audit & traceability model ("nothing happens silently")

1. **Every automated step writes an event.** Agents record via
   `BaseAgent.record()` → `state.append_audit()`; the pipeline brackets
   each run with `pipeline_start` / `pipeline_complete`.
2. **Reasoning is data.** Classification, sentiment, routing, per-draft
   thought processes, compliance reasoning, and onboarding
   `generation_reasoning` are stored fields — not just log lines.
3. **Failures are events, not silence.** A pipeline exception sets
   `final_status = "escalated"` and records `pipeline_error`; provider
   and embedding fallbacks log warnings; onboarding escalations are
   timestamped entries in `escalations` + the plan timeline.
4. **Human actions are first-class.** `POST /api/approve` and
   `POST /api/reject` append `agent: "human"` events with timestamps;
   approval is impossible without one (NFR3).
5. **One-call replay.** `GET /api/audit/{ticket_id}` returns the full
   narrative (SPEC §3 keys + chronological `timeline`);
   `GET /api/onboarding/audit/{plan_id}` does the same for plans. The
   Audit Trail UI tab renders the timeline; the
   `skills/ticket-audit-walkthrough` skill turns it into a cited
   judge-facing walkthrough.

## 6. Persistence model

In-memory stores + atomic JSON snapshots, saved on every mutation,
loaded on startup (`app/main.py::startup`):

| File | Contents | Written by |
|---|---|---|
| `backend/data/tickets.json` | `{tickets, audit_log}` | `state.save()` |
| `backend/data/swarm_memory.json` | `{entries}` | `swarm_memory._persist()` |
| `backend/data/auth.json` | users + tokens | `auth/store.py` |
| `backend/data/onboarding.json` | `{plans}` | `agents/onboarding.py::save()` |

Writes go to a `*.json.tmp` file then `replace()` — a crash mid-write
never corrupts the snapshot. In Docker the directory is the
`backend-data` named volume (`/app/data`).

## 7. Auth model

- Signup is captcha-gated and always creates role `customer`; login
  works for both roles (400 bad captcha, 401 bad credentials).
- Bearer uuid4 tokens; `GET /api/auth/me` resolves token → user.
- Passwords SHA-256-hashed — hackathon-grade, documented as such.
- UI gates by role: customer sees New Ticket / My Tickets; employee sees
  Review Queue / Audit Trail / Onboarding. Sessions persist via
  localStorage token.

## 8. Deployment topology

```
docker compose up --build
├── backend  (python:3.11-slim, :8000)
│     entrypoint.sh: uvicorn → wait for /api/health →
│     if ticket DB empty: python SEED_DATA.py against itself
│     env: LLM_PROVIDER (mock default), KIMI_*, GEMINI_*
│     volume: backend-data → /app/data
└── frontend (node:20-alpine, :5173, depends_on backend)
      Vite dev server; browser calls same-origin /api;
      dev proxy targets VITE_BACKEND_URL=http://backend:8000
network: swarmnet (bridge)
```

`demo/` is a standalone static variant (`npm run build` → `demo/dist/`)
whose `src/api.js` simulates the whole pipeline in-browser — no server,
no keys; `demo/src/gemini.js` can optionally call Gemini from the
browser with silent fallback to the simulated path.

## 9. Decision log (ADRs)

### ADR-1: Mock-first LLM strategy
**Decision:** `mock` is the default provider; real providers (kimi,
gemini, zai) all fall back to it on any failure.
**Rationale:** The hackathon must demo and grade with zero credentials
and no network. A deterministic rule-based provider makes the pipeline,
CI, and seed script reproducible, and guarantees the app never hard-fails
because an external API did.

### ADR-2: Shared TicketState dict instead of agent-to-agent messaging
**Decision:** Agents A–E never call each other; `run_pipeline()` hands
the same mutable TicketState dict through the chain; communication
happens through state fields + the audit log (`state.py`).
**Rationale:** One canonical state per ticket makes every intermediate
decision inspectable (`GET /api/tickets/{id}`), eliminates message-loss
failure modes, and makes the audit timeline the single narrative of
record — the traceability principle made structural.

### ADR-3: Append-only audit events on every mutation
**Decision:** `state.append_audit()` is the only way to record, and every
agent/human/system action — including errors and memory updates — appends
an event.
**Rationale:** "Nothing happens silently" is a product requirement, so
auditing is built into the state layer rather than bolted onto logging.

### ADR-4: Atomic JSON snapshots instead of a database
**Decision:** Four JSON files under `backend/data/`, written via tmp +
replace on every mutation.
**Rationale:** Zero-infrastructure persistence that survives restarts and
container rebuilds, human-inspectable by judges (open the file, see the
truth), and atomic so a crash never leaves a torn file. A real database
is out of scope for a hackathon build.

### ADR-5: RAG with an embeddings fallback chain
**Decision:** Rejection feedback is embedded with sentence-transformers
when available, otherwise a deterministic 256-dim numpy hashing
embedder; retrieval failure degrades to recency order.
**Rationale:** The learning loop must work in a clean container with no
2 GB torch download (`requirements-ml.txt` is opt-in) and must never
break the drafting path — relevance degrades, function never does.

### ADR-6: Synchronous pipeline behind one endpoint
**Decision:** `POST /api/submit` runs A→E synchronously and returns the
final TicketState; rejection re-runs only D→E.
**Rationale:** For a demo the full lifecycle must be observable in one
request/response round trip; there is no queue worker to explain or
debug, and the audit timeline reads as one continuous story.

### ADR-7: CSS-variable warm editorial theming
**Decision:** All UI color flows through CSS variables (`index.css`) with
automatic light/dark via `prefers-color-scheme`; no hard-coded palette
in components, no demo labeling/pills in the UI.
**Rationale:** A single var-driven palette keeps every component —
including judge-facing screens — consistent in both themes without
per-component forks, and keeps the product looking like a product.

### ADR-8: Static `demo/` twin instead of mocking the hosted backend
**Decision:** `demo/` duplicates the UI with an in-browser simulation of
the full pipeline (agents A→E, swarm memory, audit trail, seeds).
**Rationale:** Static-hosting previews cannot reach a backend; a faithful
client-side simulation keeps the demo judge-able from a URL with zero
infrastructure, while the real stack remains the source of truth.
