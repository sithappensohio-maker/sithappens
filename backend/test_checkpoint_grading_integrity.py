"""Stage 10.5A — checkpoint grading must never 500 on legacy / incomplete rows.

Every row the app writes carries module_id and rubric_snapshot (they have
existed since the collection's first commit), but rows written straight into
the database (imports, seeds, hand edits) may not. The grader validates its
context first and reconstructs ONLY what is unambiguous from the canonical
enrollment snapshot, through one shared path; everything else is a
controlled 409 with a message the trainer can act on.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

from test_trainer_lesson_workspace import ADMIN, TAG, _clean, _enrollment, _seed  # noqa: F401


def _rubric(s):
    enr = _enrollment(s)
    return server._find_lesson_in_snapshot(enr, s["lesson_ids"][0])["checkpoint"]


def _scores(rubric):
    return ({c["id"]: 4 for c in rubric["handler_criteria"]}, {c["id"]: 4 for c in rubric["dog_criteria"]})


def _grade_body(rubric, outcome="advance"):
    h, d = _scores(rubric)
    return server.CheckpointGradeIn(handler_scores=h, dog_scores=d, feedback="Clean.", outcome=outcome)


def _legacy_row(s, **over):
    enr = _enrollment(s)
    row = {
        "id": str(uuid.uuid4()), "school_enrollment_id": s["se_id"], "enrollment_id": enr["id"],
        "dog_id": s["dog_id"], "client_id": s["client"]["id"], "lesson_id": s["lesson_ids"][0],
        "lesson_name": "Lesson 1", "client_note": "", "status": "pending", "submitted_at": server.now_iso(),
    }
    row.update(over)
    run(server.db.checkpoint_submissions.insert_one(dict(row)))
    return row


def _grade(row_id, body):
    return run(server.admin_school_checkpoint_grade(row_id, body, ADMIN))


def test_1_current_valid_submission_grades_and_is_left_exactly_as_written():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    rubric = _rubric(s)
    res = run(server.admin_school_live_checkpoint(s["se_id"], s["lesson_ids"][0], _grade_body(rubric), ADMIN))
    sub = run(server.db.checkpoint_submissions.find_one({"id": res["checkpoint"]["id"]}, {"_id": 0}))
    assert sub["status"] == "graded" and sub["outcome"] == "advance"
    # modern rows are untouched by the compatibility path: same module, same frozen rubric
    assert sub["module_id"] == _enrollment(s)["program_snapshot"]["modules"][0]["id"]
    assert sub["rubric_snapshot"]["handler_criteria"][0]["id"] == rubric["handler_criteria"][0]["id"]
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][1]


def test_2_legacy_row_without_module_or_rubric_is_reconstructed_once_and_graded():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    rubric = _rubric(s)
    row = _legacy_row(s)  # no module_id, no rubric_snapshot
    # the queue shows the reconstructed rubric so the trainer can score it
    queue = run(server.admin_school_checkpoints_pending(ADMIN))
    item = next(i for i in queue if i["id"] == row["id"])
    assert item["context_problem"] is None
    assert [c["id"] for c in item["rubric_snapshot"]["handler_criteria"]] == [c["id"] for c in rubric["handler_criteria"]]
    res = _grade(row["id"], _grade_body(rubric))
    assert res["checkpoint"]["status"] == "graded"
    sub = run(server.db.checkpoint_submissions.find_one({"id": row["id"]}, {"_id": 0}))
    assert sub["module_id"] == _enrollment(s)["program_snapshot"]["modules"][0]["id"]
    assert sub["rubric_snapshot"]["handler_criteria"][0]["id"] == rubric["handler_criteria"][0]["id"]
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][1]
    # re-calling the graded row is the same idempotent no-op as before
    again = _grade(row["id"], _grade_body(rubric))
    assert again["checkpoint"]["status"] == "graded"


def test_3_incomplete_rows_that_cannot_be_recovered_get_a_controlled_409_with_a_useful_message():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    rubric = _rubric(s)
    # (a) lesson not in the program → no guess
    foreign = _legacy_row(s, lesson_id="not-a-lesson", lesson_name="Ghost Lesson")
    with pytest.raises(HTTPException) as e:
        _grade(foreign["id"], server.CheckpointGradeIn(handler_scores={}, dog_scores={}, feedback="", outcome="advance"))
    assert e.value.status_code == 409
    assert e.value.detail["code"] == "checkpoint_context_unrecoverable"
    assert "Ghost Lesson" in e.value.detail["msg"] and "submit the checkpoint again" in e.value.detail["msg"]
    # (b) lesson exists but has no checkpoint configured → nothing to score against
    plain = _seed("hybrid", checkpoint_on_lesson1=False)
    no_rubric = _legacy_row(plain)
    with pytest.raises(HTTPException) as e2:
        _grade(no_rubric["id"], server.CheckpointGradeIn(handler_scores={}, dog_scores={}, feedback="", outcome="advance"))
    assert e2.value.status_code == 409 and "Program Studio" in e2.value.detail["msg"]
    # (c) no lesson at all
    nothing = _legacy_row(s, lesson_id=None)
    with pytest.raises(HTTPException) as e3:
        _grade(nothing["id"], server.CheckpointGradeIn(handler_scores={}, dog_scores={}, feedback="", outcome="advance"))
    assert e3.value.status_code == 409
    # none of them was claimed or altered: still pending, still without a rubric
    for r in (foreign, no_rubric, nothing):
        sub = run(server.db.checkpoint_submissions.find_one({"id": r["id"]}, {"_id": 0}))
        assert sub["status"] == "pending" and "rubric_snapshot" not in sub and "grading_plan" not in sub
    # the queue names the problem instead of offering an empty rubric
    queue = run(server.admin_school_checkpoints_pending(ADMIN))
    item = next(i for i in queue if i["id"] == foreign["id"])
    assert "Ghost Lesson" in item["context_problem"]


def test_4_no_unhandled_server_error_on_any_malformed_shape():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    rubric = _rubric(s)
    shapes = [
        {},                                                     # nothing beyond ids
        {"module_id": "not-a-module"},                          # module not in the program
        {"rubric_snapshot": {"handler_criteria": [], "dog_criteria": []}},  # empty rubric
        {"rubric_snapshot": None, "module_id": None},
        {"lesson_id": "", "module_id": ""},
    ]
    for shape in shapes:
        row = _legacy_row(s, **shape)
        try:
            _grade(row["id"], _grade_body(rubric))
        except HTTPException as exc:
            assert exc.status_code in (409, 422), (shape, exc.status_code)
            assert isinstance(exc.detail, (str, dict))
        finally:
            # one active submission per lesson (cs_active_unique) — clear the way for the next shape
            run(server.db.checkpoint_submissions.delete_one({"id": row["id"]}))
        # every other exception type is exactly the unhandled 500 this stage forbids
    # and the scoring rule still holds for a recoverable row: wrong keys → 422, never a fill-in
    row = _legacy_row(s)
    with pytest.raises(HTTPException) as e:
        _grade(row["id"], server.CheckpointGradeIn(handler_scores={}, dog_scores={}, feedback="", outcome="advance"))
    assert e.value.status_code == 422
