"""Checkpoint grading polish — the 1-5 score scale.

New grades must be 1-5 (0 rejected, every criterion required); historical
0-score rows remain readable/displayable untouched (no migration).
Reuses the enrollment/checkpoint fixtures from test_module_quiz.py.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

from test_module_quiz import (  # noqa: F401 — shared fixtures, same conventions
    TAG, _admin_user, _client_user, _client_and_dog, _quiz_program, _enroll,
    _cleanup_school, _practice_current_lesson, _tiny_video,
)


def _pending_submission(se, enr, cu):
    lesson_id, _hw = _practice_current_lesson(se, enr, cu)
    out = run(server.portal_school_submit_checkpoint(
        se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), cu))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    return sub_id, raw["rubric_snapshot"]["handler_criteria"][0]["id"], raw["rubric_snapshot"]["dog_criteria"][0]["id"]


def test_new_grade_rejects_zero_and_incomplete_but_accepts_1_through_5():
    # Checkpoint on the FIRST lesson so it's immediately reachable; quiz
    # pushed out of the way (module 99 = none).
    with _quiz_program(quiz_module_idx=99, checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                sub_id, hid, did = _pending_submission(se, enr, cu)

                # Score 0 → rejected for NEW grades.
                try:
                    run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                        handler_scores={hid: 0}, dog_scores={did: 4}, outcome="advance"), admin))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422 and "1-5" in str(exc.detail)

                # Missing criterion → rejected.
                try:
                    run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                        handler_scores={}, dog_scores={did: 4}, outcome="advance"), admin))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422

                # Out-of-range high → rejected.
                try:
                    run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                        handler_scores={hid: 6}, dog_scores={did: 4}, outcome="advance"), admin))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422

                # Boundary values 1 and 5 → accepted, grade finalizes.
                out = run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                    handler_scores={hid: 1}, dog_scores={did: 5}, outcome="advance"), admin))
                cp = out["checkpoint"]
                assert cp["status"] == "graded"
                assert cp["handler_scores"] == {hid: 1}
                assert cp["dog_scores"] == {did: 5}
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_historical_zero_scores_remain_readable():
    """A pre-scale-change graded row with a stored 0 must still read/display
    accurately — no rewrite, no validation on read."""
    sub_id = str(uuid.uuid4())
    hid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.checkpoint_submissions.insert_one({
        "id": sub_id, "school_enrollment_id": f"{TAG}-legacy", "enrollment_id": f"{TAG}-legacy-enr",
        "dog_id": "legacy-dog", "client_id": "legacy-client", "lesson_id": "legacy-lesson",
        "module_id": "legacy-module", "lesson_name": "Legacy lesson",
        "rubric_snapshot": {"handler_criteria": [{"id": hid, "name": "Cue"}],
                            "dog_criteria": [{"id": did, "name": "Latency"}]},
        "status": "graded", "outcome": "prescribe_practice",
        "handler_scores": {hid: 0}, "dog_scores": {did: 3},
        "submitted_at": server.now_iso(), "graded_at": server.now_iso(),
    }))
    try:
        row = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
        # Derived overall handles the historical 0 without error.
        overall = server._checkpoint_overall_scores(row["handler_scores"], row["dog_scores"])
        assert overall["handler"] == 0.0
        # The client-safe serializer surfaces it verbatim.
        safe = server._client_safe_checkpoint_submission(row)
        assert safe["handler_scores"][hid] == 0
        assert safe["dog_scores"][did] == 3
        # Trainer-facing shape works too.
        admin_view = server._admin_safe_checkpoint(row)
        assert admin_view["handler_overall"] == 0.0
    finally:
        run(server.db.checkpoint_submissions.delete_one({"id": sub_id}))


def test_trainer_guidance_stays_out_of_client_payloads():
    rubric = {
        "enabled": True, "title": "T", "submission_instructions": "Film it.",
        "handler_criteria": [{"id": "h1", "name": "Cue", "guidance": "TRAINER ONLY H"}],
        "dog_criteria": [{"id": "d1", "name": "Latency", "guidance": "TRAINER ONLY D"}],
        "pass_readiness_guidance": "TRAINER ONLY PASS",
    }
    safe = server._client_safe_checkpoint_rubric(rubric)
    blob = str(safe)
    assert "TRAINER ONLY" not in blob
    assert "pass_readiness_guidance" not in blob
