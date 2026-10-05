"""Reversing a paid installment does not change a closed register day (audit #69:
"Reversing a payment-plan installment changes a closed register day"). The original
income row stays where it was; the money goes back out today as a refund on today's
register, and a second reversal of the same installment cannot refund again.
Disposable tag TEST_PLAN_REV."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_PLAN_REV"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Plan QA", "email": "plan@test"}
AMOUNT = 50.0


@pytest.fixture()
def paid_plan():
    today = server.business_today().isoformat()
    yesterday = (server.business_today().fromordinal(server.business_today().toordinal() - 1)).isoformat()
    pid, iid, income = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({"id": income, "date": yesterday, "description": f"{TAG} plan payment",
                                           "amount": AMOUNT, "category": "Payment Plans", "payment_method": "cash",
                                           "source_kind": "payment_plan_installment", "installment_id": iid,
                                           "created_at": server.now_iso(), "tag": TAG}))
    run(server.db.payment_plans.insert_one({"id": pid, "client_name": f"{TAG} owner", "status": "active",
                                            "total_amount": AMOUNT, "paid_total": AMOUNT, "remaining_total": 0.0,
                                            "installments": [{"id": iid, "amount": AMOUNT, "status": "paid",
                                                              "paid_method": "cash", "income_event_id": income,
                                                              "due_date": yesterday}],
                                            "tag": TAG}))
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": today},
        {"$setOnInsert": {"date": today, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield {"plan": pid, "inst": iid, "income": income, "today": today}
    run(server.db.payment_plans.delete_many({"tag": TAG}))
    run(server.db.retail_sales.delete_many({"tag": TAG}))
    run(server.db.retail_sales.delete_many({"reversed_retail_sales_id": income}))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def test_the_original_closed_day_row_is_left_as_it_was(paid_plan):
    run(server.reverse_installment_payment(paid_plan["plan"], paid_plan["inst"], None, current=ADMIN))
    original = run(server.db.retail_sales.find_one({"id": paid_plan["income"]}, {"_id": 0}))
    assert original is not None and original["amount"] == AMOUNT, "the closed day keeps its income row"


def test_the_money_goes_back_out_today_as_a_refund_linked_to_the_original(paid_plan):
    run(server.reverse_installment_payment(paid_plan["plan"], paid_plan["inst"], None, current=ADMIN))
    refund = run(server.db.retail_sales.find_one({"reversed_retail_sales_id": paid_plan["income"]}, {"_id": 0}))
    assert refund is not None
    assert refund["amount"] == -AMOUNT and refund["date"] == paid_plan["today"]
    assert refund["source_kind"] == "payment_plan_reversal"
    assert refund["payment_method"] == "cash"


def test_a_second_reversal_of_the_same_installment_is_refused(paid_plan):
    run(server.reverse_installment_payment(paid_plan["plan"], paid_plan["inst"], None, current=ADMIN))
    with pytest.raises(HTTPException) as err:
        run(server.reverse_installment_payment(paid_plan["plan"], paid_plan["inst"], None, current=ADMIN))
    assert err.value.status_code == 409
    assert run(server.db.retail_sales.count_documents({"reversed_retail_sales_id": paid_plan["income"]})) == 1


def test_a_reversal_is_refused_while_todays_register_is_closed(paid_plan, monkeypatch):
    async def closed(_date):
        raise HTTPException(status_code=409, detail="Today's register is closed.")
    monkeypatch.setattr(server, "_require_register_day_open", closed)
    with pytest.raises(HTTPException) as err:
        run(server.reverse_installment_payment(paid_plan["plan"], paid_plan["inst"], None, current=ADMIN))
    assert err.value.status_code == 409
    assert run(server.db.retail_sales.count_documents({"reversed_retail_sales_id": paid_plan["income"]})) == 0


@pytest.fixture()
def due_plan():
    today = server.business_today().isoformat()
    pid, iid = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.payment_plans.insert_one({"id": pid, "client_id": f"{TAG}-client", "client_name": f"{TAG} owner",
                                            "status": "active", "total_amount": AMOUNT, "paid_total": 0.0,
                                            "remaining_total": AMOUNT,
                                            "installments": [{"id": iid, "amount": AMOUNT, "status": "due", "due_date": today}],
                                            "tag": TAG}))
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": today},
        {"$setOnInsert": {"date": today, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield {"plan": pid, "inst": iid}
    run(server.db.payment_plans.delete_many({"tag": TAG}))
    run(server.db.retail_sales.delete_many({"installment_id": {"$exists": True}, "client_name": f"{TAG} owner"}))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def test_two_mark_paid_taps_write_one_income_row(due_plan):
    import asyncio
    body = server.MarkPaidIn(method="cash")

    async def tap_twice():
        return await asyncio.gather(
            server.mark_installment_paid(due_plan["plan"], due_plan["inst"], body, current=ADMIN),
            server.mark_installment_paid(due_plan["plan"], due_plan["inst"], body, current=ADMIN),
            return_exceptions=True)

    results = run(tap_twice())
    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == 1 and refused[0].status_code == 400, results
    assert run(server.db.retail_sales.count_documents({"installment_id": due_plan["inst"]})) == 1, "one income row, not two"
