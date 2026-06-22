"""Sprint 110di-66b — Verify per-step `description` and `minutes` persist
on the Daily Tracker POST endpoint, and that GET returns them back.
This proves the frontend bug fix (submit() now sends s.description) is
backed by a backend that actually stores & returns the field.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def test_dog(admin_headers):
    """Find a usable dog. Reuse first existing one, or create a TEST_ client+dog."""
    r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    dogs = r.json()
    if dogs:
        return dogs[0]
    # Create a TEST_ client + dog
    cr = requests.post(f"{BASE_URL}/api/clients", headers=admin_headers,
                       json={"name": f"TEST_Client_{uuid.uuid4().hex[:6]}", "email": f"test_{uuid.uuid4().hex[:6]}@example.com"}, timeout=30)
    assert cr.status_code in (200, 201), cr.text
    client_id = cr.json()["id"]
    dr = requests.post(f"{BASE_URL}/api/dogs", headers=admin_headers,
                       json={"client_id": client_id, "name": f"TEST_Dog_{uuid.uuid4().hex[:6]}", "breed": "Mixed"}, timeout=30)
    assert dr.status_code in (200, 201), dr.text
    return dr.json()


def test_description_and_minutes_persist_on_daily_tracker(admin_headers, test_dog):
    dog_id = test_dog["id"]
    payload = {
        "dog_id": dog_id,
        "title": f"TEST_StepDesc_{uuid.uuid4().hex[:6]}",
        "instructions": "Test plan overview",
        "video_url": "",
        "days": [
            {
                "day_number": 1,
                "day_focus": "Foundations",
                "instructions": "",
                "equipment": ["clicker"],
                "steps": [
                    {"id": "s-1-1", "label": "Charge the marker", "minutes": 3,
                     "description": "Say Yes! then treat. No cue, no behaviour."},
                    {"id": "s-1-2", "label": "Sit (2 reps)", "minutes": 2,
                     "description": "Lure-based"},
                    {"id": "s-1-3", "label": "Untimed step", "description": "No minutes here"},
                ],
                "resources": [],
                "fields": [
                    {"id": "f-1-mood", "label": "How'd it go?", "kind": "mood_5"},
                    {"id": "f-1-notes", "label": "Notes", "kind": "longtext"},
                ],
            }
        ],
        "save_as_template": False,
        "template_name": "",
        "resources": [],
    }
    pr = requests.post(f"{BASE_URL}/api/homework/daily-tracker", headers=admin_headers, json=payload, timeout=60)
    assert pr.status_code in (200, 201), f"POST failed: {pr.status_code} {pr.text[:400]}"
    created = pr.json()
    hw_id = created.get("id") or created.get("homework_id")
    assert hw_id, f"no id in response: {created}"

    # GET back to verify persistence
    gr = requests.get(f"{BASE_URL}/api/homework/{hw_id}", headers=admin_headers, timeout=30)
    assert gr.status_code == 200, f"GET failed: {gr.status_code} {gr.text[:400]}"
    hw = gr.json()

    # Steps live under template_snapshot.sections[].steps[] AND daily_progress[].steps[]
    snap = hw.get("template_snapshot") or {}
    sections = snap.get("sections") or []
    assert sections, f"no sections in template_snapshot: {hw}"
    steps = sections[0].get("steps", [])
    assert len(steps) == 3, f"expected 3 steps, got {len(steps)}: {steps}"

    # Also verify daily_progress mirror has the steps with same fields
    dp = hw.get("daily_progress") or []
    assert dp and dp[0].get("steps") and len(dp[0]["steps"]) == 3

    # Descriptions persisted
    descs = [s.get("description") for s in steps]
    assert "Say Yes! then treat. No cue, no behaviour." in descs, f"descriptions: {descs}"
    assert "Lure-based" in descs, f"descriptions: {descs}"
    assert "No minutes here" in descs, f"descriptions: {descs}"

    # Minutes persisted
    minutes = [s.get("minutes") for s in steps]
    assert 3 in minutes
    assert 2 in minutes
    # Untimed step: minutes is null/None or absent
    untimed = [s for s in steps if s.get("label") == "Untimed step"]
    assert untimed and (untimed[0].get("minutes") in (None, 0, "")), f"untimed step minutes: {untimed}"

    # Cleanup
    requests.delete(f"{BASE_URL}/api/homework/{hw_id}", headers=admin_headers, timeout=30)
