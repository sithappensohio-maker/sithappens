"""The public Meet & Greet form offers no times on a day the business is closed (audit #44).

Closed dates (holidays, vacations) already stop every client booking. The public
Meet & Greet finder ignored them, so the form offered times on a holiday. A closed
date now returns no slots, and a request for it is refused and writes nothing.

Disposable tag TEST_MG_CLOSED.
"""
import contextlib
import random
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_MG_CLOSED"
_used = set()
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _day():
    """A far-future weekday no other test here uses."""
    while True:
        d = date.today() + timedelta(days=200 + random.randint(0, 600))
        while d.weekday() != 2:
            d += timedelta(days=1)
        if d.isoformat() not in _used:
            _used.add(d.isoformat())
            return d.isoformat()


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.bookings.delete_many({"notes": {"$regex": TAG}}))


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k: v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def _open_hours():
    return {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}


def _mg_settings(closed_dates):
    return {"closed_dates": closed_dates,
            "meet_greet": {"enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": _open_hours()}}


def test_a_closed_day_offers_no_meet_and_greet_times():
    day = _day()
    with _settings(**_mg_settings([day])):
        out = run(server._compute_meet_greet_slots(run(server.get_settings()), date.fromisoformat(day)))
    assert out["closed"] is True
    assert out["slots"] == []


def test_an_open_day_next_to_a_closed_one_still_offers_times():
    day = _day()
    nxt = (date.fromisoformat(day) + timedelta(days=7)).isoformat()
    with _settings(**_mg_settings([day])):
        out = run(server._compute_meet_greet_slots(run(server.get_settings()), date.fromisoformat(nxt)))
    assert out["closed"] is False
    assert any(s["available"] for s in out["slots"])


def test_a_request_for_a_closed_day_is_refused_and_writes_nothing():
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.auth_rate_limits.delete_many({}))
    body = {"owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101", "dog_name": "Waffles", "date": day, "time": "10:00"}
    try:
        with _settings(**_mg_settings([day])):
            r = run(_http.post("/api/public/meet-greet-request", json=body))
        assert r.status_code >= 400, r.text
        assert not run(server.db.bookings.find_one({"date": day, "is_meet_greet": True}, {"_id": 1}))
        assert not run(server.db.clients.find_one({"email": email}, {"_id": 1})), "a refusal writes nothing"
    finally:
        run(server.db.bookings.delete_many({"date": day, "is_meet_greet": True}))
        for c in run(server.db.clients.find({"email": email}, {"_id": 0, "id": 1}).to_list(5)):
            run(server.db.claim_tokens.delete_many({"client_id": c["id"]}))
        run(server.db.clients.delete_many({"email": email}))
