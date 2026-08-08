"""User + token store (SPEC_AUTH_ONBOARDING §1).

Users and bearer tokens live in memory and are persisted to
``backend/data/auth.json`` on every mutation (same snapshot pattern as
``state.py``). Passwords are stored SHA-256-hashed (hackathon-grade).

The employee account ``codebreaker@test.com`` / ``codebreaker``
("Code Breaker", role ``employee``) is seeded on startup.
"""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from typing import Any

from .. import config

SEED_EMPLOYEE_EMAIL = "codebreaker@test.com"
SEED_EMPLOYEE_PASSWORD = "codebreaker"
SEED_EMPLOYEE_NAME = "Code Breaker"

# email -> {"user_id", "name", "email", "role", "password_hash"}
users: dict[str, dict[str, Any]] = {}
# token -> user_id
tokens: dict[str, str] = {}

_lock = threading.Lock()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """The shape returned by the API (never exposes the password hash)."""
    return {
        "user_id": user["user_id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
    }


def save() -> None:
    """Persist users + tokens to the JSON snapshot."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"users": users, "tokens": tokens}
    tmp_path = config.AUTH_SNAPSHOT_PATH.with_suffix(".json.tmp")
    with _lock:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        tmp_path.replace(config.AUTH_SNAPSHOT_PATH)


def load() -> None:
    """Load the JSON snapshot on startup, if it exists."""
    path = config.AUTH_SNAPSHOT_PATH
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return
    with _lock:
        users.clear()
        users.update(payload.get("users", {}))
        tokens.clear()
        tokens.update(payload.get("tokens", {}))


def seed_employee() -> None:
    """Ensure the seeded employee account exists (idempotent)."""
    if SEED_EMPLOYEE_EMAIL in users:
        return
    users[SEED_EMPLOYEE_EMAIL] = {
        "user_id": uuid.uuid4().hex,
        "name": SEED_EMPLOYEE_NAME,
        "email": SEED_EMPLOYEE_EMAIL,
        "role": "employee",
        "password_hash": hash_password(SEED_EMPLOYEE_PASSWORD),
    }
    save()


def create_user(name: str, email: str, password: str, role: str = "customer") -> dict[str, Any]:
    """Create a user. Raises ValueError('duplicate_email') if email exists."""
    email = email.strip().lower()
    with _lock:
        if email in users:
            raise ValueError("duplicate_email")
        user = {
            "user_id": uuid.uuid4().hex,
            "name": name.strip(),
            "email": email,
            "role": role,
            "password_hash": hash_password(password),
        }
        users[email] = user
    save()
    return user


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    """Return the user dict on valid credentials, else None."""
    user = users.get(email.strip().lower())
    if user is None or user["password_hash"] != hash_password(password):
        return None
    return user


def issue_token(user_id: str) -> str:
    token = uuid.uuid4().hex
    with _lock:
        tokens[token] = user_id
    save()
    return token


def user_for_token(token: str) -> dict[str, Any] | None:
    user_id = tokens.get(token)
    if user_id is None:
        return None
    for user in users.values():
        if user["user_id"] == user_id:
            return user
    return None
