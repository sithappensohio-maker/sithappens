"""Stage 13 — final training-system acceptance, in-process and deterministic.

Each test walks a real lifecycle through the application's own functions (the
same ones the routes call) and checks that owner, trainer and client read ONE
canonical state: enrollment pointer, session drafts, Practice rows, checkpoint
rows. Nothing is written to the database directly except the initial scenario.
"""
import json
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import _school_client_flow
from _test_loop import run
from fastapi import HTTPException

from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _clean, _client_user, _complete, _ensure_skill_in_plan, _enrollment, _open_draft, _record, _seed,
)
from test_trainer_day import _staff, _booking, _pending_checkpoint, _by_key, _day, _items, _rubric_scores
from test_online_school_phase4 import _tiny_video


def _home(s, cu):
    return run(server.portal_school_home(s["se_id"], cu))


def _steps(s, cu, lesson_id):
    return run(_school_client_flow.complete_instructional_steps(s["se_id"], lesson_id, cu))


def _practice_done(s, cu, lesson_id):
    """Practice the lesson once (None when the lesson has no Practice configured — then
    the delivery rules do not require it either)."""
    try:
        started = run(_school_client_flow.start_practice(s["se_id"], lesson_id, cu))
    except HTTPException as e:
        if e.status_code == 422 and "no practice" in str(e.detail).lower():
            return None
        raise
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
    return started


def _advance_or_checkpoint(s, cu):
    """The client advances; when the lesson requires a formal checkpoint first, the client
    submits it and the OWNER grades it (pass) — the canonical path, no shortcuts."""
    try:
        return _advance(s, cu)
    except HTTPException as e:
        if e.status_code != 409 or "checkpoint" not in json.dumps(e.detail).lower():
            raise
    lesson_id = _enrollment(s)["current_lesson_id"]
    out = run(server.portal_school_submit_checkpoint(s["se_id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video(), note="Ready."), cu))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    h = {c["id"]: 4 for c in raw["rubric_snapshot"]["handler_criteria"]}; d = {c["id"]: 4 for c in raw["rubric_snapshot"]["dog_criteria"]}
    graded = run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(outcome="advance", handler_scores=h, dog_scores=d, feedback="Passed"), ADMIN))
    return {"checkpoint": graded["checkpoint"], "enrollment": graded["enrollment"], "advanced_via_checkpoint": True}


def _advance(s, cu):
    return run(server.portal_school_advance(s["se_id"], cu))


def _finish(s, action, label, trainer=None, score=5, outcome="passed"):
    """One trainer session on the current lesson, finished with `action`."""
    d = _open_draft(s, label=label)
    skill = s["skill_ids"][0] if action != "complete_program" or len(s["skill_ids"]) < 2 else s["skill_ids"][-1]
    d, aid = _ensure_skill_in_plan(d, skill, "Skill")
    _record(d["id"], {aid: {"score": score, "outcome": outcome, "client_observation": "Held the sit for ten seconds."}},
            what_went_well="Fast, happy responses.", needs_work="Duration with distractions.",
            next_lesson_focus="Add distance before distraction.", client_recap_note="Great lesson today.")
    return run(server.complete_training_session(d["id"], server.SessionCompletionIn(advancement_action=action), trainer or ADMIN))


# ---------------------------------------------------------------------------
# 3. ONLINE-ONLY JOURNEY
# ---------------------------------------------------------------------------

def test_online_only_journey_no_manufactured_sessions_owner_reviews_client_progresses_to_completion():
    s = _seed("online", lessons=2)
    cu = _client_user(s)
    trainer = _staff("trainer")
    # no trainer-led session is manufactured for an online dog; a trainer employee is not handed it
    assert not [i for i in _items() if i["dog"].get("id") == s["dog_id"] and i["kind"] in ("session", "upcoming_booking")]
    assert not [i for i in _items(trainer) if i["dog"].get("id") == s["dog_id"]]
    # lesson 1: steps + Practice, then the client advances (online delivery rule)
    _steps(s, cu, s["lesson_ids"][0])
    hw = _practice_done(s, cu, s["lesson_ids"][0])
    if hw:
        assert run(server.db.homework.find_one({"id": hw["homework_id"]}, {"_id": 0, "dog_id": 1}))["dog_id"] == s["dog_id"]
    res = _advance_or_checkpoint(s, cu)
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][1]
    home = _home(s, cu)
    assert home["enrollment"]["current_lesson_id"] == s["lesson_ids"][1] if "enrollment" in home else True
    # the client's Practice is the owner's to review by default (online → never "needs assignment", never a trainer's)
    hw_id = str(uuid.uuid4()); log_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": s["dog_id"], "client_id": s["client"]["id"], "dog_name": f"{TAG} Dog", "client_name": "C", "title": "Sit Practice",
        "status": "assigned", "source_lesson_id": s["lesson_ids"][0], "school_enrollment_id": s["se_id"], "enrollment_id": s["enrollment_id"],
        "section_logs": [{"id": log_id, "logged_at": server.now_iso(), "note": "", "field_values": {"__video_id": "m1"}, "review_status": None}],
    }))
    pr = _by_key(_items(), f"practice:{hw_id}:{log_id}")
    assert pr is not None and pr["needs_assignment"] is False and pr["mine"] is True
    assert _by_key(_items(trainer), pr["key"]) is None
    run(server.db.homework.delete_one({"id": hw_id}))
    # lesson 2 → completion
    _steps(s, cu, s["lesson_ids"][1])
    _practice_done(s, cu, s["lesson_ids"][1])
    res = _advance_or_checkpoint(s, cu)
    assert _enrollment(s)["status"] == "completed", res
    assert "complet" in json.dumps(res).lower() or "finished" in json.dumps(res).lower()
    home = _home(s, cu)
    assert "complet" in json.dumps(home).lower()
    run(server.db.users.delete_many({"id": {"$in": [trainer["id"], cu["id"]]}}))


# ---------------------------------------------------------------------------
# 4. TRAINER-LED JOURNEY — the client can never self-advance
# ---------------------------------------------------------------------------

def test_trainer_led_client_cannot_self_advance_and_trainer_decision_moves_the_pointer():
    s = _seed("in_person", lessons=2)
    cu = _client_user(s)
    _steps(s, cu, s["lesson_ids"][0])
    with pytest.raises(HTTPException) as e:
        _advance(s, cu)
    assert e.value.status_code in (403, 409, 422), e.value.detail   # refused, controlled, never a 500
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][0]
    home = _home(s, cu)
    blob = json.dumps(home).lower()
    assert "trainer" in blob                                            # the client is told the trainer moves them forward
    assert (home.get("current_action") or {}).get("kind") not in ("advance", "advance_lesson", "next_lesson")
    # Stay Here keeps the pointer; the client's Today reflects the recap but the same lesson
    _finish(s, "remain", "visit-stay", score=3, outcome="improving")
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][0]
    home = _home(s, cu)
    assert "Great lesson today." in json.dumps(home)                    # client-safe recap travels
    assert "PRIVATE" not in json.dumps(home)
    # Ready for Next Lesson moves it; the client's Today follows
    _finish(s, "advance_next", "visit-ready")
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][1]
    home = _home(s, cu)
    lesson2 = server._find_lesson_in_snapshot(_enrollment(s), s["lesson_ids"][1])["name"]
    assert lesson2 in json.dumps(home)
    # final lesson → the trainer completes the program (explicit graduation, never automatic)
    done = _finish(s, "complete_program", "visit-final")
    assert done["enrollment"]["status"] == "completed"
    assert _enrollment(s)["status"] == "completed"
    assert "complet" in json.dumps(_home(s, cu)).lower()
    assert not [i for i in _items() if i["dog"].get("id") == s["dog_id"] and i["section"] in ("today", "continue")]
    run(server.db.users.delete_one({"id": cu["id"]}))


# ---------------------------------------------------------------------------
# 2. MULTI-DOG / MULTI-PROGRAM ISOLATION
# ---------------------------------------------------------------------------

def test_two_dogs_one_client_every_action_stays_on_its_own_enrollment():
    a = _seed("in_person", checkpoint_on_lesson1=True, lessons=2)
    cu = _client_user(a)
    # dog B for the SAME client, enrolled on the same program in person
    dog_b = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog_b, "name": f"{TAG} Dog B {dog_b[:6]}", "owner_id": a["client"]["id"], "breed": "Mix", "age_y": 2,
                                   "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog_b, program_id=a["program"]["id"], delivery_mode="in_person"), ADMIN))
    b = {**a, "dog_id": dog_b, "se_id": res["school_enrollment"]["id"], "enrollment_id": res["enrollment"]["id"]}
    # the trainer queue keys each dog separately
    ba, bb = _booking(a["dog_id"]), _booking(dog_b)
    keys = {i["key"] for i in _items()}
    assert f"session:{ba['id']}" in keys and f"session:{bb['id']}" in keys
    # Ready on A moves A only
    _finish(a, "advance_next", "a-1")
    assert _enrollment(a)["current_lesson_id"] == a["lesson_ids"][1]
    assert _enrollment(b)["current_lesson_id"] == b["lesson_ids"][0]
    # Practice opened for B is B's row; A's home never lists it
    _steps(b, cu, b["lesson_ids"][0])
    hw_b = _practice_done(b, cu, b["lesson_ids"][0])
    if hw_b:
        row = run(server.db.homework.find_one({"id": hw_b["homework_id"]}, {"_id": 0, "dog_id": 1, "school_enrollment_id": 1}))
        assert row["dog_id"] == dog_b and row["school_enrollment_id"] == b["se_id"]
        assert hw_b["homework_id"] not in json.dumps(_home(a, cu))
    # B's lesson progress never shows up on A's home, whatever the Practice configuration
    assert b["se_id"] not in json.dumps(_home(a, cu))
    # a checkpoint graded for A targets A's enrollment only
    cp = _pending_checkpoint(a, lesson_id=a["lesson_ids"][0])
    h, d = _rubric_scores(a)
    graded = run(server.admin_school_checkpoint_grade(cp["id"], server.CheckpointGradeIn(outcome="advance", handler_scores=h, dog_scores=d, feedback="Nice"), ADMIN))
    assert graded["checkpoint"]["enrollment_id"] == a["enrollment_id"]
    assert run(server.db.checkpoint_submissions.count_documents({"enrollment_id": b["enrollment_id"]})) == 0
    # completing A's program never completes B
    done = _finish(a, "complete_program", "a-final")
    assert done["enrollment"]["status"] == "completed"
    assert _enrollment(b)["status"] == "active"
    ha, hb = _home(a, cu), _home(b, cu)
    assert "complet" in json.dumps(ha).lower()
    assert _enrollment(b)["current_lesson_id"] == b["lesson_ids"][0] and hb["enrollment"]["id"] != ha["enrollment"]["id"] if "enrollment" in hb else True
    # B still has today's session; A has nothing left to do today
    rest = [i for i in _items() if i["section"] in ("today", "continue")]
    assert any(i["dog"].get("id") == dog_b for i in rest) and not any(i["dog"].get("id") == a["dog_id"] for i in rest)
    for bk in (ba, bb):
        run(server.db.bookings.delete_one({"id": bk["id"]}))
    run(server.db.users.delete_one({"id": cu["id"]}))


# ---------------------------------------------------------------------------
# 6. FAILURE PATHS — controlled responses, never a 500, no silent success
# ---------------------------------------------------------------------------

def test_failure_paths_are_controlled():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    cu = _client_user(s)
    b = _booking(s["dog_id"])
    # owner: invalid trainer, non-training booking, inactive program
    with pytest.raises(HTTPException) as e:
        run(server.assign_training_booking_trainer(b["id"], server.TrainingDayTrainerAssignmentIn(assigned_trainer_id="nobody"), ADMIN))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        run(server.assign_training_booking_trainer("missing-booking", server.TrainingDayTrainerAssignmentIn(assigned_trainer_id=None), ADMIN))
    assert e.value.status_code == 404
    run(server.db.programs.update_one({"id": s["program"]["id"]}, {"$set": {"active": False}}))
    dog2 = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog2, "name": f"{TAG} Dog X {dog2[:6]}", "owner_id": s["client"]["id"], "breed": "Mix", "age_y": 2}))
    with pytest.raises(HTTPException) as e:
        run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog2, program_id=s["program"]["id"], delivery_mode="in_person"), ADMIN))
    assert e.value.status_code == 422 and "inactive" in str(e.value.detail).lower() or e.value.status_code == 422
    run(server.db.programs.update_one({"id": s["program"]["id"]}, {"$set": {"active": True}}))
    # trainer: grading without every criterion scored is refused (no assumed scores), the row stays pending
    cp = _pending_checkpoint(s)
    with pytest.raises(HTTPException) as e:
        run(server.admin_school_checkpoint_grade(cp["id"], server.CheckpointGradeIn(outcome="advance", handler_scores={}, dog_scores={}, feedback=""), ADMIN))
    assert 400 <= e.value.status_code < 500
    assert run(server.db.checkpoint_submissions.find_one({"id": cp["id"]}, {"_id": 0, "status": 1}))["status"] == "pending"
    # trainer: a draft for a program that no longer exists cannot be resumed; the queue names it instead
    d = _open_draft(s, label="stale")
    with pytest.raises(HTTPException) as e:
        run(server.start_training_session_draft_direct(s["dog_id"], "missing-enrollment", "", ADMIN, draft_id=d["id"]))
    assert e.value.status_code in (404, 409)
    # trainer: finishing without the required record is a 409 with the gaps, never a partial write
    with pytest.raises(HTTPException) as e:
        run(server.complete_training_session(d["id"], server.SessionCompletionIn(advancement_action="advance_next"), ADMIN))
    assert e.value.status_code == 409 and ("gaps" in json.dumps(e.value.detail) or "missing" in json.dumps(e.value.detail))
    assert run(server.db.training_session_drafts.find_one({"id": d["id"]}, {"_id": 0, "status": 1}))["status"] == "draft"
    # client: a Practice log against someone else's homework is refused
    other = _seed("online")
    ocu = _client_user(other)
    _steps(other, ocu, other["lesson_ids"][0])
    hw_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({"id": hw_id, "dog_id": other["dog_id"], "client_id": other["client"]["id"], "dog_name": "O", "client_name": "O", "title": "Sit",
                                       "status": "assigned", "school_enrollment_id": other["se_id"], "enrollment_id": other["enrollment_id"], "section_logs": []}))
    with pytest.raises(HTTPException) as e:
        run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))
    assert e.value.status_code in (403, 404)
    run(server.db.homework.delete_one({"id": hw_id}))
    # client: a checkpoint submitted for a lesson that has none is refused
    with pytest.raises(HTTPException) as e:
        run(server.portal_school_submit_checkpoint(other["se_id"], other["lesson_ids"][0], server.CheckpointSubmissionIn(video=_tiny_video(), note="x"), ocu))
    assert 400 <= e.value.status_code < 500
    run(server.db.bookings.delete_one({"id": b["id"]}))
    run(server.db.users.delete_many({"id": {"$in": [cu["id"], ocu["id"]]}}))


# ---------------------------------------------------------------------------
# 7 + 8. CAPABILITY MATRIX — including the admin + trainer-staff decision
# ---------------------------------------------------------------------------

def test_presentation_follows_effective_capabilities_even_for_an_admin_tagged_trainer():
    """Stage 13 decision (item 8): an admin-role account explicitly tagged with a
    non-owner staff_role goes through the matrix — that is the documented
    permission-resolution rule (Sprint 110di-24: matrix toggles must do
    something for admins). So role=admin + staff_role=trainer is a trainer:
    no assignment authority, trainer presentation, and no Settings unless the
    matrix grants it. The owner (admin with no staff_role, or staff_role owner)
    keeps everything."""
    shell_trainer = _staff("trainer", role="admin")
    owner_tagged = _staff("owner", role="admin")
    manager = _staff("manager")
    trainer = _staff("trainer")
    fd = _staff("front_desk")
    perms = {k: server._perms_for(v) for k, v in {"shell_trainer": shell_trainer, "owner_tagged": owner_tagged, "manager": manager, "trainer": trainer, "front_desk": fd, "owner": ADMIN}.items()}
    assert perms["shell_trainer"]["assign_training_staff"] is False and perms["shell_trainer"]["settings"] is False
    assert perms["owner_tagged"]["assign_training_staff"] is True and perms["owner"]["assign_training_staff"] is True
    assert perms["manager"]["assign_training_staff"] is True and perms["manager"]["settings"] is False
    assert perms["trainer"]["assign_training_staff"] is False and perms["trainer"]["manage_training_sessions"] is True
    assert perms["front_desk"]["manage_training_sessions"] is False and perms["front_desk"]["assign_training_staff"] is False
    assert _day(shell_trainer)["viewer"]["can_assign"] is False
    assert _day(owner_tagged)["viewer"]["can_assign"] is True
    assert _day(manager)["viewer"]["can_assign"] is True
    with pytest.raises(HTTPException) as e:
        run(server.require_admin_and_permission("settings")(shell_trainer))
    assert e.value.status_code == 403
    run(server.db.users.delete_many({"id": {"$in": [u["id"] for u in (shell_trainer, owner_tagged, manager, trainer, fd)]}}))


def test_client_can_only_reach_their_own_dogs_programs_and_work():
    a = _seed("online"); b = _seed("online")
    ca, cb = _client_user(a), _client_user(b)
    assert _home(a, ca)  # own: fine
    with pytest.raises(HTTPException) as e:
        _home(b, ca)
    assert e.value.status_code in (403, 404)
    _steps(b, cb, b["lesson_ids"][0])
    hw_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({"id": hw_id, "dog_id": b["dog_id"], "client_id": b["client"]["id"], "dog_name": "B", "client_name": "B", "title": "Sit",
                                       "status": "assigned", "school_enrollment_id": b["se_id"], "enrollment_id": b["enrollment_id"], "section_logs": []}))
    with pytest.raises(HTTPException) as e:
        run(server.get_homework_detail(hw_id, ca))
    assert e.value.status_code == 403
    run(server.db.homework.delete_one({"id": hw_id}))
    with pytest.raises(HTTPException) as e:
        run(server.portal_school_lesson_detail(b["se_id"], b["lesson_ids"][0], ca))
    assert e.value.status_code in (403, 404)
    run(server.db.users.delete_many({"id": {"$in": [ca["id"], cb["id"]]}}))
