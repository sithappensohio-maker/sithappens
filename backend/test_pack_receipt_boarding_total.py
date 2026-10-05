"""The credit-pack receipt email counts boarding packs in its total (audit #37).

The "Total charged" line added up daycare and training only, so a boarding pack
showed $0.00, and a boarding-only sale put $0.00 in the subject. Boarding is now
in the total, its line reads "boarding nights", and it gets its own "added" row.
Daycare and training receipts are unchanged.

No live server or database is needed: the email is captured in memory.
"""
import re

import _test_env  # noqa: F401 — must run before `import server`
import email_service
import pytest
from _test_loop import run

CLIENT = {"id": "TEST_PACK_RECEIPT_BOARDING-c1", "name": "Pat Lee", "email": "pat@example.com"}
SOLD_AT = "2026-10-05T12:00:00+00:00"


@pytest.fixture
def sent(monkeypatch):
    out = []

    async def _capture(to_email, subject, html):
        out.append((to_email, subject, html))

    monkeypatch.setattr(email_service, "_send", _capture)
    return out


def _send(sent, lines, totals):
    run(email_service.notify_client_pack_receipt(CLIENT, lines, totals, "check", "", "Admin", SOLD_AT))
    assert len(sent) == 1
    return sent[0][1], sent[0][2]


def _total_row(html):
    m = re.search(r"Total charged</td>\s*<td[^>]*>\$([0-9.,]+)</td>", html)
    assert m, "the receipt has a Total charged row"
    return m.group(1)


def test_a_boarding_only_receipt_shows_the_boarding_total(sent):
    totals = {"daycare": {"qty": 0, "price": 0.0}, "training": {"qty": 0, "price": 0.0},
              "boarding": {"qty": 5, "price": 250.0}}
    lines = [{"pack_id": "x", "name": "5-Night Boarding Pack", "qty": 1, "unit_price": 250.0,
              "line_total": 250.0, "service_type": "boarding", "pack_qty": 5}]
    subject, html = _send(sent, lines, totals)
    assert _total_row(html) == "250.00"
    assert "$250.00" in subject and "$0.00" not in subject


def test_a_mixed_receipt_adds_boarding_to_the_daycare_total(sent):
    totals = {"daycare": {"qty": 1, "price": 35.0}, "training": {"qty": 0, "price": 0.0},
              "boarding": {"qty": 5, "price": 250.0}}
    lines = [
        {"pack_id": "d", "name": "Single Day Pack", "qty": 1, "unit_price": 35.0, "line_total": 35.0, "service_type": "daycare"},
        {"pack_id": "x", "name": "5-Night Boarding Pack", "qty": 1, "unit_price": 250.0,
         "line_total": 250.0, "service_type": "boarding", "pack_qty": 5},
    ]
    _subject, html = _send(sent, lines, totals)
    assert _total_row(html) == "285.00"


def test_a_boarding_line_is_labelled_in_nights_with_its_own_added_row(sent):
    totals = {"daycare": {"qty": 0, "price": 0.0}, "training": {"qty": 0, "price": 0.0},
              "boarding": {"qty": 5, "price": 250.0}}
    lines = [{"pack_id": "x", "name": "5-Night Boarding Pack", "qty": 1, "unit_price": 250.0,
              "line_total": 250.0, "service_type": "boarding", "pack_qty": 5}]
    _subject, html = _send(sent, lines, totals)
    assert "boarding nights" in html
    assert "+5 nights" in html


def test_a_daycare_only_receipt_is_unchanged(sent):
    totals = {"daycare": {"qty": 1, "price": 35.0}, "training": {"qty": 0, "price": 0.0},
              "boarding": {"qty": 0, "price": 0.0}}
    lines = [{"pack_id": "d", "name": "Single Day Pack", "qty": 1, "unit_price": 35.0, "line_total": 35.0, "service_type": "daycare"}]
    subject, html = _send(sent, lines, totals)
    assert _total_row(html) == "35.00"
    assert "daycare credits" in html and "boarding nights" not in html and "nights" not in html
    assert "$35.00" in subject
