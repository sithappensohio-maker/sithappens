"""Online School Phase 2C — native feedback/support regression guards.

Covers the backend behaviors introduced while removing the legacy School
feedback/help overlay: contextual Ask Trainer uses the EXISTING global message
thread store + Phase-1 event spine, client-safe thread shapes do not expose the
internal dog_program enrollment id, trainer replies surface back through the
native School support endpoint/unread lifecycle, and School context ownership
cannot cross dogs/enrollments.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run
from test_online_school_phase4 import (
    _school_program as _p4_program,
    _client_and_dog as _p4_client_and_dog,
    _enroll as _p4_enroll,
    _client_user as _p4_client_user,
    _cleanup_school as _p4_cleanup,
    _submit_checkpoint_for_current_lesson as _p4_submit_checkpoint,
)


def _current_lesson(enrollment_id):
    return run(server.db.dog_programs.find_one(
        {"id": enrollment_id}, {"_id": 0, "current_lesson_id": 1, "program_snapshot": 1},
    ))


def test_contextual_ask_trainer_reuses_global_messages_and_school_spine():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        thread_id = None
        try:
            cu = _p4_client_user(client_doc["id"])
            current = _current_lesson(enr["id"])
            lesson_id = current["current_lesson_id"]
            body = server.ClientThreadCreateIn(
                category="training", subject="School question", body="Can you check my timing?",
                dog_id=dog["id"], school_enrollment_id=se_row["id"], school_lesson_id=lesson_id,
            )
            public_thread = run(server.my_create_message(body, cu))
            thread_id = public_thread["id"]

            assert public_thread["school_enrollment_id"] == se_row["id"]
            assert public_thread["school_lesson_id"] == lesson_id
            assert public_thread["dog_id"] == dog["id"]
            assert public_thread["category"] == "training"
            assert "school_enrollment_record_id" not in public_thread  # internal dog_program id stays server-only

            stored = run(server.db.client_message_threads.find_one({"id": thread_id}, {"_id": 0}))
            assert stored["school_enrollment_record_id"] == enr["id"]
            assert stored["school_program_name"] == prog["name"]

            ev = run(server.db.school_events.find_one(
                {"thread_id": thread_id, "event_type": server.SchoolEvent.STUDENT_QUESTION}, {"_id": 0},
            ))
            assert ev and ev["school_enrollment_id"] == se_row["id"]
            assert ev["lesson_id"] == lesson_id
            assert ev["deep_link"] == {"screen": "messages", "thread_id": thread_id}
            notif = run(server.db.school_notifications.find_one({"thread_id": thread_id}, {"_id": 0}))
            assert notif and notif["notification_type"] == server.SchoolEvent.STUDENT_QUESTION

            support = run(server.portal_school_support(se_row["id"], cu))
            assert any(t["id"] == thread_id for t in support["threads"])
            assert support["unanswered_count"] >= 1
        finally:
            if thread_id:
                run(server.db.client_message_threads.delete_many({"id": thread_id}))
                run(server.db.school_events.delete_many({"thread_id": thread_id}))
                run(server.db.school_notifications.delete_many({"thread_id": thread_id}))
            _p4_cleanup(se_row["id"], enr["id"])


def test_trainer_reply_surfaces_native_unread_then_marks_read():
    with _p4_program(n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        thread_id = None
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _current_lesson(enr["id"])["current_lesson_id"]
            thread = run(server.my_create_message(server.ClientThreadCreateIn(
                body="What should I change?", dog_id=dog["id"], school_enrollment_id=se_row["id"],
                school_lesson_id=lesson_id,
            ), cu))
            thread_id = thread["id"]

            run(server.admin_reply_thread(
                thread_id, server.AdminReplyIn(body="Shorten the leash before the cue.", email_notify=False), admin,
            ))
            fresh = run(server.db.client_message_threads.find_one({"id": thread_id}, {"_id": 0}))
            assert fresh["unread_client"] is True
            assert fresh["last_message_role"] == "admin"

            reply_event = run(server.db.school_events.find_one(
                {"thread_id": thread_id, "event_type": server.SchoolEvent.TRAINER_REPLY}, {"_id": 0},
            ))
            assert reply_event and "Shorten the leash" in reply_event["summary"]

            support = run(server.portal_school_support(se_row["id"], cu))
            matching = next(t for t in support["threads"] if t["id"] == thread_id)
            assert matching["unread_client"] is True
            assert support["unread_replies"] >= 1
            assert matching["messages"][-1]["body"] == "Shorten the leash before the cue."

            run(server.my_mark_read(thread_id, cu))
            support2 = run(server.portal_school_support(se_row["id"], cu))
            matching2 = next(t for t in support2["threads"] if t["id"] == thread_id)
            assert matching2["unread_client"] is False
        finally:
            if thread_id:
                run(server.db.client_message_threads.delete_many({"id": thread_id}))
                run(server.db.school_events.delete_many({"thread_id": thread_id}))
                run(server.db.school_notifications.delete_many({"thread_id": thread_id}))
            _p4_cleanup(se_row["id"], enr["id"])


def test_school_message_context_rejects_cross_dog_spoof():
    with _p4_program(n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _current_lesson(enr["id"])["current_lesson_id"]
            wrong_dog_id = str(uuid.uuid4())
            try:
                run(server._school_message_context_for_client(server.ClientThreadCreateIn(
                    body="spoof", dog_id=wrong_dog_id, school_enrollment_id=se_row["id"],
                    school_lesson_id=lesson_id,
                ), cu))
                assert False, "cross-dog School context must be rejected"
            except server.HTTPException as exc:
                assert exc.status_code == 422
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_remediation_start_opens_exact_prescribed_homework_then_stops_when_satisfied():
    """A prescribe-practice grade must launch the ONE homework row the
    resubmission gate counts, not the lesson's generic UI or a new assignment.
    Once the required post-grade sessions are logged, the launch endpoint
    refuses another remediation run because current_action should be resubmit.
    """
    with _p4_program(n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            sub_id, hid, did, _lesson_id, original_hw = _p4_submit_checkpoint(se_row, enr, cu)
            run(server.admin_school_checkpoint_grade(
                sub_id,
                server.CheckpointGradeIn(
                    handler_scores={hid: 3}, dog_scores={did: 3}, feedback="Two more clean reps.",
                    outcome="prescribe_practice",
                    prescription=server.CheckpointPrescriptionIn(
                        action="repeat_current_recipe", min_practice_sessions_required=2,
                    ),
                ),
                admin,
            ))

            launch = run(server.portal_school_start_remediation(se_row["id"], cu))
            assert launch["homework_id"] == original_hw
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "prescription": 1}))
            assert raw["prescription"]["tracked_homework_id"] == original_hw

            # Two post-grade practice sessions against the SAME tracked
            # homework/template section — log_section validates section ids
            # against the template snapshot, so use its real "practice" id.
            run(server.log_section(original_hw, server.SectionLogIn(section_id="practice"), cu))
            run(server.log_section(original_hw, server.SectionLogIn(section_id="practice"), cu))
            home = run(server.portal_school_home(se_row["id"], cu))
            assert home["current_action"]["type"] == "submit_checkpoint"

            try:
                run(server.portal_school_start_remediation(se_row["id"], cu))
                assert False, "satisfied remediation must not keep launching Practice"
            except server.HTTPException as exc:
                assert exc.status_code == 409
                assert "ready to resubmit" in str(exc.detail).lower()
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_school_practice_has_explicit_ownership_context_and_no_legacy_email_bypass():
    """School practice must be identified by School ownership, not merely by
    source_lesson_id (trainer-led homework uses that field too). Its routine
    log goes through the School event policy instead of the old direct homework
    email helper, and the event carries course/module/enrollment context."""
    assert server._is_school_homework({"source_lesson_id": "l1", "assigned_by": "Garrett"}) is False
    assert server._is_school_homework({"source_lesson_id": "l1", "assigned_by": "Online School · Lesson"}) is True

    with _p4_program(n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        old_notify = server.notify_admin_homework_section_log
        direct_email_calls = []

        async def _should_not_be_called(*_args, **_kwargs):
            direct_email_calls.append(True)

        server.notify_admin_homework_section_log = _should_not_be_called
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _current_lesson(enr["id"])["current_lesson_id"]
            started = run(_school_client_flow.start_practice(se_row["id"], lesson_id, cu))
            raw_hw = run(server.db.homework.find_one({"id": started["homework_id"]}, {"_id": 0}))
            assert raw_hw["school_enrollment_id"] == se_row["id"]
            assert raw_hw["school_enrollment_record_id"] == enr["id"]

            run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
            assert direct_email_calls == []
            event = run(server.db.school_events.find_one(
                {"homework_id": started["homework_id"], "event_type": server.SchoolEvent.PRACTICE_COMPLETED}, {"_id": 0},
            ))
            assert event
            assert event["school_enrollment_id"] == se_row["id"]
            assert event["enrollment_id"] == enr["id"]
            assert event["program_name"] == prog["name"]
            assert event["module_id"]
            assert event["lesson_id"] == lesson_id
        finally:
            server.notify_admin_homework_section_log = old_notify
            run(server.db.school_events.delete_many({"school_enrollment_id": se_row["id"]}))
            run(server.db.school_notifications.delete_many({"school_enrollment_id": se_row["id"]}))
            _p4_cleanup(se_row["id"], enr["id"])


def test_school_support_and_context_do_not_adopt_trainer_led_homework_with_same_lesson_id():
    """source_lesson_id is shared by trainer-led homework. Native School
    support/questions must not leak or accept that row merely because dog and
    lesson match the School enrollment."""
    with _p4_program(n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        generic_id = str(uuid.uuid4())
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = _current_lesson(enr["id"])["current_lesson_id"]
            run(server.db.homework.insert_one({
                "id": generic_id, "client_id": client_doc["id"], "dog_id": dog["id"],
                "dog_name": dog.get("name"), "title": "Trainer-led copy",
                "source_lesson_id": lesson_id, "assigned_by": "Garrett",
                "created_at": server.now_iso(), "status": "assigned",
                "section_logs": [{
                    "id": str(uuid.uuid4()), "questions": [{
                        "id": str(uuid.uuid4()), "text": "This is trainer-led, not School",
                        "asked_at": server.now_iso(), "answer": None,
                    }],
                }],
            }))

            support = run(server.portal_school_support(se_row["id"], cu))
            assert all(q.get("homework_id") != generic_id for q in support["practice_questions"])

            try:
                run(server._school_message_context_for_client(server.ClientThreadCreateIn(
                    body="attach wrong homework", school_enrollment_id=se_row["id"],
                    school_lesson_id=lesson_id, school_homework_id=generic_id,
                ), cu))
                assert False, "trainer-led homework must not be accepted as School context"
            except server.HTTPException as exc:
                assert exc.status_code == 422
        finally:
            run(server.db.homework.delete_many({"id": generic_id}))
            _p4_cleanup(se_row["id"], enr["id"])


def test_reached_school_material_does_not_expose_locked_future_lesson_resources():
    """Library/search/media authorization must scope lesson-linked resources
    to curriculum the student has actually reached. Program/global resources
    are handled separately and remain intentionally available.
    """
    from school_suite import _reached_school_material

    enrollment = {
        "status": "active",
        "current_module_id": "m1",
        "current_lesson_id": "l1",
        "program_snapshot": {
            "modules": [{
                "id": "m1", "order": 0, "name": "Module",
                "lessons": [
                    {"id": "l1", "order": 0, "name": "Current", "active": True,
                     "content_blocks": [{"type": "download", "resource_id": "r-current"}]},
                    {"id": "l2", "order": 1, "name": "Locked Future", "active": True,
                     "content_blocks": [{"type": "download", "resource_id": "r-future"}]},
                ],
            }],
        },
    }
    lesson_ids, resource_ids = _reached_school_material(enrollment)
    assert lesson_ids == ["l1"]
    assert resource_ids == ["r-current"]

    enrollment["current_lesson_id"] = "l2"
    lesson_ids2, resource_ids2 = _reached_school_material(enrollment)
    assert lesson_ids2 == ["l1", "l2"]
    assert resource_ids2 == ["r-current", "r-future"]

    enrollment["status"] = "completed"
    lesson_ids3, resource_ids3 = _reached_school_material(enrollment)
    assert lesson_ids3 == ["l1", "l2"]
    assert resource_ids3 == ["r-current", "r-future"]
