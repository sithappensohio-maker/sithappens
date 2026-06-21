"""Sprint 110bq — Business mileage log + quarterly-tax integration."""
import os
import requests
import pytest

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


@pytest.fixture(autouse=True)
def _clean_pytest_rows(admin_headers):
    """Wipe any mileage entries created by this suite so re-runs are stable."""
    rows = requests.get(f"{API}/admin/mileage",
                        headers=admin_headers, timeout=15).json().get("rows", [])
    for r in rows:
        if (r.get("purpose") or "").startswith("PYTEST-"):
            requests.delete(f"{API}/admin/mileage/{r['id']}",
                            headers=admin_headers, timeout=15)
    yield
    rows = requests.get(f"{API}/admin/mileage",
                        headers=admin_headers, timeout=15).json().get("rows", [])
    for r in rows:
        if (r.get("purpose") or "").startswith("PYTEST-"):
            requests.delete(f"{API}/admin/mileage/{r['id']}",
                            headers=admin_headers, timeout=15)


def test_create_list_delete(admin_headers):
    r = requests.post(
        f"{API}/admin/mileage",
        headers=admin_headers,
        json={"miles": 15.4, "purpose": "PYTEST-create", "destination": "Vet office"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["miles"] == 15.4
    assert body["purpose"] == "PYTEST-create"
    assert body["destination"] == "Vet office"
    assert body["date"]  # auto-populated to today
    mid = body["id"]

    listed = requests.get(f"{API}/admin/mileage",
                          headers=admin_headers, timeout=15).json()["rows"]
    assert any(r["id"] == mid for r in listed)

    requests.delete(f"{API}/admin/mileage/{mid}",
                    headers=admin_headers, timeout=15)
    listed = requests.get(f"{API}/admin/mileage",
                          headers=admin_headers, timeout=15).json()["rows"]
    assert not any(r["id"] == mid for r in listed)


def test_validation(admin_headers):
    bad = requests.post(f"{API}/admin/mileage", headers=admin_headers,
                        json={"miles": -5, "purpose": "PYTEST-bad"}, timeout=15)
    assert bad.status_code in (400, 422)
    bad = requests.post(f"{API}/admin/mileage", headers=admin_headers,
                        json={"miles": 9999, "purpose": "PYTEST-bad"}, timeout=15)
    assert bad.status_code in (400, 422)
    bad = requests.post(f"{API}/admin/mileage", headers=admin_headers,
                        json={"miles": 5, "date": "not-a-date",
                              "purpose": "PYTEST-bad"}, timeout=15)
    assert bad.status_code == 400


def test_summary_buckets(admin_headers):
    # Three entries logged today
    for m in (5, 7.5, 2):
        requests.post(f"{API}/admin/mileage", headers=admin_headers,
                      json={"miles": m, "purpose": "PYTEST-summary"}, timeout=15)
    s = requests.get(f"{API}/admin/mileage/summary",
                     headers=admin_headers, timeout=15).json()
    assert s["today_miles"] >= 14.5
    assert s["mtd_miles"] >= s["today_miles"]
    assert s["ytd_miles"] >= s["mtd_miles"]
    assert s["rate_per_mile"] > 0
    # Deduction math = miles × rate
    assert abs(s["ytd_deduction"] - round(s["ytd_miles"] * s["rate_per_mile"], 2)) < 0.05


def test_summary_tax_savings(admin_headers):
    # Log a fresh trip and verify the tax-savings chip math
    requests.post(f"{API}/admin/mileage", headers=admin_headers,
                  json={"miles": 100, "purpose": "PYTEST-savings"}, timeout=15)
    s = requests.get(f"{API}/admin/mileage/summary",
                     headers=admin_headers, timeout=15).json()
    assert "ytd_tax_savings" in s
    assert "combined_tax_rate_pct" in s
    # Sole-prop combined rate should land in a sane band (15–45%)
    assert 15.0 <= s["combined_tax_rate_pct"] <= 45.0
    # Savings = deduction × combined_rate (within rounding tolerance)
    expected = round(s["ytd_deduction"] * (s["combined_tax_rate_pct"] / 100.0), 2)
    assert abs(s["ytd_tax_savings"] - expected) <= 0.05


def test_update_entry(admin_headers):
    r = requests.post(f"{API}/admin/mileage", headers=admin_headers,
                      json={"miles": 8, "purpose": "PYTEST-update"}, timeout=15)
    mid = r.json()["id"]
    r2 = requests.put(f"{API}/admin/mileage/{mid}", headers=admin_headers,
                      json={"miles": 11, "purpose": "PYTEST-update-revised"},
                      timeout=15)
    assert r2.status_code == 200
    assert r2.json()["miles"] == 11
    assert r2.json()["purpose"] == "PYTEST-update-revised"


def test_quarterly_tax_includes_mileage(admin_headers):
    # Snapshot before
    before = requests.get(f"{API}/admin/quarterly-tax",
                          headers=admin_headers, timeout=15).json()
    before_exp = before["expenses"]["total"]
    before_ded = before["expenses"]["mileage_deduction"]
    rate = before["expenses"]["mileage_rate"]

    # Log 25 mi today
    r = requests.post(f"{API}/admin/mileage", headers=admin_headers,
                      json={"miles": 25, "purpose": "PYTEST-qt"}, timeout=15)
    assert r.status_code == 200

    after = requests.get(f"{API}/admin/quarterly-tax",
                         headers=admin_headers, timeout=15).json()
    expected_delta = round(25 * rate, 2)
    actual_delta = round(after["expenses"]["mileage_deduction"] - before_ded, 2)
    assert abs(actual_delta - expected_delta) < 0.05, \
        f"expected delta {expected_delta} got {actual_delta}"
    # Total expenses should also rise by approximately the same amount
    exp_delta = round(after["expenses"]["total"] - before_exp, 2)
    assert exp_delta >= expected_delta - 0.05


def test_settings_persist_mileage_rate(admin_headers):
    # Read current
    cur = requests.get(f"{API}/admin/quarterly-tax/settings",
                       headers=admin_headers, timeout=15).json()
    assert "mileage_rate_per_mile" in cur["defaults"]
    orig = cur["current"].get("mileage_rate_per_mile", 0.70)

    # Bump to 0.99
    upd = requests.put(f"{API}/admin/quarterly-tax/settings",
                       headers=admin_headers,
                       json={"mileage_rate_per_mile": 0.99}, timeout=15)
    assert upd.status_code == 200
    assert upd.json()["settings"]["mileage_rate_per_mile"] == 0.99

    # Summary should reflect new rate immediately
    s = requests.get(f"{API}/admin/mileage/summary",
                     headers=admin_headers, timeout=15).json()
    assert s["rate_per_mile"] == 0.99

    # Restore
    requests.put(f"{API}/admin/quarterly-tax/settings",
                 headers=admin_headers,
                 json={"mileage_rate_per_mile": orig}, timeout=15)


def test_admin_required():
    r = requests.post(f"{API}/admin/mileage", json={"miles": 5}, timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{API}/admin/mileage/summary", timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{API}/admin/mileage/recent-trips", timeout=15)
    assert r.status_code in (401, 403)


def test_recent_trips_dedupes(admin_headers):
    # Three log entries — two with same (purpose, destination) pair, one different
    requests.post(f"{API}/admin/mileage", headers=admin_headers,
                  json={"miles": 5, "purpose": "PYTEST-trip-A",
                        "destination": "PYTEST-dest-1"}, timeout=15)
    requests.post(f"{API}/admin/mileage", headers=admin_headers,
                  json={"miles": 6, "purpose": "PYTEST-trip-A",
                        "destination": "PYTEST-dest-1"}, timeout=15)  # dup pair
    requests.post(f"{API}/admin/mileage", headers=admin_headers,
                  json={"miles": 7, "purpose": "PYTEST-trip-B",
                        "destination": "PYTEST-dest-2"}, timeout=15)
    r = requests.get(f"{API}/admin/mileage/recent-trips",
                     headers=admin_headers, timeout=15).json()
    trips = r["trips"]
    keys = [(t["purpose"], t["destination"]) for t in trips]
    # The two duplicates should collapse to a single entry
    pytest_a_count = sum(1 for k in keys if k == ("PYTEST-trip-A", "PYTEST-dest-1"))
    pytest_b_count = sum(1 for k in keys if k == ("PYTEST-trip-B", "PYTEST-dest-2"))
    assert pytest_a_count == 1
    assert pytest_b_count == 1
    # Capped at 10
    assert len(trips) <= 10
    # Each entry carries `last_miles` from the most recent log of that pair
    a = next(t for t in trips if t["purpose"] == "PYTEST-trip-A")
    assert a["last_miles"] == 6  # the second (more recent) PYTEST-trip-A row was 6 mi
