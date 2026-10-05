"""A practice reminder is due at the time the client chose, not at the daily run (audit
#84). A client who never saved a time gets 18:00. Pure: no database."""
from datetime import datetime

import _test_env  # noqa: F401 — must run before `import server`
import daily_jobs


def _at(hhmm):
    return datetime(2026, 10, 5, *map(int, hhmm.split(":")))


def test_a_morning_time_is_due_once_it_has_passed():
    assert daily_jobs.practice_reminder_due({"homework_reminder_time": "09:00"}, _at("10:00")) is True


def test_an_evening_time_is_not_due_in_the_morning():
    assert daily_jobs.practice_reminder_due({"homework_reminder_time": "18:00"}, _at("10:00")) is False


def test_a_client_with_no_saved_time_gets_the_six_pm_default():
    assert daily_jobs.practice_reminder_due({}, _at("17:59")) is False
    assert daily_jobs.practice_reminder_due({}, _at("18:00")) is True
