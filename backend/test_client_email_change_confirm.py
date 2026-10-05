"""A client's new email is used only after the confirmation link sent to that address is
opened (audit #27: "A client's login email can't really be changed"). Until then the login
and the contact email keep the old address. Disposable tag TEST_EMAIL_CONFIRM."""
import re
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import email_service
from _test_loop import run

TAG = "TEST_EMAIL_CONFIRM"


@pytest.fixture()
def client_user(monkeypatch):
    sent = []

    async def capture(**kw):
        sent.append(kw)
        return True
    monkeypatch.setattr(email_service, "_queue_email", capture)
    cid, uid = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-u-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": "old@example.com", "tag": TAG}))
    run(server.db.users.insert_one({"id": uid, "role": "client", "client_id": cid, "name": TAG,
                                    "email": "old@example.com", "token_version": 0, "tag": TAG}))
    yield {"user": {"id": uid, "role": "client", "client_id": cid}, "cid": cid, "uid": uid, "sent": sent}
    run(server.db.clients.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"tag": TAG}))
    run(server.db.email_changes.delete_many({"client_id": cid}))


def test_a_new_email_is_not_used_until_the_link_is_confirmed(client_user):
    run(server.update_portal_me(server.PortalProfileIn(name=TAG, email="new@example.com"), client_user["user"]))
    assert run(server.db.users.find_one({"id": client_user["uid"]}))["email"] == "old@example.com"
    assert run(server.db.clients.find_one({"id": client_user["cid"]}))["email"] == "old@example.com"
    assert client_user["sent"][0]["to_email"] == "new@example.com", "the link goes to the new address"

    token = re.search(r"token=([A-Za-z0-9_\-]+)", client_user["sent"][0]["html"]).group(1)
    run(server.portal_confirm_email_change(server.EmailChangeConfirmIn(token=token)))
    assert run(server.db.users.find_one({"id": client_user["uid"]}))["email"] == "new@example.com"
    assert run(server.db.clients.find_one({"id": client_user["cid"]}))["email"] == "new@example.com"


def test_a_wrong_link_changes_nothing(client_user):
    run(server.update_portal_me(server.PortalProfileIn(name=TAG, email="new@example.com"), client_user["user"]))
    with pytest.raises(Exception):
        run(server.portal_confirm_email_change(server.EmailChangeConfirmIn(token="not-the-token-at-all")))
    assert run(server.db.users.find_one({"id": client_user["uid"]}))["email"] == "old@example.com"
