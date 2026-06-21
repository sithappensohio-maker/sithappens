"""Sprint 110ep — Today's P&L must subtract today's logged expenses.

User report (2026-02-17): "today's p and l does not don't show expenses,
it was at zero, I added an expense — it should have went negative since
no income has been made yet today."

Pre-fix the `today_pnl` endpoint computed `net = revenue - labor_total`
and ignored the `expenses` collection entirely, so adding a $50 expense
left a $0 revenue / $0 labor day stuck at net = $0 instead of -$50.

This pins the fix:
  - GET /api/admin/today-pnl now returns an `expense_total` field
  - net = revenue - labor_total - expense_total
  - an expense logged for today shifts net by exactly -amount
"""
import os
import uuid
import pytest
import requests
from datetime import date


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_today_expense_drops_net_by_amount(admin_headers):
    today = date.today().isoformat()
    amount = 50.0

    before = requests.get(
        f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15,
    ).json()
    net_before = float(before.get("net") or 0)
    exp_before = float(before.get("expense_total") or 0)

    # New field must exist (regression: pre-fix the key was missing entirely)
    assert "expense_total" in before, (
        "today-pnl response is missing `expense_total`. The whole point of "
        "this fix is that the operator can see today's expenses in the gauge."
    )

    exp = requests.post(
        f"{BASE}/api/expenses", headers=admin_headers,
        json={
            "date": today,
            "description": f"pytest expense {uuid.uuid4().hex[:6]}",
            "amount": amount,
            "category": "Supplies",
        },
        timeout=15,
    )
    exp.raise_for_status()
    exp_id = exp.json()["id"]

    try:
        after = requests.get(
            f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15,
        ).json()
        net_after = float(after.get("net") or 0)
        exp_after = float(after.get("expense_total") or 0)

        assert round(exp_after - exp_before, 2) == amount, (
            f"expense_total didn't tick up by ${amount}: "
            f"before=${exp_before}, after=${exp_after}"
        )
        assert round(net_before - net_after, 2) == amount, (
            f"Today's net should have DROPPED by exactly ${amount} when a "
            f"${amount} expense is logged. before_net=${net_before}, "
            f"after_net=${net_after}, delta=${round(net_before - net_after, 2)}. "
            f"User explicitly reported: \"it should have went negative since "
            f"no income has been made yet today.\""
        )
    finally:
        requests.delete(
            f"{BASE}/api/expenses/{exp_id}", headers=admin_headers, timeout=15,
        )
