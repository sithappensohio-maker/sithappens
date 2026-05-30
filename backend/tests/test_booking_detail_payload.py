"""Sprint 110aq — Booking detail modal opens via `GET /bookings/{id}` plus
`GET /dogs/{id}` + `GET /clients/{id}`. Make sure those return the fields
the modal renders (status timestamps, audit fields, add-ons, report card)."""
import os
from datetime import date, timedelta

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


@pytest.fixture(scope="module")
def fresh_booking(admin_headers):
    """Picks any existing checked-in booking, or creates a new one."""
    # Easier: just GET dashboard stats and grab any roster row
    s = requests.get(f"{BASE}/api/dashboard/stats", headers=admin_headers, timeout=15).json()
    roster = s.get("today_roster") or []
    if roster:
        return roster[0]
    # Otherwise create one
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    valid_ids = {c["id"] for c in clients}
    dog = next((d for d in dogs if d.get("owner_id") in valid_ids and (d.get("vaccines") or {}).get("rabies")), None)
    assert dog, "no dog available to create test booking"
    today = date.today().isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={"dog_id": dog["id"], "date": today, "service_type": "daycare"},
        headers=admin_headers, timeout=15,
    )
    if r.status_code != 200:
        # capacity etc — try tomorrow
        r = requests.post(
            f"{BASE}/api/bookings",
            json={"dog_id": dog["id"], "date": (date.today()+timedelta(days=1)).isoformat(),
                  "service_type": "daycare", "override_capacity": True},
            headers=admin_headers, timeout=15,
        )
    assert r.status_code == 200, r.text
    return r.json()


def test_get_booking_by_id_returns_full_row(admin_headers, fresh_booking):
    """Modal does `GET /bookings/{id}` — must include the fields the UI
    renders. Optional fields are allowed to be absent (modal uses ?. chaining)
    but the core ones must always exist."""
    r = requests.get(f"{BASE}/api/bookings/{fresh_booking['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    # Core identification
    for f in ("id", "dog_id", "dog_name", "client_id", "client_name", "service_type", "date"):
        assert f in b, f"booking missing `{f}`"
    # Audit + price fields the modal renders (must exist; null is fine)
    for f in ("checked_in_at", "checked_out_at", "actual_price",
              "add_ons", "notes"):
        assert f in b, f"booking missing `{f}` (modal renders it)"


def test_get_dog_by_id_returns_care_fields(admin_headers, fresh_booking):
    """Modal also fetches the dog so we can show breed/age/notes/meds.
    Age is stored as age_y / age_m so the modal renders "{age_y}y {age_m}m"."""
    r = requests.get(f"{BASE}/api/dogs/{fresh_booking['dog_id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for f in ("id", "name", "breed", "age_y", "age_m",
              "medications", "feeding_schedule", "notes", "tags", "photo"):
        assert f in d, f"dog row missing `{f}` (modal renders it)"


def test_get_client_by_id_returns_contact(admin_headers, fresh_booking):
    """Modal also fetches the client so we can render phone/email links."""
    r = requests.get(f"{BASE}/api/clients/{fresh_booking['client_id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    c = r.json()
    for f in ("id", "name", "phone", "email"):
        assert f in c, f"client row missing `{f}` (modal renders it)"
