"""The Tax Center lists last year's fourth installment in January (audit #18).

The 4th installment for a tax year is due January 15 of the next year. The Tax
Center opens on the current year, so on January 5, 2027 it showed 2027's dates
only, and last year's January 15 federal and Ohio dates were on nobody's list.
Disposable, no rows written.
"""
from datetime import date

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run


@pytest.fixture()
def jan_fifth(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: date(2027, 1, 5))


def _upcoming_dates(year):
    payload = run(server._tax_center_payload(year, as_of=date(2027, 1, 5)))
    return {(u["date"], u["jurisdiction"]) for u in payload["upcoming_dates"]}


def test_january_fifth_lists_last_years_q4_federal_and_ohio_dates(jan_fifth):
    dates = _upcoming_dates(2027)
    assert ("2027-01-15", "federal") in dates
    assert ("2027-01-15", "ohio") in dates


def test_once_last_years_q4_is_paid_the_january_date_is_no_longer_upcoming(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: date(2027, 1, 20))
    payload = run(server._tax_center_payload(2027, as_of=date(2027, 1, 20)))
    assert not any(u["date"] == "2027-01-15" for u in payload["upcoming_dates"])
