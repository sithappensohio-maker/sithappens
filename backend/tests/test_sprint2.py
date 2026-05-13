"""Sit Happens Sprint 2 API tests: check-in/out, report card, vaccine alerts."""
import os
import uuid
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def s2_client(admin_h):
    r = requests.post(f"{BASE_URL}/api/clients",
                      json={"name": f"TEST_S2_{uuid.uuid4().hex[:6]}", "email": "s2@x.com", "credits": 10},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def s2_dog(admin_h, s2_client):
    rabies_future = (date.today() + timedelta(days=365)).isoformat()
    r = requests.post(f"{BASE_URL}/api/dogs",
                      json={"owner_id": s2_client["id"], "name": "TEST_S2_Dog", "breed": "Husky",
                            "vaccines": {"rabies": rabies_future, "bordetella": "", "dhpp": ""}},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def s2_portal(admin_h, s2_client):
    email = f"s2portal_{uuid.uuid4().hex[:6]}@example.com"
    pw = "client123"
    r = requests.post(f"{BASE_URL}/api/clients/{s2_client['id']}/portal-account",
                      json={"email": email, "password": pw}, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    lr = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": pw}, timeout=15)
    assert lr.status_code == 200
    return {"Authorization": f"Bearer {lr.json()['token']}"}


@pytest.fixture(scope="module")
def s2_booking(admin_h, s2_dog):
    """Admin-created booking dated today => approved + credits deducted."""
    today_iso = date.today().isoformat()
    r = requests.post(f"{BASE_URL}/api/bookings",
                      json={"dog_id": s2_dog["id"], "date": today_iso, "service_type": "daycare"},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "approved"
    return b


# ---------- Check-in / Check-out ----------
class TestCheckInOut:
    def test_check_in_stamps_time(self, admin_h, s2_booking):
        r = requests.post(f"{BASE_URL}/api/bookings/{s2_booking['id']}/check-in",
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == s2_booking["id"]
        assert d.get("checked_in_at"), "checked_in_at must be set"
        assert isinstance(d["checked_in_at"], str)
        # verify persisted via GET /bookings
        lst = requests.get(f"{BASE_URL}/api/bookings", headers=admin_h, timeout=15).json()
        found = next(b for b in lst if b["id"] == s2_booking["id"])
        assert found["checked_in_at"] == d["checked_in_at"]

    def test_check_in_not_found(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/bookings/nonexistent-id/check-in",
                          headers=admin_h, timeout=15)
        assert r.status_code == 404

    def test_check_out_sets_completed(self, admin_h, s2_booking):
        r = requests.post(f"{BASE_URL}/api/bookings/{s2_booking['id']}/check-out",
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "completed"
        assert d.get("checked_out_at")
        # persistence check
        lst = requests.get(f"{BASE_URL}/api/bookings", headers=admin_h, timeout=15).json()
        found = next(b for b in lst if b["id"] == s2_booking["id"])
        assert found["status"] == "completed"
        assert found["checked_out_at"] == d["checked_out_at"]


# ---------- Report card ----------
class TestReportCard:
    def test_save_report_card(self, admin_h, s2_booking):
        payload = {
            "photos": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="],
            "mood_tags": ["happy", "playful"],
            "note": "Great day at daycare!",
        }
        r = requests.post(f"{BASE_URL}/api/bookings/{s2_booking['id']}/report-card",
                          json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        rc = d.get("report_card")
        assert rc is not None
        assert rc["mood_tags"] == ["happy", "playful"]
        assert rc["note"] == "Great day at daycare!"
        assert len(rc["photos"]) == 1
        assert rc.get("created_at")

    def test_report_card_not_found(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/bookings/nope/report-card",
                          json={"photos": [], "mood_tags": [], "note": ""},
                          headers=admin_h, timeout=15)
        assert r.status_code == 404

    def test_report_card_visible_in_portal(self, s2_portal, s2_booking):
        r = requests.get(f"{BASE_URL}/api/bookings", headers=s2_portal, timeout=15)
        assert r.status_code == 200
        items = r.json()
        target = next((b for b in items if b["id"] == s2_booking["id"]), None)
        assert target is not None, "client portal must see their booking"
        assert target.get("report_card") is not None
        assert target["report_card"]["note"] == "Great day at daycare!"
        assert "happy" in target["report_card"]["mood_tags"]


# ---------- Dashboard roster includes completed ----------
class TestDashboardRoster:
    def test_today_roster_includes_completed(self, admin_h, s2_booking):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        roster = d.get("today_roster", [])
        target = next((b for b in roster if b["id"] == s2_booking["id"]), None)
        assert target is not None, "completed booking should remain on today_roster"
        assert target["status"] == "completed"
        assert target.get("checked_in_at")
        assert target.get("checked_out_at")
        assert target.get("report_card") is not None


# ---------- Vaccine alerts ----------
@pytest.fixture(scope="module")
def alert_dog_missing(admin_h, s2_client):
    r = requests.post(f"{BASE_URL}/api/dogs",
                      json={"owner_id": s2_client["id"], "name": "TEST_S2_Missing",
                            "vaccines": {"rabies": "", "bordetella": "", "dhpp": ""}},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def alert_dog_expired(admin_h, s2_client):
    r = requests.post(f"{BASE_URL}/api/dogs",
                      json={"owner_id": s2_client["id"], "name": "TEST_S2_Expired",
                            "vaccines": {"rabies": "2020-01-01"}},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def alert_dog_expiring(admin_h, s2_client):
    soon = (date.today() + timedelta(days=10)).isoformat()
    r = requests.post(f"{BASE_URL}/api/dogs",
                      json={"owner_id": s2_client["id"], "name": "TEST_S2_Expiring",
                            "vaccines": {"rabies": soon}},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestVaccineAlerts:
    def test_admin_only(self, s2_portal):
        r = requests.get(f"{BASE_URL}/api/vaccine-alerts", headers=s2_portal, timeout=15)
        assert r.status_code == 403

    def test_alerts_returns_statuses(self, admin_h, alert_dog_missing, alert_dog_expired, alert_dog_expiring, s2_client):
        r = requests.get(f"{BASE_URL}/api/vaccine-alerts", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        alerts = r.json()
        by_id = {a["dog_id"]: a for a in alerts}
        assert alert_dog_missing["id"] in by_id
        assert by_id[alert_dog_missing["id"]]["status"] == "missing"
        assert by_id[alert_dog_missing["id"]]["owner_name"] == s2_client["name"]

        assert alert_dog_expired["id"] in by_id
        assert by_id[alert_dog_expired["id"]]["status"] == "expired"

        assert alert_dog_expiring["id"] in by_id
        assert by_id[alert_dog_expiring["id"]]["status"] == "expiring"

    def test_dismiss_suppresses_alert(self, admin_h, alert_dog_expired):
        r = requests.post(f"{BASE_URL}/api/vaccine-alerts/{alert_dog_expired['id']}/dismiss",
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # verify excluded from alerts list now
        lst = requests.get(f"{BASE_URL}/api/vaccine-alerts", headers=admin_h, timeout=15).json()
        ids = [a["dog_id"] for a in lst]
        assert alert_dog_expired["id"] not in ids


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_h):
    yield
    try:
        cl = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15).json()
        for c in cl:
            if c["name"].startswith("TEST_S2_") or c["name"].startswith("TEST_Client_"):
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=admin_h, timeout=15)
    except Exception:
        pass
