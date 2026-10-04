"""A refund, a return and a void on the same Register sale take turns (audit
#86: "a refund and a void on the same sale can both go through"). Each one
reads what the sale has already given back and then writes, so run together
they each see the sale whole and both pay out. Each takes the sale's claim
first; a second one on the same sale is refused while it is held, a claim left
by a crash expires, and a refused action gives its claim back. Disposable tag
TEST_SALE_CLAIM."""
import asyncio
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
from domains.pos import sale_claims
import test_pos_returns as tpr
from test_register_refund_guards import ADMIN, _refund, _register_open_with_tax, _sell  # noqa: F401 — the fixture

TAG = "TEST_SALE_CLAIM"
_sales = []


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.sale_action_claims.delete_many({"pos_sale_id": {"$in": _sales}}))
    # The sales' own rows too: their tax is on today's books otherwise, and other files count today's tax.
    run(server.db.retail_sales.delete_many({"pos_sale_id": {"$in": _sales}}))
    run(server.db.pos_sales.delete_many({"id": {"$in": _sales}}))
    _sales.clear()


def _sale(price=100.00):
    sale_id, total = _sell(price)
    _sales.append(sale_id)
    return sale_id, total


def _refund_rows(sale_id):
    return run(server.db.retail_sales.count_documents({"pos_sale_id": sale_id, "amount": {"$lt": 0}}))


def _status(sale_id):
    return run(server.db.pos_sales.find_one({"id": sale_id}, {"_id": 0, "status": 1}))["status"]


def _void(sale_id):
    return run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
        reason=f"{TAG} wrong item", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))


@contextmanager
def _busy(sale_id, action):
    """Hold the sale's claim the way a running refund, return or void would."""
    cm = sale_claims.held(server.db, sale_id, action)
    run(cm.__aenter__())
    try:
        yield
    finally:
        run(cm.__aexit__(None, None, None))


def test_a_hand_refund_is_refused_while_a_void_holds_the_sale():
    sale_id, _ = _sale()
    with _busy(sale_id, "void"):
        with pytest.raises(HTTPException) as err:
            _refund(sale_id=sale_id, amount=10.00)
    assert err.value.status_code == 409
    assert "being saved" in err.value.detail
    assert _refund_rows(sale_id) == 0, "nothing is refunded while the sale is busy"


def test_a_return_is_refused_while_a_refund_holds_the_sale():
    pid = tpr._product(10.00, stock=9)
    sale_id = tpr._sell([{"kind": "retail", "product_id": pid, "qty": 3}],
                        [{"method": "cash", "amount": 32.03, "tendered_amount": 40.00}])
    _sales.append(sale_id)
    with _busy(sale_id, "refund"):
        with pytest.raises(HTTPException) as err:
            tpr._ret(sale_id, [{"line_index": 0, "qty": 1}])
    assert err.value.status_code == 409
    assert run(server.db.pos_sale_returns.count_documents({"pos_sale_id": sale_id})) == 0


def test_a_void_is_refused_while_a_refund_holds_the_sale():
    sale_id, _ = _sale()
    with _busy(sale_id, "refund"):
        with pytest.raises(HTTPException) as err:
            _void(sale_id)
    assert err.value.status_code == 409
    assert _status(sale_id) == "completed", "the sale stays whole"


def test_a_claim_on_one_sale_does_not_hold_up_another():
    busy, _ = _sale()
    free, _ = _sale()
    with _busy(busy, "void"):
        _refund(sale_id=free, amount=10.00)
    assert _refund_rows(free) == 1


def test_a_refund_and_a_void_racing_on_one_sale_cannot_both_go_through():
    sale_id, total = _sale()

    async def race():
        refund = server.admin_register_refund(
            server.RegisterRefundIn(reason=f"{TAG} correction", payment_method="cash", sale_id=sale_id, amount=total),
            ADMIN)
        void = server.void_pos_sale(sale_id, server.PosSaleVoidIn(
            reason=f"{TAG} wrong item", idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN)
        return await asyncio.gather(refund, void, return_exceptions=True)

    results = run(race())
    paid = [r for r in results if not isinstance(r, Exception)]
    assert len(paid) == 1, f"exactly one of the refund and the void may go through, got {results!r}"
    assert run(server.db.sale_action_claims.count_documents({"pos_sale_id": sale_id})) == 0


def test_a_claim_left_by_a_crash_expires_and_the_sale_moves_on():
    sale_id, _ = _sale()
    past = datetime.now(timezone.utc) - timedelta(minutes=10)
    run(server.db.sale_action_claims.insert_one({
        "pos_sale_id": sale_id, "action": "void", "token": "crashed",
        "claimed_at": past, "expires_at": past + timedelta(seconds=sale_claims.CLAIM_SECONDS)}))
    _refund(sale_id=sale_id, amount=10.00)
    assert _refund_rows(sale_id) == 1
    assert run(server.db.sale_action_claims.count_documents({"pos_sale_id": sale_id})) == 0


def test_a_refused_refund_gives_its_claim_back():
    sale_id, total = _sale()
    with pytest.raises(HTTPException) as err:
        _refund(sale_id=sale_id, amount=total + 500)   # over the ceiling
    assert err.value.status_code == 400
    assert run(server.db.sale_action_claims.count_documents({"pos_sale_id": sale_id})) == 0
    _refund(sale_id=sale_id, amount=10.00)
    assert _refund_rows(sale_id) == 1
