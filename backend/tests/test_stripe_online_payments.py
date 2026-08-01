"""Stripe Online Payments (Phase 3A) — targeted tests.

Black-box HTTP against a live server, same convention as
test_invoice_topup_payments.py. This environment DOES have a working
Stripe test-mode secret key (see backend/.env) — tests must never assume
otherwise, since a developer's local key is a real, functional one:

  - Everything that is OUR OWN logic (reservation atomicity, webhook
    signature verification + processing, crash/retry idempotency of every
    Step B write, monotonic refund state, legacy-refund exclusion, no
    register/drawer coupling) is tested for REAL, end-to-end, by directly
    seeding the exact DB state a real Stripe interaction would have left
    behind (a pending attempt + an acquired reservation, or a completed
    Payment row) and then driving it through the real HTTP endpoints and a
    genuinely signature-valid webhook payload (Stripe's HMAC scheme needs
    only a shared secret, not a live API key, to verify correctly).
  - A handful of tests need Stripe's own Session.create/Refund.create call
    to fail deterministically (to test the app's failure-handling path).
    Rather than depending on the environment having (or lacking) a broken
    API key, these tests force a genuine Stripe API error by referencing a
    Stripe resource that cannot exist on this account — a fabricated
    customer id (_force_stripe_customer_conflict) or payment_intent id
    (_seed_stripe_collected_payment) — so the real network call to Stripe
    still happens, and still fails, regardless of key validity.
"""
import os
import sys
import uuid
import json
import time
import hmac
import hashlib
import asyncio
from datetime import date, timedelta, datetime, timezone

import jwt
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
TODAY = (date.today() + timedelta(days=10)).isoformat()

JWT_SECRET = os.environ["JWT_SECRET"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    # This shared test DB's register day may already be closed by another
    # file that ran first (409), and a byte-fresh day's expected rollover
    # baseline is $0.00 — anything else 400s requiring an override reason.
    opened = requests.post(f"{API}/admin/register/open-drawer", headers=headers,
                            json={"opening_cash": 0.0}, timeout=15)
    if opened.status_code == 409:
        requests.post(f"{API}/admin/register/reopen-day", headers=headers,
                      json={"reason": "test_stripe_online_payments.py setup"}, timeout=15)
        requests.post(f"{API}/admin/register/open-drawer", headers=headers,
                      json={"opening_cash": 0.0}, timeout=15)
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


def _force_stripe_customer_conflict(client_id):
    """Pre-seed a Stripe customer id that cannot exist on our Stripe account,
    so the real stripe.checkout.Session.create call this endpoint makes
    deterministically fails with a genuine Stripe API error — regardless of
    whether the environment's STRIPE_SECRET_KEY happens to be a working
    test-mode key. The endpoint only calls stripe.Customer.create when
    client.stripe_customer_id is unset, so pre-seeding it here skips
    straight to Session.create with a customer reference Stripe will
    reject. Same technique test_stripe_refund_create_failure_no_mutation
    already relies on via its fake payment_intent id."""
    async def _seed(db):
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {"stripe_customer_id": f"cus_test_nonexistent_{uuid.uuid4().hex}"}},
        )
    _mongo_run(_seed)


def _make_client_and_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Stripe Test {tag}", "email": f"stripe-{tag}@example.com",
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


def _book_and_checkin(admin_headers, client, dog, service_type="daycare"):
    body = {"client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": service_type,
            "override_capacity": True}
    r = requests.post(f"{API}/bookings", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    requests.post(f"{API}/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{API}/bookings/{bid}/check-in", headers=admin_headers, json={}, timeout=15)
    return bid


def _get_invoice(admin_headers, booking_id):
    r = requests.get(f"{API}/bookings/{booking_id}/invoice", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_client(admin_headers, client_id):
    r = requests.get(f"{API}/clients/{client_id}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0):
    """AR-backed invoice (checkout partial cash payment posts the remainder
    to payment_ledger/account_balance) — the fixture every AR-path test
    needs. Balance = total - paid."""
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": total,
                             "amount_paid": paid, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    assert invoice["status"] == "PARTIALLY_PAID"
    assert abs(invoice["balance"] - (total - paid)) < 0.01
    return bid, invoice


def _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0):
    """A fully-paid-at-checkout invoice — NOT AR-backed (no ledger/balance
    posting occurs since nothing was ever left owing)."""
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": total,
                             "amount_paid": total, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    return bid, invoice


def _client_headers(client_id, email):
    """Mints a valid client-role JWT directly, bypassing the password/login
    flow entirely — inserts a matching `users` row (token_version defaults
    to 0 server-side when absent, so the minted `ver` claim just needs to
    match that default) then signs with the SAME JWT_SECRET the live server
    process was started with."""
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


def _sign_stripe_body(body_dict):
    payload = json.dumps(body_dict)
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload}"
    signature = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    header = f"t={timestamp},v1={signature}"
    return payload.encode(), header


def _stripe_event(event_type, obj, event_id=None):
    # Real Stripe event payloads always carry a top-level "object": "event"
    # field — stripe-python's own construct_event() inspects it internally
    # (to distinguish v1 vs v2 event shapes) before ever reaching our code,
    # so a hand-built payload missing it fails inside the SDK itself.
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex}",
        "object": "event",
        "type": event_type,
        "data": {"object": obj},
    }


def _post_stripe_webhook(event_type, obj, event_id=None, bad_signature=False):
    body_dict = _stripe_event(event_type, obj, event_id)
    payload_bytes, sig_header = _sign_stripe_body(body_dict)
    if bad_signature:
        sig_header = "t=1,v1=deadbeef"
    return requests.post(
        f"{API}/webhooks/stripe", data=payload_bytes,
        headers={"Content-Type": "application/json", "Stripe-Signature": sig_header}, timeout=15,
    )


def _seed_pending_attempt(invoice_id, client_id, amount, session_id=None):
    """Simulates the exact DB state immediately after a real
    POST /portal/invoices/{id}/stripe-checkout-session call would have left
    behind — an attempt row + an acquired Invoice-pointer reservation —
    without needing a real Stripe API call to get there."""
    attempt_id = str(uuid.uuid4())
    session_id = session_id or f"cs_test_{uuid.uuid4().hex}"
    amount_cents = int(round(amount * 100))
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.stripe_payment_attempts.insert_one({
            "id": attempt_id, "idempotency_key": str(uuid.uuid4()), "request_fingerprint": "test",
            "invoice_id": invoice_id, "client_id": client_id, "amount_cents": amount_cents,
            "status": "pending", "stripe_checkout_session_id": session_id,
            "stripe_checkout_session_url": f"https://checkout.stripe.com/test/{session_id}",
            "stripe_payment_intent_id": None, "stripe_customer_id": "cus_test_fake",
            "card_brand": None, "card_last4": None, "applied_payment_id": None,
            "created_at": ts, "updated_at": ts,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        })
        await db.invoices.update_one(
            {"id": invoice_id},
            {"$set": {"stripe_active_attempt_id": attempt_id, "stripe_reserved_amount_cents": amount_cents}},
        )
    _mongo_run(_seed)
    return attempt_id, session_id


def _get_attempt(attempt_id):
    async def _fetch(db):
        return await db.stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _get_invoice_raw(invoice_id):
    async def _fetch(db):
        return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _count_ledger_rows(attempt_id):
    async def _fetch(db):
        return await db.payment_ledger.count_documents({"stripe_attempt_id": attempt_id})
    return _mongo_run(_fetch)


def _count_retail_rows_for_payment(payment_id):
    async def _fetch(db):
        return await db.retail_sales.count_documents({"payment_id": payment_id})
    return _mongo_run(_fetch)


def _seed_stripe_collected_payment(invoice_id, client_id, amount, bump_invoice=True,
                                    card_brand=None, card_last4=None):
    """Simulates a Payment row exactly as _apply_stripe_payment would have
    written it, for tests that only need "a Stripe payment already
    happened" as a precondition (legacy-refund exclusion tests)."""
    payment_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.payments.insert_one({
            "id": payment_id, "invoice_id": invoice_id, "client_id": client_id,
            "amount": amount, "method": "stripe_online", "is_credit": False, "date": date.today().isoformat(),
            "employee_id": None, "employee_name": None, "processor": "stripe",
            "processor_payment_id": f"pi_test_{uuid.uuid4().hex[:12]}", "status": "completed",
            "notes": "", "refunded_amount": 0.0,
            "source": {"kind": "stripe_online_payment", "stripe_attempt_id": str(uuid.uuid4()),
                       "stripe_payment_intent_id": f"pi_test_{uuid.uuid4().hex[:12]}",
                       "card_brand": card_brand, "card_last4": card_last4},
            "booking_id": None, "ledger_id": None, "idempotency_ref": f"test:{payment_id}",
            "created_at": ts, "updated_at": ts,
        })
        if bump_invoice:
            await db.invoices.update_one({"id": invoice_id}, {"$inc": {"amount_paid": amount, "balance": -amount}})
    _mongo_run(_seed)
    return payment_id


# ---------------------------------------------------------------------------
# 1. Client portal — ownership, listing
# ---------------------------------------------------------------------------

def test_portal_invoices_requires_client_role(admin_headers):
    r = requests.get(f"{API}/portal/invoices", headers=admin_headers, timeout=15)
    assert r.status_code == 403, r.text


def test_portal_invoices_lists_only_own_invoices(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    headers = _client_headers(client["id"], client["email"])
    r = requests.get(f"{API}/portal/invoices", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert any(i["id"] == invoice["id"] for i in data["invoices"])
    assert "stripe_online_enabled" in data

    other_client, other_dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        other_headers = _client_headers(other_client["id"], other_client["email"])
        r2 = requests.get(f"{API}/portal/invoices", headers=other_headers, timeout=15)
        assert r2.status_code == 200
        assert not any(i["id"] == invoice["id"] for i in r2.json()["invoices"])
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_checkout_session_ownership_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    other_client, _ = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    try:
        other_headers = _client_headers(other_client["id"], other_client["email"])
        r = requests.post(f"{API}/portal/invoices/{invoice['id']}/stripe-checkout-session",
                           headers=other_headers, json={"idempotency_key": uuid.uuid4().hex}, timeout=15)
        assert r.status_code == 404, r.text
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_checkout_session_overpayment_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    headers = _client_headers(client["id"], client["email"])
    r = requests.post(f"{API}/portal/invoices/{invoice['id']}/stripe-checkout-session",
                       headers=headers, json={"amount": 500.0, "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert r.status_code == 400, r.text
    fresh = _get_invoice_raw(invoice["id"])
    assert fresh.get("stripe_active_attempt_id") is None  # zero mutation


# ---------------------------------------------------------------------------
# 2. Stripe session creation — real network call with an intentionally
#    invalid test key. Exercises reservation-acquire-then-release-on-
#    failure for real, and the resulting duplicate-request replay logic.
# ---------------------------------------------------------------------------

def test_checkout_session_creation_failure_releases_reservation(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    _force_stripe_customer_conflict(client["id"])
    headers = _client_headers(client["id"], client["email"])
    key = uuid.uuid4().hex
    r = requests.post(f"{API}/portal/invoices/{invoice['id']}/stripe-checkout-session",
                       headers=headers, json={"idempotency_key": key}, timeout=20)
    assert r.status_code == 502, r.text  # deliberately-nonexistent Stripe customer id -> real Stripe error

    fresh = _get_invoice_raw(invoice["id"])
    assert fresh.get("stripe_active_attempt_id") is None, "reservation must be released after a session-creation failure"

    async def _fetch_attempt(db):
        return await db.stripe_payment_attempts.find_one({"idempotency_key": key}, {"_id": 0})
    attempt = _mongo_run(_fetch_attempt)
    assert attempt["status"] == "failed"

    # Duplicate request, same key -> already resolved, not a silent retry into a new Stripe call.
    r2 = requests.post(f"{API}/portal/invoices/{invoice['id']}/stripe-checkout-session",
                        headers=headers, json={"idempotency_key": key}, timeout=20)
    assert r2.status_code == 409, r2.text


# ---------------------------------------------------------------------------
# 3. Atomic Stripe-vs-cash race protection (the Invoice-pointer filter)
# ---------------------------------------------------------------------------

def test_atomic_stripe_reservation_blocks_manual_payment(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, _ = _seed_pending_attempt(invoice["id"], client["id"], 125.0)

    r = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 409, r.text
    assert "stripe" in r.text.lower() or "online" in r.text.lower()

    fresh = _get_invoice_raw(invoice["id"])
    assert abs(fresh["balance"] - 125.0) < 0.01, "manual payment must not have been applied"
    assert fresh.get("stripe_active_attempt_id") == attempt_id, "reservation must remain untouched"


def test_manual_payment_succeeds_with_no_reservation(admin_headers, fresh_client_and_dog):
    """Baseline non-regression — normal cash top-up still works when no
    Stripe reservation exists at all."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 4. Webhook signature verification
# ---------------------------------------------------------------------------

def test_webhook_invalid_signature_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    r = _post_stripe_webhook("checkout.session.completed",
                             {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_x"},
                             bad_signature=True)
    assert r.status_code == 400, r.text
    assert _get_attempt(attempt_id)["status"] == "pending"  # untouched


# ---------------------------------------------------------------------------
# 5. Successful application — AR-backed, all Step B writes, exactly once
# ---------------------------------------------------------------------------

def test_webhook_checkout_completed_applies_payment_ar_backed(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    balance_before = _get_client(admin_headers, client["id"])["account_balance"]
    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)

    r = _post_stripe_webhook("checkout.session.completed",
                              {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_ar1"})
    assert r.status_code == 200, r.text

    fresh_invoice = _get_invoice_raw(invoice["id"])
    assert fresh_invoice["balance"] <= 0.01
    assert abs(fresh_invoice["amount_paid"] - 200.0) < 0.01
    assert fresh_invoice["status"] == "PAID"
    assert fresh_invoice.get("stripe_active_attempt_id") is None, "reservation must be released only after full apply"
    assert fresh_invoice.get("stripe_last_applied_attempt_id") == attempt_id

    assert _count_ledger_rows(attempt_id) == 1

    client_after = _get_client(admin_headers, client["id"])
    assert abs((balance_before - client_after["account_balance"]) - 125.0) < 0.01
    # stripe_ar_adjustments_applied is deliberately absent from every API
    # response (ClientIn/ClientOut no longer declare it — see the cleanup
    # pass) — read the real underlying value straight from Mongo instead.
    async def _fetch_client(db):
        return await db.clients.find_one({"id": client["id"]}, {"_id": 0})
    client_raw = _mongo_run(_fetch_client)
    assert attempt_id in (client_raw.get("stripe_ar_adjustments_applied") or [])

    attempt = _get_attempt(attempt_id)
    assert attempt["status"] == "applied"
    payment_id = attempt["applied_payment_id"]
    assert payment_id

    payment = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    assert payment["id"] == invoice["id"]

    assert _count_retail_rows_for_payment(payment_id) == 1


def test_webhook_non_ar_backed_leaves_ledger_and_balance_untouched(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    # A fully-paid checkout never posts AR — top up a SEPARATE new invoice
    # balance is impossible without AR, so instead simulate the non-AR case
    # directly: an OPEN invoice whose balance was never posted as AR (this
    # happens for e.g. a brand-new invoice with no prior ledger activity).
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    # Zero out the AR trail directly so _invoice_ar_status reports
    # ar_backed=False, mirroring a non-AR invoice's real signature.
    async def _clear_ledger(db):
        await db.payment_ledger.delete_many({"booking_id": bid})
    _mongo_run(_clear_ledger)
    balance_before = _get_client(admin_headers, client["id"])["account_balance"]

    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    r = _post_stripe_webhook("checkout.session.completed",
                              {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_nonar"})
    assert r.status_code == 200, r.text

    assert _count_ledger_rows(attempt_id) == 0
    client_after = _get_client(admin_headers, client["id"])
    assert abs(client_after["account_balance"] - balance_before) < 0.01, "non-AR-backed apply must never touch account_balance"
    assert _get_attempt(attempt_id)["status"] == "applied"


def test_webhook_duplicate_delivery_does_not_double_apply(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    event_id = f"evt_{uuid.uuid4().hex}"

    r1 = _post_stripe_webhook("checkout.session.completed",
                               {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_dup"},
                               event_id=event_id)
    assert r1.status_code == 200

    invoice_after_1 = _get_invoice_raw(invoice["id"])
    ledger_after_1 = _count_ledger_rows(attempt_id)
    attempt_after_1 = _get_attempt(attempt_id)
    payment_id = attempt_after_1["applied_payment_id"]
    retail_after_1 = _count_retail_rows_for_payment(payment_id)

    # Exact same event_id redelivered (Stripe's own retry behavior).
    r2 = _post_stripe_webhook("checkout.session.completed",
                               {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_dup"},
                               event_id=event_id)
    assert r2.status_code == 200

    invoice_after_2 = _get_invoice_raw(invoice["id"])
    assert invoice_after_2["balance"] == invoice_after_1["balance"]
    assert invoice_after_2["amount_paid"] == invoice_after_1["amount_paid"]
    assert _count_ledger_rows(attempt_id) == ledger_after_1 == 1
    assert _count_retail_rows_for_payment(payment_id) == retail_after_1 == 1

    # A second, DIFFERENT event type for the same already-applied session
    # (simulating an out-of-order/duplicate async event) must also no-op.
    r3 = _post_stripe_webhook("checkout.session.async_payment_succeeded",
                               {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_dup"})
    assert r3.status_code == 200
    assert _get_invoice_raw(invoice["id"])["balance"] == invoice_after_1["balance"]


def test_crash_retry_resumes_after_invoice_mutation_only(admin_headers, fresh_client_and_dog):
    """Simulates a crash immediately after Step A (invoice money mutation)
    but before ANY downstream write — proves retry resumes Step B without
    re-decrementing the invoice."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)

    async def _simulate_step_a_only(db):
        await db.invoices.update_one(
            {"id": invoice["id"]},
            {"$inc": {"amount_paid": 125.0, "balance": -125.0},
             "$set": {"stripe_last_applied_attempt_id": attempt_id}},
        )
    _mongo_run(_simulate_step_a_only)

    r = _post_stripe_webhook("checkout.session.completed",
                              {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_crash"})
    assert r.status_code == 200, r.text

    fresh_invoice = _get_invoice_raw(invoice["id"])
    assert abs(fresh_invoice["amount_paid"] - 200.0) < 0.01, "must NOT have decremented a second time"
    assert fresh_invoice["balance"] <= 0.01
    assert _count_ledger_rows(attempt_id) == 1  # downstream writes still completed exactly once
    assert _get_attempt(attempt_id)["status"] == "applied"


def test_ar_unreconciled_blocks_apply_and_keeps_reservation(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)

    # Manufacture the exact "ambiguous legacy AR" condition _invoice_ar_status
    # checks for: a fully generic, untagged client-level ledger row created
    # AFTER the original charge row.
    async def _make_ambiguous(db):
        charge = await db.payment_ledger.find_one({"booking_id": bid, "type": "charge"})
        await db.payment_ledger.insert_one({
            "id": str(uuid.uuid4()), "client_id": client["id"], "type": "payment", "amount": -1.0,
            "method": "cash", "notes": "legacy untagged row", "booking_id": None, "invoice_id": None,
            "created_by": "test", "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_make_ambiguous)

    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    r = _post_stripe_webhook("checkout.session.completed",
                              {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_unrec"})
    assert r.status_code >= 400  # webhook re-raises so Stripe retries delivery

    attempt = _get_attempt(attempt_id)
    assert attempt["status"] == "reconciliation_required"
    fresh_invoice = _get_invoice_raw(invoice["id"])
    assert fresh_invoice.get("stripe_active_attempt_id") == attempt_id, "reservation must NOT be released while unresolved"

    # And a manual payment must still be blocked while unresolved.
    r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 409, r2.text


# ---------------------------------------------------------------------------
# 6. Checkout session expiry — releases the reservation, never by clock alone
# ---------------------------------------------------------------------------

def test_checkout_session_expired_webhook_releases_reservation(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)

    r = _post_stripe_webhook("checkout.session.expired", {"id": session_id})
    assert r.status_code == 200, r.text
    assert _get_attempt(attempt_id)["status"] == "expired"
    assert _get_invoice_raw(invoice["id"]).get("stripe_active_attempt_id") is None

    # Now a manual payment can proceed.
    r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 200, r2.text


# ---------------------------------------------------------------------------
# 7. No register/drawer coupling
# ---------------------------------------------------------------------------

def test_online_payment_applies_with_register_closed_no_drawer_touch(fresh_client_and_dog):
    # Fresh admin session with NO register opened this call.
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(headers, client, dog, total=200.0, paid=75.0)

    before = _mongo_run(lambda db: db.pos_action_tokens.count_documents({}))

    attempt_id, session_id = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    r2 = _post_stripe_webhook("checkout.session.completed",
                               {"id": session_id, "payment_status": "paid", "payment_intent": "pi_test_noreg"})
    assert r2.status_code == 200, r2.text
    assert _get_attempt(attempt_id)["status"] == "applied"
    after = _mongo_run(lambda db: db.pos_action_tokens.count_documents({}))
    assert after == before, "Stripe online payments must never issue a hardware/drawer token"


# ---------------------------------------------------------------------------
# 8. Legacy booking-refund protection — Stripe dollars permanently excluded
# ---------------------------------------------------------------------------

def test_legacy_refund_excludes_stripe_dollars(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    # bump_invoice=False: this models "the $100 already reflected in
    # invoice.amount_paid was actually collected via Stripe," not an
    # additional $100 on top — so amount_paid must stay exactly 100 for
    # stripe_gross to fully cancel it out (matches
    # test_mixed_cash_stripe_refund_allows_cash_portion's math below, where
    # bump_invoice=True IS correct because that scenario really is a
    # separate top-up on top of a smaller original cash payment).
    _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0, bump_invoice=False)

    r = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 50.0, "payment_method": "cash", "reason": "should be blocked - all stripe money",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 409, r.text


def test_legacy_refund_stripe_gross_not_netted_by_refund(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    # bump_invoice=False — see test_legacy_refund_excludes_stripe_dollars.
    _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0, bump_invoice=False)

    async def _add_reversal(db):
        await db.payments.insert_one({
            "id": str(uuid.uuid4()), "invoice_id": invoice["id"], "client_id": client["id"],
            "amount": -40.0, "method": "stripe_online", "is_credit": False, "date": date.today().isoformat(),
            "status": "completed", "notes": "partial stripe refund", "refunded_amount": 0.0,
            "source": {"kind": "stripe_refund", "stripe_refund_attempt_id": "test"},
            "booking_id": None, "ledger_id": None, "idempotency_ref": f"test:{uuid.uuid4().hex}",
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_add_reversal)

    # Even though $40 of the $100 was already refunded via Stripe, the full
    # $100 must STILL be excluded from the legacy local ceiling.
    r = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 10.0, "payment_method": "cash", "reason": "should still be blocked",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 409, r.text


def test_mixed_cash_stripe_refund_allows_cash_portion(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    # $40 cash at checkout + $60 Stripe top-up = $100 total collected.
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=40.0)
    _seed_stripe_collected_payment(invoice["id"], client["id"], 60.0)
    # Bump the booking's own frozen amount_paid to match the $40 cash portion
    # actually collected at checkout (the ceiling's non-single-booking-invoice
    # fallback reads booking.amount_paid; here it's the single-booking
    # invoice branch that matters, already reflecting cash+stripe combined
    # minus the stripe exclusion computed server-side).
    r = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 40.0, "payment_method": "cash", "reason": "refund the cash-only portion",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 9. Stripe refunds — validation, monotonic finalize, multi-partial, dedup
# ---------------------------------------------------------------------------

def test_stripe_refund_rejected_for_non_stripe_payment(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    payment_id = r.json()["payment"]["id"]
    r2 = requests.post(f"{API}/payments/{payment_id}/stripe-refund", headers=admin_headers, json={
        "amount": 10.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 400, r2.text


def test_stripe_refund_create_failure_no_mutation(admin_headers, fresh_client_and_dog):
    """Real network call with the intentionally-invalid test key — proves
    a failed Stripe API call produces zero local mutation."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0)
    r = requests.post(f"{API}/payments/{payment_id}/stripe-refund", headers=admin_headers, json={
        "amount": 50.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=20)
    assert r.status_code == 502, r.text

    async def _fetch(db):
        p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        return p
    payment = _mongo_run(_fetch)
    assert abs(float(payment.get("refunded_amount") or 0)) < 0.01


def _seed_refund_attempt(payment_id, invoice_id, amount, stripe_refund_id=None):
    refund_attempt_id = str(uuid.uuid4())
    stripe_refund_id = stripe_refund_id or f"re_test_{uuid.uuid4().hex}"
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.stripe_refund_attempts.insert_one({
            "id": refund_attempt_id, "idempotency_key": str(uuid.uuid4()), "request_fingerprint": "test",
            "payment_id": payment_id, "invoice_id": invoice_id, "amount_cents": int(round(amount * 100)),
            "reason": "test refund", "status": "pending", "stripe_refund_id": stripe_refund_id,
            "stripe_payment_intent_id": "pi_test_fake", "applied_refund_payment_id": None,
            "created_at": ts, "updated_at": ts,
        })
    _mongo_run(_seed)
    return refund_attempt_id, stripe_refund_id


def test_refund_webhook_finalizes_exactly_once(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 40.0)

    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    async def _fetch_refund_attempt(db):
        return await db.stripe_refund_attempts.find_one({"id": refund_attempt_id}, {"_id": 0})
    attempt = _mongo_run(_fetch_refund_attempt)
    assert attempt["status"] == "succeeded"
    reversal_payment_id = attempt["applied_refund_payment_id"]
    assert reversal_payment_id

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(float(payment["refunded_amount"]) - 40.0) < 0.01

    # Duplicate delivery — must not create a second reversal or double-count.
    r2 = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r2.status_code == 200
    payment_after = _mongo_run(_fetch_payment)
    assert abs(float(payment_after["refunded_amount"]) - 40.0) < 0.01, "must not double-apply on redelivery"


def test_refund_webhook_out_of_order_never_regresses_succeeded(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 40.0)

    r1 = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r1.status_code == 200

    # A LATE-arriving, logically-earlier "pending" event must never regress it.
    r2 = _post_stripe_webhook("refund.created", {"id": stripe_refund_id, "status": "pending"})
    assert r2.status_code == 200

    async def _fetch(db):
        return await db.stripe_refund_attempts.find_one({"id": refund_attempt_id}, {"_id": 0})
    attempt = _mongo_run(_fetch)
    assert attempt["status"] == "succeeded", "a stale/out-of-order event must never regress a terminal status"


def test_refund_failure_produces_no_mutation(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 40.0)

    r = _post_stripe_webhook("refund.failed", {"id": stripe_refund_id, "status": "failed"})
    assert r.status_code == 200, r.text

    async def _fetch(db):
        return await db.stripe_refund_attempts.find_one({"id": refund_attempt_id}, {"_id": 0})
    attempt = _mongo_run(_fetch)
    assert attempt["status"] == "failed"
    assert attempt["applied_refund_payment_id"] is None

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(float(payment["refunded_amount"] or 0)) < 0.01


def test_multiple_sequential_partial_stripe_refunds(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=200.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 200.0)

    attempt_a, refund_id_a = _seed_refund_attempt(payment_id, invoice["id"], 50.0)
    ra = _post_stripe_webhook("refund.updated", {"id": refund_id_a, "status": "succeeded"})
    assert ra.status_code == 200

    attempt_b, refund_id_b = _seed_refund_attempt(payment_id, invoice["id"], 25.0)
    rb = _post_stripe_webhook("refund.updated", {"id": refund_id_b, "status": "succeeded"})
    assert rb.status_code == 200

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(float(payment["refunded_amount"]) - 75.0) < 0.01, "both partials must accumulate, never overwrite"

    async def _fetch_attempts(db):
        return [
            await db.stripe_refund_attempts.find_one({"id": attempt_a}, {"_id": 0}),
            await db.stripe_refund_attempts.find_one({"id": attempt_b}, {"_id": 0}),
        ]
    a1, a2 = _mongo_run(_fetch_attempts)
    assert a1["applied_refund_payment_id"] != a2["applied_refund_payment_id"], "each partial gets its OWN reversal Payment row"

    async def _fetch_invoice(db):
        return await db.invoices.find_one({"id": invoice["id"]}, {"_id": 0})
    fresh_invoice = _mongo_run(_fetch_invoice)
    assert abs(float(fresh_invoice["refunded_total"]) - 75.0) < 0.01


# ---------------------------------------------------------------------------
# 10. Internal Stripe bookkeeping fields must never reach client-facing
#     responses — regression coverage for the cleanup pass.
# ---------------------------------------------------------------------------

INTERNAL_CLIENT_STRIPE_FIELDS = ("stripe_customer_id", "stripe_ar_adjustments_applied")
INTERNAL_INVOICE_STRIPE_FIELDS = (
    "stripe_active_attempt_id", "stripe_reserved_amount_cents", "stripe_last_applied_attempt_id",
)


def _seed_real_stripe_client_markers(client_id):
    """Simulates a client who has genuinely been through a Stripe payment —
    both internal markers set to real-looking non-empty values — so the
    leak tests below are proving these fields are ACTIVELY stripped, not
    merely absent because nothing ever set them."""
    async def _seed(db):
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {"stripe_customer_id": "cus_test_marker_1234",
                      "stripe_ar_adjustments_applied": ["attempt-marker-1", "attempt-marker-2"]}},
        )
    _mongo_run(_seed)


def test_portal_me_never_exposes_internal_stripe_fields(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    _seed_real_stripe_client_markers(client["id"])
    headers = _client_headers(client["id"], client["email"])

    r = requests.get(f"{API}/portal/me", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()["client"]
    for field in INTERNAL_CLIENT_STRIPE_FIELDS:
        assert field not in body, f"{field} leaked from GET /portal/me"


def test_portal_me_put_never_exposes_or_wipes_internal_stripe_fields(admin_headers, fresh_client_and_dog):
    """Regression for a real bug found during cleanup: because these two
    fields used to live on ClientIn (the admin/portal EDIT input model),
    an ordinary profile save did `db.clients.update_one(..., {"$set":
    body.model_dump()})` — which silently reset stripe_customer_id to None
    and, far more seriously, wiped stripe_ar_adjustments_applied back to
    [], re-opening the idempotency guard _apply_stripe_payment's Step B2
    relies on to guarantee a redelivered webhook can never double-apply an
    AR adjustment. Proves both: the response never shows them, AND the
    underlying Mongo values survive a profile edit completely untouched."""
    client, dog = fresh_client_and_dog
    _seed_real_stripe_client_markers(client["id"])
    headers = _client_headers(client["id"], client["email"])

    r = requests.put(f"{API}/portal/me", headers=headers, json={
        "name": "Updated Via Portal", "phone": "555-0100", "email": client["email"],
        "emerg": "", "address": "",
    }, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()["client"]
    for field in INTERNAL_CLIENT_STRIPE_FIELDS:
        assert field not in body, f"{field} leaked from PUT /portal/me response"

    async def _fetch(db):
        return await db.clients.find_one({"id": client["id"]}, {"_id": 0})
    fresh = _mongo_run(_fetch)
    assert fresh["name"] == "Updated Via Portal"
    assert fresh.get("stripe_customer_id") == "cus_test_marker_1234", \
        "profile edit must never wipe the Stripe Customer mapping"
    assert fresh.get("stripe_ar_adjustments_applied") == ["attempt-marker-1", "attempt-marker-2"], \
        "profile edit must never wipe the AR idempotency marker array"


def test_admin_client_edit_never_wipes_internal_stripe_fields(admin_headers, fresh_client_and_dog):
    """Same regression as above, via the admin-facing PUT /clients/{id}
    edit path (the endpoint the wipe bug actually lived on)."""
    client, dog = fresh_client_and_dog
    _seed_real_stripe_client_markers(client["id"])

    r = requests.put(f"{API}/clients/{client['id']}", headers=admin_headers, json={
        "name": "Admin Edited Name", "phone": "555-0101", "email": client["email"],
    }, timeout=15)
    assert r.status_code == 200, r.text

    async def _fetch(db):
        return await db.clients.find_one({"id": client["id"]}, {"_id": 0})
    fresh = _mongo_run(_fetch)
    assert fresh["name"] == "Admin Edited Name"
    assert fresh.get("stripe_customer_id") == "cus_test_marker_1234", \
        "admin edit must never wipe the Stripe Customer mapping"
    assert fresh.get("stripe_ar_adjustments_applied") == ["attempt-marker-1", "attempt-marker-2"], \
        "admin edit must never wipe the AR idempotency marker array"


def test_portal_invoices_never_expose_internal_stripe_fields(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    attempt_id, _ = _seed_pending_attempt(invoice["id"], client["id"], 125.0)
    headers = _client_headers(client["id"], client["email"])

    r = requests.get(f"{API}/portal/invoices", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()["invoices"]
    matching = [inv for inv in rows if inv["id"] == invoice["id"]]
    assert len(matching) == 1
    for field in INTERNAL_INVOICE_STRIPE_FIELDS:
        assert field not in matching[0], f"{field} leaked from GET /portal/invoices"
    # sanity: the reservation genuinely IS active server-side, proving this
    # is a real positive case and not a vacuous "field never existed" pass.
    async def _fetch_invoice(db):
        return await db.invoices.find_one({"id": invoice["id"]}, {"_id": 0})
    raw_invoice = _mongo_run(_fetch_invoice)
    assert raw_invoice.get("stripe_active_attempt_id") == attempt_id


def test_stripe_publishable_key_not_referenced_in_backend_source():
    """Hosted Checkout only — the backend never needs a publishable key.
    Static source check (no module import/reload, to stay consistent with
    this file's black-box-over-HTTP convention) confirming the dead config
    var was fully removed rather than merely unused-but-present."""
    server_path = os.path.join(os.path.dirname(__file__), "..", "server.py")
    with open(server_path, encoding="utf-8") as f:
        source = f.read()
    assert "STRIPE_PUBLISHABLE_KEY" not in source


# ---------------------------------------------------------------------------
# 11. Regression — synchronous Refund.create(status="succeeded") must still
#     apply the local reversal exactly once. A real live-test-mode round
#     trip caught this: create_stripe_refund used to write status="succeeded"
#     directly BEFORE calling _finalize_stripe_refund, so that function's own
#     atomic monotonic guard ({"status": {"$nin": TERMINAL}}) saw the attempt
#     as already-terminal and no-op'd — Stripe had genuinely refunded the
#     money, but no local Payment/ledger/invoice reversal was ever recorded.
#     A real Refund.create call can't be exercised in this environment (no
#     live test-mode credentials — this suite's own documented limitation),
#     so this imports server.py directly (same precedent as
#     test_invoice_foundation.py::test_create_invoice_helper_raises_on_internal_failure)
#     and monkeypatches stripe.Refund.create in-process to return exactly
#     the synchronous-succeeded shape that triggered the bug.
# ---------------------------------------------------------------------------

def test_stripe_refund_synchronous_success_applies_exactly_once(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=40.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 40.0)

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import server as server_module

    class _FakeStripeRefund:
        def __init__(self, data):
            self._data = data
        def to_dict(self):
            return self._data

    fake_refund_id = f"re_fake_sync_{uuid.uuid4().hex[:12]}"

    def _fake_create(*args, **kwargs):
        return _FakeStripeRefund({"id": fake_refund_id, "status": "succeeded"})

    real_create = server_module.stripe.Refund.create
    real_db = server_module.db
    server_module.stripe.Refund.create = _fake_create

    async def _run():
        # A fresh Motor client, created and closed entirely within THIS
        # asyncio.run()'s own event loop — server_module.db was bound to
        # whichever loop was active at import time, and reusing it across
        # more than one separate asyncio.run() call in this same process
        # breaks motor's internal loop binding ("Event loop is closed").
        fresh_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        server_module.db = fresh_client[os.environ.get("DB_NAME", "sit_happens")]
        try:
            body = server_module.StripeRefundIn(amount=15.0, reason="sync test", idempotency_key=uuid.uuid4().hex)
            return await server_module.create_stripe_refund(payment_id, body, user={})
        finally:
            fresh_client.close()

    try:
        result = asyncio.run(_run())
    finally:
        server_module.stripe.Refund.create = real_create
        server_module.db = real_db

    assert result["ok"] is True
    attempt = result["refund_attempt"]
    assert attempt["status"] == "succeeded"
    assert attempt["applied_refund_payment_id"] is not None, \
        "BUG REGRESSION: synchronous succeeded status must still trigger the local reversal"

    async def _fetch(db):
        reversals = await db.payments.find(
            {"invoice_id": invoice["id"], "source.kind": "stripe_refund"}, {"_id": 0},
        ).to_list(10)
        payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        return reversals, payment
    reversals, payment = _mongo_run(_fetch)
    assert len(reversals) == 1, "exactly one reversal Payment row, not zero and not duplicated"
    assert abs(reversals[0]["amount"] - (-15.0)) < 0.01
    assert abs(payment["refunded_amount"] - 15.0) < 0.01


def test_stripe_refund_synchronous_and_webhook_race_applies_exactly_once(admin_headers, fresh_client_and_dog):
    """Simulates the synchronous succeeded response and a racing
    refund.updated webhook both trying to finalize the SAME attempt at
    once. Exactly one must perform the local reversal; the other must
    observe the already-completed result and do nothing further."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=60.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 60.0)
    refund_attempt_id, _stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 20.0)

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import server as server_module

    real_db = server_module.db

    async def _race():
        # Fresh, loop-scoped Motor client — see the comment in
        # test_stripe_refund_synchronous_success_applies_exactly_once for
        # why server_module.db can't be reused across separate asyncio.run()
        # calls in this same process.
        fresh_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        server_module.db = fresh_client[os.environ.get("DB_NAME", "sit_happens")]
        try:
            await asyncio.gather(
                server_module._finalize_stripe_refund(refund_attempt_id),
                server_module._finalize_stripe_refund(refund_attempt_id),
            )
        finally:
            fresh_client.close()

    try:
        asyncio.run(_race())
    finally:
        server_module.db = real_db

    async def _fetch(db):
        reversals = await db.payments.find(
            {"invoice_id": invoice["id"], "source.kind": "stripe_refund"}, {"_id": 0},
        ).to_list(10)
        payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        attempt = await db.stripe_refund_attempts.find_one({"id": refund_attempt_id}, {"_id": 0})
        return reversals, payment, attempt
    reversals, payment, attempt = _mongo_run(_fetch)
    assert len(reversals) == 1, "concurrent finalize calls must produce exactly ONE reversal, never two"
    assert abs(payment["refunded_amount"] - 20.0) < 0.01
    assert attempt["applied_refund_payment_id"] == reversals[0]["id"]


# ---------------------------------------------------------------------------
# 12. Front Desk "Online Payments" read endpoint — GET /admin/stripe-online-payments
# ---------------------------------------------------------------------------

def test_online_payments_lists_stripe_payment_with_safe_fields(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=75.0)
    payment_id = _seed_stripe_collected_payment(
        invoice["id"], client["id"], 75.0, card_brand="visa", card_last4="4242",
    )
    r = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers,
                      params={"q": client["name"]}, timeout=15)
    assert r.status_code == 200, r.text
    rows = [p for p in r.json()["payments"] if p["payment_id"] == payment_id]
    assert len(rows) == 1
    row = rows[0]
    assert row["invoice_id"] == invoice["id"]
    assert row["client_name"] == client["name"]
    assert abs(row["amount"] - 75.0) < 0.01
    assert abs(row["refunded_amount"] - 0.0) < 0.01
    assert abs(row["remaining_refundable"] - 75.0) < 0.01
    assert row["card_brand"] == "visa"
    assert row["card_last4"] == "4242"
    assert row["refund_in_progress"] is False
    assert row["refund_status"] is None
    # Safe-fields contract — no PaymentIntent id, no Stripe secret/webhook
    # data, no raw stripe_refund_attempts document anywhere in the row.
    assert "stripe_payment_intent_id" not in row
    assert "processor_payment_id" not in row
    assert "source" not in row
    assert "idempotency_ref" not in row


def test_online_payments_excludes_non_stripe_methods(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 125.0, "method": "cash", "tendered_amount": 125.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    cash_payment_id = r.json()["payment"]["id"]
    r2 = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
    assert r2.status_code == 200, r2.text
    ids = {p["payment_id"] for p in r2.json()["payments"]}
    assert cash_payment_id not in ids


def test_online_payments_excludes_refund_reversal_rows(admin_headers, fresh_client_and_dog):
    """A stripe_refund reversal row (source.kind=="stripe_refund", negative
    amount) must never be listed as if it were a separate original payment —
    same exclusion convention _booking_refund_locked already uses."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=60.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 60.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 20.0)
    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    r2 = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
    assert r2.status_code == 200, r2.text
    rows = [p for p in r2.json()["payments"] if p["invoice_id"] == invoice["id"]]
    # Exactly the original payment — never a second row for the reversal.
    assert len(rows) == 1
    assert rows[0]["payment_id"] == payment_id
    assert abs(rows[0]["refunded_amount"] - 20.0) < 0.01
    assert abs(rows[0]["remaining_refundable"] - 40.0) < 0.01


def test_online_payments_refund_in_progress_while_attempt_pending(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=50.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 50.0)
    _seed_refund_attempt(payment_id, invoice["id"], 15.0)  # defaults to status="pending"

    r = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    row = next(p for p in r.json()["payments"] if p["payment_id"] == payment_id)
    assert row["refund_in_progress"] is True
    assert row["refund_status"] == "pending"
    # Nothing refunded yet — the local reversal only applies once Stripe
    # actually reports "succeeded".
    assert abs(row["refunded_amount"] - 0.0) < 0.01
    assert abs(row["remaining_refundable"] - 50.0) < 0.01


def test_online_payments_refund_in_progress_clears_once_succeeded(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=50.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 50.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 15.0)

    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    r2 = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
    row = next(p for p in r2.json()["payments"] if p["payment_id"] == payment_id)
    assert row["refund_in_progress"] is False
    assert row["refund_status"] is None
    assert abs(row["refunded_amount"] - 15.0) < 0.01
    assert abs(row["remaining_refundable"] - 35.0) < 0.01


def test_online_payments_multiple_sequential_partial_refunds(admin_headers, fresh_client_and_dog):
    """Original $100, refund #1 $25 (remaining $75), later refund #2 $10
    (remaining $65) — the read endpoint must reflect canonical
    Payment.refunded_amount after EACH refund, never a locally-summed
    refund history."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=100.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 100.0)

    _refund_attempt_id_1, stripe_refund_id_1 = _seed_refund_attempt(payment_id, invoice["id"], 25.0)
    assert _post_stripe_webhook("refund.updated", {"id": stripe_refund_id_1, "status": "succeeded"}).status_code == 200
    row = next(p for p in requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
               .json()["payments"] if p["payment_id"] == payment_id)
    assert abs(row["refunded_amount"] - 25.0) < 0.01
    assert abs(row["remaining_refundable"] - 75.0) < 0.01

    _refund_attempt_id_2, stripe_refund_id_2 = _seed_refund_attempt(payment_id, invoice["id"], 10.0)
    assert _post_stripe_webhook("refund.updated", {"id": stripe_refund_id_2, "status": "succeeded"}).status_code == 200
    row2 = next(p for p in requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
                .json()["payments"] if p["payment_id"] == payment_id)
    assert abs(row2["refunded_amount"] - 35.0) < 0.01
    assert abs(row2["remaining_refundable"] - 65.0) < 0.01


def test_online_payments_limit_param_respected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=10.0)
    _seed_stripe_collected_payment(invoice["id"], client["id"], 10.0)
    r = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers,
                      params={"limit": 1}, timeout=15)
    assert r.status_code == 200, r.text
    assert len(r.json()["payments"]) <= 1


def test_online_payments_requires_admin(fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    r = requests.get(f"{API}/admin/stripe-online-payments", timeout=15)
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 13. Generic Stripe-refund retail_sales reversal + crash-resumable
#     _finalize_stripe_refund. Fixes a real, pre-existing gap: refunds never
#     wrote an offsetting retail_sales row, so Finance/Income/Register
#     reporting overstated revenue after ANY stripe_online refund.
# ---------------------------------------------------------------------------

def _seed_original_retail_sales_row(payment_id, client_id, client_name, invoice_id, amount):
    """Simulates the retail_sales row _apply_stripe_payment's Step B4 would
    have written for the original (pre-refund) Stripe payment."""
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.retail_sales.insert_one({
            "id": str(uuid.uuid4()), "date": date.today().isoformat(), "amount": amount,
            "payment_method": "stripe_online", "client_id": client_id, "client_name": client_name,
            "invoice_id": invoice_id, "payment_id": payment_id,
            "source_kind": "stripe_online_payment", "description": f"Stripe online payment · {invoice_id}",
            "created_at": ts, "created_by": "stripe_webhook", "logged_by": "Stripe",
        })
    _mongo_run(_seed)


def _fetch_retail_sales_reversals(payment_id):
    async def _fetch(db):
        return await db.retail_sales.find({"reversed_payment_id": payment_id}, {"_id": 0}).to_list(10)
    return _mongo_run(_fetch)


def _get_refund_attempt(refund_attempt_id):
    """NOTE: the existing _get_attempt helper (above) queries
    stripe_payment_attempts (the checkout-session attempt collection) — a
    different collection entirely. Refund attempts live in
    stripe_refund_attempts, so this dedicated helper is needed here."""
    async def _fetch(db):
        return await db.stripe_refund_attempts.find_one({"id": refund_attempt_id}, {"_id": 0})
    return _mongo_run(_fetch)


def test_stripe_refund_writes_offsetting_retail_sales_row(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=60.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 60.0)
    _seed_original_retail_sales_row(payment_id, client["id"], client["name"], invoice["id"], 60.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 25.0)

    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    reversals = _fetch_retail_sales_reversals(payment_id)
    assert len(reversals) == 1, "exactly one offsetting retail_sales row must be written"
    rev = reversals[0]
    assert abs(rev["amount"] - (-25.0)) < 0.01
    assert rev["source_kind"] == "stripe_refund"
    assert rev["payment_method"] == "stripe_online"
    assert rev["client_name"] == client["name"]

    # Original row must be untouched — never edited/deleted.
    async def _fetch_original(db):
        return await db.retail_sales.find_one({"payment_id": payment_id}, {"_id": 0})
    original = _mongo_run(_fetch_original)
    assert abs(original["amount"] - 60.0) < 0.01


def test_stripe_refund_retail_sales_reversal_idempotent_on_webhook_replay(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=40.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 40.0)
    _seed_original_retail_sales_row(payment_id, client["id"], client["name"], invoice["id"], 40.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 15.0)

    r1 = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r1.status_code == 200, r1.text
    r2 = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r2.status_code == 200, r2.text

    reversals = _fetch_retail_sales_reversals(payment_id)
    assert len(reversals) == 1, "duplicate webhook delivery must never create a second reversal row"

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(payment["refunded_amount"] - 15.0) < 0.01, "refunded_amount must not double-count on replay"


def test_stripe_refund_skips_retail_sales_reversal_when_no_original_row(admin_headers, fresh_client_and_dog):
    """No original retail_sales row exists for this payment (e.g. pre-dates
    this fix) — finalize must not crash and must not fabricate a reversal."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=30.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 30.0)
    # Deliberately NOT seeding an original retail_sales row.
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 10.0)

    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    assert _fetch_retail_sales_reversals(payment_id) == []

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(payment["refunded_amount"] - 10.0) < 0.01, "refunded_amount still applies even with no retail_sales row"


def test_finalize_stripe_refund_resumes_after_succeeded_but_incomplete(admin_headers, fresh_client_and_dog):
    """Reproduces the exact crash scenario: the refund attempt's status was
    already flipped to "succeeded" but every downstream local write (reversal
    Payment, refunded_amount, retail_sales reversal, invoice refund state,
    applied_refund_payment_id) never ran — simulating a process interruption
    right after the status guard. A redelivered webhook (the real-world
    recovery path) must complete every missing write exactly once."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 75.0, bump_invoice=False)
    _seed_original_retail_sales_row(payment_id, client["id"], client["name"], invoice["id"], 75.0)
    invoice_before = _get_invoice_raw(invoice["id"])
    refunded_total_before = float(invoice_before.get("refunded_total") or 0)

    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 30.0)
    # Simulate the crash point: status already "succeeded", nothing else done.
    async def _simulate_crash(db):
        await db.stripe_refund_attempts.update_one(
            {"id": refund_attempt_id}, {"$set": {"status": "succeeded"}},
        )
    _mongo_run(_simulate_crash)

    # Recovery: a redelivered webhook must reach _finalize_stripe_refund even
    # though _handle_refund_event sees a terminal status — this exercises the
    # fix to _handle_refund_event's own guard, not just _finalize_stripe_refund.
    r = _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"})
    assert r.status_code == 200, r.text

    attempt = _get_refund_attempt(refund_attempt_id)
    assert attempt["applied_refund_payment_id"], "local application must complete on resume"

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(payment["refunded_amount"] - 30.0) < 0.01

    reversals = _fetch_retail_sales_reversals(payment_id)
    assert len(reversals) == 1
    assert reversals[0]["id"] != payment_id

    async def _fetch_reversal_payment(db):
        return await db.payments.find_one({"id": attempt["applied_refund_payment_id"]}, {"_id": 0})
    reversal_payment = _mongo_run(_fetch_reversal_payment)
    assert reversal_payment is not None
    assert abs(reversal_payment["amount"] - (-30.0)) < 0.01

    invoice_after = _get_invoice_raw(invoice["id"])
    assert abs(float(invoice_after["refunded_total"]) - (refunded_total_before + 30.0)) < 0.01


def test_finalize_stripe_refund_fully_applied_attempt_is_true_noop(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=50.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 50.0)
    _seed_original_retail_sales_row(payment_id, client["id"], client["name"], invoice["id"], 50.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 20.0)

    # First delivery — fully applies.
    assert _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"}).status_code == 200
    attempt_after_first = _get_refund_attempt(refund_attempt_id)
    assert attempt_after_first["applied_refund_payment_id"]

    # Second delivery — must be a true no-op (already fully applied).
    assert _post_stripe_webhook("refund.updated", {"id": stripe_refund_id, "status": "succeeded"}).status_code == 200

    async def _fetch_payment(db):
        return await db.payments.find_one({"id": payment_id}, {"_id": 0})
    payment = _mongo_run(_fetch_payment)
    assert abs(payment["refunded_amount"] - 20.0) < 0.01, "must not double-apply once already fully applied"
    assert len(_fetch_retail_sales_reversals(payment_id)) == 1

    attempt_after_second = _get_refund_attempt(refund_attempt_id)
    assert attempt_after_second["applied_refund_payment_id"] == attempt_after_first["applied_refund_payment_id"]


def test_finalize_stripe_refund_concurrent_resume_applies_exactly_once(admin_headers, fresh_client_and_dog):
    """Two concurrent calls both resuming the SAME "succeeded but
    incomplete" attempt (e.g. a synchronous caller and a racing webhook)
    must still produce exactly one reversal Payment, one retail_sales
    reversal, and exactly one refunded_amount increment."""
    client, dog = fresh_client_and_dog
    bid, invoice = _fully_paid_invoice_non_ar(admin_headers, client, dog, total=80.0)
    payment_id = _seed_stripe_collected_payment(invoice["id"], client["id"], 80.0)
    _seed_original_retail_sales_row(payment_id, client["id"], client["name"], invoice["id"], 80.0)
    refund_attempt_id, stripe_refund_id = _seed_refund_attempt(payment_id, invoice["id"], 35.0)

    async def _simulate_crash(db):
        await db.stripe_refund_attempts.update_one(
            {"id": refund_attempt_id}, {"$set": {"status": "succeeded"}},
        )
    _mongo_run(_simulate_crash)

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import server as server_module
    real_db = server_module.db

    async def _race():
        fresh_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        server_module.db = fresh_client[os.environ.get("DB_NAME", "sit_happens")]
        try:
            await asyncio.gather(
                server_module._finalize_stripe_refund(refund_attempt_id),
                server_module._finalize_stripe_refund(refund_attempt_id),
            )
        finally:
            fresh_client.close()

    try:
        asyncio.run(_race())
    finally:
        server_module.db = real_db

    async def _fetch(db):
        payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        reversals = await db.payments.find(
            {"invoice_id": invoice["id"], "source.kind": "stripe_refund"}, {"_id": 0},
        ).to_list(10)
        retail_reversals = await db.retail_sales.find({"reversed_payment_id": payment_id}, {"_id": 0}).to_list(10)
        return payment, reversals, retail_reversals
    payment, reversals, retail_reversals = _mongo_run(_fetch)
    assert abs(payment["refunded_amount"] - 35.0) < 0.01, "concurrent resume must not double-apply"
    assert len(reversals) == 1
    assert len(retail_reversals) == 1
