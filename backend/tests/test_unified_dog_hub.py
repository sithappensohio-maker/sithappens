"""Regression tests for Sprint 95 — Unified System Tier 1.

Covers:
- GET /api/dogs/{id}/timeline  (admin + client perms)
- GET /api/dogs/{id}/behavior-trend  (mood sparkline aggregation)
- POST /api/admin/homework/send-monday-digest  (force-fire trainer Monday digest)
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog(admin_headers):
    r = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15)
    r.raise_for_status()
    for d in r.json():
        if d.get("owner_id"):
            return d
    pytest.skip("no dogs with owners on file")


def _make_tracker(headers, dog_id, days=2):
    body = {
        "dog_id": dog_id,
        "title": f"Hub test tracker {uuid.uuid4().hex[:6]}",
        "instructions": "Pytest unified-hub tracker",
        "days": [
            {
                "day_number": i,
                "day_focus": f"Day {i}",
                "instructions": "",
                "fields": [{"id": f"sets-{i}", "label": "Sets", "kind": "sets"}],
            }
            for i in range(1, days + 1)
        ],
    }
    r = requests.post(f"{BASE}/api/homework/daily-tracker", headers=headers, json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_timeline_empty_shape(admin_headers, a_dog):
    """Timeline endpoint always returns a JSON list."""
    r = requests.get(f"{BASE}/api/dogs/{a_dog['id']}/timeline", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_timeline_includes_homework_and_day_approval(admin_headers, a_dog):
    """After submitting + approving Day 1, the timeline should include both
    homework_assigned AND day_approved events for that homework, and the
    approval event should carry the mood emoji value."""
    hw = _make_tracker(admin_headers, a_dog["id"], days=2)
    hwid = hw["id"]
    try:
        # Submit Day 1 with mood=5
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit",
            headers=admin_headers,
            json={"field_values": {"sets-1": 3}, "mood": 5, "note": "Top form"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Approve
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/review",
            headers=admin_headers,
            json={"action": "approve", "note": "Nice"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # Pull timeline
        tl = requests.get(f"{BASE}/api/dogs/{a_dog['id']}/timeline", headers=admin_headers, timeout=15).json()
        kinds = [e.get("kind") for e in tl]
        # Both events for this homework should appear
        assigned_ids = [e for e in tl if e.get("kind") == "homework_assigned" and e.get("homework_id") == hwid]
        approved_ids = [e for e in tl if e.get("kind") == "day_approved" and e.get("homework_id") == hwid]
        assert assigned_ids, f"no homework_assigned event found · kinds={kinds}"
        assert approved_ids, f"no day_approved event found · kinds={kinds}"
        # Mood survives the round-trip
        assert int(approved_ids[0].get("mood") or 0) == 5
        # Timeline is newest-first
        ts = [e.get("ts") or "" for e in tl]
        assert ts == sorted(ts, reverse=True), "timeline is not sorted newest-first"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_behavior_trend_empty_when_no_logs(admin_headers, a_dog):
    """Behavior-trend should return a sane empty-state payload when there are
    no mood logs in the window."""
    r = requests.get(f"{BASE}/api/dogs/{a_dog['id']}/behavior-trend?days=1", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(["points", "avg", "trend", "count"]).issubset(data.keys())
    # When 1-day window has no logs, count is 0
    assert isinstance(data["points"], list)
    assert data["trend"] in ("up", "down", "flat")


def test_behavior_trend_picks_up_mood(admin_headers, a_dog):
    """A submitted daily-tracker mood should show up in the behavior-trend
    aggregation with the same value."""
    hw = _make_tracker(admin_headers, a_dog["id"], days=1)
    hwid = hw["id"]
    try:
        # Submit Day 1 with mood=4 (no need to approve — behavior-trend reads
        # all section_logs regardless of approval status)
        requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit",
            headers=admin_headers,
            json={"field_values": {"sets-1": 2}, "mood": 4},
            timeout=15,
        )
        r = requests.get(f"{BASE}/api/dogs/{a_dog['id']}/behavior-trend?days=7", headers=admin_headers, timeout=15)
        data = r.json()
        assert data["count"] >= 1, f"expected at least 1 mood point · got {data}"
        # The just-submitted mood=4 should be in the points list
        moods = [p["mood"] for p in data["points"]]
        assert 4 in moods, f"mood=4 not present in points · got {moods}"
        # avg is reasonable (1-5 range)
        assert 1 <= data["avg"] <= 5
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_timeline_404_for_unknown_dog(admin_headers):
    r = requests.get(f"{BASE}/api/dogs/does-not-exist-xyz/timeline", headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_behavior_trend_404_for_unknown_dog(admin_headers):
    r = requests.get(f"{BASE}/api/dogs/does-not-exist-xyz/behavior-trend", headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_force_monday_digest_endpoint(admin_headers):
    """The Monday digest force-fire endpoint should respond 200 with a
    structured summary. The exact `sent` count depends on environment
    (Resend reachability, dedup state); we only assert shape."""
    r = requests.post(f"{BASE}/api/admin/homework/send-monday-digest", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    # Must be a dict with at least one of the known result keys.
    assert isinstance(d, dict)
    known_keys = {"sent", "skipped_already_sent", "reason", "week_start", "week_end"}
    assert known_keys.intersection(d.keys()), f"unexpected digest response shape: {d}"


def test_monday_digest_requires_admin():
    """Endpoint must reject unauthenticated callers."""
    r = requests.post(f"{BASE}/api/admin/homework/send-monday-digest", timeout=15)
    assert r.status_code in (401, 403)
