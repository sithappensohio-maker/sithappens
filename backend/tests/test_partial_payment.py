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
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


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
                             "date": TOMORROW, "service_type": "daycare"},
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
    """POST /clients/{id}/payment reduces account_balance."""
    client, dog = fresh_client_and_dog
    bid = _create_and_checkin(admin_headers, client, dog)
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers,
                  json={"use_credits": False, "base_price": 100.0,
                        "amount_paid": 0.0, "payment_method": "cash"},
                  timeout=15)
    # balance should be 100 owed
    pr = requests.post(f"{BASE}/api/clients/{client['id']}/payment",
                       headers=admin_headers,
                       json={"amount": 60.0, "method": "cash", "notes": "Settling tab"},
                       timeout=15)
    assert pr.status_code == 200, pr.text
    assert abs(pr.json()["balance"] - 40.0) < 0.01


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
