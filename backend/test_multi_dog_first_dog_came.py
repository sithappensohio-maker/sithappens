"""The multi-dog discount follows the dogs that actually came.

Audit finding (2026-09-25): a family books two dogs together; the first dog
pays full price and the extra dog gets the multi-dog discount (and half a
credit). Who was "first" was fixed at booking time, so when the full-price
dog cancelled or never came, the dog that did come was still checked out at
the extra-dog price.

Owner's rule: the discount applies only when another dog from the same
booking actually came (was checked in). The first dog that came pays full
price; any others that came keep the discount.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_FIRST_DOG_CAME"
ADMIN = {"id": "fdc-admin", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
PRICE = 40.0


class _OpenRegisterDay:
    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-{uuid.uuid4()}"
        self.created = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {"date": self.date, "opening_cash": 100.0, "opened_at": server.now_iso(),
                              "opened_by": self.marker, "opened_by_name": TAG}},
            upsert=True, projection={"_id": 0})) is None
        return self

    def __exit__(self, *exc):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


@contextlib.contextmanager
def _family(dogs=2):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com"}))
    dog_ids = []
    for i in range(dogs):
        did = str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog {i}", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}))
        dog_ids.append(did)
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": PRICE, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=d) for d in dog_ids],
                                 date=server.business_today().isoformat(), service_type="daycare",
                                 service_id=svc["id"], override_capacity=True, override_vaccines=True)
    out = run(server.create_booking_group(body, ADMIN))
    rows = sorted(out["bookings"], key=lambda b: (b.get("pricing_snapshot") or {}).get("group_dog_index") or 0)
    try:
        yield cid, [r["id"] for r in rows]
    finally:
        for coll in ("bookings", "invoices", "payment_ledger", "retail_sales", "credit_lots", "checkout_groups"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.dogs.delete_many({"owner_id": cid}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _arrive(bid):
    """Checked in eight hours ago (a full day — no half-day pricing)."""
    run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": earlier}}))


def _out(bid, **pay):
    with _OpenRegisterDay():
        run(server.check_out(bid, server.CheckoutIn(**(pay or {"payment_method": "card", "payment_status": "paid"})), user=ADMIN))
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def test_both_dogs_came_the_second_keeps_the_discount():
    with _family() as (_cid, (first, second)):
        _arrive(first)
        _arrive(second)
        assert _out(second)["actual_price"] == PRICE / 2
        assert _out(first)["actual_price"] == PRICE


def test_the_full_price_dog_cancelled_so_the_dog_that_came_pays_full():
    with _family() as (_cid, (first, second)):
        run(server.cancel_booking(first, False, ADMIN))
        _arrive(second)
        done = _out(second)
        assert done["actual_price"] == PRICE
        assert done["multi_dog_discount_released"]["reason"]
        assert not (done.get("multi_dog_discount") or {}).get("pre_applied")


def test_the_full_price_dog_never_came_so_the_dog_that_came_pays_full():
    with _family() as (_cid, (first, second)):
        _arrive(second)          # the first dog is still booked but never checked in
        assert _out(second)["actual_price"] == PRICE


def test_three_dogs_first_cancelled_one_pays_full_and_one_keeps_the_discount():
    with _family(dogs=3) as (_cid, (first, second, third)):
        run(server.cancel_booking(first, False, ADMIN))
        _arrive(third)
        # The third dog leaves before the second arrives: nobody ahead of it
        # has come, so it pays full ...
        assert _out(third)["actual_price"] == PRICE
        # ... and the second, arriving later, is now the extra dog.
        _arrive(second)
        assert _out(second)["actual_price"] == PRICE / 2


def test_a_dog_that_came_alone_uses_a_full_credit():
    with _family() as (cid, (first, second)):
        run(server.cancel_booking(first, False, ADMIN))
        _arrive(second)
        run(server.db.credit_lots.insert_one({
            "id": str(uuid.uuid4()), "client_id": cid, "service_type": "daycare", "pack_name": f"{TAG} pack",
            "qty_total": 5, "qty_remaining": 5, "value_each": PRICE, "recognize_at_sale": True,
            "purchased_at": server.now_iso()}))
        run(server.db.clients.update_one({"id": cid}, {"$set": {"credits": 5}}))
        done = _out(second, payment_method="credits", use_credits=True)
        assert float(done.get("credits_deducted") or 0) == 1.0


def test_the_checkout_preview_shows_the_price_that_will_be_charged():
    with _family() as (_cid, (first, second)):
        run(server.cancel_booking(first, False, ADMIN))
        _arrive(second)
        preview = run(server.checkout_group_preview(second, ADMIN))
        assert preview["combined_total"] == PRICE
        stored = run(server.db.bookings.find_one({"id": second}, {"_id": 0}))
        assert (stored.get("multi_dog_discount") or {}).get("pre_applied")  # a preview never saves anything
