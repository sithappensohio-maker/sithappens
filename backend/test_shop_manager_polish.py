"""Focused regression tests for the Admin Shop Utility Addendum — the parts
that live in the backend: `_shop_manager_item_view`'s new admin-only fields
(cost, missing_image, category_hidden), the Archived view's underlying data
(archive/restore + include_archived), and the existing inventory-movement
endpoints (adjust-stock / movements) that Receive Stock / Adjust Stock /
Stock History now surface in the Shop Manager UI.

None of this touches archive/restore backend behavior, inventory mutation
logic, or the admin order/fulfillment endpoints — those are all pre-existing
and exercised here only to confirm the new UI's data contract, never to
change what they do. Calls the async server functions directly via the
shared event loop (see _test_loop.py's docstring), same pattern as
test_pos_catalog.py.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run


TAG = "TEST_SHOP_MGR_POLISH"


class _AdminUser(dict):
    def get(self, key, default=None):
        return dict.get(self, key, default)


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "name": f"{TAG} product",
        "description": "",
        "sku": "",
        "category": "",
        "price": 25.0,
        "cost": None,
        "active": True,
        "archived": False,
        "show_at_register": True,
        "show_online": True,
        "track_inventory": True,
        "stock_on_hand": 10.0,
        "low_stock_threshold": 3.0,
        "category_id": None,
        "subcategory_id": None,
        "featured": False,
        "image_id": None,
        "online_description": "A fine product",
        "sales_destination": "internal",
    }
    doc.update(overrides)
    return doc


def test_shop_manager_item_view_exposes_admin_only_cost_never_zero_for_missing():
    product = _product(cost=None)
    view = server._shop_manager_item_view(product, "physical_product")
    assert view["cost"] is None  # never coerced to 0

    priced = _product(cost=12.5)
    view2 = server._shop_manager_item_view(priced, "physical_product")
    assert view2["cost"] == 12.5


def test_shop_manager_item_view_missing_image_flag():
    view = server._shop_manager_item_view(_product(image_id=None), "physical_product")
    assert view["missing_image"] is True
    view2 = server._shop_manager_item_view(_product(image_id="img-1"), "physical_product")
    assert view2["missing_image"] is False


def test_shop_manager_item_view_shopify_listing_never_exposes_cost():
    shopify = _product(sales_destination="shopify_external", cost=999.0)
    view = server._shop_manager_item_view(shopify, "physical_product")
    assert view["cost"] is None


def test_build_shop_catalog_never_exposes_cost_to_client_facing_endpoint():
    # The client Shop / Client Preview both call _build_shop_catalog — cost
    # must never leak through this function no matter what's stored.
    product = _product(cost=17.0, show_online=True)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        catalog = run(server._build_shop_catalog(None))
        item = next(i for i in catalog["items"] if i["id"] == product["id"])
        assert "cost" not in item
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))


def test_shop_catalog_returns_every_eligible_item_beyond_500_records():
    """Regression for the removed .to_list(500) cap in _build_shop_catalog:
    with far more than 500 online-visible products, a freshly created,
    distinctly-named product must still appear in the client Shop catalog —
    never silently dropped because an arbitrary page boundary was reached
    first."""
    bulk = [_product(name=f"{TAG}_BULK500 filler {i}", show_online=True) for i in range(520)]
    target = _product(name=f"{TAG} the one that must not vanish", sku="MUST-APPEAR-SHOP", show_online=True)
    run(server.db.pos_products.insert_many([dict(p) for p in bulk]))
    run(server.db.pos_products.insert_one(dict(target)))
    try:
        catalog = run(server._build_shop_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert target["id"] in ids
        assert len(catalog["items"]) >= 521
    finally:
        run(server.db.pos_products.delete_many({"id": {"$in": [p["id"] for p in bulk] + [target["id"]]}}))


def test_shop_manager_items_include_archived_returns_archived_rows():
    active_product = _product(archived=False)
    archived_product = _product(archived=True, active=False, show_online=False)
    run(server.db.pos_products.insert_many([dict(active_product), dict(archived_product)]))
    try:
        result = run(server.shop_manager_list_items(
            section=None, category_id=None, uncategorized_only=False, hidden_only=False,
            include_archived=True, search=None, user=_admin_user(),
        ))
        ids = {it["id"]: it for it in result["items"]}
        assert archived_product["id"] in ids
        assert ids[archived_product["id"]]["archived"] is True
        # include_archived mixes in everything else too (by design) — the
        # Archived VIEW's own client-side narrowing is what isolates just
        # the archived rows (see frontend/src/lib/shopManagerPolish.js).
        assert active_product["id"] in ids
        assert ids[active_product["id"]]["archived"] is False
    finally:
        run(server.db.pos_products.delete_many({"id": {"$in": [active_product["id"], archived_product["id"]]}}))


def test_shop_manager_items_excludes_archived_by_default():
    archived_product = _product(archived=True, active=False)
    run(server.db.pos_products.insert_one(dict(archived_product)))
    try:
        result = run(server.shop_manager_list_items(
            section=None, category_id=None, uncategorized_only=False, hidden_only=False,
            include_archived=False, search=None, user=_admin_user(),
        ))
        ids = {it["id"] for it in result["items"]}
        assert archived_product["id"] not in ids
    finally:
        run(server.db.pos_products.delete_one({"id": archived_product["id"]}))


def test_archive_then_restore_round_trip_via_existing_endpoints():
    product = _product(active=True, show_online=True)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        archived = run(server.archive_pos_product(product["id"], user=_admin_user()))
        assert archived["archived"] is True
        assert archived["active"] is False

        listed = run(server.shop_manager_list_items(
            section=None, category_id=None, uncategorized_only=False, hidden_only=False,
            include_archived=True, search=None, user=_admin_user(),
        ))
        by_id = {it["id"]: it for it in listed["items"]}
        assert by_id[product["id"]]["archived"] is True

        restored = run(server.restore_pos_product(product["id"], user=_admin_user()))
        assert restored["archived"] is False
        assert restored["active"] is True  # restored from archived_from_active snapshot

        listed_after = run(server.shop_manager_list_items(
            section=None, category_id=None, uncategorized_only=False, hidden_only=False,
            include_archived=False, search=None, user=_admin_user(),
        ))
        ids_after = {it["id"] for it in listed_after["items"]}
        assert product["id"] in ids_after  # visible again under the normal (non-archived) view
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))
        run(server.db.inventory_movements.delete_many({"product_id": product["id"]}))


def test_receive_stock_creates_positive_restock_movement():
    product = _product(track_inventory=True, stock_on_hand=5.0)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        body = server.InventoryAdjustIn(quantity_delta=10, reason="Shipment received", source="RESTOCK")
        result = run(server.adjust_pos_product_stock(product["id"], body, user=_admin_user()))
        assert result["stock_on_hand"] == 15.0
        assert result["movement"]["type"] == "RESTOCK"
        assert result["movement"]["quantity_delta"] == 10

        movements = run(server.list_inventory_movements(product["id"], limit=100, user=_admin_user()))
        assert len(movements) == 1
        assert movements[0]["type"] == "RESTOCK"
        assert movements[0]["stock_before"] == 5.0
        assert movements[0]["stock_after"] == 15.0
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))
        run(server.db.inventory_movements.delete_many({"product_id": product["id"]}))


def test_adjust_stock_records_manual_adjustment_movement_positive_or_negative():
    product = _product(track_inventory=True, stock_on_hand=8.0)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        body = server.InventoryAdjustIn(quantity_delta=-3, reason="Damaged in storage", source="MANUAL_ADJUSTMENT")
        result = run(server.adjust_pos_product_stock(product["id"], body, user=_admin_user()))
        assert result["stock_on_hand"] == 5.0
        assert result["movement"]["type"] == "MANUAL_ADJUSTMENT"
        assert result["movement"]["quantity_delta"] == -3

        movements = run(server.list_inventory_movements(product["id"], limit=100, user=_admin_user()))
        assert movements[0]["reason"] == "Damaged in storage"
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))
        run(server.db.inventory_movements.delete_many({"product_id": product["id"]}))


def test_stock_history_shows_multiple_movements_most_recent_first():
    product = _product(track_inventory=True, stock_on_hand=20.0)
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        run(server.adjust_pos_product_stock(
            product["id"], server.InventoryAdjustIn(quantity_delta=5, reason="Shipment received", source="RESTOCK"),
            user=_admin_user(),
        ))
        run(server.adjust_pos_product_stock(
            product["id"], server.InventoryAdjustIn(quantity_delta=-2, reason="Count correction", source="MANUAL_ADJUSTMENT"),
            user=_admin_user(),
        ))
        movements = run(server.list_inventory_movements(product["id"], limit=100, user=_admin_user()))
        assert len(movements) == 2
        # sort("created_at", -1) -> most recent (the manual adjustment) first
        assert movements[0]["type"] == "MANUAL_ADJUSTMENT"
        assert movements[1]["type"] == "RESTOCK"
    finally:
        run(server.db.pos_products.delete_one({"id": product["id"]}))
        run(server.db.inventory_movements.delete_many({"product_id": product["id"]}))


def test_admin_shop_orders_only_returns_paid_orders():
    paid = {
        "id": str(uuid.uuid4()), "status": "paid", "client_id": None, "client_name": f"{TAG} client",
        "total": 40.0, "fulfillment_status": "fulfilled", "pickup_status": "not_applicable",
        "admin_unseen": True, "lines": [{"kind": "credit_pack", "name": "Pack", "quantity": 1}],
        "created_at": server.now_iso(),
    }
    pending = {**paid, "id": str(uuid.uuid4()), "status": "pending_payment"}
    run(server.db.shop_orders.insert_many([dict(paid), dict(pending)]))
    try:
        result = run(server.list_shop_orders(fulfillment_status=None, user=_admin_user()))
        ids = {o["id"] for o in result["orders"]}
        assert paid["id"] in ids
        assert pending["id"] not in ids
    finally:
        run(server.db.shop_orders.delete_many({"id": {"$in": [paid["id"], pending["id"]]}}))


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
