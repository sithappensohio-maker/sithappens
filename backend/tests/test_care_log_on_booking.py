"""Sprint 110co — Care logs (feeding/medication confirmations + bathroom
counters) captured by staff during a visit are surfaced on the booking
response, so the client portal and admin detail modal can render them
inside / alongside the report card.
"""
import os
import uuid
import pytest
import requests
from datetime import date

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def staff_headers(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    email = f"care-{suffix}@sithappens.com"
    pw = "FloorCare123!"
    requests.post(f"{API}/admin/employees", headers=admin_headers,
                  json={"name": f"Care {suffix}", "email": email, "password": pw, "hourly_rate": 18.0},
                  timeout=15).raise_for_status()
    login = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15).json()
    return {"Authorization": f"Bearer {login['token']}"}


@pytest.fixture
def visit(admin_headers):
    """Boarding visit with one feeding + one medication scheduled."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Care Owner {suffix}",
                                 "email": f"care-o-{suffix}@e.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"CareDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 4,
                              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
                              "feeding_schedule": [{"time": "08:00", "amount": "1c", "food_type": "kibble", "notes": ""}],
                              "medications": [{"name": "Apoquel", "dosage": "1 tab", "times": ["08:00"], "with_food": True, "notes": ""}]},
                        timeout=15).json()
    booking = requests.post(f"{API}/bookings", headers=admin_headers,
                            json={"dog_id": dog["id"], "service_type": "grooming",
                                  "grooming_type": "bath",
                                  "date": date.today().isoformat(),
                                  "status": "approved"},
                            timeout=15).json()
    return {"client": client, "dog": dog, "booking": booking}


def test_care_logs_surface_on_booking_response(staff_headers, admin_headers, visit):
    """After staff logs feeding/medication/bathroom, the booking endpoint
    must include those arrays so the client's report card can render them."""
    bid = visit["booking"]["id"]
    # Staff fires off all three kinds of care actions.
    requests.post(f"{API}/employee/bookings/{bid}/log-feeding", headers=staff_headers,
                  json={"index": 0, "note": "ate everything"}, timeout=15).raise_for_status()
    requests.post(f"{API}/employee/bookings/{bid}/log-medication", headers=staff_headers,
                  json={"index": 0, "note": "hidden in cheese"}, timeout=15).raise_for_status()
    for _ in range(2):
        requests.post(f"{API}/employee/bookings/{bid}/bathroom", headers=staff_headers,
                      json={"kind": "pee", "delta": 1}, timeout=15)
    requests.post(f"{API}/employee/bookings/{bid}/bathroom", headers=staff_headers,
                  json={"kind": "poop", "delta": 1}, timeout=15)

    # Admin pulls the booking detail.
    b = requests.get(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15).json()
    assert b.get("feeding_log") and len(b["feeding_log"]) == 1
    assert b["feeding_log"][0]["note"] == "ate everything"
    assert b["feeding_log"][0]["by_name"]
    assert b.get("medication_log") and len(b["medication_log"]) == 1
    assert b["medication_log"][0]["note"] == "hidden in cheese"
    assert b["bathroom_log"]["pee"] == 2
    assert b["bathroom_log"]["poop"] == 1


def test_care_logs_serialize_with_correct_shape(staff_headers, admin_headers, visit):
    """The BookingOut model exposes feeding_log / medication_log / bathroom_log
    so the client-portal payload carries everything needed to render the
    care-log strip alongside the report card. Even when no logs exist yet,
    the keys must be present (frontend depends on the shape)."""
    bid = visit["booking"]["id"]
    # Verify shape BEFORE any logging — keys present, sensible defaults.
    fresh = requests.get(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15).json()
    assert "feeding_log" in fresh
    assert "medication_log" in fresh
    assert "bathroom_log" in fresh
    # The bathroom_log defaults to None until first tick; once ticked,
    # it becomes {pee, poop}.
    requests.post(f"{API}/employee/bookings/{bid}/bathroom", headers=staff_headers,
                  json={"kind": "pee", "delta": 1}, timeout=15)
    ticked = requests.get(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15).json()
    assert ticked["bathroom_log"] == {"pee": 1, "poop": 0}
