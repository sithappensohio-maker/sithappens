"""A dog collected the morning after a boarding stay ends is billed the extra night,
not a late-pickup fee on top of it (audit #17). The clock runs from the booked end
date, and a later-day checkout zeroes the fee. Disposable; no rows written."""
from datetime import datetime, timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from domains.pricing import services as pricing
from _test_loop import run

MONEY = {"late_pickup_fee_per_15min": 5.0, "late_pickup_grace_min": 10}


def _breakdown(booking, checkout_ts, extra_end=None):
    settings = {"day_to_day": {"seasonal": {}, "money": dict(MONEY)}}
    return pricing.money_modifier_breakdown(booking, 100.0, settings, checkout_ts)


def test_a_dog_collected_the_morning_after_its_stay_ends_pays_no_late_fee():
    end = (datetime.now(server.BUSINESS_TZ).date() - timedelta(days=1)).isoformat()
    booking = {"service_type": "boarding", "date": end, "end_date": end, "pickup_time": "17:00"}
    morning = datetime.now(server.BUSINESS_TZ).replace(hour=10, minute=0, second=0, microsecond=0).isoformat()
    assert _breakdown(booking, morning)["late_pickup_fee"] == 0


def test_a_dog_collected_late_on_its_own_end_day_still_pays_the_late_fee():
    today = datetime.now(server.BUSINESS_TZ).date().isoformat()
    booking = {"service_type": "boarding", "date": today, "end_date": today, "pickup_time": "17:00"}
    evening = datetime.now(server.BUSINESS_TZ).replace(hour=19, minute=0, second=0, microsecond=0).isoformat()
    assert _breakdown(booking, evening)["late_pickup_fee"] > 0
