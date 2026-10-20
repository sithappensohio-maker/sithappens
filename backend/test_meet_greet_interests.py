"""The public Meet & Greet request captures what the family is interested in.

The quick Meet & Greet form only ever asked for owner/dog/time — never what
the family actually wants (daycare, boarding, training, ...), so staff saw
"Service: Other" with nothing else to go on. It now requires at least one
interest (same vocabulary as the "Tell us about your dog" questionnaire's
INQUIRY_INTERESTS) and stores it on the booking as `interested_services`.

Disposable tag TEST_MG_INTERESTS.
"""
import random
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import email_service
import server
from _test_loop import run

TAG = "TEST_MG_INTERESTS"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _day():
    d = date.today() + timedelta(days=200 + random.randint(0, 600))
    while d.weekday() != 2:
        d += timedelta(days=1)
    return d.isoformat()


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.bookings.delete_many({"client_name": {"$regex": TAG}}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def capture(*, slug, to_email, ctx=None, rows=None, **kw):
        out.append({"slug": slug, "to": to_email, "rows": dict(rows or [])})
        return True
    monkeypatch.setattr(email_service, "_dispatch", capture)
    return out


@pytest.fixture
def _open_hours():
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"meet_greet": {
        "enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}}}))
    run(server.db.auth_rate_limits.delete_many({}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def test_a_request_with_no_interests_picked_is_refused(_open_hours):
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": f"{TAG} Dog", "date": day, "time": "10:00", "interests": [],
    }))
    assert r.status_code == 422, r.text
    assert not run(server.db.clients.find_one({"email": email}, {"_id": 1}))


def test_the_chosen_interests_are_stored_on_the_booking(_open_hours):
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": f"{TAG} Dog", "date": day, "time": "10:00",
        "interests": ["boarding", "grooming"],
    }))
    assert r.status_code == 200, r.text
    row = run(server.db.bookings.find_one({"is_meet_greet": True, "date": day}, {"_id": 0}))
    assert row, "Meet & Greet booking record must exist"
    assert row["interested_services"] == ["boarding", "grooming"]


def test_an_optional_note_is_kept_on_the_booking(_open_hours):
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": f"{TAG} Dog", "date": day, "time": "10:00",
        "interests": ["boarding"],
        "message": "We're moving next month and need boarding ASAP.",
    }))
    assert r.status_code == 200, r.text
    row = run(server.db.bookings.find_one({"is_meet_greet": True, "date": day}, {"_id": 0}))
    assert "We're moving next month and need boarding ASAP." in row["notes"]


def test_no_note_given_is_fine_too(_open_hours):
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": f"{TAG} Dog", "date": day, "time": "10:00", "interests": ["boarding"],
    }))
    assert r.status_code == 200, r.text
    row = run(server.db.bookings.find_one({"is_meet_greet": True, "date": day}, {"_id": 0}))
    assert row["notes"] == "Meet & Greet requested via the public landing page."


def test_the_admin_alert_email_says_what_they_are_interested_in(sent, _open_hours):
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": f"{TAG} Dog", "date": day, "time": "10:00",
        "interests": ["boarding", "grooming"],
    }))
    assert r.status_code == 200, r.text
    mail = next(m for m in sent if m["slug"] == "admin_meet_greet_request")
    assert mail["rows"]["Interested in"] == "Boarding, Grooming"
