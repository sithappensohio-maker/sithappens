"""Regression tests for the Retail Sales feature.

Covers:
- POST /api/retail-sales creates a row
- GET  /api/retail-sales lists by date window
- PUT  /api/retail-sales/{id} updates fields and re-resolves client_name
- DELETE /api/retail-sales/{id} removes the row
- /api/transactions/weekly-summary exposes retail_total / retail_count / gross_total
- /api/transactions/summary-range folds retail into completed_total + by_day + net_total
- /api/reports/pl includes retail in income.retail_total / gross_total
"""
import os
import uuid
import requests
import pytest
from datetime import date

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def today_iso():
    return date.today().isoformat()


def test_create_list_update_delete_retail_sale(admin_headers, today_iso):
    tag = uuid.uuid4().hex[:8]
    desc = f"TestSale-{tag}"
    # create
    r = requests.post(
        f"{BASE}/api/retail-sales",
        json={
            "date": today_iso,
            "description": desc,
            "amount": 19.99,
            "category": "TestCat",
            "payment_method": "card",
            "notes": "unit-test row",
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    sale = r.json()
    assert sale["id"] and sale["amount"] == 19.99 and sale["description"] == desc

    # list — should include this row
    r = requests.get(f"{BASE}/api/retail-sales",
                     params={"start_date": today_iso, "end_date": today_iso},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert any(s["id"] == sale["id"] for s in rows)

    # update — amount + payment method
    r = requests.put(
        f"{BASE}/api/retail-sales/{sale['id']}",
        json={**sale, "amount": 25.00, "payment_method": "cash"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["amount"] == 25.00 and updated["payment_method"] == "cash"

    # delete
    r = requests.delete(f"{BASE}/api/retail-sales/{sale['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    # verify gone
    r = requests.get(f"{BASE}/api/retail-sales",
                     params={"start_date": today_iso, "end_date": today_iso},
                     headers=admin_headers, timeout=15)
    ids = [s["id"] for s in r.json()]
    assert sale["id"] not in ids


def test_weekly_summary_includes_retail(admin_headers, today_iso):
    """Logging a retail sale today must show up in weekly summary tile."""
    # Baseline
    r = requests.get(f"{BASE}/api/transactions/weekly-summary",
                     params={"ref_date": today_iso},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    base = r.json()
    base_retail = float(base.get("retail_total") or 0)
    base_count = int(base.get("retail_count") or 0)
    base_gross = float(base.get("gross_total") or base.get("completed_total") or 0)

    # Add a $40 sale
    r = requests.post(
        f"{BASE}/api/retail-sales",
        json={"date": today_iso, "description": "Test kibble", "amount": 40.0, "category": "Food"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    sale_id = r.json()["id"]

    try:
        r = requests.get(f"{BASE}/api/transactions/weekly-summary",
                         params={"ref_date": today_iso},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert round(float(s["retail_total"]) - base_retail, 2) == 40.0
        assert int(s["retail_count"]) == base_count + 1
        assert round(float(s["gross_total"]) - base_gross, 2) == 40.0
        # Service-side completed_total must NOT include retail (kept separate)
        assert s.get("service_total") == s.get("completed_total")
    finally:
        requests.delete(f"{BASE}/api/retail-sales/{sale_id}", headers=admin_headers)


def test_summary_range_includes_retail(admin_headers, today_iso):
    """summary-range completed_total + by_day + net_total must include retail."""
    r = requests.get(f"{BASE}/api/transactions/summary-range",
                     params={"start_date": today_iso, "end_date": today_iso},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    base = r.json()
    base_completed = float(base["completed_total"])
    base_retail = float(base.get("retail_total") or 0)
    base_net = float(base.get("net_total") or 0)

    # Log a $75 sale
    r = requests.post(
        f"{BASE}/api/retail-sales",
        json={"date": today_iso, "description": "Test leash bundle", "amount": 75.0},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    sale_id = r.json()["id"]

    try:
        r = requests.get(f"{BASE}/api/transactions/summary-range",
                         params={"start_date": today_iso, "end_date": today_iso},
                         headers=admin_headers, timeout=15)
        s = r.json()
        # Retail is folded into gross completed_total
        assert round(float(s["completed_total"]) - base_completed, 2) == 75.0
        # Net moves up by 75 (no labor/expense touched)
        assert round(float(s["net_total"]) - base_net, 2) == 75.0
        # Retail tracked separately too
        assert round(float(s["retail_total"]) - base_retail, 2) == 75.0
        # by_day picks up today
        today_total = next((d["total"] for d in s["by_day"] if d["date"] == today_iso), 0)
        assert today_total >= 75.0
    finally:
        requests.delete(f"{BASE}/api/retail-sales/{sale_id}", headers=admin_headers)


def test_pl_report_includes_retail(admin_headers, today_iso):
    """P&L JSON must expose retail breakdown + gross income."""
    r = requests.post(
        f"{BASE}/api/retail-sales",
        json={"date": today_iso, "description": "PL test sale", "amount": 100.0, "category": "PLTest"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    sale_id = r.json()["id"]

    try:
        # Use a tight window around today so the assertion is deterministic
        r = requests.get(
            f"{BASE}/api/reports/pl",
            params={"start_date": today_iso, "end_date": today_iso},
            headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["income"]["retail_total"] >= 100.0
        assert d["income"]["gross_total"] >= d["income"]["completed_total"] + 100.0 - 0.01
        assert d["retail"]["count"] >= 1
        # by_category must include "PLTest"
        cats = [c["name"] for c in d["retail"]["by_category"]]
        assert "PLTest" in cats
    finally:
        requests.delete(f"{BASE}/api/retail-sales/{sale_id}", headers=admin_headers)
