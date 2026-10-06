"""Holiday and peak-season surcharges on a stay, worked out over its nights.

A holiday on ANY night of a boarding stay surcharges the whole stay at the
holiday rate (the base is not split). A peak-season range is applied per night:
the base is split evenly across the nights the stay covers, and only the nights
inside the peak range take the peak rate. A holiday that falls inside a stay
which also crosses a peak season takes the holiday rate for the whole stay (it
replaces the peak rate rather than stacking on it). A daycare day is one night.

These are pure pricing tests: no database, just the breakdown function.
"""
import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server

MONEY = {"round_to_dollar": False, "late_pickup_fee_per_15min": 0}


def _settings(holidays=None, peaks=None):
    return {"day_to_day": {"money": dict(MONEY), "seasonal": {
        "holiday_surcharges": holidays or [],
        "peak_season_ranges": peaks or [],
    }}}


def _boarding(start, end):
    return {"service_type": "boarding", "date": start, "end_date": end, "pricing_snapshot": {}}


CHRISTMAS_EVE = {"date": "2030-12-24", "multiplier": 1.5, "label": "Christmas Eve"}


def test_a_holiday_on_the_last_night_surcharges_the_whole_stay_at_the_holiday_rate():
    # Two nights, 23 and 24 Dec; the 24th is a holiday at 1.5x. $100 base.
    settings = _settings(holidays=[CHRISTMAS_EVE])
    result = server._money_modifier_breakdown(_boarding("2030-12-23", "2030-12-25"), 100.0, settings)
    assert result["base_before"] == 100.0
    assert result["seasonal_multiplier"] == 1.5
    assert result["seasonal_amount"] == 50.0          # the whole $100 base at 1.5x, not one night
    assert result["total_after"] == 150.0
    assert result["seasonal_label"] == "Christmas Eve"


def test_a_holiday_on_the_first_night_surcharges_the_whole_stay_too():
    # Stay 24-26 Dec: the holiday is the first night; the second night is ordinary.
    settings = _settings(holidays=[CHRISTMAS_EVE])
    result = server._money_modifier_breakdown(_boarding("2030-12-24", "2030-12-26"), 100.0, settings)
    assert result["seasonal_multiplier"] == 1.5
    assert result["seasonal_amount"] == 50.0
    assert result["total_after"] == 150.0


def test_a_stay_that_runs_into_a_peak_season_is_charged_the_peak_rate_only_on_its_peak_nights():
    # Four nights, 8-11 June; the season covers the 10th and 11th at 2x. $50 a night.
    settings = _settings(peaks=[{"start": "2030-06-10", "end": "2030-06-30", "multiplier": 2.0, "label": "Summer peak"}])
    result = server._money_modifier_breakdown(_boarding("2030-06-08", "2030-06-12"), 200.0, settings)
    assert result["base_before"] == 200.0
    assert result["seasonal_amount"] == 100.0         # 50 + 50 + 100 + 100
    assert result["total_after"] == 300.0
    assert result["seasonal_label"] == "Summer peak"
    assert result["seasonal_multiplier"] == 1.5       # blended across the four nights


def test_a_holiday_night_inside_a_peak_season_takes_the_holiday_rate_for_the_whole_stay():
    # Four nights, 8-11 June, a holiday on the 8th at 1.5x, and a peak season from the
    # 10th at 2x. The holiday rate applies to the whole $200 base, not a night at a time.
    holiday = {"date": "2030-06-08", "multiplier": 1.5, "label": "Holiday"}
    settings = _settings(holidays=[holiday],
                         peaks=[{"start": "2030-06-10", "end": "2030-06-30", "multiplier": 2.0, "label": "Summer peak"}])
    result = server._money_modifier_breakdown(_boarding("2030-06-08", "2030-06-12"), 200.0, settings)
    assert result["seasonal_multiplier"] == 1.5
    assert result["seasonal_amount"] == 100.0
    assert result["seasonal_label"] == "Holiday"


def test_a_daycare_day_on_a_holiday_is_surcharged_as_before():
    settings = _settings(holidays=[CHRISTMAS_EVE])
    daycare = {"service_type": "daycare", "date": "2030-12-24", "pricing_snapshot": {}}
    result = server._money_modifier_breakdown(daycare, 40.0, settings)
    assert result["seasonal_amount"] == 20.0
    assert result["total_after"] == 60.0


def test_an_early_checkout_that_left_before_the_holiday_night_is_not_surcharged_for_it():
    # Booked 23-27 Dec with the holiday on the 24th, but the dog leaves on the 24th:
    # only the 23rd was stayed, so there is no holiday night and no surcharge.
    settings = _settings(holidays=[CHRISTMAS_EVE])
    result = server._money_modifier_breakdown(
        _boarding("2030-12-23", "2030-12-27"), 50.0, settings, stay_end="2030-12-24")
    assert result["seasonal_amount"] == 0.0
    assert result["total_after"] == 50.0


def test_an_early_checkout_that_stays_through_the_holiday_night_is_surcharged_on_the_whole_stay():
    # Booked 23-27 Dec, the dog leaves on the 25th: the 23rd and 24th were stayed,
    # so the holiday on the 24th surcharges the two nights stayed, not the four booked.
    settings = _settings(holidays=[CHRISTMAS_EVE])
    result = server._money_modifier_breakdown(
        _boarding("2030-12-23", "2030-12-27"), 100.0, settings, stay_end="2030-12-25")
    assert result["seasonal_amount"] == 50.0
    assert result["total_after"] == 150.0
