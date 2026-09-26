"""The online cancellation cutoff counts back from when the visit starts.

Audit #10 (the part that applies without cancellation fees): the cutoff
("Cancellation cutoff (hours)", Settings) counted back from midnight UTC of
the visit's date — 8 PM the evening before (7 PM in winter) — so a client
cancelling a 7 AM Tuesday daycare 34 hours ahead was told it was under 24
hours. It now counts back from the visit's drop-off or appointment time in
the business time zone, and the refusal says when online cancelling closed
and to message instead.
"""
import copy
import math
import uuid
from datetime import date, datetime, time, timedelta

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.bookings import guards

TAG = "TEST_CANCEL_CUTOFF"
CLIENT_ID = "cutoff-client"
CLIENT = {"id": "cutoff-client-user", "role": "client", "client_id": CLIENT_ID, "name": "Dana"}
ADMIN = {"id": "cutoff-admin", "role": "admin", "name": "Pat Owner"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    run(server.db.clients.update_one({"id": CLIENT_ID}, {"$set": {"name": f"{TAG} Owner"}}, upsert=True))
    yield
    run(server.db.bookings.delete_many({"client_name": {"$regex": f"^{TAG}"}}))
    run(server.db.clients.delete_many({"id": CLIENT_ID}))


def _visit(day: date, **over):
    b = {"id": str(uuid.uuid4()), "dog_id": "dog-x", "dog_name": "Biscuit", "client_id": CLIENT_ID,
         "client_name": f"{TAG} Owner", "service_type": "daycare", "status": "approved",
         "date": day.isoformat(), "end_date": None, "dropoff_time": "07:00", "created_at": server.now_iso()}
    b.update(over)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _with_cutoff(monkeypatch, hours):
    real = run(server.get_settings())

    async def fake():
        s = copy.deepcopy(real)
        s.setdefault("booking_rules", {})["cancellation_cutoff_hours"] = hours
        return s
    monkeypatch.setattr(server, "get_settings", fake)


def _hours_to(day: date, hh: int) -> float:
    start = datetime.combine(day, time(hh, 0), tzinfo=server.BUSINESS_TZ)
    return (start - datetime.now(server.BUSINESS_TZ)).total_seconds() / 3600.0


def _open_day():
    """Two or three days out, on a day daycare is open."""
    for n in (2, 3, 4, 5):
        d = server.business_today() + timedelta(days=n)
        if not server._service_hours_for_date(run(server.get_settings()), "daycare", d).get("closed"):
            return d
    raise AssertionError("no open daycare day found")


def test_a_client_well_inside_the_notice_can_cancel(monkeypatch):
    day = _open_day()
    # A cutoff the old "8 PM the night before" count would have refused (it
    # is 11-12 hours short), with 5 hours to spare against the real 7 AM start.
    _with_cutoff(monkeypatch, math.floor(_hours_to(day, 7)) - 5)
    b = _visit(day)
    run(server.cancel_booking(b["id"], False, CLIENT))
    assert run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))["status"] == "cancelled"


def test_too_late_to_cancel_online_says_when_it_closed_and_to_message_us(monkeypatch):
    day = _open_day()
    _with_cutoff(monkeypatch, math.ceil(_hours_to(day, 7)) + 5)
    b = _visit(day)
    with pytest.raises(HTTPException) as err:
        run(server.cancel_booking(b["id"], False, CLIENT))
    assert err.value.status_code == 400
    assert err.value.block == {"code": "cancel_cutoff", "action": "contact_us"}
    assert "7:00 AM" in err.value.detail and "message us" in err.value.detail
    assert run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))["status"] == "approved"


def test_staff_are_not_held_to_the_online_cutoff(monkeypatch):
    day = _open_day()
    _with_cutoff(monkeypatch, 24 * 30)
    b = _visit(day)
    run(server.cancel_booking(b["id"], False, ADMIN))
    assert run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))["status"] == "cancelled"


def test_a_visit_starts_at_its_appointment_or_drop_off_else_at_seven():
    settings = run(server.get_settings())
    day = _open_day()
    start = lambda b: server._booking_start_local(b, settings)  # noqa: E731
    lesson = guards.visit_start({"date": day.isoformat(), "service_type": "training", "time": "14:30"}, start, server.BUSINESS_TZ)
    assert (lesson.hour, lesson.minute) == (14, 30) and lesson.tzinfo is not None
    no_time = guards.visit_start({"date": day.isoformat(), "service_type": "training", "time": ""}, start, server.BUSINESS_TZ)
    assert (no_time.hour, no_time.minute) == (7, 0)
    assert guards.visit_start({"date": "someday", "service_type": "daycare"}, start, server.BUSINESS_TZ) is None
