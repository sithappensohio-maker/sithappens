"""An event stops taking preregistrations once it has ended, even when no closing time was set
(audit #76). The closed check read only the explicit close time, which is empty by default, so a
past event kept accepting registrations. Pure check, no database."""
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import events_domain


def _iso(delta_days):
    return (datetime.now(timezone.utc) + timedelta(days=delta_days)).isoformat()


def test_an_event_that_has_ended_is_closed_without_a_set_close_time():
    past = {"registration_open": True, "registration_closes_at": None, "start_at": _iso(-2), "end_at": _iso(-1)}
    assert events_domain._registration_closed(past) is True


def test_an_event_still_to_come_stays_open_without_a_set_close_time():
    upcoming = {"registration_open": True, "registration_closes_at": None, "start_at": _iso(5), "end_at": _iso(6)}
    assert events_domain._registration_closed(upcoming) is False


def test_an_explicit_close_time_still_wins():
    closed = {"registration_open": True, "registration_closes_at": _iso(-1), "start_at": _iso(5), "end_at": _iso(6)}
    assert events_domain._registration_closed(closed) is True
