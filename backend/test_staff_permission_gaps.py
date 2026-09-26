"""Audit #6 (2026-09-25): staff permission gaps.

(a) DELETE /bookings/{id} only restricted clients. Every other account —
    Read-only staff, staff with booking rights taken away — could cancel any
    booking, and add a cancellation charge to the client's tab. It also took
    the booking's money lock before checking anything.
(b) _perms_for sent every client to the Read-only row, overrides included, so
    ticking Messages (or School / training keys) for Read-only gave it to
    every client: all message threads and staff notes, grading, lesson moves.

Found while fixing it: the owner-only permission matrix could be rewritten
through Settings save and through a config restore (data_export, which
managers hold), and a staff role could be put on a client account.

These go over real HTTP with real tokens (httpx.ASGITransport), so the
Depends() gates are what's under test.
"""
import contextlib
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_STAFF_PERM_GAPS"
REFUSED = (401, 403)


@pytest.fixture(autouse=True)
def _clean_overrides(monkeypatch, tmp_path):
    """Each test starts from the default matrix; restore snapshots stay in tmp."""
    monkeypatch.setattr(server, "_ROLE_OVERRIDES", {})
    monkeypatch.setattr(server, "BACKUP_ROOT", str(tmp_path))


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


@contextlib.contextmanager
def _world():
    made, clients, bookings = [], [], []
    try:
        c1 = {"id": f"{TAG}-c1-{uuid.uuid4().hex[:6]}", "name": f"{TAG} Client A", "credits": 0}
        c2 = {"id": f"{TAG}-c2-{uuid.uuid4().hex[:6]}", "name": f"{TAG} Client B", "credits": 0}
        for c in (c1, c2):
            run(server.db.clients.insert_one(dict(c)))
            clients.append(c["id"])
        who = {
            "owner": _mk_user("admin"),
            "front_desk": _mk_user("employee", "front_desk"),
            "read_only": _mk_user("employee", "read_only"),
            "no_role": _mk_user("employee"),
            "admin_read_only": _mk_user("admin", "read_only"),
            "manager": _mk_user("employee", "manager"),
            "client_a": _mk_user("client", client_id=c1["id"]),
            "client_b": _mk_user("client", client_id=c2["id"]),
            "odd_role": _mk_user("prospect"),
        }
        made = [u["id"] for u in who.values()]

        def booking(client_id, days_ahead=10, **extra):
            b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:8]}", "client_id": client_id, "dog_id": f"{TAG}-dog",
                 "dog_name": "Pep", "client_name": "x", "service_type": "daycare", "status": "approved",
                 "date": (datetime.date.today() + datetime.timedelta(days=days_ahead)).isoformat(), **extra}
            run(server.db.bookings.insert_one(dict(b)))
            bookings.append(b["id"])
            return b

        yield who, c1, c2, booking
    finally:
        run(server.db.users.delete_many({"id": {"$in": made}}))
        run(server.db.clients.delete_many({"id": {"$in": clients}}))
        run(server.db.bookings.delete_many({"id": {"$in": bookings}}))
        for coll in ("invoices", "financial_ledger", "booking_financial_events"):
            run(server.db[coll].delete_many({"booking_id": {"$in": bookings}}))


def _call(method, path, user=None, json_body=None, params=None):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, json=json_body, params=params)
    return run(_go())


def _status_of(booking_id):
    return run(server.db.bookings.find_one({"id": booking_id}, {"_id": 0, "status": 1}))["status"]


# ───────────────────────── (a) cancelling ─────────────────────────

def test_staff_without_booking_edit_cannot_cancel():
    with _world() as (who, c1, _c2, booking):
        for role in ("read_only", "no_role", "admin_read_only", "odd_role"):
            b = booking(c1["id"])
            r = _call("DELETE", f"/bookings/{b['id']}", who[role])
            assert r.status_code in REFUSED, f"{role} cancelled a booking ({r.status_code})"
            r = _call("DELETE", f"/bookings/{b['id']}", who[role], params={"forfeit": "true"})
            assert r.status_code in REFUSED, f"{role} cancelled with a charge ({r.status_code})"
            assert _status_of(b["id"]) == "approved"


def test_staff_with_booking_edit_still_cancel_and_the_owner_always_can():
    with _world() as (who, c1, _c2, booking):
        for role in ("front_desk", "manager", "owner"):
            b = booking(c1["id"])
            r = _call("DELETE", f"/bookings/{b['id']}", who[role])
            assert r.status_code == 200, (role, r.text)
            assert _status_of(b["id"]) == "cancelled"


def test_a_cancellation_charge_also_needs_take_payments(monkeypatch):
    with _world() as (who, c1, _c2, booking):
        b = booking(c1["id"], actual_price=40.0)
        r = _call("DELETE", f"/bookings/{b['id']}", who["front_desk"], params={"forfeit": "true"})
        assert r.status_code == 200, r.text
        assert run(server.db.bookings.find_one({"id": b["id"]}))["cancellation_charged"] is True

        monkeypatch.setattr(server, "_ROLE_OVERRIDES", {"front_desk": {"take_payments": False}})
        b2 = booking(c1["id"], actual_price=40.0)
        r = _call("DELETE", f"/bookings/{b2['id']}", who["front_desk"], params={"forfeit": "true"})
        assert r.status_code == 403 and "Take payments" in r.text
        assert _status_of(b2["id"]) == "approved"
        # A plain cancel still works without take_payments.
        assert _call("DELETE", f"/bookings/{b2['id']}", who["front_desk"]).status_code == 200

        monkeypatch.setattr(server, "_ROLE_OVERRIDES", {"front_desk": {"booking_edit": False}})
        b3 = booking(c1["id"])
        assert _call("DELETE", f"/bookings/{b3['id']}", who["front_desk"]).status_code == 403


def test_clients_keep_their_own_booking_rules():
    with _world() as (who, c1, c2, booking):
        mine = booking(c1["id"])
        assert _call("DELETE", f"/bookings/{mine['id']}", who["client_a"]).status_code == 200
        theirs = booking(c2["id"])
        assert _call("DELETE", f"/bookings/{theirs['id']}", who["client_a"]).status_code == 403
        assert _status_of(theirs["id"]) == "approved"
        mine2 = booking(c1["id"])
        r = _call("DELETE", f"/bookings/{mine2['id']}", who["client_a"], params={"forfeit": "true"})
        assert r.status_code == 403 and "staff" in r.text.lower()
        soon = booking(c1["id"], days_ahead=0)
        assert _call("DELETE", f"/bookings/{soon['id']}", who["client_a"]).status_code == 400


def test_a_refused_cancel_never_takes_the_clients_money_lock(monkeypatch):
    taken = []
    real = server._acquire_booking_financial_correction_guard

    async def spy(booking_id):
        taken.append(booking_id)
        return await real(booking_id)

    monkeypatch.setattr(server, "_acquire_booking_financial_correction_guard", spy)
    with _world() as (who, c1, c2, booking):
        b = booking(c2["id"])
        assert _call("DELETE", f"/bookings/{b['id']}", who["read_only"]).status_code == 403
        assert _call("DELETE", f"/bookings/{b['id']}", who["client_a"]).status_code == 403
        assert taken == [], "a caller with no right to cancel locked another client's checkouts"
        assert _call("DELETE", f"/bookings/{b['id']}", who["client_b"]).status_code == 200
        assert taken == [b["id"]]


# ─────────────────── (b) clients hold no staff permissions ───────────────────

def test_clients_resolve_to_no_permissions_whatever_read_only_holds(monkeypatch):
    monkeypatch.setattr(server, "_ROLE_OVERRIDES", {"read_only": {"messages": True, "manage_school": True}})
    for user in ({"role": "client"}, {"role": "client", "staff_role": "owner"},
                 {"role": "client", "staff_role": "manager"}, {"role": "prospect"}, {}):
        assert not any(server._perms_for(user).values()), user
    ro = server._perms_for({"role": "employee"})
    assert ro["clients_view"] and ro["messages"], "a role-less employee is still Read-only, overrides included"
    assert all(server._perms_for({"role": "admin"}).values())


def test_a_read_only_override_no_longer_opens_staff_routes_to_clients(monkeypatch):
    monkeypatch.setattr(server, "_ROLE_OVERRIDES", {"read_only": {
        "messages": True, "manage_school": True, "manage_training_sessions": True}})
    with _world() as (who, _c1, _c2, _booking):
        client = who["client_a"]
        for method, path in (
            ("GET", "/admin/messages"),
            ("GET", "/admin/messages/unread-count"),
            ("POST", "/admin/messages/start"),
            ("GET", "/admin/school/trainers"),
            ("GET", "/training/legacy-enrollment-count"),
            ("GET", f"/training/enrollments/{TAG}-enr/manual-progress"),
            ("POST", f"/training/enrollments/{TAG}-enr/manual-progress"),
            ("POST", f"/admin/school/students/{TAG}-se/lessons/{TAG}-l/live-checkpoint"),
        ):
            # One body valid for every POST here, so each reaches its permission check.
            body = {"target_lesson_id": "x", "reason": "moving on", "client_id": "x", "subject": "hi", "body": "hi",
                    "handler_scores": {}, "dog_scores": {}, "outcome": "advance"} if method == "POST" else None
            r = _call(method, path, client, json_body=body)
            assert r.status_code == 403, f"client reached {method} {path}: {r.status_code}"
        # The override still does what the owner asked for staff.
        assert _call("GET", "/admin/messages", who["read_only"]).status_code == 200


def test_a_staff_role_cannot_be_put_on_a_client_account():
    with _world() as (who, _c1, _c2, _booking):
        r = _call("PUT", f"/staff/{who['client_a']['id']}/role", who["owner"], json_body={"staff_role": "manager"})
        assert r.status_code == 400
        assert "staff_role" not in run(server.db.users.find_one({"id": who["client_a"]["id"]}))
        r = _call("PUT", f"/staff/{who['no_role']['id']}/role", who["owner"], json_body={"staff_role": "front_desk"})
        assert r.status_code == 200


# ─────────── the permission matrix has one writer: the owner's Roles screen ───────────

def _settings_docs():
    return run(server.db.settings.find({}, {"_id": 0}).to_list(100))


def _put_settings_back(docs):
    run(server.db.settings.delete_many({}))
    if docs:
        run(server.db.settings.insert_many([dict(d) for d in docs]))
    run(server._load_role_overrides_from_settings())


def test_a_settings_save_cannot_rewrite_who_may_do_what():
    before = _settings_docs()
    try:
        with _world() as (who, _c1, _c2, _booking):
            matrix = (run(server.db.settings.find_one({"id": "global"})) or {}).get("staff_role_permissions")
            r = _call("PUT", "/settings", who["owner"],
                      json_body={"staff_role_permissions": {"read_only": {"messages": True, "settings": True}}})
            assert r.status_code == 200, r.text
            after = (run(server.db.settings.find_one({"id": "global"})) or {}).get("staff_role_permissions")
            assert after == matrix
    finally:
        _put_settings_back(before)


def test_a_manager_restoring_a_config_file_keeps_the_live_permission_matrix():
    before = _settings_docs()
    try:
        with _world() as (who, _c1, _c2, _booking):
            run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": {
                "trainer": {"incidents": True}}}}, upsert=True))
            run(server._load_role_overrides_from_settings())
            docs = _settings_docs()
            grab = [dict(d) for d in docs]
            for d in grab:
                if d.get("id") == "global":
                    d["staff_role_permissions"] = {"manager": {"settings": True, "audit_log": True}}
            file = {"kind": "config", "version": server.CONFIG_BACKUP_VERSION, "collections": {"settings": grab}}

            r = _call("POST", "/backup/restore-config", who["manager"], json_body=file)
            assert r.status_code == 200, r.text
            assert r.json()["summary"]["settings"]["staff_permissions"].startswith("kept")
            live = run(server.db.settings.find_one({"id": "global"}))["staff_role_permissions"]
            assert live == {"trainer": {"incidents": True}}
            assert server._perms_for({"role": "employee", "staff_role": "manager"})["settings"] is False

            # The owner's restore does apply the file's matrix, straight away.
            r = _call("POST", "/backup/restore-config", who["owner"], json_body=file)
            assert r.status_code == 200, r.text
            live = run(server.db.settings.find_one({"id": "global"}))["staff_role_permissions"]
            assert live == {"manager": {"settings": True, "audit_log": True}}
            assert server._perms_for({"role": "employee", "staff_role": "manager"})["settings"] is True
    finally:
        _put_settings_back(before)


# ─────────── review round: the same rules, through side doors ───────────

def test_a_dotted_key_in_a_settings_save_cannot_reach_the_matrix(monkeypatch):
    before = _settings_docs()
    try:
        with _world() as (who, _c1, _c2, _booking):
            monkeypatch.setattr(server, "_ROLE_OVERRIDES", {"front_desk": {"settings": True}})
            matrix = (run(server.db.settings.find_one({"id": "global"})) or {}).get("staff_role_permissions")
            r = _call("PUT", "/settings", who["front_desk"], json_body={
                "staff_role_permissions.front_desk": {"payroll": True, "data_export": True},
                "staff_role_permissions.manager.settings": True,
                "$unset": {"branding": ""},
            })
            assert r.status_code == 200, r.text
            after = (run(server.db.settings.find_one({"id": "global"})) or {}).get("staff_role_permissions")
            assert after == matrix
    finally:
        _put_settings_back(before)


def test_a_config_restore_that_fails_partway_leaves_no_planted_matrix():
    before = _settings_docs()
    try:
        with _world() as (who, _c1, _c2, _booking):
            run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": {
                "trainer": {"incidents": True}}}}, upsert=True))
            planted = [dict(d) for d in _settings_docs()]
            for d in planted:
                if d.get("id") == "global":
                    d["staff_role_permissions"] = {"manager": {"settings": True}}
                    d["staff_role_permissions.read_only"] = {"messages": True}
            file = {"kind": "config", "version": server.CONFIG_BACKUP_VERSION, "collections": {
                "settings": planted,
                # A duplicate _id makes the next collection's insert fail.
                "app_settings": [{"_id": f"{TAG}-dup", "x": 1}, {"_id": f"{TAG}-dup", "x": 2}],
            }}
            try:
                r = _call("POST", "/backup/restore-config", who["manager"], json_body=file)
                assert r.status_code >= 500
            except Exception:
                pass  # the in-process transport may re-raise the server error
            live = run(server.db.settings.find_one({"id": "global"}))
            assert live["staff_role_permissions"] == {"trainer": {"incidents": True}}
            assert "staff_role_permissions.read_only" not in live
            assert server._perms_for({"role": "employee", "staff_role": "manager"})["settings"] is False
    finally:
        run(server.db.app_settings.delete_many({"_id": f"{TAG}-dup"}))
        _put_settings_back(before)


def test_a_refused_client_cannot_lock_another_clients_archived_booking(monkeypatch):
    taken = []
    real = server._acquire_booking_financial_correction_guard

    async def spy(booking_id):
        taken.append(booking_id)
        return await real(booking_id)

    monkeypatch.setattr(server, "_acquire_booking_financial_correction_guard", spy)
    with _world() as (who, _c1, c2, booking):
        b = booking(c2["id"])
        doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
        run(server.db.bookings.delete_one({"id": b["id"]}))
        run(server.db.bookings_archive.insert_one(dict(doc)))
        try:
            assert _call("DELETE", f"/bookings/{b['id']}", who["client_a"]).status_code == 403
            assert taken == []
        finally:
            run(server.db.bookings_archive.delete_one({"id": b["id"]}))
