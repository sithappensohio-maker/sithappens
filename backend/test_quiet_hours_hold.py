"""Quiet Hours hold emails instead of dropping them (audit: "Quiet Hours drop
emails instead of holding them").

Every email that came due inside the owner's Quiet Hours without a durable
outbox key was thrown away: booking approvals, report cards, statements, bulk
email, homework reviews. Now (owner chose A, 2026-10-01) it waits in the outbox
and the email worker sends it once the window ends — once, and only while what
it says is still true. Sign-up / reset links and the owner's own test emails
still go out at once.

Disposable tag TEST_QH_HOLD.
"""
import contextlib
import sys
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import resend
import server
import email_service
from _test_loop import run

TAG = "TEST_QH_HOLD"
tag = TAG.lower()
ADMIN = {"id": "qh-admin", "name": "QH QA", "email": "qh@test", "role": "admin"}
NY = ZoneInfo("America/New_York")


@contextlib.contextmanager
def _mail(*, quiet=False, quiet_seq=None, boom=False, during=None):
    """A fake provider. `quiet_seq` answers _is_in_quiet_hours call by call."""
    sent = []
    saved = (email_service.RESEND_API_KEY, resend.Emails.send, email_service._is_in_quiet_hours)
    calls = iter(quiet_seq or [])

    def _fake_send(params, options=None):
        if during:
            during()
        if boom:
            raise RuntimeError("The sender domain is not verified")
        sent.append({"to": (params.get("to") or [""])[0], "subject": params.get("subject"),
                     "html": params.get("html"), "key": (options or {}).get("idempotency_key")})
        return {"id": "fake-" + uuid.uuid4().hex[:6]}

    async def _quiet():
        return next(calls, quiet) if quiet_seq is not None else quiet

    email_service.RESEND_API_KEY = "test-key"
    resend.Emails.send = _fake_send
    email_service._is_in_quiet_hours = _quiet
    try:
        yield sent
    finally:
        email_service.RESEND_API_KEY, resend.Emails.send, email_service._is_in_quiet_hours = saved


def _drain():
    """Quiet Hours are over: the email worker runs (twice — the second finds nothing)."""
    with _mail(quiet=False) as sent:
        run(email_service.process_email_outbox(server.db, limit=500))
        run(email_service.process_email_outbox(server.db, limit=500))
    return [m for m in sent if tag in (m["to"] or "")]


def _rows(to):
    return run(server.db.email_outbox.find({"to_email": to}, {"_id": 1, "key": 1, "status": 1, "attempts": 1,
                                                                "subject": 1, "guard": 1}).to_list(None))


def _addr():
    return f"{tag}-{uuid.uuid4().hex[:8]}@example.com"


def _client(**over):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} Dana Doe", "email": _addr(), "created_at": server.now_iso(),
           "client_status": "active", "credits": 0}
    doc.update(over)
    run(server.db.clients.insert_one(dict(doc)))
    return doc


def _booking(client, **over):
    doc = {"id": str(uuid.uuid4()), "client_id": client["id"], "client_name": client["name"], "dog_name": f"{TAG} Rex",
           "service_type": "daycare", "date": "2026-10-05", "status": "approved", "tag": TAG, "created_at": server.now_iso()}
    doc.update(over)
    run(server.db.bookings.insert_one(dict(doc)))
    return doc


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    rx = {"$regex": tag}
    ids = [c["id"] for c in run(server.db.clients.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1}).to_list(None))]
    run(server.db.email_outbox.delete_many({"to_email": rx}))
    run(server.db.email_outbox.delete_many({"key": {"$regex": TAG}}))
    run(server.db.notification_log.delete_many({"key": {"$regex": TAG}}))
    run(server.db.system_runs.delete_many({"id": {"$regex": TAG}}))
    run(server.db.bookings.delete_many({"tag": TAG}))
    run(server.db.homework.delete_many({"tag": TAG}))
    run(server.db.announcements.delete_many({"tag": TAG}))
    run(server.db.client_communications.delete_many({"client_id": {"$in": ids}}))
    run(server.db.bulk_email_history.delete_many({"sender_id": ADMIN["id"]}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    run(server.db.users.delete_many({"id": {"$regex": f"^{tag}-"}}))


# ─────────────────────────────── held, then sent once ───────────────────────────────

def test_an_email_due_in_quiet_hours_waits_and_goes_out_once_when_they_end():
    c = _client()
    b = _booking(c)
    with _mail(quiet=True) as sent:
        run(email_service.notify_client_booking_approved(b, c))
        key = email_service.last_send_held_key
        run(email_service.notify_client_booking_approved(b, c))   # the same email again that night
    assert sent == [], "nothing goes out during quiet hours"
    rows = _rows(c["email"])
    assert len(rows) == 1, "it used to be thrown away; it waits once, not twice"
    assert key and key.startswith("qh:") and rows[0]["_id"] == key and rows[0]["key"] == key
    assert rows[0]["status"] == "pending" and rows[0]["guard"] == {"kind": "booking_approved", "booking_id": b["id"]}

    got = _drain()
    assert len(got) == 1 and got[0]["to"] == c["email"]
    assert got[0]["key"] == key, "the provider gets the row's own key, so a crash-retry can't send twice"
    assert _rows(c["email"]) == []


def test_the_same_email_again_after_quiet_hours_hurries_the_waiting_copy_instead_of_sending_two():
    c = _client()
    b = _booking(c)
    with _mail(quiet=True):
        run(email_service.notify_client_booking_approved(b, c))
    with _mail(quiet=False) as sent:
        run(email_service.notify_client_booking_approved(b, c))   # morning, before the worker ran
        assert sent == [] and email_service.last_send_held_key
    assert len(_drain()) == 1


def test_outside_quiet_hours_an_email_goes_straight_out_with_no_provider_key():
    c = _client()
    b = _booking(c)
    with _mail(quiet=False) as sent:
        run(email_service.notify_client_booking_approved(b, c))
    assert len(sent) == 1 and sent[0]["key"] is None, "a deliberate re-send is never swallowed by a reused key"
    assert _rows(c["email"]) == []


def test_the_same_words_on_another_night_are_another_email(monkeypatch):
    c = _client()
    b = _booking(c)
    nights = iter(["2026-10-01", "2026-10-02"])

    async def window():
        return next(nights)
    monkeypatch.setattr(email_service, "_quiet_window_id", window)
    with _mail(quiet=True):
        run(email_service.notify_client_booking_approved(b, c))
        run(email_service.notify_client_booking_approved(b, c))
    assert len(_rows(c["email"])) == 2
    assert len(_drain()) == 2


def test_the_worker_stops_without_using_an_attempt_when_quiet_hours_start_mid_run():
    to = _addr()
    for i in range(2):
        run(server.db.email_outbox.insert_one({
            "key": f"{TAG}-mid-{i}", "status": "pending", "to_email": to, "subject": "s", "html": "<p>h</p>",
            "attempts": 0, "next_attempt_at": "2000-01-01T00:00:00", "created_at": "2000-01-01T00:00:00"}))
    with _mail(quiet=True, quiet_seq=[False]) as sent:   # the worker's own check says day; the first send finds night
        run(email_service.process_email_outbox(server.db, limit=500))
    assert [m for m in sent if m["to"] == to] == []
    assert sorted(r["attempts"] for r in _rows(to)) == [0, 0], "waiting isn't a failed attempt"


# ─────────────────────────────── the window ───────────────────────────────

def _at(monkeypatch, when, comms):
    monkeypatch.setattr(email_service, "_ohio_now", lambda: when)

    async def _comms():
        return comms
    monkeypatch.setattr(email_service, "_quiet_comms", _comms)


NIGHT = {"quiet_hours_enabled": True, "quiet_hours_start": "21:00", "quiet_hours_end": "08:00"}


@pytest.mark.parametrize("when,window", [
    (datetime(2026, 10, 1, 23, 30, tzinfo=NY), "2026-10-01"),
    (datetime(2026, 10, 2, 2, 0, tzinfo=NY), "2026-10-01"),
    (datetime(2026, 10, 2, 10, 0, tzinfo=NY), "2026-10-01"),
    (datetime(2026, 10, 2, 21, 0, tzinfo=NY), "2026-10-02"),
])
def test_an_email_held_at_night_and_its_twin_next_morning_share_one_window(monkeypatch, when, window):
    _at(monkeypatch, when, NIGHT)
    assert run(email_service._quiet_window_id()) == window


@pytest.mark.parametrize("comms,hm,quiet", [
    (NIGHT, (23, 30), True),
    (NIGHT, (7, 59), True),
    (NIGHT, (8, 0), False),
    ({**NIGHT, "quiet_hours_end": "9:00"}, (8, 30), True),       # typed without the leading zero
    ({**NIGHT, "quiet_hours_end": "9:00"}, (9, 0), False),
    ({**NIGHT, "quiet_hours_start": "13:00", "quiet_hours_end": "15:00"}, (14, 0), True),
    ({**NIGHT, "quiet_hours_start": "13:00", "quiet_hours_end": "15:00"}, (15, 30), False),
    ({**NIGHT, "quiet_hours_end": "21:00"}, (23, 0), False),     # start == end is off, or nothing would ever leave
    ({**NIGHT, "quiet_hours_enabled": False}, (23, 0), False),
    ({**NIGHT, "quiet_hours_end": "soon"}, (23, 0), False),
])
def test_quiet_hours_window(monkeypatch, comms, hm, quiet):
    _at(monkeypatch, datetime(2026, 10, 1, *hm, tzinfo=NY), comms)
    assert run(email_service._is_in_quiet_hours()) is quiet


def test_quiet_hours_are_read_from_the_settings_document_without_server_py(monkeypatch):
    """The email worker used to import server.py to read them; any error there
    meant "not quiet" and, under the hold, would release everything at night."""
    class _Settings:
        async def find_one(self, *_a, **_k):
            return {"id": "global", "day_to_day": {"comms": NIGHT}}

    class _Db:
        settings = _Settings()
    monkeypatch.setattr(email_service, "_db", _Db())
    monkeypatch.setattr(email_service, "_ohio_now", lambda: datetime(2026, 10, 1, 23, 0, tzinfo=NY))
    monkeypatch.setitem(sys.modules, "server", None)   # importing server.py would now fail
    assert run(email_service._is_in_quiet_hours()) is True


# ─────────────────────────────── stale by morning ───────────────────────────────

@pytest.mark.parametrize("then", ["cancelled", "rejected", "deleted"])
def test_an_approval_held_overnight_is_dropped_if_the_booking_is_cancelled_first(then):
    c = _client()
    b = _booking(c)
    with _mail(quiet=True):
        run(email_service.notify_client_booking_approved(b, c))
    assert len(_rows(c["email"])) == 1, "held, not thrown away"
    if then == "deleted":
        run(server.db.bookings.delete_one({"id": b["id"]}))
    else:
        run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"status": then}}))
    assert _drain() == []
    assert _rows(c["email"]) == [], "dropped, not retried"


def test_reject_then_approve_overnight_sends_only_the_approval():
    c = _client()
    b = _booking(c, status="rejected")
    with _mail(quiet=True):
        run(email_service.notify_client_booking_rejected(b, c))
        run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "approved"}}))
        run(email_service.notify_client_booking_approved({**b, "status": "approved"}, c))
    got = _drain()
    assert len(got) == 1 and "declined" not in (got[0]["subject"] + got[0]["html"]).lower()


def _homework(c, **over):
    doc = {"id": str(uuid.uuid4()), "client_id": c["id"], "dog_name": f"{TAG} Rex", "title": f"{TAG} Sit plan",
           "tag": TAG, "total_days": 5,
           "section_logs": [{"day_number": 1, "submission_status": "needs_redo", "reviewed_at": "2026-10-01T23:00:00"}]}
    doc.update(over)
    run(server.db.homework.insert_one(dict(doc)))
    return doc


def test_a_redo_then_an_approval_overnight_sends_only_the_approval():
    c = _client()
    hw = _homework(c)
    with _mail(quiet=True):
        run(email_service.notify_client_day_reviewed(hw, 1, "needs_redo", "again please", c))
        log = {"day_number": 1, "submission_status": "approved", "reviewed_at": "2026-10-01T23:30:00"}
        run(server.db.homework.update_one({"id": hw["id"]}, {"$set": {"section_logs": [log]}}))
        run(email_service.notify_client_day_reviewed({**hw, "section_logs": [log]}, 1, "approved", "", c))
    got = _drain()
    assert [m["subject"].endswith("approved") for m in got] == [True]


def test_homework_and_certificate_notes_are_dropped_if_removed_before_morning():
    c = _client()
    hw = _homework(c, certificate_uploaded_at="2026-10-01T22:00:00")
    gone = _homework(c)
    with _mail(quiet=True):
        run(email_service.notify_client_homework_assigned(gone, c))
        run(email_service.notify_client_certificate_issued(hw, c))
    assert len(_rows(c["email"])) == 2, "held, not thrown away"
    run(server.db.homework.delete_one({"id": gone["id"]}))
    run(server.db.homework.update_one({"id": hw["id"]}, {"$unset": {"certificate_uploaded_at": ""}}))
    assert _drain() == []


def test_a_record_found_without_any_checked_field_still_counts_as_there():
    """Mongo returns {} for a document that has none of the projected fields."""
    c = _client()
    hw = {"id": str(uuid.uuid4()), "client_id": c["id"], "dog_name": f"{TAG} Rex", "title": f"{TAG} Plain", "tag": TAG}
    run(server.db.homework.insert_one(dict(hw)))
    ann = {"id": str(uuid.uuid4()), "title": f"{TAG} Plain", "tag": TAG}
    run(server.db.announcements.insert_one(dict(ann)))
    with _mail(quiet=True):
        run(email_service.notify_client_homework_assigned(hw, c))
        run(email_service._send(c["email"], "Plain", "<p>x</p>",
                                hold_guard={"kind": "announcement", "announcement_id": ann["id"], "client_id": c["id"]}))
    assert len(_drain()) == 2


@pytest.mark.parametrize("then", [None, "unpublished", "expired", "opted_out", "archived"])
def test_a_held_announcement_goes_only_while_it_is_up_and_they_still_want_it(then):
    c = _client()
    ann = {"id": str(uuid.uuid4()), "title": f"{TAG} Closed Friday", "published": True, "expires_on": "", "tag": TAG}
    run(server.db.announcements.insert_one(dict(ann)))
    guard = {"kind": "announcement", "announcement_id": ann["id"], "client_id": c["id"]}
    with _mail(quiet=True):
        run(email_service._send(c["email"], "Closed Friday", "<p>x</p>", hold_guard=guard))
    assert len(_rows(c["email"])) == 1, "held, not thrown away"
    if then == "unpublished":
        run(server.db.announcements.update_one({"id": ann["id"]}, {"$set": {"published": False}}))
    elif then == "expired":
        run(server.db.announcements.update_one({"id": ann["id"]}, {"$set": {"expires_on": "2020-01-01"}}))
    elif then == "opted_out":
        run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"marketing_email_opt_out": True}}))
    elif then == "archived":
        run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"deleted_at": server.now_iso()}}))
    assert len(_drain()) == (1 if then is None else 0)


def test_the_announcement_broadcast_counts_held_families_as_queued(monkeypatch):
    c = _client()
    ann = {"id": str(uuid.uuid4()), "title": f"{TAG} Closed Friday", "body": "See you Monday", "published": True,
           "expires_on": "", "tag": TAG}
    run(server.db.announcements.insert_one(dict(ann)))
    class _Only:   # just this family, not every client in the database
        def find(self, _query, projection=None):
            return server.db.clients.find({"id": c["id"]}, projection)

    class _Db:
        def __getattr__(self, name):
            return _Only() if name == "clients" else getattr(server.db, name)
    monkeypatch.setattr(email_service, "_db", _Db())
    with _mail(quiet=True):
        res = run(email_service.broadcast_announcement_email(ann))
    assert res["queued"] == 1 and res["sent"] == 0
    assert _rows(c["email"])[0]["guard"] == {"kind": "announcement", "announcement_id": ann["id"], "client_id": c["id"]}


@pytest.mark.parametrize("path", [[2, 5], [2, 1]])
def test_a_low_credit_warning_waits_only_for_the_balance_the_family_is_still_at(path):
    c = _client()
    with _mail(quiet=True):
        for bal in path:
            run(server._maybe_send_low_credit_email(c["id"], "daycare", bal))
    got = _drain()
    if path[-1] > 2:
        assert got == [], "topped up overnight: no warning"
    else:
        assert len(got) == 1 and f"{path[-1]} days" in got[0]["html"], "only the latest balance"


def test_a_low_credit_warning_held_overnight_is_dropped_after_a_pack_top_up():
    c = _client(credits=2)
    with _mail(quiet=True):
        run(server._maybe_send_low_credit_email(c["id"], "daycare", 2))
    run(server.db.clients.update_one({"id": c["id"]}, {"$inc": {"credits": 10}}))   # how a pack sale tops up
    assert _drain() == [], "they were told '2 days left' with 12"


def test_the_low_credit_stamp_is_written_before_the_email_can_wait(monkeypatch):
    c = _client(credits=2)
    seen = {}

    async def fake(client, service_type, remaining):
        row = await server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "low_credit_emailed_at": 1})
        seen.setdefault("stamped", []).append(
            ((row.get("low_credit_emailed_at") or {}).get(service_type) or {}).get("balance") == remaining)
        return False
    monkeypatch.setattr(server, "notify_client_low_credits", fake)
    run(server._maybe_send_low_credit_email(c["id"], "daycare", 2))
    assert seen == {"stamped": [True]}


def test_a_waiting_copy_of_an_email_that_already_went_is_dropped():
    to = _addr()
    run(server.db.notification_log.insert_one({"key": f"{TAG}-done", "sent_at": server.now_iso()}))
    run(server.db.system_runs.insert_one({"id": f"{TAG}-run", "sent": 1}))
    for key, action in ((f"{TAG}-done", {"type": "notification_log", "key": f"{TAG}-done"}),
                        (f"{TAG}-run", {"type": "system_run", "id": f"{TAG}-run"}),
                        (f"{TAG}-new", {"type": "notification_log", "key": f"{TAG}-new"})):
        run(server.db.email_outbox.insert_one({
            "key": key, "status": "pending", "to_email": to, "subject": key, "html": "<p>h</p>", "attempts": 0,
            "next_attempt_at": "2000-01-01T00:00:00", "created_at": "2000-01-01T00:00:00", "on_success": action}))
    got = _drain()
    assert [m["subject"] for m in got] == [f"{TAG}-new"]


# ─────────────────────────────── the screens that send ───────────────────────────────

def test_a_report_card_waits_then_stamps_the_visit_when_it_really_goes():
    c = _client()
    b = _booking(c, status="checked_out", report_card={"note": "Great day", "mood_tags": ["happy"], "photos": []})
    with _mail(quiet=True):
        res = run(server._maybe_send_report_card_email(b))
    assert res["queued"] is True and res["sent"] is False
    row = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert row.get("report_card_email_queued_at") and not row.get("report_card_email_error"), \
        "it used to say 'Resend rejected the send — verify your domain'"
    got = _drain()
    assert len(got) == 1
    row = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert row.get("report_card_email_sent_at") and not row.get("report_card_email_queued_at")


def test_the_booking_screen_is_told_the_report_card_is_waiting():
    """The booking response only carries declared fields."""
    c = _client()
    b = _booking(c, status="completed", dog_id=str(uuid.uuid4()),
                 report_card={"note": "Great day", "mood_tags": [], "photos": []})
    with _mail(quiet=True):
        run(server._maybe_send_report_card_email(b))
    uid = f"{tag}-{uuid.uuid4().hex[:6]}"
    run(server.db.users.insert_one({"id": uid, "email": f"{uid}@example.com", "name": f"{TAG} Owner", "role": "admin",
                                    "password_hash": "x", "token_version": 0}))
    token = server.create_access_token(uid, f"{uid}@example.com", "admin", 0)
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
    res = run(http.get(f"/api/bookings/{b['id']}", headers={"Authorization": f"Bearer {token}"}))
    assert res.status_code == 200 and res.json().get("report_card_email_queued_at")


def test_a_held_report_card_that_then_fails_says_failed_not_waiting():
    c = _client()
    b = _booking(c, status="completed", report_card={"note": "Great day", "mood_tags": [], "photos": []})
    with _mail(quiet=True):
        run(server._maybe_send_report_card_email(b))
    with _mail(quiet=False, boom=True):
        run(email_service.process_email_outbox(server.db, limit=500))
    row = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert "not verified" in (row.get("report_card_email_error") or ""), "it showed 'Waiting for quiet hours' forever"
    assert not row.get("report_card_email_sent_at")


def test_the_report_card_attempt_is_on_the_visit_before_a_held_copy_exists(monkeypatch):
    c = _client()
    b = _booking(c, status="completed", report_card={"note": "Great day", "mood_tags": [], "photos": []})
    seen = {}

    async def fake(booking, client, dog=None, *, attempt_at=None):
        row = await server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0, "report_card_email_attempted_at": 1})
        seen["stamped"] = row.get("report_card_email_attempted_at") == attempt_at
        return True
    monkeypatch.setattr(email_service, "notify_client_report_card", fake)
    run(server._maybe_send_report_card_email(b))
    assert seen == {"stamped": True}


def test_a_report_card_re_sent_overnight_goes_once():
    c = _client()
    b = _booking(c, status="checked_out", report_card={"note": "Great day", "mood_tags": [], "photos": []})
    with _mail(quiet=True):
        run(server._maybe_send_report_card_email(b))
        res = run(server.resend_report_card_email(b["id"], ADMIN))
    assert res["queued"] is True
    assert len(_drain()) == 1, "the first attempt is replaced, not sent beside the re-send"


def test_a_statement_asked_for_in_quiet_hours_is_queued_not_a_500():
    c = _client(account_balance=12.5)
    with _mail(quiet=True) as sent:
        res = run(server._send_account_statement(c["id"]))
    assert res["ok"] is True and res["queued"] is True and sent == []
    assert len(_drain()) == 1


def test_bulk_email_in_quiet_hours_reports_queued_logs_it_and_drops_it_if_they_unsubscribe():
    keep, leave = _client(), _client()
    body = server.BulkEmailSendIn(subject=f"{TAG} News", body="Hello {{client_first_name}}",
                                  client_ids=[keep["id"], leave["id"]])
    with _mail(quiet=True) as sent:
        res = run(server.bulk_email_send(body, ADMIN))
    assert sent == [] and res["queued_count"] == 2 and res["success_count"] == 0 and res["fail_count"] == 0, \
        "every held recipient used to be recorded as a failure"
    timeline = {"client_id": {"$in": [keep["id"], leave["id"]]}}
    assert run(server.db.client_communications.count_documents(timeline)) == 0, "not on the timeline before it goes"
    run(server.db.clients.update_one({"id": leave["id"]}, {"$set": {"marketing_email_opt_out": True}}))
    assert [m["to"] for m in _drain()] == [keep["email"]]
    rows = run(server.db.client_communications.find(timeline, {"_id": 0}).to_list(None))
    assert [(r["client_id"], r["type"], r["summary"]) for r in rows] == [(keep["id"], "email", f"[Bulk] {TAG} News")]
    hist = run(server.db.bulk_email_history.find_one({"id": res["id"]}, {"_id": 0}))
    assert (hist["success_count"], hist["queued_count"]) == (1, 0), "the history shows what really went"


def test_bulk_email_outside_quiet_hours_still_logs_and_counts_at_once():
    c = _client()
    body = server.BulkEmailSendIn(subject=f"{TAG} Day", body="Hi", client_ids=[c["id"]])
    with _mail(quiet=False) as sent:
        res = run(server.bulk_email_send(body, ADMIN))
    assert len(sent) == 1 and (res["success_count"], res["queued_count"]) == (1, 0)
    rows = run(server.db.client_communications.find({"client_id": c["id"]}, {"_id": 0}).to_list(None))
    assert [r["summary"] for r in rows] == [f"[Bulk] {TAG} Day"]
    hist = run(server.db.bulk_email_history.find_one({"id": res["id"]}, {"_id": 0}))
    assert (hist["success_count"], hist["queued_count"]) == (1, 0)


@pytest.mark.parametrize("boom", [True, False])
def test_another_request_held_mid_send_never_makes_this_send_look_queued(boom):
    c = _client()

    def other_request():   # another _send in the same process holds an email meanwhile
        email_service.last_send_held_key = "qh:someone-else"
    with _mail(quiet=False, boom=boom, during=other_request):
        ok = run(email_service._send(c["email"], "Statement", "<p>x</p>"))
    assert ok is (not boom) and email_service.last_send_held_key is None


def test_email_health_does_not_call_a_held_email_a_failed_send(monkeypatch):
    import dns.resolver

    class _Rdata:
        def __init__(self, txt):
            self.strings = [txt.encode()]

    class _Resolver:
        def __init__(self, *a, **k):
            pass

        def resolve(self, name, _kind):
            return [_Rdata("p=abc" if name.startswith("resend._domainkey") else "v=spf1 include:_spf.resend.com ~all")]
    monkeypatch.setattr(dns.resolver, "Resolver", _Resolver)
    monkeypatch.setattr(email_service, "SENDER_EMAIL", "hello@example.com")
    c = _client()
    b = _booking(c)
    with _mail(quiet=True):
        run(email_service.notify_client_booking_approved(b, c))
    with _mail(quiet=False):
        assert run(server.email_health(ADMIN))["status"] == "ok", "the morning after, it said 'Last send failed'"


# ─────────────────────────────── still immediate ───────────────────────────────

def test_people_waiting_on_a_link_and_the_owners_own_tests_are_never_held():
    to = _addr()
    with _mail(quiet=True) as sent:
        run(email_service.send_meet_greet_request_received(to, f"{TAG} Pat", "Rex", "https://x/claim/t"))
        assert run(server.email_health_test(server.EmailHealthTestReq(to=to), ADMIN))["ok"] is True
        assert run(server.test_email_template("client_booking_approved", server.EmailTestRequest(to_email=to), ADMIN))["ok"] is True
        draft = server.EmailTemplatePreviewRequest(subject="Draft", intro_html="<p>hi</p>", to_email=to, mode="send")
        assert run(server.preview_custom_email_draft(draft, ADMIN))["ok"] is True
    assert len([m for m in sent if m["to"] == to]) == 4
    assert _rows(to) == []
