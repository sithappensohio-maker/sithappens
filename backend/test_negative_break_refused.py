"""A break cannot be negative: a negative break would add paid time to a shift (audit
#59: "Server accepts a negative break that adds paid time to a shift"). Disposable
tag TEST_NEG_BREAK."""
import datetime

import _test_env  # noqa: F401 — must run before `import server`
import pytest
from pydantic import ValidationError

import server
from domains.staff import routes as staff_routes


def test_clock_out_refuses_a_negative_break():
    with pytest.raises(ValidationError):
        server.ClockOutIn(break_minutes=-30)


def test_time_clock_edit_refuses_a_negative_break():
    with pytest.raises(ValidationError):
        server.TimeClockEditIn(break_minutes=-30)


def test_a_zero_or_positive_break_is_still_accepted():
    assert server.ClockOutIn(break_minutes=30).break_minutes == 30
    assert server.ClockOutIn().break_minutes == 0


def test_a_negative_break_never_adds_hours_to_a_shift():
    ci = datetime.datetime(2026, 10, 5, 9, 0, tzinfo=datetime.timezone.utc)
    co = datetime.datetime(2026, 10, 5, 17, 0, tzinfo=datetime.timezone.utc)
    assert staff_routes.shift_hours(ci.isoformat(), co.isoformat(), -60) == 8.0
