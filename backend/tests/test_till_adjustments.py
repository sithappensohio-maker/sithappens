"""Regression coverage for physical till adjustments.

Till adjustments must change expected drawer cash without being counted as
sales income or business expenses. A reason is always required for the audit
trail.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
TEST_DATE = "2099-12-31"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_till_add_and_owner_draw_only_change_drawer(admin_headers):
    before_r = requests.get(
        f"{BASE}/api/admin/register/day",
        params={"date": TEST_DATE},
        headers=admin_headers,
        timeout=15,
    )
    assert before_r.status_code == 200, before_r.text
    before = before_r.json()
    before_totals = before.get("totals") or {}
    tag = uuid.uuid4().hex[:8]

    add_reason = f"Test change fund {tag}"
    add_r = requests.post(
        f"{BASE}/api/admin/register/till-adjustment",
        json={
            "date": TEST_DATE,
            "direction": "add",
            "amount": 40,
            "adjustment_type": "change_fund",
            "reason": add_reason,
            "notes": "Automated regression test",
        },
        headers=admin_headers,
        timeout=15,
    )
    assert add_r.status_code == 200, add_r.text

    draw_reason = f"Test owner draw {tag}"
    draw_r = requests.post(
        f"{BASE}/api/admin/register/till-adjustment",
        json={
            "date": TEST_DATE,
            "direction": "remove",
            "amount": 15,
            "adjustment_type": "owner_draw",
            "reason": draw_reason,
        },
        headers=admin_headers,
        timeout=15,
    )
    assert draw_r.status_code == 200, draw_r.text

    after_r = requests.get(
        f"{BASE}/api/admin/register/day",
        params={"date": TEST_DATE},
        headers=admin_headers,
        timeout=15,
    )
    assert after_r.status_code == 200, after_r.text
    after = after_r.json()
    totals = after.get("totals") or {}

    assert round(float(totals.get("till_additions", 0)) - float(before_totals.get("till_additions", 0)), 2) == 40
    assert round(float(totals.get("till_removals", 0)) - float(before_totals.get("till_removals", 0)), 2) == 15
    assert round(float(totals.get("expected_cash", 0)) - float(before_totals.get("expected_cash", 0)), 2) == 25

    # Physical till movements are not revenue or expenses.
    assert float(totals.get("incoming_total", 0)) == float(before_totals.get("incoming_total", 0))
    assert float(totals.get("expense_total", 0)) == float(before_totals.get("expense_total", 0))

    reasons = {row.get("description") for row in (after.get("activity") or []) if row.get("kind") == "till_adjustment"}
    assert add_reason in reasons
    assert draw_reason in reasons


def test_till_adjustment_requires_reason(admin_headers):
    r = requests.post(
        f"{BASE}/api/admin/register/till-adjustment",
        json={
            "date": TEST_DATE,
            "direction": "remove",
            "amount": 10,
            "adjustment_type": "other",
            "reason": "",
        },
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 422
