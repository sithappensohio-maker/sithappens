"""Online School Phase 4 — Trainer Assist & Human Support Handoff.

"Do it yourself doesn't mean do it alone." A checkpoint graded
trainer_assist_recommended (Phase 2) IS the Trainer Assist case — there is
no second collection. This file covers: automatic staff-queue visibility
(retry-safe, no duplication), ownership/security (client-safe
serialization never leaks staff notes), the explicit lifecycle state
machine (needs_attention -> contacted -> scheduled -> completed, invalid
transitions rejected, idempotent repeats), scheduling integration with the
real booking system (correct dog/client, no duplicate link, cancellation
never clears the hold), completion (clears the hold exactly once, never
advances the enrollment or touches goal_progress), the legacy manual
clear-hold escape hatch staying coherent with the new lifecycle metadata,
and Trainer Assist history exposure to the client.

Same fixture/cleanup convention as test_online_school_phase3.py — this
file is self-contained, no shared conftest.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import _school_client_flow
from _test_loop import run

TAG = "TEST_SCHOOL_P4"

# Permission enforcement lives in Depends(...), which only runs through
# real ASGI dispatch — see test_online_school_phase1.py for the same
# established pattern. Used only for the handful of tests that specifically
# verify the permission gate.
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def get(url, headers=None):
        return run(_http.get(url, headers=headers))

    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


COACH_RECIPE = {
    "enabled": True, "allow_quick_practice": True,
    "goal": "Get {{dog_name}} to look at you.", "success_today": "7/10.",
    "schedule": {"minutes_per_round": 3, "rounds_per_day": 3, "reps_per_round": 10},
    "steps": [{"id": "get-ready", "title": "Get ready", "instruction": "Have {{dog_name}} nearby."}],
    "guided_practice": {"enabled": True, "ready_instruction": "Wait.", "cue_prompt": "Say the name ONCE.",
                         "success_button_label": "LOOKED", "miss_button_label": "DIDN'T", "count_successes": True},
}


@contextlib.contextmanager
def _homework_template(name_suffix="A"):
    admin = _admin_user()
    body = server.HomeworkTemplateIn(
        name=f"{TAG} Template {name_suffix} {uuid.uuid4().hex[:6]}",
        sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}],
        practice_coach=dict(COACH_RECIPE),
    )
    tpl = run(server.create_homework_template(body, admin))
    try:
        yield tpl, admin
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def _checkpoint_config():
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        submission_requirements="Good lighting.", pass_readiness_guidance="3+ clean reps.",
    )


@contextlib.contextmanager
def _school_program(n_modules=1, n_lessons_per_module=1, checkpoint_lesson_idx=0):
    admin = _admin_user()
    with contextlib.ExitStack() as stack:
        tpls = [stack.enter_context(_homework_template(str(i)))[0] for i in range(n_modules * n_lessons_per_module)]
        tpl_ids = [t["id"] for t in tpls]
        modules = []
        for mi in range(n_modules):
            goals = [server.GoalIn(name=f"Skill M{mi}L{li}") for li in range(n_lessons_per_module)]
            modules.append(server.ModuleIn(name=f"Module {mi + 1}", order=mi, goals=goals))
        body = server.ProgramIn(
            name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
            format={"count": n_modules, "unit": "modules"}, price=0,
            delivery_mode="self_guided", modules=modules,
        )
        prog = run(server.create_program(body, admin))
        fixed_modules = []
        tid = 0
        flat_idx = 0
        for mi, m in enumerate(prog["modules"]):
            goal_ids = [g["id"] for g in m["goals"]]
            lessons = []
            for li in range(n_lessons_per_module):
                cp = _checkpoint_config() if flat_idx == checkpoint_lesson_idx else None
                lessons.append(server.LessonIn(
                    name=f"Lesson {mi + 1}.{li + 1}", order=li, active=True, skill_ids=[goal_ids[li]],
                    client_overview="overview", why_it_matters="matters.",
                    success_criteria="5 in a row.", suggested_homework_template_ids=[tpl_ids[tid]],
                    checkpoint=cp,
                ))
                tid += 1
                flat_idx += 1
            fixed_modules.append(server.ModuleIn(
                id=m["id"], name=m["name"], order=m["order"],
                goals=[server.GoalIn(**g) for g in m["goals"]], lessons=lessons,
            ))
        fixed = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode="self_guided", modules=fixed_modules,
        )
        prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
        try:
            yield prog, admin
        finally:
            run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_school(school_id, enrollment_id):
    subs = run(server.db.checkpoint_submissions.find({"school_enrollment_id": school_id}, {"_id": 0, "video_media_id": 1}).to_list(50))
    media_ids = [s["video_media_id"] for s in subs if s.get("video_media_id")]
    if media_ids:
        run(server.db.homework_media.delete_many({"id": {"$in": media_ids}}))
    run(server.db.checkpoint_submissions.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"dog_id": {"$exists": True}, "assigned_by": {"$regex": "^(Online School|Trainer)"}}))


def _tiny_video():
    import base64
    return "data:video/mp4;base64," + base64.b64encode(b"x" * 1000).decode()


def _enroll(prog, dog, admin):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    return res["school_enrollment"], res["enrollment"]


def _submit_checkpoint_for_current_lesson(se, enr, client_user):
    lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
    started = run(_school_client_flow.start_practice(se["id"], lesson_id, client_user))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
    out = run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video(), note="Client note here"), client_user))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    handler_id = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
    dog_crit_id = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
    return sub_id, handler_id, dog_crit_id, lesson_id, started["homework_id"]


def _grade(sub_id, admin, outcome, handler_id, dog_crit_id, feedback="Nice work."):
    return run(server.admin_school_checkpoint_grade(
        sub_id, server.CheckpointGradeIn(
            handler_scores={handler_id: 3}, dog_scores={dog_crit_id: 3},
            feedback=feedback, outcome=outcome,
        ), admin,
    ))


def _recommend_assist(se, enr, client_user, admin, feedback="Let's work through this together."):
    sub_id, hid, did, lesson_id, hw_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
    _grade(sub_id, admin, "trainer_assist_recommended", hid, did, feedback=feedback)
    return sub_id, hid, did, lesson_id, hw_id


def _make_booking(dog, admin, date="2099-06-01"):
    b = run(server.create_booking(server.BookingIn(dog_id=dog["id"], date=date, service_type="training", time="10:00"), admin))
    return b


def _delete_booking(booking_id):
    if booking_id:
        run(server.db.bookings.delete_one({"id": booking_id}))


# ---------------------------------------------------------------------------
# Creation / visibility
# ---------------------------------------------------------------------------

def test_trainer_assist_recommended_appears_in_staff_queue():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            queue = run(server.admin_school_trainer_assist_queue(admin))
            assert any(row["id"] == sub_id for row in queue)
            row = next(r for r in queue if r["id"] == sub_id)
            assert row["trainer_assist_status"] == "needs_attention"
            assert row["dog_name"] == dog["name"]
            assert row["client_name"] == client_doc["name"]
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_grade_retry_does_not_duplicate_trainer_assist_case():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            # Retry the grade call on an already-graded submission — must be
            # a pure idempotent no-op, never a second history entry.
            _grade(sub_id, admin, "trainer_assist_recommended", "x", "y")
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert len(raw.get("trainer_assist_history") or []) == 1
            queue = run(server.admin_school_trainer_assist_queue(admin))
            assert len([r for r in queue if r["id"] == sub_id]) == 1
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_queue_priority_favors_unresolved_oldest_and_completed_recent_first():
    with _school_program(n_modules=2, n_lessons_per_module=1) as (prog, admin), \
         _client_and_dog() as (c1, dog1), _client_and_dog() as (c2, dog2):
        se1, enr1 = _enroll(prog, dog1, admin)
        se2, enr2 = _enroll(prog, dog2, admin)
        try:
            u1, u2 = _client_user(c1["id"]), _client_user(c2["id"])
            sub1, *_ = _recommend_assist(se1, enr1, u1, admin)  # stays needs_attention
            sub2, *_ = _recommend_assist(se2, enr2, u2, admin)
            run(server.admin_trainer_assist_complete(sub2, server.TrainerAssistCompleteIn(client_summary="Done."), admin))
            queue = run(server.admin_school_trainer_assist_queue(admin))
            ids = [r["id"] for r in queue]
            # The still-unresolved case must sort before the resolved one.
            assert ids.index(sub1) < ids.index(sub2)
            assert queue[ids.index(sub1)]["trainer_assist_status"] == "needs_attention"
            assert queue[ids.index(sub2)]["trainer_assist_status"] == "completed"
        finally:
            _cleanup_school(se1["id"], enr1["id"])
            _cleanup_school(se2["id"], enr2["id"])


def test_ordinary_outcomes_do_not_appear_in_trainer_assist_queue():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)
            queue = run(server.admin_school_trainer_assist_queue(admin))
            assert not any(r["id"] == sub_id for r in queue)
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Ownership / security
# ---------------------------------------------------------------------------

def test_client_can_read_own_trainer_assist_status():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            _recommend_assist(se, enr, client_user, admin)
            detail = run(server.portal_school_detail(se["id"], client_user))
            ta = detail["roadmap"]["checkpoint_status"]["trainer_assist"]
            assert ta["status"] == "needs_attention"
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_other_client_cannot_read_trainer_assist_case():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog), _client_and_dog() as (other_client, _od):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            _recommend_assist(se, enr, client_user, admin)
            other_user = _client_user(other_client["id"])
            try:
                run(server.portal_school_detail(se["id"], other_user))
                assert False, "expected 404"
            except server.HTTPException as exc:
                assert exc.status_code == 404
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_internal_notes_never_serialize_client_side():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(note="Called, left voicemail — staff eyes only."), admin))
            run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(
                client_summary="We worked on loose leash — try again when ready.",
                internal_note="Client was distracted during the call — staff eyes only.",
            ), admin))
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            entry = history[0]
            ta = entry["trainer_assist"]
            assert ta["status"] == "completed"
            assert set(ta.keys()) <= {"status", "contacted_at", "completed_at", "client_summary", "scheduled_date", "scheduled_time"}
            assert "appointment_id" not in ta
            assert "history" not in ta
            blob = str(entry)
            assert "staff eyes only" not in blob
            assert "voicemail" not in blob
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_unauthorized_staff_cannot_modify_trainer_assist():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            fd_uid, fd_h = _insert_staff("front_desk")
            try:
                r = client.post(f"/api/admin/school/trainer-assist/{sub_id}/contact", headers=fd_h, json={})
                assert r.status_code == 403, r.text
                r2 = client.get("/api/admin/school/trainer-assist", headers=fd_h)
                assert r2.status_code == 403, r2.text
            finally:
                run(server.db.users.delete_one({"id": fd_uid}))
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_authorized_staff_can_modify_trainer_assist():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            trainer_uid, trainer_h = _insert_staff("trainer")
            try:
                r = client.post(f"/api/admin/school/trainer-assist/{sub_id}/contact", headers=trainer_h, json={})
                assert r.status_code == 200, r.text
                assert r.json()["checkpoint"]["trainer_assist_status"] == "contacted"
            finally:
                run(server.db.users.delete_one({"id": trainer_uid}))
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def test_lifecycle_needs_attention_to_contacted_to_scheduled_to_completed():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)

            out = run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(), admin))
            assert out["checkpoint"]["trainer_assist_status"] == "contacted"

            booking = _make_booking(dog, admin)
            out = run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            assert out["checkpoint"]["trainer_assist_status"] == "scheduled"
            assert out["checkpoint"]["trainer_assist_appointment_id"] == booking["id"]

            out = run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="All set — try again."), admin))
            assert out["checkpoint"]["trainer_assist_status"] == "completed"
            assert out["checkpoint"]["trainer_assist_hold_active"] is False
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_invalid_transition_rejected_cleanly():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(), admin))
            run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="Done."), admin))
            # Already completed — contact must now be rejected, not silently reopen the case.
            try:
                run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(), admin))
                assert False, "expected 409"
            except server.HTTPException as exc:
                assert exc.status_code == 409
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_repeated_identical_transition_is_idempotent():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(), admin))
            # Second call while already contacted — no-op success, not an error.
            out = run(server.admin_trainer_assist_contact(sub_id, server.TrainerAssistContactIn(), admin))
            assert out["checkpoint"]["trainer_assist_status"] == "contacted"
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert len(raw.get("trainer_assist_history") or []) == 2  # needs_attention + contacted, not 3
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Scheduling integration
# ---------------------------------------------------------------------------

def test_linked_appointment_must_belong_to_correct_client_and_dog():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog), _client_and_dog() as (_oc, other_dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(other_dog, admin)  # wrong dog/client entirely
            try:
                run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
                assert False, "expected 422"
            except server.HTTPException as exc:
                assert exc.status_code == 422
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_no_duplicate_linked_appointment_from_retry():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            scheduled_entries = [h for h in raw.get("trainer_assist_history") or [] if h["status"] == "scheduled"]
            assert len(scheduled_entries) == 1
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_normal_appointments_remain_unaffected():
    with _client_and_dog() as (client_doc, dog):
        admin = _admin_user()
        booking = _make_booking(dog, admin)
        try:
            fresh = run(server.get_booking(booking["id"], admin))
            assert fresh.get("trainer_assist_case_id") is None
        finally:
            _delete_booking(booking["id"])


def test_cancellation_does_not_clear_trainer_assist_hold():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            run(server.cancel_booking(booking["id"], False, admin))
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert raw["trainer_assist_hold_active"] is True
            assert raw["trainer_assist_status"] == "scheduled"
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


# ---------------------------------------------------------------------------
# Completion
# ---------------------------------------------------------------------------

def test_completing_assist_clears_hold_exactly_once():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            out1 = run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="First summary."), admin))
            assert out1["checkpoint"]["trainer_assist_hold_active"] is False
            # Idempotent retry must not overwrite the original summary.
            out2 = run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="Different summary — should be ignored."), admin))
            assert out2["checkpoint"]["trainer_assist_client_summary"] == "First summary."
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_complete_does_not_advance_enrollment_or_alter_goal_progress():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            before = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="Worked through it."), admin))
            after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert after["current_module_id"] == before["current_module_id"]
            assert after["current_lesson_id"] == before["current_lesson_id"]
            assert after["goal_progress"] == before["goal_progress"]
            # The checkpoint's own outcome/grade must NOT have been rewritten to advance.
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert raw["outcome"] == "trainer_assist_recommended"
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_resubmission_becomes_available_after_complete():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, hw_id = _recommend_assist(se, enr, client_user, admin)
            # Blocked while on hold.
            try:
                run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                assert False, "expected 409 while held"
            except server.HTTPException as exc:
                assert exc.status_code == 409
            run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="Ready to try again."), admin))
            # Now allowed — practice again first (a fresh checkpoint still requires a practiced lesson).
            run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), client_user))
            out = run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
            assert out["checkpoint"]["status"] == "awaiting_review"
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Manual hold clear stays coherent
# ---------------------------------------------------------------------------

def test_manual_clear_hold_leaves_coherent_completed_state():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            run(server.admin_school_checkpoint_clear_trainer_assist_hold(sub_id, admin))
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert raw["trainer_assist_hold_active"] is False
            assert raw["trainer_assist_status"] == "completed"
            assert any(h["status"] == "completed" for h in raw.get("trainer_assist_history") or [])
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

def test_client_sees_client_facing_assist_summary_in_history():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin, feedback="Let's fix this together.")
            run(server.admin_trainer_assist_complete(sub_id, server.TrainerAssistCompleteIn(client_summary="Worked on loose-leash direction changes."), admin))
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            entry = history[0]
            # Original checkpoint review feedback is preserved, not overwritten.
            assert entry["trainer_feedback"] == "Let's fix this together."
            assert entry["trainer_assist"]["status"] == "completed"
            assert entry["trainer_assist"]["client_summary"] == "Worked on loose-leash direction changes."
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_checkpoint_history_still_intact_alongside_trainer_assist():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            assert len(history) == 1
            assert history[0]["id"] == sub_id
            assert history[0]["rubric_snapshot"]["handler_criteria"][0]["name"] == "Cue clarity"
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Messages admin-start endpoint (the one real gap the audit found)
# ---------------------------------------------------------------------------

def test_admin_start_thread_creates_thread_with_first_message():
    with _client_and_dog() as (client_doc, dog):
        admin = _admin_user()
        thread = run(server.admin_start_thread(server.AdminThreadStartIn(
            client_id=client_doc["id"], body="I reviewed your checkpoint and would like to help.",
            subject="Online School — Lesson 1", category="training",
        ), admin))
        try:
            assert thread["client_id"] == client_doc["id"]
            assert thread["messages"][0]["sender_role"] == "admin"
            assert thread["messages"][0]["body"] == "I reviewed your checkpoint and would like to help."
            assert thread["unread_client"] is True
            found = run(server.admin_list_messages(client_id=client_doc["id"], _=admin))
            assert any(t["id"] == thread["id"] for t in found)
        finally:
            run(server.db.client_message_threads.delete_one({"id": thread["id"]}))


def test_admin_start_thread_requires_messages_permission():
    with _client_and_dog() as (client_doc, dog):
        ro_uid, ro_h = _insert_staff("read_only")
        try:
            r = client.post("/api/admin/messages/start", headers=ro_h, json={"client_id": client_doc["id"], "body": "hi"})
            assert r.status_code == 403, r.text
        finally:
            run(server.db.users.delete_one({"id": ro_uid}))


# ---------------------------------------------------------------------------
# Cancellation / reschedule lifecycle integrity
#
# trainer_assist_status and trainer_assist_appointment_id live on the
# checkpoint submission, but cancellation happens entirely through the
# EXISTING, untouched booking-cancellation path (cancel_booking) — there is
# no hook back into this feature and there must not be one (no second
# cancellation system). The fix is to derive the client/staff-visible state
# fresh from the booking's own real status on every read
# (_enrich_trainer_assist_schedule / admin_school_trainer_assist_detail /
# admin_school_trainer_assist_queue), rather than storing booking status
# onto the submission. trainer_assist_status itself is asserted to stay
# literally "scheduled" in the database throughout — only the DERIVED,
# never-stored "reschedule_needed" value changes what's presented.
# ---------------------------------------------------------------------------

def test_scheduled_assist_with_active_booking_shows_real_date():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))

            detail = run(server.portal_school_detail(se["id"], client_user))
            ta = detail["roadmap"]["checkpoint_status"]["trainer_assist"]
            assert ta["status"] == "scheduled"
            assert ta["scheduled_date"] == booking["date"]
            assert ta["scheduled_time"] == booking["time"]
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_linked_booking_canceled_hold_remains_active():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))

            # Cancel through the normal, existing booking cancellation path —
            # nothing Trainer-Assist-specific is called here.
            run(server.cancel_booking(booking["id"], False, admin))

            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert raw["trainer_assist_hold_active"] is True
            # The stored field itself never changes — only what's DERIVED
            # from the (now cancelled) booking does.
            assert raw["trainer_assist_status"] == "scheduled"
            assert raw["trainer_assist_appointment_id"] == booking["id"]
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_client_safe_state_after_cancellation_shows_reschedule_needed_no_stale_date():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            run(server.cancel_booking(booking["id"], False, admin))

            detail = run(server.portal_school_detail(se["id"], client_user))
            cp_status = detail["roadmap"]["checkpoint_status"]
            assert cp_status["on_hold"] is True  # still held — cancellation never clears the hold
            ta = cp_status["trainer_assist"]
            assert ta["status"] == "reschedule_needed"
            assert ta.get("scheduled_date") is None
            assert ta.get("scheduled_time") is None

            # Same derivation must hold in the Trainer Feedback history view.
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            assert history[0]["trainer_assist"]["status"] == "reschedule_needed"
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_staff_queue_and_detail_flag_appointment_cancelled_not_valid_scheduled():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            booking = _make_booking(dog, admin)
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=booking["id"]), admin))
            run(server.cancel_booking(booking["id"], False, admin))

            queue = run(server.admin_school_trainer_assist_queue(admin))
            row = next(r for r in queue if r["id"] == sub_id)
            # The bucketing key stays "scheduled" (no item disappears from
            # the queue), but the row is explicitly flagged.
            assert row["trainer_assist_status"] == "scheduled"
            assert row["appointment_cancelled"] is True

            detail = run(server.admin_school_trainer_assist_detail(sub_id, admin))
            assert detail["trainer_assist_status"] == "reschedule_needed"
            assert detail["appointment"]["status"] == "cancelled"
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(booking["id"] if booking else None)


def test_replacement_booking_can_be_linked_after_cancellation():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        old_booking = None
        new_booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            old_booking = _make_booking(dog, admin, date="2026-09-21")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=old_booking["id"]), admin))
            run(server.cancel_booking(old_booking["id"], False, admin))

            new_booking = _make_booking(dog, admin, date="2026-09-28")
            out = run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))
            assert out["checkpoint"]["trainer_assist_status"] == "scheduled"
            assert out["checkpoint"]["trainer_assist_appointment_id"] == new_booking["id"]

            detail = run(server.portal_school_detail(se["id"], client_user))
            ta = detail["roadmap"]["checkpoint_status"]["trainer_assist"]
            assert ta["status"] == "scheduled"
            assert ta["scheduled_date"] == "2026-09-28"
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(old_booking["id"] if old_booking else None)
            _delete_booking(new_booking["id"] if new_booking else None)


def test_old_canceled_booking_cannot_masquerade_as_active_after_replacement():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        old_booking = None
        new_booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            old_booking = _make_booking(dog, admin, date="2026-09-21")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=old_booking["id"]), admin))
            run(server.cancel_booking(old_booking["id"], False, admin))
            new_booking = _make_booking(dog, admin, date="2026-09-28")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))

            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            # The link now points only at the replacement — the cancelled
            # booking has no path left to be read as "the" appointment.
            assert raw["trainer_assist_appointment_id"] == new_booking["id"]

            queue = run(server.admin_school_trainer_assist_queue(admin))
            row = next(r for r in queue if r["id"] == sub_id)
            assert row["appointment_cancelled"] is False

            old_fresh = run(server.db.bookings.find_one({"id": old_booking["id"]}, {"_id": 0, "status": 1}))
            assert old_fresh["status"] == "cancelled"
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(old_booking["id"] if old_booking else None)
            _delete_booking(new_booking["id"] if new_booking else None)


def test_scheduling_retry_after_cancellation_does_not_duplicate_replacement():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        old_booking = None
        new_booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            old_booking = _make_booking(dog, admin, date="2026-09-21")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=old_booking["id"]), admin))
            run(server.cancel_booking(old_booking["id"], False, admin))
            new_booking = _make_booking(dog, admin, date="2026-09-28")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))
            # Retry the identical replacement-linking call.
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))

            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            scheduled_entries = [h for h in raw.get("trainer_assist_history") or [] if h["status"] == "scheduled"]
            # One entry for the original schedule, one for the replacement —
            # the retry must not push a third.
            assert len(scheduled_entries) == 2
            assert raw["trainer_assist_appointment_id"] == new_booking["id"]
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(old_booking["id"] if old_booking else None)
            _delete_booking(new_booking["id"] if new_booking else None)


def test_hold_remains_active_throughout_cancel_and_reschedule_cycle():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        old_booking = None
        new_booking = None
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)

            def hold_active():
                return run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "trainer_assist_hold_active": 1}))["trainer_assist_hold_active"]

            assert hold_active() is True
            old_booking = _make_booking(dog, admin, date="2026-09-21")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=old_booking["id"]), admin))
            assert hold_active() is True
            run(server.cancel_booking(old_booking["id"], False, admin))
            assert hold_active() is True
            new_booking = _make_booking(dog, admin, date="2026-09-28")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))
            assert hold_active() is True
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(old_booking["id"] if old_booking else None)
            _delete_booking(new_booking["id"] if new_booking else None)


def test_cancel_and_reschedule_never_advance_lesson_or_alter_progress_or_grade():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        old_booking = None
        new_booking = None
        try:
            client_user = _client_user(client_doc["id"])
            before = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            sub_id, *_ = _recommend_assist(se, enr, client_user, admin)
            old_booking = _make_booking(dog, admin, date="2026-09-21")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=old_booking["id"]), admin))
            run(server.cancel_booking(old_booking["id"], False, admin))
            new_booking = _make_booking(dog, admin, date="2026-09-28")
            run(server.admin_trainer_assist_schedule(sub_id, server.TrainerAssistScheduleIn(booking_id=new_booking["id"]), admin))

            after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert after["current_module_id"] == before["current_module_id"]
            assert after["current_lesson_id"] == before["current_lesson_id"]
            assert after["goal_progress"] == before["goal_progress"]

            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert raw["outcome"] == "trainer_assist_recommended"
            assert raw["trainer_assist_hold_active"] is True
        finally:
            _cleanup_school(se["id"], enr["id"])
            _delete_booking(old_booking["id"] if old_booking else None)
            _delete_booking(new_booking["id"] if new_booking else None)
