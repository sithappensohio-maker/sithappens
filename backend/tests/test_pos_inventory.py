"""Simple retail stock management — targeted tests.

Black-box HTTP against a live server, same convention as
test_pos_register.py. No barcodes/SKU/UPC involved anywhere — this covers
the plain stock-on-hand system: product CRUD with inventory fields, stock
deduction on a committed sale (never on cart-add/preview/failed/abandoned),
insufficient/out-of-stock blocking, manual adjustments with a required
reason, movement history, low/out-of-stock status fields, deactivated
products, walk-in vs client-linked sales, and void-restores-stock-exactly-once.
"""
import os
import sys
import uuid
import asyncio
from datetime import date, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
TODAY = (date.today() + timedelta(days=10)).isoformat()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r2 = requests.post(f"{API}/admin/register/open-drawer", headers=headers,
                        json={"opening_cash": 0.0}, timeout=15)
    if r2.status_code not in (200, 400):
        r2.raise_for_status()
    return headers


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _make_product(admin_headers, name="Inv Test", price=10.0, category="Test",
                   track_inventory=True, starting_stock=10, low_stock_threshold=None,
                   cost=None, active=True):
    body = {
        "name": f"{name} {uuid.uuid4().hex[:6]}", "price": price, "category": category,
        "track_inventory": track_inventory, "starting_stock": starting_stock, "active": active,
    }
    if low_stock_threshold is not None:
        body["low_stock_threshold"] = low_stock_threshold
    if cost is not None:
        body["cost"] = cost
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_product(admin_headers, product_id):
    r = requests.get(f"{API}/pos/products", headers=admin_headers,
                      params={"include_inactive": True}, timeout=15)
    assert r.status_code == 200, r.text
    return next(p for p in r.json() if p["id"] == product_id)


def _sale_body(product_id, qty=1, tenders=None, client_id=None, key=None):
    return {
        "client_id": client_id,
        "lines": [{"kind": "retail", "product_id": product_id, "qty": qty}],
        "tenders": tenders or [],
        "idempotency_key": key or uuid.uuid4().hex,
    }


def _create_sale(admin_headers, product_id, qty=1, tenders=None, client_id=None, key=None):
    return requests.post(f"{API}/pos/sales", headers=admin_headers,
                          json=_sale_body(product_id, qty, tenders or [], client_id, key), timeout=15)


def _cash_sale(admin_headers, product, qty=1, client_id=None, key=None):
    amount = round(product["price"] * qty, 2)
    return _create_sale(admin_headers, product["id"], qty=qty, client_id=client_id, key=key,
                         tenders=[{"method": "cash", "amount": amount, "tendered_amount": amount}])


# ---------------------------------------------------------------------------
# 1-3. Product CRUD + starting quantity
# ---------------------------------------------------------------------------

def test_create_product(admin_headers):
    p = _make_product(admin_headers, price=29.99, cost=15.0, starting_stock=12, low_stock_threshold=3)
    assert p["price"] == 29.99
    assert p["cost"] == 15.0
    assert p["stock_on_hand"] == 12
    assert p["low_stock_threshold"] == 3
    assert p["track_inventory"] is True
    assert p["active"] is True
    # No barcode/UPC/required SKU anywhere on the response.
    assert p.get("sku") is None


def test_starting_quantity(admin_headers):
    p = _make_product(admin_headers, starting_stock=7)
    assert p["stock_on_hand"] == 7


def test_edit_product_never_touches_stock(admin_headers):
    p = _make_product(admin_headers, price=20.0, starting_stock=15)
    r = requests.put(f"{API}/pos/products/{p['id']}", headers=admin_headers, json={
        "name": p["name"], "price": 25.0, "category": "Renamed", "track_inventory": True, "active": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["price"] == 25.0
    assert updated["category"] == "Renamed"
    # stock_on_hand is untouched by an edit — only sales/voids/adjustments change it.
    fresh = _get_product(admin_headers, p["id"])
    assert fresh["stock_on_hand"] == 15


# ---------------------------------------------------------------------------
# 4-5. Sale decreases stock by the correct amount
# ---------------------------------------------------------------------------

def test_sale_decreases_stock(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    r = _cash_sale(admin_headers, p, qty=1)
    assert r.status_code == 200, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 9


def test_quantity_sale_decreases_correct_amount(admin_headers):
    p = _make_product(admin_headers, starting_stock=12)
    r = _cash_sale(admin_headers, p, qty=2)
    assert r.status_code == 200, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10


# ---------------------------------------------------------------------------
# 6. Failed sale does not decrease stock
# ---------------------------------------------------------------------------

def test_failed_sale_does_not_decrease_stock(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    # Tenders that don't add up to the total -> rejected before any commit.
    r = _create_sale(admin_headers, p["id"], qty=1,
                      tenders=[{"method": "cash", "amount": 1.0, "tendered_amount": 1.0}])
    assert r.status_code == 400, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10


# ---------------------------------------------------------------------------
# 7. Double submission does not deduct twice
# ---------------------------------------------------------------------------

def test_double_submit_same_idempotency_key_deducts_once(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    key = uuid.uuid4().hex
    r1 = _cash_sale(admin_headers, p, qty=1, key=key)
    assert r1.status_code == 200, r1.text
    r2 = _cash_sale(admin_headers, p, qty=1, key=key)
    assert r2.status_code == 200, r2.text
    assert r2.json()["pos_sale_id"] == r1.json()["pos_sale_id"], "a retry must replay, not create a second sale"
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 9


# ---------------------------------------------------------------------------
# 8, 15. Insufficient / out-of-stock blocks the sale
# ---------------------------------------------------------------------------

def test_insufficient_stock_blocks_sale(admin_headers):
    p = _make_product(admin_headers, starting_stock=2)
    r = _cash_sale(admin_headers, p, qty=3)
    assert r.status_code == 400, r.text
    assert "2" in r.json()["detail"]
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 2


def test_out_of_stock_blocks_sale(admin_headers):
    p = _make_product(admin_headers, starting_stock=0)
    r = _cash_sale(admin_headers, p, qty=1)
    assert r.status_code == 400, r.text
    assert "out of stock" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 9. Untracked product sells without stock restriction
# ---------------------------------------------------------------------------

def test_untracked_product_sells_without_stock_restriction(admin_headers):
    p = _make_product(admin_headers, track_inventory=False, starting_stock=0)
    r = _cash_sale(admin_headers, p, qty=50)
    assert r.status_code == 200, r.text
    # Untracked products aren't gated by stock at all — stock_on_hand may exist
    # internally but is never enforced or decremented for this product.
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 0


# ---------------------------------------------------------------------------
# 10-12. Manual stock adjustments
# ---------------------------------------------------------------------------

def test_manual_stock_increase(admin_headers):
    p = _make_product(admin_headers, starting_stock=3)
    r = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                       json={"quantity_delta": 10, "reason": "Shipment received", "source": "RESTOCK"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["stock_on_hand"] == 13
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 13


def test_manual_stock_decrease(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    r = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                       json={"quantity_delta": -1, "reason": "Damaged", "source": "MANUAL_ADJUSTMENT"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["stock_on_hand"] == 9


def test_adjustment_requires_reason(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    r = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                       json={"quantity_delta": 5, "reason": ""}, timeout=15)
    assert r.status_code == 422, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10

    r2 = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                        json={"quantity_delta": 0, "reason": "valid reason"}, timeout=15)
    assert r2.status_code == 422, r2.text  # zero delta is meaningless, rejected


def test_adjustment_blocked_for_untracked_product(admin_headers):
    p = _make_product(admin_headers, track_inventory=False)
    r = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                       json={"quantity_delta": 5, "reason": "should not apply"}, timeout=15)
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 13. Stock movement history
# ---------------------------------------------------------------------------

def test_stock_movement_history_created(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    _cash_sale(admin_headers, p, qty=2)
    requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                  json={"quantity_delta": 5, "reason": "Shipment received", "source": "RESTOCK"}, timeout=15)

    r = requests.get(f"{API}/pos/products/{p['id']}/movements", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    movements = r.json()
    assert len(movements) == 2
    # Newest first.
    assert movements[0]["type"] == "RESTOCK"
    assert movements[0]["quantity_delta"] == 5
    assert movements[0]["stock_before"] == 8 and movements[0]["stock_after"] == 13
    assert movements[1]["type"] == "SALE"
    assert movements[1]["quantity_delta"] == -2
    assert movements[1]["stock_before"] == 10 and movements[1]["stock_after"] == 8
    for m in movements:
        assert m["reason"]
        assert m["created_at"]


# ---------------------------------------------------------------------------
# 14. Low-stock status
# ---------------------------------------------------------------------------

def test_low_stock_status(admin_headers):
    p = _make_product(admin_headers, starting_stock=5, low_stock_threshold=3)
    fresh = _get_product(admin_headers, p["id"])
    assert fresh["stock_on_hand"] > fresh["low_stock_threshold"]  # not low yet

    _cash_sale(admin_headers, p, qty=2)  # 5 -> 3, exactly at threshold
    fresh = _get_product(admin_headers, p["id"])
    assert fresh["stock_on_hand"] <= fresh["low_stock_threshold"]


# ---------------------------------------------------------------------------
# 16. Receiving stock makes an out-of-stock product sellable again
# ---------------------------------------------------------------------------

def test_receiving_stock_makes_product_sellable_again(admin_headers):
    p = _make_product(admin_headers, starting_stock=0)
    blocked = _cash_sale(admin_headers, p, qty=1)
    assert blocked.status_code == 400, blocked.text

    r = requests.post(f"{API}/pos/products/{p['id']}/adjust-stock", headers=admin_headers,
                       json={"quantity_delta": 5, "reason": "Restock", "source": "RESTOCK"}, timeout=15)
    assert r.status_code == 200, r.text

    sale = _cash_sale(admin_headers, p, qty=1)
    assert sale.status_code == 200, sale.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 4


# ---------------------------------------------------------------------------
# 17. Deactivated product unavailable for sale
# ---------------------------------------------------------------------------

def test_deactivated_product_unavailable_for_sale(admin_headers):
    p = _make_product(admin_headers, starting_stock=10, active=True)
    r = requests.put(f"{API}/pos/products/{p['id']}", headers=admin_headers, json={
        "name": p["name"], "price": p["price"], "category": p["category"],
        "track_inventory": True, "active": False,
    }, timeout=15)
    assert r.status_code == 200, r.text

    sale = _cash_sale(admin_headers, p, qty=1)
    assert sale.status_code == 400, sale.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10  # untouched


# ---------------------------------------------------------------------------
# 18-19. Walk-in vs client-linked sale both affect stock normally
# ---------------------------------------------------------------------------

def test_walk_in_sale_affects_stock_normally(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    r = _cash_sale(admin_headers, p, qty=1, client_id=None)
    assert r.status_code == 200, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 9


def test_client_sale_affects_stock_normally(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    c = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Inv Client {uuid.uuid4().hex[:6]}", "email": f"inv-{uuid.uuid4().hex[:8]}@example.com",
    }, timeout=15).json()
    r = _cash_sale(admin_headers, p, qty=1, client_id=c["id"])
    assert r.status_code == 200, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 9


# ---------------------------------------------------------------------------
# Bonus: void restores stock exactly once (§8 of the spec) — not accounting
# ---------------------------------------------------------------------------

def test_void_restores_stock_exactly_once(admin_headers):
    p = _make_product(admin_headers, starting_stock=10)
    sale = _cash_sale(admin_headers, p, qty=2)
    assert sale.status_code == 200, sale.text
    sale_id = sale.json()["pos_sale_id"]
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 8

    r = requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                       json={"reason": "customer changed mind", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 200, r.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10

    # A second void attempt must be rejected and must not double-restore.
    r2 = requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                        json={"reason": "second attempt", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert r2.status_code == 409, r2.text
    assert _get_product(admin_headers, p["id"])["stock_on_hand"] == 10


def test_void_does_not_write_a_second_payment_or_revenue_row(admin_headers):
    """Inventory movements are not money — a void's stock restoration must
    not create any extra Payment/retail_sales/expense/invoice row beyond the
    one offsetting retail_sales row void_pos_sale already writes."""
    p = _make_product(admin_headers, starting_stock=5)
    sale = _cash_sale(admin_headers, p, qty=1)
    sale_id = sale.json()["pos_sale_id"]

    async def _count_retail_rows(db):
        return await db.retail_sales.count_documents({"pos_sale_id": sale_id})
    before = _mongo_run(_count_retail_rows)
    assert before == 1

    requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                  json={"reason": "test", "idempotency_key": uuid.uuid4().hex}, timeout=15)

    after = _mongo_run(_count_retail_rows)
    assert after == 2  # original + exactly one offsetting void row, nothing from the stock restoration
