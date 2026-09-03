"""Online School — the Today view-model's practice summary.

`portal_school_home.active_practice` rows carry a read-only, ADDITIVE summary
(school_lesson_id, school_lesson_name, is_current_lesson_practice,
sessions_logged, last_session_at, required_practice_satisfied) so the browser
never infers "was the required practice done?" from raw section_logs.

What these tests protect:
  * the numbers come from the same canonical predicate every School gate uses
    (drafts / questions / rest days never count);
  * only the CURRENT lesson's own Practice row can read as satisfied, and only
    once the roadmap says it is practised and School no longer asks for
    practice on it — trainer-prescribed general rows and remediation never do;
  * completed rows still drop out through the existing status behaviour;
  * nothing outside the client allowlist leaks.

Nothing here changes what counts as practice, the current action, advancement
or homework status — the assertions pin that those stayed put.
"""
import contextlib

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _enroll, _client_user, _admin_user, _cleanup_school,
    _homework_template, _submit_checkpoint_for_current_lesson,
)

NEW_FIELDS = {
    "school_lesson_id", "school_lesson_name", "is_current_lesson_practice",
    "sessions_logged", "last_session_at", "required_practice_satisfied",
}
ALLOWED = set(server._CLIENT_SAFE_HOMEWORK_FIELDS) | {"template_snapshot", "section_logs", "daily_progress"} | NEW_FIELDS


@contextlib.contextmanager
def _course(n_lessons=2, checkpoint_lesson_idx=99):
    with _school_program(n_modules=1, n_lessons_per_module=n_lessons,
                         checkpoint_lesson_idx=checkpoint_lesson_idx) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin)
            cu = _client_user(client["id"])
            try:
                lesson_id = run(server.db.dog_programs.find_one(
                    {"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                yield se, enr, cu, lesson_id, admin, prog
            finally:
                _cleanup_school(se["id"], enr["id"])


def _home(se, cu):
    return run(server.portal_school_home(se["id"], cu))


def _rows(se, cu):
    return {r["id"]: r for r in _home(se, cu)["active_practice"]}


def _start(se, lesson_id, cu):
    run(_school_client_flow.complete_instructional_steps(se["id"], lesson_id, cu))
    return run(server.portal_school_start_practice(se["id"], lesson_id, cu))["homework_id"]


def _log(hw_id, cu):
    run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))


# ---------------------------------------------------------------------------

def test_before_practice_the_current_row_is_present_unsatisfied_with_zero_sessions():
    with _course() as (se, enr, cu, lid, admin, prog):
        hw_id = _start(se, lid, cu)
        home = _home(se, cu)
        assert home["current_action"]["type"] == "practice"
        row = _rows(se, cu)[hw_id]
        assert row["school_lesson_id"] == lid
        assert row["school_lesson_name"] == prog["modules"][0]["lessons"][0]["name"]
        assert row["is_current_lesson_practice"] is True
        assert row["sessions_logged"] == 0
        assert row["last_session_at"] is None
        assert row["required_practice_satisfied"] is False


def test_a_real_session_counts_and_the_current_row_becomes_satisfied():
    with _course() as (se, enr, cu, lid, admin, prog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        home = _home(se, cu)
        # Progression is untouched: School moved on exactly as before.
        assert home["current_action"]["type"] == "advance"
        assert home["lesson_state"]["practiced"] is True
        row = _rows(se, cu)[hw_id]
        assert row["sessions_logged"] == 1
        assert row["last_session_at"]
        assert row["is_current_lesson_practice"] is True
        assert row["required_practice_satisfied"] is True
        # ...and the row itself did not change status: it is still active.
        assert row["status"] != "completed"
        _log(hw_id, cu)
        assert _rows(se, cu)[hw_id]["sessions_logged"] == 2


def test_questions_and_draft_placeholders_are_not_sessions():
    with _course() as (se, enr, cu, lid, admin, prog):
        hw_id = _start(se, lid, cu)
        run(server.ask_section_question(hw_id, "practice", server.DayQuestionIn(text="Can you check this?"), cu))
        row = _rows(se, cu)[hw_id]
        assert row["sessions_logged"] == 0
        assert row["last_session_at"] is None
        assert row["required_practice_satisfied"] is False
        assert _home(se, cu)["current_action"]["type"] == "practice"


def test_summary_uses_the_same_predicate_as_the_gates_for_rest_skip_and_drafts():
    # Pure predicate check against a synthetic row: the helper must agree with
    # _lesson_is_practiced / _practice_log_counts_as_session, never re-decide.
    hw = {"id": "x", "daily_tracker": True, "status": "assigned", "section_logs": [
        {"submission_status": "in_progress", "logged_at": "2026-09-01T10:00:00+00:00"},
        {"submission_status": "rest", "is_rest_day": True, "logged_at": "2026-09-02T10:00:00+00:00"},
        {"submission_status": "skipped", "is_skipped": True, "logged_at": "2026-09-03T10:00:00+00:00"},
    ]}
    run(server.db.homework.insert_one(dict(hw)))
    try:
        out = run(server._client_practice_summary(hw, {"program_snapshot": {"modules": []}},
                                                  current_hw_id="x", current_lesson_practiced=False,
                                                  practice_required_now=True))
        assert out["sessions_logged"] == 0
        assert out["last_session_at"] is None
        assert out["required_practice_satisfied"] is False
        hw["section_logs"].append({"submission_status": "submitted", "logged_at": "2026-09-04T10:00:00+00:00"})
        run(server.db.homework.update_one({"id": "x"}, {"$set": {"section_logs": hw["section_logs"]}}))
        out = run(server._client_practice_summary(hw, {"program_snapshot": {"modules": []}},
                                                  current_hw_id="x", current_lesson_practiced=True,
                                                  practice_required_now=False))
        assert out["sessions_logged"] == 1
        assert out["last_session_at"] == "2026-09-04T10:00:00+00:00"
        assert out["required_practice_satisfied"] is True
    finally:
        run(server.db.homework.delete_one({"id": "x"}))


def test_trainer_prescribed_general_practice_never_reads_as_satisfied():
    with _course() as (se, enr, cu, lid, admin, prog):
        with _homework_template("General") as (tpl, _a):
            general = run(server.assign_school_practice(
                se["id"], server.SchoolPracticeAssignIn(
                    template_id=tpl["id"], lesson_id=None, trainer_personalized_note="Bonus loose-leash reps."),
                admin))
            general_id = general["id"] if isinstance(general, dict) and general.get("id") else general.get("homework", {}).get("id")
            hw_id = _start(se, lid, cu)
            _log(hw_id, cu)
            rows = _rows(se, cu)
            assert rows[hw_id]["required_practice_satisfied"] is True
            g = rows[general_id]
            assert g["school_lesson_id"] is None
            assert g["school_lesson_name"] is None
            assert g["is_current_lesson_practice"] is False
            assert g["sessions_logged"] == 0
            assert g["required_practice_satisfied"] is False
            # Logging on the general row counts for THAT row's own tally only.
            _log(general_id, cu)
            g = _rows(se, cu)[general_id]
            assert g["sessions_logged"] == 1
            assert g["required_practice_satisfied"] is False


def test_remediation_keeps_the_current_row_unsatisfied_even_with_sessions():
    with _course(n_lessons=1, checkpoint_lesson_idx=0) as (se, enr, cu, lid, admin, prog):
        sub_id, hid, did, lesson_id, hw_id = _submit_checkpoint_for_current_lesson(se, enr, cu)
        # The lesson was practised before the checkpoint went in...
        assert _rows(se, cu)[hw_id]["sessions_logged"] >= 1
        run(server.admin_school_checkpoint_grade(
            sub_id, server.CheckpointGradeIn(
                handler_scores={hid: 2}, dog_scores={did: 2}, feedback="More reps first.",
                outcome="prescribe_practice",
                prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe", min_practice_sessions_required=2),
            ), admin))
        home = _home(se, cu)
        assert home["current_action"]["type"] == "remediation"
        row = _rows(se, cu)[hw_id]
        # ...but School still asks for practice, so it must not read as done.
        assert row["is_current_lesson_practice"] is True
        assert row["required_practice_satisfied"] is False
        assert row["sessions_logged"] >= 1


def test_completed_rows_still_drop_out_through_status():
    with _course() as (se, enr, cu, lid, admin, prog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        assert hw_id in _rows(se, cu)
        run(server.complete_homework(hw_id, server.HomeworkCompleteIn(), cu))
        assert hw_id not in _rows(se, cu)
        # Progression unchanged by the summary: still moving on.
        assert _home(se, cu)["current_action"]["type"] == "advance"


def test_no_raw_fields_leak_through_the_client_payload():
    with _course() as (se, enr, cu, lid, admin, prog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        for row in _home(se, cu)["active_practice"]:
            extra = set(row.keys()) - ALLOWED
            assert not extra, f"unexpected client fields: {sorted(extra)}"
            for forbidden in ("source_lesson_id", "school_enrollment_record_id", "assigned_by", "trigger", "template_id"):
                assert forbidden not in row
