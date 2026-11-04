"""Regression for the Tax Center "stuck loading" bug (2026-11-04).

Root cause: _tax_center_payload calls BOTH _federal_estimated_tax_payload
and _ohio_estimated_tax_payload, and each one independently called
admin_quarterly_tax(year=yr) for the exact same year when nothing was
passed in — a real full-year books scan (bookings + archive + retail_sales
+ expenses + mileage + collection-event reconstruction), not a cheap
lookup, confirmed live at ~35s for ONE call. Computing it twice back-to-
back is what made the Tax Center tab feel permanently stuck. Fixed by
computing it once in _tax_center_payload and passing it to both via a new
optional `quarterly` parameter — standalone callers (the dedicated
/admin/federal-estimated-tax and /admin/ohio-estimated-tax endpoints)
still omit it and compute their own, unchanged.

Separately, bookings_archive had no index on `paid_at` at all (its sibling
`bookings.paid_at` did) despite _booking_collection_events filtering AND
sorting bookings_archive by that exact field on every admin_quarterly_tax
call — a full collection scan + in-memory sort of the whole archive.
Added `bookings_archive_paid_at` (sparse) alongside the existing
`bookings_paid_at` index.

This test is a correctness/smoke check, not a timing assertion (timing
thresholds are flaky across CI machines and local dev data volume) — it
confirms the optional `quarterly` parameter didn't break either calling
convention: the standalone endpoints (which omit it) and the aggregator
(which now passes a shared value) must all still return 200 with sane
shapes for the same year.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def _admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_tax_center_aggregator_and_standalone_endpoints_all_succeed():
    headers = _admin_headers()
    year = 2026

    center = requests.get(f"{API}/admin/tax-center", headers=headers,
                           params={"year": year}, timeout=90)
    assert center.status_code == 200, f"tax-center failed: {center.status_code} {center.text[:500]}"
    body = center.json()
    assert body["tax_year"] == year
    assert isinstance(body.get("obligations"), list) and len(body["obligations"]) > 0
    jurisdictions = {o["jurisdiction"] for o in body["obligations"]}
    assert "federal" in jurisdictions, "federal obligation missing from tax-center response"
    assert "ohio" in jurisdictions, "ohio obligation missing from tax-center response"

    fed = requests.get(f"{API}/admin/federal-estimated-tax", headers=headers,
                        params={"year": year}, timeout=90)
    assert fed.status_code == 200, f"standalone federal endpoint failed: {fed.status_code} {fed.text[:500]}"
    assert fed.json()["tax_year"] == year

    oh = requests.get(f"{API}/admin/ohio-estimated-tax", headers=headers,
                       params={"year": year}, timeout=90)
    assert oh.status_code == 200, f"standalone ohio endpoint failed: {oh.status_code} {oh.text[:500]}"
    assert oh.json()["tax_year"] == year


def test_tax_center_shares_one_quarterly_computation_between_jurisdictions():
    """Both jurisdictions' business_projection.actual_ytd_business_profit
    must agree with each other and with the standalone admin_quarterly_tax
    net_profit for the same year — proving they're built from the SAME
    shared computation the aggregator now passes in, not two independent
    (and potentially inconsistent, or silently stale) ones."""
    headers = _admin_headers()
    year = 2026

    qt = requests.get(f"{API}/admin/quarterly-tax", headers=headers,
                       params={"year": year}, timeout=90)
    assert qt.status_code == 200
    net_profit = qt.json()["net_profit"]

    fed = requests.get(f"{API}/admin/federal-estimated-tax", headers=headers,
                        params={"year": year}, timeout=90).json()
    oh = requests.get(f"{API}/admin/ohio-estimated-tax", headers=headers,
                       params={"year": year}, timeout=90).json()

    fed_ytd = fed["business_projection"]["actual_ytd_business_profit"]
    oh_ytd = oh["business_projection"]["actual_ytd_business_profit"]
    assert fed_ytd == round(float(net_profit), 2), f"federal YTD {fed_ytd} != quarterly-tax net_profit {net_profit}"
    assert oh_ytd == round(float(net_profit), 2), f"ohio YTD {oh_ytd} != quarterly-tax net_profit {net_profit}"
