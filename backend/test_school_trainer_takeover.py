"""Changing a dog's trainer needs 'Assign training staff' everywhere (audit #55).

School HQ let anyone with School access change a dog's trainer — including
taking over another trainer's dog, or clearing it — and being the dog's
trainer lets you graduate it (and reopen it). Now School HQ, Repeat
Program and the legacy move follow the same rule as the rest of the app:
changing or removing a dog's trainer needs the permission; without it, the
only change is naming yourself on a dog with no trainer yet. A School HQ
save that doesn't change the trainer never touches it (it used to wipe it
when HQ's copy had fallen behind).

Reuses the Trainer Day fixtures (tag TLW).
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.training import services as training_services
from test_training_session_workspace import _http, _insert_staff  # noqa: F401
from test_trainer_lesson_workspace import ADMIN, _clean, _enrollment, _seed  # noqa: F401


def _owner():
    run(server.db.users.update_one({"id": ADMIN["id"]}, {"$set": {**ADMIN, "password_hash": "x", "active": True,
                                   "must_change_password": False, "needs_password": False, "token_version": 0}}, upsert=True))
    return {"Authorization": f"Bearer {server.create_access_token(ADMIN['id'], ADMIN['email'], 'admin', 0)}"}


@pytest.fixture
def dog():
    s = _seed("in_person")
    t1, t1h = _insert_staff("trainer")
    t2, t2h = _insert_staff("trainer")
    mgr, mgrh = _insert_staff("manager")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": t1}}))
    run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"assigned_trainer_id": t1}}))
    yield {**s, "t1": t1, "t1h": t1h, "t2": t2, "t2h": t2h, "mgr": mgr, "mgrh": mgrh, "owner": _owner()}
    run(server.db.users.delete_many({"id": {"$in": [t1, t2, mgr]}}))


def _patch(d, headers, body):
    return run(_http.patch(f"/api/admin/school/students/{d['se_id']}", headers=headers, json=body))


def _trainers(d):
    dp = _enrollment(d)
    se = run(server.db.school_enrollments.find_one({"id": d["se_id"]}, {"_id": 0}))
    return dp.get("assigned_trainer_id"), se.get("assigned_trainer_id")


def _refused(r):
    assert r.status_code == 403, (r.status_code, r.text[:300])
    assert "Assign training staff" in r.json()["detail"]


# ---- School HQ ---------------------------------------------------------------

def test_a_trainer_cannot_take_over_another_trainers_dog(dog):
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": dog["t2"]}))
    assert _trainers(dog) == (dog["t1"], dog["t1"])


@pytest.mark.parametrize("who", ["t2h", "t1h"])
def test_clearing_a_dogs_trainer_needs_the_permission_even_your_own(dog, who):
    _refused(_patch(dog, dog[who], {"assigned_trainer_id": None}))
    assert _trainers(dog) == (dog["t1"], dog["t1"])


def test_on_a_dog_with_no_trainer_you_may_name_yourself_but_not_someone_else(dog):
    run(server.db.dog_programs.update_one({"id": dog["enrollment_id"]}, {"$set": {"assigned_trainer_id": None}}))
    run(server.db.school_enrollments.update_one({"id": dog["se_id"]}, {"$set": {"assigned_trainer_id": None}}))
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": dog["t1"]}))
    r = _patch(dog, dog["t2h"], {"assigned_trainer_id": dog["t2"]})
    assert r.status_code == 200, r.text[:300]
    assert _trainers(dog) == (dog["t2"], dog["t2"])


def test_a_deactivated_trainer_still_counts_as_the_dogs_trainer(dog):
    run(server.db.users.update_one({"id": dog["t1"]}, {"$set": {"active": False}}))
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": dog["t2"]}))


@pytest.mark.parametrize("who", ["owner", "mgrh"])
def test_the_owner_and_a_manager_can_change_or_clear_any_dogs_trainer(dog, who):
    assert _patch(dog, dog[who], {"assigned_trainer_id": dog["t2"]}).status_code == 200
    assert _trainers(dog) == (dog["t2"], dog["t2"])
    assert _patch(dog, dog[who], {"assigned_trainer_id": None}).status_code == 200
    assert _trainers(dog) == (None, None)


def test_an_admin_login_with_a_trainer_role_is_held_to_the_same_rule(dog):
    _uid, h = _insert_staff("trainer", role="admin")
    try:
        _refused(_patch(dog, h, {"assigned_trainer_id": _uid}))
    finally:
        run(server.db.users.delete_many({"id": _uid}))


def test_the_permission_is_checked_before_anything_else(dog):
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": f"nobody-{uuid.uuid4().hex[:6]}"}))


def test_a_save_that_doesnt_change_the_trainer_never_touches_it(dog):
    # HQ's copy fell behind (the real trainer is on the program).
    run(server.db.school_enrollments.update_one({"id": dog["se_id"]}, {"$set": {"assigned_trainer_id": None}}))
    r = _patch(dog, dog["t1h"], {"pause_until": "2026-12-01"})
    assert r.status_code == 200 and _enrollment(dog)["school_pause_until"] == "2026-12-01"
    assert _trainers(dog) == (dog["t1"], None)
    r = _patch(dog, dog["t1h"], {"assigned_trainer_id": dog["t1"], "pause_until": None})
    assert r.status_code == 200
    assert _trainers(dog) == (dog["t1"], dog["t1"]), "the same trainer heals HQ's copy"


def test_when_hqs_copy_shows_no_trainer_the_real_one_still_counts(dog):
    run(server.db.school_enrollments.update_one({"id": dog["se_id"]}, {"$set": {"assigned_trainer_id": None}}))
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": dog["t2"]}))
    # and the drawer's old habit of sending HQ's empty copy back can't wipe it
    _refused(_patch(dog, dog["t1h"], {"assigned_trainer_id": None, "pause_until": "2026-12-01"}))
    assert _enrollment(dog)["assigned_trainer_id"] == dog["t1"]


def test_clearing_then_reopening_is_not_a_way_round(dog):
    run(server.db.dog_programs.update_one({"id": dog["enrollment_id"]}, {"$set": {"status": "completed"}}))
    reopen = f"/api/training/enrollments/{dog['enrollment_id']}/reopen-program"
    assert run(_http.post(reopen, headers=dog["t2h"], json={"reason": "Graduated by mistake"})).status_code == 403
    _refused(_patch(dog, dog["t2h"], {"assigned_trainer_id": None}))
    assert run(_http.post(reopen, headers=dog["t2h"], json={"reason": "Graduated by mistake"})).status_code == 403


# ---- Repeat Program ----------------------------------------------------------

def _retake(d, headers, body):
    return run(_http.post(f"/api/admin/school/students/{d['se_id']}/retake", headers=headers, json=body))


def test_repeat_program_carries_the_trainer_over_and_naming_yourself_over_it_needs_the_permission(dog):
    run(server.db.dog_programs.update_one({"id": dog["enrollment_id"]}, {"$set": {"status": "completed"}}))
    _refused(_retake(dog, dog["t2h"], {"delivery_mode": "in_person", "assigned_trainer_id": dog["t2"]}))
    r = _retake(dog, dog["t2h"], {"delivery_mode": "in_person"})
    assert r.status_code == 200, r.text[:300]
    assert r.json()["enrollment"]["assigned_trainer_id"] == dog["t1"], "the previous trainer carries over"


def test_repeat_program_by_the_owner_can_name_anyone(dog):
    run(server.db.dog_programs.update_one({"id": dog["enrollment_id"]}, {"$set": {"status": "completed"}}))
    r = _retake(dog, dog["owner"], {"delivery_mode": "in_person", "assigned_trainer_id": dog["t2"]})
    assert r.status_code == 200 and r.json()["enrollment"]["assigned_trainer_id"] == dog["t2"]


def test_repeat_program_with_no_trainer_before_lets_you_name_yourself(dog):
    run(server.db.dog_programs.update_one({"id": dog["enrollment_id"]}, {"$set": {"status": "completed", "assigned_trainer_id": None}}))
    run(server.db.school_enrollments.update_one({"id": dog["se_id"]}, {"$set": {"assigned_trainer_id": None}}))
    r = _retake(dog, dog["t2h"], {"delivery_mode": "in_person", "assigned_trainer_id": dog["t2"]})
    assert r.status_code == 200 and r.json()["enrollment"]["assigned_trainer_id"] == dog["t2"]


# ---- moving a legacy program into School ------------------------------------

def test_moving_a_legacy_program_cannot_take_over_its_trainer():
    from test_legacy_school_retirement import _client_dog, _insert_legacy, _ready_program
    t1, _h1 = _insert_staff("trainer")
    t2 = str(uuid.uuid4())
    admin_trainer = {"id": t2, "role": "admin", "staff_role": "trainer", "name": "Admin Trainer", "email": "at@example.invalid"}
    run(server.db.users.insert_one({**admin_trainer, "password_hash": "x", "active": True}))
    try:
        dog = _client_dog()
        p = _ready_program("both")
        lid = p["modules"][0]["lessons"][0]["id"]
        snapshot = {"name": p["name"], "type": p["type"], "modules": p["modules"],
                    "completion_rule": p.get("completion_rule") or server._default_completion_rule()}
        legacy = _insert_legacy(dog, p, snapshot=snapshot, current_lesson_id=lid)
        run(server.db.dog_programs.update_one({"id": legacy["id"]}, {"$set": {"assigned_trainer_id": t1}}))
        body = server.LegacySchoolMigrationIn(target_program_id=p["id"], target_lesson_id=lid, assigned_trainer_id=t2)
        with pytest.raises(server.HTTPException) as e:
            run(server.migrate_legacy_enrollment_to_school(legacy["id"], body, admin_trainer))
        assert e.value.status_code == 403 and "Assign training staff" in e.value.detail
        out = run(server.migrate_legacy_enrollment_to_school(legacy["id"], body, ADMIN))
        assert out["enrollment"]["assigned_trainer_id"] == t2, "the owner may"
    finally:
        run(server.db.users.delete_many({"id": {"$in": [t1, t2]}}))
        for d in run(server.db.dogs.find({"name": {"$regex": "TEST_LEGACY_RETIRE"}}, {"_id": 0, "id": 1, "owner_id": 1}).to_list(None)):
            for coll in ("dog_programs", "school_enrollments", "school_events"):
                run(server.db[coll].delete_many({"dog_id": d["id"]}))
            run(server.db.clients.delete_many({"id": d.get("owner_id")}))
            run(server.db.dogs.delete_many({"id": d["id"]}))
        run(server.db.programs.delete_many({"name": {"$regex": "TEST_LEGACY_RETIRE"}}))


# ---- the rule ----------------------------------------------------------------

def test_the_rule():
    me = {"id": "me"}
    staff = lambda u: {"assign_training_staff": u.get("boss", False)}  # noqa: E731
    ok = lambda new, cur, u=me: training_services.require_trainer_assignment_authority(u, new, cur, staff)  # noqa: E731
    ok("x", "x"); ok(None, None); ok("", None)          # unchanged never needs it
    ok("me", None)                                      # claim a dog with no trainer
    ok("other", "x", {"id": "me", "boss": True})        # the permission allows anything
    ok(None, "x", {"id": "me", "boss": True})
    for new, cur in (("other", None), ("me", "x"), (None, "x"), (None, "me"), ("other", "me")):
        with pytest.raises(server.HTTPException) as e:
            ok(new, cur)
        assert e.value.status_code == 403 and "Assign training staff" in e.value.detail, (new, cur)
