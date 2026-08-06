"""Training-school expansion, Phase 7 — trainer dashboard ("Today's Training
Dogs"). Reuses existing bookings/check-in records and the Phase 3/4
session-draft machinery for session status — no second appointment
calendar, no second progress store.

Every assertion below looks up its own booking_id in the result list rather
than asserting on list length, since the disposable test DB is shared
across every test file in one pytest run and other suites may create their
own training bookings dated today.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date

TAG = "TEST_TRAINER_DASH_PHASE7"


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


@contextlib.contextmanager
def _program():
    admin = _admin_user()
    body = server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")])],
    )
    prog = run(server.create_program(body, admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _make_booking(dog_id, admin, service_type="training"):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type=service_type, date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup(booking_id, enr_id=None):
    if booking_id:
        run(server.db.bookings.delete_one({"id": booking_id}))
    if enr_id:
        run(server.db.training_session_drafts.delete_many({"enrollment_id": enr_id}))
        run(server.db.training_session_log.delete_many({"enrollment_id": enr_id}))
        run(server.db.dog_programs.delete_one({"id": enr_id}))


def _row_for(rows, booking_id):
    return next(r for r in rows if r["booking_id"] == booking_id)


# ---------------------------------------------------------------------------
# Session status progression
# ---------------------------------------------------------------------------

def test_not_checked_in_status():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["session_status"] == "not_checked_in"
                assert row["checked_in"] is False
                assert row["dog_name"] == dog["name"]
            finally:
                _cleanup(booking["id"], enr["id"])


def test_plan_ready_status_after_draft_created_with_no_actuals():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["session_status"] == "plan_ready"
                assert row["program_name"] == prog["name"]
                assert row["current_module_name"] == "Week 1"
            finally:
                _cleanup(booking["id"], enr["id"])


def test_in_progress_status_after_an_actual_is_recorded():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                draft_id = started["draft"]["id"]
                sit_activity = started["draft"]["plan"]["activities"][0]
                run(server.update_training_session_draft(
                    draft_id, server.TrainingSessionDraftUpdateIn(actuals={
                        sit_activity["id"]: server.SessionActivityActualIn(score=3),
                    }), admin,
                ))
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["session_status"] == "in_progress"
            finally:
                _cleanup(booking["id"], enr["id"])


def test_completed_status_after_session_completion():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                run(server.complete_training_session(started["draft"]["id"], server.SessionCompletionIn(), admin))
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["session_status"] == "completed"
                assert row["assigned_trainer"] == admin["name"]  # from the session log's by_user
            finally:
                _cleanup(booking["id"], enr["id"])


# ---------------------------------------------------------------------------
# Resolution states surface on the dashboard too
# ---------------------------------------------------------------------------

def test_no_active_enrollment_shows_resolution_needed():
    with _client_and_dog() as (c, dog):
        admin = _admin_user()
        booking = _make_booking(dog["id"], admin)
        try:
            rows = run(server.admin_training_today(admin))
            row = _row_for(rows, booking["id"])
            assert row["session_status"] == "resolution_needed"
            assert row["resolution_reason"] == "no_active_enrollment"
        finally:
            _cleanup(booking["id"])


def test_multiple_active_enrollments_shows_resolution_needed():
    with _program() as (prog_a, admin):
        with _program() as (prog_b, _):
            with _client_and_dog() as (c, dog):
                enr_a = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_a["id"]), admin))
                enr_b = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_b["id"]), admin))
                booking = _make_booking(dog["id"], admin)
                try:
                    rows = run(server.admin_training_today(admin))
                    row = _row_for(rows, booking["id"])
                    assert row["session_status"] == "resolution_needed"
                    assert row["resolution_reason"] == "multiple_active_enrollments"
                finally:
                    _cleanup(booking["id"])
                    _cleanup(None, enr_a["id"])
                    _cleanup(None, enr_b["id"])


# ---------------------------------------------------------------------------
# Recommended focus, homework completion, media/questions
# ---------------------------------------------------------------------------

def test_recommended_focus_reflects_unmastered_skills():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            sit_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Sit")
            run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=5), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert "Down" in row["recommended_focus"]
                assert "Sit" not in row["recommended_focus"]  # already mastered
            finally:
                _cleanup(booking["id"], enr["id"])


def test_homework_completion_media_and_client_question_aggregate():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            hw = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
                dog_id=dog["id"], title=f"{TAG} Plan",
                days=[
                    server.DailyTrackerSectionIn(day_number=1, day_focus="Sit"),
                    server.DailyTrackerSectionIn(day_number=2, day_focus="Sit"),
                ],
            ), admin))
            client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            run(server.submit_day(hw["id"], 1, server.DaySubmitIn(mood=3, video_media_id="fake-media"), client_user))
            run(server.db.homework.update_one(
                {"id": hw["id"], "section_logs.day_number": 1},
                {"$push": {"section_logs.$.questions": {"id": "q1", "text": "Is this normal?", "asked_at": server.now_iso()}}},
            ))
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["homework_completion"] == {"days_completed": 1, "total_days": 2}
                assert row["media_awaiting_review"] == 1
                assert row["client_question"] == "Is this normal?"
            finally:
                _cleanup(booking["id"], enr["id"])
                run(server.db.homework.delete_one({"id": hw["id"]}))


# ---------------------------------------------------------------------------
# Only today's TRAINING bookings appear
# ---------------------------------------------------------------------------

def test_non_training_service_bookings_excluded():
    with _client_and_dog() as (c, dog):
        admin = _admin_user()
        daycare_booking = _make_booking(dog["id"], admin, service_type="daycare")
        try:
            rows = run(server.admin_training_today(admin))
            assert not any(r["booking_id"] == daycare_booking["id"] for r in rows)
        finally:
            run(server.db.bookings.delete_one({"id": daycare_booking["id"]}))


# ---------------------------------------------------------------------------
# Permission enforcement
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# UI Phase 5 — additive dashboard fields (dog_photo, client_name,
# reopen_count, draft_created_at, needs_reassessment_count,
# homework_difficulty_flags)
# ---------------------------------------------------------------------------

def test_dog_photo_and_client_name_included():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"photo": "data:image/png;base64,ABC123"}}))
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["dog_photo"] == "data:image/png;base64,ABC123"
                assert row["client_name"] == c["name"]
            finally:
                _cleanup(booking["id"], enr["id"])


def test_reopen_count_and_draft_created_at_reflect_the_draft():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                draft_id = started["draft"]["id"]
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["reopen_count"] == 0
                assert row["draft_created_at"] == started["draft"]["created_at"]

                run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                run(server.reopen_training_session(draft_id, server.SessionReopenIn(reason="client asked to redo"), admin))
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["reopen_count"] == 1
            finally:
                _cleanup(booking["id"], enr["id"])


def test_needs_reassessment_count_reflects_flagged_current_module_skills():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                draft_id = started["draft"]["id"]
                sit_activity = started["draft"]["plan"]["activities"][0]
                run(server.update_training_session_draft(
                    draft_id, server.TrainingSessionDraftUpdateIn(actuals={
                        sit_activity["id"]: server.SessionActivityActualIn(score=2),
                    }), admin,
                ))
                run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="mark_for_assessment"), admin))
                booking2 = _make_booking(dog["id"], admin)
                try:
                    rows = run(server.admin_training_today(admin))
                    row = _row_for(rows, booking2["id"])
                    assert row["needs_reassessment_count"] >= 1
                finally:
                    run(server.db.bookings.delete_one({"id": booking2["id"]}))
            finally:
                _cleanup(booking["id"], enr["id"])


def test_homework_difficulty_flags_counts_hard_and_incomplete_days():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            hw = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
                dog_id=dog["id"], title=f"{TAG} Difficulty Plan",
                days=[
                    server.DailyTrackerSectionIn(day_number=1, day_focus="Sit"),
                    server.DailyTrackerSectionIn(day_number=2, day_focus="Sit"),
                ],
            ), admin))
            client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            run(server.submit_day(hw["id"], 1, server.DaySubmitIn(mood=3, difficulty="very_hard"), client_user))
            run(server.submit_day(hw["id"], 2, server.DaySubmitIn(mood=2, could_not_complete=True, could_not_complete_reason="Too distracted"), client_user))
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = _row_for(rows, booking["id"])
                assert row["homework_difficulty_flags"] == 2
            finally:
                _cleanup(booking["id"], enr["id"])
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_trainer_can_view_dashboard_front_desk_cannot():
    trainer_uid, trainer_h = _insert_staff("trainer")
    fd_uid, fd_h = _insert_staff("front_desk")
    import httpx
    _http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
    try:
        r_fd = run(_http.get("/api/admin/training/today", headers=fd_h))
        assert r_fd.status_code == 403

        r_trainer = run(_http.get("/api/admin/training/today", headers=trainer_h))
        assert r_trainer.status_code == 200
    finally:
        run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))
