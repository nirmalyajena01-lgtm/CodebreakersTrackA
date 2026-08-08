"""Centralized global state shared by all five swarm agents (SPEC §2.1/§2.2).

`tickets` holds one TicketState dict per ticket; `audit_log` holds the
chronological audit events per ticket. Both are in-memory and snapshotted to
`backend/data/tickets.json` on every mutation, loaded back on startup.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any

from . import config

# Global stores shared by agents A–E, the API layer, and the pipeline.
tickets: dict[str, dict[str, Any]] = {}
audit_log: dict[str, list[dict[str, str]]] = {}

_lock = threading.Lock()


def utc_now() -> str:
    """Current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def append_audit(ticket_id: str, agent: str, event: str, detail: str) -> None:
    """Append an audit event (SPEC §2.2) to the ticket's timeline."""
    entry = {
        "timestamp": utc_now(),
        "agent": agent,
        "event": event,
        "detail": detail,
    }
    with _lock:
        audit_log.setdefault(ticket_id, []).append(entry)


def save() -> None:
    """Persist tickets + audit log to the JSON snapshot (SPEC §3 persistence)."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"tickets": tickets, "audit_log": audit_log}
    tmp_path = config.TICKETS_SNAPSHOT_PATH.with_suffix(".json.tmp")
    with _lock:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        tmp_path.replace(config.TICKETS_SNAPSHOT_PATH)


def load() -> None:
    """Load the JSON snapshot on startup, if it exists."""
    path = config.TICKETS_SNAPSHOT_PATH
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return
    with _lock:
        tickets.clear()
        tickets.update(payload.get("tickets", {}))
        audit_log.clear()
        audit_log.update(payload.get("audit_log", {}))
