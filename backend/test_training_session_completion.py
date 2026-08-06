"""Training-school expansion, Phase 4 — session completion and advancement.

  * Completing a session is ONE controlled operation: applies recorded
    progress, advances/holds the curriculum per the trainer's EXPLICIT
    choice (never automatically), creates homework only for flagged
    activities from real templates, writes exactly one authoritative
    training_session_log row, and flips the draft to status="completed".
  * Idempotent: retrying an already-completed draft returns the cached
    result — never re-applies progress, never double-creates homework,
    never writes a second log row.
  * A failure partway through the write phase rolls back everything
    already applied (enrollment progress/pointers, homework, session log)
    — the draft is left status="draft" so retry is always safe.

Same fixture/cleanup convention as test_training_session_workspace.py.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date
from motor.motor_asyncio import AsyncIOMotorCollection

TAG = "TEST_SESSION_COMPLETION"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


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


def _make_program_in(name, homework_template_id=None):
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit", homework_template_ids=[homework_template_id] if homework_template_id else []),
                server.GoalIn(name="Down"),
            ], lessons=[
                server.LessonIn(name="Lesson A", order=0, skill_ids=["__SIT__"]),
                server.LessonIn(name="Lesson B", order=1, skill_ids=["__DOWN__"]),
            ]),
            server.ModuleIn(name="Week 2", order=1, goals=[server.GoalIn(name="Heel")]),
        ],
    )


@contextlib.contextmanager
def _program(homework_template_id=None):
    admin = _admin_user()
    body = _make_program_in(f"{TAG} {uuid.uuid4().hex[:6]}", homework_template_id)
    prog = run(server.create_program(body, admin))
    # Wire lesson skill_ids to the REAL stamped goal ids (placeholders above
    # never match, same technique as test_curriculum_lessons_phase1.py).
    sit_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Sit")
    down_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Down")
    fixed = server.ProgramIn(
        name=prog["name"], type="private_lessons", format=prog["format"], price=50,
        modules=[
            server.ModuleIn(
                id=prog["modules"][0]["id"], name="Week 1", order=0,
                goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]],
                lessons=[
                    server.LessonIn(name="Lesson A", order=0, skill_ids=[sit_id]),
                    server.LessonIn(name="Lesson B", order=1, skill_ids=[down_id]),
                ],
            ),
            server.ModuleIn(**prog["modules"][1]),
        ],
    )
    prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog, admin, sit_id, down_id
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _make_booking(dog_id, admin):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup(booking_id, enr_id):
    if booking_id:
        run(server.db.bookings.delete_one({"id": booking_id}))
    run(server.db.training_session_drafts.delete_many({"enrollment_id": enr_id}))
    run(server.db.training_session_log.delete_many({"enrollment_id": enr_id}))
    run(server.db.dog_programs.delete_one({"id": enr_id}))


def _start_and_record_for_enrollment(enr, admin, dog, sit_id, score=3, homework_eligible=False, needs_reassessment=False, skip=False, session_label=None):
    """Same as _start_and_record but reuses an EXISTING enrollment — for a
    dog's second/third session, since re-enrolling would create a second
    active enrollment in the same program and trip the
    multiple_active_enrollments resolution. Returns (booking, draft_id, sit_activity_id).

    Gap-closing pass — a second call defaults to a distinct session_label.
    Once a session is completed, _get_or_create_session_draft now correctly
    refuses to silently start a second draft for the SAME
    (enrollment_id, occurrence_date, session_label) — that's the whole
    point of the fix — so a genuinely distinct "second session today" must
    use a distinct label, exactly like board-and-train's morning/afternoon/
    evening sessions do."""
    booking = _make_booking(dog["id"], admin)
    label = session_label if session_label is not None else f"session-{uuid.uuid4().hex[:8]}"
    started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], label, admin))
    draft_id = started["draft"]["id"]
    activities = started["draft"]["plan"]["activities"]
    sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
    if skip:
        new_plan = [server.SessionActivityIn(**{**a, "skipped": True} if a["id"] == sit_activity["id"] else a) for a in activities]
        run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(plan=new_plan), admin))
    else:
        run(server.update_training_session_draft(
            draft_id,
            server.TrainingSessionDraftUpdateIn(actuals={
                sit_activity["id"]: server.SessionActivityActualIn(
                    score=score, outcome="improving", notes="test note",
                    homework_eligible=homework_eligible, needs_reassessment=needs_reassessment,
                ),
            }),
            admin,
        ))
    return booking, draft_id, sit_activity["id"]


def _start_and_record(prog, admin, dog, sit_id, score=3, homework_eligible=False, needs_reassessment=False, skip=False):
    """Enroll, start a booking-scoped draft, and record an actual for the
    Sit activity. Returns (enr, booking, draft, sit_activity_id)."""
    enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
    booking = _make_booking(dog["id"], admin)
    started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
    draft_id = started["draft"]["id"]
    activities = started["draft"]["plan"]["activities"]
    sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
    if skip:
        new_plan = [server.SessionActivityIn(**{**a, "skipped": True} if a["id"] == sit_activity["id"] else a) for a in activities]
        run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(plan=new_plan), admin))
    else:
        run(server.update_training_session_draft(
            draft_id,
            server.TrainingSessionDraftUpdateIn(actuals={
                sit_activity["id"]: server.SessionActivityActualIn(
                    score=score, outcome="improving", notes="test note",
                    homework_eligible=homework_eligible, needs_reassessment=needs_reassessment,
                ),
            }),
            admin,
        ))
    return enr, booking, draft_id, sit_activity["id"]


# ---------------------------------------------------------------------------
# Core completion — one log, progress in sync
# ---------------------------------------------------------------------------

def test_completing_session_writes_one_log_and_updates_progress_in_sync():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            try:
                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert result["already_completed"] is False
                assert result["session_log"]["id"]

                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1
                assert logs[0]["goal_updates"][0]["goal_id"] == sit_id
                assert logs[0]["goal_updates"][0]["new_score"] == 3

                updated_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated_enr["goal_progress"][sit_id]["score"] == 3
                assert updated_enr["goal_progress"][sit_id]["status"] == "in_progress"

                draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert draft["status"] == "completed"
                assert draft["completed_log_id"] == logs[0]["id"]
            finally:
                _cleanup(booking["id"], enr["id"])


def test_skipped_activity_does_not_update_progress_or_create_homework():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, skip=True)
            try:
                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert result["session_log"]["goal_updates"] == []
                assert result["homework_created"] == []
                updated_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated_enr["goal_progress"][sit_id]["status"] == "not_started"
            finally:
                _cleanup(booking["id"], enr["id"])


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def test_retry_after_completion_is_idempotent_no_duplicates():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=4, homework_eligible=True)
            try:
                r1 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                r2 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert r2["already_completed"] is True
                assert r2["session_log"]["id"] == r1["session_log"]["id"]

                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1

                hw_ids = r1["homework_created"]
                if hw_ids:
                    count = run(server.db.homework.count_documents({"id": {"$in": hw_ids}}))
                    assert count == len(hw_ids)  # no duplicate homework created on retry
            finally:
                _cleanup(booking["id"], enr["id"])
                for hid in r1["homework_created"]:
                    run(server.db.homework.delete_one({"id": hid}))


# ---------------------------------------------------------------------------
# Advancement — explicit trainer choice only
# ---------------------------------------------------------------------------

def test_advance_module_bumps_module_and_resets_lesson_to_first_of_new_module():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=5)
            try:
                result = run(server.complete_training_session(
                    draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin,
                ))
                week2_id = prog["modules"][1]["id"]
                assert result["enrollment"]["current_module_id"] == week2_id
                assert result["session_log"]["advanced_module"] == {"from_module_id": prog["modules"][0]["id"], "to_module_id": week2_id}
                # Week 2 has no lessons defined -> legacy goals synthesize a
                # single default lesson, so the pointer resets to that.
                assert result["enrollment"]["current_lesson_id"] is not None
            finally:
                _cleanup(booking["id"], enr["id"])


def test_advance_lesson_moves_pointer_within_module_and_noops_at_boundary():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            try:
                lesson_a_id = prog["modules"][0]["lessons"][0]["id"]
                lesson_b_id = prog["modules"][0]["lessons"][1]["id"]
                assert enr["current_lesson_id"] == lesson_a_id

                result = run(server.complete_training_session(
                    draft_id, server.SessionCompletionIn(advancement_action="advance_lesson"), admin,
                ))
                assert result["enrollment"]["current_lesson_id"] == lesson_b_id
                assert result["session_log"]["lesson_change"]["to_lesson_id"] == lesson_b_id

                # Second session at the LAST lesson of the module — advancing
                # further must no-op (module boundary), never silently roll
                # into the next module.
                booking2, draft_id2, sit_aid2 = _start_and_record_for_enrollment(enr, admin, dog, sit_id, score=3)
                result2 = run(server.complete_training_session(
                    draft_id2, server.SessionCompletionIn(advancement_action="advance_lesson"), admin,
                ))
                assert result2["enrollment"]["current_lesson_id"] == lesson_b_id  # unchanged
                assert result2["enrollment"]["current_module_id"] == prog["modules"][0]["id"]  # still module 1
                run(server.db.bookings.delete_one({"id": booking2["id"]}))
            finally:
                _cleanup(booking["id"], enr["id"])


def test_reopen_previous_lesson_moves_back():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            try:
                lesson_a_id = prog["modules"][0]["lessons"][0]["id"]
                lesson_b_id = prog["modules"][0]["lessons"][1]["id"]
                run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="advance_lesson"), admin))
                run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))  # sanity load

                booking2, draft_id2, sit_aid2 = _start_and_record_for_enrollment(enr, admin, dog, sit_id, score=2)
                result = run(server.complete_training_session(
                    draft_id2, server.SessionCompletionIn(advancement_action="reopen_previous_lesson"), admin,
                ))
                assert result["enrollment"]["current_lesson_id"] == lesson_a_id
                run(server.db.bookings.delete_one({"id": booking2["id"]}))
            finally:
                _cleanup(booking["id"], enr["id"])


def test_remain_leaves_pointers_untouched():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            try:
                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="remain"), admin))
                assert result["enrollment"]["current_module_id"] == enr["current_module_id"]
                assert result["enrollment"]["current_lesson_id"] == enr["current_lesson_id"]
            finally:
                _cleanup(booking["id"], enr["id"])


def test_complete_program_sets_enrollment_status_completed():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=5)
            try:
                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="complete_program"), admin))
                assert result["enrollment"]["status"] == "completed"
                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated["status"] == "completed"
                assert updated["completed_at"]
            finally:
                _cleanup(booking["id"], enr["id"])


def test_mark_for_assessment_bulk_flags_recorded_skills():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            try:
                run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="mark_for_assessment"), admin))
                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated["goal_progress"][sit_id].get("needs_reassessment") is True
            finally:
                _cleanup(booking["id"], enr["id"])


def test_needs_reassessment_flag_from_actual_persists():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=5, needs_reassessment=True)
            try:
                run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="remain"), admin))
                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated["goal_progress"][sit_id].get("needs_reassessment") is True
            finally:
                _cleanup(booking["id"], enr["id"])


# ---------------------------------------------------------------------------
# Homework creation
# ---------------------------------------------------------------------------

def test_homework_created_only_for_flagged_activity_from_real_template():
    admin_seed = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl-{uuid.uuid4().hex[:6]}", name="Sit Practice", tier="foundation",
    ), admin_seed))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin, sit_id, down_id):
            with _client_and_dog() as (c, dog):
                enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3, homework_eligible=True)
                try:
                    result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                    assert len(result["homework_created"]) == 1
                    hw = run(server.db.homework.find_one({"id": result["homework_created"][0]}, {"_id": 0}))
                    assert hw["dog_id"] == dog["id"]
                    assert hw["title"] == "Sit Practice"
                    run(server.db.homework.delete_one({"id": hw["id"]}))
                finally:
                    _cleanup(booking["id"], enr["id"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_homework_not_created_when_not_flagged():
    admin_seed = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl2-{uuid.uuid4().hex[:6]}", name="Sit Practice 2", tier="foundation",
    ), admin_seed))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin, sit_id, down_id):
            with _client_and_dog() as (c, dog):
                enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3, homework_eligible=False)
                try:
                    result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                    assert result["homework_created"] == []
                finally:
                    _cleanup(booking["id"], enr["id"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


# ---------------------------------------------------------------------------
# Failure rollback
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _fail_method_on_collection(collection_name, method_name, message="simulated failure"):
    """Generalized failure injection — patches any named AsyncIOMotorCollection
    method (insert_one, update_one, find_one_and_update, ...) to raise ONLY
    when called on the named collection, so a single completion call can
    have exactly one specific write stage fail while everything before it
    lands for real."""
    orig = getattr(AsyncIOMotorCollection, method_name)

    async def _patched(self, *args, **kwargs):
        if self.name == collection_name:
            raise RuntimeError(message)
        return await orig(self, *args, **kwargs)

    setattr(AsyncIOMotorCollection, method_name, _patched)
    try:
        yield
    finally:
        setattr(AsyncIOMotorCollection, method_name, orig)


def test_failure_during_session_log_write_leaves_draft_resumable_and_retry_converges_to_one_log():
    """Gap-closing pass — this now tests the hardened model, not rollback.
    No native multi-document transactions on this deployment, so this
    endpoint does NOT roll the enrollment back to "draft" on a mid-write
    failure (a rollback can itself fail partway through, which is exactly
    the unrecoverable state a real hardening pass has to close). Instead:
    the draft stays "completing" with its plan persisted, the enrollment
    update (already idempotent — it $sets fixed final values) is left in
    place, and a retry reuses the SAME persisted plan and resumes — never
    recomputing, never double-applying, never creating a second log."""
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=4)
            try:
                with _fail_method_on_collection("training_session_log", "update_one"):
                    try:
                        run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                        assert False, "expected the simulated failure to propagate"
                    except RuntimeError:
                        pass

                # The enrollment update already landed (it's idempotent, so
                # leaving it in place is safe) — progress is NOT reverted.
                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated["goal_progress"][sit_id]["score"] == 4
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 0  # the log insert itself was the thing that failed — no orphan/partial log
                draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert draft["status"] == "completing"  # NOT reverted to "draft" — resumable, not restartable
                assert draft["completion_plan"] is not None

                # Retry (without the injected failure) resumes and converges
                # to exactly one session log, reusing the SAME persisted plan.
                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin))
                assert result["already_completed"] is False
                logs2 = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs2) == 1
                # The retry's differing advancement_action=="advance_module" is
                # IGNORED — the persisted plan (computed with the original
                # "remain" default) is what's replayed, proving retries can't
                # smuggle in different behavior than what was first claimed.
                assert logs2[0]["advancement_action"] == "remain"
                final_draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert final_draft["status"] == "completed"
            finally:
                _cleanup(booking["id"], enr["id"])


# ---------------------------------------------------------------------------
# Permission enforcement — real HTTP + dependency injection
# ---------------------------------------------------------------------------

def test_trainer_can_complete_session_front_desk_cannot():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, sit_aid = _start_and_record(prog, admin, dog, sit_id, score=3)
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            try:
                r_fd = client.post(f"/api/training-session-drafts/{draft_id}/complete", headers=fd_h, json={})
                assert r_fd.status_code == 403, r_fd.text

                r_trainer = client.post(f"/api/training-session-drafts/{draft_id}/complete", headers=trainer_h, json={})
                assert r_trainer.status_code == 200, r_trainer.text
                assert r_trainer.json()["already_completed"] is False
            finally:
                _cleanup(booking["id"], enr["id"])
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))
