"""Online School full-suite guards: course pathways + frozen School metadata.

These tests protect the production rules added after Phase 2B/2C:
- prerequisite references validate at authoring/publish time;
- per-dog prerequisite completion gates Online School enrollment and checkout;
- trainer-led completion satisfies the same course pathway;
- an Online School enrollment freezes onboarding/support/path metadata so later
  program edits never silently change what a paying student enrolled in.
"""
import uuid

import pytest

import _test_env  # noqa: F401
import server
from _test_loop import run
from test_online_school_phase4 import _admin_user, _client_and_dog

TAG = "TEST_SCHOOL_PATH"


def _program_body(name, slug, **kw):
    base = dict(
        name=name,
        slug=slug,
        type="private_lessons",
        format={"count": 1, "unit": "sessions"},
        price=100,
        active=True,
        available_online=True,
        delivery_mode="self_guided",
        purchase_fulfillment="online_school",
        modules=[server.ModuleIn(name="Module 1", goals=[server.GoalIn(name="Skill")])],
    )
    base.update(kw)
    return server.ProgramIn(**base)


def _delete_program(pid):
    run(server.db.programs.delete_one({"id": pid}))


def test_draft_validation_and_publish_reject_broken_prerequisite():
    admin = _admin_user()
    slug = f"{TAG.lower()}-{uuid.uuid4().hex[:8]}"
    prog = run(server.create_program(_program_body("Path Draft", slug), admin))
    try:
        draft = _program_body("Path Draft", slug, prereq_slugs=["definitely-missing-prerequisite"])
        run(server.update_program(prog["id"], draft, cascade=False, save_as_draft=True, _=admin))
        validation = run(server.validate_program(prog["id"], target="draft", _=admin))
        assert validation["valid"] is False
        assert any(e["code"] == "broken_program_prerequisite" for e in validation["errors"])
        with pytest.raises(server.HTTPException) as exc:
            run(server.publish_program(prog["id"], cascade=False, _=admin))
        assert exc.value.status_code == 422
    finally:
        _delete_program(prog["id"])


def test_circular_prerequisite_path_is_rejected_before_publish():
    admin = _admin_user()
    a_slug = f"{TAG.lower()}-a-{uuid.uuid4().hex[:6]}"
    b_slug = f"{TAG.lower()}-b-{uuid.uuid4().hex[:6]}"
    a = run(server.create_program(_program_body("Path A", a_slug), admin))
    b = run(server.create_program(_program_body("Path B", b_slug, prereq_slugs=[a_slug]), admin))
    try:
        run(server.update_program(
            a["id"], _program_body("Path A", a_slug, prereq_slugs=[b_slug]),
            cascade=False, save_as_draft=True, _=admin,
        ))
        validation = run(server.validate_program(a["id"], target="draft", _=admin))
        assert validation["valid"] is False
        assert any(e["code"] == "circular_program_prerequisite" for e in validation["errors"])
    finally:
        _delete_program(b["id"])
        _delete_program(a["id"])


def test_prerequisite_is_per_dog_and_trainer_led_completion_satisfies_it():
    admin = _admin_user()
    pre_slug = f"{TAG.lower()}-pre-{uuid.uuid4().hex[:6]}"
    adv_slug = f"{TAG.lower()}-adv-{uuid.uuid4().hex[:6]}"
    pre = run(server.create_program(_program_body("Foundations", pre_slug), admin))
    advanced = run(server.create_program(_program_body(
        "Advanced", adv_slug, prereq_slugs=[pre_slug],
        school_support={"trainer_checkpoints_included": 4, "trainer_assists_included": 1, "response_target_hours": 24},
        school_onboarding={"enabled": True, "require_baseline": True, "require_equipment_check": True},
        estimated_weeks=8,
        recommended_next_program_slugs=[],
    ), admin))
    school_id = enrollment_id = completed_dp_id = None
    try:
        with _client_and_dog() as (client_doc, dog):
            # No completion yet: canonical manual grant is blocked.
            with pytest.raises(server.HTTPException) as exc:
                run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=advanced["id"]), admin))
            assert exc.value.status_code == 422
            assert (exc.value.detail or {}).get("code") == "school_prerequisites_incomplete"

            # Authenticated checkout preflight is blocked BEFORE an order/payment.
            with pytest.raises(server.HTTPException) as checkout_exc:
                run(server._validate_shop_item_eligibility(client_doc, "training_program", advanced, 1, dog["id"]))
            assert checkout_exc.value.status_code == 422

            # Completing the prerequisite through trainer-led delivery is enough.
            completed_dp_id = str(uuid.uuid4())
            run(server.db.dog_programs.insert_one({
                "id": completed_dp_id, "dog_id": dog["id"], "program_id": pre["id"],
                "program_snapshot": {"name": pre["name"], "slug": pre_slug, "modules": pre.get("modules") or []},
                "status": "completed", "completed_at": server.now_iso(), "created_at": server.now_iso(),
            }))
            result = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=advanced["id"]), admin))
            school_id = result["school_enrollment"]["id"]
            enrollment_id = result["enrollment"]["id"]
            snap = result["enrollment"]["program_snapshot"]
            assert snap["prereq_slugs"] == [pre_slug]
            assert snap["estimated_weeks"] == 8
            assert snap["school_onboarding"]["require_baseline"] is True
            assert snap["school_onboarding"]["require_equipment_check"] is True
            assert snap["school_support"]["trainer_checkpoints_included"] == 4
            assert snap["school_support"]["trainer_assists_included"] == 1
    finally:
        if school_id:
            run(server.db.school_enrollments.delete_one({"id": school_id}))
        if enrollment_id:
            run(server.db.dog_programs.delete_one({"id": enrollment_id}))
        if completed_dp_id:
            run(server.db.dog_programs.delete_one({"id": completed_dp_id}))
        _delete_program(advanced["id"])
        _delete_program(pre["id"])


def test_course_builder_blocks_validate_sources_activity_and_knowledge_check_config():
    admin = _admin_user()
    slug = f"{TAG.lower()}-blocks-{uuid.uuid4().hex[:6]}"
    prog = run(server.create_program(_program_body("Block Validation", slug), admin))
    resource_id = str(uuid.uuid4())
    try:
        run(server.db.school_resources.insert_one({
            "id": resource_id, "title": "Archived guide", "description": "", "kind": "file",
            "program_ids": [], "lesson_ids": [], "tags": [], "active": False,
        }))
        body = _program_body(
            "Block Validation", slug,
            modules=[server.ModuleIn(
                name="Module 1", goals=[server.GoalIn(name="Skill")],
                lessons=[server.LessonIn(
                    name="Rich lesson",
                    content_blocks=[
                        server.LessonContentBlockIn(type="video", title="Demo"),
                        server.LessonContentBlockIn(type="timer", title="Hold it", config={}),
                        server.LessonContentBlockIn(type="rep_counter", title="Reps", config={"target": 0}),
                        server.LessonContentBlockIn(type="quiz", title="Check", items=["A", "B"], config={"correct_answer": "C"}),
                        server.LessonContentBlockIn(type="download", title="Guide", resource_id=resource_id),
                    ],
                )],
            )],
        )
        run(server.update_program(prog["id"], body, cascade=False, save_as_draft=True, _=admin))
        validation = run(server.validate_program(prog["id"], target="draft", _=admin))
        codes = {e["code"] for e in validation["errors"]}
        assert "content_block_missing_source" in codes
        assert "timer_missing_duration" in codes
        assert "rep_counter_missing_target" in codes
        assert "knowledge_check_invalid_answer" in codes
        assert "broken_school_resource_ref" in codes
    finally:
        run(server.db.school_resources.delete_one({"id": resource_id}))
        _delete_program(prog["id"])
