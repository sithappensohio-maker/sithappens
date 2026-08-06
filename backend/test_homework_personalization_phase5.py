"""Training-school expansion, Phase 5 — personalized homework improvements.

  * "Do not create duplicate assignments when the same module homework has
    already been assigned and remains active" — session-completion homework
    creation now checks for an existing non-completed assignment from the
    same template before creating a new one, and reports the conflict
    instead of silently duplicating OR silently skipping.
  * Session-sourced homework carries traceability (source_skill_id/
    source_lesson_id/source_session_log_id) and a trainer_personalized_note
    pulled from the activity's own recorded note.
  * Client day-submission gets a labeled difficulty scale (easy/good/okay/
    hard/very_hard) alongside the existing numeric mood, and a structured
    could_not_complete + reason signal distinct from a planned rest day.
  * Trainer review-queue additions: pending-reviews items surface has_video/
    difficulty/could_not_complete; a new stalled-homework endpoint flags
    daily-tracker homework with no recent activity.

Same fixture/cleanup convention as test_training_session_completion.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date, timedelta

TAG = "TEST_HOMEWORK_PHASE5"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


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
def _program_with_template(admin, template_id):
    body = server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[
            server.GoalIn(name="Sit", homework_template_ids=[template_id]),
        ])],
    )
    prog = run(server.create_program(body, admin))
    try:
        yield prog
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


def _run_session_with_homework(prog, admin, dog, enr=None, notes="Practice daily", session_label=None):
    """Enroll (unless an existing enrollment is passed), run + complete one
    session with Sit flagged homework_eligible. Returns (enr, booking, result).

    Gap-closing pass — a second call for the same enrollment defaults to a
    distinct session_label, since _get_or_create_session_draft now correctly
    returns the FIRST session's now-completed draft for a repeated
    (enrollment_id, occurrence_date, session_label) instead of silently
    starting a second one — exactly the behavior this hardening pass adds."""
    if enr is None:
        enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
    booking = _make_booking(dog["id"], admin)
    label = session_label if session_label is not None else f"session-{uuid.uuid4().hex[:8]}"
    started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], label, admin))
    draft_id = started["draft"]["id"]
    sit_activity = next(a for a in started["draft"]["plan"]["activities"] if a["name"] == "Sit")
    run(server.update_training_session_draft(
        draft_id,
        server.TrainingSessionDraftUpdateIn(actuals={
            sit_activity["id"]: server.SessionActivityActualIn(score=3, outcome="improving", notes=notes, homework_eligible=True),
        }),
        admin,
    ))
    result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
    return enr, booking, result


# ---------------------------------------------------------------------------
# Duplicate-assignment prevention
# ---------------------------------------------------------------------------

def test_second_session_does_not_duplicate_still_active_homework():
    admin_seed = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl-{uuid.uuid4().hex[:6]}", name="Sit Practice", tier="foundation",
    ), admin_seed))
    try:
        with _client_and_dog() as (c, dog):
            with _program_with_template(admin_seed, tpl["id"]) as prog:
                enr, booking1, r1 = _run_session_with_homework(prog, admin_seed, dog)
                assert len(r1["homework_created"]) == 1
                assert r1["homework_conflicts"] == []

                enr2, booking2, r2 = _run_session_with_homework(prog, admin_seed, dog, enr=enr)
                try:
                    assert r2["homework_created"] == []
                    assert len(r2["homework_conflicts"]) == 1
                    assert r2["homework_conflicts"][0]["existing_homework_id"] == r1["homework_created"][0]

                    count = run(server.db.homework.count_documents({"dog_id": dog["id"], "template_snapshot.template_id": tpl["id"]}))
                    assert count == 1  # never duplicated
                finally:
                    run(server.db.bookings.delete_one({"id": booking2["id"]}))
                    for hid in r1["homework_created"]:
                        run(server.db.homework.delete_one({"id": hid}))
                    _cleanup(booking1["id"], enr["id"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_new_session_can_reassign_once_prior_homework_completed():
    admin_seed = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl2-{uuid.uuid4().hex[:6]}", name="Sit Practice 2", tier="foundation",
    ), admin_seed))
    try:
        with _client_and_dog() as (c, dog):
            with _program_with_template(admin_seed, tpl["id"]) as prog:
                enr, booking1, r1 = _run_session_with_homework(prog, admin_seed, dog)
                hw_id = r1["homework_created"][0]
                run(server.db.homework.update_one({"id": hw_id}, {"$set": {"status": "completed"}}))

                enr2, booking2, r2 = _run_session_with_homework(prog, admin_seed, dog, enr=enr)
                try:
                    assert len(r2["homework_created"]) == 1
                    assert r2["homework_created"][0] != hw_id
                    assert r2["homework_conflicts"] == []
                finally:
                    run(server.db.bookings.delete_one({"id": booking2["id"]}))
                    run(server.db.homework.delete_many({"id": {"$in": [hw_id] + r2["homework_created"]}}))
                    _cleanup(booking1["id"], enr["id"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


# ---------------------------------------------------------------------------
# Personalization / traceability
# ---------------------------------------------------------------------------

def test_session_sourced_homework_carries_traceability_and_personalized_note():
    admin_seed = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl3-{uuid.uuid4().hex[:6]}", name="Sit Practice 3", tier="foundation",
    ), admin_seed))
    try:
        with _client_and_dog() as (c, dog):
            with _program_with_template(admin_seed, tpl["id"]) as prog:
                enr, booking, result = _run_session_with_homework(prog, admin_seed, dog, notes="Watch for jumping")
                try:
                    hw = run(server.db.homework.find_one({"id": result["homework_created"][0]}, {"_id": 0}))
                    assert hw["source_skill_id"] == next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Sit")
                    assert hw["source_session_log_id"] == result["session_log"]["id"]
                    assert hw["trainer_personalized_note"] == "Watch for jumping"
                    assert hw["required"] is True
                    assert hw["video_requested"] is False
                    run(server.db.homework.delete_one({"id": hw["id"]}))
                finally:
                    _cleanup(booking["id"], enr["id"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


# ---------------------------------------------------------------------------
# Client day-submission — difficulty + could-not-complete
# ---------------------------------------------------------------------------

def _make_daily_tracker_homework(admin, dog, client):
    return run(server.create_daily_tracker(server.DailyTrackerCreateIn(
        dog_id=dog["id"],
        title=f"{TAG} Daily Plan",
        days=[server.DailyTrackerSectionIn(day_number=1, day_focus="Sit", instructions="Practice sit")],
    ), admin))


def test_difficulty_label_and_mood_stored_independently():
    admin = _admin_user()
    with _client_and_dog() as (c, dog):
        hw = _make_daily_tracker_homework(admin, dog, c)
        try:
            client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            run(server.submit_day(hw["id"], 1, server.DaySubmitIn(mood=3, difficulty="hard"), client_user))
            updated = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
            log = updated["section_logs"][0]
            assert log["field_values"]["__mood"] == 3
            assert log["field_values"]["__difficulty"] == "hard"
        finally:
            run(server.db.homework.delete_one({"id": hw["id"]}))


def test_could_not_complete_flag_and_reason_stored_and_distinct_from_rest_day():
    admin = _admin_user()
    with _client_and_dog() as (c, dog):
        hw = _make_daily_tracker_homework(admin, dog, c)
        try:
            client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            run(server.submit_day(hw["id"], 1, server.DaySubmitIn(
                could_not_complete=True, could_not_complete_reason="Dog was too tired",
            ), client_user))
            updated = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
            log = updated["section_logs"][0]
            assert log["field_values"]["__could_not_complete"] is True
            assert log["field_values"]["__could_not_complete_reason"] == "Dog was too tired"
            # Distinct from rest day: submission_status is "submitted" (needs
            # trainer review), not auto-approved like a rest day.
            assert log["submission_status"] == "submitted"
            assert log["is_rest_day"] is False
        finally:
            run(server.db.homework.delete_one({"id": hw["id"]}))


# ---------------------------------------------------------------------------
# Trainer review queue
# ---------------------------------------------------------------------------

def test_pending_reviews_surfaces_new_signals():
    admin = _admin_user()
    with _client_and_dog() as (c, dog):
        hw = _make_daily_tracker_homework(admin, dog, c)
        try:
            client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            run(server.submit_day(hw["id"], 1, server.DaySubmitIn(
                difficulty="very_hard", could_not_complete=True, could_not_complete_reason="Rain",
                video_media_id="fake-media-id",
            ), client_user))
            items = run(server.list_pending_reviews(admin))
            mine = next(i for i in items if i["homework_id"] == hw["id"])
            assert mine["difficulty"] == "very_hard"
            assert mine["could_not_complete"] is True
            assert mine["could_not_complete_reason"] == "Rain"
            assert mine["has_video"] is True
        finally:
            run(server.db.homework.delete_one({"id": hw["id"]}))


def test_stalled_homework_flags_inactive_and_excludes_recent():
    admin = _admin_user()
    with _client_and_dog() as (c, dog):
        stale_hw_id = str(uuid.uuid4())
        fresh_hw_id = str(uuid.uuid4())
        stale_created = (server.datetime.now(server.timezone.utc) - server.timedelta(days=30)).isoformat()
        run(server.db.homework.insert_one({
            "id": stale_hw_id, "dog_id": dog["id"], "dog_name": dog["name"], "client_id": c["id"], "client_name": c["name"],
            "title": f"{TAG} Stale", "daily_tracker": True, "status": "assigned", "total_days": 5,
            "created_at": stale_created, "section_logs": [], "template_snapshot": {},
        }))
        run(server.db.homework.insert_one({
            "id": fresh_hw_id, "dog_id": dog["id"], "dog_name": dog["name"], "client_id": c["id"], "client_name": c["name"],
            "title": f"{TAG} Fresh", "daily_tracker": True, "status": "assigned", "total_days": 5,
            "created_at": server.now_iso(), "section_logs": [], "template_snapshot": {},
        }))
        try:
            items = run(server.list_stalled_homework(14, admin))
            ids = {i["homework_id"] for i in items}
            assert stale_hw_id in ids
            assert fresh_hw_id not in ids
        finally:
            run(server.db.homework.delete_many({"id": {"$in": [stale_hw_id, fresh_hw_id]}}))
