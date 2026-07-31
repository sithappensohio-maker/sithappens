"""Focused regression tests for the Front Desk / register product-catalog
integration fix: `_build_register_catalog` (backing `GET /pos/catalog`) and
the client-specific pricing fix inside `_price_pos_cart`.

Bug this locks in: the Front Desk register only ever queried the narrow,
physical-products-only `/pos/products` endpoint, so items configured as
credit packs, training programs, or filed under the real category taxonomy
never appeared ("No products found" even though items existed and were
marked Show on Register). A second bug — `_price_pos_cart` never resolved
client-specific/grandfathered pricing at all, charging every retail line the
raw catalog price regardless of who was buying.

Calls the async server functions directly via a single shared event loop
(no pytest-asyncio dependency, no HTTP layer) against this environment's
real MongoDB. Every test creates its own disposable rows, tagged
`"TEST_POS_CATALOG"`, and deletes them in a `finally` block.
"""
import uuid

import server
from _test_loop import run  # shared across every test_*.py file — see its docstring


TAG = "TEST_POS_CATALOG"


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "name": f"{TAG} product",
        "description": "",
        "sku": "",
        "category": "",
        "price": 20.0,
        "active": True,
        "archived": False,
        "show_at_register": True,
        "track_inventory": False,
        "stock_on_hand": 0,
        "category_id": None,
        "subcategory_id": None,
        "featured": False,
        "image_id": None,
    }
    doc.update(overrides)
    return doc


def _pack(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "name": f"{TAG} pack",
        "price": 100.0,
        "qty": 5,
        "active": True,
        "show_at_register": True,
        "service_type": "daycare",
        "category_id": None,
        "subcategory_id": None,
        "featured": False,
        "image_id": None,
    }
    doc.update(overrides)
    return doc


def _program(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "name": f"{TAG} program",
        "price": 300.0,
        "format": {"count": 6, "unit": "sessions"},
        "active": True,
        "show_at_register": True,
        "type": "private_lessons",
        "min_age_months": 0,
        "category_id": None,
        "subcategory_id": None,
        "featured": False,
        "image_id": None,
    }
    doc.update(overrides)
    return doc


def test_register_only_visible_when_show_at_register_true():
    product = _product(show_at_register=True)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        catalog = run(server._build_register_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert product["id"] in ids
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_register_hidden_when_show_at_register_false():
    product = _product(show_at_register=False)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        catalog = run(server._build_register_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert product["id"] not in ids
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_archived_and_inactive_products_excluded():
    archived = _product(archived=True)
    inactive = _product(active=False)
    run(server.db.pos_products.insert_many([dict(archived), dict(inactive)]))
    try:
        catalog = run(server._build_register_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert archived["id"] not in ids
        assert inactive["id"] not in ids
    finally:
        run(server.db.pos_products.delete_many({"id": {"$in": [archived["id"], inactive["id"]]}}))


def test_shopify_external_product_excluded_from_register():
    # A walk-up register can't fulfill a Shopify-owned listing — this must
    # never appear even though show_at_register defaults True.
    product = _product(sales_destination="shopify_external")
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        catalog = run(server._build_register_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert product["id"] not in ids
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_credit_pack_and_training_program_appear_with_kind_tag():
    pack = _pack()
    program = _program()
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.programs.insert_one(dict(program)))
    try:
        catalog = run(server._build_register_catalog(None))
        by_id = {i["id"]: i for i in catalog["items"]}
        assert by_id[pack["id"]]["kind"] == "credit_pack"
        assert by_id[pack["id"]]["qty"] == 5
        assert by_id[pack["id"]]["value_each"] == 20.0  # 100 / 5
        assert by_id[program["id"]]["kind"] == "training_program"
        assert by_id[program["id"]]["format_count"] == 6
        assert by_id[program["id"]]["format_unit"] == "sessions"
    finally:
        run(server.db.credit_packs.delete_one({"id": pack["id"]}))
        run(server.db.programs.delete_one({"id": program["id"]}))


def test_credit_pack_hidden_when_show_at_register_false():
    pack = _pack(show_at_register=False)
    run(server.db.credit_packs.insert_one(dict(pack)))
    try:
        catalog = run(server._build_register_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert pack["id"] not in ids
    finally:
        run(server.db.credit_packs.delete_one({"id": pack["id"]}))


def test_product_carries_sku_field_for_search():
    product = _product(sku="TEST-SKU-001")
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        catalog = run(server._build_register_catalog(None))
        by_id = {i["id"]: i for i in catalog["items"]}
        assert by_id[product["id"]]["sku"] == "TEST-SKU-001"
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_price_pos_cart_walk_in_uses_standard_price():
    product = _product(price=30.0)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        line = server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1)
        priced, _cache = run(server._price_pos_cart([line], None, can_price=False, client_id=None))
        assert priced["line_items"][0]["unit_price"] == 30.0
        assert priced["line_items"][0]["has_price_override"] is False
        assert priced["total"] == 30.0
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_price_pos_cart_resolves_client_specific_override():
    # Locks in the Front Desk fix: retail lines must resolve grandfathered
    # pricing through resolve_client_price(), never the raw catalog price.
    product = _product(price=30.0)
    client = {"id": str(uuid.uuid4()), "name": f"{TAG} client", "role": "client"}
    override = {
        "id": str(uuid.uuid4()), "client_id": client["id"],
        "target_kind": "pos_product", "target_code": product["id"],
        "override_price": 12.5,
    }
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.clients.insert_one(dict(client)))
    run(server.db.price_overrides.insert_one(dict(override)))
    try:
        line = server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=2)
        priced, _cache = run(server._price_pos_cart([line], None, can_price=False, client_id=client["id"]))
        li = priced["line_items"][0]
        assert li["unit_price"] == 12.5
        assert li["list_price"] == 30.0
        assert li["has_price_override"] is True
        assert priced["total"] == 25.0  # 12.5 * 2

        # Walk-in (no client_id) on the exact same product must still see
        # the standard price — the override must never leak.
        priced_walk_in, _ = run(server._price_pos_cart([line], None, can_price=False, client_id=None))
        assert priced_walk_in["line_items"][0]["unit_price"] == 30.0
        assert priced_walk_in["line_items"][0]["has_price_override"] is False
    finally:
        run(server.db.price_overrides.delete_one({"id": override["id"]}))
        run(server.db.clients.delete_one({"id": client["id"]}))
        run(server.db.pos_products.delete_one({"id": product["id"]}))


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
