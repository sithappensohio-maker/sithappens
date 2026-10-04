"""A dose the owner gave at home is not "Missed" when the dog arrives later
(audit #1: "A dose given at home shows as Missed and sets off an Overdue
Medication alert at check-in"). A dose due before the arrival time on the arrival
day is not due here, so it is off the board and out of Action Required and the
Kennel Board. A recorded dose stays visible, and a dose after arrival still
goes missed. The clock is pinned to 13:00 so the result does not depend on when
this runs. Disposable tag TEST_CARE_ARRIVAL."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server  # noqa: F401 — configures the care domain's globals
from domains.bookings import care

DAY = "2026-10-04"
NY = ZoneInfo("America/New_York")


def _arrival(hour, minute=0, day=DAY):
    local = datetime(*map(int, day.split("-")), hour, minute, tzinfo=NY)
    return local.astimezone(timezone.utc).isoformat()


def _booking(arrived_at, items, start=DAY):
    return {"id": "TEST_CARE_ARRIVAL-b", "date": start, "end_date": "2026-10-06", "checked_in_at": arrived_at,
            "care_items": items}


def _dose(item_id, time, **extra):
    return {"id": item_id, "kind": "medication", "name": "Apoquel", "time": time, "status": "pending", **extra}


@pytest.fixture(autouse=True)
def _clock_at_one_pm(monkeypatch):
    monkeypatch.setitem(care._server_globals, "_now_business_minutes", lambda: 13 * 60)


def _by_id(view):
    return {it["id"]: it for it in view}


def test_a_dose_due_before_the_dog_arrived_is_not_missed():
    b = _booking(_arrival(10, 0), [_dose("morning", "08:00")])
    view = _by_id(care.items_for_day(b, DAY, today=DAY))
    assert "morning" not in view, "the owner gave it at home; it is not due here"
    assert not care.med_overdue(b, DAY)


def test_a_dose_due_after_arrival_still_goes_missed_when_overdue():
    b = _booking(_arrival(10, 0), [_dose("late-morning", "11:00")])
    view = _by_id(care.items_for_day(b, DAY, today=DAY))
    assert view["late-morning"]["derived_status"] == "missed"
    assert care.med_overdue(b, DAY)


def test_a_dose_recorded_before_arrival_stays_visible_as_given():
    b = _booking(_arrival(10, 0), [_dose("morning", "08:00", days={DAY: {"status": "completed", "completed_at": _arrival(9, 0)}})])
    view = _by_id(care.items_for_day(b, DAY, today=DAY))
    assert view["morning"]["derived_status"] == "completed"


def test_a_dog_that_arrived_on_an_earlier_day_still_misses_todays_dose():
    b = _booking(_arrival(10, 0, day="2026-10-03"), [_dose("morning", "08:00")], start="2026-10-03")
    view = _by_id(care.items_for_day(b, DAY, today=DAY))
    assert view["morning"]["derived_status"] == "missed"


def test_a_meal_before_arrival_is_left_as_it_was():
    # Only doses are the owner's to have given at home; a meal due before arrival is still shown.
    b = _booking(_arrival(10, 0), [{"id": "breakfast", "kind": "feeding", "name": "Kibble", "time": "08:00", "status": "pending"}])
    view = _by_id(care.items_for_day(b, DAY, today=DAY))
    assert view["breakfast"]["derived_status"] == "missed"
