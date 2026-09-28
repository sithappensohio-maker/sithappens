"""Multi-dog group bookings are made safely (step 1 of friends & family
groups, owner request 2026-09-28).

Before:
  * an admin could put dogs from DIFFERENT families in one group through the
    API — each family was then billed apart, every dog at the first family's
    rates (the screens only hid it);
  * a single booking could carry any group id it was sent, joining another
    family's group (and its multi-dog discount);
  * if the group couldn't be priced together, the failure was only logged —
    the dogs were booked at separate full prices, the discount silently lost.

Now dogs from different families are refused (friends & family groups come
with a payer, later), only the group booking itself stamps a group id, and a
group that can't be priced books nothing.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_GROUP_GUARDS"
ADMIN = {"id": "gg-admin", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}


def _day():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _families(*sizes):
    """One client per size, each with that many dogs, plus a daycare service."""
    fams = []
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    for n in sizes:
        cid = str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com"}))
        dogs = []
        for i in range(n):
            did = str(uuid.uuid4())
            run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog {i}", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                           "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}))
            dogs.append(did)
        fams.append((cid, dogs))
    try:
        yield svc["id"], fams
    finally:
        for cid, _dogs in fams:
            run(server.db.bookings.delete_many({"client_id": cid}))
            run(server.db.dogs.delete_many({"owner_id": cid}))
            run(server.db.clients.delete_one({"id": cid}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _group(svc_id, dog_ids):
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=d) for d in dog_ids], date=_day(),
                                 service_type="daycare", service_id=svc_id, override_capacity=True, override_vaccines=True)
    return run(server.create_booking_group(body, ADMIN))


def _rows(dog_ids):
    return run(server.db.bookings.find({"dog_id": {"$in": list(dog_ids)}}, {"_id": 0}).to_list(20))


def test_a_family_group_still_books_every_dog_on_one_group_and_prices_them_together():
    with _families(2) as (svc, [(_cid, dogs)]):
        out = _group(svc, dogs)
        rows = _rows(dogs)
        assert len(rows) == 2 and {r["group_id"] for r in rows} == {out["group_id"]}
        assert sorted((r.get("pricing_snapshot") or {}).get("group_dog_index") for r in rows) == [0, 1]
        assert sum(1 for r in rows if (r.get("multi_dog_discount") or {}).get("pre_applied")) == 1


def test_dogs_from_different_families_are_refused_and_nothing_is_booked():
    with _families(1, 1) as (svc, [(_a, [dog_a]), (_b, [dog_b])]):
        with pytest.raises(HTTPException) as e:
            _group(svc, [dog_a, dog_b])
        assert e.value.status_code == 400 and "different families" in e.value.detail
        assert _rows([dog_a, dog_b]) == []


def test_a_group_id_sent_by_hand_never_joins_a_group():
    with _families(2, 1) as (svc, [(_a, dogs), (_b, [stranger])]):
        gid = _group(svc, dogs)["group_id"]
        run(server.create_booking(server.BookingIn(dog_id=stranger, date=_day(), service_type="daycare", service_id=svc,
                                                   override_capacity=True, override_vaccines=True, group_id=gid), ADMIN))
        [row] = _rows([stranger])
        assert not row.get("group_id")
        assert len(run(server.db.bookings.find({"group_id": gid}).to_list(20))) == 2


def test_if_the_dogs_cannot_be_priced_together_nothing_is_booked(monkeypatch):
    def broken_discount(*_a, **_kw):
        raise RuntimeError("discount settings unreadable")
    with _families(2) as (svc, [(_cid, dogs)]):
        monkeypatch.setattr(server, "_discount_amount_for_extra_dogs", broken_discount)
        with pytest.raises(HTTPException) as e:
            _group(svc, dogs)
        assert e.value.status_code == 500 and "nothing was booked" in e.value.detail
        assert _rows(dogs) == []


def test_when_one_dog_cannot_be_booked_the_others_are_taken_back():
    with _families(1) as (svc, [(_cid, [dog])]):
        with pytest.raises(HTTPException):
            _group(svc, [dog, f"{TAG}-no-such-dog"])
        assert _rows([dog]) == []


def _board_and_train_group(svc_program=True):
    """A boarding service sold as a Board & Train package: booking it
    enrolls each dog in the package's School program."""
    pid = str(uuid.uuid4())
    run(server.db.programs.insert_one({
        "id": pid, "name": f"{TAG} Board & Train", "type": "board_train", "format": {"count": 1, "unit": "week"},
        "delivery_mode": "in_person", "active": True,
        "modules": [{"id": "m1", "name": "M1", "lessons": [{"id": "l1", "title": "Sit", "name": "Sit", "active": True}]}]}))
    sid = str(uuid.uuid4())
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} B&T", "service_type": "boarding", "base_price": 100.0,
                                       "active": True, "package_program_id": pid}))
    return pid, sid


def _enrollments(dog_ids):
    return (run(server.db.dog_programs.count_documents({"dog_id": {"$in": list(dog_ids)}})),
            run(server.db.school_enrollments.count_documents({"dog_id": {"$in": list(dog_ids)}})))


def test_a_board_and_train_group_that_is_taken_back_leaves_no_school_enrollment(monkeypatch):
    def broken_discount(*_a, **_kw):
        raise RuntimeError("discount settings unreadable")
    pid, sid = _board_and_train_group()
    with _families(2) as (_svc, [(_cid, dogs)]):
        try:
            start = (server.business_today() + server.timedelta(days=6)).isoformat()
            end = (server.business_today() + server.timedelta(days=13)).isoformat()
            body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=d) for d in dogs], date=start, end_date=end,
                                         service_type="boarding", service_id=sid, override_capacity=True, override_vaccines=True)
            monkeypatch.setattr(server, "_discount_amount_for_extra_dogs", broken_discount)
            with pytest.raises(HTTPException):
                run(server.create_booking_group(body, ADMIN))
            assert _rows(dogs) == [] and _enrollments(dogs) == (0, 0), "nothing was booked means nothing was enrolled"
        finally:
            run(server.db.dog_programs.delete_many({"dog_id": {"$in": dogs}}))
            run(server.db.school_enrollments.delete_many({"dog_id": {"$in": dogs}}))
            run(server.db.programs.delete_one({"id": pid}))
            run(server.db.services.delete_one({"id": sid}))
