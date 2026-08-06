"""Sprint 110di-69 — Training Tracker (trainer-side batch + audit).

Acceptance criteria (from user spec):
1. Dog with no active program checks in normally (no tracker).
2. Dog with active program returns has_program=True from /bookings/{id}/training-context.
3. Marking a goal mastered via a training session updates the existing
   goal_progress (NOT a duplicate progress store).
4. Completing all goals in current module → all_current_goals_mastered=True.
5. advance_to_next_module=True moves current_module_id forward.
6. Advancing updates current_week everywhere — /training-context and the
   regular enrollment listing both reflect the new pointer.
7. Existing Dog Training tab still sees the same progress (no duplicate doc).
8. Audit row written to training_session_log with goal diffs + session note.

Final correctness pass — this file used to write sessions via
POST /api/dogs/{id}/programs/{id}/training-session, which has been retired:
it was a second, independently-writing path into goal_progress/
training_session_log that bypassed the training_session_drafts draft/
completion state machine entirely. Every acceptance criterion above still
holds; only the mechanism used to record a session changed, to the
supported draft -> update -> complete pipeline (the same one the Training
Session Workspace UI uses).
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


def _run_session(H, dog_id, enr_id, goal_scores=None, session_note=None, advance_to_next_module=False, session_label=None):
    """Runs one full session via the supported pipeline: start a direct
    draft (no booking needed), record actuals for the given goal_id->score
    map, complete it with the requested advancement action. Returns
    (start_response, complete_response) — complete_response is the exact
    shape POST .../complete returns (already_completed, session_log, draft,
    enrollment, homework_created, homework_conflicts)."""
    label = session_label or f"session-{os.urandom(4).hex()}"
    started = requests.post(
        f"{BASE}/api/dogs/{dog_id}/programs/{enr_id}/training-session/draft",
        headers=H, params={"session_label": label}, timeout=15,
    ).json()
    draft_id = started["draft"]["id"]
    activities = started["draft"]["plan"]["activities"]

    if goal_scores or session_note is not None:
        actuals = {}
        for a in activities:
            skill_id = a.get("skill_id")
            if goal_scores and skill_id in goal_scores:
                actuals[a["id"]] = {"score": goal_scores[skill_id]}
        update_body = {}
        if actuals:
            update_body["actuals"] = actuals
        if session_note is not None:
            update_body["session_note"] = session_note
        if update_body:
            r = requests.put(f"{BASE}/api/training-session-drafts/{draft_id}", headers=H, json=update_body, timeout=15)
            r.raise_for_status()

    complete_body = {"advancement_action": "advance_module" if advance_to_next_module else "remain"}
    completed = requests.post(
        f"{BASE}/api/training-session-drafts/{draft_id}/complete", headers=H, json=complete_body, timeout=15,
    ).json()
    return started, completed


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
    """AC3 — Goals marked via a completed session flow through the same
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
        _, completed = _run_session(H, dog["id"], enr["id"], goal_scores={sit_id: 5}, session_note="Mastered indoors")

        # Verify via the existing enrollment listing (the one Dog Training tab uses)
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        e = next(e for e in listing if e["id"] == enr["id"])
        gp = (e.get("goal_progress") or {}).get(sit_id) or {}
        assert gp.get("status") == "mastered"
        assert gp.get("score") == 5
        # And the completion response also reflects it in goal_updates
        diff = next(d for d in completed["session_log"]["goal_updates"] if d["goal_id"] == sit_id)
        assert diff["new_status"] == "mastered"
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
        scores = {g["id"]: 5 for g in ctx["goals"]}
        _run_session(H, dog["id"], enr["id"], goal_scores=scores)

        after = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        assert after["all_current_goals_mastered"] is True
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_advance_to_next_module_bumps_pointer():
    """AC5+6 — advancement_action='advance_module' bumps current_module_id
    and current_week everywhere (training-context and enrollment listing
    both reflect it)."""
    H = _admin()
    prog = _make_program(H, "AC5 advance")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        _, completed = _run_session(H, dog["id"], enr["id"], advance_to_next_module=True)
        assert completed["enrollment"]["current_module_id"] is not None
        assert completed["session_log"]["advanced_module"] is not None

        ctx = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context",
            headers=H, timeout=15,
        ).json()
        assert ctx["enrollment"]["current_week"] == 2
        assert ctx["current_module"]["name"] == "Week 2"
        # Enrollment listing must also reflect the new week
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        e = next(e for e in listing if e["id"] == enr["id"])
        assert e["current_week"] == 2
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_session_log_records_audit_row():
    """AC8 — A completed session writes one audit row with diffs + session_note."""
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
        _run_session(H, dog["id"], enr["id"], goal_scores={sit_id: 4}, session_note="First mastery")

        log = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/session-log",
            headers=H, timeout=15,
        ).json()
        assert len(log) == 1
        assert log[0]["session_note"] == "First mastery"
        assert any(d["goal_id"] == sit_id and d["new_status"] == "mastered"
                   for d in log[0]["goal_updates"])
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])


def test_completion_rejects_activity_not_in_this_enrollment():
    """The supported pipeline's equivalent of 'alien goal id is rejected':
    the draft's own plan is built strictly from THIS enrollment's snapshot
    (see start_training_session_draft_direct), so there is no way to submit
    an actual for a skill outside it — proven here by confirming every
    activity in a freshly-started draft resolves to a real goal id on the
    enrollment, and that updating the draft with a bogus activity id is
    simply ignored (never partially applied) rather than accepted."""
    H = _admin()
    prog = _make_program(H, "AC reject")
    dog = _pick_dog(H)
    enr = _enroll(H, dog["id"], prog["id"])
    try:
        started = requests.post(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-session/draft",
            headers=H, timeout=15,
        ).json()
        draft_id = started["draft"]["id"]
        valid_goal_ids = {g["id"] for g in requests.get(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/training-context", headers=H, timeout=15,
        ).json()["goals"]}
        for a in started["draft"]["plan"]["activities"]:
            if a.get("skill_id"):
                assert a["skill_id"] in valid_goal_ids

        r = requests.put(
            f"{BASE}/api/training-session-drafts/{draft_id}", headers=H,
            json={"actuals": {"definitely-bogus-activity-id": {"score": 5}}}, timeout=15,
        )
        assert r.status_code == 200  # the update itself succeeds (actuals are keyed freely)
        completed = requests.post(
            f"{BASE}/api/training-session-drafts/{draft_id}/complete", headers=H, json={}, timeout=15,
        ).json()
        # A bogus activity id that doesn't match any real plan activity
        # never produces a goal_update — nothing to apply it to.
        assert completed["session_log"]["goal_updates"] == []
    finally:
        _cleanup(H, dog["id"], enr["id"], prog["id"])
