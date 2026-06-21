"""Sprint 110cj — Training-program revenue is recognized ONCE at sale-time
(via `retail_sales` source_kind=training_program_sale), not again when
individual prepaid sessions get checked out.

Before this fix, completing a prepaid training session was adding its
per-session value to the weekly/monthly completed_total — double-counting the
same revenue that was already recorded as the program sale.
"""
import os
import uuid
import pytest
import requests
from datetime import date

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_prepaid_program_session_completion_does_not_double_count(admin_headers):
    """Selling a $400 / 4-session program then completing one of the auto-
    scheduled prepaid sessions must NOT add its per-session value ($100) to
    the by_service breakdown — the program's revenue was already booked at
    sell-time as $400 in training_revenue_total."""
    suffix = uuid.uuid4().hex[:6]

    client = requests.post(
        f"{API}/clients", headers=admin_headers, json={
            "name": f"NoDouble {suffix}",
            "email": f"no-double-{suffix}@sithappens.com",
        }, timeout=15,
    ).json()
    dog = requests.post(
        f"{API}/dogs", headers=admin_headers, json={
            "name": f"NoDouble Dog {suffix}",
            "owner_id": client["id"],
            "breed": "Mix",
            "age_y": 2,
        }, timeout=15,
    ).json()
    program = requests.post(
        f"{API}/programs", headers=admin_headers, json={
            "name": f"NoDouble Program {suffix}",
            "type": "private_lessons",
            "format": {"count": 4, "unit": "sessions"},
            "price": 400.00,
            "modules": [],
        }, timeout=15,
    ).json()

    # Sell + auto-schedule weekly starting TODAY (same weekday) so the first
    # session lands on today's date and the sale and session share the same week.
    today = date.today()
    sell_resp = requests.post(
        f"{API}/clients/{client['id']}/sell-program",
        headers=admin_headers, json={
            "program_id": program["id"],
            "dog_id": dog["id"],
            "payment_method": "card",
            "schedule_day_of_week": today.weekday(),
            "schedule_time": "10:00",
            "schedule_start_date": today.isoformat(),
        }, timeout=15,
    )
    sell_resp.raise_for_status()
    sell_body = sell_resp.json()
    scheduled = sell_body.get("scheduled_bookings") or []
    assert len(scheduled) == 4
    first = scheduled[0]
    assert first["date"] == today.isoformat()
    assert first["actual_price"] == 0.0
    assert first["is_prepaid_program_session"] is True

    # Promote the session to "completed" via the real check-in/check-out
    # flow — simulates the operator actually checking the dog out.
    requests.post(
        f"{API}/bookings/{first['id']}/check-in",
        headers=admin_headers, json={}, timeout=15,
    ).raise_for_status()
    requests.post(
        f"{API}/bookings/{first['id']}/check-out",
        headers=admin_headers, json={}, timeout=15,
    ).raise_for_status()

    # Pull weekly summary for the SAME week the sale + session live in.
    summary = requests.get(
        f"{API}/transactions/weekly-summary",
        headers=admin_headers, params={"ref_date": today.isoformat()}, timeout=15,
    ).json()

    # 1. Training revenue (sale-time) shows the full $400.
    assert summary["training_revenue_total"] >= 400.0, summary

    # 2. Re-fetch the booking — checkout DID set actual_price=$100 (value_each
    #    is fine — that's the per-session sticker value used by the audit
    #    trail and by per-dog stats). The summary fix is what matters.
    fresh = requests.get(
        f"{API}/bookings/{first['id']}", headers=admin_headers, timeout=15,
    ).json()
    assert fresh["status"] == "completed"
    assert fresh.get("is_prepaid_program_session") is True

    # 3. Re-pull the summary AFTER checkout. Even though the booking now has
    #    actual_price=$100, the program-redemption filter must exclude it.
    after = requests.get(
        f"{API}/transactions/weekly-summary",
        headers=admin_headers, params={"ref_date": today.isoformat()}, timeout=15,
    ).json()

    # Key invariant: completed_total must NOT have grown by $100 just because
    # we checked out a prepaid program session.
    assert after["completed_total"] == summary["completed_total"], (
        f"BUG: completed_total jumped from {summary['completed_total']} to "
        f"{after['completed_total']} after checking out a prepaid program "
        f"session — this is the double-count the fix is supposed to prevent."
    )

    # Training revenue should still be the program sale price ($400) and not
    # include the $100 leak.
    assert after["training_revenue_total"] == summary["training_revenue_total"]

