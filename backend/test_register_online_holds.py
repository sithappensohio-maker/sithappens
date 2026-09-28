"""The register never sells what an online buyer is paying for (audit #59).

Before: the register checked only the shelf count (stock_on_hand), not the
units held for online Shop checkouts (stock_reserved). Staff could sell the
last unit while a buyer was on the card page; the count went below zero
when that payment landed and the paid pickup order waited for an item that
was gone.

Now the register sells at most the shelf less what is held — in its own
check, in the atomic stock write, and in the product list it shows — while
a stock-count adjustment is never blocked. An online hold and a register
sale landing at the same moment can't both take the last unit.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorCollection

import _test_env  # noqa: F401 — configure disposable DB before importing server
import server
from _test_loop import run

TAG = "TEST_REGISTER_HOLDS"
ADMIN = {"id": "holds-admin", "name": "Holds QA", "email": "holds@test", "role": "admin"}


@contextlib.contextmanager
def _product(stock, held=0.0):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} leash", "description": "", "sku": "", "category": "", "price": 20.0,
        "active": True, "archived": False, "show_at_register": True, "track_inventory": True,
        "stock_on_hand": stock, "stock_reserved": held,
        "shop_reservations": ([{"ref": f"shop_order:x:item:{pid}", "order_id": "x", "item_id": pid, "quantity": held,
                                "state": "reserved"}] if held else []),
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None, "taxable": False}))
    try:
        yield pid
    finally:
        async def go():
            await server.db.pos_products.delete_many({"id": pid})
            await server.db.inventory_movements.delete_many({"product_id": pid})
            sales = await server.db.pos_sales.find({"line_items.product_id": pid}, {"_id": 0, "id": 1}).to_list(50)
            ids = [s["id"] for s in sales]
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
        run(go())


def _stock(pid):
    return run(server.db.pos_products.find_one({"id": pid}, {"_id": 0, "stock_on_hand": 1, "stock_reserved": 1}))


def _sell(pid, qty=1):
    body = server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=qty)],
        tenders=[server.PosSaleTenderIn(method="card", amount=20.0 * qty)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}")
    with patch.object(server, "_issue_pos_token", new=AsyncMock(return_value=None)):
        return run(server.create_pos_sale(body, ADMIN))


def _refused(fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    return exc.value


def _catalog_item(pid):
    cat = run(server.get_register_catalog(None, ADMIN))
    return next(i for i in cat["items"] if i.get("id") == pid)


def test_the_register_list_shows_what_it_can_sell():
    with _product(stock=2, held=1) as pid:
        item = _catalog_item(pid)
        assert item["stock_on_hand"] == 1 and item["stock_held"] == 1 and item["in_stock"] is True
    with _product(stock=1, held=1) as pid:
        item = _catalog_item(pid)
        assert item["stock_on_hand"] == 0 and item["in_stock"] is False


def test_the_last_unit_held_online_is_never_sold_at_the_register():
    with _product(stock=1, held=1) as pid:
        err = _refused(lambda: _sell(pid))
        assert err.status_code == 400 and "held for an online order" in err.detail
        assert _stock(pid)["stock_on_hand"] == 1, "nothing was taken off the shelf"


def test_the_register_sells_up_to_what_is_not_held():
    with _product(stock=2, held=1) as pid:
        _sell(pid)
        assert _stock(pid)["stock_on_hand"] == 1
        err = _refused(lambda: _sell(pid))
        assert "held for an online order" in err.detail
    with _product(stock=3, held=1) as pid:
        err = _refused(lambda: _sell(pid, qty=3))
        assert err.detail.startswith("Only 2 available") and "1 held" in err.detail


def test_a_stock_count_adjustment_is_never_blocked_by_a_hold():
    with _product(stock=1, held=1) as pid:
        run(server.adjust_pos_product_stock(pid, server.InventoryAdjustIn(
            quantity_delta=-1, reason="damaged in the shop"), ADMIN))
        assert _stock(pid)["stock_on_hand"] == 0


def test_an_online_hold_landing_mid_sale_stops_the_register_sale():
    with _product(stock=1) as pid:
        orig = AsyncIOMotorCollection.find_one_and_update
        state = {"raced": False}

        async def racing(self, filter, *a, **k):
            if self.name == "pos_products" and filter.get("id") == pid and "shop_reservations.ref" not in filter \
                    and not state["raced"]:
                state["raced"] = True   # an online buyer takes the last unit between read and write
                await orig(self, {"id": pid}, {"$inc": {"stock_reserved": 1}})
            return await orig(self, filter, *a, **k)

        with patch.object(AsyncIOMotorCollection, "find_one_and_update", racing):
            err = _refused(lambda: run(server._mutate_product_stock(pid, -1, "SALE", "register", respect_holds=True)))
        assert state["raced"] and "held for an online order" in err.detail
        assert _stock(pid)["stock_on_hand"] == 1


def test_a_register_sale_landing_mid_hold_stops_the_online_hold():
    with _product(stock=1) as pid:
        orig = AsyncIOMotorCollection.find_one_and_update
        state = {"raced": False}

        async def racing(self, filter, *a, **k):
            if self.name == "pos_products" and "shop_reservations.ref" in filter and not state["raced"]:
                state["raced"] = True   # the register sells the last unit between read and write
                await orig(self, {"id": pid}, {"$inc": {"stock_on_hand": -1}})
            return await orig(self, filter, *a, **k)

        order = {"id": str(uuid.uuid4()), "status": "pending", "lines": []}
        line = {"kind": "product", "item_id": "i1", "ref_id": pid, "quantity": 1, "name": "leash"}
        with patch.object(AsyncIOMotorCollection, "find_one_and_update", racing):
            err = _refused(lambda: run(server._reserve_shop_inventory_line(order, line)))
        assert state["raced"] and err.status_code == 400
        assert _stock(pid) == {"stock_on_hand": 0, "stock_reserved": 0}, "never oversold"
