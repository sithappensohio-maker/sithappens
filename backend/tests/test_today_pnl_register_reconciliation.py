"""Today's P&L must reconcile to the register's cash-basis incoming total.

Regression: the old endpoint rebuilt service revenue from bookings whose
*service date* was today. The register correctly recognizes money on the
business date it was collected. That mismatch could omit non-cash payments,
payments on earlier boarding stays, tab payments, and other register income.
"""
import os
import pytest
import requests

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
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


def test_today_pnl_reconciles_to_register_for_every_payment_method(admin_headers):
    register = requests.get(
        f"{BASE}/api/admin/register/day", headers=admin_headers, timeout=15,
    )
    register.raise_for_status()
    register_body = register.json()

    pnl = requests.get(
        f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15,
    )
    pnl.raise_for_status()
    pnl_body = pnl.json()

    expected_total = round(float((register_body.get("totals") or {}).get("incoming_total") or 0), 2)
    actual_total = round(float(pnl_body.get("revenue") or 0), 2)
    assert actual_total == expected_total, (
        f"Today's P&L revenue (${actual_total}) must equal the register's "
        f"cash-basis incoming total (${expected_total})."
    )

    expected_methods = register_body.get("incoming_by_method") or {}
    actual_methods = pnl_body.get("revenue_by_method") or {}
    for method in ("cash", "check", "venmo", "paypal", "clover", "venmo_paypal", "other"):
        assert round(float(actual_methods.get(method) or 0), 2) == round(float(expected_methods.get(method) or 0), 2), (
            f"P&L method total for {method} does not match the register."
        )
