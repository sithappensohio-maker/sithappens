"""Online School Phase 2 — Trainer Checkpoints & Grading.

Stage 2.1 coverage: typed per-lesson rubric config, checkpoint_submissions
data model + indexes, the client submit endpoint (video size/MIME
validation, rubric snapshot, duplicate-submission protection), the
checkpoint-required advancement gate, the client-safe allowlist
serializer's leakage boundary, rubric structural validation, and the
delete_school_enrollment checkpoint-history guard.

Grading (the durable state machine), structured remediation, trainer
assist, and the refresher-access entitlement are covered by later stages'
own test additions to this same file.

Same fixture/cleanup convention as test_online_school_phase1.py /
test_online_school_hardening.py.
"""
import asyncio
import base64
import contextlib
import json
import uuid

import httpx
from motor.motor_asyncio import AsyncIOMotorCollection

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_SCHOOL_CHECKPOINTS"

# Permission enforcement lives in Depends(require_admin_and_permission(...)),
# which only runs through real ASGI dispatch — calling an endpoint function
# directly bypasses Depends entirely (see test_online_school_phase1.py).
# Used only for the one test that specifically verifies the permission gate.
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


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


COACH_RECIPE = {
    "enabled": True, "allow_quick_practice": True,
    "goal": "Get {{dog_name}} to look at you when you say the name once.",
    "success_today": "{{dog_name}} looks at you within 2 seconds on 7 out of 10 tries.",
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


def _checkpoint_config(handler_names=("Cue clarity",), dog_names=("Latency",)):
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side, full body visible.",
        handler_criteria=[server.CheckpointCriterionIn(name=n) for n in handler_names],
        dog_criteria=[server.CheckpointCriterionIn(name=n) for n in dog_names],
        submission_requirements="Good lighting.", pass_readiness_guidance="Look for 3+ clean reps.",
    )


@contextlib.contextmanager
def _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=2, tpl_ids=None, checkpoint_lesson_idx=0):
    """n_modules x n_lessons_per_module curriculum with real Coach-Mode
    homework templates wired to each lesson. The lesson at flat index
    `checkpoint_lesson_idx` (across all modules, in order) is marked
    requires-checkpoint with author-defined criteria; pass None for a
    program with no checkpoint lesson at all (Phase 1 regression coverage)."""
    admin = _admin_user()
    with contextlib.ExitStack() as stack:
        if tpl_ids is None:
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
                cp = _checkpoint_config() if flat_idx == checkpoint_lesson_idx else None
                lessons.append(server.LessonIn(
                    name=f"Lesson {mi + 1}.{li + 1}", order=li, active=True, skill_ids=[goal_ids[li]],
                    client_overview=f"Lesson {mi + 1}.{li + 1} overview", why_it_matters="It matters.",
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
    run(server.db.homework.delete_many({"dog_id": {"$exists": True}, "assigned_by": {"$regex": "^Online School"}}))


def _tiny_video(raw_bytes=1000, mime="video/mp4"):
    return f"data:{mime};base64," + base64.b64encode(b"x" * raw_bytes).decode()


def _oversized_video():
    return _tiny_video(raw_bytes=11 * 1024 * 1024)


def _enroll(prog, dog, admin):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    return res["school_enrollment"], res["enrollment"]


def _submit_checkpoint_for_current_lesson(se, enr, client_user):
    """Practices + submits a checkpoint for whatever lesson is CURRENT.
    Returns (submission_id, handler_criterion_id, dog_criterion_id, lesson_id)."""
    lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
    started = run(server.portal_school_start_practice(se["id"], lesson_id, client_user))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
    out = run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    handler_id = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
    dog_crit_id = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
    return sub_id, handler_id, dog_crit_id, lesson_id


@contextlib.contextmanager
def _fail_only_nth_call(collection_name, method_name, n, message="simulated failure"):
    """Fails ONLY the Nth call (1-indexed) of method_name on
    collection_name — every other call (before and after) succeeds
    normally. Distinct from the 'fail the first N calls' helper used
    elsewhere in this repo's test suites: here earlier legitimate calls
    within the SAME grade() invocation must go through so the failure
    lands at one exact, deliberately chosen later point."""
    orig = getattr(AsyncIOMotorCollection, method_name)
    state = {"count": 0}

    async def _patched(self, *args, **kwargs):
        if self.name == collection_name:
            state["count"] += 1
            if state["count"] == n:
                raise RuntimeError(message)
        return await orig(self, *args, **kwargs)

    setattr(AsyncIOMotorCollection, method_name, _patched)
    try:
        yield
    finally:
        setattr(AsyncIOMotorCollection, method_name, orig)


# ---------------------------------------------------------------------------
# Advancement gate — checkpoint-required lessons never self-advance
# ---------------------------------------------------------------------------

def test_non_checkpoint_lesson_advance_behaves_as_phase1():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=None) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                adv = run(server.portal_school_advance(se["id"], client_user))
                assert adv["finished"] is False
                assert adv["current_lesson_id"] == lesson2_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_lesson_advance_always_422s_regardless_of_practice_state():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                # Not yet practiced.
                try:
                    run(server.portal_school_advance(se["id"], client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
                    assert "checkpoint" in exc.detail.lower() or "trainer" in exc.detail.lower()

                # Now practiced — still 422, same reason (checkpoint gate fires first).
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                try:
                    run(server.portal_school_advance(se["id"], client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Client submission
# ---------------------------------------------------------------------------

def test_checkpoint_submit_requires_prior_practice():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_submit_succeeds_and_returns_client_safe_view():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                out = run(server.portal_school_submit_checkpoint(
                    se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video(), note="here goes"), client_user,
                ))
                cp = out["checkpoint"]
                assert cp["lesson_id"] == lesson1_id
                assert cp["status"] == "awaiting_review"
                # Not yet graded — no scores/feedback surfaced.
                assert "handler_scores" not in cp

                raw = run(server.db.checkpoint_submissions.find_one({"id": cp["id"]}, {"_id": 0}))
                assert raw["status"] == "pending"
                assert raw["client_note"] == "here goes"
                assert raw["rubric_snapshot"]["handler_criteria"][0]["name"] == "Cue clarity"
                media = run(server.db.homework_media.find_one({"id": raw["video_media_id"]}, {"_id": 0}))
                assert media["kind"] == "checkpoint_video"
                assert media["homework_id"] == raw["homework_id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_submit_blocked_while_pending_submission_exists():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_concurrent_checkpoint_submission_only_one_survives():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))

                async def _go():
                    return await asyncio.gather(
                        server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user),
                        server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user),
                        return_exceptions=True,
                    )
                results = run(_go())
                successes = [r for r in results if not isinstance(r, Exception)]
                failures = [r for r in results if isinstance(r, Exception)]
                assert len(successes) == 1, results
                assert len(failures) == 1
                assert isinstance(failures[0], server.HTTPException) and failures[0].status_code == 409

                count = run(server.db.checkpoint_submissions.count_documents(
                    {"school_enrollment_id": se["id"], "lesson_id": lesson1_id, "status": {"$in": ["pending", "grading"]}},
                ))
                assert count == 1
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_video_oversized_rejected():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_oversized_video()), client_user))
                    assert False, "expected 400"
                except server.HTTPException as exc:
                    assert exc.status_code == 400
                    assert "large" in exc.detail.lower()
                # No orphaned checkpoint_submissions/homework_media from the rejected attempt.
                assert run(server.db.checkpoint_submissions.count_documents({"school_enrollment_id": se["id"]})) == 0
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_video_bad_mime_rejected():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video(mime="application/pdf")), client_user))
                    assert False, "expected 400"
                except server.HTTPException as exc:
                    assert exc.status_code == 400
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_submission_ownership_enforced():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c1, dog1), _client_and_dog() as (c2, dog2):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog1["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                other_user = _client_user(c2["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), other_user))
                    assert False, "expected 404"
                except server.HTTPException as exc:
                    assert exc.status_code == 404
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_checkpoint_rubric_snapshot_immutable_after_curriculum_edit():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                sub_id = out["checkpoint"]["id"]
                before = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))

                # Edit the LIVE program's lesson 1 criteria (rename one).
                edited_lesson = dict(prog["modules"][0]["lessons"][0])
                edited_lesson["checkpoint"]["handler_criteria"][0]["name"] = "RENAMED"
                edited_modules = [server.ModuleIn(
                    id=prog["modules"][0]["id"], name=prog["modules"][0]["name"], order=prog["modules"][0]["order"],
                    goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]],
                    lessons=[server.LessonIn(**edited_lesson)] + [server.LessonIn(**l) for l in prog["modules"][0]["lessons"][1:]],
                )]
                edited = server.ProgramIn(name=prog["name"], type="private_lessons", format=prog["format"], price=0, delivery_mode="self_guided", modules=edited_modules)
                run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=False, _=admin))

                after = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
                assert after["rubric_snapshot"] == before["rubric_snapshot"]
                assert after["rubric_snapshot"]["handler_criteria"][0]["name"] == "Cue clarity"
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Client-safe serialization — sentinel leakage
# ---------------------------------------------------------------------------

def test_client_safe_checkpoint_helpers_never_leak_trainer_only_fields():
    sentinel = f"SENTINEL_{uuid.uuid4().hex[:8]}"
    raw_rubric = {
        "title": "Checkpoint", "submission_instructions": "Film it.",
        "handler_criteria": [{"id": "h1", "name": "Cue clarity", "guidance": sentinel}],
        "dog_criteria": [{"id": "d1", "name": "Latency", "guidance": sentinel}],
        "submission_requirements": "Full body visible.",
        "pass_readiness_guidance": sentinel,
        "enabled": True,
    }
    raw_sub = {
        "id": "sub1", "lesson_id": "lesson1", "status": "graded",
        "submitted_at": server.now_iso(), "graded_at": server.now_iso(),
        "handler_scores": {"h1": 4}, "dog_scores": {"d1": 5},
        "trainer_feedback": "Nice work.", "outcome": "advance",
        "prescription": None,
        "trainer_assist_hold_active": False,
        "grading_plan": {"sentinel": sentinel},
        "notification_sent": True, "notification_sent_at": server.now_iso(),
        "last_advance_conflict_at": sentinel,
        "__totally_undeclared_field__": sentinel,
    }
    out_sub = server._client_safe_checkpoint_submission(raw_sub)
    out_rubric = server._client_safe_checkpoint_rubric(raw_rubric)
    combined = json.dumps(out_sub) + json.dumps(out_rubric)
    assert sentinel not in combined


def test_checkpoint_submission_sentinel_field_never_leaks_through_real_flow():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                sub_id = out["checkpoint"]["id"]
                sentinel = f"SENTINEL_{uuid.uuid4().hex[:8]}"
                run(server.db.checkpoint_submissions.update_one(
                    {"id": sub_id}, {"$set": {"__future_hidden_field__": sentinel, "grading_plan": {"x": sentinel}, "status": "graded",
                                               "trainer_feedback": sentinel + "_feedback_is_fine_to_show"}},
                ))
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                safe = server._client_safe_checkpoint_submission(raw)
                # trainer_feedback is legitimately client-visible — only assert
                # the pure-sentinel value (not embedded in an expected field) is absent.
                assert "__future_hidden_field__" not in json.dumps(safe)
                assert sentinel not in json.dumps({k: v for k, v in safe.items() if k != "trainer_feedback"})
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Rubric structural validation
# ---------------------------------------------------------------------------

def _publish_errors(program_id, admin):
    try:
        run(server.publish_program(program_id, cascade=False, _=admin))
        return None
    except server.HTTPException as exc:
        assert exc.status_code == 422
        return exc.detail["errors"]


def test_checkpoint_validation_blocks_publish_missing_handler_criteria():
    with _school_program(delivery_mode="self_guided", n_lessons_per_module=1, checkpoint_lesson_idx=None) as (prog, admin):
        lesson0 = dict(prog["modules"][0]["lessons"][0])
        lesson0["checkpoint"] = {
            "enabled": True, "title": None, "submission_instructions": None,
            "handler_criteria": [], "dog_criteria": [{"id": None, "name": "Latency", "guidance": None}],
            "submission_requirements": None, "pass_readiness_guidance": None,
        }
        edited_modules = [server.ModuleIn(
            id=prog["modules"][0]["id"], name=prog["modules"][0]["name"], order=prog["modules"][0]["order"],
            goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]], lessons=[server.LessonIn(**lesson0)],
        )]
        edited = server.ProgramIn(name=prog["name"], type="private_lessons", format=prog["format"], price=0, delivery_mode="self_guided", modules=edited_modules)
        run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=True, _=admin))
        errors = _publish_errors(prog["id"], admin)
        assert errors is not None
        assert any(e["code"] == "checkpoint_missing_handler_criteria" for e in errors)


def test_checkpoint_validation_blocks_publish_missing_dog_criteria():
    with _school_program(delivery_mode="self_guided", n_lessons_per_module=1, checkpoint_lesson_idx=None) as (prog, admin):
        lesson0 = dict(prog["modules"][0]["lessons"][0])
        lesson0["checkpoint"] = {
            "enabled": True, "title": None, "submission_instructions": None,
            "handler_criteria": [{"id": None, "name": "Cue clarity", "guidance": None}], "dog_criteria": [],
            "submission_requirements": None, "pass_readiness_guidance": None,
        }
        edited_modules = [server.ModuleIn(
            id=prog["modules"][0]["id"], name=prog["modules"][0]["name"], order=prog["modules"][0]["order"],
            goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]], lessons=[server.LessonIn(**lesson0)],
        )]
        edited = server.ProgramIn(name=prog["name"], type="private_lessons", format=prog["format"], price=0, delivery_mode="self_guided", modules=edited_modules)
        run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=True, _=admin))
        errors = _publish_errors(prog["id"], admin)
        assert errors is not None
        assert any(e["code"] == "checkpoint_missing_dog_criteria" for e in errors)


def test_checkpoint_validation_blocks_publish_duplicate_criterion_ids():
    with _school_program(delivery_mode="self_guided", n_lessons_per_module=1, checkpoint_lesson_idx=None) as (prog, admin):
        lesson0 = dict(prog["modules"][0]["lessons"][0])
        lesson0["checkpoint"] = {
            "enabled": True, "title": None, "submission_instructions": None,
            "handler_criteria": [{"id": "dup-1", "name": "Cue clarity", "guidance": None}],
            "dog_criteria": [{"id": "dup-1", "name": "Latency", "guidance": None}],
            "submission_requirements": None, "pass_readiness_guidance": None,
        }
        edited_modules = [server.ModuleIn(
            id=prog["modules"][0]["id"], name=prog["modules"][0]["name"], order=prog["modules"][0]["order"],
            goals=[server.GoalIn(**g) for g in prog["modules"][0]["goals"]], lessons=[server.LessonIn(**lesson0)],
        )]
        edited = server.ProgramIn(name=prog["name"], type="private_lessons", format=prog["format"], price=0, delivery_mode="self_guided", modules=edited_modules)
        run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=True, _=admin))
        errors = _publish_errors(prog["id"], admin)
        assert errors is not None
        assert any(e["code"] == "checkpoint_duplicate_criterion_id" for e in errors)


def test_legacy_lesson_with_no_checkpoint_validates_unchanged():
    with _school_program(delivery_mode="self_guided", n_lessons_per_module=1, checkpoint_lesson_idx=None) as (prog, admin):
        modules_raw = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0, "modules": 1}))["modules"]
        result = run(server._validate_program_structure(modules_raw))
        assert not any(e["code"].startswith("checkpoint_") for e in result["errors"])


# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------

def test_critical_checkpoint_indexes_present_with_expected_definition():
    indexes = run(server.db.checkpoint_submissions.index_information())

    def _has(key, unique, partial):
        for spec in indexes.values():
            k = [(a, float(b)) for a, b in (spec.get("key") or [])]
            if k != [(a, float(b)) for a, b in key]:
                continue
            if bool(spec.get("unique")) != unique:
                continue
            if partial is None:
                if spec.get("partialFilterExpression"):
                    continue
            elif spec.get("partialFilterExpression") != partial:
                continue
            return True
        return False

    assert _has([("id", 1)], True, None)
    assert _has([("school_enrollment_id", 1), ("lesson_id", 1)], True, {"status": {"$in": ["pending", "grading"]}})


# ---------------------------------------------------------------------------
# Enrollment removal + checkpoint history
# ---------------------------------------------------------------------------

def test_delete_school_enrollment_zero_checkpoints_still_works():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=None) as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            run(server.delete_school_enrollment(se["id"], admin))
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is None


def test_delete_school_enrollment_blocked_once_checkpoint_history_exists():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))

                try:
                    run(server.delete_school_enrollment(se["id"], admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
                    assert "checkpoint" in exc.detail.lower()

                # Nothing was touched.
                assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is not None
                assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is not None
                assert run(server.db.checkpoint_submissions.count_documents({"school_enrollment_id": se["id"]})) == 1
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Grading — happy path, goal_progress untouched, final lesson, queue states
# ---------------------------------------------------------------------------

def test_admin_grade_advance_happy_path_moves_enrollment():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                before_gp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "goal_progress": 1}))

                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, feedback="Nice!", outcome="advance"), admin,
                ))
                cp = grade["checkpoint"]
                assert cp["status"] == "graded"
                assert cp["outcome"] == "advance"
                assert cp["handler_overall"] == 4
                assert cp["dog_overall"] == 5

                fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1, "goal_progress": 1}))
                assert fresh["current_lesson_id"] == lesson2_id
                assert fresh["goal_progress"] == before_gp["goal_progress"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_admin_grade_score_key_validation():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                try:
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
                try:
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4, "extra": 3}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_admin_grade_advance_final_lesson_marks_school_enrollment_completed():
    with _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=1, checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 5}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                ))
                assert grade["checkpoint"]["status"] == "graded"
                raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
                assert raw_se["status"] == "completed"
                assert raw_se["completed_at"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_pending_checkpoints_queue_shows_all_three_states():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                queue = run(server.admin_school_checkpoints_pending(admin))
                row = next(r for r in queue if r["id"] == sub_id)
                assert row["queue_state"] == "pending_review"

                # Claim it (pending -> grading) but interrupt before the CAS,
                # so it's stuck mid-grade with no conflict marker.
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False, "expected the simulated failure to propagate"
                    except RuntimeError:
                        pass
                queue = run(server.admin_school_checkpoints_pending(admin))
                row = next(r for r in queue if r["id"] == sub_id)
                assert row["queue_state"] == "grading_resume_needed"

                # Now force a real state conflict.
                run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_lesson_id": "some-unrelated-lesson-id"}}))
                try:
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert False, "expected 409"
                except server.HTTPException:
                    pass
                queue = run(server.admin_school_checkpoints_pending(admin))
                row = next(r for r in queue if r["id"] == sub_id)
                assert row["queue_state"] == "state_conflict"
                # Conflicts sort first.
                assert queue[0]["id"] == sub_id
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Interruption safety — every meaningful boundary
# ---------------------------------------------------------------------------

def test_crash_between_claim_and_advance_cas_then_retry_advances_exactly_once():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                # 1st dog_programs.find_one in the call = pos-computation in
                # the PENDING branch (before claim); 2nd = the enrollment
                # refetch in the GRADING branch (after claim). Failing the
                # 2nd interrupts strictly AFTER the claim succeeded.
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False, "expected the simulated failure to propagate"
                    except RuntimeError:
                        pass

                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"
                assert raw["grading_plan"]["expected_source_lesson_id"] == lesson1_id
                still_at_lesson1 = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert still_at_lesson1["current_lesson_id"] == lesson1_id  # not yet advanced

                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                ))
                assert grade["checkpoint"]["status"] == "graded"
                fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert fresh["current_lesson_id"] == lesson2_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_crash_between_advance_cas_and_homework_assign_then_retry_finalizes_without_double_advance():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                # Claim cleanly first (separate call, no fault).
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"

                # Resume: let the CAS succeed, fail the fresh_enrollment
                # lookup INSIDE _finish_school_advancement (2nd
                # dog_programs.find_one in a grading-only resume: 1st =
                # enrollment fetch before the CAS, 2nd = fresh_enrollment
                # after it).
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass

                # CAS already succeeded — enrollment moved — but finalize
                # never ran.
                moved = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert moved["current_lesson_id"] == lesson2_id
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"

                # Clean retry finalizes without moving the enrollment again.
                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                ))
                assert grade["checkpoint"]["status"] == "graded"
                final = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert final["current_lesson_id"] == lesson2_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_crash_during_finalize_then_retry_finalizes_cleanly():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                # Claim cleanly.
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass

                # Resume, letting the CAS + homework-assign succeed, but
                # fail the FIRST checkpoint_submissions.find_one_and_update
                # in this resume — the finalize call itself.
                with _fail_only_nth_call("checkpoint_submissions", "find_one_and_update", 1):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass

                moved = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert moved["current_lesson_id"] == lesson2_id
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"

                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                ))
                assert grade["checkpoint"]["status"] == "graded"
                final = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert final["current_lesson_id"] == lesson2_id  # never double-advanced
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_enrollment_moved_to_unrelated_position_between_claim_and_resume_surfaces_explicit_conflict():
    with _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=3, checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson3_id = prog["modules"][0]["lessons"][2]["id"]
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                # Claim (pending -> grading), interrupted before the CAS.
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass

                # Simulate "some other write moved the enrollment" — jump
                # straight to lesson 3, neither the expected source
                # (lesson 1) nor this grading plan's intended target
                # (lesson 2).
                run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_lesson_id": lesson3_id}}))

                try:
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert False, "expected 409 state conflict"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
                    assert exc.detail["error_code"] == "checkpoint_advance_state_conflict"

                # Never falsely finalized as success.
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"
                assert raw["last_advance_conflict_at"]
                # The unrelated position was left completely untouched.
                still = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert still["current_lesson_id"] == lesson3_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_concurrent_grade_calls_on_pending_submission_advance_exactly_once():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                async def _go():
                    return await asyncio.gather(
                        server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin),
                        server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin),
                        return_exceptions=True,
                    )
                results = run(_go())
                for r in results:
                    assert not isinstance(r, Exception), f"unexpected exception: {r}"
                for r in results:
                    assert r["checkpoint"]["status"] == "graded"

                final = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert final["current_lesson_id"] == lesson2_id  # never skipped ahead
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_concurrent_resumes_of_grading_submission_advance_exactly_once():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                # Get it stuck in "grading" with the enrollment NOT yet moved.
                with _fail_only_nth_call("dog_programs", "find_one", 2):
                    try:
                        run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                        assert False
                    except RuntimeError:
                        pass
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw["status"] == "grading"
                still = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert still["current_lesson_id"] == lesson1_id

                async def _go():
                    return await asyncio.gather(
                        server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin),
                        server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin),
                        return_exceptions=True,
                    )
                results = run(_go())
                for r in results:
                    assert not isinstance(r, Exception), f"unexpected exception: {r}"
                    assert r["checkpoint"]["status"] == "graded"

                final = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert final["current_lesson_id"] == lesson2_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_notification_sent_at_most_once_across_interruption_and_retry():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)

                calls = {"n": 0}
                orig = server.notify_client_checkpoint_graded

                async def _counting(*args, **kwargs):
                    calls["n"] += 1
                    return await orig(*args, **kwargs)

                server.notify_client_checkpoint_graded = _counting
                try:
                    # Fresh pending->graded flow: checkpoint_submissions
                    # find_one_and_update #1=claim, #2=finalize, #3=notification
                    # claim. Fail #3 so grading fully succeeds but the
                    # notification claim never completes.
                    with _fail_only_nth_call("checkpoint_submissions", "find_one_and_update", 3):
                        grade = run(server.admin_school_checkpoint_grade(
                            sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                        ))
                    # The endpoint itself must NOT fail — grading succeeded;
                    # notification failure is swallowed and logged.
                    assert grade["checkpoint"]["status"] == "graded"
                    assert calls["n"] == 0

                    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                    assert not raw.get("notification_sent")

                    # Retry (submission already "graded") — this time the
                    # notification claim succeeds, sends exactly once.
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert calls["n"] == 1

                    # A THIRD call must not send a second time.
                    run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 5}, outcome="advance"), admin,
                    ))
                    assert calls["n"] == 1
                finally:
                    server.notify_client_checkpoint_graded = orig
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Structured remediation — prescribe_practice
# ---------------------------------------------------------------------------

def test_prescribe_practice_repeat_current_recipe_gates_resubmission_on_new_practice():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                original_hw_id = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "homework_id": 1}))["homework_id"]

                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(
                        handler_scores={handler_id: 2}, dog_scores={dog_crit_id: 2}, feedback="Work on it.",
                        outcome="prescribe_practice",
                        prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe", min_practice_sessions_required=2),
                    ), admin,
                ))
                cp = grade["checkpoint"]
                assert cp["status"] == "graded"
                assert cp["prescription"]["tracked_homework_id"] == original_hw_id

                # No enrollment movement.
                fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert fresh["current_lesson_id"] == lesson1_id

                # Resubmission blocked — zero new practice yet.
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
                    assert "2 more time" in exc.detail

                run(server.log_section(original_hw_id, server.SectionLogIn(section_id="practice"), client_user))
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
                    assert "1 more time" in exc.detail

                run(server.log_section(original_hw_id, server.SectionLogIn(section_id="practice"), client_user))
                out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                assert out["checkpoint"]["status"] == "awaiting_review"
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_prescribe_practice_assign_recipe_creates_and_tracks_new_homework():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _homework_template("second") as (tpl2, _admin2):
            with _client_and_dog() as (c, dog):
                se, enr = _enroll(prog, dog, admin)
                try:
                    client_user = _client_user(c["id"])
                    sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                    original_hw_id = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "homework_id": 1}))["homework_id"]

                    grade = run(server.admin_school_checkpoint_grade(
                        sub_id, server.CheckpointGradeIn(
                            handler_scores={handler_id: 2}, dog_scores={dog_crit_id: 2},
                            outcome="prescribe_practice",
                            prescription=server.CheckpointPrescriptionIn(action="assign_recipe", homework_template_id=tpl2["id"], min_practice_sessions_required=1),
                        ), admin,
                    ))
                    tracked_id = grade["checkpoint"]["prescription"]["tracked_homework_id"]
                    assert tracked_id != original_hw_id
                    new_hw = run(server.db.homework.find_one({"id": tracked_id}, {"_id": 0}))
                    assert new_hw["source_lesson_id"] == lesson1_id
                    assert new_hw["assigned_by"] == "Trainer prescription"

                    # Practicing the ORIGINAL homework does not count toward
                    # the new prescribed recipe's minimum.
                    run(server.log_section(original_hw_id, server.SectionLogIn(section_id="practice"), client_user))
                    try:
                        run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                        assert False, "expected 422"
                    except server.HTTPException as exc:
                        assert exc.status_code == 422

                    run(server.log_section(tracked_id, server.SectionLogIn(section_id="practice"), client_user))
                    out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert out["checkpoint"]["status"] == "awaiting_review"
                finally:
                    _cleanup_school(se["id"], enr["id"])


def test_prescribe_practice_assign_refresher_lesson_grants_narrow_access_without_moving_enrollment():
    with _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=3, checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                lesson3_id = prog["modules"][0]["lessons"][2]["id"]

                # Ordinary locked lesson, before any prescription — 403.
                try:
                    run(server.portal_school_lesson_detail(se["id"], lesson2_id, client_user))
                    assert False, "expected 403"
                except server.HTTPException as exc:
                    assert exc.status_code == 403

                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(
                        handler_scores={handler_id: 2}, dog_scores={dog_crit_id: 2},
                        outcome="prescribe_practice",
                        prescription=server.CheckpointPrescriptionIn(action="assign_refresher_lesson", refresher_lesson_id=lesson2_id),
                    ), admin,
                ))
                assert grade["checkpoint"]["prescription"]["tracked_homework_id"]

                # Explicitly prescribed refresher lesson: now accessible.
                detail = run(server.portal_school_lesson_detail(se["id"], lesson2_id, client_user))
                assert detail["lesson"]["id"] == lesson2_id
                practice = run(server.portal_school_start_practice(se["id"], lesson2_id, client_user))
                assert practice["homework_id"]

                # A DIFFERENT locked lesson remains inaccessible.
                try:
                    run(server.portal_school_lesson_detail(se["id"], lesson3_id, client_user))
                    assert False, "expected 403"
                except server.HTTPException as exc:
                    assert exc.status_code == 403

                # Enrollment position never moved.
                fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_module_id": 1, "current_lesson_id": 1}))
                assert fresh["current_lesson_id"] == lesson1_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_prescribe_practice_no_minimum_allows_resubmission_after_any_practice():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                original_hw_id = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "homework_id": 1}))["homework_id"]

                run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(
                        handler_scores={handler_id: 3}, dog_scores={dog_crit_id: 3},
                        outcome="prescribe_practice",
                        prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe"),
                    ), admin,
                ))
                run(server.log_section(original_hw_id, server.SectionLogIn(section_id="practice"), client_user))
                out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                assert out["checkpoint"]["status"] == "awaiting_review"
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Trainer Assist — a real hold
# ---------------------------------------------------------------------------

def test_trainer_assist_recommended_blocks_resubmission_until_cleared():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, lesson1_id = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                original_hw_id = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "homework_id": 1}))["homework_id"]

                grade = run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(
                        handler_scores={handler_id: 1}, dog_scores={dog_crit_id: 1},
                        feedback="Let's work on this together in person.", outcome="trainer_assist_recommended",
                    ), admin,
                ))
                assert grade["checkpoint"]["outcome"] == "trainer_assist_recommended"
                fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert fresh["current_lesson_id"] == lesson1_id  # no advancement

                run(server.log_section(original_hw_id, server.SectionLogIn(section_id="practice"), client_user))
                try:
                    run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

                cleared = run(server.admin_school_checkpoint_clear_trainer_assist_hold(sub_id, admin))
                assert cleared["checkpoint"]["trainer_assist_hold_active"] is False
                assert cleared["checkpoint"]["hold_cleared_at"]

                # No fabricated progress/scores from clearing.
                after_clear = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert after_clear["handler_scores"] == {handler_id: 1}
                fresh2 = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1, "goal_progress": 1}))
                assert fresh2["current_lesson_id"] == lesson1_id

                out = run(server.portal_school_submit_checkpoint(se["id"], lesson1_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
                assert out["checkpoint"]["status"] == "awaiting_review"
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_clear_trainer_assist_hold_is_idempotent():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 1}, dog_scores={dog_crit_id: 1}, outcome="trainer_assist_recommended"), admin,
                ))
                first = run(server.admin_school_checkpoint_clear_trainer_assist_hold(sub_id, admin))
                second = run(server.admin_school_checkpoint_clear_trainer_assist_hold(sub_id, admin))
                assert first["checkpoint"]["trainer_assist_hold_active"] is False
                assert second["checkpoint"]["trainer_assist_hold_active"] is False  # no-op, not an error
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_pending_queue_surfaces_active_trainer_assist_hold_until_cleared():
    """A graded trainer_assist_recommended submission has nowhere else to
    have its hold cleared from — the pending queue must surface it (a
    distinct queue_state) until a trainer clears it, then it must drop out
    of the queue like any other resolved item."""
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 1}, dog_scores={dog_crit_id: 1}, outcome="trainer_assist_recommended"), admin,
                ))
                queue = run(server.admin_school_checkpoints_pending(admin))
                row = next(r for r in queue if r["id"] == sub_id)
                assert row["queue_state"] == "trainer_assist_hold"
                assert row["trainer_assist_hold_active"] is True

                run(server.admin_school_checkpoint_clear_trainer_assist_hold(sub_id, admin))
                queue_after = run(server.admin_school_checkpoints_pending(admin))
                assert all(r["id"] != sub_id for r in queue_after)
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_clear_trainer_assist_hold_permission_gated():
    with _school_program(delivery_mode="self_guided", checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                client_user = _client_user(c["id"])
                sub_id, handler_id, dog_crit_id, _ = _submit_checkpoint_for_current_lesson(se, enr, client_user)
                run(server.admin_school_checkpoint_grade(
                    sub_id, server.CheckpointGradeIn(handler_scores={handler_id: 1}, dog_scores={dog_crit_id: 1}, outcome="trainer_assist_recommended"), admin,
                ))
                fd_uid, fd_h = _insert_staff("front_desk")
                try:
                    r = client.post(f"/api/admin/school/checkpoints/{sub_id}/clear-trainer-assist-hold", headers=fd_h)
                    assert r.status_code == 403, r.text
                finally:
                    run(server.db.users.delete_one({"id": fd_uid}))
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Generic practice-session counting across homework flavors
# ---------------------------------------------------------------------------

def test_count_practice_sessions_since_section_log_style():
    hw_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": "x", "section_logs": [
            {"logged_at": "2026-01-01T00:00:00"}, {"logged_at": "2026-01-02T00:00:00"}, {"logged_at": "2026-01-03T00:00:00"},
        ],
    }))
    try:
        assert run(server._count_practice_sessions_since(hw_id, "2026-01-01T12:00:00")) == 2
        assert run(server._count_practice_sessions_since(hw_id, "2026-01-03T12:00:00")) == 0
        assert run(server._count_practice_sessions_since(None, "2026-01-01T00:00:00")) == 0
        # Online School Phase 3 — since_iso=None means "no lower bound":
        # every logged session counts (generalized for the graduation
        # completion_summary's whole-program practice total).
        assert run(server._count_practice_sessions_since(hw_id, None)) == 3
    finally:
        run(server.db.homework.delete_one({"id": hw_id}))


def test_count_practice_sessions_since_daily_tracker_excludes_rest_and_skipped():
    hw_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": "x", "daily_tracker": True, "section_logs": [
            {"logged_at": "2026-01-01T00:00:00", "submission_status": "submitted"},
            {"logged_at": "2026-01-02T00:00:00", "submission_status": "rest"},
            {"logged_at": "2026-01-03T00:00:00", "submission_status": "skipped"},
            {"logged_at": "2026-01-04T00:00:00", "submission_status": "approved"},
            {"logged_at": "2026-01-05T00:00:00", "submission_status": "draft"},
        ],
    }))
    try:
        assert run(server._count_practice_sessions_since(hw_id, "2025-12-31T00:00:00")) == 2  # only submitted + approved
    finally:
        run(server.db.homework.delete_one({"id": hw_id}))
