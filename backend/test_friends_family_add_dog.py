"""Friends & family: add a dog to a booking that already exists (build step
8; owner request 2026-09-28). The switch is on in these tests only.

The owner's rules: a friend's dog (or another of the family's own) can join
a booking any time before a dog of it has gone home. It gets the same dates,
service and times, and the multi-dog discount at the paying family's rates;
the family paying for the booking pays for it too. A friend's dog is
trusted (no Meet & Greet), but a family marked rejected is still refused.
A failed add leaves the dogs already booked exactly as they were.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import friends_family, group_add
from matrix_support import saved_matrix  # noqa: F401 — the fixture is a test argument

TAG = "TEST_FF_ADD"
OWNER = {"id": "ffadd-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
MANAGER = {"id": "ffadd-manager", "role": "admin", "staff_role": "manager", "name": "Mo Manager"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _day(off=0):
    return (server.business_today() + timedelta(days=off)).isoformat()


def _arrived(booking_id):
    run(server.check_in(booking_id, server.CheckInIn(vaccine_ack=True), OWNER))
    run(server.db.bookings.update_one({"id": booking_id}, {"$set": {
        "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()}}))


@contextlib.contextmanager
def _families(friend_status="prospect"):
    """The payer (a $30 special rate on a $40 daycare, a $5 nail trim; two
    dogs) and a friend's family (not yet a full client; one dog)."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    addon = {"id": str(uuid.uuid4()), "name": f"{TAG} Nail trim", "service_type": "grooming", "base_price": 10.0,
             "active": True, "is_addon": True, "addon_for": ["daycare"]}
    run(server.db.services.insert_many([dict(svc), dict(addon)]))
    fams = {}
    for who, status, n in (("payer", "active", 2), ("friend", friend_status, 1)):
        cid = str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": status, "account_balance": 0.0}))
        dogs = []
        for i in range(n):
            did = str(uuid.uuid4())
            run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog {i}", "owner_id": cid, "breed": "Mix",
                                           "age_y": 3, "vaccines": dict(VAX)}))
            dogs.append(did)
        fams[who] = {"client": cid, "dog": dogs[0], "dogs": dogs}
    payer = fams["payer"]["client"]
    run(server.db.price_overrides.insert_many([
        {"id": str(uuid.uuid4()), "client_id": payer, "target_kind": "service", "target_code": svc["id"],
         "override_price": 30.0, "created_at": server.now_iso()},
        {"id": str(uuid.uuid4()), "client_id": payer, "target_kind": "service", "target_code": addon["id"],
         "override_price": 5.0, "created_at": server.now_iso()}]))
    try:
        yield svc["id"], addon["id"], fams["payer"], fams["friend"]
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "checkout_groups"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            for d in f["dogs"]:
                run(server.db.bookings.delete_many({"dog_id": d}))
                run(server.db.dogs.delete_one({"id": d}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
        run(server.db.services.delete_many({"id": {"$in": [svc["id"], addon["id"]]}}))


def _book_one(svc, dog_id):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, date=_day(), service_type="daycare", service_id=svc,
        override_capacity=True, override_vaccines=True), OWNER))


def _book_group(svc, dogs, payer):
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=d) for d in dogs], date=_day(), service_type="daycare",
                                 service_id=svc, override_capacity=True, override_vaccines=True, payer_client_id=payer)
    return run(server.create_booking_group(body, OWNER))


def _add(booking_id, dog_id, user=OWNER, **body):
    body.setdefault("override_vaccines", True)
    return run(group_add.add_dog(booking_id, group_add.GroupDogIn(dog_id=dog_id, **body), user))


def _row(booking_id):
    return run(server.db.bookings.find_one({"id": booking_id}, {"_id": 0}))


def test_a_friends_dog_joins_a_booking_and_the_family_booked_first_pays_for_both():
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        out = _add(lone["id"], friend["dog"])
        mine, theirs = _row(lone["id"]), _row(out["booking"]["id"])
        assert theirs["client_id"] == friend["client"], "the friend's dog stays with its own family"
        for r in (mine, theirs):
            assert r["bill_to_client_id"] == payer["client"] and r["group_kind"] == "friends_family"
            assert r["group_id"] == out["group_id"] and r["pricing_snapshot"]["group_dog_count"] == 2
        assert mine["pricing_snapshot"]["group_dog_index"] == 0 and mine["estimated_price"] == 30.0
        assert theirs["pricing_snapshot"]["group_dog_index"] == 1 and theirs["multi_dog_discount"]["pre_applied"]
        assert theirs["estimated_price"] == 15.0, "the multi-dog discount off the payer's rate"
        assert theirs["pricing_snapshot"]["pricing_client_id"] == payer["client"]
        # ...and they leave on one bill, the payer's.
        earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
        for bid in (lone["id"], theirs["id"]):
            run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), OWNER))
            run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": earlier}}))
        for bid in (theirs["id"], lone["id"]):
            run(server.check_out(bid, server.CheckoutIn(use_credits=True), OWNER))
        [bill] = run(server.db.invoices.find({"client_id": payer["client"], "status": {"$ne": "VOID"}}, {"_id": 0}).to_list(5))
        assert bill["total"] == 45.0 and sorted(bill["booking_ids"]) == sorted([lone["id"], theirs["id"]])


def test_a_dog_joins_an_existing_friends_and_family_group_and_every_dog_counts_it():
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        out = _add(made["bookings"][1]["id"], payer["dogs"][1])      # added from the friend's dog's booking
        new = _row(out["booking"]["id"])
        assert new["group_id"] == made["group_id"] and new["bill_to_client_id"] == payer["client"]
        assert new["pricing_snapshot"]["group_dog_index"] == 2 and new["estimated_price"] == 15.0
        for b in made["bookings"]:
            assert _row(b["id"])["pricing_snapshot"]["group_dog_count"] == 3
        assert out["dog_count"] == 3


def test_a_friends_add_on_is_priced_at_the_payers_rate():
    with _families() as (svc, addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        new = _row(_add(lone["id"], friend["dog"], addon_service_ids=[addon])["booking"]["id"])
        assert [a["price"] for a in new["add_ons"]] == [5.0] and new["estimated_price"] == 20.0


def test_the_family_can_add_its_own_dog_and_no_payer_is_recorded():
    with _families() as (svc, _addon, payer, _friend):
        lone = _book_one(svc, payer["dog"])
        new = _row(_add(lone["id"], payer["dogs"][1])["booking"]["id"])
        for r in (_row(lone["id"]), new):
            assert "bill_to_client_id" not in r and "group_kind" not in r
        assert new["group_id"] == _row(lone["id"])["group_id"] and new["estimated_price"] == 15.0


def test_a_friends_family_needs_no_meet_and_greet():
    """Added WITHOUT the admin's override (which has always let an admin past
    the new-client gate): the friend's family is still a prospect."""
    with _families(friend_status="prospect") as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        new = _row(_add(lone["id"], friend["dog"], override_capacity=False)["booking"]["id"])
        assert new["bill_to_client_id"] == payer["client"]


def test_a_family_marked_rejected_is_refused_and_the_booking_is_left_as_it_was():
    with _families(friend_status="rejected") as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        before = _row(lone["id"])
        with pytest.raises(HTTPException) as e:
            _add(lone["id"], friend["dog"], override_capacity=False)
        assert e.value.status_code == 400 and "rejected" in e.value.detail
        assert _row(lone["id"]) == before
        assert run(server.db.bookings.count_documents({"dog_id": friend["dog"]})) == 0


def _gone_home(row):
    run(server.db.bookings.update_one({"id": row["id"]}, {"$set": {"checked_out_at": server.now_iso()}}))


def _cancelled(row):
    run(server.db.bookings.update_one({"id": row["id"]}, {"$set": {"status": "cancelled"}}))


def _training(row):
    run(server.db.bookings.update_one({"id": row["id"]}, {"$set": {"service_type": "training"}}))


def _yesterday(row):
    run(server.db.bookings.update_one({"id": row["id"]}, {"$set": {"date": _day(-1)}}))


@pytest.mark.parametrize("change, status, words", [
    (_gone_home, 409, "gone home"),
    (_cancelled, 409, "cancelled"),
    (_training, 400, "daycare and boarding"),
    (_yesterday, 409, "earlier day"),
])
def test_a_dog_is_only_added_to_a_booking_still_to_come(change, status, words):
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        change(lone)
        with pytest.raises(HTTPException) as e:
            _add(lone["id"], friend["dog"])
        assert e.value.status_code == status and words in e.value.detail
        assert run(server.db.bookings.count_documents({"dog_id": friend["dog"]})) == 0


def test_a_dog_already_on_the_booking_is_not_added_twice():
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        with pytest.raises(HTTPException) as e:
            _add(made["bookings"][0]["id"], friend["dog"])
        assert e.value.status_code == 409 and "already on this booking" in e.value.detail


def test_only_with_the_permission_and_only_while_switched_on(monkeypatch, saved_matrix):
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        for who in (MANAGER, {"id": "c", "role": "client", "client_id": payer["client"]}):
            with pytest.raises(HTTPException) as e:
                _add(lone["id"], friend["dog"], user=who)
            assert e.value.status_code == 403
        monkeypatch.setattr(friends_family, "ENABLED", False)
        with pytest.raises(HTTPException) as e:
            _add(lone["id"], friend["dog"])
        assert e.value.status_code == 400 and "switched on" in e.value.detail
        monkeypatch.setattr(friends_family, "ENABLED", True)
        saved_matrix("manager", {friends_family.PERMISSION: True})
        assert _add(lone["id"], friend["dog"], user=MANAGER)["dog_count"] == 2


def test_a_dog_that_cannot_be_booked_leaves_the_booking_as_it_was():
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        before = _row(lone["id"])
        run(server.db.dogs.update_one({"id": friend["dog"]}, {"$set": {"vaccines": {"rabies": "2020-01-01"}}}))
        with pytest.raises(HTTPException):
            _add(lone["id"], friend["dog"], override_vaccines=False)
        assert _row(lone["id"]) == before
        assert run(server.db.bookings.count_documents({"dog_id": friend["dog"]})) == 0


class _FlakyBookings:
    """The bookings collection, failing when the given booking is updated as a
    dog already on the booking (the part of an add after the new dog is made)."""

    def __init__(self, real, fail_id):
        self._real, self._fail = real, fail_id

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def update_one(self, flt, update, *args, **kwargs):
        sets = update.get("$set") or {}
        if flt.get("id") == self._fail and "group_id" in sets and "estimated_price" not in sets:
            raise RuntimeError("the database went away")
        return await self._real.update_one(flt, update, *args, **kwargs)


class _FlakyDb:
    def __init__(self, real, fail_id):
        self._real, self.bookings = real, _FlakyBookings(real.bookings, fail_id)

    def __getattr__(self, name):
        return getattr(self._real, name)

    def __getitem__(self, name):
        return self._real[name]


def test_a_failed_add_takes_the_new_dog_back_and_puts_the_dogs_already_booked_back_exactly():
    """It fails part-way through updating the dogs already booked (the first
    of them updated, the second not): the new dog's booking is removed and
    both dogs already on the booking are exactly as they were."""
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        first, second = sorted(made["bookings"], key=lambda b: b["pricing_snapshot"]["group_dog_index"])
        before = {b["id"]: _row(b["id"]) for b in made["bookings"]}
        real_db = server.db
        server.db = _FlakyDb(real_db, second["id"])
        try:
            with pytest.raises(RuntimeError):
                _add(first["id"], payer["dogs"][1])
        finally:
            server.db = real_db
        assert {b["id"]: _row(b["id"]) for b in made["bookings"]} == before
        assert run(server.db.bookings.count_documents({"dog_id": payer["dogs"][1]})) == 0


@contextlib.contextmanager
def _boarding():
    board = {"id": str(uuid.uuid4()), "name": f"{TAG} Boarding", "service_type": "boarding", "base_price": 50.0, "active": True}
    run(server.db.services.insert_one(dict(board)))
    try:
        yield board["id"]
    finally:
        run(server.db.services.delete_one({"id": board["id"]}))


def _book_stay(board, dog_id, first, last):
    made = run(server.create_booking(server.BookingIn(
        dog_id=dog_id, date=_day(), end_date=_day(last - first), service_type="boarding", service_id=board,
        override_capacity=True, override_vaccines=True), OWNER))
    run(server.db.bookings.update_one({"id": made["id"]}, {"$set": {"date": _day(first), "end_date": _day(last)}}))
    return made


def test_a_dog_joining_a_stay_already_under_way_starts_today_and_pays_only_its_nights():
    """The payer's dog has boarded since two days ago and leaves in two days;
    the friend's dog joins today: two nights at $50, the extra-dog half."""
    with _families() as (_svc, _addon, payer, friend), _boarding() as board:
        stay = _book_stay(board, payer["dog"], -2, 2)
        _arrived(stay["id"])
        new = _row(_add(stay["id"], friend["dog"])["booking"]["id"])
        assert (new["date"], new["end_date"]) == (_day(), _day(2))
        assert new["pricing_snapshot"]["billable_units"] == 2 and new["estimated_price"] == 50.0


def test_no_dog_joins_a_stay_whose_last_night_has_passed():
    with _families() as (_svc, _addon, payer, friend), _boarding() as board:
        stay = _book_stay(board, payer["dog"], -2, 0)
        with pytest.raises(HTTPException) as e:
            _add(stay["id"], friend["dog"])
        assert e.value.status_code == 409 and "No nights are left" in e.value.detail


def test_a_checkout_tried_while_a_dog_is_being_added_waits_and_the_add_is_kept(monkeypatch):
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        _arrived(lone["id"])
        real, tried = server.create_booking, {}

        async def a_checkout_meanwhile(sub, user):
            try:
                await server.check_out(lone["id"], server.CheckoutIn(
                    use_credits=True, payment_method="check", payment_status="paid"), OWNER)
                tried["went through"] = True
            except HTTPException as e:
                tried["refused"] = e.status_code
            return await real(sub, user)
        monkeypatch.setattr(server, "create_booking", a_checkout_meanwhile)
        _add(lone["id"], friend["dog"])
        assert tried == {"refused": 409}
        row = _row(lone["id"])
        assert row["status"] != "completed" and row["bill_to_client_id"] == payer["client"] and row["group_id"]
        assert not row.get("checkout_in_progress"), "let go once the dog is added"


def test_a_dog_cancelled_while_another_is_being_added_stops_the_add_and_nothing_else_changes(monkeypatch):
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        mine = next(b for b in made["bookings"] if b["dog_id"] == payer["dog"])
        theirs = next(b for b in made["bookings"] if b["dog_id"] == friend["dog"])
        before = _row(mine["id"])
        real = server.create_booking

        async def cancelled_meanwhile(sub, user):
            await server.db.bookings.update_one({"id": theirs["id"]}, {"$set": {"status": "cancelled"}})
            return await real(sub, user)
        monkeypatch.setattr(server, "create_booking", cancelled_meanwhile)
        with pytest.raises(HTTPException) as e:
            _add(mine["id"], payer["dogs"][1])
        assert e.value.status_code == 409 and "just changed" in e.value.detail
        assert _row(mine["id"]) == before
        assert run(server.db.bookings.count_documents({"dog_id": payer["dogs"][1]})) == 0


def test_the_add_changes_only_its_own_fields_on_the_dogs_already_booked(monkeypatch):
    """Something else saved on the booking's price record while the dog was
    being added (a checkout re-pricing it, say) is kept."""
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        real = server.create_booking

        async def saved_meanwhile(sub, user):
            await server.db.bookings.update_one({"id": lone["id"]}, {"$set": {"pricing_snapshot.saved_meanwhile": True}})
            return await real(sub, user)
        monkeypatch.setattr(server, "create_booking", saved_meanwhile)
        _add(lone["id"], friend["dog"])
        ps = _row(lone["id"])["pricing_snapshot"]
        assert ps.get("saved_meanwhile") is True and ps["group_dog_count"] == 2


def test_taking_the_friends_dog_back_out_makes_it_the_familys_own_booking_again():
    with _families() as (svc, _addon, payer, friend):
        lone = _book_one(svc, payer["dog"])
        out = _add(lone["id"], friend["dog"])
        run(server.cancel_booking(out["booking"]["id"], forfeit=False, user=OWNER))
        row = _row(lone["id"])
        assert "bill_to_client_id" not in row and "group_kind" not in row
        assert row["pricing_snapshot"]["group_dog_count"] == 1
        _arrived(lone["id"])   # ...and it is paid for at the desk again
        run(server.check_out(lone["id"], server.CheckoutIn(use_credits=True, payment_method="check", payment_status="paid"), OWNER))
        assert _row(lone["id"])["status"] == "completed"


def test_once_a_dog_has_gone_home_the_rest_stay_on_the_groups_one_bill_when_the_friends_dog_is_taken_out():
    """The payer's two dogs and a friend's: one of the payer's dogs has gone
    home (waiting for the group's bill) when the friend's dog is taken out —
    the payer's other dog stays on that one bill."""
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], payer["dogs"][1], friend["dog"]], payer["client"])
        first, second, theirs = (next(b for b in made["bookings"] if b["dog_id"] == d)
                                 for d in (payer["dog"], payer["dogs"][1], friend["dog"]))
        _arrived(first["id"])
        run(server.check_out(first["id"], server.CheckoutIn(use_credits=True), OWNER))
        run(server.cancel_booking(theirs["id"], forfeit=False, user=OWNER))
        for b in (first, second):
            assert _row(b["id"])["bill_to_client_id"] == payer["client"]
        _arrived(second["id"])
        run(server.check_out(second["id"], server.CheckoutIn(use_credits=True), OWNER))
        [bill] = run(server.db.invoices.find({"client_id": payer["client"], "status": {"$ne": "VOID"}}, {"_id": 0}).to_list(5))
        assert sorted(bill["booking_ids"]) == sorted([first["id"], second["id"]])


def test_a_dog_cannot_be_cancelled_while_another_is_being_added(monkeypatch):
    """Adding a dog holds the paying family's money, as a cancel does: the
    cancel waits (refused, try again) instead of landing half-way through."""
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        mine = next(b for b in made["bookings"] if b["dog_id"] == payer["dog"])
        theirs = next(b for b in made["bookings"] if b["dog_id"] == friend["dog"])
        real, tried = server.create_booking, {}

        async def a_cancel_meanwhile(sub, user):
            try:
                await server.cancel_booking(theirs["id"], forfeit=False, user=OWNER)
                tried["went through"] = True
            except HTTPException as e:
                tried["refused"] = e.status_code
            return await real(sub, user)
        monkeypatch.setattr(server, "create_booking", a_cancel_meanwhile)
        assert _add(mine["id"], payer["dogs"][1])["dog_count"] == 3
        assert tried == {"refused": 409}
        assert _row(theirs["id"])["status"] == "approved"


def test_taking_the_friends_dog_out_leaves_the_booking_alone_while_one_of_its_dogs_is_being_checked_out():
    with _families() as (svc, _addon, payer, friend):
        made = _book_group(svc, [payer["dog"], friend["dog"]], payer["client"])
        mine = next(b for b in made["bookings"] if b["dog_id"] == payer["dog"])
        theirs = next(b for b in made["bookings"] if b["dog_id"] == friend["dog"])
        run(server.db.bookings.update_one({"id": mine["id"]}, {"$set": {
            "checkout_in_progress": True, "checkout_operation_id": "a-checkout", "checkout_started_at": server.now_iso()}}))
        run(server.cancel_booking(theirs["id"], forfeit=False, user=OWNER))
        row = _row(mine["id"])
        assert row["bill_to_client_id"] == payer["client"] and row["checkout_operation_id"] == "a-checkout"


class _ChangedJustAfterReading:
    """The bookings collection: right after a checkout reads whether a visit
    is friends & family, a dog is added to its booking (the payer recorded)."""

    def __init__(self, real, booking_id, payer_id):
        self._real, self._id, self._payer = real, booking_id, payer_id

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def find_one(self, flt, projection=None, *args, **kwargs):
        got = await self._real.find_one(flt, projection, *args, **kwargs)
        if flt == {"id": self._id} and projection == {"_id": 0, "bill_to_client_id": 1}:
            await self._real.update_one({"id": self._id}, {"$set": {"bill_to_client_id": self._payer}})
        return got


def test_a_checkout_goes_ahead_only_if_the_booking_is_still_as_it_was_read():
    with _families() as (svc, _addon, payer, _friend):
        lone = _book_one(svc, payer["dog"])
        _arrived(lone["id"])
        real_db = server.db
        server.db = _FlakyDb(real_db, None)
        server.db.bookings = _ChangedJustAfterReading(real_db.bookings, lone["id"], payer["client"])
        try:
            with pytest.raises(HTTPException) as e:
                run(server.check_out(lone["id"], server.CheckoutIn(use_credits=True, payment_method="check", payment_status="paid"), OWNER))
        finally:
            server.db = real_db
        assert e.value.status_code == 409 and "just changed" in e.value.detail
        row = _row(lone["id"])
        assert row["status"] != "completed" and not row.get("checkout_in_progress")


def test_a_dog_that_joined_a_stay_under_way_leaves_with_its_group():
    with _families() as (_svc, _addon, payer, friend), _boarding() as board:
        stay = _book_stay(board, payer["dog"], -2, 2)
        _arrived(stay["id"])
        new = _add(stay["id"], friend["dog"])["booking"]
        _arrived(new["id"])
        run(server.db.bookings.update_many({"id": {"$in": [stay["id"], new["id"]]}}, {"$set": {"end_date": _day()}}))   # leaving day
        anchor = _row(stay["id"])
        assert sorted(r["id"] for r in run(server._active_household_checkout_rows(anchor))) == sorted([stay["id"], new["id"]])


def test_a_familys_combined_checkout_never_takes_a_dog_that_just_joined_a_friends_and_family_booking(monkeypatch):
    """The family's two dogs are checked out together; right after the list
    of dogs is read, one of them is put on a friends & family booking. The
    combined checkout stops rather than check it out the family's own way."""
    with _families() as (svc, _addon, payer, _friend):
        one, two = (_book_one(svc, d) for d in payer["dogs"])
        for b in (one, two):
            _arrived(b["id"])
        real = server._active_household_checkout_rows

        async def changed_right_after(anchor):
            rows = await real(anchor)
            await server.db.bookings.update_one({"id": two["id"]}, {"$set": {"bill_to_client_id": payer["client"]}})
            return rows
        monkeypatch.setattr(server, "_active_household_checkout_rows", changed_right_after)
        with pytest.raises(HTTPException) as e:
            run(server.check_out_group(one["id"], server.CheckoutIn(use_credits=True, payment_method="check", payment_status="paid"), OWNER))
        assert e.value.status_code == 409
        for b in (one, two):
            row = _row(b["id"])
            assert row["status"] != "completed" and not row.get("checkout_in_progress")
