"""The Sunday step recap goes out in the evening, so Sunday practice is in it (audit #87).

It used to go at the first scheduler run after 7 AM, before Sunday's practice was
logged. A Sunday run before the evening hour does nothing, and the evening helper
runs the recap once for the day. The send is stubbed. Disposable tag TEST_SUNDAY_RECAP.
"""
from datetime import date, datetime

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import daily_jobs
import email_service
import server
from _test_loop import run

SUNDAY = date(2026, 10, 4)   # a Sunday
DAY_KEYS = ["hw_step_rollup:2026-10-04", "sunday_recap"]


@pytest.fixture()
def sunday(monkeypatch):
    monkeypatch.setattr(daily_jobs, "_today_local", lambda: SUNDAY)
    monkeypatch.setattr(email_service, "ADMIN_NOTIFICATION_EMAIL", "owner@test")

    async def _send(*_a, **_k):
        return True
    monkeypatch.setattr(email_service, "_send", _send)
    run(server.db.system_runs.delete_many({"id": {"$in": DAY_KEYS}}))
    yield monkeypatch
    run(server.db.system_runs.delete_many({"id": {"$in": DAY_KEYS}}))


def _at(monkeypatch, hour):
    monkeypatch.setattr(daily_jobs, "_business_now",
                        lambda: datetime(2026, 10, 4, hour, 0, tzinfo=daily_jobs.BUSINESS_TZ))


def test_the_sunday_recap_waits_for_the_evening(sunday):
    _at(sunday, 10)
    out = run(daily_jobs.run_homework_step_rollup_job(server.db))
    assert out.get("reason") == "waiting_for_sunday_evening"


def test_the_evening_run_goes_past_the_wait(sunday):
    _at(sunday, 21)
    out = run(daily_jobs.run_homework_step_rollup_job(server.db))
    assert out.get("reason") != "waiting_for_sunday_evening"


def test_the_evening_helper_runs_the_recap_only_after_the_wait(sunday):
    _at(sunday, 10)
    assert run(daily_jobs.maybe_run_sunday_recap(server.db)) is None
    _at(sunday, 21)
    out = run(daily_jobs.maybe_run_sunday_recap(server.db))
    assert out is not None and out.get("reason") != "waiting_for_sunday_evening"
