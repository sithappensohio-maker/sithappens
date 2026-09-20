"""The manual register refund cannot quietly cost you money any more.

Two faults found by audit, both real cash:

  * refunding a taxed sale gave the customer their tax back out of the drawer
    while the sales-tax liability still said it was owed to Ohio — so it got
    remitted on a sale that no longer existed;
  * there was no ceiling at all. A slipped decimal refunded far more than was
    ever taken, straight into the drawer, the P&L and the books.

A refund now either points at the sale it reverses — tax and ceiling derived
from that sale, so neither can be wrong — or states its own tax portion, which
for a service refund is correctly zero but has to be a decision.

Disposable tag TEST_REFGUARD.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_REFGUARD"
RATE = 6.75
ADMIN = {"id": "rg-admin", "name": "Refund QA", "email": "rg@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _register_open_with_tax():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 500.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))
    run(server.db.pos_products.delete_many({"name": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


def _day():
    return server.business_today().isoformat()


def _tax_owed():
    return round(float(run(server.sales_tax_summary(_day(), _day(), ADMIN))["total_tax_collected"]), 2)


def _expected_cash():
    return round(float(run(server._register_day_summary(_day()))["totals"]["expected_cash"]), 2)


def _sell(price=100.00, qty=1, method="cash"):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} item", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    total = round(price * qty * (1 + RATE / 100), 2)
    tender = {"method": method, "amount": total}
    if method == "cash":
        tender["tendered_amount"] = total
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=qty)],
        tenders=[server.PosSaleTenderIn(**tender)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return (out.get("pos_sale_id") or (out.get("sale") or {}).get("id")), total


def _refund(**kw):
    payload = {"reason": f"{TAG} correction", "payment_method": "cash"}
    payload.update(kw)
    return run(server.admin_register_refund(server.RegisterRefundIn(**payload), ADMIN))


# ------------------------------------------------- the tax that went missing

def test_refunding_a_taxed_sale_gives_the_tax_back_to_ohio_too():
    # The audit case, exactly: $100 + $6.75 tax, refunded in full.
    sale_id, total = _sell(100.00)
    assert total == 106.75
    owed_after_sale = _tax_owed()
    _refund(amount=total, sale_id=sale_id)
    assert round(owed_after_sale - _tax_owed(), 2) == 6.75, "liability must fall with the refund"


def test_a_part_refund_gives_back_the_matching_part_of_the_tax():
    sale_id, total = _sell(100.00)
    owed = _tax_owed()
    _refund(amount=53.38, sale_id=sale_id)          # half of 106.75
    assert round(owed - _tax_owed(), 2) == 3.38     # half of 6.75, to the cent


def test_a_service_refund_reverses_no_tax_because_none_was_charged():
    owed = _tax_owed()
    _refund(amount=40.00, reason=f"{TAG} cancelled daycare day")
    assert _tax_owed() == owed


def test_an_unlinked_refund_can_still_state_its_tax():
    owed = _tax_owed()
    _refund(amount=106.75, tax_amount=6.75, reason=f"{TAG} manual correction")
    assert round(owed - _tax_owed(), 2) == 6.75


def test_the_tax_portion_cannot_exceed_the_refund():
    with pytest.raises(HTTPException) as e:
        _refund(amount=10.00, tax_amount=50.00)
    assert e.value.status_code == 400


# ------------------------------------------------------------- the ceiling

def test_a_slipped_decimal_cannot_refund_more_than_the_sale_was():
    sale_id, total = _sell(100.00)
    with pytest.raises(HTTPException) as e:
        _refund(amount=10675.00, sale_id=sale_id)   # 100x, the classic typo
    assert e.value.status_code == 400
    assert "left to refund" in str(e.value.detail)


def test_two_part_refunds_cannot_add_up_to_more_than_was_paid():
    sale_id, total = _sell(100.00)
    _refund(amount=60.00, sale_id=sale_id)
    _refund(amount=46.75, sale_id=sale_id)          # exactly the remainder
    with pytest.raises(HTTPException) as e:
        _refund(amount=0.01, sale_id=sale_id)
    assert e.value.status_code == 409
    assert "already been fully refunded" in str(e.value.detail)


def test_a_sale_already_returned_cannot_then_be_refunded_again():
    # Three ways to give money back; none of them may stack.
    from domains.pos import services as pos
    sale_id, total = _sell(100.00)
    run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=[{"line_index": 0, "qty": 1, "restock": False}],
        reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    with pytest.raises(HTTPException) as e:
        _refund(amount=total, sale_id=sale_id)
    assert e.value.status_code == 409


def test_an_unknown_sale_is_refused():
    with pytest.raises(HTTPException) as e:
        _refund(amount=10.00, sale_id="no-such-sale")
    assert e.value.status_code == 404


# --------------------------------------------------------- still works

def test_the_drawer_still_moves_by_the_full_amount_handed_over():
    # The customer gets back cash INCLUDING the tax — only the liability
    # changes, never what leaves the till.
    sale_id, total = _sell(100.00)
    before = _expected_cash()
    _refund(amount=total, sale_id=sale_id)
    assert round(before - _expected_cash(), 2) == 106.75


def test_the_refund_row_says_what_it_reversed():
    sale_id, total = _sell(100.00)
    doc = _refund(amount=total, sale_id=sale_id)["refund"]
    assert doc["amount"] == -106.75
    assert doc["tax_amount"] == -6.75
    assert doc["pre_tax_amount"] == -100.00
    assert doc["pos_sale_id"] == sale_id
    assert doc["source_kind"] == "refund"
    assert "against #" in doc["description"]


def test_an_unlinked_service_refund_is_still_a_plain_correction():
    doc = _refund(amount=25.00, reason=f"{TAG} overcharged a bath")["refund"]
    assert doc["amount"] == -25.00
    assert doc["tax_amount"] == 0.0 and doc["pre_tax_amount"] == -25.00
    assert doc["pos_sale_id"] is None
