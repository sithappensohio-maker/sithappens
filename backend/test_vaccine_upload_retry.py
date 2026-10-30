"""A vaccine upload is safe to send twice.

Clients reported "it said it worked, then it said it didn't, but it did": a
phone that loses the reply to an upload the server saved shows a failure,
and the client (or the app's own retry) sends it again. Each upload now
carries an id; the same id is stored once, answered with what is stored,
and never emails staff a second time. A new id is a new upload, as before.

Disposable tag TEST_BOOKING_BLOCKS (shared helpers).
"""
import asyncio

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from domains.operations import routes as ops
from test_booking_block_messages import _client_user, _household


def _dog(dog):
    return run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0}))


def _upload(client, dog, expires_on, upload_id=None, photo="data:image/png;base64,TkVX"):
    body = server.VaccineUpdateIn(vaccine="rabies", expires_on=expires_on, photos=[photo], upload_id=upload_id)
    return run(server.portal_update_vaccine(dog["id"], body, _client_user(client)))


def _count_admin_emails(monkeypatch):
    sent = []

    async def fake(client, dog, vaccine, expires_on):
        sent.append((dog.get("id"), vaccine, expires_on))
    monkeypatch.setattr(server.email_service, "notify_admin_vaccine_upload_pending", fake)
    return sent


def test_the_same_upload_sent_twice_is_stored_once_and_emails_staff_once(monkeypatch):
    sent = _count_admin_emails(monkeypatch)
    with _household() as (client, dogs):
        first = _upload(client, dogs[0], "2031-01-01", upload_id="up-123")
        stored = _dog(dogs[0])["vaccine_certs"]["rabies"]
        again = _upload(client, dogs[0], "2031-01-01", upload_id="up-123")   # the reply to `first` was lost
        run(asyncio.sleep(0.05))   # let the fire-and-forget emails run

        assert first["status"] == "pending_review" and "already_received" not in first
        assert again["ok"] is True and again["status"] == "pending_review" and again["already_received"] is True
        assert _dog(dogs[0])["vaccine_certs"]["rabies"] == stored          # not rewritten
        assert stored["upload_id"] == "up-123"
        assert len(sent) == 1


def test_a_new_upload_id_is_a_new_upload_that_replaces_the_waiting_one(monkeypatch):
    sent = _count_admin_emails(monkeypatch)
    with _household() as (client, dogs):
        _upload(client, dogs[0], "2031-01-01", upload_id="up-1")
        _upload(client, dogs[0], "2031-02-02", upload_id="up-2", photo="data:image/png;base64,QUdBSU4=")
        run(asyncio.sleep(0.05))
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert cert["pending_expires_on"] == "2031-02-02" and cert["upload_id"] == "up-2"
        assert len(sent) == 2


def test_a_late_retry_after_staff_approved_it_does_not_reopen_the_review(monkeypatch):
    sent = _count_admin_emails(monkeypatch)
    with _household() as (client, dogs):
        _upload(client, dogs[0], "2031-01-01", upload_id="up-late")
        run(ops.approve_vaccine_cert(server.db, dogs[0]["id"], "rabies", "Owner", server.now_iso))
        again = _upload(client, dogs[0], "2031-01-01", upload_id="up-late")
        run(asyncio.sleep(0.05))
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert again["already_received"] is True and again["status"] == "approved"
        assert cert["status"] == "approved" and not cert.get("pending_expires_on")
        assert len(sent) == 1


def test_an_upload_without_an_id_behaves_as_before(monkeypatch):
    _count_admin_emails(monkeypatch)
    with _household() as (client, dogs):
        _upload(client, dogs[0], "2031-01-01")
        _upload(client, dogs[0], "2031-03-03")
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert cert["pending_expires_on"] == "2031-03-03" and "upload_id" not in cert
