"""Public "Request a Meet & Greet" flow — the landing-page CTA that lets a
prospect submit owner/dog info and pick a real open slot, without an
account (GET /public/meet-greet-slots, POST /public/meet-greet-request).

Covers:
  1. New prospect creation — client_status="prospect", form details
     captured, and the chosen slot is booked onto the calendar.
  2. Auto-merge into an existing admin-created client — no duplicate client,
     admin's existing data (name/phone/client_status) is not clobbered.
  3. Rate limiting — mirrors /auth/register's per-(ip,email) fixed window.
  4. The claim link minted by the request works end-to-end (verify -> set
     password -> log in).
  5. GET /public/meet-greet-slots reflects Settings -> meet_greet.
  6. A slot that overlaps an existing appointment on the calendar is
     excluded from the slot list, and requesting it is rejected with 400 —
     this is the actual "can't book over my other appointments" behavior.

Built against the live preview backend exposed via TEST_BACKEND_URL /
REACT_APP_BACKEND_URL, same as the rest of this suite (see conftest.py).
Direct Mongo access (motor) is used to read the minted claim token, since
the token is only ever delivered by email, never in the API response.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import requests
import pytest
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = (
    os.environ.get("TEST_BACKEND_URL")
    or os.environ.get("API_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _run(coro):
    return asyncio.run(coro)


async def _with_db(fn):
    mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        db = mc[os.environ["DB_NAME"]]
        return await fn(db)
    finally:
        mc.close()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module", autouse=True)
def _clean_rate_limit_scopes():
    """This endpoint's rate-limit buckets are keyed by (scope, subject_hash,
    hour-bucket) in Mongo. Clear our scopes before the module runs so
    unrelated earlier activity from the same test-runner IP (manual testing,
    a prior partial run) can't make test_rate_limiting flaky."""
    async def _clear(db):
        await db.auth_rate_limits.delete_many(
            {"scope": {"$in": ["meet_greet_ip", "meet_greet_email_ip", "meet_greet_slots_ip"]}}
        )
    _run(_with_db(_clear))
    yield


def _clients_by_email(admin_token, email):
    cs = requests.get(f"{BASE_URL}/api/clients", headers=_hdr(admin_token), timeout=15).json()
    return [c for c in cs if (c.get("email") or "").lower() == email.lower()]


def _claim_token_for_client(client_id):
    async def _fetch(db):
        return await db.claim_tokens.find_one({"client_id": client_id, "used": False}, {"_id": 0})
    return _run(_with_db(_fetch))


def _first_available_slot(days_ahead, max_tries=8):
    """Fetch the real slot list starting at `today + days_ahead` and return
    (date, time) of the first open slot, walking forward a day at a time if
    that date is closed (e.g. lands on the default-closed Sunday). Exercises
    the actual availability endpoint instead of guessing a time that might
    collide with default hours/lead-time/other tests."""
    for i in range(max_tries):
        target_date = (datetime.now(timezone.utc) + timedelta(days=days_ahead + i)).date().isoformat()
        r = requests.get(f"{BASE_URL}/api/public/meet-greet-slots", params={"date_str": target_date}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        open_slots = [s["time"] for s in body.get("slots", []) if s["available"]]
        if open_slots:
            return target_date, open_slots[0]
    raise AssertionError(
        f"No open Meet & Greet slots found within {max_tries} days of +{days_ahead}d "
        "(check default settings.meet_greet)"
    )


class TestMeetGreetRequest:
    _merged_client_id = None
    _merged_email = None

    def test_new_prospect_creation(self, admin_token):
        suffix = uuid.uuid4().hex[:8]
        email = f"mg_new_{suffix}@example.com"
        target_date, target_time = _first_available_slot(5)
        r = requests.post(f"{BASE_URL}/api/public/meet-greet-request", json={
            "owner_name": "New Prospect",
            "email": email,
            "phone": "555-200-0001",
            "dog_name": "Biscuit",
            "date": target_date,
            "time": target_time,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        matches = _clients_by_email(admin_token, email)
        assert len(matches) == 1, matches
        c = matches[0]
        assert c["client_status"] == "prospect"
        assert c["name"] == "New Prospect"
        assert c["phone"] == "555-200-0001"
        notes = c.get("evaluation_notes") or ""
        assert "Biscuit" in notes
        assert target_date in notes and target_time in notes

        # The slot is booked onto the calendar, not just noted on the client.
        events = requests.get(f"{BASE_URL}/api/events", headers=_hdr(admin_token), timeout=15).json()
        matches_ev = [e for e in events if e.get("extendedProps", {}).get("client_id") == c["id"]]
        assert len(matches_ev) == 1, matches_ev
        ev = matches_ev[0]["extendedProps"]
        assert ev["time"] == target_time
        assert ev["service_type"] == "other"
        assert ev["dog_name"] == "Biscuit"

    def test_merge_with_existing_admin_created_client(self, admin_token):
        suffix = uuid.uuid4().hex[:8]
        email = f"mg_merge_{suffix}@example.com"
        # Admin already created this client (e.g. from a phone call).
        created = requests.post(f"{BASE_URL}/api/clients", headers=_hdr(admin_token), json={
            "name": "Phone Lead",
            "email": email,
            "phone": "555-300-0001",
        }, timeout=15)
        assert created.status_code == 200, created.text
        original = created.json()
        original_client_id = original["id"]

        target_date, target_time = _first_available_slot(5)
        r = requests.post(f"{BASE_URL}/api/public/meet-greet-request", json={
            "owner_name": "Should Be Ignored",
            "email": email.upper(),  # case-insensitive match against the existing client
            "phone": "555-999-9999",  # must NOT overwrite the phone already on file
            "dog_name": "Rex",
            "date": target_date,
            "time": target_time,
        }, timeout=15)
        assert r.status_code == 200, r.text

        matches = _clients_by_email(admin_token, email)
        assert len(matches) == 1, "meet-greet request must not create a duplicate client"
        c = matches[0]
        assert c["id"] == original_client_id
        assert c["name"] == "Phone Lead"  # admin's data preserved, not overwritten
        assert c["phone"] == "555-300-0001"  # not overwritten by the form's phone
        assert c["client_status"] == original["client_status"]  # not downgraded/reset
        assert "Rex" in (c.get("evaluation_notes") or "")

        TestMeetGreetRequest._merged_client_id = original_client_id
        TestMeetGreetRequest._merged_email = email

    def test_claim_link_works_end_to_end(self, admin_token):
        client_id = TestMeetGreetRequest._merged_client_id
        email = TestMeetGreetRequest._merged_email
        assert client_id, "requires test_merge_with_existing_admin_created_client to run first"

        rec = _claim_token_for_client(client_id)
        assert rec is not None, "meet-greet request should have minted a claim token for this client"
        token = rec["token"]
        assert rec["email"].lower() == email.lower()

        verify = requests.get(f"{BASE_URL}/api/claim/{token}", timeout=15)
        assert verify.status_code == 200, verify.text
        vbody = verify.json()
        assert vbody["valid"] is True
        assert vbody["email"].lower() == email.lower()

        new_password = "ClaimFlowPassw0rd!"
        consume = requests.post(f"{BASE_URL}/api/claim/{token}", json={"password": new_password}, timeout=15)
        assert consume.status_code == 200, consume.text
        cbody = consume.json()
        assert cbody["user"]["client_id"] == client_id
        assert cbody["token"]

        login = requests.post(f"{BASE_URL}/api/auth/login",
                               json={"email": email, "password": new_password}, timeout=15)
        assert login.status_code == 200, login.text
        assert login.json()["user"]["client_id"] == client_id

    def test_rate_limiting(self):
        email = f"mg_rl_{uuid.uuid4().hex[:8]}@example.com"
        statuses = []
        for i in range(6):
            # A distinct future date per call so the 5 successful requests
            # don't collide with each other over the same slot — this test
            # is only about the rate limiter, not slot contention. Stays
            # comfortably inside the default 30-day max_advance_days window.
            target_date, target_time = _first_available_slot(15 + i, max_tries=3)
            r = requests.post(f"{BASE_URL}/api/public/meet-greet-request", json={
                "owner_name": "Rate Limit Test",
                "email": email,
                "phone": "555-400-0001",
                "dog_name": f"Dog{i}",
                "date": target_date,
                "time": target_time,
            }, timeout=15)
            statuses.append(r.status_code)
        # register_email_ip-style limit is 5/hour for this endpoint too —
        # the 6th call for the same (ip, email) pair must be rejected.
        assert statuses[:5] == [200, 200, 200, 200, 200], statuses
        assert statuses[5] == 429, statuses


class TestMeetGreetScheduling:
    def test_slots_endpoint_reflects_settings(self, admin_token):
        target_date, target_time = _first_available_slot(9)

        r = requests.get(f"{BASE_URL}/api/public/meet-greet-slots", params={"date_str": target_date}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["date"] == target_date
        assert body["enabled"] is True
        assert body["closed"] is False
        assert any(s["time"] == target_time and s["available"] for s in body["slots"])

        # Turning it off entirely must be reflected immediately.
        orig = requests.get(f"{BASE_URL}/api/settings", headers=_hdr(admin_token), timeout=15).json()["meet_greet"]
        try:
            off = {**orig, "enabled": False}
            put = requests.put(f"{BASE_URL}/api/settings", headers=_hdr(admin_token), json={"meet_greet": off}, timeout=15)
            assert put.status_code == 200, put.text
            r2 = requests.get(f"{BASE_URL}/api/public/meet-greet-slots", params={"date_str": target_date}, timeout=15)
            body2 = r2.json()
            assert body2["enabled"] is False
            assert body2["closed"] is True
            assert body2["slots"] == []
        finally:
            requests.put(f"{BASE_URL}/api/settings", headers=_hdr(admin_token), json={"meet_greet": orig}, timeout=15)

    def test_conflicting_appointment_blocks_slot_and_request(self, admin_token):
        target_date, target_time = _first_available_slot(8)

        dogs = requests.get(f"{BASE_URL}/api/dogs", headers=_hdr(admin_token), timeout=15).json()
        assert dogs, "fixture data must include at least one dog to book training against"
        dog_id = dogs[0]["id"]

        booked = requests.post(f"{BASE_URL}/api/bookings", headers=_hdr(admin_token), json={
            "dog_id": dog_id,
            "date": target_date,
            "service_type": "training",
            "time": target_time,
            "override_capacity": True,
        }, timeout=15)
        assert booked.status_code == 200, booked.text
        booking_id = booked.json()["id"]
        try:
            # The slot must now show as unavailable on the public list...
            slots = requests.get(f"{BASE_URL}/api/public/meet-greet-slots",
                                  params={"date_str": target_date}, timeout=15).json()
            match = next(s for s in slots["slots"] if s["time"] == target_time)
            assert match["available"] is False, slots

            # ...and requesting that exact time must be rejected server-side,
            # even if a stale client tried to submit it anyway.
            email = f"mg_conflict_{uuid.uuid4().hex[:8]}@example.com"
            r = requests.post(f"{BASE_URL}/api/public/meet-greet-request", json={
                "owner_name": "Conflict Test",
                "email": email,
                "phone": "555-500-0001",
                "dog_name": "Fido",
                "date": target_date,
                "time": target_time,
            }, timeout=15)
            assert r.status_code == 400, r.text
            assert _clients_by_email(admin_token, email) == [], "rejected request must not create a client"
        finally:
            requests.delete(f"{BASE_URL}/api/bookings/{booking_id}", headers=_hdr(admin_token), timeout=15)
