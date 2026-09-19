"""A cash sale at the till changes what the drawer should hold.

Reported as "doing a cash sale on a retail item didn't change the expected
drawer amount". The arithmetic turned out to be right — this file is what
proves it stays right, because nothing else asserted the whole chain from
"ring a product" to "expected_cash moved by exactly that".

The chain has several links that each look plausible while broken: the sale
has to write a retail_sales row, the row has to carry pos_sale_id, the summary
has to bucket that row from the SALE's tenders rather than the row's own
label, and the tender has to land in the cash bucket specifically.

Disposable tag TEST_DRAWER.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_DRAWER"
RATE = 6.75
ADMIN = {"id": "drawer-admin", "name": "Drawer QA", "email": "drawer@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _open_register_with_tax():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def _day():
    return server.business_today().isoformat()


def _summary():
    return run(server._register_day_summary(_day()))


def _expected_cash():
    return round(float(_summary()["totals"]["expected_cash"]), 2)


def _cash_bucket():
    return round(float(_summary()["incoming_by_method"].get("cash") or 0), 2)


def _product(price=12.99, taxable=True):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} Ear Wipes", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": taxable,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


def _sell(pid, *, method="cash", amount, tendered=None, qty=1):
    tender = {"method": method, "amount": amount}
    if method == "cash":
        tender["tendered_amount"] = tendered if tendered is not None else amount
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=qty)],
        tenders=[server.PosSaleTenderIn(**tender)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


def _cleanup(pid=None, sale_ids=()):
    async def go():
        if pid:
            await server.db.pos_products.delete_many({"id": pid})
        if sale_ids:
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
            await server.db.pos_sales.delete_many({"id": {"$in": list(sale_ids)}})
    run(go())


# ------------------------------------------------------------------ the chain

def test_a_cash_sale_moves_expected_drawer_cash_by_the_total_charged():
    pid = _product(12.99)
    before, sale_id = _expected_cash(), None
    try:
        sale_id = _sell(pid, amount=13.87, tendered=20.00)   # 12.99 + 6.75% tax
        assert round(_expected_cash() - before, 2) == 13.87
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])


def test_the_drawer_gets_the_tax_too_not_just_the_shelf_price():
    # The tax is real money in the till and has to be remitted later; if the
    # drawer only expected $12.99 it would read $0.88 over at closeout.
    pid = _product(12.99)
    before, sale_id = _expected_cash(), None
    try:
        sale_id = _sell(pid, amount=13.87, tendered=20.00)
        moved = round(_expected_cash() - before, 2)
        assert moved == 13.87 and moved != 12.99
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])


def test_change_given_does_not_come_out_of_the_drawer_twice():
    # $20 handed over for a $13.87 sale: the till keeps 13.87, not 20.
    pid = _product(12.99)
    before, sale_id = _expected_cash(), None
    try:
        sale_id = _sell(pid, amount=13.87, tendered=20.00)
        assert round(_expected_cash() - before, 2) == 13.87
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])


def test_a_card_sale_leaves_the_cash_drawer_alone():
    pid = _product(12.99)
    before, sale_id = _expected_cash(), None
    try:
        sale_id = _sell(pid, method="card", amount=13.87)
        assert round(_expected_cash() - before, 2) == 0.0
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])


def test_the_sale_writes_the_row_the_summary_actually_reads():
    # Each link, named: a retail_sales row, carrying pos_sale_id, dated today.
    pid = _product(12.99)
    sale_id = None
    try:
        sale_id = _sell(pid, amount=13.87, tendered=20.00)
        rows = run(server.db.retail_sales.find({"pos_sale_id": sale_id}, {"_id": 0}).to_list(10))
        assert len(rows) == 1, "exactly one retail revenue row per sale"
        assert rows[0]["date"] == _day()
        assert round(float(rows[0]["amount"]), 2) == 13.87
        sale = run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0}))
        assert [t["method"] for t in sale["tenders"]] == ["cash"]
        assert round(float(sale["tenders"][0]["amount"]), 2) == 13.87
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])


def test_two_sales_both_land():
    pid = _product(10.00)
    before, ids = _expected_cash(), []
    try:
        ids.append(_sell(pid, amount=10.68, tendered=20.00))
        ids.append(_sell(pid, amount=10.68, tendered=20.00))
        assert round(_expected_cash() - before, 2) == 21.36
    finally:
        _cleanup(pid, ids)


def test_a_voided_cash_sale_takes_the_money_back_out():
    pid = _product(12.99)
    before, sale_id = _expected_cash(), None
    try:
        sale_id = _sell(pid, amount=13.87, tendered=20.00)
        assert round(_expected_cash() - before, 2) == 13.87
        run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(reason=f"{TAG} wrong item", idempotency_key=f"{TAG}-void-{uuid.uuid4()}"), ADMIN))
        assert round(_expected_cash() - before, 2) == 0.0
    finally:
        _cleanup(pid, [sale_id] if sale_id else [])
