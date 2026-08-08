# Plan — SwarmTriage: Entry-Criteria Pack + z-ai/GLM Provider

## Requests
1. New LLM provider: z-ai GLM (key nvapi-…, model glm-5.2, OpenAI-compatible
   https://api.z.ai/api/paas/v4) — backend + demo wiring with mock fallback.
2. Traceability/auditability narrative: judge can follow every decision — docs must
   make this explicit.
3. BMAD-style planning trail: rich PRD + story trail in repo.
4. Five entry checkpoints:
   a. Architecture document (stack, data model, high-level design) → docs/ARCHITECTURE.md
   b. Agent rules/constitution → AGENTS.md (+ .clinerules)
   c. Working code — already true; CI must prove it
   d. ≥1 custom agent + ≥1 custom skill, documented in AGENTS_AND_SKILLS.md
      → skills/ticket-audit-walkthrough/SKILL.md + document swarm agents
   e. Green CI/CD: .github/workflows/ci.yml (backend smoke, frontend build, demo
      build, docker config check); run every CI step locally to prove green.

## Stage 1 — Contracts (orchestrator)
- Define z-ai provider contract + docs/CI file list (this plan + prompt briefs).

## Stage 2 — Code (coder subagent A)
- backend/app/llm/zai.py (OpenAI-compatible client, env ZAI_API_KEY/ZAI_MODEL,
  fallback to mock), factory wiring, compose env (trial key, rotate comment).
- demo/src/zai.js + provider chain gemini→zai→mock in submitTicket path.
- tests/smoke_test.py (boot-free unit smoke: imports, mock pipeline, onboarding,
  auth store) + .github/workflows/ci.yml + run all CI steps locally, fix until green.
- Rebuild demo dist.

## Stage 3 — Docs pack (coder subagent B)
- docs/PRD.md (BMAD-style: problem, personas, epics→stories with acceptance
  criteria, traceability requirements), docs/ARCHITECTURE.md (stack, data model
  incl. TicketState/User/Plan, provider fallback design, audit model),
  AGENTS.md (constitution: agent rules, contracts, never-silent rule),
  .clinerules (pointer), AGENTS_AND_SKILLS.md (custom agents A–E + coordinator,
  custom skill skills/ticket-audit-walkthrough/SKILL.md usage), 
  skills/ticket-audit-walkthrough/SKILL.md (the custom skill itself).
- README: link the checkpoint docs.

## Stage 4 — Verify, redeploy
- Re-run CI steps on merged tree; copy demo dist → /mnt/agents/output/app;
  build_version. Final report notes key-rotation warning.
