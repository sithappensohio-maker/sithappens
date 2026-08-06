"""UI Phase 4 — proves the client-safe Learn/Progress/session-recap
allowlists (and the three small additive fields this phase adds to them)
never leak trainer-only curriculum content, even though the underlying
stored Lesson/Goal/session-log documents carry it.

Same fixture/cleanup convention as test_no_session_write_bypass.py.
"""
import contextlib
import uuid
from datetime import date

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_UI4_SAFE"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def get(url, headers=None):
        return run(_http.get(url, headers=headers))

    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_dog_program():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))

    body = server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[
            server.GoalIn(
                name="Sit", training_objective="Client-visible objective.",
                trainer_only_guidance="TRAINER-SECRET-STRATEGY-XYZ",
                target_duration="hold 5 sec", target_repetitions="10 reps",
                client_facing_explanation="Why sit matters to you.",
            ),
        ], lessons=[
            server.LessonIn(
                name="Sit Fundamentals", order=0, skill_ids=[],
                client_overview="Client-visible overview.",
                trainer_instructions="TRAINER-SECRET-INSTRUCTIONS-XYZ",
                trainer_prep_notes="TRAINER-SECRET-PREP-XYZ",
                advancement_criteria="TRAINER-SECRET-ADVANCEMENT-XYZ",
                estimated_minutes=12, troubleshooting="Client-visible troubleshooting tip.",
                success_criteria="Client-visible success criteria.",
                common_mistakes="Client-visible common mistake.",
            ),
        ])],
    )
    prog = run(server.create_program(body, admin))
    sit_id = prog["modules"][0]["goals"][0]["id"]
    lesson_id = prog["modules"][0]["lessons"][0]["id"]
    run(server.db.programs.update_one(
        {"id": prog["id"], "modules.0.lessons.0.id": lesson_id},
        {"$set": {"modules.0.lessons.0.skill_ids": [sit_id]}},
    ))
    enr = run(server.enroll_dog(did, server.EnrollIn(program_id=prog["id"]), admin))
    try:
        yield c, dog, prog, enr, sit_id, admin, user_id
    finally:
        run(server.db.dog_programs.delete_one({"id": enr["id"]}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.users.delete_one({"id": user_id}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def test_client_safe_lesson_never_includes_trainer_only_fields():
    """_client_safe_lesson must never leak trainer_instructions/prep_notes/
    advancement_criteria, even though the stored Lesson doc has them."""
    with _client_dog_program() as (c, dog, prog, enr, sit_id, admin, user_id):
        lesson = prog["modules"][0]["lessons"][0]
        assert lesson.get("trainer_instructions") == "TRAINER-SECRET-INSTRUCTIONS-XYZ"  # really stored
        safe = server._client_safe_lesson(lesson)
        dumped = str(safe)
        assert "TRAINER-SECRET" not in dumped
        assert "trainer_instructions" not in safe
        assert "trainer_prep_notes" not in safe
        assert "advancement_criteria" not in safe
        # UI Phase 4 additive fields ARE present and correct
        assert safe["estimated_minutes"] == 12
        assert safe["troubleshooting"] == "Client-visible troubleshooting tip."
        assert safe["success_criteria"] == "Client-visible success criteria."


def test_client_safe_skill_never_includes_trainer_only_guidance():
    with _client_dog_program() as (c, dog, prog, enr, sit_id, admin, user_id):
        goal = prog["modules"][0]["goals"][0]
        assert goal.get("trainer_only_guidance") == "TRAINER-SECRET-STRATEGY-XYZ"
        safe = server._client_safe_skill(goal, {
            "score": 3, "status": "in_progress", "last_session_at": "2026-08-01T12:00:00+00:00",
            "needs_reassessment": True,
        })
        assert "TRAINER-SECRET" not in str(safe)
        assert "trainer_only_guidance" not in safe
        assert safe["level_label"] == "Practicing"
        assert safe["target_duration"] == "hold 5 sec"
        assert safe["target_repetitions"] == "10 reps"
        assert safe["last_updated"] == "2026-08-01T12:00:00+00:00"
        assert safe["needs_reassessment"] is True


def test_legacy_program_without_explicit_lessons_still_renders_in_portal_learn():
    """A module created before the Lesson layer existed (goals only, no
    `lessons` list) must still render via _effective_lessons' synthesized
    single default lesson — not an empty/broken Learn screen."""
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} LegacyDog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))
    # ModuleIn with goals but no lessons= kwarg — exactly the legacy shape.
    body = server.ProgramIn(
        name=f"{TAG} legacy {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")])],
    )
    prog = run(server.create_program(body, admin))
    assert prog["modules"][0].get("lessons") in (None, [])  # confirms this really is the legacy shape
    enr = run(server.enroll_dog(did, server.EnrollIn(program_id=prog["id"]), admin))
    try:
        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/learn", headers=h)
        assert r.status_code == 200, r.text
        entry = next(x for x in r.json() if x["dog_id"] == did)
        assert len(entry["modules"]) == 1
        lessons = entry["modules"][0]["lessons"]
        assert len(lessons) == 1
        assert lessons[0]["name"] == "Lesson 1"  # the synthesized default lesson
    finally:
        run(server.db.dog_programs.delete_one({"id": enr["id"]}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.users.delete_one({"id": user_id}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def test_portal_learn_reports_locked_counts_without_naming_locked_content():
    """A second, not-yet-reached module must be counted but never named or
    described — the roadmap can say "1 more module" honestly without
    exposing unpublished curriculum."""
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} Dog2", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))
    body = server.ProgramIn(
        name=f"{TAG} 2mod {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit")]),
            server.ModuleIn(name="SECRET-FUTURE-MODULE-NAME", order=1, goals=[server.GoalIn(name="SECRET-FUTURE-SKILL")]),
        ],
    )
    prog = run(server.create_program(body, admin))
    enr = run(server.enroll_dog(did, server.EnrollIn(program_id=prog["id"]), admin))
    try:
        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/learn", headers=h)
        assert r.status_code == 200, r.text
        assert "SECRET-FUTURE-MODULE-NAME" not in r.text
        assert "SECRET-FUTURE-SKILL" not in r.text
        entry = next(x for x in r.json() if x["dog_id"] == did)
        assert entry["locked_module_count"] == 1
        assert {m["name"] for m in entry["modules"]} == {"Week 1"}
    finally:
        run(server.db.dog_programs.delete_one({"id": enr["id"]}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.users.delete_one({"id": user_id}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def test_portal_learn_endpoint_never_leaks_trainer_content_over_http():
    with _client_dog_program() as (c, dog, prog, enr, sit_id, admin, user_id):
        run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"photo": "data:image/png;base64,ABC123"}}))
        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/learn", headers=h)
        assert r.status_code == 200, r.text
        assert "TRAINER-SECRET" not in r.text
        entry = next(x for x in r.json() if x["dog_id"] == dog["id"])
        assert entry["dog_photo"] == "data:image/png;base64,ABC123"


def test_portal_progress_endpoint_never_leaks_trainer_content_over_http():
    with _client_dog_program() as (c, dog, prog, enr, sit_id, admin, user_id):
        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=3), admin))
        r = client.get("/api/portal/progress", headers=h)
        assert r.status_code == 200, r.text
        assert "TRAINER-SECRET" not in r.text
        body = r.json()
        skill = next(s for d in body for s in d["current_skills"])
        assert skill["level_label"] == "Practicing"
        assert skill["last_updated"]


@contextlib.contextmanager
def _client_dog_multi_module_program(n_modules=3):
    """Same shape as _client_dog_program but with N sequential modules
    (Week 1..N), each with one goal — used by the historical module-
    resolution tests below, which need real advance_module transitions."""
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} Dog {uuid.uuid4().hex[:4]}", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))
    modules = [
        server.ModuleIn(name=f"Week {i+1}", order=i, goals=[server.GoalIn(name=f"Skill{i+1}")])
        for i in range(n_modules)
    ]
    body = server.ProgramIn(
        name=f"{TAG} multi {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": n_modules, "unit": "sessions"}, price=50, modules=modules,
    )
    prog = run(server.create_program(body, admin))
    enr = run(server.enroll_dog(did, server.EnrollIn(program_id=prog["id"]), admin))
    try:
        yield c, dog, prog, enr, admin, user_id
    finally:
        run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
        run(server.db.training_session_drafts.delete_many({"enrollment_id": enr["id"]}))
        run(server.db.bookings.delete_many({"dog_id": did}))
        run(server.db.dog_programs.delete_one({"id": enr["id"]}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.users.delete_one({"id": user_id}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _run_session(dog_id, enr_id, admin, advancement_action):
    """Books, starts a draft, and completes a session with the given
    advancement action — returns the resulting log_id (derived from the
    draft_id, per _apply_completion_plan's deterministic id scheme).
    Each call uses a unique session_label: draft get-or-create is keyed on
    (enrollment_id, occurrence_date, session_label), so same-day repeat
    calls in these tests would otherwise all resolve to the same
    already-completed draft instead of starting a fresh session."""
    booking = run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=date.today().isoformat(), override_capacity=True,
    ), admin))
    started = run(server.start_training_session_draft_for_booking(booking["id"], enr_id, f"sess-{uuid.uuid4().hex[:8]}", admin))
    draft_id = started["draft"]["id"]
    run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(
        client_recap_note="Good session.",
    ), admin))
    run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action=advancement_action), admin))
    return f"sesslog-{draft_id}"


def test_historical_module_stays_labeled_after_enrollment_advances_further():
    """A session completed in Module 2 (a 'remain' session — no advancement
    of its own) must stay labeled Module 2 even after LATER sessions advance
    the enrollment on to Module 3. Proves the old current_module_id fallback
    (which read the enrollment's LIVE position) is gone."""
    with _client_dog_multi_module_program(3) as (c, dog, prog, enr, admin, user_id):
        _run_session(dog["id"], enr["id"], admin, "advance_module")  # Week 1 -> Week 2
        mid_log_id = _run_session(dog["id"], enr["id"], admin, "remain")  # stays in Week 2
        _run_session(dog["id"], enr["id"], admin, "advance_module")  # Week 2 -> Week 3

        enrollment_after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        assert enrollment_after["current_module_id"] == prog["modules"][2]["id"]  # now on Week 3

        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/session-recaps?limit=50", headers=h)
        assert r.status_code == 200, r.text
        recaps_by_id = {x["at"]: x for x in r.json() if x["dog_id"] == dog["id"]}
        mid_log = run(server.db.training_session_log.find_one({"id": mid_log_id}, {"_id": 0}))
        mid_recap = recaps_by_id[mid_log["at"]]
        assert mid_recap["module_name"] == "Week 2"  # NOT "Week 3", the enrollment's current module


def test_advancing_session_labeled_by_the_module_it_was_worked_in():
    """A session that advances Module 2 -> Module 3 is labeled 'Week 2' —
    the module actively worked in during that visit — per the documented
    from-module convention in _resolve_session_module_name."""
    with _client_dog_multi_module_program(3) as (c, dog, prog, enr, admin, user_id):
        _run_session(dog["id"], enr["id"], admin, "advance_module")  # Week 1 -> Week 2
        advancing_log_id = _run_session(dog["id"], enr["id"], admin, "advance_module")  # Week 2 -> Week 3

        log = run(server.db.training_session_log.find_one({"id": advancing_log_id}, {"_id": 0}))
        assert log["advanced_module"]["from_module_id"] == prog["modules"][1]["id"]
        assert log["advanced_module"]["to_module_id"] == prog["modules"][2]["id"]

        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/session-recaps?limit=50", headers=h)
        recap = next(x for x in r.json() if x["dog_id"] == dog["id"] and x["at"] == log["at"])
        assert recap["module_name"] == "Week 2"


def test_legacy_log_without_usable_module_info_does_not_inherit_enrollment_current_module():
    """A genuinely old/legacy log with none of advanced_module,
    current_module_id_after, or resolvable activities must fall back to a
    neutral label, never the enrollment's current module."""
    with _client_dog_multi_module_program(2) as (c, dog, prog, enr, admin, user_id):
        _run_session(dog["id"], enr["id"], admin, "advance_module")  # enrollment now on Week 2
        enrollment_now = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        assert enrollment_now["current_module_id"] == prog["modules"][1]["id"]

        legacy_log_id = f"sesslog-legacy-{uuid.uuid4().hex[:8]}"
        run(server.db.training_session_log.insert_one({
            "id": legacy_log_id, "dog_id": dog["id"], "enrollment_id": enr["id"],
            "booking_id": None, "draft_id": "legacy-draft", "by_user": admin["name"], "by_email": admin["email"],
            "at": server.now_iso(), "session_note": "", "client_recap_note": "Old recap before this field existed.",
            "goal_updates": [], "activities": [], "advancement_action": "remain", "advancement_reason": None,
            "lesson_change": None, "advanced_module": None,
            "current_module_id_after": None, "current_lesson_id_after": None,
            "homework_created": [], "session_label": None,
        }))
        try:
            token = server.create_access_token(user_id, c["email"], "client", 0)
            h = {"Authorization": f"Bearer {token}"}
            r = client.get("/api/portal/session-recaps?limit=50", headers=h)
            assert r.status_code == 200, r.text
            recap = next(x for x in r.json() if x["dog_id"] == dog["id"] and x["recap_note"] == "Old recap before this field existed.")
            assert recap["module_name"] == "Training Session"  # neutral fallback, not "Week 2"
        finally:
            run(server.db.training_session_log.delete_one({"id": legacy_log_id}))


def test_multi_program_history_resolves_each_session_from_its_own_program_snapshot():
    """A dog with two sequential enrollments (different programs) must have
    each session recap resolve module_name from THAT session's own
    enrollment's program_snapshot — never a different enrollment's."""
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} MultiProgDog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))

    prog_a = run(server.create_program(server.ProgramIn(
        name=f"{TAG} ProgA {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 1, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Alpha Module", order=0, goals=[server.GoalIn(name="AlphaSkill")])],
    ), admin))
    prog_b = run(server.create_program(server.ProgramIn(
        name=f"{TAG} ProgB {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 1, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Beta Module", order=0, goals=[server.GoalIn(name="BetaSkill")])],
    ), admin))
    enr_a = run(server.enroll_dog(did, server.EnrollIn(program_id=prog_a["id"]), admin))
    log_a_id = _run_session(did, enr_a["id"], admin, "remain")
    run(server.db.dog_programs.update_one({"id": enr_a["id"]}, {"$set": {"status": "completed"}}))
    enr_b = run(server.enroll_dog(did, server.EnrollIn(program_id=prog_b["id"]), admin))
    log_b_id = _run_session(did, enr_b["id"], admin, "remain")
    try:
        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/session-recaps?limit=50", headers=h)
        assert r.status_code == 200, r.text
        recaps = {x["at"]: x for x in r.json() if x["dog_id"] == did}
        log_a = run(server.db.training_session_log.find_one({"id": log_a_id}, {"_id": 0}))
        log_b = run(server.db.training_session_log.find_one({"id": log_b_id}, {"_id": 0}))
        assert recaps[log_a["at"]]["module_name"] == "Alpha Module"
        assert recaps[log_b["at"]]["module_name"] == "Beta Module"
    finally:
        run(server.db.training_session_log.delete_many({"enrollment_id": {"$in": [enr_a["id"], enr_b["id"]]}}))
        run(server.db.training_session_drafts.delete_many({"enrollment_id": {"$in": [enr_a["id"], enr_b["id"]]}}))
        run(server.db.bookings.delete_many({"dog_id": did}))
        run(server.db.dog_programs.delete_many({"id": {"$in": [enr_a["id"], enr_b["id"]]}}))
        run(server.db.programs.delete_many({"id": {"$in": [prog_a["id"], prog_b["id"]]}}))
        run(server.db.users.delete_one({"id": user_id}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def test_portal_session_recaps_never_includes_internal_session_note():
    """session_note is the internal/staff note; client_recap_note is the
    only text meant for the client. trainer_name/module_name are the new
    additive fields — both derived from data already stored on the log."""
    with _client_dog_program() as (c, dog, prog, enr, sit_id, admin, user_id):
        booking = run(server.create_booking(server.BookingIn(
            dog_id=dog["id"], service_type="training", date=date.today().isoformat(), override_capacity=True,
        ), admin))
        started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "safety-check", admin))
        draft_id = started["draft"]["id"]
        activities = started["draft"]["plan"]["activities"]
        sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
        run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(
            actuals={sit_activity["id"]: server.SessionActivityActualIn(score=5)},
            session_note="INTERNAL-STAFF-ONLY-NOTE-XYZ",
            client_recap_note="Great session today!",
        ), admin))
        run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="remain"), admin))

        token = server.create_access_token(user_id, c["email"], "client", 0)
        h = {"Authorization": f"Bearer {token}"}
        r = client.get("/api/portal/session-recaps", headers=h)
        assert r.status_code == 200, r.text
        assert "INTERNAL-STAFF-ONLY-NOTE-XYZ" not in r.text
        recap = next(x for x in r.json() if x["dog_id"] == dog["id"])
        assert recap["recap_note"] == "Great session today!"
        assert recap["trainer_name"] == admin["name"]
        assert recap["module_name"] == "Week 1"
        run(server.db.bookings.delete_one({"id": booking["id"]}))
        run(server.db.training_session_drafts.delete_many({"enrollment_id": enr["id"]}))
        run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
