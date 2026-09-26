"""Gift card money must go where the sale went — audit #4 (2026-09-25).

Four paths used to strand or duplicate card money:

  A. a RETRIED register sale (Wi-Fi drop after the server committed, a
     double tap) charged the card a second time, and a retried sale of a
     card minted a second live card with a second revenue row;
  B. a checkout that failed partway (a household where the second dog was
     refused) kept the money it had already taken off the card;
  C. Void and Return ignored gift cards: a sold card stayed live with its
     money and its revenue, and a card that paid for something returned was
     never refilled;
  D. a gift card refunded online stayed live.

Plus a stored balance like 11.370000000000001 (left by an older $inc)
that no compare-and-set could match, so the card could never be spent.

The shared shape of the fix: every movement of money back onto (or off) a
card is keyed and happens exactly once.
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.gift_cards import services as gift
from domains.pos import services as pos
from test_gift_cards import (  # noqa: F401 — the autouse fixture opens the register with tax on
    ADMIN, _expected_cash, _product, _register_open_with_tax, _revenue, _sell_card, _tax_owed,
)


def _balance(card_id):
    return run(server.db.gift_cards.find_one({"id": card_id}, {"_id": 0}))["balance"]


def _body(lines, tenders, key=None):
    return server.PosSaleIn(
        lines=[server.PosSaleLineIn(**l) for l in lines],
        tenders=[server.PosSaleTenderIn(**t) for t in tenders],
        idempotency_key=key or f"TEST_GIFT-{uuid.uuid4()}")


def _sale_id(out):
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


# ───────────────────────────────────────────────── A. retries replay

def test_a_retried_card_paid_sale_charges_the_card_once():
    _sid, card = _sell_card(100.00)
    pid = _product(20.00)
    body = _body([{"kind": "retail", "product_id": pid, "qty": 1}],
                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}])
    first = run(pos.create_sale(body, ADMIN))
    again = run(pos.create_sale(body, ADMIN))            # the response was lost; staff tap again
    assert _sale_id(again) == _sale_id(first) and again.get("replayed") is True
    assert _balance(card["id"]) == 78.65, "charged once, not twice"
    sale = run(server.db.pos_sales.find_one({"id": _sale_id(first)}, {"_id": 0}))
    [t] = [t for t in sale["tenders"] if t["method"] == "gift_card"]
    assert t["gift_card_id"] == card["id"], "the sale remembers which card paid"
    redeems = run(server.db.gift_card_transactions.find(
        {"gift_card_id": card["id"], "kind": "redeem"}, {"_id": 0}).to_list(10))
    assert [r["pos_sale_id"] for r in redeems] == [_sale_id(first)]


def test_a_retried_sale_of_a_card_mints_one_card_and_one_revenue_row():
    body = _body([{"kind": "gift_card", "gift_card_amount": 50.00}],
                 [{"method": "cash", "amount": 50.00, "tendered_amount": 50.00}])
    first = run(pos.create_sale(body, ADMIN))
    again = run(pos.create_sale(body, ADMIN))
    sid = _sale_id(first)
    cards = run(server.db.gift_cards.find({"sold_via_pos_sale_id": sid}, {"_id": 0}).to_list(10))
    rows = run(server.db.retail_sales.find({"pos_sale_id": sid, "source_kind": "gift_card_sale"}, {"_id": 0}).to_list(10))
    assert len(cards) == 1 and len(rows) == 1, "one card, one revenue row"
    assert [c["code"] for c in again["gift_cards"]] == [cards[0]["code"]], "the replay hands back the same card"


def test_a_retried_top_up_adds_the_money_once():
    _sid, card = _sell_card(20.00)
    body = _body([{"kind": "gift_card", "gift_card_amount": 30.00, "gift_card_code": card["code"], "gift_card_topup": True}],
                 [{"method": "cash", "amount": 30.00, "tendered_amount": 30.00}])
    run(pos.create_sale(body, ADMIN))
    run(pos.create_sale(body, ADMIN))
    assert _balance(card["id"]) == 50.00


def test_a_retried_rack_card_sale_replays_instead_of_refusing():
    code = run(gift.mint_stock(quantity=1, actor=ADMIN))[0]["code"]
    body = _body([{"kind": "gift_card", "gift_card_amount": 25.00, "gift_card_code": code}],
                 [{"method": "cash", "amount": 25.00, "tendered_amount": 25.00}])
    first = run(pos.create_sale(body, ADMIN))
    again = run(pos.create_sale(body, ADMIN))           # used to be 409 "That card was already sold."
    assert _sale_id(again) == _sale_id(first)


def test_a_race_losers_card_charge_is_given_back(monkeypatch):
    _sid, card = _sell_card(40.00)
    pid = _product(10.00)
    winner = run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                       [{"method": "cash", "amount": 10.68, "tendered_amount": 10.68}]), ADMIN))

    async def lost_the_race(body, user):
        return {"ok": True, "sale": winner.get("sale"), "pos_sale_id": _sale_id(winner), "replayed": True}
    monkeypatch.setattr(pos, "_create_sale_impl_fn", lost_the_race)
    run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                              [{"method": "gift_card", "amount": 10.68, "gift_card_code": card["code"]}]), ADMIN))
    assert _balance(card["id"]) == 40.00, "the duplicate request's charge came back"


def test_if_the_second_card_fails_the_first_is_given_back(monkeypatch):
    _s1, c1 = _sell_card(30.00)
    _s2, c2 = _sell_card(30.00)
    pid = _product(40.00)
    real = gift.redeem
    calls = {"n": 0}

    async def flaky(**kw):
        calls["n"] += 1
        if calls["n"] == 2:
            raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")
        return await real(**kw)
    monkeypatch.setattr(gift, "redeem", flaky)
    with pytest.raises(HTTPException):
        run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                  [{"method": "gift_card", "amount": 30.00, "gift_card_code": c1["code"]},
                                   {"method": "gift_card", "amount": 12.70, "gift_card_code": c2["code"]}]), ADMIN))
    assert _balance(c1["id"]) == 30.00 and _balance(c2["id"]) == 30.00


def test_a_card_with_a_drifted_balance_can_still_be_spent():
    _sid, card = _sell_card(10.00)
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"balance": 11.370000000000001}}))
    run(gift.redeem(code=card["code"], amount=5.00, actor=ADMIN))
    assert _balance(card["id"]) == 6.37


def test_credit_card_gives_money_back_exactly_once_per_key():
    _sid, card = _sell_card(10.00)
    run(gift.redeem(code=card["code"], amount=10.00, actor=ADMIN))
    for _ in range(3):
        run(gift.credit_card(card_id=card["id"], amount=4.00, actor=ADMIN, key="refund:abc"))
    assert _balance(card["id"]) == 4.00


def test_a_voided_card_cannot_be_revived_by_an_adjustment():
    _sid, card = _sell_card(10.00)
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"status": "voided"}}))

    class Body:
        amount, direction, reason = 5.00, "add", "oops"
    with pytest.raises(HTTPException) as e:
        run(gift.adjust(code=card["code"], body=Body(), actor=ADMIN))
    assert e.value.status_code == 409


# ─────────────────────────────── B. a failed checkout gives the card back

from test_pickup_merchandise import (  # noqa: E402,F401
    _booking, _checkout, _cleanup, _client_dog, _gift_card, _lines, _pay_by_card,
    _product as _pickup_product, _tax_on_and_register_open,
)


def test_a_household_where_the_second_dog_fails_gets_every_cent_back(monkeypatch):
    cid, d1 = _client_dog()
    d2 = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": d2, "owner_id": cid, "name": "TEST_PICKUP Bolt"}))
    b1, b2 = _booking(cid, d1, price=40.0), _booking(cid, d2, price=40.0)
    card = _gift_card(500.00)
    real, calls = server._check_out_locked, {"n": 0}

    async def second_dog_refused(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 2:   # e.g. "That card only has $X left." for the second dog
            raise HTTPException(status_code=400, detail="That card only has $10.00 left.")
        return await real(*a, **kw)
    monkeypatch.setattr(server, "_check_out_locked", second_dog_refused)
    try:
        with pytest.raises(HTTPException):
            run(server.check_out_group(b1, server.CheckoutIn(
                use_credits=False, base_price=40.0, **_pay_by_card(card)), ADMIN))
        assert calls["n"] == 2
        assert _balance(card["id"]) == 500.00, "dog 1's charge went back when dog 2 was refused"
        for bid in (b1, b2):
            assert run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))["status"] == "checked_in"
    finally:
        run(server.db.gift_cards.delete_many({"id": card["id"]}))
        _cleanup(cid, [d1, d2], [b1, b2])


def test_a_payment_refused_after_the_card_was_charged_gives_the_card_back():
    cid, did = _client_dog()
    bid = _booking(cid, did, price=40.0)
    card = _gift_card(100.00)
    try:
        with pytest.raises(HTTPException):
            _checkout(bid, **_pay_by_card(card), tendered_amount=50.0)   # cash-only field on a card payment
        assert _balance(card["id"]) == 100.00
    finally:
        run(server.db.gift_cards.delete_many({"id": card["id"]}))
        _cleanup(cid, [did], [bid])


def test_merchandise_stays_bought_but_the_failed_stays_charge_comes_back():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did, price=40.0), _pickup_product(20.00)
    card = _gift_card(100.00)
    key = f"pickup-{uuid.uuid4()}"
    try:
        with pytest.raises(HTTPException):
            _checkout(bid, **_pay_by_card(card), retail_lines=_lines(prod), retail_idempotency_key=key,
                      tendered_amount=50.0)
        assert _balance(card["id"]) == 78.65, "the goods (21.35) are sold; the stay's 40 came back"
        out = _checkout(bid, **_pay_by_card(card), retail_lines=_lines(prod), retail_idempotency_key=key)
        assert out["status"] == "completed"
        assert _balance(card["id"]) == 38.65, "the retry replays the goods — not charged twice"
    finally:
        run(server.db.gift_cards.delete_many({"id": card["id"]}))
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_a_rollback_that_runs_twice_returns_the_money_once():
    _sid, card = _sell_card(50.00)
    run(gift.redeem(code=card["code"], amount=30.00, actor=ADMIN, operation_id="op-x", source="booking_checkout"))
    for _ in range(2):
        run(gift.return_checkout_charges(operation_id="op-x", actor=ADMIN))
    assert _balance(card["id"]) == 50.00


# ─────────────────────────────────────────────── C. void and return

def _void(sale_id, key=None):
    return run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
        reason="TEST_GIFT customer changed their mind", idempotency_key=key or f"void-{uuid.uuid4()}"), ADMIN))


def _return(sale_id, lines, key=None):
    return run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=lines, reason="TEST_GIFT changed their mind", idempotency_key=key or f"ret-{uuid.uuid4()}"), ADMIN))


def test_voiding_the_sale_of_a_card_takes_the_card_back_and_the_money_and_revenue_net_to_zero():
    revenue, cash = _revenue(), _expected_cash()
    sale_id, card = _sell_card(50.00)
    _void(sale_id)
    after = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert after["status"] == "voided" and after["balance"] == 0.0, "the card is dead, not live with $50"
    assert _revenue() == revenue, "the card's revenue is reversed"
    assert _expected_cash() == cash, "the drawer no longer expects the $50 that was handed back"


def test_voiding_a_top_up_takes_back_only_the_top_up():
    _s, card = _sell_card(20.00)
    body = _body([{"kind": "gift_card", "gift_card_amount": 30.00, "gift_card_code": card["code"], "gift_card_topup": True}],
                 [{"method": "cash", "amount": 30.00, "tendered_amount": 30.00}])
    sale_id = _sale_id(run(pos.create_sale(body, ADMIN)))
    _void(sale_id)
    after = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert after["balance"] == 20.00 and after["status"] == "active", "the customer's own $20 stays"


def test_a_sold_card_already_spent_refuses_the_void_and_nothing_changes():
    sale_id, card = _sell_card(50.00)
    run(gift.redeem(code=card["code"], amount=10.00, actor=ADMIN))
    with pytest.raises(HTTPException) as e:
        _void(sale_id)
    assert e.value.status_code == 409 and "already been spent" in e.value.detail
    assert _balance(card["id"]) == 40.00
    assert run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0}))["status"] == "completed"


def test_voiding_a_card_paid_sale_refills_the_card_with_no_revenue_change():
    _s, card = _sell_card(100.00)
    pid = _product(20.00)
    revenue, owed, cash = _revenue(), _tax_owed(), _expected_cash()
    sale_id = _sale_id(run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN)))
    _void(sale_id)
    assert _balance(card["id"]) == 100.00, "the card gets its $21.35 back"
    assert _revenue() == revenue and _tax_owed() == owed and _expected_cash() == cash


def test_returning_something_a_card_paid_for_puts_it_back_on_the_card_once():
    _s, card = _sell_card(100.00)
    pid = _product(20.00)
    revenue, owed = _revenue(), _tax_owed()
    sale_id = _sale_id(run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN)))
    key = f"ret-{uuid.uuid4()}"
    out = _return(sale_id, [{"line_index": 0, "qty": 1, "restock": True}], key=key)
    assert out["returned"]["tenders"][0]["gift_card_id"] == card["id"]
    _return(sale_id, [{"line_index": 0, "qty": 1, "restock": True}], key=key)   # a retry
    assert _balance(card["id"]) == 100.00, "refilled once"
    assert _revenue() == revenue and _tax_owed() == owed


def test_the_pl_counts_no_cash_for_a_card_paid_reversal():
    import pl_report
    row = {"amount": -21.35, "tax_amount": -1.35, "gift_card_funded": -20.00}
    assert pl_report._cash_received_on_row(row) == 0.0
    assert pl_report._cash_received_on_row({"amount": 21.35, "tax_amount": 1.35, "gift_card_funded": 20.00}) == 0.0
    assert pl_report._cash_received_on_row({"amount": -10.68, "tax_amount": -0.68}) == -10.68


# ────────────────────────────────── D. online cards refunded through Stripe

from domains.gift_cards import online as gconline  # noqa: E402
from domains.gift_cards import shop as gcshop  # noqa: E402


def _online_attempt(kind, **kw):
    a = {"id": str(uuid.uuid4()), "kind": kind, "status": "pending",
         "stripe_checkout_session_id": "cs_" + str(uuid.uuid4()),
         "business_date": server.business_today().isoformat(), "client_id": "gc-online-client",
         "created_at": server.now_iso(), "updated_at": server.now_iso()}
    a.update(kw)
    run(server.db.gift_card_topup_attempts.insert_one(dict(a)))
    a.pop("_id", None)
    return a


def _pay(attempt):
    intent = "pi_" + str(uuid.uuid4())
    run(gconline.handle_paid({"id": attempt["stripe_checkout_session_id"], "payment_status": "paid",
                              "amount_total": attempt["amount_cents"], "payment_intent": intent,
                              "metadata": {"sithappens_gift_card_topup_id": attempt["id"]}}))
    return intent


def _stripe_refund(intent, amount, refund_id=None):
    run(server._handle_refund_event({"id": refund_id or f"re_{uuid.uuid4().hex[:10]}", "object": "refund",
                                     "status": "succeeded", "amount": int(round(amount * 100)),
                                     "payment_intent": intent, "metadata": {}}))


def test_a_card_bought_online_and_refunded_in_stripe_is_voided_and_its_revenue_reversed():
    a = _online_attempt("purchase", card_id=str(uuid.uuid4()), amount_cents=5000, recipient_email="friend@example.com")
    intent = _pay(a)
    pay = run(server.db.payments.find_one({"processor_payment_id": intent}, {"_id": 0}))
    assert pay and pay["source"]["kind"] == "gift_card_online_payment", "the online payment is on the books"
    revenue = _revenue()
    refund_id = f"re_{uuid.uuid4().hex[:10]}"
    _stripe_refund(intent, 50.00, refund_id)
    card = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))
    assert card["status"] == "voided" and card["balance"] == 0.0, "a refunded card can't still be spent"
    assert _revenue() == round(revenue - 50.00, 2), "the $50 of revenue is reversed"
    _stripe_refund(intent, 50.00, refund_id)            # Stripe delivers it again
    assert _revenue() == round(revenue - 50.00, 2)


def test_refunding_an_online_top_up_takes_back_only_the_top_up():
    _s, card = _sell_card(20.00)
    a = _online_attempt("topup", gift_card_id=card["id"], code=card["code"], amount_cents=3000)
    intent = _pay(a)
    assert _balance(card["id"]) == 50.00
    _stripe_refund(intent, 30.00)
    after = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert after["balance"] == 20.00 and after["status"] == "active"


def test_a_refund_of_a_partly_spent_card_takes_what_is_left_and_flags_the_rest():
    a = _online_attempt("purchase", card_id=str(uuid.uuid4()), amount_cents=5000, recipient_email="friend@example.com")
    intent = _pay(a)
    code = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))["code"]
    run(gift.redeem(code=code, amount=10.00, actor=ADMIN))
    _stripe_refund(intent, 50.00)
    card = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))
    assert card["balance"] == 0.0 and card["status"] == "voided"
    pay = run(server.db.payments.find_one({"processor_payment_id": intent}, {"_id": 0}))
    assert pay["gift_card_refund_shortfall"] == 10.00 and pay["gift_card_refund_reconciliation_required"] is True


def test_a_card_bought_online_before_this_change_is_still_found_by_its_refund():
    a = _online_attempt("purchase", card_id=str(uuid.uuid4()), amount_cents=2500, recipient_email="friend@example.com")
    intent = _pay(a)
    run(server.db.payments.delete_many({"processor_payment_id": intent}))          # as older data looks
    run(server.db.retail_sales.update_one({"id": f"gcbuy-{a['id']}"}, {"$unset": {"payment_id": ""}}))
    _stripe_refund(intent, 25.00)
    assert run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))["status"] == "voided"


def _shop_card_order(amount=25.0):
    order = {"id": "ord-" + str(uuid.uuid4())[:8], "client_id": "cli-1", "client_name": "Dana",
             "client_email": "buyer@example.com"}
    line = {"item_id": "li-" + str(uuid.uuid4())[:8], "kind": "gift_card", "ref_id": gcshop.ref_id_for(amount),
            "unit_price": amount, "quantity": 1, "recipient_email": "friend@example.com", "name": f"Gift card · ${amount:.2f}",
            "fulfillment_status": "fulfilled"}
    run(server.db.shop_orders.insert_one({**order, "lines": [line], "total": amount}))

    async def no_email(card):
        return True
    run(gcshop.fulfill_line(order, line, mint=gift.mint_card, email=no_email))
    card = run(server.db.gift_cards.find_one({"id": f"gcshop-{order['id']}-{line['item_id']}-0"}, {"_id": 0}))
    return order, line, card


def test_a_shop_gift_card_can_be_refunded_while_unspent_and_is_then_dead():
    order, line, card = _shop_card_order()
    run(server._validate_shop_refund_entitlements(order, [{"line": line, "quantity": 1}]))   # no 409 any more
    attempt = {"id": str(uuid.uuid4()), "shop_refund": True, "shop_order_id": order["id"], "amount_cents": 2500,
               "line_refunds": [{"item_id": line["item_id"], "quantity": 1, "amount": 25.0, "tax_amount": 0.0}]}
    run(server._apply_shop_refund_fulfillment(attempt))
    run(server._apply_shop_refund_fulfillment(attempt))                                     # a replay
    after = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert after["status"] == "voided" and after["balance"] == 0.0
    fresh = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
    assert fresh["lines"][0]["fulfillment_status"] == "refunded", "Retry Fulfillment will skip it"
    sent = []

    async def capture(c):
        sent.append(c["id"])
    run(gcshop.fulfill_line(order, fresh["lines"][0], mint=gift.mint_card, email=capture))
    assert sent == [], "a refunded card is never emailed"


def test_a_spent_shop_gift_card_is_not_refunded_automatically():
    order, line, card = _shop_card_order()
    run(gift.redeem(code=card["code"], amount=5.00, actor=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(server._validate_shop_refund_entitlements(order, [{"line": line, "quantity": 1}]))
    assert e.value.status_code == 409 and "already been used" in e.value.detail


# ─────────────────────────────── review round: the edges

def test_a_sale_partly_returned_cannot_then_be_voided():
    _s, card = _sell_card(100.00)
    pid = _product(10.00)
    sale_id = _sale_id(run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 2}],
                                                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN)))
    _return(sale_id, [{"line_index": 0, "qty": 1, "restock": True}])
    refilled = _balance(card["id"])
    with pytest.raises(HTTPException) as e:
        _void(sale_id)
    assert e.value.status_code == 409 and "already been returned" in e.value.detail
    assert _balance(card["id"]) == refilled, "the returned part is not refilled a second time"


def test_a_void_racing_a_return_cannot_refund_the_returned_item_again():
    """Audit #8: a return reserves its items first and writes its record a
    moment later. A void in that gap must still see the reservation."""
    _s, card = _sell_card(100.00)
    pid = _product(10.00)
    sale_id = _sale_id(run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 2}],
                                                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN)))
    run(server.db.pos_sales.update_one({"id": sale_id}, {"$inc": {"line_items.0.returned_qty": 1}}))  # the return's reservation
    before = _balance(card["id"])
    with pytest.raises(HTTPException) as e:
        _void(sale_id)
    assert e.value.status_code == 409 and "already been returned" in e.value.detail
    assert run(server.db.pos_sales.find_one({"id": sale_id}))["status"] == "completed"
    assert _balance(card["id"]) == before, "nothing was refunded by the void"


def test_a_retried_void_of_a_card_sale_replays_instead_of_a_false_409():
    sale_id, card = _sell_card(50.00)
    key = f"void-{uuid.uuid4()}"
    _void(sale_id, key)
    out = _void(sale_id, key)
    assert out["ok"] and out["sale"]["status"] == "voided"


def test_voiding_the_sale_of_a_card_topped_up_since_keeps_the_customers_top_up():
    sale_id, card = _sell_card(50.00)
    run(pos.create_sale(_body([{"kind": "gift_card", "gift_card_amount": 30.00, "gift_card_code": card["code"], "gift_card_topup": True}],
                              [{"method": "cash", "amount": 30.00, "tendered_amount": 30.00}]), ADMIN))
    run(gift.redeem(code=card["code"], amount=30.00, actor=ADMIN))    # back down to 50
    _void(sale_id)
    after = run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))
    assert after["balance"] == 0.0 and after["status"] == "spent",         "not retired: it carried the customer's own top-up, which a later refund must be able to land on"


def test_a_zero_value_row_carries_no_card_offset_and_no_cash():
    import pl_report
    assert gift.funded_offset({"amount": 0.0, "tax_amount": 0.0, "pre_tax_amount": 0.0, "gift_card_funded": 100.0}) == {}
    assert pl_report._cash_received_on_row({"amount": -0.0, "tax_amount": 0.0, "gift_card_funded": -100.0}) == 0.0


def test_a_return_that_fails_part_way_leaves_nothing_behind_and_the_retry_books_it_once(monkeypatch):
    _s, card = _sell_card(100.00)
    pid = _product(20.00)
    sale_id = _sale_id(run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                                 [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN)))
    real = gift.refill_for_return

    async def boom(*a, **kw):
        raise RuntimeError("card service down")
    monkeypatch.setattr(gift, "refill_for_return", boom)
    key = f"ret-{uuid.uuid4()}"
    with pytest.raises(RuntimeError):
        _return(sale_id, [{"line_index": 0, "qty": 1, "restock": True}], key=key)
    assert run(server.db.pos_sale_returns.count_documents({"pos_sale_id": sale_id})) == 0
    assert run(server.db.retail_sales.count_documents({"pos_sale_id": sale_id, "source_kind": "pos_sale_return"})) == 0
    monkeypatch.setattr(gift, "refill_for_return", real)
    _return(sale_id, [{"line_index": 0, "qty": 1, "restock": True}], key=key)
    assert run(server.db.retail_sales.count_documents({"pos_sale_id": sale_id, "source_kind": "pos_sale_return"})) == 1
    assert _balance(card["id"]) == 100.00


def test_a_sale_that_fails_after_it_commits_still_finishes_its_card_bookkeeping(monkeypatch):
    _s, card = _sell_card(100.00)
    pid = _product(20.00)
    real = pos._create_sale_impl_fn

    async def commits_then_fails(body, user):
        await real(body, user)
        raise RuntimeError("lost the connection after the commit")
    monkeypatch.setattr(pos, "_create_sale_impl_fn", commits_then_fails)
    out = run(pos.create_sale(_body([{"kind": "retail", "product_id": pid, "qty": 1}],
                                    [{"method": "gift_card", "amount": 21.35, "gift_card_code": card["code"]}]), ADMIN))
    sale = run(server.db.pos_sales.find_one({"id": _sale_id(out)}, {"_id": 0}))
    assert [t.get("gift_card_id") for t in sale["tenders"]] == [card["id"]]
    row = run(server.db.retail_sales.find_one({"id": sale["retail_sales_id"]}, {"_id": 0}))
    assert row.get("gift_card_funded") == 20.00, "the card-paid goods are not counted as new revenue"
    assert _balance(card["id"]) == 78.65


def test_a_refund_that_arrives_before_the_purchase_is_recorded_is_applied_when_it_is():
    a = _online_attempt("purchase", card_id=str(uuid.uuid4()), amount_cents=5000, recipient_email="friend@example.com")
    intent = "pi_" + str(uuid.uuid4())
    _stripe_refund(intent, 50.00)                       # the owner refunded; the paid webhook hadn't landed
    run(gconline.handle_paid({"id": a["stripe_checkout_session_id"], "payment_status": "paid",
                              "amount_total": 5000, "payment_intent": intent,
                              "metadata": {"sithappens_gift_card_topup_id": a["id"]}}))
    card = run(server.db.gift_cards.find_one({"id": a["card_id"]}, {"_id": 0}))
    assert card["status"] == "voided" and card["balance"] == 0.0, "not a refund AND a live card"
    assert not card.get("code_emailed_at"), "a dead card is never emailed"
