"""'Requested time already passed' is judged on the Ohio clock (audit: "Action
Required judges 'requested time already passed' on the server's UTC clock").

The production server runs on UTC. The test makes the server's own clock read
UTC (18:00 when Ohio is 14:00), so it shows the wrong answer if the rule ever
reads the server clock again. Pure function test; no data is written."""
import datetime as dt

import _test_env  # noqa: F401 — must run before `import server`
import server


class _UTCServerClock(dt.datetime):
    """What the server's own clock reads on a UTC box: naive local = UTC."""

    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return dt.datetime(2030, 6, 10, 18, 0)
        return dt.datetime(2030, 6, 10, 18, 0, tzinfo=dt.timezone.utc).astimezone(tz)


def _at_ohio_two_pm(monkeypatch):
    today = dt.date(2030, 6, 10)   # a Monday, well away from the real calendar
    monkeypatch.setattr(server, "business_today", lambda: today)
    monkeypatch.setattr(server, "now_local", lambda: dt.datetime(2030, 6, 10, 14, 0))
    monkeypatch.setattr(server, "datetime", _UTCServerClock)
    return today.isoformat()


def test_a_time_later_today_by_the_ohio_clock_is_not_passed(monkeypatch):
    day = _at_ohio_two_pm(monkeypatch)
    out = server._pending_action_urgency(None, day, "15:00")
    assert out["urgency"] != "overdue_requested_passed", "2 PM Ohio: a 3 PM request is still to come"


def test_a_time_earlier_today_by_the_ohio_clock_is_passed(monkeypatch):
    day = _at_ohio_two_pm(monkeypatch)
    out = server._pending_action_urgency(None, day, "13:00")
    assert out["urgency"] == "overdue_requested_passed"
