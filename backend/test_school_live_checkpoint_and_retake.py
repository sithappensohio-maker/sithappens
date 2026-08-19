"""School consolidation — live trainer checkpoints, Repeat Program, and the
owner-directed B4/B5/B6 authorization + delivery-mode rules.

Companion to test_school_unified_delivery.py. Everything here drives the REAL
endpoints against the disposable DB; nothing is hand-mocked, and the live
checkpoint path is asserted to reuse the SAME canonical
checkpoint_submissions + grading state machine as a client video submission
(no special-case advancement). Tag TEST_SLC.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_SLC"


def _admin():
    return {"id": f"{TAG}-admin", "name": f"{TAG} Admin", "email": "slc@test", "role": "admin"}


def _staff(staff_role="trainer"):
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.invalid",
        "name": f"{TAG} {staff_role}", "role": "employee", "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False,
        "needs_password": False,
    }))
    return run(server.db.users.find_one({"id": uid}, {"_id": 0}))


def _client_user(client_id):
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-c-{uuid.uuid4().hex[:6]}@example.invalid",
        "name": f"{TAG} Client User", "role": "client", "client_id": client_id,
        "password_hash": "x", "active": True, "must_change_password": False,
        "needs_password": False,
    }))
    return run(server.db.users.find_one({"id": uid}, {"_id": 0}))


def _checkpoint_config():
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        submission_requirements="Good lighting.", pass_readiness_guidance="3+ clean reps.",
    )


@contextlib.contextmanager
def _program(delivery_mode="both", n_lessons=2):
    """A checkpoint-enabled program; every lesson carries a checkpoint so we
    can assert advancement lesson by lesson."""
    admin = _admin()
    body = server.ProgramIn(
        name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": 1, "unit": "modules"}, price=0, delivery_mode=delivery_mode,
        modules=[server.ModuleIn(name="Module 1", order=0,
                                 goals=[server.GoalIn(name=f"Skill {i}") for i in range(n_lessons)])],
    )
    prog = run(server.create_program(body, admin))
    m = prog["modules"][0]
    goal_ids = [g["id"] for g in m["goals"]]
    lessons = [
        server.LessonIn(
            name=f"Lesson {i + 1}", order=i, active=True, skill_ids=[goal_ids[i]],
            client_overview="overview", why_it_matters="matters.",
            success_criteria="5 in a row.", checkpoint=_checkpoint_config(),
        ) for i in range(n_lessons)
    ]
    fixed = server.ProgramIn(
        name=prog["name"], type="private_lessons", format=prog["format"], price=0,
        delivery_mode=delivery_mode,
        modules=[server.ModuleIn(id=m["id"], name=m["name"], order=m["order"],
                                 goals=[server.GoalIn(**g) for g in m["goals"]], lessons=lessons)],
    )
    prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _client_and_dog():
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@example.invalid"), _admin()))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"},
    }))
    return c, run(server.db.dogs.find_one({"id": did}, {"_id": 0}))


def _enroll(dog, program, mode, user=None):
    return run(server.school_enroll(
        server.SchoolEnrollIn(dog_id=dog["id"], program_id=program["id"], delivery_mode=mode),
        user or _admin()))


def _criteria(enrollment, lesson_id):
    lesson = server._find_lesson_in_snapshot(enrollment, lesson_id)
    cp = lesson["checkpoint"]
    return cp["handler_criteria"][0]["id"], cp["dog_criteria"][0]["id"]


def _live(se_id, lesson_id, enrollment, outcome, user=None, feedback="Live observed."):
    hid, did_ = _criteria(enrollment, lesson_id)
    body = server.CheckpointGradeIn(
        handler_scores={hid: 3}, dog_scores={did_: 3}, feedback=feedback, outcome=outcome,
    )
    return run(server.admin_school_live_checkpoint(se_id, lesson_id, body, user or _admin()))


@pytest.fixture(autouse=True)
def _clean():
    yield
    dog_ids = [d["id"] for d in run(
        server.db.dogs.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1}).to_list(500))]
    for coll in ("dog_programs", "school_enrollments", "homework",
                 "checkpoint_submissions", "school_events", "training_session_log",
                 "training_session_drafts"):
        run(server.db[coll].delete_many({"dog_id": {"$in": dog_ids}}))
    run(server.db.programs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    run(server.db.dogs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.users.delete_many({"name": {"$regex": TAG}}))


# ═══════════════ B4 — outer authorization gate ═══════════════

def test_b4_client_rejected_before_handler():
    """A client must be rejected by the DEPENDENCY, not merely by an in-body
    check — require_employee_or_admin keeps non-staff out entirely."""
    with _program("both") as p:
        c, dog = _client_and_dog()
        cu = _client_user(c["id"])
        dep = server.require_admin_and_any_permission("manage_school", "manage_training_sessions")
        with pytest.raises(server.HTTPException) as e:
            run(dep.__wrapped__(cu)) if hasattr(dep, "__wrapped__") else run(server.require_employee_or_admin(cu))
        assert e.value.status_code == 403
        # …and end-to-end through the route as well.
        for mode in ("online", "in_person", "hybrid"):
            with pytest.raises(server.HTTPException) as e2:
                _enroll(dog, p, mode, user=cu)
            assert e2.value.status_code == 403
        assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"]})) == 0


def test_b4_staff_without_either_permission_rejected(monkeypatch):
    with _program("both") as p:
        c, dog = _client_and_dog()
        fd = _staff("front_desk")
        perms = server._perms_for(fd)
        assert not perms.get("manage_school") and not perms.get("manage_training_sessions")
        with pytest.raises(server.HTTPException) as e:
            _enroll(dog, p, "in_person", user=fd)
        assert e.value.status_code == 403


def test_b4_trainer_may_assign_in_person_and_hybrid_not_online(monkeypatch):
    monkeypatch.setitem(server._ROLE_OVERRIDES, "trainer",
                        {"manage_school": False, "manage_training_sessions": True})
    tr = _staff("trainer")
    assert server._perms_for(tr).get("manage_training_sessions") is True
    assert not server._perms_for(tr).get("manage_school")
    with _program("both") as p:
        c1, d1 = _client_and_dog()
        assert _enroll(d1, p, "in_person", user=tr)["school_enrollment"]["delivery_mode"] == "trainer_led"
        c2, d2 = _client_and_dog()
        assert _enroll(d2, p, "hybrid", user=tr)["school_enrollment"]["delivery_mode"] == "hybrid"
        c3, d3 = _client_and_dog()
        with pytest.raises(server.HTTPException) as e:
            _enroll(d3, p, "online", user=tr)
        assert e.value.status_code == 403


def test_b4_owner_retains_full_control():
    with _program("both") as p:
        for mode in ("in_person", "online", "hybrid"):
            c, dog = _client_and_dog()
            assert _enroll(dog, p, mode)["school_enrollment"]["id"]


# ═══════════════ B5 — one active School enrollment per dog+program ═══════════════

@pytest.mark.parametrize("first,second", [
    ("in_person", "online"), ("online", "in_person"),
    ("hybrid", "online"), ("in_person", "hybrid"), ("online", "hybrid"),
])
def test_b5_second_active_school_enrollment_rejected_across_modes(first, second):
    """Both trainer-led AND online delivery for one program is HYBRID — never
    two School enrollments."""
    with _program("both") as p:
        c, dog = _client_and_dog()
        _enroll(dog, p, first)
        with pytest.raises(server.HTTPException) as e:
            _enroll(dog, p, second)
        assert e.value.status_code == 409
        assert run(server.db.dog_programs.count_documents(
            {"dog_id": dog["id"], "program_id": p["id"], "status": "active"})) == 1
        assert run(server.db.school_enrollments.count_documents(
            {"dog_id": dog["id"], "program_id": p["id"], "status": "active"})) == 1


def test_b5_legacy_dual_enrollment_data_is_preserved_not_rewritten():
    """Legacy rows holding a simultaneous trainer-led + online pair must keep
    working; the new gate governs only NEW School assignment."""
    with _program("both") as p:
        c, dog = _client_and_dog()
        legacy_trainer_led = {
            "id": str(uuid.uuid4()), "dog_id": dog["id"], "program_id": p["id"],
            "status": "active", "goal_progress": {"legacy": True}, "sessions_count": 4,
            "created_at": server.now_iso(),
        }
        run(server.db.dog_programs.insert_one(dict(legacy_trainer_led)))
        _enroll(dog, p, "online")  # legacy online path still allowed alongside it
        rows = run(server.db.dog_programs.find(
            {"dog_id": dog["id"], "program_id": p["id"], "status": "active"},
            {"_id": 0}).to_list(10))
        assert len(rows) == 2, "existing dual-enrollment data must be preserved"
        kept = next(r for r in rows if r["id"] == legacy_trainer_led["id"])
        assert kept["goal_progress"] == {"legacy": True} and kept["sessions_count"] == 4


# ═══════════════ B6 — formal checkpoint by delivery mode ═══════════════

def _advance_to_checkpoint_ready(se, enrollment, dog):
    """Mark the current lesson practiced so a checkpoint is permissible."""
    run(server.db.homework.insert_one({
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "client_id": se["client_id"],
        "title": f"{TAG} practice", "status": "completed",
        "school_enrollment_id": se["id"], "source_lesson_id": enrollment["current_lesson_id"],
        "assigned_by": "School - practice", "created_at": server.now_iso(),
        "completions": [{"at": server.now_iso()}],
    }))


def test_b6_in_person_client_cannot_submit_formal_checkpoint():
    with _program("trainer_led") as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        _advance_to_checkpoint_ready(se, enrollment, dog)
        cu = _client_user(c["id"])
        with pytest.raises(server.HTTPException) as e:
            run(server.portal_school_submit_checkpoint(
                se["id"], enrollment["current_lesson_id"],
                server.CheckpointSubmissionIn(
                    video="data:video/mp4;base64,AAAAAAAAAAAAAAAA",
                    filename="clip.mp4", note=""), cu))
        assert e.value.status_code == 409
        assert "in person" in str(e.value.detail).lower()
        assert run(server.db.checkpoint_submissions.count_documents(
            {"school_enrollment_id": se["id"]})) == 0


def test_b6_in_person_client_keeps_the_rest_of_school():
    """The restriction is narrow: curriculum review and Practice remain."""
    with _program("trainer_led") as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se = res["school_enrollment"]
        cu = _client_user(c["id"])
        home = run(server.portal_school_home(se["id"], cu))
        assert home is not None
        courses = run(server.portal_school_list(cu))
        assert any(e.get("school_enrollment_id") == se["id"] or e.get("id") == se["id"]
                   for e in (courses if isinstance(courses, list) else courses.get("enrollments", [])))


def test_b6_in_person_client_still_cannot_self_advance():
    with _program("trainer_led") as p:
        c, dog = _client_and_dog()
        se = _enroll(dog, p, "in_person")["school_enrollment"]
        cu = _client_user(c["id"])
        with pytest.raises(server.HTTPException) as e:
            run(server.portal_school_advance(se["id"], cu))
        assert e.value.status_code == 409


def test_b6_hybrid_client_submission_not_blocked_by_delivery_mode():
    """Hybrid keeps client submission — it must not hit the in-person 409."""
    with _program("both") as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "hybrid")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        cu = _client_user(c["id"])
        try:
            run(server.portal_school_submit_checkpoint(
                se["id"], enrollment["current_lesson_id"],
                server.CheckpointSubmissionIn(
                    video="data:video/mp4;base64,AAAAAAAAAAAAAAAA",
                    filename="clip.mp4", note=""), cu))
        except server.HTTPException as e:
            assert e.status_code != 409 or "in person" not in str(e.detail).lower(), \
                "hybrid must not be blocked by the in-person checkpoint rule"


# ═══════════════ live trainer checkpoints ═══════════════

def test_live_checkpoint_creates_canonical_submission_and_advances_on_pass():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]

        out = _live(se["id"], lesson_id, enrollment, "advance")

        sub = run(server.db.checkpoint_submissions.find_one(
            {"school_enrollment_id": se["id"], "lesson_id": lesson_id}, {"_id": 0}))
        assert sub is not None, "live checkpoint must use the canonical collection"
        assert sub["submission_source"] == "trainer_live"
        assert sub["video_media_id"] is None, "no fake client video"
        assert sub["enrollment_id"] == enrollment["id"]
        assert sub["dog_id"] == dog["id"] and sub["client_id"] == se["client_id"]
        assert sub["observed_live_by"]
        assert sub["status"] == "graded"
        hid, did_ = _criteria(enrollment, lesson_id)
        assert sub["handler_scores"][hid] == 3
        assert sub["dog_scores"][did_] == 3
        assert sub["trainer_feedback"] == "Live observed."
        assert sub["outcome"] == "advance"
        assert sub["graded_by"], "grading is attributed to the trainer"
        after = run(server.db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}))
        assert after["current_lesson_id"] != lesson_id, "pass must advance the pointer"
        assert out["checkpoint"]["submission_source"] == "trainer_live"


def test_live_checkpoint_more_practice_does_not_advance():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]
        hid, did_ = _criteria(enrollment, lesson_id)
        run(server.admin_school_live_checkpoint(
            se["id"], lesson_id,
            server.CheckpointGradeIn(
                handler_scores={hid: 1}, dog_scores={did_: 1}, feedback="Keep practicing.",
                outcome="prescribe_practice",
                prescription=server.CheckpointPrescriptionIn(action="repeat_current_recipe"),
            ), _admin()))
        after = run(server.db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}))
        assert after["current_lesson_id"] == lesson_id, "more-practice must NOT advance"


def test_live_checkpoint_trainer_assist_holds_progress():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]
        _live(se["id"], lesson_id, enrollment, "trainer_assist_recommended",
              feedback="Let's work together.")
        after = run(server.db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}))
        assert after["current_lesson_id"] == lesson_id, "assist must not advance"
        sub = run(server.db.checkpoint_submissions.find_one(
            {"school_enrollment_id": se["id"], "lesson_id": lesson_id}, {"_id": 0}))
        assert sub["outcome"] == "trainer_assist_recommended"


def test_live_checkpoint_appears_in_history_and_timeline():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]
        _live(se["id"], lesson_id, enrollment, "advance")
        cu = _client_user(c["id"])
        hist = run(server.portal_school_checkpoint_history(se["id"], cu))
        rows = hist if isinstance(hist, list) else hist.get("checkpoints", [])
        assert any(r.get("lesson_id") == lesson_id for r in rows), "must appear in client history"
        events = run(server.db.school_events.count_documents({"dog_id": dog["id"]}))
        assert events > 0, "live checkpoint should produce School timeline activity"


def test_live_checkpoint_duplicate_pending_rejected():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]
        run(server.db.checkpoint_submissions.insert_one({
            "id": str(uuid.uuid4()), "school_enrollment_id": se["id"], "lesson_id": lesson_id,
            "enrollment_id": enrollment["id"], "dog_id": dog["id"], "status": "pending",
            "created_at": server.now_iso(),
        }))
        with pytest.raises(server.HTTPException) as e:
            _live(se["id"], lesson_id, enrollment, "advance")
        assert e.value.status_code == 409


def test_live_checkpoint_only_for_current_lesson_and_active_program():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lessons = server._effective_lesson_list(enrollment["program_snapshot"]["modules"][0])
        future = lessons[1]["id"]
        with pytest.raises(server.HTTPException) as e:
            _live(se["id"], future, enrollment, "advance")
        assert e.value.status_code == 409


def test_live_checkpoint_permissions():
    """Client blocked; front desk blocked; restricted trainer allowed for
    in-person; online live checkpoint still needs manage_school."""
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        lesson_id = enrollment["current_lesson_id"]
        cu = _client_user(c["id"])
        with pytest.raises(server.HTTPException) as e:
            _live(se["id"], lesson_id, enrollment, "advance", user=cu)
        assert e.value.status_code == 403
        fd = _staff("front_desk")
        with pytest.raises(server.HTTPException) as e2:
            _live(se["id"], lesson_id, enrollment, "advance", user=fd)
        assert e2.value.status_code == 403


def test_live_checkpoint_online_program_requires_school_permission(monkeypatch):
    monkeypatch.setitem(server._ROLE_OVERRIDES, "trainer",
                        {"manage_school": False, "manage_training_sessions": True})
    tr = _staff("trainer")
    with _program("self_guided", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "online")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        with pytest.raises(server.HTTPException) as e:
            _live(se["id"], enrollment["current_lesson_id"], enrollment, "advance", user=tr)
        assert e.value.status_code == 403


# ═══════════════ Repeat Program / retake ═══════════════

def _finish(enrollment_id, status):
    run(server.db.dog_programs.update_one(
        {"id": enrollment_id},
        {"$set": {"status": status, "completed_at": server.now_iso() if status == "completed" else None}}))
    run(server.db.school_enrollments.update_one(
        {"enrollment_id": enrollment_id}, {"$set": {"status": status}}))


def _seed_history(se, enrollment, dog):
    """Sessions + Practice + a graded checkpoint on the first attempt."""
    run(server.db.training_session_log.insert_one({
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "enrollment_id": enrollment["id"],
        "notes": f"{TAG} session", "created_at": server.now_iso(),
    }))
    run(server.db.homework.insert_one({
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "client_id": se["client_id"],
        "title": f"{TAG} attempt1 practice", "status": "completed",
        "school_enrollment_id": se["id"], "assigned_by": "School - practice",
        "created_at": server.now_iso(),
    }))
    lesson_id = enrollment["current_lesson_id"]
    _live(se["id"], lesson_id, enrollment, "advance")


@pytest.mark.parametrize("finish_status", ["completed", "withdrawn"])
def test_retake_creates_new_attempt_and_preserves_history(finish_status):
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
        _seed_history(se, enrollment, dog)
        first = run(server.db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}))
        first_progress = first["goal_progress"]
        first_lesson_pointer = first["current_lesson_id"]
        _finish(enrollment["id"], finish_status)

        out = run(server.school_retake_enrollment(
            se["id"], server.SchoolRetakeIn(delivery_mode="in_person"), _admin()))
        new_se = out["school_enrollment"]
        new_enr = run(server.db.dog_programs.find_one({"id": new_se["enrollment_id"]}, {"_id": 0}))

        # new attempt exists and is distinct
        assert new_se["id"] != se["id"]
        assert new_enr["id"] != enrollment["id"]
        assert new_enr["status"] == "active"
        # lineage recorded
        assert new_enr["retake_of_enrollment_id"] == enrollment["id"]
        assert new_se["retake_of_school_enrollment_id"] == se["id"]
        # previous attempt untouched
        old = run(server.db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}))
        assert old["status"] == finish_status
        assert old["goal_progress"] == first_progress
        assert old["current_lesson_id"] == first_lesson_pointer
        old_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
        assert old_se["status"] == finish_status
        # history preserved
        assert run(server.db.training_session_log.count_documents(
            {"enrollment_id": enrollment["id"]})) == 1
        assert run(server.db.homework.count_documents(
            {"school_enrollment_id": se["id"]})) >= 1
        assert run(server.db.checkpoint_submissions.count_documents(
            {"school_enrollment_id": se["id"]})) == 1
        # new attempt starts clean — no inherited completion
        assert run(server.db.checkpoint_submissions.count_documents(
            {"school_enrollment_id": new_se["id"]})) == 0
        first_lesson = server._effective_lesson_list(
            new_enr["program_snapshot"]["modules"][0])[0]["id"]
        assert new_enr["current_lesson_id"] == first_lesson, "retake starts at lesson 1"
        assert new_enr["sessions_count"] == 0
        # attempts are distinguishable for reporting
        all_attempts = run(server.db.dog_programs.find(
            {"dog_id": dog["id"], "program_id": p["id"]}, {"_id": 0}).to_list(10))
        assert len(all_attempts) == 2


def test_retake_rejected_while_an_attempt_is_still_active():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        se = _enroll(dog, p, "in_person")["school_enrollment"]
        with pytest.raises(server.HTTPException) as e:
            run(server.school_retake_enrollment(se["id"], server.SchoolRetakeIn(), _admin()))
        assert e.value.status_code == 409


def test_duplicate_retake_requests_do_not_create_two_attempts():
    with _program("both", n_lessons=2) as p:
        c, dog = _client_and_dog()
        res = _enroll(dog, p, "in_person")
        se, enr = res["school_enrollment"], res["enrollment"]
        _finish(enr["id"], "completed")
        run(server.school_retake_enrollment(
            se["id"], server.SchoolRetakeIn(delivery_mode="in_person"), _admin()))
        with pytest.raises(server.HTTPException) as e:
            run(server.school_retake_enrollment(
                se["id"], server.SchoolRetakeIn(delivery_mode="in_person"), _admin()))
        assert e.value.status_code == 409
        assert run(server.db.dog_programs.count_documents(
            {"dog_id": dog["id"], "program_id": p["id"], "status": "active"})) == 1
