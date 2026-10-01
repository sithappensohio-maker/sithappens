"""'Please try again' after a payment hiccup really works (audit: "'Please try
again' after a payment hiccup can never work").

When Stripe fails to start a Shop payment, the order is marked failed and the
customer is told to try again — but the screen kept the same checkout key, so
every retry resumed the failed order and was refused until the cart changed.
Now every refusal that ends a checkout for good carries the code
"checkout_restart"; the screens drop the key on it, and the next press starts
a fresh checkout. Nothing is charged on the attempt that failed.

Uses the guest checkout harness (tag TEST_GUEST_SHOP).
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import checkout as shop_checkout
from test_shop_guest_checkout import (  # noqa: F401
    _guest_body, _guest_orders, _item, _product, _public_shop_open, _Req, _stripe_mocked, guest_checkout,
)


def _boom(**kwargs):
    raise RuntimeError("Stripe is having a moment")


def _refused(fn):
    try:
        fn()
    except HTTPException as e:
        return e
    raise AssertionError("expected a refusal")


def test_a_payment_that_fails_to_start_tells_the_screen_to_start_fresh_and_a_fresh_try_works():
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=1) as p:
        key = f"g-{uuid.uuid4().hex}"
        with _stripe_mocked():
            real = server.stripe.checkout.Session.create
            server.stripe.checkout.Session.create = _boom
            try:
                e = _refused(lambda: run(guest_checkout(_guest_body([_item("product", p["id"])], idem=key), _Req())))
            finally:
                server.stripe.checkout.Session.create = real
            assert e.status_code == 502
            assert e.detail["error_code"] == shop_checkout.RESTART_CODE and "nothing was charged" in e.detail["msg"]
            claim = run(server.db.shop_checkout_claims.find_one({"idempotency_key": key}, {"_id": 0}))
            failed = run(server.db.shop_orders.find_one({"id": claim["shop_order_id"]}, {"_id": 0}))
            assert failed["status"] == "payment_failed", "nothing was charged on the attempt that failed"

            # The old screen retried with the same key: refused for good, and now says so in a way it can act on.
            again = _refused(lambda: run(guest_checkout(_guest_body([_item("product", p["id"])], idem=key), _Req())))
            assert again.status_code == 409 and again.detail["error_code"] == shop_checkout.RESTART_CODE

            # The screen starts fresh: it goes through, and the last unit is held once.
            out = run(guest_checkout(_guest_body([_item("product", p["id"])], idem=f"g-{uuid.uuid4().hex}"), _Req()))
            assert out["url"].startswith("https://checkout.stripe.com/")
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 1.0


def test_a_refusal_that_is_not_the_end_of_the_checkout_keeps_the_key():
    # Reusing a key for a different basket is a mistake to fix, not a dead checkout.
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=5) as p:
        key = f"g-{uuid.uuid4().hex}"
        with _stripe_mocked():
            run(guest_checkout(_guest_body([_item("product", p["id"])], idem=key), _Req()))
            e = _refused(lambda: run(guest_checkout(_guest_body([_item("product", p["id"], 2)], idem=key), _Req())))
        assert e.status_code == 409 and isinstance(e.detail, str)
