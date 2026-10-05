"""The automatic backup runs at the configured time, and midnight means midnight (audit
#91: "A nightly backup set for 12 AM actually runs at 3 AM"). Disposable tag none (pure)."""
from domains.backup import routes as backup_routes


def test_an_hour_of_zero_is_midnight_not_three_am():
    assert backup_routes.scheduled_hhmm({"hour": 0, "minute": 0}) == (0, 0)


def test_a_missing_hour_still_defaults_to_three_am():
    assert backup_routes.scheduled_hhmm({}) == (3, 0)


def test_a_configured_time_is_used_as_set():
    assert backup_routes.scheduled_hhmm({"hour": 5, "minute": 30}) == (5, 30)
