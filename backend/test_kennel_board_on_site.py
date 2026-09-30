"""The Kennel Board shows the dogs actually here (audit #46).

It hid a dog only when it was checked out "today" by the UTC date, so a stay
picked up early (or after 8 PM Eastern) stayed in its suite on the board, and
a dog nobody checked out after its stay ended vanished though it was still
here. It now uses the Care Board's rule (domains/bookings/spans.on_site).

Disposable tag TEST_KENNEL_ON_SITE.
"""
import json
import uuid
from datetime import datetime, time, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import care as care_domain

TAG = "TEST_KENNEL_ON_SITE"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "kennel-on-site@test"}
TODAY = server.business_today()


def _day(n):
    return (TODAY + timedelta(days=n)).isoformat()


def _stay(**extra):
    b = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "dog_id": f"{TAG}-dog-{uuid.uuid4().hex[:4]}", "dog_name": "Rex",
         "client_id": f"{TAG}-client", "client_name": f"{TAG} Family", "service_type": "boarding", "status": "approved",
         "date": _day(-2), "end_date": _day(2), "created_at": server.now_iso(), **extra}
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _board():
    return json.dumps(run(server.get_kennel_board(ADMIN)))


def _card(bid):
    board = run(server.get_kennel_board(ADMIN))
    return next((c for cards in board["groups"].values() for c in cards if c["booking_id"] == bid), None)


def teardown_module(_m):
    run(server.db.bookings.delete_many({"id": {"$regex": f"^{TAG}"}}))


def test_a_stay_picked_up_early_on_an_earlier_day_is_off_the_board():
    b = _stay(checked_in_at=f"{_day(-2)}T14:00:00+00:00", checked_out_at=f"{_day(-1)}T15:00:00+00:00", status="completed")
    assert b["id"] not in _board()


def test_an_evening_pickup_is_off_the_board_though_its_utc_stamp_is_tomorrow():
    evening = datetime.combine(TODAY, time(20, 30), tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc)
    assert evening.date().isoformat() != TODAY.isoformat(), "8:30 PM Eastern is already tomorrow in UTC"
    b = _stay(checked_in_at=f"{_day(-2)}T14:00:00+00:00", checked_out_at=evening.isoformat(), status="completed")
    assert b["id"] not in _board()


def test_a_dog_nobody_checked_out_after_its_stay_is_still_on_the_board_and_flagged():
    b = _stay(service_type="daycare", date=_day(-1), end_date=None, checked_in_at=f"{_day(-1)}T12:00:00+00:00")
    card = _card(b["id"])
    assert card is not None and card["warnings"]["missed_checkout"] is True and card["end_date"] == _day(-1)
    care = run(care_domain.care_board_today())
    assert care["on_site_count"] >= 1   # the Care Board keeps it too (same rule)


def test_dogs_booked_for_today_stay_on_the_board_arrived_or_not():
    expected = _stay(service_type="daycare", date=_day(0), end_date=None)
    arrived = _stay(checked_in_at=f"{_day(-2)}T14:00:00+00:00")
    for b in (expected, arrived):
        card = _card(b["id"])
        assert card is not None and card["warnings"]["missed_checkout"] is False


def test_a_dog_checked_out_earlier_today_is_off_the_board():
    b = _stay(checked_in_at=f"{_day(-2)}T14:00:00+00:00", checked_out_at=server.now_iso(), status="completed")
    assert b["id"] not in _board()


def test_the_rule_in_one_place():
    from domains.bookings import spans
    today = TODAY.isoformat()
    assert spans.on_site({"date": _day(-1), "end_date": _day(1)}, today) == "here"
    assert spans.on_site({"date": _day(-1), "end_date": _day(1), "checked_out_at": "x"}, today) is None
    assert spans.on_site({"date": _day(-3), "end_date": _day(-1), "checked_in_at": "x"}, today) == "missed_checkout"
    assert spans.on_site({"date": _day(-3), "end_date": _day(-1)}, today) is None, "never came: not here"
