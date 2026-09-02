"""scheduler.py + the jobs it drives.

Before this, every automated job fired only from GET /dashboard/stats (admin
role only) and day-gated jobs were skipped outright when nobody opened Admin
that day; recurring schedules were extended only by a manual button. These
tests pin: the Mongo lease (one worker runs), fault isolation between jobs,
the catch-up plan, birthday catch-up, and recurring auto-extend.
"""
import asyncio
import contextlib
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
import scheduler
import daily_jobs
from _test_loop import run

TAG = "TEST_SCHED"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


# ───────────────────────── lease ─────────────────────────


def test_lease_is_exclusive_renewable_and_expires():
    db = server.db
    run(db.system_runs.delete_one({"_id": scheduler.LEASE_ID}))
    assert run(scheduler.acquire_lease(db, "worker-a")) is True
    assert run(scheduler.acquire_lease(db, "worker-b")) is False, "second worker must idle while the lease is live"
    assert run(scheduler.acquire_lease(db, "worker-a")) is True, "holder renews"
    # Holder crashes: lease expires → b takes over.
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    run(db.system_runs.update_one({"_id": scheduler.LEASE_ID}, {"$set": {"expires_at": past}}))
    assert run(scheduler.acquire_lease(db, "worker-b")) is True
    assert run(scheduler.acquire_lease(db, "worker-a")) is False
    # Graceful release hands over immediately.
    run(scheduler.release_lease(db, "worker-b"))
    assert run(scheduler.acquire_lease(db, "worker-a")) is True
    run(db.system_runs.delete_one({"_id": scheduler.LEASE_ID}))


def test_tick_runs_jobs_only_for_holder_and_isolates_failures():
    db = server.db
    run(db.system_runs.delete_many({"_id": {"$in": [scheduler.LEASE_ID, scheduler.TICK_ID]}}))
    calls = []

    async def ok_job():
        calls.append("ok")
        return {"did": "thing"}

    async def boom():
        raise RuntimeError("kaboom")

    async def after():
        calls.append("after")
        return 7

    jobs = [("ok", ok_job), ("boom", boom), ("after", after)]
    assert run(scheduler.tick(db, jobs, "holder-1")) is not None
    assert run(scheduler.tick(db, jobs, "holder-2")) is None, "non-holder must not run jobs"
    assert calls == ["ok", "after"], "a failing job must not stop later jobs"
    doc = run(db.system_runs.find_one({"_id": scheduler.TICK_ID}))
    assert doc["holder"] == "holder-1" and doc["ticks"] == 1
    assert doc["results"]["ok"]["ok"] is True and doc["results"]["ok"]["result"] == {"did": "thing"}
    assert doc["results"]["boom"]["ok"] is False and "kaboom" in doc["results"]["boom"]["error"]
    assert doc["results"]["after"]["result"] == 7
    st = run(scheduler.status(db, ["daily"]))
    assert st["lease"]["holder"] == "holder-1" and st["lease"]["live"] is True
    assert st["last_tick"]["ticks"] == 1
    run(db.system_runs.delete_many({"_id": {"$in": [scheduler.LEASE_ID, scheduler.TICK_ID]}}))


def test_run_forever_stops_on_event_and_releases_lease():
    db = server.db
    run(db.system_runs.delete_one({"_id": scheduler.LEASE_ID}))
    stop = asyncio.Event()
    ticks = []

    async def job():
        ticks.append(1)
        stop.set()

    run(scheduler.run_forever(db, [("j", job)], holder="loop-x", tick_seconds=30, stop=stop))
    assert ticks == [1]
    assert run(scheduler.acquire_lease(db, "someone-else")) is True, "lease released on stop"
    run(db.system_runs.delete_one({"_id": scheduler.LEASE_ID}))


# ───────────────────────── daily plan / catch-up ─────────────────────────


def test_daily_plan_catch_up_windows():
    mon = date(2026, 9, 7)   # Monday
    assert mon.weekday() == 0
    p = daily_jobs.daily_plan(mon)
    assert p["trainer_monday_digest"] is True
    assert p["hw_weekly_digest_as_of"] == date(2026, 9, 6), "Monday runs the Sunday digest for the week just ended"
    tue = daily_jobs.daily_plan(mon + timedelta(days=1))
    assert tue["trainer_monday_digest"] is True and tue["hw_weekly_digest_as_of"] == date(2026, 9, 6)
    wed = daily_jobs.daily_plan(mon + timedelta(days=2))
    assert wed["trainer_monday_digest"] is True and wed["hw_weekly_digest_as_of"] is None
    thu = daily_jobs.daily_plan(mon + timedelta(days=3))
    assert thu["trainer_monday_digest"] is False and thu["hw_weekly_digest_as_of"] is None
    sun = daily_jobs.daily_plan(mon + timedelta(days=6))
    assert sun["hw_weekly_digest_as_of"] == mon + timedelta(days=6)
    assert daily_jobs.daily_plan(date(2026, 10, 1))["pl_monthly"] is True
    assert daily_jobs.daily_plan(date(2026, 10, 7))["pl_monthly"] is True
    assert daily_jobs.daily_plan(date(2026, 10, 8))["pl_monthly"] is False


def test_maybe_run_daily_waits_for_min_hour():
    db = server.db
    saved = run(db.system_runs.find_one({"id": "daily"}, {"_id": 0}))
    try:
        run(db.system_runs.delete_one({"id": "daily"}))
        assert run(daily_jobs.maybe_run_daily(db, min_hour=24)) is None
        assert run(db.system_runs.find_one({"id": "daily"})) is None, "too-early call must not reserve the day"
    finally:
        if saved:
            run(db.system_runs.update_one({"id": "daily"}, {"$set": saved}, upsert=True))


def test_birthday_job_catches_up_a_missed_day():
    db = server.db
    today = datetime.now(daily_jobs.BUSINESS_TZ).date()
    yesterday = today - timedelta(days=1)
    stale = today - timedelta(days=daily_jobs.BIRTHDAY_CATCHUP_DAYS)   # just outside the window
    cid, did, did2 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    run(db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{uuid.uuid4().hex[:6]}@example.com", "_tag": TAG}))
    run(db.dogs.insert_one({"id": did, "name": f"{TAG} Pup", "owner_id": cid, "birthday": f"2020-{yesterday.strftime('%m-%d')}", "_tag": TAG}))
    run(db.dogs.insert_one({"id": did2, "name": f"{TAG} Old", "owner_id": cid, "birthday": f"2019-{stale.strftime('%m-%d')}", "_tag": TAG}))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_dog_birthday", new=AsyncMock(return_value=True)) as m:
            res = run(daily_jobs.run_birthday_job(db))
            keys = [c.kwargs.get("delivery_key") for c in m.call_args_list]
        assert f"birthday:{did}:{yesterday.isoformat()}" in keys, "yesterday's missed birthday is greeted, keyed by the birthday date"
        assert all(did2 not in k for k in keys), "outside the catch-up window stays quiet"
        assert res["sent"] >= 1
        # Idempotent once logged.
        run(db.notification_log.insert_one({"key": f"birthday:{did}:{yesterday.isoformat()}", "sent_at": server.now_iso(), "_tag": TAG}))
        with patch.object(daily_jobs.email_service, "notify_client_dog_birthday", new=AsyncMock(return_value=True)) as m2:
            run(daily_jobs.run_birthday_job(db))
            assert all(c.kwargs.get("delivery_key") != f"birthday:{did}:{yesterday.isoformat()}" for c in m2.call_args_list)
    finally:
        run(db.notification_log.delete_many({"_tag": TAG}))
        run(db.dogs.delete_many({"_tag": TAG}))
        run(db.clients.delete_many({"_tag": TAG}))


# ───────────────────────── recurring auto-extend ─────────────────────────


def _ensure_daycare_service():
    existing = run(server.db.services.find_one({"service_type": "daycare", "active": True}, {"_id": 0, "id": 1}))
    if existing:
        return existing["id"]
    sid = str(uuid.uuid4())
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare", "active": True, "is_default": True, "price": 30.0}))
    return sid


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
                                   "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}))
    try:
        yield c, {"id": did}
    finally:
        run(server.db.bookings.delete_many({"dog_id": did}))
        run(server.db.recurring_templates.delete_many({"dog_id": did}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _template(dog_id, sid, **extra):
    doc = {"id": str(uuid.uuid4()), "dog_id": dog_id, "label": f"{TAG} tpl", "service_type": "daycare", "service_id": sid,
           "time": "", "dropoff_time": "", "weekdays": [0, 1, 2, 3, 4], "notes": "", "default_horizon_weeks": 2,
           "start_date": "", "active": True, "auto_extend": True, "last_booked_through": None,
           "created_at": server.now_iso(), "created_by": "admin"}
    doc.update(extra)
    run(server.db.recurring_templates.insert_one(doc))
    return doc


def test_auto_extend_only_touches_due_opted_in_templates():
    sid = _ensure_daycare_service()
    today = server.business_today()
    with _client_and_dog() as (c, dog):
        due = _template(dog["id"], sid, last_booked_through=(today + timedelta(days=5)).isoformat())
        far = _template(dog["id"], sid, last_booked_through=(today + timedelta(days=60)).isoformat())
        manual = _template(dog["id"], sid, auto_extend=False, last_booked_through=(today + timedelta(days=2)).isoformat())
        never = _template(dog["id"], sid)  # never extended → operator has not opted in yet
        inactive = _template(dog["id"], sid, active=False, last_booked_through=(today + timedelta(days=2)).isoformat())

        summary = run(server._auto_extend_recurring_templates_once())
        assert summary["checked"] == 1 and summary["extended"] == 1, summary
        assert summary["created"] >= 5, "two weeks of weekday daycare should book at least five days"

        fresh = {t["id"]: t for t in run(server.db.recurring_templates.find({"dog_id": dog["id"]}, {"_id": 0}).to_list(10))}
        expected_end = (today + timedelta(days=6) + timedelta(weeks=2)).isoformat()
        assert fresh[due["id"]]["last_booked_through"] == expected_end
        assert fresh[due["id"]]["last_auto_extended_at"]
        assert fresh[due["id"]]["last_auto_extend_result"]["created"] == summary["created"]
        for t in (far, manual, never, inactive):
            assert fresh[t["id"]]["last_booked_through"] == t["last_booked_through"]
            assert "last_auto_extended_at" not in fresh[t["id"]]
        booked = run(server.db.bookings.find({"dog_id": dog["id"]}, {"_id": 0, "date": 1}).to_list(100))
        assert booked and min(b["date"] for b in booked) > due["last_booked_through"]
        assert all(b["date"] <= expected_end for b in booked)

        # Daily marker: second run today is a no-op.
        run(server.db.system_runs.delete_one({"_id": "recurring_auto_extend"}))
        first = run(server._maybe_auto_extend_recurring_today())
        second = run(server._maybe_auto_extend_recurring_today())
        assert first.get("checked") == 0 and second.get("skipped") == "done_today"
        run(server.db.system_runs.delete_one({"_id": "recurring_auto_extend"}))


def test_new_templates_default_to_auto_extend():
    body = server.RecurringTemplateIn(dog_id="x", weekdays=[0], service_id="s")
    assert body.auto_extend is True
    assert server.RecurringTemplateIn(dog_id="x", weekdays=[0], service_id="s", auto_extend=False).auto_extend is False


# ───────────────────────── wiring ─────────────────────────


def test_scheduler_jobs_and_status_endpoint():
    names = [n for n, _ in server._scheduler_jobs()]
    assert names == ["daily_jobs", "archive_bookings", "trophy_recheck", "recurring_auto_extend", "auto_backup"]
    st = run(server.admin_scheduler_status(_admin_user()))
    assert st["enabled"] is False, "_test_env disables the loop for tests"
    assert st["jobs"] == names and "lease" in st and "markers" in st


def test_auto_backup_tick_respects_disabled_config():
    with patch.object(server, "_get_auto_backup_config", new=AsyncMock(return_value={"enabled": False})):
        assert run(server._maybe_auto_backup_tick()) == {"skipped": "disabled"}
    assert not hasattr(server, "_auto_backup_loop"), "per-worker backup loop must be gone (it fired once per worker)"
