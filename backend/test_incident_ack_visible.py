"""The Incidents list shows whether the owner has read a serious incident, and the
Action Center item opens that list (audit #35). Before this, the list response
dropped the acknowledgement fields, so the screen could never show a serious
incident as read, and the item's Open button went back to the Today page it was
already on. Goes over HTTP, because the drop happens when the response is
serialized. Disposable tag TEST_INC_ACK, far-future business date."""
import uuid
from datetime import date

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_INC_ACK"
DAY = date(2031, 6, 9)
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Owner QA",
         "role": "admin", "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _bite():
    inc = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "dog_id": f"{TAG}-dog", "dog_name": "Biter", "client_id": f"{TAG}-c",
           "client_name": "Pat", "type": "bite", "severity": "severe", "date": DAY.isoformat(), "time": "10:00",
           "description": "Bit a visitor", "reported_by": "Staff", "created_at": server.now_iso(), "tag": TAG,
           "witnesses": "", "action_taken": "", "internal_notes": "", "edit_history": []}
    run(server.db.incidents.insert_one(dict(inc)))
    return inc


def teardown_module():
    run(server.db.incidents.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"name": "Owner QA", "password_hash": "x"}))


def test_the_list_shows_whether_the_owner_has_read_a_serious_incident():
    admin = _admin()
    bite = _bite()

    async def scenario():
        before = (await _http.get("/api/incidents", headers=_auth(admin))).json()
        row = next(r for r in before if r["id"] == bite["id"])
        assert "owner_acknowledged_at" in row and row["owner_acknowledged_at"] is None

        ack = await _http.post(f"/api/admin/incidents/{bite['id']}/acknowledge", headers=_auth(admin))
        assert ack.status_code == 200

        after = (await _http.get("/api/incidents", headers=_auth(admin))).json()
        row = next(r for r in after if r["id"] == bite["id"])
        assert row["owner_acknowledged_at"]
        assert row["owner_acknowledged_by"] == "Owner QA"
    run(scenario())


def test_the_action_center_item_opens_the_incidents_list():
    bite = _bite()
    out = run(server.admin_today_brain(_admin()))
    item = next(i for i in out["items"] if i.get("kind") == "serious_incident" and "Biter" in (i.get("subtitle") or ""))
    assert item["cta"] == {"type": "open_screen", "screen": "incidents"}
    run(server.db.incidents.update_one({"id": bite["id"]}, {"$set": {"owner_acknowledged_at": server.now_iso()}}))
