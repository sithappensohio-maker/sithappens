"""Gap-closing tests for the basic receipt system (Phase 2 checkpoint follow-up):

1. Settings -> Receipts -> "Automatically email receipts" / "Automatically
   print receipts" must actually be honored after every applicable
   successful transaction (booking/service checkout, POS sale, client Shop
   purchase, prepaid-visit/credit-pack purchase, payment on an invoice or
   account) — not merely stored. A delivery failure (or the setting being
   off) must never affect the transaction that already succeeded.

2. An authenticated client can View/Print(email-print)/Email their OWN
   receipts from the client Payments area (PortalInvoices -> /receipts/{kind}
   /{ref_id} and .../email), and only their own — never another client's,
   never a staff-only action.

Black-box HTTP against a live server, same convention as
test_receipt_settings.py / test_shop_checkout.py.
"""
import os
import uuid
import time
import json
import hmac
import hashlib
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
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]
TODAY = (date.today() + timedelta(days=12)).isoformat()

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
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json=DEFAULT_SETTINGS, timeout=15)
    yield
    requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json=DEFAULT_SETTINGS, timeout=15)


def _set_receipt_settings(admin_headers, **kwargs):
    r = requests.put(f"{API}/admin/receipt-settings", headers=admin_headers, json=kwargs, timeout=15)
    assert r.status_code == 200, r.text


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _wait_for_outbox(key, timeout=5.0):
    """Auto-email is fire-and-forget (asyncio.create_task) so the HTTP
    response can return before the outbox write lands — poll briefly rather
    than asserting immediately."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = _mongo_run(lambda db: db.email_outbox.find_one({"_id": key}, {"_id": 0}))
        if row:
            return row
        time.sleep(0.15)
    return None


def _assert_no_outbox(key, settle=1.0):
    time.sleep(settle)
    row = _mongo_run(lambda db: db.email_outbox.find_one({"_id": key}, {"_id": 0}))
    assert row is None, f"expected no outbox row for {key}, found {row}"


def _make_client_and_dog(admin_headers, tag, email=True):
    payload = {"name": f"AutoReceipt Test {tag}"}
    if email:
        payload["email"] = f"auto-receipt-{tag}@example.com"
    client = requests.post(f"{API}/clients", headers=admin_headers, json=payload, timeout=15).json()
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


def _checkout_invoice(admin_headers, client, dog, date_=None):
    booking = requests.post(f"{API}/bookings", headers=admin_headers, json={
        "client_id": client["id"], "dog_id": dog["id"], "date": date_ or TODAY, "service_type": "daycare",
        "override_capacity": True,
    }, timeout=15).json()
    bid = booking["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers, json={
        "payment_method": "cash", "payment_status": "paid", "amount_paid": 40.0, "tendered_amount": 40.0,
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    return bid, invoice, data


def _make_product(admin_headers, price=20.0):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"AutoReceipt Widget {uuid.uuid4().hex[:6]}", "price": price,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_pos_sale(admin_headers, product, client_id=None, tenders=None):
    r = requests.post(f"{API}/pos/sales", headers=admin_headers, json={
        "client_id": client_id, "lines": [{"kind": "retail", "product_id": product["id"], "qty": 1}],
        "tenders": tenders or [{"method": "check", "amount": product["price"]}],
        "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_credit_pack(admin_headers, price=50.0, qty=5):
    r = requests.post(f"{API}/credit-packs", headers=admin_headers, json={
        "name": f"AutoReceipt Pack {uuid.uuid4().hex[:6]}", "qty": qty, "price": price, "service_type": "daycare",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Shop-order webhook helpers (mirrors test_shop_checkout.py exactly)
# ---------------------------------------------------------------------------

def _make_online_product(admin_headers, tag, price=20.0):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"AutoReceipt Shop Product {tag}", "price": price, "active": True, "show_online": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_line(kind, ref_id, name, unit_price, qty):
    item_id = str(uuid.uuid4())
    line_subtotal = round(unit_price * qty, 2)
    return {
        "item_id": item_id, "kind": kind, "ref_id": ref_id, "name": name,
        "unit_price": unit_price, "quantity": qty, "line_subtotal": line_subtotal,
        "allocated_tax": 0.0, "line_total": line_subtotal, "fulfillment_status": "pending",
    }


def _seed_shop_order(client_id, client_name, lines):
    order_id = str(uuid.uuid4())
    subtotal = round(sum(l["line_subtotal"] for l in lines), 2)
    ts = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": order_id, "client_id": client_id, "client_name": client_name,
        "status": "pending_payment", "fulfillment_status": "pending", "pickup_status": None,
        "lines": lines, "subtotal": subtotal, "tax_amount": 0.0, "tax_rate_pct": 0.0,
        "total": subtotal, "currency": "USD",
        "stripe_active_attempt_id": None, "stripe_reserved_amount_cents": None,
        "shop_last_applied_attempt_id": None, "created_at": ts, "updated_at": ts,
    }

    async def _seed(db):
        await db.shop_orders.insert_one(doc)
    _mongo_run(_seed)
    return order_id, doc


def _seed_pending_shop_attempt(order_id, client_id, amount):
    attempt_id = str(uuid.uuid4())
    session_id = f"cs_test_{uuid.uuid4().hex}"
    amount_cents = int(round(amount * 100))
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.shop_payment_attempts.insert_one({
            "id": attempt_id, "idempotency_key": str(uuid.uuid4()), "request_fingerprint": "test",
            "shop_order_id": order_id, "client_id": client_id, "amount_cents": amount_cents,
            "status": "pending", "stripe_checkout_session_id": session_id,
            "stripe_checkout_session_url": f"https://checkout.stripe.com/test/{session_id}",
            "stripe_payment_intent_id": None, "stripe_customer_id": "cus_test_fake",
            "card_brand": None, "card_last4": None, "applied_payment_id": None,
            "created_at": ts, "updated_at": ts,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        })
        await db.shop_orders.update_one({"id": order_id}, {"$set": {
            "stripe_active_attempt_id": attempt_id, "stripe_reserved_amount_cents": amount_cents,
        }})
    _mongo_run(_seed)
    return attempt_id, session_id


def _sign_stripe_body(body_dict):
    payload = json.dumps(body_dict)
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload}"
    signature = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    return payload.encode(), f"t={timestamp},v1={signature}"


def _post_stripe_webhook(event_type, obj):
    body_dict = {"id": f"evt_{uuid.uuid4().hex}", "object": "event", "type": event_type, "data": {"object": obj}}
    payload_bytes, sig_header = _sign_stripe_body(body_dict)
    return requests.post(
        f"{API}/webhooks/stripe", data=payload_bytes,
        headers={"Content-Type": "application/json", "Stripe-Signature": sig_header}, timeout=15,
    )


def _pay_shop_order_via_webhook(order_id, client_id, amount):
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, client_id, amount)
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "payment_intent": f"pi_test_{uuid.uuid4().hex[:10]}",
        "currency": "usd", "amount_total": int(round(amount * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": client_id},
    })
    assert r.status_code == 200, r.text


# ===========================================================================
# GAP 1 — auto-email actually fires (or doesn't) per Settings -> Receipts
# ===========================================================================

def test_auto_email_off_by_default_on_booking_checkout(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    _assert_no_outbox(f"auto-receipt:invoice:{invoice['id']}")


def test_auto_email_fires_on_booking_checkout(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    row = _wait_for_outbox(f"auto-receipt:invoice:{invoice['id']}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_fires_on_pos_sale_with_client(admin_headers, fresh_client_and_dog):
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    product = _make_product(admin_headers)
    sale = _create_pos_sale(admin_headers, product, client_id=client["id"])
    row = _wait_for_outbox(f"auto-receipt:pos_sale:{sale['pos_sale_id']}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_skipped_on_walkin_pos_sale(admin_headers):
    """No client on the sale means no one to email — must never error, and
    the sale itself must still succeed."""
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    product = _make_product(admin_headers)
    sale = _create_pos_sale(admin_headers, product, client_id=None)
    assert sale["ok"] is True
    _assert_no_outbox(f"auto-receipt:pos_sale:{sale['pos_sale_id']}")


def test_auto_email_fires_on_tab_payment(admin_headers, fresh_client_and_dog):
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    r = requests.post(f"{API}/clients/{client['id']}/payment", headers=admin_headers, json={
        "amount": 25.0, "method": "check", "notes": "auto-email test",
    }, timeout=15)
    assert r.status_code == 200, r.text
    ledger_id = r.json()["row"]["id"]
    row = _wait_for_outbox(f"auto-receipt:tab_payment:{ledger_id}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_fires_on_invoice_topup_payment(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    # Deliberately underpay at checkout (partial) so the invoice is left
    # with a real balance to top up — auto-email is OFF for this checkout
    # itself so it doesn't pre-empt the attempt_key this test checks.
    booking = requests.post(f"{API}/bookings", headers=admin_headers, json={
        "client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": "daycare",
        "override_capacity": True,
    }, timeout=15).json()
    bid = booking["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers, json={
        "payment_method": "cash", "payment_status": "paid_partial", "amount_paid": 1.0, "tendered_amount": 1.0,
    }, timeout=15)
    assert r.status_code == 200, r.text
    invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    if not invoice or float(invoice.get("balance") or 0) <= 0.005:
        pytest.skip("checkout invoice left no balance in this environment — cannot exercise the top-up path")

    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": min(5.0, invoice["balance"]), "method": "check",
        "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 200, r2.text
    payment_id = r2.json()["payment"]["id"]
    # Keyed by payment_id, NOT bare invoice_id — an invoice can receive
    # several distinct top-up payments over its life, each a real separate
    # event deserving its own receipt (see the dedicated test below proving
    # this doesn't collide with the checkout's own invoice-level claim).
    row = _wait_for_outbox(f"auto-receipt:invoice:invoice_payment:{payment_id}")
    assert row is not None


def test_invoice_topup_email_not_blocked_by_earlier_checkout_email_claim(admin_headers, fresh_client_and_dog):
    """A top-up payment on an invoice that ALREADY auto-emailed at checkout
    time is a genuinely separate event — it must still get its own receipt
    email. If the dedup claim were keyed by bare invoice_id, the checkout's
    own claim would permanently block every later payment on that invoice
    from ever notifying the client again."""
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    booking = requests.post(f"{API}/bookings", headers=admin_headers, json={
        "client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": "daycare",
        "override_capacity": True,
    }, timeout=15).json()
    bid = booking["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers, json={
        "payment_method": "cash", "payment_status": "paid_partial", "amount_paid": 1.0, "tendered_amount": 1.0,
    }, timeout=15)
    assert r.status_code == 200, r.text
    invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    if not invoice or float(invoice.get("balance") or 0) <= 0.005:
        pytest.skip("checkout invoice left no balance in this environment — cannot exercise the top-up path")

    # Checkout's own auto-email fires and claims "invoice:{invoice_id}".
    row_checkout = _wait_for_outbox(f"auto-receipt:invoice:{invoice['id']}")
    assert row_checkout is not None

    # A later, genuinely separate top-up payment must still get its own email.
    r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": min(5.0, invoice["balance"]), "method": "check",
        "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 200, r2.text
    payment_id = r2.json()["payment"]["id"]
    row_topup = _wait_for_outbox(f"auto-receipt:invoice:invoice_payment:{payment_id}")
    assert row_topup is not None, "the earlier checkout claim must not block this genuinely separate payment's email"


def test_auto_email_claim_survives_outbox_row_deletion_and_blocks_resend(admin_headers, fresh_client_and_dog):
    """The real risk this whole mechanism guards against: email_outbox rows
    are DELETED once fully delivered (see process_email_outbox), so without
    a separate, never-deleted claim, a retried/replayed transaction could
    re-queue (and genuinely re-send) the SAME receipt after the first send
    already completed. Prove the claim persists independently of the outbox
    row's own lifecycle, and that a second claim attempt for the same key is
    structurally impossible (atomic unique _id)."""
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    claim_key = f"invoice:{invoice['id']}"
    row = _wait_for_outbox(f"auto-receipt:invoice:{invoice['id']}")
    assert row is not None

    async def _delete_outbox_row(db):
        await db.email_outbox.delete_one({"_id": f"auto-receipt:invoice:{invoice['id']}"})
    _mongo_run(_delete_outbox_row)

    claim = _mongo_run(lambda db: db.auto_receipt_email_claims.find_one({"_id": claim_key}, {"_id": 0}))
    assert claim is not None, "the claim must survive independently of the outbox row's own delivered/deleted lifecycle"

    async def _try_reclaim(db):
        try:
            await db.auto_receipt_email_claims.insert_one({"_id": claim_key, "kind": "invoice", "ref_id": invoice["id"], "claimed_at": "x"})
            return True
        except Exception:
            return False
    reclaimed = _mongo_run(_try_reclaim)
    assert reclaimed is False, "a second claim for the same key must be structurally impossible"


def test_auto_email_fires_on_single_credit_pack_sale(admin_headers, fresh_client_and_dog):
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    pack = _make_credit_pack(admin_headers)
    r = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=admin_headers, json={
        "pack_id": pack["id"], "payment_method": "check", "amount_paid": pack["price"],
    }, timeout=15)
    assert r.status_code == 200, r.text
    lot = r.json()
    row = _wait_for_outbox(f"auto-receipt:credit_pack:{lot['id']}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_fires_on_bulk_credit_pack_sale(admin_headers, fresh_client_and_dog):
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    pack = _make_credit_pack(admin_headers)
    r = requests.post(f"{API}/clients/{client['id']}/sell-packs", headers=admin_headers, json={
        "items": [{"pack_id": pack["id"], "quantity": 2}], "payment_method": "check",
    }, timeout=15)
    assert r.status_code == 200, r.text
    lots = r.json()["lots"]
    assert len(lots) == 2
    row = _wait_for_outbox(f"auto-receipt:credit_pack_bulk:{lots[0]['id']}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_fires_on_shop_order_payment(admin_headers, fresh_client_and_dog):
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=15.0)
    order_id, order = _seed_shop_order(client["id"], client["name"], [
        _make_line("product", product["id"], product["name"], 15.0, 1),
    ])
    _pay_shop_order_via_webhook(order_id, client["id"], order["total"])
    row = _wait_for_outbox(f"auto-receipt:shop_order:{order_id}")
    assert row is not None
    assert row["to_email"] == client["email"]


def test_auto_email_never_duplicates_on_shop_order_webhook_replay(admin_headers, fresh_client_and_dog):
    """_apply_shop_payment is safe to call repeatedly for the same attempt
    (crash-retry, Front Desk 'Retry Fulfillment') — the auto-email trigger
    must fire exactly once, not once per replay."""
    client, _ = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_email_receipts=True)
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=12.0)
    order_id, order = _seed_shop_order(client["id"], client["name"], [
        _make_line("product", product["id"], product["name"], 12.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, client["id"], order["total"])
    obj = {
        "id": session_id, "payment_status": "paid", "payment_intent": f"pi_test_{uuid.uuid4().hex[:10]}",
        "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": client["id"]},
    }
    r1 = _post_stripe_webhook("checkout.session.completed", obj)
    assert r1.status_code == 200
    row = _wait_for_outbox(f"auto-receipt:shop_order:{order_id}")
    assert row is not None
    first_updated = row.get("updated_at")

    # Replay the same event (Stripe does this routinely) — must not reset
    # the outbox row back to "pending" a second time.
    r2 = _post_stripe_webhook("checkout.session.completed", obj)
    assert r2.status_code == 200
    time.sleep(1.0)
    row_after = _mongo_run(lambda db: db.email_outbox.find_one({"_id": f"auto-receipt:shop_order:{order_id}"}, {"_id": 0}))
    assert row_after is not None
    assert row_after.get("updated_at") == first_updated, "webhook replay must not re-queue/reset the same auto-email"


def test_auto_email_failure_path_never_blocks_checkout(admin_headers):
    """A client with no email on file is the realistic 'delivery can't
    happen' case — the checkout must still fully succeed."""
    client, dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8], email=False)
    try:
        _set_receipt_settings(admin_headers, auto_email_receipts=True)
        bid, invoice, data = _checkout_invoice(admin_headers, client, dog)
        assert invoice is not None
        assert invoice.get("status") in ("PAID", "PARTIALLY_PAID", "OPEN", "DRAFT")
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ===========================================================================
# GAP 1 — auto-print token issuance gated by the same setting
# ===========================================================================

def test_auto_print_off_issues_no_print_token_on_checkout(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_print_receipts=False)
    bid, invoice, data = _checkout_invoice(admin_headers, client, dog)
    assert data.get("pos_print_receipt_token") is None


def test_auto_print_on_issues_print_token_on_checkout(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_print_receipts=True)
    bid, invoice, data = _checkout_invoice(admin_headers, client, dog)
    assert data.get("pos_print_receipt_token") is not None


def test_auto_print_off_issues_no_print_token_on_pos_sale(admin_headers):
    _set_receipt_settings(admin_headers, auto_print_receipts=False)
    product = _make_product(admin_headers)
    sale = _create_pos_sale(admin_headers, product)
    assert sale.get("pos_print_receipt_token") is None


def test_auto_print_on_issues_print_token_on_pos_sale(admin_headers):
    _set_receipt_settings(admin_headers, auto_print_receipts=True)
    product = _make_product(admin_headers)
    sale = _create_pos_sale(admin_headers, product)
    assert sale.get("pos_print_receipt_token") is not None


def test_auto_print_off_still_allows_manual_reissue(admin_headers, fresh_client_and_dog):
    """Turning auto-print off must never strand staff without ANY way to
    print — the manual reissue-token endpoint stays available regardless."""
    client, dog = fresh_client_and_dog
    _set_receipt_settings(admin_headers, auto_print_receipts=False)
    bid, invoice, data = _checkout_invoice(admin_headers, client, dog)
    assert data.get("pos_print_receipt_token") is None
    r = requests.post(f"{API}/invoices/{invoice['id']}/pos-tokens", headers=admin_headers,
                       json={"actions": ["print_receipt"]}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("print_receipt_token")


# ===========================================================================
# GAP 2 — client Payments-area receipt actions (view / email), own only
# ===========================================================================

def test_client_can_view_own_invoice_receipt_from_payments_area(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.get(f"{API}/receipts/invoice/{invoice['id']}", headers=client_hdrs, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "invoice"


def test_client_can_email_own_invoice_receipt_from_payments_area(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=client_hdrs, json={}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    async def _fetch(db):
        return await db.receipt_email_log.find_one({"kind": "invoice", "ref_id": invoice["id"]}, {"_id": 0}, sort=[("sent_at", -1)])
    log_row = _mongo_run(_fetch)
    assert log_row is not None
    assert log_row["to_email"] == client["email"]


def test_client_email_receipt_ignores_arbitrary_to_email_override(admin_headers, fresh_client_and_dog):
    """A client may only ever email their OWN receipt to their OWN address
    on file — never an arbitrary address they type into the request body
    (that would turn this into an open email-relay)."""
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=client_hdrs,
                       json={"to_email": "someone-else@example.com"}, timeout=15)
    assert r.status_code == 200, r.text

    async def _fetch(db):
        return await db.receipt_email_log.find_one({"kind": "invoice", "ref_id": invoice["id"]}, {"_id": 0}, sort=[("sent_at", -1)])
    log_row = _mongo_run(_fetch)
    assert log_row["to_email"] == client["email"]
    assert log_row["to_email"] != "someone-else@example.com"


def test_client_cannot_view_another_clients_invoice_receipt(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    other_client, _ = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        other_hdrs = _client_headers(other_client["id"], other_client["email"])
        r = requests.get(f"{API}/receipts/invoice/{invoice['id']}", headers=other_hdrs, timeout=15)
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_client_cannot_email_another_clients_invoice_receipt(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice, _ = _checkout_invoice(admin_headers, client, dog)
    other_client, _ = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        other_hdrs = _client_headers(other_client["id"], other_client["email"])
        r = requests.post(f"{API}/receipts/invoice/{invoice['id']}/email", headers=other_hdrs, json={}, timeout=15)
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_client_cannot_view_walkin_pos_sale_receipt(admin_headers, fresh_client_and_dog):
    """A walk-in POS sale has no owning client at all — no client should
    ever be able to view or email it (staff-only, ownerless record)."""
    client, _ = fresh_client_and_dog
    product = _make_product(admin_headers)
    sale = _create_pos_sale(admin_headers, product, client_id=None)
    client_hdrs = _client_headers(client["id"], client["email"])
    r = requests.get(f"{API}/receipts/pos_sale/{sale['pos_sale_id']}", headers=client_hdrs, timeout=15)
    assert r.status_code == 403
    r2 = requests.post(f"{API}/receipts/pos_sale/{sale['pos_sale_id']}/email", headers=client_hdrs, json={}, timeout=15)
    assert r2.status_code == 403


def test_client_cannot_pass_arbitrary_to_email_and_bypass_ownership_via_other_kinds(admin_headers, fresh_client_and_dog):
    """Credit-pack and shop-order receipts are reachable through the same
    generic /receipts/{kind}/{ref_id} endpoints — confirm client ownership
    is enforced there too, not just for invoices."""
    client, _ = fresh_client_and_dog
    pack = _make_credit_pack(admin_headers)
    r = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=admin_headers, json={
        "pack_id": pack["id"], "payment_method": "check", "amount_paid": pack["price"],
    }, timeout=15)
    assert r.status_code == 200, r.text
    lot = r.json()

    other_client, _ = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        own_hdrs = _client_headers(client["id"], client["email"])
        r_own = requests.get(f"{API}/receipts/credit_pack/{lot['id']}", headers=own_hdrs, timeout=15)
        assert r_own.status_code == 200, r_own.text

        other_hdrs = _client_headers(other_client["id"], other_client["email"])
        r_other = requests.get(f"{API}/receipts/credit_pack/{lot['id']}", headers=other_hdrs, timeout=15)
        assert r_other.status_code == 403
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)
