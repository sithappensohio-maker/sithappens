"""Found while wiring up Employee Portal walk-in check-in (2026-10-09):
`_require_booking_edit` — the gate POST /bookings, POST /bookings/group, and
"add a dog to a booking" all call before anything else — only checked the
booking_edit permission for `role == "admin"`. A `role: employee` account
(front desk, trainer, daycare/boarding staff — every non-admin staff
account) sailed straight through regardless of what the owner's Permission
Matrix said, the same class of bug audit #6 already fixed for cancelling a
booking (see test_staff_permission_gaps.py). It had zero real-world exposure
before now because no Employee Portal screen ever offered to create a
booking at all — the Employee Portal's new Walk-In button is the first UI
that can reach this endpoint as a non-admin, which is what surfaced it.

Same pattern as test_staff_permission_gaps.py: real HTTP, real tokens
(httpx.ASGITransport), so the Depends()/in-body gate is what's under test.
"""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_BOOKING_CREATE_PERM"


def _matrix(overrides):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": overrides}}, upsert=True))
    run(server._load_role_overrides_from_settings())


@pytest.fixture(autouse=True)
def _clean_overrides():
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "staff_role_permissions": 1})) or {}
    _matrix({})
    yield
    if "staff_role_permissions" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": prev["staff_role_permissions"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"staff_role_permissions": ""}}))
    run(server._load_role_overrides_from_settings())


def _mk_user(role, staff_role=None, client_id=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _call(method, path, user=None, json_body=None):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, json=json_body)
    return run(_go())


def _mk_dog_and_client():
    client = {"id": f"{TAG}-c-{uuid.uuid4().hex[:8]}", "name": f"{TAG} Client", "credits": 0}
    dog = {"id": f"{TAG}-d-{uuid.uuid4().hex[:8]}", "owner_id": client["id"], "name": f"{TAG} Dog",
           "breed": "Mutt", "vaccines": {"rabies": "2099-01-01", "bordetella": "2099-01-01", "dhpp": "2099-01-01"},
           "feeding_schedule": [], "medications": []}
    run(server.db.clients.insert_one(dict(client)))
    run(server.db.dogs.insert_one(dict(dog)))
    return client, dog


def _mk_active_daycare_service():
    svc = {"id": f"{TAG}-svc-{uuid.uuid4().hex[:8]}", "name": f"{TAG} Daycare", "service_type": "daycare", "active": True}
    run(server.db.services.insert_one(dict(svc)))
    return svc


def _cleanup(*, user_ids=(), client_ids=(), dog_ids=(), service_ids=(), booking_ids=()):
    if user_ids:
        run(server.db.users.delete_many({"id": {"$in": list(user_ids)}}))
    if client_ids:
        run(server.db.clients.delete_many({"id": {"$in": list(client_ids)}}))
    if dog_ids:
        run(server.db.dogs.delete_many({"id": {"$in": list(dog_ids)}}))
    if service_ids:
        run(server.db.services.delete_many({"id": {"$in": list(service_ids)}}))
    if booking_ids:
        run(server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}}))


def _today():
    return server.business_today().isoformat()


def test_an_employee_without_booking_edit_cannot_create_a_walk_in():
    # _require_booking_edit fires before any dog/client lookup, so a
    # deliberately-bogus dog_id is enough to isolate the permission gate —
    # a 403 here can only be the permission check, never a "dog not found".
    for staff_role in ("read_only", None):
        user = _mk_user("employee", staff_role)
        try:
            r = _call("POST", "/bookings", user, {
                "dog_id": f"{TAG}-nonexistent", "service_type": "daycare", "date": _today(),
            })
            assert r.status_code == 403, (staff_role, r.status_code, r.text)
            assert "booking_edit" in r.text.lower(), r.text
        finally:
            _cleanup(user_ids=[user["id"]])


def test_an_employee_with_booking_edit_can_create_a_walk_in():
    _matrix({"front_desk": {"booking_edit": True}})
    user = _mk_user("employee", "front_desk")
    client, dog = _mk_dog_and_client()
    svc = _mk_active_daycare_service()
    booking_id = None
    try:
        r = _call("POST", "/bookings", user, {
            "dog_id": dog["id"], "service_type": "daycare", "service_id": svc["id"],
            "date": _today(), "override_capacity": True,
        })
        assert r.status_code == 200, r.text
        booking_id = r.json()["id"]
        assert r.json()["dog_id"] == dog["id"]
    finally:
        _cleanup(user_ids=[user["id"]], client_ids=[client["id"]], dog_ids=[dog["id"]],
                 service_ids=[svc["id"]], booking_ids=[booking_id] if booking_id else [])


def test_an_employee_can_walk_in_a_dog_with_no_exact_service_id_picked():
    # Found live (2026-10-09): a walk-in doesn't always arrive with an exact
    # service_id — the "pick a category, let the server resolve the one
    # obvious active service" legacy path. resolve_base_service_for_booking
    # had the SAME role=="admin"-only bug: with zero or multiple matching
    # services (no single unambiguous default), an authorized employee got
    # the client-only "can't be booked online, contact us" refusal instead
    # of the staff manual-fallback path admin always had.
    _matrix({"front_desk": {"booking_edit": True}})
    user = _mk_user("employee", "front_desk")
    client, dog = _mk_dog_and_client()
    # Zero active daycare services on file at all — the exact shape that
    # surfaced this live.
    booking_id = None
    try:
        r = _call("POST", "/bookings", user, {
            "dog_id": dog["id"], "service_type": "daycare", "date": _today(), "override_capacity": True,
        })
        assert r.status_code == 200, r.text
        booking_id = r.json()["id"]
        assert r.json()["dog_id"] == dog["id"]
    finally:
        _cleanup(user_ids=[user["id"]], client_ids=[client["id"]], dog_ids=[dog["id"]],
                 booking_ids=[booking_id] if booking_id else [])


def test_an_employee_without_booking_edit_is_blocked_even_on_the_group_endpoint():
    user = _mk_user("employee", "read_only")
    try:
        r = _call("POST", "/bookings/group", user, {
            "dogs": [{"dog_id": f"{TAG}-nonexistent"}], "service_type": "daycare", "date": _today(),
        })
        assert r.status_code == 403, r.text
        assert "booking_edit" in r.text.lower(), r.text
    finally:
        _cleanup(user_ids=[user["id"]])


def test_a_client_can_still_book_their_own_dog_ungated_by_the_staff_matrix():
    client, dog = _mk_dog_and_client()
    client_user = _mk_user("client", client_id=client["id"])
    svc = _mk_active_daycare_service()
    run(server.db.waiver_signatures.insert_one({
        "id": f"{TAG}-wv-{uuid.uuid4().hex[:8]}", "client_id": client["id"],
        "waiver_version": 1, "signed_at": server.now_iso(),
    }))
    booking_id = None
    try:
        r = _call("POST", "/bookings", client_user, {
            "dog_id": dog["id"], "service_type": "daycare", "service_id": svc["id"], "date": _today(),
        })
        assert r.status_code == 200, r.text
        booking_id = r.json()["id"]
        # The client-only guards this fix must NOT have loosened are the ones
        # that actually fired here: waiver + their own vaccine/ownership data.
        # A second real client, same shape, with no waiver, still gets refused.
        other_client = {"id": f"{TAG}-c2-{uuid.uuid4().hex[:8]}", "name": f"{TAG} No Waiver", "credits": 0}
        other_dog = {"id": f"{TAG}-d2-{uuid.uuid4().hex[:8]}", "owner_id": other_client["id"], "name": f"{TAG} Dog 2",
                     "breed": "Mutt", "vaccines": {"rabies": "2099-01-01", "bordetella": "2099-01-01", "dhpp": "2099-01-01"},
                     "feeding_schedule": [], "medications": []}
        run(server.db.clients.insert_one(dict(other_client)))
        run(server.db.dogs.insert_one(dict(other_dog)))
        other_user = _mk_user("client", client_id=other_client["id"])
        try:
            r2 = _call("POST", "/bookings", other_user, {
                "dog_id": other_dog["id"], "service_type": "daycare", "service_id": svc["id"], "date": _today(),
            })
            assert r2.status_code == 400 and "waiver" in r2.text.lower(), r2.text
        finally:
            _cleanup(user_ids=[other_user["id"]], client_ids=[other_client["id"]], dog_ids=[other_dog["id"]])
    finally:
        run(server.db.waiver_signatures.delete_many({"client_id": client["id"]}))
        _cleanup(user_ids=[client_user["id"]], client_ids=[client["id"]], dog_ids=[dog["id"]],
                 service_ids=[svc["id"]], booking_ids=[booking_id] if booking_id else [])


def test_the_owner_is_never_gated():
    user = _mk_user("admin")
    client, dog = _mk_dog_and_client()
    svc = _mk_active_daycare_service()
    booking_id = None
    try:
        r = _call("POST", "/bookings", user, {
            "dog_id": dog["id"], "service_type": "daycare", "service_id": svc["id"],
            "date": _today(), "override_capacity": True,
        })
        assert r.status_code == 200, r.text
        booking_id = r.json()["id"]
    finally:
        _cleanup(user_ids=[user["id"]], client_ids=[client["id"]], dog_ids=[dog["id"]],
                 service_ids=[svc["id"]], booking_ids=[booking_id] if booking_id else [])
