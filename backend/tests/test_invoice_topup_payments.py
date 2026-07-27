"""Payment rebuild Phase 2 — Cash + manual payments + register.

Black-box HTTP against a live server, same convention as
test_invoice_foundation.py. Covers: multi-tender top-ups reaching $0,
overpayment rejection, method/tender validation, the open-drawer gate,
top-up idempotency (including payload/resource mismatch), sequential
top-ups tracking AR correctly, AR reconciliation (including legacy
ambiguity), the apply_tab_payment AR-backed guard, refund-status
(credits excluded from the threshold), the refund-activity guard on both
top-up and void, void-exactly-once, exact Payment<->ledger<->retail_sales
linkage, the register-session read model's NOT_OPEN/OPEN/CLOSED states,
and the post-closeout refund-ceiling compatibility fix.
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
    requests.post(f"{API}/admin/register/open-drawer", headers=headers,
                  json={"opening_cash": 100.0}, timeout=15)
    return headers


def _mongo_run(async_fn):
    """Run ONE async DB operation with its own fresh client + event loop.

    Motor's AsyncIOMotorClient caches the event loop of whichever operation
    touches it first; calling asyncio.run() more than once against a client
    created outside that call breaks with "no current event loop" on the
    second call, since asyncio.run() tears its loop down on exit. A fresh
    client per call sidesteps this entirely — async_fn receives `db` and
    should return whatever the caller needs.
    """
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _server_business_today(admin_headers):
    """The server resolves "today" in US Eastern (business_today()), which
    can differ from the test machine's local date.today() near midnight or
    under a different local timezone — always ask the server directly
    rather than assuming they match."""
    r = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["date"]


def _make_client_and_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Topup Test {tag}", "email": f"topup-{tag}@example.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    return client, dog


def _book_and_checkin(admin_headers, client, dog, service_type="daycare"):
    # override_capacity: same shared-DB isolation fix as the other test files
    # using this "+10 days" date convention.
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


@pytest.fixture
def fresh_client_and_dog(admin_headers):
    client, dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    yield client, dog
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0):
    """AR-backed invoice: checkout with an explicit partial amount_paid,
    leaving a balance that WAS posted to payment_ledger/account_balance."""
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


def _topup(admin_headers, invoice_id, amount, method="check", tendered_amount=None, notes=None, key=None):
    body = {"amount": amount, "method": method, "idempotency_key": key or uuid.uuid4().hex}
    if tendered_amount is not None:
        body["tendered_amount"] = tendered_amount
    if notes is not None:
        body["notes"] = notes
    return requests.post(f"{API}/invoices/{invoice_id}/payments", headers=admin_headers, json=body, timeout=15)


# ---------------------------------------------------------------------------
# 1. Multi-tender top-up reaching exact $0, and overpayment rejection
# ---------------------------------------------------------------------------

def test_multi_tender_topup_reaches_zero_balance(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)

    r1 = _topup(admin_headers, invoice["id"], 75.0, method="check")
    assert r1.status_code == 200, r1.text
    inv1 = r1.json()["invoice"]
    assert abs(inv1["balance"] - 50.0) < 0.01
    assert inv1["status"] == "PARTIALLY_PAID"

    r2 = _topup(admin_headers, invoice["id"], 50.0, method="venmo")
    assert r2.status_code == 200, r2.text
    inv2 = r2.json()["invoice"]
    assert abs(inv2["balance"]) < 0.01
    assert inv2["status"] == "PAID"


def test_topup_exceeding_balance_rejected_zero_mutation(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = _topup(admin_headers, invoice["id"], 200.0, method="check")
    assert r.status_code == 409, r.text
    fresh = _get_invoice(admin_headers, bid)
    assert abs(fresh["balance"] - 125.0) < 0.01
    assert fresh["status"] == "PARTIALLY_PAID"


# ---------------------------------------------------------------------------
# 2. Validation: other-without-notes, cash tender rules
# ---------------------------------------------------------------------------

def test_other_without_notes_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    r = _topup(admin_headers, invoice["id"], 10.0, method="other", notes="")
    assert r.status_code == 400, r.text


def test_cash_requires_tendered_amount(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    r = _topup(admin_headers, invoice["id"], 10.0, method="cash")
    assert r.status_code == 400, r.text


def test_cash_tendered_less_than_amount_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    r = _topup(admin_headers, invoice["id"], 50.0, method="cash", tendered_amount=40.0)
    assert r.status_code == 400, r.text


def test_non_cash_with_tendered_amount_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    r = _topup(admin_headers, invoice["id"], 10.0, method="check", tendered_amount=20.0)
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 3. Open-drawer gate for cash top-ups (and single/group checkout)
# ---------------------------------------------------------------------------

def test_cash_topup_blocked_without_open_drawer(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog)
    today = _server_business_today(admin_headers)

    async def _pop_session(db):
        session = await db.cash_drawer_sessions.find_one({"date": today})
        await db.cash_drawer_sessions.delete_one({"date": today})
        return session
    session = _mongo_run(_pop_session)
    try:
        r = _topup(admin_headers, invoice["id"], 50.0, method="cash", tendered_amount=50.0)
        assert r.status_code == 400, r.text
    finally:
        if session:
            session.pop("_id", None)
            _mongo_run(lambda db: db.cash_drawer_sessions.insert_one(session))
        else:
            requests.post(f"{API}/admin/register/open-drawer", headers=admin_headers,
                          json={"opening_cash": 100.0}, timeout=15)


def test_cash_checkout_blocked_without_open_drawer(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    today = _server_business_today(admin_headers)

    async def _pop_session(db):
        session = await db.cash_drawer_sessions.find_one({"date": today})
        await db.cash_drawer_sessions.delete_one({"date": today})
        return session
    session = _mongo_run(_pop_session)
    try:
        r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                           json={"use_credits": False, "base_price": 30.0,
                                 "payment_method": "cash", "payment_status": "paid"},
                           timeout=15)
        assert r.status_code == 400, r.text
        fresh_booking = requests.get(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15).json()
        assert fresh_booking.get("status") != "completed", "checkout must not have committed"
    finally:
        if session:
            session.pop("_id", None)
            _mongo_run(lambda db: db.cash_drawer_sessions.insert_one(session))
        else:
            requests.post(f"{API}/admin/register/open-drawer", headers=admin_headers,
                          json={"opening_cash": 100.0}, timeout=15)


def test_cash_topup_increases_expected_cash_noncash_does_not(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)

    before = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()
    r_check = _topup(admin_headers, invoice["id"], 25.0, method="check")
    assert r_check.status_code == 200, r_check.text
    after_check = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()
    assert abs(after_check["expected_cash"] - before["expected_cash"]) < 0.01, "check top-up must not move expected_cash"

    r_cash = _topup(admin_headers, invoice["id"], 25.0, method="cash", tendered_amount=25.0)
    assert r_cash.status_code == 200, r_cash.text
    after_cash = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()
    assert abs(after_cash["expected_cash"] - after_check["expected_cash"] - 25.0) < 0.01, "cash top-up must increase expected_cash by exactly the amount"


# ---------------------------------------------------------------------------
# 4. Idempotency: retry, resource mismatch, payload mismatch
# ---------------------------------------------------------------------------

def test_topup_idempotency_retry_does_not_double_collect(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    key = uuid.uuid4().hex

    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check", key=key)
    assert r1.status_code == 200, r1.text
    r2 = _topup(admin_headers, invoice["id"], 50.0, method="check", key=key)
    assert r2.status_code == 200, r2.text
    assert r1.json()["payment"]["id"] == r2.json()["payment"]["id"]

    fresh = _get_invoice(admin_headers, bid)
    assert abs(fresh["balance"] - 75.0) < 0.01, "retry must not double-collect"
    matching_payments = [p for p in fresh["payments"] if p.get("idempotency_ref", "").endswith(key)]
    assert len(matching_payments) == 1


def test_topup_same_key_different_invoice_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid1, inv1 = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    bid2 = _book_and_checkin(admin_headers, client, dog)
    r_second_checkout = requests.post(f"{API}/bookings/{bid2}/check-out", headers=admin_headers,
                                       json={"use_credits": False, "base_price": 100.0,
                                             "amount_paid": 20.0, "payment_method": "cash"},
                                       timeout=15)
    assert r_second_checkout.status_code == 200, r_second_checkout.text
    inv2 = _get_invoice(admin_headers, bid2)

    key = uuid.uuid4().hex
    r1 = _topup(admin_headers, inv1["id"], 25.0, method="check", key=key)
    assert r1.status_code == 200, r1.text
    r2 = _topup(admin_headers, inv2["id"], 25.0, method="check", key=key)
    assert r2.status_code == 409, r2.text


def test_topup_same_key_different_payload_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    key = uuid.uuid4().hex
    r1 = _topup(admin_headers, invoice["id"], 25.0, method="check", key=key)
    assert r1.status_code == 200, r1.text
    r2 = _topup(admin_headers, invoice["id"], 75.0, method="check", key=key)
    assert r2.status_code == 409, r2.text
    fresh = _get_invoice(admin_headers, bid)
    assert abs(fresh["balance"] - 100.0) < 0.01, "mismatched-payload replay must not have collected the second amount"


# ---------------------------------------------------------------------------
# 5. Multiple sequential top-ups — AR net tracks correctly across each
# ---------------------------------------------------------------------------

def test_sequential_topups_track_ar_correctly(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    balance_after_checkout = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance_after_checkout - 125.0) < 0.01

    r1 = _topup(admin_headers, invoice["id"], 75.0, method="check")
    assert r1.status_code == 200, r1.text
    bal1 = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(bal1 - 50.0) < 0.01

    r2 = _topup(admin_headers, invoice["id"], 50.0, method="venmo")
    assert r2.status_code == 200, r2.text
    bal2 = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(bal2) < 0.01
    assert r2.json()["invoice"]["status"] == "PAID"


# ---------------------------------------------------------------------------
# 6. AR reconciliation: not-AR-backed, drift, legacy ambiguity
# ---------------------------------------------------------------------------

def test_topup_not_ar_backed_leaves_balance_unchanged(admin_headers, fresh_client_and_dog):
    """Checkout 'unpaid' with NO explicit amount_paid — the balance is
    never posted to AR at all. A top-up must still succeed (money is
    still recorded) but must not touch client.account_balance."""
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 90.0, "payment_status": "unpaid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    assert invoice["status"] == "OPEN"
    balance_before = _get_client(admin_headers, client["id"])["account_balance"]

    r2 = _topup(admin_headers, invoice["id"], 90.0, method="check")
    assert r2.status_code == 200, r2.text
    assert abs(r2.json()["invoice"]["balance"]) < 0.01
    balance_after = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance_after - balance_before) < 0.01, "not-AR-backed top-up must not touch account_balance"


def test_topup_rejected_when_booking_net_drifts_from_balance(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    try:
        # Simulate drift: a ledger row tagged to this booking that doesn't
        # match what _apply_booking_partial_payment actually wrote.
        _mongo_run(lambda db: db.payment_ledger.insert_one({
            "id": str(uuid.uuid4()), "client_id": client["id"], "type": "adjustment",
            "amount": -10.0, "method": "", "notes": "simulated drift", "booking_id": bid,
            "invoice_id": None, "created_by": "test", "created_at": "2099-01-01T00:00:00+00:00",
            "operation_id": None,
        }))
        r = _topup(admin_headers, invoice["id"], 50.0, method="check")
        assert r.status_code == 409, r.text
        fresh = _get_invoice(admin_headers, bid)
        assert abs(fresh["balance"] - 125.0) < 0.01
    finally:
        _mongo_run(lambda db: db.payment_ledger.delete_many({"booking_id": bid, "notes": "simulated drift"}))


def test_topup_rejected_on_legacy_ambiguous_generic_ledger_activity(admin_headers, fresh_client_and_dog):
    """AR-backed AND booking_net == invoice.balance (fully reconciled by
    net-sum) but a fully untagged (booking_id=None, invoice_id=None)
    client-level ledger row exists after the charge — simulating
    pre-Phase-2 generic apply_tab_payment activity. Must be rejected even
    though the net-sum check alone would have passed."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    try:
        _mongo_run(lambda db: db.payment_ledger.insert_one({
            "id": str(uuid.uuid4()), "client_id": client["id"], "type": "payment",
            "amount": -1.0, "method": "cash", "notes": "simulated legacy generic activity",
            "booking_id": None, "invoice_id": None, "created_by": "test",
            "created_at": "2099-01-01T00:00:00+00:00", "operation_id": None,
        }))
        r = _topup(admin_headers, invoice["id"], 50.0, method="check")
        assert r.status_code == 409, r.text
    finally:
        _mongo_run(lambda db: db.payment_ledger.delete_many({"notes": "simulated legacy generic activity"}))


# ---------------------------------------------------------------------------
# 7. apply_tab_payment AR-backed guard
# ---------------------------------------------------------------------------

def test_apply_tab_payment_blocked_for_ar_backed_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = requests.post(f"{API}/clients/{client['id']}/payment", headers=admin_headers,
                       json={"amount": 125.0, "method": "cash", "tendered_amount": 125.0}, timeout=15)
    assert r.status_code == 409, r.text
    fresh = _get_invoice(admin_headers, bid)
    assert abs(fresh["balance"] - 125.0) < 0.01
    balance = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance - 125.0) < 0.01

    r2 = _topup(admin_headers, invoice["id"], 125.0, method="check")
    assert r2.status_code == 200, r2.text
    assert abs(r2.json()["invoice"]["balance"]) < 0.01


def test_apply_tab_payment_allowed_for_legacy_ar_with_non_ar_backed_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    # Non-AR-backed open invoice (unpaid, no explicit amount_paid).
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 40.0, "payment_status": "unpaid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    # Separate legacy AR, unrelated to any invoice.
    _mongo_run(lambda db: db.clients.update_one({"id": client["id"]}, {"$inc": {"account_balance": 60.0}}))
    r2 = requests.post(f"{API}/clients/{client['id']}/payment", headers=admin_headers,
                        json={"amount": 60.0, "method": "cash", "tendered_amount": 60.0}, timeout=15)
    assert r2.status_code == 200, r2.text


# ---------------------------------------------------------------------------
# 8. Refund-status regression: credits excluded from the refund threshold
# ---------------------------------------------------------------------------

def test_refund_status_threshold_excludes_credits(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    lot_id = str(uuid.uuid4())

    async def _seed():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ.get("DB_NAME", "sit_happens")]
        # Matches test_invoice_foundation.py's own proven-working
        # split-credit-and-cash configuration exactly (1 credit worth $50
        # covers the base visit; additional_cash_charge is the uncovered
        # cash portion on top).
        await db.credit_lots.insert_one({
            "id": lot_id, "client_id": client["id"], "pack_id": "test-pack", "pack_name": "Test 1-Pack",
            "service_type": "daycare", "qty_total": 1, "qty_remaining": 1, "price_paid": 50.0,
            "list_price": 50.0, "value_each": 50.0, "payment_method": "card", "note": "test seed",
            "sold_by": "test-seed", "purchased_at": "2025-01-01T00:00:00+00:00",
        })
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 1}})
        mc.close()

    asyncio.run(_seed())
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": True, "additional_cash_charge": 30.0, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    amount_paid = invoice["amount_paid"]
    assert amount_paid > 0

    rr1 = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": round(amount_paid / 2, 2), "payment_method": "cash", "reason": "partial",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr1.status_code == 200, rr1.text
    mid = _get_invoice(admin_headers, bid)
    assert mid["status"] == "PARTIALLY_REFUNDED"

    rr2 = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": round(amount_paid - round(amount_paid / 2, 2), 2), "payment_method": "cash", "reason": "rest",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr2.status_code == 200, rr2.text
    final = _get_invoice(admin_headers, bid)
    assert final["status"] == "REFUNDED", "fully refunding the cash portion must reach REFUNDED even though the credit portion was never refunded"


# ---------------------------------------------------------------------------
# 9. Refund-activity guard on top-up and void
# ---------------------------------------------------------------------------

def test_topup_rejected_on_partially_refunded_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 100.0, "payment_method": "cash",
                             "payment_status": "paid"}, timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 20.0, "payment_method": "cash", "reason": "test", "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr.status_code == 200, rr.text
    invoice_after = _get_invoice(admin_headers, bid)
    assert invoice_after["status"] == "PARTIALLY_REFUNDED"

    r2 = _topup(admin_headers, invoice["id"], 10.0, method="check")
    assert r2.status_code == 400, r2.text


def test_void_rejected_when_invoice_has_refund_activity(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check")
    assert r1.status_code == 200, r1.text
    payment_id = r1.json()["payment"]["id"]

    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 20.0, "payment_method": "cash", "reason": "test", "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr.status_code == 200, rr.text

    rv = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                        json={"reason": "test void", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv.status_code == 409, rv.text
    fresh_payment = requests.get(f"{API}/invoices/{invoice['id']}", headers=admin_headers, timeout=15).json()
    matching = [p for p in fresh_payment["payments"] if p["id"] == payment_id]
    assert matching[0]["status"] == "completed", "rejected void must not have mutated the payment"


# ---------------------------------------------------------------------------
# 10. Void: success, closed-day rejection, exactly-once, idempotency
# ---------------------------------------------------------------------------

def test_void_reverses_topup_exactly(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check")
    assert r1.status_code == 200, r1.text
    payment_id = r1.json()["payment"]["id"]
    balance_after_topup = _get_client(admin_headers, client["id"])["account_balance"]

    rv = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                        json={"reason": "mistaken entry", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv.status_code == 200, rv.text
    fresh = _get_invoice(admin_headers, bid)
    assert abs(fresh["balance"] - 125.0) < 0.01, "void must restore the pre-topup balance"
    balance_after_void = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance_after_void - balance_after_topup - 50.0) < 0.01, "void must restore the AR debit"


def test_void_exactly_once_different_keys_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check")
    assert r1.status_code == 200, r1.text
    payment_id = r1.json()["payment"]["id"]

    rv1 = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                         json={"reason": "first void", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv1.status_code == 200, rv1.text
    balance_after_first_void = _get_client(admin_headers, client["id"])["account_balance"]

    rv2 = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                         json={"reason": "second attempt, different key", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv2.status_code == 409, rv2.text
    balance_after_second_attempt = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance_after_second_attempt - balance_after_first_void) < 0.01, "second void attempt must not double-reverse"

    invoice_final = _get_invoice(admin_headers, bid)
    reversal_payments = [p for p in invoice_final["payments"] if (p.get("source") or {}).get("voided_payment_id") == payment_id]
    assert len(reversal_payments) == 1, "exactly one reversal Payment row must exist"


def test_void_same_key_retry_replays_cleanly(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check")
    payment_id = r1.json()["payment"]["id"]
    key = uuid.uuid4().hex
    rv1 = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                         json={"reason": "same key retry test", "idempotency_key": key}, timeout=15)
    assert rv1.status_code == 200, rv1.text
    rv2 = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                         json={"reason": "same key retry test", "idempotency_key": key}, timeout=15)
    assert rv2.status_code == 200, rv2.text
    balance = _get_client(admin_headers, client["id"])["account_balance"]
    invoice_final = _get_invoice(admin_headers, bid)
    assert abs(invoice_final["balance"] - 125.0) < 0.01


def test_void_rejected_after_closeout(admin_headers, fresh_client_and_dog):
    """Simulate a closed business day for the top-up's business_date by
    injecting a synthetic daily_closeouts row (never touching real
    cash_drawer_sessions/register state), then confirm the void is
    rejected with zero mutation."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r1 = _topup(admin_headers, invoice["id"], 50.0, method="check")
    assert r1.status_code == 200, r1.text
    payment_id = r1.json()["payment"]["id"]
    business_date = r1.json()["payment"]["business_date"]

    closeout_id = str(uuid.uuid4())
    try:
        _mongo_run(lambda db: db.daily_closeouts.insert_one({
            "id": closeout_id, "date": business_date, "created_at": "2099-01-01T00:00:00+00:00",
            "created_by": "test", "created_by_name": "test", "status": "closed",
        }))
        rv = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                            json={"reason": "should be rejected", "idempotency_key": uuid.uuid4().hex}, timeout=15)
        assert rv.status_code == 409, rv.text
        fresh_payment = requests.get(f"{API}/invoices/{invoice['id']}", headers=admin_headers, timeout=15).json()
        matching = [p for p in fresh_payment["payments"] if p["id"] == payment_id]
        assert matching[0]["status"] == "completed"
    finally:
        _mongo_run(lambda db: db.daily_closeouts.delete_one({"id": closeout_id}))


# ---------------------------------------------------------------------------
# 11. Exact-reference linkage: independent top-ups, void only one
# ---------------------------------------------------------------------------

def test_two_topups_have_distinct_ledger_and_retail_links_void_one_leaves_other_untouched(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)

    r1 = _topup(admin_headers, invoice["id"], 75.0, method="check")
    assert r1.status_code == 200, r1.text
    p1 = r1.json()["payment"]
    r2 = _topup(admin_headers, invoice["id"], 50.0, method="cash", tendered_amount=50.0)
    assert r2.status_code == 200, r2.text
    p2 = r2.json()["payment"]

    assert p1["ledger_id"] and p2["ledger_id"] and p1["ledger_id"] != p2["ledger_id"]

    async def _fetch_both(db):
        rs1 = await db.retail_sales.find_one({"payment_id": p1["id"]})
        rs2 = await db.retail_sales.find_one({"payment_id": p2["id"]})
        return rs1, rs2
    rs1, rs2 = _mongo_run(_fetch_both)
    assert rs1 is not None and rs2 is not None
    assert rs1["id"] != rs2["id"]

    balance_before_void = _get_client(admin_headers, client["id"])["account_balance"]
    rv = requests.post(f"{API}/payments/{p1['id']}/void", headers=admin_headers,
                        json={"reason": "void only this one", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv.status_code == 200, rv.text
    balance_after_void = _get_client(admin_headers, client["id"])["account_balance"]
    assert abs(balance_after_void - balance_before_void - 75.0) < 0.01

    fresh = requests.get(f"{API}/invoices/{invoice['id']}", headers=admin_headers, timeout=15).json()
    p2_fresh = [p for p in fresh["payments"] if p["id"] == p2["id"]][0]
    assert p2_fresh["status"] == "completed", "the OTHER top-up must be completely untouched"
    assert abs(fresh["balance"] - 75.0) < 0.01  # 200 - 75(orig) - 50(p2 remains) = 75


# ---------------------------------------------------------------------------
# 12. Register-session view: NOT_OPEN / OPEN / CLOSED / OPEN-after-reopen
# ---------------------------------------------------------------------------

def test_register_session_view_states(admin_headers):
    synthetic_date = "2019-06-15"  # obscure, unlikely to collide with any seeded data
    try:
        _mongo_run(lambda db: db.cash_drawer_sessions.delete_many({"date": synthetic_date}))
        _mongo_run(lambda db: db.daily_closeouts.delete_many({"date": synthetic_date}))

        r_not_open = requests.get(f"{API}/admin/register/session", headers=admin_headers,
                                   params={"date": synthetic_date}, timeout=15)
        assert r_not_open.status_code == 200, r_not_open.text
        assert r_not_open.json()["status"] == "NOT_OPEN"

        _mongo_run(lambda db: db.cash_drawer_sessions.insert_one({
            "date": synthetic_date, "opening_cash": 50.0, "opened_at": "2019-06-15T08:00:00+00:00",
            "opened_by_name": "test",
        }))
        r_open = requests.get(f"{API}/admin/register/session", headers=admin_headers,
                               params={"date": synthetic_date}, timeout=15)
        assert r_open.json()["status"] == "OPEN"

        closeout_id = str(uuid.uuid4())
        _mongo_run(lambda db: db.daily_closeouts.insert_one({
            "id": closeout_id, "date": synthetic_date, "created_at": "2019-06-15T20:00:00+00:00",
            "created_by": "test", "created_by_name": "test", "status": "closed",
        }))
        r_closed = requests.get(f"{API}/admin/register/session", headers=admin_headers,
                                 params={"date": synthetic_date}, timeout=15)
        assert r_closed.json()["status"] == "CLOSED"

        _mongo_run(lambda db: db.daily_closeouts.update_one({"id": closeout_id}, {"$set": {
            "reopened_at": "2019-06-16T08:00:00+00:00", "reopened_reason": "test reopen",
            "reopened_by_name": "test",
        }}))
        r_reopened = requests.get(f"{API}/admin/register/session", headers=admin_headers,
                                   params={"date": synthetic_date}, timeout=15)
        assert r_reopened.json()["status"] == "OPEN", "a reopened day must read OPEN again, not CLOSED"
    finally:
        _mongo_run(lambda db: db.cash_drawer_sessions.delete_many({"date": synthetic_date}))
        _mongo_run(lambda db: db.daily_closeouts.delete_many({"date": synthetic_date}))


# ---------------------------------------------------------------------------
# 13. Cash refund still reduces expected_cash (existing mechanism, verified)
# ---------------------------------------------------------------------------

def test_cash_refund_reduces_expected_cash(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 60.0, "payment_method": "cash",
                             "payment_status": "paid"}, timeout=15)
    assert r.status_code == 200, r.text
    before = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()
    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 20.0, "payment_method": "cash", "reason": "test", "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr.status_code == 200, rr.text
    after = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()
    assert abs(after["expected_cash"] - before["expected_cash"] + 20.0) < 0.01


# ---------------------------------------------------------------------------
# 14. Checkout-time tendered/change (single checkout)
# ---------------------------------------------------------------------------

def test_checkout_cash_tendered_and_change_recorded(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 65.0, "payment_method": "cash",
                             "payment_status": "paid", "tendered_amount": 80.0},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert abs(float(booking["actual_price"]) - 65.0) < 0.01, "tendered_amount must not change pricing"
    invoice = _get_invoice(admin_headers, bid)
    cash_payment = [p for p in invoice["payments"] if not p["is_credit"]][0]
    assert abs(cash_payment["tendered_amount"] - 80.0) < 0.01
    assert abs(cash_payment["change_given"] - 15.0) < 0.01


def test_checkout_noncash_with_tendered_amount_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 65.0, "payment_method": "check",
                             "payment_status": "paid", "tendered_amount": 80.0},
                       timeout=15)
    assert r.status_code == 400, r.text


def test_checkout_other_without_note_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 65.0, "payment_method": "other",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# 15. Group checkout regression: unmodified behavior + OTHER-note required
# ---------------------------------------------------------------------------

def test_group_checkout_other_without_note_rejected(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client, dog1 = _make_client_and_dog(admin_headers, tag)
    dog2 = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog2 {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 2,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    try:
        r = requests.post(f"{API}/bookings/group", headers=admin_headers, json={
            "dogs": [{"dog_id": dog1["id"]}, {"dog_id": dog2["id"]}],
            "date": TODAY, "service_type": "daycare", "override_vaccines": True,
            "override_capacity": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for b in bookings:
            requests.post(f"{API}/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{API}/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)
        out = requests.post(f"{API}/bookings/{bookings[1]['id']}/check-out-group",
                             headers=admin_headers, json={"payment_method": "other"}, timeout=30)
        assert out.status_code == 400, out.text
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 16. Refund-ceiling compatibility fix (§13 of the Phase 2 plan)
# ---------------------------------------------------------------------------

def test_refund_ceiling_includes_topup_money(admin_headers, fresh_client_and_dog):
    """Checkout $75 of $200, top-up the remaining $125 -> invoice.amount_paid
    becomes $200 even though booking.amount_paid is frozen at $75. A $100
    refund must succeed because the true collected amount was $200."""
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = _topup(admin_headers, invoice["id"], 125.0, method="check")
    assert r.status_code == 200, r.text
    assert abs(r.json()["invoice"]["amount_paid"] - 200.0) < 0.01

    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 100.0, "payment_method": "cash", "reason": "post-topup refund",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr.status_code == 200, f"refund against top-up money must succeed, not be capped at frozen booking.amount_paid=$75: {rr.text}"


def test_voided_topup_does_not_inflate_refund_ceiling(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)
    r = _topup(admin_headers, invoice["id"], 125.0, method="check")
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment"]["id"]

    rv = requests.post(f"{API}/payments/{payment_id}/void", headers=admin_headers,
                        json={"reason": "voiding before closeout", "idempotency_key": uuid.uuid4().hex}, timeout=15)
    assert rv.status_code == 200, rv.text
    fresh_invoice = _get_invoice(admin_headers, bid)
    assert abs(fresh_invoice["amount_paid"] - 75.0) < 0.01

    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 100.0, "payment_method": "cash", "reason": "should be capped at 75",
        "refund_idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert rr.status_code == 409, f"a voided top-up must contribute nothing to the refundable ceiling: {rr.text}"


def test_group_invoice_refund_ceiling_uses_per_booking_amount(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client, dog1 = _make_client_and_dog(admin_headers, tag)
    dog2 = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog2 {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 2,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    try:
        r = requests.post(f"{API}/bookings/group", headers=admin_headers, json={
            "dogs": [{"dog_id": dog1["id"]}, {"dog_id": dog2["id"]}],
            "date": TODAY, "service_type": "daycare", "override_vaccines": True,
            "override_capacity": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for b in bookings:
            requests.post(f"{API}/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{API}/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)
        out = requests.post(f"{API}/bookings/{bookings[1]['id']}/check-out-group",
                             headers=admin_headers, json={"payment_method": "cash", "payment_status": "paid"}, timeout=30)
        assert out.status_code == 200, out.text
        completed = out.json()["bookings"]
        first_bid = completed[0]["id"]
        first_booking = requests.get(f"{API}/bookings/{first_bid}", headers=admin_headers, timeout=15).json()
        per_dog_paid = float(first_booking.get("amount_paid") or 0)
        assert per_dog_paid > 0

        # A refund exceeding THIS booking's own amount_paid must be rejected,
        # even though the group invoice's combined amount_paid is larger.
        rr = requests.post(f"{API}/bookings/{first_bid}/refund", headers=admin_headers, json={
            "amount": per_dog_paid + 50.0, "payment_method": "cash", "reason": "must be capped per-booking",
            "refund_idempotency_key": uuid.uuid4().hex,
        }, timeout=15)
        assert rr.status_code == 409, rr.text
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)
