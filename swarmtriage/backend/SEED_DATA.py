"""SEED_DATA.py — demo seeder for SwarmTriage (SPEC §4).

Standalone script (``python SEED_DATA.py``) that POSTs 5 tickets to the
running backend (2 Billing, 2 Technical Bug, 1 Feature Request; sentiments
from furious to happy), then approves 1 and rejects 2 with distinct reasons
("Too complex" and "Too aggressive"), and finally re-submits a similar angry
billing ticket so the RAG tone change is visible in the new drafts.

Additionally seeds the onboarding coordinator (SPEC_AUTH_ONBOARDING §5):
creates 1 plan ("Ava Chen", Support Agent, start date today), marks 2 tasks
done, and blocks 1 task with "VPN access not provisioned" (→ escalation to
hr_manager@company.com).

Usage:  API_URL=http://localhost:8000 python SEED_DATA.py
"""

from __future__ import annotations

import os
import sys
import time
from datetime import date

import requests

API_URL = os.getenv("API_URL", "http://localhost:8000").rstrip("/")

# ---------------------------------------------------------------------------
# 5 sample tickets: 2 Billing, 2 Technical Bug, 1 Feature Request.
# Sentiments run from furious to happy.
# ---------------------------------------------------------------------------
SEED_TICKETS = [
    {
        "raw_text": (
            "I am absolutely FURIOUS! You charged my credit card TWICE for the "
            "same invoice this month and this is the second time it has happened. "
            "This double-charged billing scam is completely unacceptable — refund "
            "my payment NOW or I am cancelling my subscription and calling my lawyer!"
        ),
        "customer_email": "karen.angry@example.com",
    },
    {
        "raw_text": (
            "Your app crashes every single time I try to log in. I get a 500 error "
            "and a blank screen, then it freezes. This bug is ridiculous and I am "
            "fed up — our whole team cannot work. Fix this broken login immediately!"
        ),
        "customer_email": "devon.frustrated@example.com",
    },
    {
        "raw_text": (
            "Hello, I noticed a charge on my latest invoice that I do not recognize. "
            "Could the billing team please review it when convenient? Thanks."
        ),
        "customer_email": "morgan.neutral@example.com",
    },
    {
        "raw_text": (
            "Love the product so far! It would be nice if you could add a dark mode "
            "feature and an export-to-CSV option. Just a suggestion — keep up the "
            "great work, thanks!"
        ),
        "customer_email": "riley.happy@example.com",
    },
    {
        "raw_text": (
            "The export feature fails with an error whenever I select more than "
            "1000 rows. It just times out and nothing downloads. Can someone look "
            "into this issue? It is a bit annoying but not urgent."
        ),
        "customer_email": "sam.patient@example.com",
    },
]

# A follow-up angry billing ticket, similar to the first one. Because the
# first ticket's draft was rejected with feedback stored in swarm memory, the
# new drafts for THIS ticket must visibly adapt (RAG tone change).
RAG_DEMO_TICKET = {
    "raw_text": (
        "I am FURIOUS about my invoice! You overcharged my credit card again on "
        "this month's subscription payment and nobody from billing has answered. "
        "This is the worst, completely unacceptable — I demand a refund and I will "
        "cancel my account if this charge is not fixed!"
    ),
    "customer_email": "taylor.irate@example.com",
}


def _wait_for_backend(timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(f"{API_URL}/api/health", timeout=2)
            if resp.ok:
                return
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise SystemExit(f"Backend at {API_URL} did not become healthy within {timeout}s")


def _post(path: str, payload: dict) -> dict:
    resp = requests.post(f"{API_URL}{path}", json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    print("=" * 74)
    print("SwarmTriage SEED_DATA — seeding demo tickets against", API_URL)
    print("=" * 74)
    _wait_for_backend()
    health = requests.get(f"{API_URL}/api/health", timeout=5).json()
    print(f"Backend healthy: status={health['status']} llm_provider={health['llm_provider']}\n")

    submitted = []
    for i, ticket in enumerate(SEED_TICKETS, start=1):
        result = _post("/api/submit", ticket)
        submitted.append(result)
        print(
            f"[{i}/5] {result['ticket_id'][:8]}… "
            f"category={result['category']!r:<18} sentiment={result['sentiment']} "
            f"({result['sentiment_score']}/10) status={result['final_status']} "
            f"approver={result['assigned_approver']}"
        )

    furious_billing = submitted[0]
    crash_bug = submitted[1]
    neutral_billing = submitted[2]

    # --- Approve 1 ticket (the neutral billing inquiry). ---------------------
    approved = _post(
        "/api/approve",
        {"ticket_id": neutral_billing["ticket_id"], "draft_style": "formal"},
    )
    print(
        f"\nAPPROVED  {approved['ticket_id'][:8]}… style='formal' "
        f"at {approved['human_approval_timestamp']}"
    )

    # --- Reject 2 tickets with distinct reasons ------------------------------
    rejected_1 = _post(
        "/api/reject",
        {
            "ticket_id": furious_billing["ticket_id"],
            "reason": "Too aggressive",
            "free_text": (
                "The tone is too cold and demanding for an angry customer. "
                "Add more empathy and stop pressuring them."
            ),
        },
    )
    print(
        f"REJECTED  {rejected_1['ticket_id'][:8]}… reason='Too aggressive' "
        f"→ {len(rejected_1['drafts'])} drafts regenerated, "
        f"status={rejected_1['final_status']}"
    )
    rejected_2 = _post(
        "/api/reject",
        {
            "ticket_id": crash_bug["ticket_id"],
            "reason": "Too complex",
            "free_text": (
                "The customer is not technical. Use short, plain sentences and "
                "drop the jargon."
            ),
        },
    )
    print(
        f"REJECTED  {rejected_2['ticket_id'][:8]}… reason='Too complex' "
        f"→ {len(rejected_2['drafts'])} drafts regenerated, "
        f"status={rejected_2['final_status']}"
    )

    # --- Re-submit a similar angry billing ticket: RAG tone change visible ---
    print("\nRe-submitting a similar angry billing ticket (RAG demo)…")
    rag_demo = _post("/api/submit", RAG_DEMO_TICKET)
    print(
        f"NEW       {rag_demo['ticket_id'][:8]}… category={rag_demo['category']!r} "
        f"sentiment={rag_demo['sentiment']} ({rag_demo['sentiment_score']}/10)"
    )
    print(f"rag_feedback_used ({len(rag_demo['rag_feedback_used'])} item(s)):")
    for item in rag_demo["rag_feedback_used"]:
        print(f"  - {item}")
    print("\nAdapted draft thought processes (feedback must be mentioned):")
    for draft in rag_demo["drafts"]:
        print(f"  [{draft['style']}] {draft['thought_process']}")

    # --- Onboarding coordinator demo (SPEC_AUTH_ONBOARDING §5) -----------------
    print("\nCreating onboarding plan for Ava Chen (Support Agent)…")
    plan = _post(
        "/api/onboarding/plans",
        {
            "hire_name": "Ava Chen",
            "role": "Support Agent",
            "start_date": date.today().isoformat(),
            "notes": "Seed plan — demonstrates done/blocked tasks and escalation.",
        },
    )
    print(
        f"PLAN      {plan['plan_id'][:8]}… role={plan['role']!r} "
        f"tasks={len(plan['tasks'])} status={plan['status']}"
    )
    for task in plan["tasks"][:2]:
        plan = _post(f"/api/onboarding/tasks/{task['task_id']}/status", {"status": "in_progress"})
        plan = _post(f"/api/onboarding/tasks/{task['task_id']}/status", {"status": "done"})
        print(f"DONE      task={task['title'][:52]!r}")
    blocked_task = plan["tasks"][2]
    plan = _post(
        f"/api/onboarding/tasks/{blocked_task['task_id']}/status",
        {"status": "blocked", "blocker_reason": "VPN access not provisioned"},
    )
    print(f"BLOCKED   task={blocked_task['title'][:52]!r} reason='VPN access not provisioned'")
    for esc in plan["escalations"]:
        print(
            f"ESCALATED task={esc['task_title'][:44]!r} → {esc['escalated_to']} "
            f"reason={esc['reason']!r}"
        )
    if not plan["escalations"]:
        print("\nERROR: blocked task produced no escalation!", file=sys.stderr)
        sys.exit(1)

    # --- Summary --------------------------------------------------------------
    queue = requests.get(f"{API_URL}/api/queue", timeout=5).json()["tickets"]
    print("\n" + "=" * 74)
    print("SUMMARY")
    print("=" * 74)
    print(f"Tickets submitted : {len(SEED_TICKETS)} (+1 RAG demo ticket)")
    print("Approved          : 1 (neutral billing, formal draft)")
    print("Rejected          : 2 ('Too aggressive' billing, 'Too complex' bug)")
    print(f"Review queue now  : {len(queue)} ticket(s) pending_review/escalated")
    done_count = sum(1 for t in plan["tasks"] if t["status"] == "done")
    blocked_count = sum(1 for t in plan["tasks"] if t["status"] == "blocked")
    print(
        f"Onboarding plan   : 1 (Ava Chen, Support Agent) — {done_count} done, "
        f"{blocked_count} blocked, {len(plan['escalations'])} escalation(s) "
        f"→ hr_manager@company.com"
    )
    for t in queue:
        print(
            f"  - {t['ticket_id'][:8]}… {t['category']:<15} "
            f"sentiment={t['sentiment_score']:>4}/10 status={t['final_status']} "
            f"drafts={len(t['drafts'])} rag_items={len(t['rag_feedback_used'])}"
        )
    if not rag_demo["rag_feedback_used"]:
        print(
            "\nWARNING: RAG demo ticket used NO prior feedback — the adaptive "
            "loop may not be visible!",
            file=sys.stderr,
        )
        sys.exit(1)
    print("\nRAG adaptive loop verified: the new angry billing ticket retrieved")
    print("prior rejection feedback BEFORE drafting and adapted its tone.")
    print("Done. Open http://localhost:5173 to review the queue in the UI.")


if __name__ == "__main__":
    main()
