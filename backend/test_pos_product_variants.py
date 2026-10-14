"""Product variants (size/color options) — Phase 5 inventory work.

One product, several options, each with its own barcode-scannable sku,
its own stock, and an optional price different from the base product.
Register-only in this phase (not the online Shop). Covers: create/edit
reconciliation (_reconcile_pos_product_variants — the one place that
decides create-vs-keep-vs-refuse-removal), the dedicated variant stock
endpoint, and the full POS checkout/void path for a variant line, since
that's real money moving against the wrong bucket if it's wrong.

Disposable tag TEST_POS_PRODUCT_VARIANTS.
"""
import uuid
from unittest.mock import patch

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_POS_PRODUCT_VARIANTS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "variants@test"}


async def _noop(*args, **kwargs):
    return None


def _cleanup(product_ids):
    async def go():
        await server.db.pos_products.delete_many({"id": {"$in": product_ids}})
        await server.db.inventory_movements.delete_many({"product_id": {"$in": product_ids}})
        await server.db.pos_sales.delete_many({"line_items.product_id": {"$in": product_ids}})
    run(go())


def _create(**overrides):
    body = {
        "name": f"{TAG} Tee", "price": 20.0, "track_inventory": False,
        "variants": [{"name": "Small", "sku": f"{TAG}-S", "starting_stock": 3},
                     {"name": "Medium", "sku": f"{TAG}-M", "starting_stock": 1}],
    }
    body.update(overrides)
    result = run(server.create_pos_product(server.PosProductCreateIn(**body), ADMIN))
    return result


class _OpenRegisterDay:
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


# ----------------------------------------------------------- create/reconcile

def test_create_assigns_a_fresh_id_and_starting_stock_to_each_variant():
    product = _create()
    try:
        assert len(product["variants"]) == 2
        small = next(v for v in product["variants"] if v["name"] == "Small")
        assert small["id"] and small["stock_on_hand"] == 3.0
        assert small["sku"] == f"{TAG}-S"
    finally:
        _cleanup([product["id"]])


def test_editing_an_existing_variant_by_id_preserves_its_stock():
    # A single-variant product, so the edit payload can't accidentally drop
    # a sibling the test isn't thinking about — that's its own test below.
    product = _create(variants=[{"name": "Small", "sku": f"{TAG}-S-solo", "starting_stock": 3}])
    try:
        small = product["variants"][0]
        updated = run(server.update_pos_product(product["id"], server.PosProductIn(
            name=product["name"], price=20.0, track_inventory=False,
            variants=[{"id": small["id"], "name": "Small (renamed)", "sku": "NEW-SKU", "starting_stock": 999}],
        ), ADMIN))
        assert len(updated["variants"]) == 1
        v = updated["variants"][0]
        assert v["id"] == small["id"]  # same variant, not a new one
        assert v["name"] == "Small (renamed)" and v["sku"] == "NEW-SKU"
        assert v["stock_on_hand"] == 3.0  # untouched — starting_stock is ignored on an edit of an existing row
    finally:
        _cleanup([product["id"]])


def test_adding_a_new_variant_on_edit_gets_its_own_fresh_stock():
    product = _create()
    try:
        small = next(v for v in product["variants"] if v["name"] == "Small")
        medium = next(v for v in product["variants"] if v["name"] == "Medium")
        updated = run(server.update_pos_product(product["id"], server.PosProductIn(
            name=product["name"], price=20.0, track_inventory=False,
            # Both existing variants echoed back (by id) so neither is
            # treated as removed — only "Large" is actually new here.
            variants=[{"id": small["id"], "name": "Small"}, {"id": medium["id"], "name": "Medium"},
                      {"name": "Large", "sku": f"{TAG}-L", "starting_stock": 5}],
        ), ADMIN))
        assert len(updated["variants"]) == 3
        large = next(v for v in updated["variants"] if v["name"] == "Large")
        assert large["id"] not in (small["id"], medium["id"])
        assert large["stock_on_hand"] == 5.0
        # The two pre-existing variants are untouched, not recreated.
        assert next(v for v in updated["variants"] if v["name"] == "Small")["stock_on_hand"] == 3.0
        assert next(v for v in updated["variants"] if v["name"] == "Medium")["stock_on_hand"] == 1.0
    finally:
        _cleanup([product["id"]])


def test_removing_a_variant_with_stock_is_refused():
    product = _create()
    try:
        with pytest.raises(server.HTTPException) as exc_info:
            run(server.update_pos_product(product["id"], server.PosProductIn(
                name=product["name"], price=20.0, track_inventory=False, variants=[],  # drops both Small (stock 3) and Medium (stock 1)
            ), ADMIN))
        assert exc_info.value.status_code == 409
        assert "still has stock" in exc_info.value.detail
    finally:
        _cleanup([product["id"]])


def test_removing_a_variant_with_zero_stock_is_allowed():
    product = _create(variants=[{"name": "OneOnly", "sku": f"{TAG}-ZERO", "starting_stock": 0}])
    try:
        updated = run(server.update_pos_product(product["id"], server.PosProductIn(
            name=product["name"], price=20.0, track_inventory=False, variants=[],
        ), ADMIN))
        assert updated["variants"] == []
    finally:
        _cleanup([product["id"]])


def test_duplicating_a_variant_product_gives_every_variant_a_fresh_id_and_zero_stock():
    product = _create()
    dup = None
    try:
        dup = run(server.duplicate_pos_product(product["id"], ADMIN))
        assert len(dup["variants"]) == 2
        original_ids = {v["id"] for v in product["variants"]}
        for v in dup["variants"]:
            assert v["id"] not in original_ids
            assert v["stock_on_hand"] == 0.0
            assert v["sku"] is None  # never copies a barcode onto a second physical item
    finally:
        _cleanup([product["id"], dup["id"]] if dup else [product["id"]])


def test_a_shopify_linked_product_never_carries_variants():
    product = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Shopify Tee", sales_destination="shopify_external", shopify_product_url="https://example.myshopify.com/products/tee",
        variants=[{"name": "Small", "starting_stock": 3}],
    ), ADMIN))
    try:
        assert product["variants"] == []
    finally:
        _cleanup([product["id"]])


# ------------------------------------------------------- the dedicated endpoint

def test_adjust_variant_stock_writes_a_movement_tagged_with_the_variant():
    product = _create()
    try:
        small = next(v for v in product["variants"] if v["name"] == "Small")
        result = run(server.adjust_pos_product_variant_stock(
            product["id"], small["id"], server.InventoryAdjustIn(quantity_delta=5, reason="Shipment", source="RESTOCK"), ADMIN))
        assert result["stock_on_hand"] == 8.0  # 3 + 5
        movement = result["movement"]
        assert movement["variant_id"] == small["id"] and movement["product_id"] == product["id"]

        # The SIBLING variant (Medium) is untouched.
        refreshed = run(server.db.pos_products.find_one({"id": product["id"]}, {"_id": 0}))
        medium = next(v for v in refreshed["variants"] if v["name"] == "Medium")
        assert medium["stock_on_hand"] == 1.0
    finally:
        _cleanup([product["id"]])


def test_adjust_variant_stock_refuses_an_unknown_variant_id():
    product = _create()
    try:
        with pytest.raises(server.HTTPException) as exc_info:
            run(server.adjust_pos_product_variant_stock(
                product["id"], "not-a-real-variant", server.InventoryAdjustIn(quantity_delta=1, reason="test", source="RESTOCK"), ADMIN))
        assert exc_info.value.status_code == 404
    finally:
        _cleanup([product["id"]])


# ------------------------------------------------------------- the register

def test_register_catalog_reports_each_variants_own_price_and_stock():
    product = _create(variants=[{"name": "Small", "sku": f"{TAG}-S", "starting_stock": 3, "price_override": 25.0},
                                 {"name": "Large", "sku": f"{TAG}-L", "starting_stock": 0}])
    try:
        catalog = run(server._build_register_catalog(None))
        item = next(i for i in catalog["items"] if i["id"] == product["id"])
        small = next(v for v in item["variants"] if v["name"] == "Small")
        large = next(v for v in item["variants"] if v["name"] == "Large")
        assert small["price"] == 25.0 and small["in_stock"] is True
        assert large["price"] == 20.0 and large["in_stock"] is False  # falls back to the product's own price
    finally:
        _cleanup([product["id"]])


# ----------------------------------------------------------------- checkout

def _sale_body(product_id, variant_id, qty=1):
    return server.PosSaleIn(
        client_id=None,
        lines=[server.PosSaleLineIn(kind="retail", product_id=product_id, variant_id=variant_id, qty=qty)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=20.0, tendered_amount=20.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )


def test_selling_a_variant_deducts_only_that_variants_stock():
    product = _create()
    sale_id = None
    try:
        small = next(v for v in product["variants"] if v["name"] == "Small")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(product["id"], small["id"]), ADMIN))
        sale_id = result["pos_sale_id"]
        assert result["sale"]["line_items"][0]["variant_id"] == small["id"]

        refreshed = run(server.db.pos_products.find_one({"id": product["id"]}, {"_id": 0}))
        small_after = next(v for v in refreshed["variants"] if v["id"] == small["id"])
        medium_after = next(v for v in refreshed["variants"] if v["name"] == "Medium")
        assert small_after["stock_on_hand"] == 2.0  # 3 - 1
        assert medium_after["stock_on_hand"] == 1.0  # untouched
    finally:
        _cleanup([product["id"]])


def test_selling_more_than_a_variant_has_in_stock_is_refused():
    product = _create(variants=[{"name": "Small", "sku": f"{TAG}-S2", "starting_stock": 1}])
    try:
        small = product["variants"][0]
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.create_pos_sale(_sale_body(product["id"], small["id"], qty=2), ADMIN))
        assert exc_info.value.status_code == 400
    finally:
        _cleanup([product["id"]])


def test_voiding_a_variant_sale_restores_that_variants_stock():
    product = _create()
    sale_id = None
    try:
        small = next(v for v in product["variants"] if v["name"] == "Small")
        with _OpenRegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(product["id"], small["id"]), ADMIN))
            sale_id = result["pos_sale_id"]
            run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(reason="test void", idempotency_key=f"test-{uuid.uuid4()}"), ADMIN))
        refreshed = run(server.db.pos_products.find_one({"id": product["id"]}, {"_id": 0}))
        small_after = next(v for v in refreshed["variants"] if v["id"] == small["id"])
        assert small_after["stock_on_hand"] == 3.0  # fully restored
    finally:
        _cleanup([product["id"]])
