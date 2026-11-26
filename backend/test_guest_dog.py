"""One-time guest dog (owner request 2026-11-26) — a family on file turns up
with an extra dog we have never seen.

The owner's rules: the desk adds it in one step under the family already on
file; it stays on their file tagged "One-time guest"; it has no vaccine
records, staff must confirm that, and the confirmation lets the dog be booked
and checked in TODAY only. It can join a visit already on today's list.

Self-contained fixtures (never import another test module).
"""
import _test_env  # noqa: F401 — must run before `import server`
import contextlib
import uuid
from datetime import timedelta

import pytest
import server
from _test_loop import run
from fastapi import HTTPException
from domains.bookings import friends_family, group_add

TAG = "TEST_GUEST_DOG"
ADMIN = {"id": "guest-admin", "name": "Guest Admin", "email": "guest@example.invalid", "role": "admin"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


def _day(off=0):
    return (server.business_today() + timedelta(days=off)).isoformat()


@contextlib.contextmanager
def _family():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rex", "owner_id": cid, "breed": "Mix", "age_y": 3, "vaccines": dict(VAX)}))
    try:
        yield cid, did
    finally:
        dogs = [d["id"] for d in run(server.db.dogs.find({"owner_id": cid}, {"_id": 0, "id": 1}).to_list(50))]
        run(server.db.bookings.delete_many({"dog_id": {"$in": dogs}}))
        for coll in ("bookings", "invoices", "payments", "payment_ledger"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.dogs.delete_many({"owner_id": cid}))
        run(server.db.clients.delete_one({"id": cid}))


def _guest(cid, **over):
    body = server.GuestDogIn(**{"dog_name": "Pepper", "breed": "Beagle", "no_vaccines_confirmed": True, **over})
    return run(server.create_guest_dog(cid, body, ADMIN))


def _vaccines_required(monkeypatch):
    """Whatever the saved settings say, vaccines are required and enforced here."""
    monkeypatch.setattr(server, "_required_vaccines_for_service", lambda *a, **k: ["rabies"])


def test_a_guest_dog_is_saved_on_the_family_and_marked_one_time_guest():
    with _family() as (cid, _):
        out = _guest(cid)
        dog = out["dog"]
        assert out["already_on_file"] is False
        assert dog["owner_id"] == cid and dog["name"] == "Pepper" and dog["breed"] == "Beagle"
        assert dog["tags"] == ["One-time guest"]
        assert dog["vaccines"] == {}, "a guest has handed in no vaccine paperwork; do not imply otherwise"
        saved = run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0}))
        assert saved and saved["guest"] is True and saved["guest_vaccines_ok_on"] == _day()


def test_staff_must_confirm_the_no_vaccines_warning():
    with _family() as (cid, _):
        with pytest.raises(HTTPException) as e:
            _guest(cid, no_vaccines_confirmed=False)
        assert e.value.status_code == 422
        assert run(server.db.dogs.count_documents({"owner_id": cid})) == 1, "nothing is saved without the confirmation"


def test_a_blank_name_and_an_unknown_family_are_refused():
    with _family() as (cid, _):
        with pytest.raises(HTTPException) as e:
            _guest(cid, dog_name="   ")
        assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        _guest("no-such-family")
    assert e.value.status_code == 404


def test_pressing_add_twice_gives_the_same_guest_back_not_a_second_dog():
    with _family() as (cid, _):
        first = _guest(cid)["dog"]
        again = _guest(cid, dog_name="  pepper ")
        assert again["already_on_file"] is True and again["dog"]["id"] == first["id"]
        assert run(server.db.dogs.count_documents({"owner_id": cid})) == 2


def test_a_name_the_family_already_has_on_file_is_refused_with_a_way_forward():
    with _family() as (cid, _):
        with pytest.raises(HTTPException) as e:
            _guest(cid, dog_name="rex")
        assert e.value.status_code == 409 and "Pick that dog instead" in e.value.detail


def test_an_archived_family_cannot_get_a_guest_dog():
    with _family() as (cid, _):
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": server.now_iso()}}))
        with pytest.raises(HTTPException):
            _guest(cid)
        assert run(server.db.dogs.count_documents({"owner_id": cid})) == 1


def test_the_guest_can_be_booked_and_checked_in_today_without_the_vaccine_override(monkeypatch):
    _vaccines_required(monkeypatch)
    with _family() as (cid, _):
        dog = _guest(cid)["dog"]
        booking = run(server.create_booking(server.BookingIn(
            dog_id=dog["id"], date=_day(), service_type="daycare", override_capacity=True, check_in_now=True), ADMIN))
        assert booking["status"] == "approved" and booking.get("checked_in_at")


def test_the_confirmation_covers_today_only(monkeypatch):
    _vaccines_required(monkeypatch)
    with _family() as (cid, _):
        dog = _guest(cid)["dog"]
        # a visit on another day is checked like every other dog
        with pytest.raises(HTTPException) as e:
            run(server.create_booking(server.BookingIn(
                dog_id=dog["id"], date=_day(3), service_type="daycare", override_capacity=True), ADMIN))
        assert "accin" in str(e.value.detail)
        # and so is today, once the confirmation is a day old
        run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"guest_vaccines_ok_on": _day(-1)}}))
        with pytest.raises(HTTPException):
            run(server.create_booking(server.BookingIn(
                dog_id=dog["id"], date=_day(), service_type="daycare", override_capacity=True), ADMIN))


def test_a_dog_that_is_not_a_guest_is_still_stopped_by_the_vaccine_check(monkeypatch):
    _vaccines_required(monkeypatch)
    with _family() as (cid, did):
        run(server.db.dogs.update_one({"id": did}, {"$set": {"vaccines": {}}}))
        with pytest.raises(HTTPException):
            run(server.create_booking(server.BookingIn(
                dog_id=did, date=_day(), service_type="daycare", override_capacity=True), ADMIN))


def test_the_guest_joins_a_visit_already_on_todays_list_and_is_checked_in(monkeypatch):
    _vaccines_required(monkeypatch)
    monkeypatch.setattr(friends_family, "ENABLED", True)
    with _family() as (cid, did):
        visit = run(server.create_booking(server.BookingIn(
            dog_id=did, date=_day(), service_type="daycare", override_capacity=True), ADMIN))
        dog = _guest(cid)["dog"]
        out = run(group_add.add_dog(visit["id"], group_add.GroupDogIn(dog_id=dog["id"], override_capacity=True), ADMIN))
        assert out["dog_count"] == 2
        new = out["booking"]
        assert new["dog_id"] == dog["id"] and new["client_id"] == cid and new["date"][:10] == _day()
        checked = run(server.check_in(new["id"], server.CheckInIn(vaccine_ack=True), ADMIN))
        assert checked.get("checked_in_at")
