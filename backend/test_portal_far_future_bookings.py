"""A client's My Bookings lists every upcoming booking, however far ahead.

Audit finding (2026-09-25): the portal reads GET /bookings with no range, and
the default window stopped 90 days ahead. Holiday boarding booked in
September, or regular days booked far ahead, were invisible — the client
couldn't see or cancel them, while the duplicate-booking refusal told them to
"see My Bookings". The business-wide default window (staff Bookings screen)
keeps its 90-day bound.
"""
import uuid
from datetime import timedelta

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_FAR_FUTURE"
ADMIN = {"id": "far-admin", "role": "admin", "name": "Pat Owner"}


@pytest.fixture()
def family():
    cid = str(uuid.uuid4())
    user = {"id": f"u-{cid}", "role": "client", "client_id": cid, "name": "Dana"}
    today = server.business_today()
    rows = []
    for days, label in ((5, "soon"), (120, "holiday"), (400, "next-year")):
        start = today + timedelta(days=days)
        rows.append({"id": f"{label}-{uuid.uuid4()}", "dog_id": "dog-x", "dog_name": "Biscuit", "client_id": cid,
                     "client_name": f"{TAG} Owner", "service_type": "boarding", "status": "approved",
                     "date": start.isoformat(), "end_date": (start + timedelta(days=3)).isoformat(),
                     "created_at": server.now_iso()})
    run(server.db.bookings.insert_many([dict(r) for r in rows]))
    yield user, {r["id"].split("-")[0]: r["id"] for r in rows}
    run(server.db.bookings.delete_many({"client_id": cid}))


def _ids(items):
    return {b["id"] if isinstance(b, dict) else b.id for b in items}


def test_my_bookings_shows_holiday_boarding_months_ahead(family):
    user, ids = family
    listed = _ids(run(server.list_bookings(user=user)))
    assert {ids["soon"], ids["holiday"], ids["next"]} <= listed


def test_the_business_wide_list_keeps_its_window(family):
    _user, ids = family
    listed = _ids(run(server.list_bookings(user=ADMIN)))
    assert ids["soon"] in listed and ids["holiday"] not in listed
