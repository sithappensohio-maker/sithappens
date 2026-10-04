"""Friends & family: what the screens are told (build step 9; owner request
2026-09-28).

The switch comes to the screens with the signed-in person's permissions (the
owner passes every permission check, so it can't be one); a single checkout
that made the group's one bill says so; the calendar and the front-desk roster
say who pays; a family's page lists the dogs it pays for and whether any are
waiting for their bill; and a friend's dog added from the booking screen can
come with its vaccine dates.

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
from domains.bookings import friends_family
from matrix_support import saved_matrix  # noqa: F401 — the fixture is a test argument

TAG = "TEST_FF_SCREENS"
OWNER = {"id": "ffs-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner", "email": "owner@example.com"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _today():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _group():
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    fams = {}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "account_balance": 0.0}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did}
    payer, friend = fams["payer"], fams["friend"]
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=_today(), service_type="daycare", service_id=svc["id"], override_capacity=True,
                                 override_vaccines=True, payer_client_id=payer["client"])
    out = run(server.create_booking_group(body, OWNER))
    rows = {r["dog_id"]: r for r in out["bookings"]}
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    for f in fams.values():
        f["booking"] = rows[f["dog"]]["id"]
        run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
        run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": earlier}}))
    try:
        yield payer, friend, out["group_id"]
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _out(booking_id):
    return run(server.check_out(booking_id, server.CheckoutIn(use_credits=True), OWNER))


def test_the_switch_reaches_the_screens_with_the_permissions(monkeypatch):
    assert run(server.my_permissions(user=OWNER))["features"] == {"friends_family": True}
    monkeypatch.setattr(friends_family, "ENABLED", False)
    assert run(server.my_permissions(user=OWNER))["features"] == {"friends_family": False}


def test_a_single_checkout_that_made_the_one_bill_says_so_over_http():
    """(The checkout's response is shaped by BookingOut: a field it doesn't
    declare never reaches the screen.)"""
    with _group() as (payer, friend, _gid):
        first = server.BookingOut(**_out(friend["booking"]))
        assert first.group_bill is None and first.group_bill_pending is True
        last = server.BookingOut(**_out(payer["booking"]))
        assert last.group_bill["total"] == 60.0 and last.group_bill["client_id"] == payer["client"]


def test_the_calendar_and_the_front_desk_roster_say_who_pays():
    with _group() as (payer, friend, _gid):
        events = run(server.calendar_events(OWNER, start=_today(), end=_today()))
        mine = next(e for e in events if e["id"] == friend["booking"])["extendedProps"]
        assert mine["bill_to_client_id"] == payer["client"] and mine["group_kind"] == "friends_family"
        roster = run(server.employee_roster_today(user=OWNER))["roster"]
        row = next(r for r in roster if r["booking_id"] == friend["booking"])
        assert row["bill_to_client_name"].endswith("payer") and row["client_id"] == friend["client"]


def test_a_familys_page_lists_the_dogs_it_pays_for_and_what_is_waiting():
    route = next(r for r in server.app.routes if getattr(r, "path", "").endswith("/clients/{client_id}/friends-family"))
    with _group() as (payer, friend, gid):
        got = run(route.endpoint(payer["client"], user=OWNER))
        [group] = got["groups"]
        assert group["group_id"] == gid and {d["dog_id"] for d in group["dogs"]} == {payer["dog"], friend["dog"]}
        assert got["waiting_for_bill"] is False and group["waiting"] is False
        _out(friend["booking"])
        got = run(route.endpoint(payer["client"], user=OWNER))
        assert got["waiting_for_bill"] is True and got["groups"][0]["waiting"] is True
        assert run(route.endpoint(friend["client"], user=OWNER))["groups"] == [], "the friend's family pays for nothing"


def test_a_friends_dog_added_on_the_spot_can_bring_its_vaccine_dates():
    made = run(server.create_walk_in(server.WalkInIn(
        owner_name=f"{TAG} Sam", dog_name=f"{TAG} Rex", vaccines={"rabies": "2031-05-01", "dhpp": "", "bordetella": "2030-02-02"}),
        user=OWNER))
    try:
        assert made["dog"]["vaccines"] == {"rabies": "2031-05-01", "bordetella": "2030-02-02"}
        with pytest.raises(HTTPException) as e:
            run(server.create_walk_in(server.WalkInIn(owner_name=f"{TAG} X", dog_name="Y", vaccines={"rabies": "soon"}), user=OWNER))
        assert e.value.status_code == 422
        walk_in = run(server.create_walk_in(server.WalkInIn(owner_name=f"{TAG} W", dog_name="Z"), user=OWNER))
        assert walk_in["dog"]["vaccines"] == {}, "a walk-in hands in no paperwork"
    finally:
        run(server.db.dogs.delete_many({"name": {"$regex": f"^{TAG}|^Y$|^Z$"}, "owner_id": {"$exists": True}}))
        run(server.db.clients.delete_many({"name": {"$regex": f"^{TAG}"}}))


# ------------------------------------------------------------- review fixes

MANAGER = {"id": "ffs-manager", "role": "admin", "staff_role": "manager", "name": "Mo Manager", "email": "mo@example.com"}


@pytest.fixture
def _no_pricing(monkeypatch, saved_matrix):
    """A manager who takes payments and edits clients, but may not set a price
    or write a dog's vaccine record."""
    saved_matrix("manager",
                        {"take_payments": True, "pricing": False, "clients_edit": True, "dogs_edit": False})


def test_a_checkout_built_for_the_other_kind_of_booking_is_refused():
    """The screen read a friends & family booking; a dog was taken out since and
    it became the family's own (or the other way round): refused, never run the
    wrong way."""
    with _group() as (payer, friend, _gid):
        for call in (server.check_out, server.check_out_group):
            with pytest.raises(HTTPException) as e:
                run(call(friend["booking"], server.CheckoutIn(use_credits=True, expect_friends_family=False), OWNER))
            assert e.value.status_code == 409 and "just changed" in e.value.detail
        assert run(server.db.bookings.find_one({"id": friend["booking"]}))["status"] != "completed"
        # a screen that says nothing still checks out (older screens)
        assert _out(friend["booking"])["status"] == "completed"


def test_a_price_override_without_the_permission_is_refused_before_any_dog_leaves(_no_pricing):
    with _group() as (payer, friend, _gid):
        with pytest.raises(HTTPException) as e:
            run(server.check_out_group(friend["booking"], server.CheckoutIn(use_credits=True, base_price=10.0,
                                                                            base_price_reason="friend"), MANAGER))
        assert e.value.status_code == 403
        for f in (payer, friend):
            assert run(server.db.bookings.find_one({"id": f["booking"]}))["status"] != "completed"


def test_the_servers_own_early_checkout_price_needs_no_pricing_permission(_no_pricing):
    board = {"id": str(uuid.uuid4()), "name": f"{TAG} Boarding", "service_type": "boarding", "base_price": 50.0, "active": True}
    run(server.db.services.insert_one(dict(board)))
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} early", "client_status": "active", "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} early dog", "owner_id": cid, "vaccines": dict(VAX)}))
    try:
        today = server.business_today()
        made = run(server.create_booking(server.BookingIn(
            dog_id=did, date=_today(), end_date=(today + timedelta(days=4)).isoformat(), service_type="boarding",
            service_id=board["id"], override_capacity=True, override_vaccines=True), OWNER))
        run(server.db.bookings.update_one({"id": made["id"]}, {"$set": {
            "date": (today - timedelta(days=2)).isoformat(), "end_date": (today + timedelta(days=2)).isoformat(),
            "checked_in_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(), "status": "approved"}}))
        quote = run(server.early_checkout_quote(made["id"], MANAGER))
        assert quote["applicable"]
        ok = server.CheckoutIn(base_price=quote["base_price"])
        assert run(server._is_early_checkout_price(made["id"], ok, MANAGER)) is True
        other = server.CheckoutIn(base_price=float(quote["base_price"]) + 5)
        assert run(server._is_early_checkout_price(made["id"], other, MANAGER)) is False
        reasoned = server.CheckoutIn(base_price=quote["base_price"], base_price_reason="loyalty")
        assert run(server._is_early_checkout_price(made["id"], reasoned, MANAGER)) is False
        # ...and the checkout itself goes through with it
        with pytest.raises(HTTPException) as e:
            run(server.check_out(made["id"], server.CheckoutIn(use_credits=False, base_price=float(quote["base_price"]) + 5,
                                                               payment_method="check", payment_status="paid"), MANAGER))
        assert e.value.status_code == 403
        done = run(server.check_out(made["id"], server.CheckoutIn(use_credits=False, base_price=quote["base_price"],
                                                                  payment_method="check", payment_status="paid"), MANAGER))
        assert done["status"] == "completed" and done["actual_price"] == quote["base_price"]
    finally:
        for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.bookings.delete_many({"dog_id": did}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.services.delete_one({"id": board["id"]}))


def test_vaccine_dates_on_a_quick_added_dog_need_the_dog_permission(_no_pricing):
    try:
        with pytest.raises(HTTPException) as e:
            run(server.create_walk_in(server.WalkInIn(owner_name=f"{TAG} Vic", dog_name=f"{TAG} Vee",
                                                      vaccines={"rabies": "2031-01-01"}), user=MANAGER))
        assert e.value.status_code == 403
        assert run(server.create_walk_in(server.WalkInIn(owner_name=f"{TAG} Vic", dog_name=f"{TAG} Vee"), user=MANAGER))["dog"]
    finally:
        run(server.db.dogs.delete_many({"name": f"{TAG} Vee"}))
        run(server.db.clients.delete_many({"name": f"{TAG} Vic"}))


def test_a_familys_page_lists_whole_bookings_and_always_the_one_waiting_for_its_bill():
    route = next(r for r in server.app.routes if getattr(r, "path", "").endswith("/clients/{client_id}/friends-family"))
    with _group() as (payer, friend, gid):
        _out(friend["booking"])     # waiting for its bill (the payer's dog is still here)
        later = (server.business_today() + timedelta(days=30)).isoformat()
        run(server.db.bookings.insert_many([{
            "id": f"{TAG}-bulk-{i}", "group_id": f"{TAG}-bulk-g{i}", "client_id": payer["client"], "dog_id": f"{TAG}-bulk-d{i}",
            "dog_name": "Bulk", "client_name": "Pat", "bill_to_client_id": payer["client"], "service_type": "daycare",
            "date": later, "status": "approved"} for i in range(205)]))
        got = run(route.endpoint(payer["client"], user=OWNER))
        mine = next(g for g in got["groups"] if g["group_id"] == gid)
        assert mine["waiting"] is True and {d["dog_id"] for d in mine["dogs"]} == {payer["dog"], friend["dog"]}
