"""Sprint 110di-71 — Trainer Scorecard rollup.

Aggregates training_session_log entries within a rolling window into per-trainer
buckets: session_count, unique_dogs, skills_mastered, modules_advanced.
"""

import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


def _make_program(H):
    return requests.post(f"{BASE}/api/programs", headers=H, json={
        "name": "Pytest Scorecard", "type": "private_lessons",
        "format": {"count": 4, "unit": "sessions"}, "price": 100,
        "modules": [
            {"name": "Week 1", "order": 0, "goals": [{"name": "Sit"}, {"name": "Down"}]},
            {"name": "Week 2", "order": 1, "goals": [{"name": "Heel"}]},
        ],
    }, timeout=15).json()


def _pick_dog(H):
    dogs = requests.get(f"{BASE}/api/dogs?include_inactive=true", headers=H, timeout=15).json()
    return next((d for d in dogs if d.get("client_id")), dogs[0])


def test_scorecard_returns_required_shape():
    """Even with zero sessions, the endpoint must return days, since, trainers
    (list), and totals (dict) so the UI never crashes on empty state."""
    H = _admin()
    body = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=30",
                        headers=H, timeout=15).json()
    for k in ("days", "since", "trainers", "totals"):
        assert k in body
    assert isinstance(body["trainers"], list)
    assert isinstance(body["totals"], dict)
    for k in ("trainers", "sessions", "skills_mastered", "modules_advanced"):
        assert k in body["totals"]


def test_scorecard_counts_sessions_and_mastery_for_admin():
    """When admin logs sessions via the training-session endpoint, the
    scorecard must show them under the admin trainer bucket with correct
    session_count + skills_mastered + modules_advanced + unique_dogs."""
    H = _admin()
    prog = _make_program(H)
    dog = _pick_dog(H)
    enr = requests.post(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H,
                        json={"program_id": prog["id"]}, timeout=15).json()

    # Capture baseline so we measure DELTA (other tests may have left rows)
    before = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=30",
                          headers=H, timeout=15).json()
    base_admin = next((t for t in before["trainers"] if "admin" in (t["trainer_key"] or "")), None)
    base_sessions = base_admin["session_count"] if base_admin else 0
    base_mastered = base_admin["skills_mastered"] if base_admin else 0
    base_advanced = base_admin["modules_advanced"] if base_admin else 0

    try:
        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        sit_id = ctx["goals"][0]["id"]
        down_id = ctx["goals"][1]["id"]

        # Session 1: mark Sit mastered + Down learning
        requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H, json={
                "session_note": "First session",
                "goal_updates": [
                    {"goal_id": sit_id, "score": 5},
                    {"goal_id": down_id, "score": 2},
                ],
            }, timeout=15,
        )
        # Session 2: master Down + advance week
        requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H, json={
                "session_note": "Down finally clicked",
                "goal_updates": [{"goal_id": down_id, "score": 5}],
                "advance_to_next_module": True,
            }, timeout=15,
        )

        after = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=30",
                             headers=H, timeout=15).json()
        admin_row = next(t for t in after["trainers"] if "admin" in (t["trainer_key"] or ""))
        assert admin_row["session_count"] - base_sessions == 2
        assert admin_row["skills_mastered"] - base_mastered == 2  # Sit + Down
        assert admin_row["modules_advanced"] - base_advanced == 1
        assert admin_row["unique_dogs"] >= 1
        # totals also bump
        assert after["totals"]["sessions"] >= before["totals"]["sessions"] + 2
    finally:
        requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}",
                     headers=H, json={"status": "withdrawn"}, timeout=15)
        requests.delete(f"{BASE}/api/programs/{prog['id']}", headers=H, timeout=15)


def test_scorecard_respects_days_window():
    """A 1-day window must return strictly less-or-equal sessions than a
    365-day window (sanity: small window is a strict subset)."""
    H = _admin()
    one_day = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=1",
                           headers=H, timeout=15).json()
    year = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=365",
                        headers=H, timeout=15).json()
    assert one_day["totals"]["sessions"] <= year["totals"]["sessions"]
    assert one_day["days"] == 1
    assert year["days"] == 365


def test_scorecard_days_clamps_to_max():
    """days > 365 clamps to 365 (no runaway scans)."""
    H = _admin()
    body = requests.get(f"{BASE}/api/admin/training/trainer-scorecard?days=99999",
                        headers=H, timeout=15).json()
    assert body["days"] == 365
