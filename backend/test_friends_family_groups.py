"""Friends & family groups: booking dogs from different families together,
one family paying (owner request 2026-09-28; build steps 2-3 — creating the
group). Money paths come in later steps, so the feature is switched on here
by the tests only (friends_family.ENABLED stays False in the app).

The owner's rules for a new group:
  * each dog stays under its OWN family (its row's client_id), and every row
    records the payer (bill_to_client_id) — staff-only;
  * the payer's own dog pays full price, the friend's dog gets the multi-dog
    discount, all at the PAYER's rates (add-ons included); the payer must
    have a dog in the group;
  * a friend's family needs no Meet & Greet (trusted) — but a family marked
    rejected stays refused;
  * only with the friends_family_bookings permission (the owner has it,
    managers don't unless granted); never from the portal; daycare and
    boarding only.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import friends_family

TAG = "TEST_FRIENDS_FAMILY"
OWNER = {"id": "ff-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
MANAGER = {"id": "ff-manager", "role": "admin", "staff_role": "manager", "name": "Mo Manager"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _day():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _two_families(friend_status="prospect"):
    """The payer (a $30 special rate on daycare and a $5 nail trim) and a
    friend's family (not yet a full client), one dog each."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    addon = {"id": str(uuid.uuid4()), "name": f"{TAG} Nail trim", "service_type": "grooming", "base_price": 10.0,
             "active": True, "is_addon": True, "addon_for": ["daycare"]}
    run(server.db.services.insert_many([dict(svc), dict(addon)]))
    fams = {}
    for who, status in (("payer", "active"), ("friend", friend_status)):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": status}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = (cid, did)
    payer_id = fams["payer"][0]
    run(server.db.price_overrides.insert_many([
        {"id": str(uuid.uuid4()), "client_id": payer_id, "target_kind": "service", "target_code": svc["id"],
         "override_price": 30.0, "created_at": server.now_iso()},
        {"id": str(uuid.uuid4()), "client_id": payer_id, "target_kind": "service", "target_code": addon["id"],
         "override_price": 5.0, "created_at": server.now_iso()}]))
    try:
        yield svc["id"], addon["id"], fams
    finally:
        for cid, did in fams.values():
            run(server.db.bookings.delete_many({"dog_id": did}))
            run(server.db.dogs.delete_one({"id": did}))
            run(server.db.clients.delete_one({"id": cid}))
            run(server.db.price_overrides.delete_many({"client_id": cid}))
        run(server.db.services.delete_many({"id": {"$in": [svc["id"], addon["id"]]}}))


def _book(svc, dogs, payer=None, user=OWNER, service_type="daycare", addons=None, override_capacity=True):
    body = server.BookingGroupIn(
        dogs=[server.BookingGroupDog(dog_id=d, addon_service_ids=(addons or {}).get(d, [])) for d in dogs],
        date=_day(), service_type=service_type, service_id=svc, override_capacity=override_capacity,
        override_vaccines=True, payer_client_id=payer)
    return run(server.create_booking_group(body, user))


def _row(dog_id):
    return run(server.db.bookings.find_one({"dog_id": dog_id}, {"_id": 0}))


def test_each_dog_stays_with_its_family_and_the_payer_is_recorded_on_both():
    with _two_families() as (svc, _addon, fams):
        (payer, payer_dog), (friend, friend_dog) = fams["payer"], fams["friend"]
        _book(svc, [friend_dog, payer_dog], payer=payer)   # listed friend first on purpose
        mine, theirs = _row(payer_dog), _row(friend_dog)
        assert mine["client_id"] == payer and theirs["client_id"] == friend, "each dog stays with its own family"
        for r in (mine, theirs):
            assert r["bill_to_client_id"] == payer and r["group_kind"] == "friends_family"
            assert r["pricing_snapshot"]["pricing_client_id"] == payer
        assert mine["group_id"] == theirs["group_id"]


def test_the_payers_dog_pays_full_price_and_the_friends_dog_gets_the_discount_at_the_payers_rate():
    with _two_families() as (svc, _addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        _book(svc, [friend_dog, payer_dog], payer=payer)
        mine, theirs = _row(payer_dog), _row(friend_dog)
        assert mine["pricing_snapshot"]["group_dog_index"] == 0 and not mine.get("multi_dog_discount")
        assert mine["estimated_price"] == 30.0, "the payer's special rate, full price"
        assert theirs["pricing_snapshot"]["group_dog_index"] == 1 and theirs["multi_dog_discount"]["pre_applied"]
        assert theirs["estimated_price"] == 15.0, "the multi-dog discount off the payer's rate"


def test_a_friends_add_on_is_priced_at_the_payers_rate():
    with _two_families() as (svc, addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        _book(svc, [payer_dog, friend_dog], payer=payer, addons={friend_dog: [addon]})
        theirs = _row(friend_dog)
        assert [a["price"] for a in theirs["add_ons"]] == [5.0]
        assert theirs["estimated_price"] == 20.0


def test_a_friends_family_needs_no_meet_and_greet():
    """Booked WITHOUT the admin's override (which has always let an admin
    past the new-client gate): the friend's family is still a prospect."""
    with _two_families(friend_status="prospect") as (svc, _addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        _book(svc, [payer_dog, friend_dog], payer=payer, override_capacity=False)
        assert _row(friend_dog)["bill_to_client_id"] == payer


def test_a_family_marked_rejected_is_still_refused():
    with _two_families(friend_status="rejected") as (svc, _addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        with pytest.raises(HTTPException) as e:
            _book(svc, [payer_dog, friend_dog], payer=payer, override_capacity=False)
        assert e.value.status_code == 400 and "rejected" in e.value.detail
        assert _row(payer_dog) is None and _row(friend_dog) is None


@pytest.mark.parametrize("payer_key, message", [(None, "Choose who pays"), ("outsider", "must have one of its own dogs")])
def test_the_payer_must_be_named_and_have_a_dog_on_the_booking(payer_key, message):
    with _two_families() as (svc, _addon, fams):
        payer = str(uuid.uuid4()) if payer_key == "outsider" else None
        with pytest.raises(HTTPException) as e:
            _book(svc, [fams["payer"][1], fams["friend"][1]], payer=payer)
        assert e.value.status_code == 400 and message in e.value.detail


def test_only_daycare_and_boarding():
    with _two_families() as (svc, _addon, fams):
        with pytest.raises(HTTPException) as e:
            _book(svc, [fams["payer"][1], fams["friend"][1]], payer=fams["payer"][0], service_type="training")
        assert e.value.status_code == 400 and "daycare and boarding" in e.value.detail


def test_managers_need_the_permission_granted_and_clients_never_can(monkeypatch):
    with _two_families() as (svc, _addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        for who in (MANAGER, {"id": "c", "role": "client", "client_id": payer}):
            with pytest.raises(HTTPException) as e:
                _book(svc, [payer_dog, friend_dog], payer=payer, user=who)
            assert e.value.status_code == 403
        monkeypatch.setitem(server._ROLE_OVERRIDES, "manager", {friends_family.PERMISSION: True})
        _book(svc, [payer_dog, friend_dog], payer=payer, user=MANAGER)
        assert _row(friend_dog)["bill_to_client_id"] == payer


def test_while_switched_off_different_families_are_refused(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", False)
    with _two_families() as (svc, _addon, fams):
        with pytest.raises(HTTPException) as e:
            _book(svc, [fams["payer"][1], fams["friend"][1]], payer=fams["payer"][0])
        assert e.value.status_code == 400 and "different families" in e.value.detail


def test_a_family_group_carries_no_payer():
    with _two_families() as (svc, _addon, fams):
        cid, did = fams["payer"]
        second = str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": second, "name": f"{TAG} second", "owner_id": cid, "breed": "Mix", "age_y": 2,
                                       "vaccines": dict(VAX)}))
        try:
            _book(svc, [did, second], payer=cid)
            for d in (did, second):
                row = _row(d)
                assert "bill_to_client_id" not in row and "group_kind" not in row
        finally:
            run(server.db.bookings.delete_many({"dog_id": second}))
            run(server.db.dogs.delete_one({"id": second}))


def test_if_recording_the_payer_fails_part_way_nothing_is_booked(monkeypatch):
    """A friend's add-on switched off the very moment the group is saved (the
    look-up at the payer's rates fails): the group is taken back whole — never
    left half set up at separate prices."""
    with _two_families() as (svc, addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        real = server.resolve_addon_snapshots

        async def gone_at_the_payers_rate(client_id, ids, service_type):
            if client_id == payer:
                raise server.BookingBlocked(400, "One of the add-ons you picked isn't offered anymore. Please remove it and try again.",
                                            code="addon_unavailable", action="remove_addon")
            return await real(client_id, ids, service_type)
        monkeypatch.setattr(server, "resolve_addon_snapshots", gone_at_the_payers_rate)
        with pytest.raises(HTTPException) as e:
            _book(svc, [payer_dog, friend_dog], payer=payer, addons={friend_dog: [addon]})
        assert "Nothing was booked" in e.value.detail
        assert _row(payer_dog) is None and _row(friend_dog) is None


def test_the_booking_note_goes_to_the_paying_familys_dogs_only():
    """The note typed on the booking is the paying family's; a friend's
    family never gets it on its dog (their portal shows booking notes). A
    note written for one dog stays with that dog."""
    with _two_families() as (svc, _addon, fams):
        (payer, payer_dog), (_friend, friend_dog) = fams["payer"], fams["friend"]
        body = server.BookingGroupIn(
            dogs=[server.BookingGroupDog(dog_id=friend_dog, notes=""), server.BookingGroupDog(dog_id=payer_dog, notes="")],
            date=_day(), service_type="daycare", service_id=svc, override_capacity=True, override_vaccines=True,
            payer_client_id=payer, notes="insulin at noon")
        run(server.create_booking_group(body, OWNER))
        assert _row(payer_dog)["notes"] == "insulin at noon"
        assert (_row(friend_dog).get("notes") or "") == ""
