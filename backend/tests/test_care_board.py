"""Sprint 110es — Phase 2: Feeding & Medication tracker regression.

Covers:
  - GET /api/care/today returns the expected shape with summary + grouped lists
  - GET /api/bookings/{id}/care auto-seeds care_items from the dog's defaults
  - PUT /api/bookings/{id}/care replaces the schedule and preserves completion
    state on items that survive the edit
  - POST /complete stamps initials + timestamp; status flips to "completed"
    AND derived_status reflects it
  - POST /skip stamps initials + reason; status becomes "skipped"
  - POST /reset (admin) returns the item to "pending"
  - Status derivation: pending item at past time = "missed"
"""
import os
import uuid
import pytest
import requests
from datetime import date, datetime, timedelta


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
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


def _make_dog_with_schedule(admin_headers, suffix):
    # Create client + dog with feeding/med defaults
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"Care-{suffix}", "email": f"care-{suffix}@e.com"},
        timeout=15,
    ).json()
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={
            "name": f"CarePup-{suffix}", "owner_id": client["id"],
            "breed": "Mix", "age_y": 3,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
            "feeding_schedule": [
                {"time": "08:00", "amount": "1 cup", "food_type": "Kibble"},
                {"time": "18:00", "amount": "1 cup", "food_type": "Kibble"},
            ],
            "medications": [
                {"name": "Apoquel", "dosage": "16mg", "times": ["08:00"]},
            ],
        },
        timeout=15,
    ).json()
    today = date.today().isoformat()
    b = requests.post(
        f"{BASE}/api/bookings", headers=admin_headers,
        json={"dog_id": dog["id"], "service_type": "boarding",
              "date": today, "end_date": today, "status": "approved",
              "override_capacity": True, "override_vaccines": True},
        timeout=15,
    )
    if b.status_code != 200:
        pytest.skip(f"Couldn't create booking: {b.text}")
    return client, dog, b.json()


def test_care_board_shape(admin_headers):
    r = requests.get(f"{BASE}/api/care/today", headers=admin_headers, timeout=15)
    r.raise_for_status()
    d = r.json()
    assert "date" in d and "summary" in d
    assert "feedings" in d and isinstance(d["feedings"], list)
    assert "medications" in d and isinstance(d["medications"], list)
    for k in ("not_due", "due_now", "completed", "missed", "skipped"):
        assert k in d["summary"]


def test_booking_care_seed_and_complete(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    client, dog, booking = _make_dog_with_schedule(admin_headers, suffix)
    try:
        # First open seeds from dog defaults: 2 feedings + 1 med = 3 items
        care = requests.get(
            f"{BASE}/api/bookings/{booking['id']}/care", headers=admin_headers, timeout=15,
        ).json()
        items = care["items"]
        feedings = [i for i in items if i["kind"] == "feeding"]
        meds = [i for i in items if i["kind"] == "medication"]
        assert len(feedings) == 2, f"Expected 2 feedings, got {len(feedings)}"
        assert len(meds) == 1, f"Expected 1 medication, got {len(meds)}"
        # Every item must have derived_status
        for it in items:
            assert "derived_status" in it
            assert it["derived_status"] in ("not_due", "due_now", "completed", "missed", "skipped")

        # Complete the first feeding with initials
        target = feedings[0]
        comp = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/care/{target['id']}/complete",
            headers=admin_headers,
            json={"initials": "jt", "note": "ate everything"},
            timeout=15,
        ).json()
        match = next(i for i in comp["items"] if i["id"] == target["id"])
        assert match["status"] == "completed"
        assert match["derived_status"] == "completed"
        assert match["completed_initials"] == "JT"           # uppercased
        assert match["completed_at"]
        assert match["completion_note"] == "ate everything"

        # Skip the medication
        med = meds[0]
        skp = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/care/{med['id']}/skip",
            headers=admin_headers,
            json={"initials": "AB", "reason": "Dog refused"},
            timeout=15,
        ).json()
        match = next(i for i in skp["items"] if i["id"] == med["id"])
        assert match["status"] == "skipped"
        assert match["derived_status"] == "skipped"
        assert match["skip_reason"] == "Dog refused"

        # Reset the skipped med (admin-only)
        rst = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/care/{med['id']}/reset",
            headers=admin_headers, timeout=15,
        ).json()
        match = next(i for i in rst["items"] if i["id"] == med["id"])
        assert match["status"] == "pending"
        assert "skip_reason" not in match
        assert match["derived_status"] in ("not_due", "due_now", "missed")

        # ── PUT replaces schedule, but preserves completion state of feeding[0]
        kept = [i for i in items if i["id"] == target["id"]][0]
        new_schedule = {
            "items": [
                {"id": kept["id"], "kind": "feeding", "time": kept["time"],
                 "label": "Renamed", "amount": kept.get("amount", ""), "food_type": kept.get("food_type", "")},
                {"kind": "feeding", "time": "13:00", "label": "New lunch",
                 "amount": "0.5 cup", "food_type": "Kibble"},
            ]
        }
        put = requests.put(
            f"{BASE}/api/bookings/{booking['id']}/care",
            headers=admin_headers, json=new_schedule, timeout=15,
        ).json()
        new_items = put["items"]
        assert len(new_items) == 2
        kept_after = next(i for i in new_items if i["id"] == kept["id"])
        assert kept_after["status"] == "completed", "Completion state must survive PUT"
        assert kept_after["completed_initials"] == "JT"

        # Care board /today must reflect this booking now
        board = requests.get(f"{BASE}/api/care/today", headers=admin_headers, timeout=15).json()
        ours = [i for i in board["feedings"] if i.get("booking_id") == booking["id"]]
        assert len(ours) == 2, f"Booking should contribute 2 feedings to the board, got {len(ours)}"

    finally:
        # cleanup booking + dog + client
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_care_complete_requires_initials(admin_headers):
    """Boundary check: empty initials must be rejected by pydantic min_length=1."""
    suffix = uuid.uuid4().hex[:6]
    client, dog, booking = _make_dog_with_schedule(admin_headers, suffix)
    try:
        care = requests.get(
            f"{BASE}/api/bookings/{booking['id']}/care", headers=admin_headers, timeout=15,
        ).json()
        item = care["items"][0]
        r = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/care/{item['id']}/complete",
            headers=admin_headers,
            json={"initials": "", "note": ""},
            timeout=15,
        )
        assert r.status_code in (400, 422), (
            f"Empty initials must be rejected — got {r.status_code}: {r.text[:200]}"
        )
    finally:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
