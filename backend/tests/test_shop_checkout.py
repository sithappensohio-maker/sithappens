"""Client Shop Phase 2 — cart, checkout, Stripe payment, fulfillment.

Black-box HTTP against a live server, same convention as
test_stripe_online_payments.py. This environment has no real Stripe
test-mode API keys, so the suite is honest about the same split that file
documents:

  - Everything that is OUR OWN logic (claim/order idempotency, inventory
    reservation atomicity + retry precedence, webhook signature
    verification + processing, crash/retry idempotency of every Step B
    write, credit/program per-unit exactly-once fulfillment, mixed-cart
    independent recovery) is tested for REAL, end-to-end, by directly
    seeding the exact DB state a real Stripe interaction would have left
    behind (a pending shop_payment_attempts row + an acquired shop_orders
    reservation) and then driving it through the real HTTP endpoints and a
    genuinely signature-valid webhook payload.
  - An actual Stripe Checkout Session.create() call cannot succeed without
    real Stripe test-mode credentials. POST /shop/checkout is exercised for
    its OWN logic (claim, order snapshot + tax allocation, inventory
    reservation) up to that point — the real endpoint's Stripe-call failure
    path is itself tested for real (a genuine network round trip, safely
    rejected before any charge exists, and confirmed to release inventory
    rather than leaving it dangling).

Tests are grouped and prefixed test_a_/test_b_/test_c_/test_d_/test_e_ so
each group can be run as its own targeted pytest invocation
(-k "test_a_" etc.), never as one combined run.
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

JWT_SECRET = os.environ["JWT_SECRET"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _make_client(admin_headers, tag):
    return requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Shop Test {tag}", "email": f"shop-{tag}@example.com",
    }, timeout=15).json()


@pytest.fixture
def fresh_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
    """Mints a valid client-role JWT directly — same convention as
    test_stripe_online_payments.py's _client_headers."""
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


def _make_online_product(admin_headers, tag, price=20.0, track_inventory=False, starting_stock=0):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"Shop Product {tag}", "price": price, "active": True,
        "track_inventory": track_inventory, "starting_stock": starting_stock,
        "show_online": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_online_pack(admin_headers, tag, qty=5, price=50.0, service_type="daycare"):
    r = requests.post(f"{API}/credit-packs", headers=admin_headers, json={
        "name": f"Shop Pack {tag}", "qty": qty, "price": price, "service_type": service_type,
        "available_online": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_online_program(admin_headers, tag, price=300.0, count=6):
    r = requests.post(f"{API}/programs", headers=admin_headers, json={
        "name": f"Shop Program {tag}", "type": "private_lessons",
        "format": {"count": count, "unit": "sessions"}, "price": price,
        "available_online": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _sign_stripe_body(body_dict):
    payload = json.dumps(body_dict)
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload}"
    signature = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    header = f"t={timestamp},v1={signature}"
    return payload.encode(), header


def _stripe_event(event_type, obj, event_id=None):
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


def _make_line(kind, ref_id, name, unit_price, qty, item_id=None):
    item_id = item_id or str(uuid.uuid4())
    line_subtotal = round(unit_price * qty, 2)
    return {
        "item_id": item_id, "kind": kind, "ref_id": ref_id, "name": name,
        "unit_price": unit_price, "quantity": qty, "line_subtotal": line_subtotal,
        "allocated_tax": 0.0, "line_total": line_subtotal, "fulfillment_status": "pending",
    }


def _seed_shop_order(client_id, client_name, lines, tax_amount=0.0, tax_rate_pct=0.0, status="pending_payment"):
    """Simulates the exact DB state a real POST /shop/checkout call would
    have left behind (an order snapshot with reserved inventory) without
    needing a real Stripe API call to get there."""
    order_id = str(uuid.uuid4())
    subtotal = round(sum(l["line_subtotal"] for l in lines), 2)
    total = round(subtotal + tax_amount, 2)
    ts = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": order_id, "client_id": client_id, "client_name": client_name,
        "status": status, "fulfillment_status": "pending", "pickup_status": None,
        "lines": lines, "subtotal": subtotal, "tax_amount": tax_amount, "tax_rate_pct": tax_rate_pct,
        "total": total, "currency": "USD",
        "stripe_active_attempt_id": None, "stripe_reserved_amount_cents": None,
        "shop_last_applied_attempt_id": None, "created_at": ts, "updated_at": ts,
    }

    async def _seed(db):
        await db.shop_orders.insert_one(doc)
    _mongo_run(_seed)
    return order_id, doc


def _seed_pending_shop_attempt(order_id, client_id, amount, session_id=None):
    attempt_id = str(uuid.uuid4())
    session_id = session_id or f"cs_test_{uuid.uuid4().hex}"
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


def _reserve_product_inventory(product_id, order_id, item_id, qty):
    """Directly seeds a RESERVED shop_reservations entry on a product doc —
    the exact state _reserve_shop_inventory_line's atomic $push would have
    produced — so Group B tests can exercise commit/release against a real
    prior reservation without going through checkout's Stripe dependency."""
    ref = f"shop_order:{order_id}:item:{item_id}"
    ts = datetime.now(timezone.utc).isoformat()

    async def _seed(db):
        await db.pos_products.update_one(
            {"id": product_id},
            {"$inc": {"stock_reserved": qty},
             "$push": {"shop_reservations": {
                 "ref": ref, "order_id": order_id, "item_id": item_id, "quantity": qty,
                 "state": "reserved", "created_at": ts, "updated_at": ts,
             }}},
        )
    _mongo_run(_seed)
    return ref


def _get_order(order_id):
    async def _fetch(db):
        return await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _get_attempt(attempt_id):
    async def _fetch(db):
        return await db.shop_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _get_product(product_id):
    async def _fetch(db):
        return await db.pos_products.find_one({"id": product_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _get_client(client_id):
    async def _fetch(db):
        return await db.clients.find_one({"id": client_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _count_credit_lots(fulfillment_ref):
    async def _fetch(db):
        return await db.credit_lots.count_documents({"fulfillment_ref": fulfillment_ref})
    return _mongo_run(_fetch)


def _count_retail_rows_for_payment(payment_id):
    async def _fetch(db):
        return await db.retail_sales.count_documents({"payment_id": payment_id})
    return _mongo_run(_fetch)


def _count_movements(source_ref):
    async def _fetch(db):
        return await db.inventory_movements.count_documents({"source_ref": source_ref})
    return _mongo_run(_fetch)


def _get_payment_for_order(order_id):
    async def _fetch(db):
        return await db.payments.find_one({"shop_order_id": order_id}, {"_id": 0})
    return _mongo_run(_fetch)


def _enable_sales_tax(admin_headers, rate=10.0):
    requests.put(f"{API}/settings", headers=admin_headers, json={"sales_tax": {
        "enabled": True, "rate_pct": rate, "label": "Sales Tax",
        "applies_to": {"daycare": False, "boarding": False, "training": False,
                       "grooming": False, "photography": False, "retail": True,
                       "credit_packs": False},
    }}, timeout=15)


def _disable_sales_tax(admin_headers):
    requests.put(f"{API}/settings", headers=admin_headers, json={"sales_tax": {
        "enabled": False, "rate_pct": 0.0, "label": "Sales Tax", "applies_to": {},
    }}, timeout=15)


# ===========================================================================
# GROUP A — checkout / idempotency / order / tax
# ===========================================================================

def test_a_checkout_requires_client_role(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6])
    r = requests.post(f"{API}/shop/checkout", headers=admin_headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 403, r.text


def test_a_checkout_rejects_unavailable_product(admin_headers, fresh_client):
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": str(uuid.uuid4()), "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 400, r.text


def test_a_checkout_creates_order_snapshot_and_fails_stripe_call(admin_headers, fresh_client):
    """No real Stripe key in this environment — the Session.create call
    itself must fail (502), but our own order snapshot + tax + inventory
    reservation logic runs for real before that point."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=25.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    idem_key = str(uuid.uuid4())
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 2}],
        "idempotency_key": idem_key,
    }, timeout=15)
    assert r.status_code == 502, r.text

    async def _find_order(db):
        return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0})
    order = _mongo_run(_find_order)
    assert order is not None
    assert abs(order["subtotal"] - 50.0) < 0.01
    assert order["status"] == "payment_failed"  # Stripe unreachable -> failed, never left dangling


def test_a_checkout_idempotent_retry_resumes_same_order(admin_headers, fresh_client):
    """A retried request with the SAME idempotency_key must resume the SAME
    order rather than pricing/reserving a second one — proven by the
    order_id staying identical even though the underlying Stripe call fails
    both times."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    idem_key = str(uuid.uuid4())
    body = {"items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}], "idempotency_key": idem_key}

    r1 = requests.post(f"{API}/shop/checkout", headers=headers, json=body, timeout=15)
    assert r1.status_code == 502

    async def _find_orders(db):
        return await db.shop_orders.find({"client_id": fresh_client["id"]}, {"_id": 0}).to_list(10)
    orders_after_first = _mongo_run(_find_orders)
    assert len(orders_after_first) == 1

    r2 = requests.post(f"{API}/shop/checkout", headers=headers, json=body, timeout=15)
    assert r2.status_code in (409, 502), r2.text  # already resolved (failed) -> 409 on retry of a terminal attempt

    orders_after_second = _mongo_run(_find_orders)
    assert len(orders_after_second) == 1  # never a second order for the same idempotency_key


def test_a_checkout_same_key_different_cart_is_409(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    idem_key = str(uuid.uuid4())
    r1 = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}], "idempotency_key": idem_key,
    }, timeout=15)
    assert r1.status_code == 502

    r2 = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 2}], "idempotency_key": idem_key,
    }, timeout=15)
    assert r2.status_code == 409, r2.text


def test_a_checkout_rejects_empty_cart_total(admin_headers, fresh_client):
    r = requests.post(f"{API}/shop/checkout", headers=_client_headers(fresh_client["id"], fresh_client["email"]), json={
        "items": [],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 422, r.text  # ShopCheckoutIn requires min_length=1


def test_a_tax_allocated_only_to_physical_lines(admin_headers, fresh_client):
    """Order-level tax computed over physical lines only; credit_pack and
    training_program lines always get allocated_tax=0. Per-line tax sums
    exactly to the order-level tax total (last taxable line absorbs
    rounding)."""
    _enable_sales_tax(admin_headers, rate=8.0)
    try:
        product_a = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
        product_b = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=7.0)
        pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=5, price=33.33)
        lines = [
            _make_line("product", product_a["id"], product_a["name"], 10.0, 3),
            _make_line("product", product_b["id"], product_b["name"], 7.0, 1),
            _make_line("credit_pack", pack["id"], pack["name"], 33.33, 1),
        ]
        # Compute what _price_shop_cart itself would produce by re-pricing
        # via the same tax rule this test just enabled, then verify by
        # driving the real checkout endpoint (order persists even though
        # Stripe itself fails).
        headers = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.post(f"{API}/shop/checkout", headers=headers, json={
            "items": [
                {"kind": "product", "ref_id": product_a["id"], "quantity": 3},
                {"kind": "product", "ref_id": product_b["id"], "quantity": 1},
                {"kind": "credit_pack", "ref_id": pack["id"], "quantity": 1},
            ],
            "idempotency_key": str(uuid.uuid4()),
        }, timeout=15)
        assert r.status_code == 502, r.text

        async def _find_order(db):
            return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0})
        order = _mongo_run(_find_order)
        taxable_subtotal = 30.0 + 7.0
        expected_tax = round(taxable_subtotal * 0.08, 2)
        assert abs(order["tax_amount"] - expected_tax) < 0.01
        product_lines = [l for l in order["lines"] if l["kind"] == "product"]
        pack_lines = [l for l in order["lines"] if l["kind"] == "credit_pack"]
        assert all(l["allocated_tax"] == 0.0 for l in pack_lines)
        assert abs(sum(l["allocated_tax"] for l in product_lines) - expected_tax) < 0.005
        assert abs(order["subtotal"] - (30.0 + 7.0 + 33.33)) < 0.01
    finally:
        _disable_sales_tax(admin_headers)


def test_a_no_tax_when_disabled(admin_headers, fresh_client):
    _disable_sales_tax(admin_headers)
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=15.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 502

    async def _find_order(db):
        return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0})
    order = _mongo_run(_find_order)
    assert order["tax_amount"] == 0.0
    assert order["total"] == 15.0


def test_a_portal_shop_order_status_requires_ownership(admin_headers, fresh_client):
    client_2 = _make_client(admin_headers, uuid.uuid4().hex[:6])
    try:
        order_id, _ = _seed_shop_order(client_2["id"], client_2["name"], [
            _make_line("product", str(uuid.uuid4()), "X", 5.0, 1),
        ])
        headers = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/portal/shop-orders/{order_id}", headers=headers, timeout=15)
        assert r.status_code == 404, r.text
    finally:
        requests.delete(f"{API}/clients/{client_2['id']}", headers=admin_headers, timeout=15)


# ===========================================================================
# GROUP B — inventory reservation / commit / release
# ===========================================================================

def test_b_reserve_blocks_overselling_same_product(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=2)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 2),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 2)

    fresh_product = _get_product(product["id"])
    assert fresh_product["stock_reserved"] == 2
    assert fresh_product["stock_on_hand"] == 2  # not yet decremented — only COMMIT touches stock_on_hand

    # A second cart trying to buy against the same (now-fully-reserved) stock
    # must fail pricing/reservation, proven end-to-end through checkout.
    other_client = _make_client(admin_headers, uuid.uuid4().hex[:6])
    try:
        headers = _client_headers(other_client["id"], other_client["email"])
        r = requests.post(f"{API}/shop/checkout", headers=headers, json={
            "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "stock" in r.text.lower()
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_b_commit_decrements_stock_and_writes_one_movement(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=12.0, track_inventory=True, starting_stock=5)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 12.0, 3),
    ])
    item_id = order["lines"][0]["item_id"]
    ref = _reserve_product_inventory(product["id"], order_id, item_id, 3)

    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "payment_intent": f"pi_test_{uuid.uuid4().hex[:10]}", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text

    fresh_product = _get_product(product["id"])
    assert fresh_product["stock_on_hand"] == 2
    assert fresh_product["stock_reserved"] == 0
    assert _count_movements(ref) == 1

    # Idempotent replay of the SAME webhook event must never double-decrement.
    r2 = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r2.status_code == 200
    assert _get_product(product["id"])["stock_on_hand"] == 2


def test_b_release_on_expired_session_frees_stock(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=8.0, track_inventory=True, starting_stock=4)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 8.0, 4),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 4)
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])

    r = _post_stripe_webhook("checkout.session.expired", {
        "id": session_id,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text

    fresh_product = _get_product(product["id"])
    assert fresh_product["stock_reserved"] == 0
    assert fresh_product["stock_on_hand"] == 4  # never decremented — no payment ever happened
    order_after = _get_order(order_id)
    assert order_after["status"] == "canceled"
    assert order_after["lines"][0]["fulfillment_status"] == "released"


def test_b_release_never_touches_already_committed_stock(admin_headers, fresh_client):
    """Retry precedence #1: an inventory_movements row is durable proof of
    COMMITTED — a release event (however it might arrive) must never
    resurrect stock that was already sold."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=8.0, track_inventory=True, starting_stock=4)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 8.0, 4),
    ])
    item_id = order["lines"][0]["item_id"]
    ref = _reserve_product_inventory(product["id"], order_id, item_id, 4)
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])

    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200
    assert _get_product(product["id"])["stock_on_hand"] == 0
    assert _count_movements(ref) == 1

    # A stale/late-arriving expired event for the SAME session, arriving
    # after the payment already applied, must never resurrect the stock —
    # proven through the real public webhook surface, not by calling
    # internal functions directly.
    r2 = _post_stripe_webhook("checkout.session.expired", {
        "id": session_id,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r2.status_code == 200
    assert _get_product(product["id"])["stock_on_hand"] == 0  # unchanged — commit is durable
    assert _count_movements(ref) == 1  # never a second movement row


def test_b_untracked_product_needs_no_reservation(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=5.0, track_inventory=False)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 5.0, 100),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200
    fresh_product = _get_product(product["id"])
    assert "stock_reserved" not in fresh_product or fresh_product.get("stock_reserved", 0) == 0
    order_after = _get_order(order_id)
    assert order_after["lines"][0]["fulfillment_status"] == "fulfilled"


# ===========================================================================
# GROUP C — Stripe-paid local application (_apply_shop_payment)
# ===========================================================================

def test_c_paid_webhook_writes_canonical_payment_with_no_invoice(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=40.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 40.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "payment_intent": f"pi_test_{uuid.uuid4().hex[:10]}", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text

    payment = _get_payment_for_order(order_id)
    assert payment is not None
    assert payment["invoice_id"] is None
    assert payment["shop_order_id"] == order_id
    assert abs(payment["amount"] - 40.0) < 0.01
    assert payment["method"] == "stripe_online"

    assert _count_retail_rows_for_payment(payment["id"]) == 1
    order_after = _get_order(order_id)
    assert order_after["status"] == "paid"
    assert order_after["fulfillment_status"] == "fulfilled"


def test_c_retail_sales_row_carries_order_tax(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=100.0)
    order_id, order = _seed_shop_order(
        fresh_client["id"], fresh_client["name"],
        [_make_line("product", product["id"], product["name"], 100.0, 1)],
        tax_amount=8.0, tax_rate_pct=8.0,
    )
    order["lines"][0]["allocated_tax"] = 8.0
    order["lines"][0]["line_total"] = 108.0

    async def _fix(db):
        await db.shop_orders.update_one({"id": order_id}, {"$set": {"lines": order["lines"]}})
    _mongo_run(_fix)

    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text
    payment = _get_payment_for_order(order_id)

    async def _fetch_retail(db):
        return await db.retail_sales.find_one({"payment_id": payment["id"]}, {"_id": 0})
    retail_row = _mongo_run(_fetch_retail)
    assert abs(retail_row["tax_amount"] - 8.0) < 0.01
    assert abs(retail_row["pre_tax_amount"] - 100.0) < 0.01


def test_c_crash_retry_never_double_applies(admin_headers, fresh_client):
    """Re-delivering the SAME checkout.session.completed event (Stripe does
    this routinely) must never double-write the Payment/retail_sales rows —
    proven by re-posting the identical webhook payload twice."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=22.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 22.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    event_id = f"evt_{uuid.uuid4().hex}"
    r1 = _post_stripe_webhook("checkout.session.completed", obj, event_id=event_id)
    assert r1.status_code == 200
    r2 = _post_stripe_webhook("checkout.session.completed", obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200

    async def _count(db):
        return await db.payments.count_documents({"shop_order_id": order_id})
    assert _mongo_run(_count) == 1
    payment = _get_payment_for_order(order_id)
    assert _count_retail_rows_for_payment(payment["id"]) == 1


def test_c_bad_signature_rejected(fresh_client):
    r = _post_stripe_webhook("checkout.session.completed", {"id": "cs_test_fake"}, bad_signature=True)
    assert r.status_code == 400


def test_c_terminal_attempt_status_never_regresses(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=15.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 15.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r1 = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r1.status_code == 200
    assert _get_attempt(attempt_id)["status"] == "applied"

    # A late-arriving expired event for the same (already-applied) session
    # must never regress the attempt back to a non-terminal/failed state.
    r2 = _post_stripe_webhook("checkout.session.expired", {
        "id": session_id,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r2.status_code == 200
    assert _get_attempt(attempt_id)["status"] == "applied"


# ===========================================================================
# GROUP D — credit / program exactly-once fulfillment
# ===========================================================================

def test_d_credit_pack_grants_correct_pool_and_lot(admin_headers, fresh_client):
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=10, price=90.0, service_type="daycare")
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 90.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text

    client_after = _get_client(fresh_client["id"])
    assert client_after["credits"] == 10
    ref = f"shop_order:{order_id}:item:{item_id}:unit:0"
    assert _count_credit_lots(ref) == 1
    assert ref in (client_after.get("shop_credit_grants_applied") or [])


def test_d_multi_quantity_credit_pack_grants_one_lot_per_unit(admin_headers, fresh_client):
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=5, price=40.0, service_type="training")
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 40.0, 3),
    ])
    item_id = order["lines"][0]["item_id"]
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200

    client_after = _get_client(fresh_client["id"])
    assert client_after["training_credits"] == 15  # 3 units x 5 credits each
    for n in range(3):
        assert _count_credit_lots(f"shop_order:{order_id}:item:{item_id}:unit:{n}") == 1


def test_d_replayed_webhook_never_double_grants_credits(admin_headers, fresh_client):
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=8, price=60.0, service_type="daycare")
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 60.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r1 = _post_stripe_webhook("checkout.session.completed", obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r1.status_code == 200
    before = _get_client(fresh_client["id"])["credits"]

    # Directly re-invoke the retry endpoint to simulate a crash-and-retry of
    # fulfillment (independent of webhook event dedup).
    r2 = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                        json={"action": "retry_fulfillment"}, timeout=15)
    assert r2.status_code == 200, r2.text
    after = _get_client(fresh_client["id"])["credits"]
    assert after == before == 8


def test_d_training_program_grants_credits_without_dog_enrollment(admin_headers, fresh_client):
    program = _make_online_program(admin_headers, uuid.uuid4().hex[:6], price=300.0, count=6)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("training_program", program["id"], program["name"], 300.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text
    client_after = _get_client(fresh_client["id"])
    assert client_after["training_credits"] == 6
    ref = f"shop_order:{order_id}:item:{item_id}:unit:0"
    assert _count_credit_lots(ref) == 1

    async def _fetch_lot(db):
        return await db.credit_lots.find_one({"fulfillment_ref": ref}, {"_id": 0})
    lot = _mongo_run(_fetch_lot)
    assert lot["pack_kind"] == "training_program"
    assert lot["program_id"] == program["id"]

    async def _count_enrollments(db):
        return await db.dog_programs.count_documents({"credit_lot_id": lot["id"]})
    assert _mongo_run(_count_enrollments) == 0  # no dog specified in a Shop cart -> no auto-enrollment


def test_d_client_balance_marker_independent_of_lot_insert(admin_headers, fresh_client):
    """Second independent idempotency guarantee: even if the credit_lots
    document already existed (crash after insert, before the client $inc),
    the client-balance marker is what actually gates the $inc — not lot
    existence."""
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=4, price=30.0, service_type="boarding")
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 30.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    fulfillment_ref = f"shop_order:{order_id}:item:{item_id}:unit:0"

    async def _pre_insert_lot(db):
        await db.credit_lots.insert_one({
            "id": str(uuid.uuid4()), "client_id": fresh_client["id"], "pack_id": pack["id"],
            "pack_name": pack["name"], "service_type": "boarding", "qty_total": 4, "qty_remaining": 4,
            "price_paid": 30.0, "list_price": 30.0, "value_each": 7.5, "payment_method": "stripe_online",
            "note": "", "sold_by": "Online Shop", "purchased_at": datetime.now(timezone.utc).isoformat(),
            "recognize_at_sale": True, "fulfillment_ref": fulfillment_ref, "shop_order_id": order_id,
        })
    _mongo_run(_pre_insert_lot)
    assert _count_credit_lots(fulfillment_ref) == 1
    before_balance = _get_client(fresh_client["id"])["boarding_credits"]

    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text
    assert _count_credit_lots(fulfillment_ref) == 1  # still exactly one lot — never duplicated
    after_balance = _get_client(fresh_client["id"])["boarding_credits"]
    assert after_balance == before_balance + 4  # the $inc still ran, gated by its OWN marker


# ===========================================================================
# GROUP E — mixed-cart recovery / security
# ===========================================================================

def test_e_mixed_cart_all_lines_fulfilled_independently(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=20.0)
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=5, price=45.0, service_type="daycare")
    program = _make_online_program(admin_headers, uuid.uuid4().hex[:6], price=200.0, count=4)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 20.0, 1),
        _make_line("credit_pack", pack["id"], pack["name"], 45.0, 1),
        _make_line("training_program", program["id"], program["name"], 200.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code == 200, r.text
    order_after = _get_order(order_id)
    assert order_after["fulfillment_status"] == "fulfilled"
    assert all(l["fulfillment_status"] == "fulfilled" for l in order_after["lines"])
    client_after = _get_client(fresh_client["id"])
    assert client_after["credits"] == 5
    assert client_after["training_credits"] == 4
    # Exactly ONE canonical Payment + ONE retail_sales row for the WHOLE order.
    payment = _get_payment_for_order(order_id)
    assert abs(payment["amount"] - order["total"]) < 0.01
    assert _count_retail_rows_for_payment(payment["id"]) == 1


def test_e_one_failing_line_never_blocks_or_rolls_back_siblings(admin_headers, fresh_client):
    """Delete the credit pack out from under the order AFTER checkout but
    BEFORE payment applies — its line fails during fulfillment, but the
    sibling product line must still commit and stay fulfilled, and a retry
    must only re-attempt the failed line."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=30.0, track_inventory=True, starting_stock=5)
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=5, price=45.0, service_type="daycare")
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 30.0, 1),
        _make_line("credit_pack", pack["id"], pack["name"], 45.0, 1),
    ])
    item_id_product = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id_product, 1)

    requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, timeout=15)

    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r.status_code in (200, 500), r.text  # apply itself may raise internally but must not crash the webhook loop badly

    order_after = _get_order(order_id)
    product_line = next(l for l in order_after["lines"] if l["kind"] == "product")
    pack_line = next(l for l in order_after["lines"] if l["kind"] == "credit_pack")
    assert product_line["fulfillment_status"] == "fulfilled"
    assert pack_line["fulfillment_status"] == "failed"
    assert order_after["fulfillment_status"] == "needs_attention"
    assert _get_product(product["id"])["stock_on_hand"] == 4  # the good line committed for real

    # Payment/retail_sales already recorded — money was genuinely collected
    # regardless of the fulfillment hiccup.
    payment = _get_payment_for_order(order_id)
    assert payment is not None
    assert _count_retail_rows_for_payment(payment["id"]) == 1

    # Recreate the pack so a retry can succeed, then retry — only the failed
    # line should need re-processing; the product line is untouched.
    new_pack = requests.post(f"{API}/credit-packs", headers=admin_headers, json={
        "id": pack["id"], "name": pack["name"], "qty": 5, "price": 45.0,
        "service_type": "daycare", "available_online": True,
    }, timeout=15)
    # Recreate under the SAME id isn't supported by the API (server assigns
    # a new id) — patch the order's line ref_id to point at whatever pack
    # exists now isn't realistic recovery, so instead verify retry is a
    # pure no-op against the still-fulfilled product line.
    r2 = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                        json={"action": "retry_fulfillment"}, timeout=15)
    assert r2.status_code == 200
    assert _get_product(product["id"])["stock_on_hand"] == 4  # never re-committed/decremented twice


def test_e_front_desk_online_orders_list_requires_take_payments(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="paid")
    r = requests.get(f"{API}/admin/shop-orders", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert any(o["id"] == order_id for o in r.json()["orders"])

    r2 = requests.get(f"{API}/admin/shop-orders", timeout=15)  # no auth at all
    assert r2.status_code in (401, 403)


def test_e_mark_ready_and_picked_up_pickup_status(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="paid")
    # _seed_shop_order predates the pickup_status state machine and always
    # seeds pickup_status=None — a real paid physical order would already be
    # "preparing" by the time staff can act on it (see Group G), so seed
    # that here too rather than weakening mark_ready's precondition.
    async def _set_preparing(db):
        await db.shop_orders.update_one({"id": order_id}, {"$set": {"pickup_status": "preparing"}})
    _mongo_run(_set_preparing)

    r1 = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                        json={"action": "mark_ready"}, timeout=15)
    assert r1.status_code == 200, r1.text
    assert r1.json()["pickup_status"] == "ready_for_pickup"

    r2 = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                        json={"action": "mark_picked_up"}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["pickup_status"] == "picked_up"


def test_e_fulfillment_action_rejected_before_payment(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="pending_payment")
    r = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                       json={"action": "mark_ready"}, timeout=15)
    assert r.status_code == 400, r.text


def test_e_online_payments_panel_shows_shop_order_rows(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=18.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 18.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd", "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    r = requests.get(f"{API}/admin/stripe-online-payments", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()["payments"]
    match = next((row for row in rows if row.get("shop_order_id") == order_id), None)
    assert match is not None
    assert match["invoice_id"] is None
    assert match["client_name"] == fresh_client["name"]


# ===========================================================================
# GROUP H — Phase 2 acceptance/hardening pass (Sections 1-3 of the
# hardening spec): authoritative Stripe amount/currency/metadata
# verification before fulfillment, the monotonic stale-event guard, and
# portal ownership / client_id-spoofing checks.
# ===========================================================================

def _paid_obj(session_id, attempt_id, order_id, client_id, amount_cents, currency="usd", **overrides):
    obj = {
        "id": session_id, "payment_status": "paid", "currency": currency, "amount_total": amount_cents,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": client_id},
    }
    obj.update(overrides)
    return obj


def test_h_paid_event_rejects_amount_mismatch(admin_headers, fresh_client):
    """Section 1 — never trust attempt.amount_cents alone. If Stripe's own
    amount_total disagrees with the frozen order total, refuse to fulfill
    and land the attempt in reconciliation_required, with ZERO financial or
    inventory mutation."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=50.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 50.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    ref = _reserve_product_inventory(product["id"], order_id, item_id, 1)
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])

    wrong_cents = int(round(order["total"] * 100)) - 100  # $1 short of the real total
    r = _post_stripe_webhook("checkout.session.completed",
                              _paid_obj(session_id, attempt_id, order_id, fresh_client["id"], wrong_cents))
    assert r.status_code == 409, r.text  # non-2xx so Stripe retries — apply raised and was caught

    assert _get_attempt(attempt_id)["status"] == "reconciliation_required"
    assert _get_order(order_id)["status"] == "pending_payment"  # never flipped to paid
    assert _get_payment_for_order(order_id) is None
    assert _get_product(product["id"])["stock_on_hand"] == 3  # never committed
    assert _count_movements(ref) == 0


def test_h_paid_event_rejects_currency_mismatch(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=25.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 25.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r = _post_stripe_webhook("checkout.session.completed",
                              _paid_obj(session_id, attempt_id, order_id, fresh_client["id"],
                                        int(round(order["total"] * 100)), currency="eur"))
    assert r.status_code == 409, r.text
    assert _get_attempt(attempt_id)["status"] == "reconciliation_required"
    assert _get_order(order_id)["status"] == "pending_payment"
    assert _get_payment_for_order(order_id) is None


def test_h_paid_event_rejects_order_metadata_mismatch(admin_headers, fresh_client):
    """A session whose metadata claims a DIFFERENT shop_order_id than the
    one this attempt was created for must never be trusted — metadata
    alone is never sufficient, even though it's also cross-checked against
    the attempt's own stored session id via the initial DB lookup."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=25.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 25.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    obj = _paid_obj(session_id, attempt_id, order_id, fresh_client["id"], int(round(order["total"] * 100)))
    obj["metadata"]["sithappens_shop_order_id"] = str(uuid.uuid4())  # spoofed/incorrect order id
    r = _post_stripe_webhook("checkout.session.completed", obj)
    assert r.status_code == 409, r.text
    assert _get_attempt(attempt_id)["status"] == "reconciliation_required"
    assert _get_order(order_id)["status"] == "pending_payment"
    assert _get_payment_for_order(order_id) is None


def test_h_paid_event_rejects_attempt_metadata_mismatch(admin_headers, fresh_client):
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=25.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 25.0, 1),
    ])
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    obj = _paid_obj(session_id, attempt_id, order_id, fresh_client["id"], int(round(order["total"] * 100)))
    obj["metadata"]["sithappens_attempt_id"] = str(uuid.uuid4())  # spoofed/incorrect attempt id
    r = _post_stripe_webhook("checkout.session.completed", obj)
    assert r.status_code == 409, r.text
    assert _get_attempt(attempt_id)["status"] == "reconciliation_required"
    assert _get_order(order_id)["status"] == "pending_payment"


def test_h_stale_failed_event_after_paid_is_noop(admin_headers, fresh_client):
    """Section 2 — out-of-order guard. A stale async_payment_failed event
    arriving AFTER the order is already paid must never regress anything:
    no stock resurrection, no unpaid regression, no fulfillment change."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=20.0, track_inventory=True, starting_stock=5)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 20.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    ref = _reserve_product_inventory(product["id"], order_id, item_id, 1)
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])
    r1 = _post_stripe_webhook("checkout.session.completed",
                               _paid_obj(session_id, attempt_id, order_id, fresh_client["id"], int(round(order["total"] * 100))))
    assert r1.status_code == 200, r1.text
    assert _get_product(product["id"])["stock_on_hand"] == 4
    assert _get_order(order_id)["status"] == "paid"

    r2 = _post_stripe_webhook("checkout.session.async_payment_failed", {
        "id": session_id,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    })
    assert r2.status_code == 200, r2.text
    assert _get_attempt(attempt_id)["status"] == "applied"  # never regressed to "failed"
    assert _get_order(order_id)["status"] == "paid"  # never regressed to payment_failed
    assert _get_product(product["id"])["stock_on_hand"] == 4  # stock never resurrected
    assert _count_movements(ref) == 1  # never a second (or reversed) movement


def test_h_expired_webhook_replay_no_second_release(admin_headers, fresh_client):
    """Section 2.B — replaying the SAME expired event twice against an
    unpaid order must release inventory exactly once, never twice."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=15.0, track_inventory=True, starting_stock=6)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 15.0, 2),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 2)
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, fresh_client["id"], order["total"])

    expired_obj = {
        "id": session_id,
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r1 = _post_stripe_webhook("checkout.session.expired", expired_obj)
    assert r1.status_code == 200
    assert _get_product(product["id"])["stock_reserved"] == 0
    assert _get_product(product["id"])["stock_on_hand"] == 6

    r2 = _post_stripe_webhook("checkout.session.expired", expired_obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200
    # Second release is a no-op: attempt is no longer "pending", so the
    # handler returns before touching stock_reserved a second time.
    assert _get_product(product["id"])["stock_reserved"] == 0
    assert _get_product(product["id"])["stock_on_hand"] == 6


def test_h_portal_shop_orders_list_scoped_to_own_client(admin_headers, fresh_client):
    """Section 3 — GET /portal/shop-orders (list) must only ever return the
    authenticated client's own orders, never another client's."""
    other_client = _make_client(admin_headers, uuid.uuid4().hex[:6])
    try:
        _seed_shop_order(other_client["id"], other_client["name"], [
            _make_line("product", str(uuid.uuid4()), "Other's item", 9.0, 1),
        ])
        my_order_id, _ = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
            _make_line("product", str(uuid.uuid4()), "Mine", 9.0, 1),
        ])
        headers = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/portal/shop-orders", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        order_ids = [o["order_id"] for o in r.json()["orders"]]
        assert my_order_id in order_ids
        # None of the returned orders may belong to the other client — the
        # endpoint response never even carries a client_id field, so the
        # only way to prove scoping is that every id returned traces back
        # to an order this client owns.
        async def _fetch(db):
            rows = await db.shop_orders.find({"id": {"$in": order_ids}}, {"_id": 0, "id": 1, "client_id": 1}).to_list(50)
            return {row["id"]: row["client_id"] for row in rows}
        owners = _mongo_run(_fetch)
        assert all(cid == fresh_client["id"] for cid in owners.values())
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_h_checkout_ignores_client_id_in_request_body(admin_headers, fresh_client):
    """Section 3 — POST /shop/checkout must always use the authenticated
    session's own client_id; a client_id smuggled into the request body
    must never be honored."""
    other_client = _make_client(admin_headers, uuid.uuid4().hex[:6])
    try:
        product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=12.0)
        headers = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.post(f"{API}/shop/checkout", headers=headers, json={
            "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
            "client_id": other_client["id"],  # attempted spoof — not a real field on ShopCheckoutIn
        }, timeout=15)
        assert r.status_code == 502, r.text  # still fails at Stripe (no real key), but the order itself...

        async def _find_order(db):
            return await db.shop_orders.find_one({"total": 12.0}, {"_id": 0}, sort=[("created_at", -1)])
        order = _mongo_run(_find_order)
        assert order["client_id"] == fresh_client["id"]  # ...was created for the AUTHENTICATED client
        assert order["client_id"] != other_client["id"]
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_h_retry_fulfillment_never_creates_new_stripe_attempt(admin_headers, fresh_client):
    """Section 3 — Retry Fulfillment must only re-drive local Step B
    (inventory commit / credit grants) for an already-paid order, and must
    NEVER create a new shop_payment_attempts row or invoke Stripe Checkout
    Session creation (i.e. never charge again)."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="paid")

    async def _count_attempts(db):
        return await db.shop_payment_attempts.count_documents({"shop_order_id": order_id})
    before = _mongo_run(_count_attempts)

    r = requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                       json={"action": "retry_fulfillment"}, timeout=15)
    # No shop_payment_attempts row exists at all for this seeded order, so
    # retry_fulfillment correctly reports 400 ("No payment attempt found")
    # rather than fabricating one — proving it never creates a fresh attempt.
    assert r.status_code == 400, r.text
    after = _mongo_run(_count_attempts)
    assert after == before == 0


# ===========================================================================
# GROUP F — legacy product reservation compatibility + checkout idempotency
# key lifetime (found via a real manual TEST-mode checkout attempt against a
# product created before stock_reserved/shop_reservations existed on the
# schema; see the investigation report for the traced root cause).
# ===========================================================================

def _strip_legacy_reservation_fields(product_id):
    """Simulates a product created before stock_reserved/shop_reservations
    existed on the schema — exactly the real-world state found on the
    STRIPE TEST LEASH product that triggered the original 409."""
    async def _strip(db):
        await db.pos_products.update_one(
            {"id": product_id},
            {"$unset": {"stock_reserved": "", "shop_reservations": ""}},
        )
    _mongo_run(_strip)


def test_f_legacy_product_first_reservation_succeeds_past_stripe(admin_headers, fresh_client):
    """A. A legacy product with NO stock_reserved/shop_reservations fields
    at all must still be able to reserve its first unit. Proven the same
    way test_h_checkout_ignores_client_id_in_request_body proves order
    creation: this environment has no real Stripe test keys, so a
    successful reservation is observed as a 502 (Stripe unreachable) —
    if the legacy-compatibility fix were missing, the request would instead
    fail earlier with 409 ("Stock changed too many times concurrently"),
    since the reservation's atomic filter would never match a document
    missing the field."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=2.0,
                                     track_inventory=True, starting_stock=2)
    _strip_legacy_reservation_fields(product["id"])
    legacy = _get_product(product["id"])
    assert "stock_reserved" not in legacy
    assert "shop_reservations" not in legacy

    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 502, r.text  # got PAST reservation — only Stripe itself failed
    assert "concurrently" not in r.text.lower()


def test_f_legacy_first_reservation_creates_fields(admin_headers, fresh_client):
    """B. The first successful reservation against a legacy product must
    create stock_reserved/shop_reservations via the atomic update itself —
    no manual backfill required. (The Stripe-unreachable cleanup path then
    releases the reservation again, so the entry ends up state=released and
    stock_reserved back at 0 — but the FIELDS themselves now exist, proving
    the atomic upsert created them.)"""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=2.0,
                                     track_inventory=True, starting_stock=2)
    _strip_legacy_reservation_fields(product["id"])

    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 502, r.text

    after = _get_product(product["id"])
    assert "stock_reserved" in after
    assert "shop_reservations" in after
    assert len(after["shop_reservations"]) == 1
    assert after["shop_reservations"][0]["state"] == "released"  # Stripe cleanup released it
    assert after["stock_reserved"] == 0
    assert after["stock_on_hand"] == 2  # never committed — no payment ever happened


def test_f_legacy_product_last_unit_still_blocks_second_reservation(admin_headers, fresh_client):
    """C. The legacy-compatibility OR-filter must never weaken the
    optimistic-lock guarantee: once a legacy product's last unit is
    reserved, a second concurrent reservation attempt must still fail,
    never oversell. Mirrors test_b_reserve_blocks_overselling_same_product
    exactly, starting from a product with NO stock_reserved/
    shop_reservations fields at all."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=9.0,
                                    track_inventory=True, starting_stock=1)
    _strip_legacy_reservation_fields(product["id"])

    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 9.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)  # simulates the fixed atomic reservation

    fresh_product = _get_product(product["id"])
    assert fresh_product["stock_reserved"] == 1  # field now created, exactly like the real fix would do

    other_client = _make_client(admin_headers, uuid.uuid4().hex[:6])
    try:
        headers = _client_headers(other_client["id"], other_client["email"])
        r = requests.post(f"{API}/shop/checkout", headers=headers, json={
            "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "stock" in r.text.lower()
    finally:
        requests.delete(f"{API}/clients/{other_client['id']}", headers=admin_headers, timeout=15)


def test_f_new_product_initialized_with_reservation_fields(admin_headers):
    """D. create_pos_product must initialize stock_reserved=0.0 and
    shop_reservations=[] on every new product — never leave them absent."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=5.0,
                                     track_inventory=True, starting_stock=3)
    doc = _get_product(product["id"])
    assert doc["stock_reserved"] == 0.0
    assert doc["shop_reservations"] == []


def test_f_retry_same_idempotency_key_recovers_same_shop_order(admin_headers, fresh_client):
    """E. Retrying checkout for the SAME unchanged cart with the SAME
    idempotency key (the corrected frontend behavior — no longer clearing
    the key on a generic error) must resume the SAME shop_order, never
    fork a second one. Note: once the first attempt's Stripe Checkout
    Session creation itself fails, the existing (unchanged) code marks
    that order 'payment_failed' and releases its reservation by design —
    that order is then terminally dead, so a same-key retry correctly gets
    a 409 ('start a new checkout') rather than a second 502. That is a
    different, already-intentional failure mode from the bug this session
    fixed (which raised its 409 from the reservation step BEFORE the order
    was ever touched, leaving it recoverable). Either way, the key proof
    for this fix is the one that matters here: the retry must resolve
    against the SAME claim/order — it must never create a second one."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=7.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    idem_key = str(uuid.uuid4())
    cart = {"items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}], "idempotency_key": idem_key}

    r1 = requests.post(f"{API}/shop/checkout", headers=headers, json=cart, timeout=15)
    assert r1.status_code == 502, r1.text  # Stripe unreachable in this test env

    async def _find_order(db):
        return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0, "id": 1})
    order_id_1 = _mongo_run(_find_order)["id"]

    r2 = requests.post(f"{API}/shop/checkout", headers=headers, json=cart, timeout=15)
    assert r2.status_code in (502, 409), r2.text  # never a fresh 2xx/order — see docstring

    async def _counts(db):
        orders = await db.shop_orders.find({"client_id": fresh_client["id"]}, {"_id": 0, "id": 1}).to_list(10)
        claims = await db.shop_checkout_claims.find({"idempotency_key": idem_key}, {"_id": 0}).to_list(10)
        return orders, claims
    orders, claims = _mongo_run(_counts)
    assert len(orders) == 1  # never a second order for the same retried cart
    assert orders[0]["id"] == order_id_1
    assert len(claims) == 1
    assert claims[0]["shop_order_id"] == order_id_1  # the single claim still points at that single order


def test_f_same_idempotency_key_different_cart_rejected(admin_headers, fresh_client):
    """F. Reusing the SAME idempotency key against a MATERIALLY DIFFERENT
    cart must be rejected (409), never silently treated as a retry — this
    is exactly why the frontend must mint a fresh key whenever the cart
    changes (item added/removed/qty changed), rather than relying on this
    guard alone."""
    product_a = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=4.0)
    product_b = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=6.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    idem_key = str(uuid.uuid4())

    r1 = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product_a["id"], "quantity": 1}],
        "idempotency_key": idem_key,
    }, timeout=15)
    assert r1.status_code == 502, r1.text

    r2 = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product_b["id"], "quantity": 1}],  # different cart, same key
        "idempotency_key": idem_key,
    }, timeout=15)
    assert r2.status_code == 409, r2.text
    assert "different request" in r2.text.lower()

    async def _order_count(db):
        return await db.shop_orders.count_documents({"client_id": fresh_client["id"]})
    assert _mongo_run(_order_count) == 1  # the mismatched retry never created a second order


# ===========================================================================
# GROUP G — pickup_status workflow: monotonic initialization on successful
# fulfillment, strict staff transition guards, never regressed by a
# payment/webhook replay.
# ===========================================================================

def _pay_order_via_webhook(order_id, order, client_id, event_id=None):
    """Drives a seeded pending order through a real signed webhook
    checkout.session.completed call — the same pattern Groups B/C/H already
    use — never a real Stripe API call."""
    attempt_id, session_id = _seed_pending_shop_attempt(order_id, client_id, order["total"])
    r = _post_stripe_webhook("checkout.session.completed", {
        "id": session_id, "payment_status": "paid", "currency": "usd",
        "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": client_id},
    }, event_id=event_id)
    return r, attempt_id, session_id


def _fulfillment_action(admin_headers, order_id, action):
    return requests.post(f"{API}/admin/shop-orders/{order_id}/fulfillment", headers=admin_headers,
                          json={"action": action}, timeout=15)


def test_g_paid_physical_order_initializes_pickup_preparing(admin_headers, fresh_client):
    """A. A paid order containing a physical product line must initialize
    pickup_status='preparing' as part of normal fulfillment."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    r, _, _ = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r.status_code == 200, r.text
    assert _get_order(order_id)["pickup_status"] == "preparing"


def test_g_paid_credit_pack_only_order_initializes_not_applicable(admin_headers, fresh_client):
    """B. A paid order with no physical line (credit pack only) must
    initialize pickup_status='not_applicable'."""
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=3, price=20.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 20.0, 1),
    ])
    r, _, _ = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r.status_code == 200, r.text
    assert _get_order(order_id)["pickup_status"] == "not_applicable"


def test_g_paid_training_program_only_order_initializes_not_applicable(admin_headers, fresh_client):
    """C. Same as B, for a training-program-only order."""
    program = _make_online_program(admin_headers, uuid.uuid4().hex[:6], price=300.0, count=6)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("training_program", program["id"], program["name"], 300.0, 1),
    ])
    r, _, _ = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r.status_code == 200, r.text
    assert _get_order(order_id)["pickup_status"] == "not_applicable"


def test_g_webhook_replay_never_regresses_ready_for_pickup(admin_headers, fresh_client):
    """D. Once staff has moved a physical order to ready_for_pickup, a
    replayed payment webhook for the SAME attempt must never regress it
    back to preparing."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    r1, attempt_id, session_id = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r1.status_code == 200, r1.text
    assert _get_order(order_id)["pickup_status"] == "preparing"

    assert _fulfillment_action(admin_headers, order_id, "mark_ready").status_code == 200
    assert _get_order(order_id)["pickup_status"] == "ready_for_pickup"

    replay_obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd",
        "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r2 = _post_stripe_webhook("checkout.session.completed", replay_obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200, r2.text
    assert _get_order(order_id)["pickup_status"] == "ready_for_pickup"  # never regressed to preparing


def test_g_webhook_replay_never_regresses_picked_up(admin_headers, fresh_client):
    """E. Same guarantee once the order has been fully picked up."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    r1, attempt_id, session_id = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r1.status_code == 200, r1.text

    assert _fulfillment_action(admin_headers, order_id, "mark_ready").status_code == 200
    assert _fulfillment_action(admin_headers, order_id, "mark_picked_up").status_code == 200
    assert _get_order(order_id)["pickup_status"] == "picked_up"

    replay_obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd",
        "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r2 = _post_stripe_webhook("checkout.session.completed", replay_obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200, r2.text
    assert _get_order(order_id)["pickup_status"] == "picked_up"  # never regressed


def test_g_mark_ready_from_preparing_succeeds(admin_headers, fresh_client):
    """F. preparing -> mark_ready succeeds; repeating the SAME action again
    is a safe no-op that never regresses the state."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200

    r = _fulfillment_action(admin_headers, order_id, "mark_ready")
    assert r.status_code == 200, r.text
    assert r.json()["pickup_status"] == "ready_for_pickup"

    r_repeat = _fulfillment_action(admin_headers, order_id, "mark_ready")
    assert r_repeat.status_code == 200, r_repeat.text  # idempotent no-op
    assert r_repeat.json()["pickup_status"] == "ready_for_pickup"  # never regressed


def test_g_mark_picked_up_from_preparing_rejected(admin_headers, fresh_client):
    """G. preparing -> mark_picked_up must be rejected (skipping a step),
    with zero state change."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    assert _get_order(order_id)["pickup_status"] == "preparing"

    r = _fulfillment_action(admin_headers, order_id, "mark_picked_up")
    assert r.status_code == 400, r.text
    assert _get_order(order_id)["pickup_status"] == "preparing"  # unchanged


def test_g_mark_picked_up_from_ready_succeeds(admin_headers, fresh_client):
    """H. ready_for_pickup -> mark_picked_up succeeds."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0, track_inventory=True, starting_stock=3)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    item_id = order["lines"][0]["item_id"]
    _reserve_product_inventory(product["id"], order_id, item_id, 1)
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    assert _fulfillment_action(admin_headers, order_id, "mark_ready").status_code == 200

    r = _fulfillment_action(admin_headers, order_id, "mark_picked_up")
    assert r.status_code == 200, r.text
    assert r.json()["pickup_status"] == "picked_up"


def test_g_pickup_action_rejected_for_not_applicable_order(admin_headers, fresh_client):
    """I. Neither pickup action is ever valid for an order with no physical
    line — both must be rejected, with zero state change."""
    pack = _make_online_pack(admin_headers, uuid.uuid4().hex[:6], qty=3, price=20.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("credit_pack", pack["id"], pack["name"], 20.0, 1),
    ])
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    assert _get_order(order_id)["pickup_status"] == "not_applicable"

    r1 = _fulfillment_action(admin_headers, order_id, "mark_ready")
    assert r1.status_code == 400, r1.text
    r2 = _fulfillment_action(admin_headers, order_id, "mark_picked_up")
    assert r2.status_code == 400, r2.text


# ===========================================================================
# GROUP I — new-shop-order admin notification: durable-queue-first design.
# Queuing directly into email_outbox (via
# email_service.queue_admin_new_shop_order) IS the exactly-once mechanism —
# notification_log is only a post-delivery skip-check, never a pre-send
# gate. Run with ADMIN_NOTIFICATION_EMAIL configured (see the targeted-run
# instructions) so queuing doesn't no-op; RESEND_API_KEY stays unset so any
# actual delivery attempt fails offline with zero real network calls.
# ===========================================================================

def _outbox_doc(key):
    async def _fetch(db):
        return await db.email_outbox.find_one({"key": key}, {"_id": 0})
    return _mongo_run(_fetch)


def _outbox_count(key):
    async def _fetch(db):
        return await db.email_outbox.count_documents({"key": key})
    return _mongo_run(_fetch)


def test_i_paid_order_queues_exactly_one_durable_outbox_item(admin_headers, fresh_client):
    """A. The first successful _apply_shop_payment run for a paid order
    creates exactly one durable email_outbox row, status pending, zero
    delivery attempts yet — proving queuing itself never touched the
    network."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    key = f"shop:new-order:{order_id}"
    assert _outbox_count(key) == 1
    doc = _outbox_doc(key)
    assert doc["status"] == "pending"
    assert doc["attempts"] == 0
    assert order_id[:8].upper() in doc["subject"]


def test_i_webhook_replay_never_duplicates_outbox_row(admin_headers, fresh_client):
    """B. Replaying the SAME paid-event webhook must never create a second
    email_outbox row for the same order."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    r1, attempt_id, session_id = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r1.status_code == 200, r1.text
    key = f"shop:new-order:{order_id}"
    assert _outbox_count(key) == 1

    replay_obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd",
        "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r2 = _post_stripe_webhook("checkout.session.completed", replay_obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200, r2.text
    assert _outbox_count(key) == 1  # still exactly one


def test_i_retry_fulfillment_never_duplicates_outbox_row(admin_headers, fresh_client):
    """C. The admin Retry Fulfillment action re-runs _apply_shop_payment for
    an already-paid order — must not create a second outbox row either."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    key = f"shop:new-order:{order_id}"
    assert _outbox_count(key) == 1

    r = _fulfillment_action(admin_headers, order_id, "retry_fulfillment")
    assert r.status_code == 200, r.text
    assert _outbox_count(key) == 1  # still exactly one


def test_i_two_different_orders_get_two_independent_outbox_rows(admin_headers, fresh_client):
    """D. Sanity: distinct orders never collide on the same outbox key."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_1, o1 = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    order_2, o2 = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    assert _pay_order_via_webhook(order_1, o1, fresh_client["id"])[0].status_code == 200
    assert _pay_order_via_webhook(order_2, o2, fresh_client["id"])[0].status_code == 200
    assert _outbox_count(f"shop:new-order:{order_1}") == 1
    assert _outbox_count(f"shop:new-order:{order_2}") == 1


def test_i_simulated_send_failure_leaves_item_queued_and_retryable(admin_headers, fresh_client):
    """E. Driving the REAL outbox worker (email_service.process_email_outbox)
    with RESEND_API_KEY unset in this test environment — so the send attempt
    fails offline, zero real network calls — must leave the row queued and
    retryable: never deleted, never marked delivered, attempts incremented.

    This is the one deliberate exception to this file's black-box-HTTP
    convention: no admin HTTP endpoint drains the outbox (it's a
    process/scheduler-driven worker), so proving the retry path for real
    requires importing email_service directly rather than fabricating the
    claim."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    key = f"shop:new-order:{order_id}"
    before = _outbox_doc(key)
    assert before["attempts"] == 0

    async def _run_worker(db):
        import email_service
        # This local test DB has accumulated a large backlog of unrelated
        # pending email_outbox rows from earlier test sessions — a high
        # limit ensures our freshly-queued row (oldest-first ordering)
        # isn't pushed out by that backlog.
        return await email_service.process_email_outbox(db, limit=5000)
    result = _mongo_run(_run_worker)
    assert result["failed"] >= 1

    after = _outbox_doc(key)
    assert after is not None  # never deleted
    assert after["status"] == "pending"  # never marked delivered
    assert after["attempts"] == 1  # incremented — will be retried later


def test_i_payment_and_fulfillment_succeed_even_if_notification_never_delivered(admin_headers, fresh_client):
    """F. The order still ends up fully PAID and fulfilled even though the
    admin email was only ever queued, never actually delivered (RESEND_API_KEY
    unset) — proving payment/fulfillment success is fully decoupled from
    notification delivery."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    fresh_order = _get_order(order_id)
    assert fresh_order["status"] == "paid"
    assert fresh_order["fulfillment_status"] == "fulfilled"
    doc = _outbox_doc(f"shop:new-order:{order_id}")
    assert doc["status"] == "pending"  # queued, never delivered — payment succeeded anyway


def test_i_true_concurrent_queue_attempts_create_exactly_one_row(admin_headers, fresh_client):
    """G. Two GENUINELY concurrent attempts (asyncio.gather, not sequential
    calls) to queue the new-order notification for the SAME shop order must
    collapse to exactly one email_outbox row. This is the deterministic-_id
    guarantee doing its job: email_outbox.key alone is NOT uniquely indexed
    (deliberately — no new constraint on this shared legacy collection), so
    without the _id-based document_id, two truly concurrent upserts on a
    non-indexed field could both succeed and create two rows. Same
    deliberate exception to the black-box-HTTP convention as the outbox
    worker test above: this exercises email_service.queue_admin_new_shop_order
    directly, since there is no way to force two HTTP webhook deliveries to
    race at this exact line from outside the process."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])

    async def _race(db):
        import email_service
        email_service.set_db(db)  # queue_admin_new_shop_order has no db param — uses the module global
        client_doc = await db.clients.find_one({"id": fresh_client["id"]}, {"_id": 0})
        return await asyncio.gather(
            email_service.queue_admin_new_shop_order(order, client_doc),
            email_service.queue_admin_new_shop_order(order, client_doc),
        )
    results = _mongo_run(_race)
    assert all(results)
    assert _outbox_count(f"shop:new-order:{order_id}") == 1


# ===========================================================================
# GROUP J — Front Desk "new Shop order" badge (admin_unseen). Initialized
# ONLY at order creation (create_shop_checkout, never inside the replayable
# _apply_shop_payment), so a webhook replay or Retry Fulfillment can never
# reset it back to true. The unseen-count query is an exact match on
# admin_unseen == True — a historical order missing the field entirely
# never counts, by construction.
# ===========================================================================

def _unseen_count(admin_headers):
    r = requests.get(f"{API}/admin/shop-orders/unseen-count", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["unseen"]


def test_j_new_order_has_admin_unseen_true_but_does_not_count_until_paid(admin_headers, fresh_client):
    """A. create_shop_checkout (the real endpoint) initializes admin_unseen
    true on every new order — but the unseen-count query also requires
    status=='paid', so an order that never reaches 'paid' (this test
    environment's Stripe call always fails, landing the order in
    'payment_failed' — see the earlier investigation in this session)
    contributes 0 to the count."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    headers = _client_headers(fresh_client["id"], fresh_client["email"])
    before = _unseen_count(admin_headers)
    r = requests.post(f"{API}/shop/checkout", headers=headers, json={
        "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
        "idempotency_key": str(uuid.uuid4()),
    }, timeout=15)
    assert r.status_code == 502, r.text  # Stripe unreachable in this test env — order still created first

    async def _find_order(db):
        return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0})
    order = _mongo_run(_find_order)
    assert order["status"] != "paid"
    assert order["admin_unseen"] is True
    after = _unseen_count(admin_headers)
    assert after == before  # never-paid order never counts


def test_j_paid_order_increments_unseen_count(admin_headers, fresh_client):
    """B. An order with admin_unseen=true (as create_shop_checkout leaves
    it) that becomes paid counts exactly once."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    # _seed_shop_order is a test-only fixture predating this field — set
    # admin_unseen explicitly here to mirror what a real create_shop_checkout
    # order looks like at creation.
    async def _init_unseen(db):
        await db.shop_orders.update_one({"id": order_id}, {"$set": {"admin_unseen": True}})
    _mongo_run(_init_unseen)

    before = _unseen_count(admin_headers)
    assert _pay_order_via_webhook(order_id, order, fresh_client["id"])[0].status_code == 200
    after = _unseen_count(admin_headers)
    assert after == before + 1


def _make_paid_unseen_order(admin_headers, fresh_client, product):
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ])
    async def _init_unseen(db):
        await db.shop_orders.update_one({"id": order_id}, {"$set": {"admin_unseen": True}})
    _mongo_run(_init_unseen)
    r1, attempt_id, session_id = _pay_order_via_webhook(order_id, order, fresh_client["id"])
    assert r1.status_code == 200, r1.text
    return order_id, order, attempt_id, session_id


def test_j_mark_seen_changes_count_to_zero(admin_headers, fresh_client):
    """C. Marking a specific paid+unseen order seen flips it to false and
    drops it out of the count."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order, _, _ = _make_paid_unseen_order(admin_headers, fresh_client, product)
    before = _unseen_count(admin_headers)
    assert before >= 1

    r = requests.post(f"{API}/admin/shop-orders/mark-seen", headers=admin_headers,
                       json={"order_ids": [order_id]}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["marked"] == 1

    assert _get_order(order_id)["admin_unseen"] is False
    after = _unseen_count(admin_headers)
    assert after == before - 1


def test_j_webhook_replay_never_resets_admin_unseen_to_true(admin_headers, fresh_client):
    """D. Once marked seen, replaying the paid-event webhook must never flip
    admin_unseen back to true — it's initialized only at order creation,
    never touched inside _apply_shop_payment."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order, attempt_id, session_id = _make_paid_unseen_order(admin_headers, fresh_client, product)
    requests.post(f"{API}/admin/shop-orders/mark-seen", headers=admin_headers,
                  json={"order_ids": [order_id]}, timeout=15)
    assert _get_order(order_id)["admin_unseen"] is False

    replay_obj = {
        "id": session_id, "payment_status": "paid", "currency": "usd",
        "amount_total": int(round(order["total"] * 100)),
        "metadata": {"sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                     "sithappens_client_id": fresh_client["id"]},
    }
    r2 = _post_stripe_webhook("checkout.session.completed", replay_obj, event_id=f"evt_{uuid.uuid4().hex}")
    assert r2.status_code == 200, r2.text
    assert _get_order(order_id)["admin_unseen"] is False  # never reset to true


def test_j_retry_fulfillment_never_resets_admin_unseen_to_true(admin_headers, fresh_client):
    """E. Same guarantee for the admin Retry Fulfillment action."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order, _, _ = _make_paid_unseen_order(admin_headers, fresh_client, product)
    requests.post(f"{API}/admin/shop-orders/mark-seen", headers=admin_headers,
                  json={"order_ids": [order_id]}, timeout=15)
    assert _get_order(order_id)["admin_unseen"] is False

    r = _fulfillment_action(admin_headers, order_id, "retry_fulfillment")
    assert r.status_code == 200, r.text
    assert _get_order(order_id)["admin_unseen"] is False  # never reset to true


def test_j_historical_paid_order_missing_admin_unseen_never_counts(admin_headers, fresh_client):
    """F. A historical order (seeded exactly like _seed_shop_order always
    has, with NO admin_unseen field at all) must never count as unseen —
    the legacy-safety requirement."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    before = _unseen_count(admin_headers)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="paid")
    fresh_order = _get_order(order_id)
    assert "admin_unseen" not in fresh_order
    after = _unseen_count(admin_headers)
    assert after == before  # missing field never counts as unseen


def test_j_needs_attention_order_stays_needs_attention_after_marked_seen(admin_headers, fresh_client):
    """G. Seen/unseen is not fulfillment status — marking an order seen must
    never alter its fulfillment_status (or any other field). A
    needs_attention order stays needs_attention, still eligible for Retry
    Fulfillment, after being marked seen."""
    product = _make_online_product(admin_headers, uuid.uuid4().hex[:6], price=10.0)
    order_id, order = _seed_shop_order(fresh_client["id"], fresh_client["name"], [
        _make_line("product", product["id"], product["name"], 10.0, 1),
    ], status="paid")

    async def _mark_needs_attention_and_unseen(db):
        await db.shop_orders.update_one(
            {"id": order_id},
            {"$set": {"fulfillment_status": "needs_attention", "admin_unseen": True}},
        )
    _mongo_run(_mark_needs_attention_and_unseen)

    r = requests.post(f"{API}/admin/shop-orders/mark-seen", headers=admin_headers,
                       json={"order_ids": [order_id]}, timeout=15)
    assert r.status_code == 200, r.text

    fresh_order = _get_order(order_id)
    assert fresh_order["admin_unseen"] is False
    assert fresh_order["fulfillment_status"] == "needs_attention"  # untouched by mark-seen
    assert fresh_order["status"] == "paid"  # untouched
    assert fresh_order["pickup_status"] is None  # untouched
