"""Dog trophies: real mastery threshold, an Online School skill signal,
graduation that re-evaluates immediately, and a dog-side recheck sweep.

Before: the skill trophies demanded score 5 while the app calls a goal
"mastered" at 4; Online School never writes goal scores, so online students
could earn none of them; graduating from the Pipeline never re-evaluated
trophies and there was no dog sweep to heal it; the first_checkpoint_passed
evaluator had no catalog trophy.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
import trophy_service
from _test_loop import run

TAG = "TEST_DOG_TROPHY_SIG"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3}))
    try:
        yield c, {"id": did}
    finally:
        run(server.db.awarded_trophies.delete_many({"dog_id": did}))
        run(server.db.dog_programs.delete_many({"dog_id": did}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _snapshot():
    def lesson(i, skills):
        return {"id": f"L{i}", "name": f"Lesson {i}", "order": i, "active": True, "skill_ids": skills}
    return {"name": "P", "modules": [
        {"id": "M1", "name": "Module 1", "order": 0, "goals": [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}],
         "lessons": [lesson(1, ["s1"]), lesson(2, ["s2", "s3"])]},
        {"id": "M2", "name": "Module 2", "order": 1, "goals": [{"id": "s4"}, {"id": "s5"}],
         "lessons": [lesson(3, ["s4"]), lesson(4, ["s5"]), {"id": "L9", "name": "inactive", "order": 9, "active": False, "skill_ids": ["s9"]}]},
    ]}


def _enrollment(dog_id, **extra):
    doc = {"id": str(uuid.uuid4()), "dog_id": dog_id, "program_id": "p", "status": "active",
           "delivery_channel": "in_person_school", "goal_progress": {}, "program_snapshot": _snapshot(),
           "current_module_id": "M1", "current_lesson_id": "L1", "created_at": server.now_iso()}
    doc.update(extra)
    run(server.db.dog_programs.insert_one(doc))
    return doc


def test_mastery_threshold_matches_the_app():
    assert trophy_service.goal_is_mastered({"score": 4}) is True
    assert trophy_service.goal_is_mastered({"status": "mastered"}) is True
    assert trophy_service.goal_is_mastered({"score": 3}) is False
    assert trophy_service.goal_is_mastered({"score": "5"}) is True
    with _client_and_dog() as (c, dog):
        _enrollment(dog["id"], goal_progress={"s1": {"score": 4}, "s2": {"status": "mastered", "score": 0}, "s3": {"score": 3}})
        assert run(trophy_service._count_dog_skills_mastered(server.db, dog["id"])) == 2


def test_online_school_lessons_passed_count_as_skills():
    with _client_and_dog() as (c, dog):
        e = _enrollment(dog["id"], delivery_channel="online_school", current_module_id="M2", current_lesson_id="L4")
        # Passed L1, L2, L3 → s1, s2, s3, s4 (L4 is current, inactive L9 never counts)
        assert trophy_service.online_skills_demonstrated(e) == {"s1", "s2", "s3", "s4"}
        assert run(trophy_service._count_dog_skills_mastered(server.db, dog["id"])) == 4
        # Not-yet-started online enrollment demonstrates nothing.
        fresh = {**e, "current_module_id": "M1", "current_lesson_id": "L1"}
        assert trophy_service.online_skills_demonstrated(fresh) == set()
        # Pointer cleared inside module 1 → module 1 done.
        assert trophy_service.online_skills_demonstrated({**e, "current_module_id": "M1", "current_lesson_id": None}) == {"s1", "s2", "s3"}
        # Completed → everything active.
        assert trophy_service.online_skills_demonstrated({**e, "status": "completed"}) == {"s1", "s2", "s3", "s4", "s5"}
        # In-person rows never use the pointer signal.
        assert trophy_service.online_skills_demonstrated({**e, "delivery_channel": "in_person_school", "status": "completed"}) == set()
        # Skills are distinct across enrollments (trainer-scored s1 does not double count).
        _enrollment(dog["id"], goal_progress={"s1": {"score": 5}, "s7": {"score": 4}})
        assert run(trophy_service._count_dog_skills_mastered(server.db, dog["id"])) == 5
        awarded = run(trophy_service.check_dog_trophies(server.db, dog["id"]))
        codes = {a["trophy_code"] for a in awarded}
        assert {"dog_quick_learner", "dog_skill_master"} <= codes, codes
        assert "dog_top_dog" not in codes


def test_graduating_from_the_trainer_endpoint_awards_graduate_immediately():
    with _client_and_dog() as (c, dog):
        e = _enrollment(dog["id"])
        admin = _admin_user()
        run(server.update_enrollment(dog["id"], e["id"], server.EnrollmentUpdate(status="completed"), admin))
        row = run(server.db.awarded_trophies.find_one({"dog_id": dog["id"], "trophy_code": "dog_graduate"}, {"_id": 0}))
        assert row is not None, "graduation must hand out Sit Happens Graduate without waiting for a sweep"


def test_dog_sweep_backfills_graduations_and_status_endpoint_reports_dogs():
    with _client_and_dog() as (c, dog):
        _enrollment(dog["id"], status="completed", completed_at=server.now_iso())
        assert run(server.db.awarded_trophies.find_one({"dog_id": dog["id"], "trophy_code": "dog_graduate"})) is None
        summary = run(trophy_service.recheck_all_trophies(server.db))
        assert summary["dogs_checked"] >= 1 and summary["by_code"].get("dog_graduate", 0) >= 1
        assert run(server.db.awarded_trophies.find_one({"dog_id": dog["id"], "trophy_code": "dog_graduate"})) is not None
        again = run(trophy_service.recheck_all_dog_trophies(server.db))
        assert again["by_code"].get("dog_graduate", 0) == 0, "idempotent"
        out = run(server.admin_recheck_trophies(_admin_user()))
        assert "dogs_checked" in out and "clients_checked" in out


def test_checkpoint_evaluator_has_a_catalog_trophy():
    from trophies_data import SEED_TROPHIES
    kinds = {t.get("trigger_kind") for t in SEED_TROPHIES if t.get("trigger_type") == "auto"}
    assert "first_checkpoint_passed" in kinds
    row = run(server.db.trophies.find_one({"code": "dog_checkpoint_cleared"}, {"_id": 0}))
    assert row and row["trigger_kind"] == "first_checkpoint_passed" and row["active"] is True
    quick = run(server.db.trophies.find_one({"code": "dog_quick_learner"}, {"_id": 0}))
    assert "perfect 5" not in (quick.get("description") or "")
