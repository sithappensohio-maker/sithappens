"""Money paid ahead onto the account, as a Shop basket line
(domains/shop/account_credit.py).

Owner request: a customer booking add-ons can pay for them while booking.
The dollars land as credit on file; the pickup bill uses them.

Stripe is monkeypatched, same as test_shop_income_split.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import account_credit

TAG = "TEST_ACCT_CREDIT"


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
        for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payment_ledger", "payments", "credit_lots"):
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


def _item(kind, ref, qty=1):
    return server.ShopCartItemIn(kind=kind, ref_id=ref, quantity=qty)


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


def _account(user):
    return run(server.db.clients.find_one({"id": user["client_id"]}, {"_id": 0}))


def _ledger(user):
    return run(server.db.payment_ledger.find({"client_id": user["client_id"]}, {"_id": 0}).to_list(50))


def _income(order):
    return run(server.db.retail_sales.find({"shop_order_id": order["id"]}, {"_id": 0}).to_list(50))


AHEAD = account_credit.ref_id_for(15.0)


def test_paying_ahead_puts_exactly_that_money_on_the_account_once():
    with _stripe(), _buyer() as user:
        order, attempt, session = _pay(user, [_item("account_credit", AHEAD)])
        assert order["total"] == 15.0 and order["tax_amount"] == 0 and order["discount_amount"] == 0
        assert order["status"] == "paid" and order["fulfillment_status"] == "fulfilled"
        assert _account(user)["account_balance"] == -15.0
        assert run(server.billing_tab_sync.credit_on_file(user["client_id"])) == 15.0
        rows = _ledger(user)
        assert [(r["type"], r["amount"], r["method"]) for r in rows] == [("payment", -15.0, "stripe_online")]
        # The same payment delivered again (webhook replay, Retry Fulfillment) changes nothing.
        run(server._apply_shop_payment(attempt, session))
        run(account_credit.fulfill_line(order, order["lines"][0]))
        assert _account(user)["account_balance"] == -15.0 and len(_ledger(user)) == 1


def test_income_is_counted_once_as_a_tab_payment_not_as_merchandise():
    with _stripe(), _buyer() as user, _pack(price=40.0) as pack:
        order, _, _ = _pay(user, [_item("credit_pack", pack["id"]), _item("account_credit", AHEAD)])
        assert order["total"] == 55.0
        rows = _income(order)
        assert sorted((r["source_kind"], r["amount"]) for r in rows) == [("credit_pack_sale", 40.0), ("tab_payment", 15.0)]
        assert sum(1 for r in rows if r.get("payment_id")) == 1
        assert all(float(r.get("tax_amount") or 0) == 0 for r in rows)
        # One card payment bought both: the credit landed and so did the money.
        acct = _account(user)
        assert acct["credits"] == 1 and acct["account_balance"] == -15.0


def test_the_amount_is_never_discounted_and_has_limits():
    with _stripe(), _buyer() as user:
        for bad in ("ac-50", "ac-5000001", "ac-abc", "15"):   # 50 cents, $50,000.01, junk
            try:
                _checkout(user, [_item("account_credit", bad)])
                assert False, f"expected a refusal for {bad}"
            except HTTPException as e:
                assert e.status_code == 400
        try:
            _checkout(user, [_item("account_credit", AHEAD, 2)])
            assert False, "expected one amount per order"
        except HTTPException as e:
            assert e.status_code == 422
        priced = run(server._price_shop_cart([_item("account_credit", AHEAD)], client_id=user["client_id"]))
        assert priced["total"] == 15.0 and priced["discount_amount"] == 0 and priced["lines"][0]["taxable"] is False


def test_a_guest_cannot_pay_ahead():
    try:
        run(server._price_shop_cart([_item("account_credit", AHEAD)], client_id=None, is_guest=True))
        assert False, "expected 403"
    except HTTPException as e:
        assert e.status_code == 403


def test_refund_is_allowed_only_while_the_money_is_still_unused():
    with _stripe(), _buyer() as user:
        order, attempt, _ = _pay(user, [_item("account_credit", AHEAD)])
        line = order["lines"][0]
        run(account_credit.assert_refundable(order, line))          # untouched: fine
        # A bill used $10 of it: only $5 is left on the account.
        run(server.db.clients.update_one({"id": user["client_id"]}, {"$inc": {"account_balance": 10.0}}))
        try:
            run(account_credit.assert_refundable(order, line))
            assert False, "expected the refund to be blocked"
        except HTTPException as e:
            assert e.status_code == 409 and "already been used" in e.detail
        run(server.db.clients.update_one({"id": user["client_id"]}, {"$inc": {"account_balance": -10.0}}))
        # Refunded: the money comes off the account exactly once.
        run(account_credit.revoke_line(order, line, "refund-attempt-1"))
        run(account_credit.revoke_line(order, line, "refund-attempt-1"))
        assert _account(user)["account_balance"] == 0.0
        assert sorted((r["type"], r["amount"]) for r in _ledger(user)) == [("payment", -15.0), ("refund", 15.0)]
        fresh = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert fresh["lines"][0]["fulfillment_status"] == "refunded"
        # A Retry Fulfillment after the refund must not put it back.
        run(server._apply_shop_payment(attempt, None))
        assert _account(user)["account_balance"] == 0.0


def test_the_refund_screen_plan_uses_the_same_rule():
    with _stripe(), _buyer() as user:
        order, _, _ = _pay(user, [_item("account_credit", AHEAD)])
        req = [server.ShopRefundLineIn(item_id=order["lines"][0]["item_id"], quantity=1)]
        plan = run(server._build_shop_refund_plan(order, req))
        assert plan["amount"] == 15.0
        run(server.db.clients.update_one({"id": user["client_id"]}, {"$set": {"account_balance": 0.0}}))
        try:
            run(server._build_shop_refund_plan(order, req))
            assert False, "expected the refund to be blocked once the money is used"
        except HTTPException as e:
            assert e.status_code == 409
