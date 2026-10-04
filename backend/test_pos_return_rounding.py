"""Units returned one at a time give back exactly what was charged, to the cent
(audit: "A return made one unit at a time can come back a cent off"). The final
unit takes the remainder; every earlier unit is pro-rata. Disposable tag
TEST_RETURN (shared with test_pos_returns.py cleanup)."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from test_pos_returns import ADMIN, RATE, TAG, _product, _ret, _sell

from domains.pos import services as pos


@pytest.fixture(autouse=True)
def _register_open_with_tax():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 200.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.pos_products.delete_many({"name": {"$regex": TAG}}))


def test_three_single_unit_returns_give_back_exactly_what_was_collected():
    # $10 x3 = $30.00, tax $2.03 collected, total $32.03.
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "cash", "amount": 32.03, "tendered_amount": 40.00}])
    returned = [_ret(sale, [{"line_index": 0, "qty": 1, "restock": True}])["returned"] for _ in range(3)]
    assert round(sum(r["total"] for r in returned), 2) == 32.03, "the money given back is the money taken"
    assert round(sum(r["tax_amount"] for r in returned), 2) == 2.03, "the tax given back is the tax collected"


def test_discounted_single_unit_returns_add_up_to_the_amount_charged():
    # $10 off $30 = $20.00 charged, tax $1.35, card $21.35.
    pid = _product(10.00, stock=9)
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=3)],
        discount=server.PosSaleDiscountIn(kind="fixed", value=10.0, reason=f"{TAG} deal"),
        tenders=[server.PosSaleTenderIn(method="card", amount=21.35)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    returned = [_ret(sale, [{"line_index": 0, "qty": 1}])["returned"] for _ in range(3)]
    assert round(sum(r["subtotal"] for r in returned), 2) == 20.00
    assert round(sum(r["tax_amount"] for r in returned), 2) == 1.35


def test_final_return_after_a_partial_takes_the_remainder():
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "cash", "amount": 32.03, "tendered_amount": 40.00}])
    first = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    last = _ret(sale, [{"line_index": 0, "qty": 2}])["returned"]
    assert round(first["total"] + last["total"], 2) == 32.03


def test_a_failed_return_gives_its_money_back_on_the_line(monkeypatch):
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "cash", "amount": 32.03, "tendered_amount": 40.00}])
    _ret(sale, [{"line_index": 0, "qty": 1}])
    before = run(server.db.pos_sales.find_one({"id": sale}, {"_id": 0}))["line_items"][0]

    from motor.motor_asyncio import AsyncIOMotorCollection
    real_insert = AsyncIOMotorCollection.insert_one

    async def boom(self, *a, **k):   # the sales ledger write fails after the units were claimed
        if self.name == "retail_sales":
            raise RuntimeError("disk full")
        return await real_insert(self, *a, **k)
    monkeypatch.setattr(AsyncIOMotorCollection, "insert_one", boom)
    with pytest.raises(Exception):
        _ret(sale, [{"line_index": 0, "qty": 1}])
    after = run(server.db.pos_sales.find_one({"id": sale}, {"_id": 0}))["line_items"][0]
    assert after.get("returned_qty") == before.get("returned_qty")
    assert round(float(after.get("returned_net") or 0), 2) == round(float(before.get("returned_net") or 0), 2)
    assert round(float(after.get("returned_tax") or 0), 2) == round(float(before.get("returned_tax") or 0), 2)
