"""Training Experience Clarity Pass — Stage 2: the client LAST → NOW → NEXT
journey block on the Today view-model (`portal_school_home.journey`).

What these tests protect:
  * NOW is a presentation of the existing current_action (never a second
    priority engine) and points at the ONE Practice row it refers to;
  * NEXT comes from the roadmap / checkpoint gates / delivery mode, and only
    names a booked appointment when one really exists for THIS dog;
  * LAST picks the most meaningful recent event for THIS enrollment attempt
    (trainer session > checkpoint > completed lesson > logged Practice) and
    never renders a blank card, even for legacy session logs missing the
    newer recap fields;
  * two dogs, or two programs on one dog, never blend.

Nothing here changes progression, gating, Practice counting or advancement.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _client_user, _cleanup_school,
    _submit_checkpoint_for_current_lesson, _grade, _make_booking, _delete_booking, TAG,
)


def _enroll_mode(prog, dog, admin, delivery_mode="online"):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"], delivery_mode=delivery_mode), admin))
    return res["school_enrollment"], res["enrollment"]


@contextlib.contextmanager
def _course(n_lessons=2, checkpoint_lesson_idx=99, delivery_mode="online"):
    with _school_program(n_modules=1, n_lessons_per_module=n_lessons, checkpoint_lesson_idx=checkpoint_lesson_idx) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll_mode(prog, dog, admin, delivery_mode)
            cu = _client_user(client["id"])
            try:
                lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                yield se, enr, cu, lesson_id, admin, prog, dog
            finally:
                run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
                _cleanup_school(se["id"], enr["id"])


def _journey(se, cu):
    return run(server.portal_school_home(se["id"], cu))["journey"]


def _start(se, lesson_id, cu):
    run(_school_client_flow.complete_instructional_steps(se["id"], lesson_id, cu))
    return run(server.portal_school_start_practice(se["id"], lesson_id, cu))["homework_id"]


def _log(hw_id, cu):
    run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))


def _assert_filled(j):
    for part in ("last", "now", "next"):
        block = j[part]
        assert isinstance(block.get("title"), str) and block["title"].strip(), (part, block)
        for key in ("title", "summary", "body", "eyebrow"):
            v = block.get(key)
            if v is not None:
                assert "None" not in str(v) and "—" != str(v).strip() and "Unknown" not in str(v), (part, key, v)


def _session_log(enr, dog, **fields):
    doc = {"id": f"sesslog-{uuid.uuid4().hex[:8]}", "dog_id": dog["id"], "enrollment_id": enr["id"],
           "by_user": f"{TAG} trainer", "at": server.now_iso()}
    doc.update(fields)
    run(server.db.training_session_log.insert_one(doc))
    return doc


# ---------------------------------------------------------------------------

def test_fresh_online_enrollment_has_no_history_and_points_at_the_first_lesson():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["last"]["kind"] == "none"
        assert j["now"]["kind"] == "lesson" and j["now"]["cta"]["run"] == "action"
        assert j["now"]["title"] == "Lesson 1.1"
        assert j["next"]["kind"] == "next_lesson" and j["next"]["title"] == "Lesson 1.2"
        assert j["next"]["appointment"] is None


def test_practice_due_names_the_current_lessons_practice_row_and_start_practice():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        hw_id = _start(se, lid, cu)
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "practice"
        assert j["now"]["cta"] == {"label": "Start Practice", "run": "action"}
        assert j["now"]["practice"]["id"] == hw_id
        assert j["now"]["title"] == "Practice Lesson 1.1"
        assert j["next"]["body"] == "Available after today's Practice."
        # Practice began, so the lesson material is the most recent event.
        assert j["last"]["kind"] in ("none", "lesson")


def test_practice_completed_online_moves_now_to_advance_and_last_to_the_logged_practice():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "advance" and j["now"]["cta"]["label"] == "Continue to your next lesson"
        assert j["last"]["kind"] == "practice" and j["last"]["at"]
        assert j["last"]["title"] == "Practice: Lesson 1.1", j["last"]
        assert j["next"]["title"] == "Lesson 1.2" and j["next"]["body"].startswith("Ready now")


def test_checkpoint_states_waiting_remediation_and_passed():
    with _course(checkpoint_lesson_idx=0) as (se, enr, cu, lid, admin, prog, dog):
        j = _journey(se, cu)
        assert j["next"]["kind"] == "checkpoint_next" and j["next"]["title"] == "Checkpoint: Lesson 1.1"
        sub_id, hid, did, _lid, hw_id = _submit_checkpoint_for_current_lesson(se, enr, cu)
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "awaiting_review" and j["now"]["cta"] is None
        assert "don't need to do anything" in j["now"]["body"]
        assert j["next"]["kind"] == "checkpoint_review"
        assert j["last"]["kind"] == "checkpoint_submitted"

        run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
            handler_scores={hid: 2}, dog_scores={did: 2}, feedback="Loosen the leash.", outcome="prescribe_practice",
            prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe", min_practice_sessions_required=2),
        ), admin))
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "remediation" and j["now"]["cta"]["label"] == "Start Practice"
        assert j["next"]["kind"] == "checkpoint_resubmit"
        assert j["last"]["kind"] == "checkpoint" and "more Practice" in j["last"]["summary"]
        assert "Loosen the leash." in j["last"]["summary"]

    with _course(checkpoint_lesson_idx=0) as (se, enr, cu, lid, admin, prog, dog):
        sub_id, hid, did, _lid, hw_id = _submit_checkpoint_for_current_lesson(se, enr, cu)
        _grade(sub_id, admin, "advance", hid, did)
        j = _journey(se, cu)
        assert j["last"]["kind"] == "checkpoint" and j["last"]["summary"].startswith("Passed")


def test_program_complete_is_celebrated_and_next_is_not_a_dead_end():
    with _course(n_lessons=1) as (se, enr, cu, lid, admin, prog, dog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        run(server.portal_school_advance(se["id"], cu))
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "course_complete" and j["now"]["cta"]["label"] == "See your progress"
        assert j["next"]["kind"] in ("program_complete", "next_program")
        assert j["last"]["kind"] in ("lesson", "practice")


def test_trainer_led_next_never_promises_a_date_without_a_booking_and_uses_it_when_one_exists():
    with _course(delivery_mode="in_person") as (se, enr, cu, lid, admin, prog, dog):
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "lesson"
        assert j["next"]["appointment"] is None
        assert "next visit" in j["next"]["body"] or "trainer" in j["next"]["body"]
        b = _make_booking(dog, admin, date="2099-06-01")
        try:
            j = _journey(se, cu)
            assert j["next"]["appointment"] == {"date": "2099-06-01", "time": "10:00", "status": b["status"]}
        finally:
            _delete_booking(b["id"])
        # Practice logged → trainer-guided: done for today, keep practicing.
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "done_today" and "trainer" in j["now"]["body"]
        assert j["now"]["cta"] == {"label": "Practice again", "run": "practice_row", "secondary": True}
        assert j["now"]["practice"]["id"] == hw_id
        assert j["next"]["kind"] == "next_lesson" and "Keep practicing" in j["next"]["body"]


def test_hybrid_next_connects_the_app_and_the_trainer():
    with _course(delivery_mode="hybrid") as (se, enr, cu, lid, admin, prog, dog):
        _start(se, lid, cu)
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["now"]["kind"] == "practice"
        assert j["next"]["title"] == "Lesson 1.2"
        assert "after today's Practice" in j["next"]["body"] and "in person" in j["next"]["body"]


def test_online_enrollments_ignore_training_bookings():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        b = _make_booking(dog, admin, date="2099-06-02")
        try:
            assert _journey(se, cu)["next"]["appointment"] is None
        finally:
            _delete_booking(b["id"])


def test_legacy_session_log_without_recap_fields_still_gives_a_safe_last_card():
    with _course(delivery_mode="in_person") as (se, enr, cu, lid, admin, prog, dog):
        _session_log(enr, dog)  # nothing but the bare log
        j = _journey(se, cu)
        _assert_filled(j)
        assert j["last"]["kind"] == "session"
        assert j["last"]["title"] == "Lesson with your trainer"
        assert j["last"]["summary"] == "Your trainer logged this lesson."

        _session_log(enr, dog, lesson_name_at_session="Place With Distractions",
                     what_went_well="Stayed on Place for 20 seconds with mild distraction.",
                     session_note="PRIVATE: owner was late")
        j = _journey(se, cu)
        assert j["last"]["title"] == "Place With Distractions"
        assert j["last"]["summary"] == "Stayed on Place for 20 seconds with mild distraction."
        assert "PRIVATE" not in str(j)


def test_trainer_session_outranks_older_practice_and_completed_lessons():
    with _course(delivery_mode="in_person") as (se, enr, cu, lid, admin, prog, dog):
        hw_id = _start(se, lid, cu)
        _log(hw_id, cu)
        assert _journey(se, cu)["last"]["kind"] == "practice"
        _session_log(enr, dog, client_recap_note="Great focus today.")
        j = _journey(se, cu)
        assert j["last"]["kind"] == "session" and j["last"]["summary"] == "Great focus today."


def test_two_dogs_in_one_household_never_share_last_or_next():
    with _course(delivery_mode="in_person") as (se_a, enr_a, cu, lid_a, admin, prog, dog_a):
        dog_b = {"id": str(uuid.uuid4()), "name": f"{TAG} Dog B", "owner_id": dog_a["owner_id"], "breed": "Mix", "age_y": 2,
                 "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
        run(server.db.dogs.insert_one(dog_b))
        se_b, enr_b = _enroll_mode(prog, dog_b, admin, "in_person")
        b = _make_booking(dog_a, admin, date="2099-06-03")
        try:
            _session_log(enr_a, dog_a, what_went_well="Dog A did great.")
            ja, jb = _journey(se_a, cu), _journey(se_b, cu)
            assert ja["last"]["summary"] == "Dog A did great."
            assert ja["next"]["appointment"]["date"] == "2099-06-03"
            assert jb["last"]["kind"] == "none"
            assert jb["next"]["appointment"] is None
            assert "Dog A" not in str(jb)
        finally:
            _delete_booking(b["id"])
            run(server.db.training_session_log.delete_many({"enrollment_id": enr_b["id"]}))
            _cleanup_school(se_b["id"], enr_b["id"])
            run(server.db.dogs.delete_one({"id": dog_b["id"]}))


def test_two_programs_on_one_dog_keep_separate_histories():
    with _course(delivery_mode="in_person") as (se1, enr1, cu, lid1, admin, prog1, dog):
        with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog2, admin2):
            se2, enr2 = _enroll_mode(prog2, dog, admin, "online")
            try:
                _session_log(enr1, dog, what_went_well="Only program one.")
                hw2 = _start(se2, run(server.db.dog_programs.find_one({"id": enr2["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"], cu)
                _log(hw2, cu)
                j1, j2 = _journey(se1, cu), _journey(se2, cu)
                assert j1["last"]["kind"] == "session" and j1["last"]["summary"] == "Only program one."
                assert j2["last"]["kind"] == "practice"
                assert "Only program one." not in str(j2)
            finally:
                run(server.db.training_session_log.delete_many({"enrollment_id": enr2["id"]}))
                _cleanup_school(se2["id"], enr2["id"])


def test_journey_never_leaks_internal_ids_or_raw_records():
    with _course(delivery_mode="in_person") as (se, enr, cu, lid, admin, prog, dog):
        _session_log(enr, dog, what_went_well="Fine.", session_note="staff only", advancement_reason="internal")
        j = _journey(se, cu)
        blob = str(j)
        for forbidden in (enr["id"], se["id"], "staff only", "internal", "goal_updates", "session_note", "draft_id"):
            assert forbidden not in blob, forbidden
        assert set(j.keys()) == {"last", "recap", "now", "next"}
