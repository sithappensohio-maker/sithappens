"""A retry of a register sale that already went through replays it (audit #47).

The cart was priced, stock was taken, the sale completed. A retry with the same
idempotency key priced the cart again, found the stock gone, and refused it as
out of stock instead of replaying the finished sale. A completed sale with the
same cart now replays. A different cart is still refused. Disposable tag TEST_POS_RETRY.
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.pos.models import PosSaleIn, PosSaleLineIn, PosSaleTenderIn

TAG = "TEST_POS_RETRY"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "pos-retry@test"}


def _body(key, product_id, qty=1):
    return PosSaleIn(lines=[PosSaleLineIn(kind="retail", product_id=product_id, qty=qty)],
                     tenders=[PosSaleTenderIn(method="card", amount=10.0)], idempotency_key=key)


@pytest.fixture()
def done_sale(monkeypatch):
    """A completed sale for one product, and its claim, as the first attempt left them."""
    key = f"{TAG}-{uuid.uuid4().hex}"
    product_id = f"{TAG}-p-{uuid.uuid4().hex[:6]}"
    sale_id = f"{TAG}-s-{uuid.uuid4().hex[:6]}"
    run(server.db.pos_sales.insert_one({"id": sale_id, "tag": TAG, "client_id": None, "status": "completed",
                                        "receipt_number": "RETRY", "line_items": [
                                            {"kind": "retail", "product_id": product_id, "qty": 1.0, "line_total": 10.0}]}))
    run(server.db.pos_sale_claims.insert_one({"id": f"{TAG}-c-{uuid.uuid4().hex[:6]}", "tag": TAG, "idempotency_key": key,
                                              "status": "completed", "pos_sale_id": sale_id, "request_fingerprint": "x"}))

    async def out_of_stock(*args, **kwargs):
        raise HTTPException(status_code=409, detail="Widget is out of stock.")
    monkeypatch.setattr(server, "_price_pos_cart", out_of_stock)
    yield key, product_id, sale_id
    run(server.db.pos_sales.delete_many({"tag": TAG}))
    run(server.db.pos_sale_claims.delete_many({"tag": TAG}))


def test_the_same_cart_retried_replays_the_finished_sale(done_sale):
    key, product_id, sale_id = done_sale
    out = run(server._create_pos_sale_impl(_body(key, product_id), ADMIN))
    assert out["replayed"] is True and out["pos_sale_id"] == sale_id


def test_a_different_cart_on_a_used_key_is_still_refused(done_sale):
    key, _product_id, _sale_id = done_sale
    with pytest.raises(HTTPException) as exc:
        run(server._create_pos_sale_impl(_body(key, f"{TAG}-other", qty=2), ADMIN))
    assert exc.value.status_code == 409 and "out of stock" in exc.value.detail
