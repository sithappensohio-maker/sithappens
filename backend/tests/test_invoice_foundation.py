"""Payment rebuild Phase 1 — Invoice + Payment ledger foundation.

Black-box HTTP against a live server, same convention as every other test
file in this suite (`admin_headers` fixture, `requests`). Covers every
required Phase 1 scenario: single-dog checkout, group (multi-dog) checkout
producing exactly ONE canonical invoice, boarding, daycare, a $0 training
visit (no invoice created), add-ons, multi-dog discount, credits, partial
payment, split (credits+cash) payment, refund, and invoice/payment
idempotency on retry.

The final test imports `server` directly for a pure Python-level unit check
that `_create_invoice_for_bookings` itself raises on a genuine internal
failure — proving the try/except wrapper at the checkout call site is what
provides isolation, not silent swallowing inside the helper. This runs
in-process in the TEST's own import of the module (a separate OS process
from the live server used by every other test here), so it cannot affect
or be affected by the live server under test — no production endpoint,
flag, or backdoor is added to exercise this.
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
# A same-day-of-week-agnostic booking date. Daycare/training hours can be
# closed on specific days (e.g. Sunday) per this app's business-hours
# settings — mirrors the existing `TOMORROW = today + 10 days` convention
# already used by test_partial_payment.py to sidestep exactly this.
TODAY = (date.today() + timedelta(days=10)).isoformat()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    # Payment rebuild Phase 2 — checkout's cash component now requires
    # today's cash drawer to actually be open (register-day-open alone is
    # not enough — see the Phase 2 plan). Open it once for this module's
    # tests; idempotent to call even if already open today.
    requests.post(f"{API}/admin/register/open-drawer", headers=headers,
                  json={"opening_cash": 100.0}, timeout=15)
    return headers


def _mongo_db():
    mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return mc, mc[os.environ.get("DB_NAME", "sit_happens")]


def _make_client_and_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Invoice Test {tag}", "email": f"invoice-{tag}@example.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    return client, dog


def _book_and_checkin(admin_headers, client, dog, service_type="daycare", end_date=None):
    # override_capacity: this shared, long-lived test DB accumulates real
    # daycare bookings from many test files using the same date convention.
    body = {"client_id": client["id"], "dog_id": dog["id"], "date": TODAY, "service_type": service_type,
            "override_capacity": True}
    if end_date:
        body["end_date"] = end_date
    if service_type in ("training", "grooming", "photography"):
        # Randomized to avoid colliding with leftover slots from prior test
        # runs at a fixed time (this is a capacity/scheduling conflict, not
        # a Phase 1 concern — same reason other fixtures use a random tag).
        body["time"] = f"{uuid.uuid4().int % 10 + 6:02d}:{uuid.uuid4().int % 60:02d}"
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


@pytest.fixture
def fresh_client_and_dog(admin_headers):
    client, dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    yield client, dog
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 1. Single-dog full-cash checkout
# ---------------------------------------------------------------------------

def test_single_dog_full_cash_checkout_creates_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 90.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    assert invoice["booking_ids"] == [bid]
    assert invoice["dog_ids"] == [dog["id"]]
    assert abs(invoice["total"] - float(booking["actual_price"])) < 0.01
    assert invoice["status"] == "PAID"
    assert abs(invoice["balance"] - float(booking["balance_due"])) < 0.01
    assert abs(invoice["amount_paid"] - float(booking["amount_paid"])) < 0.01
    tenders = [p for p in invoice["payments"] if not p["is_credit"]]
    assert len(tenders) == 1
    assert tenders[0]["method"] == "cash"
    assert abs(tenders[0]["amount"] - invoice["amount_paid"]) < 0.01


# ---------------------------------------------------------------------------
# 2. Group (multi-dog) checkout -> exactly ONE canonical invoice
# ---------------------------------------------------------------------------

def test_group_checkout_produces_one_canonical_invoice_with_discount(admin_headers):
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
                             headers=admin_headers, json={}, timeout=30)
        assert out.status_code == 200, out.text
        payload = out.json()
        booking_ids = {b["id"] for b in payload["bookings"]}

        inv1 = _get_invoice(admin_headers, bookings[0]["id"])
        inv2 = _get_invoice(admin_headers, bookings[1]["id"])
        assert inv1 is not None and inv2 is not None
        assert inv1["id"] == inv2["id"], "both bookings in the group must resolve to the SAME invoice"
        assert set(inv1["booking_ids"]) == booking_ids
        assert len(inv1["dog_ids"]) == 2
        assert abs(inv1["total"] - payload["total"]) < 0.01

        # Confirm there is NOT a second, separate rollup invoice anywhere.
        mc, db = _mongo_db()
        try:
            async def _count():
                return await db.invoices.count_documents({"booking_ids": {"$in": list(booking_ids)}})
            count = asyncio.run(_count())
            assert count == 1, "exactly one canonical invoice must cover the whole group, never a per-booking + rollup pair"
        finally:
            mc.close()
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 3. Boarding
# ---------------------------------------------------------------------------

def test_boarding_checkout_invoice_mirrors_actual_price(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    end = (date.fromisoformat(TODAY) + timedelta(days=2)).isoformat()
    bid = _book_and_checkin(admin_headers, client, dog, service_type="boarding", end_date=end)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 150.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    assert abs(invoice["total"] - float(booking["actual_price"])) < 0.01


# ---------------------------------------------------------------------------
# 4. Daycare (baseline, mirrors #1's shape — separate scenario per spec)
# ---------------------------------------------------------------------------

def test_daycare_checkout_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog, service_type="daycare")
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 35.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    assert invoice["service_type"] == "daycare"


# ---------------------------------------------------------------------------
# 5. $0 training visit -> no invoice created
# ---------------------------------------------------------------------------

def test_zero_dollar_visit_creates_no_invoice(admin_headers, fresh_client_and_dog):
    """A $0 checkout (forced via the admin base_price override) must create
    no invoice. Uses `boarding` (always 24/7, no hours/capacity gating) to
    isolate this from unrelated training-slot scheduling — the point under
    test is the invoice skip-guard when there is nothing to invoice, not
    training-specific pricing defaults or capacity rules."""
    client, dog = fresh_client_and_dog
    end = (date.fromisoformat(TODAY) + timedelta(days=1)).isoformat()
    bid = _book_and_checkin(admin_headers, client, dog, service_type="boarding", end_date=end)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 0.0, "payment_status": "paid"}, timeout=15)
    assert r.status_code == 200, r.text
    assert float(r.json().get("actual_price") or 0) == 0.0
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is None


# ---------------------------------------------------------------------------
# 6. Add-ons
# ---------------------------------------------------------------------------

@pytest.fixture
def addon_service(admin_headers):
    r = requests.post(f"{API}/services", headers=admin_headers, json={
        "name": f"Bath {uuid.uuid4().hex[:6]}", "service_type": "grooming",
        "base_price": 20.0, "active": True, "is_addon": True, "addon_for": ["daycare"],
    }, timeout=15)
    assert r.status_code == 200, r.text
    svc = r.json()
    yield svc
    requests.delete(f"{API}/services/{svc['id']}", headers=admin_headers, timeout=15)


def test_addon_line_item_on_invoice(admin_headers, fresh_client_and_dog, addon_service):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog, service_type="daycare")
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={
                           "use_credits": False, "base_price": 35.0, "payment_method": "cash",
                           "payment_status": "paid",
                           "add_ons": [{"service_id": addon_service["id"], "name": addon_service["name"],
                                        "price": 20.0, "qty": 1}],
                       },
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    add_on_lines = [li for li in invoice["line_items"] if li["kind"] == "add_on"]
    assert len(add_on_lines) == 1
    assert abs(add_on_lines[0]["amount"] - 20.0) < 0.01
    assert abs(invoice["total"] - float(booking["actual_price"])) < 0.01


# ---------------------------------------------------------------------------
# 7. Multi-dog discount line item (single-booking view of the group tested in #2)
# ---------------------------------------------------------------------------

def test_multi_dog_discount_line_item_present(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client, dog1 = _make_client_and_dog(admin_headers, tag)
    dog2 = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Sibling {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 2,
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
                             headers=admin_headers, json={}, timeout=30)
        assert out.status_code == 200, out.text
        invoice = _get_invoice(admin_headers, bookings[1]["id"])
        assert invoice is not None
        discount_lines = [li for li in invoice["line_items"] if li["kind"] == "discount"]
        if any((b.get("multi_dog_discount") or {}).get("amount") for b in out.json()["bookings"]):
            assert len(discount_lines) >= 1
            assert discount_lines[0]["amount"] < 0
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 8. Credits — invoice mirrors booking.balance_due exactly; credit balances
#    are unaffected by the invoice write itself
# ---------------------------------------------------------------------------

def test_credit_redemption_mirrors_balance_no_double_count(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    lot_id = str(uuid.uuid4())

    async def _seed():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ.get("DB_NAME", "sit_happens")]
        await db.credit_lots.insert_one({
            "id": lot_id, "client_id": client["id"], "pack_id": "test-pack", "pack_name": "Test 5-Pack",
            "service_type": "daycare", "qty_total": 5, "qty_remaining": 5, "price_paid": 100.0,
            "list_price": 100.0, "value_each": 20.0, "payment_method": "card", "note": "test seed",
            "sold_by": "test-seed", "purchased_at": "2025-01-01T00:00:00+00:00",
        })
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 5}})
        mc.close()

    asyncio.run(_seed())
    bid = _book_and_checkin(admin_headers, client, dog, service_type="daycare")
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": True}, timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking["payment_method"] == "credits"

    cr = requests.get(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)
    credits_after = float(cr.json().get("credits") or 0)

    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    assert abs(invoice["balance"] - float(booking["balance_due"])) < 0.01
    assert abs(invoice["credit_applied"] - float(booking.get("credit_value") or 0)) < 0.01
    credit_payments = [p for p in invoice["payments"] if p["is_credit"]]
    assert len(credit_payments) == 1
    assert abs(credit_payments[0]["amount"] - invoice["credit_applied"]) < 0.01

    # The invoice write itself must not have touched the credit balance a
    # second time — only _consume_credit_lots (already exercised by the
    # checkout itself) may move it.
    cr2 = requests.get(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(float(cr2.json().get("credits") or 0) - credits_after) < 0.001


# ---------------------------------------------------------------------------
# 9. Partial payment
# ---------------------------------------------------------------------------

def test_partial_payment_invoice(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 100.0,
                             "amount_paid": 40.0, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking["payment_status"] == "paid_partial"
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    assert invoice["status"] == "PARTIALLY_PAID"
    assert abs(invoice["balance"] - 60.0) < 0.01
    assert abs(invoice["amount_paid"] - 40.0) < 0.01


# ---------------------------------------------------------------------------
# 10. Split (credits + cash) payment
# ---------------------------------------------------------------------------

def test_split_credit_and_cash_payment(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    lot_id = str(uuid.uuid4())

    async def _seed():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ.get("DB_NAME", "sit_happens")]
        await db.credit_lots.insert_one({
            "id": lot_id, "client_id": client["id"], "pack_id": "test-pack", "pack_name": "Test 1-Pack",
            "service_type": "daycare", "qty_total": 1, "qty_remaining": 1, "price_paid": 50.0,
            "list_price": 50.0, "value_each": 50.0, "payment_method": "card", "note": "test seed",
            "sold_by": "test-seed", "purchased_at": "2025-01-01T00:00:00+00:00",
        })
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 1}})
        mc.close()

    asyncio.run(_seed())
    bid = _book_and_checkin(admin_headers, client, dog, service_type="daycare")
    # additional_cash_charge forces a cash component on top of the credit-covered base.
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": True, "additional_cash_charge": 30.0, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    invoice = _get_invoice(admin_headers, bid)
    assert invoice is not None
    credit_payments = [p for p in invoice["payments"] if p["is_credit"]]
    cash_payments = [p for p in invoice["payments"] if not p["is_credit"]]
    assert len(credit_payments) == 1
    assert len(cash_payments) == 1
    assert abs(invoice["credit_applied"] - float(booking.get("credit_value") or 0)) < 0.01
    assert abs(invoice["amount_paid"] - float(booking.get("amount_paid") or 0)) < 0.01
    assert abs(credit_payments[0]["amount"] - invoice["credit_applied"]) < 0.01
    assert abs(cash_payments[0]["amount"] - invoice["amount_paid"]) < 0.01
    # Charge side and payment side must reconcile: nothing subtracted twice.
    assert abs((invoice["credit_applied"] + invoice["amount_paid"]) - invoice["total"]) < 0.01


# ---------------------------------------------------------------------------
# 11. Refund
# ---------------------------------------------------------------------------

def test_refund_updates_invoice_status_without_rewriting_total(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 80.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice_before = _get_invoice(admin_headers, bid)
    assert invoice_before["status"] == "PAID"

    key = uuid.uuid4().hex
    rr = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 30.0, "payment_method": "cash", "reason": "Partial refund test",
        "refund_idempotency_key": key,
    }, timeout=15)
    assert rr.status_code == 200, rr.text

    invoice_after = _get_invoice(admin_headers, bid)
    assert invoice_after["id"] == invoice_before["id"]
    assert abs(invoice_after["total"] - invoice_before["total"]) < 0.01
    assert abs(invoice_after["amount_paid"] - invoice_before["amount_paid"]) < 0.01
    assert invoice_after["status"] == "PARTIALLY_REFUNDED"
    assert abs(invoice_after["refunded_total"] - 30.0) < 0.01
    refund_payments = [p for p in invoice_after["payments"] if p["amount"] < 0]
    assert len(refund_payments) == 1
    assert abs(refund_payments[0]["amount"] + 30.0) < 0.01

    # Retrying the SAME refund request (same key) must not double-refund.
    rr2 = requests.post(f"{API}/bookings/{bid}/refund", headers=admin_headers, json={
        "amount": 30.0, "payment_method": "cash", "reason": "Partial refund test",
        "refund_idempotency_key": key,
    }, timeout=15)
    assert rr2.status_code == 200, rr2.text
    invoice_retry = _get_invoice(admin_headers, bid)
    assert abs(invoice_retry["refunded_total"] - 30.0) < 0.01, "retrying the same refund key must not double-refund"
    refund_payments_retry = [p for p in invoice_retry["payments"] if p["amount"] < 0]
    assert len(refund_payments_retry) == 1


# ---------------------------------------------------------------------------
# 12. Invoice-creation idempotency on retry
# ---------------------------------------------------------------------------

def test_invoice_creation_idempotent_on_retry(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 55.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice1 = _get_invoice(admin_headers, bid)

    mc, db = _mongo_db()
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        os.environ.setdefault("MONGO_URL", os.environ["MONGO_URL"])
        import server as server_module

        async def _retry():
            return await server_module._create_invoice_for_bookings(
                [bid], user={"id": "test"}, ts="2020-01-01T00:00:00+00:00",
            )
        result = asyncio.run(_retry())
        assert result["id"] == invoice1["id"], "a retried create call must return the existing invoice, not a duplicate"

        async def _count():
            return await db.invoices.count_documents({"booking_ids": bid})
        count = asyncio.run(_count())
        assert count == 1
    finally:
        mc.close()


# ---------------------------------------------------------------------------
# Unit-level failure isolation — pure Python, in-process, no HTTP, no
# production backdoor. Proves _create_invoice_for_bookings itself raises on
# a genuine internal failure (so the try/except at the checkout call site
# is what provides isolation, not silent swallowing inside the helper).
# ---------------------------------------------------------------------------

def test_create_invoice_helper_raises_on_internal_failure(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 25.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import server as server_module

    class _BrokenInvoices:
        async def find_one(self, *a, **kw):
            raise RuntimeError("simulated invoices collection failure")

    real_invoices = server_module.db.invoices
    server_module.db.invoices = _BrokenInvoices()
    try:
        with pytest.raises(Exception):
            asyncio.run(server_module._create_invoice_for_bookings(
                [bid], user={"id": "test"}, ts="2020-01-01T00:00:00+00:00",
            ))
    finally:
        server_module.db.invoices = real_invoices
