"""The cash drawer, on a checkout paid with credits.

The drawer rule was always right — cash tender AND money collected now. What
was wrong was how the tender got decided. A credits checkout that left any
remainder the credits did not cover (a late-pickup fee, a rate worth more than
the credit) ran this:

    update["cash_payment_method"] = _normalize_payment_method(chosen_tender or "cash", ...)

The front desk sends no payment_method at all for a credits checkout, and a
booking that never took cash has no stored tender, so `or "cash"` invented one.
The remainder was recorded as cash nobody had taken, and the drawer popped open
on a visit paid with credits.

Unset is the honest answer: still owed, still revenue, but not cash — so it
never inflates what the drawer is expected to hold.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_CREDIT_DRAWER"


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin",
            "permissions": ["take_payments", "pricing"]}


@contextlib.contextmanager
def _client_dog_booking(*, credits=1, price=30.0):
    admin = _admin()
    client = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    run(server.db.clients.update_one({"id": client["id"]}, {"$set": {"credits": credits}}))
    dog_id = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog_id, "name": f"{TAG}dog", "owner_id": client["id"],
                                   "breed": "Mix", "age_y": 3}))
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": client["id"], "client_name": client["name"],
        "dog_id": dog_id, "dog_name": f"{TAG}dog", "service_type": "daycare",
        "status": "approved", "date": server.business_today().isoformat(),
        "estimated_price": price, "unit_price": price,
        "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat(),
        "checked_in_by": "test", "created_at": server.now_iso(),
    }))
    try:
        yield client, bid
    finally:
        run(server.db.bookings.delete_many({"client_id": client["id"]}))
        run(server.db.dogs.delete_many({"owner_id": client["id"]}))
        run(server.db.clients.delete_many({"id": client["id"]}))


def _resolved_tender(booking):
    """The exact expression the checkout and the drawer both read."""
    return (booking.get("cash_payment_method")
            if booking.get("payment_method") == "credits"
            else booking.get("payment_method"))


def _drawer_would_open(booking):
    return _resolved_tender(booking) == "cash" and float(booking.get("amount_paid") or 0) > 0


# ── the reported bug ───────────────────────────────────────────────────────

def test_a_credits_checkout_with_a_remainder_does_not_open_the_drawer():
    """The visit is worth more than the credit covers. That remainder is real
    money owed — but nobody said it was paid in cash, so the drawer stays shut
    and the register does not expect notes that were never handed over."""
    with _client_dog_booking(price=45.0) as (client, bid):
        run(server.db.bookings.update_one({"id": bid}, {"$set": {
            "payment_method": "credits", "actual_price": 45.0, "credit_value": 40.0}}))
        booking = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))

        # The block under test, with the inputs a credits checkout produces:
        # the front desk sends no payment_method, and nothing is stored.
        chosen = server._credit_remainder_tender(None, booking.get("cash_payment_method"))
        after = dict(booking)
        after["amount_paid"] = round(45.0 - 40.0, 2)
        if chosen:
            after["cash_payment_method"] = chosen

        assert after["amount_paid"] == 5.0, "the remainder is still owed"
        assert after.get("cash_payment_method") is None, "no tender was chosen, so none is claimed"
        assert _resolved_tender(after) is None
        assert _drawer_would_open(after) is False, "credits must not pop the cash drawer"


def test_the_unclaimed_remainder_lands_in_other_not_cash():
    """Where the money goes matters as much as the drawer: an unchosen tender
    must not be counted as cash, or the register's expected cash is wrong and
    the count never reconciles."""
    assert server._normalize_payment_method(None) == "other"
    assert server._map_booking_method_to_payment_method(None) == "other"
    assert server._normalize_payment_method(None) != "cash"


# ── everything that must still work ────────────────────────────────────────

def test_an_operator_who_chooses_cash_still_opens_the_drawer():
    """The fix removes an invented default, not the feature. When the front
    desk actually takes cash on top of credits, the drawer must still open."""
    after = {"payment_method": "credits", "amount_paid": 5.0,
             "cash_payment_method": server._credit_remainder_tender("cash", None)}
    assert _resolved_tender(after) == "cash"
    assert _drawer_would_open(after) is True


def test_a_non_cash_tender_never_opens_the_drawer():
    for method in ("card", "venmo", "check", "other"):
        after = {"payment_method": "credits", "amount_paid": 5.0,
                 "cash_payment_method": server._credit_remainder_tender(method, None)}
        assert _drawer_would_open(after) is False, method


def test_a_tender_already_stored_on_the_booking_is_still_honoured():
    """A booking that genuinely took cash earlier keeps its tender — the fix
    only stops inventing one where none exists."""
    after = {"payment_method": "credits", "amount_paid": 5.0,
             "cash_payment_method": server._credit_remainder_tender(None, "cash")}
    assert _drawer_would_open(after) is True


def test_a_fully_covered_credits_checkout_collects_nothing_at_all():
    with _client_dog_booking(price=30.0) as (client, bid):
        run(server.db.bookings.update_one({"id": bid}, {"$set": {
            "payment_method": "credits", "actual_price": 30.0, "credit_value": 30.0}}))
        booking = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        remainder = round(max(0.0, 30.0 - 30.0), 2)
        assert remainder == 0.0
        assert _drawer_would_open({**booking, "amount_paid": remainder}) is False


def test_a_plain_cash_checkout_is_untouched():
    """Nothing about ordinary cash checkouts changes: payment_method is not
    'credits', so the remainder rule never runs for them."""
    after = {"payment_method": "cash", "amount_paid": 30.0}
    assert _resolved_tender(after) == "cash"
    assert _drawer_would_open(after) is True
