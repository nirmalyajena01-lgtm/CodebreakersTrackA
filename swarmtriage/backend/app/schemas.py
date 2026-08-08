"""Pydantic request/response schemas for the HTTP API (SPEC §3)."""

from __future__ import annotations

from pydantic import BaseModel, Field

# Simple, practical email format check (full validation happens in Agent A).
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class SubmitRequest(BaseModel):
    raw_text: str = Field(..., min_length=1)
    customer_email: str = Field(..., pattern=EMAIL_PATTERN)


class ApproveRequest(BaseModel):
    ticket_id: str
    draft_style: str = Field(..., pattern="^(formal|empathetic|concise)$")
    edited_text: str | None = None


class RejectRequest(BaseModel):
    ticket_id: str
    reason: str = Field(..., min_length=1)
    free_text: str | None = None


# --- Auth (SPEC_AUTH_ONBOARDING §1) -------------------------------------------


class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., pattern=EMAIL_PATTERN)
    password: str = Field(..., min_length=6)
    captcha_id: str = Field(..., min_length=1)
    captcha_text: str = Field(..., min_length=1)


class LoginRequest(BaseModel):
    email: str = Field(..., pattern=EMAIL_PATTERN)
    password: str = Field(..., min_length=1)
    captcha_id: str = Field(..., min_length=1)
    captcha_text: str = Field(..., min_length=1)


# --- Onboarding coordinator (SPEC_AUTH_ONBOARDING §3) --------------------------


class CreatePlanRequest(BaseModel):
    hire_name: str = Field(..., min_length=1)
    role: str = Field(
        ...,
        pattern="^(Support Agent|Engineer|Finance Analyst|People Ops|Sales Rep)$",
    )
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str | None = None


class TaskStatusRequest(BaseModel):
    status: str = Field(..., pattern="^(pending|in_progress|done|blocked)$")
    blocker_reason: str | None = None
