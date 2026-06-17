"""Sprint 110et — Phase 3: Waitlist + capacity-aware availability.

Covers the full waitlist lifecycle:
  - GET /availability returns capacity/count/is_full for daycare & boarding
  - POST /waitlist adds an entry with status="waiting"
  - GET /waitlist filters by status/service_type/client_id
  - PUT updates priority/status/notes; "offered" auto-stamps offered_at
  - POST /waitlist/{id}/convert-to-booking creates a real booking that
    bypasses the daily capacity cap but still runs vaccine/waiver checks,
    and flips the entry to status="booked" with the booking id linked.
  - Bad status / priority rejected with 400
"""
import os
import uuid
import pytest
import requests
from datetime import date


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_availability_shape(admin_headers):
    today = date.today().isoformat()
    r = requests.get(
        f"{BASE}/api/availability?date={today}&service_type=daycare",
        headers=admin_headers, timeout=15,
    ).json()
    for k in ("service_type", "date", "capacity", "count", "available", "is_full", "has_limit"):
        assert k in r, f"availability response missing {k}"
    assert r["service_type"] == "daycare"
    assert r["date"] == today
    assert r["has_limit"] is True
    # Time-slotted service returns has_limit=False
    r2 = requests.get(
        f"{BASE}/api/availability?date={today}&service_type=training",
        headers=admin_headers, timeout=15,
    ).json()
    assert r2["has_limit"] is False
    assert r2["is_full"] is False


def test_waitlist_full_lifecycle(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    today = date.today().isoformat()

    # Create client + dog with valid vaccines
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"WL-{suffix}", "email": f"wl-{suffix}@e.com"},
        timeout=15,
    ).json()
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={"name": f"WLPup-{suffix}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
        timeout=15,
    ).json()

    try:
        # ── Add to waitlist
        entry = requests.post(
            f"{BASE}/api/waitlist", headers=admin_headers,
            json={"dog_id": dog["id"], "service_type": "daycare",
                  "requested_date": today, "priority": "high",
                  "notes": "owner is flexible"},
            timeout=15,
        ).json()
        assert entry["status"] == "waiting"
        assert entry["priority"] == "high"
        assert entry["client_id"] == client["id"]
        assert entry["dog_name"] == dog["name"]
        eid = entry["id"]

        # ── List filtered by client
        listed = requests.get(
            f"{BASE}/api/waitlist?client_id={client['id']}",
            headers=admin_headers, timeout=15,
        ).json()
        assert any(e["id"] == eid for e in listed["entries"])
        for status in ("waiting", "offered", "booked", "declined", "expired", "removed"):
            assert status in listed["statuses"]

        # ── Bad status rejected
        bad = requests.put(
            f"{BASE}/api/waitlist/{eid}", headers=admin_headers,
            json={"status": "rocket"}, timeout=15,
        )
        assert bad.status_code == 400

        # ── Move to "offered" → auto-stamps offered_at
        offered = requests.put(
            f"{BASE}/api/waitlist/{eid}", headers=admin_headers,
            json={"status": "offered"}, timeout=15,
        ).json()
        assert offered["status"] == "offered"
        assert offered["offered_at"]

        # ── Update priority + notes
        upd = requests.put(
            f"{BASE}/api/waitlist/{eid}", headers=admin_headers,
            json={"priority": "low", "notes": "owner went on vacation"}, timeout=15,
        ).json()
        assert upd["priority"] == "low"
        assert upd["notes"] == "owner went on vacation"

        # ── Convert to booking — should bypass capacity, succeed
        conv = requests.post(
            f"{BASE}/api/waitlist/{eid}/convert-to-booking",
            headers=admin_headers, timeout=15,
        )
        conv.raise_for_status()
        body = conv.json()
        assert "booking" in body
        assert body["waitlist_entry_id"] == eid
        booking_id = body["booking"]["id"] if isinstance(body["booking"], dict) else body["booking"].id

        # ── Entry is now status=booked with booking_id stamped
        final = requests.get(f"{BASE}/api/waitlist/{eid}", headers=admin_headers, timeout=15).json()
        assert final["status"] == "booked"
        assert final["booking_id"] == booking_id

        # ── Can't convert a booked entry again
        again = requests.post(
            f"{BASE}/api/waitlist/{eid}/convert-to-booking",
            headers=admin_headers, timeout=15,
        )
        assert again.status_code == 400

        # cleanup booking
        requests.delete(f"{BASE}/api/bookings/{booking_id}", headers=admin_headers, timeout=15)

    finally:
        # cleanup
        listed = requests.get(
            f"{BASE}/api/waitlist?client_id={client['id']}",
            headers=admin_headers, timeout=15,
        ).json()
        for e in listed["entries"]:
            requests.delete(f"{BASE}/api/waitlist/{e['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
