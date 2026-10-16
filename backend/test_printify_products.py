"""Printify POD products — Phase 1 (foundation): a new sales_destination,
"printify", that is still sold and paid for here (register + eventually
the client Shop) unlike the existing shopify_external link-out card.

Covers: create/update validation (needs a Printify product id and a
Printify variant id per size), duplicate clears those ids, register
catalog includes it with variants always "in stock" (Printify makes each
on demand), register checkout skips the variant stock check for it, and
(own-Shop Phase 2) the client Shop catalog/cart now carry real variant
pricing and require a size choice before a Printify line can be priced.

Disposable tag TEST_PRINTIFY_PRODUCTS.
"""
import uuid
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_PRINTIFY_PRODUCTS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "printify@test"}


async def _noop(*args, **kwargs):
    return None


class _OpenRegisterDay:
    """Same helper as test_pos_product_variants.py — opens (and only
    cleans up a day it itself opened) the cash-drawer day a register sale
    requires."""
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
        "name": f"{TAG} Hoodie",
        "sales_destination": "printify",
        "printify_product_id": "pf-prod-1",
        "price": 40.0,
        "variants": [
            {"name": "Small", "printify_variant_id": "pf-var-s"},
            {"name": "Medium", "printify_variant_id": "pf-var-m"},
        ],
    }
    body.update(overrides)
    return body


def _create(**overrides):
    return run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(**overrides)), ADMIN))


def _cleanup(product_ids):
    run(server.db.pos_products.delete_many({"id": {"$in": product_ids}}))


def test_create_requires_a_printify_product_id():
    try:
        run(server.create_pos_product(
            server.PosProductCreateIn(**_printify_body(printify_product_id="")), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Printify product ID" in e.detail


def test_create_requires_at_least_one_variant():
    try:
        run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(variants=[])), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "size/option" in e.detail


def test_create_requires_a_printify_variant_id_on_every_size():
    try:
        run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(
            variants=[{"name": "Small", "printify_variant_id": "pf-var-s"}, {"name": "Medium"}],
        )), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Medium" in e.detail


def test_create_keeps_price_variants_and_forces_off_stock_tracking():
    p = _create()
    try:
        assert p["sales_destination"] == "printify"
        assert p["printify_product_id"] == "pf-prod-1"
        assert p["price"] == 40.0
        assert p["track_inventory"] is False
        assert p["low_stock_threshold"] is None
        assert len(p["variants"]) == 2
        names_to_pfid = {v["name"]: v["printify_variant_id"] for v in p["variants"]}
        assert names_to_pfid == {"Small": "pf-var-s", "Medium": "pf-var-m"}
        # Unlike shopify_external, a printify listing never touches these.
        assert p["shopify_product_url"] is None
    finally:
        _cleanup([p["id"]])


def test_create_persists_the_blueprint_and_print_provider_ids():
    # Captured by the "Fetch Sizes" picker (GET /admin/printify/products/{id})
    # alongside the variant ids — needed later to look up real shipping cost.
    p = _create(printify_blueprint_id=6, printify_print_provider_id=99)
    try:
        assert p["printify_blueprint_id"] == 6
        assert p["printify_print_provider_id"] == 99
    finally:
        _cleanup([p["id"]])


def test_switching_away_from_printify_clears_the_blueprint_and_provider_ids():
    p = _create(printify_blueprint_id=6, printify_print_provider_id=99)
    try:
        updated = run(server.update_pos_product(
            p["id"],
            server.PosProductIn(name=f"{TAG} Hoodie", sales_destination="internal", price=40.0),
            ADMIN,
        ))
        assert updated["printify_blueprint_id"] is None
        assert updated["printify_print_provider_id"] is None
    finally:
        _cleanup([p["id"]])


def test_update_re_validates_printify_variants():
    p = _create()
    try:
        patch = {**_printify_body(), "variants": [
            {"id": p["variants"][0]["id"], "name": "Small", "printify_variant_id": "pf-var-s"},
            {"id": p["variants"][1]["id"], "name": "Medium"},  # dropped its printify_variant_id
        ]}
        try:
            run(server.update_pos_product(p["id"], server.PosProductIn(**patch), ADMIN))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "Medium" in e.detail
    finally:
        _cleanup([p["id"]])


def test_update_can_add_a_new_size_with_its_own_printify_variant_id():
    p = _create()
    try:
        patch = {**_printify_body(), "variants": [
            {"id": p["variants"][0]["id"], "name": "Small", "printify_variant_id": "pf-var-s"},
            {"id": p["variants"][1]["id"], "name": "Medium", "printify_variant_id": "pf-var-m"},
            {"name": "Large", "printify_variant_id": "pf-var-l"},
        ]}
        updated = run(server.update_pos_product(p["id"], server.PosProductIn(**patch), ADMIN))
        assert len(updated["variants"]) == 3
        large = next(v for v in updated["variants"] if v["name"] == "Large")
        assert large["printify_variant_id"] == "pf-var-l"
        assert large["stock_on_hand"] == 0.0
    finally:
        _cleanup([p["id"]])


def test_duplicate_clears_printify_links_so_two_listings_never_share_one_printify_product():
    p = _create()
    try:
        dup = run(server.duplicate_pos_product(p["id"], ADMIN))
        try:
            assert dup["sales_destination"] == "printify"
            assert dup["printify_product_id"] is None
            assert all(v.get("printify_variant_id") is None for v in dup["variants"])
            assert all(v["id"] != orig["id"] for v, orig in zip(dup["variants"], p["variants"]))
        finally:
            _cleanup([dup["id"]])
    finally:
        _cleanup([p["id"]])


def test_register_catalog_includes_it_with_every_size_always_in_stock():
    p = _create()
    try:
        catalog = run(server.get_register_catalog(client_id=None, user=ADMIN))
        item = next(i for i in catalog["items"] if i["id"] == p["id"])
        assert item["track_inventory"] is False
        assert item["in_stock"] is True
        assert len(item["variants"]) == 2
        assert all(v["in_stock"] is True for v in item["variants"])
    finally:
        _cleanup([p["id"]])


def test_register_checkout_skips_the_variant_stock_check_for_printify():
    p = _create()
    try:
        variant_id = p["variants"][0]["id"]
        line = server.PosSaleLineIn(kind="retail", product_id=p["id"], variant_id=variant_id, qty=500)
        # 500 units of a variant with stock_on_hand == 0 would refuse for any
        # ordinary variant product — it must NOT refuse here.
        priced, _caches = run(server._price_pos_cart([line], None, can_price=True, client_id=None))
        line_item = priced["line_items"][0]
        assert line_item["qty"] == 500
        assert line_item["unit_price"] == 40.0
    finally:
        _cleanup([p["id"]])


def test_client_shop_catalog_includes_it_with_its_real_variants():
    # Own-Shop Phase 2 — Printify items are no longer register-only; the
    # catalog now carries each size with its own price (falling back to
    # the product's base price when a size has no override of its own).
    p = _create(show_online=True)
    try:
        catalog = run(server._build_shop_catalog(None))
        item = next((i for i in catalog["items"] if i["id"] == p["id"]), None)
        assert item is not None
        assert item["sales_destination"] == "printify"
        assert item["in_stock"] is True
        # The catalog's variant id is the row's own internal id (same one
        # the register's price_pos_cart matches on) — never the Printify
        # variant id, which is just an attribute of that row.
        assert {v["id"] for v in item["variants"]} == {v["id"] for v in p["variants"]}
        assert {v["name"] for v in item["variants"]} == {"Small", "Medium"}
        assert all(v["price"] == 40.0 for v in item["variants"])  # no per-size override in _printify_body
    finally:
        _cleanup([p["id"]])


def test_client_shop_checkout_requires_a_size_choice():
    p = _create(show_online=True)
    try:
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1)
        try:
            run(server._price_shop_cart([cart_item], client_id=None))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "size" in e.detail.lower()
    finally:
        _cleanup([p["id"]])


def test_client_shop_checkout_prices_a_chosen_size_from_the_real_variant():
    p = _create(show_online=True, variants=[
        {"name": "Small", "printify_variant_id": "pf-var-s"},
        {"name": "Medium", "printify_variant_id": "pf-var-m", "price_override": 45.0},
    ])
    try:
        medium_id = next(v["id"] for v in p["variants"] if v["name"] == "Medium")
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=2, variant_id=medium_id)
        priced = run(server._price_shop_cart([cart_item], client_id=None))
        line = priced["lines"][0]
        assert line["unit_price"] == 45.0
        assert line["quantity"] == 2
        assert line["variant_id"] == medium_id
        assert "Medium" in line["name"]
    finally:
        _cleanup([p["id"]])


def test_client_shop_checkout_refuses_a_variant_id_that_doesnt_belong_to_the_product():
    p = _create(show_online=True)
    try:
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1, variant_id="not-a-real-variant")
        try:
            run(server._price_shop_cart([cart_item], client_id=None))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "no longer available" in e.detail
    finally:
        _cleanup([p["id"]])


def test_normalize_cart_lines_keeps_different_sizes_of_the_same_product_separate():
    # Without variant_id in the aggregation key, a Small and a Medium of the
    # same shirt would silently combine into one line carrying only one of
    # the two variant ids — wrong size (or wrong price) for half the order.
    items = [
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=1, variant_id="small-id"),
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=2, variant_id="medium-id"),
    ]
    lines = server._normalize_cart_lines(items)
    assert len(lines) == 2
    by_variant = {l.variant_id: l.quantity for l in lines}
    assert by_variant == {"small-id": 1, "medium-id": 2}


def test_normalize_cart_lines_combines_two_requests_for_the_same_size():
    items = [
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=1, variant_id="small-id"),
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=2, variant_id="small-id"),
    ]
    lines = server._normalize_cart_lines(items)
    assert len(lines) == 1
    assert lines[0].quantity == 3
    assert lines[0].variant_id == "small-id"


def test_a_full_register_sale_of_a_printify_variant_commits_with_no_inventory_movement():
    """A real end-to-end register checkout, not just the pricing preview —
    the pricing-time stock check and the commit-time stock MUTATION are two
    separate code paths (price_pos_cart vs. _create_pos_sale_impl's own
    qty_by_variant loop), and only patching the first would still leave a
    printify sale failing here with "insufficient stock" at the register."""
    p = _create()
    sale_id = None
    try:
        variant_id = p["variants"][0]["id"]
        body = server.PosSaleIn(
            client_id=None,
            lines=[server.PosSaleLineIn(kind="retail", product_id=p["id"], variant_id=variant_id, qty=1)],
            tenders=[server.PosSaleTenderIn(method="cash", amount=40.0, tendered_amount=40.0)],
            idempotency_key=f"test-{uuid.uuid4()}",
            printify_fulfillment=server.PrintifyFulfillmentIn(method="pickup"),
        )
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(body, ADMIN))
        sale_id = result["pos_sale_id"]
        assert result["sale"]["line_items"][0]["variant_id"] == variant_id

        # Variant stock_on_hand is untouched (still 0 — never went negative)
        # and no inventory_movements row was written for it.
        refreshed = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        variant_after = next(v for v in refreshed["variants"] if v["id"] == variant_id)
        assert variant_after["stock_on_hand"] == 0.0
        movements = run(server.db.inventory_movements.find(
            {"product_id": p["id"], "variant_id": variant_id}, {"_id": 0}).to_list(10))
        assert movements == []
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            run(server.db.printify_order_outbox.delete_many({"source_id": sale_id}))
        _cleanup([p["id"]])


# ───────────────────── Phase 2 — pickup/ship at the register ─────────────────────

SHIP_ADDRESS = {
    "first_name": "Jordan", "last_name": "Rivers", "email": "jordan@example.com", "phone": "555-0100",
    "address1": "1 Main St", "address2": "", "city": "Columbus", "region": "OH", "zip": "43215", "country": "US",
}


def _sale_body(product_id, variant_id, fulfillment=None, qty=1, personalization=None):
    return server.PosSaleIn(
        client_id=None,
        lines=[server.PosSaleLineIn(kind="retail", product_id=product_id, variant_id=variant_id, qty=qty, personalization=personalization)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=40.0 * qty, tendered_amount=40.0 * qty)],
        idempotency_key=f"test-{uuid.uuid4()}",
        printify_fulfillment=fulfillment,
    )


def _cleanup_outbox(sale_ids):
    run(server.db.printify_order_outbox.delete_many({"source_id": {"$in": sale_ids}}))


def test_register_sale_refuses_a_printify_item_with_no_fulfillment_choice():
    p = _create()
    try:
        variant_id = p["variants"][0]["id"]
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            try:
                run(server.create_pos_sale(_sale_body(p["id"], variant_id), ADMIN))
                assert False, "should have been refused"
            except HTTPException as e:
                assert e.status_code == 400
                assert "pickup or shipping" in e.detail
    finally:
        _cleanup([p["id"]])


def test_register_sale_refuses_ship_with_no_address():
    p = _create()
    try:
        variant_id = p["variants"][0]["id"]
        fulfillment = server.PrintifyFulfillmentIn(method="ship")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            try:
                run(server.create_pos_sale(_sale_body(p["id"], variant_id, fulfillment), ADMIN))
                assert False, "should have been refused"
            except HTTPException as e:
                assert e.status_code == 400
                assert "shipping address" in e.detail
    finally:
        _cleanup([p["id"]])


def test_register_sale_with_pickup_queues_an_outbox_row_with_no_address():
    p = _create()
    sale_id = None
    try:
        variant_id = p["variants"][0]["id"]
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(p["id"], variant_id, fulfillment), ADMIN))
        sale_id = result["pos_sale_id"]
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row is not None
        assert row["status"] == "pending"
        assert row["fulfillment_method"] == "pickup"
        assert row["shipping_address"] is None
        assert row["printify_order_id"] is None
        assert row["attempts"] == 0
        assert len(row["line_items"]) == 1
        li = row["line_items"][0]
        assert li["printify_product_id"] == "pf-prod-1"
        assert li["printify_variant_id"] == "pf-var-s"
        assert li["quantity"] == 1
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            _cleanup_outbox([sale_id])
        _cleanup([p["id"]])


def test_register_sale_with_ship_queues_an_outbox_row_with_the_address():
    p = _create()
    sale_id = None
    try:
        variant_id = p["variants"][0]["id"]
        fulfillment = server.PrintifyFulfillmentIn(
            method="ship", shipping_address=server.PrintifyShippingAddressIn(**SHIP_ADDRESS))
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(p["id"], variant_id, fulfillment), ADMIN))
        sale_id = result["pos_sale_id"]
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row["fulfillment_method"] == "ship"
        assert row["shipping_address"]["city"] == "Columbus"
        assert row["shipping_address"]["email"] == "jordan@example.com"
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            _cleanup_outbox([sale_id])
        _cleanup([p["id"]])


def test_register_sale_with_no_printify_items_never_requires_fulfillment_or_queues_anything():
    internal = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Plain Item", price=10.0, track_inventory=False), ADMIN))
    sale_id = None
    try:
        body = server.PosSaleIn(
            client_id=None,
            lines=[server.PosSaleLineIn(kind="retail", product_id=internal["id"], qty=1)],
            tenders=[server.PosSaleTenderIn(method="cash", amount=10.0, tendered_amount=10.0)],
            idempotency_key=f"test-{uuid.uuid4()}",
        )
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(body, ADMIN))
        sale_id = result["pos_sale_id"]
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        assert row is None
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
        _cleanup([internal["id"]])


# ── Personalization (text layers — e.g. a pet tag's Name/Phone) ────────────

PET_TAG_PRINT_AREAS = [{
    "variant_ids": ["pf-var-s"],
    "placeholders": [
        {"position": "front", "images": [
            {"id": "logo-id", "name": "logo.png", "type": "image/png", "height": 1254, "width": 1254,
             "x": 0.5, "y": 0.5, "scale": 0.6, "angle": 0, "layerType": "image"},
        ], "decoration_method": "dye-sublimation"},
        {"position": "back", "images": [
            {"id": "name-layer", "name": "Name", "type": "text/svg", "width": 714, "x": 0.5, "y": 0.35,
             "font_family": "Open Sans", "font_size": 200, "font_color": "#000000", "input_text": "Name", "layerType": "text"},
            {"id": "phone-layer", "name": "Phone", "type": "text/svg", "width": 714, "x": 0.5, "y": 0.5,
             "font_family": "Open Sans", "font_size": 200, "font_color": "#000000", "input_text": "Phone", "layerType": "text"},
        ], "decoration_method": "dye-sublimation"},
    ],
    "background": "#ffffff", "canvas": False,
}]


def _create_personalized(**overrides):
    return _create(printify_print_areas=PET_TAG_PRINT_AREAS, **overrides)


def test_create_derives_personalization_fields_from_print_areas():
    p = _create_personalized()
    try:
        assert p["printify_personalization_fields"] == ["Name", "Phone"]
    finally:
        _cleanup([p["id"]])


def test_create_with_no_print_areas_has_no_personalization_fields():
    p = _create()
    try:
        assert p["printify_personalization_fields"] == []
    finally:
        _cleanup([p["id"]])


def test_register_catalog_exposes_personalization_fields():
    p = _create_personalized()
    try:
        catalog = run(server.get_register_catalog(client_id=None, user=ADMIN))
        item = next(i for i in catalog["items"] if i["id"] == p["id"])
        assert item["personalization_fields"] == ["Name", "Phone"]
    finally:
        _cleanup([p["id"]])


def test_register_pricing_refuses_a_personalized_line_missing_fields():
    p = _create_personalized()
    try:
        variant_id = p["variants"][0]["id"]
        line = server.PosSaleLineIn(kind="retail", product_id=p["id"], variant_id=variant_id,
                                     personalization={"Name": "Rex"})  # Phone missing
        try:
            run(server._price_pos_cart([line], None, can_price=True, client_id=None))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "Phone" in e.detail
    finally:
        _cleanup([p["id"]])


def test_register_pricing_accepts_and_carries_personalization():
    p = _create_personalized()
    try:
        variant_id = p["variants"][0]["id"]
        line = server.PosSaleLineIn(kind="retail", product_id=p["id"], variant_id=variant_id,
                                     personalization={"Name": " Rex ", "Phone": "330-555-0101"})
        priced, _caches = run(server._price_pos_cart([line], None, can_price=True, client_id=None))
        li = priced["line_items"][0]
        # Trimmed, and only the fields the product actually declared.
        assert li["personalization"] == {"Name": "Rex", "Phone": "330-555-0101"}
    finally:
        _cleanup([p["id"]])


def test_register_sale_queues_an_outbox_row_carrying_personalization_and_the_template():
    p = _create_personalized()
    sale_id = None
    try:
        variant_id = p["variants"][0]["id"]
        fulfillment = server.PrintifyFulfillmentIn(method="pickup")
        body = _sale_body(p["id"], variant_id, fulfillment, personalization={"Name": "Rex", "Phone": "330-555-0101"})
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(body, ADMIN))
        sale_id = result["pos_sale_id"]
        row = run(server.db.printify_order_outbox.find_one({"source_id": sale_id}, {"_id": 0}))
        li = row["line_items"][0]
        assert li["personalization"] == {"Name": "Rex", "Phone": "330-555-0101"}
        assert li["printify_blueprint_id"] == p["printify_blueprint_id"]
        assert li["printify_print_provider_id"] == p["printify_print_provider_id"]
        assert li["printify_print_areas"] == PET_TAG_PRINT_AREAS
        assert li["unit_price_cents"] == 4000  # $40.00 base price, no variant override
    finally:
        if sale_id:
            run(server.db.pos_sales.delete_one({"id": sale_id}))
            _cleanup_outbox([sale_id])
        _cleanup([p["id"]])


def test_client_shop_checkout_refuses_a_personalized_line_missing_fields():
    p = _create_personalized(show_online=True)
    try:
        variant_id = next(v["id"] for v in p["variants"] if v["name"] == "Small")
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1, variant_id=variant_id,
                                           personalization={"Phone": "330-555-0101"})  # Name missing
        try:
            run(server._price_shop_cart([cart_item], client_id=None))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "Name" in e.detail
    finally:
        _cleanup([p["id"]])


def test_client_shop_checkout_prices_a_personalized_line_and_carries_its_text():
    p = _create_personalized(show_online=True)
    try:
        variant_id = next(v["id"] for v in p["variants"] if v["name"] == "Small")
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1, variant_id=variant_id,
                                           personalization={"Name": "Rex", "Phone": "330-555-0101"})
        priced = run(server._price_shop_cart([cart_item], client_id=None))
        assert priced["lines"][0]["personalization"] == {"Name": "Rex", "Phone": "330-555-0101"}
    finally:
        _cleanup([p["id"]])


def test_normalize_cart_lines_keeps_two_differently_personalized_lines_separate():
    items = [
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=1, variant_id="v1", personalization={"Name": "Rex"}),
        server.ShopCartItemIn(kind="product", ref_id="p1", quantity=1, variant_id="v1", personalization={"Name": "Buddy"}),
    ]
    lines = server._normalize_cart_lines(items)
    assert len(lines) == 2
    names = sorted(l.personalization["Name"] for l in lines)
    assert names == ["Buddy", "Rex"]


def test_normalize_cart_lines_refuses_quantity_greater_than_one_for_a_personalized_line():
    items = [server.ShopCartItemIn(kind="product", ref_id="p1", quantity=2, variant_id="v1", personalization={"Name": "Rex"})]
    try:
        server._normalize_cart_lines(items)
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 422
