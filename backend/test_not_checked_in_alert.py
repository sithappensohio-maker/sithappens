"""The 'dogs booked today not checked in' alert counts only dogs whose drop-off time has
passed, on the business clock (audit #82). An afternoon drop-off is not late at 10:30.
Uses a far-future business date so no other test's bookings can match. Disposable tag
TEST_NOT_IN."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_NOT_IN"
DAY = date(2031, 3, 5)
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


@pytest.fixture()
def day(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: DAY)
    monkeypatch.setattr(server, "now_local", lambda: server.datetime(2031, 3, 5, 10, 30))
    rows = [{"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "date": DAY.isoformat(), "status": "approved",
             "checked_in_at": None, "dog_name": name, "dropoff_time": drop, "tag": TAG}
            for name, drop in (("Morning", "09:00"), ("Afternoon", "14:00"))]
    run(server.db.bookings.insert_many(rows))
    yield
    run(server.db.bookings.delete_many({"tag": TAG}))


def _no_checkin_title(out):
    for it in out.get("items", []):
        if it.get("kind") == "no_checkin":
            return it["title"]
    return None


def test_only_the_dog_whose_drop_off_has_passed_is_counted(day):
    out = run(server.admin_today_brain(ADMIN))
    assert _no_checkin_title(out) == "1 dog booked today not yet checked in"
