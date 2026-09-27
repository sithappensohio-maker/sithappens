"""The Photo Specials' $0 Portrait Session is never offered or booked on its own.

Audit finding (2026-09-25): Photo Specials point their 15-minute slots at one
"Portrait Session" service created on demand with a $0 price (the Register
prices the package). As an ordinary active service it was listed on the
public Photography page as "Portrait Session $0", offered in the client
portal, and any client could book a free portrait on any day.

Owner's decision: hide it everywhere except Photo Specials. These pin that the
public page, the portal and staff booking pickers don't offer it, that a
booking of it outside a Photo Special is refused, and that the category-only
booking path can't fall back onto it — while Photo Specials keep using it.
"""
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.bookings import guards

TAG = "TEST_PORTRAIT_HIDDEN"
ADMIN = {"id": "portrait-admin", "role": "admin", "name": "Pat Owner"}


@pytest.fixture(scope="module")
def world():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com"}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": cid,
                                   "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}))
    existing = run(server.db.services.find_one({"slug": guards.PHOTO_SPECIAL_ONLY_SLUG}, {"_id": 0}))
    portrait = existing or {"id": str(uuid.uuid4()), "slug": guards.PHOTO_SPECIAL_ONLY_SLUG, "name": "Portrait Session",
                            "service_type": "photography", "base_price": 0.0, "duration_minutes": 15, "active": True}
    if not existing:
        # An older row, created before the flag existed: the slug alone hides it.
        run(server.db.services.insert_one(dict(portrait)))
    session = {"id": str(uuid.uuid4()), "slug": f"{TAG.lower()}-session", "name": f"{TAG} Photo Session",
               "service_type": "photography", "base_price": 150.0, "duration_minutes": 60, "active": True}
    run(server.db.services.insert_one(dict(session)))
    client_user = {"id": f"u-{cid}", "role": "client", "client_id": cid, "name": "Dana"}
    yield {"client": client_user, "dog_id": did, "portrait": portrait, "session": session}
    run(server.db.bookings.delete_many({"dog_id": did}))
    run(server.db.dogs.delete_one({"id": did}))
    run(server.db.clients.delete_one({"id": cid}))
    run(server.db.services.delete_one({"id": session["id"]}))
    if not existing:
        run(server.db.services.delete_one({"id": portrait["id"]}))


def _ids(items):
    return {s["id"] for s in items}


def test_the_public_photography_page_does_not_list_it(world):
    items = run(server.public_list_services())
    assert world["portrait"]["id"] not in _ids(items)
    assert world["session"]["id"] in _ids(items)


def test_clients_are_not_offered_it_and_staff_pickers_are_told(world):
    as_client = run(server.list_services(user=world["client"]))
    assert world["portrait"]["id"] not in _ids(as_client)
    as_staff = {s["id"]: s for s in run(server.list_services(user=ADMIN))}
    assert as_staff[world["portrait"]["id"]]["photo_special_only"] is True
    assert not as_staff[world["session"]["id"]].get("photo_special_only")


def _book(world, user, service_id=None):
    day = (server.business_today() + timedelta(days=9)).isoformat()
    body = server.BookingIn(dog_id=world["dog_id"], date=day, service_type="photography",
                            service_id=service_id, time="11:00", override_capacity=True)
    return run(server.create_booking(body=body, user=user))


def test_booking_it_outside_a_photo_special_is_refused(world):
    for user in (world["client"], ADMIN):
        with pytest.raises(HTTPException) as err:
            _book(world, user, world["portrait"]["id"])
        assert err.value.status_code == 400 and err.value.block["code"] == "photo_special_only"


def test_a_photography_booking_without_a_service_never_lands_on_it(world):
    booking = _book(world, ADMIN)
    assert booking.get("service_id") != world["portrait"]["id"]
