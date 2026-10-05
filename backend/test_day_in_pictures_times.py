"""Times in the Day in Pictures email are the business's clock (audit #85: "The 'Day in
Pictures' email shows meal and medication times 4-5 hours off"). Stored times are UTC.
Pure: no database."""
import _test_env  # noqa: F401 — must run before `import server`
import email_service


def test_a_utc_time_is_shown_on_the_business_clock():
    assert email_service._short_time("2026-10-05T13:12:00+00:00") == "9:12 AM"


def test_an_afternoon_time_is_shown_as_pm():
    assert email_service._short_time("2026-10-05T19:05:00+00:00") == "3:05 PM"


def test_a_missing_time_is_blank():
    assert email_service._short_time(None) == ""
