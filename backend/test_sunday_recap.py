"""Sunday recap (audit #87): the Sunday homework roll-up covers Monday through
Sunday by business date and is titled as that week. Other days keep the
rolling 24-hour roll-up titled "Today's training progress"."""
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
import daily_jobs
import email_service
from _test_loop import run

TAG = "TEST_SUNDAY_RECAP"
SUNDAY = date(2026, 10, 4)
MONDAY = date(2026, 9, 28)
WEDNESDAY = date(2026, 9, 30)


def _local(d: date, hour: int) -> str:
    """Business-local wall time on `d`, stored the way step_events store `ts` (UTC ISO)."""
    return datetime(d.year, d.month, d.day, hour, tzinfo=daily_jobs.BUSINESS_TZ).astimezone(timezone.utc).isoformat()


def _event(label: str, ts: str) -> None:
    run(server.db.step_events.insert_one({
        "id": str(uuid.uuid4()), "homework_id": str(uuid.uuid4()), "client_id": f"{TAG}-client",
        "client_name": f"{TAG} Client", "dog_id": f"{TAG}-dog", "dog_name": f"{TAG} Dog",
        "homework_title": f"{TAG} Sit practice", "day_number": 1, "step_id": label, "step_label": label,
        "done": True, "all_done": False, "ts": ts,
    }))


def _cleanup(*days: date) -> None:
    run(server.db.step_events.delete_many({"step_label": {"$regex": f"^{TAG}"}}))
    real_today = datetime.now(daily_jobs.BUSINESS_TZ).date()
    for d in (*days, real_today):  # the real day's dedup key must not hide a run
        run(server.db.system_runs.delete_many({"id": f"hw_step_rollup:{d.isoformat()}"}))


def _run_rollup(today: date):
    send = AsyncMock(return_value=True)
    evening = datetime(today.year, today.month, today.day, 21, 0, tzinfo=daily_jobs.BUSINESS_TZ)
    with patch.object(daily_jobs, "_today_local", return_value=today), \
            patch.object(daily_jobs, "_business_now", return_value=evening), \
            patch.object(email_service, "ADMIN_NOTIFICATION_EMAIL", "owner@example.com"), \
            patch.object(email_service, "_send", new=send):
        res = run(daily_jobs.run_homework_step_rollup_job(server.db))
    return res, send


def test_sunday_roll_up_covers_monday_through_sunday_including_sunday_practice_after_seven():
    assert SUNDAY.weekday() == 6 and MONDAY.weekday() == 0
    _cleanup(SUNDAY)
    try:
        _event(f"{TAG} Monday step", _local(MONDAY, 9))
        _event(f"{TAG} Wednesday step", _local(WEDNESDAY, 18))
        _event(f"{TAG} Sunday afternoon step", _local(SUNDAY, 15))  # recorded after the 7 AM run
        _event(f"{TAG} Sunday late step", _local(SUNDAY, 21))
        _event(f"{TAG} previous Sunday step", _local(date(2026, 9, 27), 23))  # before the week
        _event(f"{TAG} next Monday step", _local(date(2026, 10, 5), 8))  # after the week
        res, send = _run_rollup(SUNDAY)
        assert res.get("sent") == 1, res
        subj = send.call_args.args[1]
        body = send.call_args.args[2]
        assert f"{TAG} Sunday afternoon step" in body, "Sunday practice after the 7 AM run must be in the recap"
        for label in ("Monday step", "Wednesday step", "Sunday late step"):
            assert f"{TAG} {label}" in body, label
        for label in ("previous Sunday step", "next Monday step"):
            assert f"{TAG} {label}" not in body, label
        assert "week of Sep 28 – Oct 4, 2026" in subj, subj
        assert "Week of Sep 28 – Oct 4, 2026" in body
        assert "Today's training progress" not in subj and "Today's training progress" not in body
        assert "Date: 2026-10-04" not in body
    finally:
        _cleanup(SUNDAY)


def test_week_recap_title_crosses_a_year_end():
    dec_sun = date(2027, 1, 3)  # Sunday; the week is Dec 28 2026 - Jan 3 2027
    _cleanup(dec_sun)
    try:
        _event(f"{TAG} year-end step", _local(dec_sun, 10))
        res, send = _run_rollup(dec_sun)
        assert res.get("sent") == 1, res
        subj = send.call_args.args[1]
        assert "week of Dec 28, 2026 – Jan 3, 2027" in subj, subj
    finally:
        _cleanup(dec_sun)


def test_weekday_roll_up_keeps_todays_title():
    _cleanup(WEDNESDAY)
    try:
        # Weekday roll-ups keep the rolling 24-hour window, so the step is stamped one hour before now.
        _event(f"{TAG} weekday step", (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
        res, send = _run_rollup(WEDNESDAY)
        assert res.get("sent") == 1, res
        subj = send.call_args.args[1]
        assert subj.startswith("Today's training progress"), subj
        assert "Date: 2026-09-30" in send.call_args.args[2]
    finally:
        _cleanup(WEDNESDAY)
