# SwarmTriage — Adaptive Enterprise Support Automation

Hackathon Track A (Business Process Automation). A five-agent AI swarm that
triages enterprise support tickets end-to-end: ingest → classify → route →
draft → compliance-check → human review, with an **Adaptive Rejection
Learning Loop** that learns from every human rejection.

## Hackathon entry criteria

| # | Checkpoint | Where |
|---|---|---|
| 1 | Architecture document in repo | `docs/ARCHITECTURE.md` (design, data model, provider fallback, ADRs) |
| 2 | Agent rules / constitution file | `AGENTS.md` (never-silent rule, per-agent contracts, contributor rules; short form: `.clinerules`) |
| 3 | Working demonstrable code | `docker compose up --build` (backend :8000 auto-seeds, frontend :5173); offline default `MockLLM`; static variant in `demo/` |
| 4 | ≥1 custom agent AND ≥1 custom skill, committed + documented | 6 custom agents in `backend/app/agents/`; skill `skills/ticket-audit-walkthrough/`; both documented in `AGENTS_AND_SKILLS.md` |
| 5 | Green CI/CD workflow | `.github/workflows/ci.yml` runs `tests/smoke_test.py` on every push |

## Documentation

- `docs/PRD.md` — BMAD-style product requirements: personas, epics →
  numbered stories with acceptance criteria, story trail.
- `docs/ARCHITECTURE.md` — architecture checkpoint: high-level design,
  stack, full data model, provider fallback, audit/persistence/auth
  models, deployment, decision log.
- `AGENTS.md` — agent constitution: never-silent rule, roster contracts,
  human-in-the-loop, memory and provider rules.
- `AGENTS_AND_SKILLS.md` — custom agents & skills checkpoint with
  verification commands.
- `skills/` — custom agent skills (`ticket-audit-walkthrough`).
- `SPEC.md`, `SPEC_AUTH_ONBOARDING.md` — binding implementation
  contracts.

## Architecture

```
POST /api/submit
      │
      ▼
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│ Agent A   │ → │ Agent B   │ → │ Agent C   │ → │ Agent D   │ → │ Agent E   │
│ Orchestra-│   │ Classifier│   │ Router    │   │ Drafter   │   │ Compliance│
│ tor       │   │ category +│   │ approver  │   │ 3 drafts, │   │ policy    │
│ validate  │   │ sentiment │   │ + escalate│   │ RAG over  │   │ score     │
│           │   │ + reason  │   │           │   │ rejections│   │ ≥ 80      │
└───────────┘   └───────────┘   └───────────┘   └─────┬─────┘   └───────────┘
                                                      │
                          swarm memory (vector store of human rejection
                          feedback, embedded with sentence-transformers /
                          numpy hashing fallback) ◄── POST /api/reject
```

All five agents share one centralized `TicketState` dict per ticket
(`backend/app/state.py`) and append audit events to a per-ticket timeline.

## Quick start

### Local (no Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install fastapi "uvicorn[standard]" pydantic numpy requests openai
uvicorn app.main:app --reload --port 8000

# in another terminal — seed demo data (optional)
python SEED_DATA.py

# frontend (separate agent/module)
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

The backend runs **fully offline** with the deterministic `MockLLM`
(default `LLM_PROVIDER=mock`) — no API credits needed.

### Docker

```bash
docker compose up --build
# backend → http://localhost:8000 (auto-seeds demo data on first boot)
# frontend → http://localhost:5173
```

**No API keys required.** The default stack runs the deterministic offline
`MockLLM` and a pure-numpy hashing-embedding fallback for swarm memory, so
`docker compose up --build` works end-to-end with zero credentials and no
model downloads. The default image is lean (~no torch): `sentence-transformers`
lives in the optional `backend/requirements-ml.txt` (see below).

How the frontend reaches the backend: the browser only ever calls
**same-origin `/api`**. The Vite dev server (running inside the frontend
container) proxies `/api` to the target given by the **server-side** env var
`VITE_BACKEND_URL` — compose sets it to `http://backend:8000`, which resolves
on the shared docker network; locally it defaults to `http://localhost:8000`
(see `frontend/vite.config.js`). `VITE_API_URL` in `frontend/src/api.js`
remains only as an optional escape hatch for calling a browser-resolvable
backend URL directly.

### Optional: real sentence embeddings

```bash
pip install -r backend/requirements-ml.txt   # pulls torch (~2GB)
```

This upgrades swarm-memory retrieval from the built-in numpy hashing fallback
to real `all-MiniLM-L6-v2` embeddings. Everything works either way — the app
lazy-imports sentence-transformers and falls back automatically.

### Static demo (no backend)

`demo/` is a standalone variant of the dashboard for static hosting previews:
same UI, but `src/api.js` is an in-browser simulation of the full mock
pipeline (agents A→E, swarm memory, audit trail, seeded tickets) — no server,
no API keys.

```bash
cd demo && npm install && npm run build   # static site in demo/dist/
```

### Real LLM (Kimi / Moonshot)

```bash
export LLM_PROVIDER=kimi KIMI_API_KEY=sk-...
uvicorn app.main:app --port 8000
```

`KimiLLM` uses the OpenAI-compatible client against
`https://api.moonshot.ai/v1` with strict-JSON prompts and gracefully falls
back to the mock provider on any API/parse failure.

### Real LLM (Gemini)

```bash
export LLM_PROVIDER=gemini GEMINI_API_KEY=...   # GEMINI_MODEL defaults to gemini-2.0-flash
uvicorn app.main:app --port 8000
```

`GeminiLLM` calls the REST endpoint
`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`
directly with `requests` (no google SDK), prompts for strict JSON, strips
markdown fences when parsing, and falls back to `MockLLM` with a logged
warning on **any** failure (missing key, network, HTTP or parse error) — so
`LLM_PROVIDER=gemini` without a key still boots and serves. docker-compose
passes `GEMINI_API_KEY` through (a trial key is the built-in default —
rotate after the hackathon); `LLM_PROVIDER` stays `mock` by default.

### Real LLM (z-ai / GLM)

```bash
export LLM_PROVIDER=zai ZAI_API_KEY=...   # GLM model, e.g. glm-5.2
uvicorn app.main:app --port 8000
```

`backend/app/llm/zai.py` is the fourth provider — same
`complete_json(system, prompt) -> dict` contract, strict-JSON prompts,
and the same degrade-never-die rule: any failure logs a warning and
falls back to `MockLLM`.

## Auth (SPEC_AUTH_ONBOARDING §1)

Captcha-gated signup/login with bearer-token sessions. Trial credentials:

- **Employee:** `codebreaker@test.com` / `codebreaker` (name "Code Breaker",
  seeded on first boot)
- **Customer:** sign up via `POST /api/auth/signup` (any email; role is
  always `customer`)

Passwords are stored SHA-256-hashed (hackathon-grade), users + tokens persist
in `backend/data/auth.json`. Captchas are 5-char SVG codes (no ambiguous
0/O/1/I), valid 10 minutes, single-use, compared case-insensitively.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/captcha` | `{captcha_id, svg}` — SVG string with per-char jitter + noise lines |
| POST | `/api/auth/signup` | `{name, email, password, captcha_id, captcha_text}` → `{token, user}` (400 bad captcha / duplicate email / weak input) |
| POST | `/api/auth/login` | `{email, password, captcha_id, captcha_text}` → `{token, user}` (400 bad captcha, 401 bad credentials) |
| GET | `/api/auth/me` | `Authorization: Bearer <token>` → `{user}` |

## Onboarding Coordinator (SPEC_AUTH_ONBOARDING §3)

An agent-style coordinator that generates role-specific new-hire onboarding
plans (8–10 tasks for Support Agent / Engineer / Finance Analyst / People Ops
/ Sales Rep; template-based by default, Gemini-generated when the gemini
provider is active with template fallback), tracks task status
(`pending → in_progress → done`; `blocked` requires a `blocker_reason`),
escalates blocked tasks immediately to `hr_manager@company.com`,
auto-escalates overdue tasks once per task on plan reads, and keeps a
per-plan audit timeline. Plans persist in `backend/data/onboarding.json`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/onboarding/plans` | `{hire_name, role, start_date, notes?}` → plan with generated tasks |
| GET | `/api/onboarding/plans` | `{plans}` newest first (overdue sweep applied) |
| GET | `/api/onboarding/plans/{plan_id}` | One plan |
| POST | `/api/onboarding/tasks/{task_id}/status` | `{status, blocker_reason?}` → updated plan |
| GET | `/api/onboarding/audit/{plan_id}` | `{plan_id, timeline, escalations, status}` |

## API (prefix `/api`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/submit` | Submit `{raw_text, customer_email}` → runs pipeline A→E synchronously, returns full TicketState |
| GET | `/api/queue` | Tickets `pending_review` + `escalated`, sorted by `sentiment_score` desc |
| GET | `/api/tickets` | All tickets |
| GET | `/api/tickets/{id}` | One ticket |
| POST | `/api/approve` | `{ticket_id, draft_style, edited_text?}` → status `approved`, human audit event |
| POST | `/api/reject` | `{ticket_id, reason, free_text?}` → logs feedback, embeds it into swarm memory, re-runs Drafter+Compliance with RAG |
| GET | `/api/audit/{id}` | Full audit narrative (classification reasoning, sentiment score, draft thought processes, compliance scores, timeline) |
| GET | `/api/health` | `{status, llm_provider}` |

## The Adaptive Rejection Learning Loop

1. A manager rejects a draft set with a reason (e.g. **"Too aggressive"**,
   **"Too complex"**) via `POST /api/reject`.
2. The reason (+ free text) is embedded and stored in the vector swarm memory
   (`backend/data/swarm_memory.json`, survives restarts).
3. The Drafter retrieves relevant past rejection reasons **before** drafting
   (cosine similarity over sentence-transformers embeddings, or the pure-numpy
   256-dim hashing fallback) and visibly adapts tone/content; every draft's
   `thought_process` mentions the applied feedback.
4. Agent E re-scores the new drafts against the 8-rule company policy
   (threshold 80; if **all** drafts fail, the ticket is `escalated`).

## Persistence

JSON snapshots in `backend/data/`: `tickets.json` (tickets + audit log, saved
on every mutation, loaded on startup), `swarm_memory.json` (rejection
feedback), `auth.json` (users + tokens) and `onboarding.json` (onboarding
plans). In Docker these live in the `backend-data` volume.

## Layout

See `SPEC.md` §1 — backend in `backend/` (this module), frontend in
`frontend/` (React 18 + Vite 5 + Tailwind 3, built separately).
