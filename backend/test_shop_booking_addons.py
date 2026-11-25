"""A booking's add-ons paid online, as a Shop basket line
(domains/shop/booking_addons.py).

Owner request: a customer booking add-ons can pay for them while booking.
The paid add-ons become "(paid online)" at $0 on the booking, so the staff
checkout — which adds up add-ons from the booking — charges nothing more.

Stripe is monkeypatched, same as test_shop_income_split.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import booking_addons

TAG = "TEST_BOOKING_ADDONS"


class _Fake(dict):
    __getattr__ = dict.__getitem__


@contextlib.contextmanager
def _stripe():
    calls = []
    saved = (server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY,
             server.stripe.Customer.create, server.stripe.checkout.Session.create)
    server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY = True, "sk_test_fake"
    server.stripe.Customer.create = lambda **kw: _Fake(id="cus_" + uuid.uuid4().hex[:8])

    def _session(**kw):
        calls.append(kw)
        return _Fake(id="cs_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake")
    server.stripe.checkout.Session.create = _session
    try:
        yield calls
    finally:
        (server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY,
         server.stripe.Customer.create, server.stripe.checkout.Session.create) = saved


@contextlib.contextmanager
def _buyer(**fields):
    cid = str(uuid.uuid4())
    doc = {"id": cid, "name": f"{TAG} Buyer", "email": f"{uuid.uuid4().hex[:8]}@example.com",
           "created_at": "2026-01-01T00:00:00Z", **fields}
    run(server.db.clients.insert_one(dict(doc)))
    try:
        yield {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": TAG}
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        orders = [o["id"] for o in run(server.db.shop_orders.find({"client_id": cid}, {"_id": 0, "id": 1}).to_list(50))]
        for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments", "credit_lots", "bookings"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": orders}}))


@contextlib.contextmanager
def _pack(**kw):
    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}
    defaults = dict(name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=1, price=40.0,
                    service_type="daycare", available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), admin))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


def _addon(name="Bath", price=15.0, **kw):
    return {"service_id": f"svc-{name.lower().replace(' ', '-')}", "name": name, "icon": "fa-bath",
            "price": price, "list_price": price, "price_override_id": None, "qty": 1,
            "added_at": "2026-11-25T10:00:00+00:00", **kw}


def _visit(user, *addons, **fields):
    doc = {"id": str(uuid.uuid4()), "client_id": user["client_id"], "dog_id": "d-" + TAG, "dog_name": "Rex",
           "service_type": "daycare", "date": "2027-03-10", "end_date": None, "status": "approved",
           "add_ons": [dict(a) for a in addons], **fields}
    run(server.db.bookings.insert_one(dict(doc)))
    return doc


def _line(*bookings):
    return server.ShopCartItemIn(kind="booking_addons", ref_id=booking_addons.ref_id_for([b["id"] for b in bookings]), quantity=1)


def _checkout(user, items, idem=None):
    return run(server.create_shop_checkout(
        server.ShopCheckoutIn(items=items, idempotency_key=idem or f"{TAG}-{uuid.uuid4().hex}"), user))


def _pay(user, items):
    out = _checkout(user, items)
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _Fake(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                    amount_total=server._stripe_amount_cents(order["total"]),
                    metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0})), attempt, session


def _booking(b):
    return run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))


def _income(order):
    return run(server.db.retail_sales.find({"shop_order_id": order["id"]}, {"_id": 0}).to_list(50))


def _refused(fn, status):
    try:
        fn()
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e
    raise AssertionError(f"expected a {status} refusal")


def test_paying_marks_the_addons_paid_so_pickup_charges_nothing_more():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0), _addon("Nail trim", 8.0))
        assert server._booking_addon_total_from(visit) == 23.0
        order, attempt, session = _pay(user, [_line(visit)])
        assert order["total"] == 23.0 and order["tax_amount"] == 0 and order["discount_amount"] == 0
        assert order["status"] == "paid" and order["fulfillment_status"] == "fulfilled"
        after = _booking(visit)
        # The staff checkout adds up add-ons with this very function.
        assert server._booking_addon_total_from(after) == 0.0
        assert [a["name"] for a in after["add_ons"]] == ["Bath (paid online)", "Nail trim (paid online)"]
        assert [(a["paid_online"], a["prepaid_amount"], a["prepaid_order_id"]) for a in after["add_ons"]] == \
            [(True, 15.0, order["id"]), (True, 8.0, order["id"])]
        # The same payment delivered again (webhook replay, Retry Fulfillment) changes nothing.
        run(server._apply_shop_payment(attempt, session))
        run(booking_addons.fulfill_line(order, order["lines"][0]))
        assert _booking(visit)["add_ons"] == after["add_ons"]


def test_the_amount_comes_from_the_bookings_never_from_the_cart():
    with _stripe(), _buyer() as user, _buyer() as stranger:
        visit = _visit(user, _addon("Bath", 15.0))
        other = _visit(stranger, _addon("Bath", 15.0))
        closed = _visit(user, _addon("Bath", 15.0), status="completed")
        bare = _visit(user)
        _refused(lambda: _checkout(user, [_line(other)]), 404)          # someone else's booking
        _refused(lambda: _checkout(user, [_line(closed)]), 409)         # already finished
        _refused(lambda: _checkout(user, [_line(bare)]), 409)           # nothing to pay
        _refused(lambda: _checkout(user, [server.ShopCartItemIn(kind="booking_addons", ref_id="ba:", quantity=1)]), 400)
        _refused(lambda: _checkout(user, [server.ShopCartItemIn(kind="booking_addons", ref_id=_line(visit).ref_id, quantity=2)]), 422)
        priced = run(server._price_shop_cart([_line(visit)], client_id=user["client_id"]))
        assert priced["total"] == 15.0 and priced["discount_amount"] == 0 and priced["lines"][0]["taxable"] is False
        _refused(lambda: run(server._price_shop_cart([_line(visit)], client_id=None, is_guest=True)), 403)


def test_two_dogs_and_a_pack_are_one_payment_filed_once_and_not_as_merchandise():
    with _stripe() as calls, _buyer() as user, _pack(price=37.5, qty=1.5) as pack:
        rex = _visit(user, _addon("Bath", 15.0), group_id="g1")
        bo = _visit(user, _addon("Bath", 15.0), _addon("Nail trim", 8.0), group_id="g1", dog_name="Bo")
        order, _, _ = _pay(user, [server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=1), _line(rex, bo)])
        assert order["total"] == 75.5 and len(calls) == 1
        rows = _income(order)
        assert sorted((r["source_kind"], r["amount"]) for r in rows) == [("credit_pack_sale", 37.5), ("tab_payment", 38.0)]
        assert sum(1 for r in rows if r.get("payment_id")) == 1
        assert all(float(r.get("tax_amount") or 0) == 0 for r in rows)
        assert server._finance_income_category(next(r for r in rows if r["source_kind"] == "tab_payment")) == "account_payments"
        assert server._booking_addon_total_from(_booking(rex)) == 0 and server._booking_addon_total_from(_booking(bo)) == 0
        assert run(server.db.clients.find_one({"id": user["client_id"]}, {"_id": 0}))["credits"] == 1.5


def test_an_addon_added_later_is_still_charged_at_pickup():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0))
        _pay(user, [_line(visit)])
        run(server.db.bookings.update_one({"id": visit["id"]}, {"$push": {"add_ons": _addon("Nail trim", 8.0)}}))
        assert server._booking_addon_total_from(_booking(visit)) == 8.0
        # …and can itself be paid online, without touching the one already paid.
        order, _, _ = _pay(user, [_line(visit)])
        assert order["total"] == 8.0 and server._booking_addon_total_from(_booking(visit)) == 0.0


def test_a_paid_addon_cannot_be_quietly_removed():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0), _addon("Nail trim", 8.0))
        run(server.remove_booking_addon(visit["id"], 1, user))            # unpaid: fine
        _pay(user, [_line(visit)])
        e = _refused(lambda: run(server.remove_booking_addon(visit["id"], 0, user)), 409)
        assert "paid for online" in e.detail
        assert len(_booking(visit)["add_ons"]) == 1


def test_payment_landing_on_a_cancelled_booking_goes_to_needs_attention():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0))
        out = _checkout(user, [_line(visit)])
        run(server.db.bookings.update_one({"id": visit["id"]}, {"$set": {"status": "cancelled"}}))
        order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
        attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
        session = _Fake(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                        amount_total=1500, metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
        run(server._apply_shop_payment(attempt, session))
        fresh = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert fresh["status"] == "paid" and fresh["fulfillment_status"] == "needs_attention"
        assert "was cancelled" in fresh["lines"][0]["fulfillment_error"]
        assert _booking(visit)["add_ons"][0]["price"] == 15.0, "nothing is changed on a closed booking"


def test_refund_puts_the_price_back_and_is_blocked_after_checkout():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0, line_total=15.0))
        order, attempt, _ = _pay(user, [_line(visit)])
        line = order["lines"][0]
        req = [server.ShopRefundLineIn(item_id=line["item_id"], quantity=1)]
        assert run(server._build_shop_refund_plan(order, req))["amount"] == 15.0
        run(booking_addons.revoke_line(order, line, "refund-1"))
        run(booking_addons.revoke_line(order, line, "refund-1"))
        back = _booking(visit)["add_ons"][0]
        assert (back["name"], back["price"], back["line_total"]) == ("Bath", 15.0, 15.0) and not back.get("paid_online")
        assert server._booking_addon_total_from(_booking(visit)) == 15.0
        fresh = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert fresh["lines"][0]["fulfillment_status"] == "refunded"
        run(server._apply_shop_payment(attempt, None))   # a Retry Fulfillment after the refund must not mark it paid again
        assert server._booking_addon_total_from(_booking(visit)) == 15.0

        done = _visit(user, _addon("Bath", 15.0))
        order2, _, _ = _pay(user, [_line(done)])
        run(server.db.bookings.update_one({"id": done["id"]}, {"$set": {"status": "completed", "checked_out_at": "2027-03-10T22:00:00Z"}}))
        req2 = [server.ShopRefundLineIn(item_id=order2["lines"][0]["item_id"], quantity=1)]
        e = _refused(lambda: run(server._build_shop_refund_plan(order2, req2)), 409)
        assert "already checked out" in e.detail


def test_cancelling_a_booking_with_paid_addons_flags_the_order_for_a_refund():
    with _stripe(), _buyer() as user:
        visit = _visit(user, _addon("Bath", 15.0))
        order, _, _ = _pay(user, [_line(visit)])
        run(server.db.bookings.update_one({"id": visit["id"]}, {"$set": {"status": "cancelled"}}))
        run(server._flag_paid_addons_of_closed_booking(visit["id"]))
        fresh = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert fresh["fulfillment_status"] == "needs_attention"
        assert "$15.00 of add-ons" in fresh["lines"][0]["fulfillment_error"]
        # A cancelled booking's paid add-ons can be refunded automatically.
        req = [server.ShopRefundLineIn(item_id=fresh["lines"][0]["item_id"], quantity=1)]
        assert run(server._build_shop_refund_plan(fresh, req))["amount"] == 15.0
        # A booking with nothing paid online flags nothing.
        plain = _visit(user, _addon("Bath", 15.0))
        run(server._flag_paid_addons_of_closed_booking(plain["id"]))
