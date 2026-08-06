"""Training-school expansion, Phase 2 (backend half) — Program Studio's
draft/publish/validate/impact-preview endpoints.

  * PUT /programs/{id}?save_as_draft=true never touches the live program
    fields, never affects a new enrollment created afterward, and never
    triggers cascade (a draft can't affect anything by definition).
  * POST /programs/{id}/publish applies the saved draft to the live fields
    and clears it; `cascade` behaves like update_program's existing cascade
    (goal_progress preserved for surviving goal ids, dropped for removed
    ones); publish is blocked (422) by any hard validation ERROR and the
    draft is left intact so the admin can fix and retry.
  * GET /programs/{id}/validate classifies genuinely broken references
    (prerequisites/next-skill/homework-template ids pointing at nothing) as
    errors, and everything else (empty modules, missing instructions,
    order ties, inactive-but-existing homework templates) as warnings only.
  * GET /programs/{id}/publish-impact is read-only and reports accurate
    added/removed/preserved/orphaned counts.

Same fixture/cleanup convention as test_curriculum_lessons_phase1.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_PROGRAM_STUDIO"


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


def _base_program_in(name):
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
def _program():
    admin = _admin_user()
    prog = run(server.create_program(_base_program_in(f"{TAG} {uuid.uuid4().hex[:6]}"), admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _reload(program_id):
    return run(server.db.programs.find_one({"id": program_id}, {"_id": 0}))


# ---------------------------------------------------------------------------
# save_as_draft — never touches live state
# ---------------------------------------------------------------------------

def test_draft_save_does_not_touch_live_program_fields():
    with _program() as (prog, admin):
        draft_body = server.ProgramIn(
            name="Renamed In Draft", type="private_lessons", format=prog["format"], price=999,
            modules=[server.ModuleIn(name="Draft-only module", order=0, goals=[server.GoalIn(name="New skill")])],
        )
        result = run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        assert result["name"] == prog["name"]  # live name unchanged in the response
        assert result["price"] == prog["price"]
        assert result["draft"]["name"] == "Renamed In Draft"
        assert result["draft"]["price"] == 999

        live = _reload(prog["id"])
        assert live["name"] == prog["name"]
        assert live["price"] == prog["price"]
        assert len(live["modules"]) == 2  # still the original two modules
        assert live["draft"]["name"] == "Renamed In Draft"


def test_draft_save_never_reaches_a_newly_enrolled_dog():
    with _program() as (prog, admin):
        draft_body = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
            modules=[server.ModuleIn(name="Draft-only module", order=0, goals=[server.GoalIn(name="Draft skill")])],
        )
        run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                names = {m["name"] for m in enr["program_snapshot"]["modules"]}
                assert names == {"Week 1", "Week 2"}
                assert "Draft-only module" not in names
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_draft_save_ignores_cascade_flag():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                draft_body = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
                    modules=[server.ModuleIn(name="Solo module", order=0, goals=[server.GoalIn(name="X")])],
                )
                run(server.update_program(prog["id"], draft_body, cascade=True, save_as_draft=True, _=admin))
                unchanged = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                names = {m["name"] for m in unchanged["program_snapshot"]["modules"]}
                assert names == {"Week 1", "Week 2"}
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


# ---------------------------------------------------------------------------
# publish — applies draft, clears it, respects cascade
# ---------------------------------------------------------------------------

def test_publish_applies_draft_to_live_and_clears_it():
    with _program() as (prog, admin):
        draft_body = server.ProgramIn(
            name="Published Name", type="private_lessons", format=prog["format"], price=123,
            modules=[server.ModuleIn(name="Only module", order=0, goals=[server.GoalIn(name="Only skill")])],
        )
        run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        published = run(server.publish_program(prog["id"], cascade=False, _=admin))
        assert published["name"] == "Published Name"
        assert published["price"] == 123
        assert "draft" not in published or published["draft"] is None
        live = _reload(prog["id"])
        assert live["name"] == "Published Name"
        assert live.get("draft") is None


def test_publish_without_cascade_leaves_active_enrollment_snapshot_untouched():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                draft_body = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
                    modules=[server.ModuleIn(name="New Only Module", order=0, goals=[server.GoalIn(name="New")])],
                )
                run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
                run(server.publish_program(prog["id"], cascade=False, _=admin))
                unchanged = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                names = {m["name"] for m in unchanged["program_snapshot"]["modules"]}
                assert names == {"Week 1", "Week 2"}  # snapshot untouched — cascade was not requested
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_publish_with_cascade_preserves_surviving_progress_and_drops_removed():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                ctx = run(server.get_training_context_direct(dog["id"], enr["id"], admin))
                sit_id = ctx["goals"][0]["id"]  # "Sit" — kept in the draft below
                down_id = ctx["goals"][1]["id"]  # "Down" — removed in the draft below
                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=3), admin))
                run(server.update_goal(dog["id"], enr["id"], down_id, server.GoalUpdate(score=2), admin))

                draft_body = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
                    modules=[
                        server.ModuleIn(id=prog["modules"][0]["id"], name="Week 1", order=0, goals=[
                            server.GoalIn(id=sit_id, name="Sit"),  # Down dropped entirely
                        ]),
                        server.ModuleIn(**prog["modules"][1]),
                    ],
                )
                run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
                run(server.publish_program(prog["id"], cascade=True, _=admin))

                updated = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                gp = updated["goal_progress"]
                assert sit_id in gp and gp[sit_id]["score"] == 3  # preserved
                assert down_id not in gp  # dropped — no longer in the published curriculum
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_publish_with_no_draft_saved_returns_404():
    with _program() as (prog, admin):
        try:
            run(server.publish_program(prog["id"], cascade=False, _=admin))
            assert False, "expected an HTTPException"
        except server.HTTPException as e:
            assert e.status_code == 404


def test_publish_blocked_by_structural_error_leaves_live_and_draft_untouched():
    with _program() as (prog, admin):
        draft_body = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
            modules=[server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit", prerequisite_skill_ids=["does-not-exist-anywhere"]),
            ])],
        )
        run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        try:
            run(server.publish_program(prog["id"], cascade=False, _=admin))
            assert False, "expected a 422"
        except server.HTTPException as e:
            assert e.status_code == 422
            assert any(err["code"] == "broken_prerequisite" for err in e.detail["errors"])

        live = _reload(prog["id"])
        assert live["name"] == prog["name"]  # live never touched
        assert live["draft"] is not None  # draft preserved so the admin can fix and retry


# ---------------------------------------------------------------------------
# validate — errors vs warnings classification
# ---------------------------------------------------------------------------

def test_validate_classifies_broken_prerequisite_as_error():
    modules = [{"id": "m1", "name": "M1", "goals": [
        {"id": "g1", "name": "Sit", "prerequisite_skill_ids": ["nonexistent"], "homework_template_ids": []},
    ], "lessons": []}]
    result = run(server._validate_program_structure(modules))
    assert result["valid"] is False
    assert any(e["code"] == "broken_prerequisite" for e in result["errors"])


def test_validate_classifies_broken_homework_template_ref_as_error():
    modules = [{"id": "m1", "name": "M1", "goals": [
        {"id": "g1", "name": "Sit", "prerequisite_skill_ids": [], "homework_template_ids": ["nonexistent-template"]},
    ], "lessons": []}]
    result = run(server._validate_program_structure(modules))
    assert result["valid"] is False
    assert any(e["code"] == "broken_homework_ref" for e in result["errors"])


def test_validate_classifies_empty_module_and_order_ties_as_warnings_only():
    modules = [
        {"id": "m1", "name": "Empty Module", "goals": [], "lessons": []},
        {"id": "m2", "name": "Tied Orders", "goals": [
            {"id": "g1", "name": "A", "order": 0, "prerequisite_skill_ids": [], "homework_template_ids": []},
            {"id": "g2", "name": "B", "order": 0, "prerequisite_skill_ids": [], "homework_template_ids": []},
        ], "lessons": []},
    ]
    result = run(server._validate_program_structure(modules))
    assert result["valid"] is True  # no errors — legacy-shaped ties/empties must never block publish
    codes = {w["code"] for w in result["warnings"]}
    assert "empty_module" in codes
    assert "duplicate_order" in codes


def test_validate_classifies_inactive_homework_template_as_warning_not_error():
    admin = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-inactive-{uuid.uuid4().hex[:6]}", name="Inactive tpl", tier="foundation",
    ), admin))
    run(server.db.homework_templates.update_one({"id": tpl["id"]}, {"$set": {"active": False}}))
    try:
        modules = [{"id": "m1", "name": "M1", "goals": [
            {"id": "g1", "name": "Sit", "prerequisite_skill_ids": [], "homework_template_ids": [tpl["id"]]},
        ], "lessons": []}]
        result = run(server._validate_program_structure(modules))
        assert result["valid"] is True
        assert any(w["code"] == "inactive_homework_ref" for w in result["warnings"])
        assert not any(e["code"] == "broken_homework_ref" for e in result["errors"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_validate_endpoint_targets_live_or_draft():
    with _program() as (prog, admin):
        live_result = run(server.validate_program(prog["id"], target="live", _=admin))
        assert live_result["valid"] is True

        draft_body = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
            modules=[server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit", suggested_next_skill_id="ghost-skill"),
            ])],
        )
        run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        draft_result = run(server.validate_program(prog["id"], target="draft", _=admin))
        assert draft_result["valid"] is False
        assert any(e["code"] == "broken_next_skill" for e in draft_result["errors"])
        # Live is still clean — the draft's problem hasn't leaked into it.
        assert run(server.validate_program(prog["id"], target="live", _=admin))["valid"] is True


# ---------------------------------------------------------------------------
# publish-impact — read-only, accurate counts
# ---------------------------------------------------------------------------

def test_publish_impact_reports_accurate_counts_and_writes_nothing():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                ctx = run(server.get_training_context_direct(dog["id"], enr["id"], admin))
                sit_id = ctx["goals"][0]["id"]
                down_id = ctx["goals"][1]["id"]
                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=3), admin))
                run(server.update_goal(dog["id"], enr["id"], down_id, server.GoalUpdate(score=2), admin))

                draft_body = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=prog["price"],
                    modules=[
                        server.ModuleIn(id=prog["modules"][0]["id"], name="Week 1", order=0, goals=[
                            server.GoalIn(id=sit_id, name="Sit"),
                            server.GoalIn(name="Brand New Skill"),  # added
                        ]),  # Down removed
                        server.ModuleIn(**prog["modules"][1]),
                    ],
                )
                run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))

                impact1 = run(server.program_publish_impact(prog["id"], _=admin))
                impact2 = run(server.program_publish_impact(prog["id"], _=admin))
                assert impact1 == impact2  # read-only — calling twice is idempotent

                assert impact1["enrollments_affected"] == 1
                assert impact1["skills_added"] == 1  # "Brand New Skill"
                assert impact1["skills_removed"] == 1  # "Down"
                assert impact1["progress_entries_preserved"] == 2  # Sit + Heel (Heel's untouched progress entry survives too)
                assert impact1["progress_entries_orphaned"] == 1  # Down
                assert impact1["validation"]["valid"] is True

                # Genuinely read-only: live program + enrollment untouched.
                live = _reload(prog["id"])
                assert len(live["modules"][0]["goals"]) == 2
                unchanged_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert down_id in unchanged_enr["goal_progress"]
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_discard_draft_clears_it_without_touching_live():
    with _program() as (prog, admin):
        draft_body = server.ProgramIn(
            name="Discard Me", type="private_lessons", format=prog["format"], price=prog["price"],
            modules=[server.ModuleIn(name="Draft module", order=0, goals=[server.GoalIn(name="X")])],
        )
        run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
        assert _reload(prog["id"])["draft"] is not None
        result = run(server.discard_program_draft(prog["id"], admin))
        assert result == {"ok": True}
        live = _reload(prog["id"])
        assert live.get("draft") is None
        assert live["name"] == prog["name"]  # live untouched throughout


def test_publish_impact_with_no_draft_returns_404():
    with _program() as (prog, admin):
        try:
            run(server.program_publish_impact(prog["id"], _=admin))
            assert False, "expected an HTTPException"
        except server.HTTPException as e:
            assert e.status_code == 404
