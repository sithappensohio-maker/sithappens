"""Training-school expansion, Phase 1 — additive curriculum model changes:

  * GoalIn gains optional skill-measurement fields (a "goal" now doubles as
    a "skill" — no new collection, no new id space).
  * ModuleIn gains an optional `lessons: List[LessonIn]` layer. A lesson
    never owns progress or duplicates the goal list — it only references
    existing goal ids via `skill_ids`, so goal_progress/completion/
    homework-engine logic (all keyed on goal id) is completely untouched
    whether or not lessons are used.
  * `_effective_lessons(module)` gives lesson-aware readers a single
    default lesson wrapping a legacy module's goals, so old modules-as-
    weeks behave like a one-lesson module instead of an empty one.
  * A new `manage_training_sessions` permission, separate from
    `manage_training_content`, now gates the actual session-running
    endpoints (training-context, training-session, goal updates,
    current-module, session-log) instead of the old blanket
    `require_admin` — closing the gap where a trainer with
    manage_training_content could edit curriculum but was 403'd from
    actually running a session.

Same fixture/cleanup convention as test_shared_credit_mutation_service.py /
test_unbacked_credit_balance_fix.py: loose ad-hoc test file, disposable
Mongo DB via _test_env.py, `run()` sync wrapper from _test_loop.py.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CURRICULUM_PHASE1"

# NOT starlette's TestClient — it runs the ASGI app in its own background
# thread with its own event loop, which collides with Motor (already bound
# to _test_loop's shared loop — see that module's docstring) and blows up
# with "attached to a different loop". httpx.AsyncClient over ASGITransport
# stays on whichever loop calls it, so driving it through the shared `run()`
# wrapper keeps every DB call on the one loop Motor is bound to.
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
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


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


def _make_legacy_program_in(name):
    """The exact shape a pre-Phase-1 client would have sent — no `lessons`
    key at all on either module."""
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit"), server.GoalIn(name="Down"),
            ]),
            server.ModuleIn(name="Week 2", order=1, goals=[
                server.GoalIn(name="Heel"),
            ]),
        ],
    )


@contextlib.contextmanager
def _program(program_in):
    admin = _admin_user()
    prog = run(server.create_program(program_in, admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


# ---------------------------------------------------------------------------
# Legacy compatibility — nothing about existing modules/goals changes
# ---------------------------------------------------------------------------

def test_legacy_program_with_no_lessons_field_stores_empty_lessons_list_and_keeps_goal_ids():
    with _program(_make_legacy_program_in(f"{TAG} Legacy")) as (prog, admin):
        assert prog["modules"][0]["lessons"] == []
        assert prog["modules"][1]["lessons"] == []
        # Goals are unaffected — same shape as before, ids stamped, new
        # optional skill fields present but None.
        sit = prog["modules"][0]["goals"][0]
        assert sit["name"] == "Sit"
        assert sit["id"]
        assert sit["training_objective"] is None
        assert sit["prerequisite_skill_ids"] == []


def test_legacy_program_still_enrolls_and_scores_exactly_as_before():
    with _program(_make_legacy_program_in(f"{TAG} Legacy Enroll")) as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                ctx = run(server.get_training_context_direct(dog["id"], enr["id"], admin))
                assert ctx["has_program"] is True
                assert len(ctx["goals"]) == 2
                sit_id = ctx["goals"][0]["id"]
                updated = run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=5), admin))
                assert updated  # no exception — same code path as pre-Phase-1
                listing = run(server.list_dog_enrollments(dog["id"], admin))
                e = next(x for x in listing if x["id"] == enr["id"])
                assert e["goal_progress"][sit_id]["status"] == "mastered"
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_effective_lessons_synthesizes_one_default_lesson_for_a_legacy_module():
    module = {"id": "mod-1", "goals": [{"id": "g1"}, {"id": "g2"}], "lessons": []}
    lessons = server._effective_lessons(module)
    assert len(lessons) == 1
    assert lessons[0]["id"] == "default-lesson-mod-1"
    assert lessons[0]["skill_ids"] == ["g1", "g2"]
    assert lessons[0]["active"] is True


def test_effective_lessons_returns_real_lessons_untouched_when_present():
    module = {
        "id": "mod-1", "goals": [{"id": "g1"}, {"id": "g2"}],
        "lessons": [{"id": "lesson-a", "name": "Real Lesson", "skill_ids": ["g1"], "active": True, "order": 0,
                     "suggested_homework_template_ids": []}],
    }
    lessons = server._effective_lessons(module)
    assert len(lessons) == 1
    assert lessons[0]["id"] == "lesson-a"


def test_effective_lessons_empty_module_returns_empty_list():
    assert server._effective_lessons({"id": "mod-1", "goals": [], "lessons": []}) == []


# ---------------------------------------------------------------------------
# New Lesson layer — create/update/duplicate round-trips
# ---------------------------------------------------------------------------

def _program_with_lesson_in(name):
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit", pass_criteria="Holds 10s"), server.GoalIn(name="Down"),
            ], lessons=[
                server.LessonIn(name="Lesson 1: Sit", order=0, skill_ids=["__SIT__", "bogus-id-not-a-real-goal"]),
            ]),
        ],
    )


def test_creating_a_program_with_a_lesson_stamps_ids_and_drops_bogus_skill_refs():
    body = _program_with_lesson_in(f"{TAG} With Lesson")
    admin = _admin_user()
    prog = run(server.create_program(body, admin))
    try:
        module = prog["modules"][0]
        sit_id = next(g["id"] for g in module["goals"] if g["name"] == "Sit")
        assert len(module["lessons"]) == 1
        lesson = module["lessons"][0]
        assert lesson["id"]
        assert lesson["name"] == "Lesson 1: Sit"
        # "__SIT__" was a placeholder that never matched a real stamped goal
        # id, and the bogus id never matched either — both must be dropped,
        # never silently kept pointing at nothing.
        assert lesson["skill_ids"] == []
        assert sit_id  # sanity: the goal itself still exists correctly
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_updating_a_program_can_wire_a_lesson_to_real_goal_ids():
    with _program(_make_legacy_program_in(f"{TAG} Update Lesson")) as (prog, admin):
        sit_id = prog["modules"][0]["goals"][0]["id"]
        down_id = prog["modules"][0]["goals"][1]["id"]
        update_body = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=50,
            modules=[
                server.ModuleIn(id=prog["modules"][0]["id"], name="Week 1", order=0, goals=[
                    server.GoalIn(id=sit_id, name="Sit"), server.GoalIn(id=down_id, name="Down"),
                ], lessons=[
                    server.LessonIn(name="Lesson 1", order=0, skill_ids=[sit_id, down_id]),
                ]),
                server.ModuleIn(**prog["modules"][1]),
            ],
        )
        updated = run(server.update_program(prog["id"], update_body, cascade=False, save_as_draft=False, _=admin))
        lesson = updated["modules"][0]["lessons"][0]
        assert sorted(lesson["skill_ids"]) == sorted([sit_id, down_id])


def test_duplicate_program_remaps_lesson_skill_ids_to_new_goal_ids_and_never_shares_ids():
    body = _program_with_lesson_in(f"{TAG} Dup Source")
    # Fix the placeholder up front so the source program itself has a real,
    # working lesson->skill link to duplicate.
    admin = _admin_user()
    prog = run(server.create_program(body, admin))
    sit_id = next(g["id"] for g in prog["modules"][0]["goals"] if g["name"] == "Sit")
    fixed = server.ProgramIn(
        name=prog["name"], type="private_lessons", format=prog["format"], price=50,
        modules=[server.ModuleIn(
            id=prog["modules"][0]["id"], name="Week 1", order=0,
            goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]],
            lessons=[server.LessonIn(name="Lesson 1: Sit", order=0, skill_ids=[sit_id])],
        )],
    )
    prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
    try:
        dup = run(server.duplicate_program(prog["id"], admin))
        try:
            src_goal_ids = {g["id"] for g in prog["modules"][0]["goals"]}
            dup_goal_ids = {g["id"] for g in dup["modules"][0]["goals"]}
            assert src_goal_ids.isdisjoint(dup_goal_ids)
            src_lesson_ids = {l["id"] for l in prog["modules"][0]["lessons"]}
            dup_lesson_ids = {l["id"] for l in dup["modules"][0]["lessons"]}
            assert src_lesson_ids.isdisjoint(dup_lesson_ids)
            dup_sit_id = next(g["id"] for g in dup["modules"][0]["goals"] if g["name"] == "Sit")
            assert dup["modules"][0]["lessons"][0]["skill_ids"] == [dup_sit_id]
        finally:
            run(server.db.programs.delete_one({"id": dup["id"]}))
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


# ---------------------------------------------------------------------------
# manage_training_sessions permission — real HTTP + dependency-injection
# ---------------------------------------------------------------------------

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


def test_trainer_can_reach_training_context_and_run_a_session_front_desk_cannot():
    """Gap-closing pass — 'run a session' now means the supported draft/
    complete pipeline (record_training_session was retired as a second,
    independently-writing bypass of that same pipeline), not the old
    direct-write endpoint."""
    with _program(_make_legacy_program_in(f"{TAG} Perm")) as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            draft_id = None
            try:
                r_ctx_trainer = client.get(f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-context", headers=trainer_h)
                assert r_ctx_trainer.status_code == 200, r_ctx_trainer.text
                assert r_ctx_trainer.json()["has_program"] is True

                r_ctx_fd = client.get(f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-context", headers=fd_h)
                assert r_ctx_fd.status_code == 403, r_ctx_fd.text

                goal_id = r_ctx_trainer.json()["goals"][0]["id"]

                r_draft_fd = client.post(f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-session/draft", headers=fd_h)
                assert r_draft_fd.status_code == 403, r_draft_fd.text

                r_draft_trainer = client.post(f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-session/draft", headers=trainer_h)
                assert r_draft_trainer.status_code == 200, r_draft_trainer.text
                draft_id = r_draft_trainer.json()["draft"]["id"]
                activities = r_draft_trainer.json()["draft"]["plan"]["activities"]
                activity_id = next(a["id"] for a in activities if a.get("skill_id") == goal_id)

                r_update_fd = client.put(
                    f"/api/training-session-drafts/{draft_id}", headers=fd_h,
                    json={"actuals": {activity_id: {"score": 3}}},
                )
                assert r_update_fd.status_code == 403, r_update_fd.text

                r_update_trainer = client.put(
                    f"/api/training-session-drafts/{draft_id}", headers=trainer_h,
                    json={"actuals": {activity_id: {"score": 3}}},
                )
                assert r_update_trainer.status_code == 200, r_update_trainer.text

                r_complete_fd = client.post(f"/api/training-session-drafts/{draft_id}/complete", headers=fd_h, json={})
                assert r_complete_fd.status_code == 403, r_complete_fd.text

                r_complete_trainer = client.post(f"/api/training-session-drafts/{draft_id}/complete", headers=trainer_h, json={})
                assert r_complete_trainer.status_code == 200, r_complete_trainer.text

                r_goal_fd = client.put(
                    f"/api/dogs/{dog['id']}/programs/{enr['id']}/goals/{goal_id}",
                    headers=fd_h, json={"score": 4},
                )
                assert r_goal_fd.status_code == 403, r_goal_fd.text
            finally:
                if draft_id:
                    run(server.db.training_session_drafts.delete_one({"id": draft_id}))
                run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))


def test_owner_admin_unaffected_by_the_new_permission_gate():
    with _program(_make_legacy_program_in(f"{TAG} Perm Owner")) as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            owner_uid = str(uuid.uuid4())
            owner_email = f"{TAG.lower()}-owner-{uuid.uuid4().hex[:6]}@example.invalid"
            run(server.db.users.insert_one({
                "id": owner_uid, "email": owner_email, "name": f"{TAG} owner",
                "role": "admin", "staff_role": None,
                "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
            }))
            token = server.create_access_token(owner_uid, owner_email, "admin", 0)
            headers = {"Authorization": f"Bearer {token}"}
            try:
                r = client.get(f"/api/dogs/{dog['id']}/programs/{enr['id']}/training-context", headers=headers)
                assert r.status_code == 200, r.text
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_one({"id": owner_uid}))


def test_manage_training_sessions_permission_key_exists_and_is_role_scoped():
    assert "manage_training_sessions" in server.PERMISSION_KEYS
    assert server.ROLE_PERMISSIONS["trainer"]["manage_training_sessions"] is True
    assert server.ROLE_PERMISSIONS["front_desk"]["manage_training_sessions"] is False
    assert server.ROLE_PERMISSIONS["daycare_staff"]["manage_training_sessions"] is False


# ---------------------------------------------------------------------------
# UI Phase 5 — Program Studio's write endpoints stay 403'd server-side for
# anyone without manage_training_content, matching the frontend's own hidden
# entry points (Programs.jsx's New/Edit/Archive buttons) — this is the
# server-side half of that same guarantee, independent of the UI.
# ---------------------------------------------------------------------------

def test_program_studio_write_endpoints_403_without_manage_training_content():
    front_desk_uid, fd_h = _insert_staff("front_desk")
    trainer_uid, trainer_h = _insert_staff("trainer")
    try:
        body = {
            "name": f"{TAG} Denied Program {uuid.uuid4().hex[:6]}", "type": "private_lessons",
            "format": {"count": 1, "unit": "sessions"}, "price": 10, "modules": [],
        }
        r_fd_create = client.post("/api/programs", headers=fd_h, json=body)
        assert r_fd_create.status_code == 403

        r_trainer_create = client.post("/api/programs", headers=trainer_h, json=body)
        assert r_trainer_create.status_code == 200, r_trainer_create.text
        prog = r_trainer_create.json()
        try:
            r_fd_update = client.put(f"/api/programs/{prog['id']}", headers=fd_h, json=body)
            assert r_fd_update.status_code == 403

            r_fd_draft = client.put(f"/api/programs/{prog['id']}?save_as_draft=true", headers=fd_h, json=body)
            assert r_fd_draft.status_code == 403

            r_fd_delete = run(_http.delete(f"/api/programs/{prog['id']}", headers=fd_h))
            assert r_fd_delete.status_code == 403
        finally:
            run(server.db.programs.delete_one({"id": prog["id"]}))
    finally:
        run(server.db.users.delete_many({"id": {"$in": [front_desk_uid, trainer_uid]}}))
