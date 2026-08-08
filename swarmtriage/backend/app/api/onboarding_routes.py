"""Onboarding coordinator HTTP routes, prefix /api/onboarding
(SPEC_AUTH_ONBOARDING §3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..agents import onboarding
from ..schemas import CreatePlanRequest, TaskStatusRequest

router = APIRouter(prefix="/api/onboarding")


@router.post("/plans")
def create_plan(payload: CreatePlanRequest) -> dict[str, Any]:
    """Create an onboarding plan (tasks generated for the role)."""
    try:
        return onboarding.create_plan(
            hire_name=payload.hire_name,
            role=payload.role,
            start_date=payload.start_date,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/plans")
def list_plans() -> dict[str, Any]:
    """All plans, newest first, overdue auto-escalation sweep applied."""
    return {"plans": onboarding.list_plans()}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str) -> dict[str, Any]:
    plan = onboarding.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id!r} not found")
    return plan


@router.post("/tasks/{task_id}/status")
def set_task_status(task_id: str, payload: TaskStatusRequest) -> dict[str, Any]:
    """Transition a task status; blocked requires blocker_reason."""
    try:
        return onboarding.set_task_status(
            task_id, payload.status, payload.blocker_reason
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Task {task_id!r} not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/audit/{plan_id}")
def get_audit(plan_id: str) -> dict[str, Any]:
    """Audit timeline + escalations for a plan."""
    plan = onboarding.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id!r} not found")
    return {
        "plan_id": plan["plan_id"],
        "timeline": plan["timeline"],
        "escalations": plan["escalations"],
        "status": plan["status"],
    }
