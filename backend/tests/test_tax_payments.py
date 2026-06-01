"""Quarterly Tax — recorded payments (Mark Q# Paid tracker)."""
import os
import requests
from datetime import date

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _clean_year(h, year):
    rows = requests.get(f"{BASE}/api/admin/quarterly-tax/payments",
                        headers=h, params={"year": year}, timeout=15).json()["payments"]
    for p in rows:
        requests.delete(f"{BASE}/api/admin/quarterly-tax/payments/{p['id']}", headers=h, timeout=15)


def test_payments_crud_roundtrip():
    h = _admin()
    year = date.today().year + 5  # use far-future year so we don't pollute real data
    _clean_year(h, year)
    # Create
    r = requests.post(f"{BASE}/api/admin/quarterly-tax/payments", headers=h,
                      json={"year": year, "quarter": 2, "amount": 432.10,
                            "payment_method": "EFTPS", "memo": "test"}, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert r.json()["payment_date"]  # default to today
    # List
    rows = requests.get(f"{BASE}/api/admin/quarterly-tax/payments",
                        headers=h, params={"year": year}, timeout=15).json()
    assert rows["total"] == 432.10
    assert len(rows["payments"]) == 1
    # Delete
    assert requests.delete(f"{BASE}/api/admin/quarterly-tax/payments/{pid}",
                           headers=h, timeout=15).status_code == 200
    rows = requests.get(f"{BASE}/api/admin/quarterly-tax/payments",
                        headers=h, params={"year": year}, timeout=15).json()
    assert len(rows["payments"]) == 0


def test_payments_validation():
    h = _admin()
    for body, msg in [
        ({"year": 2099, "quarter": 5, "amount": 100}, "quarter must be 1-4"),
        ({"year": 2099, "quarter": 1, "amount": -10}, "amount must be > 0"),
    ]:
        r = requests.post(f"{BASE}/api/admin/quarterly-tax/payments",
                          headers=h, json=body, timeout=15)
        assert r.status_code == 400


def test_payments_reduce_balance_in_quarterly_endpoint():
    h = _admin()
    year = date.today().year
    _clean_year(h, year)
    body_before = requests.get(f"{BASE}/api/admin/quarterly-tax",
                               headers=h, params={"year": year}, timeout=15).json()
    bal_before = body_before["balance_owed_ytd"]
    # Make a $100 payment for Q1
    r = requests.post(f"{BASE}/api/admin/quarterly-tax/payments", headers=h,
                      json={"year": year, "quarter": 1, "amount": 100.0}, timeout=15)
    pid = r.json()["id"]
    body_after = requests.get(f"{BASE}/api/admin/quarterly-tax",
                              headers=h, params={"year": year}, timeout=15).json()
    assert body_after["recorded_payments_total"] == 100.0
    # Each quarter should now have paid+remaining computed
    q1 = next(q for q in body_after["quarters"] if q["quarter"] == 1)
    assert q1["paid"] == 100.0
    assert q1["remaining"] == round(max(0.0, q1["suggested_payment"] - 100.0), 2)
    # Balance dropped (or stayed 0 if total_tax was 0)
    assert body_after["balance_owed_ytd"] <= bal_before
    # Cleanup
    requests.delete(f"{BASE}/api/admin/quarterly-tax/payments/{pid}", headers=h, timeout=15)


def test_payments_requires_admin():
    r = requests.post(f"{BASE}/api/admin/quarterly-tax/payments",
                      json={"year": 2026, "quarter": 1, "amount": 50}, timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{BASE}/api/admin/quarterly-tax/payments", timeout=15)
    assert r.status_code in (401, 403)
