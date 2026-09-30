"""A Meet & Greet blocks its time for everything timed (audit #34).

A Meet & Greet is stored as service_type "other" with `is_meet_greet`, and
the checks that stop timed appointments overlapping only asked for
training/grooming/photography — so a lesson, a grooming or a portrait could
be booked right on top of one (only the Meet & Greet finder looked the other
way), and moving a Meet & Greet was never checked at all. Now every overlap
check and free-time list reads one shared pool (domains/bookings/time_pool.py)
that includes Meet & Greets at the length they were booked with.

Disposable tag TEST_MG_POOL.
"""
import contextlib
import random
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_MG_POOL"
ADMIN = {"id": "mg-pool-admin", "role": "admin", "name": f"{TAG} admin", "email": "mg-pool@test"}
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
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def _meet_greet(day, time="10:00", minutes=30, status="pending", **extra):
    row = {"id": str(uuid.uuid4()), "dog_id": "", "dog_name": "Waffles", "client_id": f"{TAG}-c", "client_name": f"{TAG} Owner",
           "date": day, "time": time, "duration_minutes": minutes, "service_type": "other", "status": status,
           "notes": f"{TAG} Meet & Greet", "created_at": server.now_iso(), "is_meet_greet": True, **extra}
    run(server.db.bookings.insert_one(dict(row)))
    return row


def _lesson(day, time, minutes=60, service="training", **extra):
    row = {"id": str(uuid.uuid4()), "dog_id": f"{TAG}-d", "dog_name": "Rex", "client_id": f"{TAG}-c2", "date": day,
           "time": time, "duration_minutes": minutes, "service_type": service, "status": "approved",
           "notes": f"{TAG} lesson", "created_at": server.now_iso(), **extra}
    run(server.db.bookings.insert_one(dict(row)))
    return row


def _fits(day, time, service="training", minutes=60, service_doc=None):
    """Whether a new timed booking passes the booking check."""
    body = server.BookingIn(dog_id=f"{TAG}-new", service_type=service, date=day, time=time)
    svc = service_doc or {"id": f"{TAG}-svc", "duration_minutes": minutes, "capacity_per_slot": 1}
    try:
        run(server._assert_capacity_available(body, run(server.get_settings()), svc))
        return True
    except HTTPException as e:
        assert e.status_code == 409, e.detail
        return False


# --------------------------------------------- a Meet & Greet blocks bookings

def test_a_lesson_grooming_or_portrait_cannot_be_booked_over_a_meet_and_greet():
    day = _day()
    _meet_greet(day, "10:00", 30)
    for service in ("training", "grooming", "photography"):
        assert not _fits(day, "10:00", service), service
    assert not _fits(day, "09:30"), "a 60-minute lesson at 9:30 runs into it"
    assert _fits(day, "10:30") and _fits(day, "09:00")


def test_it_blocks_for_the_length_it_was_booked_with():
    day = _day()
    _meet_greet(day, "10:00", 90)
    assert not _fits(day, "11:00", minutes=30)
    assert _fits(day, "11:30", minutes=30)


def test_one_saved_without_a_length_uses_the_setting():
    day = _day()
    _meet_greet(day, "10:00", 0)
    with _settings(meet_greet__slot_minutes=90):
        assert not _fits(day, "11:00", minutes=30)
        assert _fits(day, "11:30", minutes=30)


def test_it_is_never_a_seat_in_a_class():
    day = _day()
    cls = {"id": f"{TAG}-class-{uuid.uuid4().hex[:6]}", "duration_minutes": 60, "capacity_per_slot": 6}
    _lesson(day, "10:00", service_id=cls["id"])
    assert _fits(day, "10:00", service_doc=cls), "5 seats still free"
    _meet_greet(day, "10:00", 30, service_id=cls["id"])      # even one carrying a stray matching service id
    assert not _fits(day, "10:00", service_doc=cls), "the owner is at the Meet & Greet"


def test_a_cancelled_rejected_or_finished_meet_and_greet_frees_the_time():
    day = _day()
    for status, extra in (("cancelled", {}), ("rejected", {}), ("completed", {"checked_out_at": server.now_iso()})):
        mg = _meet_greet(day, "10:00", 30, status=status, **extra)
        assert _fits(day, "10:00"), status
        run(server.db.bookings.delete_one({"id": mg["id"]}))


# ------------------------------------------------- the time picker agrees

def test_the_time_picker_shows_the_meet_and_greet_time_as_taken():
    day = _day()
    dow = server.DEFAULT_DAYS[date.fromisoformat(day).weekday()]
    with _settings(**{f"service_hours__grooming__{dow}": {"closed": False, "open": "08:00", "close": "18:00"}}):
        _meet_greet(day, "10:00", 30)
        slots = {s["time"]: s["available"] for s in run(server.list_time_slots(day, "grooming", 30, None, ADMIN))["slots"]}
        assert slots["10:00"] is False
        assert slots["09:30"] is True and slots["10:30"] is True


# ----------------------------------------------- moving a Meet & Greet

def test_moving_a_meet_and_greet_onto_a_lesson_is_refused():
    day = _day()
    _lesson(day, "14:00", 60)
    mg = _meet_greet(day, "10:00", 30)
    with pytest.raises(HTTPException) as e:
        run(server._update_booking_with_capacity(mg, {"time": "14:30"}))
    assert e.value.status_code == 409
    assert run(server.db.bookings.find_one({"id": mg["id"]}, {"_id": 0}))["time"] == "10:00"
    run(server._update_booking_with_capacity(mg, {"time": "15:00"}))
    assert run(server.db.bookings.find_one({"id": mg["id"]}, {"_id": 0}))["time"] == "15:00"


def test_dragging_a_meet_and_greet_to_a_busy_day_is_refused():
    day, busy = _day(), _day()
    _lesson(busy, "10:00", 60, service="grooming")
    mg = _meet_greet(day, "10:00", 30)
    with pytest.raises(HTTPException) as e:
        run(server._update_booking_with_capacity(mg, {"date": busy}))
    assert e.value.status_code == 409
    assert run(server.db.bookings.find_one({"id": mg["id"]}, {"_id": 0}))["date"] == day


# ----------------------------------- the Meet & Greet finder, same pool

def test_the_meet_and_greet_finder_reads_the_same_pool():
    day = _day()
    dow = server.DEFAULT_DAYS[date.fromisoformat(day).weekday()]
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    with _settings(meet_greet={"enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}):
        _lesson(day, "10:00", 60)
        _lesson(day, "13:00", 60, checked_out_at=server.now_iso())          # finished early
        s = {x["time"]: x["available"] for x in run(server._compute_meet_greet_slots(run(server.get_settings()), date.fromisoformat(day)))["slots"]}
        assert s["10:00"] is False and s["10:30"] is False and s["11:00"] is True
        assert s["13:00"] is True, "a lesson that already went home frees its time, as everywhere else"
        assert dow in hours


# ------------------------------------- a request can't race a lesson

def test_a_meet_and_greet_request_waits_for_the_days_time_pool():
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.db.auth_rate_limits.delete_many({}))
    body = {"owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101", "dog_name": "Waffles", "date": day, "time": "10:00"}
    with _settings(meet_greet={"enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}):
        owner = run(server._acquire_capacity_locks([f"timepool:{day}"]))
        try:
            r = run(_http.post("/api/public/meet-greet-request", json=body))
            assert r.status_code == 409, r.text
            assert not run(server.db.bookings.find_one({"date": day, "is_meet_greet": True}, {"_id": 1}))
            assert not run(server.db.clients.find_one({"email": email}, {"_id": 1})), "a refusal writes nothing"
        finally:
            run(server._release_capacity_locks(owner, [f"timepool:{day}"]))
        r = run(_http.post("/api/public/meet-greet-request", json=body))
        assert r.status_code == 200, r.text
    run(server.db.bookings.delete_many({"date": day, "is_meet_greet": True}))
    for c in run(server.db.clients.find({"email": email}, {"_id": 0, "id": 1}).to_list(5)):
        run(server.db.claim_tokens.delete_many({"client_id": c["id"]}))
    run(server.db.clients.delete_many({"email": email}))



def test_a_lesson_booked_while_a_request_waits_wins_and_the_request_writes_nothing():
    import asyncio
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.db.auth_rate_limits.delete_many({}))
    body = {"owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101", "dog_name": "Waffles", "date": day, "time": "10:00"}

    async def _race():
        owner = await server._acquire_capacity_locks([f"timepool:{day}"])
        request = asyncio.create_task(_http.post("/api/public/meet-greet-request", json=body))
        await asyncio.sleep(0.05)
        await server.db.bookings.insert_one({                         # the lesson that held the pool
            "id": str(uuid.uuid4()), "dog_id": f"{TAG}-d", "dog_name": "Rex", "date": day, "time": "10:00",
            "duration_minutes": 60, "service_type": "training", "status": "approved", "notes": f"{TAG} lesson"})
        await server._release_capacity_locks(owner, [f"timepool:{day}"])
        return await request
    with _settings(meet_greet={"enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}):
        r = run(_race())
    assert r.status_code == 400, r.text
    assert not run(server.db.bookings.find_one({"date": day, "is_meet_greet": True}, {"_id": 1}))
    assert not run(server.db.clients.find_one({"email": email}, {"_id": 1}))


def test_moving_a_meet_and_greet_waits_for_the_days_time_pool():
    day = _day()
    mg = _meet_greet(day, "10:00", 30)
    owner = run(server._acquire_capacity_locks([f"timepool:{day}"]))
    try:
        with pytest.raises(HTTPException) as e:
            run(server._update_booking_with_capacity(mg, {"time": "11:00"}))
        assert e.value.status_code == 409
    finally:
        run(server._release_capacity_locks(owner, [f"timepool:{day}"]))


def test_editing_a_booking_that_already_overlaps_one_without_moving_it_is_allowed():
    # Overlaps made before this check existed stay editable (notes, etc.);
    # only moving takes a new place and is checked.
    day = _day()
    _meet_greet(day, "10:00", 30)
    lesson = _lesson(day, "10:00", 60)
    run(server._update_booking_with_capacity(lesson, {"notes": f"{TAG} bring treats", "date": day, "time": "10:00"}))
    assert run(server.db.bookings.find_one({"id": lesson["id"]}, {"_id": 0}))["notes"] == f"{TAG} bring treats"
    with pytest.raises(HTTPException):
        run(server._update_booking_with_capacity(lesson, {"time": "09:45"}))


# ------------------------- a returning archived family (audit #36)

def test_an_archived_familys_request_is_kept_for_staff_but_sends_no_sign_up_link_that_cannot_work():
    day = _day()
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    cid = f"{TAG}-archived-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Archived", "email": email,
                                      "deleted_at": server.now_iso(), "created_at": server.now_iso()}))
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.db.auth_rate_limits.delete_many({}))
    body = {"owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101", "dog_name": "Waffles", "date": day, "time": "10:00"}
    try:
        with _settings(meet_greet={"enabled": True, "slot_minutes": 30, "min_lead_hours": 0, "max_advance_days": 900, "hours": hours}):
            r = run(_http.post("/api/public/meet-greet-request", json=body))
        assert r.status_code == 200, r.text
        mg = run(server.db.bookings.find_one({"date": day, "is_meet_greet": True}, {"_id": 0}))
        assert mg["client_id"] == cid and "archived" in mg["notes"], "kept on the family, and staff are told why"
        assert not run(server.db.claim_tokens.find_one({"client_id": cid})), "no link that could only fail"
        with pytest.raises(HTTPException) as e:
            run(server.approve_booking(mg["id"], ADMIN))
        assert e.value.block["code"] == "family_archived"
    finally:
        run(server.db.bookings.delete_many({"date": day, "is_meet_greet": True}))
        run(server.db.claim_tokens.delete_many({"client_id": cid}))
        run(server.db.clients.delete_many({"email": email}))
