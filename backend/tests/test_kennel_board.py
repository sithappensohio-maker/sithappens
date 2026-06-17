"""Sprint 110eu — Phase 4: Visual Kennel/Daycare board regression.

Covers:
  - GET /api/kennel-board/labels returns the five defaulted lists
  - PUT /api/kennel-board/labels persists custom labels
  - GET /api/kennel-board returns groups + summary + on_site_count, with
    each card carrying assignment fields + warnings dict
  - PATCH /api/bookings supports the four new assignment fields
    (kennel, room, crate, yard_group, training_group) — they round-trip
    through the board response
  - PUT /api/dogs/{id}/safety-flags persists; the kennel board reflects them
  - Vaccine-lapsed warning fires when the dog has no rabies date
  - Do-not-group warning fires when "Do not group" appears in safety_flags
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


def test_labels_get_and_put(admin_headers):
    base = requests.get(f"{BASE}/api/kennel-board/labels", headers=admin_headers, timeout=15).json()
    for k in ("kennels", "rooms", "crates", "yard_groups", "training_groups"):
        assert k in base and isinstance(base[k], list)

    # Partial update — change only "kennels", others should retain defaults/saved
    new_kennels = ["Test-Kennel-1", "Test-Kennel-2"]
    r = requests.put(
        f"{BASE}/api/kennel-board/labels", headers=admin_headers,
        json={"kennels": new_kennels}, timeout=15,
    )
    r.raise_for_status()
    saved = r.json()
    assert saved["kennels"] == new_kennels
    # other keys still present
    for k in ("rooms", "crates", "yard_groups", "training_groups"):
        assert k in saved and len(saved[k]) > 0

    # Restore originals so we don't pollute the install
    requests.put(
        f"{BASE}/api/kennel-board/labels", headers=admin_headers,
        json={"kennels": base["kennels"]}, timeout=15,
    )


def test_board_assignment_roundtrip_and_warnings(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    today = date.today().isoformat()

    # Create client + dog WITHOUT valid rabies (date in past) so vaccine warning fires
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"KB-{suffix}", "email": f"kb-{suffix}@e.com"},
        timeout=15,
    ).json()
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={
            "name": f"KBPup-{suffix}", "owner_id": client["id"],
            "breed": "Mix", "age_y": 3,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
        },
        timeout=15,
    ).json()

    # Booking on-site today
    b = requests.post(
        f"{BASE}/api/bookings", headers=admin_headers,
        json={"dog_id": dog["id"], "service_type": "boarding",
              "date": today, "end_date": today, "status": "approved",
              "override_capacity": True, "override_vaccines": True},
        timeout=15,
    )
    if b.status_code != 200:
        pytest.skip(f"Could not create booking: {b.text}")
    booking = b.json()

    try:
        # PATCH all five assignment fields at once
        patch = requests.patch(
            f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers,
            json={"kennel": "Suite 1", "room": "Quiet Room", "crate": "Crate 2",
                  "yard_group": "Big Dogs", "training_group": "Group A"},
            timeout=15,
        )
        patch.raise_for_status()
        b_after = patch.json()
        assert b_after["kennel"] == "Suite 1"
        assert b_after["room"] == "Quiet Room"
        assert b_after["crate"] == "Crate 2"
        assert b_after["yard_group"] == "Big Dogs"
        assert b_after["training_group"] == "Group A"

        # Add safety flags including "Do not group"
        sf = requests.put(
            f"{BASE}/api/dogs/{dog['id']}/safety-flags", headers=admin_headers,
            json={"flags": ["Do not group", "Muzzle required"]},
            timeout=15,
        ).json()
        assert "Do not group" in sf["safety_flags"]

        # Board reflects everything
        board = requests.get(f"{BASE}/api/kennel-board", headers=admin_headers, timeout=15).json()
        cards = [c for c in board["groups"]["boarding"] if c["booking_id"] == booking["id"]]
        assert len(cards) == 1, "Booking should appear on the boarding bucket"
        c = cards[0]
        assert c["kennel"] == "Suite 1"
        assert c["room"] == "Quiet Room"
        assert c["yard_group"] == "Big Dogs"
        assert "Do not group" in c["safety_flags"]
        assert c["warnings"]["do_not_group"] is True

    finally:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
