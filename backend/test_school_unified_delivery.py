"""School consolidation review — unified delivery modes (in person / online / hybrid).

The staged consolidation added ~580 lines of backend logic with NO tests.
This suite covers the invariants the architecture depends on:

  * one curriculum + ONE progress ledger per dog+program, in every mode
  * duplicate-enrollment protection across delivery channels
  * delivery-mode <-> channel mapping and program-capability validation
  * permission boundaries (client / restricted trainer / School admin)
  * client privacy on the raw training-enrollment endpoint
  * School-owned Practice never appears twice to the client

Disposable-DB harness, same convention as the other School suites. Tag TEST_SUD.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_SUD"


def _admin():
    return {"id": f"{TAG}-admin", "name": "SUD Admin", "email": "sud@test", "role": "admin"}


def _staff(staff_role):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}", "role": "employee",
        "staff_role": staff_role, "password_hash": "x", "active": True,
        "must_change_password": False, "needs_password": False,
    }))
    return run(server.db.users.find_one({"id": uid}, {"_id": 0}))


def _client_user(client_id):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-client-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} Client User", "role": "client",
        "client_id": client_id, "password_hash": "x", "active": True,
        "must_change_password": False, "needs_password": False,
    }))
    return run(server.db.users.find_one({"id": uid}, {"_id": 0}))


def _program(delivery_mode="both"):
    body = server.ProgramIn(
        name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": 1, "unit": "modules"}, price=0, delivery_mode=delivery_mode,
        modules=[server.ModuleIn(name="Module 1", order=0, goals=[server.GoalIn(name="Sit")])],
    )
    return run(server.create_program(body, _admin()))


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


def _enroll(dog, program, mode, user=None, **kw):
    body = server.SchoolEnrollIn(dog_id=dog["id"], program_id=program["id"],
                                 delivery_mode=mode, **kw)
    return run(server.school_enroll(body, user or _admin()))


@pytest.fixture(autouse=True)
def _clean():
    yield
    dog_ids = [d["id"] for d in run(
        server.db.dogs.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1}).to_list(500))]
    for coll in ("dog_programs", "school_enrollments", "homework",
                 "checkpoint_submissions", "school_events"):
        run(server.db[coll].delete_many({"dog_id": {"$in": dog_ids}}))
    run(server.db.programs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    run(server.db.dogs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.users.delete_many({"name": {"$regex": TAG}}))
    run(server.db.role_permission_overrides.delete_many({"staff_role": "trainer"}))


# ═══════════ one ledger per delivery mode ═══════════

def test_in_person_creates_one_ledger_and_companion():
    c, dog = _client_and_dog()
    res = _enroll(dog, _program("trainer_led"), "in_person")
    dps = run(server.db.dog_programs.find({"dog_id": dog["id"]}, {"_id": 0}).to_list(10))
    ses = run(server.db.school_enrollments.find({"dog_id": dog["id"]}, {"_id": 0}).to_list(10))
    assert len(dps) == 1, "exactly ONE progress ledger row"
    assert len(ses) == 1, "exactly ONE School identity row"
    assert dps[0]["delivery_channel"] == "in_person_school"
    assert ses[0]["delivery_mode"] == "trainer_led"
    assert ses[0]["enrollment_id"] == dps[0]["id"], "companion points at the ledger"
    assert res["school_enrollment"]["id"] == ses[0]["id"]


def test_online_channel_and_mode():
    c, dog = _client_and_dog()
    _enroll(dog, _program("self_guided"), "online")
    dp = run(server.db.dog_programs.find_one({"dog_id": dog["id"]}, {"_id": 0}))
    se = run(server.db.school_enrollments.find_one({"dog_id": dog["id"]}, {"_id": 0}))
    assert dp["delivery_channel"] == "online_school"
    assert se["delivery_mode"] == "self_guided"


def test_online_is_the_backward_compatible_default():
    """Omitting delivery_mode must still mean Online School."""
    c, dog = _client_and_dog()
    p = _program("self_guided")
    run(server.school_enroll(
        server.SchoolEnrollIn(dog_id=dog["id"], program_id=p["id"]), _admin()))
    dp = run(server.db.dog_programs.find_one({"dog_id": dog["id"]}, {"_id": 0}))
    assert dp["delivery_channel"] == "online_school"


def test_hybrid_creates_one_ledger():
    c, dog = _client_and_dog()
    _enroll(dog, _program("both"), "hybrid")
    dps = run(server.db.dog_programs.find({"dog_id": dog["id"]}, {"_id": 0}).to_list(10))
    se = run(server.db.school_enrollments.find_one({"dog_id": dog["id"]}, {"_id": 0}))
    assert len(dps) == 1
    assert dps[0]["delivery_channel"] == "hybrid_school"
    assert se["delivery_mode"] == "hybrid"


# ═══════════ program-capability validation ═══════════

def test_self_guided_program_rejects_in_person():
    c, dog = _client_and_dog()
    with pytest.raises(server.HTTPException) as e:
        _enroll(dog, _program("self_guided"), "in_person")
    assert e.value.status_code == 422


def test_trainer_led_program_rejects_hybrid():
    c, dog = _client_and_dog()
    with pytest.raises(server.HTTPException) as e:
        _enroll(dog, _program("trainer_led"), "hybrid")
    assert e.value.status_code == 422


# ═══════════ duplicate protection ═══════════

def test_duplicate_in_person_enrollment_rejected():
    c, dog = _client_and_dog()
    p = _program("trainer_led")
    _enroll(dog, p, "in_person")
    with pytest.raises(server.HTTPException) as e:
        _enroll(dog, p, "in_person")
    assert e.value.status_code == 409
    assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"]})) == 1


def test_cross_channel_duplicate_rejected():
    """An active online enrollment must block a second in-person copy of the
    same curriculum — one dog+program has ONE live progress ledger."""
    c, dog = _client_and_dog()
    p = _program("both")
    _enroll(dog, p, "online")
    with pytest.raises(server.HTTPException) as e:
        _enroll(dog, p, "in_person")
    assert e.value.status_code == 409
    assert run(server.db.dog_programs.count_documents(
        {"dog_id": dog["id"], "status": "active"})) == 1


# ═══════════ permissions ═══════════

def test_client_cannot_enroll_in_any_mode():
    c, dog = _client_and_dog()
    p = _program("both")
    cu = _client_user(c["id"])
    for mode in ("online", "in_person", "hybrid"):
        with pytest.raises(server.HTTPException) as e:
            _enroll(dog, p, mode, user=cu)
        assert e.value.status_code == 403, f"client must not enroll ({mode})"
    assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"]})) == 0


def test_restricted_trainer_may_run_in_person_but_not_online(monkeypatch):
    """manage_training_sessions enables in-person delivery; it must NOT
    confer Online School administration."""
    c, dog = _client_and_dog()
    p = _program("both")
    tr = _staff("trainer")
    # Simulate an owner who narrowed the trainer role: training sessions yes,
    # School administration no.
    monkeypatch.setitem(server._ROLE_OVERRIDES, "trainer",
                        {"manage_school": False, "manage_training_sessions": True})
    perms = server._perms_for(tr)
    assert perms.get("manage_training_sessions") is True
    assert not perms.get("manage_school")
    with pytest.raises(server.HTTPException) as e:
        _enroll(dog, p, "online", user=tr)
    assert e.value.status_code == 403
    res = _enroll(dog, p, "in_person", user=tr)
    assert res["school_enrollment"]["delivery_mode"] == "trainer_led"


# ═══════════ client privacy on the raw endpoint ═══════════

def test_raw_enrollment_endpoint_hides_all_school_channels_from_client():
    """Regression for the leak this consolidation patched: in-person and
    hybrid School rows must not escape through the raw endpoint."""
    c, dog = _client_and_dog()
    cu = _client_user(c["id"])
    _enroll(dog, _program("trainer_led"), "in_person")
    out = run(server.list_dog_enrollments(dog["id"], cu))
    rows = out if isinstance(out, list) else (out.get("enrollments") or [])
    assert all(r.get("delivery_channel") not in server.SCHOOL_DELIVERY_CHANNELS for r in rows), \
        "no School-channel enrollment may reach the client via the raw endpoint"


def test_raw_enrollment_endpoint_still_shows_staff_everything():
    c, dog = _client_and_dog()
    _enroll(dog, _program("trainer_led"), "in_person")
    out = run(server.list_dog_enrollments(dog["id"], _admin()))
    rows = out if isinstance(out, list) else (out.get("enrollments") or [])
    assert any(r.get("delivery_channel") == "in_person_school" for r in rows), \
        "staff must still see School enrollments on the admin-facing endpoint"


# ═══════════ Practice de-duplication ═══════════

def test_school_practice_not_duplicated_in_legacy_client_list():
    c, dog = _client_and_dog()
    res = _enroll(dog, _program("trainer_led"), "in_person")
    se_id = res["school_enrollment"]["id"]
    run(server.db.homework.insert_many([
        {"id": str(uuid.uuid4()), "dog_id": dog["id"], "client_id": c["id"],
         "title": f"{TAG} school practice", "status": "assigned",
         "school_enrollment_id": se_id, "assigned_by": "School - Lesson 1",
         "source_lesson_id": "l1", "created_at": server.now_iso()},
        {"id": str(uuid.uuid4()), "dog_id": dog["id"], "client_id": c["id"],
         "title": f"{TAG} legacy general practice", "status": "assigned",
         "assigned_by": "Auto - Legacy welcome", "created_at": server.now_iso()},
    ]))
    cu = _client_user(c["id"])
    items = run(server.list_homework(user=cu, dog_id=dog["id"]))
    titles = [i.get("title") for i in items]
    assert f"{TAG} school practice" not in titles, "School Practice must not appear twice"
    assert f"{TAG} legacy general practice" in titles, "legacy Practice must remain visible"


# ═══════════ concurrency: duplicate-enrollment race ═══════════

def test_concurrent_in_person_enrollment_does_not_create_two_ledgers():
    """DEFECT PROBE — in-person/hybrid duplicate protection is an
    application-level read-then-write check. The only unique index on
    dog_programs is partial-filtered to delivery_channel="online_school",
    so it does not cover the new channels. Two concurrent assignments (a
    double-clicked Assign Program button) must still not create two live
    progress ledgers for one dog+program.
    """
    import asyncio
    c, dog = _client_and_dog()
    p = _program("trainer_led")

    async def _both():
        body = server.SchoolEnrollIn(dog_id=dog["id"], program_id=p["id"],
                                     delivery_mode="in_person")
        return await asyncio.gather(
            server.school_enroll(body, _admin()),
            server.school_enroll(body, _admin()),
            return_exceptions=True,
        )

    results = run(_both())
    ok = [r for r in results if not isinstance(r, Exception)]
    active = run(server.db.dog_programs.count_documents(
        {"dog_id": dog["id"], "program_id": p["id"], "status": "active"}))
    companions = run(server.db.school_enrollments.count_documents(
        {"dog_id": dog["id"], "program_id": p["id"]}))
    assert active == 1, (
        f"race created {active} active progress ledgers for one dog+program "
        f"({len(ok)} concurrent calls succeeded) — duplicate progress")
    assert companions == 1, f"race created {companions} School companion rows"


def test_online_channel_race_is_index_protected():
    """Control: the ONLINE channel has a real unique index, so the same
    concurrent pattern is safe there. This contrasts the gap above."""
    import asyncio
    c, dog = _client_and_dog()
    p = _program("self_guided")

    async def _both():
        body = server.SchoolEnrollIn(dog_id=dog["id"], program_id=p["id"],
                                     delivery_mode="online")
        return await asyncio.gather(
            server.school_enroll(body, _admin()),
            server.school_enroll(body, _admin()),
            return_exceptions=True,
        )

    run(_both())
    active = run(server.db.dog_programs.count_documents(
        {"dog_id": dog["id"], "program_id": p["id"], "status": "active"}))
    assert active == 1, f"online race created {active} active ledgers"
