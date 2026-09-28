"""Gift card money spent AT THE REGISTER is never new income or new cash
(audit #72, found while fixing #19; owner option A, 2026-09-28).

Before: the money a card paid was recorded on the sale's merchandise row
only. A credit pack or training program bought with a card therefore counted
as income a second time (P&L, Weekly Summary, Quarterly Tax and the tax
estimates on it), and a mixed cart put the whole card amount on the
merchandise row, where it was clamped, so the rest counted again on the pack.
Several "cash collected" figures (Quarterly Tax, Money Health, the P&L's
cash-flow block, the register's "where the money came from" tiles — and so
the tax-summary sheet) added the raw row amount even for a sale a card paid,
and a void of a card-paid sale showed up as a refund.

Now the card's share is spread over every revenue row of the sale, voids
take back exactly that share, and every "cash collected" figure uses the one
"what actually came into the till" rule. A one-time repair re-shares the
card money on earlier pack/program sales.

Each test measures the day's figures before and after one sale, so other data
in the database cannot move the answer. Self-contained fixtures.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import pl_report
from _test_loop import run
from domains.gift_cards import services as gift
from domains.pos import services as pos

TAG = "TEST_GC_REGISTER_ONCE"
RATE = 6.75
ADMIN = {"id": "gc-register-admin", "name": "GC Register QA", "email": "gcregister@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _register_open_with_tax():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = _day()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 200.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def _day():
    return server.business_today().isoformat()


def _client():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "training_credits": 0, "account_balance": 0.0}))
    return cid


def _product(price=20.00):
    pid = f"{TAG}-p-{uuid.uuid4().hex[:8]}"
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} bag of food", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


def _pack(price=100.0):
    pid = f"{TAG}-pack-{uuid.uuid4().hex[:8]}"
    run(server.db.credit_packs.insert_one({
        "id": pid, "name": f"{TAG} pack", "price": price, "qty": 5, "active": True, "show_at_register": True,
        "service_type": "daycare", "category_id": None, "subcategory_id": None, "featured": False, "image_id": None}))
    return pid


def _program(price=300.0):
    pid = f"{TAG}-prog-{uuid.uuid4().hex[:8]}"
    run(server.db.programs.insert_one({
        "id": pid, "name": f"{TAG} program", "price": price, "format": {"count": 6, "unit": "sessions"},
        "active": True, "show_at_register": True, "type": "private_lessons", "min_age_months": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None}))
    return pid


def _card(value=500.00):
    return run(gift.mint_card(amount=value, actor=ADMIN, note=f"{TAG} test card", origin="issued"))


def _balance(card):
    return round(float(run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"]), 2)


def _sale(cid, lines, tenders):
    out = run(pos.create_sale(server.PosSaleIn(
        client_id=cid,
        lines=[server.PosSaleLineIn(**l) for l in lines],
        tenders=[server.PosSaleTenderIn(**t) for t in tenders],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


def _by_card(card, amount):
    return {"method": "gift_card", "amount": amount, "gift_card_code": card["code"]}


def _void(sale_id):
    return run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
        reason=f"{TAG} customer changed their mind", idempotency_key=f"void-{uuid.uuid4()}"), ADMIN))


def _return(sale_id, lines):
    return run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=lines, reason=f"{TAG} changed their mind", idempotency_key=f"ret-{uuid.uuid4()}"), ADMIN))


def _pick(d, key):
    """A key anywhere in a nested report."""
    if isinstance(d, dict):
        if key in d:
            return d[key]
        for v in d.values():
            found = _pick(v, key)
            if found is not None:
                return found
    return None


def _figures():
    """Every place register money shows up — income, and money coming in."""
    d = _day()
    pl = run(pl_report.build_pl_data(server.db, d, d))
    week = run(server.weekly_summary(_=ADMIN))
    quarter = run(server.admin_quarterly_tax(_=ADMIN, year=None))
    health = run(server.admin_money_health(start_date=d, end_date=d, _=ADMIN))
    reg = run(server._register_day_summary(d))
    src = reg["incoming_sources"]
    return {
        # income
        "pl_net": float(pl.get("net") or 0),
        "weekly_net": float(week.get("net_total") or 0),
        "quarterly_profit": float(quarter.get("net_profit") or 0),
        "health_schedule_c": float(_pick(health, "schedule_c_income") or 0),
        # money coming in
        "pl_cash_in": float(_pick(pl, "total_cash_in") or 0),
        "quarterly_cash": float(quarter["income"]["cash_collected_before_sales_tax"]),
        "health_retail_cash": float(_pick(health, "retail_collected_before_sales_tax") or 0),
        "health_pack_cash": float(_pick(health, "credit_pack_cash_sales_in_window") or 0),
        "register_sources": float(src["manual_sales"] + src["credit_pack_sales"] + src["training_program_sales"]),
        "register_refunds": float(src["refunds"]),
        "register_incoming": float(reg["totals"]["incoming_total"]),
    }


INCOME = ("pl_net", "weekly_net", "quarterly_profit", "health_schedule_c")
MONEY_IN = ("pl_cash_in", "quarterly_cash", "health_retail_cash", "register_sources", "register_incoming")


def _delta(before, after):
    return {k: round(after[k] - before[k], 2) for k in before}


def _nothing(change):
    return {k: v for k, v in change.items() if abs(v) >= 0.01}


def _cleanup(cid, ids=()):
    async def go():
        for coll in ("retail_sales", "pos_sales", "credit_lots", "clients", "pos_sale_returns"):
            await getattr(server.db, coll).delete_many({"client_id": cid} if coll != "clients" else {"id": cid})
        await server.db.pos_products.delete_many({"id": {"$in": list(ids)}})
        await server.db.credit_packs.delete_many({"id": {"$in": list(ids)}})
        await server.db.programs.delete_many({"id": {"$in": list(ids)}})
    run(go())


def test_a_credit_pack_bought_with_a_gift_card_is_not_new_income_or_money_in():
    cid, pack, card = _client(), _pack(100.0), _card()
    try:
        before = _figures()
        _sale(cid, [{"kind": "credit_pack", "pack_id": pack, "qty": 1}], [_by_card(card, 100.0)])
        assert _balance(card) == 400.0
        assert run(server.db.clients.find_one({"id": cid}))["credits"] == 5, "the customer still gets the credits"
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [pack])


def test_a_training_program_bought_with_a_gift_card_is_not_new_income_or_money_in():
    cid, prog, card = _client(), _program(300.0), _card()
    try:
        before = _figures()
        _sale(cid, [{"kind": "training_program", "program_id": prog, "qty": 1}], [_by_card(card, 300.0)])
        assert _balance(card) == 200.0
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [prog])


def test_a_mixed_cart_paid_by_card_counts_nothing_but_the_sales_tax_is_still_owed():
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        before = _figures()
        tax_before = run(server.sales_tax_summary(_day(), _day(), ADMIN))["total_tax_collected"]
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
                    [_by_card(card, 121.35)])
        assert _nothing(_delta(before, _figures())) == {}
        tax_after = run(server.sales_tax_summary(_day(), _day(), ADMIN))["total_tax_collected"]
        assert round(tax_after - tax_before, 2) == 1.35, "the tax on the food was really collected"
        rows = run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(10))
        assert round(sum(r.get("gift_card_funded") or 0 for r in rows), 2) == 120.0
    finally:
        _cleanup(cid, [item, pack])


def test_a_mixed_cart_paid_partly_by_card_counts_only_the_other_money():
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        before = _figures()
        _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
              [_by_card(card, 60.0), {"method": "check", "amount": 61.35}])
        change = _delta(before, _figures())
        # $121.35 = $120 + $1.35 tax; the card paid $60 of it, so $59.33 of the
        # $120 was already income when the card was sold.
        for k in INCOME:
            assert abs(change[k] - 60.67) <= 0.01, (k, change[k])
        for k in MONEY_IN:
            assert abs(change[k] - 61.35) <= 0.01, (k, change[k])
    finally:
        _cleanup(cid, [item, pack])


def test_a_custom_service_line_paid_by_card_is_not_money_in():
    cid, card = _client(), _card()
    try:
        before = _figures()
        _sale(cid, [{"kind": "custom", "description": f"{TAG} nail trim", "custom_amount": 15.0, "custom_kind": "service",
                     "custom_reason": "nail trim at pickup"}],
              [_by_card(card, 15.0)])
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid)


def test_voiding_a_pack_bought_with_a_card_nets_to_nothing_and_is_no_refund():
    cid, pack, card = _client(), _pack(100.0), _card()
    try:
        before = _figures()
        sid = _sale(cid, [{"kind": "credit_pack", "pack_id": pack, "qty": 1}], [_by_card(card, 100.0)])
        _void(sid)
        assert _balance(card) == 500.0, "the card got its money back"
        assert run(server.db.clients.find_one({"id": cid}))["credits"] == 0, "and the credits went away"
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [pack])


def test_returning_card_paid_goods_is_no_refund_of_money():
    cid, item, card = _client(), _product(20.0), _card()
    try:
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}], [_by_card(card, 21.35)])
        before = _figures()
        _return(sid, [{"line_index": 0, "qty": 1, "restock": True}])
        assert _balance(card) == 500.0
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [item])


def test_money_that_is_not_a_gift_card_still_counts():
    cid, item, pack = _client(), _product(20.0), _pack(100.0)
    try:
        before = _figures()
        _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
              [{"method": "check", "amount": 121.35}])
        change = _delta(before, _figures())
        for k in INCOME:
            assert abs(change[k] - 120.0) <= 0.01, (k, change[k])
        for k in MONEY_IN:
            assert abs(change[k] - 121.35) <= 0.01, (k, change[k])
    finally:
        _cleanup(cid, [item, pack])


def _make_old_style(sid, card, *, funded=120.0, era_before_tender_links=True):
    """What a sale rung before the fix looks like: all the card money on the
    merchandise row (clamped there), none on the pack. Sales from 2026-09-20
    to 09-26 also kept the paying card ONLY on that row, not on the tender."""
    sale = run(server.db.pos_sales.find_one({"id": sid}, {"_id": 0}))
    run(server.db.retail_sales.update_one({"id": sale["retail_sales_id"]},
                                          {"$set": {"gift_card_funded": funded, "gift_card_ids": [card["id"]]}}))
    run(server.db.retail_sales.update_many({"pos_sale_id": sid, "source_kind": "credit_pack_sale"},
                                           {"$unset": {"gift_card_funded": "", "gift_card_ids": ""}}))
    if era_before_tender_links:
        run(server.db.pos_sales.update_one({"id": sid, "tenders.method": "gift_card"},
                                           {"$unset": {"tenders.$.gift_card_id": ""}}))


def _rung_an_hour_ago(*sids):
    an_hour_ago = (server.datetime.now(server.timezone.utc) - server.timedelta(hours=1)).isoformat()
    run(server.db.pos_sales.update_many({"id": {"$in": list(sids)}}, {"$set": {"created_at": an_hour_ago}}))


def _daily_repair():
    """The scheduler's job, exactly as a tick runs it (once a day)."""
    job = dict(server._scheduler_jobs())[gift.FUNDING_REPAIR_JOB]
    return run(job())


def test_the_repair_re_shares_card_money_on_earlier_pack_sales_and_keeps_the_card_link():
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        before = _figures()
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
                    [_by_card(card, 121.35)])
        voided = _sale(cid, [{"kind": "credit_pack", "pack_id": pack, "qty": 1}], [_by_card(card, 100.0)])
        _void(voided)
        _make_old_style(sid, card)
        assert _delta(before, _figures())["pl_net"] == 100.0, "the old double count"
        merch_id = run(server.db.pos_sales.find_one({"id": sid}))["retail_sales_id"]

        run(gift.backfill_spread_funding())
        assert run(server.db.retail_sales.find_one({"id": merch_id}))["gift_card_funded"] == 120.0,             "a sale still being rung up (under 10 minutes old) is never touched"

        _rung_an_hour_ago(sid, voided)
        voided_rows = run(server.db.retail_sales.find({"pos_sale_id": voided}, {"_id": 0}).to_list(20))
        run(gift.backfill_spread_funding())
        assert _nothing(_delta(before, _figures())) == {}
        assert run(server.db.retail_sales.find_one({"id": merch_id}))["gift_card_ids"] == [card["id"]],             "the only record of which card paid is kept"
        assert run(server.db.retail_sales.find({"pos_sale_id": voided}, {"_id": 0}).to_list(20)) == voided_rows,             "a voided sale is left exactly as it was"
        rows_now = run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(20))
        run(gift.backfill_spread_funding())
        assert run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(20)) == rows_now,             "a sale that is already right is not written again"

        _void(sid)   # still voidable: the card gets its money back and everything nets to nothing
        assert _balance(card) == 500.0
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [item, pack])


def test_restoring_an_older_backup_over_repaired_sales_is_put_right_again():
    """A Merge restore (the default) writes the old rows' fields back over the
    live ones but never removes a field: the merchandise row gets its old
    all-of-the-card share back while the pack row keeps its new one, so the
    card money is taken off twice. The repair decides from the rows, and the
    restore sends it round again."""
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        before = _figures()
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
                    [_by_card(card, 60.0), {"method": "check", "amount": 61.35}])
        _rung_an_hour_ago(sid)
        _make_old_style(sid, card, funded=59.33)
        backup = {"pos_sales": [run(server.db.pos_sales.find_one({"id": sid}, {"_id": 0}))],
                  "retail_sales": run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(20))}

        def right():
            change = _delta(before, _figures())
            return all(abs(change[k] - 60.67) <= 0.01 for k in INCOME) and                 all(abs(change[k] - 61.35) <= 0.01 for k in MONEY_IN)

        assert not right(), "the old split counts card money as income"
        run(server.db.system_runs.delete_one({"_id": gift.FUNDING_REPAIR_JOB}))
        _daily_repair()
        assert right()
        run(server._restore_collections(backup, "merge"))
        assert not right(), "the merge left the card money taken off twice"
        assert run(server.db.system_runs.find_one({"_id": gift.FUNDING_REPAIR_JOB})) is None,             "the restore sends the repair round again"
        _daily_repair()
        assert right()
    finally:
        _cleanup(cid, [item, pack])


def test_a_void_that_raced_the_repair_is_put_back_in_step():
    """The desk voids an old-style sale while the repair is re-sharing it:
    the void rows mirror the OLD split, the originals now carry the new one,
    and the sale would sit at minus the pack price. The next run puts the
    void rows back in step, so the voided sale nets to nothing again."""
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        before = _figures()
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
                    [_by_card(card, 121.35)])
        _rung_an_hour_ago(sid)
        _void(sid)
        # what the race leaves: originals re-shared, the pack's void row without its share
        run(server.db.retail_sales.update_many({"pos_sale_id": sid, "source_kind": "pos_sale_void",
                                                "reversed_retail_sales_id": {"$ne": run(server.db.pos_sales.find_one({"id": sid}))["retail_sales_id"]}},
                                               {"$unset": {"gift_card_funded": ""}}))
        assert _delta(before, _figures())["pl_net"] == -100.0
        run(gift.backfill_spread_funding())
        assert _nothing(_delta(before, _figures())) == {}
    finally:
        _cleanup(cid, [item, pack])


def test_a_sale_trimmed_on_purpose_is_never_re_shared():
    """The owner deletes the food line of a past sale from Income. The pack's
    card share must stay exactly as it was rung — the repair only ever
    touches the old-split shapes."""
    cid, item, pack, card = _client(), _product(20.0), _pack(100.0), _card()
    try:
        sid = _sale(cid, [{"kind": "retail", "product_id": item, "qty": 1}, {"kind": "credit_pack", "pack_id": pack, "qty": 1}],
                    [_by_card(card, 60.0), {"method": "check", "amount": 61.35}])
        _rung_an_hour_ago(sid)
        run(server.db.retail_sales.delete_one({"id": run(server.db.pos_sales.find_one({"id": sid}))["retail_sales_id"]}))
        pack_rows = run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(10))
        run(gift.backfill_spread_funding())
        assert run(server.db.retail_sales.find({"pos_sale_id": sid}, {"_id": 0}).to_list(10)) == pack_rows
    finally:
        _cleanup(cid, [item, pack])


def _repair_done_today():
    run(server.db.system_runs.update_one({"_id": gift.FUNDING_REPAIR_JOB},
                                         {"$set": {"date": server.business_today().isoformat()}}, upsert=True))


def test_a_restore_that_fails_partway_still_sends_the_repair_round():
    _repair_done_today()

    async def dies(*_a, **_k):
        _repair_done_today()   # the repair ran on a scheduler tick mid-restore...
        raise RuntimeError("the server restarted during the restore")   # ...then the restore died
    with pytest.raises(RuntimeError):
        run(server._restore_collections({"retail_sales": []}, "merge", dies))
    assert run(server.db.system_runs.find_one({"_id": gift.FUNDING_REPAIR_JOB})) is None
