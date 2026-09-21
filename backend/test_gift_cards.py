"""Gift cards, and the one thing that must not go wrong with them.

A gift card is money the customer has already paid for. Revenue is recognised
when the card is SOLD (the owner's decision, right on a cash basis), so
redeeming one must NOT book revenue a second time — otherwise $100 of cash
turns into $200 of income and you pay tax on money you never made.

The other half is sales tax. A card is never taxed when sold; the tax lands on
whatever the card buys. Taxing both charges the customer twice on the same
dollars.

Everything else here is the ordinary shopkeeping: a card cannot be overspent,
cannot be spent twice from two tills, cannot buy another card, and a sale that
fails must hand the balance straight back.

Disposable tag TEST_GIFT.
"""
import asyncio
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
import pl_report

from domains.gift_cards import services as gift

TAG = "TEST_GIFT"
RATE = 6.75
ADMIN = {"id": "gift-admin", "name": "Gift QA", "email": "gift@test", "role": "admin"}


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


def _revenue():
    pl = run(pl_report.build_pl_data(server.db, _day(), _day()))
    return round(float(pl.get("net") or 0), 2)


def _tax_owed():
    return round(float(run(server.sales_tax_summary(_day(), _day(), ADMIN))["total_tax_collected"]), 2)


def _expected_cash():
    return round(float(run(server._register_day_summary(_day()))["totals"]["expected_cash"]), 2)


def _money_in():
    """Everything the register counts as money ARRIVING today, by method.
    A gift card redemption must not appear in ANY of these — not cash, and
    not quietly in "other" either."""
    return run(server._register_day_summary(_day()))["incoming_by_method"]


def _product(price=50.00):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} item", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


def _sale(lines, tenders):
    out = run(server.pos_domain_services.create_sale(server.PosSaleIn(
        lines=[server.PosSaleLineIn(**l) for l in lines],
        tenders=[server.PosSaleTenderIn(**t) for t in tenders],
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


def _sell_card(value=100.00, method="cash"):
    tender = {"method": method, "amount": value}
    if method == "cash":
        tender["tendered_amount"] = value
    sale_id = _sale([{"kind": "gift_card", "gift_card_amount": value}], [tender])
    card = run(server.db.gift_cards.find_one({"sold_via_pos_sale_id": sale_id}, {"_id": 0}))
    return sale_id, card


# ------------------------------------------------------------ selling a card

def test_selling_a_card_takes_the_money_and_charges_no_tax():
    owed, cash = _tax_owed(), _expected_cash()
    _sale_id, card = _sell_card(100.00)
    assert card and card["balance"] == 100.00 and card["status"] == "active"
    assert _tax_owed() == owed, "a gift card is money, not a taxable good"
    assert round(_expected_cash() - cash, 2) == 100.00


def test_selling_a_card_books_the_revenue_now():
    before = _revenue()
    _sell_card(100.00)
    assert round(_revenue() - before, 2) == 100.00


def test_the_code_is_readable_off_a_card_by_a_person():
    _sale_id, card = _sell_card(25.00)
    code = card["code"]
    assert len(code) == 12
    assert not (set(code) & set("01OIL")), "no characters that get misread"
    # and typed back in any shape a human might
    assert gift.normalize_code(f" {code[:4]}-{code[4:8]} {code[8:]} ".lower()) == code


# --------------------------------------------------- the double-count guard

def test_spending_a_card_does_not_book_the_revenue_twice():
    # THE test. $100 card sold, then $50 of food bought with it.
    _sale_id, card = _sell_card(100.00)
    after_sale = _revenue()
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert round(_revenue() - after_sale, 2) == 0.00, \
        "the $50 of goods was already paid for when the card was sold"


def test_but_the_tax_on_what_it_bought_is_still_owed():
    _sale_id, card = _sell_card(100.00)
    owed = _tax_owed()
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert round(_tax_owed() - owed, 2) == 3.38, "Ohio is owed tax on the goods"


def test_spending_a_card_brings_no_money_in_at_all():
    _sale_id, card = _sell_card(100.00)
    cash, before = _expected_cash(), _money_in()
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert _expected_cash() == cash, "no cash arrived — it arrived when the card was sold"
    after = _money_in()
    moved = {k: round(after.get(k, 0) - before.get(k, 0), 2)
             for k in set(before) | set(after)
             if abs(after.get(k, 0) - before.get(k, 0)) > 0.004}
    assert moved == {}, f"a redemption is not money in, but these moved: {moved}"


def test_the_whole_story_adds_up():
    # One card, sold and spent: $100 cash in, $100 revenue, tax on the goods.
    rev0, cash0, owed0 = _revenue(), _expected_cash(), _tax_owed()
    _sale_id, card = _sell_card(100.00)
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert round(_expected_cash() - cash0, 2) == 100.00
    assert round(_revenue() - rev0, 2) == 100.00
    assert round(_tax_owed() - owed0, 2) == 3.38


# ------------------------------------------------------------ spending rules

def test_the_card_itself_refuses_to_go_below_zero():
    # Belt as well as braces: the cart checks the total up front, and the
    # card refuses at the moment of spending. Either alone would do; both
    # means a caller that skips the cart still cannot overdraw a card.
    _sale_id, card = _sell_card(15.00)
    with pytest.raises(HTTPException) as e:
        run(gift.redeem(code=card["code"], amount=20.00, actor=ADMIN))
    assert e.value.status_code == 400
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"] == 15.00


def test_a_card_cannot_be_overspent():
    _sale_id, card = _sell_card(20.00)
    pid = _product(50.00)
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
              [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert e.value.status_code == 400
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"] == 20.00


def test_the_balance_comes_back_if_the_sale_fails():
    # The sale is refused after the card has been debited; the customer must
    # not be left with a lighter card and nothing to show for it.
    _sale_id, card = _sell_card(100.00)
    pid = _product(50.00)
    with pytest.raises(HTTPException):
        _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
              [{"method": "gift_card", "amount": 30.00, "gift_card_code": card["code"]},
               {"method": "cash", "amount": 5.00, "tendered_amount": 5.00}])  # does not add up
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"] == 100.00


def test_a_card_cannot_buy_another_card():
    _sale_id, card = _sell_card(100.00)
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "gift_card", "gift_card_amount": 50.00}],
              [{"method": "gift_card", "amount": 50.00, "gift_card_code": card["code"]}])
    assert e.value.status_code == 400
    assert "another gift card" in str(e.value.detail)


def test_part_of_a_card_plus_cash_works():
    _sale_id, card = _sell_card(20.00)
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 20.00, "gift_card_code": card["code"]},
           {"method": "cash", "amount": 33.38, "tendered_amount": 40.00}])
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"] == 0.0
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["status"] == "spent"


def test_a_voided_card_cannot_be_spent():
    _sale_id, card = _sell_card(50.00)
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"status": "voided"}}))
    pid = _product(50.00)
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
              [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    assert e.value.status_code == 409


def test_an_unknown_code_is_refused():
    pid = _product(50.00)
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
              [{"method": "gift_card", "amount": 53.38, "gift_card_code": "ZZZZ-ZZZZ-ZZZZ"}])
    assert e.value.status_code == 404


# --------------------------------------------------------- issuing by hand

def test_a_comped_card_is_a_liability_not_income():
    before = _revenue()
    card = run(gift.mint_card(amount=25.00, actor=ADMIN,
                              note=f"{TAG} make-good for a bad groom", origin="issued"))
    assert card["balance"] == 25.00
    assert _revenue() == before, "no money came in, so nothing was earned"


def test_the_balance_and_history_can_be_looked_up():
    _sale_id, card = _sell_card(40.00)
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 40.00, "gift_card_code": card["code"]},
           {"method": "cash", "amount": 13.38, "tendered_amount": 13.38}])
    view = run(gift.card_detail(card["code"]))
    assert view["balance"] == 0.0 and view["spent"] == 40.00
    kinds = [h["kind"] for h in view["history"]]
    assert kinds == ["issue", "redeem"]


def test_what_you_owe_card_holders_is_one_number():
    _sell_card(100.00)
    _sell_card(25.00)
    listing = run(gift.list_cards())
    assert listing["outstanding_balance"] >= 125.00
    assert listing["outstanding_count"] >= 2


def test_a_lost_card_can_be_killed_and_then_refuses_to_spend():
    _sale_id, card = _sell_card(60.00)
    run(gift.void_card(code=card["code"], body=gift.GiftCardVoidIn(reason=f"{TAG} lost"), actor=ADMIN))
    assert run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["status"] == "voided"
    with pytest.raises(HTTPException):
        run(gift.redeem(code=card["code"], amount=5.0, actor=ADMIN))


def test_a_balance_correction_leaves_a_reason_behind():
    _sale_id, card = _sell_card(30.00)
    run(gift.adjust(code=card["code"], actor=ADMIN, body=gift.GiftCardAdjustIn(
        amount=10.0, direction="add", reason=f"{TAG} owner goodwill")))
    view = run(gift.card_detail(card["code"]))
    assert view["balance"] == 40.00
    assert any(h["kind"] == "adjust" and TAG in (h["note"] or "") for h in view["history"])


def test_a_correction_cannot_take_a_card_below_zero():
    _sale_id, card = _sell_card(10.00)
    with pytest.raises(HTTPException) as e:
        run(gift.adjust(code=card["code"], actor=ADMIN, body=gift.GiftCardAdjustIn(
            amount=50.0, direction="remove", reason=f"{TAG} too much")))
    assert e.value.status_code == 400


def test_the_endpoints_exist_and_are_gated_sensibly():
    # Looking a card up is a counter question, so any employee may. Creating
    # money out of nothing, or destroying it, is not.
    paths = {r.path: r for r in server.app.routes if "gift-card" in getattr(r, "path", "")}
    assert set(paths) == {
        "/api/gift-cards", "/api/gift-cards/lookup/{code}", "/api/gift-cards/issue",
        "/api/gift-cards/stock", "/api/gift-cards/{code}/details",
        "/api/gift-cards/{code}/adjust", "/api/gift-cards/{code}/void",
        # Customer-facing. Every one of these is gated to a signed-in client
        # and none of them can move money on its own — only a verified
        # Stripe webhook does that.
        "/api/portal/gift-cards/{code}",
        "/api/portal/gift-cards/{code}/topup-session",
        "/api/portal/gift-cards/purchase-session",
        "/api/portal/gift-card-attempts/{attempt_id}",
    }


def test_two_tills_cannot_spend_the_same_last_ten_dollars():
    _sale_id, card = _sell_card(10.00)
    run(gift.redeem(code=card["code"], amount=10.00, actor=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(gift.redeem(code=card["code"], amount=10.00, actor=ADMIN))
    assert e.value.status_code == 409


# ------------------------------------------------- the code must be unguessable

def test_codes_come_from_a_cryptographic_generator():
    """`random` is a Mersenne Twister: see enough of its output and you can
    reconstruct its state and compute every code it will produce next. For
    money that is not a theoretical distinction, so the generator must be
    `secrets`. This pins the import, because the two are one word apart."""
    import inspect
    src = inspect.getsource(gift)
    assert "secrets.choice" in src
    assert "random.choice" not in src
    assert "import random" not in src


def test_the_code_space_is_far_too_big_to_guess():
    import math
    bits = gift.CODE_GROUPS * gift.CODE_GROUP_LEN * math.log2(len(gift._ALPHABET))
    assert bits > 55, f"only {bits:.1f} bits of code — too few to be unguessable"


def test_two_hundred_codes_are_all_different():
    codes = {run(gift._fresh_code()) for _ in range(200)}
    assert len(codes) == 200


def test_a_code_is_never_reused_even_if_the_generator_repeats():
    # The uniqueness check is what makes a collision impossible rather than
    # merely unlikely, so it is exercised directly.
    _sale_id, card = _sell_card(10.00)
    existing = card["code"]
    seen = {"n": 0}
    real = gift.secrets.choice

    def once(alphabet):
        # force the first attempt to rebuild the code that already exists
        if seen["n"] < len(existing):
            ch = existing[seen["n"]]
            seen["n"] += 1
            return ch
        return real(alphabet)

    gift.secrets.choice = once
    try:
        fresh = run(gift._fresh_code())
    finally:
        gift.secrets.choice = real
    assert fresh != existing, "a duplicate must be rejected and regenerated"


def test_looking_codes_up_is_rate_limited():
    # Guessing is hopeless on the numbers; being allowed a million tries is
    # what would make it less hopeless.
    import inspect
    from domains.gift_cards import routes
    src = inspect.getsource(routes)
    assert "gift_card_lookup" in src and "enforce_rate_limit" in src


def test_the_code_lands_on_the_printed_receipt():
    """The thermal printer at the counter is driven from a fixed payload the
    local agent renders — nothing here can teach it a new document. So the
    code goes into the sale's own line description, which means the ordinary
    till receipt is itself proof of the card, and a reprint still works."""
    _sale_id, card = _sell_card(50.00)
    sale = run(server.db.pos_sales.find_one({"id": _sale_id}, {"_id": 0}))
    line = [li for li in sale["line_items"] if li["kind"] == "gift_card"][0]
    assert card["code"][:4] in line["description"].replace("-", "")
    assert "Gift card" in line["description"]

    payload = run(server._build_pos_sale_receipt_payload(_sale_id))
    printed = " ".join(str(li.get("description")) for li in payload["line_items"])
    assert card["code"][:4] in printed.replace("-", ""), "the code reaches the printer"


def test_two_cards_on_one_sale_both_reach_the_receipt():
    sale_id = _sale([{"kind": "gift_card", "gift_card_amount": 25.00, "qty": 2}],
                    [{"method": "cash", "amount": 50.00, "tendered_amount": 50.00}])
    cards = run(server.db.gift_cards.find({"sold_via_pos_sale_id": sale_id}, {"_id": 0}).to_list(10))
    assert len(cards) == 2
    payload = run(server._build_pos_sale_receipt_payload(sale_id))
    printed = " ".join(str(li.get("description")) for li in payload["line_items"]).replace("-", "")
    for c in cards:
        assert c["code"] in printed


# ---------------------------------------- the same story, on every surface
# The daily P&L reads the whole retail_sales document, so it nets the
# redemption out correctly. Surfaces that ask Mongo for a NAMED list of
# fields get a row with `gift_card_funded` missing, and the canonical
# revenue helper's `row.get("gift_card_funded") or 0` then quietly reads
# zero — the subtraction still runs, on nothing. Nothing raises; the number
# is just bigger. Each of these pins one surface to the daily P&L.

def _sell_then_spend():
    """$100 card sold for cash, then $50 of goods bought with it.

    Total business revenue for the day is $100: the goods were paid for when
    the card was sold. Anything reporting $150 has counted the card twice.
    """
    _sale_id, card = _sell_card(100.00)
    pid = _product(50.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 53.38, "gift_card_code": card["code"]}])
    return card


def test_the_pl_ytd_line_does_not_double_count_a_redeemed_card():
    before = run(pl_report.build_pl_data(server.db, _day(), _day()))["ytd"]["income"]
    _sell_then_spend()
    after = run(pl_report.build_pl_data(server.db, _day(), _day()))["ytd"]["income"]
    assert round(after - before, 2) == 100.00, \
        "the year-to-date line counted the $50 of goods on top of the card"


def test_the_pl_ytd_line_agrees_with_the_pl_above_it():
    # Same report, same day, two numbers that must not disagree.
    rev0 = _revenue()
    ytd0 = run(pl_report.build_pl_data(server.db, _day(), _day()))["ytd"]["income"]
    _sell_then_spend()
    pl = run(pl_report.build_pl_data(server.db, _day(), _day()))
    assert round(pl["net"] - rev0, 2) == round(pl["ytd"]["income"] - ytd0, 2)


def test_the_weekly_summary_does_not_double_count_a_redeemed_card():
    before = run(server.weekly_summary(ADMIN))["retail_total"]
    _sell_then_spend()
    after = run(server.weekly_summary(ADMIN))["retail_total"]
    assert round(after - before, 2) == 100.00, \
        "the weekly summary counted the $50 of goods on top of the card"


def test_the_weekly_net_total_does_not_double_count_a_redeemed_card():
    before = run(server.weekly_summary(ADMIN))["net_total"]
    _sell_then_spend()
    after = run(server.weekly_summary(ADMIN))["net_total"]
    assert round(after - before, 2) == 100.00, \
        "the week's net counted the $50 of goods on top of the card"


def test_the_cash_flow_ledger_counts_the_money_once():
    """The P&L's cash-flow block answers "where did this period's cash come
    from". A redemption brings in none: the cash arrived when the card was
    sold. Counting the redeemed sale again makes the report disagree with
    the drawer it is supposed to explain."""
    cf0 = run(pl_report.build_pl_data(server.db, _day(), _day()))["cash_flow"]["total_cash_in"]
    drawer0 = _expected_cash()
    _sell_then_spend()
    cf1 = run(pl_report.build_pl_data(server.db, _day(), _day()))["cash_flow"]["total_cash_in"]
    drawer1 = _expected_cash()
    assert round(cf1 - cf0, 2) == round(drawer1 - drawer0, 2) == 100.00, \
        "the cash-flow ledger and the till disagree about how much came in"


# ────────────────────────────────────────────── blanks on the rack (stock)
# Printed ahead, hung up, sold later. The whole risk is that a rack of
# plastic starts looking like money before anybody has paid for any of it.

def _blank():
    return run(gift.mint_stock(quantity=1, actor=ADMIN))[0]


def _sell_blank(code, value=75.00, method="cash"):
    tender = {"method": method, "amount": value}
    if method == "cash":
        tender["tendered_amount"] = value
    return _sale([{"kind": "gift_card", "gift_card_amount": value, "gift_card_code": code}],
                 [tender])


def test_printing_blanks_creates_real_codes_worth_nothing():
    made = run(gift.mint_stock(quantity=5, actor=ADMIN))
    assert len(made) == 5
    assert len({c["code"] for c in made}) == 5, "every blank needs its own code"
    for c in made:
        assert c["balance"] == 0.0 and c["status"] == "stock"
        assert len(c["code"]) == 12 and not (set(c["code"]) & set("01OIL"))


def test_a_rack_of_blanks_is_not_income_and_is_not_owed():
    rev, cash, owed = _revenue(), _expected_cash(), _tax_owed()
    before = run(gift.list_cards())["outstanding_balance"]
    run(gift.mint_stock(quantity=25, actor=ADMIN))
    assert _revenue() == rev, "printing cards is not earning money"
    assert _expected_cash() == cash
    assert _tax_owed() == owed
    after = run(gift.list_cards())
    assert after["outstanding_balance"] == before, "a blank is owed to nobody"
    assert after["stock_count"] >= 25


def test_a_blank_cannot_be_spent_before_it_is_sold():
    blank = _blank()
    pid = _product(10.00)
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
              [{"method": "gift_card", "amount": 10.68, "gift_card_code": blank["code"]}])
    assert e.value.status_code == 409
    assert "not been sold" in str(e.value.detail), "say WHY, not 'no balance left'"


def test_a_blank_cannot_be_loaded_with_a_balance_correction():
    # Otherwise you could put $500 on a card with no sale behind it: a
    # liability with no income, and no money in the till.
    blank = _blank()
    with pytest.raises(HTTPException) as e:
        run(gift.adjust(code=blank["code"], actor=ADMIN,
                        body=gift.GiftCardAdjustIn(amount=500.0, direction="add",
                                                   reason=f"{TAG} sneaky")))
    assert e.value.status_code == 409


def test_selling_a_blank_loads_the_card_the_customer_is_holding():
    blank = _blank()
    _sell_blank(blank["code"], 75.00)
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["code"] == blank["code"], "the printed code must not change"
    assert live["status"] == "active" and live["balance"] == 75.00
    assert live["initial_amount"] == 75.00


def test_selling_a_blank_mints_nothing_new():
    blank = _blank()
    before = run(server.db.gift_cards.count_documents({}))
    _sell_blank(blank["code"], 40.00)
    assert run(server.db.gift_cards.count_documents({})) == before, \
        "loading a rack card must not also create a second card"


def test_selling_a_blank_books_the_revenue_and_takes_the_cash():
    blank = _blank()
    rev, cash, owed = _revenue(), _expected_cash(), _tax_owed()
    _sell_blank(blank["code"], 60.00)
    assert round(_revenue() - rev, 2) == 60.00
    assert round(_expected_cash() - cash, 2) == 60.00
    assert _tax_owed() == owed, "a gift card is money, not a taxable good"


def test_a_sold_blank_then_spends_like_any_other_card():
    blank = _blank()
    _sell_blank(blank["code"], 50.00)
    after_sale = _revenue()
    pid = _product(20.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 21.35, "gift_card_code": blank["code"]}])
    assert round(_revenue() - after_sale, 2) == 0.00, "already earned when it was sold"
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["balance"] == 28.65


def test_the_same_blank_cannot_be_sold_twice():
    blank = _blank()
    _sell_blank(blank["code"], 50.00)
    with pytest.raises(HTTPException) as e:
        _sell_blank(blank["code"], 500.00)
    assert e.value.status_code == 409
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["balance"] == 50.00, "the second sale must not overwrite the first"


def test_a_quantity_of_rack_cards_is_refused_rather_than_guessed():
    # One printed card, one code. Two would silently load the same card.
    blank = _blank()
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "gift_card", "gift_card_amount": 25.00,
                "gift_card_code": blank["code"], "qty": 2}],
              [{"method": "cash", "amount": 50.00, "tendered_amount": 50.00}])
    assert e.value.status_code == 400


def test_selling_a_blank_that_does_not_exist_is_refused():
    with pytest.raises(HTTPException) as e:
        _sell_blank("ZZZZ-ZZZZ-ZZZZ", 25.00)
    assert e.value.status_code == 404


def test_the_rack_code_lands_on_the_printed_receipt():
    blank = _blank()
    sale_id = _sell_blank(blank["code"], 35.00)
    payload = run(server._build_pos_sale_receipt_payload(sale_id))
    printed = " ".join(str(li.get("description")) for li in payload["line_items"])
    assert blank["code"] in printed.replace("-", "")


def test_a_lost_blank_can_be_voided_off_the_rack():
    blank = _blank()
    run(gift.void_card(code=blank["code"], actor=ADMIN,
                       body=gift.GiftCardVoidIn(reason=f"{TAG} lost in the post")))
    with pytest.raises(HTTPException) as e:
        _sell_blank(blank["code"], 25.00)
    assert e.value.status_code == 409


def test_a_bad_rack_code_takes_no_money_at_all():
    """Settlement runs AFTER the sale commits and its failures are logged,
    not shown. So a wrong code has to be refused before the money moves, or
    the customer pays and walks out holding a dead card."""
    cash, rev = _expected_cash(), _revenue()
    sales_before = run(server.db.pos_sales.count_documents({}))
    with pytest.raises(HTTPException):
        _sell_blank("ZZZZ-ZZZZ-ZZZZ", 80.00)
    assert _expected_cash() == cash, "the till moved on a sale that could not work"
    assert _revenue() == rev
    assert run(server.db.pos_sales.count_documents({})) == sales_before


def test_selling_an_already_sold_card_takes_no_money_either():
    blank = _blank()
    _sell_blank(blank["code"], 50.00)
    cash, rev = _expected_cash(), _revenue()
    sales_before = run(server.db.pos_sales.count_documents({}))
    with pytest.raises(HTTPException):
        _sell_blank(blank["code"], 90.00)
    assert _expected_cash() == cash
    assert _revenue() == rev
    assert run(server.db.pos_sales.count_documents({})) == sales_before


def test_one_card_cannot_be_on_the_same_sale_twice():
    blank = _blank()
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "gift_card", "gift_card_amount": 25.00, "gift_card_code": blank["code"]},
               {"kind": "gift_card", "gift_card_amount": 25.00, "gift_card_code": blank["code"]}],
              [{"method": "cash", "amount": 50.00, "tendered_amount": 50.00}])
    assert e.value.status_code == 400


def test_a_blank_does_not_count_as_a_card_in_circulation():
    run(gift.mint_stock(quantity=3, actor=ADMIN))
    listed = run(gift.list_cards())
    rack = [c for c in listed["cards"] if c["status"] == "stock"]
    assert rack, "the rack should be visible"
    assert all(c["balance"] == 0.0 and c["origin"] == "stock" for c in rack)
    # the headline liability figure counts only what is actually owed
    owed = run(server.db.gift_cards.find({"status": "active"}, {"_id": 0, "balance": 1}).to_list(900))
    assert listed["outstanding_balance"] == round(sum(c["balance"] for c in owed), 2)


def test_a_stale_read_still_cannot_sell_a_card_twice():
    """The deterministic version of two tills racing.

    Both tills look the card up, both see "on the rack", and only then does
    either try to load it. The in-function status check is useless here — it
    is reading a snapshot taken before the other till won. The atomic status
    precondition on the write is the ONLY thing left, so this test hands
    activation a deliberately stale card to prove it holds.

    Without it the card ends up worth whichever sale wrote last, and one of
    the two customers has paid for nothing.
    """
    blank = _blank()
    stale = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert stale["status"] == "stock"

    _sell_blank(blank["code"], 50.00)          # the other till got there first

    async def _stale_lookup(_raw_code):
        return stale                            # what this till read a moment ago

    real = gift.find_by_code
    gift.find_by_code = _stale_lookup
    try:
        with pytest.raises(HTTPException) as e:
            run(gift.activate_stock_card(code=blank["code"], amount=500.00,
                                         actor=ADMIN, pos_sale_id="till-B"))
    finally:
        gift.find_by_code = real

    assert e.value.status_code == 409
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["balance"] == 50.00, "the second till overwrote a card already sold"
    logged = run(server.db.gift_card_transactions.count_documents(
        {"gift_card_id": blank["id"], "kind": "activate"}))
    assert logged == 1, "the losing till logged an activation it never made"


def test_the_index_is_registered_to_run_on_startup():
    """The index only protects anything if the app actually creates it.
    _test_loop calls server.startup() directly and never runs FastAPI's
    lifespan, so nothing else here would notice if this were dropped."""
    handlers = [getattr(h, "__name__", "") for h in server.app.router.on_startup]
    assert "ensure_indexes" in handlers


def test_the_database_itself_refuses_a_duplicate_code():
    """Minting checks for a collision then inserts, which is a race. The
    unique index is what actually makes "one code, one card" true."""
    run(gift.ensure_indexes())
    blank = _blank()
    import pymongo
    with pytest.raises(pymongo.errors.DuplicateKeyError):
        run(server.db.gift_cards.insert_one({
            "id": str(uuid.uuid4()), "code": blank["code"], "balance": 0.0,
            "initial_amount": 0.0, "status": "stock", "origin": "stock"}))


def test_a_whole_sheet_of_blanks_is_individually_trackable():
    """Printing 25 for the rack has to give 25 separately redeemable cards,
    not 25 copies of one. Each is looked up, sold and spent on its own."""
    sheet = run(gift.mint_stock(quantity=25, actor=ADMIN))
    codes = [c["code"] for c in sheet]
    assert len(set(codes)) == 25
    # each one really resolves to its own card
    ids = {run(gift.find_by_code(c))["id"] for c in codes}
    assert len(ids) == 25
    # selling one leaves the other 24 untouched on the rack
    _sell_blank(codes[0], 25.00)
    assert run(gift.find_by_code(codes[0]))["balance"] == 25.00
    for c in codes[1:]:
        other = run(gift.find_by_code(c))
        assert other["status"] == "stock" and other["balance"] == 0.0


# ──────────────────────────────────── fixed-denomination cards ($25 stack)
# The amount is PRINTED on these, so the printed number and the balance have
# to agree or the card lies to whoever is holding it.

def _denom(value=25.00, qty=1):
    return run(gift.mint_stock(quantity=qty, actor=ADMIN, face_value=value))


def test_a_denomination_stack_prints_its_value():
    made = _denom(25.00, 4)
    assert len(made) == 4
    assert all(c["face_value"] == 25.00 for c in made)
    assert len({c["code"] for c in made}) == 4, "still its own code each"


def test_a_printed_value_is_not_a_balance():
    # A $25 card nobody has bought is worth nothing. If face value counted as
    # balance, a rack of 40 would show $1,000 owed before a penny came in.
    rev, cash = _revenue(), _expected_cash()
    before = run(gift.list_cards())["outstanding_balance"]
    _denom(25.00, 40)
    assert _revenue() == rev and _expected_cash() == cash
    after = run(gift.list_cards())
    assert after["outstanding_balance"] == before, "a printed number is not money"
    assert all(c["balance"] == 0.0 for c in after["cards"] if c["status"] == "stock")


def test_a_blank_and_a_denomination_can_share_the_rack():
    blank = _blank()
    fixed = _denom(50.00)[0]
    assert blank["face_value"] is None
    assert fixed["face_value"] == 50.00


def test_a_twenty_five_dollar_card_sells_for_twenty_five():
    card = _denom(25.00)[0]
    _sell_blank(card["code"], 25.00)
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["status"] == "active" and live["balance"] == 25.00


def test_a_twenty_five_dollar_card_cannot_be_sold_for_ten():
    # Otherwise the customer holds a card that says $25 with $10 on it.
    card = _denom(25.00)[0]
    with pytest.raises(HTTPException) as e:
        _sell_blank(card["code"], 10.00)
    assert e.value.status_code == 400
    assert "$25.00" in str(e.value.detail)
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["status"] == "stock", "the card must stay on the rack"


def test_the_wrong_price_takes_no_money():
    card = _denom(25.00)[0]
    cash, rev = _expected_cash(), _revenue()
    sales_before = run(server.db.pos_sales.count_documents({}))
    with pytest.raises(HTTPException):
        _sell_blank(card["code"], 100.00)
    assert _expected_cash() == cash and _revenue() == rev
    assert run(server.db.pos_sales.count_documents({})) == sales_before


def test_activation_enforces_the_printed_value_on_its_own():
    # The till checks first, but activation is the only path that moves
    # money, so it must not depend on the caller having checked.
    card = _denom(25.00)[0]
    with pytest.raises(HTTPException) as e:
        run(gift.activate_stock_card(code=card["code"], amount=999.00,
                                     actor=ADMIN, pos_sale_id="direct"))
    assert e.value.status_code == 400


def test_a_blank_still_sells_for_anything():
    blank = _blank()
    _sell_blank(blank["code"], 63.47)
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["balance"] == 63.47


def test_a_denomination_card_spends_like_any_other():
    card = _denom(50.00)[0]
    _sell_blank(card["code"], 50.00)
    after_sale = _revenue()
    pid = _product(20.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}])
    assert round(_revenue() - after_sale, 2) == 0.00
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 28.65


def test_a_silly_printed_value_is_refused():
    with pytest.raises(Exception):
        run(gift.mint_stock(quantity=1, actor=ADMIN, face_value=99999.0))


# ──────────────────────────────────────── adding money to a card you own
# A top-up is a SALE, not a correction: cash arrives, revenue is recognised
# now, and what you owe the holder grows by the same amount.

def _topup(code, amount, method="cash"):
    tender = {"method": method, "amount": amount}
    if method == "cash":
        tender["tendered_amount"] = amount
    return _sale([{"kind": "gift_card", "gift_card_amount": amount,
                   "gift_card_code": code, "gift_card_topup": True}], [tender])


def _live_card(value=20.00):
    blank = _blank()
    _sell_blank(blank["code"], value)
    return blank


def test_a_customer_can_add_to_a_card_they_already_have():
    card = _live_card(20.00)
    _topup(card["code"], 50.00)
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 70.00 and live["status"] == "active"


def test_a_topup_is_income_and_cash_like_any_other_sale():
    card = _live_card(20.00)
    rev, cash, owed = _revenue(), _expected_cash(), \
        run(gift.list_cards())["outstanding_balance"]
    _topup(card["code"], 50.00)
    assert round(_revenue() - rev, 2) == 50.00, "the money came in, so it is income"
    assert round(_expected_cash() - cash, 2) == 50.00
    assert round(run(gift.list_cards())["outstanding_balance"] - owed, 2) == 50.00


def test_a_topup_is_not_sales_taxed():
    card = _live_card(20.00)
    owed = _tax_owed()
    _topup(card["code"], 50.00)
    assert _tax_owed() == owed, "a gift card is money — tax lands on what it buys"


def test_topping_up_does_not_mint_a_second_card():
    card = _live_card(20.00)
    before = run(server.db.gift_cards.count_documents({}))
    _topup(card["code"], 50.00)
    assert run(server.db.gift_cards.count_documents({})) == before


def test_a_spent_out_card_can_be_brought_back_to_life():
    # $20 of goods is $21.35 with Ohio tax on top, so the card has to hold
    # that much to be spent flat.
    card = _live_card(21.35)
    pid = _product(20.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}])
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["status"] == "spent"
    _topup(card["code"], 30.00)
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 30.00 and live["status"] == "active"


def test_a_blank_cannot_be_topped_up():
    # It has not been sold, so there is no sale behind the balance. Selling
    # it is the thing that books the revenue.
    blank = _blank()
    with pytest.raises(HTTPException) as e:
        _topup(blank["code"], 50.00)
    assert e.value.status_code == 409
    assert "not been sold" in str(e.value.detail)


def test_a_voided_card_cannot_be_topped_up():
    card = _live_card(20.00)
    run(gift.void_card(code=card["code"], actor=ADMIN,
                       body=gift.GiftCardVoidIn(reason=f"{TAG} stolen")))
    with pytest.raises(HTTPException) as e:
        _topup(card["code"], 50.00)
    assert e.value.status_code == 409


def test_a_topup_without_a_code_is_refused_rather_than_guessed():
    with pytest.raises(HTTPException) as e:
        _sale([{"kind": "gift_card", "gift_card_amount": 50.00, "gift_card_topup": True}],
              [{"method": "cash", "amount": 50.00, "tendered_amount": 50.00}])
    assert e.value.status_code == 400


def test_a_failed_topup_takes_no_money():
    blank = _blank()
    cash, rev = _expected_cash(), _revenue()
    sales_before = run(server.db.pos_sales.count_documents({}))
    with pytest.raises(HTTPException):
        _topup(blank["code"], 50.00)
    assert _expected_cash() == cash and _revenue() == rev
    assert run(server.db.pos_sales.count_documents({})) == sales_before


def test_a_topup_cannot_push_a_card_over_the_limit():
    card = _live_card(900.00)
    with pytest.raises(HTTPException) as e:
        _topup(card["code"], 500.00)
    assert e.value.status_code == 400
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 900.00


def test_the_printed_value_does_not_govern_a_topup():
    # A $25 card sells for $25. Once sold, the 25 on the plastic is history
    # and the holder can put any amount back on it.
    fixed = _denom(25.00)[0]
    _sell_blank(fixed["code"], 25.00)
    _topup(fixed["code"], 60.00)
    live = run(server.db.gift_cards.find_one({"id": fixed["id"]}, {"_id": 0}))
    assert live["balance"] == 85.00


def test_a_topup_shows_in_the_cards_history():
    card = _live_card(20.00)
    _topup(card["code"], 50.00)
    view = run(gift.card_detail(card["code"]))
    assert any(h["kind"] == "topup" and h["amount"] == 50.00 for h in view["history"])
    assert view["balance"] == 70.00


def test_two_tills_topping_up_at_once_cannot_lose_a_payment():
    """Both read $20, both add $50. Without the balance precondition both
    write $70 and one of the two payments vanishes off the card."""
    card = _live_card(20.00)
    stale = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    run(gift.topup_card(code=card["code"], amount=50.00, actor=ADMIN,
                        pos_sale_id="till-A"))          # the other till won

    real = gift.find_by_code
    seen = {"n": 0}

    async def _stale_once(raw):
        """First read is the snapshot this till took before the other one
        wrote — that is the race. Afterwards it reads reality, which is what
        the retry exists to do."""
        seen["n"] += 1
        return stale if seen["n"] == 1 else await real(raw)

    gift.find_by_code = _stale_once
    try:
        run(gift.topup_card(code=card["code"], amount=50.00, actor=ADMIN,
                            pos_sale_id="till-B"))
    finally:
        gift.find_by_code = real
    assert seen["n"] >= 2, "the stale attempt must have been rejected and retried"
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 120.00, "one of the two $50 payments was lost"


# ──────────────────────────────── editing the two things that are not money

def test_who_a_card_is_for_can_be_fixed_afterwards():
    # The till usually takes the money before anybody knows whose name goes
    # on it, and a typo on a card about to be printed is worth fixing.
    card = _live_card(20.00)
    out = run(gift.edit_details(code=card["code"], actor=ADMIN,
                                body=gift.GiftCardDetailsIn(
                                    recipient_name="Dana", note="Birthday")))
    assert out["recipient_name"] == "Dana" and out["note"] == "Birthday"
    live = run(gift.card_detail(card["code"]))
    assert live["recipient_name"] == "Dana"


def test_editing_details_cannot_touch_the_money():
    card = _live_card(20.00)
    rev, cash = _revenue(), _expected_cash()
    owed = run(gift.list_cards())["outstanding_balance"]
    run(gift.edit_details(code=card["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(recipient_name="Dana")))
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 20.00 and live["status"] == "active"
    assert _revenue() == rev and _expected_cash() == cash
    assert run(gift.list_cards())["outstanding_balance"] == owed


def test_the_edit_model_has_no_way_to_set_an_amount():
    # The guard is the model itself: extra keys are not silently accepted
    # into something that could move a balance.
    body = gift.GiftCardDetailsIn(recipient_name="Dana")
    assert not hasattr(body, "amount")
    assert not hasattr(body, "balance")
    assert not hasattr(body, "status")


def test_an_edit_leaves_a_trail_without_claiming_money_moved():
    card = _live_card(20.00)
    run(gift.edit_details(code=card["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(note=f"{TAG} note")))
    view = run(gift.card_detail(card["code"]))
    edits = [h for h in view["history"] if h["kind"] == "edit"]
    assert edits and edits[-1]["amount"] == 0.0
    assert edits[-1]["balance_after"] == 20.00


def test_a_voided_card_cannot_be_edited():
    card = _live_card(20.00)
    run(gift.void_card(code=card["code"], actor=ADMIN,
                       body=gift.GiftCardVoidIn(reason=f"{TAG} gone")))
    with pytest.raises(HTTPException) as e:
        run(gift.edit_details(code=card["code"], actor=ADMIN,
                              body=gift.GiftCardDetailsIn(recipient_name="Nope")))
    assert e.value.status_code == 409


def test_editing_only_one_field_leaves_the_other_alone():
    card = _live_card(20.00)
    run(gift.edit_details(code=card["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(recipient_name="Dana", note="Keep me")))
    run(gift.edit_details(code=card["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(recipient_name="Sam")))
    live = run(gift.card_detail(card["code"]))
    assert live["recipient_name"] == "Sam" and live["note"] == "Keep me"


def test_a_blank_on_the_rack_can_be_named_before_it_is_sold():
    blank = _blank()
    run(gift.edit_details(code=blank["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(recipient_name="Dana")))
    live = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert live["recipient_name"] == "Dana"
    assert live["status"] == "stock" and live["balance"] == 0.0, "still unsold"


# ══════════════════════════════════ online: top-ups, digital cards, webhooks
# The browser is never financial authority here. Every test below drives the
# webhook handlers directly — that is the only path that moves money — so
# nothing depends on Stripe being reachable.
import json as _json  # noqa: E402

from domains.gift_cards import online as gconline  # noqa: E402


@pytest.fixture(autouse=True)
def _online_configured():
    gconline.configure(
        db=server.db, stripe_mod=None, now_iso=server.now_iso,
        business_today=server.business_today, logger=server.logger,
        amount_cents=server._stripe_amount_cents,
        public_url=server._app_public_url,
        expires_seconds=server.STRIPE_CHECKOUT_EXPIRES_SECONDS,
        email_service=None)
    yield


def _attempt(kind="topup", **kw):
    """An attempt in the state Stripe would leave it in just before paying."""
    a = {"id": str(uuid.uuid4()), "kind": kind, "status": "pending",
         "stripe_checkout_session_id": "cs_" + str(uuid.uuid4()),
         "business_date": _day(), "created_at": server.now_iso(),
         "updated_at": server.now_iso()}
    a.update(kw)
    run(server.db.gift_card_topup_attempts.insert_one(dict(a)))
    a.pop("_id", None)
    return a


def _paid(attempt, cents=None):
    return {"id": attempt["stripe_checkout_session_id"], "payment_status": "paid",
            "amount_total": cents if cents is not None else attempt["amount_cents"],
            "payment_intent": "pi_" + str(uuid.uuid4()),
            "metadata": {"sithappens_gift_card_topup_id": attempt["id"]}}


# ------------------------------------------------------------- top-ups

def test_an_online_topup_puts_the_money_on_the_card():
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_paid(_paid(a)))
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 70.00 and live["status"] == "active"


def test_an_online_topup_is_income_but_never_till_cash():
    # The money is real, so it is revenue. It is not in the drawer, so the
    # drawer must not claim it — a cash count would catch that.
    card = _live_card(20.00)
    rev, cash = _revenue(), _expected_cash()
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_paid(_paid(a)))
    assert round(_revenue() - rev, 2) == 50.00
    assert _expected_cash() == cash, "online money is not in the till"


def test_stripe_delivering_the_same_event_twice_only_pays_once():
    # Stripe retries. This is THE test: a repeat delivery must be a no-op.
    card = _live_card(20.00)
    rev = _revenue()
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    ev = _paid(a)
    run(gconline.handle_paid(ev))
    run(gconline.handle_paid(ev))
    run(gconline.handle_paid(ev))
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 70.00, "the card was credited more than once"
    assert round(_revenue() - rev, 2) == 50.00, "the income was booked more than once"


def test_re_driving_a_half_finished_apply_finishes_it():
    # Crash after the balance moved but before the revenue row was written:
    # calling apply again must write the row and NOT move the balance twice.
    card = _live_card(20.00)
    rev = _revenue()
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.apply_topup(a))
    run(server.db.retail_sales.delete_one({"id": "gctopup-" + a["id"]}))
    run(gconline.apply_topup(a))
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 70.00, "balance moved twice"
    assert round(_revenue() - rev, 2) == 50.00, "revenue row was not restored"


def test_an_unpaid_session_puts_nothing_on_the_card():
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    ev = _paid(a)
    ev["payment_status"] = "unpaid"
    run(gconline.handle_paid(ev))
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 20.00


def test_paying_a_different_amount_is_held_back_rather_than_guessed():
    # What Stripe actually collected is the authority. If it disagrees with
    # what we asked for, crediting either number is a guess.
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_paid(_paid(a, cents=1000)))
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 20.00
    live = run(server.db.gift_card_topup_attempts.find_one({"id": a["id"]}))
    assert live["status"] == "reconciliation_required"


def test_a_failed_or_expired_session_never_credits():
    card = _live_card(20.00)
    for handler, status in ((gconline.handle_failed, "failed"),
                            (gconline.handle_expired, "expired")):
        a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
        run(handler({"id": a["stripe_checkout_session_id"]}))
        assert run(server.db.gift_card_topup_attempts.find_one(
            {"id": a["id"]}))["status"] == status
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 20.00


def test_a_stale_failure_after_payment_cannot_take_the_money_back():
    # Stripe does not guarantee delivery order.
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_paid(_paid(a)))
    run(gconline.handle_failed({"id": a["stripe_checkout_session_id"]}))
    live = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert live["balance"] == 70.00
    assert run(server.db.gift_card_topup_attempts.find_one(
        {"id": a["id"]}))["status"] == "applied"


def test_an_unknown_session_is_ignored_quietly():
    run(gconline.handle_paid({"id": "cs_nothing", "payment_status": "paid"}))


# --------------------------------------------------- digital cards, online

def test_buying_a_digital_card_online_mints_it_and_books_it():
    rev = _revenue()
    a = _attempt(kind="purchase", card_id=str(uuid.uuid4()), amount_cents=4000,
                 recipient_email="dana@example.com", recipient_name="Dana")
    run(gconline.handle_paid(_paid(a)))
    card = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))
    assert card and card["balance"] == 40.00 and card["status"] == "active"
    assert card["origin"] == "digital" and card["delivery"] == "email"
    assert card["recipient_email"] == "dana@example.com"
    assert round(_revenue() - rev, 2) == 40.00


def test_a_repeated_delivery_does_not_mint_a_second_card():
    # THE risk of minting from a webhook: two cards for one payment.
    run(gift.ensure_indexes())
    rev = _revenue()
    a = _attempt(kind="purchase", card_id=str(uuid.uuid4()), amount_cents=4000,
                 recipient_email="dana@example.com")
    ev = _paid(a)
    run(gconline.handle_paid(ev))
    run(gconline.handle_paid(ev))
    run(gconline.handle_paid(ev))
    assert run(server.db.gift_cards.count_documents({"id": a["card_id"]})) == 1
    assert round(_revenue() - rev, 2) == 40.00


def test_a_digital_card_spends_like_any_other():
    a = _attempt(kind="purchase", card_id=str(uuid.uuid4()), amount_cents=4000,
                 recipient_email="dana@example.com")
    run(gconline.handle_paid(_paid(a)))
    card = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))
    after = _revenue()
    pid = _product(20.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}])
    assert round(_revenue() - after, 2) == 0.00, "already earned when it was bought"
    assert run(server.db.gift_cards.find_one({"id": a["card_id"]}))["balance"] == 18.65


def test_an_online_card_is_owed_to_its_holder():
    owed = run(gift.list_cards())["outstanding_balance"]
    a = _attempt(kind="purchase", card_id=str(uuid.uuid4()), amount_cents=4000,
                 recipient_email="dana@example.com")
    run(gconline.handle_paid(_paid(a)))
    assert round(run(gift.list_cards())["outstanding_balance"] - owed, 2) == 40.00


# ------------------------------------------------ what a customer may see

def test_a_customer_looking_up_a_code_sees_the_balance_and_nothing_else():
    card = _live_card(20.00)
    run(gift.edit_details(code=card["code"], actor=ADMIN,
                          body=gift.GiftCardDetailsIn(recipient_name="Dana",
                                                      note="secret note")))
    full = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    view = gconline.portal_view(full)
    assert view["balance"] == 20.00 and view["can_top_up"] is True
    blob = _json.dumps(view)
    assert "Dana" not in blob and "secret note" not in blob, \
        "whoever holds a code is not necessarily who it was bought for"


def test_a_blank_reads_as_not_toppable_to_a_customer():
    blank = _blank()
    full = run(server.db.gift_cards.find_one({"id": blank["id"]}, {"_id": 0}))
    assert gconline.portal_view(full)["can_top_up"] is False


# ------------------------------------------------ digital cards at the till

def test_a_card_sold_with_an_email_is_a_digital_card():
    sent = []

    async def _catch(card):
        sent.append(card["code"])
        return True

    gift.configure(db=server.db, now_iso=server.now_iso,
                   business_today=server.business_today, logger=server.logger,
                   email_sender=_catch)
    try:
        sale_id = _sale([{"kind": "gift_card", "gift_card_amount": 40.00,
                          "gift_card_recipient_email": "dana@example.com"}],
                        [{"method": "cash", "amount": 40.00, "tendered_amount": 40.00}])
        card = run(server.db.gift_cards.find_one(
            {"sold_via_pos_sale_id": sale_id}, {"_id": 0}))
        assert card["delivery"] == "email"
        assert card["recipient_email"] == "dana@example.com"
        assert sent == [card["code"]], "the code has to actually be sent somewhere"
        assert card["balance"] == 40.00
    finally:
        gift.configure(db=server.db, now_iso=server.now_iso,
                       business_today=server.business_today, logger=server.logger,
                       email_sender=None)


def test_a_card_sold_without_an_email_is_still_a_printed_card():
    sale_id = _sale([{"kind": "gift_card", "gift_card_amount": 40.00}],
                    [{"method": "cash", "amount": 40.00, "tendered_amount": 40.00}])
    card = run(server.db.gift_cards.find_one(
        {"sold_via_pos_sale_id": sale_id}, {"_id": 0}))
    assert card["delivery"] == "print" and not card["recipient_email"]


def test_the_code_is_emailed_once_even_if_asked_twice():
    calls = []

    async def _catch(card):
        calls.append(card["id"])
        return True

    card = _live_card(20.00)
    run(server.db.gift_cards.update_one(
        {"id": card["id"]}, {"$set": {"recipient_email": "dana@example.com"}}))
    full = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert run(gift.send_card_email(full, sender=_catch)) is True
    assert run(gift.send_card_email(full, sender=_catch)) is False
    assert len(calls) == 1, "the recipient was emailed their card twice"


def test_a_failed_send_can_be_retried_rather_than_lost():
    # A card that never arrives is worse than one that arrives twice, so a
    # failure must release the claim.
    async def _fail(card):
        return False

    async def _ok(card):
        return True

    card = _live_card(20.00)
    run(server.db.gift_cards.update_one(
        {"id": card["id"]}, {"$set": {"recipient_email": "dana@example.com"}}))
    full = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert run(gift.send_card_email(full, sender=_fail)) is False
    assert run(server.db.gift_cards.find_one(
        {"id": card["id"]})).get("code_emailed_at") is None
    assert run(gift.send_card_email(full, sender=_ok)) is True


def test_a_mail_provider_falling_over_never_fails_the_sale():
    async def _boom(card):
        raise RuntimeError("Resend is down")

    card = _live_card(20.00)
    run(server.db.gift_cards.update_one(
        {"id": card["id"]}, {"$set": {"recipient_email": "dana@example.com"}}))
    full = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert run(gift.send_card_email(full, sender=_boom)) is False
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 20.00


def test_a_payment_arriving_after_we_gave_up_is_flagged_not_dropped():
    """Stripe should never do this, so if it does, something is wrong. The
    customer's money is real either way, and quietly ignoring it would mean
    they paid and got nothing — so it goes to a human rather than nowhere."""
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_expired({"id": a["stripe_checkout_session_id"]}))
    run(gconline.handle_paid(_paid(a)))
    live = run(server.db.gift_card_topup_attempts.find_one({"id": a["id"]}))
    assert live["status"] == "reconciliation_required"
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 20.00


def test_an_applied_attempt_paid_again_stays_applied():
    card = _live_card(20.00)
    a = _attempt(gift_card_id=card["id"], code=card["code"], amount_cents=5000)
    run(gconline.handle_paid(_paid(a)))
    run(gconline.handle_paid(_paid(a)))
    live = run(server.db.gift_card_topup_attempts.find_one({"id": a["id"]}))
    assert live["status"] == "applied"
    assert run(server.db.gift_cards.find_one({"id": card["id"]}))["balance"] == 70.00


def test_the_database_refuses_two_cards_with_the_same_id():
    """An online purchase pins the card id before paying so a repeated
    webhook cannot mint twice — which only holds if the index is real."""
    import pymongo
    run(gift.ensure_indexes())
    card = _live_card(20.00)
    with pytest.raises(pymongo.errors.DuplicateKeyError):
        run(server.db.gift_cards.insert_one({
            "id": card["id"], "code": "ZZZZZZZZZZZZ", "balance": 0.0,
            "initial_amount": 0.0, "status": "stock", "origin": "stock"}))


# ══════════════════════════════════ a code must never belong to two cards
# A duplicate means two customers sharing one balance and no way to tell
# whose money is whose. Three things stand between us and that, and each is
# tested on its own because any one of them alone is not enough.

def test_the_index_is_actually_on_the_collection():
    # The generator only makes a duplicate unlikely. THIS is what makes one
    # impossible, and a log line saying it failed is not something anybody
    # reads — so ask the database.
    run(gift.ensure_indexes())
    assert run(gift.code_uniqueness_enforced()) is True


def test_no_two_cards_share_a_code_right_now():
    run(gift.mint_stock(quantity=30, actor=ADMIN))
    assert run(gift.find_duplicate_codes()) == []


def test_a_code_collision_is_retried_rather_than_losing_the_sale():
    """A collision is astronomically unlikely, but it surfaces inside
    settlement — which is logged and swallowed — so without a retry the
    customer is charged and gets no card. Forced here by making the
    generator hand out a code that is already taken."""
    run(gift.ensure_indexes())
    taken = _blank()["code"]
    handed = []
    real = gift._fresh_code

    async def _collide_once():
        if not handed:
            handed.append(taken)
            return taken           # already on another card
        return await real()

    gift._fresh_code = _collide_once
    try:
        card = run(gift.mint_card(amount=25.0, actor=ADMIN))
    finally:
        gift._fresh_code = real

    assert card["code"] != taken, "it kept the code that was already taken"
    assert card["balance"] == 25.00
    assert len(handed) == 1, "the collision was never actually hit"
    assert run(gift.find_duplicate_codes()) == []


def test_a_clash_on_the_card_id_is_reported_as_itself():
    """An online purchase pins its card id, so a repeated webhook hits the id
    index. The unique index stops the second card either way — but the caller
    has to be able to tell "this card already exists" from "we could not
    generate a code", and it should find out immediately rather than after
    six pointless attempts to re-code a card that is already there.
    """
    import pymongo
    run(gift.ensure_indexes())
    first = run(gift.mint_card(amount=10.0, actor=ADMIN, card_id="fixed-id-1"))
    before = run(server.db.gift_cards.count_documents({}))
    with pytest.raises(pymongo.errors.DuplicateKeyError):
        run(gift.mint_card(amount=10.0, actor=ADMIN, card_id="fixed-id-1"))
    assert run(server.db.gift_cards.count_documents({})) == before
    assert first["code"] == run(
        server.db.gift_cards.find_one({"id": "fixed-id-1"}))["code"]


def test_every_way_of_making_a_card_goes_through_the_guarded_insert():
    # Sold, issued by hand, printed for the rack, bought online — all of them
    # have to be covered, not just the one that was written first.
    import inspect
    src = inspect.getsource(gift)
    direct = src.count("gift_cards.insert_one")
    assert direct == 1, (
        f"{direct} direct inserts into gift_cards; every card must be written "
        "through _insert_with_fresh_code so a collision is retried")


def test_a_thousand_codes_in_a_row_are_all_different():
    made = []
    for _ in range(10):
        made += [c["code"] for c in run(gift.mint_stock(quantity=100, actor=ADMIN))]
    assert len(made) == 1000
    assert len(set(made)) == 1000
    assert run(gift.find_duplicate_codes()) == []


def test_duplicates_are_reported_if_they_somehow_exist():
    # The reporting has to work, or the startup check cannot tell anybody
    # what is wrong. Written straight past the index to simulate a legacy row.
    run(server.db.gift_cards.drop_indexes())
    code = "ZZZZZZZZZZZZ"
    for _ in range(2):
        run(server.db.gift_cards.insert_one({
            "id": str(uuid.uuid4()), "code": code, "balance": 0.0,
            "initial_amount": 0.0, "status": "stock", "origin": "stock"}))
    assert code in run(gift.find_duplicate_codes())
    # and with duplicates present the index cannot build, which must be
    # visible rather than assumed
    run(gift.ensure_indexes())
    assert run(gift.code_uniqueness_enforced()) is False
    run(server.db.gift_cards.delete_many({"code": code}))
    run(gift.ensure_indexes())
    assert run(gift.code_uniqueness_enforced()) is True


# ══════════════════════════════════════════ gift cards in the Shop basket
# A shop gift card is a DIGITAL card bought alongside anything else, on the
# Shop's own order/payment/fulfilment machinery. It is money, so it is never
# taxed and never stocked.
from domains.gift_cards import shop as gcshop  # noqa: E402


def _shop_line(amount=25.0, qty=1, recipient=""):
    return {"item_id": "li-" + str(uuid.uuid4())[:8], "kind": "gift_card",
            "ref_id": gcshop.ref_id_for(amount), "unit_price": amount,
            "quantity": qty, "recipient_email": recipient}


def _shop_order(**kw):
    o = {"id": "ord-" + str(uuid.uuid4())[:8], "client_id": "cli-1",
         "client_name": "Dana", "client_email": "buyer@example.com"}
    o.update(kw)
    return o


def test_the_shop_offers_gift_cards():
    items = run(gcshop.catalog_items())
    assert items, "the Shop should offer gift cards out of the box"
    assert all(i["kind"] == "gift_card" for i in items)
    amounts = [i["price"] for i in items]
    assert amounts == sorted(amounts)
    assert 25.0 in amounts


def test_a_shop_gift_card_is_never_taxed_and_never_stocked():
    # It is money, not goods. Both of these being wrong would be invisible
    # until a tax return.
    for i in run(gcshop.catalog_items()):
        assert i["taxable"] is False
        assert i["in_stock"] is True   # nothing physical to run out of


def test_the_amount_comes_from_the_server_not_the_cart():
    # A cart that can name its own price is not a price.
    priced = run(gcshop.price_line(gcshop.ref_id_for(50.0), 1))
    assert priced["unit_price"] == 50.00


def test_an_amount_we_do_not_offer_is_refused():
    with pytest.raises(HTTPException) as e:
        run(gcshop.price_line(gcshop.ref_id_for(37.13), 1))
    assert e.value.status_code == 400


def test_a_made_up_reference_is_refused_rather_than_priced_at_zero():
    for bogus in ("", "gc-", "nonsense", "gc-abc", "../../etc"):
        with pytest.raises(HTTPException):
            run(gcshop.price_line(bogus, 1))


def test_the_offered_amounts_can_be_changed_without_a_deploy():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "gift_cards": 1})) or {}
    run(server.db.settings.update_one(
        {}, {"$set": {"gift_cards": {"shop_amounts": [15, 75]}}}, upsert=True))
    try:
        assert run(gcshop.offered_amounts()) == [15.0, 75.0]
        assert run(gcshop.price_line(gcshop.ref_id_for(75.0), 1))["unit_price"] == 75.0
        with pytest.raises(HTTPException):
            run(gcshop.price_line(gcshop.ref_id_for(25.0), 1))   # no longer offered
    finally:
        run(server.db.settings.update_one(
            {}, {"$set": {"gift_cards": prev.get("gift_cards") or {}}}, upsert=True))


def test_gift_cards_can_be_taken_out_of_the_shop_entirely():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "gift_cards": 1})) or {}
    run(server.db.settings.update_one(
        {}, {"$set": {"gift_cards": {"shop_enabled": False}}}, upsert=True))
    try:
        assert run(gcshop.offered_amounts()) == []
        assert run(gcshop.catalog_items()) == []
        with pytest.raises(HTTPException):
            run(gcshop.price_line(gcshop.ref_id_for(25.0), 1))
    finally:
        run(server.db.settings.update_one(
            {}, {"$set": {"gift_cards": prev.get("gift_cards") or {}}}, upsert=True))


def test_a_silly_configured_amount_is_ignored_rather_than_sold():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "gift_cards": 1})) or {}
    run(server.db.settings.update_one(
        {}, {"$set": {"gift_cards": {"shop_amounts": [25, 0, -5, 99999, "abc", None]}}},
        upsert=True))
    try:
        assert run(gcshop.offered_amounts()) == [25.0]
    finally:
        run(server.db.settings.update_one(
            {}, {"$set": {"gift_cards": prev.get("gift_cards") or {}}}, upsert=True))


# ------------------------------------------------------------- fulfilment

def _fulfil(order, line, sent=None):
    """Mirrors how server.py wires this: the email goes through
    services.send_card_email, which is what claims the card so it can only
    be sent once. Passing a raw sender here would test a path production
    does not use."""
    async def _capture(card):
        if sent is not None:
            sent.append(card.get("recipient_email"))
        return True

    async def _email(card):
        return await gift.send_card_email(card, sender=_capture)

    return run(gcshop.fulfill_line(order, line, mint=gift.mint_card, email=_email))


def test_buying_one_in_the_shop_mints_a_digital_card_and_sends_it():
    sent = []
    order, line = _shop_order(), _shop_line(25.0)
    out = _fulfil(order, line, sent)
    assert out["count"] == 1
    card = run(gift.find_by_code(out["codes"][0]))
    assert card["balance"] == 25.00 and card["status"] == "active"
    assert card["origin"] == "digital" and card["delivery"] == "email"
    assert sent == ["buyer@example.com"], "it has to actually be sent somewhere"


def test_it_goes_to_the_named_recipient_when_there_is_one():
    sent = []
    out = _fulfil(_shop_order(), _shop_line(25.0, recipient="dana@example.com"), sent)
    assert sent == ["dana@example.com"]
    assert run(gift.find_by_code(out["codes"][0]))["recipient_email"] == "dana@example.com"


def test_buying_three_gives_three_separate_cards():
    out = _fulfil(_shop_order(), _shop_line(25.0, qty=3))
    assert out["count"] == 3
    assert len(set(out["codes"])) == 3, "three cards, three codes"
    for c in out["codes"]:
        assert run(gift.find_by_code(c))["balance"] == 25.00


def test_re_running_fulfilment_does_not_mint_a_second_set():
    # The Shop re-drives fulfilment on retry and from the admin Retry
    # Fulfillment action, so this WILL happen.
    run(gift.ensure_indexes())
    order, line = _shop_order(), _shop_line(50.0, qty=2)
    first = _fulfil(order, line)
    before = run(server.db.gift_cards.count_documents({}))
    second = _fulfil(order, line)
    assert run(server.db.gift_cards.count_documents({})) == before
    assert sorted(first["codes"]) == sorted(second["codes"]), "different cards on a retry"


def test_re_running_fulfilment_does_not_email_the_code_twice():
    run(gift.ensure_indexes())
    sent = []
    order, line = _shop_order(), _shop_line(25.0)
    _fulfil(order, line, sent)
    _fulfil(order, line, sent)
    assert len(sent) == 1, "the recipient got their card twice"


def test_a_shop_card_is_owed_to_its_holder_and_spends_normally():
    owed = run(gift.list_cards())["outstanding_balance"]
    out = _fulfil(_shop_order(), _shop_line(50.0))
    assert round(run(gift.list_cards())["outstanding_balance"] - owed, 2) == 50.00
    code = out["codes"][0]
    after = _revenue()
    pid = _product(20.00)
    _sale([{"kind": "retail", "product_id": pid, "qty": 1}],
          [{"method": "gift_card", "amount": 21.35, "gift_card_code": code}])
    assert round(_revenue() - after, 2) == 0.00, "already earned when it was bought"
    assert run(gift.find_by_code(code))["balance"] == 28.65


def test_two_shop_orders_never_share_a_card():
    a = _fulfil(_shop_order(), _shop_line(25.0))
    b = _fulfil(_shop_order(), _shop_line(25.0))
    assert a["codes"] != b["codes"]
    assert run(gift.find_duplicate_codes()) == []


def _online_product(price=20.00):
    """A product the SHOP can sell — show_online, not show_at_register."""
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} online item", "price": price, "active": True,
        "archived": False, "show_online": True, "show_at_register": True,
        "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None,
        "subcategory_id": None}))
    return pid


def test_a_gift_card_adds_no_sales_tax_to_a_basket_that_has_goods_in_it():
    """The case that matters: a $25 card next to a $20 chew. Ohio is owed
    tax on the chew and nothing at all on the card, and the order total has
    to reflect exactly that."""
    pid = _online_product(20.00)
    items = [server.ShopCartItemIn(kind="product", ref_id=pid, quantity=1),
             server.ShopCartItemIn(kind="gift_card",
                                   ref_id=gcshop.ref_id_for(25.0), quantity=1)]
    priced = run(server._price_shop_cart(items, client_id=None))

    card_line = [l for l in priced["lines"] if l["kind"] == "gift_card"][0]
    goods_line = [l for l in priced["lines"] if l["kind"] == "product"][0]
    assert card_line["allocated_tax"] == 0.0, "a gift card is money, not a good"
    assert goods_line["allocated_tax"] > 0, "the chew is still taxed"
    # the whole order's tax is the tax on the goods alone
    assert priced["tax_amount"] == goods_line["allocated_tax"]
    assert priced["subtotal"] == 45.00
    assert priced["total"] == round(45.00 + priced["tax_amount"], 2)


def test_a_basket_of_only_gift_cards_owes_no_tax_at_all():
    items = [server.ShopCartItemIn(kind="gift_card",
                                   ref_id=gcshop.ref_id_for(50.0), quantity=2)]
    priced = run(server._price_shop_cart(items, client_id=None))
    assert priced["tax_amount"] == 0.0
    assert priced["subtotal"] == 100.00 and priced["total"] == 100.00


def test_the_shop_price_is_the_amount_the_card_is_worth():
    # If these ever drift, somebody pays $25 for a $50 card or the reverse.
    items = [server.ShopCartItemIn(kind="gift_card",
                                   ref_id=gcshop.ref_id_for(50.0), quantity=1)]
    priced = run(server._price_shop_cart(items, client_id=None))
    line = priced["lines"][0]
    out = _fulfil(_shop_order(), {**line, "recipient_email": ""})
    assert run(gift.find_by_code(out["codes"][0]))["balance"] == line["unit_price"]


def test_gift_cards_are_not_on_the_public_storefront():
    """A digital card is delivered by email, so there has to be an account
    behind it — a guest with no sign-in has nowhere for it to go. Adding
    them to the shared catalog without this broke 18 storefront tests with a
    KeyError, because the public side maps every kind to a section."""
    prev = run(server.get_settings()).get("shop_page") or {}
    run(server.db.settings.update_one(
        {"id": "global"},
        {"$set": {"shop_page.public_shop_enabled": True,
                  "shop_page.public_browsing_enabled": True}}, upsert=True))
    try:
        items = run(server._public_visible_shop_items())
        assert all(i.get("kind") != "gift_card" for i in items)
    finally:
        run(server.db.settings.update_one(
            {"id": "global"}, {"$set": {"shop_page": prev}}, upsert=True))


def test_gift_cards_ARE_in_the_signed_in_shop():
    # The other half of the same rule: hidden from guests, offered to clients.
    catalog = run(server._build_shop_catalog(None))
    kinds = {i["kind"] for i in catalog["items"]}
    assert "gift_card" in kinds
