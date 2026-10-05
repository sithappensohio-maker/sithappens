"""An announcement's email broadcast is a durable outbox, one row per family (audit #88).

Nothing goes out inside the request. The email worker sends each row, and the
announcement_broadcasts row counts what really happened: sent, cancelled (unpublished
before it went) and failed to queue. A broadcast run again, or resumed after a restart,
skips the families it already reached. Disposable tag TEST_ANN_OUTBOX."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import email_service
import server
from _test_loop import run

TAG = "TEST_ANN_OUTBOX"
db = server.db
SENT = []
OURS = []
_REAL_SEND = email_service._send
_REAL_QUIET = email_service._is_in_quiet_hours
_REAL_DB = email_service._db


async def _fake_send(to_email, subject, html, **kw):
    SENT.append(to_email)
    return True


async def _never_quiet():
    return False


class _Only:
    """Just this test's families, not every client the test database holds."""
    def find(self, _query, projection=None):
        return db.clients.find({"id": {"$in": OURS}}, projection)


class _Db:
    def __getattr__(self, name):
        return _Only() if name == "clients" else getattr(db, name)


def _family():
    cid = f"{TAG}-{uuid.uuid4().hex[:8]}"
    OURS.append(cid)
    run(db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                               "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    return cid


def _announcement():
    ann = {"id": str(uuid.uuid4()), "title": f"{TAG} Closed Friday", "body": "See you Monday",
           "published": True, "expires_on": "", "tag": TAG, "created_at": server.now_iso()}
    run(db.announcements.insert_one(dict(ann)))
    return ann


def _drain():
    for _ in range(20):
        out = run(email_service.process_email_outbox(db))
        if not out.get("checked"):
            return
    raise AssertionError("the outbox did not empty")


def _rows(ann):
    return run(db.email_outbox.find({"key": {"$regex": f"^announcement:{ann['id']}:"}}, {"_id": 0}).to_list(50))


def _broadcast(ann):
    return run(email_service.broadcast_announcement_email(ann))


def _state(ann):
    return run(db.announcement_broadcasts.find_one({"id": ann["id"]}, {"_id": 0}))


@pytest.fixture(autouse=True)
def _wired(monkeypatch):
    SENT.clear()
    email_service._send = _fake_send
    email_service._is_in_quiet_hours = _never_quiet
    email_service._db = _Db()
    yield
    email_service._send = _REAL_SEND
    email_service._is_in_quiet_hours = _REAL_QUIET
    email_service._db = _REAL_DB
    run(db.clients.delete_many({"tag": TAG}))
    run(db.announcements.delete_many({"tag": TAG}))
    run(db.email_outbox.delete_many({"subject": {"$regex": TAG}}))
    run(db.announcement_broadcasts.delete_many({"title": {"$regex": TAG}}))
    OURS.clear()


def test_a_broadcast_queues_one_row_per_family_and_sends_nothing_in_the_request():
    for _ in range(3):
        _family()
    ann = _announcement()
    res = _broadcast(ann)
    assert SENT == [], "nothing is sent inside the request"
    assert res["queued"] == 3
    assert len(_rows(ann)) == 3
    state = _state(ann)
    assert state["status"] == "queued" and state["queued_count"] == 3 and state["sent_count"] == 0


def test_delivery_is_counted_and_a_repeat_run_mails_nobody_again():
    for _ in range(2):
        _family()
    ann = _announcement()
    _broadcast(ann)
    _drain()
    assert len(SENT) == 2
    state = _state(ann)
    assert state["sent_count"] == 2 and state["queued_count"] == 0

    again = _broadcast(ann)
    assert again["queued"] == 0 and again["skipped"] == 2
    assert _rows(ann) == [], "nothing new is queued"
    _drain()
    assert len(SENT) == 2


def test_an_announcement_unpublished_before_it_went_is_cancelled_not_sent():
    for _ in range(2):
        _family()
    ann = _announcement()
    _broadcast(ann)
    run(db.announcements.update_one({"id": ann["id"]}, {"$set": {"published": False}}))
    _drain()
    assert SENT == []
    state = _state(ann)
    assert state["sent_count"] == 0 and state["cancelled_count"] == 2 and state["queued_count"] == 0


def test_a_fan_out_a_restart_cut_short_is_resumed_and_finishes():
    for _ in range(2):
        _family()
    ann = _announcement()
    run(db.announcement_broadcasts.insert_one({
        "id": ann["id"], "announcement_id": ann["id"], "title": f"{TAG} stalled", "status": "queueing",
        "queued_count": 0, "sent_count": 0, "cancelled_count": 0, "failed_count": 0,
        "started_at": "2020-01-01T00:00:00+00:00", "updated_at": "2020-01-01T00:00:00+00:00"}))
    out = run(email_service.resume_stalled_broadcasts())
    assert out["resumed"] >= 1
    assert len(_rows(ann)) == 2
    assert _state(ann)["status"] == "queued"
