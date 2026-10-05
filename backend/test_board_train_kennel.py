"""A residential Board & Train dog takes a kennel, so it counts against the kennel limit
and the boarding cap (audit #45: "Board & Train dogs don't take up a boarding spot or
their kennel"). A boarding dog cannot be given that kennel on the same nights. Far-future
dates. Disposable tag TEST_BT_KENNEL."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_BT_KENNEL"
START = date(2031, 3, 5)
END = date(2031, 3, 7)


@pytest.fixture()
def residential_board_train(monkeypatch):
    bid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({"id": bid, "dog_id": f"{TAG}-d1", "date": START.isoformat(),
                                       "end_date": END.isoformat(), "service_type": "training", "status": "approved",
                                       "kennel": "Suite A", "tag": TAG}))
    yield bid
    run(server.db.bookings.delete_many({"tag": TAG}))


def test_a_boarding_dog_cannot_take_a_kennel_a_board_and_train_dog_is_in(residential_board_train):
    body = server.BookingIn(dog_id=f"{TAG}-d2", date=START.isoformat(), end_date=END.isoformat(),
                            service_type="boarding", kennel="Suite A")
    with pytest.raises(HTTPException):
        run(server._assert_capacity_available(body, {}, None))
