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
import asyncio
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


@contextlib.contextmanager
def _fedex_label_configured(tracking="123456789012", label_b64="ZmFrZS1wZGY=", content_type="application/pdf"):
    label = fedex.ShipmentLabel(tracking_number=tracking, label_base64=label_b64, label_content_type=content_type)
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "create_ground_label", AsyncMock(return_value=label)) as mock_create:
        yield mock_create


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


# ──────────────────────────────── shipping labels (owner, 2026-10-18) ──
# "do the labels and shit in the app so i dont have to jump around
# sites" — a real FedEx Ground shipment + printable label, created and
# reprinted without ever leaving the Shop Manager. FedEx's Ship API call
# itself (fedex.create_ground_label) is always mocked here, same as
# quote_ground_rate above — see test_fedex_client.py for the API-shape
# coverage. This file tests the business rules: who's allowed to create
# one, exactly once per order, and where the result ends up.

def _shipped_order():
    """A paid, shippable order sitting in shipping_status == 'preparing'."""
    user = _client()
    product = _product(price=40.0, weight=2.0)
    with _fedex_configured(rate=10.0):
        return _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
                    shipping_address=ADDRESS)


def test_create_label_for_order_refuses_without_a_shipping_address():
    order = {"id": "x", "shipping_address": None, "lines": [{"kind": "product", "shipping_weight_lbs": 2.0, "quantity": 1}]}
    with _fedex_label_configured():
        try:
            run(shop_shipping.create_label_for_order(order))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "no shipping address" in e.detail


def test_create_label_for_order_refuses_with_nothing_to_ship():
    order = {"id": "x", "shipping_address": ADDRESS.model_dump(), "lines": [{"kind": "credit_pack", "quantity": 1}]}
    with _fedex_label_configured():
        try:
            run(shop_shipping.create_label_for_order(order))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "nothing" in e.detail


def test_create_label_for_order_fails_closed_when_fedex_is_not_configured():
    order = {"id": "x", "shipping_address": ADDRESS.model_dump(), "lines": [{"kind": "product", "shipping_weight_lbs": 2.0, "quantity": 1}]}
    with patch.object(fedex, "FEDEX_ENABLED", False):
        try:
            run(shop_shipping.create_label_for_order(order))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "isn't configured" in e.detail


def test_create_label_for_order_returns_the_real_fedex_label():
    order = {"id": "x", "shipping_address": ADDRESS.model_dump(),
             "lines": [{"kind": "product", "shipping_weight_lbs": 2.0, "quantity": 2}]}
    with _fedex_label_configured(tracking="999", label_b64="abc123") as mock_create:
        label = run(shop_shipping.create_label_for_order(order))
    assert label.tracking_number == "999" and label.label_base64 == "abc123"
    assert mock_create.await_args.kwargs["weight_lbs"] == 4.0  # 2.0 lbs x qty 2
    assert mock_create.await_args.kwargs["ship_to"].city == "Dayton"


def test_create_label_for_order_turns_a_fedex_error_into_a_clean_refusal():
    order = {"id": "x", "shipping_address": ADDRESS.model_dump(),
             "lines": [{"kind": "product", "shipping_weight_lbs": 2.0, "quantity": 1}]}
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "create_ground_label", AsyncMock(side_effect=fedex.FedexApiError(500, "boom"))):
        try:
            run(shop_shipping.create_label_for_order(order))
            assert False
        except HTTPException as e:
            assert e.status_code == 400 and "try again" in e.detail


def test_create_shipping_label_endpoint_stores_tracking_and_label_on_the_order():
    order = _shipped_order()
    with _fedex_label_configured(tracking="777", label_b64="xyz") as mock_create:
        out = run(server.create_shop_order_shipping_label(order["id"], STAFF))
    assert out == {"tracking_number": "777", "label_base64": "xyz", "label_content_type": "application/pdf"}
    assert mock_create.await_count == 1
    doc = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
    assert doc["tracking_number"] == "777" and doc["label_base64"] == "xyz" and doc["label_created_at"]
    assert doc["shipping_status"] == "preparing"  # creating a label doesn't itself mark it shipped


def test_create_shipping_label_endpoint_is_idempotent_never_calls_fedex_twice():
    order = _shipped_order()
    with _fedex_label_configured(tracking="777", label_b64="xyz") as mock_create:
        first = run(server.create_shop_order_shipping_label(order["id"], STAFF))
    with _fedex_label_configured(tracking="should-not-be-used", label_b64="should-not-be-used") as mock_second:
        second = run(server.create_shop_order_shipping_label(order["id"], STAFF))
    assert first == second
    assert mock_second.await_count == 0  # the stored label won, FedEx was never called again


def test_create_shipping_label_endpoint_claims_so_two_concurrent_calls_cant_both_hit_fedex():
    """Two near-simultaneous requests for the same order (double-click, a
    retry, two staff tabs) must never both reach the real, non-idempotent
    FedEx call — only one may win; the other must see the claim already
    held rather than racing past the "no label yet" check. Without
    shop_shipping.label_claim_held this reproduces as mock_create.await_count
    == 2 (a real double-billed FedEx shipment)."""
    order = _shipped_order()
    release = asyncio.Event()

    async def _slow_create(**kwargs):
        await release.wait()
        return fedex.ShipmentLabel(tracking_number="999", label_base64="abc", label_content_type="application/pdf")

    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "create_ground_label", AsyncMock(side_effect=_slow_create)) as mock_create:

        async def _race():
            first = asyncio.ensure_future(server.create_shop_order_shipping_label(order["id"], STAFF))
            await asyncio.sleep(0)  # let `first` start and take the claim before `second` is created
            second = asyncio.ensure_future(server.create_shop_order_shipping_label(order["id"], STAFF))
            await asyncio.sleep(0)  # let `second` hit the already-held claim
            release.set()
            return await asyncio.gather(first, second, return_exceptions=True)

        results = run(_race())

    assert mock_create.await_count == 1  # FedEx was only ever actually called once
    successes = [r for r in results if isinstance(r, dict)]
    busy = [r for r in results if isinstance(r, HTTPException) and r.status_code == 409]
    assert len(successes) == 1 and successes[0]["tracking_number"] == "999"
    assert len(busy) == 1


def test_create_shipping_label_endpoint_refuses_a_pickup_order():
    user = _client()
    product = _product(price=40.0)
    order = _pay(user, [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)])
    try:
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
        assert False
    except HTTPException as e:
        assert e.status_code == 400 and "nothing to ship" in e.detail


def test_create_shipping_label_endpoint_refuses_an_already_shipped_order():
    order = _shipped_order()
    run(server.db.shop_orders.update_one({"id": order["id"]}, {"$set": {"shipping_status": "shipped"}}))
    try:
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
        assert False
    except HTTPException as e:
        assert e.status_code == 400 and "already shipped" in e.detail


def test_get_shipping_label_endpoint_404s_until_one_exists_then_returns_it():
    order = _shipped_order()
    try:
        run(server.get_shop_order_shipping_label(order["id"], STAFF))
        assert False
    except HTTPException as e:
        assert e.status_code == 404

    with _fedex_label_configured(tracking="555", label_b64="reprint-me"):
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
    fetched = run(server.get_shop_order_shipping_label(order["id"], STAFF))
    assert fetched == {"tracking_number": "555", "label_base64": "reprint-me", "label_content_type": "application/pdf"}


def test_mark_shipped_keeps_the_label_tracking_number_when_none_is_typed_in():
    order = _shipped_order()
    with _fedex_label_configured(tracking="888", label_b64="abc"):
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
    with patch("domains.shop.shipping.email_shipped", AsyncMock(return_value={"state": "sent"})):
        result = run(server.mark_shop_order_shipped(order["id"], server.ShopOrderMarkShippedIn(), STAFF))
    assert result["shipping_status"] == "shipped"
    assert result["tracking_number"] == "888"  # the label's own number, not blanked out


def test_mark_shipped_lets_a_manually_typed_tracking_number_override_the_label():
    order = _shipped_order()
    with _fedex_label_configured(tracking="888", label_b64="abc"):
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
    with patch("domains.shop.shipping.email_shipped", AsyncMock(return_value={"state": "sent"})):
        result = run(server.mark_shop_order_shipped(
            order["id"], server.ShopOrderMarkShippedIn(tracking_number="HAND-DELIVERED"), STAFF))
    assert result["tracking_number"] == "HAND-DELIVERED"


def test_shop_orders_list_never_carries_the_label_pdf():
    order = _shipped_order()
    with _fedex_label_configured(tracking="321", label_b64="a-whole-pdf-worth-of-bytes"):
        run(server.create_shop_order_shipping_label(order["id"], STAFF))
    listing = run(server.list_shop_orders(None, STAFF))
    row = next(o for o in listing["orders"] if o["id"] == order["id"])
    assert "label_base64" not in row
    assert row["tracking_number"] == "321"  # the small, useful field still comes through
