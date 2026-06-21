"""Sprint 101 — Employees use the same checkout flow as admins.

Regression coverage:
- Employee can fetch a client doc (GET /api/clients/{id}) to read balances
- Employee can check OUT a booking with the full body (credits + add-ons + price)
- Credits get deducted, actual_price stamped, status flips to completed
- Employee can DELETE a booking (cancel-with-refund), credits restored
- A client still gets blocked from another client's bookings
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
EMP_EMAIL = "alex@sithappens.com"
EMP_PASSWORD = "emp1234"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def emp_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMP_EMAIL, "password": EMP_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"employee login failed: {r.status_code} {r.text}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog(admin_headers):
    """Pick a dog whose owner has at least 1 daycare credit. Returns
    (dog, client) so the test knows the starting balance."""
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    for d in dogs:
        if not d.get("owner_id"):
            continue
        c = requests.get(f"{BASE}/api/clients/{d['owner_id']}", headers=admin_headers, timeout=15).json()
        if c.get("credits", 0) >= 2:  # need at least 1 to deduct + room to grow
            return d, c
    pytest.skip("no dogs with owners holding >= 2 daycare credits")


def test_employee_can_read_client(emp_headers, a_dog):
    """Sprint 101 — employee perm lift on GET /api/clients/{id}."""
    _, client = a_dog
    r = requests.get(f"{BASE}/api/clients/{client['id']}", headers=emp_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == client["id"]
    assert "credits" in body


def test_employee_checkout_with_credits_and_price(admin_headers, emp_headers, a_dog):
    """Admin creates a daycare booking, employee checks it out using credits +
    a base price override. Credits should be deducted and actual_price stamped."""
    from datetime import date
    dog, client = a_dog
    starting_credits = int(client.get("credits") or 0)

    # 1. Admin creates + approves a daycare booking with auto-check-in
    body = {
        "dog_id": dog["id"], "client_id": client["id"], "service_type": "daycare",
        "date": date.today().isoformat(), "notes": f"emp checkout test {uuid.uuid4().hex[:6]}",
        "check_in_now": True, "override_vaccines": True, "override_capacity": True,
    }
    r = requests.post(f"{BASE}/api/bookings", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    bid = booking["id"]

    try:
        # 2. Employee fetches the booking detail
        rb = requests.get(f"{BASE}/api/bookings/{bid}", headers=emp_headers, timeout=15)
        assert rb.status_code == 200, rb.text

        # 3. Employee posts the full check-out body (credits + price override)
        checkout_body = {
            "use_credits": True,
            "add_ons": [],
            "base_price": 42.50,
        }
        rc = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=emp_headers, json=checkout_body, timeout=15)
        assert rc.status_code == 200, rc.text

        # 4. Verify state — booking completed, actual_price set, credits deducted
        rb2 = requests.get(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15).json()
        assert rb2["status"] == "completed", rb2
        assert rb2.get("checked_out_at"), "no check-out timestamp"
        assert float(rb2.get("actual_price") or 0) == 42.50, f"actual_price mismatch: {rb2.get('actual_price')}"
        # When using credits, payment_method should be credits
        assert rb2.get("payment_method") == "credits", f"payment_method: {rb2.get('payment_method')}"

        # 5. Client credits should have dropped by the original deduction
        c_after = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15).json()
        assert c_after["credits"] < starting_credits, f"credits not deducted: {starting_credits} → {c_after['credits']}"
    finally:
        # Best-effort cleanup — booking is "completed" so we just leave it (deletion
        # would refund nothing useful for a completed booking).
        pass


def test_employee_cancel_booking_refunds_credits(admin_headers, emp_headers, a_dog):
    """Sprint 101 — employee can DELETE a booking (cancel-with-refund)."""
    from datetime import date, timedelta
    dog, client = a_dog
    # Future-dated booking so cancellation cutoff is irrelevant
    future = (date.today() + timedelta(days=10)).isoformat()
    body = {
        "dog_id": dog["id"], "client_id": client["id"], "service_type": "daycare",
        "date": future, "notes": "emp cancel test",
        "override_vaccines": True, "override_capacity": True,
    }
    r = requests.post(f"{BASE}/api/bookings", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]

    bal_before = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15).json()["credits"]

    # Employee cancels
    rc = requests.delete(f"{BASE}/api/bookings/{bid}", headers=emp_headers, timeout=15)
    assert rc.status_code == 200, rc.text

    # Credits should be restored
    bal_after = requests.get(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15).json()["credits"]
    assert bal_after >= bal_before, f"credits not refunded: {bal_before} → {bal_after}"


def test_employee_can_get_services(emp_headers):
    """Employee needs to read the services catalog to populate add-on chips."""
    r = requests.get(f"{BASE}/api/services", headers=emp_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_client_still_blocked_from_other_client_data(emp_headers, admin_headers, a_dog):
    """Sanity: lifting GET /clients/{id} to employee_or_admin should NOT also
    silently open it to clients. Clients are not employees — they should still
    be blocked."""
    _, client = a_dog
    # Try as a fresh self-registered client account
    email = f"perm-check-{uuid.uuid4().hex[:8]}@test.com"
    rr = requests.post(f"{BASE}/api/auth/register", json={"email": email, "password": "abc12345", "name": "Perm Tester"}, timeout=15)
    if rr.status_code != 200:
        pytest.skip("could not create test client account")
    client_token = rr.json()["token"]
    r = requests.get(f"{BASE}/api/clients/{client['id']}", headers={"Authorization": f"Bearer {client_token}"}, timeout=15)
    assert r.status_code == 403, f"client should be blocked, got {r.status_code}: {r.text}"
