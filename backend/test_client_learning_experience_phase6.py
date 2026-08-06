"""Training-school expansion, Phase 6 — client learning experience.

  * GET /portal/learn — client-accessible curriculum browser. Future
    modules stay hidden; within the CURRENT module, lessons unlock
    progressively up to current_lesson_id; a PRIOR (already-passed) module
    is fully visible. Every returned lesson/skill dict is built from an
    explicit client-safe field whitelist — trainer-only fields (trainer_
    instructions, trainer_prep_notes, troubleshooting, pass_criteria,
    trainer_only_guidance) are never even present as keys, not just blanked.
  * GET /portal/progress — individual progress: skills by 0-5 level with
    labels, completed modules, session history (client_recap_note only,
    never the internal session_note), "what's next."
  * GET /portal/session-recaps — only sessions with a non-empty
    client_recap_note, scoped to the client's own dogs.
  * All three require role=="client".

Same fixture/cleanup convention as test_training_session_completion.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date

TAG = "TEST_LEARN_PHASE6"


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


def _client_user(client_doc):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_doc["id"], "name": client_doc["name"]}


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


TRAINER_ONLY_LESSON_FIELDS = ("trainer_purpose", "trainer_prep_notes", "trainer_instructions", "advancement_criteria")
TRAINER_ONLY_SKILL_FIELDS = ("pass_criteria", "reset_criteria", "trainer_only_guidance", "starting_criteria")


def _rich_lesson(name, order, skill_ids, active=True):
    return server.LessonIn(
        name=name, order=order, active=active, skill_ids=skill_ids,
        client_overview="Client overview text", trainer_purpose="SECRET trainer purpose",
        trainer_prep_notes="SECRET prep notes", trainer_instructions="SECRET step by step",
        advancement_criteria="SECRET advancement strategy",
        common_mistakes="Common mistake text",
        # UI Phase 4 — troubleshooting/success_criteria/estimated_minutes were
        # added to the client-safe lesson allowlist (same category as
        # common_mistakes/safety_notes below): real client-facing content,
        # deliberately no longer trainer-only. See _CLIENT_SAFE_LESSON_FIELDS.
        troubleshooting="If your dog backs away, try a corner.", success_criteria="5 correct in a row.",
        estimated_minutes=8,
        equipment_needed="6ft leash", client_instructions="Do this at home", safety_notes="Keep leashed",
        demo_video_url="https://example.com/demo.mp4",
    )


def _rich_skill(name):
    return server.GoalIn(
        name=name, pass_criteria="SECRET pass criteria", reset_criteria="SECRET reset criteria",
        trainer_only_guidance="SECRET guidance", starting_criteria="SECRET starting criteria",
        client_facing_explanation="Here's what this means for you",
    )


@contextlib.contextmanager
def _rich_program():
    admin = _admin_user()
    body = server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[_rich_skill("Sit"), _rich_skill("Down")]),
            server.ModuleIn(name="Week 2", order=1, goals=[_rich_skill("Heel")]),
        ],
    )
    prog = run(server.create_program(body, admin))
    sit_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Sit")
    down_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Down")
    fixed = server.ProgramIn(
        name=prog["name"], type="private_lessons", format=prog["format"], price=50,
        modules=[
            server.ModuleIn(
                id=prog["modules"][0]["id"], name="Week 1", order=0,
                goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]],
                lessons=[_rich_lesson("Lesson A", 0, [sit_id]), _rich_lesson("Lesson B", 1, [down_id])],
            ),
            server.ModuleIn(**prog["modules"][1]),
        ],
    )
    prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog, admin, sit_id, down_id
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


# ---------------------------------------------------------------------------
# /portal/learn
# ---------------------------------------------------------------------------

def test_learn_hides_future_modules_and_strips_trainer_only_fields():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                result = run(server.portal_learn(_client_user(c)))
                entry = next(r for r in result if r["dog_id"] == dog["id"])
                module_names = {m["name"] for m in entry["modules"]}
                assert module_names == {"Week 1"}  # Week 2 not reached yet — hidden

                lesson_a = entry["modules"][0]["lessons"][0]
                assert lesson_a["name"] == "Lesson A"
                assert lesson_a["client_overview"] == "Client overview text"
                assert lesson_a["equipment_needed"] == "6ft leash"
                # UI Phase 4 — troubleshooting/success_criteria/estimated_minutes
                # are now intentionally client-safe (Lesson Detail's expandable
                # sections need real content, not an always-empty accordion).
                assert lesson_a["troubleshooting"] == "If your dog backs away, try a corner."
                assert lesson_a["success_criteria"] == "5 correct in a row."
                assert lesson_a["estimated_minutes"] == 8
                for f in TRAINER_ONLY_LESSON_FIELDS:
                    assert f not in lesson_a, f"trainer-only lesson field '{f}' leaked to client"
            finally:
                _cleanup(None, enr["id"])


def test_learn_within_current_module_unlocks_progressively():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                # Fresh enrollment starts on Lesson A only.
                result = run(server.portal_learn(_client_user(c)))
                entry = next(r for r in result if r["dog_id"] == dog["id"])
                lesson_names = {l["name"] for l in entry["modules"][0]["lessons"]}
                assert lesson_names == {"Lesson A"}

                lesson_b_id = prog["modules"][0]["lessons"][1]["id"]
                run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_lesson_id": lesson_b_id}}))
                result2 = run(server.portal_learn(_client_user(c)))
                entry2 = next(r for r in result2 if r["dog_id"] == dog["id"])
                lesson_names2 = {l["name"] for l in entry2["modules"][0]["lessons"]}
                assert lesson_names2 == {"Lesson A", "Lesson B"}
            finally:
                _cleanup(None, enr["id"])


def test_learn_prior_module_fully_visible_regardless_of_its_own_lesson_pointer():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                week2_id = prog["modules"][1]["id"]
                # Advance to module 2 while Week 1's own lesson pointer never moved past Lesson A.
                run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_module_id": week2_id}}))
                result = run(server.portal_learn(_client_user(c)))
                entry = next(r for r in result if r["dog_id"] == dog["id"])
                week1 = next(m for m in entry["modules"] if m["name"] == "Week 1")
                assert {l["name"] for l in week1["lessons"]} == {"Lesson A", "Lesson B"}  # fully visible — it's a prior module
            finally:
                _cleanup(None, enr["id"])


def test_learn_rejects_non_client_role():
    admin = _admin_user()
    try:
        run(server.portal_learn(admin))
        assert False, "expected 403"
    except server.HTTPException as e:
        assert e.status_code == 403


# ---------------------------------------------------------------------------
# /portal/progress
# ---------------------------------------------------------------------------

def test_progress_skill_levels_labels_and_whats_next():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=5), admin))
                run(server.update_goal(dog["id"], enr["id"], down_id, server.GoalUpdate(score=2), admin))

                result = run(server.portal_progress(_client_user(c)))
                entry = next(r for r in result if r["dog_id"] == dog["id"])
                sit_skill = next(s for s in entry["current_skills"] if s["name"] == "Sit")
                down_skill = next(s for s in entry["current_skills"] if s["name"] == "Down")
                assert sit_skill["level_label"] == "Mastered"
                assert down_skill["level_label"] == "Learning"
                assert "pass_criteria" not in sit_skill  # trainer-only, never leaked

                assert "Down" in entry["whats_next"]
                assert "Sit" not in entry["whats_next"]  # already mastered — not "what's next"
            finally:
                _cleanup(None, enr["id"])


def test_progress_session_history_excludes_internal_session_note():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                draft_id = started["draft"]["id"]
                sit_activity = next(a for a in started["draft"]["plan"]["activities"] if a["skill_id"] == sit_id)
                run(server.update_training_session_draft(
                    draft_id,
                    server.TrainingSessionDraftUpdateIn(
                        actuals={sit_activity["id"]: server.SessionActivityActualIn(score=4, outcome="passed")},
                        session_note="INTERNAL — dog was reactive to other dogs today",
                        client_recap_note="Great progress on Sit today!",
                    ),
                    admin,
                ))
                run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))

                result = run(server.portal_progress(_client_user(c)))
                entry = next(r for r in result if r["dog_id"] == dog["id"])
                assert len(entry["session_history"]) == 1
                session = entry["session_history"][0]
                assert session["recap_note"] == "Great progress on Sit today!"
                assert "session_note" not in session
                assert "INTERNAL" not in str(session)  # the internal note never appears anywhere in this payload
            finally:
                _cleanup(booking["id"], enr["id"])


def test_progress_rejects_non_client_role():
    admin = _admin_user()
    try:
        run(server.portal_progress(admin))
        assert False, "expected 403"
    except server.HTTPException as e:
        assert e.status_code == 403


# ---------------------------------------------------------------------------
# /portal/session-recaps
# ---------------------------------------------------------------------------

def test_session_recaps_only_includes_sessions_with_a_recap_note():
    with _rich_program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking1 = _make_booking(dog["id"], admin)
            try:
                # Session 1 — no recap note.
                s1 = run(server.start_training_session_draft_for_booking(booking1["id"], enr["id"], "", admin))
                run(server.complete_training_session(s1["draft"]["id"], server.SessionCompletionIn(), admin))

                # Session 2 — has a recap note. Distinct session_label: once
                # session 1 completes, _get_or_create_session_draft correctly
                # refuses to silently start a second draft under the same
                # (enrollment_id, occurrence_date, session_label) key.
                booking2 = _make_booking(dog["id"], admin)
                s2 = run(server.start_training_session_draft_for_booking(booking2["id"], enr["id"], "session-2", admin))
                run(server.update_training_session_draft(
                    s2["draft"]["id"], server.TrainingSessionDraftUpdateIn(client_recap_note="Nice work on Down!"), admin,
                ))
                run(server.complete_training_session(s2["draft"]["id"], server.SessionCompletionIn(), admin))

                result = run(server.portal_session_recaps(20, _client_user(c)))
                assert len(result) == 1
                assert result[0]["recap_note"] == "Nice work on Down!"
                assert result[0]["dog_name"] == dog["name"]
                run(server.db.bookings.delete_one({"id": booking2["id"]}))
            finally:
                _cleanup(booking1["id"], enr["id"])


def test_session_recaps_rejects_non_client_role():
    admin = _admin_user()
    try:
        run(server.portal_session_recaps(20, admin))
        assert False, "expected 403"
    except server.HTTPException as e:
        assert e.status_code == 403
