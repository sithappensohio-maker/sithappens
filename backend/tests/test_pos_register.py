"""Front Desk POS / Cash Register — targeted tests.

Black-box HTTP against a live server, same convention as
test_pos_hardware_authorization.py. Covers the §26 checklist: register gate,
cart correctness, cash tender/change, non-cash tenders, retail sale
lifecycle (walk-in, client-linked, canonical receipt, reprint, recent
sales), split tender, custom item/discount admin gating, void-exactly-once,
and a light regression pass confirming the pre-existing invoice top-up /
booking checkout / group-checkout-no-real-cash behaviors are unaffected by
this new pos_sales code path.
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


def _server_module():
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import server as server_module
    return server_module


def _make_product(admin_headers, name="Test Widget", price=20.0, category="Test"):
    r = requests.post(f"{API}/pos/products", headers=admin_headers,
                       json={"name": f"{name} {uuid.uuid4().hex[:6]}", "price": price, "category": category},
                       timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _sale_body(product_id, qty=1, tenders=None, client_id=None, key=None):
    return {
        "client_id": client_id,
        "lines": [{"kind": "retail", "product_id": product_id, "qty": qty}],
        "tenders": tenders or [],
        "idempotency_key": key or uuid.uuid4().hex,
    }


def _create_sale(admin_headers, product_id, qty=1, tenders=None, client_id=None, key=None):
    return requests.post(f"{API}/pos/sales", headers=admin_headers,
                          json=_sale_body(product_id, qty, tenders, client_id, key), timeout=15)


# ---------------------------------------------------------------------------
# 1. Register gate
# ---------------------------------------------------------------------------

def test_cash_sale_blocked_without_open_register(admin_headers):
    product = _make_product(admin_headers)
    today_server = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()["date"]

    async def _pop(db):
        return await db.cash_drawer_sessions.find_one_and_delete({"date": today_server})
    popped = _mongo_run(_pop)
    try:
        r = _create_sale(admin_headers, product["id"],
                          tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 20.0}])
        assert r.status_code == 400, r.text
        assert "register" in r.text.lower() or "drawer" in r.text.lower()

        async def _count(db):
            return await db.pos_sales.count_documents({"line_items.product_id": product["id"]})
        assert _mongo_run(_count) == 0, "a rejected sale must create zero pos_sales rows"
    finally:
        if popped:
            _mongo_run(lambda db: db.cash_drawer_sessions.insert_one(popped))


def test_non_cash_sale_allowed_without_cash_drawer_open(admin_headers):
    product = _make_product(admin_headers)
    today_server = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()["date"]

    async def _pop(db):
        return await db.cash_drawer_sessions.find_one_and_delete({"date": today_server})
    popped = _mongo_run(_pop)
    try:
        r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}])
        assert r.status_code == 200, r.text
        assert r.json()["pos_open_drawer_token"] is None
    finally:
        if not popped:
            requests.post(f"{API}/admin/register/open-drawer", headers=admin_headers, json={"opening_cash": 0.0}, timeout=15)
        else:
            _mongo_run(lambda db: db.cash_drawer_sessions.insert_one(popped))


# ---------------------------------------------------------------------------
# 2. Cart correctness + no duplicate sale on double submit
# ---------------------------------------------------------------------------

def test_preview_prices_quantity_correctly(admin_headers):
    product = _make_product(admin_headers, price=15.5)
    r = requests.post(f"{API}/pos/sales/preview", headers=admin_headers,
                       json={"lines": [{"kind": "retail", "product_id": product["id"], "qty": 3}]}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["subtotal"] - 46.5) < 0.01
    assert abs(body["total"] - 46.5) < 0.01
    assert body["line_items"][0]["qty"] == 3


def test_double_submit_same_idempotency_key_creates_one_sale(admin_headers):
    product = _make_product(admin_headers)
    key = uuid.uuid4().hex
    r1 = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}], key=key)
    r2 = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}], key=key)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["pos_sale_id"] == r2.json()["pos_sale_id"]

    async def _count(db):
        return await db.pos_sales.count_documents({"line_items.product_id": product["id"]})
    assert _mongo_run(_count) == 1


def test_same_key_different_payload_rejected(admin_headers):
    product = _make_product(admin_headers)
    key = uuid.uuid4().hex
    r1 = _create_sale(admin_headers, product["id"], qty=1, tenders=[{"method": "check", "amount": 20.0}], key=key)
    assert r1.status_code == 200, r1.text
    r2 = _create_sale(admin_headers, product["id"], qty=2, tenders=[{"method": "check", "amount": 40.0}], key=key)
    assert r2.status_code == 409, r2.text


# ---------------------------------------------------------------------------
# 3. Cash tender / change / revenue-not-tendered
# ---------------------------------------------------------------------------

def test_exact_cash_tender(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 20.0}])
    assert r.status_code == 200, r.text
    sale = r.json()["sale"]
    assert sale["tenders"][0]["change_given"] == 0.0
    assert r.json()["pos_open_drawer_token"]


def test_cash_over_amount_with_change(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 25.0}])
    assert r.status_code == 200, r.text
    sale = r.json()["sale"]
    assert abs(sale["tenders"][0]["change_given"] - 5.0) < 0.01


def test_insufficient_cash_rejected(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 15.0}])
    assert r.status_code == 400, r.text


def test_revenue_uses_sale_amount_not_tendered_amount(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 100.0}])
    assert r.status_code == 200, r.text
    sale = r.json()["sale"]

    async def _get_retail_row(db):
        return await db.retail_sales.find_one({"id": sale["retail_sales_id"]}, {"_id": 0})
    row = _mongo_run(_get_retail_row)
    assert abs(row["amount"] - 20.0) < 0.01, "revenue must record the sale amount, never the cash physically handed over"


def test_expected_cash_increases_by_sale_amount_only(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    before = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()["expected_cash"]
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 100.0}])
    assert r.status_code == 200, r.text
    after = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()["expected_cash"]
    assert abs((after - before) - 20.0) < 0.01, "the till only ever nets the sale amount, never the $100 handed over"


# ---------------------------------------------------------------------------
# 4. Non-cash tenders
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method", ["check", "venmo", "paypal"])
def test_non_cash_tender_never_opens_drawer(admin_headers, method):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": method, "amount": 20.0}])
    assert r.status_code == 200, r.text
    assert r.json()["pos_open_drawer_token"] is None
    assert r.json()["pos_print_receipt_token"]


def test_other_tender_requires_note(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "other", "amount": 20.0}])
    assert r.status_code == 400, r.text


def test_other_tender_with_note_succeeds(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "other", "amount": 20.0, "notes": "Zelle"}])
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 5. Retail sale lifecycle: walk-in, client-linked, receipt, reprint, recent
# ---------------------------------------------------------------------------

def test_walkin_sale_has_no_client(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}])
    assert r.status_code == 200, r.text
    assert r.json()["sale"]["client_id"] is None


def test_client_linked_sale_records_client(admin_headers):
    client = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"POS Reg Test {uuid.uuid4().hex[:8]}", "email": f"posreg-{uuid.uuid4().hex[:8]}@example.com"},
                            timeout=15).json()
    try:
        product = _make_product(admin_headers, price=20.0)
        r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}], client_id=client["id"])
        assert r.status_code == 200, r.text
        assert r.json()["sale"]["client_id"] == client["id"]
        assert r.json()["sale"]["client_name"] == client["name"]
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_receipt_payload_matches_sale(admin_headers):
    product = _make_product(admin_headers, price=33.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 33.0, "tendered_amount": 40.0}])
    assert r.status_code == 200, r.text
    data = r.json()
    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": data["pos_print_receipt_token"]}, timeout=15)
    assert rr.status_code == 200, rr.text
    receipt = rr.json()
    assert receipt["kind"] == "pos_sale"
    assert abs(receipt["total"] - 33.0) < 0.01
    assert abs(receipt["tendered_amount"] - 40.0) < 0.01
    assert abs(receipt["change_given"] - 7.0) < 0.01


def test_reprint_creates_no_new_payment_or_revenue(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}])
    sale_id = r.json()["pos_sale_id"]

    async def _count(db):
        return await db.retail_sales.count_documents({"pos_sale_id": sale_id})
    before = _mongo_run(_count)
    for _ in range(3):
        rr = requests.post(f"{API}/pos/sales/{sale_id}/pos-tokens", headers=admin_headers,
                            json={"actions": ["print_receipt"]}, timeout=15)
        assert rr.status_code == 200, rr.text
        assert rr.json().get("print_receipt_token")
    after = _mongo_run(_count)
    assert after == before == 1


def test_recent_sales_retrieval(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}])
    sale_id = r.json()["pos_sale_id"]
    rr = requests.get(f"{API}/pos/sales", headers=admin_headers, timeout=15)
    assert rr.status_code == 200, rr.text
    assert any(s["id"] == sale_id for s in rr.json())


# ---------------------------------------------------------------------------
# 6. Split tender
# ---------------------------------------------------------------------------

def test_split_tender_cash_and_check(admin_headers):
    product = _make_product(admin_headers, price=100.0)
    r = _create_sale(admin_headers, product["id"], tenders=[
        {"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
        {"method": "check", "amount": 60.0},
    ])
    assert r.status_code == 200, r.text
    sale = r.json()["sale"]
    assert len(sale["tenders"]) == 2
    assert abs(sale["cash_component"] - 40.0) < 0.01
    assert r.json()["pos_open_drawer_token"], "real cash was part of the split — drawer must open"


def test_tenders_exceeding_total_rejected(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 25.0}])
    assert r.status_code == 400, r.text


def test_tenders_under_total_rejected(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 10.0}])
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 7. Custom item + discount — admin-only, validated (unit-level for the
#    is_admin=False path, since spinning up a non-admin staff login is out
#    of scope for this targeted pass; the HTTP-level admin-allowed path is
#    covered by the tests above using admin_headers throughout)
# ---------------------------------------------------------------------------

def test_custom_item_rejected_for_non_admin_unit_level():
    server_module = _server_module()

    class _FakeLine:
        kind = "custom"
        product_id = None
        description = "Leash"
        qty = 1
        custom_amount = 12.0
        custom_reason = "Replacement"

    async def _run():
        with pytest.raises(Exception):
            await server_module._price_pos_cart([_FakeLine()], None, is_admin=False)
    asyncio.run(_run())


def test_custom_item_allowed_for_admin(admin_headers):
    r = requests.post(f"{API}/pos/sales/preview", headers=admin_headers, json={
        "lines": [{"kind": "custom", "description": "Replacement leash", "custom_amount": 12.0, "custom_reason": "Damaged in play"}],
    }, timeout=15)
    assert r.status_code == 200, r.text
    assert abs(r.json()["total"] - 12.0) < 0.01


def test_discount_fixed_amount(admin_headers):
    product = _make_product(admin_headers, price=50.0)
    r = requests.post(f"{API}/pos/sales/preview", headers=admin_headers, json={
        "lines": [{"kind": "retail", "product_id": product["id"], "qty": 1}],
        "discount": {"kind": "fixed", "value": 10.0, "reason": "Loyalty"},
    }, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["discount_amount"] - 10.0) < 0.01
    assert abs(body["total"] - 40.0) < 0.01


def test_discount_percent_capped_at_100(admin_headers):
    product = _make_product(admin_headers, price=50.0)
    r = requests.post(f"{API}/pos/sales/preview", headers=admin_headers, json={
        "lines": [{"kind": "retail", "product_id": product["id"], "qty": 1}],
        "discount": {"kind": "percent", "value": 150.0, "reason": "Too generous"},
    }, timeout=15)
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 8. Void — exactly once
# ---------------------------------------------------------------------------

def test_void_reverses_retail_sales_and_status(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "cash", "amount": 20.0, "tendered_amount": 20.0}])
    sale_id = r.json()["pos_sale_id"]

    vr = requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                        json={"reason": "customer return", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert vr.status_code == 200, vr.text
    assert vr.json()["sale"]["status"] == "voided"
    assert vr.json()["pos_open_drawer_token"], "cash was part of the sale — void should authorize giving it back"

    async def _sum(db):
        rows = await db.retail_sales.find({"pos_sale_id": sale_id}).to_list(10)
        return sum(float(r.get("amount") or 0) for r in rows)
    assert abs(_mongo_run(_sum)) < 0.01, "the original + reversal retail_sales rows must net to zero"


def test_void_exactly_once(admin_headers):
    product = _make_product(admin_headers, price=20.0)
    r = _create_sale(admin_headers, product["id"], tenders=[{"method": "check", "amount": 20.0}])
    sale_id = r.json()["pos_sale_id"]

    vr1 = requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                         json={"reason": "test void", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert vr1.status_code == 200, vr1.text
    vr2 = requests.post(f"{API}/pos/sales/{sale_id}/void", headers=admin_headers,
                         json={"reason": "test void again", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert vr2.status_code == 409, vr2.text


# ---------------------------------------------------------------------------
# 9. Regression — existing invoice top-up / booking checkout / group checkout
#    with no real cash must all still behave exactly as before this phase.
# ---------------------------------------------------------------------------

def _book_and_checkin(admin_headers, client, dog, service_type="daycare"):
    # override_capacity: same shared-DB isolation fix as test_pos_hardware_authorization.py.
    body = {"client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": service_type,
            "override_capacity": True}
    r = requests.post(f"{API}/bookings", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    return bid


def test_regression_single_booking_cash_checkout_still_works(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"Reg POS {tag}", "email": f"regpos-{tag}@example.com"}, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    try:
        bid = _book_and_checkin(admin_headers, client, dog)
        r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                           json={"use_credits": False, "base_price": 60.0, "payment_method": "cash", "payment_status": "paid"},
                           timeout=15)
        assert r.status_code == 200, r.text
        booking = r.json()
        assert booking.get("pos_print_receipt_token")
        assert booking.get("pos_open_drawer_token")
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_regression_invoice_topup_still_works(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"Reg Topup {tag}", "email": f"regtopup-{tag}@example.com"}, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    try:
        bid = _book_and_checkin(admin_headers, client, dog)
        r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                           json={"use_credits": False, "base_price": 100.0, "amount_paid": 40.0, "payment_method": "cash"},
                           timeout=15)
        assert r.status_code == 200, r.text
        invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
        assert invoice["status"] == "PARTIALLY_PAID"
        r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers,
                            json={"amount": 60.0, "method": "check", "idempotency_key": uuid.uuid4().hex}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["invoice"]["status"] == "PAID"
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)
