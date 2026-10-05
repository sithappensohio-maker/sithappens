"""A staff reply to a family's message goes to the family's current email, not the address
the conversation started with (audit #86). Disposable tag TEST_THREAD_EMAIL."""
import asyncio
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_THREAD_EMAIL"
STAFF = {"id": f"{TAG}-staff", "role": "admin", "name": "Owner QA", "email": "owner-thread@test"}


def _family_with_thread(old_email):
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": old_email,
                                      "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    tid = f"{TAG}-t-{uuid.uuid4().hex[:6]}"
    run(server.db.client_message_threads.insert_one({
        "id": tid, "client_id": cid, "client_name": f"{TAG} Pat", "client_email": old_email, "category": "general",
        "subject": "Hello", "status": "open", "messages": [], "internal_notes": [], "tag": TAG,
        "created_at": server.now_iso(), "updated_at": server.now_iso(), "last_message_at": server.now_iso(),
        "last_message_preview": "", "last_message_role": "client", "unread_admin": True, "unread_client": False}))
    return cid, tid


def teardown_module():
    run(server.db.clients.delete_many({"tag": TAG}))
    run(server.db.client_message_threads.delete_many({"tag": TAG}))


def test_a_reply_goes_to_the_families_current_address(monkeypatch):
    sent = []

    async def fake_notify(thread, to_email, body, **kw):
        sent.append(to_email)
    monkeypatch.setattr(server, "_send_message_notification_email", fake_notify)

    cid, tid = _family_with_thread(f"{TAG}-old@example.com")
    run(server.db.clients.update_one({"id": cid}, {"$set": {"email": f"{TAG}-new@example.com"}}))
    run(server.admin_reply_thread(tid, server.AdminReplyIn(body="Your pickup is ready.", email_notify=True), STAFF))
    run(asyncio.sleep(0.1))
    assert sent == [f"{TAG}-new@example.com"]
