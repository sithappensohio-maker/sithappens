"""Two dogs booked together into one timed slot (a group) are not refused as full: the
group is one unit of the service's capacity (audit #11: "Two dogs in one timed group
booking are refused as full"). A dog from another booking still counts. Far-future date.
Disposable tag TEST_GROUP_SLOT."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_GROUP_SLOT"
DAY = date(2031, 3, 5)


@pytest.fixture()
def slot(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: DAY)
    svc = f"{TAG}-svc-{uuid.uuid4().hex[:6]}"
    group = f"{TAG}-grp-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({"id": f"{TAG}-first-{uuid.uuid4().hex[:6]}", "dog_id": f"{TAG}-d1",
                                       "date": DAY.isoformat(), "time": "10:00", "duration_minutes": 60,
                                       "service_type": "training", "service_id": svc, "status": "approved",
                                       "group_id": group, "tag": TAG}))
    yield {"svc": svc, "group": group, "service": {"id": svc, "name": "Lesson", "capacity_per_slot": 1, "duration_minutes": 60}}
    run(server.db.bookings.delete_many({"tag": TAG}))


def _body(svc):
    return server.BookingIn(dog_id=f"{TAG}-d2", date=DAY.isoformat(), service_type="training", service_id=svc, time="10:00")


def test_a_second_dog_of_the_same_group_takes_the_slot(slot):
    token = server._booking_group_ctx.set(slot["group"])
    try:
        run(server._assert_capacity_available(_body(slot["svc"]), {}, slot["service"]))
    finally:
        server._booking_group_ctx.reset(token)


def test_a_dog_outside_the_group_is_still_refused_a_full_slot(slot):
    with pytest.raises(HTTPException):
        run(server._assert_capacity_available(_body(slot["svc"]), {}, slot["service"]))
