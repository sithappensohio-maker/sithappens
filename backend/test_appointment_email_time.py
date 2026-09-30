"""Appointment emails say the time (audit #41).

A lesson, grooming, portrait or Meet & Greet is booked for a set time, but
the client's "Booking confirmed" email only gave the date, a Meet & Greet was
called an "Other booking", and the "we got your Meet & Greet request" email
never repeated the day and time the prospect had picked.

Disposable tag TEST_APPT_EMAIL_TIME.
"""
import contextlib
import random
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import email_service
import server
from _test_loop import run
from domains.bookings.blocks import pretty_date

TAG = "TEST_APPT_EMAIL_TIME"
ADMIN = {"id": "appt-email-admin", "role": "admin", "name": f"{TAG} admin", "email": "appt-email@test"}
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def capture(*, slug, to_email, ctx=None, rows=None, **kw):
        out.append({"slug": slug, "to": to_email, "ctx": ctx or {}, "rows": dict(rows or [])})
        return True
    monkeypatch.setattr(email_service, "_dispatch", capture)
    return out


@contextlib.contextmanager
def _family():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat Lee", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "created_at": server.now_iso()}))
    try:
        yield cid
    finally:
        run(server.db.bookings.delete_many({"client_id": cid}))
        run(server.db.clients.delete_many({"id": cid}))


def _pending(cid, **extra):
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": "", "dog_name": "Waffles", "client_id": cid, "client_name": f"{TAG} Pat Lee",
         "date": (date.today() + timedelta(days=30)).isoformat(), "status": "pending", "created_at": server.now_iso(), **extra}
    run(server.db.bookings.insert_one(dict(b)))
    return b


@pytest.mark.parametrize("service", ["photography", "training", "grooming"])
def test_the_confirmation_for_a_timed_visit_says_the_time(sent, service):
    with _family() as cid:
        b = _pending(cid, service_type=service, time="14:30")
        run(server.approve_booking(b["id"], ADMIN))
        mail = next(m for m in sent if m["slug"] == "client_booking_approved")
        assert mail["rows"]["Time"] == "2:30 PM"


def test_a_meet_and_greet_confirmation_is_called_a_meet_and_greet_and_says_the_time(sent):
    with _family() as cid:
        b = _pending(cid, service_type="other", is_meet_greet=True, time="10:00", duration_minutes=30)
        run(server.approve_booking(b["id"], ADMIN))
        mail = next(m for m in sent if m["slug"] == "client_booking_approved")
        assert mail["ctx"]["service_label"] == "Meet & Greet" and mail["rows"]["Service"] == "Meet & Greet"
        assert mail["rows"]["Time"] == "10:00 AM"


def test_a_stay_keeps_its_drop_off_and_pick_up_and_gets_no_time_line(sent):
    with _family() as cid:
        b = _pending(cid, service_type="daycare", time="07:00", dropoff_time="07:30", pickup_time="17:00")
        run(server.approve_booking(b["id"], ADMIN))
        mail = next(m for m in sent if m["slug"] == "client_booking_approved")
        assert "Time" not in mail["rows"] and mail["rows"]["Drop-off"] == "07:30"


def test_a_declined_appointment_says_which_time_was_asked_for(sent):
    with _family() as cid:
        b = _pending(cid, service_type="other", is_meet_greet=True, time="15:15")
        run(server.reject_booking(b["id"], ADMIN))
        mail = next(m for m in sent if m["slug"] == "client_booking_rejected")
        assert mail["rows"]["Requested time"] == "3:15 PM" and mail["rows"]["Service"] == "Meet & Greet"


def test_the_meet_and_greet_request_email_repeats_the_day_and_time_asked_for(sent):
    day = date.today() + timedelta(days=200 + random.randint(0, 400))
    while day.weekday() != 2:
        day += timedelta(days=1)
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"meet_greet": {
        "enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}}}))
    run(server.db.auth_rate_limits.delete_many({}))
    try:
        r = run(_http.post("/api/public/meet-greet-request", json={"owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
                                                                   "dog_name": "Waffles", "date": day.isoformat(), "time": "10:30"}))
        assert r.status_code == 200, r.text
        mail = next(m for m in sent if m["slug"] == "meet_greet_request_received")
        assert mail["rows"]["You asked for"] == f"{pretty_date(day.isoformat())} at 10:30 AM"
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))
        run(server.db.bookings.delete_many({"date": day.isoformat(), "is_meet_greet": True}))
        for c in run(server.db.clients.find({"email": email}, {"_id": 0, "id": 1}).to_list(5)):
            run(server.db.claim_tokens.delete_many({"client_id": c["id"]}))
        run(server.db.clients.delete_many({"email": email}))


def test_the_rule_in_one_place():
    at = email_service._appointment_time
    assert at({"service_type": "photography", "time": "09:05"}) == "9:05 AM"
    assert at({"service_type": "boarding", "time": "09:05"}) == "" and at({"service_type": "training"}) == ""
    assert email_service._booking_label({"service_type": "grooming", "grooming_type": "bath"}) == "Grooming · Bath"
