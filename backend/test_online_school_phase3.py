"""Online School Phase 3 — Student Journey & Support (backend additions).

Covers: trainer_name exposure, the checkpoint-history endpoint, the
completed-enrollment-stays-visible fix (portal_school_list), the
dog_programs completion status + trophy-engine fix (including proof it
never disturbs a trainer-led "active enrollment" lookup for the same dog),
author-defined assessment_type (default + uniqueness validation), and the
completion_summary object (including the enrollment-scoped, not
dog+lesson-scoped, practice-session count).

Same fixture/cleanup convention as test_online_school_checkpoints.py — this
file is self-contained, no shared conftest.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import _school_client_flow
from _test_loop import run

TAG = "TEST_SCHOOL_P3"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


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


COACH_RECIPE = {
    "enabled": True, "allow_quick_practice": True,
    "goal": "Get {{dog_name}} to look at you.", "success_today": "7/10.",
    "schedule": {"minutes_per_round": 3, "rounds_per_day": 3, "reps_per_round": 10},
    "steps": [{"id": "get-ready", "title": "Get ready", "instruction": "Have {{dog_name}} nearby."}],
    "guided_practice": {"enabled": True, "ready_instruction": "Wait.", "cue_prompt": "Say the name ONCE.",
                         "success_button_label": "LOOKED", "miss_button_label": "DIDN'T", "count_successes": True},
}


@contextlib.contextmanager
def _homework_template(name_suffix="A"):
    admin = _admin_user()
    body = server.HomeworkTemplateIn(
        name=f"{TAG} Template {name_suffix} {uuid.uuid4().hex[:6]}",
        sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}],
        practice_coach=dict(COACH_RECIPE),
    )
    tpl = run(server.create_homework_template(body, admin))
    try:
        yield tpl, admin
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def _checkpoint_config(assessment_type="checkpoint"):
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        submission_requirements="Good lighting.", pass_readiness_guidance="3+ clean reps.",
        assessment_type=assessment_type,
    )


@contextlib.contextmanager
def _school_program(n_modules=1, n_lessons_per_module=1, checkpoint_lesson_idx=0, assessment_type="checkpoint", delivery_mode="self_guided"):
    admin = _admin_user()
    with contextlib.ExitStack() as stack:
        tpls = [stack.enter_context(_homework_template(str(i)))[0] for i in range(n_modules * n_lessons_per_module)]
        tpl_ids = [t["id"] for t in tpls]
        modules = []
        for mi in range(n_modules):
            goals = [server.GoalIn(name=f"Skill M{mi}L{li}") for li in range(n_lessons_per_module)]
            modules.append(server.ModuleIn(name=f"Module {mi + 1}", order=mi, goals=goals))
        body = server.ProgramIn(
            name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
            format={"count": n_modules, "unit": "modules"}, price=0,
            delivery_mode=delivery_mode, modules=modules,
        )
        prog = run(server.create_program(body, admin))
        fixed_modules = []
        tid = 0
        flat_idx = 0
        for mi, m in enumerate(prog["modules"]):
            goal_ids = [g["id"] for g in m["goals"]]
            lessons = []
            for li in range(n_lessons_per_module):
                cp = _checkpoint_config(assessment_type=assessment_type) if flat_idx == checkpoint_lesson_idx else None
                lessons.append(server.LessonIn(
                    name=f"Lesson {mi + 1}.{li + 1}", order=li, active=True, skill_ids=[goal_ids[li]],
                    client_overview="overview", why_it_matters="matters.",
                    success_criteria="5 in a row.", suggested_homework_template_ids=[tpl_ids[tid]],
                    checkpoint=cp,
                ))
                tid += 1
                flat_idx += 1
            fixed_modules.append(server.ModuleIn(
                id=m["id"], name=m["name"], order=m["order"],
                goals=[server.GoalIn(**g) for g in m["goals"]], lessons=lessons,
            ))
        fixed = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode=delivery_mode, modules=fixed_modules,
        )
        prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
        try:
            yield prog, admin
        finally:
            run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_school(school_id, enrollment_id):
    subs = run(server.db.checkpoint_submissions.find({"school_enrollment_id": school_id}, {"_id": 0, "video_media_id": 1}).to_list(50))
    media_ids = [s["video_media_id"] for s in subs if s.get("video_media_id")]
    if media_ids:
        run(server.db.homework_media.delete_many({"id": {"$in": media_ids}}))
    run(server.db.checkpoint_submissions.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"dog_id": {"$exists": True}, "assigned_by": {"$regex": "^(Online School|Trainer)"}}))


def _tiny_video():
    import base64
    return "data:video/mp4;base64," + base64.b64encode(b"x" * 1000).decode()


def _enroll(prog, dog, admin):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    return res["school_enrollment"], res["enrollment"]


def _submit_checkpoint_for_current_lesson(se, enr, client_user):
    lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
    started = run(_school_client_flow.start_practice(se["id"], lesson_id, client_user))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
    out = run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    handler_id = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
    dog_crit_id = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
    return sub_id, handler_id, dog_crit_id, lesson_id, started["homework_id"]


def _grade(sub_id, admin, outcome="advance", handler_id=None, dog_crit_id=None, feedback="Nice work."):
    scores = {}
    if handler_id:
        scores["handler_scores"] = {handler_id: 4}
    if dog_crit_id:
        scores["dog_scores"] = {dog_crit_id: 4}
    return run(server.admin_school_checkpoint_grade(
        sub_id, server.CheckpointGradeIn(
            handler_scores=scores.get("handler_scores", {}), dog_scores=scores.get("dog_scores", {}),
            feedback=feedback, outcome=outcome,
        ), admin,
    ))


# ---------------------------------------------------------------------------
# Trainer name exposure
# ---------------------------------------------------------------------------

def test_trainer_name_exposed_on_graded_client_safe_submission():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
            safe = server._client_safe_checkpoint_submission(raw)
            assert safe["trainer_name"] == admin["name"]
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Checkpoint history endpoint
# ---------------------------------------------------------------------------

def test_checkpoint_history_lists_graded_newest_first_with_labels():
    with _school_program(n_modules=1, n_lessons_per_module=1) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did, feedback="Great first pass.")
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            assert len(history) == 1
            entry = history[0]
            assert entry["id"] == sub_id
            assert entry["lesson_name"]
            assert entry["module_name"] == prog["modules"][0]["name"]
            assert entry["trainer_feedback"] == "Great first pass."
            assert entry["rubric_snapshot"]["handler_criteria"][0]["name"] == "Cue clarity"
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_checkpoint_history_excludes_pending_and_grading():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            _submit_checkpoint_for_current_lesson(se, enr, client_user)  # left pending, never graded
            history = run(server.portal_school_checkpoint_history(se["id"], client_user))
            assert history == []
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_checkpoint_history_ownership_enforced():
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog), _client_and_dog() as (other_client, other_dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            other_user = _client_user(other_client["id"])
            try:
                run(server.portal_school_checkpoint_history(se["id"], other_user))
                assert False, "expected 404"
            except server.HTTPException as exc:
                assert exc.status_code == 404
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Refresher-lesson name resolution (Go to Refresher Lesson affordance)
# ---------------------------------------------------------------------------

def test_prescribed_refresher_lesson_name_resolved_into_checkpoint_status():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=0) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            refresher_lesson_id = prog["modules"][0]["lessons"][1]["id"]
            run(server.admin_school_checkpoint_grade(
                sub_id, server.CheckpointGradeIn(
                    handler_scores={hid: 2}, dog_scores={did: 2}, feedback="Practice this again.",
                    outcome="prescribe_practice",
                    prescription=server.CheckpointPrescriptionIn(
                        action="assign_refresher_lesson", refresher_lesson_id=refresher_lesson_id,
                        min_practice_sessions_required=1,
                    ),
                ), admin,
            ))
            detail = run(server.portal_school_detail(se["id"], client_user))
            prescription = detail["roadmap"]["checkpoint_status"]["prescription"]
            assert prescription["refresher_lesson_id"] == refresher_lesson_id
            assert prescription["refresher_lesson_name"] == prog["modules"][0]["lessons"][1]["name"]
        finally:
            _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Completed enrollment stays accessible
# ---------------------------------------------------------------------------

def test_portal_school_list_includes_completed_enrollment():
    with _school_program(n_modules=1, n_lessons_per_module=1) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)

            se_after = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert se_after["status"] == "completed"

            listing = run(server.portal_school_list(client_user))
            assert any(row["school_enrollment_id"] == se["id"] and row["status"] == "completed" for row in listing)

            detail = run(server.portal_school_detail(se["id"], client_user))
            assert detail["status"] == "completed"
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_final_advance_completes_dog_program_without_disturbing_trainer_led_active_lookup():
    with _school_program(n_modules=1, n_lessons_per_module=1) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        # A second, unrelated trainer-led enrollment for the SAME dog —
        # proves the online completion never displaces or masquerades as it.
        led_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)

            dp_online = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp_online["status"] == "completed"
            assert dp_online.get("completed_at")

            # The same query admin_training_today/active_summary use to find
            # a dog's trainer-led active enrollment — must be unaffected.
            trainer_led_active = run(server.db.dog_programs.find_one(
                {"dog_id": dog["id"], "status": "active", "delivery_channel": {"$ne": "online_school"}}, {"_id": 0},
            ))
            assert trainer_led_active is not None
            assert trainer_led_active["id"] == led_enr["id"]
        finally:
            _cleanup_school(se["id"], enr["id"])
            run(server.db.dog_programs.delete_one({"id": led_enr["id"]}))


# ---------------------------------------------------------------------------
# Author-defined Final Assessment
# ---------------------------------------------------------------------------

def test_assessment_type_defaults_to_checkpoint():
    with _school_program(assessment_type="checkpoint") as (prog, admin):
        modules_raw = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0, "modules": 1}))["modules"]
        cp = modules_raw[0]["lessons"][0]["checkpoint"]
        assert cp["assessment_type"] == "checkpoint"


def test_final_assessment_type_flows_to_rubric_snapshot_and_client_safe_rubric():
    with _school_program(assessment_type="final_assessment") as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            detail = run(server.portal_school_detail(se["id"], client_user))
            assert detail["roadmap"]["checkpoint_rubric"]["assessment_type"] == "final_assessment"
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
            assert raw["rubric_snapshot"]["assessment_type"] == "final_assessment"
        finally:
            _cleanup_school(se["id"], enr["id"])


def _publish_errors(program_id, admin):
    try:
        run(server.publish_program(program_id, cascade=False, _=admin))
        return None
    except server.HTTPException as exc:
        assert exc.status_code == 422
        return exc.detail["errors"]


def test_final_assessment_uniqueness_blocks_publish_with_two():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=None) as (prog, admin):
        lessons = [dict(l) for l in prog["modules"][0]["lessons"]]
        cp = _checkpoint_config(assessment_type="final_assessment").model_dump()
        lessons[0]["checkpoint"] = cp
        lessons[1]["checkpoint"] = dict(cp)
        edited = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode="self_guided",
            modules=[server.ModuleIn(
                id=prog["modules"][0]["id"], name=prog["modules"][0]["name"], order=0,
                goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]],
                lessons=[server.LessonIn(**l) for l in lessons],
            )],
        )
        run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=True, _=admin))
        errors = _publish_errors(prog["id"], admin)
        assert errors is not None
        assert any(e["code"] == "checkpoint_multiple_final_assessments" for e in errors)


def test_final_assessment_single_lesson_publishes_cleanly():
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=1, assessment_type="final_assessment") as (prog, admin):
        modules_raw = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0, "modules": 1}))["modules"]
        result = run(server._validate_program_structure(modules_raw))
        assert not any(e["code"] == "checkpoint_multiple_final_assessments" for e in result["errors"])


def test_legacy_program_with_no_final_assessment_remains_valid():
    with _school_program(checkpoint_lesson_idx=None) as (prog, admin):
        modules_raw = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0, "modules": 1}))["modules"]
        result = run(server._validate_program_structure(modules_raw))
        assert not any(e["code"] == "checkpoint_multiple_final_assessments" for e in result["errors"])


# ---------------------------------------------------------------------------
# completion_summary
# ---------------------------------------------------------------------------

def test_completion_summary_absent_when_not_completed():
    with _school_program(n_modules=1, n_lessons_per_module=2) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            detail = run(server.portal_school_detail(se["id"], client_user))
            assert detail["completion_summary"] is None
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_completion_summary_fields_and_final_assessment_once_completed():
    with _school_program(n_modules=1, n_lessons_per_module=1, assessment_type="final_assessment") as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did, feedback="Solid final pass.")

            detail = run(server.portal_school_detail(se["id"], client_user))
            cs = detail["completion_summary"]
            assert cs is not None
            assert cs["total_modules"] == 1
            assert cs["total_lessons"] == 1
            assert cs["checkpoints_passed"] == 1
            assert cs["practice_sessions_logged"] == 1
            assert cs["final_assessment"] is not None
            assert cs["final_assessment"]["trainer_name"] == admin["name"]
            assert cs["final_assessment"]["trainer_feedback"] == "Solid final pass."
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_completion_summary_final_assessment_absent_for_ordinary_checkpoint():
    with _school_program(n_modules=1, n_lessons_per_module=1, assessment_type="checkpoint") as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)
            detail = run(server.portal_school_detail(se["id"], client_user))
            assert detail["completion_summary"]["final_assessment"] is None
        finally:
            _cleanup_school(se["id"], enr["id"])


def test_practice_sessions_logged_is_enrollment_scoped_not_dog_lesson_scoped():
    """Correction: a dog with BOTH an Online School enrollment and a
    trainer-led enrollment of the SAME program (identical lesson ids)
    must never have the trainer-led practice volume leak into the Online
    School graduation total, or vice versa — practice_sessions_logged must
    come from THIS enrollment's own auto_homework_log, never a
    dog_id+lesson_id homework lookup."""
    with _school_program(n_modules=1, n_lessons_per_module=1) as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        led_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
        led_hw = None
        try:
            client_user = _client_user(client_doc["id"])

            # Online-enrollment practice FIRST: exactly 1 round via the real
            # start-practice + submit flow, claimed through
            # _claim_school_lesson_homework and logged in THIS enrollment's
            # own auto_homework_log (the real, enrollment-scoped provenance).
            sub_id, hid, did, lesson_id, online_hw_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)

            # THEN a separate trainer-led homework row against the IDENTICAL
            # lesson_id (a second, distinct homework doc — the exact
            # dog_id+lesson_id ambiguity a naive lookup would conflate),
            # with 5 practice rounds logged — must NOT be counted by the
            # Online School enrollment's graduation summary.
            tpl_id = prog["modules"][0]["lessons"][0]["suggested_homework_template_ids"][0]
            led_hw = run(server._create_homework_from_template_internal(
                dog, client_doc, tpl_id, assigned_by="Trainer manual assign", source_lesson_id=lesson_id,
            ))
            assert online_hw_id != led_hw["id"], "test setup sanity: must be two distinct homework rows"
            for _ in range(5):
                run(server.log_section(led_hw["id"], server.SectionLogIn(section_id="practice"), admin))

            _grade(sub_id, admin, "advance", hid, did)

            detail = run(server.portal_school_detail(se["id"], client_user))
            assert detail["completion_summary"]["practice_sessions_logged"] == 1
        finally:
            _cleanup_school(se["id"], enr["id"])
            run(server.db.dog_programs.delete_one({"id": led_enr["id"]}))
            if led_hw:
                run(server.db.homework.delete_one({"id": led_hw["id"]}))


# ---------------------------------------------------------------------------
# first_checkpoint_passed trophy
# ---------------------------------------------------------------------------

def test_first_checkpoint_passed_trophy_fires_on_advance():
    code = f"{TAG.lower()}_first_checkpoint"
    run(server.db.trophies.insert_one({
        "id": str(uuid.uuid4()), "code": code, "name": "First Checkpoint Passed",
        "description": "test", "category": "dog", "tier": "bronze", "icon": "fa-video",
        "trigger_type": "auto", "trigger_kind": "first_checkpoint_passed", "threshold": 1,
        "active": True, "is_default": False,
    }))
    with _school_program() as (prog, admin), _client_and_dog() as (client_doc, dog):
        se, enr = _enroll(prog, dog, admin)
        try:
            client_user = _client_user(client_doc["id"])
            sub_id, hid, did, lesson_id, _hw = _submit_checkpoint_for_current_lesson(se, enr, client_user)
            _grade(sub_id, admin, "advance", hid, did)
            awarded = run(server.db.awarded_trophies.find_one(
                {"recipient_type": "dog", "recipient_id": dog["id"], "trophy_code": code}, {"_id": 0},
            ))
            assert awarded is not None
        finally:
            _cleanup_school(se["id"], enr["id"])
            run(server.db.awarded_trophies.delete_many({"trophy_code": code}))
            run(server.db.trophies.delete_one({"code": code}))
