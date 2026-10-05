"""A bulk email goes out in the background, and a repeat of the same message skips the
families it already reached (audit #40). Before this, the send looped over every family
inside the request, and sending the same message twice mailed everyone twice. Disposable
tag TEST_BULK_BG."""
import asyncio
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import email_service
import server
from _test_loop import run

TAG = "TEST_BULK_BG"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner-bg@test"}
db = server.db
SENT = []
CAMPAIGNS = []
_REAL_SEND = email_service._send
_REAL_QUIET = email_service._is_in_quiet_hours


async def _fake_send(to_email, subject, html, **kw):
    # Other suites leave their own rows in the outbox; only this test's families are recorded.
    if TAG in to_email:
        SENT.append(to_email)
    return True


async def _never_quiet():
    return False


def _family():
    cid = f"{TAG}-{uuid.uuid4().hex[:8]}"
    run(db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                               "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    return cid


def _emails(ids):
    return sorted(c["email"] for c in run(db.clients.find({"id": {"$in": ids}}, {"_id": 0, "email": 1}).to_list(50)))


def _send(ids, text):
    body = server.BulkEmailSendIn(subject=f"{TAG} newsletter", body=f"{text} {TAG}", client_ids=ids)
    out = run(server.bulk_email_send(body, ADMIN))
    run(asyncio.gather(*list(server._BULK_ENQUEUE_TASKS)))
    CAMPAIGNS.append(out["campaign"])
    return out


def _deliver():
    return run(email_service.process_email_outbox(db))


def setup_function():
    SENT.clear()
    email_service._send = _fake_send
    email_service._is_in_quiet_hours = _never_quiet


def teardown_function():
    email_service._send = _REAL_SEND
    email_service._is_in_quiet_hours = _REAL_QUIET
    run(db.clients.delete_many({"tag": TAG}))
    run(db.email_outbox.delete_many({"subject": {"$regex": TAG}}))
    run(db.bulk_email_history.delete_many({"subject": {"$regex": TAG}}))
    run(db.bulk_email_deliveries.delete_many({"campaign": {"$in": CAMPAIGNS}}))
    CAMPAIGNS.clear()


def test_a_bulk_send_queues_each_family_instead_of_sending_in_the_request():
    ids = [_family(), _family(), _family()]
    out = _send(ids, "Spring hours")
    assert SENT == [], "nothing is sent inside the request"
    assert out["status"] in ("queueing", "queued")
    assert out["queued_count"] == 3 and out["skipped_already_sent"] == 0
    rows = run(db.email_outbox.find({"key": {"$regex": f"^bulk:{out['campaign']}:"}}, {"_id": 0}).to_list(10))
    assert len(rows) == 3
    hist = run(db.bulk_email_history.find_one({"id": out["id"]}, {"_id": 0}))
    assert hist["status"] == "queued" and hist["queued_count"] == 3 and hist["success_count"] == 0


def test_the_worker_delivers_them_and_a_repeat_skips_the_families_already_reached():
    ids = [_family(), _family(), _family()]
    first = _send(ids, "Summer hours")
    _deliver()
    assert sorted(SENT) == _emails(ids)
    done = run(db.bulk_email_history.find_one({"id": first["id"]}, {"_id": 0}))
    assert done["success_count"] == 3 and done["queued_count"] == 0
    assert run(db.bulk_email_deliveries.count_documents({"campaign": first["campaign"]})) == 3

    SENT.clear()
    again = _send(ids, "Summer hours")
    _deliver()
    assert again["skipped_already_sent"] == 3 and again["queued_count"] == 0
    assert SENT == [], "families the message already reached are not emailed again"


def test_a_new_family_on_a_repeat_gets_only_the_new_one():
    ids = [_family(), _family()]
    _send(ids, "Autumn hours")
    _deliver()
    SENT.clear()
    newcomer = _family()
    again = _send(ids + [newcomer], "Autumn hours")
    _deliver()
    assert again["skipped_already_sent"] == 2 and again["queued_count"] == 1
    assert SENT == _emails([newcomer])
