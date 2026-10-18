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
