"""A boarding dog collected after its booked end date is not also charged a
per-15-minute late fee counted from the old pickup time (audit #17: "An extra
night at checkout also triggers a huge per-15-minute late-pickup fee"). The
clock never runs across the night, as for daycare. A same-evening late pickup is
still charged. Disposable tag TEST_BOARD_LATE."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`
import server  # noqa: F401 — configures the pricing domain (its business timezone)
from domains.pricing import services as pricing

NY = ZoneInfo("America/New_York")  # the business timezone the app uses
SETTINGS = {"day_to_day": {"money": {"late_pickup_fee_per_15min": 5.0, "late_pickup_grace_min": 0}}}
END = "2026-10-03"


def _at(day, hhmm):
    return datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=NY).astimezone(timezone.utc).isoformat()


def _stay():
    return {"service_type": "boarding", "date": "2026-09-30", "end_date": END, "pickup_time": "17:00"}


def test_a_boarding_dog_collected_the_next_morning_has_no_late_fee():
    out = pricing.money_modifier_breakdown(_stay(), 100.0, SETTINGS, _at("2026-10-04", "10:00"))
    assert out["late_pickup_fee"] == 0.0, "the extra night is the charge; the clock must not run overnight"


def test_a_boarding_dog_collected_the_same_evening_late_still_pays_the_fee():
    out = pricing.money_modifier_breakdown(_stay(), 100.0, SETTINGS, _at(END, "17:30"))
    assert out["late_pickup_fee"] == 10.0
