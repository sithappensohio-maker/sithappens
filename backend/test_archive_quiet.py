"""An archived family (or a removed dog) gets no automatic email and makes no
staff to-do (audit #36).

Birthday and vaccine emails, practice reminders and weekly recaps kept going
to archived families — and about removed dogs — and queued ones went out
after the archive. Their lapsed vaccines stayed urgent on Today and the
dashboard forever, their old homework sat "stalled", and marketing blasts
included them. Money items (what they owe, their credit) are untouched.

Disposable tag TEST_ARCHIVE_QUIET.
"""
import contextlib
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
import daily_jobs
import email_service
from _test_loop import run

TAG = "TEST_ARCHIVE_QUIET"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA"}
EXPIRED = {"rabies": "2020-01-01", "dhpp": "2020-01-01", "bordetella": "2020-01-01"}


def _today():
    return datetime.now(daily_jobs.BUSINESS_TZ).date()


@contextlib.contextmanager
def _families(**client_extra):
    """A live family and an archived one, each with a dog; plus a removed dog
    in the live family. Every dog's birthday is today and its vaccines lapse
    in two weeks."""
    today = _today()
    soon = (today + timedelta(days=14)).isoformat()
    ids = {"live": f"{TAG}-live-{uuid.uuid4().hex[:6]}", "gone": f"{TAG}-gone-{uuid.uuid4().hex[:6]}"}
    stamp = server.now_iso()
    for k, cid in ids.items():
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {k}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "created_at": server.now_iso(), "_tag": TAG, **client_extra,
                                          **({"deleted_at": stamp} if k == "gone" else {})}))
    dogs = {}
    # "stray": a live dog left on an archived family (possible before audit #36) — its family still decides.
    for k, owner, removed in (("live", ids["live"], False), ("removed", ids["live"], True), ("archived", ids["gone"], True),
                              ("stray", ids["gone"], False)):
        did = f"{TAG}-dog-{k}-{uuid.uuid4().hex[:6]}"
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {k}", "owner_id": owner, "_tag": TAG,
                                       "birthday": f"2020-{today.strftime('%m-%d')}",
                                       "vaccines": {"rabies": soon, "dhpp": soon, "bordetella": soon},
                                       **({"deleted_at": stamp} if removed else {})}))
        dogs[k] = did
    try:
        yield ids, dogs
    finally:
        run(server.db.notification_log.delete_many({"key": {"$regex": TAG}}))
        run(server.db.notification_log.delete_many({"meta.client_id": {"$in": list(ids.values())}}))
        run(server.db.homework.delete_many({"_tag": TAG}))
        run(server.db.email_outbox.delete_many({"key": {"$regex": TAG}}))
        run(server.db.dogs.delete_many({"_tag": TAG}))
        run(server.db.clients.delete_many({"_tag": TAG}))


def _called_for(mock, *, client=None, dog=None):
    out = []
    for c in mock.call_args_list:
        cl = c.args[0] if c.args else {}
        dg = c.args[1] if len(c.args) > 1 and isinstance(c.args[1], dict) else {}
        if client and cl.get("id") == client:
            out.append(c)
        if dog and dg.get("id") == dog:
            out.append(c)
    return out


def test_birthday_and_vaccine_emails_never_reach_an_archived_family_or_a_removed_dog():
    with _families() as (ids, dogs):
        with patch.object(daily_jobs.email_service, "notify_client_dog_birthday", new=AsyncMock(return_value=True)) as bd:
            run(daily_jobs.run_birthday_job(server.db))
        assert _called_for(bd, dog=dogs["live"]), "the live dog still gets its card"
        assert not _called_for(bd, dog=dogs["removed"]) and not _called_for(bd, dog=dogs["archived"])
        assert not _called_for(bd, dog=dogs["stray"]), "an archived family's live dog gets nothing either"
        with patch.object(daily_jobs.email_service, "notify_client_vaccine_expiring", new=AsyncMock(return_value=True)) as vx:
            run(daily_jobs.run_vaccine_expiry_job(server.db))
        assert _called_for(vx, dog=dogs["live"])
        assert not _called_for(vx, dog=dogs["removed"]) and not _called_for(vx, dog=dogs["archived"])


def _tracker(cid, did, **extra):
    hw = {"id": f"{TAG}-hw-{uuid.uuid4().hex[:6]}", "client_id": cid, "dog_id": did, "dog_name": "Pup", "client_name": "Fam",
          "title": f"{TAG} plan", "daily_tracker": True, "status": "active", "total_days": 3, "_tag": TAG,
          "created_at": (datetime.now() - timedelta(days=40)).isoformat(),
          "template_snapshot": {"sections": [{"day_number": 1, "day_focus": "Sit", "steps": ["a"]}]},
          "section_logs": [{"day_number": 1, "submission_status": "submitted", "logged_at": (datetime.now() - timedelta(days=30)).isoformat(),
                            "questions": [{"q": "why?"}]}]}
    hw.update(extra)
    run(server.db.homework.insert_one(dict(hw)))
    return hw


def test_practice_reminders_and_recaps_skip_archived_families_and_removed_dogs():
    dow = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][_today().weekday()]
    with _families(homework_reminder_enabled=True, homework_reminder_days=[dow], homework_reminder_time="00:00") as (ids, dogs):
        for hw_dog, cid in ((dogs["live"], ids["live"]), (dogs["archived"], ids["gone"])):
            _tracker(cid, hw_dog, section_logs=[])
        _tracker(ids["live"], dogs["removed"], title=f"{TAG} removed-dog plan", section_logs=[])
        _tracker(ids["gone"], None, title=f"{TAG} no-dog plan", section_logs=[])   # a row with no dog: the family decides
        with patch.object(daily_jobs.email_service, "notify_client_homework_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_homework_practice_reminder_job(server.db))
        live = _called_for(m, client=ids["live"])
        assert live and not _called_for(m, client=ids["gone"])
        assert all(p["hw_title"] != f"{TAG} removed-dog plan" for p in live[0].args[1]), "never nudged about a removed dog"


def test_a_queued_automatic_email_is_dropped_once_the_family_is_archived():
    with _families() as (ids, dogs):
        for who in ("live", "gone"):
            run(server.db.email_outbox.insert_one({
                "key": f"{TAG}-{who}", "status": "pending", "to_email": "x@example.com", "subject": "Happy birthday",
                "html": "<p>hi</p>", "attempts": 0, "next_attempt_at": "2000-01-01T00:00:00", "created_at": "2000-01-01T00:00:00",
                "on_success": {"type": "notification_log", "key": f"{TAG}-{who}",
                               "meta": {"job": "birthday", "client_id": ids[who], "dog_id": dogs["live" if who == "live" else "archived"]}}}))
        low = {"type": "client_low_credit", "client_id": ids["gone"]}
        assert run(email_service._outbox_row_still_wanted(low)) is False
        assert run(email_service._outbox_row_still_wanted({**low, "client_id": ids["live"]})) is True
        sent = []

        async def fake_send(to, subject, html, **kw):
            sent.append(kw.get("outbox_key"))
            return True
        with patch.object(email_service, "_send", new=fake_send),                 patch.object(email_service, "_is_in_quiet_hours", new=AsyncMock(return_value=False)):
            run(email_service.process_email_outbox(server.db, limit=500))
        assert f"{TAG}-live" in sent and f"{TAG}-gone" not in sent
        assert not run(server.db.email_outbox.find_one({"key": f"{TAG}-gone"})), "dropped, not retried forever"


def test_marketing_emails_leave_out_archived_families():
    with _families() as (ids, dogs):
        rows = run(server._bulk_email_resolve_recipients([]))
        got = {r["id"] for r in rows}
        assert ids["live"] in got and ids["gone"] not in got
        live = next(r for r in rows if r["id"] == ids["live"])
        assert f"{TAG} removed" not in (live.get("dog_names") or ""), "a removed dog's name never lands in an email"
        picked = run(server.bulk_email_recipients(server.BulkEmailFiltersIn(client_ids=[ids["live"], ids["gone"]]), ADMIN))
        assert [r["id"] for r in picked["recipients"]] == [ids["live"]]


def test_today_and_the_dashboard_never_flag_an_archived_family_or_a_removed_dog():
    with _families() as (ids, dogs):
        for did in dogs.values():
            run(server.db.dogs.update_one({"id": did}, {"$set": {"vaccines": dict(EXPIRED)}}))
        items = run(server.admin_today_brain(ADMIN))["items"]
        vax_ids = " ".join(i["id"] for i in items if i["kind"].startswith("vaccine_"))
        assert dogs["live"] in vax_ids
        assert dogs["removed"] not in vax_ids and dogs["archived"] not in vax_ids
        alerts = run(server.vaccine_alerts(ADMIN))
        flagged = {a.get("dog_id") for a in (alerts if isinstance(alerts, list) else alerts.get("alerts", []))}
        assert dogs["live"] in flagged and not flagged & {dogs["removed"], dogs["archived"]}
        before = run(server.dashboard_stats(ADMIN))
        run(server.db.dogs.update_one({"id": dogs["live"]}, {"$set": {"deleted_at": server.now_iso()}}))
        after = run(server.dashboard_stats(ADMIN))
        assert after["health_flags"] == before["health_flags"] - 1 and after["total_dogs"] == before["total_dogs"] - 1


def test_training_queues_skip_an_archived_familys_homework():
    with _families() as (ids, dogs):
        live = _tracker(ids["live"], dogs["live"])
        gone = _tracker(ids["gone"], dogs["archived"])
        stalled = {r["homework_id"] for r in run(server.list_stalled_homework(14, ADMIN))}
        assert live["id"] in stalled and gone["id"] not in stalled
        pending = {r["homework_id"] for r in run(server.list_pending_reviews(ADMIN))}
        assert live["id"] in pending and gone["id"] not in pending
