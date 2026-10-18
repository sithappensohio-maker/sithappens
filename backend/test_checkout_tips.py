"""Tips, added on the spot at checkout (owner, 2026-10-18: "allow tips as
an add on on the spot").

Unlike the one-time discount this mirrors the shape of (domains/bookings/
tips.py, modeled on checkout_discount.py), a tip is a flat ADD applied dead
last — strictly after the one-time discount, so a staff discount can never
eat into it — and is never gated behind the "pricing" permission a
discount needs: anyone who can take payments can accept a tip. Never on a
friends & family visit; a household leaving together shares the one tip
the screen asked for (the anchor dog only, same pattern additional_cash_
charge already uses); reopening a checkout clears it.

Self-contained fixtures (never import another test module, mirrors
test_checkout_discount.py's own style).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import tips as checkout_tips, checkout_prices, friends_family
from matrix_support import saved_matrix  # noqa: F401 — the fixture is a test argument

TAG = "TEST_CHECKOUT_TIPS"
OWNER = {"id": "ct-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
DESK = {"id": "ct-desk", "role": "admin", "staff_role": "front_desk", "name": "Dee Desk", "display_name": "Dee Desk"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _setup(monkeypatch, saved_matrix):
    saved_matrix("front_desk", {"take_payments": True, "pricing": False})
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


def _refused(call, bid, body, user=OWNER):
    with pytest.raises(HTTPException) as e:
        run(call(bid, body, user))
    return e.value


# ------------------------------------------------------------ one dog

def test_a_tip_adds_to_what_is_charged_and_shows_on_the_bill():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(tip_amount=5.0), DESK))  # front_desk, no pricing permission
        row = _row(bid)
        assert row["actual_price"] == 45.0 and row["amount_paid"] == 45.0 and float(row["balance_due"]) == 0.0
        assert row["tip_amount"] == 5.0
        assert server._cash_revenue(row) == 45.0
        bill = _bill(bid)
        assert bill["total"] == 45.0 and bill["amount_paid"] == 45.0
        lines = {(li["kind"], li["amount"]) for li in bill["line_items"]}
        assert ("service", 40.0) in lines and ("tip", 5.0) in lines
        assert any(li["description"] == "Tip" for li in bill["line_items"])
        pays = run(server.db.payments.find({"invoice_id": bill["id"]}, {"_id": 0}).to_list(10))
        assert [p["amount"] for p in pays] == [45.0]
        # the already-existing (previously dead) BookingOut field now carries real data
        shown = server.BookingOut.model_validate(run(server.get_booking(bid, OWNER))).model_dump()
        assert shown["tip_amount"] == 5.0


def test_no_tip_sent_means_no_tip_line_at_all():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(), OWNER))
        row = _row(bid)
        assert row["actual_price"] == 40.0 and not row.get("tip_amount")
        bill = _bill(bid)
        assert not any(li["kind"] == "tip" for li in bill["line_items"])


def test_a_tip_is_never_gated_behind_the_pricing_permission():
    # DESK has take_payments but NOT pricing (see _setup) — a tip must still go through.
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(tip_amount=8.0), DESK))
        assert _row(bid)["tip_amount"] == 8.0


# ------------------------------------------------------------ interplay with the discount

def test_a_discount_never_eats_into_the_tip():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(
            checkout_discount_amount=40.0, checkout_discount_reason="Courtesy discount",
            tip_amount=5.0,
        ), OWNER))
        row = _row(bid)
        # The $40 discount comps the $40 stay entirely; the $5 tip is real
        # money on top, untouched by the discount's own "due" math.
        assert row["checkout_discount"]["amount"] == 40.0
        assert row["tip_amount"] == 5.0
        assert row["actual_price"] == 5.0
        bill = _bill(bid)
        lines = {(li["kind"], li["amount"]) for li in bill["line_items"]}
        assert ("discount", -40.0) in lines and ("tip", 5.0) in lines


def test_a_fully_comped_visit_that_still_gets_tipped_is_paid_not_comped():
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(
            checkout_discount_amount=40.0, checkout_discount_reason="Comp the visit",
            tip_amount=10.0,
        ), OWNER))
        row = _row(bid)
        # Without the tip this would be "comped" (see test_checkout_discount.py);
        # real cash changed hands for the tip, so the visit is "paid", not comped.
        assert row["payment_status"] == "paid"
        assert row["amount_paid"] == 10.0 and row["actual_price"] == 10.0
        assert row["payment_method"] == "cash"


def test_a_discount_above_what_is_due_with_no_tip_is_still_comped():
    """Control for the test above — comping alone (no tip) behaves exactly
    as it already did before this feature existed."""
    with _daycare() as svc, _family() as (cid, dogs):
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, _cash(checkout_discount_amount=40.0, checkout_discount_reason="Comp"), OWNER))
        row = _row(bid)
        assert row["payment_status"] == "comped" and row["actual_price"] == 0.0


# ------------------------------------------------------------ credits

def test_a_tip_is_the_only_cash_due_when_credits_cover_the_stay():
    with _daycare() as svc, _family() as (cid, dogs):
        run(server._mutate_client_credits(cid, "daycare", 1, source="manual", reason=TAG))
        bid = _visit(svc, dogs[0])
        run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash", tip_amount=6.0), OWNER))
        row = _row(bid)
        assert row["payment_method"] == "credits"
        assert row["actual_price"] == 46.0  # $40 stay + $6 tip
        assert row["tip_amount"] == 6.0
        assert float(row["amount_paid"]) == 6.0  # the stay cost 0 cash; only the tip is new money
        assert run(server.db.clients.find_one({"id": cid}))["credits"] == 0


# ------------------------------------------------------------ a household together

def test_a_household_tip_is_charged_once_not_once_per_dog():
    with _daycare() as svc, _family(dogs=2) as (cid, dogs):
        ids = [_visit(svc, d) for d in dogs]
        run(server.check_out_group(ids[0], _cash(tip_amount=10.0), OWNER))
        rows = [_row(b) for b in ids]
        assert all(r["status"] == "completed" for r in rows)
        # Only the anchor (ids[0], the dog whose checkout button was pressed) carries it.
        tipped = [r for r in rows if r.get("tip_amount")]
        assert len(tipped) == 1 and tipped[0]["id"] == ids[0] and tipped[0]["tip_amount"] == 10.0
        assert round(sum(r.get("tip_amount") or 0 for r in rows), 2) == 10.0  # not 20


# ------------------------------------------------------------ friends & family

def test_a_friends_and_family_tip_never_repeats_across_the_group():
    """Same rule additional_cash_charge already follows on an FF checkout
    (friends_family.check_out_together): an extra charge belongs to the dog
    whose button was clicked, never repeated onto every other dog in the
    group. The frontend never offers the tip panel at all when isFF — this
    is the backend's own guard against a direct call multiplying it."""
    with _daycare() as svc, _family(name="payer") as (payer, pdogs), _family(name="friend") as (_f, fdogs):
        body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=pdogs[0]), server.BookingGroupDog(dog_id=fdogs[0])],
                                     date=_day(), service_type="daycare", service_id=svc, override_capacity=True,
                                     override_vaccines=True, payer_client_id=payer)
        ids = [r["id"] for r in run(server.create_booking_group(body, OWNER))["bookings"]]
        for bid in ids:
            _arrive(bid)
        ff = server.CheckoutIn(use_credits=False, tip_amount=5.0)
        run(server.check_out_group(ids[0], ff, OWNER))
        rows = [_row(b) for b in ids]
        tipped = [r for r in rows if r.get("tip_amount")]
        assert len(tipped) <= 1
        assert round(sum(r.get("tip_amount") or 0 for r in rows), 2) in (0.0, 5.0)  # never doubled to 10


# ------------------------------------------------------------ reopen

def test_undo_checkout_clears_the_tip_field_and_records_what_it_was():
    """Direct unit test of the building-block function (same style as
    checkout_discount's own "the rule itself" tests below) — a checkout
    that actually collected a tip can never be reopened at all (it has real
    money attached, same as any other payment; see _reopen_booking_checkout_
    locked's own money-attached refusal), so this exercises reopen.undo_
    checkout directly rather than through the full HTTP-reachable flow."""
    from domains.bookings import reopen
    booking = {"id": "fake-id", "tip_amount": 7.0, "checked_out_at": "2026-01-01T00:00:00Z"}
    to_set, to_unset, note = reopen.undo_checkout(booking)
    assert to_unset.get("tip_amount") == ""
    assert note.get("prior_tip_amount") == 7.0


def test_undo_checkout_leaves_an_untipped_booking_alone():
    from domains.bookings import reopen
    booking = {"id": "fake-id", "checked_out_at": "2026-01-01T00:00:00Z"}
    _to_set, to_unset, note = reopen.undo_checkout(booking)
    assert "tip_amount" not in to_unset
    assert "prior_tip_amount" not in note


# ------------------------------------------------------------ the rule itself

def test_tip_apply_adds_to_actual_price_and_records_the_field():
    update = {"actual_price": 40.0}
    taken = checkout_tips.apply({}, update, server.CheckoutIn(tip_amount=5.0))
    assert taken == 5.0
    assert update["actual_price"] == 45.0 and update["tip_amount"] == 5.0


def test_tip_apply_is_a_no_op_at_zero():
    update = {"actual_price": 40.0}
    taken = checkout_tips.apply({}, update, server.CheckoutIn(tip_amount=0))
    assert taken == 0.0 and "tip_amount" not in update and update["actual_price"] == 40.0


def test_checkout_prices_never_blocks_a_tip_for_non_pricing_staff():
    """checkout_prices.refuse_price_changes is the gate a discount/base-price
    override hits — a tip must sail through it untouched."""
    run(checkout_prices.refuse_price_changes("fake-id", server.CheckoutIn(tip_amount=500), DESK))
