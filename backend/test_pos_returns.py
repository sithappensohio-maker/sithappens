"""Returning merchandise: partial, refunded the way it was paid, restocked or not.

A VOID cancels a whole sale on the day it happened. This is the other thing a
shop needs — someone brings one of three items back on Thursday for something
bought on Monday, and wants that item's money.

What these pin, because all of it is money:
  * a partial return refunds that line's share and nothing more, including the
    share of the tax that was actually collected on it;
  * the money goes back the way it came, split in the same proportion on a
    split-tender sale;
  * the same item cannot be returned twice, by retrying or by racing;
  * an item only goes back on the shelf when the desk said it was resellable;
  * expected drawer cash falls by the CASH part of the refund and nothing else;
  * services are refused — that is what the void path is for.

Disposable tag TEST_RETURN.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

from domains.pos import services as pos

TAG = "TEST_RETURN"
RATE = 6.75
ADMIN = {"id": "ret-admin", "name": "Return QA", "email": "ret@test", "role": "admin"}


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
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))
    run(server.db.pos_products.delete_many({"name": {"$regex": TAG}}))


def _day():
    return server.business_today().isoformat()


def _expected_cash():
    return round(float(run(server._register_day_summary(_day()))["totals"]["expected_cash"]), 2)


def _product(price=10.00, stock=None, taxable=True):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} widget", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": stock is not None,
        "stock_on_hand": float(stock or 0), "taxable": taxable, "category": "", "description": "",
        "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


def _sell(lines, tenders):
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(**l) for l in lines],
        tenders=[server.PosSaleTenderIn(**t) for t in tenders],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


def _ret(sale_id, lines, *, key=None, reason=f"{TAG} customer changed their mind"):
    return run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=lines, reason=reason, idempotency_key=key or f"{TAG}-{uuid.uuid4()}"), ADMIN))


def _stock(pid):
    return float(run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))["stock_on_hand"])


# --------------------------------------------------------------- the refund

def test_returning_one_of_three_refunds_only_that_one():
    # $10 each, 3 sold = $30.00 + $2.03 tax = $32.03. One back = $10.68.
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "cash", "amount": 32.03, "tendered_amount": 40.00}])
    out = _ret(sale, [{"line_index": 0, "qty": 1, "restock": True}])
    r = out["returned"]
    assert r["subtotal"] == 10.00
    assert r["tax_amount"] == 0.68          # a third of the 2.03 collected
    assert r["total"] == 10.68
    assert r["tenders"] == [{"method": "cash", "amount": 10.68}]


def test_the_rest_can_still_come_back_later_but_never_more_than_was_sold():
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "card", "amount": 32.03}])
    _ret(sale, [{"line_index": 0, "qty": 1}])
    _ret(sale, [{"line_index": 0, "qty": 2}])
    with pytest.raises(HTTPException) as e:
        _ret(sale, [{"line_index": 0, "qty": 1}])
    assert e.value.status_code == 400
    assert "can still be returned" in str(e.value.detail)


def test_asking_for_more_than_was_bought_is_refused_outright():
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 2}],
                 [{"method": "card", "amount": 21.35}])
    with pytest.raises(HTTPException) as e:
        _ret(sale, [{"line_index": 0, "qty": 5}])
    assert e.value.status_code == 400
    # and nothing was reserved by the attempt
    assert _ret(sale, [{"line_index": 0, "qty": 2}])["returned"]["total"] == 21.35


def test_an_exempt_item_refunds_no_tax():
    pid = _product(25.00, taxable=False)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 25.00}])
    r = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    assert r["tax_amount"] == 0.0 and r["total"] == 25.00


def test_a_discounted_sale_refunds_what_was_actually_charged():
    # $10 off a $30 sale means the customer paid $20 + tax. Returning one of
    # three must give back a third of what they PAID, not a third of the
    # shelf price.
    pid = _product(10.00, stock=9)
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=3)],
        discount=server.PosSaleDiscountIn(kind="fixed", value=10.0, reason=f"{TAG} deal"),
        tenders=[server.PosSaleTenderIn(method="card", amount=21.35)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    r = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    assert r["subtotal"] == 6.67, "a third of the $20 actually charged"
    assert r["total"] < 10.00, "never a third of the undiscounted price"


# ------------------------------------------------------- back the way it came

def test_a_card_sale_refunds_to_card_and_leaves_the_drawer_alone():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 10.68}])
    before = _expected_cash()
    r = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    assert r["tenders"] == [{"method": "card", "amount": 10.68}]
    assert _expected_cash() == before, "no cash left the till"


def test_a_cash_sale_takes_the_money_out_of_the_drawer():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "cash", "amount": 10.68, "tendered_amount": 20.00}])
    before = _expected_cash()
    _ret(sale, [{"line_index": 0, "qty": 1}])
    assert round(before - _expected_cash(), 2) == 10.68


def test_a_split_sale_refunds_in_the_same_proportion():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 8.00}, {"method": "cash", "amount": 2.68, "tendered_amount": 2.68}])
    before = _expected_cash()
    r = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    by_method = {t["method"]: t["amount"] for t in r["tenders"]}
    assert round(sum(by_method.values()), 2) == 10.68
    assert by_method["card"] > by_method["cash"], "refunded in the proportion it was paid"
    # only the cash slice comes out of the till
    assert round(before - _expected_cash(), 2) == by_method["cash"]


# ------------------------------------------------------------------- restock

def test_a_resellable_item_goes_back_on_the_shelf():
    pid = _product(10.00, stock=5)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 2}],
                 [{"method": "card", "amount": 21.35}])
    assert _stock(pid) == 3.0
    _ret(sale, [{"line_index": 0, "qty": 1, "restock": True}])
    assert _stock(pid) == 4.0


def test_a_damaged_item_is_refunded_but_not_restocked():
    pid = _product(10.00, stock=5)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 2}],
                 [{"method": "card", "amount": 21.35}])
    r = _ret(sale, [{"line_index": 0, "qty": 1, "restock": False}])["returned"]
    assert r["total"] == 10.68, "the customer still gets their money"
    assert _stock(pid) == 3.0, "but the chewed toy is not back on the shelf"


# ----------------------------------------------------------- refusing well

def test_the_same_key_never_refunds_twice():
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "card", "amount": 32.03}])
    key = f"{TAG}-{uuid.uuid4()}"
    first = _ret(sale, [{"line_index": 0, "qty": 1}], key=key)
    again = _ret(sale, [{"line_index": 0, "qty": 1}], key=key)
    assert again["returned"]["id"] == first["returned"]["id"]
    assert again.get("replayed") is True
    sale_doc = run(server.db.pos_sales.find_one({"id": sale}, {"_id": 0}))
    assert float(sale_doc["line_items"][0]["returned_qty"]) == 1.0, "reserved once, not twice"


def test_a_sale_older_than_the_window_is_refused():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 10.68}])
    run(server.db.pos_sales.update_one({"id": sale}, {"$set": {"business_date": "2020-01-01"}}))
    with pytest.raises(HTTPException) as e:
        _ret(sale, [{"line_index": 0, "qty": 1}])
    assert e.value.status_code == 409
    assert "30 days" in str(e.value.detail)


def test_a_voided_sale_has_nothing_to_return():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 10.68}])
    run(server.void_pos_sale(sale, server.PosSaleVoidIn(
        reason=f"{TAG} v", idempotency_key=f"{TAG}v{uuid.uuid4()}"), ADMIN))
    with pytest.raises(HTTPException) as e:
        _ret(sale, [{"line_index": 0, "qty": 1}])
    assert e.value.status_code == 409


def test_a_service_line_is_sent_to_the_void_path_instead():
    sale = _sell([{"kind": "custom", "custom_amount": 30.0, "custom_kind": "service",
                   "custom_reason": TAG, "description": f"{TAG} nail trim"}],
                 [{"method": "card", "amount": 30.00}])
    with pytest.raises(HTTPException) as e:
        _ret(sale, [{"line_index": 0, "qty": 1}])
    assert e.value.status_code == 400
    assert "Void the sale instead" in str(e.value.detail)


def test_cash_back_needs_the_drawer_open():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "cash", "amount": 10.68, "tendered_amount": 10.68}])
    run(server.db.cash_drawer_sessions.delete_many({"date": _day()}))
    try:
        with pytest.raises(HTTPException) as e:
            _ret(sale, [{"line_index": 0, "qty": 1}])
        assert e.value.status_code == 400
        # and the reservation was rolled back, so it can be returned properly later
        doc = run(server.db.pos_sales.find_one({"id": sale}, {"_id": 0}))
        assert float(doc["line_items"][0].get("returned_qty") or 0) == 0.0
    finally:
        run(server.db.cash_drawer_sessions.insert_one(
            {"date": _day(), "opening_cash": 200.0, "opened_at": server.now_iso(),
             "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}))


# ------------------------------------------------------------------ preview

def test_the_preview_says_what_is_left_and_why_not():
    pid = _product(10.00, stock=9)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                 [{"method": "card", "amount": 32.03}])
    _ret(sale, [{"line_index": 0, "qty": 1}])
    view = run(server.get_pos_sale_return_preview(sale, ADMIN))
    assert view["can_return"] is True and view["blocked_reason"] is None
    line = view["lines"][0]
    assert (line["qty"], line["returned_qty"], line["remaining_qty"]) == (3.0, 1.0, 2.0)
    assert line["returnable"] is True
    assert view["window_days"] == 30


def test_the_return_is_recorded_with_who_did_it_and_against_what():
    pid = _product(10.00)
    sale = _sell([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "card", "amount": 10.68}])
    r = _ret(sale, [{"line_index": 0, "qty": 1}])["returned"]
    assert r["pos_sale_id"] == sale
    assert r["created_by"] == "ret-admin" and r["created_by_name"] == "Return QA"
    assert r["reason"].startswith(TAG)
    assert r["business_date"] == _day()
    rows = run(server.db.retail_sales.find({"pos_sale_return_id": r["id"]}, {"_id": 0}).to_list(10))
    assert len(rows) == 1 and rows[0]["amount"] == -10.68
    assert rows[0]["source_kind"] == "pos_sale_return"
