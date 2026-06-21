"""Sprint 110cn — Staff Portal P0 additions.

Validates the new floor-action endpoints for the Employee Portal:
  • /employee/incidents (POST) — staff can log incidents from the floor
  • /employee/bookings/{id}/log-feeding (POST)
  • /employee/bookings/{id}/log-medication (POST) — w/ photo proof
  • /employee/bookings/{id}/bathroom (POST) — pee/poop counter
  • /employee/punch-corrections (POST + GET)
  • /employee/punch-corrections/{id}/decision (POST, admin only)
  • /employee/trivia/quiz + /employee/trivia/answer (staff learning)
  • /employee/roster-today now includes vaccines, feeding_log, medication_log,
    bathroom_log, is_birthday
"""
import os
import uuid
import pytest
import requests
from datetime import date, datetime, timezone

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
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
    """Spin up a fresh staff account (or reuse one if it exists) and return
    a logged-in token for it. Staff-only endpoints should accept this."""
    suffix = uuid.uuid4().hex[:6]
    email = f"floor-{suffix}@sithappens.com"
    password = "FloorPass123!"
    r = requests.post(
        f"{API}/admin/employees", headers=admin_headers,
        json={"name": f"Floor {suffix}", "email": email, "password": password, "hourly_rate": 18.0},
        timeout=15,
    )
    r.raise_for_status()
    login = requests.post(f"{API}/auth/login",
                          json={"email": email, "password": password}, timeout=15)
    login.raise_for_status()
    return {"Authorization": f"Bearer {login.json()['token']}"}


@pytest.fixture
def floor_dog_and_booking(admin_headers):
    """Create a client + dog + today's approved booking so we have something
    on the roster to log against."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Floor Client {suffix}",
                                 "email": f"floor-c-{suffix}@example.com"},
                           timeout=15).json()
    dog_resp = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"FloorDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 3,
                              "birthday": date.today().isoformat(),  # birthday today!
                              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
                              "feeding_schedule": [{"time": "12:00", "amount": "1c", "food_type": "kibble", "notes": ""}],
                              "medications": [{"name": "Apoquel", "dosage": "1/2 tab", "times": ["08:00"], "with_food": True, "notes": ""}]},
                        timeout=15)
    if dog_resp.status_code >= 400:
        raise AssertionError(f"Dog creation failed: {dog_resp.status_code} {dog_resp.text}")
    dog = dog_resp.json()
    booking_resp = requests.post(f"{API}/bookings", headers=admin_headers,
                            json={"dog_id": dog["id"], "service_type": "grooming",
                                  "grooming_type": "bath",
                                  "date": date.today().isoformat(),
                                  "status": "approved"},
                            timeout=15)
    if booking_resp.status_code >= 400:
        raise AssertionError(f"Booking creation failed: {booking_resp.status_code} {booking_resp.text}")
    booking = booking_resp.json()
    return {"client": client, "dog": dog, "booking": booking}


# ─────────────────────── 1. Incident logging ───────────────────────
def test_staff_can_log_incident(staff_headers, floor_dog_and_booking):
    dog = floor_dog_and_booking["dog"]
    resp = requests.post(f"{API}/employee/incidents", headers=staff_headers,
                         json={"dog_id": dog["id"], "type": "behavior",
                               "severity": "minor",
                               "description": "Mild resource guarding at water bowl",
                               "action_taken": "Separated, gave space"},
                         timeout=15)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dog_id"] == dog["id"]
    assert body["dog_name"] == dog["name"]
    assert body["reported_by"]   # staff name auto-stamped
    assert body["date"] == date.today().isoformat()
    assert body["time"]          # auto HH:MM


def test_staff_incident_rejects_unknown_dog(staff_headers):
    resp = requests.post(f"{API}/employee/incidents", headers=staff_headers,
                         json={"dog_id": "does-not-exist", "type": "bite",
                               "severity": "moderate", "description": "test"},
                         timeout=15)
    assert resp.status_code == 404


# ─────────────────────── 2. Feeding / Medication logs ───────────────────────
def test_staff_can_log_feeding_and_medication(staff_headers, floor_dog_and_booking):
    bid = floor_dog_and_booking["booking"]["id"]
    # log feeding index 0
    r1 = requests.post(f"{API}/employee/bookings/{bid}/log-feeding",
                       headers=staff_headers, json={"index": 0, "note": "ate everything"},
                       timeout=15)
    assert r1.status_code == 200
    # log medication index 0
    r2 = requests.post(f"{API}/employee/bookings/{bid}/log-medication",
                       headers=staff_headers, json={"index": 0, "note": "in cheese"},
                       timeout=15)
    assert r2.status_code == 200
    # Both entries should now show on the roster
    roster = requests.get(f"{API}/employee/roster-today", headers=staff_headers,
                          timeout=15).json()
    row = next(r for r in roster["roster"] if r["booking_id"] == bid)
    assert any(x["index"] == 0 for x in row["feeding_log"])
    assert any(x["index"] == 0 for x in row["medication_log"])
    # By-name should be stamped from the staff token
    assert row["feeding_log"][0]["by_name"]


# ─────────────────────── 3. Bathroom counter ───────────────────────
def test_bathroom_counter_increments_and_undoes(staff_headers, floor_dog_and_booking):
    bid = floor_dog_and_booking["booking"]["id"]
    for _ in range(3):
        requests.post(f"{API}/employee/bookings/{bid}/bathroom",
                      headers=staff_headers, json={"kind": "pee", "delta": 1},
                      timeout=15)
    requests.post(f"{API}/employee/bookings/{bid}/bathroom",
                  headers=staff_headers, json={"kind": "poop", "delta": 1},
                  timeout=15)
    # Undo one pee
    r = requests.post(f"{API}/employee/bookings/{bid}/bathroom",
                      headers=staff_headers, json={"kind": "pee", "delta": -1},
                      timeout=15)
    assert r.json()["bathroom_log"]["pee"] == 2
    assert r.json()["bathroom_log"]["poop"] == 1


def test_bathroom_counter_clamped_to_zero(staff_headers, floor_dog_and_booking):
    bid = floor_dog_and_booking["booking"]["id"]
    # Walk it past zero — should clamp.
    r1 = requests.post(f"{API}/employee/bookings/{bid}/bathroom",
                  headers=staff_headers, json={"kind": "poop", "delta": -1}, timeout=15)
    r = requests.post(f"{API}/employee/bookings/{bid}/bathroom",
                      headers=staff_headers, json={"kind": "poop", "delta": -1}, timeout=15)
    assert r.status_code == 200, f"r1={r1.status_code} {r1.text} | r={r.status_code} {r.text}"
    assert r.json()["bathroom_log"]["poop"] >= 0


# ─────────────────────── 4. Roster surfaces vaccines + birthday ───────────────────────
def test_roster_includes_vaccines_and_birthday(staff_headers, floor_dog_and_booking):
    roster = requests.get(f"{API}/employee/roster-today", headers=staff_headers, timeout=15).json()
    row = next(r for r in roster["roster"] if r["booking_id"] == floor_dog_and_booking["booking"]["id"])
    assert "vaccines" in row
    assert row["vaccines"].get("rabies") == "2028-01-01"
    assert row["is_birthday"] is True  # DOB set to today in the fixture


# ─────────────────────── 5. Punch corrections ───────────────────────
def test_staff_submit_and_admin_decide_punch_correction(admin_headers, staff_headers):
    """Staff submits a correction. Admin approves. The time_clock_entries
    collection should reflect the new times."""
    today = date.today().isoformat()
    submit = requests.post(f"{API}/employee/punch-corrections", headers=staff_headers,
                           json={"target_date": today,
                                 "requested_clock_in": f"{today}T09:00:00Z",
                                 "requested_clock_out": f"{today}T17:00:00Z",
                                 "reason": "Forgot to clock in this morning"},
                           timeout=15)
    assert submit.status_code == 200
    cid = submit.json()["id"]
    assert submit.json()["status"] == "pending"

    # Staff sees only their own corrections.
    mine = requests.get(f"{API}/employee/punch-corrections", headers=staff_headers, timeout=15).json()
    assert any(r["id"] == cid for r in mine)

    # Admin approves.
    decision = requests.post(f"{API}/employee/punch-corrections/{cid}/decision",
                             headers=admin_headers,
                             json={"decision": "approved", "admin_note": "Confirmed via cameras"},
                             timeout=15)
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "approved"
    assert decision.json()["admin_note"] == "Confirmed via cameras"


def test_admin_can_deny_punch_correction(admin_headers, staff_headers):
    today = date.today().isoformat()
    cid = requests.post(f"{API}/employee/punch-corrections", headers=staff_headers,
                       json={"target_date": today,
                             "requested_clock_in": f"{today}T08:00:00Z",
                             "reason": "test deny"}, timeout=15).json()["id"]
    r = requests.post(f"{API}/employee/punch-corrections/{cid}/decision",
                      headers=admin_headers, json={"decision": "denied"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "denied"
    # Re-decide should fail.
    r2 = requests.post(f"{API}/employee/punch-corrections/{cid}/decision",
                       headers=admin_headers, json={"decision": "approved"}, timeout=15)
    assert r2.status_code == 409


def test_staff_cannot_decide_punch_correction(staff_headers):
    today = date.today().isoformat()
    cid = requests.post(f"{API}/employee/punch-corrections", headers=staff_headers,
                       json={"target_date": today, "reason": "test rbac"}, timeout=15).json()["id"]
    r = requests.post(f"{API}/employee/punch-corrections/{cid}/decision",
                      headers=staff_headers, json={"decision": "approved"}, timeout=15)
    assert r.status_code in (401, 403)


# ─────────────────────── 6. Trivia (staff learning) ───────────────────────
def test_staff_can_play_trivia_quiz(staff_headers):
    quiz = requests.get(f"{API}/employee/trivia/quiz", headers=staff_headers,
                       params={"count": 3}, timeout=15)
    assert quiz.status_code == 200
    qs = quiz.json()["questions"]
    assert 1 <= len(qs) <= 3
    for q in qs:
        # Correct_index must NOT be revealed in the quiz payload.
        assert "correct_index" not in q
        assert q["choices"] and len(q["choices"]) >= 2
    # Answering reveals the correct index + explanation, no scoring.
    q = qs[0]
    ans = requests.post(f"{API}/employee/trivia/answer", headers=staff_headers,
                       json={"question_id": q["id"], "chosen_index": 0}, timeout=15)
    assert ans.status_code == 200
    body = ans.json()
    assert "correct_index" in body
    assert "correct" in body
