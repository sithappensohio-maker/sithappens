"""Gift card money counts as income ONCE — the day the card is sold or topped
up — never again when it pays for a visit (audit #19; owner option A,
2026-09-28).

Before: a card paying for a WHOLE visit was already right, but a card paying
the part credits didn't cover (a $50 visit, $40 of credit, $10 on the card),
or paying part of a visit with the rest on the tab, was counted as new income
a second time — in the P&L, the Weekly Summary, Quarterly Tax and the tax
estimates built on it, the register's "Booking payments", and End of Day. The
P&L's "Most Active Dogs" counted even a whole card-paid visit.

Each test measures the day's figures before and after one checkout, so other
data in the database cannot move the answer. Real money is still
counted — the controls (paid by check) prove the fix only takes out card money.

Self-contained fixtures (never import another test module).
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import pl_report
from _test_loop import run
from domains.gift_cards import services as gift

TAG = "TEST_GC_INCOME_ONCE"
ADMIN = {"id": "gc-income-admin", "name": "GC Income QA", "email": "gcincome@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _register_open(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _day():
    return server.business_today().isoformat()


def _client_dog():
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:8]}", f"{TAG}-d-{uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "phone": "6145550000", "credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} Luna"}))
    return cid, did


def _booking(cid, did, price=40.0, **extra):
    bid = f"{TAG}-b-{uuid.uuid4().hex[:8]}"
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "dog_id": did, "dog_name": f"{TAG} Luna", "client_name": f"{TAG} owner",
        "service_type": "daycare", "date": _day(), "status": "checked_in",
        "checked_in_at": server.now_iso(), "estimated_price": price, "unit_price": price,
        "created_at": server.now_iso(), **extra}))
    return bid


def _credit_booking(cid, did):
    """A daycare visit already paid for with one $40 credit."""
    return _booking(cid, did, credit_value=40.0, credits_deducted=1)


def _card(value=100.00):
    return run(gift.mint_card(amount=value, actor=ADMIN, note=f"{TAG} test card", origin="issued"))


def _balance(card):
    return round(float(run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))["balance"]), 2)


def _checkout(bid, **body):
    payload = {"use_credits": False, "payment_method": "cash", "base_price": 40.0}
    payload.update(body)
    return run(server.check_out(bid, server.CheckoutIn(**payload), ADMIN))


def _by_card(card, **over):
    return {"payment_method": "gift_card", "gift_card_code": card["code"], "payment_status": "paid", **over}


def _figures(did):
    """Every place the day's visit income shows up."""
    d = _day()
    pl = run(pl_report.build_pl_data(server.db, d, d))
    week = run(server.weekly_summary(_=ADMIN))
    quarter = run(server.admin_quarterly_tax(_=ADMIN, year=None))
    reg = run(server._register_day_summary(d))
    dog = next((x for x in pl.get("top_dogs") or [] if x.get("dog_id") == did), {})
    return {
        "events": round(sum(e["amount"] for e in run(server._booking_collection_events(d, d))), 2),
        "pl_net": round(float(pl.get("net") or 0), 2),
        "weekly_net": round(float(week.get("net_total") or 0), 2),
        "quarterly_services": round(float((quarter.get("income") or {}).get("service_bookings") or 0), 2),
        "register_booking_payments": round(float(reg["incoming_sources"]["booking_payments"]), 2),
        "register_incoming_total": round(float(reg["totals"]["incoming_total"]), 2),
        "top_dog_revenue": round(float(dog.get("total") or 0), 2),
    }


def _delta(before, after):
    return {k: round(after[k] - before[k], 2) for k in before}


NOTHING = {"events": 0.0, "pl_net": 0.0, "weekly_net": 0.0, "quarterly_services": 0.0,
           "register_booking_payments": 0.0, "register_incoming_total": 0.0, "top_dog_revenue": 0.0}


def _cleanup(cid, did, bids, card=None):
    async def go():
        await server.db.bookings.delete_many({"id": {"$in": list(bids)}})
        await server.db.dogs.delete_many({"id": did})
        await server.db.clients.delete_many({"id": cid})
        for coll in ("payment_ledger", "invoices", "payments", "retail_sales"):
            await getattr(server.db, coll).delete_many({"client_id": cid})
        if card:
            await server.db.gift_cards.delete_many({"id": card["id"]})
    run(go())


@pytest.mark.parametrize("ui_sends_amount", [False, True])
def test_a_card_paying_what_credits_did_not_cover_is_not_new_income(ui_sends_amount):
    cid, did = _client_dog()
    bid = _credit_booking(cid, did)
    card = _card()
    try:
        before = _figures(did)
        extra = {"amount_paid": 10.0} if ui_sends_amount else {}
        _checkout(bid, use_credits=True, base_price=50.0, **_by_card(card, **extra))
        assert _balance(card) == 90.0, "the card paid the $10 the credit didn't cover"
        assert _delta(before, _figures(did)) == NOTHING
        b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        assert float(b.get("cash_revenue") or 0) == 0.0
    finally:
        _cleanup(cid, did, [bid], card)


def test_a_card_paying_part_of_a_visit_with_the_rest_on_the_tab_is_not_new_income():
    cid, did = _client_dog()
    bid = _booking(cid, did)
    card = _card()
    try:
        before = _figures(did)
        _checkout(bid, **_by_card(card, payment_status="paid_partial", amount_paid=15.0))
        assert _balance(card) == 85.0
        b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        assert b["payment_status"] == "paid_partial" and float(b["balance_due"]) == 25.0, "the rest is still owed"
        assert _delta(before, _figures(did)) == NOTHING
    finally:
        _cleanup(cid, did, [bid], card)


@pytest.mark.parametrize("amount", [40.0, 60.0])
def test_a_card_paying_the_whole_visit_or_more_through_the_tab_screen_is_not_new_income(amount):
    """The pickup screen's "Partial / on tab" mode with the whole amount (or
    more) typed in, paid by card."""
    cid, did = _client_dog()
    bid = _booking(cid, did)
    card = _card()
    try:
        before = _figures(did)
        _checkout(bid, **_by_card(card, payment_status="paid_partial", amount_paid=amount))
        assert _balance(card) == round(100.0 - amount, 2)
        assert _delta(before, _figures(did)) == NOTHING
    finally:
        _cleanup(cid, did, [bid], card)


def test_most_active_dogs_shows_no_revenue_for_a_visit_paid_by_card():
    cid, did = _client_dog()
    bid = _booking(cid, did)
    card = _card()
    try:
        before = _figures(did)
        _checkout(bid, **_by_card(card))
        assert _balance(card) == 60.0
        assert _delta(before, _figures(did)) == NOTHING
    finally:
        _cleanup(cid, did, [bid], card)


def test_money_paying_part_of_a_visit_is_still_income():
    cid, did = _client_dog()
    bid = _booking(cid, did)
    try:
        before = _figures(did)
        _checkout(bid, payment_method="check", payment_status="paid_partial", amount_paid=15.0)
        change = _delta(before, _figures(did))
        for k in ("events", "pl_net", "weekly_net", "quarterly_services", "register_booking_payments", "register_incoming_total"):
            assert change[k] == 15.0, k
    finally:
        _cleanup(cid, did, [bid])


def test_money_paying_what_credits_did_not_cover_is_still_income():
    cid, did = _client_dog()
    bid = _credit_booking(cid, did)
    try:
        before = _figures(did)
        _checkout(bid, use_credits=True, base_price=50.0, payment_method="check", payment_status="paid")
        change = _delta(before, _figures(did))
        for k in ("events", "pl_net", "weekly_net", "quarterly_services", "register_booking_payments",
                  "register_incoming_total", "top_dog_revenue"):
            assert change[k] == 10.0, k
    finally:
        _cleanup(cid, did, [bid])


def test_the_one_revenue_rule_takes_out_what_a_card_paid_on_a_credits_visit():
    base = {"payment_method": "credits", "actual_price": 50.0, "credit_value": 40.0, "payment_status": "paid"}
    assert server._cash_revenue({**base, "amount_paid": 10.0, "gift_card_applied": 10.0}) == 0.0
    assert server._cash_revenue({**base, "amount_paid": 10.0, "gift_card_applied": 4.0}) == 6.0
    assert server._cash_revenue({**base, "amount_paid": 10.0}) == 10.0
    assert server._cash_revenue({**base, "amount_paid": 0.0}) == 10.0
