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


# ------------------------------------ the receipt # the desk actually has
# The box only took the sale's internal id, which is printed nowhere, so it
# was left empty and a merchandise refund reversed no tax (audit #27).

def _receipt(sale_id):
    return run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "receipt_number": 1}))["receipt_number"]


def _sell_with_letters():
    # A receipt # that is all digits reads the same in any case; keep selling
    # until one has letters, so the any-case test always proves something.
    for _ in range(20):
        sale_id, total = _sell(100.00)
        if _receipt(sale_id).lower() != _receipt(sale_id):
            return sale_id, total
    raise AssertionError("no receipt number with letters in 20 sales")


def test_the_receipt_number_as_printed_finds_the_sale_and_gives_the_tax_back():
    sale_id, total = _sell(100.00)
    owed = _tax_owed()
    doc = _refund(amount=total, sale_id=f"#{_receipt(sale_id)}")["refund"]
    assert round(owed - _tax_owed(), 2) == 6.75
    assert doc["tax_amount"] == -6.75
    assert doc["pos_sale_id"] == sale_id, "the row must point at the sale itself, not the typed number"


def test_the_receipt_number_is_found_in_any_case_and_with_spaces():
    sale_id, total = _sell_with_letters()
    doc = _refund(amount=53.38, sale_id=f"  # {_receipt(sale_id).lower()} ")["refund"]
    assert doc["pos_sale_id"] == sale_id and doc["tax_amount"] == -3.38


def test_the_ceiling_holds_when_the_receipt_number_is_used():
    sale_id, total = _sell(100.00)
    _refund(amount=60.00, sale_id=sale_id)
    with pytest.raises(HTTPException) as e:
        _refund(amount=50.00, sale_id=_receipt(sale_id))    # the id and the receipt # are one sale
    assert e.value.status_code == 400 and "left to refund" in str(e.value.detail)
    _refund(amount=46.75, sale_id=_receipt(sale_id))        # exactly what is left
    with pytest.raises(HTTPException) as e:
        _refund(amount=0.01, sale_id=sale_id)
    assert e.value.status_code == 409


def test_the_old_internal_id_still_works_in_any_case():
    sale_id, total = _sell_with_letters()
    doc = _refund(amount=total, sale_id=sale_id.upper())["refund"]
    assert doc["pos_sale_id"] == sale_id and doc["tax_amount"] == -6.75


def test_a_receipt_number_that_matches_no_sale_says_so_plainly():
    with pytest.raises(HTTPException) as e:
        _refund(amount=10.00, sale_id="#zz99zz99")
    assert e.value.status_code == 404
    assert "No Register sale has receipt #ZZ99ZZ99" in str(e.value.detail)
    assert "Recent Sales" in str(e.value.detail), "it must say where pickup goods' receipt # is"


def test_two_sales_sharing_a_receipt_number_refuse_rather_than_guess():
    sale_id, total = _sell(100.00)
    receipt = _receipt(sale_id)
    twin = {"id": f"{TAG}-{uuid.uuid4()}", "receipt_number": receipt, "total": 5.0, "tax_amount": 0.0}
    run(server.db.pos_sales.insert_one(twin.copy()))
    try:
        with pytest.raises(HTTPException) as e:
            _refund(amount=1.00, sale_id=receipt)
        assert e.value.status_code == 409 and "More than one Register sale" in str(e.value.detail)
    finally:
        run(server.db.pos_sales.delete_one({"id": twin["id"]}))


def test_a_box_holding_only_a_hash_is_refused_not_saved_unlinked():
    before = run(server.db.retail_sales.count_documents({"description": {"$regex": TAG}}))
    with pytest.raises(HTTPException) as e:
        _refund(amount=10.00, sale_id=" # ")
    assert e.value.status_code == 400
    assert run(server.db.retail_sales.count_documents({"description": {"$regex": TAG}})) == before


def _return_all(sale_id, line_index=0):
    from domains.pos import services as pos
    run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=[{"line_index": line_index, "qty": 1, "restock": False}],
        reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))


def _tax_reversed_on(sale_id):
    rows = run(server.db.retail_sales.find({"pos_sale_id": sale_id, "amount": {"$lt": 0}}, {"_id": 0, "tax_amount": 1}).to_list(50))
    return round(sum(abs(float(r.get("tax_amount") or 0)) for r in rows), 2)


def _sell_goods_and_a_service():
    # $100 of taxed goods ($6.75 tax) and a $50 untaxed service on one sale.
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} food", "price": 100.00, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    total = 156.75
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=1),
               server.PosSaleLineIn(kind="custom", description=f"{TAG} nail trim", custom_amount=50.00,
                                    custom_reason=f"{TAG} walk-in", custom_kind="service")],
        tenders=[server.PosSaleTenderIn(method="cash", amount=total, tendered_amount=total)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale_id = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    sale = run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "total": 1, "tax_amount": 1}))
    assert (sale["total"], sale["tax_amount"]) == (total, 6.75)
    return sale_id, total


def test_a_sale_mixing_taxed_goods_and_untaxed_items_asks_for_the_tax_rather_than_guessing():
    # Splitting the sale's tax over the whole sale would reverse tax on the
    # untaxed service too. It can't tell which part is going back, so it asks.
    sale_id, total = _sell_goods_and_a_service()
    owed = _tax_owed()
    with pytest.raises(HTTPException) as e:
        _refund(amount=50.00, sale_id=_receipt(sale_id))
    assert e.value.status_code == 409 and "Sales tax included" in str(e.value.detail)
    assert _tax_owed() == owed


def test_on_a_mixed_sale_the_stated_tax_is_used_and_the_refund_stays_linked():
    sale_id, total = _sell_goods_and_a_service()
    doc = _refund(amount=50.00, sale_id=_receipt(sale_id), tax_amount=0)["refund"]      # the service
    assert doc["tax_amount"] == 0.0 and doc["pos_sale_id"] == sale_id, "linked, so the ceiling still sees it"
    doc = _refund(amount=21.35, sale_id=_receipt(sale_id), tax_amount=1.35)["refund"]   # a goods price correction
    assert doc["tax_amount"] == -1.35 and doc["pre_tax_amount"] == -20.00
    with pytest.raises(HTTPException) as e:
        _refund(amount=50.00, sale_id=_receipt(sale_id), tax_amount=5.50)               # only $5.40 of tax is left
    assert e.value.status_code == 400 and "$5.40 of sales tax is left" in str(e.value.detail)


def test_once_its_goods_are_returned_the_rest_of_a_mixed_sale_refunds_with_no_tax():
    sale_id, total = _sell_goods_and_a_service()
    _return_all(sale_id, line_index=0)                   # the goods, $106.75 with their $6.75 tax
    owed = _tax_owed()
    doc = _refund(amount=50.00, sale_id=_receipt(sale_id))["refund"]
    assert doc["tax_amount"] == 0.0 and doc["pos_sale_id"] == sale_id
    assert _tax_owed() == owed, "the goods' tax already went back with the return"
    assert _tax_reversed_on(sale_id) == 6.75


def test_tax_already_given_back_by_a_return_is_never_reversed_twice():
    # Two of the same item; one comes back over the counter, the rest is
    # refunded here. Together they give back exactly the sale's tax.
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} toy", "price": 50.00, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=1),
               server.PosSaleLineIn(kind="retail", product_id=pid, qty=1)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=106.75, tendered_amount=106.75)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale_id = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    _return_all(sale_id, line_index=0)
    left = round(106.75 - 53.38, 2)
    doc = _refund(amount=left, sale_id=_receipt(sale_id))["refund"]
    assert _tax_reversed_on(sale_id) == 6.75, "never more tax back than the sale collected"
    assert doc["pre_tax_amount"] == -round(left + doc["tax_amount"], 2)


def test_a_linked_refund_shows_the_method_it_went_back_on():
    # Paid by card, refunded in cash: the Register activity must say Cash,
    # not repeat the sale's own "Card $106.75".
    sale_id, total = _sell(100.00, method="card")
    doc = _refund(amount=total, sale_id=_receipt(sale_id), payment_method="cash")["refund"]
    rows = run(server._register_day_summary(_day()))["activity"]
    row = next(a for a in rows if a["id"] == doc["id"])
    assert row["payment_method_label"] == "Cash"


# ------------------------------- one ceiling, whichever way round it happens
# A refund by hand is money only, not items. A void or return after it would
# hand the same money and tax back again, so both refuse (audit #27).

def test_after_a_refund_by_hand_the_sale_cannot_also_be_returned():
    from domains.pos import services as pos
    sale_id, total = _sell(100.00)
    _refund(amount=50.00, sale_id=_receipt(sale_id))
    preview = run(server.get_pos_sale_return_preview(sale_id, ADMIN))
    assert preview["can_return"] is False and "refunded by hand" in preview["blocked_reason"]
    with pytest.raises(HTTPException) as e:
        run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
            lines=[{"line_index": 0, "qty": 1, "restock": False}],
            reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    assert e.value.status_code == 409
    assert _tax_reversed_on(sale_id) == round(6.75 * 50 / 106.75, 2), "only the hand refund's tax went back"


def test_after_a_refund_by_hand_the_sale_cannot_also_be_voided():
    from unittest.mock import patch

    async def _noop(*a, **k):
        return None
    sale_id, total = _sell(100.00)
    _refund(amount=total, sale_id=_receipt(sale_id))
    with patch.object(server, "_issue_pos_token", new=_noop), pytest.raises(HTTPException) as e:
        run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
            reason=f"{TAG} void", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    assert e.value.status_code == 409 and "refunded by hand" in str(e.value.detail)
    assert run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "status": 1}))["status"] == "completed"
    assert _tax_reversed_on(sale_id) == 6.75


def test_goods_returned_one_unit_at_a_time_leave_no_cent_of_tax_to_trip_the_mixed_rule():
    # 2 x $8.99 ($1.21 tax) and a $20 service. Each single return gives back
    # $0.60 of tax, leaving a cent on paper; the goods are all back, so the
    # service refunds against the receipt with no tax and no refusal.
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} toy", "price": 8.99, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=2),
               server.PosSaleLineIn(kind="custom", description=f"{TAG} nail trim", custom_amount=20.00,
                                    custom_reason=f"{TAG} walk-in", custom_kind="service")],
        tenders=[server.PosSaleTenderIn(method="cash", amount=39.19, tendered_amount=39.19)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale_id = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    assert run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "tax_amount": 1}))["tax_amount"] == 1.21
    _return_all(sale_id)
    _return_all(sale_id)
    assert _tax_reversed_on(sale_id) == 1.20
    doc = _refund(amount=20.00, sale_id=_receipt(sale_id))["refund"]
    assert doc["tax_amount"] == 0.0 and doc["pos_sale_id"] == sale_id


def test_a_sale_from_before_lines_said_what_was_taxed_still_gives_its_tax_back():
    legacy = {"id": f"{TAG}-{uuid.uuid4()}", "receipt_number": f"L{uuid.uuid4().hex[:7].upper()}", "status": "completed",
              "total": 106.75, "tax_amount": 6.75, "tax_rate_pct": RATE, "business_date": _day(),
              "line_items": [{"kind": "retail", "qty": 1, "amount": 100.0, "net_amount": 100.0}]}
    run(server.db.pos_sales.insert_one(dict(legacy)))
    try:
        doc = _refund(amount=106.75, sale_id=legacy["receipt_number"])["refund"]
        assert doc["tax_amount"] == -6.75 and doc["pos_sale_id"] == legacy["id"]
    finally:
        run(server.db.pos_sales.delete_one({"id": legacy["id"]}))


# ---------------------- a pack, program or gift card is undone by a void

def _pack_sale(business_date=None):
    sale = {"id": f"{TAG}-{uuid.uuid4()}", "receipt_number": f"P{uuid.uuid4().hex[:7].upper()}", "status": "completed",
            "total": 250.0, "tax_amount": 0.0, "business_date": business_date or _day(),
            "line_items": [{"kind": "credit_pack", "qty": 1, "amount": 250.0, "net_amount": 250.0, "taxable": False}]}
    run(server.db.pos_sales.insert_one(dict(sale)))
    return sale


def test_a_pack_sale_that_can_still_be_voided_is_sent_to_the_void():
    # A money-only refund would leave the client holding the credits.
    sale = _pack_sale()
    try:
        with pytest.raises(HTTPException) as e:
            _refund(amount=25.00, sale_id=sale["receipt_number"])
        assert e.value.status_code == 409 and "void the sale" in str(e.value.detail)
    finally:
        run(server.db.pos_sales.delete_one({"id": sale["id"]}))


def test_once_its_day_is_closed_a_pack_sale_refunds_against_its_receipt(monkeypatch):
    # No void is possible after closeout, so the refund is the only way — and
    # it stays linked, so the ceiling holds.
    import datetime as dt
    from domains.register import services as reg
    sale = _pack_sale((server.business_today() - dt.timedelta(days=3)).isoformat())   # sold on a day since closed

    async def _closed(day):
        return {"date": day} if day == sale["business_date"] else None
    monkeypatch.setattr(reg, "_active_register_closeout_fn", _closed)
    try:
        doc = _refund(amount=25.00, sale_id=sale["receipt_number"])["refund"]
        assert doc["pos_sale_id"] == sale["id"] and doc["tax_amount"] == 0.0
        with pytest.raises(HTTPException) as e:
            _refund(amount=225.01, sale_id=sale["receipt_number"])
        assert e.value.status_code == 400
    finally:
        run(server.db.pos_sales.delete_one({"id": sale["id"]}))


def test_untaxed_goods_all_returned_no_longer_make_the_sale_mixed():
    from domains.pos import services as pos
    taxed, untaxed = str(uuid.uuid4()), str(uuid.uuid4())
    for pid, taxable, price in ((taxed, True, 100.00), (untaxed, False, 20.00)):
        run(server.db.pos_products.insert_one({
            "id": pid, "name": f"{TAG} {'toy' if taxable else 'exempt'}", "price": price, "active": True, "archived": False,
            "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": taxable,
            "tax_exempt_reason": None if taxable else "resale", "category": "", "description": "", "sku": "",
            "category_id": None, "subcategory_id": None}))
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=taxed, qty=1),
               server.PosSaleLineIn(kind="retail", product_id=untaxed, qty=1)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=126.75, tendered_amount=126.75)],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    sale_id = out.get("pos_sale_id") or (out.get("sale") or {}).get("id")
    lines = run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "line_items": 1}))["line_items"]
    assert [li["taxable"] for li in lines] == [True, False]
    run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=[{"line_index": 1, "qty": 1, "restock": False}],
        reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    doc = _refund(amount=53.38, sale_id=_receipt(sale_id))["refund"]    # half the toy, tax worked out
    assert doc["tax_amount"] == -3.38


def test_on_a_goods_only_sale_a_stray_tax_in_the_box_is_ignored_and_the_tax_worked_out():
    # A 0 left in the tax box from an earlier service refund must not stop a
    # taxed sale's tax going back — the #27 problem all over again.
    sale_id, total = _sell(100.00)
    doc = _refund(amount=total, sale_id=_receipt(sale_id), tax_amount=0)["refund"]
    assert doc["tax_amount"] == -6.75


# Sent to the void only when a void would really undo it — never to a void
# that refuses and sends the desk back here, or one that over-refunds.

def test_a_pack_with_credits_already_used_refunds_against_its_receipt():
    # A void would hand back the full price and only take back unused credits.
    sale = _pack_sale()
    lot = {"id": f"{TAG}-{uuid.uuid4()}", "pos_sale_id": sale["id"], "qty_total": 10, "qty_remaining": 7}
    run(server.db.credit_lots.insert_one(dict(lot)))
    try:
        doc = _refund(amount=175.00, sale_id=sale["receipt_number"])["refund"]
        assert doc["pos_sale_id"] == sale["id"]
    finally:
        run(server.db.credit_lots.delete_one({"id": lot["id"]}))
        run(server.db.pos_sales.delete_one({"id": sale["id"]}))


def test_a_sale_whose_void_would_refuse_refunds_against_its_receipt(monkeypatch):
    # e.g. a gift card sold on it was partly spent: the void says "give back
    # the unused part by hand", so the refund box must take it.
    from domains.register import services as reg
    sale = _pack_sale()

    async def _refuses(s):
        raise HTTPException(status_code=409, detail="A gift card sold on this sale has been spent.")
    monkeypatch.setattr(reg.gift_card_services, "plan_void", _refuses)
    try:
        doc = _refund(amount=30.00, sale_id=sale["receipt_number"])["refund"]
        assert doc["pos_sale_id"] == sale["id"]
    finally:
        run(server.db.pos_sales.delete_one({"id": sale["id"]}))


def test_after_a_refund_by_hand_a_reopened_days_pack_sale_is_not_sent_back_to_the_void(monkeypatch):
    import datetime as dt
    from domains.register import services as reg
    sale = _pack_sale((server.business_today() - dt.timedelta(days=3)).isoformat())
    real = reg._active_register_closeout_fn

    async def _closed(day):
        return {"date": day} if day == sale["business_date"] else await real(day)
    monkeypatch.setattr(reg, "_active_register_closeout_fn", _closed)
    try:
        _refund(amount=25.00, sale_id=sale["receipt_number"])      # while its day was closed
        monkeypatch.setattr(reg, "_active_register_closeout_fn", real)   # the day is reopened
        doc = _refund(amount=25.00, sale_id=sale["receipt_number"])["refund"]
        assert doc["pos_sale_id"] == sale["id"], "the void refuses after a hand refund, so this must not send the desk there"
    finally:
        run(server.db.pos_sales.delete_one({"id": sale["id"]}))
