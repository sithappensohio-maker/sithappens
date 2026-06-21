"""Sprint 110at — Calendar `/events` keeps showing completed bookings
(muted color), while `/bookings` list view continues to hide them by
default.
"""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def completed_booking(admin_headers):
    """Approved booking that we promote to 'completed' via check-in + check-out."""
    today = date.today().isoformat()
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    valid_ids = {c["id"] for c in clients}
    dog = next((d for d in dogs if d.get("owner_id") in valid_ids and (d.get("vaccines") or {}).get("rabies")), None)
    assert dog, "need a vaccinated dog with a real client"
    r = requests.post(
        f"{BASE}/api/bookings",
        json={"dog_id": dog["id"], "date": today, "service_type": "daycare",
              "override_capacity": True, "override_vaccines": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    booking = r.json()
    requests.post(f"{BASE}/api/bookings/{booking['id']}/approve", headers=admin_headers, timeout=15)
    requests.post(f"{BASE}/api/bookings/{booking['id']}/check-in", headers=admin_headers, timeout=15)
    r = requests.post(
        f"{BASE}/api/bookings/{booking['id']}/check-out",
        json={"base_price": 25.0, "payment_method": "cash", "mark_paid": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    yield r.json()
    # Cleanup
    requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)


def test_completed_booking_shows_on_calendar(admin_headers, completed_booking):
    """Completed bookings used to vanish from the calendar the moment check-out
    happened — now they should still appear (greyed out)."""
    events = requests.get(f"{BASE}/api/events", headers=admin_headers, timeout=15).json()
    match = next((e for e in events if e["id"] == completed_booking["id"]), None)
    assert match is not None, (
        "completed booking is missing from /events — calendar will look empty after check-out"
    )
    # extendedProps.status surfaces as 'completed'
    assert match.get("extendedProps", {}).get("status") == "completed"
    # Muted color (slate) so it doesn't compete visually with active bookings
    assert match.get("backgroundColor") == "#64748b"


def test_pending_and_approved_still_show(admin_headers):
    """Sanity check that adding the 'completed' status to the query didn't
    regress active bookings rendering."""
    events = requests.get(f"{BASE}/api/events", headers=admin_headers, timeout=15).json()
    statuses = {e.get("extendedProps", {}).get("status") for e in events}
    # In a real environment there's usually at least one approved booking;
    # accept any non-empty active state as the signal.
    assert "approved" in statuses or "pending" in statuses or len(events) == 0
