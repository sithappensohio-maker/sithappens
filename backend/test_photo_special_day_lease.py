"""A Photo Special reservation checks the day's time and saves it while holding
the day's time pool, as a lesson, grooming or Meet & Greet does (audit: "Photo
Special reservations save without the day's time lock"). Two people taking the
same instant can't both be accepted, and a lesson booked meanwhile wins.
Disposable tag TEST_PS_LEASE."""
import asyncio
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import test_photo_specials as ps
from _test_loop import run
from domains.bookings.blocks import BookingBlocked, block_of

TAG = "TEST_PS_LEASE"


def _body(sp, when, key=None):
    return server.PhotoSpecialReserveIn(**{
        "date": ps.DAY_1, "time": when, "first_name": "Sarah", "last_name": "Jones",
        "email": f"sarah{uuid.uuid4().hex[:8]}@example.com", "phone": f"614555{uuid.uuid4().int % 10_000_000:07d}",
        "dog_name": "Bella", "breed": "Corgi", **({"idempotency_key": key} if key else {}),
    })


def _reserve(sp, when, key=None):
    return server.public_photo_special_reserve(sp["slug"], _body(sp, when, key), ps._Req())


@pytest.fixture()
def special():
    sp = ps._special(start_time="09:00", end_time="10:30", slot_minutes=15)
    yield sp
    run(server.db.bookings.delete_many({"photo_special_id": sp["id"]}))
    run(server.db.bookings.delete_many({"tag": TAG}))


def _key(day):
    return f"timepool:{day}"


def test_a_reservation_waits_while_the_day_is_held(special):
    async def scenario():
        owner = await server._acquire_capacity_locks([_key(ps.DAY_1)])
        try:
            task = asyncio.ensure_future(_reserve(special, "09:00"))
            await asyncio.sleep(0.05)
            assert not task.done(), "the reservation must wait for the day's time pool"
        finally:
            await server._release_capacity_locks(owner, [_key(ps.DAY_1)])
        out = await task
        assert out["ok"] is True
    run(scenario())


def test_a_lesson_booked_while_the_reservation_waits_wins(special):
    async def scenario():
        owner = await server._acquire_capacity_locks([_key(ps.DAY_1)])
        task = asyncio.ensure_future(_reserve(special, "09:00"))
        await asyncio.sleep(0.05)
        await server.db.bookings.insert_one({
            "id": f"{TAG}-lesson-{uuid.uuid4().hex[:6]}", "tag": TAG, "date": ps.DAY_1, "time": "09:00",
            "duration_minutes": 60, "service_type": "training", "status": "approved", "dog_name": "Other"})
        await server._release_capacity_locks(owner, [_key(ps.DAY_1)])
        with pytest.raises(BookingBlocked) as err:
            await task
        assert block_of(err.value)["code"] == "slot_taken"
        assert await server.db.bookings.count_documents({"photo_special_id": special["id"], "time": "09:00"}) == 0
    run(scenario())


def test_two_taps_with_the_same_key_give_one_reservation(special):
    async def scenario():
        a, b = await asyncio.gather(_reserve(special, "09:15", key=f"{TAG}-k"), _reserve(special, "09:15", key=f"{TAG}-k"))
        assert a["ok"] and b["ok"]
        assert a["reservation"]["booking_id"] == b["reservation"]["booking_id"]
        assert await server.db.bookings.count_documents({"photo_special_id": special["id"], "time": "09:15"}) == 1
    run(scenario())


def test_a_refused_reservation_gives_the_day_back(special):
    async def scenario():
        owner = await server._acquire_capacity_locks([_key(ps.DAY_1)])
        await server._release_capacity_locks(owner, [_key(ps.DAY_1)])
        await server.db.bookings.insert_one({
            "id": f"{TAG}-taken-{uuid.uuid4().hex[:6]}", "tag": TAG, "date": ps.DAY_1, "time": "09:30",
            "duration_minutes": 30, "service_type": "training", "status": "approved", "dog_name": "Other"})
        with pytest.raises(BookingBlocked):
            await _reserve(special, "09:30")
        again = await asyncio.wait_for(server._acquire_capacity_locks([_key(ps.DAY_1)]), timeout=2)
        await server._release_capacity_locks(again, [_key(ps.DAY_1)])
    run(scenario())
