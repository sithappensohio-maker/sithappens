"""Training-school expansion, Phase 3 — Training Session Workspace backend:
server-backed session drafts, check-in resolution logic, pre-session
overview, and the deterministic suggested plan.

  * A draft is keyed on (enrollment_id, occurrence_date, session_label) — a
    second start call for the same key resumes the existing draft rather
    than creating a new one, and a real concurrent race is guarded by a
    partial unique index (not just a happy-path find-then-insert).
  * Resolution reasons (no_active_enrollment, multiple_active_enrollments,
    no_current_module, no_lessons_in_module) are returned instead of
    silently picking one or 500ing.
  * manage_training_sessions gates every draft endpoint — front_desk (which
    can still check bookings in) is rejected from starting/reading/editing
    a session draft.

Same fixture/cleanup convention as test_curriculum_lessons_phase1.py /
test_program_studio_draft_publish.py.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date

TAG = "TEST_SESSION_WORKSPACE"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))

    @staticmethod
    def get(url, headers=None, params=None):
        return run(_http.get(url, headers=headers, params=params))

    @staticmethod
    def put(url, headers=None, json=None):
        return run(_http.put(url, headers=headers, json=json))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


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


def _make_program_in(name, modules=None):
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=modules if modules is not None else [
            server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit"), server.GoalIn(name="Down"),
            ]),
            server.ModuleIn(name="Week 2", order=1, goals=[server.GoalIn(name="Heel")]),
        ],
    )


@contextlib.contextmanager
def _program(modules=None):
    admin = _admin_user()
    prog = run(server.create_program(_make_program_in(f"{TAG} {uuid.uuid4().hex[:6]}", modules), admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _make_booking(dog_id, admin):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup_booking(booking_id):
    run(server.db.bookings.delete_one({"id": booking_id}))


def _cleanup_drafts(enrollment_id):
    run(server.db.training_session_drafts.delete_many({"enrollment_id": enrollment_id}))


# ---------------------------------------------------------------------------
# Draft creation / resumption
# ---------------------------------------------------------------------------

def test_draft_created_on_first_call_and_resumed_not_duplicated_on_second():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                r1 = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                assert r1["resolution"] == "ready"
                draft1_id = r1["draft"]["id"]

                r2 = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                assert r2["resolution"] == "ready"
                assert r2["draft"]["id"] == draft1_id  # resumed, not duplicated

                count = run(server.db.training_session_drafts.count_documents({"enrollment_id": enr["id"]}))
                assert count == 1
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_two_concurrent_starts_never_create_two_drafts():
    """Real concurrency guard, not just the happy find-then-insert path —
    the partial unique index is what actually prevents a race."""
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                async def _both():
                    import asyncio
                    return await asyncio.gather(
                        server.start_training_session_draft_for_booking(booking["id"], None, "", admin),
                        server.start_training_session_draft_for_booking(booking["id"], None, "", admin),
                    )
                r1, r2 = run(_both())
                assert r1["resolution"] == "ready" and r2["resolution"] == "ready"
                assert r1["draft"]["id"] == r2["draft"]["id"]
                count = run(server.db.training_session_drafts.count_documents({"enrollment_id": enr["id"]}))
                assert count == 1
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_draft_resumable_via_get_after_refresh():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                draft_id = started["draft"]["id"]
                fetched = run(server.get_training_session_draft(draft_id, admin))
                assert fetched["draft"]["id"] == draft_id
                assert fetched["overview"] is not None
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


# ---------------------------------------------------------------------------
# Resolution states
# ---------------------------------------------------------------------------

def test_no_active_enrollment_returns_resolution_not_500():
    with _client_and_dog() as (c, dog):
        booking = _make_booking(dog["id"], admin := _admin_user())
        try:
            r = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
            assert r["resolution"] == "no_active_enrollment"
        finally:
            _cleanup_booking(booking["id"])


def test_multiple_active_enrollments_returns_choices():
    with _program() as (prog_a, admin):
        with _program() as (prog_b, _):
            with _client_and_dog() as (c, dog):
                enr_a = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_a["id"]), admin))
                enr_b = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_b["id"]), admin))
                booking = _make_booking(dog["id"], admin)
                try:
                    r = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                    assert r["resolution"] == "multiple_active_enrollments"
                    ids = {ch["enrollment_id"] for ch in r["choices"]}
                    assert ids == {enr_a["id"], enr_b["id"]}

                    # Explicit choice resolves it cleanly.
                    r2 = run(server.start_training_session_draft_for_booking(booking["id"], enr_a["id"], "", admin))
                    assert r2["resolution"] == "ready"
                    assert r2["draft"]["enrollment_id"] == enr_a["id"]
                finally:
                    _cleanup_booking(booking["id"])
                    _cleanup_drafts(enr_a["id"])
                    _cleanup_drafts(enr_b["id"])
                    run(server.db.dog_programs.delete_many({"id": {"$in": [enr_a["id"], enr_b["id"]]}}))


def test_no_current_module_returns_resolution():
    with _program(modules=[]) as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                r = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                assert r["resolution"] == "no_current_module"
            finally:
                _cleanup_booking(booking["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_module_with_no_lessons_or_skills_returns_resolution():
    with _program(modules=[server.ModuleIn(name="Empty Week", order=0, goals=[])]) as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                r = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                assert r["resolution"] == "no_lessons_in_module"
                assert r["module_name"] == "Empty Week"
            finally:
                _cleanup_booking(booking["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_no_dog_on_booking_returns_resolution():
    admin = _admin_user()
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({"id": bid, "dog_id": None, "service_type": "training", "status": "approved"}))
    try:
        r = run(server.start_training_session_draft_for_booking(bid, None, "", admin))
        assert r["resolution"] == "no_dog_on_booking"
    finally:
        run(server.db.bookings.delete_one({"id": bid}))


def test_missing_booking_raises_404():
    admin = _admin_user()
    try:
        run(server.start_training_session_draft_for_booking("definitely-bogus-booking-id", None, "", admin))
        assert False, "expected 404"
    except server.HTTPException as e:
        assert e.status_code == 404


# ---------------------------------------------------------------------------
# Plan editing persists; completed drafts are immutable
# ---------------------------------------------------------------------------

def test_plan_edits_persist_and_reload_correctly():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                draft_id = started["draft"]["id"]
                original_activities = started["draft"]["plan"]["activities"]
                assert len(original_activities) >= 1

                # Trainer removes one activity, adds a custom one, reorders.
                new_plan = [
                    server.SessionActivityIn(**{**original_activities[0], "order": 1}),
                    server.SessionActivityIn(id=None, source="custom", name="Custom recall drill", order=0),
                ]
                updated = run(server.update_training_session_draft(
                    draft_id, server.TrainingSessionDraftUpdateIn(plan=new_plan, session_note="Great energy today"),
                    admin,
                ))
                assert len(updated["plan"]["activities"]) == 2
                assert updated["session_note"] == "Great energy today"

                reloaded = run(server.get_training_session_draft(draft_id, admin))
                assert len(reloaded["draft"]["plan"]["activities"]) == 2
                assert any(a["name"] == "Custom recall drill" for a in reloaded["draft"]["plan"]["activities"])
                assert reloaded["draft"]["session_note"] == "Great energy today"
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_recording_actuals_persists():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                draft_id = started["draft"]["id"]
                activity_id = started["draft"]["plan"]["activities"][0]["id"]
                updated = run(server.update_training_session_draft(
                    draft_id,
                    server.TrainingSessionDraftUpdateIn(actuals={
                        activity_id: server.SessionActivityActualIn(
                            score=3, outcome="improving", distraction_level="medium",
                            notes="Getting there", homework_eligible=True,
                        ),
                    }),
                    admin,
                ))
                assert updated["actuals"][activity_id]["score"] == 3
                assert updated["actuals"][activity_id]["outcome"] == "improving"
                assert updated["actuals"][activity_id]["homework_eligible"] is True
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_completed_draft_rejects_further_edits():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
                draft_id = started["draft"]["id"]
                run(server.db.training_session_drafts.update_one({"id": draft_id}, {"$set": {"status": "completed"}}))
                try:
                    run(server.update_training_session_draft(
                        draft_id, server.TrainingSessionDraftUpdateIn(session_note="too late"), admin,
                    ))
                    assert False, "expected 409"
                except server.HTTPException as e:
                    assert e.status_code == 409
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


# ---------------------------------------------------------------------------
# Permission enforcement — real HTTP + dependency injection
# ---------------------------------------------------------------------------

def test_trainer_can_start_draft_front_desk_cannot():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            try:
                r_fd = client.post(f"/api/bookings/{booking['id']}/training-session/draft", headers=fd_h)
                assert r_fd.status_code == 403, r_fd.text

                r_trainer = client.post(f"/api/bookings/{booking['id']}/training-session/draft", headers=trainer_h)
                assert r_trainer.status_code == 200, r_trainer.text
                assert r_trainer.json()["resolution"] == "ready"
                draft_id = r_trainer.json()["draft"]["id"]

                r_get_fd = client.get(f"/api/training-session-drafts/{draft_id}", headers=fd_h)
                assert r_get_fd.status_code == 403

                r_put_fd = client.put(f"/api/training-session-drafts/{draft_id}", headers=fd_h, json={"session_note": "nope"})
                assert r_put_fd.status_code == 403
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))


# ---------------------------------------------------------------------------
# Pre-session overview content
# ---------------------------------------------------------------------------

def test_pre_session_overview_includes_last_session_and_recommended_objectives():
    """Gap-closing pass — seeds the prior session via the SUPPORTED draft/
    complete pipeline (record_training_session was retired as a second,
    independently-writing bypass of that same pipeline) instead of a direct
    write, then proves the pre-session overview for a SECOND session
    correctly surfaces that history."""
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            ctx = run(server.get_training_context_direct(dog["id"], enr["id"], admin))
            sit_id = ctx["goals"][0]["id"]

            booking1 = _make_booking(dog["id"], admin)
            started1 = run(server.start_training_session_draft_for_booking(booking1["id"], enr["id"], "session-1", admin))
            draft1_id = started1["draft"]["id"]
            activities = started1["draft"]["plan"]["activities"]
            sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
            run(server.update_training_session_draft(
                draft1_id,
                server.TrainingSessionDraftUpdateIn(
                    actuals={sit_activity["id"]: server.SessionActivityActualIn(score=3, outcome="improving")},
                    session_note="Worked on Sit",
                ),
                admin,
            ))
            run(server.complete_training_session(draft1_id, server.SessionCompletionIn(), admin))

            booking2 = _make_booking(dog["id"], admin)
            try:
                started2 = run(server.start_training_session_draft_for_booking(booking2["id"], None, "session-2", admin))
                overview = started2["overview"]
                assert overview["last_session"] is not None
                assert overview["last_session"]["note"] == "Worked on Sit"
                assert any(s["skill_id"] == sit_id for s in overview["last_session"]["skills_worked"])
                assert len(overview["recommended_objectives"]) >= 1
            finally:
                _cleanup_booking(booking1["id"])
                _cleanup_booking(booking2["id"])
                _cleanup_drafts(enr["id"])
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
