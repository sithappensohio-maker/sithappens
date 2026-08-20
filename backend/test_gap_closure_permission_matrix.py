"""Whole-app gap closure — API-level permission and privacy matrix.

Section L.5 of CLAUDE_WHOLE_APP_GAP_CLOSURE_HANDOFF.md. Exercises the
candidate's new surfaces as Owner, restricted staff (trainer / front desk /
read-only) and Client, asserting BOTH directions: the role that should reach
an endpoint does, and the role that should not is refused.

These go over REAL HTTP through httpx.ASGITransport with real signed tokens,
not by calling the endpoint functions directly. That distinction matters
here: the Depends() gate IS the thing under test, and calling a function body
directly skips it entirely — a suite written that way would report every
endpoint as wide open.

No real financial transaction is performed and no Stripe call is made.
"""
import contextlib
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_GAP_PERM"


# ---------------------------------------------------------------------------
# Real identities with real tokens
# ---------------------------------------------------------------------------

def _mk_user(role, staff_role=None, client_id=None):
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
        "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
        "password_hash": "x", "active": True, "token_version": 0,
    }
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    token = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG,
    )
    doc["_token"] = token
    return doc


@contextlib.contextmanager
def _identities():
    """Owner, three restricted staff roles, and two separate clients."""
    made = []
    try:
        c1 = run(server.create_client(server.ClientIn(
            name=f"{TAG} Client A", email=f"{uuid.uuid4().hex[:8]}@example.invalid"), {"role": "admin", "id": "seed"}))
        c2 = run(server.create_client(server.ClientIn(
            name=f"{TAG} Client B", email=f"{uuid.uuid4().hex[:8]}@example.invalid"), {"role": "admin", "id": "seed"}))
        who = {
            "owner": _mk_user("admin"),
            "trainer": _mk_user("employee", "trainer"),
            "front_desk": _mk_user("employee", "front_desk"),
            "read_only": _mk_user("employee", "read_only"),
            "client_a": _mk_user("client", client_id=c1["id"]),
            "client_b": _mk_user("client", client_id=c2["id"]),
        }
        made = [u["id"] for u in who.values()]
        yield who, c1, c2
    finally:
        run(server.db.users.delete_many({"id": {"$in": made}}))
        for c in (locals().get("c1"), locals().get("c2")):
            if c:
                run(server.db.intake_submissions.delete_many({"client_id": c["id"]}))
                run(server.db.clients.delete_one({"id": c["id"]}))


def _call(method, path, user=None, json_body=None):
    """One real request. Returns the httpx Response."""
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, json=json_body)
    return run(_go())


def _status(*a, **kw):
    return _call(*a, **kw).status_code


REFUSED = (401, 403, 404)


# ---------------------------------------------------------------------------
# MFA — admin-only
# ---------------------------------------------------------------------------

def test_mfa_endpoints_are_admin_only():
    with _identities() as (who, _c1, _c2):
        for path, method in (("/auth/mfa/status", "GET"), ("/auth/mfa/setup", "POST")):
            assert _status(method, path, who["owner"]) < 400, f"owner blocked from {path}"
            for role in ("client_a", "trainer", "front_desk", "read_only"):
                assert _status(method, path, who[role]) in REFUSED, f"{role} reached {path}"


def test_mfa_endpoints_reject_an_unauthenticated_caller():
    assert _status("GET", "/auth/mfa/status") in REFUSED
    assert _status("POST", "/auth/mfa/setup") in REFUSED


def test_mfa_status_never_returns_secret_material():
    with _identities() as (who, _c1, _c2):
        owner = who["owner"]
        run(server.db.users.update_one({"id": owner["id"]}, {"$set": {
            "mfa_enabled": True,
            "mfa_secret_encrypted": server._mfa_fernets()[0].encrypt(b"JBSWY3DPEHPK3PXP").decode(),
        }}))
        body = _call("GET", "/auth/mfa/status", owner).text
        assert "JBSWY3DPEHPK3PXP" not in body
        assert "mfa_secret" not in body


def test_one_admin_cannot_read_another_admins_mfa_state():
    with _identities() as (who, _c1, _c2):
        other = _mk_user("admin")
        try:
            run(server.db.users.update_one({"id": other["id"]}, {"$set": {"mfa_enabled": True}}))
            body = _call("GET", "/auth/mfa/status", who["owner"]).json()
            assert body.get("enabled") is not True, "read another account's MFA state"
        finally:
            run(server.db.users.delete_one({"id": other["id"]}))


# ---------------------------------------------------------------------------
# Agreements — admin authoring vs client signing
# ---------------------------------------------------------------------------

def test_agreement_templates_are_authored_behind_a_staff_permission():
    with _identities() as (who, _c1, _c2):
        assert _status("GET", "/admin/agreement-templates", who["owner"]) < 400
        for role in ("client_a", "trainer", "read_only"):
            assert _status("GET", "/admin/agreement-templates", who[role]) in REFUSED, role


def test_a_client_cannot_author_an_agreement_template():
    with _identities() as (who, _c1, _c2):
        payload = {"name": f"{TAG} injected", "body_html": "<p>x</p>", "applies_to": "all"}
        assert _status("POST", "/admin/agreement-templates", who["client_a"], payload) in REFUSED
        assert run(server.db.agreement_templates.count_documents({"name": f"{TAG} injected"})) == 0


def test_the_client_agreement_portal_is_scoped_to_the_caller():
    with _identities() as (who, c1, c2):
        r = _call("GET", "/portal/agreements", who["client_a"])
        assert r.status_code < 400
        assert c2["id"] not in r.text, "another client's id leaked into the portal payload"


def test_staff_cannot_use_the_client_agreement_portal():
    with _identities() as (who, _c1, _c2):
        # Staff hold no client_id, so the client portal must not resolve one.
        assert _status("GET", "/portal/agreements", who["trainer"]) in REFUSED


# ---------------------------------------------------------------------------
# Intake — cross-client file isolation
# ---------------------------------------------------------------------------

def test_intake_submission_admin_list_requires_a_staff_permission():
    with _identities() as (who, _c1, _c2):
        assert _status("GET", "/intake/submissions", who["owner"]) < 400
        for role in ("client_a", "read_only"):
            assert _status("GET", "/intake/submissions", who[role]) in REFUSED, role


def test_a_client_cannot_read_another_clients_intake_submission():
    with _identities() as (who, c1, c2):
        sub_id = str(uuid.uuid4())
        run(server.db.intake_submissions.insert_one({
            "id": sub_id, "client_id": c2["id"], "template_id": "t1", "status": "submitted",
            "answers": {"secret": "client B private answer"}, "created_at": server.now_iso(),
        }))
        try:
            direct = _call("GET", f"/intake/submissions/{sub_id}", who["client_a"])
            assert direct.status_code in REFUSED, "client A read client B's submission"
            assigned = _call("GET", "/portal/intake/assigned", who["client_a"])
            assert "client B private answer" not in assigned.text
            assert sub_id not in assigned.text
        finally:
            run(server.db.intake_submissions.delete_one({"id": sub_id}))


def test_a_client_cannot_upload_into_another_clients_submission():
    with _identities() as (who, c1, c2):
        sub_id = str(uuid.uuid4())
        run(server.db.intake_submissions.insert_one({
            "id": sub_id, "client_id": c2["id"], "template_id": "t1", "status": "sent",
            "answers": {}, "created_at": server.now_iso(),
        }))
        try:
            # A VALID body on purpose: a malformed one is rejected by Pydantic
            # at 422 before _portal_intake_context runs, which would leave the
            # ownership check itself untested.
            r = _call("POST", f"/portal/intake/submissions/{sub_id}/files/field-1", who["client_a"],
                      {"name": "x.pdf", "content_type": "application/pdf", "data": "QUFBQQ=="})
            assert r.status_code != 422, "payload rejected before the ownership check ran"
            assert r.status_code in REFUSED, f"cross-client upload returned {r.status_code}"
            assert "Not yours" in r.text or r.status_code == 404
            fresh = run(server.db.intake_submissions.find_one({"id": sub_id}, {"_id": 0}))
            assert not fresh.get("files"), "a foreign upload landed on the submission"
        finally:
            run(server.db.intake_submissions.delete_one({"id": sub_id}))


def test_an_unauthenticated_caller_cannot_touch_intake_at_all():
    assert _status("GET", "/intake/submissions") in REFUSED
    assert _status("GET", "/portal/intake/assigned") in REFUSED


# ---------------------------------------------------------------------------
# Finance-gated surfaces — disputes, refunds, reconciliation
# ---------------------------------------------------------------------------

def test_finance_surfaces_refuse_clients_and_restricted_staff():
    with _identities() as (who, _c1, _c2):
        for path in ("/admin/stripe/disputes", "/admin/stripe/payouts", "/admin/stripe/balance-transactions"):
            owner_status = _status("GET", path, who["owner"])
            if owner_status == 404:
                continue                      # route not present on this candidate
            assert owner_status < 400, f"owner blocked from {path}"
            for role in ("client_a", "trainer", "read_only"):
                assert _status("GET", path, who[role]) in REFUSED, f"{role} reached {path}"


def test_a_client_cannot_issue_a_refund():
    with _identities() as (who, _c1, _c2):
        r = _call("POST", "/admin/register/refund", who["client_a"], {"payment_id": "x", "amount": 1})
        assert r.status_code in REFUSED
        # and nothing financial was written
        assert run(server.db.payments.count_documents({"client_id": _c1["id"]})) == 0


def test_permission_keys_resolve_as_documented_per_role():
    # The matrix behind every gate above, asserted directly so a role change
    # is caught here rather than as a mysterious 403 somewhere else.
    owner = server._perms_for({"role": "admin", "id": "o"})
    assert all(owner.values()), "a true owner holds every permission"
    for role in ("trainer", "front_desk", "read_only"):
        perms = server._perms_for({"role": "employee", "staff_role": role, "id": role})
        assert not perms.get("settings"), f"{role} holds settings"
        assert not perms.get("delete_records"), f"{role} holds delete_records"
        assert not perms.get("finance_reports"), f"{role} holds finance_reports"


def test_an_admin_tagged_with_a_restricted_staff_role_loses_the_owner_bypass():
    tagged = server._perms_for({"role": "admin", "staff_role": "read_only", "id": "x"})
    assert not all(tagged.values()), "a tagged admin kept unrestricted access"


# ---------------------------------------------------------------------------
# Care-permission surfaces
# ---------------------------------------------------------------------------

def test_medication_logging_is_staff_only():
    with _identities() as (who, _c1, _c2):
        r = _call("POST", "/bookings/does-not-exist/med-feed-log", who["client_a"], {})
        assert r.status_code in REFUSED, "a client reached the medication log"


# ---------------------------------------------------------------------------
# Marketing preference must not become an authorisation channel
# ---------------------------------------------------------------------------

def test_marketing_suppression_changes_no_permission_and_no_transactional_data():
    with _identities() as (who, c1, _c2):
        before = server._perms_for(who["owner"])
        snapshot = run(server.db.clients.find_one({"id": c1["id"]}, {"_id": 0}))
        run(server.db.clients.update_one({"id": c1["id"]}, {"$set": {
            "marketing_opt_out": True, "marketing_suppressed_at": server.now_iso()}}))
        after = run(server.db.clients.find_one({"id": c1["id"]}, {"_id": 0}))
        assert server._perms_for(who["owner"]) == before
        for field in ("id", "name", "email", "phone", "created_at"):
            assert after.get(field) == snapshot.get(field), f"{field} changed with a marketing preference"
        # The client can still use their own portal.
        assert _call("GET", "/portal/agreements", who["client_a"]).status_code < 400
