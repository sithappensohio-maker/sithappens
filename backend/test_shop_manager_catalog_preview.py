"""Shop Manager's "Client Preview" tab (ShopManager.jsx's ClientPreviewTab)
renders the real client Shop (PortalShop) under an ADMIN session, not a
client one. The catalog GRID already had its own admin-gated mirror of the
real client endpoint (shop_manager_catalog_preview, reusing
_build_shop_catalog) — but clicking INTO an item still called the real
client-only /shop/item/{kind}/{id}, which 403'd for an admin every time.
ShopItemDetail.jsx's catch() can't tell a 403 apart from a genuinely
missing item, so every single item in Client Preview read as "This item
isn't available right now" — exactly what the owner reported. These tests
exist for the fix: a sibling admin-gated item-detail endpoint,
shop_manager_catalog_preview_item, built the same way the grid one is.
"""
import uuid
import contextlib
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_SMCP"


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _client(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": f"{TAG} client"}


@contextlib.contextmanager
def _product(**kw):
    defaults = dict(name=f"{TAG} Leash {uuid.uuid4().hex[:6]}", price=24.0,
                     show_online=True, active=True, starting_stock=5, track_inventory=True)
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))


def test_an_admin_previewing_the_shop_can_open_an_item_the_real_client_endpoint_would_403_them_on():
    with _product() as p:
        admin = _admin()
        # The real client-only endpoint refuses an admin outright — this is
        # the exact 403 that used to read as "item unavailable" in preview.
        try:
            run(server.get_shop_item_detail("product", p["id"], admin))
            raise AssertionError("expected a 403 for an admin on the client-only endpoint")
        except HTTPException as e:
            assert e.status_code == 403

        # The admin-gated preview mirror succeeds instead.
        detail = run(server.shop_manager_catalog_preview_item(kind="product", item_id=p["id"],
                                                                preview_client_id=None, _=admin))
        assert detail["id"] == p["id"]
        assert detail["name"] == p["name"]


def test_preview_item_detail_returns_404_not_a_second_distinguishable_error_for_a_hidden_item():
    with _product(show_online=False) as p:
        try:
            run(server.shop_manager_catalog_preview_item(kind="product", item_id=p["id"],
                                                           preview_client_id=None, _=_admin()))
            raise AssertionError("expected 404 for an item not shown in the client Shop")
        except HTTPException as e:
            assert e.status_code == 404


def test_preview_item_detail_rejects_an_unknown_preview_client_id():
    with _product() as p:
        try:
            run(server.shop_manager_catalog_preview_item(kind="product", item_id=p["id"],
                                                           preview_client_id="not-a-real-client", _=_admin()))
            raise AssertionError("expected 404 for a bogus preview_client_id")
        except HTTPException as e:
            assert e.status_code == 404


# Performance pass, 2026-10-19: _build_shop_catalog called resolve_client_price()
# once per product and once per pack, and that resolver re-fetches the SAME
# client document on every call (one query per item on the shelf). Fetched
# once up front now and threaded through instead.
def test_shop_catalog_fetches_the_pricing_client_once_not_once_per_item():
    cid = str(uuid.uuid4())
    tier_id = str(uuid.uuid4())
    run(server.db.pricing_tiers.insert_one({"id": tier_id, "name": f"{TAG} VIP", "active": True, "tag": TAG}))
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "pricing_tier_id": tier_id, "tag": TAG}))
    try:
        with _product() as p1, _product() as p2, _product() as p3:
            run(server.db.pricing_tier_prices.insert_one({"id": str(uuid.uuid4()), "tier_id": tier_id,
                                                           "target_kind": "pos_product", "target_code": p1["id"],
                                                           "override_price": 5.0, "tag": TAG}))
            # Motor hands back a fresh AsyncIOMotorCollection wrapper on every
            # `db.clients` attribute access (not a cached singleton), so an
            # instance-level patch of `server.db.clients.find_one` silently
            # never intercepts the call `_build_shop_catalog` makes through
            # ITS OWN `db.clients` access — the class method has to be patched.
            counts = {"n": 0}
            orig_find_one = type(server.db.clients).find_one

            async def counted(self, *a, **kw):
                if self.name == "clients":
                    counts["n"] += 1
                return await orig_find_one(self, *a, **kw)

            with patch.object(type(server.db.clients), "find_one", counted):
                catalog = run(server.get_shop_catalog({"role": "client", "client_id": cid}))

            assert counts["n"] == 1, f"expected exactly one client lookup for the whole catalog, got {counts['n']}"
            by_id = {it["id"]: it for it in catalog["items"] if it.get("kind") == "product"}
            # The tier override still resolves correctly from the one shared fetch...
            assert by_id[p1["id"]]["effective_price"] == 5.0
            assert by_id[p1["id"]]["pricing_source"] == "tier"
            # ...and an item with no override still gets its own standard price, not p1's.
            assert by_id[p2["id"]]["effective_price"] == p2["price"]
            assert by_id[p3["id"]]["effective_price"] == p3["price"]
    finally:
        run(server.db.pricing_tier_prices.delete_many({"tag": TAG}))
        run(server.db.pricing_tiers.delete_many({"tag": TAG}))
        run(server.db.clients.delete_one({"id": cid}))
