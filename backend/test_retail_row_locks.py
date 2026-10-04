"""Income's Retail Sales rows: a manual sale can be edited and removed there; a
row the register, a payment, a refund or the Shop wrote cannot (audit:
"Editing a refund row in Income turns it into a sale"). Disposable tag
TEST_RETAIL_LOCK."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_RETAIL_LOCK"
ADMIN = {"id": f"{TAG}-admin", "name": "Lock QA", "email": "lock@test", "role": "admin"}
DAY = "2031-04-02"


def _row(**over):
    doc = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "date": DAY, "description": f"{TAG} row", "amount": 20.0,
           "category": "Retail", "payment_method": "cash", "created_at": server.now_iso(), "tag": TAG}
    doc.update(over)
    run(server.db.retail_sales.insert_one(dict(doc)))
    return doc


def _edit(row, amount=30.0):
    body = server.RetailSaleIn(date=DAY, description=f"{TAG} edited", amount=amount, payment_method="cash")
    return run(server.update_retail_sale(row["id"], body, ADMIN))


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.retail_sales.delete_many({"tag": TAG}))


def test_a_manual_sale_can_still_be_edited_and_removed():
    manual = _row()
    out = _edit(manual, amount=25.0)
    assert out["amount"] == 25.0
    run(server.delete_retail_sale(manual["id"], ADMIN))
    assert run(server.db.retail_sales.find_one({"id": manual["id"]})) is None


def test_a_refund_row_cannot_be_edited_into_a_sale():
    refund = _row(amount=-20.0, source_kind="refund", description=f"{TAG} refund")
    with pytest.raises(HTTPException) as err:
        _edit(refund, amount=20.0)
    assert err.value.status_code == 409
    assert run(server.db.retail_sales.find_one({"id": refund["id"]}))["amount"] == -20.0, "the money stays a refund"


def test_a_register_sale_row_cannot_be_edited(  ):
    sale = _row(pos_sale_id=f"{TAG}-pos")
    with pytest.raises(HTTPException) as err:
        _edit(sale)
    assert err.value.status_code == 409


@pytest.mark.parametrize("extra", [
    {"source_kind": "refund"}, {"source_kind": "pos_sale_return", "pos_sale_id": f"{TAG}-p"},
    {"source_kind": "pos_sale_void"}, {"source_kind": "stripe_refund"}, {"source_kind": "invoice_payment"},
    {"source_kind": "shop_order", "shop_order_id": f"{TAG}-o"}, {"source_kind": "credit_pack_sale"},
    {"source_kind": "payment_plan_installment", "installment_id": f"{TAG}-i"}, {"source_kind": "gift_card_sale"},
    {"amount": -5.0},
])
def test_system_rows_cannot_be_removed(extra):
    row = _row(**extra)
    with pytest.raises(HTTPException) as err:
        run(server.delete_retail_sale(row["id"], ADMIN))
    assert err.value.status_code == 409
    assert run(server.db.retail_sales.find_one({"id": row["id"]})) is not None


def test_the_list_says_which_rows_the_system_wrote():
    manual = _row()
    refund = _row(amount=-7.0, source_kind="refund")
    rows = {r["id"]: r for r in run(server.list_retail_sales(ADMIN, start_date=DAY, end_date=DAY))}
    assert rows[manual["id"]]["system"] is False
    assert rows[refund["id"]]["system"] is True
