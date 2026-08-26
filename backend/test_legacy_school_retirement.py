"""School-only curriculum retirement regression coverage.

The app used to treat any dog_programs row that was not ``online_school`` as
current trainer work.  These tests lock the new rule: only canonical School
channels drive current training; old rows remain history and must be explicitly
migrated by Admin.
"""
import uuid

import _test_env  # noqa: F401
import pytest
import server
from _test_loop import run

TAG = "TEST_LEGACY_RETIRE"


def _admin():
    return {"id": f"{TAG}-admin", "name": "Legacy Admin", "email": "legacy@test", "role": "admin"}


def _client_dog():
    cid = str(uuid.uuid4())
    did = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.invalid"}))
    run(server.db.dogs.insert_one({
        "id": did, "name": f"{TAG} Dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"},
    }))
    return run(server.db.dogs.find_one({"id": did}, {"_id": 0}))


def _ready_program(delivery_mode="both"):
    gid = str(uuid.uuid4())
    lid = str(uuid.uuid4())
    mid = str(uuid.uuid4())
    body = server.ProgramIn(
        name=f"{TAG} School {uuid.uuid4().hex[:6]}", type="private_lessons",
        delivery_mode=delivery_mode, format={"count": 1, "unit": "weeks"},
        modules=[server.ModuleIn(
            id=mid, name="Week 1", order=0,
            goals=[server.GoalIn(id=gid, name="Sit", order=0)],
            lessons=[server.LessonIn(id=lid, name="Day 1 · Sit", order=0, skill_ids=[gid])],
        )],
    )
    return run(server.create_program(body, _admin()))


def _legacy_program():
    gid = str(uuid.uuid4())
    body = server.ProgramIn(
        name=f"{TAG} Legacy {uuid.uuid4().hex[:6]}", type="private_lessons",
        modules=[server.ModuleIn(id=str(uuid.uuid4()), name="Old Week", goals=[server.GoalIn(id=gid, name="Old Sit")])],
    )
    return run(server.create_program(body, _admin()))


def _insert_legacy(dog, program, *, snapshot=None, current_lesson_id=None, score=2):
    modules = (snapshot or program).get("modules") or []
    progress = server._empty_progress(modules)
    if progress:
        first = next(iter(progress))
        progress[first] = {"status": "in_progress", "score": score, "notes": "legacy note", "last_session_at": None}
    doc = {
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "program_id": program["id"],
        "program_snapshot": snapshot or {
            "name": program["name"], "type": program["type"], "slug": program.get("slug"),
            "description": program.get("description", ""), "focus": program.get("focus", ""),
            "format": program.get("format"), "modules": modules,
            "completion_rule": program.get("completion_rule") or server._default_completion_rule(),
        },
        "status": "active", "started_at": server.business_today().isoformat(),
        "goal_progress": progress, "sessions_count": 1, "trainer_notes": "old trainer note",
        "created_at": server.now_iso(), "current_module_id": modules[0].get("id") if modules else None,
        "current_lesson_id": current_lesson_id,
        # deliberately NO School delivery_channel: this is the legacy shape
    }
    run(server.db.dog_programs.insert_one(doc))
    run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"active_program_id": doc["id"]}}))
    return run(server.db.dog_programs.find_one({"id": doc["id"]}, {"_id": 0}))


@pytest.fixture(autouse=True)
def _clean():
    yield
    dogs = run(server.db.dogs.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1, "owner_id": 1}).to_list(500))
    dog_ids = [d["id"] for d in dogs]
    client_ids = [d.get("owner_id") for d in dogs if d.get("owner_id")]
    for coll in ("dog_programs", "school_enrollments", "training_session_log", "training_session_drafts", "homework", "school_events"):
        run(server.db[coll].delete_many({"dog_id": {"$in": dog_ids}}))
    run(server.db.programs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.dogs.delete_many({"id": {"$in": dog_ids}}))
    run(server.db.clients.delete_many({"id": {"$in": client_ids}}))


def test_legacy_enrollment_creator_is_gone():
    dog = _client_dog()
    p = _legacy_program()
    with pytest.raises(server.HTTPException) as exc:
        run(server.retired_legacy_enrollment_route(dog["id"], server.EnrollIn(program_id=p["id"]), _admin()))
    assert exc.value.status_code == 410


def test_modules_goals_only_program_cannot_be_newly_assigned_to_school():
    dog = _client_dog()
    p = _legacy_program()
    with pytest.raises(server.HTTPException) as exc:
        run(server.school_enroll(server.SchoolEnrollIn(
            dog_id=dog["id"], program_id=p["id"], delivery_mode="in_person"), _admin()))
    assert exc.value.status_code == 422
    assert "retired legacy" in str(exc.value.detail).lower()


def test_active_legacy_is_not_resolved_as_current_trainer_work():
    dog = _client_dog()
    p = _legacy_program()
    legacy = _insert_legacy(dog, p)
    resolved = run(server._resolve_active_enrollment_for_dog(dog["id"]))
    assert resolved == {"ok": False, "reason": "no_active_enrollment"}
    summary = server._enrollment_summary(legacy)
    assert summary["curriculum_system"] == "legacy"
    assert summary["legacy_read_only"] is True


def test_same_program_school_ready_snapshot_is_adopted_in_place():
    dog = _client_dog()
    p = _ready_program("both")
    lid = p["modules"][0]["lessons"][0]["id"]
    snapshot = {
        "name": p["name"], "type": p["type"], "slug": p.get("slug"),
        "description": p.get("description", ""), "focus": p.get("focus", ""),
        "format": p.get("format"), "modules": p["modules"],
        "completion_rule": p.get("completion_rule") or server._default_completion_rule(),
    }
    legacy = _insert_legacy(dog, p, snapshot=snapshot, current_lesson_id=lid, score=3)
    before = legacy["goal_progress"]
    result = run(server.migrate_legacy_enrollment_to_school(
        legacy["id"], server.LegacySchoolMigrationIn(target_program_id=p["id"], target_lesson_id=lid), _admin()))
    assert result["strategy"] == "adopted_in_place"
    assert result["enrollment"]["id"] == legacy["id"]
    fresh = run(server.db.dog_programs.find_one({"id": legacy["id"]}, {"_id": 0}))
    assert fresh["delivery_channel"] == "in_person_school"
    assert fresh["goal_progress"] == before
    se = run(server.db.school_enrollments.find_one({"enrollment_id": legacy["id"]}, {"_id": 0}))
    assert se and se["delivery_mode"] == "trainer_led"


def test_different_legacy_curriculum_moves_to_selected_school_lesson_and_retires_old_row():
    dog = _client_dog()
    old = _legacy_program()
    legacy = _insert_legacy(dog, old)
    target = _ready_program("both")
    lid = target["modules"][0]["lessons"][0]["id"]
    result = run(server.migrate_legacy_enrollment_to_school(
        legacy["id"], server.LegacySchoolMigrationIn(target_program_id=target["id"], target_lesson_id=lid), _admin()))
    assert result["strategy"] == "migrated_to_school_program"
    assert result["enrollment"]["id"] != legacy["id"]
    old_fresh = run(server.db.dog_programs.find_one({"id": legacy["id"]}, {"_id": 0}))
    assert old_fresh["status"] == "withdrawn"
    assert old_fresh["legacy_read_only"] is True
    assert old_fresh["legacy_migrated_to_enrollment_id"] == result["enrollment"]["id"]
    new_fresh = run(server.db.dog_programs.find_one({"id": result["enrollment"]["id"]}, {"_id": 0}))
    assert new_fresh["current_lesson_id"] == lid
    assert legacy["id"] in new_fresh["legacy_history_enrollment_ids"]


def test_legacy_history_merges_into_existing_online_and_upgrades_it_to_hybrid():
    dog = _client_dog()
    p = _ready_program("both")
    online = run(server.school_enroll(server.SchoolEnrollIn(
        dog_id=dog["id"], program_id=p["id"], delivery_mode="online"), _admin()))
    legacy = _insert_legacy(dog, p)
    lid = p["modules"][0]["lessons"][0]["id"]
    result = run(server.migrate_legacy_enrollment_to_school(
        legacy["id"], server.LegacySchoolMigrationIn(target_program_id=p["id"], target_lesson_id=lid), _admin()))
    assert result["strategy"] == "merged_into_existing_school"
    assert result["enrollment"]["id"] == online["enrollment"]["id"]
    fresh = run(server.db.dog_programs.find_one({"id": online["enrollment"]["id"]}, {"_id": 0}))
    assert fresh["delivery_channel"] == "hybrid_school"
    assert legacy["id"] in fresh["legacy_history_enrollment_ids"]
    se = run(server.db.school_enrollments.find_one({"enrollment_id": fresh["id"]}, {"_id": 0}))
    assert se["delivery_mode"] == "hybrid"


def test_session_log_follows_legacy_lineage_after_migration():
    dog = _client_dog()
    old = _legacy_program()
    legacy = _insert_legacy(dog, old)
    run(server.db.training_session_log.insert_one({
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "enrollment_id": legacy["id"],
        "at": server.now_iso(), "by_user": "Old Trainer", "goal_updates": [],
    }))
    target = _ready_program()
    lid = target["modules"][0]["lessons"][0]["id"]
    migrated = run(server.migrate_legacy_enrollment_to_school(
        legacy["id"], server.LegacySchoolMigrationIn(target_program_id=target["id"], target_lesson_id=lid), _admin()))
    rows = run(server.list_training_session_log(dog["id"], migrated["enrollment"]["id"], 50, _admin()))
    assert any(r.get("enrollment_id") == legacy["id"] and r.get("by_user") == "Old Trainer" for r in rows)
