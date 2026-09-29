"""One rule for every price at checkout (audit #23, owner's choice A, 2026-09-29).

Only staff with the pricing permission change a price at checkout — the visit
price, an extra amount on top, the per-night rate for extra nights, an
add-on's price — whether one dog leaves or a household leaves together
(friends & family included). Everyone else checks out at the normal price;
a changed price is refused before any dog leaves. The owner, and staff given
the permission, are unaffected.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import checkout_prices, friends_family

TAG = "TEST_CHECKOUT_PRICES"
OWNER = {"id": "cp-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
DESK = {"id": "cp-desk", "role": "admin", "staff_role": "front_desk", "name": "Dee Desk", "display_name": "Dee Desk"}
MANAGER = {"id": "cp-manager", "role": "admin", "staff_role": "manager", "name": "Mo Manager", "display_name": "Mo Manager"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _roles(monkeypatch):
    """The front desk takes payments but may not set prices; the manager may."""
    monkeypatch.setitem(server._ROLE_OVERRIDES, "front_desk", {"take_payments": True, "pricing": False})
    monkeypatch.setitem(server._ROLE_OVERRIDES, "manager", {"take_payments": True, "pricing": True})
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _day(off=0):
    return (server.business_today() + timedelta(days=off)).isoformat()


@contextlib.contextmanager
def _catalogue():
    """Daycare $40, boarding $50/night, a $20 bath (this family's own rate: $15)."""
    ids = {k: f"{TAG}-{k}-{uuid.uuid4().hex[:6]}" for k in ("daycare", "boarding", "bath")}
    run(server.db.services.insert_many([
        {"id": ids["daycare"], "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True},
        {"id": ids["boarding"], "name": f"{TAG} Boarding", "service_type": "boarding", "base_price": 50.0, "active": True},
        {"id": ids["bath"], "name": f"{TAG} Bath", "service_type": "grooming", "base_price": 20.0, "active": True,
         "is_addon": True, "addon_for": ["daycare", "boarding"]},
    ]))
    try:
        yield ids
    finally:
        run(server.db.services.delete_many({"id": {"$in": list(ids.values())}}))


@contextlib.contextmanager
def _family(svc, dogs=1, name="family", bath_rate=15.0):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {name}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "account_balance": 0.0}))
    run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": cid, "target_kind": "service",
                                              "target_code": svc["bath"], "override_price": bath_rate, "status": "active",
                                              "created_at": server.now_iso()}))
    dog_ids = [str(uuid.uuid4()) for _ in range(dogs)]
    for i, did in enumerate(dog_ids):
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {name} dog {i}", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
    try:
        yield cid, dog_ids
    finally:
        for coll in ("bookings", "invoices", "payments", "payment_ledger", "checkout_groups"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.bookings.delete_many({"dog_id": {"$in": dog_ids}}))
        run(server.db.dogs.delete_many({"id": {"$in": dog_ids}}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.price_overrides.delete_many({"client_id": cid}))


def _arrive(booking_id):
    run(server.check_in(booking_id, server.CheckInIn(vaccine_ack=True), OWNER))
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    run(server.db.bookings.update_one({"id": booking_id}, {"$set": {"checked_in_at": earlier}}))


def _daycare(svc, dog_id):
    made = run(server.create_booking(server.BookingIn(dog_id=dog_id, date=_day(), service_type="daycare", service_id=svc["daycare"],
                                                      override_capacity=True, override_vaccines=True), OWNER))
    _arrive(made["id"])
    return made["id"]


def _stay(svc, dog_id):
    """A boarding stay that began two days ago and ends today."""
    made = run(server.create_booking(server.BookingIn(dog_id=dog_id, date=_day(), end_date=_day(2), service_type="boarding",
                                                      service_id=svc["boarding"], override_capacity=True,
                                                      override_vaccines=True), OWNER))
    run(server.db.bookings.update_one({"id": made["id"]}, {"$set": {
        "date": _day(-2), "end_date": _day(), "status": "approved",
        "checked_in_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}}))
    return made["id"]


def _group(svc, dog_ids, payer=None):
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=d) for d in dog_ids], date=_day(), service_type="daycare",
                                 service_id=svc["daycare"], override_capacity=True, override_vaccines=True,
                                 payer_client_id=payer)
    out = run(server.create_booking_group(body, OWNER))
    ids = [r["id"] for r in out["bookings"]]
    for bid in ids:
        _arrive(bid)
    return ids


def _paid(**extra):
    return server.CheckoutIn(use_credits=False, payment_method="check", payment_status="paid", **extra)


def _bath(svc, price, qty=1):
    return [server.CheckoutAddOn(service_id=svc["bath"], name="Bath", price=price, qty=qty)]


def _refused(call, booking_id, body, user=DESK):
    with pytest.raises(HTTPException) as e:
        run(call(booking_id, body, user))
    return e.value


def _status(booking_id):
    return run(server.db.bookings.find_one({"id": booking_id}, {"_id": 0, "status": 1}))["status"]


# ---------------------------------------------------------------- one dog

# A changed price of each kind, and the refusal it gets.
CHANGED = {
    "visit price": (lambda svc: _paid(base_price=10.0, base_price_reason="regular"), checkout_prices.MSG_PRICE),
    "extra amount": (lambda svc: server.CheckoutIn(use_credits=True, additional_cash_charge=5.0), checkout_prices.MSG_EXTRA),
    "night rate": (lambda svc: _paid(extra_nights_rate=10.0), checkout_prices.MSG_NIGHT_RATE),
}


def _addon_lines(booking_id):
    row = run(server.db.bookings.find_one({"id": booking_id}, {"_id": 0, "add_ons": 1}))
    return [(a["name"], a["price"], a["qty"]) for a in row.get("add_ons") or [] if a.get("added_stage") == "checkout"]


@pytest.mark.parametrize("kind", list(CHANGED))
def test_without_the_pricing_permission_a_changed_price_is_refused_and_the_dog_stays(kind):
    make, message = CHANGED[kind]
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        e = _refused(server.check_out, bid, make(svc))
        assert (e.status_code, e.detail) == (403, message)
        assert _status(bid) != "completed"


def test_without_the_pricing_permission_an_add_on_is_sold_at_its_catalogue_price():
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        done = run(server.check_out(bid, _paid(add_ons=_bath(svc, 20.0, qty=2)), DESK))   # the catalogue price (what the screen sends)
        assert done["status"] == "completed" and done["actual_price"] == 80.0


def _price_now(name, price):
    return checkout_prices.MSG_ADDON_PRICE.format(name=f"{TAG} {name}", price=price)


def test_without_the_pricing_permission_any_other_add_on_price_is_refused_with_the_price_it_is_now():
    """Nobody types an add-on price on the screen: a different one is a hand-made
    request, or a screen showing a price from before the owner changed it.
    Refused either way (never charged differently from what the screen
    showed, which would record money nobody took)."""
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        e = _refused(server.check_out, bid, _paid(add_ons=_bath(svc, 1.0)))
        assert (e.status_code, e.detail) == (409, _price_now("Bath", 20))
        run(server.db.services.update_one({"id": svc["bath"]}, {"$set": {"base_price": 25.0}}))   # the owner raised it
        e = _refused(server.check_out, bid, _paid(add_ons=_bath(svc, 20.0)))
        assert (e.status_code, e.detail) == (409, _price_now("Bath", 25))
        assert e.detail == "The price of TEST_CHECKOUT_PRICES Bath is now $25.00. Check the total and press Complete again."
        assert _status(bid) != "completed"
        done = run(server.check_out(bid, _paid(add_ons=_bath(svc, 25.0)), DESK))
        assert done["status"] == "completed" and done["actual_price"] == 65.0


def test_the_familys_own_add_on_rate_is_a_normal_price_too():
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        done = run(server.check_out(bid, _paid(add_ons=_bath(svc, 15.0)), DESK))
        assert done["status"] == "completed" and done["actual_price"] == 55.0


def test_an_add_on_that_isnt_offered_is_refused_for_staff_without_the_pricing_permission():
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        run(server.db.services.update_one({"id": svc["bath"]}, {"$set": {"active": False}}))
        e = _refused(server.check_out, bid, _paid(add_ons=_bath(svc, 20.0)))
        assert (e.status_code, e.detail) == (400, checkout_prices.MSG_ADDON_GONE)
        e = _refused(server.check_out, bid, _paid(add_ons=[server.CheckoutAddOn(service_id="no-such-thing", name="x", price=5)]))
        assert e.status_code == 400
        assert _status(bid) != "completed"


def test_the_extra_night_rate_is_the_normal_one_for_staff_without_the_permission():
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _stay(svc, dogs[0])
        e = _refused(server.check_out, bid, _paid(extra_nights=1, extra_nights_use_credits=False, extra_nights_rate=10.0))
        assert (e.status_code, e.detail) == (403, checkout_prices.MSG_NIGHT_RATE)
        assert _status(bid) != "completed"
        done = run(server.check_out(bid, _paid(extra_nights=1, extra_nights_use_credits=False), DESK))
        assert done["status"] == "completed"
        assert done["extra_nights"]["rate_source"] != "manual_override" and done["extra_nights"]["per_night_rate"] == 50.0


# ---------------------------------------------------------- household together

@pytest.mark.parametrize("kind", list(CHANGED))
def test_a_household_leaving_together_follows_the_same_rule_before_any_dog_leaves(kind):
    make, message = CHANGED[kind]
    with _catalogue() as svc, _family(svc, dogs=2) as (_cid, dogs):
        ids = _group(svc, dogs)
        for clicked in ids:   # whichever dog's button
            e = _refused(server.check_out_group, clicked, make(svc))
            assert (e.status_code, e.detail) == (403, message)
            assert all(_status(b) != "completed" for b in ids)


def test_a_household_leaving_together_is_refused_an_add_on_at_another_price_before_any_dog_leaves():
    with _catalogue() as svc, _family(svc, dogs=2) as (_cid, dogs):
        ids = _group(svc, dogs)
        for clicked in ids:
            e = _refused(server.check_out_group, clicked, _paid(add_ons=_bath(svc, 1.0)))
            assert (e.status_code, e.detail) == (409, _price_now("Bath", 20))
            assert all(_status(b) != "completed" for b in ids)
        run(server.check_out_group(ids[1], _paid(add_ons=_bath(svc, 20.0)), DESK))
        assert all(_status(b) == "completed" for b in ids)
        assert _addon_lines(ids[1]) == [("Bath", 20.0, 1)] and _addon_lines(ids[0]) == []


def test_a_friends_and_family_group_leaving_together_follows_the_same_rule_before_any_dog_leaves():
    with _catalogue() as svc, _family(svc, name="payer") as (payer, payer_dogs), _family(svc, name="friend") as (_f, friend_dogs):
        ids = _group(svc, [payer_dogs[0], friend_dogs[0]], payer=payer)
        for make, message in CHANGED.values():
            for clicked in ids:   # whichever dog's button, and whichever dog would leave first
                body = make(svc).model_copy(update={"payment_method": None, "payment_status": None})
                e = _refused(server.check_out_group, clicked, body)
                assert (e.status_code, e.detail) == (403, message)
                assert all(_status(b) != "completed" for b in ids)
        for clicked in ids:
            e = _refused(server.check_out_group, clicked, server.CheckoutIn(use_credits=False, add_ons=_bath(svc, 1.0)))
            assert (e.status_code, e.detail) == (409, _price_now("Bath", 20))
            assert all(_status(b) != "completed" for b in ids)


def test_on_a_friends_and_family_booking_the_familys_own_rate_is_the_paying_familys():
    with _catalogue() as svc, _family(svc, name="payer") as (payer, payer_dogs), \
            _family(svc, name="friend", bath_rate=12.0) as (_f, friend_dogs):
        _group(svc, [payer_dogs[0], friend_dogs[0]], payer=payer)
        friends_dog = run(server.db.bookings.find_one({"dog_id": friend_dogs[0]}, {"_id": 0, "id": 1}))["id"]
        e = _refused(server.check_out, friends_dog, server.CheckoutIn(use_credits=False, add_ons=_bath(svc, 12.0)))
        assert (e.status_code, e.detail) == (409, _price_now("Bath", 20))            # the friend's own rate is not this bill's
        run(server.check_out(friends_dog, server.CheckoutIn(use_credits=False, add_ons=_bath(svc, 15.0)), DESK))
        assert _addon_lines(friends_dog) == [("Bath", 15.0, 1)]              # the payer's rate


# -------------------------------------------------------- who may change prices

def test_the_owner_and_staff_given_the_pricing_permission_change_prices_as_before():
    with _catalogue() as svc, _family(svc, dogs=2) as (_cid, dogs):
        one = _daycare(svc, dogs[0])
        done = run(server.check_out(one, _paid(base_price=33.0, base_price_reason="loyal", add_ons=_bath(svc, 1.0)), MANAGER))
        assert done["actual_price"] == 34.0
        stay = _stay(svc, dogs[1])
        done = run(server.check_out(stay, _paid(extra_nights=1, extra_nights_use_credits=False, extra_nights_rate=10.0), OWNER))
        assert done["extra_nights"]["rate_source"] == "manual_override" and done["extra_nights"]["per_night_rate"] == 10.0


def test_the_owner_may_still_sell_an_add_on_that_is_not_in_the_catalogue():
    """(Older checkouts and tests sell a service by id at a typed price.)"""
    with _catalogue() as svc, _family(svc) as (_cid, dogs):
        bid = _daycare(svc, dogs[0])
        done = run(server.check_out(bid, _paid(add_ons=[server.CheckoutAddOn(service_id="gone", name="Nail trim", price=7.5)]), OWNER))
        assert done["actual_price"] == 47.5


def test_a_visit_price_is_never_below_zero():
    with pytest.raises(ValidationError):
        server.CheckoutIn(base_price=-5)
