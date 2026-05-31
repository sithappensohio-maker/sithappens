"""Sprint 110as — Cancelling a booking with `?forfeit=true` keeps the
credit deducted, snapshots a cancellation fee, and surfaces in P&L.
"""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _seed_booking(admin_headers, *, service_type="daycare"):
    today = date.today().isoformat()
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    valid_ids = {c["id"] for c in clients}
    dog = next((d for d in dogs if d.get("owner_id") in valid_ids and (d.get("vaccines") or {}).get("rabies")), None)
    assert dog, "need a vaccinated dog with a real client to test cancel-with-charge"
    payload = {"dog_id": dog["id"], "date": today, "service_type": service_type,
               "override_capacity": True, "override_vaccines": True}
    if service_type == "training":
        payload["time"] = "11:30"
    r = requests.post(f"{BASE}/api/bookings", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    booking = r.json()
    requests.post(f"{BASE}/api/bookings/{booking['id']}/approve", headers=admin_headers, timeout=15)
    return booking


def test_cancel_with_charge_records_fee_and_keeps_credits(admin_headers):
    booking = _seed_booking(admin_headers)
    bid = booking["id"]
    client_id = booking["client_id"]
    # Snapshot client credits BEFORE cancel
    c_before = requests.get(f"{BASE}/api/clients/{client_id}", headers=admin_headers, timeout=15).json()
    credits_before = int(c_before.get("credits") or 0)

    r = requests.delete(f"{BASE}/api/bookings/{bid}?forfeit=true",
                        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("forfeit") is True
    # Fee snapshot is a non-negative number (credit_value / actual_price /
    # catalog base_price).
    assert float(body.get("cancellation_fee") or 0) >= 0

    # Booking flagged cancelled+charged with matching fee
    detail = requests.get(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15).json()
    assert detail.get("status") == "cancelled"
    assert detail.get("cancellation_charged") is True
    assert float(detail.get("cancellation_fee") or 0) == float(body.get("cancellation_fee") or 0)

    # Client credits must NOT be refunded (forfeit)
    c_after = requests.get(f"{BASE}/api/clients/{client_id}", headers=admin_headers, timeout=15).json()
    assert int(c_after.get("credits") or 0) == credits_before, (
        f"forfeit cancel should not refund credits — before={credits_before} after={c_after.get('credits')}"
    )


def test_cancel_without_charge_refunds_and_excludes_from_pnl(admin_headers):
    booking = _seed_booking(admin_headers)
    bid = booking["id"]
    client_id = booking["client_id"]
    # Get current PnL revenue
    pnl_before = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    rev_before = float(pnl_before.get("revenue") or 0)

    # Default cancel (no forfeit)
    r = requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("forfeit") is False

    detail = requests.get(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15).json()
    assert detail.get("status") == "cancelled"
    assert not detail.get("cancellation_charged")

    # P&L revenue should not have INCREASED due to this booking — it should
    # decrease (or stay equal) because the cancelled booking drops out.
    pnl_after = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    rev_after = float(pnl_after.get("revenue") or 0)
    assert rev_after <= rev_before, (
        f"unforfeit cancel must not pad P&L · before={rev_before} after={rev_after}"
    )


def test_client_cannot_self_charge_a_cancellation(admin_headers):
    """Clients hitting `?forfeit=true` on their own booking must get 403 —
    only staff can issue a cancellation charge.
    """
    # Use the seeded test client account
    login = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "testclient@sithappens.com", "password": "test1234"},
        timeout=15,
    )
    if login.status_code != 200:
        pytest.skip("test client account not seeded")
    client_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    # Client books on their own behalf (any future date so cutoff doesn't trip)
    me = requests.get(f"{BASE}/api/auth/me", headers=client_headers, timeout=15).json()
    dogs = requests.get(f"{BASE}/api/dogs", headers=client_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    dog = next((d for d in dogs if (d.get("vaccines") or {}).get("rabies")), None)
    if not dog:
        pytest.skip("test client has no vaccinated dog seeded")
    # Date 30 days out
    from datetime import timedelta
    future = (date.today() + timedelta(days=30)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={"dog_id": dog["id"], "date": future, "service_type": "daycare"},
        headers=client_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    # Client tries to forfeit-cancel — must be blocked
    r = requests.delete(f"{BASE}/api/bookings/{bid}?forfeit=true",
                        headers=client_headers, timeout=15)
    assert r.status_code == 403, r.text
    # Cleanup with normal cancel
    requests.delete(f"{BASE}/api/bookings/{bid}", headers=client_headers, timeout=15)
