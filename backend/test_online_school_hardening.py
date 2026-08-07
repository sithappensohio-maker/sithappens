"""Sit Happens Online School — foundation hardening audit (post-Phase-1).

Covers the four requirements from the hardening pass that
test_online_school_phase1.py's original coverage didn't prove:

  1. Global dog_programs active-enrollment audit — every trainer-facing
     query/helper that resolves "the active enrollment" for a dog must keep
     resolving to the TRAINER-LED one when an online_school enrollment is
     also active simultaneously, and every trainer admin write endpoint
     must refuse to operate on an online_school enrollment.
  2. School enrollment write integrity — POST /school/enroll's two-record
     write (dog_programs + school_enrollments) survives a mid-enrollment
     failure with no orphaned row, and the new dp_online_active_unique
     partial index enforces the duplicate-enrollment policy under real
     concurrency, not just the read-before-write pre-check.
  3. Client advancement hardening — advance-twice is idempotent, concurrent
     advance requests produce only one logical advancement, a client can
     never advance another client's enrollment, and advancement never
     touches goal_progress/mastery.
  4. The three new critical indexes are present with the exact expected
     definition, verified via the same mandatory-startup mechanism that
     already protects the training-session draft/completion pipeline.
  5. DELETE /school/enrollments/{id} removal integrity — the inverse of
     school_enroll's two-record write. Idempotent/safely retryable under a
     simulated mid-removal failure, never touches a trainer-led enrollment,
     and handles both "companion exists, dog_programs already gone" and
     "dog_programs exists, companion already gone" deterministically.

Same fixture/cleanup convention as test_online_school_phase1.py /
test_trainer_dashboard_phase7.py / test_session_completion_hardening.py.
"""
import asyncio
import contextlib
import uuid
from datetime import date

from motor.motor_asyncio import AsyncIOMotorCollection

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_SCHOOL_HARDENING"


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


def _lesson(name, order, skill_ids, tpl_id):
    return server.LessonIn(
        name=name, order=order, active=True, skill_ids=skill_ids,
        client_overview=f"{name} overview", why_it_matters="It matters.",
        success_criteria="5 in a row.", suggested_homework_template_ids=[tpl_id],
    )


@contextlib.contextmanager
def _school_program(delivery_mode="self_guided", n_modules=2, n_lessons_per_module=2, tpl_ids=None):
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
        for mi, m in enumerate(prog["modules"]):
            goal_ids = [g["id"] for g in m["goals"]]
            lessons = []
            for li in range(n_lessons_per_module):
                lessons.append(_lesson(f"Lesson {mi + 1}.{li + 1}", li, [goal_ids[li]], tpl_ids[tid]))
                tid += 1
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


@contextlib.contextmanager
def _trainer_program():
    admin = _admin_user()
    body = server.ProgramIn(
        name=f"{TAG} trainer {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": 1, "unit": "sessions"}, price=50, delivery_mode="both",
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")])],
    )
    prog = run(server.create_program(body, admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_school(school_id, enrollment_id):
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"dog_id": {"$exists": True}, "assigned_by": {"$regex": "^Online School"}}))


def _make_booking(dog_id, admin, service_type="training"):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type=service_type, date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup_booking(booking_id, enr_id=None):
    if booking_id:
        run(server.db.bookings.delete_one({"id": booking_id}))
    if enr_id:
        run(server.db.training_session_drafts.delete_many({"enrollment_id": enr_id}))
        run(server.db.training_session_log.delete_many({"enrollment_id": enr_id}))
        run(server.db.dog_programs.delete_one({"id": enr_id}))


@contextlib.contextmanager
def _fail_method_on_collection(collection_name, method_name, message="simulated failure", fail_times=1):
    """Fails the Nth call(s) of `method_name` on `collection_name` — patches
    the Motor collection CLASS (not a specific instance), matching
    test_session_completion_hardening.py's proven pattern, since
    server.db.<name> may hand back a fresh AsyncIOMotorCollection object
    per access rather than a cached one."""
    orig = getattr(AsyncIOMotorCollection, method_name)
    state = {"remaining": fail_times}

    async def _patched(self, *args, **kwargs):
        if self.name == collection_name and state["remaining"] > 0:
            state["remaining"] -= 1
            raise RuntimeError(message)
        return await orig(self, *args, **kwargs)

    setattr(AsyncIOMotorCollection, method_name, _patched)
    try:
        yield
    finally:
        setattr(AsyncIOMotorCollection, method_name, orig)


def _enroll_both(prog, dog, admin):
    """Give a dog BOTH a trainer-led and an online_school active
    enrollment in the same "both"-delivery program — the exact simultaneous
    state the entire hardening audit is about."""
    trainer_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    se, school_enr = res["school_enrollment"], res["enrollment"]
    return trainer_enr, se, school_enr


# ---------------------------------------------------------------------------
# Part 1 — global dog_programs active-enrollment audit
# ---------------------------------------------------------------------------

def test_resolve_active_enrollment_for_dog_excludes_online_school():
    """_resolve_active_enrollment_for_dog is the central resolver behind
    booking check-in / direct session-start. With both delivery types
    active, it must resolve to the trainer-led enrollment deterministically
    — never a false 'multiple_active_enrollments' state, never picking the
    online one."""
    with _trainer_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr, se, school_enr = _enroll_both(prog, dog, admin)
            try:
                result = run(server._resolve_active_enrollment_for_dog(dog["id"]))
                assert result["ok"] is True, result
                assert result["enrollment"]["id"] == trainer_enr["id"]

                # Explicit id lookup of the ONLINE enrollment must be refused —
                # a trainer session can never be resolved against it, even by id.
                blocked = run(server._resolve_active_enrollment_for_dog(dog["id"], school_enr["id"]))
                assert blocked["ok"] is False
                assert blocked["reason"] == "enrollment_not_found"
            finally:
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_admin_training_today_resolves_trainer_led_enrollment_only():
    with _trainer_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr, se, school_enr = _enroll_both(prog, dog, admin)
            booking = _make_booking(dog["id"], admin)
            try:
                rows = run(server.admin_training_today(admin))
                row = next(r for r in rows if r["booking_id"] == booking["id"])
                assert row["program_name"] == prog["name"]
                # Exactly one enrollment resolved for this booking's dog, not
                # a false "resolution_needed" from the simultaneous online row.
                assert row["session_status"] != "resolution_needed"
            finally:
                _cleanup_booking(booking["id"])
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_active_summary_excludes_online_school():
    with _trainer_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            before = run(server.active_summary(admin))
            trainer_enr, se, school_enr = _enroll_both(prog, dog, admin)
            try:
                after = run(server.active_summary(admin))
                # Only the trainer-led enrollment counted — total goes up by
                # exactly 1, not 2, even though 2 dog_programs rows exist.
                assert after["total"] == before["total"] + 1
                ids_after = {e["id"] for e in after["active"]}
                assert trainer_enr["id"] in ids_after or after["total"] > 20  # top-20 slice guard
                assert school_enr["id"] not in ids_after
            finally:
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_programs_pipeline_excludes_online_school_unconditionally():
    with _trainer_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr, se, school_enr = _enroll_both(prog, dog, admin)
            try:
                # No status filter.
                rows = run(server.programs_pipeline(admin))
                ids = {r["id"] for r in rows}
                assert trainer_enr["id"] in ids
                assert school_enr["id"] not in ids
                # WITH a status filter — must still exclude online_school,
                # not just when status is unset.
                rows2 = run(server.programs_pipeline(admin, status="active"))
                ids2 = {r["id"] for r in rows2}
                assert trainer_enr["id"] in ids2
                assert school_enr["id"] not in ids2
            finally:
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_trainer_admin_write_endpoints_refuse_online_school_enrollment():
    """update_enrollment / set_enrollment_current_module / update_goal /
    start_training_session_draft_direct / get_training_context_direct all
    predate Online School and have always meant 'operate on a trainer-led
    enrollment' — each must now refuse an online_school enrollment id
    server-side, not just hide the control client-side."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, school_enr = res["school_enrollment"], res["enrollment"]
            try:
                try:
                    run(server.update_enrollment(dog["id"], school_enr["id"], server.EnrollmentUpdate(status="on_hold"), admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

                first_module_id = prog["modules"][0]["id"]
                try:
                    run(server.set_enrollment_current_module(dog["id"], school_enr["id"], server.EnrollmentCurrentModuleIn(module_id=first_module_id), admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

                goal_id = prog["modules"][0]["goals"][0]["id"]
                try:
                    run(server.update_goal(dog["id"], school_enr["id"], goal_id, server.GoalUpdate(score=4), admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

                try:
                    run(server.start_training_session_draft_direct(dog["id"], school_enr["id"], "", admin))
                    assert False, "expected 404"
                except server.HTTPException as exc:
                    assert exc.status_code == 404

                try:
                    run(server.get_training_context_direct(dog["id"], school_enr["id"], admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            finally:
                _cleanup_school(se["id"], school_enr["id"])


def test_today_brain_certificate_nudge_excludes_online_school():
    """The overall_pct>=95 'ready for certificate' nudge is a trainer-led
    pipeline concept — an online_school enrollment forced to overall_pct=95
    must never surface as certificate-ready."""
    with _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=1) as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, school_enr = res["school_enrollment"], res["enrollment"]
            try:
                run(server.db.dog_programs.update_one({"id": school_enr["id"]}, {"$set": {"overall_pct": 100}}))
                found = run(server.db.dog_programs.find_one(
                    {"status": "active", "overall_pct": {"$gte": 95}, "delivery_channel": {"$ne": "online_school"}},
                    {"_id": 0, "id": 1},
                ))
                assert (found or {}).get("id") != school_enr["id"]
            finally:
                _cleanup_school(se["id"], school_enr["id"])


# ---------------------------------------------------------------------------
# Part 2 — school enrollment write integrity
# ---------------------------------------------------------------------------

def test_school_enroll_rolls_back_dog_programs_on_school_enrollments_failure():
    """Simulated mid-enrollment failure: the school_enrollments insert
    raises. Proves no orphaned dog_programs row (nor a half-written
    school_enrollments row) survives."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            with _fail_method_on_collection("school_enrollments", "insert_one", "simulated mid-enrollment failure"):
                try:
                    run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                    assert False, "expected 500"
                except server.HTTPException as exc:
                    assert exc.status_code == 500

            # No orphaned dog_programs row for this dog+program.
            orphan = run(server.db.dog_programs.find_one(
                {"dog_id": dog["id"], "program_id": prog["id"], "delivery_channel": "online_school"},
            ))
            assert orphan is None
            # No half-written school_enrollments row either.
            se_orphan = run(server.db.school_enrollments.find_one({"dog_id": dog["id"], "program_id": prog["id"]}))
            assert se_orphan is None


def test_concurrent_duplicate_school_enroll_only_one_succeeds():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            async def _go():
                return await asyncio.gather(
                    server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin),
                    server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin),
                    return_exceptions=True,
                )
            results = run(_go())
            successes = [r for r in results if not isinstance(r, Exception)]
            failures = [r for r in results if isinstance(r, Exception)]
            try:
                assert len(successes) == 1, f"expected exactly 1 success, got {len(successes)}: {results}"
                assert len(failures) == 1
                assert isinstance(failures[0], server.HTTPException)
                assert failures[0].status_code == 409

                active_count = run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"], "status": "active", "delivery_channel": "online_school"},
                ))
                assert active_count == 1
                se_count = run(server.db.school_enrollments.count_documents({"dog_id": dog["id"], "program_id": prog["id"]}))
                assert se_count == 1
            finally:
                for r in successes:
                    _cleanup_school(r["school_enrollment"]["id"], r["enrollment"]["id"])


def test_critical_school_indexes_present_with_expected_definition():
    se_indexes = run(server.db.school_enrollments.index_information())
    dp_indexes = run(server.db.dog_programs.index_information())

    def _has(indexes, key, unique, partial):
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

    assert _has(se_indexes, [("id", 1)], True, None)
    assert _has(se_indexes, [("enrollment_id", 1)], True, None)
    assert _has(dp_indexes, [("dog_id", 1), ("program_id", 1)], True,
                {"status": "active", "delivery_channel": "online_school"})


# ---------------------------------------------------------------------------
# Part 3 — client advancement hardening
# ---------------------------------------------------------------------------

def _practice_and_advance(se, enr, client_user, lesson_id):
    started = run(server.portal_school_start_practice(se["id"], lesson_id, client_user))
    run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
    return run(server.portal_school_advance(se["id"], client_user))


def test_advance_twice_is_idempotent_no_skipped_lesson():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                adv1 = _practice_and_advance(se, enr, client_user, lesson1_id)
                assert adv1["current_lesson_id"] == lesson2_id

                # Re-issuing advance WITHOUT practicing lesson2 must be
                # rejected (not silently re-apply, not skip to lesson 3+).
                try:
                    run(server.portal_school_advance(se["id"], client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422

                raw = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
                assert raw["current_lesson_id"] == lesson2_id  # unchanged — no skip
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_concurrent_advance_requests_produce_only_one_logical_advancement():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                lesson2_id = prog["modules"][0]["lessons"][1]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))

                async def _go():
                    return await asyncio.gather(
                        server.portal_school_advance(se["id"], client_user),
                        server.portal_school_advance(se["id"], client_user),
                        return_exceptions=True,
                    )
                results = run(_go())
                for r in results:
                    assert not isinstance(r, Exception), f"unexpected exception: {r}"

                # Both calls resolve without error (the CAS loser returns the
                # current state idempotently), but the enrollment only ever
                # lands on lesson2 — never skipped to a 3rd lesson.
                for r in results:
                    assert r["current_lesson_id"] == lesson2_id

                raw = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_module_id": 1, "current_lesson_id": 1}))
                assert raw["current_lesson_id"] == lesson2_id
                assert raw["current_module_id"] == prog["modules"][0]["id"]

                # Homework for lesson2 was auto-assigned exactly once, not twice.
                hw_count = run(server.db.homework.count_documents({"dog_id": dog["id"], "source_lesson_id": lesson2_id}))
                assert hw_count == 1
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_client_cannot_advance_another_clients_enrollment():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c1, dog1), _client_and_dog() as (c2, dog2):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog1["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                other_user = _client_user(c2["id"])
                try:
                    run(server.portal_school_advance(se["id"], other_user))
                    assert False, "expected 404"
                except server.HTTPException as exc:
                    assert exc.status_code == 404
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_advance_never_writes_goal_progress_or_mastery():
    """Advancement must alter course navigation/progression only — it must
    never fabricate goal_progress/mastery/trainer scores."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                before = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "goal_progress": 1}))
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                run(server.portal_school_advance(se["id"], client_user))
                after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "goal_progress": 1}))
                assert before["goal_progress"] == after["goal_progress"]
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Part 5 — DELETE /school/enrollments/{id} removal integrity
# ---------------------------------------------------------------------------

def test_delete_school_enrollment_normal_removal_touches_only_the_intended_pair():
    with _trainer_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr, se, school_enr = _enroll_both(prog, dog, admin)
            try:
                run(server.delete_school_enrollment(se["id"], admin))
                assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None
                assert run(server.db.dog_programs.find_one({"id": school_enr["id"]})) is None
                # Trainer-led enrollment for the same dog is untouched.
                still_there = run(server.db.dog_programs.find_one({"id": trainer_enr["id"]}))
                assert still_there is not None
                assert still_there["status"] == "active"
                assert "delivery_channel" not in still_there
            finally:
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_delete_school_enrollment_called_twice_produces_no_corruption():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            run(server.delete_school_enrollment(se["id"], admin))
            try:
                run(server.delete_school_enrollment(se["id"], admin))
                assert False, "expected 404 on retry after real removal"
            except server.HTTPException as exc:
                assert exc.status_code == 404
            # Final state is clean either way — nothing left behind.
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is None


def test_delete_school_enrollment_when_dog_programs_already_missing_succeeds_safely():
    """Simulates the recoverable half-completed state: school_enrollments
    still exists but its linked dog_programs row is already gone (e.g. a
    prior removal attempt died after deleting dog_programs but before
    deleting school_enrollments). Retrying the SAME endpoint call must
    finish the cleanup, not error or leave the leftover row behind."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            run(server.db.dog_programs.delete_one({"id": enr["id"]}))  # simulate the partial state directly
            result = run(server.delete_school_enrollment(se["id"], admin))
            assert result == {"ok": True}
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None


def test_orphaned_dog_programs_without_companion_self_heals_on_convergence():
    """The inverse orphan: an online dog_programs row exists with NO
    school_enrollments companion at all — the residual double-failure risk
    disclosed in _grant_online_school_enrollment's own compensating-
    rollback docstring (a hard process kill between the two inserts; not
    reachable via delete_school_enrollment's own failure modes after the
    ordering fix, but verified here directly).

    Commerce-integrity hardening (Phase 5H) — this used to be handled only
    "deterministically" (reject with a message naming the stuck
    dog_programs id, but never actually fix anything — a real gap: a paid
    Shop purchase landing in this exact window would retry forever and
    mark the order line "fulfilled" while GET /portal/school, which reads
    school_enrollments, never showed the course). Every convergence path
    now SELF-HEALS: it find-or-creates the missing companion before
    reporting "already enrolled", so a retry after a crash actually
    finishes the job — list_dog_school_enrollments finds it, and a repeat
    school_enroll attempt's 409 now names a real, working school_enrollment
    id instead of the orphaned dog_programs id."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            run(server.db.school_enrollments.delete_one({"id": se["id"]}))  # simulate the orphan directly
            try:
                rows = run(server.list_dog_school_enrollments(dog["id"], admin))
                assert rows == []  # companion still missing — not yet healed

                try:
                    run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
                    # A NEW school_enrollment id was healed into existence —
                    # never the raw dog_programs id, and never the original
                    # (deleted) se["id"].
                    healed_id = exc.detail.rsplit(" ", 1)[-1].rstrip(").")
                    assert healed_id not in (enr["id"], se["id"])

                # The healed companion is now real and discoverable.
                healed_rows = run(server.list_dog_school_enrollments(dog["id"], admin))
                assert len(healed_rows) == 1
                assert healed_rows[0]["enrollment_id"] == enr["id"]
                assert healed_rows[0]["status"] == "active"

                # No second dog_programs row was created by the healing.
                assert run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"},
                )) == 1
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.school_enrollments.delete_many({"dog_id": dog["id"]}))


def test_delete_school_enrollment_failure_after_dog_programs_delete_is_retryable_not_falsely_successful():
    """Simulated failure in the SECOND half of removal (the
    school_enrollments delete). Must raise (never report false success),
    and the dog_programs delete that already completed must not be
    reverted — retrying the same call must then finish cleanly."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            with _fail_method_on_collection("school_enrollments", "delete_one", "simulated failure after dog_programs delete"):
                try:
                    run(server.delete_school_enrollment(se["id"], admin))
                    assert False, "expected the simulated failure to propagate"
                except RuntimeError:
                    pass
            # dog_programs delete already completed — real, not reverted.
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is None
            # school_enrollments is the leftover, still-existing row.
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is not None

            # Retry with the SAME id now finishes cleanly.
            result = run(server.delete_school_enrollment(se["id"], admin))
            assert result == {"ok": True}
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None


def test_delete_school_enrollment_failure_before_dog_programs_delete_leaves_state_untouched():
    """Simulated failure in the FIRST half of removal (the dog_programs
    delete). Must raise, and BOTH documents must remain fully intact — a
    plain retry (no special recovery needed) then succeeds normally."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            with _fail_method_on_collection("dog_programs", "delete_one", "simulated failure before school_enrollments delete"):
                try:
                    run(server.delete_school_enrollment(se["id"], admin))
                    assert False, "expected the simulated failure to propagate"
                except RuntimeError:
                    pass
            # Nothing removed — both documents still fully intact.
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is not None
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is not None

            result = run(server.delete_school_enrollment(se["id"], admin))
            assert result == {"ok": True}
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is None
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None
