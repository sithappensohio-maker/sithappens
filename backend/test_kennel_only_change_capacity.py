"""Moving a boarder to another kennel does not re-count the night's boarders (audit #12).
On a full night, a kennel-only change was refused as "We're full" because the day count
included every other boarder. Only a changed stay can take a new night; a kennel change
still refuses an occupied kennel. Disposable tag TEST_KENNEL_ONLY."""
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_KENNEL_ONLY"
NIGHT = date(2031, 7, 14)
END = date(2031, 7, 16)


@pytest.fixture()
def full_night(monkeypatch):
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                                      "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rosie", "owner_id": cid, "breed": "Mix", "tag": TAG,
                                   "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}))
    def booking(kennel):
        b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": did, "client_id": cid, "dog_name": "Rosie",
             "service_type": "boarding", "service_id": None, "date": NIGHT.isoformat(), "end_date": END.isoformat(),
             "status": "approved", "kennel": kennel, "time": "", "dropoff_time": "", "pickup_time": "", "notes": "",
             "tag": TAG, "created_at": server.now_iso(), "price": 0}
        run(server.db.bookings.insert_one(dict(b)))
        return b
    first = booking("Kennel 1")
    second = booking("Kennel 2")
    settings = {"boarding_capacity": 1, "daycare_capacity": 10, "day_to_day": {"guardrails": {"max_dogs_per_kennel": 1}}}

    async def fake_settings():
        return settings
    monkeypatch.setattr(server, "get_settings", fake_settings)
    yield second
    run(server.db.bookings.delete_many({"tag": TAG}))
    run(server.db.dogs.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"tag": TAG}))


def test_a_kennel_change_on_a_full_night_goes_through(full_night):
    out = run(server._update_booking_with_capacity(full_night, {"kennel": "Kennel 3"}))
    assert out["kennel"] == "Kennel 3"


def test_a_kennel_change_into_an_occupied_kennel_is_still_refused(full_night):
    with pytest.raises(HTTPException) as err:
        run(server._update_booking_with_capacity(full_night, {"kennel": "Kennel 1"}))
    assert err.value.status_code == 409
