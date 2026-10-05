"""The booking screen's time grid greys out the times the booking would refuse (audit #46).

The grid used to offer every open hour, including hours already past and hours
a same-day or minimum-notice rule refuses, so a client could pick one and be
turned away at Book. The grid and the booking now read the same time rules, so
a slot the grid offers is one the booking accepts. Admins are not limited by
these rules and still see every slot.
"""
from datetime import datetime, timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

ALL_DAY = {d: {"closed": False, "open": "00:00", "close": "23:30"} for d in server.DEFAULT_DAYS}


@pytest.fixture
def settings(monkeypatch):
    """Training open all day, so every hour of today is a candidate slot."""
    base = {"service_hours": {"training": ALL_DAY}, "booking_flow_controls": {}}

    def _set(**controls):
        s = dict(base)
        if controls:
            s["booking_flow_controls"] = {"per_service": {"training": controls}}
        else:
            s["booking_flow_controls"] = {}

        async def _stub():
            return s

        monkeypatch.setattr(server, "get_settings", _stub)
        return s

    return _set


def _today_ohio():
    return datetime.now(server.BUSINESS_TZ).date()


def _slots(day, user):
    out = run(server.list_time_slots(date_str=day.isoformat(), service_type="training", user=user))
    return {s["time"]: s for s in out["slots"]}


def test_a_past_time_today_is_greyed_for_a_client(settings):
    settings()
    slots = _slots(_today_ohio(), {"role": "client", "id": "client-t"})
    assert slots["00:00"]["available"] is False
    assert slots["00:00"]["blocked_by"] == "time_in_past"


def test_a_same_day_rule_greys_every_slot_today_for_a_client(settings):
    settings(same_day=False)
    slots = _slots(_today_ohio(), {"role": "client", "id": "client-t"})
    assert slots and not any(s["available"] for s in slots.values())
    # A slot already past reports time_in_past first, the same order the booking checks in.
    reasons = {s["blocked_by"] for s in slots.values()}
    assert reasons <= {"same_day_not_allowed", "time_in_past"}
    assert "same_day_not_allowed" in reasons


def test_an_admin_still_sees_today_as_bookable(settings):
    settings(same_day=False)
    slots = _slots(_today_ohio(), {"role": "admin", "id": "admin-t"})
    assert slots["00:00"]["available"] is True


def test_tomorrow_is_bookable_under_the_default_rules(settings):
    settings()
    tomorrow = _today_ohio() + timedelta(days=1)
    slots = _slots(tomorrow, {"role": "client", "id": "client-t"})
    assert slots["09:00"]["available"] is True


def _stub_settings(monkeypatch, settings):
    async def _stub():
        return settings
    monkeypatch.setattr(server, "get_settings", _stub)


def test_a_day_with_no_service_row_follows_the_business_closure(monkeypatch):
    """With no training row for a day, the grid uses the business day, as booking does (review of a223e53)."""
    d = _today_ohio() + timedelta(days=14)
    dow = server.DEFAULT_DAYS[d.weekday()]
    _stub_settings(monkeypatch, {"service_hours": {"training": {}},
                                 "business_hours": {dow: {"closed": True}}, "booking_flow_controls": {}})
    out = run(server.list_time_slots(date_str=d.isoformat(), service_type="training", user={"role": "client", "id": "c"}))
    assert out["closed"] is True and out["slots"] == []


def test_a_day_with_no_service_row_offers_only_the_business_hours(monkeypatch):
    d = _today_ohio() + timedelta(days=14)
    dow = server.DEFAULT_DAYS[d.weekday()]
    _stub_settings(monkeypatch, {"service_hours": {"training": {}},
                                 "business_hours": {dow: {"closed": False, "open": "10:00", "close": "12:00"}},
                                 "booking_flow_controls": {}})
    out = run(server.list_time_slots(date_str=d.isoformat(), service_type="training", user={"role": "client", "id": "c"}))
    times = [s["time"] for s in out["slots"]]
    assert times and times[0] == "10:00" and times[-1] < "12:00"
