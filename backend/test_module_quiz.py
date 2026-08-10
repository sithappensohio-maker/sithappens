"""Module Quiz — authoring/stamping/validation, snapshot freezing, client
endpoints (sanitization + server-side grading + idempotency), and the
progression gate (self-advance, checkpoint deferral, course completion).

Same fixture/cleanup conventions as test_online_school_checkpoints.py:
in-process calls to the async server functions via the shared event loop,
disposable rows tagged TEST_MODULE_QUIZ, per-test cleanup.
"""
import base64
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_MODULE_QUIZ"


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


@contextlib.contextmanager
def _homework_template(name_suffix="A"):
    admin = _admin_user()
    body = server.HomeworkTemplateIn(
        name=f"{TAG} Template {name_suffix} {uuid.uuid4().hex[:6]}",
        sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}],
    )
    tpl = run(server.create_homework_template(body, admin))
    try:
        yield tpl, admin
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def _checkpoint_config():
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity", guidance="Cue once.")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        pass_readiness_guidance="Look for 3+ clean reps.",
    )


def _two_question_quiz(passing=80):
    """Two MC questions with explicit stable option ids so tests know the
    correct answers without peeking at grading internals."""
    q1_right = server.ModuleQuizOptionIn(id=str(uuid.uuid4()), text="Mark then reward")
    q1_wrong = server.ModuleQuizOptionIn(id=str(uuid.uuid4()), text="Repeat the cue louder")
    q2_true = server.ModuleQuizOptionIn(id=str(uuid.uuid4()), text="True")
    q2_false = server.ModuleQuizOptionIn(id=str(uuid.uuid4()), text="False")
    return server.ModuleQuizConfigIn(
        enabled=True, title=f"{TAG} Knowledge Check", instructions="Answer honestly.",
        passing_score=passing,
        questions=[
            server.ModuleQuizQuestionIn(
                id=str(uuid.uuid4()), type="multiple_choice", question="What happens after a correct rep?",
                options=[q1_right, q1_wrong], correct_option_id=q1_right.id,
                explanation="Mark the moment, then pay.",
            ),
            server.ModuleQuizQuestionIn(
                id=str(uuid.uuid4()), type="true_false", question="You should end sessions on a win.",
                options=[q2_true, q2_false], correct_option_id=q2_true.id,
                explanation="Short and successful beats long and messy.",
            ),
        ],
    )


@contextlib.contextmanager
def _quiz_program(n_modules=2, n_lessons_per_module=2, quiz_module_idx=0, checkpoint_lesson_idx=None, passing=80):
    """Curriculum with practice templates on every lesson, an enabled Module
    Quiz on module `quiz_module_idx`, and (optionally) a checkpoint on the
    flat lesson index `checkpoint_lesson_idx`."""
    admin = _admin_user()
    with contextlib.ExitStack() as stack:
        tpls = [stack.enter_context(_homework_template(str(i)))[0] for i in range(n_modules * n_lessons_per_module)]
        tpl_ids = [t["id"] for t in tpls]
        modules = []
        for mi in range(n_modules):
            goals = [server.GoalIn(name=f"Skill M{mi}L{li}") for li in range(n_lessons_per_module)]
            modules.append(server.ModuleIn(name=f"Module {mi + 1}", order=mi, goals=goals))
        prog = run(server.create_program(server.ProgramIn(
            name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
            format={"count": n_modules, "unit": "modules"}, price=0,
            delivery_mode="self_guided", modules=modules,
        ), admin))
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
                    client_overview="Overview", suggested_homework_template_ids=[tpl_ids[tid]],
                    checkpoint=cp,
                ))
                tid += 1
                flat_idx += 1
            fixed_modules.append(server.ModuleIn(
                id=m["id"], name=m["name"], order=m["order"],
                goals=[server.GoalIn(**g) for g in m["goals"]], lessons=lessons,
                module_quiz=_two_question_quiz(passing=passing) if mi == quiz_module_idx else None,
            ))
        prog = run(server.update_program(prog["id"], server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode="self_guided", modules=fixed_modules,
        ), cascade=False, save_as_draft=False, _=admin))
        try:
            yield prog, admin
        finally:
            run(server.db.programs.delete_one({"id": prog["id"]}))


def _enroll(prog, dog, admin):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    return res["school_enrollment"], res["enrollment"]


def _cleanup_school(school_id, enrollment_id):
    subs = run(server.db.checkpoint_submissions.find({"school_enrollment_id": school_id}, {"_id": 0, "video_media_id": 1}).to_list(50))
    media_ids = [s["video_media_id"] for s in subs if s.get("video_media_id")]
    if media_ids:
        run(server.db.homework_media.delete_many({"id": {"$in": media_ids}}))
    run(server.db.checkpoint_submissions.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_quiz_attempts.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_events.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_notifications.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"assigned_by": {"$regex": "^Online School"}}))


def _practice_current_lesson(se, enr, client_user):
    lesson_id = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
    started = run(server.portal_school_start_practice(se["id"], lesson_id, client_user))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
    return lesson_id, started["homework_id"]


def _position(enr_id):
    row = run(server.db.dog_programs.find_one({"id": enr_id}, {"_id": 0, "current_module_id": 1, "current_lesson_id": 1, "status": 1}))
    return row


def _snapshot_quiz(enr_id, module_idx=0):
    enr = run(server.db.dog_programs.find_one({"id": enr_id}, {"_id": 0, "program_snapshot": 1}))
    return (enr["program_snapshot"]["modules"][module_idx]).get("module_quiz")


def _correct_answers(quiz_cfg):
    return [{"question_id": q["id"], "selected_option_id": q["correct_option_id"]} for q in quiz_cfg["questions"]]


def _wrong_answers(quiz_cfg):
    out = []
    for q in quiz_cfg["questions"]:
        wrong = next(o["id"] for o in q["options"] if o["id"] != q["correct_option_id"])
        out.append({"question_id": q["id"], "selected_option_id": wrong})
    return out


def _submit(se_id, module_id, answers, client_user, key=None):
    body = server.ModuleQuizSubmitIn(
        answers=[server.ModuleQuizAnswerIn(**a) for a in answers],
        idempotency_key=key or uuid.uuid4().hex,
    )
    return run(server.portal_school_module_quiz_submit(se_id, module_id, body, client_user))


def _tiny_video(raw_bytes=1000, mime="video/mp4"):
    return f"data:{mime};base64," + base64.b64encode(b"x" * raw_bytes).decode()


def _submit_and_grade_checkpoint(se, enr, client_user, admin, outcome="advance", prescription=None):
    lesson_id, _hw = _practice_current_lesson(se, enr, client_user)
    out = run(server.portal_school_submit_checkpoint(se["id"], lesson_id, server.CheckpointSubmissionIn(video=_tiny_video()), client_user))
    sub_id = out["checkpoint"]["id"]
    raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0, "rubric_snapshot": 1}))
    handler_id = raw["rubric_snapshot"]["handler_criteria"][0]["id"]
    dog_crit_id = raw["rubric_snapshot"]["dog_criteria"][0]["id"]
    body = server.CheckpointGradeIn(
        handler_scores={handler_id: 4}, dog_scores={dog_crit_id: 4},
        feedback="Nice work.", outcome=outcome, prescription=prescription,
    )
    graded = run(server.admin_school_checkpoint_grade(sub_id, body, admin))
    return sub_id, graded


# ---------------------------------------------------------------------------
# Authoring model — stamping, validation, snapshot
# ---------------------------------------------------------------------------

def test_stamped_quiz_ids_are_stable_and_generated():
    quiz = _two_question_quiz()
    modules = server._stamp_ids([{
        "name": "M1", "goals": [], "lessons": [],
        "module_quiz": quiz.model_dump(),
    }])
    stamped = modules[0]["module_quiz"]
    assert stamped["enabled"] is True
    # Provided ids survive
    assert stamped["questions"][0]["id"] == quiz.questions[0].id
    assert {o["id"] for o in stamped["questions"][0]["options"]} == {o.id for o in quiz.questions[0].options}
    # Missing ids get generated
    modules2 = server._stamp_ids([{
        "name": "M1", "goals": [], "lessons": [],
        "module_quiz": {"enabled": True, "questions": [
            {"type": "multiple_choice", "question": "Q?", "options": [{"text": "A"}, {"text": "B"}]},
        ]},
    }])
    q = modules2[0]["module_quiz"]["questions"][0]
    assert q["id"] and all(o["id"] for o in q["options"])
    # Re-stamping keeps generated ids
    restamped = server._stamp_ids(modules2)[0]["module_quiz"]["questions"][0]
    assert restamped["id"] == q["id"]
    assert [o["id"] for o in restamped["options"]] == [o["id"] for o in q["options"]]


def test_true_false_options_keep_ids_across_restamp():
    modules = server._stamp_ids([{
        "name": "M1", "goals": [], "lessons": [],
        "module_quiz": {"enabled": True, "questions": [
            {"type": "true_false", "question": "T or F?", "options": []},
        ]},
    }])
    q = modules[0]["module_quiz"]["questions"][0]
    assert [o["text"] for o in q["options"]] == ["True", "False"]
    restamped = server._stamp_ids(modules)[0]["module_quiz"]["questions"][0]
    assert [o["id"] for o in restamped["options"]] == [o["id"] for o in q["options"]]


def test_validation_blocks_broken_enabled_quiz_but_not_disabled():
    # Disabled / absent quiz → valid regardless of content.
    ok = run(server._validate_program_structure([
        {"id": "m1", "name": "M1", "goals": [], "lessons": [], "module_quiz": None},
        {"id": "m2", "name": "M2", "goals": [], "lessons": [],
         "module_quiz": {"enabled": False, "questions": []}},
    ]))
    assert not [e for e in ok["errors"] if e["code"].startswith("module_quiz")]

    # Enabled quiz with problems → hard errors.
    bad = run(server._validate_program_structure([
        {"id": "m1", "name": "M1", "goals": [], "lessons": [], "module_quiz": {
            "enabled": True, "passing_score": 150, "questions": [
                {"id": "q1", "question": "", "options": [{"id": "o1", "text": "A"}],
                 "correct_option_id": "nope", "review_lesson_id": "ghost-lesson"},
            ],
        }},
    ]))
    codes = {e["code"] for e in bad["errors"]}
    assert "module_quiz_invalid_passing_score" in codes
    assert "module_quiz_blank_question" in codes
    assert "module_quiz_too_few_options" in codes
    assert "module_quiz_invalid_correct_option" in codes
    assert "module_quiz_invalid_review_lesson" in codes

    # Zero questions on an enabled quiz is its own hard error.
    empty = run(server._validate_program_structure([
        {"id": "m1", "name": "M1", "goals": [], "lessons": [],
         "module_quiz": {"enabled": True, "passing_score": 80, "questions": []}},
    ]))
    assert "module_quiz_no_questions" in {e["code"] for e in empty["errors"]}


def test_quiz_enters_enrollment_snapshot_and_live_edit_does_not_leak():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                snap_quiz = _snapshot_quiz(enr["id"])
                assert snap_quiz and snap_quiz["enabled"] is True
                assert len(snap_quiz["questions"]) == 2
                assert all(q["id"] for q in snap_quiz["questions"])
                # Edit the LIVE program (disable the quiz) — the enrolled
                # student's frozen snapshot must not change.
                run(server.db.programs.update_one(
                    {"id": prog["id"]}, {"$set": {"modules.0.module_quiz.enabled": False}},
                ))
                assert _snapshot_quiz(enr["id"])["enabled"] is True
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Security — sanitization, fake input, foreign/locked access
# ---------------------------------------------------------------------------

def test_quiz_get_never_leaks_correct_answers():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module_id = prog["modules"][0]["id"]
                # Reach the quiz boundary (practice both lessons of module 1).
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                out = run(server.portal_school_module_quiz(se["id"], module_id, cu))
                assert out["status"] == "available"
                assert out["questions"], "questions must be included when available"
                blob = str(out)
                assert "correct_option_id" not in blob
                assert "explanation" not in blob
                assert "review_lesson_id" not in blob
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_submit_model_has_no_client_score_fields():
    fields = set(server.ModuleQuizSubmitIn.model_fields)
    assert fields == {"answers", "idempotency_key"}
    assert set(server.ModuleQuizAnswerIn.model_fields) == {"question_id", "selected_option_id"}


def test_invalid_option_unknown_question_and_incomplete_rejected():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module_id = prog["modules"][0]["id"]
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                quiz = _snapshot_quiz(enr["id"])
                good = _correct_answers(quiz)

                # Unknown question id
                try:
                    _submit(se["id"], module_id, good + [{"question_id": "ghost", "selected_option_id": "x"}], cu)
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422 and exc.detail["error_code"] == "module_quiz_unknown_question"

                # Option from the WRONG question
                crossed = [dict(good[0]), dict(good[1])]
                crossed[0]["selected_option_id"] = good[1]["selected_option_id"]
                try:
                    _submit(se["id"], module_id, crossed, cu)
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422 and exc.detail["error_code"] == "module_quiz_invalid_option"

                # Missing an answer
                try:
                    _submit(se["id"], module_id, good[:1], cu)
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422 and exc.detail["error_code"] == "module_quiz_incomplete"
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_foreign_enrollment_denied():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            with _client_and_dog() as (other_c, _other_dog):
                se, enr = _enroll(prog, dog, admin)
                try:
                    stranger = _client_user(other_c["id"])
                    module_id = prog["modules"][0]["id"]
                    try:
                        run(server.portal_school_module_quiz(se["id"], module_id, stranger))
                        assert False, "expected denial"
                    except server.HTTPException as exc:
                        assert exc.status_code in (403, 404)
                    try:
                        quiz = _snapshot_quiz(enr["id"])
                        _submit(se["id"], module_id, _correct_answers(quiz), stranger)
                        assert False, "expected denial"
                    except server.HTTPException as exc:
                        assert exc.status_code in (403, 404)
                finally:
                    _cleanup_school(se["id"], enr["id"])


def test_future_module_quiz_locked_and_submit_denied():
    with _quiz_program(quiz_module_idx=1) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module2_id = prog["modules"][1]["id"]
                out = run(server.portal_school_module_quiz(se["id"], module2_id, cu))
                assert out["status"] == "locked"
                assert out["questions"] is None
                quiz = _snapshot_quiz(enr["id"], module_idx=1)
                try:
                    _submit(se["id"], module2_id, _correct_answers(quiz), cu)
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409 and exc.detail["error_code"] == "module_quiz_locked"
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Progression gate — self-advance path
# ---------------------------------------------------------------------------

def test_quiz_gate_blocks_module_boundary_and_pass_advances_once():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module1_id = prog["modules"][0]["id"]
                module2_id = prog["modules"][1]["id"]

                # Mid-module advance is NOT gated.
                _practice_current_lesson(se, enr, cu)
                adv = run(server.portal_school_advance(se["id"], cu))
                assert adv["current_module_id"] == module1_id

                # Boundary advance IS gated (server-side, structured error).
                _practice_current_lesson(se, enr, cu)
                try:
                    run(server.portal_school_advance(se["id"], cu))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
                    assert exc.detail["error_code"] == "module_quiz_required"
                    assert exc.detail["module_id"] == module1_id
                    assert exc.detail["quiz_available"] is True
                pos = _position(enr["id"])
                assert pos["current_module_id"] == module1_id

                quiz = _snapshot_quiz(enr["id"])

                # Failed attempt → stored, no advancement, gate still holds.
                res_fail = _submit(se["id"], module1_id, _wrong_answers(quiz), cu)
                assert res_fail["passed"] is False and res_fail["advanced"] is False
                assert res_fail["score_percent"] == 0.0
                assert _position(enr["id"])["current_module_id"] == module1_id
                # Result reveals answers + explanations AFTER grading.
                assert all(r["correct_answer"] for r in res_fail["results"])
                assert any(r["explanation"] for r in res_fail["results"])

                # Passing attempt → advances exactly once into module 2.
                res_pass = _submit(se["id"], module1_id, _correct_answers(quiz), cu)
                assert res_pass["passed"] is True and res_pass["advanced"] is True
                assert res_pass["score_percent"] == 100.0
                pos = _position(enr["id"])
                assert pos["current_module_id"] == module2_id

                # MODULE_COMPLETED emitted exactly once, only after the pass.
                n = run(server.db.school_events.count_documents(
                    {"dedupe_key": f"module_completed:{enr['id']}:{module1_id}"}))
                assert n == 1

                # A fresh (different-key) submission after passing → 409.
                try:
                    _submit(se["id"], module1_id, _correct_answers(quiz), cu)
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409 and exc.detail["error_code"] == "module_quiz_already_passed"
                assert _position(enr["id"])["current_module_id"] == module2_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_double_submit_same_idempotency_key_replays_without_double_advance():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module1_id = prog["modules"][0]["id"]
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                quiz = _snapshot_quiz(enr["id"])
                key = uuid.uuid4().hex
                first = _submit(se["id"], module1_id, _correct_answers(quiz), cu, key=key)
                assert first["passed"] is True
                replay = _submit(se["id"], module1_id, _correct_answers(quiz), cu, key=key)
                assert replay["replayed"] is True
                assert replay["attempt_id"] == first["attempt_id"]
                attempts = run(server.db.school_quiz_attempts.count_documents(
                    {"school_enrollment_id": se["id"], "module_id": module1_id}))
                assert attempts == 1
                assert _position(enr["id"])["current_module_id"] == prog["modules"][1]["id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_final_module_quiz_delays_course_completion_until_pass():
    with _quiz_program(n_modules=1) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module_id = prog["modules"][0]["id"]
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                try:
                    run(server.portal_school_advance(se["id"], cu))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409 and exc.detail["error_code"] == "module_quiz_required"
                # NOT completed yet.
                assert run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0, "status": 1}))["status"] != "completed"

                quiz = _snapshot_quiz(enr["id"])
                res = _submit(se["id"], module_id, _correct_answers(quiz), cu)
                assert res["passed"] is True and res["course_completed"] is True
                assert run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0, "status": 1}))["status"] == "completed"
                assert _position(enr["id"])["status"] == "completed"
                n = run(server.db.school_events.count_documents({"dedupe_key": f"course_completed:{enr['id']}"}))
                assert n == 1
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_pre_quiz_snapshot_advances_exactly_as_before():
    # quiz_module_idx=None is not supported by the fixture; build via idx
    # beyond range so no module gets a quiz.
    with _quiz_program(quiz_module_idx=99) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                assert _snapshot_quiz(enr["id"]) is None
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                adv = run(server.portal_school_advance(se["id"], cu))
                assert adv["current_module_id"] == prog["modules"][1]["id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Checkpoint + quiz interaction
# ---------------------------------------------------------------------------

def test_checkpoint_pass_defers_advancement_until_quiz_pass():
    # Checkpoint on the LAST lesson of module 1 (flat idx 1), quiz on module 1.
    with _quiz_program(checkpoint_lesson_idx=1) as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module1_id = prog["modules"][0]["id"]
                module2_id = prog["modules"][1]["id"]
                final_lesson_id = prog["modules"][0]["lessons"][1]["id"]

                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))

                # Quiz is locked until the checkpoint passes.
                out = run(server.portal_school_module_quiz(se["id"], module1_id, cu))
                assert out["status"] == "locked"

                sub_id, graded = _submit_and_grade_checkpoint(se, enr, cu, admin, outcome="advance")
                # Checkpoint finalized as PASSED…
                assert graded["checkpoint"]["status"] == "graded"
                assert graded["checkpoint"]["outcome"] == "advance"
                raw = run(server.db.checkpoint_submissions.find_one({"id": sub_id}, {"_id": 0}))
                assert raw.get("progression_deferred_for_module_quiz") is True
                # …but the enrollment did NOT move.
                pos = _position(enr["id"])
                assert pos["current_module_id"] == module1_id
                assert pos["current_lesson_id"] == final_lesson_id
                # MODULE_COMPLETED must NOT exist yet.
                assert run(server.db.school_events.count_documents(
                    {"dedupe_key": f"module_completed:{enr['id']}:{module1_id}"})) == 0

                # Retrying the SAME grade request must not suddenly advance.
                raw_grade = run(server.admin_school_checkpoint_grade(sub_id, server.CheckpointGradeIn(
                    handler_scores={}, dog_scores={}, outcome="advance"), admin))
                assert raw_grade["checkpoint"]["status"] == "graded"
                assert _position(enr["id"])["current_lesson_id"] == final_lesson_id

                # Quiz is now available; passing it advances into module 2.
                out = run(server.portal_school_module_quiz(se["id"], module1_id, cu))
                assert out["status"] == "available"
                quiz = _snapshot_quiz(enr["id"])
                res = _submit(se["id"], module1_id, _correct_answers(quiz), cu)
                assert res["passed"] is True and res["advanced"] is True
                assert _position(enr["id"])["current_module_id"] == module2_id
                assert run(server.db.school_events.count_documents(
                    {"dedupe_key": f"module_completed:{enr['id']}:{module1_id}"})) == 1
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_prescribe_practice_and_trainer_assist_keep_quiz_locked():
    for outcome, prescription in (
        ("prescribe_practice", server.CheckpointPrescriptionIn(action="repeat_current_recipe")),
        ("trainer_assist_recommended", None),
    ):
        with _quiz_program(checkpoint_lesson_idx=1) as (prog, admin):
            with _client_and_dog() as (c, dog):
                se, enr = _enroll(prog, dog, admin)
                try:
                    cu = _client_user(c["id"])
                    module1_id = prog["modules"][0]["id"]
                    _practice_current_lesson(se, enr, cu)
                    run(server.portal_school_advance(se["id"], cu))
                    _submit_and_grade_checkpoint(se, enr, cu, admin, outcome=outcome, prescription=prescription)
                    out = run(server.portal_school_module_quiz(se["id"], module1_id, cu))
                    assert out["status"] == "locked", f"{outcome} must keep the quiz locked"
                    quiz = _snapshot_quiz(enr["id"])
                    try:
                        _submit(se["id"], module1_id, _correct_answers(quiz), cu)
                        assert False, "expected 409"
                    except server.HTTPException as exc:
                        assert exc.status_code == 409 and exc.detail["error_code"] == "module_quiz_locked"
                finally:
                    _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Attempts & history
# ---------------------------------------------------------------------------

def test_attempts_store_snapshot_numbering_and_summaries():
    with _quiz_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            se, enr = _enroll(prog, dog, admin)
            try:
                cu = _client_user(c["id"])
                module1_id = prog["modules"][0]["id"]
                _practice_current_lesson(se, enr, cu)
                run(server.portal_school_advance(se["id"], cu))
                _practice_current_lesson(se, enr, cu)
                quiz = _snapshot_quiz(enr["id"])

                # Attempt 1: half right (50% < 80% → fail)
                mixed = [_correct_answers(quiz)[0], _wrong_answers(quiz)[1]]
                res1 = _submit(se["id"], module1_id, mixed, cu)
                assert res1["passed"] is False and res1["attempt_number"] == 1
                assert res1["score_percent"] == 50.0

                res2 = _submit(se["id"], module1_id, _correct_answers(quiz), cu)
                assert res2["passed"] is True and res2["attempt_number"] == 2

                rows = run(server.portal_school_module_quiz_attempts(se["id"], module1_id, cu))
                assert [r["attempt_number"] for r in rows] == [1, 2]
                assert rows[0]["passed"] is False and rows[1]["passed"] is True

                # Attempt keeps its own frozen quiz snapshot.
                stored = run(server.db.school_quiz_attempts.find_one(
                    {"school_enrollment_id": se["id"], "module_id": module1_id, "attempt_number": 1}, {"_id": 0}))
                assert len(stored["quiz_snapshot"]["questions"]) == 2
                assert stored["quiz_snapshot"]["passing_score"] == 80

                # GET summary reflects best/attempts (quiz passed now).
                out = run(server.portal_school_module_quiz(se["id"], module1_id, cu))
                assert out["status"] == "passed"
                assert out["attempt_count"] == 2 and out["best_score"] == 100.0
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_quiz_attempts_participate_in_backups():
    assert "school_quiz_attempts" in server.BACKUP_COLLECTIONS
