"""The boarding checkout screen shows the price the stay was booked at, which is
what checkout saves and receipts (audit #2: "Boarding checkout screen shows
today's catalogue price, but the app records the price the stay was booked
at"). The discount preview used to price the stay at today's default boarding
rate. Disposable tag TEST_BOARD_PREVIEW."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_BOARD_PREVIEW"
BOOKED = 45.0
TODAY_RATE = 50.0
NIGHTS = 2


@pytest.fixture()
def stay():
    svc_id = f"{TAG}-svc-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": svc_id, "name": f"{TAG} Boarding", "service_type": "boarding",
                                       "base_price": TODAY_RATE, "active": True, "is_default": True}))
    bid = f"{TAG}-b-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": f"{TAG}-client", "dog_id": f"{TAG}-dog", "dog_name": TAG,
        "service_type": "boarding", "date": "2026-09-30", "end_date": "2026-10-02", "status": "checked_in",
        "unit_price": BOOKED, "estimated_price": BOOKED * NIGHTS, "actual_price": 0,
        "pricing_snapshot": {"unit_price": BOOKED}, "checked_in_at": server.now_iso(), "created_at": server.now_iso()}))
    yield bid
    run(server.db.bookings.delete_many({"id": bid}))
    run(server.db.services.delete_many({"id": svc_id}))


def test_the_checkout_preview_prices_a_stay_at_the_rate_it_was_booked(stay):
    out = run(server.discount_preview(stay, {"id": "admin", "role": "admin"}))
    assert out["preview_base_price"] == BOOKED * NIGHTS, "the booked rate, not today's catalogue rate"


def test_the_preview_is_what_checkout_would_charge(stay):
    booking = run(server.db.bookings.find_one({"id": stay}, {"_id": 0}))
    settings = run(server.get_settings())
    charged = run(server._boarding_auto_base(booking, settings))
    out = run(server.discount_preview(stay, {"id": "admin", "role": "admin"}))
    assert out["preview_base_price"] == round(charged, 2)
