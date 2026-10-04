"""A register refund with no receipt number is only for something that is not
against a Register sale, and says so (audit: "A refund with the receipt box
left empty is invisible to a later void or return"). An unmarked empty-box
refund is refused, so no later void or return can take the same money again.
Disposable tag TEST_REFGUARD (shared with test_register_refund_guards.py)."""
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_REFGUARD"
ADMIN = {"id": "ebr-admin", "name": "Empty Box QA", "email": "ebr@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


def _refund(**kw):
    payload = {"reason": f"{TAG} correction", "payment_method": "cash",
               "date": server.business_today().isoformat()}
    payload.update(kw)
    return run(server.admin_register_refund(server.RegisterRefundIn(**payload), ADMIN))


def test_an_empty_box_refund_not_marked_as_a_sale_is_refused():
    with pytest.raises(HTTPException) as err:
        _refund(amount=12.00)
    assert err.value.status_code == 400
    assert "Not against a Register sale" in err.value.detail
    assert run(server.db.retail_sales.count_documents({"description": {"$regex": TAG}})) == 0


def test_a_marked_not_against_a_sale_refund_is_saved_and_says_so():
    doc = _refund(amount=12.00, not_against_sale=True)["refund"]
    assert doc["amount"] == -12.00
    assert doc["pos_sale_id"] is None
    assert doc["not_against_sale"] is True


def test_a_receipt_and_the_not_a_sale_tick_together_are_refused():
    with pytest.raises(HTTPException) as err:
        _refund(amount=5.00, sale_id="00000000-0000-0000-0000-000000000000", not_against_sale=True)
    assert err.value.status_code == 400
