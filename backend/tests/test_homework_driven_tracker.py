"""Sprint 103 — Homework-Driven Tracker (steps + catch-up + today-plan).

Covers:
- Create a daily-tracker homework with `steps[]` on each day
- Toggle individual steps; states persist
- Toggling the LAST step auto-submits the day (status → submitted)
- /portal/today-plan returns the current available day per active tracker
- /catch-up · skip_missed marks missed day skipped + next day unlocks
- /catch-up · shift_forward extends due_date by 1
- /catch-up · double_up carries missed steps onto the next available day
- today-brain surfaces "steps_incomplete" when any tracker has today's steps undone
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
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
        pytest.skip(f"test client login failed: {r.text}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_dog(admin_headers, client_headers):
    me = requests.get(f"{BASE}/api/auth/me", headers=client_headers).json()
    cid = me["client_id"]
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers).json()
    dog = next((d for d in dogs if d.get("owner_id") == cid), None)
    if not dog:
        pytest.skip("test client has no dog")
    return dog


def _make_tracker_with_steps(headers, dog_id, days=2):
    body = {
        "dog_id": dog_id,
        "title": f"Step tracker {uuid.uuid4().hex[:6]}",
        "instructions": "Sprint 103 test",
        "days": [
            {
                "day_number": i,
                "day_focus": f"Day {i} focus",
                "instructions": "",
                "fields": [],
                "steps": [
                    {"id": f"step-{i}-a", "label": "Practice sit 5x"},
                    {"id": f"step-{i}-b", "label": "Practice down 5x"},
                ],
            }
            for i in range(1, days + 1)
        ],
    }
    r = requests.post(f"{BASE}/api/homework/daily-tracker", headers=headers, json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_tracker_with_steps_persists(admin_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=2)
    try:
        d = requests.get(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers).json()
        assert d["daily_tracker"] is True
        prog = d["daily_progress"]
        assert len(prog) == 2
        assert prog[0]["steps"], "steps did not persist on day 1"
        assert {s["id"] for s in prog[0]["steps"]} == {"step-1-a", "step-1-b"}
        assert prog[0]["step_states"] == {}
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_toggle_step_persists_state(admin_headers, client_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=2)
    hwid = hw["id"]
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/toggle-step",
            headers=client_headers,
            json={"step_id": "step-1-a", "done": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        prog = d["daily_progress"]
        assert prog[0]["step_states"]["step-1-a"] is True
        assert prog[0]["status"] in ("available", "submitted", "in_progress")  # half done = intermediate
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_all_steps_do_not_auto_submit_day(admin_headers, client_headers, client_dog):
    """Sprint 110ah — checking off every step must NOT auto-submit the day.
    The client still needs to capture mood / note / photo and tap Mark
    Complete via `/day/{n}/submit` for the day to enter the review queue."""
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=2)
    hwid = hw["id"]
    try:
        for sid in ["step-1-a", "step-1-b"]:
            r = requests.post(
                f"{BASE}/api/homework/{hwid}/day/1/toggle-step",
                headers=client_headers,
                json={"step_id": sid, "done": True},
                timeout=15,
            )
            assert r.status_code == 200, r.text
        d = r.json()
        # Status stays available/in_progress — never auto-flips to submitted
        assert d["daily_progress"][0]["status"] in ("available", "in_progress"), (
            f"day 1 should stay open · got {d['daily_progress'][0]['status']}"
        )
        # And the pending review queue MUST NOT pick it up yet
        q = requests.get(f"{BASE}/api/admin/homework/pending-reviews", headers=admin_headers).json()
        assert not any(it["homework_id"] == hwid and it["day_number"] == 1 for it in q), (
            "day must not appear in review queue before client taps Mark Complete"
        )
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_today_plan_shows_active_tracker(admin_headers, client_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=3)
    try:
        r = requests.get(f"{BASE}/api/portal/today-plan", headers=client_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 1
        ours = next((it for it in data["items"] if it["homework_id"] == hw["id"]), None)
        assert ours is not None, "tracker missing from today-plan"
        assert ours["day_number"] == 1
        assert len(ours["steps"]) == 2
        assert all("done" in s for s in ours["steps"])
        assert ours["all_done"] is False
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_catchup_skip_missed_unlocks_next(admin_headers, client_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=3)
    hwid = hw["id"]
    try:
        # Apply skip_missed to day 1 (pretending client missed it)
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/catch-up",
            headers=client_headers,
            json={"strategy": "skip_missed", "missed_day_number": 1},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["catch_up_applied"] == "skip_missed"
        # Day 1 should now be skipped, day 2 available
        prog = d["daily_progress"]
        assert prog[0]["status"] == "skipped"
        assert prog[1]["status"] == "available", f"day 2 should unlock · got {prog[1]['status']}"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_catchup_shift_forward_extends_due_date(admin_headers, client_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=2)
    hwid = hw["id"]
    try:
        before = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers).json()["due_date"]
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/catch-up",
            headers=client_headers,
            json={"strategy": "shift_forward", "missed_day_number": 1},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        after = requests.get(f"{BASE}/api/homework/{hwid}", headers=admin_headers).json()["due_date"]
        assert after > before, f"due_date should advance · {before} → {after}"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_catchup_double_up_carries_steps(admin_headers, client_headers, client_dog):
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=3)
    hwid = hw["id"]
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/catch-up",
            headers=client_headers,
            json={"strategy": "double_up", "missed_day_number": 1},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        prog = d["daily_progress"]
        # Day 2 should now have step-1-a/b carried over alongside its original steps
        day2_steps = prog[1]["steps"]
        labels = [s["label"] for s in day2_steps]
        assert any(l.startswith("(catch-up)") for l in labels), f"missed steps not carried · {labels}"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_step_toggle_rejected_when_no_steps_configured(admin_headers, client_dog):
    """Old-style trackers (no steps[]) must reject step toggling so clients
    don't get a confusing UX."""
    body = {
        "dog_id": client_dog["id"], "title": "no-steps tracker", "instructions": "",
        "days": [{"day_number": 1, "day_focus": "x", "instructions": "", "fields": [{"id": "f1", "label": "Notes", "kind": "longtext"}]}],
    }
    hw = requests.post(f"{BASE}/api/homework/daily-tracker", headers=admin_headers, json=body, timeout=15).json()
    hwid = hw["id"]
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/toggle-step",
            headers=admin_headers,
            json={"step_id": "nope", "done": True},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 · got {r.status_code}: {r.text}"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_today_brain_surfaces_steps_incomplete(admin_headers, client_dog):
    """Creating an active tracker with steps should cause today-brain to flag it."""
    hw = _make_tracker_with_steps(admin_headers, client_dog["id"], days=2)
    try:
        r = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers).json()
        kinds = [it["kind"] for it in r["items"]]
        assert "steps_incomplete" in kinds, f"steps_incomplete missing from brain · kinds={kinds}"
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)
