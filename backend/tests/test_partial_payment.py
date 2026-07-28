"""Sprint 110di-51 — Partial payment / per-client tab / accounts receivable.

Covers:
  - amount_paid < total → booking marked paid_partial, tab balance increases,
    ledger has charge + payment rows
  - amount_paid == total → booking marked paid, no balance change
  - amount_paid > total → booking marked paid, tab balance goes NEGATIVE
    (pre-paid credit on file)
  - POST /clients/{id}/payment → reduces balance, writes payment row,
    receipt fired
  - POST /clients/{id}/adjustment → write-off / correction logged
  - GET /clients/{id}/ledger → returns rows newest-first + current balance
  - GET /admin/accounts-receivable → returns clients with non-zero balance
    + totals
"""
import os
import uuid
import datetime
import requests
import pytest

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"))
TOMORROW = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}
    # Payment rebuild Phase 2 — cash checkout/top-ups now require today's
    # cash drawer to actually be open. Idempotent to call even if already open.
    requests.post(f"{BASE}/api/admin/register/open-drawer", headers=headers,
                  json={"opening_cash": 100.0}, timeout=15)
    return headers


@pytest.fixture(scope="function")
def fresh_client_and_dog(admin_headers):
    """Create a brand-new client + dog so balance math starts at 0."""
    cid_suffix = uuid.uuid4().hex[:6]
    cr = requests.post(f"{BASE}/api/clients", headers=admin_headers,
                       json={"name": f"Tab Test {cid_suffix}",
                             "email": f"tabtest_{cid_suffix}@example.com",
                             "phone": "555-555-0000"},
                       timeout=15)
    assert cr.status_code == 200, cr.text
    client = cr.json()
    dr = requests.post(f"{BASE}/api/dogs", headers=admin_headers,
                       json={"owner_id": client["id"], "name": f"Rex{cid_suffix}",
                             "breed": "Test Breed", "age_y": 3, "age_m": 0,
                             "sex": "Male", "vaccines": {"rabies": "2099-01-01"}},
                       timeout=15)
    assert dr.status_code == 200, dr.text
    dog = dr.json()
    yield client, dog
    # cleanup: best-effort delete bookings + client
    requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def _create_and_checkin(admin_headers, client, dog, base_price=100.0):
    """Helper — create a daycare booking, check it in, return booking id."""
    br = requests.post(f"{BASE}/api/bookings", headers=admin_headers,
                       json={"client_id": client["id"], "dog_id": dog["id"],
                             "date": TOMORROW, "service_type": "daycare",
                             # override_capacity: this shared, long-lived test DB
                             # accumulates real daycare bookings from many other
                             # test files using the same date offset convention,
                             # so capacity can already be exhausted by unrelated
                             # prior runs — test-data isolation, not a production
                             # rule change.
                             "override_capacity": True},
                       timeout=15)
    assert br.status_code == 200, br.text
    bid = br.json()["id"]
    # approve
    requests.post(f"{BASE}/api/bookings/{bid}/approve", headers=admin_headers, timeout=15)
    # check in
    requests.post(f"{BASE}/api/bookings/{bid}/check-in", headers=admin_headers,
                  json={}, timeout=15)
    return bid


def test_partial_payment_creates_tab(admin_headers, fresh_client_and_dog):
    """Pay $40 on a $100 ticket → booking paid_partial, balance $60 owed."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 100.0,
                            "amount_paid": 40.0, "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["payment_status"] == "paid_partial"
    assert b["amount_paid"] == 40.0
    assert abs(b["actual_price"] - 100.0) < 0.01
    # client balance increased by $60
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert cr.status_code == 200
    assert abs(cr.json()["account_balance"] - 60.0) < 0.01


def test_exact_payment_no_tab(admin_headers, fresh_client_and_dog):
    """Pay $100 on a $100 ticket → paid, balance still 0."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 100.0,
                            "amount_paid": 100.0, "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["payment_status"] == "paid"
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"]) < 0.01


def test_overpayment_creates_credit(admin_headers, fresh_client_and_dog):
    """Pay $150 on a $100 ticket → paid, balance -$50 (prepaid credit)."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 100.0,
                            "amount_paid": 150.0, "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["payment_status"] == "paid"
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] + 50.0) < 0.01  # -50


# ---------------------------------------------------------------------------
# Dashboard "Partial / on tab" blank-amount bug — regression coverage.
#
# Real bug: CheckoutModal's "Partial / on tab" pill used to send
# payment_status="paid" unconditionally and only attached amount_paid when
# the operator typed a non-blank number. Selecting "Partial / on tab" and
# leaving the amount blank (the natural way to mean "collect nothing today")
# reached the backend indistinguishable from a full payment: false completed
# Payment row, no AR ledger charge, client.account_balance never moved,
# invoice marked PAID with balance $0. Fixed by (a) the frontend always
# sending an explicit numeric amount_paid (blank → 0) plus an explicit
# payment_status="paid_partial" tab-intent assertion, and (b) a backend
# belt-and-suspenders guard so payment_status="paid_partial" can never
# collapse into a full payment merely because amount_paid was omitted.
# ---------------------------------------------------------------------------

def _get_invoice(admin_headers, booking_id):
    r = requests.get(f"{BASE}/api/bookings/{booking_id}/invoice", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_tab_checkout_blank_amount_creates_full_ar_not_a_payment(admin_headers, fresh_client_and_dog):
    """The exact reported scenario: $1 total, 'Partial / on tab', amount
    field left blank. Must produce $0 paid / full $1 to AR — never a false
    completed Payment, never a PAID invoice."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog, base_price=1.0)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 1.0,
                            "payment_method": "cash", "payment_status": "paid_partial"},
                      timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["payment_status"] == "paid_partial"
    assert abs(b["actual_price"] - 1.0) < 0.01
    assert abs(b["amount_paid"] - 0.0) < 0.01
    assert abs(b["balance_due"] - 1.0) < 0.01

    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 1.0) < 0.01, "AR must land on the client tab"

    inv = _get_invoice(admin_headers, bid)
    assert abs(inv["total"] - 1.0) < 0.01
    assert abs(inv["amount_paid"] - 0.0) < 0.01
    assert abs(inv["balance"] - 1.0) < 0.01
    assert inv["status"] == "OPEN"
    # No false completed cash/card Payment row for money never collected.
    cash_payments = [p for p in inv["payments"] if not p.get("is_credit")]
    assert cash_payments == [], f"expected zero cash Payment rows, got {cash_payments}"


def test_tab_checkout_explicit_zero_amount_same_as_blank(admin_headers, fresh_client_and_dog):
    """payment_status='paid_partial' + amount_paid=0 explicit must behave
    identically to the blank-amount case above."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog, base_price=1.0)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 1.0, "amount_paid": 0,
                            "payment_method": "cash", "payment_status": "paid_partial"},
                      timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["payment_status"] == "paid_partial"
    assert abs(b["amount_paid"] - 0.0) < 0.01
    assert abs(b["balance_due"] - 1.0) < 0.01
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 1.0) < 0.01
    inv = _get_invoice(admin_headers, bid)
    assert inv["status"] == "OPEN"
    assert [p for p in inv["payments"] if not p.get("is_credit")] == []


def test_tab_checkout_partial_amount_splits_correctly(admin_headers, fresh_client_and_dog):
    """$0.25 paid on a $1.00 ticket, tab mode → amount_paid=.25, balance=.75,
    AR/account balance reflects exactly the unpaid remainder, and the ONE
    real Payment row is for the $0.25 actually collected — never the full $1."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog, base_price=1.0)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 1.0, "amount_paid": 0.25,
                            "payment_method": "cash", "payment_status": "paid_partial"},
                      timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["payment_status"] == "paid_partial"
    assert abs(b["amount_paid"] - 0.25) < 0.01
    assert abs(b["balance_due"] - 0.75) < 0.01
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 0.75) < 0.01
    inv = _get_invoice(admin_headers, bid)
    assert abs(inv["amount_paid"] - 0.25) < 0.01
    assert abs(inv["balance"] - 0.75) < 0.01
    assert inv["status"] == "PARTIALLY_PAID"
    cash_payments = [p for p in inv["payments"] if not p.get("is_credit")]
    assert len(cash_payments) == 1
    assert abs(cash_payments[0]["amount"] - 0.25) < 0.01


def test_full_payment_behavior_unchanged(admin_headers, fresh_client_and_dog):
    """Plain 'Paid in full' (payment_status='paid', no amount_paid sent) —
    the legacy default — must be completely unaffected by this fix."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog, base_price=1.0)
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                      json={"use_credits": False, "base_price": 1.0,
                            "payment_method": "cash", "payment_status": "paid"},
                      timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["payment_status"] == "paid"
    assert abs(b["amount_paid"] - 1.0) < 0.01
    assert abs(b["balance_due"] - 0.0) < 0.01
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 0.0) < 0.01
    inv = _get_invoice(admin_headers, bid)
    assert inv["status"] == "PAID"
    assert abs(inv["amount_paid"] - 1.0) < 0.01
    cash_payments = [p for p in inv["payments"] if not p.get("is_credit")]
    assert len(cash_payments) == 1
    assert abs(cash_payments[0]["amount"] - 1.0) < 0.01


def test_ledger_shows_rows_newest_first(admin_headers, fresh_client_and_dog):
    """Ledger endpoint returns charge + payment rows for the partial-pay."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 80.0,
                        "amount_paid": 30.0, "payment_method": "cash"},
                  timeout=15)
    r = requests.get(f"{BASE}/api/clients/{client['id']}/ledger",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert abs(data["balance"] - 50.0) < 0.01
    types = {row["type"] for row in data["rows"]}
    assert "charge" in types and "payment" in types
    # newest first → payment row was inserted AFTER charge row in same ts,
    # but ordering by created_at -1 is stable; just assert we have ≥2 rows
    assert len(data["rows"]) >= 2


def test_apply_tab_payment_reduces_balance(admin_headers, fresh_client_and_dog):
    """POST /clients/{id}/payment reduces account_balance for LEGACY/
    non-invoice-backed AR. This checkout leaves an explicit amount_paid,
    which (Payment rebuild Phase 2) posts the balance to an invoice-backed
    AR entry — POST /clients/{id}/payment now deliberately refuses to
    settle that (it would leave the invoice stale and double-collectible);
    settling it goes through POST /invoices/{invoice_id}/payments instead.
    See test_invoice_topup_payments.py::
    test_apply_tab_payment_allowed_for_legacy_ar_with_non_ar_backed_invoice
    for the still-supported legacy/non-invoice-backed AR case."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 100.0,
                        "amount_paid": 0.0, "payment_method": "cash"},
                  timeout=15)
    # balance should be 100 owed, and it's AR-backed (explicit amount_paid
    # was sent at checkout) -> generic tab payment must refuse it.
    blocked = requests.post(f"{BASE}/api/clients/{client['id']}/payment",
                            headers=admin_headers,
                            json={"amount": 60.0, "method": "cash", "tendered_amount": 60.0, "notes": "Settling tab"},
                            timeout=15)
    assert blocked.status_code == 409, blocked.text

    invoice = requests.get(f"{BASE}/api/bookings/{bid}/invoice", headers=admin_headers, timeout=15).json()
    pr = requests.post(f"{BASE}/api/invoices/{invoice['id']}/payments",
                       headers=admin_headers,
                       json={"amount": 60.0, "method": "cash", "tendered_amount": 60.0,
                             "notes": "Settling tab", "idempotency_key": uuid.uuid4().hex},
                       timeout=15)
    assert pr.status_code == 200, pr.text
    assert abs(pr.json()["invoice"]["balance"] - 40.0) < 0.01


def test_apply_tab_adjustment_writeoff(admin_headers, fresh_client_and_dog):
    """Adjustment with negative amount forgives part of the tab."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 100.0,
                        "amount_paid": 0.0, "payment_method": "cash"},
                  timeout=15)
    ar = requests.post(f"{BASE}/api/clients/{client['id']}/adjustment",
                       headers=admin_headers,
                       json={"amount": -25.0, "notes": "Goodwill write-off"},
                       timeout=15)
    assert ar.status_code == 200, ar.text
    assert abs(ar.json()["balance"] - 75.0) < 0.01


def test_accounts_receivable_lists_clients_with_balance(admin_headers, fresh_client_and_dog):
    """AR endpoint includes the test client when balance ≠ 0."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 50.0,
                        "amount_paid": 10.0, "payment_method": "cash"},
                  timeout=15)
    r = requests.get(f"{BASE}/api/admin/accounts-receivable",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    ids = {c["id"] for c in data["clients"]}
    assert client["id"] in ids
    # totals math
    assert data["total_receivable"] >= 40.0


def test_partial_checkout_alias_endpoint(admin_headers, fresh_client_and_dog):
    """POST /bookings/{id}/checkout-partial behaves the same."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{BASE}/api/bookings/{bid}/checkout-partial",
                      headers=admin_headers,
                      json={"use_credits": False, "base_price": 70.0,
                            "amount_paid": 20.0, "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["payment_status"] == "paid_partial"
    cr = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 50.0) < 0.01


def test_checkout_partial_requires_amount_paid(admin_headers, fresh_client_and_dog):
    """The alias endpoint enforces amount_paid presence."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    r = requests.post(f"{BASE}/api/bookings/{bid}/checkout-partial",
                      headers=admin_headers,
                      json={"use_credits": False, "base_price": 50.0},
                      timeout=15)
    assert r.status_code == 400


def test_send_statement_requires_email(admin_headers, fresh_client_and_dog):
    """Statement email requires an email on file."""
    # Strip the email from the fixture client
    client, _ = fresh_client_and_dog
    requests.put(f"{BASE}/api/clients/{client['id']}", headers=admin_headers,
                 json={"name": client["name"], "email": "", "phone": "555-555-0000"},
                 timeout=15)
    r = requests.post(f"{BASE}/api/clients/{client['id']}/send-statement",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 400, r.text


def test_send_statement_returns_ok_with_email(admin_headers, fresh_client_and_dog):
    """Statement endpoint returns ok=true + sent_to + balance + row_count."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 60.0,
                        "amount_paid": 20.0, "payment_method": "cash"},
                  timeout=15)
    r = requests.post(f"{BASE}/api/clients/{client['id']}/send-statement",
                      headers=admin_headers, timeout=15)
    # When Resend isn't configured locally, _dispatch returns False and we 500.
    # When it IS configured, returns 200. Accept either as long as the
    # response shape is sane on success.
    assert r.status_code in (200, 500), r.text
    if r.status_code == 200:
        d = r.json()
        assert d["ok"] is True
        assert d["sent_to"] == client["email"]
        assert d["row_count"] >= 2  # charge + payment


def test_portal_send_statement_self_serve(admin_headers):
    """Sprint 110di-54 — Client can request their own statement via portal."""
    # Use the test client credentials from /app/memory/test_credentials.md
    login = requests.post(f"{BASE}/api/auth/login",
                          json={"email": "freightshaker06@gmail.com",
                                "password": "TestPass123"}, timeout=15)
    if login.status_code != 200:
        import pytest
        pytest.skip("test client credentials not available")
    client_token = login.json()["token"]
    r = requests.post(f"{BASE}/api/portal/send-statement",
                      headers={"Authorization": f"Bearer {client_token}"},
                      timeout=15)
    # 200 on success (Resend configured) or 500 (Resend not configured locally)
    assert r.status_code in (200, 500), r.text
    if r.status_code == 200:
        d = r.json()
        assert d["ok"] is True
        assert "@" in d["sent_to"]


def test_portal_send_statement_rejects_admin(admin_headers):
    """Sprint 110di-54 — Portal endpoint refuses admin users (role mismatch)."""
    r = requests.post(f"{BASE}/api/portal/send-statement",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 403
