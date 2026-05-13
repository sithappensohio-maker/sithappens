"""Sprint 6 backend tests:
- GET /api/search (global search)
- PATCH /api/bookings/{id} (admin booking edit)
- GET /api/bookings/conflicts (conflict detection)
- GET /api/dogs/{id}/stats (lifetime stats)
- GET /api/dashboard/stats -> upcoming_birthdays
"""
import os
import uuid
import pytest
import requests
from datetime import date, timedelta

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def seed(admin_headers):
    h = admin_headers
    uniq = uuid.uuid4().hex[:6]
    client_payload = {
        "name": f"TEST_S6_Client_{uniq}",
        "email": f"test_s6_{uniq}@example.com",
        "phone": "555-0166",
    }
    rc = requests.post(f"{BASE}/api/clients", json=client_payload, headers=h, timeout=15)
    assert rc.status_code in (200, 201), rc.text
    client = rc.json()

    # Birthday 5 days from now
    upcoming = (date.today() + timedelta(days=5))
    bday = f"2022-{upcoming.month:02d}-{upcoming.day:02d}"
    dog_payload = {
        "name": f"TEST_S6_Dog_{uniq}",
        "breed": "Sprint6Breed",
        "owner_id": client["id"],
        "birthday": bday,
        "vaccines": {"rabies": "2099-12-31"},
    }
    rd = requests.post(f"{BASE}/api/dogs", json=dog_payload, headers=h, timeout=15)
    assert rd.status_code in (200, 201), rd.text
    dog = rd.json()

    # Booking today (daycare) - past_days >= 1 for stats
    booking_payload = {
        "dog_id": dog["id"],
        "owner_id": client["id"],
        "service_type": "daycare",
        "date": date.today().isoformat(),
        "notes": "initial",
        "dropoff_time": "08:00",
        "pickup_time": "17:00",
        "override_vaccines": True,
    }
    rb = requests.post(f"{BASE}/api/bookings", json=booking_payload, headers=h, timeout=15)
    assert rb.status_code in (200, 201), rb.text
    booking = rb.json()

    data = {"client": client, "dog": dog, "booking": booking, "uniq": uniq}
    yield data

    # Teardown
    try:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=h, timeout=10)
    except Exception:
        pass
    try:
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=h, timeout=10)
    except Exception:
        pass
    try:
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=h, timeout=10)
    except Exception:
        pass


# ----------------- Global Search -----------------
class TestSearch:
    def test_search_requires_auth(self):
        r = requests.get(f"{BASE}/api/search", params={"q": "x"}, timeout=10)
        assert r.status_code in (401, 403)

    def test_search_finds_dog_and_client(self, admin_headers, seed):
        # Dog by name
        r = requests.get(f"{BASE}/api/search",
                         params={"q": f"TEST_S6_Dog_{seed['uniq']}"},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "dogs" in data and "clients" in data
        assert any(d["id"] == seed["dog"]["id"] for d in data["dogs"])
        # owner_name populated
        match = next(d for d in data["dogs"] if d["id"] == seed["dog"]["id"])
        assert match["owner_name"] == seed["client"]["name"]

        # Client by name
        r2 = requests.get(f"{BASE}/api/search",
                          params={"q": f"TEST_S6_Client_{seed['uniq']}"},
                          headers=admin_headers, timeout=15)
        assert r2.status_code == 200
        assert any(c["id"] == seed["client"]["id"] for c in r2.json()["clients"])

    def test_search_empty_query_returns_empty(self, admin_headers):
        r = requests.get(f"{BASE}/api/search", params={"q": "   "},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"clients": [], "dogs": []}


# ----------------- Booking PATCH (Admin Edit) -----------------
class TestBookingPatch:
    def test_patch_updates_notes_kennel_times(self, admin_headers, seed):
        bid = seed["booking"]["id"]
        payload = {
            "notes": "updated notes",
            "kennel": "K-12",
            "dropoff_time": "09:30",
            "pickup_time": "18:30",
        }
        r = requests.patch(f"{BASE}/api/bookings/{bid}", json=payload,
                           headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["notes"] == "updated notes"
        assert body["kennel"] == "K-12"
        assert body["dropoff_time"] == "09:30"
        assert body["pickup_time"] == "18:30"

        # Verify persistence via GET /api/bookings
        rl = requests.get(f"{BASE}/api/bookings", headers=admin_headers, timeout=15)
        assert rl.status_code == 200
        found = next((b for b in rl.json() if b["id"] == bid), None)
        assert found is not None
        assert found["notes"] == "updated notes"
        assert found["kennel"] == "K-12"
        assert found["dropoff_time"] == "09:30"
        assert found["pickup_time"] == "18:30"

    def test_patch_404_unknown(self, admin_headers):
        r = requests.patch(f"{BASE}/api/bookings/nonexistent-id",
                           json={"notes": "x"}, headers=admin_headers, timeout=10)
        assert r.status_code == 404


# ----------------- Booking Conflicts -----------------
class TestBookingConflicts:
    def test_conflict_present_for_existing_booking(self, admin_headers, seed):
        r = requests.get(
            f"{BASE}/api/bookings/conflicts",
            params={"dog_id": seed["dog"]["id"], "date_str": date.today().isoformat()},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "conflicts" in body
        ids = [c["id"] for c in body["conflicts"]]
        assert seed["booking"]["id"] in ids

    def test_no_conflict_for_far_future(self, admin_headers, seed):
        future = (date.today() + timedelta(days=120)).isoformat()
        r = requests.get(
            f"{BASE}/api/bookings/conflicts",
            params={"dog_id": seed["dog"]["id"], "date_str": future},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["conflicts"] == []


# ----------------- Dog Lifetime Stats -----------------
class TestDogStats:
    def test_stats_structure_and_daycare_increment(self, admin_headers, seed):
        r = requests.get(f"{BASE}/api/dogs/{seed['dog']['id']}/stats",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        for k in ("dog_id", "daycare_days", "boarding_nights", "training_sessions",
                  "last_visit", "incidents", "homework_completed", "homework_assigned"):
            assert k in s, f"missing {k}"
        assert s["dog_id"] == seed["dog"]["id"]
        # today's daycare booking counts as 1
        assert s["daycare_days"] >= 1
        assert s["last_visit"] == date.today().isoformat()

    def test_stats_404_unknown_dog(self, admin_headers):
        r = requests.get(f"{BASE}/api/dogs/does-not-exist/stats",
                         headers=admin_headers, timeout=10)
        assert r.status_code == 404


# ----------------- Dashboard Upcoming Birthdays -----------------
class TestUpcomingBirthdays:
    def test_birthday_within_14_days_appears(self, admin_headers, seed):
        r = requests.get(f"{BASE}/api/dashboard/stats", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        stats = r.json()
        assert "upcoming_birthdays" in stats
        ids = [b["dog_id"] for b in stats["upcoming_birthdays"]]
        assert seed["dog"]["id"] in ids
        entry = next(b for b in stats["upcoming_birthdays"] if b["dog_id"] == seed["dog"]["id"])
        # required keys
        for k in ("dog_name", "birthday", "next", "days", "turning"):
            assert k in entry
        assert 0 <= entry["days"] <= 14
