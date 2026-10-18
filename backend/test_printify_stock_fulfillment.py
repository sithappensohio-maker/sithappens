"""Register-only stock-first fulfillment for Printify items (owner,
2026-10-18): "stock some of my printify items... so it doesn't just auto
make a new order." A Printify product can now opt into track_inventory
(previously hard-forced off); selling one at the REGISTER checks shelf
stock first. The online Shop never does — every online order still always
places a fresh Printify production order, unconditionally, exactly as
before this existed.

Three outcomes per line: full stock covers it (sells off the shelf, no
production order at all), zero stock (falls straight through to Printify,
today's unchanged behavior), or SOME stock but not enough (a genuine
choice — refused with a 409 until the cashier picks ship-partial-and-
order-the-rest or skip-the-shelf-and-order-it-all).

Disposable tag TEST_PRINTIFY_STOCK.
"""
import uuid
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_PRINTIFY_STOCK"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "printify-stock@test"}


async def _noop(*args, **kwargs):
    return None


class _OpenRegisterDay:
    """Same helper as test_printify_products.py — opens (and only cleans
    up a day it itself opened) the cash-drawer day a register sale needs."""
    def __init__(self):
        self.date = None
        self.marker = None
        self.created = False

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-register-{uuid.uuid4()}"
        before = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {
                "date": self.date, "opening_cash": 0.0, "notes": f"{TAG} disposable test register day",
                "suggested_opening_cash": None, "suggested_opening_from_date": None,
                "suggested_opening_from_closeout_id": None, "opening_override_reason": "", "opening_was_overridden": False,
                "opened_at": server.now_iso(), "opened_by": self.marker, "opened_by_name": f"{TAG} fixture",
            }},
            upsert=True, projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _printify_body(**overrides):
    body = {
        "name": f"{TAG} Hoodie", "sales_destination": "printify",
        "printify_product_id": "pf-prod-1", "price": 40.0,
        "printify_blueprint_id": 6, "printify_print_provider_id": 99,
        "variants": [{"name": "Small", "printify_variant_id": "pf-var-s"}],
    }
    body.update(overrides)
    return body


def _create(**overrides):
    return run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(**overrides)), ADMIN))


def _set_variant_stock(product_id, variant_id, stock):
    run(server.db.pos_products.update_one(
        {"id": product_id, "variants.id": variant_id}, {"$set": {"variants.$.stock_on_hand": stock}}))


def _cleanup(product_ids):
    run(server.db.pos_products.delete_many({"id": {"$in": product_ids}}))


def _sale_body(product_id, variant_id, qty=1, printify_use_stock=None, fulfillment=None):
    return server.PosSaleIn(
        client_id=None,
        lines=[server.PosSaleLineIn(kind="retail", product_id=product_id, variant_id=variant_id, qty=qty,
                                     printify_use_stock=printify_use_stock)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=40.0 * qty, tendered_amount=40.0 * qty)],
        idempotency_key=f"test-{uuid.uuid4()}",
        printify_fulfillment=fulfillment,
    )


def test_a_printify_product_can_now_opt_into_tracking_stock():
    p = _create(track_inventory=True, low_stock_threshold=2)
    try:
        assert p["track_inventory"] is True
        assert p["low_stock_threshold"] == 2
    finally:
        _cleanup([p["id"]])


def test_untracked_printify_product_still_defaults_to_no_stock_tracking():
    # Unchanged default — opting in is explicit, never implied.
    p = _create()
    try:
        assert p["track_inventory"] is False
        assert p["low_stock_threshold"] is None
    finally:
        _cleanup([p["id"]])


def test_full_stock_sells_off_the_shelf_with_no_production_order_at_all():
    p = _create(track_inventory=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 5)
    sale_id = None
    try:
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(p["id"], variant_id, qty=2), ADMIN))
        sale_id = result["pos_sale_id"]
        # No Printify order for a fully-stocked line.
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row is None
        # Stock went down by exactly what was sold, with a real movement row.
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 3.0
        movement = run(server.db.inventory_movements.find_one({"product_id": p["id"], "variant_id": variant_id}, {"_id": 0}))
        assert movement is not None
        assert movement["quantity_delta"] == -2
        assert movement["pos_sale_id"] == sale_id
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


def test_zero_stock_falls_straight_through_to_printify_unchanged():
    p = _create(track_inventory=True)  # stock_on_hand defaults to 0
    variant_id = p["variants"][0]["id"]
    sale_id = None
    try:
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop), \
             patch.object(server.printify_client, "estimate_cart_shipping_cents", AsyncMock(return_value=0)):
            result = run(server.create_pos_sale(_sale_body(p["id"], variant_id, qty=3, fulfillment=fulfillment), ADMIN))
        sale_id = result["pos_sale_id"]
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row is not None
        assert row["line_items"][0]["quantity"] == 3
        # Nothing to deduct — no movement row at all.
        movement = run(server.db.inventory_movements.find_one({"product_id": p["id"], "variant_id": variant_id}, {"_id": 0}))
        assert movement is None
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


def test_partial_stock_with_no_decision_refuses_with_the_structured_409():
    p = _create(track_inventory=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 1)
    try:
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            try:
                run(server.create_pos_sale(_sale_body(p["id"], variant_id, qty=3), ADMIN))
                assert False, "should have been refused pending a decision"
            except HTTPException as e:
                assert e.status_code == 409
                assert e.detail["code"] == "printify_stock_decision_needed"
                line = e.detail["lines"][0]
                assert line["product_id"] == p["id"]
                assert line["variant_id"] == variant_id
                assert line["requested"] == 3
                assert line["available"] == 1
        # Refused before anything committed — no sale, no outbox row, no stock movement.
        assert run(server.db.pos_sales.count_documents({"client_id": None, "line_items.product_id": p["id"]})) == 0
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 1.0
    finally:
        _cleanup([p["id"]])


def test_partial_stock_choosing_ship_now_splits_stock_and_printify():
    p = _create(track_inventory=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 1)
    sale_id = None
    try:
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop), \
             patch.object(server.printify_client, "estimate_cart_shipping_cents", AsyncMock(return_value=0)):
            result = run(server.create_pos_sale(
                _sale_body(p["id"], variant_id, qty=3, printify_use_stock=True, fulfillment=fulfillment), ADMIN))
        sale_id = result["pos_sale_id"]
        # The 1 on hand is deducted...
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 0.0
        movement = run(server.db.inventory_movements.find_one({"product_id": p["id"], "variant_id": variant_id}, {"_id": 0}))
        assert movement["quantity_delta"] == -1
        # ...and only the remaining 2 go to Printify, not the full 3.
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row is not None
        assert row["line_items"][0]["quantity"] == 2
        # The sale itself still recorded the full quantity actually sold/charged.
        assert result["sale"]["line_items"][0]["qty"] == 3
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


def test_partial_stock_choosing_order_all_skips_the_shelf_entirely():
    p = _create(track_inventory=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 1)
    sale_id = None
    try:
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop), \
             patch.object(server.printify_client, "estimate_cart_shipping_cents", AsyncMock(return_value=0)):
            result = run(server.create_pos_sale(
                _sale_body(p["id"], variant_id, qty=3, printify_use_stock=False, fulfillment=fulfillment), ADMIN))
        sale_id = result["pos_sale_id"]
        # Stock on the shelf is left untouched...
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 1.0
        movement = run(server.db.inventory_movements.find_one({"product_id": p["id"], "variant_id": variant_id}, {"_id": 0}))
        assert movement is None
        # ...and the FULL quantity is ordered from Printify.
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row["line_items"][0]["quantity"] == 3
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


def test_voiding_a_partially_stocked_sale_restores_only_what_actually_left_the_shelf():
    # The "every variant sale deducts exactly qty, so void always restores
    # exactly qty" rule every other variant product follows doesn't hold for
    # a printify line split between stock and Printify — voiding it must
    # restore only the 1 that actually came off the shelf, never the full
    # 3 that were sold (2 of which were never physically on hand at all).
    p = _create(track_inventory=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 1)
    sale_id = None
    try:
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop), \
             patch.object(server.printify_client, "estimate_cart_shipping_cents", AsyncMock(return_value=0)):
            result = run(server.create_pos_sale(
                _sale_body(p["id"], variant_id, qty=3, printify_use_stock=True, fulfillment=fulfillment), ADMIN))
            sale_id = result["pos_sale_id"]
            run(server.void_pos_sale(
                sale_id, server.PosSaleVoidIn(reason=f"{TAG} test void", idempotency_key=f"{TAG}-void-{uuid.uuid4()}"), ADMIN))
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 1.0  # back to where it started, not 3
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


# ───────────────────── Online Shop never considers stock ─────────────────────

class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


class _StripeMocked:
    def __enter__(self):
        self._orig_customer_create = server.stripe.Customer.create
        self._orig_session_create = server.stripe.checkout.Session.create
        server.stripe.Customer.create = lambda **kw: _FakeStripeObj(id="cus_test_" + uuid.uuid4().hex[:8])
        server.stripe.checkout.Session.create = lambda **kw: _FakeStripeObj(
            id="cs_test_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/x")
        return self

    def __exit__(self, *exc):
        server.stripe.Customer.create = self._orig_customer_create
        server.stripe.checkout.Session.create = self._orig_session_create
        return False


def _shop_client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Shop Client", "email": f"{cid[:8]}@example.com",
                                      "credits": 0, "training_credits": 0, "created_at": server.now_iso()}))
    return cid, {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Shop Client"}


def _shop_pay(user, items, printify_fulfillment=None):
    with _StripeMocked():
        out = run(server.create_shop_checkout(
            server.ShopCheckoutIn(items=items, idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                                   printify_fulfillment=printify_fulfillment), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(
        id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
        amount_total=server._stripe_amount_cents(order["total"]),
        metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))


def _cleanup_shop_order(cid, order_id):
    run(server.db.payments.delete_many({"shop_order_id": order_id}))
    run(server.db.retail_sales.delete_many({"shop_order_id": order_id}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts"):
        run(server.db[coll].delete_many({"client_id": cid}))
    run(server.db.printify_order_outbox.delete_many({"source_id": order_id}))
    run(server.db.clients.delete_one({"id": cid}))


def test_online_shop_order_always_orders_fresh_regardless_of_stock_on_hand():
    # Full stock on hand — if the Shop looked at stock the way the register
    # now does, this would sell off the shelf with no production order.
    # It must still queue the real order every time; register-only.
    p = _create(track_inventory=True, show_online=True)
    variant_id = p["variants"][0]["id"]
    _set_variant_stock(p["id"], variant_id, 10)
    cid, user = _shop_client()
    order = None
    try:
        with patch.object(server.printify_client, "estimate_cart_shipping_cents", AsyncMock(return_value=0)):
            order = _shop_pay(user, [server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=2, variant_id=variant_id)],
                               printify_fulfillment=server.ShopPrintifyFulfillmentIn(method="pickup"))
        row = run(server.db.printify_order_outbox.find_one({"source": "shop_order", "source_id": order["id"]}, {"_id": 0}))
        assert row is not None
        assert row["line_items"][0]["quantity"] == 2
        # Stock on the shelf is completely untouched by an online sale.
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 10.0
    finally:
        if order:
            _cleanup_shop_order(cid, order["id"])
        else:
            run(server.db.clients.delete_one({"id": cid}))
        _cleanup([p["id"]])
