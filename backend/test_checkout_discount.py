"""The one-time discount at checkout works again (restored 2026-09-29).

The checkout screen offered it all along, but since f690a86 (2026-07-17) the
server ignored it: the visit was recorded at its full price as if all of it
had been paid. Now it comes off the money due for the stay, after every
other price step, and everything downstream (the money recorded, the tab,
the bill, cash revenue) sees the discounted amount. Only staff with the
pricing permission give one; credits are never discounted; it stops at what
is due (a comp), never refused for being too large; never on a friends &
family visit.

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
from domains.bookings import checkout_discount, checkout_prices, friends_family, reopen

TAG = "TEST_CHECKOUT_DISCOUNT"
OWNER = {"id": "cd-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
DESK = {"id": "cd-desk", "role": "admin", "staff_role": "front_desk", "name": "Dee Desk", "display_name": "Dee Desk"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    monkeypatch.setitem(server._ROLE_OVERRIDES, "front_desk", {"take_payments": True, "pricing": False})
    monkeypatch.setattr(friends_family, "ENABLED", True)
    marker = f"{TAG}-{uuid.uuid4()}"
    day = server.business_today().isoformat()
    before = run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day}, {"$setOnInsert": {"date": day, "opening_cash": 0.0, "opened_at": server.now_iso(),
                                         "opened_by": marker, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    if before is None:
        run(server.db.cash_drawer_sessions.delete_one({"date": day, "opened_by": marker}))


def _day():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _daycare(price=40.0):
    sid = f"{TAG}-daycare-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare",
                                       "base_price": price, "active": True, "is_default": True}))
    try:
        yield sid
    finally:
        run(server.db.services.delete_one({"id": sid}))


@contextlib.contextmanager
def _family(dogs=1, name="family"):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {name}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "account_balance": 0.0, "credits": 0}))
    ids = [str(uuid.uuid4()) for _ in range(dogs)]
    for i, did in enumerate(ids):
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {name} dog {i}", "owner_id": cid, "breed": "Mix",
                                       "age_y": 3, "vaccines": dict(VAX)}))
    try:
        yield cid, ids
    finally:
        for coll in ("bookings", "invoices", "payments", "payment_ledger", "credit_lots", "checkout_groups"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.bookings.delete_many({"dog_id": {"$in": ids}}))
        run(server.db.dogs.delete_many({"id": {"$in": ids}}))
        run(server.db.clients.delete_one({"id": cid}))


def _arrive(bid, hours=8):
    run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), OWNER))
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": ts}}))


def _visit(svc, dog_id, hours=8):
    made = run(server.create_booking(server.BookingIn(dog_id=dog_id, date=_day(), service_type="daycare", service_id=svc,
                                                      override_capacity=True, override_vaccines=True), OWNER))
    _arrive(made["id"], hours)
    return made["id"]


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _bill(bid):
    return run(server.db.invoices.find_one({"booking_ids": bid, "status": {"$ne": "VOID"}}, {"_id": 0}))


def _cash(**extra):
    return server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid", **extra)


def _off(amount, reason="Courtesy discount"):
    return {"checkout_discount_amount": amount, "checkout_discount_reason": reason}


def _refused(call, bid, body, user=OWNER):
    with pytest.raises(HTTPException) as e:
        run(call(bid, body, user))
    return e.value


# ------------------------------------------------------------ one dog

def test_a_discount_comes_off_what_is_paid_and_shows_on_the_bill():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(**_off(10)), OWNER))
        row = _row(bid)
        assert row["actual_price"] == 30.0 and row["amount_paid"] == 30.0 and float(row["balance_due"]) == 0.0
        assert server._cash_revenue(row) == 30.0
        rec = row["checkout_discount"]
        assert (rec["amount"], rec["reason"], rec["price_before"], rec["price_after"]) == (10.0, "Courtesy discount", 40.0, 30.0)
        assert rec["applied_by"] == OWNER["id"]
        bill = _bill(bid)
        assert bill["total"] == 30.0 and bill["amount_paid"] == 30.0
        lines = {(li["kind"], li["amount"]) for li in bill["line_items"]}
        assert ("service", 40.0) in lines and ("discount", -10.0) in lines
        assert any(li["description"] == "Discount · Courtesy discount" for li in bill["line_items"])
        pays = run(server.db.payments.find({"invoice_id": bill["id"]}, {"_id": 0}).to_list(10))
        assert [p["amount"] for p in pays] == [30.0]
        # the visit's details show it again (the staff pill reads it; the API answers through BookingOut)
        shown = server.BookingOut.model_validate(run(server.get_booking(bid, OWNER))).model_dump()
        assert shown["checkout_discount"]["amount"] == 10.0


def test_a_discount_needs_its_reason():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        e = _refused(server.check_out, bid, _cash(**_off(10, reason="ok")))
        assert (e.status_code, e.detail) == (400, checkout_discount.MSG_REASON)
        assert _row(bid)["status"] != "completed"


def test_a_discount_above_what_is_due_stops_there_and_comps_the_stay():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(**_off(50)), OWNER))
        row = _row(bid)
        assert (row["payment_status"], row["actual_price"]) == ("comped", 0.0)
        assert (row["checkout_discount"]["amount"], row["checkout_discount"]["requested_amount"]) == (40.0, 50.0)


def test_comping_a_short_daycare_visit_at_the_screens_full_day_price_is_not_refused():
    """The screen shows the full-day price; the server bills a visit under
    five hours as a half day. Comping it at the screen's price comps it."""
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0], hours=3)
        run(server.check_out(bid, _cash(**_off(40)), OWNER))
        row = _row(bid)
        assert (row["status"], row["payment_status"], row["actual_price"]) == ("completed", "comped", 0.0)
        assert row["checkout_discount"]["amount"] == 20.0 and row["checkout_discount"]["price_before"] == 20.0


def test_a_stay_discounted_to_nothing_is_comped():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(**_off(40)), OWNER))
        row = _row(bid)
        assert (row["status"], row["payment_status"], row["actual_price"]) == ("completed", "comped", 0.0)
        assert float(row.get("amount_paid") or 0) == 0.0 and float(row.get("balance_due") or 0) == 0.0
        assert server._cash_revenue(row) == 0.0


def test_a_discount_covering_the_whole_visit_takes_no_payment_and_says_how_much_is_due():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        body = server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid_partial", amount_paid=5.0, **_off(40))
        e = _refused(server.check_out, bid, body)
        assert e.status_code == 400
        assert e.detail.startswith("The $40.00 discount covers all $40.00 due for this visit")
        assert "lower the discount to $35.00 or less" in e.detail
        assert _row(bid)["status"] != "completed"


def test_on_a_short_visit_the_refusal_names_the_real_amount_due():
    """The screen shows the full day ($40); the server bills a half day ($20).
    $25 off with $10 taken is refused with the $20 due and a discount that fits."""
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0], hours=3)
        body = server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid_partial", amount_paid=10.0, **_off(25))
        e = _refused(server.check_out, bid, body)
        assert "covers all $20.00 due" in e.detail and "lower the discount to $10.00 or less" in e.detail
        run(server.check_out(bid, server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid_partial",
                                                    amount_paid=10.0, **_off(10)), OWNER))
        row = _row(bid)
        assert (row["actual_price"], row["amount_paid"], float(row["balance_due"])) == (10.0, 10.0, 0.0)


def test_a_payment_above_the_discounted_price_still_goes_on_account():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        body = server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid_partial", amount_paid=40.0, **_off(10))
        run(server.check_out(bid, body, OWNER))
        row = _row(bid)
        assert row["actual_price"] == 30.0 and row["checkout_discount"]["amount"] == 10.0
        assert run(server.db.clients.find_one({"id": cid}))["account_balance"] == -10.0


def test_on_a_tab_only_the_discounted_amount_is_owed():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        body = server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid_partial", amount_paid=10.0, **_off(10))
        run(server.check_out(bid, body, OWNER))
        row = _row(bid)
        assert row["actual_price"] == 30.0 and row["amount_paid"] == 10.0 and float(row["balance_due"]) == 20.0
        assert run(server.db.clients.find_one({"id": cid}))["account_balance"] == 20.0


def test_credits_are_never_discounted_only_what_sits_on_top_of_them():
    """Credits pay the day; the $15 bath booked with it is taken off with the
    discount. Nothing is paid today, and the credits are untouched."""
    with _daycare() as svc, _family() as (cid, dogs):
        run(server._mutate_client_credits(cid, "daycare", 1, source="manual", reason=TAG))
        bid = _visit(svc, dogs[0])
        run(server.db.bookings.update_one({"id": bid}, {"$set": {
            "estimated_price": 55.0,
            "add_ons": [{"service_id": "x-bath", "name": "Bath", "price": 15.0, "qty": 1, "line_total": 15.0, "added_stage": "booking"}]}}))
        # (what the screen sends: the extras are "due", so a tender and "paid" travel, no amount)
        run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash", payment_status="paid", **_off(15)), OWNER))
        row = _row(bid)
        assert row["payment_method"] == "credits" and row["credits_deducted"] == 1
        assert row["checkout_discount"]["amount"] == 15.0 and row["checkout_discount"]["credit_value_preserved"] == 40.0
        assert float(row.get("amount_paid") or 0) == 0.0 and server._cash_revenue(row) == 0.0
        bill = _bill(bid)
        assert not [p for p in run(server.db.payments.find({"invoice_id": bill["id"]}, {"_id": 0}).to_list(10)) if not p.get("is_credit")]


def test_a_visit_credits_fully_pay_has_nothing_to_discount():
    with _daycare() as svc, _family() as (cid, dogs):
        run(server._mutate_client_credits(cid, "daycare", 1, source="manual", reason=TAG))
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, server.CheckoutIn(use_credits=True, **_off(5)), OWNER))
        row = _row(bid)
        assert row["status"] == "completed" and row["payment_method"] == "credits" and not row.get("checkout_discount")
        assert row["actual_price"] == 40.0 and float(row.get("amount_paid") or 0) == 0.0
        assert run(server.db.clients.find_one({"id": cid}))["credits"] == 0


# ------------------------------------------------------------ a household together

def test_a_household_shares_one_discount_in_checkout_order():
    with _daycare() as svc, _family(dogs=2) as (cid, dogs):
        ids = [_visit(svc, d) for d in dogs]
        run(server.check_out_group(ids[0], _cash(**_off(50)), OWNER))
        rows = [_row(b) for b in ids]
        assert all(r["status"] == "completed" for r in rows)
        assert round(sum(r["checkout_discount"]["amount"] for r in rows if r.get("checkout_discount")), 2) == 50.0
        # $40 + $20 (the second dog's multi-dog price) − $50
        assert round(sum(r["actual_price"] for r in rows), 2) == 10.0


def test_a_household_discount_above_what_is_due_comps_every_dog_and_is_never_refused():
    with _daycare() as svc, _family(dogs=2) as (cid, dogs):
        ids = [_visit(svc, d) for d in dogs]
        run(server.check_out_group(ids[0], _cash(**_off(100)), OWNER))
        rows = [_row(b) for b in ids]
        assert all(r["status"] == "completed" and r["payment_status"] == "comped" for r in rows)
        assert round(sum(r["checkout_discount"]["amount"] for r in rows), 2) == 60.0


# ------------------------------------------------------------ who, and where not

def test_only_staff_with_the_pricing_permission_give_a_discount():
    with _daycare() as svc, _family(dogs=3) as (cid, dogs):
        one = _visit(svc, dogs[0])
        for call in (server.check_out, server.check_out_group):
            e = _refused(call, one, _cash(**_off(5)), user=DESK)
            assert (e.status_code, e.detail) == (403, checkout_prices.MSG_DISCOUNT)
        assert _row(one)["status"] != "completed"


def test_never_on_a_friends_and_family_visit():
    with _daycare() as svc, _family(name="payer") as (payer, pdogs), _family(name="friend") as (_f, fdogs):
        body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=pdogs[0]), server.BookingGroupDog(dog_id=fdogs[0])],
                                     date=_day(), service_type="daycare", service_id=svc, override_capacity=True,
                                     override_vaccines=True, payer_client_id=payer)
        ids = [r["id"] for r in run(server.create_booking_group(body, OWNER))["bookings"]]
        for bid in ids:
            _arrive(bid)
        ff = server.CheckoutIn(use_credits=False, **_off(5))
        for call, bid in ((server.check_out, ids[1]), (server.check_out_group, ids[0]), (server.check_out_group, ids[1])):
            e = _refused(call, bid, ff)
            assert (e.status_code, e.detail) == (400, checkout_discount.MSG_FRIENDS)
            assert all(_row(b)["status"] != "completed" for b in ids)


def test_reopening_the_checkout_clears_the_discount():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(**_off(40)), OWNER))            # comped: nothing attached, so it can reopen
        run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(reason="entered by mistake"), OWNER))
        row = _row(bid)
        assert not row.get("checkout_discount")
        assert (row.get("financial_reopen_history") or [{}])[-1].get("prior_checkout_discount", {}).get("amount") == 40.0
        run(server.check_out(bid, _cash(), OWNER))
        assert _row(bid)["actual_price"] == 40.0 and not _row(bid).get("checkout_discount")


# ------------------------------------------------------------ the rule itself

def test_an_earlier_dog_of_a_household_takes_what_it_can_and_passes_the_rest_on():
    body = server.CheckoutIn(**_off(50))
    update = {"actual_price": 40.0, "payment_method": "cash"}
    assert checkout_discount.apply({}, update, body, OWNER, "ts") == 40.0
    share = checkout_discount.HouseholdShare(body)
    share.took({"checkout_discount": {"amount": 40.0}})
    assert share.payload_for({})["checkout_discount_amount"] == 10.0


def test_undoing_a_checkout_takes_the_discount_off_and_remembers_it():
    to_set, to_unset, note = reopen.undo_checkout({"checkout_discount": {"amount": 5.0}})
    assert to_unset.get("checkout_discount") == "" and note["prior_checkout_discount"] == {"amount": 5.0}
