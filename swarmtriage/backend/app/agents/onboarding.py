"""Onboarding coordinator agent (SPEC_AUTH_ONBOARDING §3).

Generates role-specific onboarding plans (8–10 tasks each) from built-in
templates by default; when the ``gemini`` LLM provider is active it tries
LLM-based task generation first and falls back to the template on any
failure. Tracks task status transitions (pending → in_progress → done;
``blocked`` requires a ``blocker_reason``), escalates blocked tasks
immediately to hr_manager@company.com, auto-escalates overdue tasks once
per task on plan reads, marks plans completed when all tasks are done, and
keeps a per-plan audit timeline (agents "coordinator" / "system").

Plans are in-memory and snapshotted to ``backend/data/onboarding.json`` on
every mutation — the same persistence pattern as ``state.py``.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .. import config

logger = logging.getLogger("swarmtriage.agents.onboarding")

# plan_id -> plan dict (SPEC_AUTH_ONBOARDING §3 shape + generation_reasoning
# + timeline).
plans: dict[str, dict[str, Any]] = {}

_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Role templates: 8–10 sensible tasks each (title, owner, offset_days).
# ---------------------------------------------------------------------------
ROLE_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "Support Agent": [
        {"title": "Create company accounts and SSO access", "owner": "IT", "offset_days": 0},
        {"title": "Provision helpdesk and CRM tool access", "owner": "IT", "offset_days": 1},
        {"title": "Complete security and privacy policy training", "owner": "People Ops", "offset_days": 2},
        {"title": "Read support playbook and escalation policy", "owner": "Support Lead", "offset_days": 3},
        {"title": "Shadow 5 live support tickets with a senior agent", "owner": "Support Lead", "offset_days": 5},
        {"title": "Handle first 3 tickets with review", "owner": "Support Lead", "offset_days": 8},
        {"title": "Learn macros, canned replies and tone guidelines", "owner": "Support Lead", "offset_days": 10},
        {"title": "Complete product knowledge certification quiz", "owner": "Enablement", "offset_days": 14},
        {"title": "Draft personal 30-60-90 day goals with manager", "owner": "Hiring Manager", "offset_days": 21},
    ],
    "Engineer": [
        {"title": "Create company accounts, SSO and VPN access", "owner": "IT", "offset_days": 0},
        {"title": "Provision GitHub, CI/CD and cloud console access", "owner": "IT", "offset_days": 1},
        {"title": "Set up local dev environment and run the test suite", "owner": "Engineering Lead", "offset_days": 2},
        {"title": "Complete security and code review policy training", "owner": "People Ops", "offset_days": 3},
        {"title": "Read architecture docs and on-call runbook", "owner": "Engineering Lead", "offset_days": 5},
        {"title": "Pair-program a first bug fix with a buddy", "owner": "Engineering Buddy", "offset_days": 7},
        {"title": "Ship first small feature to production", "owner": "Engineering Lead", "offset_days": 14},
        {"title": "Join on-call shadow rotation", "owner": "SRE Lead", "offset_days": 21},
        {"title": "Draft personal 30-60-90 day goals with manager", "owner": "Hiring Manager", "offset_days": 30},
    ],
    "Finance Analyst": [
        {"title": "Create company accounts and SSO access", "owner": "IT", "offset_days": 0},
        {"title": "Provision ERP, billing and expense tool access", "owner": "IT", "offset_days": 1},
        {"title": "Complete financial controls and compliance training", "owner": "Finance Lead", "offset_days": 2},
        {"title": "Read chart of accounts and monthly close checklist", "owner": "Finance Lead", "offset_days": 4},
        {"title": "Shadow one accounts-receivable reconciliation", "owner": "Senior Analyst", "offset_days": 6},
        {"title": "Prepare first variance analysis with review", "owner": "Senior Analyst", "offset_days": 10},
        {"title": "Learn procurement and invoice approval workflow", "owner": "Finance Lead", "offset_days": 14},
        {"title": "Support first month-end close cycle", "owner": "Controller", "offset_days": 30},
        {"title": "Draft personal 30-60-90 day goals with manager", "owner": "Hiring Manager", "offset_days": 30},
    ],
    "People Ops": [
        {"title": "Create company accounts and SSO access", "owner": "IT", "offset_days": 0},
        {"title": "Provision HRIS and ATS tool access", "owner": "IT", "offset_days": 1},
        {"title": "Complete confidentiality and labor-law policy training", "owner": "People Lead", "offset_days": 2},
        {"title": "Read employee handbook and benefits documentation", "owner": "People Lead", "offset_days": 3},
        {"title": "Shadow one onboarding and one offboarding cycle", "owner": "People Partner", "offset_days": 5},
        {"title": "Run first new-hire orientation session", "owner": "People Partner", "offset_days": 10},
        {"title": "Learn performance review and PIP processes", "owner": "People Lead", "offset_days": 14},
        {"title": "Handle first employee relations case with review", "owner": "People Lead", "offset_days": 21},
        {"title": "Draft personal 30-60-90 day goals with manager", "owner": "Hiring Manager", "offset_days": 30},
    ],
    "Sales Rep": [
        {"title": "Create company accounts and SSO access", "owner": "IT", "offset_days": 0},
        {"title": "Provision CRM and sales engagement tool access", "owner": "IT", "offset_days": 1},
        {"title": "Complete pricing, discounting and legal policy training", "owner": "Sales Enablement", "offset_days": 2},
        {"title": "Read ideal customer profile and playbook", "owner": "Sales Lead", "offset_days": 3},
        {"title": "Shadow 3 discovery calls and 1 demo", "owner": "Sales Lead", "offset_days": 5},
        {"title": "Build first prospect list of 50 accounts", "owner": "Sales Lead", "offset_days": 7},
        {"title": "Run first solo discovery call with review", "owner": "Sales Lead", "offset_days": 14},
        {"title": "Complete product demo certification", "owner": "Sales Enablement", "offset_days": 21},
        {"title": "Draft personal 30-60-90 day goals with manager", "owner": "Hiring Manager", "offset_days": 30},
    ],
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(plan: dict[str, Any], agent: str, event: str, detail: str) -> None:
    plan["timeline"].append(
        {"timestamp": _utc_now(), "agent": agent, "event": event, "detail": detail}
    )


def save() -> None:
    """Persist plans to the JSON snapshot (same pattern as state.py)."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"plans": plans}
    tmp_path = config.ONBOARDING_SNAPSHOT_PATH.with_suffix(".json.tmp")
    with _lock:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        tmp_path.replace(config.ONBOARDING_SNAPSHOT_PATH)


def load() -> None:
    """Load the JSON snapshot on startup, if it exists."""
    path = config.ONBOARDING_SNAPSHOT_PATH
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return
    with _lock:
        plans.clear()
        plans.update(payload.get("plans", {}))


# ---------------------------------------------------------------------------
# Task generation
# ---------------------------------------------------------------------------

def _template_tasks(role: str) -> list[dict[str, Any]]:
    return [dict(task) for task in ROLE_TEMPLATES[role]]


def _try_gemini_tasks(role: str) -> list[dict[str, Any]] | None:
    """Ask the active LLM (gemini) for a task list; None on any failure."""
    try:
        from ..llm.factory import get_llm

        llm = get_llm()
        if getattr(llm, "name", "mock") != "gemini":
            return None
        result = llm.complete_json(
            system=(
                "You generate employee onboarding task plans as strict JSON. "
                "Return 8-10 tasks."
            ),
            prompt=(
                f'Generate an onboarding plan for a new hire with role "{role}". '
                'Reply with JSON: {"tasks": [{"title": str, "owner": str, '
                '"offset_days": int}]} — 8 to 10 tasks covering accounts/access, '
                "policy training, tooling, shadowing, first assignment and "
                "30-60-90 day goals. offset_days is the due date offset from the "
                "start date."
            ),
        )
        tasks = result.get("tasks")
        if not isinstance(tasks, list) or not (6 <= len(tasks) <= 12):
            return None
        cleaned = []
        for task in tasks:
            if not isinstance(task, dict) or not task.get("title"):
                return None
            cleaned.append(
                {
                    "title": str(task["title"]),
                    "owner": str(task.get("owner") or "Hiring Manager"),
                    "offset_days": int(task.get("offset_days") or 0),
                }
            )
        return cleaned
    except Exception as exc:
        logger.warning("Gemini onboarding task generation failed (%s); using template.", exc)
        return None


def create_plan(
    hire_name: str, role: str, start_date: str, notes: str | None = None
) -> dict[str, Any]:
    """Create an onboarding plan with generated tasks (SPEC_AUTH_ONBOARDING §3)."""
    if role not in ROLE_TEMPLATES:
        raise ValueError(f"unknown role {role!r}")
    # Validate the date format early.
    date.fromisoformat(start_date)

    generated = _try_gemini_tasks(role) if config.LLM_PROVIDER == "gemini" else None
    if generated is not None:
        tasks = generated
        generation_reasoning = (
            f"LLM (gemini) generated {len(tasks)} onboarding tasks for role "
            f"'{role}' from the coordinator prompt (accounts/access, policy "
            "training, tooling, shadowing, first assignment, 30-60-90 goals)."
        )
    else:
        tasks = _template_tasks(role)
        generation_reasoning = (
            f"Template generator selected the curated '{role}' playbook: "
            f"{len(tasks)} tasks covering accounts/access, policy training, "
            "tooling, shadowing, first assignment and 30-60-90 goals, with "
            "owners and due-date offsets ordered for a realistic ramp-up."
        )

    plan: dict[str, Any] = {
        "plan_id": uuid.uuid4().hex,
        "hire_name": hire_name,
        "role": role,
        "start_date": start_date,
        "notes": notes,
        "created_at": _utc_now(),
        "status": "active",
        "tasks": [
            {
                "task_id": uuid.uuid4().hex,
                "title": task["title"],
                "owner": task["owner"],
                "offset_days": task["offset_days"],
                "status": "pending",
                "blocker_reason": None,
                "completed_at": None,
            }
            for task in tasks
        ],
        "escalations": [],
        "generation_reasoning": generation_reasoning,
        "timeline": [],
    }
    _audit(
        plan,
        "coordinator",
        "plan_created",
        f"Created onboarding plan for {hire_name} ({role}), start date "
        f"{start_date}, {len(tasks)} tasks generated.",
    )
    _audit(plan, "coordinator", "generation_reasoning", generation_reasoning)
    with _lock:
        plans[plan["plan_id"]] = plan
    save()
    return plan


# ---------------------------------------------------------------------------
# Escalation + status tracking
# ---------------------------------------------------------------------------

def _escalate(plan: dict[str, Any], task: dict[str, Any], reason: str) -> None:
    entry = {
        "timestamp": _utc_now(),
        "task_id": task["task_id"],
        "task_title": task["title"],
        "reason": reason,
        "escalated_to": config.HR_MANAGER_EMAIL,
    }
    plan["escalations"].append(entry)
    _audit(
        plan,
        "system",
        "escalation",
        f"Escalated task '{task['title']}' to {config.HR_MANAGER_EMAIL}: {reason}",
    )


def sweep_overdue(plan: dict[str, Any]) -> bool:
    """Auto-escalate overdue, not-done tasks (once per task). Returns True if
    the plan was mutated."""
    try:
        start = date.fromisoformat(plan["start_date"])
    except ValueError:
        return False
    today = date.today()
    escalated_overdue = {
        e["task_id"] for e in plan["escalations"] if e["reason"] == "overdue"
    }
    mutated = False
    for task in plan["tasks"]:
        if task["status"] == "done" or task["task_id"] in escalated_overdue:
            continue
        due = start + timedelta(days=task["offset_days"])
        if today > due:
            _escalate(plan, task, "overdue")
            mutated = True
    return mutated


def get_plan(plan_id: str) -> dict[str, Any] | None:
    plan = plans.get(plan_id)
    if plan is not None and sweep_overdue(plan):
        save()
    return plan


def list_plans() -> list[dict[str, Any]]:
    """All plans, newest first, with the overdue auto-escalation sweep applied."""
    mutated = False
    for plan in plans.values():
        if sweep_overdue(plan):
            mutated = True
    if mutated:
        save()
    return sorted(plans.values(), key=lambda p: p.get("created_at") or "", reverse=True)


def find_plan_for_task(task_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    for plan in plans.values():
        for task in plan["tasks"]:
            if task["task_id"] == task_id:
                return plan, task
    return None


def set_task_status(
    task_id: str, status: str, blocker_reason: str | None = None
) -> dict[str, Any]:
    """Transition a task's status. Raises KeyError (unknown task) or
    ValueError (invalid transition / missing blocker reason)."""
    found = find_plan_for_task(task_id)
    if found is None:
        raise KeyError(task_id)
    plan, task = found
    if status not in ("pending", "in_progress", "done", "blocked"):
        raise ValueError(f"invalid status {status!r}")
    if status == "blocked" and not (blocker_reason or "").strip():
        raise ValueError("blocker_reason is required when status is 'blocked'")

    old_status = task["status"]
    task["status"] = status
    if status == "done":
        task["completed_at"] = _utc_now()
        task["blocker_reason"] = None
    else:
        task["completed_at"] = None
        task["blocker_reason"] = blocker_reason.strip() if status == "blocked" else None

    _audit(
        plan,
        "coordinator",
        "task_status",
        f"Task '{task['title']}' (owner: {task['owner']}) moved "
        f"{old_status} → {status}"
        + (f" — blocker: {task['blocker_reason']}" if status == "blocked" else ""),
    )

    # Immediate escalation on blocked (SPEC_AUTH_ONBOARDING §3.3a).
    if status == "blocked" and old_status != "blocked":
        _escalate(plan, task, task["blocker_reason"])

    # Plan completed when all tasks are done (SPEC_AUTH_ONBOARDING §3.4).
    all_done = all(t["status"] == "done" for t in plan["tasks"])
    if all_done and plan["status"] != "completed":
        plan["status"] = "completed"
        _audit(
            plan,
            "system",
            "plan_completed",
            f"All {len(plan['tasks'])} tasks done — onboarding plan for "
            f"{plan['hire_name']} is completed.",
        )
    elif not all_done and plan["status"] == "completed":
        plan["status"] = "active"
        _audit(
            plan,
            "system",
            "plan_reopened",
            "A task moved out of 'done' — plan is active again.",
        )

    sweep_overdue(plan)
    save()
    return plan
