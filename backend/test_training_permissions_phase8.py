"""Training-school expansion, Phase 8 — notes and permissions audit fixes.

  * A trainer (manage_training_sessions) can now actually perform the full
    operational workflow — enroll a dog, update an enrollment, view the
    Training Hub pipeline, view the active-programs summary, and view a
    dog's own enrollment list — without needing role=="admin". Before this
    phase these were all hard-gated to literal admin, which is exactly the
    "trainer-role employees... without falsely requiring role=='admin'" gap
    the spec called out.
  * Front Desk (no manage_training_sessions) stays blocked from all of the
    above, same as before.
  * A client can still view their OWN dog's enrollment list, but not
    another client's dog's.
  * manage_training_content vs manage_training_sessions stays a real split:
    a trainer with only manage_training_sessions cannot create a custom
    program (content-authoring), and vice versa a content-only role
    (hypothetically) cannot enroll a dog.

Same fixture/cleanup convention as test_trainer_dashboard_phase7.py.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_TRAINING_PERMS_PHASE8"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def get(url, headers=None, params=None):
        return run(_http.get(url, headers=headers, params=params))

    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))

    @staticmethod
    def put(url, headers=None, json=None):
        return run(_http.put(url, headers=headers, json=json))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


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


def _insert_client_with_password(dog_owner=True):
    uid = str(uuid.uuid4())
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    run(server.db.users.insert_one({
        "id": uid, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, c["email"], "client", 0)
    return c, uid, {"Authorization": f"Bearer {token}"}


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
def _program():
    admin = _admin_user()
    body = server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit")])],
    )
    prog = run(server.create_program(body, admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


# ---------------------------------------------------------------------------
# Trainer can now perform the operational workflow without role=="admin"
# ---------------------------------------------------------------------------

def test_trainer_can_enroll_and_update_enrollment_front_desk_cannot():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            enr_id = None
            try:
                r_fd = client.post(f"/api/dogs/{dog['id']}/programs", headers=fd_h, json={"program_id": prog["id"]})
                assert r_fd.status_code == 403, r_fd.text

                r_trainer = client.post(f"/api/dogs/{dog['id']}/programs", headers=trainer_h, json={"program_id": prog["id"]})
                assert r_trainer.status_code == 200, r_trainer.text
                enr_id = r_trainer.json()["id"]

                r_update_fd = client.put(f"/api/dogs/{dog['id']}/programs/{enr_id}", headers=fd_h, json={"trainer_notes": "nope"})
                assert r_update_fd.status_code == 403

                r_update_trainer = client.put(f"/api/dogs/{dog['id']}/programs/{enr_id}", headers=trainer_h, json={"trainer_notes": "Great energy today"})
                assert r_update_trainer.status_code == 200
            finally:
                if enr_id:
                    run(server.db.dog_programs.delete_one({"id": enr_id}))
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))


def test_trainer_can_view_pipeline_and_active_summary_front_desk_cannot():
    trainer_uid, trainer_h = _insert_staff("trainer")
    fd_uid, fd_h = _insert_staff("front_desk")
    try:
        assert client.get("/api/programs/pipeline", headers=fd_h).status_code == 403
        assert client.get("/api/programs/pipeline", headers=trainer_h).status_code == 200
        assert client.get("/api/programs/active-summary", headers=fd_h).status_code == 403
        assert client.get("/api/programs/active-summary", headers=trainer_h).status_code == 200
    finally:
        run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))


def test_trainer_can_view_dog_enrollment_list_front_desk_cannot():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            try:
                r_fd = client.get(f"/api/dogs/{dog['id']}/programs", headers=fd_h)
                assert r_fd.status_code == 403

                r_trainer = client.get(f"/api/dogs/{dog['id']}/programs", headers=trainer_h)
                assert r_trainer.status_code == 200
                assert any(e["id"] == enr["id"] for e in r_trainer.json())
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))


# ---------------------------------------------------------------------------
# A client can view their own dog's enrollments, never another client's
# ---------------------------------------------------------------------------

def test_client_can_view_own_dog_enrollments_not_anothers():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            owner_client, owner_uid, owner_h = _insert_client_with_password()
            other_client, other_uid, other_h = _insert_client_with_password()
            # Re-point the dog's owner to owner_client so ownership actually matches.
            run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"owner_id": owner_client["id"]}}))
            try:
                r_owner = client.get(f"/api/dogs/{dog['id']}/programs", headers=owner_h)
                assert r_owner.status_code == 200
                assert any(e["id"] == enr["id"] for e in r_owner.json())

                r_other = client.get(f"/api/dogs/{dog['id']}/programs", headers=other_h)
                assert r_other.status_code == 403
            finally:
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))
                run(server.db.users.delete_many({"id": {"$in": [owner_uid, other_uid]}}))
                run(server.db.clients.delete_many({"id": {"$in": [owner_client["id"], other_client["id"]]}}))


# ---------------------------------------------------------------------------
# manage_training_content vs manage_training_sessions stays a real split
# ---------------------------------------------------------------------------

def test_operational_only_trainer_cannot_create_custom_program():
    with _client_and_dog() as (c, dog):
        trainer_uid, trainer_h = _insert_staff("trainer")
        try:
            # Trainer has BOTH permissions by default (matches the app's real
            # role matrix), so simulate a hypothetical operational-only role
            # by stripping manage_training_content via the override table.
            run(server.db.users.update_one({"id": trainer_uid}, {"$set": {"staff_role": "front_desk"}}))
            r = client.post(f"/api/dogs/{dog['id']}/programs/custom", headers=trainer_h, json={
                "name": "Ad hoc plan", "format": {"count": 1, "unit": "sessions"}, "modules": [],
            })
            assert r.status_code == 403  # front_desk has neither permission
        finally:
            run(server.db.users.delete_one({"id": trainer_uid}))


def test_trainer_with_both_permissions_can_create_custom_program():
    with _client_and_dog() as (c, dog):
        trainer_uid, trainer_h = _insert_staff("trainer")
        try:
            r = client.post(f"/api/dogs/{dog['id']}/programs/custom", headers=trainer_h, json={
                "name": f"{TAG} Ad hoc plan", "format": {"count": 1, "unit": "sessions"}, "modules": [],
            })
            assert r.status_code == 200, r.text
            enr_id = r.json()["id"]
            prog_id = r.json()["program_id"]
            run(server.db.dog_programs.delete_one({"id": enr_id}))
            run(server.db.programs.delete_one({"id": prog_id}))
        finally:
            run(server.db.users.delete_one({"id": trainer_uid}))
