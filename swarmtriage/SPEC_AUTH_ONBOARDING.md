# SPEC AUTH + ONBOARDING ADDENDUM — SwarmTriage

Contracts for the auth, captcha, onboarding-coordinator and Gemini-provider features.
Backend and demo implementations MUST match these shapes exactly.

## 1. Auth

### User
```json
{"user_id": "uuid4hex", "name": "str", "email": "str", "role": "customer|employee"}
```
Passwords stored SHA-256-hashed (hackathon-grade; note in README). Tokens: uuid4
hex, in-memory dict + persisted JSON snapshot; sent as `Authorization: Bearer <token>`.

### Seeded account (must exist on first boot, backend AND demo)
- employee: `codebreaker@test.com` / password `codebreaker`, name "Code Breaker"

### Endpoints
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/captcha` | — | `{captcha_id, svg}` — svg is a string rendering a 5-char distorted code (A-Z0-9, no ambiguous chars: exclude 0/O, 1/I) with noise lines; valid 10 min, single-use |
| POST | `/api/auth/signup` | `{name, email, password, captcha_id, captcha_text}` | `{token, user}` — role always "customer"; 400 on bad captcha / duplicate email / weak input |
| POST | `/api/auth/login` | `{email, password, captcha_id, captcha_text}` | `{token, user}` — works for customer and employee; 401 on bad credentials, 400 on bad captcha |
| GET | `/api/auth/me` | header Bearer | `{user}` |

Captcha verify is case-insensitive. Demo variant: canvas-drawn captcha, code kept
client-side, same UX (5 chars, refresh button, case-insensitive).

## 2. Gemini LLM provider

- New provider id `gemini` alongside `mock`/`kimi`. Selected by `LLM_PROVIDER=gemini`
  (backend) — `GEMINI_API_KEY` env, default model `gemini-2.0-flash`, REST endpoint
  `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`.
- Same `complete_json(system, prompt) -> dict` interface; strict-JSON instruction;
  ANY failure (network, HTTP, parse, missing key) → log warning, fall back to MockLLM.
- Demo: `demo/src/gemini.js` with the same REST call from the browser, 8 s timeout,
  silent fallback to the simulated mock path. Key as a module-level constant
  `GEMINI_API_KEY` (user-supplied trial key) overridable via localStorage
  `swarmtriage_gemini_key`. No UI mentions of providers/models anywhere.

## 3. Onboarding Coordinator

### Plan
```json
{
  "plan_id": "uuid4hex",
  "hire_name": "str",
  "role": "Support Agent|Engineer|Finance Analyst|People Ops|Sales Rep",
  "start_date": "YYYY-MM-DD",
  "notes": "str|null",
  "created_at": "ISO",
  "status": "active|completed",
  "tasks": [
    {"task_id": "uuid4hex", "title": "str", "owner": "str",
     "offset_days": 0, "status": "pending|in_progress|done|blocked",
     "blocker_reason": "str|null", "completed_at": "ISO|null"}
  ],
  "escalations": [
    {"timestamp": "ISO", "task_id": "str", "task_title": "str",
     "reason": "str", "escalated_to": "hr_manager@company.com"}
  ]
}
```

### Coordinator behavior (agent-style, reasoning logged per plan)
1. Task generation: role-specific template (8–10 tasks; e.g. accounts/access,
   policy training, tooling, shadowing, first assignment, 30-60-90 goals) —
   mock generator by default; if `gemini` provider active, try LLM generation
   with template fallback. Each plan records `generation_reasoning`.
2. Completion tracking: status transitions pending → in_progress → done;
   blocked is set with a mandatory blocker_reason.
3. Escalation: (a) any task set to blocked → immediate escalation entry to
   hr_manager@company.com with reason; (b) on plan read, tasks past
   start_date+offset_days and not done → auto-escalation entry (once per task)
   with reason "overdue". All events appended to the plan's audit timeline.
4. Plan status = completed when all tasks done.

### Endpoints
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/onboarding/plans` | `{hire_name, role, start_date, notes?}` | plan (tasks generated) |
| GET | `/api/onboarding/plans` | — | `{plans: [plan]}` newest first, auto-escalation sweep applied |
| GET | `/api/onboarding/plans/{plan_id}` | — | plan |
| POST | `/api/onboarding/tasks/{task_id}/status` | `{status, blocker_reason?}` | updated plan |
| GET | `/api/onboarding/audit/{plan_id}` | — | `{plan_id, timeline: [{timestamp, agent, event, detail}], escalations: [...], status}` |

Timeline agents labeled `"coordinator"` and `"system"`.

## 4. Frontend/Demo UX contract

- Auth gate: not logged in → auth screen only. Two modes: "Customer" (Sign up /
  Log in toggle) and "Employee" (Log in only). Captcha image/canvas + refresh on
  both. Trial employee creds must work in backend AND demo.
- Session persisted (localStorage token). Header: wordmark left, role tabs center,
  user chip (name + role) + Logout right. Demo header: NO pills of any kind.
- Customer tabs: New Ticket, My Tickets (their submissions + statuses).
- Employee tabs: Review Queue, Audit Trail, Onboarding.
- Onboarding tab: left rail = New Plan form (hire name, role select, start date,
  notes) + plan list with mini progress; main = selected plan: progress bar,
  task checklist (advance status buttons, "Mark blocked" w/ reason prompt),
  escalation banner (latest), event timeline.
- All new UI uses the var-driven warm palette — light/dark both work untouched.

## 5. Seeds
- SEED_DATA.py additionally creates 1 onboarding plan ("Ava Chen", Support Agent)
  with one task blocked ("VPN access not provisioned") → escalated, and 2 tasks done.
- Demo seeds the equivalent in-browser.
