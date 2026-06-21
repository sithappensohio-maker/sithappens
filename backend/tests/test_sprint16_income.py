"""Sprint 16 — Services Catalog + Income Tracking backend tests.

Coverage:
- Services CRUD (admin only, soft-delete defaults, hard-delete custom)
- POST /api/services/seed-standard idempotency (7 first call, 0 second)
- POST /api/transactions (log_service) — service_id snapshot + price fallback
- PUT /api/transactions/{id} — inline edits + paid→completed auto-flip + paid_at stamp
- GET /api/transactions — filters + revenue-bearing rows only
- GET /api/transactions/weekly-summary — Mon-Sun bounds + ref_date shift
- GET /api/transactions/summary-range — by_day series
- POST /api/bookings/{id}/check-out — auto-tally hook
- 403 for client role on all endpoints
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
CLIENT_EMAIL = "testclient@sithappens.com"
CLIENT_PASSWORD = "test1234"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip("Client login not available")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog(admin_headers):
    dogs = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=15).json()
    assert isinstance(dogs, list) and dogs, "Need at least one dog in fixture"
    return dogs[0]


# ---------- Services seed + list ----------
class TestServicesSeed:
    def test_seed_standard_first_run_creates_or_idempotent(self, admin_headers):
        # First call — may seed 7 or skip if already seeded from previous tests
        r = requests.post(f"{BASE_URL}/api/services/seed-standard", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "seeded" in body and "total_active" in body
        assert body["total_active"] >= 7

    def test_seed_standard_second_run_idempotent(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/services/seed-standard", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # Second call must seed 0 — proves idempotency
        assert r.json()["seeded"] == 0

    def test_list_services_sorted_by_name(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 7
        names = [s["name"] for s in items]
        assert names == sorted(names), "Services should be sorted by name"
        # all default services active
        default_names = {s["name"] for s in items if s.get("is_default")}
        assert "Bath" in default_names and "Nail Trim" in default_names


# ---------- Services CRUD ----------
class TestServicesCRUD:
    def test_create_custom_service(self, admin_headers):
        body = {"name": f"TEST_Custom_{uuid.uuid4().hex[:6]}", "base_price": 42.0, "service_type": "training"}
        r = requests.post(f"{BASE_URL}/api/services", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == body["name"]
        assert d["base_price"] == 42.0
        assert d["is_default"] is False
        assert "id" in d
        pytest.custom_svc_id = d["id"]

    def test_update_service(self, admin_headers):
        sid = pytest.custom_svc_id
        body = {"name": f"TEST_Custom_Renamed_{uuid.uuid4().hex[:6]}", "base_price": 55.5, "service_type": "training"}
        r = requests.put(f"{BASE_URL}/api/services/{sid}", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == body["name"]
        assert d["base_price"] == 55.5
        # GET verifies persistence
        listing = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        match = [s for s in listing if s["id"] == sid]
        assert match and match[0]["base_price"] == 55.5

    def test_delete_custom_service_hard_deletes(self, admin_headers):
        sid = pytest.custom_svc_id
        r = requests.delete(f"{BASE_URL}/api/services/{sid}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        listing = requests.get(f"{BASE_URL}/api/services?include_inactive=true",
                               headers=admin_headers, timeout=15).json()
        assert all(s["id"] != sid for s in listing), "Custom service should be hard-deleted"

    def test_delete_default_service_soft_deletes(self, admin_headers):
        # Find a default service
        listing = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        defaults = [s for s in listing if s.get("is_default")]
        assert defaults, "Need at least one default service"
        target = defaults[0]
        sid = target["id"]
        r = requests.delete(f"{BASE_URL}/api/services/{sid}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # Soft-delete: still in DB (include_inactive) but not in active list
        active = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        assert all(s["id"] != sid for s in active)
        all_svc = requests.get(f"{BASE_URL}/api/services?include_inactive=true",
                               headers=admin_headers, timeout=15).json()
        soft = [s for s in all_svc if s["id"] == sid]
        assert soft and soft[0]["active"] is False
        # Restore by reseeding — wait, reseeding only inserts if missing. Reactivate manually via PUT.
        requests.put(f"{BASE_URL}/api/services/{sid}",
                     json={"name": target["name"], "base_price": target["base_price"],
                           "service_type": target.get("service_type"), "active": True},
                     headers=admin_headers, timeout=15)


# ---------- Transactions (log_service) ----------
class TestTransactionsCreate:
    def test_log_service_uses_service_base_price_when_actual_null(self, admin_headers, a_dog):
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        # pick private lesson (has fixed base_price 90)
        target = next((s for s in svcs if s["slug"] == "private_lesson"), svcs[0])
        body = {"dog_id": a_dog["id"], "service_id": target["id"], "date": date.today().isoformat()}
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["service_id"] == target["id"]
        assert d["service_name"] == target["name"]
        assert float(d["actual_price"]) == float(target["base_price"])
        assert d["payment_status"] == "paid"
        assert d["paid_at"]  # auto-stamped
        pytest.txn_fallback_id = d["id"]

    def test_log_service_honors_explicit_actual_price(self, admin_headers, a_dog):
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        target = svcs[0]
        body = {"dog_id": a_dog["id"], "service_id": target["id"], "actual_price": 123.45,
                "payment_status": "unpaid", "payment_method": "cash",
                "date": date.today().isoformat()}
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert float(d["actual_price"]) == 123.45
        assert d["payment_status"] == "unpaid"
        assert d["paid_at"] is None
        pytest.txn_unpaid_id = d["id"]


# ---------- Transactions update ----------
class TestTransactionsUpdate:
    def test_inline_price_edit_persists(self, admin_headers):
        tid = pytest.txn_unpaid_id
        r = requests.put(f"{BASE_URL}/api/transactions/{tid}",
                         json={"actual_price": 200.0}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # GET to verify
        rows = requests.get(f"{BASE_URL}/api/transactions", headers=admin_headers, timeout=15).json()
        match = [r for r in rows if r["id"] == tid]
        assert match and float(match[0]["actual_price"]) == 200.0

    def test_mark_paid_autoflips_to_completed_and_stamps_paid_at(self, admin_headers):
        tid = pytest.txn_unpaid_id
        # Reset status to approved first
        requests.put(f"{BASE_URL}/api/transactions/{tid}",
                     json={"status": "approved", "payment_status": "unpaid"},
                     headers=admin_headers, timeout=15)
        r = requests.put(f"{BASE_URL}/api/transactions/{tid}",
                         json={"payment_status": "paid"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["payment_status"] == "paid"
        assert d["status"] == "completed", "Should auto-flip status to completed when paid"
        assert d["paid_at"], "Should auto-stamp paid_at"

    def test_change_service_updates_name_and_syncs_price_only_if_zero(self, admin_headers, a_dog):
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        svc_a, svc_b = svcs[0], svcs[1]
        # Create txn with explicit price (>0)
        c = requests.post(f"{BASE_URL}/api/transactions",
                          json={"dog_id": a_dog["id"], "service_id": svc_a["id"],
                                "actual_price": 77.0, "date": date.today().isoformat()},
                          headers=admin_headers, timeout=15).json()
        tid = c["id"]
        r = requests.put(f"{BASE_URL}/api/transactions/{tid}",
                         json={"service_id": svc_b["id"]}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["service_name"] == svc_b["name"]
        assert float(d["actual_price"]) == 77.0, "Existing non-zero price should NOT be overwritten"

        # Now create one with 0 price, change service → price should sync
        c2 = requests.post(f"{BASE_URL}/api/transactions",
                           json={"dog_id": a_dog["id"], "service_id": svc_a["id"],
                                 "actual_price": 0, "date": date.today().isoformat()},
                           headers=admin_headers, timeout=15).json()
        tid2 = c2["id"]
        r2 = requests.put(f"{BASE_URL}/api/transactions/{tid2}",
                          json={"service_id": svc_b["id"]}, headers=admin_headers, timeout=15)
        d2 = r2.json()
        assert float(d2["actual_price"]) == float(svc_b["base_price"]), \
            "Zero price should sync to new service base_price"
        # cleanup
        requests.delete(f"{BASE_URL}/api/transactions/{tid}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE_URL}/api/transactions/{tid2}", headers=admin_headers, timeout=15)


# ---------- List transactions + filters ----------
class TestTransactionsList:
    def test_list_excludes_cancelled(self, admin_headers, a_dog):
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        c = requests.post(f"{BASE_URL}/api/transactions",
                          json={"dog_id": a_dog["id"], "service_id": svcs[0]["id"],
                                "actual_price": 10.0, "date": date.today().isoformat()},
                          headers=admin_headers, timeout=15).json()
        tid = c["id"]
        requests.put(f"{BASE_URL}/api/transactions/{tid}",
                     json={"status": "cancelled"}, headers=admin_headers, timeout=15)
        rows = requests.get(f"{BASE_URL}/api/transactions", headers=admin_headers, timeout=15).json()
        assert all(r["id"] != tid for r in rows), "Cancelled txn should be excluded"
        requests.delete(f"{BASE_URL}/api/transactions/{tid}", headers=admin_headers, timeout=15)

    def test_filter_by_dog_and_service(self, admin_headers, a_dog):
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        sid = svcs[0]["id"]
        rows = requests.get(f"{BASE_URL}/api/transactions",
                            params={"dog_id": a_dog["id"], "service_id": sid},
                            headers=admin_headers, timeout=15).json()
        assert all(r["dog_id"] == a_dog["id"] for r in rows)
        assert all(r.get("service_id") == sid for r in rows if r.get("service_id"))


# ---------- Weekly summary ----------
class TestWeeklySummary:
    def test_current_week_bounds_mon_to_sun(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/transactions/weekly-summary",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        start = date.fromisoformat(d["week_start"])
        end = date.fromisoformat(d["week_end"])
        assert start.weekday() == 0, "week_start must be Monday"
        assert end.weekday() == 6, "week_end must be Sunday"
        assert (end - start).days == 6
        for key in ["completed_total", "paid_total", "unpaid_total", "booked_total",
                    "completed_count", "booked_count", "by_service", "credits_redeemed"]:
            assert key in d, f"Missing key {key}"
        assert isinstance(d["by_service"], list)

    def test_ref_date_jumps_weeks(self, admin_headers):
        future = (date.today() + timedelta(days=30)).isoformat()
        r = requests.get(f"{BASE_URL}/api/transactions/weekly-summary",
                         params={"ref_date": future}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        start = date.fromisoformat(d["week_start"])
        assert start.weekday() == 0
        ref = date.fromisoformat(future)
        assert start <= ref <= date.fromisoformat(d["week_end"])

    def test_ref_date_invalid_400(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/transactions/weekly-summary",
                         params={"ref_date": "not-a-date"}, headers=admin_headers, timeout=15)
        assert r.status_code == 400


# ---------- Summary range ----------
class TestSummaryRange:
    def test_summary_range_with_by_day(self, admin_headers):
        start = (date.today() - timedelta(days=14)).isoformat()
        end = date.today().isoformat()
        r = requests.get(f"{BASE_URL}/api/transactions/summary-range",
                         params={"start_date": start, "end_date": end},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["start_date"] == start and d["end_date"] == end
        assert "by_day" in d and isinstance(d["by_day"], list)
        for row in d["by_day"]:
            assert "date" in row and "total" in row


# ---------- Auto-tally hook ----------
class TestCheckOutAutoTally:
    def test_checkout_auto_attaches_default_service_price(self, admin_headers, a_dog):
        # Create a legacy-style booking with no service_id / actual_price
        bk = {
            "dog_id": a_dog["id"],
            "service_type": "daycare",
            "date": date.today().isoformat(),
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=bk, headers=admin_headers, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"POST /bookings not available or rejected: {r.status_code} {r.text}")
        booking = r.json()
        bid = booking["id"]
        # Auto-approve if needed
        requests.put(f"{BASE_URL}/api/bookings/{bid}/status",
                     json={"status": "approved"}, headers=admin_headers, timeout=15)
        # Check-in then check-out
        requests.post(f"{BASE_URL}/api/bookings/{bid}/check-in", headers=admin_headers, timeout=15)
        co = requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out", headers=admin_headers, timeout=15)
        assert co.status_code == 200, co.text
        d = co.json()
        assert d["status"] == "completed"
        # Should have attached a default daycare service
        assert d.get("service_id"), "check-out should auto-attach a service_id"
        assert d.get("actual_price"), "check-out should set actual_price from default service"
        assert d.get("payment_status") == "unpaid"
        # cleanup
        requests.delete(f"{BASE_URL}/api/transactions/{bid}", headers=admin_headers, timeout=15)


# ---------- Client 403 ----------
class TestClientForbidden:
    def test_client_cannot_seed_services(self, client_headers):
        r = requests.post(f"{BASE_URL}/api/services/seed-standard",
                          headers=client_headers, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_crud_services(self, client_headers):
        r = requests.post(f"{BASE_URL}/api/services",
                          json={"name": "TEST_x", "base_price": 1}, headers=client_headers, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_log_transaction(self, client_headers):
        r = requests.post(f"{BASE_URL}/api/transactions",
                          json={"dog_id": "x", "service_id": "x"},
                          headers=client_headers, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_list_transactions(self, client_headers):
        r = requests.get(f"{BASE_URL}/api/transactions", headers=client_headers, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_weekly_summary(self, client_headers):
        r = requests.get(f"{BASE_URL}/api/transactions/weekly-summary",
                         headers=client_headers, timeout=15)
        assert r.status_code == 403


# ---------- Cleanup ----------
class TestZCleanup:
    def test_delete_seed_test_transactions(self, admin_headers):
        # Delete the two fixture txns
        for tid_attr in ["txn_fallback_id", "txn_unpaid_id"]:
            tid = getattr(pytest, tid_attr, None)
            if tid:
                requests.delete(f"{BASE_URL}/api/transactions/{tid}", headers=admin_headers, timeout=15)
