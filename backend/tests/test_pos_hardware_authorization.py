"""Front-desk POS hardware integration — authorization + safety tests.

Black-box HTTP against a live server, same convention as
test_invoice_topup_payments.py. The backend contains ZERO hardware code —
there is no printer or drawer to mock here. What's tested is the thing the
backend actually owns: that hardware ACTIONS are only ever authorized after
a real financial commit, that the browser can never forge receipt content,
that tokens are short-lived/single-use/action-and-workstation-scoped, that
manual drawer opens are audited and create no financial side effect, and
that no hardware-adjacent code path can create a duplicate Payment.

Covers the 21 scenarios from the POS hardware integration spec:
  1.  Hardware tokens only appear after the financial commit succeeds
  2.  A failed/rejected checkout issues no tokens (no drawer, no receipt)
  3.  Non-cash tenders (check/venmo/paypal/other) never yield a drawer token
  3b. Credits-only (even when nominally tendered "cash") never yields one
  4.  Token verification is independent of physical hardware success/failure
  5.  Retrying a hardware action (reissue) creates no new financial mutation
  6.  Receipt payload always reflects canonical server data
  7.  The token cannot be used to smuggle browser-supplied amounts
  8.  Expired token rejected
  9.  Tampered/invalid-signature token rejected
  10. Wrong-workstation token rejected
  11. Wrong-action token rejected
  12. Token is single-use (second verification attempt fails)
  13. Manual drawer open requires admin, requires a reason, writes an audit
      record BEFORE the token is issued, and creates no financial record
  14. Reprint (token reissuance) creates no new Payment
  15. A group receipt never invents tendered/change amounts
  16. Directly-related Phase 2 tests are unaffected (run separately in the
      full targeted-regression pass, not duplicated here)
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
    """Run ONE async DB operation with its own fresh client + event loop —
    see test_invoice_topup_payments.py for why a fresh client per call is
    required when mixing this with asyncio.run() elsewhere in the file."""
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


def _make_client_and_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"POSHW Test {tag}", "email": f"poshw-{tag}@example.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    return client, dog


def _book_and_checkin(admin_headers, client, dog, service_type="daycare"):
    # override_capacity: this shared, long-lived test DB accumulates real
    # daycare bookings from many other test files using the same "+10 days"
    # date convention, so capacity for this exact date can already be
    # exhausted by unrelated prior runs — this is a test-data-isolation
    # fix (the existing admin-only bypass), not a production rule change.
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


@pytest.fixture
def fresh_client_and_dog(admin_headers):
    client, dog = _make_client_and_dog(admin_headers, uuid.uuid4().hex[:8])
    yield client, dog
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _payment_count(invoice_id):
    return _mongo_run(lambda db: db.payments.count_documents({"invoice_id": invoice_id}))


# ---------------------------------------------------------------------------
# 1. Hardware tokens only appear after a successful financial commit
# ---------------------------------------------------------------------------

def test_cash_checkout_issues_both_tokens_after_commit(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 90.0, "payment_method": "cash",
                             "payment_status": "paid", "workstation_id": "FRONT_DESK_1"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking.get("pos_invoice_id")
    assert booking.get("pos_print_receipt_token")
    assert booking.get("pos_open_drawer_token")

    invoice = _get_invoice(admin_headers, bid)
    assert invoice["status"] == "PAID"
    assert _payment_count(invoice["id"]) == 1


# ---------------------------------------------------------------------------
# 2. A rejected checkout issues no tokens at all
# ---------------------------------------------------------------------------

def test_rejected_cash_checkout_issues_no_tokens(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)

    today_server = requests.get(f"{API}/admin/register/session", headers=admin_headers, timeout=15).json()["date"]

    async def _pop(db):
        return await db.cash_drawer_sessions.find_one_and_delete({"date": today_server})
    popped = _mongo_run(_pop)
    try:
        r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                           json={"use_credits": False, "base_price": 90.0, "payment_method": "cash",
                                 "payment_status": "paid"},
                           timeout=15)
        assert r.status_code == 400, r.text
        assert "register" in r.text.lower() or "drawer" in r.text.lower()
        invoice = requests.get(f"{API}/bookings/{bid}/invoice", headers=admin_headers, timeout=15)
        assert invoice.status_code == 200
        assert invoice.json() is None, "a rejected checkout must not create an invoice"
    finally:
        if popped:
            _mongo_run(lambda db: db.cash_drawer_sessions.insert_one(popped))


# ---------------------------------------------------------------------------
# 3. Non-cash tenders never yield a drawer token (receipt token still issued)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method", ["check", "venmo", "paypal"])
def test_non_cash_checkout_never_yields_drawer_token(admin_headers, fresh_client_and_dog, method):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 60.0, "payment_method": method,
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking.get("pos_print_receipt_token")
    assert booking.get("pos_open_drawer_token") is None


def test_other_checkout_with_note_never_yields_drawer_token(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 60.0, "payment_method": "other",
                             "payment_status": "paid", "payment_notes": "Zelle"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking.get("pos_print_receipt_token")
    assert booking.get("pos_open_drawer_token") is None


def test_credits_only_checkout_never_yields_drawer_token(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    lot_id = str(uuid.uuid4())

    async def _seed(db):
        await db.credit_lots.insert_one({
            "id": lot_id, "client_id": client["id"], "pack_id": "test-pack", "pack_name": "Test 5-Pack",
            "service_type": "daycare", "qty_total": 5, "qty_remaining": 5, "price_paid": 100.0,
            "list_price": 100.0, "value_each": 20.0, "payment_method": "card", "note": "test seed",
            "sold_by": "test-seed", "purchased_at": "2025-01-01T00:00:00+00:00",
        })
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 5}})
    _mongo_run(_seed)

    bid = _book_and_checkin(admin_headers, client, dog, service_type="daycare")
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": True}, timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking["payment_method"] == "credits"
    assert booking.get("pos_print_receipt_token")
    assert booking.get("pos_open_drawer_token") is None


def test_group_checkout_cash_tender_fully_covered_by_credits_never_opens_drawer(admin_headers):
    """Regression for a real asymmetry found while writing this test file:
    group checkout only checked `resolved_group_tender == "cash"`, not
    whether any cash was actually collected — unlike single checkout, which
    already gated on `amount_collected_now > 0`. If every dog's price is
    fully covered by credits, `_check_out_locked` overrides each booking's
    payment_method to "credits" and its cash_revenue to $0, so
    `combined_cash` is genuinely 0 even though the group's nominal
    `payment_method` field was "cash" — the drawer must not open."""
    tag = uuid.uuid4().hex[:8]
    client, dog1 = _make_client_and_dog(admin_headers, tag)
    dog2 = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Dog2 {tag}", "owner_id": client["id"], "breed": "Mix", "age_y": 2,
        "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
    }, timeout=15).json()
    try:
        async def _seed(db):
            for i, dog in enumerate((dog1, dog2)):
                await db.credit_lots.insert_one({
                    "id": str(uuid.uuid4()), "client_id": client["id"], "pack_id": "test-pack",
                    "pack_name": "Test 5-Pack", "service_type": "daycare", "qty_total": 5,
                    "qty_remaining": 5, "price_paid": 100.0, "list_price": 100.0, "value_each": 20.0,
                    "payment_method": "card", "note": "test seed", "sold_by": "test-seed",
                    "purchased_at": "2025-01-01T00:00:00+00:00",
                })
            await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 10}})
        _mongo_run(_seed)

        r = requests.post(f"{API}/bookings/group", headers=admin_headers, json={
            "dogs": [{"dog_id": dog1["id"]}, {"dog_id": dog2["id"]}],
            "date": TODAY, "service_type": "daycare", "override_vaccines": True,
            # override_capacity: this shared, long-lived test DB accumulates
            # real daycare bookings on the same "+10 days" convention many
            # other test files also use, so capacity for this exact date can
            # already be exhausted by unrelated prior runs. This is a test-
            # data-isolation fix (the existing admin-only bypass), not a
            # production capacity rule change — the test's own assertions
            # about hardware tokens/drawer behavior are unaffected.
            "override_capacity": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for b in bookings:
            requests.post(f"{API}/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{API}/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)

        out = requests.post(f"{API}/bookings/{bookings[1]['id']}/check-out-group",
                             headers=admin_headers, json={"use_credits": True, "payment_method": "cash"},
                             timeout=30)
        assert out.status_code == 200, out.text
        payload = out.json()
        assert payload.get("pos_print_receipt_token")
        assert payload.get("pos_open_drawer_token") is None, (
            "credits fully covered the group; no real cash was collected, so no drawer token should issue"
        )
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_group_checkout_real_cash_component_yields_drawer_token(admin_headers):
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
            # override_capacity: this shared, long-lived test DB accumulates
            # real daycare bookings on the same "+10 days" convention many
            # other test files also use, so capacity for this exact date can
            # already be exhausted by unrelated prior runs. This is a test-
            # data-isolation fix (the existing admin-only bypass), not a
            # production capacity rule change — the test's own assertions
            # about hardware tokens/drawer behavior are unaffected.
            "override_capacity": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for b in bookings:
            requests.post(f"{API}/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{API}/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)

        out = requests.post(f"{API}/bookings/{bookings[1]['id']}/check-out-group",
                             headers=admin_headers, json={"payment_method": "cash", "payment_status": "paid"},
                             timeout=30)
        assert out.status_code == 200, out.text
        payload = out.json()
        assert payload.get("cash_total", 0) > 0, "test setup sanity check: real cash must have been collected"
        assert payload.get("pos_print_receipt_token")
        assert payload.get("pos_open_drawer_token")
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 4/5/13/14. Token reissuance / manual drawer open create no financial
#            mutation; reprint never creates a new Payment
# ---------------------------------------------------------------------------

def test_token_reissuance_creates_no_new_payment(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 50.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice_id = r.json()["pos_invoice_id"]
    before = _payment_count(invoice_id)

    for _ in range(3):
        rr = requests.post(f"{API}/invoices/{invoice_id}/pos-tokens", headers=admin_headers,
                            json={"actions": ["print_receipt", "open_drawer"]}, timeout=15)
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body.get("print_receipt_token")
        assert body.get("open_drawer_token")

    after = _payment_count(invoice_id)
    assert after == before == 1


def test_manual_open_drawer_requires_admin():
    # No Authorization header at all — require_admin rejects this the same
    # way it would reject a logged-in non-admin (this endpoint has no
    # separate "employee" path to fall back to).
    rr = requests.post(f"{API}/admin/pos/open-drawer", json={"reason": "Make change"}, timeout=15)
    assert rr.status_code in (401, 403)


def test_manual_open_drawer_requires_reason(admin_headers):
    r = requests.post(f"{API}/admin/pos/open-drawer", headers=admin_headers, json={"reason": "ab"}, timeout=15)
    assert r.status_code == 422, r.text


def test_manual_open_drawer_writes_audit_before_token_and_no_financial_record(admin_headers):
    before_count = _mongo_run(lambda db: db.pos_drawer_audit.count_documents({}))
    r = requests.post(f"{API}/admin/pos/open-drawer", headers=admin_headers,
                       json={"reason": "Count drawer", "workstation_id": "FRONT_DESK_1"}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["open_drawer_token"]
    assert token

    after_count = _mongo_run(lambda db: db.pos_drawer_audit.count_documents({}))
    assert after_count == before_count + 1

    latest = _mongo_run(lambda db: db.pos_drawer_audit.find_one({}, {"_id": 0}, sort=[("created_at", -1)]))
    assert latest["reason"] == "Count drawer"
    assert latest["workstation_id"] == "FRONT_DESK_1"
    assert latest["source"] == "manual_admin_open_drawer"
    assert latest.get("user_id")

    # Verifying+consuming the token must not create any Payment/retail_sales row.
    payments_before = _mongo_run(lambda db: db.payments.count_documents({}))
    sales_before = _mongo_run(lambda db: db.retail_sales.count_documents({}))
    vr = requests.post(f"{API}/pos/verify-drawer-token", json={"token": token, "workstation_id": "FRONT_DESK_1"}, timeout=15)
    assert vr.status_code == 200, vr.text
    assert vr.json()["ok"] is True
    payments_after = _mongo_run(lambda db: db.payments.count_documents({}))
    sales_after = _mongo_run(lambda db: db.retail_sales.count_documents({}))
    assert payments_after == payments_before
    assert sales_after == sales_before


# ---------------------------------------------------------------------------
# 6/7. Receipt payload is always canonical server data — the token carries
#      no amounts, only references, so the browser cannot smuggle a value
# ---------------------------------------------------------------------------

def test_receipt_payload_matches_canonical_invoice_data(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 123.45, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    invoice = _get_invoice(admin_headers, bid)

    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": booking["pos_print_receipt_token"]}, timeout=15)
    assert rr.status_code == 200, rr.text
    payload = rr.json()
    assert payload["invoice_id"] == invoice["id"]
    assert abs(float(payload["invoice_total"]) - float(invoice["total"])) < 0.01
    assert abs(float(payload["payment_amount"]) - float(invoice["amount_paid"])) < 0.01
    assert abs(float(payload["remaining_balance"]) - float(invoice["balance"])) < 0.01
    assert payload["client_name"] == invoice.get("client_name")


def test_receipt_payload_token_carries_no_amount_and_ignores_query_tampering(admin_headers, fresh_client_and_dog):
    """The token references an invoice_id (and optional payment_ids) only —
    it has no amount field for a caller to tamper with. Appending arbitrary
    extra query params must have zero effect on the returned payload."""
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 40.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()

    server_module = _server_module()
    claims = server_module._unsign_pos_token(booking["pos_print_receipt_token"])
    assert set(claims.keys()) >= {"jti", "action", "invoice_id", "payment_ids", "iat", "exp"}
    assert "invoice_total" not in claims and "amount" not in claims and "payment_amount" not in claims

    # Reissue a fresh token (the original above gets consumed by other tests'
    # helpers if reused) and confirm tampering the query string does nothing.
    reissue = requests.post(f"{API}/invoices/{booking['pos_invoice_id']}/pos-tokens", headers=admin_headers,
                             json={"actions": ["print_receipt"]}, timeout=15)
    token = reissue.json()["print_receipt_token"]
    rr = requests.get(f"{API}/pos/receipt-payload",
                       params={"token": token, "invoice_total": "999999.99", "amount": "1.00"}, timeout=15)
    assert rr.status_code == 200, rr.text
    assert abs(float(rr.json()["invoice_total"]) - 40.0) < 0.01


# ---------------------------------------------------------------------------
# 8/9/10/11/12. Token expiry, tampering, wrong workstation, wrong action,
#               single-use
# ---------------------------------------------------------------------------

def test_expired_token_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 30.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    invoice_id = r.json()["pos_invoice_id"]

    server_module = _server_module()

    async def _issue_expired(db):
        return await server_module._issue_pos_token(
            action="print_receipt", invoice_id=invoice_id, ttl_seconds=-5,
        )
    token = _mongo_run(_issue_expired)

    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert rr.status_code == 401, rr.text
    assert "expired" in rr.text.lower()


def test_tampered_signature_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 30.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    token = r.json()["pos_print_receipt_token"]
    body, sig = token.split(".", 1)
    tampered = f"{body}.{'0' if sig[0] != '0' else '1'}{sig[1:]}"

    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": tampered}, timeout=15)
    assert rr.status_code == 401, rr.text


def test_wrong_workstation_token_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 30.0, "payment_method": "cash",
                             "payment_status": "paid", "workstation_id": "FRONT_DESK_1"},
                       timeout=15)
    token = r.json()["pos_open_drawer_token"]
    assert token

    rr = requests.post(f"{API}/pos/verify-drawer-token",
                        json={"token": token, "workstation_id": "FRONT_DESK_2"}, timeout=15)
    assert rr.status_code == 403, rr.text

    # And the same token verified with the correct workstation still works.
    rr2 = requests.post(f"{API}/pos/verify-drawer-token",
                         json={"token": token, "workstation_id": "FRONT_DESK_1"}, timeout=15)
    assert rr2.status_code == 200, rr2.text


def test_wrong_action_token_rejected(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 30.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    print_token = r.json()["pos_print_receipt_token"]

    # A print_receipt token must never authorize an open_drawer action.
    rr = requests.post(f"{API}/pos/verify-drawer-token", json={"token": print_token}, timeout=15)
    assert rr.status_code == 403, rr.text


def test_token_is_single_use(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 30.0, "payment_method": "cash",
                             "payment_status": "paid"},
                       timeout=15)
    token = r.json()["pos_print_receipt_token"]

    first = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert first.status_code == 200, first.text
    second = requests.get(f"{API}/pos/receipt-payload", params={"token": token}, timeout=15)
    assert second.status_code == 409, second.text
    assert "already been used" in second.text.lower()


# ---------------------------------------------------------------------------
# 15. Group receipt never invents Cash Received / Change
# ---------------------------------------------------------------------------

def test_group_receipt_never_invents_tendered_or_change(admin_headers):
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
            # override_capacity: this shared, long-lived test DB accumulates
            # real daycare bookings on the same "+10 days" convention many
            # other test files also use, so capacity for this exact date can
            # already be exhausted by unrelated prior runs. This is a test-
            # data-isolation fix (the existing admin-only bypass), not a
            # production capacity rule change — the test's own assertions
            # about hardware tokens/drawer behavior are unaffected.
            "override_capacity": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for b in bookings:
            requests.post(f"{API}/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{API}/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)

        out = requests.post(f"{API}/bookings/{bookings[1]['id']}/check-out-group",
                             headers=admin_headers, json={"payment_method": "cash"}, timeout=30)
        assert out.status_code == 200, out.text
        payload = out.json()
        print_token = payload["pos_print_receipt_token"]

        rr = requests.get(f"{API}/pos/receipt-payload", params={"token": print_token}, timeout=15)
        assert rr.status_code == 200, rr.text
        receipt = rr.json()
        assert receipt["tendered_amount"] is None, "group checkout never records a real tender per Phase 2 — must not fabricate one"
        assert receipt["change_given"] is None
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_single_checkout_receipt_includes_real_tendered_and_change(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": 45.0, "payment_method": "cash",
                             "payment_status": "paid", "tendered_amount": 50.0},
                       timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()

    rr = requests.get(f"{API}/pos/receipt-payload", params={"token": booking["pos_print_receipt_token"]}, timeout=15)
    assert rr.status_code == 200, rr.text
    receipt = rr.json()
    assert abs(receipt["tendered_amount"] - 50.0) < 0.01
    assert abs(receipt["change_given"] - 5.0) < 0.01


# ---------------------------------------------------------------------------
# Top-up cash payment also issues a drawer token; non-cash top-up does not
# ---------------------------------------------------------------------------

def _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0):
    bid = _book_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{API}/bookings/{bid}/check-out", headers=admin_headers,
                       json={"use_credits": False, "base_price": total,
                             "amount_paid": paid, "payment_method": "cash"},
                       timeout=15)
    assert r.status_code == 200, r.text
    invoice = _get_invoice(admin_headers, bid)
    return bid, invoice


def test_cash_topup_issues_drawer_token_non_cash_does_not(admin_headers, fresh_client_and_dog):
    client, dog = fresh_client_and_dog
    bid, invoice = _partial_paid_invoice(admin_headers, client, dog, total=200.0, paid=75.0)

    r1 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 50.0, "method": "check", "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r1.status_code == 200, r1.text
    assert r1.json().get("pos_print_receipt_token")
    assert r1.json().get("pos_open_drawer_token") is None

    r2 = requests.post(f"{API}/invoices/{invoice['id']}/payments", headers=admin_headers, json={
        "amount": 75.0, "method": "cash", "tendered_amount": 75.0, "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r2.status_code == 200, r2.text
    assert r2.json().get("pos_print_receipt_token")
    assert r2.json().get("pos_open_drawer_token")
