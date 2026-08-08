"""Auth HTTP routes, prefix /api/auth (SPEC_AUTH_ONBOARDING §1)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException

from ..auth import captcha, store
from ..schemas import LoginRequest, SignupRequest

router = APIRouter(prefix="/api/auth")


@router.get("/captcha")
def get_captcha() -> dict[str, str]:
    """Generate a 5-char SVG captcha (10-min validity, single-use)."""
    return captcha.generate_captcha()


@router.post("/signup")
def signup(payload: SignupRequest) -> dict[str, Any]:
    """Register a customer account (captcha-gated)."""
    if not captcha.verify_captcha(payload.captcha_id, payload.captcha_text):
        raise HTTPException(status_code=400, detail="Invalid or expired captcha")
    try:
        user = store.create_user(payload.name, payload.email, payload.password, role="customer")
    except ValueError:
        raise HTTPException(status_code=400, detail="Email already registered")
    token = store.issue_token(user["user_id"])
    return {"token": token, "user": store.public_user(user)}


@router.post("/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    """Log in (customer or employee). 400 bad captcha, 401 bad credentials."""
    if not captcha.verify_captcha(payload.captcha_id, payload.captcha_text):
        raise HTTPException(status_code=400, detail="Invalid or expired captcha")
    user = store.authenticate(payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = store.issue_token(user["user_id"])
    return {"token": token, "user": store.public_user(user)}


@router.get("/me")
def me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Return the current user for a Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(None, 1)[1].strip()
    user = store.user_for_token(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {"user": store.public_user(user)}
