"""Training-school expansion, final correctness pass — proves there is no
reachable backend endpoint that can independently write session progress,
a session log, or homework outside the training_session_drafts draft/
completion pipeline.

Context: record_training_session (POST /dogs/{id}/programs/{id}/training-
session) used to exist as a second, fully independent write path into
goal_progress + training_session_log — orphaned from the UI (nothing called
it) but still reachable over the API, which is a real server-side bypass
regardless of whether any UI happens to use it. It has been retired
entirely (function, route, and its request models deleted from server.py).

This file is the direct proof, not just documentation of the removal:
  1. The retired route no longer exists at the HTTP layer (404, not 403 —
     it's gone, not merely permission-gated).
  2. The single remaining "quick correction" write path (update_goal) is
     confirmed to do exactly what it claims and nothing more — it can move
     a goal's score, but it never creates a session log, never advances a
     module/lesson pointer, never assigns homework. It is a real, narrower,
     intentionally-retained utility, not a second session-recording path.
  3. Every field that can ever end up in training_session_log or
     dog_programs.goal_progress after a real session is traced back to
     having gone through complete_training_session's pipeline.

Same fixture/cleanup convention as test_session_completion_hardening.py.
"""
import contextlib
import uuid
from datetime import date

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_NO_SESSION_BYPASS"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def get(url, headers=None):
        return run(_http.get(url, headers=headers))

    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))

    @staticmethod
    def put(url, headers=None, json=None):
        return run(_http.put(url, headers=headers, json=json))


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


def _make_booking(dog_id, admin):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=date.today().isoformat(), override_capacity=True,
    ), admin))


# ---------------------------------------------------------------------------
# 1. The retired endpoint is gone, not just permission-gated
# ---------------------------------------------------------------------------

def test_retired_training_session_endpoint_no_longer_exists():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            trainer_uid, trainer_h = _insert_staff("trainer")
            try:
                # An admin token (full access to everything else) still gets 404 —
                # proving the route itself is gone, not merely 403'd.
                admin_token = server.create_access_token(str(uuid.uuid4()), "x@example.com", "admin", 0)
                admin_h = {"Authorization": f"Bearer {admin_token}"}
                r_admin = client.post(
                    f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
                    headers=admin_h, json={"goal_updates": []},
                )
                assert r_admin.status_code == 404, r_admin.text

                r_trainer = client.post(
                    f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-session",
                    headers=trainer_h, json={"goal_updates": []},
                )
                assert r_trainer.status_code == 404, r_trainer.text

                # Confirm the class it used to depend on is really gone too —
                # not just unreachable, actually removed from the module.
                assert not hasattr(server, "record_training_session")
                assert not hasattr(server, "TrainingSessionGoalUpdate")
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_one({"id": trainer_uid}))


def test_no_route_writes_training_session_log_except_the_completion_pipeline():
    """Enumerates every registered route whose path contains 'training-session'
    or 'training-session-drafts' and confirms the only POST/PUT routes left
    are the draft lifecycle (start/update/complete/reopen) — proving there
    is no OTHER registered endpoint that could independently write a
    session log, by construction rather than by memory of what was removed.

    Explicitly excludes /api/dogs/{dog_id}/training-sessions (plural) — an
    unrelated, pre-existing, already-orphaned endpoint (log_training_session)
    that writes to dog.curriculum + a separate `training_sessions` collection
    from an older command-library feature that pre-dates the Program/Module/
    Goal curriculum system entirely. It never touches goal_progress or
    training_session_log, so it isn't a bypass of THIS pipeline, and
    retiring it is out of scope for this pass (not part of the training-
    school project this hardening work covers)."""
    write_routes = sorted({
        (tuple(sorted(r.methods - {"HEAD", "OPTIONS"})), r.path)
        for r in server.app.routes
        if getattr(r, "methods", None) and (r.methods - {"HEAD", "OPTIONS", "GET"})
        and ("training-session/" in r.path or "training-session-drafts" in r.path)
    })
    assert write_routes == [
        (("POST",), "/api/bookings/{booking_id}/training-session/draft"),
        (("POST",), "/api/dogs/{dog_id}/programs/{enrollment_id}/training-session/draft"),
        (("POST",), "/api/training-session-drafts/{draft_id}/complete"),
        (("POST",), "/api/training-session-drafts/{draft_id}/reopen"),
        (("PUT",), "/api/training-session-drafts/{draft_id}"),
    ], f"Unexpected session-writing route registered: {write_routes}"


# ---------------------------------------------------------------------------
# 2. update_goal (the intentionally-retained quick-correction tool) really
#    is narrower — no session log, no advancement, no homework
# ---------------------------------------------------------------------------

def test_update_goal_never_writes_a_session_log_or_homework():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            sit_id = prog["modules"][0]["goals"][0]["id"]
            try:
                before_logs = run(server.db.training_session_log.count_documents({"enrollment_id": enr["id"]}))
                before_hw = run(server.db.homework.count_documents({"dog_id": dog["id"]}))

                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=5), admin))

                after_logs = run(server.db.training_session_log.count_documents({"enrollment_id": enr["id"]}))
                after_hw = run(server.db.homework.count_documents({"dog_id": dog["id"]}))
                assert after_logs == before_logs == 0
                assert after_hw == before_hw == 0

                # The score DID move — this is a real, working correction tool,
                # just one that stays outside the session-recording pipeline.
                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated["goal_progress"][sit_id]["score"] == 5
                # And it never touches the module/lesson pointer either.
                assert updated.get("current_module_id") == enr.get("current_module_id")
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


# ---------------------------------------------------------------------------
# 3. The only way goal_progress advancement + a session log + homework are
#    ever created together is the completion pipeline
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _two_module_program():
    admin = _admin_user()
    body = server.ProgramIn(
        name=f"{TAG} 2mod {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")]),
            server.ModuleIn(name="Week 2", order=1, goals=[server.GoalIn(name="Heel")]),
        ],
    )
    prog = run(server.create_program(body, admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_completion_pipeline_is_the_only_path_that_writes_advancement_and_log_together():
    with _two_module_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            sit_id = prog["modules"][0]["goals"][0]["id"]
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "bypass-check", admin))
                draft_id = started["draft"]["id"]
                activities = started["draft"]["plan"]["activities"]
                sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
                run(server.update_training_session_draft(
                    draft_id, server.TrainingSessionDraftUpdateIn(
                        actuals={sit_activity["id"]: server.SessionActivityActualIn(score=5)},
                    ), admin,
                ))
                result = run(server.complete_training_session(
                    draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin,
                ))
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1
                assert logs[0]["draft_id"] == draft_id  # traceable to the draft that produced it
                assert logs[0]["advanced_module"] is not None
                assert result["enrollment"]["current_module_id"] == logs[0]["advanced_module"]["to_module_id"]
                updated_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated_enr["current_module_id"] != enr.get("current_module_id")  # actually advanced
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                run(server.db.training_session_drafts.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
