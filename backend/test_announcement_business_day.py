"""An announcement with an end date stays up through that business day (audit #65:
"Announcements with an end date disappear from the portal about 4-5 hours early").
The comparison is on the Ohio day, not the UTC day, which runs a day ahead in the
evening. Pure: no database."""
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import server


def test_an_announcement_is_still_up_on_its_last_business_day(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: date(2026, 10, 4))
    assert server._ann_visible_today({"published": True, "expires_on": "2026-10-04"}) is True


def test_an_announcement_is_gone_the_day_after_its_end_date(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: date(2026, 10, 5))
    assert server._ann_visible_today({"published": True, "expires_on": "2026-10-04"}) is False
