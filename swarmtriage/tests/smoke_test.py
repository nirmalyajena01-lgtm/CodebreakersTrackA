"""SwarmTriage backend smoke tests.

Runs with plain ``python tests/smoke_test.py`` — no pytest, no network, no
torch, no API keys. Everything runs in-process against a temporary DATA_DIR
so repo snapshots are never touched. Prints PASS lines and exits 0 on
success; exits non-zero on the first failure summary.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Isolate persistence: config reads DATA_DIR at import time, so set it before
# importing any app module. Snapshot writes then land in a temp dir.
_TMP_DATA = tempfile.mkdtemp(prefix="swarmtriage-smoke-")
os.environ["DATA_DIR"] = _TMP_DATA
os.environ.pop("LLM_PROVIDER", None)  # force the default mock provider

_failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"PASS: {name}")
    else:
        _failures.append(name)
        print(f"FAIL: {name} {detail}")


def main() -> int:
    # ------------------------------------------------------------------
    # 1. App modules import cleanly.
    # ------------------------------------------------------------------
    from app import config, state  # noqa: F401
    from app.agents import onboarding, pipeline
    from app.auth import captcha, store as auth_store
    from app.llm.factory import get_llm, reset_llm
    from app.llm.mock import MockLLM
    from app.llm.zai import ZaiLLM

    print("PASS: app modules imported")

    # ------------------------------------------------------------------
    # 2. LLM factory: default is mock; zai provider falls back without a key.
    # ------------------------------------------------------------------
    reset_llm()
    llm = get_llm()
    check("factory default provider is mock", llm.name == "mock", f"got {llm.name}")

    os.environ["ZAI_API_KEY"] = ""  # ensure no key
    config.ZAI_API_KEY = ""
    zai = ZaiLLM()
    out = zai.complete_json(
        "classify",
        "TASK: classify\nTICKET TEXT: My invoice was charged twice, refund please",
    )
    check(
        "zai provider falls back to mock without key",
        isinstance(out, dict) and out.get("category") in config.VALID_CATEGORIES,
        f"got {out!r}",
    )
    parsed = ZaiLLM._parse_json('```json\n{"category": "Billing"}\n```')
    check("zai fence-stripping parse", parsed == {"category": "Billing"})

    # ------------------------------------------------------------------
    # 3. Mock pipeline in-process: submit → classify → drafts → compliance.
    # ------------------------------------------------------------------
    ticket = pipeline.new_ticket_state(
        "I am FURIOUS! You double-charged my credit card on this invoice again. "
        "This billing scam is unacceptable — refund my payment now!",
        "smoke@test.com",
    )
    state.tickets[ticket["ticket_id"]] = ticket
    pipeline.run_pipeline(ticket["ticket_id"])

    check(
        "pipeline classified the ticket",
        ticket["category"] in config.VALID_CATEGORIES,
        f"category={ticket['category']}",
    )
    check(
        "pipeline sentiment scored",
        isinstance(ticket["sentiment_score"], (int, float))
        and 0.0 <= ticket["sentiment_score"] <= 10.0,
        f"score={ticket['sentiment_score']}",
    )
    check(
        "pipeline produced 3 compliant-scored drafts",
        len(ticket["drafts"]) == 3
        and all(d["compliance_score"] is not None for d in ticket["drafts"]),
        f"drafts={len(ticket['drafts'])}",
    )
    check(
        "pipeline final status after compliance",
        ticket["final_status"] in ("pending_review", "escalated"),
        f"status={ticket['final_status']}",
    )

    # ------------------------------------------------------------------
    # 4. Audit keys on the ticket.
    # ------------------------------------------------------------------
    audit = state.audit_log.get(ticket["ticket_id"], [])
    events = {entry["event"] for entry in audit}
    check(
        "audit entries have required keys",
        bool(audit)
        and all({"timestamp", "agent", "event", "detail"} <= set(e) for e in audit),
    )
    check(
        "audit covers agents A→E",
        {
            "pipeline_start",
            "intake_validation",
            "classification",
            "sentiment_analysis",
            "routing",
            "drafting",
            "compliance_check",
            "pipeline_complete",
        }
        <= events,
        f"events={sorted(events)}",
    )

    # ------------------------------------------------------------------
    # 5. Onboarding coordinator: create, advance, block, overdue sweep.
    # ------------------------------------------------------------------
    past_start = "2000-01-01"  # every task overdue → exercises the sweep
    plan = onboarding.create_plan("Smoke Hire", "Engineer", past_start)
    check(
        "onboarding plan created with tasks",
        len(plan["tasks"]) >= 8 and plan["status"] == "active",
        f"tasks={len(plan['tasks'])}",
    )

    t_done = plan["tasks"][0]
    onboarding.set_task_status(t_done["task_id"], "done")
    check(
        "task advanced to done",
        t_done["status"] == "done" and t_done["completed_at"] is not None,
    )

    t_blocked = plan["tasks"][1]
    onboarding.set_task_status(t_blocked["task_id"], "blocked", "VPN access not provisioned")
    check(
        "blocked task escalates immediately",
        any(
            e["task_id"] == t_blocked["task_id"]
            and e["escalated_to"] == config.HR_MANAGER_EMAIL
            for e in plan["escalations"]
        ),
        f"escalations={plan['escalations']!r}",
    )

    # Overdue sweep: first call escalates remaining overdue tasks once; the
    # second call must not add anything (idempotent).
    onboarding.sweep_overdue(plan)
    count_after_first = len(plan["escalations"])
    check("overdue sweep escalates pending overdue tasks", count_after_first >= 2)
    onboarding.sweep_overdue(plan)
    check(
        "overdue sweep idempotent",
        len(plan["escalations"]) == count_after_first,
        f"{count_after_first} -> {len(plan['escalations'])}",
    )

    # ------------------------------------------------------------------
    # 6. Auth store: seeded employee verifies; captcha is single-use.
    # ------------------------------------------------------------------
    auth_store.seed_employee()
    user = auth_store.authenticate("codebreaker@test.com", "codebreaker")
    check(
        "seeded employee codebreaker@test.com verifies",
        user is not None and user["role"] == "employee",
    )
    check(
        "wrong password rejected",
        auth_store.authenticate("codebreaker@test.com", "wrong-password") is None,
    )

    cap = captcha.generate_captcha()
    check(
        "captcha generated (id + svg)",
        bool(cap.get("captcha_id")) and "<svg" in cap.get("svg", ""),
    )
    # Positive verification: force the stored hash to a known code, then the
    # first attempt succeeds and the SAME captcha id cannot be reused.
    known = "ABCDE"
    captcha._captchas[cap["captcha_id"]]["hash"] = captcha._hash_code(known)
    check(
        "captcha verifies (case-insensitive)",
        captcha.verify_captcha(cap["captcha_id"], known.lower()),
    )
    check(
        "captcha is single-use",
        not captcha.verify_captcha(cap["captcha_id"], known),
    )

    # ------------------------------------------------------------------
    print()
    if _failures:
        print(f"SMOKE TEST FAILED: {len(_failures)} failure(s): {_failures}")
        return 1
    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
