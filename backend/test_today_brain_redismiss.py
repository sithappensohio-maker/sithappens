"""Today's tasks: a dismissed to-do comes back on the next business day.

Before this fix the count-keyed kinds (booking_pending, contact_inquiry, ...)
signed themselves with only the digits from the title, so a dismissal never
expired while the count stayed the same, and a to-do the owner hid on Monday
was still hidden on Friday. The signature now carries the business date, the
same way the date-scoped kinds already do. The item id is unchanged.

Also covers the un-hide side: the feed lists the dismissed items under
`hidden` so Today and the Action Center can offer an un-hide control that
calls the existing restore endpoint.

In-process, like the other ad hoc backend tests: business_today is
monkeypatched to move the business day forward.
"""
import uuid
from datetime import date

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_TODAY_REDISMISS"
DAY1 = date(2026, 10, 6)
DAY2 = date(2026, 10, 7)


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin",
            "email": f"{TAG.lower()}@example.com"}


def _feed():
    return run(server.admin_today_brain(_=_admin_user()))


def _find(feed, item_id):
    return next((it for it in feed["items"] if it["id"] == item_id), None)


def _dismiss(item):
    return run(server.admin_today_brain_dismiss(
        server.TodayBrainDismissIn(item_id=item["id"], signature=item["signature"]),
        user=_admin_user(),
    ))


@pytest.fixture
def pending_booking():
    """One booking awaiting approval so a booking_pending item is on the feed."""
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "status": "pending", "client_name": TAG, "dog_name": TAG,
        "service_type": "boarding", "date": "2026-10-20", "end_date": "2026-10-21",
    }))
    yield bid
    run(server.db.bookings.delete_one({"id": bid}))
    run(server.db.task_dismissals.delete_many({"dismissed_by": _admin_user()["email"]}))


def test_count_signature_changes_when_the_business_day_changes(monkeypatch):
    item = {"kind": "booking_pending", "title": "2 booking requests awaiting approval",
            "subtitle": "Tap to open the Bookings queue"}
    monkeypatch.setattr(server, "business_today", lambda: DAY1)
    sig_day1 = server._today_brain_signature(item)
    monkeypatch.setattr(server, "business_today", lambda: DAY2)
    sig_day2 = server._today_brain_signature(item)
    assert sig_day1 != sig_day2, "a dismissal must not outlive its business day"


def test_count_signature_still_changes_when_the_count_changes(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: DAY1)
    two = server._today_brain_signature(
        {"kind": "booking_pending", "title": "2 booking requests awaiting approval", "subtitle": ""})
    three = server._today_brain_signature(
        {"kind": "booking_pending", "title": "3 booking requests awaiting approval", "subtitle": ""})
    assert two != three


def test_dismissed_count_item_reappears_on_the_next_business_day(monkeypatch, pending_booking):
    monkeypatch.setattr(server, "business_today", lambda: DAY1)
    item = _find(_feed(), f"booking-pending:{_count_pending()}")
    assert item is not None, "the pending booking must surface on the feed"

    _dismiss(item)
    assert _find(_feed(), item["id"]) is None, "hidden for the rest of the same business day"

    monkeypatch.setattr(server, "business_today", lambda: DAY2)
    back = _find(_feed(), item["id"])
    assert back is not None, "a dismissed to-do must come back the next business day"
    assert back["id"] == item["id"], "the item id must not change"


def test_dismissed_items_are_listed_as_hidden_until_restored(monkeypatch, pending_booking):
    monkeypatch.setattr(server, "business_today", lambda: DAY1)
    item = _find(_feed(), f"booking-pending:{_count_pending()}")
    assert item is not None

    _dismiss(item)
    feed = _feed()
    assert _find(feed, item["id"]) is None
    hidden_ids = [h["id"] for h in feed.get("hidden", [])]
    assert item["id"] in hidden_ids, "a dismissed item must be listed under `hidden` so it can be un-hidden"

    run(server.admin_today_brain_restore(
        server.TodayBrainDismissIn(item_id=item["id"]), _=_admin_user()))
    feed = _feed()
    assert _find(feed, item["id"]) is not None, "restore brings the item back straight away"
    assert item["id"] not in [h["id"] for h in feed.get("hidden", [])]


def _count_pending():
    return run(server.db.bookings.count_documents({"status": "pending"}))
