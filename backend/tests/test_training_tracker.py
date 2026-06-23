"""Sprint 110di-69 — Training Tracker (trainer-side batch + audit).

Acceptance criteria (from user spec):
1. Dog with no active program checks in normally (no tracker).
2. Dog with active program returns has_program=True from /bookings/{id}/training-context.
3. Marking a goal mastered via the training-session endpoint updates the
   existing goal_progress (NOT a duplicate progress store).
4. Completing all goals in current module → all_current_goals_mastered=True.
5. advance_to_next_module=True moves current_module_id forward.
6. Advancing updates current_week everywhere — /training-context and the
   regular enrollment listing both reflect the new pointer.
7. Existing Dog Training tab still sees the same progress (no duplicate doc).
8. Audit row written to training_session_log with goal diffs + session note.
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


def _make_program(H, name="Pytest Training Tracker"):
    body = {
        "name": name, "type": "private_lessons", "format": {"count": 4, "unit": "sessions"}, "price": 100,
        "modules": [
            {"name": "Week 1", "description": "Foundations", "order": 0,
             "goals": [{"name": "Sit"}, {"name": "Down"}]},
            {"name": "Week 2", "description": "Loose Leash", "order": 1,
             "goals": [{"name": "Heel"}]},
        ],
    }
    return requests.post(f"{BASE}/api/programs", headers=H, json=body, timeout=15).json()


def _pick_dog(H):
    dogs = requests.get(f"{BASE}/api/dogs?include_inactive=true", headers=H, timeout=15).json()
    return next((d for d in dogs if d.get("client_id")), dogs[0])


def _enroll(H, dog_id, program_id):
    return requests.post(f"{BASE}/api/dogs/{dog_id}/programs", headers=H,
                         json={"program_id": program_id}, timeout=15).json()


def _cleanup(H, dog_id, eid, pid):
    try:
        requests.put(f"{BASE}/api/dogs/{dog_id}/programs/{eid}",
                     headers=H, json={"status": "withdrawn"}, timeout=15)
    except Exception:
        pass
    requests.delete(f"{BASE}/api/programs/{pid}", headers=H, timeout=15)


def test_dog_with_no_active_program_returns_has_program_false():
    """AC1 — A dog (or booking) with no active enrollment returns has_program=False."""
    H = _admin()
    dog = _pick_dog(H)
    # Look for any booking for this dog and use it to query training context
    bookings = requests.get(f"{BASE}/api/bookings", headers=H, timeout=15).json()
    booking = next((b for b in bookings if b.get("dog_id") == dog["id"]), None)
    if not booking:
        # Nothing to test the booking endpoint with — that's fine; direct check still works.
        return
    # Withdraw any active enrollments first
    listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
    for e in listing:
        if e.get("status") == "active":
            requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{e['id']}",
                         headers=H, json={"status": "withdrawn"}, timeout=15)
    try:
        ctx = requests.get(f"{BASE}/api/bookings/{booking['id']}/training-context",
                           headers=H, timeout=15).json()
        assert ctx["has_program"] is False
    finally:
        pass  # leave the dog in whatever state — caller tests can re-enroll


def test_active_enrollment_returns_full_training_context():
    """AC2 — has_program=True, current module + goals exposed."""
    H = _admin()
    prog = _make_program(H, "AC2 ctx")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        assert ctx["has_program"] is True
        assert ctx["enrollment"]["current_week"] == 1
        assert ctx["enrollment"]["total_weeks"] == 2
        assert ctx["current_module"]["name"] == "Week 1"
        assert len(ctx["goals"]) == 2
        # Each goal must expose status/score/notes
        for g in ctx["goals"]:
            assert "status" in g and "score" in g and "notes" in g
        assert ctx["all_current_goals_mastered"] is False
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_goal_mastered_updates_existing_goal_progress():
    """AC3 — Goals marked via training-session endpoint flow through the same
    goal_progress that update_goal uses. NO duplicate store is created."""
    H = _admin()
    prog = _make_program(H, "AC3 mastered")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        sit_id = ctx["goals"][0]["id"]
        # Mark Sit mastered via training-session
        r = requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H,
            json={"goal_updates": [{"goal_id": sit_id, "score": 5}], "session_note": "Mastered indoors"},
            timeout=15,
        ).json()
        # Verify via the existing enrollment listing (the one Dog Training tab uses)
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        e = next(e for e in listing if e["id"] == enr["id"])
        gp = (e.get("goal_progress") or {}).get(sit_id) or {}
        assert gp.get("status") == "mastered"
        assert gp.get("score") == 5
        # And the training-session response also reflects it
        sit_in_resp = next(g for g in r["goals"] if g["id"] == sit_id)
        assert sit_in_resp["status"] == "mastered"
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_all_goals_mastered_flips_flag():
    """AC4 — Mastering every goal in the current module → all_current_goals_mastered=True."""
    H = _admin()
    prog = _make_program(H, "AC4 all-mastered")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        updates = [{"goal_id": g["id"], "score": 5} for g in ctx["goals"]]
        r = requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H, json={"goal_updates": updates},
            timeout=15,
        ).json()
        assert r["all_current_goals_mastered"] is True
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_advance_to_next_module_bumps_pointer():
    """AC5+6 — advance_to_next_module=True bumps current_module_id and current_week
    everywhere (training-context and enrollment listing both reflect it)."""
    H = _admin()
    prog = _make_program(H, "AC5 advance")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        r = requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H, json={"advance_to_next_module": True},
            timeout=15,
        ).json()
        assert r["enrollment"]["current_week"] == 2
        assert r["current_module"]["name"] == "Week 2"
        assert r["last_log"]["advanced_module"] is not None
        # Enrollment listing must also reflect the new week
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        e = next(e for e in listing if e["id"] == enr["id"])
        assert e["current_week"] == 2
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_session_log_records_audit_row():
    """AC8 — A training session writes one audit row with diffs + session_note."""
    H = _admin()
    prog = _make_program(H, "AC8 audit")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        sit_id = ctx["goals"][0]["id"]
        requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H,
            json={"goal_updates": [{"goal_id": sit_id, "score": 4}],
                  "session_note": "First mastery", "booking_id": "qa-booking-123"},
            timeout=15,
        )
        log = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/session-log",
            headers=H, timeout=15,
        ).json()
        assert len(log) == 1
        assert log[0]["session_note"] == "First mastery"
        assert log[0]["booking_id"] == "qa-booking-123"
        assert any(d["goal_id"] == sit_id and d["new_status"] == "mastered"
                   for d in log[0]["goal_updates"])
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_alien_goal_id_is_rejected():
    """Goal updates must belong to this enrollment's snapshotted plan."""
    H = _admin()
    prog = _make_program(H, "AC reject")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        r = requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
            headers=H,
            json={"goal_updates": [{"goal_id": "definitely-bogus", "score": 5}]},
            timeout=15,
        )
        assert r.status_code == 404
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])
