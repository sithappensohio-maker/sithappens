"""Front desk staff can finish setting up a new client (audit #49).

Staff whose role lets them add or edit clients could save a family but the
next steps were owner-only: the portal invite, attaching vaccine certificate
photos, the client's Files and moving a prospect to Active. They can now —
and a certificate photo they attach waits in the owner's approval queue like
a client upload (the approved certificate stays on file and the dog's date
doesn't move until approval). A typed portal password stays the owner's.

Disposable tag TEST_STAFF_FOLLOWUPS.
"""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_STAFF_FOLLOWUPS"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
APPROVED = {"photo": PNG, "photos": [PNG], "uploaded_at": "2026-01-05T10:00:00+00:00", "uploaded_by": "Pat",
            "expires_on": "2030-01-01", "status": "approved", "reviewed_at": "2026-01-06T09:00:00+00:00", "reviewed_by": "Owner"}


@pytest.fixture(autouse=True)
def _clean_overrides(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_ROLE_OVERRIDES", {})
    monkeypatch.setattr(server, "BACKUP_ROOT", str(tmp_path))


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def capture(**kw):
        out.append(kw)
    monkeypatch.setattr(server, "send_account_claim", capture)
    return out


def _mk_user(role, staff_role=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}", "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode({"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
                                "exp": now + datetime.timedelta(hours=2), "type": "access"}, server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _call(method, path, user, json_body=None):
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.request(method, f"/api{path}", headers={"Authorization": f"Bearer {user['_token']}"}, json=json_body)
    return run(_go())


def _family(status="prospect", rabies="2030-01-01", certs=None):
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": status, "created_at": server.now_iso()}))
    did = f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": did, "name": "Rex", "owner_id": cid, "breed": "Mix",
                                   "vaccines": {"rabies": rabies, "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
                                   "vaccine_certs": certs or {}}))
    return cid, did


def _dog(did):
    return run(server.db.dogs.find_one({"id": did}, {"_id": 0}))


def teardown_module(_m):
    for coll in ("users", "clients", "dogs", "client_files"):
        run(server.db[coll].delete_many({"$or": [{"id": {"$regex": f"^{TAG}"}}, {"email": {"$regex": f"^{TAG.lower()}"}},
                                                  {"client_id": {"$regex": f"^{TAG}"}}]}))
    run(server.db.claim_tokens.delete_many({"client_id": {"$regex": f"^{TAG}"}}))


def test_front_desk_sends_the_portal_invite(sent):
    desk = _mk_user("employee", "front_desk")
    cid, _ = _family()
    r = _call("POST", f"/clients/{cid}/send-claim-email", desk)
    assert r.status_code == 200, r.text
    assert run(server.db.claim_tokens.find_one({"client_id": cid, "used": False})) and len(sent) == 1


def test_front_desk_uses_the_clients_files_but_cannot_delete_them():
    desk = _mk_user("employee", "front_desk")
    cid, _ = _family()
    r = _call("POST", f"/clients/{cid}/files", desk, {"name": "waiver.png", "content_type": "image/png", "data": PNG})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    assert r.json()["uploaded_by"] == desk["name"]
    listed = _call("GET", f"/clients/{cid}/files", desk)
    assert listed.status_code == 200 and [f["id"] for f in listed.json()] == [fid]
    assert _call("GET", f"/files/{fid}/download", desk).status_code == 200
    assert _call("DELETE", f"/files/{fid}", desk).status_code == 403


def test_front_desk_moves_a_prospect_to_active_but_no_other_status():
    desk = _mk_user("employee", "front_desk")
    cid, _ = _family("prospect")
    r = _call("POST", f"/clients/{cid}/status", desk, {"status": "active"})
    assert r.status_code == 200 and r.json()["client_status"] == "active", r.text
    walk_in, _ = _family("walk_in")
    assert _call("POST", f"/clients/{walk_in}/status", desk, {"status": "active"}).status_code == 200
    other, _ = _family("prospect")
    assert _call("POST", f"/clients/{other}/status", desk, {"status": "rejected"}).status_code == 403
    rejected, _ = _family("rejected")
    assert _call("POST", f"/clients/{rejected}/status", desk, {"status": "active"}).status_code == 403


def test_a_staff_certificate_photo_waits_for_the_owner_and_keeps_the_approved_one():
    desk = _mk_user("employee", "front_desk")
    owner = _mk_user("admin")
    _, did = _family(certs={"rabies": APPROVED})
    r = _call("POST", f"/dogs/{did}/vaccine-cert", desk, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG})
    assert r.status_code == 200 and r.json()["status"] == "pending_review", r.text
    d = _dog(did)
    cert = d["vaccine_certs"]["rabies"]
    assert d["vaccines"]["rabies"] == "2030-01-01", "the dog's date waits for approval"
    assert cert["status"] == "pending_review" and cert["pending_expires_on"] == "2031-03-03" and cert["approved_before"] == APPROVED
    assert cert["uploaded_by"] == desk["name"] and cert["uploaded_by_staff"] is True
    assert "uploaded_by_admin" not in cert and "reviewed_at" not in cert
    rows = [x for x in _call("GET", "/admin/vaccine-cert-uploads", owner).json() if x["dog_id"] == did]
    assert len(rows) == 1 and rows[0]["uploaded_by_staff"] is True


def test_the_owner_decides_on_a_staff_photo_like_any_upload():
    desk = _mk_user("employee", "front_desk")
    owner = _mk_user("admin")
    _, did = _family(rabies="")
    _call("POST", f"/dogs/{did}/vaccine-cert", desk, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG})
    assert _dog(did)["vaccines"]["rabies"] == "", "nothing counts before approval"
    assert _call("POST", f"/admin/dogs/{did}/vaccine-cert/rabies/review", owner).status_code == 200
    assert _dog(did)["vaccines"]["rabies"] == "2031-03-03"
    _, did2 = _family(certs={"rabies": APPROVED})
    _call("POST", f"/dogs/{did2}/vaccine-cert", desk, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG})
    assert _call("DELETE", f"/admin/dogs/{did2}/vaccine-cert/rabies", owner).status_code == 200
    assert _dog(did2)["vaccine_certs"]["rabies"] == APPROVED


def test_staff_need_a_photo_and_a_manager_waits_for_the_owner_too():
    desk = _mk_user("employee", "front_desk")
    _, did = _family()
    r = _call("POST", f"/dogs/{did}/vaccine-cert", desk, {"vaccine": "rabies", "expires_on": "2031-03-03"})
    assert r.status_code == 400 and "photo" in r.json()["detail"]
    manager = _mk_user("employee", "manager")
    r = _call("POST", f"/dogs/{did}/vaccine-cert", manager, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG})
    assert r.status_code == 200 and r.json()["status"] == "pending_review"


def test_the_owner_still_attaches_an_approved_certificate():
    owner = _mk_user("admin")
    _, did = _family(rabies="")
    r = _call("POST", f"/dogs/{did}/vaccine-cert", owner, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG})
    assert r.status_code == 200, r.text
    d = _dog(did)
    assert d["vaccines"]["rabies"] == "2031-03-03" and d["vaccine_certs"]["rabies"]["status"] == "approved"


@pytest.mark.parametrize("role,staff_role", [("employee", "trainer"), ("employee", "read_only"), ("admin", "read_only")])
def test_staff_who_cannot_edit_clients_still_cannot(role, staff_role, sent):
    user = _mk_user(role, staff_role)
    cid, did = _family()
    assert _call("POST", f"/clients/{cid}/send-claim-email", user).status_code == 403
    assert _call("GET", f"/clients/{cid}/files", user).status_code == 403
    assert _call("POST", f"/clients/{cid}/status", user, {"status": "active"}).status_code == 403
    assert _call("POST", f"/dogs/{did}/vaccine-cert", user, {"vaccine": "rabies", "expires_on": "2031-03-03", "photo": PNG}).status_code == 403
    assert not sent


def test_a_typed_portal_password_stays_the_owners():
    desk = _mk_user("employee", "front_desk")
    cid, _ = _family()
    r = _call("POST", f"/clients/{cid}/portal-account", desk, {"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "Sup3r-secret-pw!"})
    assert r.status_code == 403
