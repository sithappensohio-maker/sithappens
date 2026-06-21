"""Regression tests for daily-tracker Phase 2 features (Sprint 99).

Covers:
- Equipment per day propagates from create → progress
- Question thread: client asks → admin answers
- Rest day: preserves streak, unlocks next day, marks hw completed if last
- Certificate upload/download/delete
- Video upload + retrieval
- Client reminder settings (admin gets 403, client get/put)
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
CLIENT_EMAIL = "testclient@sithappens.com"
CLIENT_PASSWORD = "test1234"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip("testclient account unavailable")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog(admin_headers):
    for d in requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json():
        if d.get("owner_id"):
            return d
    pytest.skip("no client-owned dogs")


def _make(admin_headers, dog_id, days=2, with_equipment=False):
    body = {
        "dog_id": dog_id,
        "title": f"Phase2-Test {uuid.uuid4().hex[:6]}",
        "days": [
            {
                "day_number": i,
                "day_focus": f"Day {i} focus",
                "equipment": ["high-value treats", "6-ft leash"] if with_equipment else [],
                "fields": [{"id": "sets", "label": "Sets", "kind": "sets"}],
            }
            for i in range(1, days + 1)
        ],
    }
    return requests.post(f"{BASE}/api/homework/daily-tracker", headers=admin_headers, json=body, timeout=20).json()


def test_equipment_round_trips(admin_headers, a_dog):
    hw = _make(admin_headers, a_dog["id"], days=2, with_equipment=True)
    try:
        d = requests.get(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers, timeout=15).json()
        eq = d["daily_progress"][0]["equipment"]
        assert "high-value treats" in eq and "6-ft leash" in eq
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_question_thread(admin_headers, a_dog):
    hw = _make(admin_headers, a_dog["id"], days=2)
    hwid = hw["id"]
    try:
        # Ask
        r = requests.post(f"{BASE}/api/homework/{hwid}/day/1/ask", headers=admin_headers,
                          json={"text": "Is 3 sets enough?"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        qs = d["daily_progress"][0]["questions"]
        assert len(qs) == 1 and qs[0]["text"] == "Is 3 sets enough?"
        qid = qs[0]["id"]
        assert not qs[0]["answer"]

        # Answer
        r = requests.post(f"{BASE}/api/homework/{hwid}/day/1/answer/{qid}", headers=admin_headers,
                          json={"text": "Yes! 3 is plenty."}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        qs2 = d["daily_progress"][0]["questions"]
        assert qs2[0]["answer"] == "Yes! 3 is plenty."
        assert qs2[0]["answered_by"]
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_rest_day_preserves_streak_and_unlocks(admin_headers, a_dog):
    hw = _make(admin_headers, a_dog["id"], days=3)
    hwid = hw["id"]
    try:
        # Approve Day 1 normally
        requests.post(f"{BASE}/api/homework/{hwid}/day/1/submit", headers=admin_headers,
                      json={"field_values": {"sets": 3}, "mood": 4}, timeout=15)
        requests.post(f"{BASE}/api/homework/{hwid}/day/1/review", headers=admin_headers,
                      json={"action": "approve"}, timeout=15)
        # Day 2 → rest day
        r = requests.post(f"{BASE}/api/homework/{hwid}/day/2/rest", headers=admin_headers,
                          json={"note": "vet visit"}, timeout=15)
        d = r.json()
        assert d["streak"] == 2  # rest still counts
        statuses = [p["status"] for p in d["daily_progress"]]
        assert statuses == ["approved", "rest", "available"]
        # Now rest the last day to verify auto-complete via rest
        r = requests.post(f"{BASE}/api/homework/{hwid}/day/3/rest", headers=admin_headers,
                          json={}, timeout=15)
        d = r.json()
        assert d["status"] == "completed"
        assert d["streak"] == 3
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_certificate_upload_and_remove(admin_headers, a_dog):
    hw = _make(admin_headers, a_dog["id"], days=1)
    hwid = hw["id"]
    try:
        # No cert initially
        d = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers, timeout=15).json()
        assert not d.get("certificate")
        # Upload
        r = requests.post(f"{BASE}/api/homework/{hwid}/certificate", headers=admin_headers,
                          json={"photo": "data:image/png;base64,iVBORw0KGgo=", "filename": "test-cert.png"}, timeout=15)
        assert r.status_code == 200
        d = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers, timeout=15).json()
        assert d.get("certificate", "").startswith("data:image/")
        assert d.get("certificate_filename") == "test-cert.png"
        # Remove
        r = requests.delete(f"{BASE}/api/homework/{hwid}/certificate", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers, timeout=15).json()
        assert not d.get("certificate")
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_video_upload_and_fetch(admin_headers, a_dog):
    hw = _make(admin_headers, a_dog["id"], days=1)
    hwid = hw["id"]
    try:
        # Upload a "video" (just a tiny base64 string for the test)
        r = requests.post(f"{BASE}/api/homework/{hwid}/day/1/video", headers=admin_headers,
                          json={"photo": "data:video/mp4;base64,AAAAFGZ0eXBpc29t", "filename": "clip.mp4"}, timeout=15)
        assert r.status_code == 200
        media_id = r.json()["media_id"]
        # Fetch back
        r = requests.get(f"{BASE}/api/homework/{hwid}/media/{media_id}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        m = r.json()
        assert m["data"].startswith("data:video/")
        assert m["filename"] == "clip.mp4"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_reminder_settings_admin_forbidden(admin_headers):
    r = requests.get(f"{BASE}/api/portal/reminder-settings", headers=admin_headers, timeout=10)
    assert r.status_code == 403


def test_reminder_settings_client_roundtrip(client_headers):
    # Save
    r = requests.put(f"{BASE}/api/portal/reminder-settings", headers=client_headers,
                     json={"enabled": True, "days": ["mon", "wed", "fri"], "time": "18:30"}, timeout=15)
    assert r.status_code == 200
    # Read
    r = requests.get(f"{BASE}/api/portal/reminder-settings", headers=client_headers, timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s["enabled"] is True
    assert set(s["days"]) == {"mon", "wed", "fri"}
    assert s["time"] == "18:30"
    # Reject bad time
    r = requests.put(f"{BASE}/api/portal/reminder-settings", headers=client_headers,
                     json={"enabled": True, "days": ["mon"], "time": "bogus"}, timeout=15)
    assert r.status_code == 400
    # Cleanup — turn it off
    requests.put(f"{BASE}/api/portal/reminder-settings", headers=client_headers,
                 json={"enabled": False, "days": [], "time": "18:00"}, timeout=15)
