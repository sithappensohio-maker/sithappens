"""'Send now' on the Monday brief clears this week's dedup key, so it can re-send (audit #69).

The job keys its dedup on the Monday of the week. 'Send now' used to clear the key
for the day it was pressed, so on a Tuesday through Sunday the stale Monday key stayed
and the job skipped without sending. The job itself is stubbed; only the key handling
is under test. Disposable tag TEST_DIGEST_DAY."""
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import daily_jobs
from _test_loop import run

TAG = "TEST_DIGEST_DAY"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


@pytest.fixture()
def stub_job(monkeypatch):
    async def fake(_db, **_kw):
        return {"sent": 0}
    monkeypatch.setattr(daily_jobs, "run_trainer_monday_digest_job", fake)
    yield monkeypatch
    run(server.db.notification_log.delete_many({"tag": TAG}))


def _seed_key(key):
    run(server.db.notification_log.insert_one({"key": key, "tag": TAG}))


def test_send_now_on_the_monday_clears_that_monday_key(stub_job):
    stub_job.setattr(server, "business_today", lambda: date(2026, 10, 5))
    _seed_key("trainer_monday_digest:2026-10-05")
    run(server.admin_force_monday_digest(ADMIN))
    assert run(server.db.notification_log.count_documents({"key": "trainer_monday_digest:2026-10-05"})) == 0


def test_a_send_now_uses_its_own_provider_key_so_resend_does_not_drop_it(monkeypatch):
    """Resend dedupes an idempotency key for 24 hours. A manual re-send reuses the week's key, so it can be
    dropped while reporting success (review of 788d179). A manual send carries its own key; the week's
    key is still the one stamped as sent."""
    from datetime import datetime, timedelta
    import email_service
    today = datetime.now(server.BUSINESS_TZ).date()
    week_key = f"trainer_monday_digest:{(today - timedelta(days=today.weekday())).isoformat()}"
    seen = {}

    async def fake_notify(data, **kw):
        seen.update(kw)
        return True
    monkeypatch.setattr(email_service, "notify_trainer_monday_digest", fake_notify)
    run(server.db.bookings.insert_one({"id": f"{TAG}-bk", "date": today.isoformat(), "status": "approved",
                                       "service_type": "daycare", "tag": TAG, "notes": TAG}))
    try:
        run(server.db.notification_log.delete_many({"key": week_key}))
        run(server.admin_force_monday_digest(ADMIN))
        assert seen["delivery_key"] == week_key
        assert seen["send_key"] and seen["send_key"] != week_key and seen["send_key"].startswith(week_key)
    finally:
        run(server.db.bookings.delete_many({"tag": TAG}))
        run(server.db.notification_log.delete_many({"key": week_key}))


def test_send_now_on_a_wednesday_clears_this_weeks_monday_key(stub_job):
    # The job's key is the Monday of this week (2026-10-05), not today (2026-10-07).
    stub_job.setattr(server, "business_today", lambda: date(2026, 10, 7))
    _seed_key("trainer_monday_digest:2026-10-05")
    run(server.admin_force_monday_digest(ADMIN))
    assert run(server.db.notification_log.count_documents({"key": "trainer_monday_digest:2026-10-05"})) == 0


def test_a_send_now_held_by_quiet_hours_is_reported_as_held_not_failed(monkeypatch):
    """A brief held for Quiet Hours will go out when they end; it is not a failed send (review of 479e8c6)."""
    from datetime import datetime, timedelta
    import email_service
    today = datetime.now(server.BUSINESS_TZ).date()
    week_key = f"trainer_monday_digest:{(today - timedelta(days=today.weekday())).isoformat()}"

    async def held_notify(data, **kw):
        email_service.last_send_error = "Quiet hours active"
        return False
    monkeypatch.setattr(email_service, "notify_trainer_monday_digest", held_notify)
    run(server.db.bookings.insert_one({"id": f"{TAG}-held", "date": today.isoformat(), "status": "approved",
                                       "service_type": "daycare", "tag": TAG, "notes": TAG}))
    try:
        run(server.db.notification_log.delete_many({"key": week_key}))
        out = run(server.admin_force_monday_digest(ADMIN))
        assert out["sent"] == 0 and out["reason"] == "held_quiet_hours"
    finally:
        run(server.db.bookings.delete_many({"tag": TAG}))
        run(server.db.notification_log.delete_many({"key": week_key}))
