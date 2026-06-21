"""Quarterly Tax Estimate (Sole-Proprietor / Schedule C)."""
import os
import requests
from datetime import date

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_quarterly_tax_payload_shape():
    h = _admin()
    r = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    # Top-level keys
    for k in ("year", "as_of", "period", "income", "expenses", "net_profit",
              "se_tax", "income_tax", "total_tax_ytd", "balance_owed_ytd",
              "quarters", "current_quarter", "next_quarter_due", "settings",
              "disclaimer", "estimated_payments_made"):
        assert k in body, f"missing top-level key: {k}"

    # Income sub-keys
    for k in ("service_bookings", "retail_sales", "gross"):
        assert k in body["income"]
    # Expenses sub-keys
    for k in ("recorded", "labor_gross", "labor_burden", "labor_total", "total"):
        assert k in body["expenses"]
    # SE tax sub-keys
    for k in ("taxable_base", "social_security", "medicare", "total", "deductible_half"):
        assert k in body["se_tax"]
    # Income tax sub-keys
    for k in ("taxable_income", "federal", "state", "local", "total"):
        assert k in body["income_tax"]


def test_quarterly_tax_quarters_structure():
    body = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=_admin(), timeout=20).json()
    assert len(body["quarters"]) == 4
    statuses = set()
    for q in body["quarters"]:
        for k in ("quarter", "due", "period", "suggested_payment", "status"):
            assert k in q, f"quarter missing {k}"
        statuses.add(q["status"])
        # Each suggested payment is YTD / 4 (matches all four quarters)
        assert isinstance(q["suggested_payment"], (int, float))
    assert statuses.issubset({"past", "current", "upcoming"})
    # Exactly one current quarter
    current = [q for q in body["quarters"] if q["status"] == "current"]
    assert len(current) == 1


def test_quarterly_tax_math_consistency():
    body = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=_admin(), timeout=20).json()
    # Net profit = gross income - total expenses (allow tiny FP wobble)
    net = body["income"]["gross"] - body["expenses"]["total"]
    assert abs(net - body["net_profit"]) < 0.05
    # SE total = SS + Medicare
    se = body["se_tax"]
    assert abs((se["social_security"] + se["medicare"]) - se["total"]) < 0.05
    # Income tax total = federal + state + local
    it = body["income_tax"]
    assert abs((it["federal"] + it["state"] + it["local"]) - it["total"]) < 0.05
    # Total YTD = SE + income tax total
    assert abs((se["total"] + it["total"]) - body["total_tax_ytd"]) < 0.05


def test_quarterly_tax_settings_roundtrip():
    h = _admin()
    # GET current + defaults
    r = requests.get(f"{BASE}/api/admin/quarterly-tax/settings", headers=h, timeout=15)
    assert r.status_code == 200
    payload = r.json()
    assert "current" in payload and "defaults" in payload
    original_fed = payload["current"]["federal_income_pct"]

    # PUT a change
    new_fed = 22.0 if original_fed != 22.0 else 18.0
    r = requests.put(f"{BASE}/api/admin/quarterly-tax/settings",
                     headers=h, json={"federal_income_pct": new_fed}, timeout=15)
    assert r.status_code == 200, r.text
    assert abs(r.json()["settings"]["federal_income_pct"] - new_fed) < 0.001

    # Verify the estimate now uses the new rate
    body = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
    assert abs(body["settings"]["federal_income_pct"] - new_fed) < 0.001

    # Restore original
    requests.put(f"{BASE}/api/admin/quarterly-tax/settings",
                 headers=h, json={"federal_income_pct": original_fed}, timeout=15)


def test_quarterly_tax_balance_after_payments():
    h = _admin()
    # Bump estimated_payments_made high enough to zero out balance
    body = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
    total = body["total_tax_ytd"]
    huge = total + 5000
    requests.put(f"{BASE}/api/admin/quarterly-tax/settings",
                 headers=h, json={"estimated_payments_made": huge}, timeout=15)
    body2 = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
    assert body2["balance_owed_ytd"] == 0.0
    # Restore to zero
    requests.put(f"{BASE}/api/admin/quarterly-tax/settings",
                 headers=h, json={"estimated_payments_made": 0.0}, timeout=15)


def test_quarterly_tax_year_param():
    h = _admin()
    last_year = date.today().year - 1
    r = requests.get(f"{BASE}/api/admin/quarterly-tax",
                     headers=h, params={"year": last_year}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == last_year
    assert body["period"]["start"] == f"{last_year}-01-01"
    assert body["period"]["end"] == f"{last_year}-12-31"


def test_quarterly_tax_requires_admin():
    r = requests.get(f"{BASE}/api/admin/quarterly-tax", timeout=15)
    assert r.status_code in (401, 403)
