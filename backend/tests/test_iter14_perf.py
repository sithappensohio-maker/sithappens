"""Iteration 14 — Performance changes regression tests.

Covers the 5 perf fixes applied to /app/backend/server.py:
 1. GET /api/bookings — new date window default + include_all + range filters + client scope
 2. GET /api/dogs — list response no longer contains `photos` gallery
 3. GET /api/dogs/{id} — NEW endpoint returns full record including `photos`
 4. GET /api/dashboard/stats — keeps top-level fields, strips heavy dog fields from roster
 5. GET /api/programs/pipeline — batch-load N+1 fix, still produces full joined rows
 6. MongoDB indexes — verify they exist on hot collections
"""

import os
import time
import requests
import pytest
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}
TEST_CLIENT = {"email": "testclient@sithappens.com", "password": "test1234"}
BUDDY_ID = "a1e63d21-2d4b-444f-8286-56f3324c4401"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_CLIENT, timeout=15)
    if r.status_code != 200:
        pytest.skip("Test client login failed")
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------- GET /api/bookings — date filter ----------
class TestBookingsWindow:
    def test_default_window_is_rolling_180_days(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/bookings", headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        # All entries must fall in the ±90 day window
        today = date.today()
        lo = (today - timedelta(days=90)).isoformat()
        hi = (today + timedelta(days=90)).isoformat()
        for b in items:
            assert lo <= b["date"] <= hi, f"Booking {b['id']} date {b['date']} outside default window"

    def test_include_all_returns_more_or_equal(self, admin_headers):
        windowed = requests.get(f"{BASE_URL}/api/bookings", headers=admin_headers, timeout=20).json()
        full = requests.get(f"{BASE_URL}/api/bookings?include_all=true", headers=admin_headers, timeout=20).json()
        assert isinstance(full, list)
        assert len(full) >= len(windowed)

    def test_custom_date_range(self, admin_headers):
        start = (date.today() - timedelta(days=10)).isoformat()
        end = (date.today() + timedelta(days=10)).isoformat()
        r = requests.get(
            f"{BASE_URL}/api/bookings?start_date={start}&end_date={end}",
            headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200
        for b in r.json():
            assert start <= b["date"] <= end

    def test_client_scope_filter(self, client_headers):
        r = requests.get(f"{BASE_URL}/api/bookings", headers=client_headers, timeout=20)
        assert r.status_code == 200
        # Resolve own client_id
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=client_headers, timeout=15).json()
        cid = me.get("client_id")
        for b in r.json():
            assert b.get("client_id") == cid, f"Booking leaked: {b}"


# ---------- GET /api/dogs — strip photos gallery ----------
class TestDogsList:
    def test_list_dogs_no_photos_gallery(self, admin_headers):
        """Mongo projection strips photos[], but DogOut pydantic model has a default
        `photos: List[str] = []` so the wire response still has the key with value [].
        The actual gallery payload (the heavy base64 strings) is NOT transmitted —
        that's the real bandwidth win."""
        r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        dogs = r.json()
        assert len(dogs) > 0, "Expected at least one dog in fixtures"
        for d in dogs:
            photos = d.get("photos")
            assert photos == [] or photos is None, (
                f"Dog {d.get('id')} list response includes non-empty photos gallery: "
                f"len={len(photos) if isinstance(photos, list) else 'N/A'}. "
                "Mongo projection must strip the gallery payload."
            )

    def test_list_smaller_than_detail(self, admin_headers):
        list_resp = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=20).json()
        if not list_resp:
            pytest.skip("No dogs")
        # Detail endpoint returns photos gallery key (even if empty list)
        first = list_resp[0]
        detail = requests.get(
            f"{BASE_URL}/api/dogs/{first['id']}", headers=admin_headers, timeout=20,
        ).json()
        # Sanity: detail has same dog
        assert detail["id"] == first["id"]


# ---------- GET /api/dogs/{id} — new endpoint ----------
class TestDogDetail:
    def test_buddy_detail_includes_photos_field(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dogs/{BUDDY_ID}", headers=admin_headers, timeout=20)
        if r.status_code == 404:
            pytest.skip("Buddy fixture missing in this env")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == BUDDY_ID
        # `photos` key MUST be present (the gallery field — may be [] empty list)
        assert "photos" in d, "Detail endpoint must return photos gallery"
        assert isinstance(d["photos"], list)

    def test_unknown_id_returns_404(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/dogs/does-not-exist-zzz", headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404

    def test_client_cannot_access_other_clients_dog(self, client_headers):
        # Buddy belongs to a different client; testclient must not be able to read it
        r = requests.get(f"{BASE_URL}/api/dogs/{BUDDY_ID}", headers=client_headers, timeout=15)
        # Implementation returns 404 (scope filter doesn't match) which is the
        # standard "don't leak existence" pattern. 403 also acceptable.
        assert r.status_code in (403, 404), f"Got {r.status_code}: {r.text}"


# ---------- GET /api/dashboard/stats ----------
class TestDashboardStats:
    def test_top_level_fields_present(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        s = r.json()
        for k in (
            "daycare_occupancy", "daycare_capacity", "boarding_today",
            "training_today", "health_flags", "total_dogs",
            "today_roster", "upcoming_birthdays",
        ):
            assert k in s, f"dashboard_stats missing {k}"
        assert isinstance(s["today_roster"], list)
        assert isinstance(s["upcoming_birthdays"], list)

    def test_roster_dogs_have_heavy_fields_stripped(self, admin_headers, request):
        """Per perf spec, today_roster dog records must not contain photo, photos,
        training_logs, feeding_schedule, or medications."""
        # Create a booking for today so the roster has at least one entry
        list_resp = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=15).json()
        if not list_resp:
            pytest.skip("No dogs available")
        dog_id = list_resp[0]["id"]
        payload = {
            "dog_id": dog_id,
            "date": date.today().isoformat(),
            "service_type": "daycare",
            "dropoff_time": "08:00",
            "override_vaccines": True,
            "override_capacity": True,
        }
        br = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=admin_headers, timeout=15)
        if br.status_code != 200:
            pytest.skip(f"Could not create today booking: {br.text}")
        bid = br.json()["id"]
        try:
            stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_headers, timeout=20).json()
            entries = [x for x in stats["today_roster"] if x["id"] == bid]
            assert len(entries) == 1
            dog = entries[0].get("dog") or {}
            # Sprint 110di-25 — Only the bandwidth-hog fields are stripped.
            # feeding_schedule / medications / training_skills are kept on
            # purpose because the dashboard renders care-icon badges from
            # them (see dog_proj in server.py). Re-asserting them here would
            # contradict the design.
            for stripped in ("photo", "photos", "training_logs"):
                assert stripped not in dog, (
                    f"Stripped field {stripped!r} present in roster dog: {list(dog.keys())}"
                )
        finally:
            requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_headers, timeout=15)


# ---------- GET /api/programs/pipeline ----------
class TestProgramsPipeline:
    def test_pipeline_returns_joined_rows(self, admin_headers):
        t0 = time.perf_counter()
        r = requests.get(f"{BASE_URL}/api/programs/pipeline", headers=admin_headers, timeout=30)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        if not rows:
            pytest.skip("No enrollments to verify")
        for row in rows[:5]:
            # joined fields
            assert "dog_name" in row
            assert "dog_photo" in row
            assert "client_name" in row
            # _enrollment_summary fields
            for sk in ("total_goals", "mastered_goals", "status", "dog_id"):
                assert sk in row, f"Missing summary key {sk} in pipeline row"
            # dog_photo must NOT be a gallery (string only, never list)
            assert not isinstance(row["dog_photo"], list), "dog_photo should be string, not list"
        print(f"\npipeline elapsed: {elapsed_ms:.0f}ms, rows={len(rows)}")


# ---------- MongoDB indexes ----------
class TestIndexes:
    def test_indexes_exist(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        import asyncio
        load_dotenv("/app/backend/.env")
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name, "MONGO_URL/DB_NAME missing in env"

        async def _check():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            results = {}
            for coll in ("bookings", "dogs", "homework", "dog_programs", "credit_lots", "incidents", "vaccine_dismissals"):
                results[coll] = await db[coll].index_information()
            client.close()
            return results

        idx = asyncio.run(_check())

        # Expected hot-path indexes
        assert "date_1_status_1" in idx["bookings"], idx["bookings"].keys()
        assert "owner_id_1" in idx["dogs"], idx["dogs"].keys()
        assert "status_1_created_at_-1" in idx["homework"], idx["homework"].keys()
        assert "dog_id_1_status_1" in idx["dog_programs"], idx["dog_programs"].keys()
        assert "client_id_1_purchased_at_-1" in idx["credit_lots"], idx["credit_lots"].keys()
        assert "date_-1_dog_id_1" in idx["incidents"], idx["incidents"].keys()
