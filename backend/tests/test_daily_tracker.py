"""Regression tests for the Daily Tracker homework feature (Sprint 97).

Covers:
- Create a daily-tracker homework with N days
- GET /homework/{id} returns daily_progress with correct lock/available/locked statuses
- Submit Day 1 → status flips to submitted, queued for admin review
- Pending-reviews queue includes the submission
- Approve Day 1 → status approved, Day 2 unlocks, streak ticks
- Send back Day 2 (needs_redo) → client can resubmit
- All-days-approved auto-completes the homework
- Save-as-template flag persists a reusable template
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
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


def _make_tracker(headers, dog_id, days=2, title=None, save_template=False, template_name=""):
    body = {
        "dog_id": dog_id,
        "title": title or f"Test tracker {uuid.uuid4().hex[:6]}",
        "instructions": "Pytest tracker",
        "days": [
            {
                "day_number": i,
                "day_focus": f"Focus for day {i}",
                "instructions": "",
                "fields": [
                    {"id": f"sets-{i}", "label": "Sets", "kind": "sets"},
                    {"id": f"notes-{i}", "label": "Notes", "kind": "longtext"},
                ],
            }
            for i in range(1, days + 1)
        ],
        "save_as_template": save_template,
        "template_name": template_name,
    }
    r = requests.post(f"{BASE}/api/homework/daily-tracker", headers=headers, json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_tracker_initial_state(admin_headers, a_dog):
    hw = _make_tracker(admin_headers, a_dog["id"], days=3)
    try:
        r = requests.get(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers, timeout=15)
        d = r.json()
        assert d["daily_tracker"] is True
        assert d["total_days"] == 3
        assert d["streak"] == 0
        statuses = [p["status"] for p in d["daily_progress"]]
        assert statuses == ["available", "locked", "locked"]
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_submit_then_approve_unlocks_next_day(admin_headers, a_dog):
    """Sprint 110p — client-driven advancement. Submitting Day 1 now unlocks
    Day 2 immediately (the trainer no longer needs to approve before the
    client can advance). Admin approval still flips the status from
    `submitted` → `approved` but is no longer a gate for the next day."""
    hw = _make_tracker(admin_headers, a_dog["id"], days=2)
    hwid = hw["id"]
    try:
        # Submit Day 1
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit",
            headers=admin_headers,
            json={"field_values": {"sets-1": 3, "notes-1": "Went well"}, "mood": 4, "note": "Buddy nailed it"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        statuses = [p["status"] for p in d["daily_progress"]]
        # Day 2 should now be unlocked the moment Day 1 is submitted.
        assert statuses == ["submitted", "available"], statuses

        # Pending queue should still include Day 1 (trainer can still review)
        q = requests.get(f"{BASE}/api/admin/homework/pending-reviews", headers=admin_headers, timeout=15).json()
        assert any(it["homework_id"] == hwid and it["day_number"] == 1 for it in q)

        # Day 2 can be submitted now — no admin approval needed for advancement.
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/2/submit", headers=admin_headers,
            json={"field_values": {"sets-2": 4}}, timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        statuses = [p["status"] for p in d["daily_progress"]]
        assert statuses == ["submitted", "submitted"], statuses

        # Approve Day 1 — Day 2 stays at its own status (submitted).
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/review", headers=admin_headers,
            json={"action": "approve", "note": "Looks great"}, timeout=15,
        )
        d = r.json()
        statuses = [p["status"] for p in d["daily_progress"]]
        assert statuses == ["approved", "submitted"], statuses
        assert d["streak"] == 1
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_needs_redo_relocks_unlogged_days(admin_headers, a_dog):
    """Sprint 110p — when an unlogged day's predecessor is `needs_redo`,
    the unlogged day re-locks. (A subsequent day that was already submitted
    keeps its own status — the client doesn't lose advancement they've
    already earned.)"""
    hw = _make_tracker(admin_headers, a_dog["id"], days=3)
    hwid = hw["id"]
    try:
        # Submit only Day 1 — Day 2 and Day 3 are unlogged.
        requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit", headers=admin_headers,
            json={"field_values": {"sets-1": 3}}, timeout=15,
        )
        d = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers, timeout=15).json()
        statuses = [p["status"] for p in d["daily_progress"]]
        # Day 2 should be available (auto-advance), Day 3 should be locked.
        assert statuses == ["submitted", "available", "locked"], statuses
        # Trainer sends Day 1 back. Day 2 has no log, so it re-locks. Day 3 too.
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/review", headers=admin_headers,
            json={"action": "needs_redo", "note": "Try again"}, timeout=15,
        )
        d = r.json()
        statuses = [p["status"] for p in d["daily_progress"]]
        assert statuses == ["needs_redo", "locked", "locked"], statuses
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_send_back_and_resubmit(admin_headers, a_dog):
    hw = _make_tracker(admin_headers, a_dog["id"], days=2)
    hwid = hw["id"]
    try:
        # Submit Day 1
        requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit", headers=admin_headers,
            json={"field_values": {"sets-1": 1}, "note": "first try"}, timeout=15,
        )
        # Send back
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/review", headers=admin_headers,
            json={"action": "needs_redo", "note": "Try 3 sets, not 1"}, timeout=15,
        )
        d = r.json()
        assert d["daily_progress"][0]["status"] == "needs_redo"
        assert d["daily_progress"][0]["log"]["review_note"] == "Try 3 sets, not 1"
        assert d["daily_progress"][1]["status"] == "locked"

        # Resubmit Day 1
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/submit", headers=admin_headers,
            json={"field_values": {"sets-1": 3}, "note": "second try"}, timeout=15,
        )
        d = r.json()
        # New submission overwrites the old, status back to submitted
        assert d["daily_progress"][0]["status"] == "submitted"
        assert d["daily_progress"][0]["log"]["field_values"]["sets-1"] == 3
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_all_days_approved_completes_homework(admin_headers, a_dog):
    hw = _make_tracker(admin_headers, a_dog["id"], days=2)
    hwid = hw["id"]
    try:
        for day in [1, 2]:
            requests.post(
                f"{BASE}/api/homework/{hwid}/day/{day}/submit", headers=admin_headers,
                json={"field_values": {f"sets-{day}": day}}, timeout=15,
            )
            requests.post(
                f"{BASE}/api/homework/{hwid}/day/{day}/review", headers=admin_headers,
                json={"action": "approve"}, timeout=15,
            )
        d = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers, timeout=15).json()
        assert d["status"] == "completed"
        assert d["streak"] == 2
        assert all(p["status"] == "approved" for p in d["daily_progress"])
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_save_as_template_persists(admin_headers, a_dog):
    name = f"PytestTpl-{uuid.uuid4().hex[:6]}"
    hw = _make_tracker(admin_headers, a_dog["id"], days=2, save_template=True, template_name=name)
    try:
        r = requests.get(f"{BASE}/api/homework-templates", headers=admin_headers, timeout=15)
        tpls = r.json()
        found = next((t for t in tpls if t.get("name") == name), None)
        assert found is not None, "Template was not persisted"
        assert found.get("daily_tracker") is True
        assert len(found.get("sections", [])) == 2
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)
        # cleanup template
        for t in requests.get(f"{BASE}/api/homework-templates", headers=admin_headers).json():
            if t.get("name") == name:
                requests.delete(f"{BASE}/api/homework-templates/{t['id']}", headers=admin_headers)
                break
