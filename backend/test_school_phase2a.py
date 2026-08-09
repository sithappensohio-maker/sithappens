"""Online School Phase 2A — Student Home view-model + current_action.

Proves the backend that powers the new Student School:
  * _school_current_action priority (unit — pure function, all branches)
  * GET /portal/school/{id}/home view-model via the REAL enroll → practice →
    checkpoint → grade flow (Scenarios A, E, F, G, J).

Reuses the Phase-4 fixtures (real program/enroll/checkpoint/grade) so nothing
is hand-mocked. Same disposable-DB harness as the other suites.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

ca = server._school_current_action

from test_online_school_phase4 import (  # noqa: E402
    _school_program as _p4_program,
    _client_and_dog as _p4_client_and_dog,
    _enroll as _p4_enroll,
    _grade as _p4_grade,
    _client_user as _p4_client_user,
    _cleanup_school as _p4_cleanup,
)


# ── Unit: current_action priority (pure function) ───────────────────────────
def _roadmap(*, practiced=False, learn_done=False, has_practice=True, requires_cp=False, cp=None, lesson=True):
    return {
        "current_lesson": ({"id": "l1", "name": "Engagement Reps"} if lesson else None),
        "current_lesson_practiced": practiced,
        "current_lesson_learn_completed": learn_done,
        "current_lesson_has_practice": has_practice,
        "requires_checkpoint": requires_cp,
        "checkpoint_status": cp,
    }


def test_action_course_complete():
    assert ca("completed", "active", _roadmap())["type"] == "course_complete"

def test_action_access_expired():
    assert ca("active", "revoked", _roadmap())["type"] == "access_expired"

# 1) Fresh enrollment (learn not completed) → LESSON, not practice.
def test_action_lesson_when_fresh():
    a = ca("active", "active", _roadmap(practiced=False, learn_done=False, requires_cp=True, cp={"status": "not_submitted"}))
    assert a["type"] == "lesson" and a["target"]["lesson_id"] == "l1"

# 2) Learn completed (Start-Practice taken) but practice incomplete → PRACTICE.
def test_action_practice_after_learn_completed():
    a = ca("active", "active", _roadmap(practiced=False, learn_done=True, requires_cp=True, cp={"status": "not_submitted"}))
    assert a["type"] == "practice"

# 3) Learn + practice complete with required checkpoint → SUBMIT_CHECKPOINT.
def test_action_submit_checkpoint_when_practiced():
    a = ca("active", "active", _roadmap(practiced=True, learn_done=True, requires_cp=True, cp={"status": "not_submitted"}))
    assert a["type"] == "submit_checkpoint"

# 4) Checkpoint submitted → AWAITING_REVIEW.
def test_action_awaiting_review():
    a = ca("active", "active", _roadmap(practiced=True, learn_done=True, requires_cp=True, cp={"status": "awaiting_review"}))
    assert a["type"] == "awaiting_review"

# 5) Remediation overrides everything — even before the learn step.
def test_action_remediation_overrides():
    cp = {"status": "graded", "outcome": "prescribe_practice",
          "prescription": {"action": "assign_refresher_lesson", "refresher_lesson_id": "lx", "practice_sessions_remaining": 2}}
    a = ca("active", "active", _roadmap(practiced=False, learn_done=False, requires_cp=True, cp=cp))
    assert a["type"] == "remediation" and a["target"]["lesson_id"] == "lx" and "2 more" in a["sublabel"]

# 6) Trainer Assist hold overrides normal progression — even before the learn step.
def test_action_trainer_assist_overrides():
    cp = {"status": "graded", "outcome": "trainer_assist_recommended", "id": "cp1", "trainer_assist": {"status": "needs_attention"}}
    a = ca("active", "active", _roadmap(practiced=False, learn_done=False, requires_cp=True, cp=cp))
    assert a["type"] == "trainer_assist" and "not a setback" in a["sublabel"]

# 7) Non-checkpoint lesson advances ONLY after its learn + practice steps.
def test_action_noncheckpoint_progression_order():
    assert ca("active", "active", _roadmap(practiced=False, learn_done=False, requires_cp=False))["type"] == "lesson"
    assert ca("active", "active", _roadmap(practiced=False, learn_done=True, requires_cp=False))["type"] == "practice"
    assert ca("active", "active", _roadmap(practiced=True, learn_done=True, requires_cp=False))["type"] == "advance"

# A lesson with no practice step at all shouldn't dead-end on a learn/practice step.
def test_action_no_practice_lesson_skips_to_advance():
    assert ca("active", "active", _roadmap(practiced=False, learn_done=False, has_practice=False, requires_cp=False))["type"] == "advance"


# ── Integration: the real Student Home view-model ───────────────────────────
def _home(se_id, cu):
    return run(server.portal_school_home(se_id, cu))

def _start_and_practice(se_row, enr, cu):
    lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
    started = run(server.portal_school_start_practice(se_row["id"], lesson_id, cu))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
    return lesson_id


def test_scenario_a_active_student_home():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            home = _home(se_row["id"], cu)
            # correct dog + course + current module + a real next action
            assert home["dog"]["name"] == dog["name"]
            assert home["program"]["name"] == prog["name"]
            assert home["current_module"] and home["current_lesson"]
            assert home["current_action"]["type"] == "lesson"   # fresh enroll → learn step, NOT practice
            assert home["lesson_state"]["learn_completed"] is False
            assert home["progress"]["lessons_total"] >= 2 and home["progress"]["lessons_completed"] == 0
            # view-model never speaks "homework" to the student
            import json
            assert "homework" not in json.dumps(home).lower()
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_learn_then_practice_via_start_practice():
    # fresh → lesson; explicit Start-Practice completes the learn step → practice;
    # logging a session → practiced → submit_checkpoint. The real endpoints, not mocks.
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
            assert _home(se_row["id"], cu)["current_action"]["type"] == "lesson"
            started = run(server.portal_school_start_practice(se_row["id"], lesson_id, cu))
            h = _home(se_row["id"], cu)
            assert h["current_action"]["type"] == "practice"
            assert h["lesson_state"]["learn_completed"] is True and h["lesson_state"]["practiced"] is False
            run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
            assert _home(se_row["id"], cu)["current_action"]["type"] == "submit_checkpoint"
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_learn_completed_is_per_dog():
    # Starting practice for one dog must not mark another dog's lesson learned.
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog1):
        se1, enr1 = _p4_enroll(prog, dog1, admin)
        did2 = str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did2, "name": "SecondDog", "owner_id": client_doc["id"],
                                       "breed": "Mix", "age_y": 2,
                                       "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}))
        res2 = run(server.school_enroll(server.SchoolEnrollIn(dog_id=did2, program_id=prog["id"]), admin))
        se2_id, enr2_id = res2["school_enrollment"]["id"], res2["enrollment"]["id"]
        try:
            cu = _p4_client_user(client_doc["id"])
            l1 = run(server.db.dog_programs.find_one({"id": enr1["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
            run(server.portal_school_start_practice(se1["id"], l1, cu))
            assert _home(se1["id"], cu)["current_action"]["type"] == "practice"      # dog1 learn done
            assert _home(se2_id, cu)["current_action"]["type"] == "lesson"           # dog2 untouched
        finally:
            _p4_cleanup(se2_id, enr2_id)
            run(server.db.dogs.delete_one({"id": did2}))
            _p4_cleanup(se1["id"], enr1["id"])


def test_scenario_e_checkpoint_awaiting_review():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _start_and_practice(se_row, enr, cu)
            # practiced → home should now say submit checkpoint
            assert _home(se_row["id"], cu)["current_action"]["type"] == "submit_checkpoint"
            run(server.portal_school_submit_checkpoint(se_row["id"], lesson_id, server.CheckpointSubmissionIn(
                video="data:video/mp4;base64," + __import__("base64").b64encode(b"x" * 1000).decode(), note="n"), cu))
            home = _home(se_row["id"], cu)
            # must NOT tell them to keep progressing — trainer's turn
            assert home["current_action"]["type"] == "awaiting_review"
            assert home["checkpoint_status"]["status"] == "awaiting_review"
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_scenario_f_checkpoint_passed_advances():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _start_and_practice(se_row, enr, cu)
            out = run(server.portal_school_submit_checkpoint(se_row["id"], lesson_id, server.CheckpointSubmissionIn(
                video="data:video/mp4;base64," + __import__("base64").b64encode(b"x" * 1000).decode(), note="n"), cu))
            sub_id = out["checkpoint"]["id"]
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
            hid = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
            did = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
            _p4_grade(sub_id, admin, "advance", hid, did, feedback="Great handling.")
            home = _home(se_row["id"], cu)
            # advanced to lesson 2 → next action is practice again; feedback present; handler/dog separate
            assert home["progress"]["checkpoints_passed"] == 1
            assert home["progress"]["lessons_completed"] == 1
            # advanced to lesson 2 (learn step not started there) → lesson, not practice
            assert home["current_action"]["type"] == "lesson"
            fb = home["latest_feedback"]
            assert fb and fb["handler_overall"] is not None and fb["dog_overall"] is not None
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_scenario_g_remediation_is_priority():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _start_and_practice(se_row, enr, cu)
            out = run(server.portal_school_submit_checkpoint(se_row["id"], lesson_id, server.CheckpointSubmissionIn(
                video="data:video/mp4;base64," + __import__("base64").b64encode(b"x" * 1000).decode(), note="n"), cu))
            sub_id = out["checkpoint"]["id"]
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
            hid = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
            did = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
            run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                handler_scores={hid: 3}, dog_scores={did: 2}, feedback="Let's build more reps.",
                outcome="prescribe_practice",
                prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe", min_practice_sessions_required=3)), admin))
            home = _home(se_row["id"], cu)
            assert home["current_action"]["type"] == "remediation"
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_scenario_j_no_enrollment():
    # A client with no school enrollment: list is empty, home 404s cleanly.
    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": "P2A admin"}
    c = run(server.create_client(server.ClientIn(name=f"P2A NoEnroll {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    cu = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "NoEnroll"}
    try:
        assert run(server.portal_school_list(cu)) == []
        import pytest
        with pytest.raises(server.HTTPException):
            run(server.portal_school_home(str(uuid.uuid4()), cu))
    finally:
        run(server.db.clients.delete_one({"id": c["id"]}))
