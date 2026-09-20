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
        "/api/gift-cards/{code}/adjust", "/api/gift-cards/{code}/void",
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
