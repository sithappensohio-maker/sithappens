"""Goods bought at a dog's pickup print their own receipt (audit #89: "goods
sold at a pickup get no receipt"). The stay's receipt was the only one the
checkout named, so a bag of food rang up on the Register printed nothing. The
goods' receipt now rides on the checkout response with the visit's, and only
when auto-print is on. Disposable tag TEST_PICKUP (shared with
test_pickup_merchandise.py)."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from test_pickup_merchandise import (  # noqa: F401 — the fixture is used by the tests below
    _booking, _checkout, _cleanup, _client_dog, _lines, _product, _tax_on_and_register_open)  # noqa: F401


@pytest.fixture()
def auto_print():
    prev = run(server.db.receipt_settings.find_one({"_id": "singleton"}, {"_id": 0}))
    run(server.db.receipt_settings.update_one({"_id": "singleton"}, {"$set": {"auto_print_receipts": True}}, upsert=True))
    yield
    if prev is None:
        run(server.db.receipt_settings.delete_one({"_id": "singleton"}))
    else:
        run(server.db.receipt_settings.replace_one({"_id": "singleton"}, prev, upsert=True))


def _token_rows(sale_id):
    return run(server.db.pos_action_tokens.find({"pos_sale_id": sale_id}, {"_id": 0}).to_list(10))


def test_goods_bought_at_pickup_print_their_own_receipt(auto_print):
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    sale_id = None
    try:
        out = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        sale_id = out["pickup_sale"]["pos_sale_id"]
        assert len(out.get("pos_extra_print_receipt_tokens") or []) == 1, "the goods get one receipt of their own"
        rows = _token_rows(sale_id)
        assert rows and rows[0]["action"] == "print_receipt", "the token prints the goods' sale, not the stay"
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])
        if sale_id:
            run(server.db.pos_action_tokens.delete_many({"pos_sale_id": sale_id}))


def test_a_stay_with_nothing_bought_prints_no_goods_receipt(auto_print):
    cid, did = _client_dog()
    bid = _booking(cid, did)
    try:
        out = _checkout(bid)
        assert not out.get("pos_extra_print_receipt_tokens")
    finally:
        _cleanup(cid, [did], [bid])


def test_with_auto_print_off_the_goods_get_no_receipt_token():
    prev = run(server.db.receipt_settings.find_one({"_id": "singleton"}, {"_id": 0}))
    run(server.db.receipt_settings.update_one({"_id": "singleton"}, {"$set": {"auto_print_receipts": False}}, upsert=True))
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    try:
        out = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        assert not out.get("pos_extra_print_receipt_tokens"), "auto-print off: staff print from the screen"
        assert out["pickup_sale"]["pos_sale_id"], "the sale itself still happened"
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])
        if prev is None:
            run(server.db.receipt_settings.delete_one({"_id": "singleton"}))
        else:
            run(server.db.receipt_settings.replace_one({"_id": "singleton"}, prev, upsert=True))


def test_goods_rung_on_a_household_checkout_print_with_the_group(auto_print):
    # The household's bill goes through the group answer, so the goods' receipt
    # has to ride on that answer too, not only on the single-dog one.
    from test_checkout_price_permission import _catalogue, _family, _group
    from test_pickup_merchandise import ADMIN
    with _catalogue() as svc, _family(svc, dogs=2) as (_cid, dogs):
        ids = _group(svc, dogs)
        prod = _product(20.00)
        try:
            out = run(server.check_out_group(ids[0], server.CheckoutIn(
                use_credits=False, payment_method="check", payment_status="paid",
                retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}"), ADMIN))
            assert len(out.get("pos_extra_print_receipt_tokens") or []) == 1, "the goods print with the household's checkout"
        finally:
            run(server.db.pos_products.delete_many({"id": prod["id"]}))
