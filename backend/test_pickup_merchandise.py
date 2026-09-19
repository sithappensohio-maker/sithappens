"""Selling a bag of food while the dog is being collected.

The rule this encodes: merchandise at pickup is an ordinary Register sale, not
a booking add-on. That distinction is the whole design — it means stock, sales
tax, retail revenue, the receipt and idempotency are the ones that already
work, rather than a second till growing quietly on the booking record.

So these tests mostly check that the retail machinery really did run: that the
stay stayed untaxed while the goods were taxed, that inventory moved, that a
retail_sales row exists, and that a household checkout cannot sell the same
bag of food once per dog.

Disposable tag TEST_PICKUP.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_PICKUP"
RATE = 6.75
ADMIN = {"id": "pickup-admin", "name": "Pickup QA", "email": "pickup@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _tax_on_and_register_open():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def _client_dog():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "phone": "6145550000", "credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} Luna"}))
    return cid, did


def _booking(cid, did, price=40.0):
    bid = str(uuid.uuid4())
    day = server.business_today().isoformat()
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "dog_id": did, "dog_name": f"{TAG} Luna",
        "service_type": "daycare", "date": day, "status": "checked_in",
        "checked_in_at": server.now_iso(), "estimated_price": price, "unit_price": price,
        "created_at": server.now_iso(),
    }))
    return bid


def _product(price, *, stock=None, taxable=True):
    pid = str(uuid.uuid4())
    doc = {"id": pid, "name": f"{TAG} bag of food", "description": "", "sku": "", "category": "",
           "price": price, "active": True, "archived": False, "show_at_register": True,
           "show_online": False, "track_inventory": stock is not None,
           "stock_on_hand": float(stock or 0), "category_id": None, "subcategory_id": None,
           "featured": False, "image_id": None, "taxable": taxable}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _checkout(bid, **over):
    payload = {"use_credits": False, "payment_method": "cash", "base_price": 40.0}
    payload.update(over)
    return run(server.check_out(bid, server.CheckoutIn(**payload), ADMIN))


def _cleanup(cid=None, dids=(), bids=(), pids=()):
    async def go():
        await server.db.bookings.delete_many({"id": {"$in": list(bids)}})
        await server.db.pos_products.delete_many({"id": {"$in": list(pids)}})
        await server.db.dogs.delete_many({"id": {"$in": list(dids)}})
        if cid:
            await server.db.clients.delete_many({"id": cid})
            await server.db.retail_sales.delete_many({"client_id": cid})
            await server.db.pos_sales.delete_many({"client_id": cid})
            await server.db.invoices.delete_many({"client_id": cid})
            await server.db.payments.delete_many({"client_id": cid})
            await server.db.payment_ledger.delete_many({"client_id": cid})
    run(go())


def _lines(product, qty=1):
    return [{"kind": "retail", "product_id": product["id"], "qty": qty}]


# --------------------------------------------------------------- the basics

def test_a_stay_with_nothing_bought_is_completely_unchanged():
    cid, did = _client_dog()
    bid = _booking(cid, did)
    try:
        out = _checkout(bid)
        assert out["status"] == "completed"
        assert float(out["actual_price"]) == 40.0
        assert not out.get("pickup_sale")
        assert not out.get("tax_amount"), "a stay is a service and is never taxed"
    finally:
        _cleanup(cid, [did], [bid])


def test_food_bought_at_pickup_is_taxed_while_the_stay_is_not():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    try:
        out = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        sale = out["pickup_sale"]
        assert sale["subtotal"] == 20.00
        assert sale["tax_amount"] == 1.35          # 20.00 @ 6.75%
        assert sale["total"] == 21.35
        assert sale["pos_sale_id"]
        # and the stay itself is untouched by any of it
        assert float(out["actual_price"]) == 40.0
        assert not out.get("tax_amount")
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_the_sale_is_a_real_register_sale_not_a_booking_field():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    try:
        out = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        sale = run(server.db.pos_sales.find_one({"id": out["pickup_sale"]["pos_sale_id"]}, {"_id": 0}))
        assert sale, "it lands in pos_sales like any other till sale"
        assert round(float(sale["total"]), 2) == 21.35
        # retail revenue is recorded the one canonical way
        rows = run(server.db.retail_sales.find({"client_id": cid}, {"_id": 0}).to_list(10))
        assert rows, "retail revenue row written"
        assert abs(float(rows[0]["tax_amount"]) - 1.35) < 0.005
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_stock_comes_down_by_what_was_sold():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00, stock=10)
    try:
        _checkout(bid, retail_lines=_lines(prod, qty=3), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        after = run(server.db.pos_products.find_one({"id": prod["id"]}, {"_id": 0}))
        assert float(after["stock_on_hand"]) == 7.0
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_an_item_marked_exempt_is_still_exempt_at_pickup():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00, taxable=False)
    try:
        out = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        assert out["pickup_sale"]["tax_amount"] == 0.0
        assert out["pickup_sale"]["total"] == 20.00
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


# ------------------------------------------------------------- refusing well

def test_selling_out_of_stock_refuses_before_the_dog_is_checked_out():
    # The order matters: the part that can legitimately refuse runs first, so
    # a refusal leaves nothing half-done.
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00, stock=1)
    try:
        with pytest.raises(HTTPException):
            _checkout(bid, retail_lines=_lines(prod, qty=5), retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        assert b["status"] == "checked_in", "the stay was left alone"
        assert not b.get("checked_out_at")
        assert float(run(server.db.pos_products.find_one({"id": prod["id"]}, {"_id": 0}))["stock_on_hand"]) == 1.0
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_credits_cannot_buy_dog_food():
    # Credits are prepaid VISITS. Letting them buy merchandise would invent
    # revenue that was never paid for.
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    try:
        with pytest.raises(HTTPException) as e:
            _checkout(bid, retail_lines=_lines(prod), payment_method="credits",
                      retail_idempotency_key=f"pickup-{uuid.uuid4()}")
        assert e.value.status_code == 400
        assert "Credits can't pay for products" in str(e.value.detail)
        assert run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))["status"] == "checked_in"
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_a_sale_without_an_idempotency_key_is_refused():
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00)
    try:
        with pytest.raises(HTTPException) as e:
            _checkout(bid, retail_lines=_lines(prod))
        assert e.value.status_code == 400
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_the_same_key_never_sells_the_same_food_twice():
    # A retry after a flaky connection must replay, not re-charge.
    cid, did = _client_dog()
    bid, prod = _booking(cid, did), _product(20.00, stock=10)
    key = f"pickup-{uuid.uuid4()}"
    try:
        first = _checkout(bid, retail_lines=_lines(prod), retail_idempotency_key=key)
        sale_id = first["pickup_sale"]["pos_sale_id"]
        # a second attempt on the same key replays the same sale
        second = run(server.pos_domain_services.ring_pickup_merchandise(
            run(server.db.bookings.find_one({"id": bid}, {"_id": 0})),
            server.CheckoutIn(payment_method="cash", retail_lines=_lines(prod), retail_idempotency_key=key),
            ADMIN))
        assert second["pos_sale_id"] == sale_id
        assert float(run(server.db.pos_products.find_one({"id": prod["id"]}, {"_id": 0}))["stock_on_hand"]) == 9.0
        assert len(run(server.db.pos_sales.find({"client_id": cid}, {"_id": 0}).to_list(10))) == 1
    finally:
        _cleanup(cid, [did], [bid], [prod["id"]])


def test_merchandise_belongs_to_one_checkout_not_to_every_dog_in_the_house():
    # A household checkout loops every dog through the same body. Without
    # blanking these, one bag of food would sell once per dog.
    import inspect
    src = inspect.getsource(server.check_out_group)
    assert 'payload["retail_lines"] = []' in src
    assert src.index('payload["retail_lines"] = []') > src.index('if target.get("id") != booking_id:')
