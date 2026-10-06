"""A Front Desk void is booked on the day it is made, not the day of the sale.

Voiding a sale from an earlier day used to write the reversal rows dated that
earlier day. A day that was already closed out then got a reversal it never
had a chance to balance, and an open day's drawer was asked to give back cash
it never saw. Now the reversal lands on today's register, the same way a
return does, and the earlier day keeps its original sale untouched.

What these pin:
  * a sale from an earlier day that was never closed is voided onto TODAY's
    date, and that earlier day's own rows do not change;
  * the reversal's description still names the original receipt and its date;
  * a void is refused while today's register is closed (the same refusal a
    return gets), and nothing is written;
  * the open-drawer token is only handed out while today's drawer is open.

Disposable tag TEST_VOID_DAY.
"""
import datetime as dt
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_VOID_DAY"
RATE = 6.75
ADMIN = {"id": "void-day-admin", "name": "Void Day QA", "email": "voiddays@test", "role": "admin"}


def _today():
    return server.business_today().isoformat()


def _earlier():
    # Three days back: a day in the window, never closed in this disposable DB.
    return (server.business_today() - dt.timedelta(days=3)).isoformat()


@pytest.fixture(autouse=True)
def _register_open_with_tax():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = _today()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 200.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))
    run(server.db.daily_closeouts.delete_many({"notes": TAG}))
    run(server.db.pos_products.delete_many({"name": {"$regex": TAG}}))


def _product():
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} widget", "price": 10.00, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0.0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


def _sale(tender="card"):
    """Rings up a $10 taxable item ($10.68 with tax). Then backdates the sale
    and its own revenue row to an earlier day, as if it had been rung up then."""
    pid = _product()
    kw = {"method": tender, "amount": 10.68}
    if tender == "cash":
        kw["tendered_amount"] = 10.68
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=1)],
        tenders=[server.PosSaleTenderIn(**kw)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale_id = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    run(server.db.pos_sales.update_one({"id": sale_id}, {"$set": {"business_date": _earlier()}}))
    run(server.db.retail_sales.update_many({"pos_sale_id": sale_id}, {"$set": {"date": _earlier()}}))
    return sale_id


def _void(sale_id):
    return run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
        reason=f"{TAG} wrong item", idempotency_key=f"{TAG}-void-{uuid.uuid4()}"), ADMIN))


def _rows_on(day):
    return sorted(
        (r["id"], r["amount"], r.get("source_kind"))
        for r in run(server.db.retail_sales.find({"date": day}, {"_id": 0}).to_list(10000)))


def test_voiding_an_earlier_unclosed_day_sale_books_the_reversal_today():
    sale_id = _sale()
    before_earlier = _rows_on(_earlier())
    receipt = run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0}))["receipt_number"]

    _void(sale_id)

    voids = run(server.db.retail_sales.find(
        {"pos_sale_id": sale_id, "source_kind": "pos_sale_void"}, {"_id": 0}).to_list(50))
    assert voids, "the void wrote its reversal rows"
    assert all(v["date"] == _today() for v in voids), [v["date"] for v in voids]
    assert round(sum(v["amount"] for v in voids), 2) == -10.68
    for v in voids:
        assert f"#{receipt}" in v["description"]
        assert _earlier() in v["description"], "the description still names the original sale's date"

    # The earlier day is exactly as it was: its original sale rows, no reversal.
    assert _rows_on(_earlier()) == before_earlier
    sale_doc = run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0}))
    assert sale_doc["status"] == "voided"
    assert sale_doc["business_date"] == _earlier()


def test_a_void_is_refused_while_todays_register_is_closed():
    sale_id = _sale()
    closeout_id = str(uuid.uuid4())
    run(server.db.daily_closeouts.insert_one({
        "id": closeout_id, "date": _today(), "status": "closed",
        "rollover_cash": 200.0, "cash_counted": 200.0,
        "created_at": "2999-01-01T00:00:00", "created_by_name": TAG, "notes": TAG,
    }))
    try:
        with pytest.raises(HTTPException) as e:
            _void(sale_id)
        assert e.value.status_code == 409
        assert "closed" in str(e.value.detail).lower()
        assert run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0}))["status"] == "completed"
        assert run(server.db.retail_sales.find({"pos_sale_id": sale_id, "source_kind": "pos_sale_void"},
                                               {"_id": 0}).to_list(50)) == []
    finally:
        run(server.db.daily_closeouts.delete_many({"id": closeout_id}))


def test_the_open_drawer_token_is_only_issued_while_todays_drawer_is_open():
    open_sale = _sale(tender="cash")
    assert _void(open_sale)["pos_open_drawer_token"] is not None, "today's drawer is open: cash goes back from it"

    closed_sale = _sale(tender="cash")
    run(server.db.cash_drawer_sessions.delete_many({"date": _today()}))
    out = _void(closed_sale)
    assert out["pos_open_drawer_token"] is None, "no drawer open today, so no drawer to open"
    assert run(server.db.pos_sales.find_one({"id": closed_sale}, {"_id": 0}))["status"] == "voided"
