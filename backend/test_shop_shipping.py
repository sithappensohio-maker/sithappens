"""Shipping for self-fulfilled Shop products (Shop gap-list item 5, owner
request 2026-10-15). Covers the all-or-nothing eligibility rule, the
fail-closed behavior when FedEx isn't configured, the real
_price_shop_cart/checkout integration (a FedEx Ground quote added to the
total, never taxed), the separate shipping_status state machine
(preparing -> shipped, distinct from pickup_status), and the product-
form validation (shippable requires a weight).

FedEx itself is always mocked (domains.shop.fedex.quote_ground_rate) —
this file tests the business rules in domains.shop.shipping and their
integration, not the FedEx API client (see test_fedex_client.py for
that).

Disposable tag TEST_SHOP_SHIPPING.
"""
import contextlib
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.shop import fedex
from domains.shop import shipping as shop_shipping

TAG = "TEST_SHOP_SHIPPING"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "shipping@test"}
STAFF = {"id": f"{TAG}-staff", "role": "admin", "name": f"{TAG} staff"}

ADDRESS = server.shop_shipping.ShopShippingAddressIn(
    address1="1 Main St", city="Dayton", region="OH", zip="45402")


class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


@contextlib.contextmanager
def _stripe_mocked():
    orig_c, orig_s = server.stripe.Customer.create, server.stripe.checkout.Session.create
    server.stripe.Customer.create = lambda **kw: _FakeStripeObj(id="cus_test_" + uuid.uuid4().hex[:8])
    server.stripe.checkout.Session.create = lambda **kw: _FakeStripeObj(
        id="cs_test_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/x",
        _line_items=kw.get("line_items"))
    try:
        yield
    finally:
        server.stripe.Customer.create, server.stripe.checkout.Session.create = orig_c, orig_s


@contextlib.contextmanager
def _fedex_configured(rate=15.0):
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "quote_ground_rate", AsyncMock(return_value=rate)):
        yield


_made = {"clients": [], "products": []}


def setup_module(_module):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"sales_tax.enabled": False}}, upsert=True))


def teardown_module(_module):
    cids = _made["clients"]
    oids = [o["id"] for o in run(server.db.shop_orders.find({"client_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": oids}}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments"):
        run(server.db[coll].delete_many({"client_id": {"$in": cids}}))
    run(server.db.clients.delete_many({"id": {"$in": cids}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))


def _client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.com",
        "credits": 0, "created_at": server.now_iso(),
    }))
    _made["clients"].append(cid)
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Client"}


def _product(price=40.0, *, shippable=True, weight=2.0):
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Item {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True,
        starting_stock=0, shippable=shippable, shipping_weight_lbs=weight if shippable else None), ADMIN))
    _made["products"].append(p["id"])
    return p


def _pay(user, items, *, shipping_address=None):
    with _stripe_mocked():
        out = run(server.create_shop_checkout(
            server.ShopCheckoutIn(items=items, idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                                   shipping_address=shipping_address), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                              amount_total=server._stripe_amount_cents(order["total"]),
                              metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))


# ──────────────────────────────────────────────────── product form ────

def test_shippable_without_a_weight_is_refused_on_create():
    try:
        run(server.create_pos_product(server.PosProductCreateIn(
            name=f"{TAG} bad", price=10.0, shippable=True, starting_stock=0), ADMIN))
        assert False
    except HTTPException as e:
        assert e.status_code == 400 and "weight" in e.detail.lower()


def test_shippable_with_a_weight_persists_and_reaches_the_catalog():
    p = _product(weight=3.5)
    doc = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
    assert doc["shippable"] is True and doc["shipping_weight_lbs"] == 3.5
    catalog = run(server._build_shop_catalog(None))
    item = next(i for i in catalog["items"] if i["kind"] == "product" and i["id"] == p["id"])
    assert item["shippable"] is True


def test_update_also_refuses_shippable_without_a_weight():
    p = _product(weight=2.0)
    try:
        run(server.update_pos_product(p["id"], server.PosProductIn(
            name=p["name"], price=40.0, shippable=True, shipping_weight_lbs=None), ADMIN))
        assert False
    except HTTPException as e:
        assert e.status_code == 400


# ───────────────────────────────────────────── cart_shippable / weight ─

def test_cart_shippable_requires_every_physical_line():
    shippable_line = {"kind": "product", "shippable": True}
    unshippable_line = {"kind": "product", "shippable": False}
    assert shop_shipping.cart_shippable([shippable_line]) is True
    assert shop_shipping.cart_shippable([shippable_line, unshippable_line]) is False
    assert shop_shipping.cart_shippable([{"kind": "credit_pack", "shippable": False}]) is False  # nothing physical at all


def test_cart_weight_sums_only_physical_lines():
    lines = [
        {"kind": "product", "shipping_weight_lbs": 2.0, "quantity": 2},
        {"kind": "product", "shipping_weight_lbs": 1.5, "quantity": 1},
        {"kind": "credit_pack", "quantity": 1},
    ]
    assert shop_shipping.cart_weight_lbs(lines) == 5.5


# ──────────────────────────────────────────────────── quote_for_cart ──

def test_quote_for_cart_refuses_a_non_shippable_line():
    lines = [{"kind": "product", "shippable": False, "shipping_weight_lbs": None, "quantity": 1}]
    with _fedex_configured():
        try:
            run(shop_shipping.quote_for_cart(lines, ADDRESS))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "can't be shipped" in e.detail


def test_quote_for_cart_fails_closed_when_fedex_is_not_configured():
    lines = [{"kind": "product", "shippable": True, "shipping_weight_lbs": 2.0, "quantity": 1}]
    with patch.object(fedex, "FEDEX_ENABLED", False):
        try:
            run(shop_shipping.quote_for_cart(lines, ADDRESS))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "isn't available" in e.detail


def test_quote_for_cart_returns_the_fedex_rate_when_configured():
    lines = [{"kind": "product", "shippable": True, "shipping_weight_lbs": 2.0, "quantity": 1}]
    with _fedex_configured(rate=11.25):
        amount = run(shop_shipping.quote_for_cart(lines, ADDRESS))
    assert amount == 11.25


# ─────────────────────────────────────────────── _price_shop_cart ─────

def test_price_shop_cart_adds_the_shipping_amount_to_the_total():
    user = _client()
    product = _product(price=40.0, weight=2.0)
    with _fedex_configured(rate=8.0):
        priced = run(server._price_shop_cart(
            [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
            client_id=user["client_id"], shipping_address=ADDRESS,
        ))
    assert priced["shipping_amount"] == 8.0
    assert priced["total"] == 48.0
    assert priced["shipping_address"]["city"] == "Dayton"


def test_price_shop_cart_refuses_shipping_a_non_shippable_product():
    user = _client()
    product = _product(shippable=False, weight=None)
    with _fedex_configured():
        try:
            run(server._price_shop_cart(
                [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
                client_id=user["client_id"], shipping_address=ADDRESS,
            ))
            assert False
        except HTTPException as e:
            assert e.status_code == 400


def test_pickup_cart_is_unaffected_when_no_address_is_given():
    user = _client()
    product = _product(price=40.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)], client_id=user["client_id"]))
    assert priced["shipping_amount"] == 0.0 and priced["shipping_address"] is None
    assert priced["total"] == 40.0


# ──────────────────────────────────────────── real checkout + status ──

def test_a_shipped_order_gets_the_right_status_split():
    user = _client()
    product = _product(price=40.0, weight=2.0)
    with _fedex_configured(rate=10.0):
        order = _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
                     shipping_address=ADDRESS)
    assert order["total"] == 50.0
    assert order["shipping_amount"] == 10.0
    assert order["shipping_address"]["city"] == "Dayton"
    assert order["shipping_status"] == "preparing"
    assert order["pickup_status"] == "not_applicable"  # nothing to pick up — it ships


def test_a_pickup_order_still_gets_the_old_pickup_status_and_no_shipping():
    user = _client()
    product = _product(price=40.0)
    order = _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)])
    assert order["pickup_status"] == "preparing"
    assert order["shipping_status"] == "not_applicable"
    assert order["shipping_amount"] == 0.0


def test_mark_shipped_transitions_once_stamps_tracking_and_emails():
    user = _client()
    product = _product(price=40.0, weight=2.0)
    with _fedex_configured(rate=10.0):
        order = _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
                     shipping_address=ADDRESS)
    with patch("domains.shop.shipping.email_shipped", AsyncMock(return_value={"state": "sent", "to": "x@example.com"})) as mock_email:
        result = run(server.mark_shop_order_shipped(
            order["id"], server.ShopOrderMarkShippedIn(tracking_number="1Z999AA10123456784"), STAFF))
    assert result["shipping_status"] == "shipped"
    assert result["tracking_number"] == "1Z999AA10123456784"
    assert result["shipped_at"]
    assert mock_email.await_count == 1

    # repeating is a safe no-op, not a second email
    with patch("domains.shop.shipping.email_shipped", AsyncMock()) as second_call:
        again = run(server.mark_shop_order_shipped(order["id"], server.ShopOrderMarkShippedIn(), STAFF))
    assert again["shipping_status"] == "shipped"
    assert second_call.await_count == 0


def test_mark_shipped_refuses_a_pickup_order():
    user = _client()
    product = _product(price=40.0)
    order = _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)])
    try:
        run(server.mark_shop_order_shipped(order["id"], server.ShopOrderMarkShippedIn(), STAFF))
        assert False
    except HTTPException as e:
        assert e.status_code == 400 and "nothing to ship" in e.detail
