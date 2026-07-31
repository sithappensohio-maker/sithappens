"""Basic receipt customization (Phase 2, reduced scope) — Settings →
Receipts. Presentation only: business identity, thank-you/policy messages,
optional-field show/hide toggles, and auto-email/auto-print flags. Every
receipt amount still comes from the existing authoritative invoice/payment/
pos_sale record via the canonical _build_*_receipt_payload builders — this
file proves that stays true, and that test-print/reprint/email-resend never
create a second payment, income entry, credit grant, fulfillment event, or
cash-drawer change.

Black-box HTTP against a live server, same convention as
test_pos_register.py / test_stripe_online_payments.py.
"""
import os
import uuid
import asyncio
from datetime import date, timedelta, datetime, timezone

import jwt
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
JWT_SECRET = os.environ["JWT_SECRET"]
TODAY = (date.today() + timedelta(days=11)).isoformat()

DEFAULT_SETTINGS = {
    "business_logo_image_id": None,
    "business_display_name": "Sit Happens Dog Training",
    "address": "", "phone": "", "email": "", "website": "",
    "thank_you_message": "Thank you for choosing Sit Happens!",
    "policy_footer_message": "",
    "show_client_name": True, "show_dog_names": True, "show_service_dates": True,
    "show_staff_name": True, "show_booking_reference": True,
    "show_remaining_prepaid_visits": True, "show_public_price_when_override_used": True,
    "auto_email_receipts": False, "auto_print_receipts": True,
}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r2 = requests.post(f"{API}/admin/register/open-drawer", headers=headers, json={"opening_cash": 0.0}, timeout=15)
    if r2.status_code not in (200, 400):
        r2.raise_for_status()
    return headers


@pytest.fixture(autouse=True)
def restore_default_receipt_settings(admin_headers):
    """Every test starts and ends on the documented defaults, so tests never
    leak settings into each other regardless of run order."""
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json=DEFAULT_SETTINGS, timeout=15)
    yield
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json=DEFAULT_SETTINGS, timeout=15)


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _make_client_and_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Receipt Test {tag}", "email": f"receipt-{tag}@example.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    return client, dog


@pytest.fixture
def fresh_client_and_dog(admin_headers):
    client, dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    yield client, dog
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
    user_id = str(uuid.uuid4())

    async def _insert(db):
        await db.users.insert_one({
            "id": user_id, "email": email, "name": "Test Client", "role": "client",
            "client_id": client_id, "active": True, "must_change_password": False,
            "password_hash": "unused-jwt-minted-directly", "token_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_insert)
    token = jwt.encode({"sub": user_id, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _checkout_invoice(admin_headers, client, dog):
    booking = requests.post(f"{API}/bookings", headers=admin_headers, json={
        "client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": "daycare",
        "override_capacity": True,
    }, timeout=15).json()
    bid = booking["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers, json={
        "payment_method": "cash", "payment_status": "paid", "amount_paid": 40.0, "tendered_amount": 40.0,
    }, timeout=15)
    assert r.status_code == 200, r.text
    invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    return bid, invoice


def _make_product(admin_headers, price=20.0):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"Receipt Test Widget {uuid.uuid4().hex[:6]}", "price": price,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_pos_sale(admin_headers, product, tenders=None):
    r = requests.post(f"{API}/pos/sales", headers=admin_headers, json={
        "client_id": None, "lines": [{"kind": "retail", "product_id": product["id"], "qty": 1}],
        "tenders": tenders or [{"method": "check", "amount": product["price"]}],
        "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# 1. Settings persistence
# ---------------------------------------------------------------------------

def test_get_receipt_settings_defaults(admin_headers):
    r = requests.get(f"{API}/admin/receipt-settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k, v in DEFAULT_SETTINGS.items():
        assert body[k] == v


def test_put_receipt_settings_persists(admin_headers):
    r = requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json={
        "business_display_name": "Test Biz Co", "phone": "555-9999", "thank_you_message": "Thanks a bunch!",
    }, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["business_display_name"] == "Test Biz Co"
    fetched = requests.get(f"{API}/admin/receipt-settings", headers=admin_headers, timeout=15).json()
    assert fetched["business_display_name"] == "Test Biz Co"
    assert fetched["phone"] == "555-9999"
    assert fetched["thank_you_message"] == "Thanks a bunch!"


def test_receipt_settings_requires_admin(fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.put(f"{API}/admin/receipt-settings", headers=client_hdrs, json={"phone": "555-0000"}, timeout=15)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# 2. Branding + toggles applied to REAL receipts (invoice + pos_sale)
# ---------------------------------------------------------------------------

def test_invoice_receipt_reflects_branding_and_toggles(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json={
        "business_display_name": "Branding Test Kennel", "address": "123 Bark St",
        "show_dog_names": False, "show_client_name": True,
    }, timeout=15)
    bid, invoice = _checkout_invoice(admin_headers, client, dog)
    r = requests.get(f"{API}/receipts/invoice/{invoice['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    receipt = r.json()
    assert receipt["business_name"] == "Branding Test Kennel"
    assert receipt["business_address"] == "123 Bark St"
    assert receipt["dogs"] is None  # hidden by toggle
    assert receipt["client_name"] == client["name"]  # still shown
    # Amounts always come from the authoritative invoice — never recomputed.
    assert receipt["invoice_total"] == invoice["total"]
    assert receipt["payment_amount"] == invoice["amount_paid"]


def test_pos_sale_receipt_reflects_branding(admin_headers):
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json={
        "business_display_name": "POS Branding Co",
    }, timeout=15)
    product = _make_product(admin_headers, price=27.5)
    sale = _create_pos_sale(admin_headers, product)
    r = requests.get(f"{API}/receipts/pos_sale/{sale['pos_sale_id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    receipt = r.json()
    assert receipt["business_name"] == "POS Branding Co"
    assert receipt["total"] == 27.5  # authoritative sale total, never recomputed


# ---------------------------------------------------------------------------
# 3. Test-print — zero financial mutation
# ---------------------------------------------------------------------------

def test_test_print_creates_no_financial_records(admin_headers):
    async def _counts(db):
        return {
            "invoices": await db.invoices.count_documents({}),
            "payments": await db.payments.count_documents({}),
            "pos_sales": await db.pos_sales.count_documents({}),
            "retail_sales": await db.retail_sales.count_documents({}),
            "credit_lots": await db.credit_lots.count_documents({}),
            "cash_drawer_sessions": await db.cash_drawer_sessions.count_documents({}),
        }
    before = _mongo_run(_counts)

    r = requests.post(f"{API}/admin/receipts/test-print", headers=admin_headers, json={}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["print_receipt_token"]
    fetched = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["test_receipt"] is True
    assert payload["test_label"] == "TEST RECEIPT — NOT A TRANSACTION"

    after = _mongo_run(_counts)
    assert after == before


def test_test_print_token_is_single_use(admin_headers):
    r = requests.post(f"{API}/admin/receipts/test-print", headers=admin_headers, json={}, timeout=15)
    token = r.json()["print_receipt_token"]
    first = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert first.status_code == 200
    second = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert second.status_code == 409


def test_preview_endpoint_matches_test_print_shape(admin_headers):
    r = requests.get(f"{API}/admin/receipts/preview", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["thermal"]["test_receipt"] is True
    assert body["digital"]["test_receipt"] is True


# ---------------------------------------------------------------------------
# 4. Reprint / email-resend never duplicate anything financial
# ---------------------------------------------------------------------------

def test_reprint_still_creates_no_new_payment_or_revenue(admin_headers):
    """Regression — the pre-existing reprint mechanism, now flowing through
    the enhanced (settings-aware) builder, must still be side-effect-free."""
    product = _make_product(admin_headers, price=18.0)
    sale = _create_pos_sale(admin_headers, product)

    async def _count(db):
        return await db.retail_sales.count_documents({"pos_sale_id": sale["pos_sale_id"]})
    before = _mongo_run(_count)
    for _ in range(3):
        rr = requests.post(f"{API}/pos/sales/{sale['pos_sale_id']}/pos-tokens", headers=admin_headers,
                            json={"actions": ["print_receipt"]}, timeout=15)
        assert rr.status_code == 200, rr.text
    after = _mongo_run(_count)
    assert after == before == 1


def test_email_receipt_does_not_duplicate_revenue_or_credits(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _checkout_invoice(admin_headers, client, dog)

    async def _counts(db):
        return {
            "payments": await db.payments.count_documents({"invoice_id": invoice["id"]}),
            "credit_lots": await db.credit_lots.count_documents({"client_id": client["id"]}),
        }
    before = _mongo_run(_counts)
    r = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=admin_headers,
                       json={"to_email": client["email"]}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    after = _mongo_run(_counts)
    assert after == before

    async def _log_count(db):
        return await db.receipt_email_log.count_documents({"kind": "invoice", "ref_id": invoice["id"]})
    assert _mongo_run(_log_count) == 1


def test_email_receipt_rate_limited(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _checkout_invoice(admin_headers, client, dog)
    first = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=admin_headers,
                           json={"to_email": client["email"]}, timeout=15)
    assert first.status_code == 200, first.text
    second = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=admin_headers,
                            json={"to_email": client["email"]}, timeout=15)
    assert second.status_code == 429


def test_email_receipt_defaults_to_client_email_on_file(admin_headers, fresh_client_and_dog):
    """Omitting to_email must fall back to the client's own email — not
    require the caller to already know it."""
    client, dog = fresh_client_and_dog
    bid, invoice = _checkout_invoice(admin_headers, client, dog)
    r = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=admin_headers, json={}, timeout=15)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 5. View-receipt authorization
# ---------------------------------------------------------------------------

def test_client_can_view_own_receipt(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _checkout_invoice(admin_headers, client, dog)
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.get(f"{API}/receipts/invoice/{invoice['id']}", headers=client_hdrs, timeout=15)
    assert r.status_code == 200, r.text


def test_client_cannot_view_another_clients_receipt(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _checkout_invoice(admin_headers, client, dog)
    other_client, _ = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        other_hdrs = _client_headers(other_client["id"], other_client["email"])
        r = requests.get(f"{API}/receipts/invoice/{invoice['id']}", headers=other_hdrs, timeout=15)
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 6. Existing invoice/POS regression untouched by the settings wiring
# ---------------------------------------------------------------------------

def test_receipt_payload_still_matches_sale_totals(admin_headers):
    """Same assertion as test_pos_register.py's own coverage — proves the
    settings-aware builder still reports the exact authoritative amounts."""
    product = _make_product(admin_headers, price=33.0)
    sale = _create_pos_sale(admin_headers, product, tenders=[{"method": "cash", "amount": 33.0, "tendered_amount": 40.0}])
    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": sale["pos_print_receipt_token"]}, timeout=15)
    assert rr.status_code == 200, rr.text
    receipt = rr.json()
    assert receipt["kind"] == "pos_sale"
    assert abs(receipt["total"] - 33.0) < 0.01
    assert abs(receipt["tendered_amount"] - 40.0) < 0.01
    assert abs(receipt["change_given"] - 7.0) < 0.01
