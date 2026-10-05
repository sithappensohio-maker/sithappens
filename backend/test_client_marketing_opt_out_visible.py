"""Staff can see that a family is off marketing email (audit #38). The client record
response dropped the opt-out fields, so the profile could not show it, and staff had
no way to tell why a family got no campaign. Goes over HTTP: the drop happens when the
response is serialized. Disposable tag TEST_MKT_OPTOUT."""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_MKT_OPTOUT"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Owner QA",
         "role": "admin", "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _family(opted_out):
    cid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    doc = {"id": cid, "name": f"{TAG} Pat", "email": f"{uuid.uuid4().hex[:8]}@example.com", "client_status": "active",
           "created_at": server.now_iso(), "tag": TAG}
    if opted_out:
        doc.update({"marketing_email_opt_out": True, "marketing_email_opt_out_at": server.now_iso(),
                    "marketing_email_opt_out_source": "unsubscribe_link"})
    run(server.db.clients.insert_one(doc))
    return cid


def teardown_module():
    run(server.db.clients.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"name": "Owner QA", "password_hash": "x"}))


def test_the_client_record_says_when_a_family_is_off_marketing_email():
    admin = _admin()
    off = _family(opted_out=True)
    on = _family(opted_out=False)

    async def scenario():
        row = (await _http.get(f"/api/clients/{off}", headers=_auth(admin))).json()
        assert row["marketing_email_opt_out"] is True
        assert row["marketing_email_opt_out_source"] == "unsubscribe_link"
        assert row["marketing_email_opt_out_at"]

        plain = (await _http.get(f"/api/clients/{on}", headers=_auth(admin))).json()
        assert plain["marketing_email_opt_out"] is False
    run(scenario())
