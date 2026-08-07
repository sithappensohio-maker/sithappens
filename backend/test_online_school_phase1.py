"""Sit Happens Online School — Phase 1 (foundation) backend coverage.

Architecture under test (see Phase 0 audit): Online School enrollment
reuses the existing dog_programs document as the single source of truth
for program_snapshot/goal_progress/current_module_id/current_lesson_id —
there is no second progress ledger. A small companion `school_enrollments`
collection links to a dog_programs row via `enrollment_id`. dog_programs
gains exactly one additive field, `delivery_channel` ("online_school" or
absent — absent means trainer_led, unchanged for every legacy/trainer-led
document). ProgramIn gains one additive field, `delivery_mode`
("trainer_led" default / "self_guided" / "both").

Same fixture/cleanup convention as test_practice_coach.py /
test_client_learning_experience_phase6.py.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ONLINE_SCHOOL"

# Permission enforcement lives in Depends(require_admin_and_permission(...)),
# which only runs through real ASGI dispatch — calling an endpoint function
# directly in Python bypasses Depends entirely (this is a real gotcha; see
# test_training_permissions_phase8.py which established this same pattern).
# Used only for the handful of tests that specifically verify the
# permission gate; every other test below calls endpoint functions directly
# for speed, since ownership/role checks written inline in the function
# body (not inside Depends) work correctly either way.
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))

    @staticmethod
    def delete(url, headers=None):
        return run(_http.delete(url, headers=headers))


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
    """A generic 2-module, 2-lessons-each program (no exercise-specific
    naming) with each lesson wired to a real Coach-Mode-enabled homework
    template via suggested_homework_template_ids, exactly like a real
    curriculum author would configure it."""
    admin = _admin_user()
    with contextlib.ExitStack() as stack:
        if tpl_ids is None:
            tpls = [stack.enter_context(_homework_template(str(i)))[0] for i in range(n_modules * n_lessons_per_module)]
            tpl_ids = [t["id"] for t in tpls]
        modules = []
        tid = 0
        for mi in range(n_modules):
            goals = [server.GoalIn(name=f"Skill M{mi}L{li}") for li in range(n_lessons_per_module)]
            modules.append(server.ModuleIn(name=f"Module {mi + 1}", order=mi, goals=goals))
        body = server.ProgramIn(
            name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
            format={"count": n_modules, "unit": "modules"}, price=0,
            delivery_mode=delivery_mode, modules=modules,
        )
        prog = run(server.create_program(body, admin))
        # Second pass: attach real lessons (need goal ids from the created program).
        fixed_modules = []
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


def _cleanup_school(school_id, enrollment_id):
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"dog_id": {"$exists": True}, "assigned_by": {"$regex": "^Online School"}}))


# ---------------------------------------------------------------------------
# Legacy / trainer-led compatibility
# ---------------------------------------------------------------------------

def test_legacy_program_with_no_delivery_mode_behaves_as_trainer_led():
    admin = _admin_user()
    body = server.ProgramIn(name=f"{TAG} legacy {uuid.uuid4().hex[:6]}", type="private_lessons", price=0,
                             modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit")])])
    prog = run(server.create_program(body, admin))
    try:
        assert prog["delivery_mode"] == "trainer_led"
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                assert enr["status"] == "active"
                # Trainer-led enroll never sets delivery_channel — confirm absent.
                raw = run(server.db.dog_programs.find_one({"id": enr["id"]}))
                assert "delivery_channel" not in raw
                # portal_learn still finds it (the defensive $ne filter must not
                # exclude a legacy row that simply never set the key).
                learn = run(server.portal_learn(_client_user(c["id"])))
                assert len(learn) == 1 and learn[0]["program_name"] == prog["name"]
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_trainer_led_only_program_rejects_school_enroll():
    admin = _admin_user()
    body = server.ProgramIn(name=f"{TAG} tled {uuid.uuid4().hex[:6]}", type="private_lessons", price=0,
                             delivery_mode="trainer_led",
                             modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit")])])
    prog = run(server.create_program(body, admin))
    try:
        with _client_and_dog() as (c, dog):
            try:
                run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                assert False, "expected 422"
            except server.HTTPException as exc:
                assert exc.status_code == 422
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


# ---------------------------------------------------------------------------
# Online-capable / both-delivery enrollment
# ---------------------------------------------------------------------------

def test_online_capable_program_school_enroll_succeeds():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                assert se["client_id"] == c["id"]
                assert se["dog_id"] == dog["id"]
                assert se["program_id"] == prog["id"]
                assert se["delivery_mode"] == "self_guided"
                assert se["status"] == "active"
                assert enr["current_module_id"] == prog["modules"][0]["id"]
                raw = run(server.db.dog_programs.find_one({"id": enr["id"]}))
                assert raw["delivery_channel"] == "online_school"
                assert raw["current_lesson_id"] == prog["modules"][0]["lessons"][0]["id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_both_delivery_program_supports_trainer_led_and_online_independently():
    with _school_program(delivery_mode="both") as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, school_enr = res["school_enrollment"], res["enrollment"]
            try:
                assert trainer_enr["id"] != school_enr["id"]
                raw_trainer = run(server.db.dog_programs.find_one({"id": trainer_enr["id"]}))
                raw_school = run(server.db.dog_programs.find_one({"id": school_enr["id"]}))
                assert "delivery_channel" not in raw_trainer
                assert raw_school["delivery_channel"] == "online_school"
                # Both independently active for the same dog+program.
                active_count = run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"}))
                assert active_count == 2
            finally:
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_portal_learn_resolves_deterministically_when_dog_has_both_active_enrollments():
    """Regression test for the exact collision the Phase 0 audit found:
    portal_learn's dog+status=active lookup must keep returning the
    TRAINER-LED enrollment, never nondeterministically picking the online
    one, when both are active simultaneously."""
    with _school_program(delivery_mode="both") as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, school_enr = res["school_enrollment"], res["enrollment"]
            try:
                learn = run(server.portal_learn(_client_user(c["id"])))
                assert len(learn) == 1
                assert learn[0]["dog_id"] == dog["id"]
                progress = run(server.portal_progress(_client_user(c["id"])))
                assert len(progress) == 1
            finally:
                _cleanup_school(se["id"], school_enr["id"])
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))


def test_duplicate_active_online_enrollment_rejected():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                try:
                    run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Security / permissions
# ---------------------------------------------------------------------------

def test_non_admin_cannot_school_enroll():
    """Real ASGI-dispatch check — a client account and an unpermitted
    staff role (front_desk, no manage_training_sessions) both get 403 from
    the actual endpoint; a trainer (has manage_training_sessions) succeeds.
    This proves the Depends(require_admin_and_permission(...)) gate itself
    is wired on POST /school/enroll, not merely inline logic."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            _, client_h = None, None
            client_uid = str(uuid.uuid4())
            run(server.db.users.insert_one({
                "id": client_uid, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
                "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
            }))
            client_h = {"Authorization": f"Bearer {server.create_access_token(client_uid, c['email'], 'client', 0)}"}
            fd_uid, fd_h = _insert_staff("front_desk")
            trainer_uid, trainer_h = _insert_staff("trainer")
            enr_id = None
            try:
                r_client = client.post("/api/school/enroll", headers=client_h, json={"dog_id": dog["id"], "program_id": prog["id"]})
                assert r_client.status_code == 403, r_client.text
                r_fd = client.post("/api/school/enroll", headers=fd_h, json={"dog_id": dog["id"], "program_id": prog["id"]})
                assert r_fd.status_code == 403, r_fd.text
                r_trainer = client.post("/api/school/enroll", headers=trainer_h, json={"dog_id": dog["id"], "program_id": prog["id"]})
                assert r_trainer.status_code == 200, r_trainer.text
                enr_id = r_trainer.json()["enrollment"]["id"]
                se_id = r_trainer.json()["school_enrollment"]["id"]
                r_del_fd = client.delete(f"/api/school/enrollments/{se_id}", headers=fd_h)
                assert r_del_fd.status_code == 403, r_del_fd.text
            finally:
                if enr_id:
                    run(server.db.school_enrollments.delete_many({"enrollment_id": enr_id}))
                    run(server.db.dog_programs.delete_one({"id": enr_id}))
                run(server.db.users.delete_many({"id": {"$in": [client_uid, fd_uid, trainer_uid]}}))


def test_client_cannot_view_another_clients_school_enrollment():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c1, dog1), _client_and_dog() as (c2, dog2):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog1["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                other_user = _client_user(c2["id"])
                try:
                    run(server.portal_school_detail(se["id"], other_user))
                    assert False, "expected 404"
                except server.HTTPException as exc:
                    assert exc.status_code == 404
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Roadmap / locking / progression
# ---------------------------------------------------------------------------

def test_locked_lesson_rejected_server_side():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                locked_lesson_id = prog["modules"][0]["lessons"][1]["id"]  # lesson 2 of module 1 — not current yet
                try:
                    run(server.portal_school_lesson_detail(se["id"], locked_lesson_id, client_user))
                    assert False, "expected 403"
                except server.HTTPException as exc:
                    assert exc.status_code == 403
                    assert "lesson" in exc.detail.lower() or "complete" in exc.detail.lower()
                try:
                    run(server.portal_school_start_practice(se["id"], locked_lesson_id, client_user))
                    assert False, "expected 403"
                except server.HTTPException as exc:
                    assert exc.status_code == 403
                # A future module's lesson is 404 (not even in the roadmap's lesson list).
                future_module_lesson_id = prog["modules"][1]["lessons"][0]["id"]
                try:
                    run(server.portal_school_lesson_detail(se["id"], future_module_lesson_id, client_user))
                    assert False, "expected 404"
                except server.HTTPException as exc:
                    assert exc.status_code == 404
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_roadmap_hides_future_module_lesson_content():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                detail = run(server.portal_school_detail(se["id"], client_user))
                roadmap = detail["roadmap"]
                m2 = next(m for m in roadmap["modules"] if m["status"] == "locked")
                assert m2["lessons"] == []
                assert m2["locked_reason"]
                m1 = next(m for m in roadmap["modules"] if m["status"] == "current")
                lesson2 = next(l for l in m1["lessons"] if l["status"] == "locked")
                assert lesson2["name"] == "Lesson 1.2"  # name visible…
                assert "client_overview" not in lesson2  # …but no instructional content
                assert lesson2["locked_reason"] == "Complete Lesson 1.1 before continuing."
                lesson1 = next(l for l in m1["lessons"] if l["is_current"])
                assert lesson1["status"] == "available"  # not yet practiced
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_start_practice_launches_generic_coach_mode_homework_and_is_idempotent():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                out1 = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                hw = run(server.db.homework.find_one({"id": out1["homework_id"]}))
                assert hw["source_lesson_id"] == lesson1_id
                assert hw["template_snapshot"]["practice_coach"]["enabled"] is True
                assert hw["template_snapshot"]["practice_coach"]["goal"] == COACH_RECIPE["goal"]  # not exercise-hardcoded — comes straight from the template
                out2 = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                assert out2["homework_id"] == out1["homework_id"]  # idempotent find-or-create
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_advance_requires_practice_first():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                try:
                    run(server.portal_school_advance(se["id"], client_user))
                    assert False, "expected 422"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_progression_unlocks_next_lesson_after_practice_and_advance():
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

                # Now "in_progress" (practiced but not yet advanced).
                detail = run(server.portal_school_detail(se["id"], client_user))
                m1 = next(m for m in detail["roadmap"]["modules"] if m["status"] == "current")
                cur = next(l for l in m1["lessons"] if l["is_current"])
                assert cur["status"] == "in_progress"

                adv = run(server.portal_school_advance(se["id"], client_user))
                assert adv["finished"] is False
                assert adv["current_lesson_id"] == lesson2_id

                detail2 = run(server.portal_school_detail(se["id"], client_user))
                m1b = next(m for m in detail2["roadmap"]["modules"] if m["status"] == "current")
                lesson1_after = next(l for l in m1b["lessons"] if l["id"] == lesson1_id)
                lesson2_after = next(l for l in m1b["lessons"] if l["id"] == lesson2_id)
                assert lesson1_after["status"] == "completed"
                assert lesson2_after["status"] == "available"
                assert lesson2_after["is_current"] is True
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_advance_through_entire_program_marks_school_enrollment_completed():
    with _school_program(delivery_mode="self_guided", n_modules=1, n_lessons_per_module=1) as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                client_user = _client_user(c["id"])
                lesson1_id = prog["modules"][0]["lessons"][0]["id"]
                started = run(server.portal_school_start_practice(se["id"], lesson1_id, client_user))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), client_user))
                adv = run(server.portal_school_advance(se["id"], client_user))
                assert adv["finished"] is True
                raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}))
                assert raw_se["status"] == "completed"
                assert raw_se["completed_at"]
                # Online School Phase 3 correction — a completed enrollment
                # must stay visible (Continue-Training vs
                # Completed/Graduation is a frontend branch on `status`,
                # never a server-side disappearance).
                listed = run(server.portal_school_list(client_user))
                row = next(r for r in listed if r["school_enrollment_id"] == se["id"])
                assert row["status"] == "completed"
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# No second progress ledger / snapshot stability
# ---------------------------------------------------------------------------

def test_school_enrollment_document_carries_no_progress_fields():
    """The companion record must never duplicate goal_progress/current_
    module_id/current_lesson_id — those live ONLY on dog_programs."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}))
                for forbidden in ("goal_progress", "current_module_id", "current_lesson_id", "program_snapshot"):
                    assert forbidden not in raw_se
                assert raw_se["enrollment_id"] == enr["id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_program_edit_does_not_mutate_active_school_enrollment_snapshot():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                before = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                # Edit the LIVE program (no cascade) — rename module 1.
                edited_modules = []
                for m in prog["modules"]:
                    edited_modules.append(server.ModuleIn(
                        id=m["id"], name=m["name"] + " EDITED", order=m["order"],
                        goals=[server.GoalIn(**g) for g in m["goals"]],
                        lessons=[server.LessonIn(**l) for l in m["lessons"]],
                    ))
                edited = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=0,
                    delivery_mode="self_guided", modules=edited_modules,
                )
                run(server.update_program(prog["id"], edited, cascade=False, save_as_draft=False, _=admin))
                after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert before["program_snapshot"] == after["program_snapshot"]
            finally:
                _cleanup_school(se["id"], enr["id"])


# ---------------------------------------------------------------------------
# Clean removal
# ---------------------------------------------------------------------------

def test_list_dog_school_enrollments_resolves_the_id_delete_needs():
    """The admin dog-profile UI has only the underlying dog_programs id
    (from GET /dogs/{id}/programs); it needs this lookup to find the
    matching school_enrollments id for DELETE /school/enrollments/{id}."""
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            try:
                rows = run(server.list_dog_school_enrollments(dog["id"], admin))
                assert len(rows) == 1
                assert rows[0]["id"] == se["id"]
                assert rows[0]["enrollment_id"] == enr["id"]
            finally:
                _cleanup_school(se["id"], enr["id"])


def test_delete_school_enrollment_removes_both_documents():
    with _school_program(delivery_mode="self_guided") as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            run(server.delete_school_enrollment(se["id"], admin))
            assert run(server.db.school_enrollments.find_one({"id": se["id"]})) is None
            assert run(server.db.dog_programs.find_one({"id": enr["id"]})) is None


def test_delete_school_enrollment_refuses_a_trainer_led_row():
    """Safety guard: even if a school_enrollments row somehow pointed at a
    trainer-led dog_programs document, delete must refuse rather than ever
    remove a trainer-led enrollment."""
    with _school_program(delivery_mode="both") as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            fake_se = {
                "id": str(uuid.uuid4()), "client_id": c["id"], "dog_id": dog["id"], "program_id": prog["id"],
                "enrollment_id": trainer_enr["id"], "delivery_mode": "self_guided", "status": "active",
                "enrolled_at": server.now_iso(), "enrolled_by": admin["id"], "created_at": server.now_iso(),
            }
            run(server.db.school_enrollments.insert_one(dict(fake_se)))
            try:
                try:
                    run(server.delete_school_enrollment(fake_se["id"], admin))
                    assert False, "expected 409"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
                assert run(server.db.dog_programs.find_one({"id": trainer_enr["id"]})) is not None
            finally:
                run(server.db.school_enrollments.delete_one({"id": fake_se["id"]}))
                run(server.db.dog_programs.delete_one({"id": trainer_enr["id"]}))
