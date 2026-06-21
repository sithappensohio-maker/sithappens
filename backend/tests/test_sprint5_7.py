"""Sprint 5 + 7 tests: feeding/medication/training skills per dog,
dropoff/pickup times on bookings, run sheet endpoint, homework assignments,
dashboard roster with dog enrichment.
"""
import os
import uuid
import time
import requests
import pytest
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"

TODAY = date.today().isoformat()
FUTURE_VAX = (date.today() + timedelta(days=365)).isoformat()
BOOKING_DATE = (date.today() + timedelta(days=3)).isoformat()


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def setup_settings_all_vax(admin_headers):
    """Ensure all three vaccines required (Sprint 5/7 default behavior)."""
    payload = {
        "required_vaccines": ["rabies", "bordetella", "dhpp"],
        "waiver_required_for_booking": False,
    }
    r = requests.put(f"{BASE_URL}/api/settings", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200
    yield
    # restore legacy single-vaccine state for downstream session tests
    requests.put(f"{BASE_URL}/api/settings",
                 json={"required_vaccines": ["rabies"]},
                 headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def test_client(admin_headers):
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_S57_Client_{suffix}",
        "phone": "555-1234",
        "email": f"test_s57_{suffix}@example.com",
        "emerg": "555-9999 (Mom)",
        "credits": 100,
    }
    r = requests.post(f"{BASE_URL}/api/clients", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield r.json()
    requests.delete(f"{BASE_URL}/api/clients/{cid}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def portal_client(admin_headers, test_client):
    pw = "client123"
    email = f"portal_s57_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/clients/{test_client['id']}/portal-account",
        json={"email": email, "password": pw},
        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    login = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=15)
    assert login.status_code == 200
    return {"token": login.json()["token"], "client_id": test_client["id"]}


@pytest.fixture(scope="module")
def other_portal_client(admin_headers):
    """A second client + portal user used to verify 403 on other-client homework."""
    suffix = uuid.uuid4().hex[:8]
    c = requests.post(f"{BASE_URL}/api/clients",
                      json={"name": f"TEST_S57_Other_{suffix}", "credits": 10},
                      headers=admin_headers, timeout=15).json()
    email = f"other_s57_{suffix}@example.com"
    requests.post(f"{BASE_URL}/api/clients/{c['id']}/portal-account",
                  json={"email": email, "password": "client123"},
                  headers=admin_headers, timeout=15)
    login = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "client123"}, timeout=15)
    yield {"token": login.json()["token"], "client_id": c["id"]}
    requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def test_dog(admin_headers, setup_settings_all_vax, test_client):
    payload = {
        "owner_id": test_client["id"],
        "name": "TEST_S57_Buddy",
        "breed": "Labrador",
        "age_y": 3,
        "sex": "Male",
        "fixed": "Yes",
        "vaccines": {"rabies": FUTURE_VAX, "bordetella": FUTURE_VAX, "dhpp": FUTURE_VAX},
        "feeding_schedule": [
            {"time": "07:00", "amount": "2 cups", "food_type": "Kibble", "notes": "morning"},
            {"time": "18:00", "amount": "2 cups", "food_type": "Kibble", "notes": "evening"},
        ],
        "medications": [
            {"name": "Apoquel", "dosage": "16mg", "times": ["08:00", "20:00"], "with_food": True, "notes": "for itch"},
        ],
        "training_skills": [
            {"name": "Sit", "level": "reliable", "notes": "solid"},
            {"name": "Recall", "level": "practicing", "notes": "wip"},
        ],
        "vet_name": "Dr. Pawsworth",
        "vet_phone": "555-VET-DOGS",
    }
    r = requests.post(f"{BASE_URL}/api/dogs", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    yield r.json()
    requests.delete(f"{BASE_URL}/api/dogs/{r.json()['id']}", headers=admin_headers, timeout=15)


# ---------- Sprint 5: Dog feeding/meds/training_skills ----------

class TestDogCareFields:
    def test_create_dog_persists_care_fields(self, admin_headers, test_dog):
        # GET to verify persistence
        r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        match = [d for d in r.json() if d["id"] == test_dog["id"]]
        assert len(match) == 1
        d = match[0]
        assert len(d["feeding_schedule"]) == 2
        assert d["feeding_schedule"][0]["time"] == "07:00"
        assert d["feeding_schedule"][0]["amount"] == "2 cups"
        assert len(d["medications"]) == 1
        assert d["medications"][0]["name"] == "Apoquel"
        assert d["medications"][0]["times"] == ["08:00", "20:00"]
        assert d["medications"][0]["with_food"] is True
        assert len(d["training_skills"]) == 2
        names = {s["name"] for s in d["training_skills"]}
        assert {"Sit", "Recall"} <= names
        assert d["vet_name"] == "Dr. Pawsworth"
        assert d["vet_phone"] == "555-VET-DOGS"
        # IDs should auto-fill
        assert all("id" in s and s["id"] for s in d["feeding_schedule"])
        assert all("id" in m and m["id"] for m in d["medications"])
        assert all("id" in s and s["id"] for s in d["training_skills"])

    def test_update_dog_modifies_care_fields(self, admin_headers, test_dog, test_client):
        update = {
            "owner_id": test_client["id"],
            "name": test_dog["name"],
            "breed": test_dog["breed"],
            "age_y": test_dog["age_y"],
            "sex": "Male",
            "fixed": "Yes",
            "vaccines": test_dog["vaccines"],
            "feeding_schedule": [{"time": "12:00", "amount": "1 cup", "food_type": "Raw", "notes": "lunch"}],
            "medications": [],
            "training_skills": [{"name": "Down", "level": "proofed", "notes": "rock solid"}],
            "vet_name": "Dr. New Vet",
            "vet_phone": "555-NEW",
        }
        r = requests.put(f"{BASE_URL}/api/dogs/{test_dog['id']}", json=update, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["feeding_schedule"]) == 1
        assert body["feeding_schedule"][0]["time"] == "12:00"
        assert body["medications"] == []
        assert body["training_skills"][0]["level"] == "proofed"
        assert body["vet_name"] == "Dr. New Vet"
        # Re-fetch
        r2 = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=15)
        d = [x for x in r2.json() if x["id"] == test_dog["id"]][0]
        assert d["vet_phone"] == "555-NEW"
        assert d["training_skills"][0]["name"] == "Down"


# ---------- Booking dropoff_time / pickup_time ----------

class TestBookingTimes:
    def test_booking_persists_dropoff_pickup(self, admin_headers, test_dog):
        payload = {
            "dog_id": test_dog["id"],
            "date": BOOKING_DATE,
            "service_type": "daycare",
            "notes": "TEST_S57",
            "dropoff_time": "08:30",
            "pickup_time": "17:00",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        bid = b["id"]
        # Immediate response should reflect persisted times
        assert b.get("dropoff_time") == "08:30", f"dropoff_time not echoed; got {b.get('dropoff_time')!r}"
        assert b.get("pickup_time") == "17:00", f"pickup_time not echoed; got {b.get('pickup_time')!r}"
        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/bookings", headers=admin_headers, timeout=15)
        match = [x for x in r2.json() if x["id"] == bid]
        assert len(match) == 1
        assert match[0]["dropoff_time"] == "08:30"
        assert match[0]["pickup_time"] == "17:00"
        # cleanup
        requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_headers, timeout=15)


# ---------- Run sheet ----------

class TestRunSheet:
    def test_run_sheet_structure_and_sort(self, admin_headers, test_dog):
        # Create three bookings for the same date - boarding, daycare, training
        d = BOOKING_DATE
        created = []
        for svc, drop in [("training", "14:00"), ("boarding", "09:00"), ("daycare", "08:00")]:
            payload = {
                "dog_id": test_dog["id"],
                "date": d,
                "service_type": svc,
                "dropoff_time": drop,
                "pickup_time": "17:00",
            }
            r = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=admin_headers, timeout=15)
            assert r.status_code == 200, f"{svc} booking failed: {r.text}"
            created.append(r.json()["id"])
        try:
            r = requests.get(f"{BASE_URL}/api/run-sheet", params={"date_str": d},
                             headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["date"] == d
            assert "bookings" in body
            # filter to our test bookings (others may exist)
            ours = [x for x in body["bookings"] if x["id"] in created]
            assert len(ours) == 3
            # Sort: boarding first, daycare next, training last
            svc_order = [x["service_type"] for x in ours]
            assert svc_order == ["boarding", "daycare", "training"], f"Sort wrong: {svc_order}"
            # Each entry has full dog + client phone + emerg
            for entry in ours:
                assert entry.get("dog") and entry["dog"]["id"] == test_dog["id"]
                assert "feeding_schedule" in entry["dog"]
                assert "medications" in entry["dog"]
                assert "training_skills" in entry["dog"]
                assert entry.get("client_phone") == "555-1234"
                assert "555-9999" in (entry.get("client_emerg") or "")
        finally:
            for bid in created:
                requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_headers, timeout=15)

    def test_run_sheet_filters_by_date(self, admin_headers, test_dog):
        far = (date.today() + timedelta(days=20)).isoformat()
        payload = {"dog_id": test_dog["id"], "date": far, "service_type": "daycare", "dropoff_time": "10:00"}
        b = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=admin_headers, timeout=15).json()
        try:
            r = requests.get(f"{BASE_URL}/api/run-sheet", params={"date_str": far},
                             headers=admin_headers, timeout=15)
            ids = [x["id"] for x in r.json()["bookings"]]
            assert b["id"] in ids
            # date the day before should NOT include this booking
            before = (date.today() + timedelta(days=19)).isoformat()
            r2 = requests.get(f"{BASE_URL}/api/run-sheet", params={"date_str": before},
                              headers=admin_headers, timeout=15)
            ids2 = [x["id"] for x in r2.json()["bookings"]]
            assert b["id"] not in ids2
        finally:
            requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_headers, timeout=15)


# ---------- Homework ----------

class TestHomework:
    def test_create_requires_admin(self, admin_headers, portal_client, test_dog):
        # Client should NOT be able to create
        hdrs = {"Authorization": f"Bearer {portal_client['token']}"}
        r = requests.post(f"{BASE_URL}/api/homework",
                          json={"dog_id": test_dog["id"], "title": "Loose leash"},
                          headers=hdrs, timeout=15)
        assert r.status_code == 403

    def test_create_validates_title_length(self, admin_headers, test_dog):
        r = requests.post(f"{BASE_URL}/api/homework",
                          json={"dog_id": test_dog["id"], "title": "x"},
                          headers=admin_headers, timeout=15)
        assert r.status_code == 422  # title min_length=2

    def test_full_homework_flow(self, admin_headers, portal_client, other_portal_client, test_dog):
        # Admin creates
        payload = {
            "dog_id": test_dog["id"],
            "title": "Practice loose-leash walking",
            "instructions": "10 min daily",
            "video_url": "https://youtu.be/abc",
            "due_date": (date.today() + timedelta(days=7)).isoformat(),
        }
        r = requests.post(f"{BASE_URL}/api/homework", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        hw = r.json()
        hwid = hw["id"]
        assert hw["status"] == "assigned"
        assert hw["dog_name"] == test_dog["name"]
        assert hw["client_id"] == test_dog["owner_id"]
        assert hw["client_name"] and hw["client_name"].startswith("TEST_S57_Client")
        assert hw["assigned_by"]
        assert hw["created_at"]

        # Admin lists all
        all_admin = requests.get(f"{BASE_URL}/api/homework", headers=admin_headers, timeout=15).json()
        assert hwid in [h["id"] for h in all_admin]

        # Filter by dog_id
        filt = requests.get(f"{BASE_URL}/api/homework",
                            params={"dog_id": test_dog["id"]}, headers=admin_headers, timeout=15).json()
        assert all(h["dog_id"] == test_dog["id"] for h in filt)
        assert hwid in [h["id"] for h in filt]

        # Owning client sees own homework only
        c_hdrs = {"Authorization": f"Bearer {portal_client['token']}"}
        client_list = requests.get(f"{BASE_URL}/api/homework", headers=c_hdrs, timeout=15).json()
        assert hwid in [h["id"] for h in client_list]
        assert all(h["client_id"] == portal_client["client_id"] for h in client_list)

        # Other client cannot see it
        o_hdrs = {"Authorization": f"Bearer {other_portal_client['token']}"}
        other_list = requests.get(f"{BASE_URL}/api/homework", headers=o_hdrs, timeout=15).json()
        assert hwid not in [h["id"] for h in other_list]

        # Other client gets 403 on complete
        r403 = requests.post(f"{BASE_URL}/api/homework/{hwid}/complete",
                             json={"note": "nope"}, headers=o_hdrs, timeout=15)
        assert r403.status_code == 403

        # Owning client completes
        r_done = requests.post(f"{BASE_URL}/api/homework/{hwid}/complete",
                               json={"note": "Got it!", "photo": "data:image/png;base64,AAAA"},
                               headers=c_hdrs, timeout=15)
        assert r_done.status_code == 200, r_done.text
        b = r_done.json()
        assert b["status"] == "completed"
        assert b["completion_note"] == "Got it!"
        assert b["completion_photo"].startswith("data:image/png")
        assert b["completed_at"]

        # Admin delete
        rdel = requests.delete(f"{BASE_URL}/api/homework/{hwid}", headers=admin_headers, timeout=15)
        assert rdel.status_code == 200
        after = requests.get(f"{BASE_URL}/api/homework", headers=admin_headers, timeout=15).json()
        assert hwid not in [h["id"] for h in after]

    def test_client_cannot_delete(self, admin_headers, portal_client, test_dog):
        hw = requests.post(f"{BASE_URL}/api/homework",
                           json={"dog_id": test_dog["id"], "title": "Temp"},
                           headers=admin_headers, timeout=15).json()
        c_hdrs = {"Authorization": f"Bearer {portal_client['token']}"}
        r = requests.delete(f"{BASE_URL}/api/homework/{hw['id']}", headers=c_hdrs, timeout=15)
        assert r.status_code == 403
        # cleanup
        requests.delete(f"{BASE_URL}/api/homework/{hw['id']}", headers=admin_headers, timeout=15)


# ---------- Dashboard roster includes dog map ----------

class TestDashboardRoster:
    def test_roster_entries_include_dog_with_care_fields(self, admin_headers, test_dog):
        # Create a booking for today so it appears on today's roster
        payload = {
            "dog_id": test_dog["id"],
            "date": TODAY,
            "service_type": "daycare",
            "dropoff_time": "08:00",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        try:
            stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_headers, timeout=15).json()
            roster = stats.get("today_roster", [])
            mine = [x for x in roster if x["id"] == bid]
            assert len(mine) == 1
            entry = mine[0]
            assert "dog" in entry, "Dashboard roster entry missing 'dog' field"
            assert entry["dog"].get("id") == test_dog["id"]
            assert "feeding_schedule" in entry["dog"]
            assert "medications" in entry["dog"]
            assert "training_skills" in entry["dog"]
        finally:
            requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_headers, timeout=15)
