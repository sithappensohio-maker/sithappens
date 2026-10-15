"""Shop cart recovery email (Shop gap-list item 3, owner request
2026-10-15). A checkout that was started but never finished gets ONE
nudge, roughly 10-15 minutes in, with a link straight back to its still-
open Stripe page — never sent once that page has gone dead, never during
Quiet Hours, never sent twice for the same order.

Self-contained fixtures (never import another test module). Stripe and
the real email delivery are always faked — `email_service.send_shop_cart_
recovery` is patched to a recorder rather than letting `_dispatch` reach
Resend, since this file is testing the SWEEP's eligibility logic, not the
email-rendering pipeline (which test_shop_abandoned_stock.py's siblings
and the template registry already cover elsewhere).

Disposable tag TEST_SHOP_CART_RECOVERY.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

import email_service
from domains.shop import abandon

TAG = "TEST_SHOP_CART_RECOVERY"


class _Obj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


@contextlib.contextmanager
def _stripe():
    s = server.stripe
    saved = (s.Customer.create, s.checkout.Session.create, server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY)
    s.Customer.create = lambda **kw: _Obj(id="cus_fake_" + uuid.uuid4().hex[:8])
    s.checkout.Session.create = lambda **kw: _Obj(
        id="cs_fake_" + uuid.uuid4().hex[:8], url=f"https://checkout.stripe.com/test/{uuid.uuid4().hex[:8]}")
    server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY = True, server.STRIPE_SECRET_KEY or "sk_test_fake"
    try:
        yield
    finally:
        s.Customer.create, s.checkout.Session.create, server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY = saved


@contextlib.contextmanager
def _product(price=10.0):
    created = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True,
        track_inventory=False, starting_stock=0, guest_cart_allowed=True, publicly_visible=True), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _client():
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Buyer", email=f"{uuid.uuid4().hex[:8]}@example.com"), _admin()))
    user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": f"{TAG} Buyer"}
    try:
        yield user, c
    finally:
        orders = [o["id"] for o in run(server.db.shop_orders.find({"client_id": c["id"]}, {"_id": 0, "id": 1}).to_list(100))]
        run(server.db.shop_orders.delete_many({"client_id": c["id"]}))
        run(server.db.shop_payment_attempts.delete_many({"shop_order_id": {"$in": orders}}))
        run(server.db.shop_checkout_claims.delete_many({"client_id": c["id"]}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _item(p, qty=1):
    return server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=qty)


def _checkout(user, items):
    return run(server.create_shop_checkout(
        server.ShopCheckoutIn(items=items, idempotency_key=f"k-{uuid.uuid4().hex}"), user))


def _age_order(order_id, minutes):
    past = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    run(server.db.shop_orders.update_one({"id": order_id}, {"$set": {"created_at": past}}))


@contextlib.contextmanager
def _recorder(in_quiet_hours=False):
    calls = []

    async def _fake_send(to, order, *, client_name, checkout_url):
        calls.append({"to": to, "order_id": order["id"], "client_name": client_name, "checkout_url": checkout_url})
        return True

    with patch.object(email_service, "send_shop_cart_recovery", _fake_send), \
         patch.object(email_service, "_is_in_quiet_hours", return_value=in_quiet_hours):
        yield calls


def test_an_order_in_the_recovery_window_gets_one_nudge_with_the_live_link():
    with _client() as (user, client), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        _age_order(out["order_id"], minutes=12)
        run(abandon.sweep())
        assert len(calls) == 1
        assert calls[0]["order_id"] == out["order_id"]
        assert calls[0]["client_name"] == client["name"]
        attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": out["order_id"]}, {"_id": 0}))
        assert calls[0]["checkout_url"] == attempt["stripe_checkout_session_url"]


def test_too_recent_is_not_due_yet():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        _age_order(out["order_id"], minutes=3)
        run(abandon.sweep())
        assert calls == []


def test_outside_the_window_entirely_is_never_nudged():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        _age_order(out["order_id"], minutes=25)  # long past the 10-15 minute window
        run(abandon.sweep())
        assert calls == []


def test_a_paid_order_is_never_nudged():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": out["order_id"]}, {"_id": 0}))
        session = _Obj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                        amount_total=server._stripe_amount_cents(
                            run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))["total"]),
                        metadata={"sithappens_shop_order_id": out["order_id"], "sithappens_attempt_id": attempt["id"]})
        run(server._apply_shop_payment(attempt, session))
        _age_order(out["order_id"], minutes=12)
        run(abandon.sweep())
        assert calls == []


def test_no_nudge_during_quiet_hours():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder(in_quiet_hours=True) as calls:
        out = _checkout(user, [_item(leash)])
        _age_order(out["order_id"], minutes=12)
        run(abandon.sweep())
        assert calls == []
        # it was never claimed, so it's still eligible once quiet hours end
        order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
        assert "abandoned_email_sent_at" not in order


def test_never_sent_twice_even_across_several_ticks_in_the_same_window():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        _age_order(out["order_id"], minutes=12)
        run(abandon.sweep())
        run(abandon.sweep())  # a second tick, same order still inside the 10-15 minute window
        assert len(calls) == 1
        order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
        assert order.get("abandoned_email_sent_at")


def test_a_closed_stripe_page_still_claims_but_sends_nothing():
    with _client() as (user, _c), _product() as leash, _stripe(), _recorder() as calls:
        out = _checkout(user, [_item(leash)])
        run(server.db.shop_payment_attempts.update_many(
            {"shop_order_id": out["order_id"]}, {"$set": {"stripe_checkout_session_url": None}}))
        _age_order(out["order_id"], minutes=12)
        run(abandon.sweep())
        assert calls == []
        order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
        assert order.get("abandoned_email_sent_at")  # claimed for good — never retried with a now-dead page


def test_the_sweep_remains_registered_as_the_one_scheduler_job():
    assert "shop_abandoned_checkouts" in [n for n, _ in server._scheduler_jobs()]
