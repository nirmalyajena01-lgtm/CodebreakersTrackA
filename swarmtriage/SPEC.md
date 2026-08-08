# SPEC.md — SwarmTriage: Adaptive Enterprise Support Automation

Hackathon Track A (Business Process Automation). Single source of truth for all
modules. Subagents MUST implement these contracts exactly.

## 0. Tech Stack
- Backend: Python 3.11, FastAPI + Uvicorn, Pydantic v2
- LLM: pluggable provider — `mock` (deterministic, no API credits, DEFAULT) or
  `kimi` (OpenAI-compatible client, base URL `https://api.moonshot.ai/v1`)
- Vector memory: `sentence-transformers` (all-MiniLM-L6-v2) with a built-in
  lightweight hashing-embedding fallback so the app runs even if the model
  download is unavailable
- Frontend: React 18 + Vite 5 + Tailwind CSS 3
- Orchestration: docker-compose (backend :8000, frontend :5173)

## 1. Directory Layout
```
swarmtriage/
├── README.md
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── SEED_DATA.py
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       ├── policy.py
│       ├── schemas.py
│       ├── state.py
│       ├── llm/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── mock.py
│       │   ├── kimi.py
│       │   └── factory.py
│       ├── agents/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── orchestrator.py      # Agent A
│       │   ├── classifier.py        # Agent B
│       │   ├── router.py            # Agent C
│       │   ├── drafter.py           # Agent D
│       │   ├── compliance.py        # Agent E
│       │   └── pipeline.py          # runs A→E, records audit events
│       ├── memory/
│       │   ├── __init__.py
│       │   ├── embeddings.py
│       │   └── swarm_memory.py      # update_swarm_memory(), retrieve()
│       └── api/
│           ├── __init__.py
│           └── routes.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── api.js
        └── components/
            ├── NewTicketForm.jsx
            ├── ReviewQueue.jsx
            ├── DraftCard.jsx
            ├── RejectFeedbackModal.jsx
            ├── AuditTrail.jsx
            └── SentimentBadge.jsx
```

## 2. Core Data Contracts

### 2.1 TicketState (shared global per ticket — dict in `state.py`)
```python
TicketState = {
    "ticket_id": str,            # uuid4 hex
    "raw_text": str,
    "customer_email": str,
    "ingestion_timestamp": str,  # ISO 8601 UTC
    "validation": {"valid": bool, "errors": [str]},
    "category": str | None,      # "Billing" | "Technical Bug" | "Feature Request"
    "category_reasoning": str | None,
    "sentiment": str | None,     # "Anger" | "Neutral" | "Happy"
    "sentiment_score": float | None,   # 0.0–10.0, higher = angrier/more urgent
    "sentiment_reasoning": str | None,
    "assigned_approver": str | None,   # email
    "routing_reasoning": str | None,
    "rag_feedback_used": [str],        # rejection reasons retrieved by Drafter
    "drafts": [                        # exactly 3
        {"style": "formal" | "empathetic" | "concise",
         "text": str,
         "thought_process": str,
         "compliance_score": int | None,   # 0–100
         "compliance_reasoning": str | None,
         "compliance_passed": bool | None} # threshold 80
    ],
    "rejection_feedback_log": [        # one entry per rejection
        {"timestamp": str, "reason": str, "free_text": str | None}
    ],
    "human_approval_timestamp": str | None,
    "approved_draft_style": str | None,
    "final_status": str,  # "processing" | "pending_review" | "approved" | "rejected" | "escalated"
}
```

### 2.2 Audit event (appended to `state.audit_log[ticket_id]`)
```python
{"timestamp": str, "agent": "A".."E" | "human" | "system",
 "event": str, "detail": str}
```

### 2.3 LLM interface (`llm/base.py`)
```python
class BaseLLM(ABC):
    def complete_json(self, system: str, prompt: str) -> dict: ...
```
- `MockLLM`: deterministic rule-based responses (keyword heuristics for
  category/sentiment; template drafts; rule-based compliance scoring). MUST be
  good enough that the full pipeline works offline and demos well.
- `KimiLLM`: uses `openai` python client with
  `base_url=os.getenv("KIMI_BASE_URL", "https://api.moonshot.ai/v1")`,
  `api_key=os.getenv("KIMI_API_KEY")`, `model=os.getenv("KIMI_MODEL",
  "kimi-k2-0905-preview")`. Always instructs the model to reply with strict JSON
  and parses the result; falls back to MockLLM on parse/API failure (log warning).
- `factory.py::get_llm()` reads `LLM_PROVIDER` env var (default `"mock"`),
  returns a cached singleton.

### 2.4 Swarm memory (`memory/swarm_memory.py`)
```python
def update_swarm_memory(ticket_id: str, category: str, reason: str,
                        free_text: str | None) -> None
def retrieve_relevant_feedback(category: str, query_text: str,
                               top_k: int = 3) -> list[str]
```
- Backed by `memory/embeddings.py::Embedder`: tries sentence-transformers
  all-MiniLM-L6-v2; on ANY failure falls back to a deterministic 256-dim hashing
  bag-of-words embedding (pure numpy) so the app never breaks. Cosine similarity
  retrieval. Persist store to `backend/data/swarm_memory.json` so feedback
  survives restarts.

### 2.5 Pipeline behavior (`agents/pipeline.py::run_pipeline(ticket_id)`)
1. Agent A validates (non-empty text, email format), initializes state + audit.
2. Agent B classifies category & sentiment (with reasoning strings).
3. Agent C routes: Billing→finance_manager@company.com,
   Technical Bug→engineering_lead@company.com,
   Feature Request→product_manager@company.com; sentiment_score ≥ 7 ⇒ CC
   vp_support@company.com and note escalation in reasoning.
4. Agent D calls `retrieve_relevant_feedback()` FIRST, then generates 3 drafts
   (formal / empathetic / concise). If prior rejection feedback exists, the
   drafts MUST visibly adapt tone/content (e.g. avoid previously rejected
   behavior) and each draft's `thought_process` must mention the applied feedback.
5. Agent E scores each draft 0–100 against `policy.py::COMPANY_POLICY`;
   < 80 ⇒ `compliance_passed=False`. If ALL drafts fail ⇒ status `escalated`,
   else `pending_review`.

### 2.6 Company policy (`policy.py`)
A multi-line string `COMPANY_POLICY` with ~8 concrete rules (no refunds > 90
days, never admit fault, no SLA promises, PII handling, escalation rules,
tone guidelines, etc.) — used by Agent E prompts/rules.

## 3. API Contract (`api/routes.py`, prefix `/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/submit` | `{raw_text, customer_email}` | full TicketState (pipeline runs synchronously) |
| GET | `/api/queue` | — | `{tickets: [TicketState]}` pending_review + escalated, sorted by sentiment_score desc |
| GET | `/api/tickets` | — | `{tickets: [TicketState]}` all tickets |
| GET | `/api/tickets/{ticket_id}` | — | TicketState |
| POST | `/api/approve` | `{ticket_id, draft_style, edited_text?}` | updated TicketState; sets human_approval_timestamp, final_status="approved", appends human audit event |
| POST | `/api/reject` | `{ticket_id, reason, free_text?}` | updated TicketState; appends to rejection_feedback_log, calls update_swarm_memory(), re-runs Drafter (D) + Compliance (E) with RAG feedback, status back to pending_review/escalated |
| GET | `/api/audit/{ticket_id}` | — | audit narrative object (below) |
| GET | `/api/health` | — | `{status: "ok", llm_provider: str}` |

### Audit response shape
```json
{
  "ticket_id": "...",
  "ingestion_timestamp": "...",
  "agent_a_classification_reasoning": "...",
  "agent_b_sentiment_score_and_reasoning": {"score": 8.5, "reasoning": "..."},
  "agent_c_draft_variations_thought_process": [{"style": "formal", "thought_process": "..."}],
  "agent_d_compliance_check_score": [{"style": "formal", "score": 92, "passed": true, "reasoning": "..."}],
  "human_approval_timestamp": "... | null",
  "rejection_feedback_log": [],
  "final_status": "pending_review",
  "timeline": [{"timestamp": "...", "agent": "A", "event": "...", "detail": "..."}]
}
```
(Keep exactly these keys — naming follows the hackathon brief; `timeline` is the
chronological narrative for the UI.)

### CORS: allow `http://localhost:5173` and `*`.

### Persistence: in-memory dict + JSON snapshot at `backend/data/tickets.json`
(save on every mutation, load on startup).

## 4. SEED_DATA.py
Standalone script (`python SEED_DATA.py`) that POSTs 5 tickets to the running
backend (varied categories: 2 Billing, 2 Technical Bug, 1 Feature Request;
sentiments from furious to happy), then approves 1 and rejects 2 (with distinct
rejection reasons incl. "Too complex" and "Too aggressive") and re-submits a
similar angry billing ticket so the RAG tone change is visible. Uses `requests`.
Must print a readable summary.

## 5. Frontend Contract
- Vite dev proxy `/api` → `http://localhost:8000`; `src/api.js` wraps fetch.
- Space theme: deep navy/near-black background, subtle stars, low-saturation
  indigo/teal accents, glassmorphism cards. No blue-purple gradients, no
  oversaturated colors.
- Tab 1 **New Ticket**: textarea + email + submit → shows resulting ticket id,
  category, sentiment badge.
- Tab 2 **Manager Review Queue**: cards per pending ticket with sentiment
  heatmap badge (red ≥7, orange 4–6.9, green <4), category, assigned approver,
  3 drafts side-by-side (DraftCard: style label, compliance score chip
  green/red, text). Buttons per ticket: **Approve** (choose draft via radio,
  optional inline edit textarea), **Reject & Provide Feedback**
  (RejectFeedbackModal with reason select: "Too complex", "Incorrect info",
  "Too aggressive", "Too vague", "Other" + free text), **Edit** (edit chosen
  draft then approve with edited_text).
- Tab 3 **Audit Trail**: ticket selector + vertical visual timeline of agent
  events (A→E, human), showing reasoning strings, scores, timestamps.
- Poll `/api/queue` every 5s while on tab 2.

## 6. Docker
- backend/Dockerfile: python:3.11-slim, pip install -r requirements.txt,
  `uvicorn app.main:app --host 0.0.0.0 --port 8000`; on container start, if DB
  empty, run SEED_DATA.py against itself (via a small `entrypoint.sh`).
- frontend/Dockerfile: node:20-alpine, npm install, `npm run dev -- --host`.
- docker-compose.yml: two services, backend first, shared bridge network;
  frontend env `VITE_API_URL=http://backend:8000` (dev proxy still works locally).

## 7. Quality Bar
- Backend must import cleanly: `python -c "from app.main import app"` works.
- Mock provider must produce the FULL pipeline with zero external calls.
- All file writes use exact paths from §1. No placeholders/TODOs in delivered code.
