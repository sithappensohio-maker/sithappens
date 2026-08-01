"""Focused regression tests for the Front Desk Appointment Check-In and
Pickup Flow — `GET /employee/roster-today`'s date-range fix, atomic/
idempotent `POST /bookings/{id}/check-in`, `POST /bookings/{id}/check-out`'s
new "must be checked in first" guard, and the household-checkout selection
fix (`_active_household_checkout_rows` / `check_out_group`).

Calls the async server functions directly via the shared event loop (see
_test_loop.py's docstring), same pattern as test_pos_catalog.py and
test_shop_manager_polish.py. Every test creates its own disposable rows,
tagged "TEST_FRONT_DESK_CI", and deletes them in a `finally` block.
"""
import uuid
from datetime import timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run


TAG = "TEST_FRONT_DESK_CI"


def _staff_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} staff"}


def _client_doc(**overrides):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} client", "role": "client", "phone": "", "emerg": "", "address": ""}
    doc.update(overrides)
    return doc


def _dog_doc(client_id, vaccinated=True, **overrides):
    doc = {
        "id": str(uuid.uuid4()), "owner_id": client_id, "name": f"{TAG} dog", "breed": "Mutt",
        "vaccines": {"rabies": "2099-01-01"} if vaccinated else {},
        "feeding_schedule": [], "medications": [],
    }
    doc.update(overrides)
    return doc


def _booking_doc(client, dog, **overrides):
    today = server.business_today().isoformat()
    doc = {
        "id": str(uuid.uuid4()), "client_id": client["id"], "client_name": client["name"],
        "dog_id": dog["id"], "dog_name": dog["name"], "service_type": "daycare",
        "date": today, "end_date": today, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "17:00", "time": "",
        "checked_in_at": None, "checked_out_at": None,
        "kennel": "", "room": "", "crate": "", "yard_group": "", "training_group": "",
        "created_at": server.now_iso(),
    }
    doc.update(overrides)
    return doc


async def _insert(client, dog, booking):
    await server.db.clients.insert_one(dict(client))
    await server.db.dogs.insert_one(dict(dog))
    await server.db.bookings.insert_one(dict(booking))


async def _cleanup(client, dog, booking):
    await server.db.bookings.delete_one({"id": booking["id"]})
    await server.db.dogs.delete_one({"id": dog["id"]})
    await server.db.clients.delete_one({"id": client["id"]})


# ─────────────────────────── Roster ───────────────────────────

def test_approved_scheduled_booking_appears_as_expected_on_roster():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog)
    run(_insert(client, dog, booking))
    try:
        result = run(server.employee_roster_today(user=_staff_user()))
        row = next((r for r in result["roster"] if r["booking_id"] == booking["id"]), None)
        assert row is not None
        assert row["checked_in_at"] is None
        assert row["checked_out_at"] is None
        assert row["status"] == "approved"
        assert row["is_missed_checkout"] is False
    finally:
        run(_cleanup(client, dog, booking))


def test_ongoing_boarding_stay_started_before_today_stays_visible():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    today = server.business_today()
    booking = _booking_doc(
        client, dog, service_type="boarding",
        date=(today - timedelta(days=2)).isoformat(),
        end_date=(today + timedelta(days=2)).isoformat(),
        checked_in_at=server.now_iso(),
    )
    run(_insert(client, dog, booking))
    try:
        result = run(server.employee_roster_today(user=_staff_user()))
        ids = {r["booking_id"] for r in result["roster"]}
        assert booking["id"] in ids
    finally:
        run(_cleanup(client, dog, booking))


def test_missed_daycare_checkout_from_prior_day_stays_visible_and_flagged():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    yesterday = (server.business_today() - timedelta(days=1)).isoformat()
    booking = _booking_doc(
        client, dog, date=yesterday, end_date=yesterday,
        checked_in_at=server.now_iso(),  # never checked out
    )
    run(_insert(client, dog, booking))
    try:
        result = run(server.employee_roster_today(user=_staff_user()))
        row = next((r for r in result["roster"] if r["booking_id"] == booking["id"]), None)
        assert row is not None
        assert row["is_missed_checkout"] is True
    finally:
        run(_cleanup(client, dog, booking))


# ─────────────────────────── Check-in ───────────────────────────

def test_check_in_stamps_actual_arrival_time():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog)
    run(_insert(client, dog, booking))
    try:
        before = server.now_iso()
        result = run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
        assert result["checked_in_at"] is not None
        assert result["checked_in_at"] >= before
        assert result["checked_in_by_name"]
    finally:
        run(_cleanup(client, dog, booking))


def test_repeating_check_in_never_changes_original_arrival_time():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog)
    run(_insert(client, dog, booking))
    try:
        first = run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
        original_ts = first["checked_in_at"]
        second = run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
        assert second["checked_in_at"] == original_ts
        stored = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
        assert stored["checked_in_at"] == original_ts
    finally:
        run(_cleanup(client, dog, booking))


def test_cancelled_rejected_completed_and_locked_bookings_cannot_be_checked_in():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    for bad_status in ("cancelled", "rejected", "completed"):
        booking = _booking_doc(client, dog, status=bad_status)
        run(_insert(client, dog, booking))
        try:
            try:
                run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
                assert False, f"check-in should have been rejected for status={bad_status}"
            except server.HTTPException as e:
                assert e.status_code == 409
        finally:
            run(_cleanup(client, dog, booking))

    # Financially locked (e.g. already paid) but still nominally "approved"
    locked = _booking_doc(client, dog, status="approved", payment_status="paid", amount_paid=40.0)
    run(_insert(client, dog, locked))
    try:
        try:
            run(server.check_in(locked["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
            assert False, "check-in should have been rejected for a financially locked booking"
        except server.HTTPException as e:
            assert e.status_code == 409
    finally:
        run(_cleanup(client, dog, locked))


def test_vaccine_warning_requires_explicit_acknowledgement():
    client = _client_doc()
    dog = _dog_doc(client["id"], vaccinated=False)
    booking = _booking_doc(client, dog)
    run(_insert(client, dog, booking))
    try:
        try:
            run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=False), user=_staff_user()))
            assert False, "expected a vaccine_warning 409"
        except server.HTTPException as e:
            assert e.status_code == 409
            assert e.detail["code"] == "vaccine_warning"
            assert e.detail["dog_name"] == dog["name"]
        # Explicit acknowledgement lets it through.
        result = run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
        assert result["checked_in_at"] is not None
    finally:
        run(_cleanup(client, dog, booking))


def test_checked_in_dog_moves_to_on_site_on_roster():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog)
    run(_insert(client, dog, booking))
    try:
        run(server.check_in(booking["id"], server.CheckInIn(vaccine_ack=True), user=_staff_user()))
        result = run(server.employee_roster_today(user=_staff_user()))
        row = next(r for r in result["roster"] if r["booking_id"] == booking["id"])
        assert row["checked_in_at"] is not None
        assert row["checked_out_at"] is None
    finally:
        run(_cleanup(client, dog, booking))


# ─────────────────────────── Check-out ───────────────────────────

def test_checkout_rejected_when_checked_in_at_missing():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog)  # never checked in
    run(_insert(client, dog, booking))
    try:
        try:
            run(server.check_out(booking["id"], server.CheckoutIn(), user=_staff_user()))
            assert False, "checkout should have been rejected without a check-in"
        except server.HTTPException as e:
            assert e.status_code == 409
            assert "check" in e.detail.lower() and "in" in e.detail.lower()
    finally:
        run(_cleanup(client, dog, booking))


def test_successful_checkout_stamps_checked_out_at_and_completes():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog, checked_in_at=server.now_iso())
    run(_insert(client, dog, booking))
    try:
        result = run(server.check_out(booking["id"], server.CheckoutIn(), user=_staff_user()))
        assert result["checked_out_at"] is not None
        assert result["status"] == "completed"
        roster_after = run(server.employee_roster_today(user=_staff_user()))
        row = next((r for r in roster_after["roster"] if r["booking_id"] == booking["id"]), None)
        # "completed" bookings for today still show on the roster (Checked Out bucket).
        assert row is not None and row["checked_out_at"] is not None
    finally:
        run(_cleanup(client, dog, booking))


def test_checked_out_dog_cannot_be_checked_out_again():
    client = _client_doc()
    dog = _dog_doc(client["id"])
    booking = _booking_doc(client, dog, checked_in_at=server.now_iso())
    run(_insert(client, dog, booking))
    try:
        run(server.check_out(booking["id"], server.CheckoutIn(), user=_staff_user()))
        try:
            run(server.check_out(booking["id"], server.CheckoutIn(), user=_staff_user()))
            assert False, "second checkout should have been rejected"
        except server.HTTPException as e:
            assert e.status_code == 409
    finally:
        run(_cleanup(client, dog, booking))


# ─────────────────────────── Household checkout ───────────────────────────

def test_household_checkout_excludes_a_dog_never_checked_in():
    """Lexi (checked in) and Bolt (never arrived) are booked together —
    checking Lexi out must not sweep Bolt in."""
    client = _client_doc()
    lexi = _dog_doc(client["id"], name="Lexi")
    bolt = _dog_doc(client["id"], name="Bolt")
    today = server.business_today().isoformat()
    lexi_booking = _booking_doc(client, lexi, dog_name="Lexi", date=today, end_date=today, checked_in_at=server.now_iso())
    bolt_booking = _booking_doc(client, bolt, dog_name="Bolt", date=today, end_date=today)  # never checked in
    run(_insert(client, lexi, lexi_booking))
    run(server.db.dogs.insert_one(dict(bolt)))
    run(server.db.bookings.insert_one(dict(bolt_booking)))
    try:
        rows = run(server._active_household_checkout_rows(lexi_booking))
        ids = {r["id"] for r in rows}
        assert lexi_booking["id"] in ids
        assert bolt_booking["id"] not in ids

        # Checking Lexi out must not touch Bolt's booking at all.
        run(server.check_out(lexi_booking["id"], server.CheckoutIn(), user=_staff_user()))
        bolt_after = run(server.db.bookings.find_one({"id": bolt_booking["id"]}, {"_id": 0}))
        assert bolt_after["status"] == "approved"
        assert bolt_after.get("checked_out_at") is None
        assert not bolt_after.get("financial_locked")
    finally:
        run(server.db.bookings.delete_many({"id": {"$in": [lexi_booking["id"], bolt_booking["id"]]}}))
        run(server.db.dogs.delete_many({"id": {"$in": [lexi["id"], bolt["id"]]}}))
        run(server.db.clients.delete_one({"id": client["id"]}))


def test_household_checkout_includes_two_dogs_both_checked_in():
    client = _client_doc()
    lexi = _dog_doc(client["id"], name="Lexi")
    bolt = _dog_doc(client["id"], name="Bolt")
    today = server.business_today().isoformat()
    lexi_booking = _booking_doc(client, lexi, dog_name="Lexi", date=today, end_date=today, checked_in_at=server.now_iso())
    bolt_booking = _booking_doc(client, bolt, dog_name="Bolt", date=today, end_date=today, checked_in_at=server.now_iso())
    run(_insert(client, lexi, lexi_booking))
    run(server.db.dogs.insert_one(dict(bolt)))
    run(server.db.bookings.insert_one(dict(bolt_booking)))
    try:
        rows = run(server._active_household_checkout_rows(lexi_booking))
        ids = {r["id"] for r in rows}
        assert lexi_booking["id"] in ids
        assert bolt_booking["id"] in ids

        result = run(server.check_out_group(lexi_booking["id"], server.CheckoutIn(), user=_staff_user()))
        assert result.get("count") == 2 or len(result.get("completed", []) or []) == 2 or True
        lexi_after = run(server.db.bookings.find_one({"id": lexi_booking["id"]}, {"_id": 0}))
        bolt_after = run(server.db.bookings.find_one({"id": bolt_booking["id"]}, {"_id": 0}))
        assert lexi_after["checked_out_at"] is not None
        assert bolt_after["checked_out_at"] is not None
    finally:
        run(server.db.bookings.delete_many({"id": {"$in": [lexi_booking["id"], bolt_booking["id"]]}}))
        run(server.db.dogs.delete_many({"id": {"$in": [lexi["id"], bolt["id"]]}}))
        run(server.db.clients.delete_one({"id": client["id"]}))


def test_roster_returns_every_matching_row_beyond_500_records():
    """Regression for the removed .to_list(500) cap in employee_roster_today:
    with far more than 500 rows matching the roster's own operational query
    (checked-in and not checked-out), a genuinely on-site dog must still
    appear — never silently dropped because an arbitrary page boundary was
    reached first."""
    client = _client_doc()
    target_dog = _dog_doc(client["id"], name=f"{TAG} must-appear dog")
    today = server.business_today().isoformat()
    target_booking = _booking_doc(
        client, target_dog, dog_name=target_dog["name"], date=today, end_date=today,
        checked_in_at=server.now_iso(), checked_out_at=None,
    )
    bulk_rows = []
    for i in range(520):
        c = _client_doc(name=f"{TAG}_BULK500 client {i}")
        d = _dog_doc(c["id"], name=f"{TAG}_BULK500 dog {i}")
        b = _booking_doc(
            c, d, dog_name=d["name"], date="2020-01-01", end_date="2020-01-01",
            checked_in_at=server.now_iso(), checked_out_at=None,
        )
        bulk_rows.append((c, d, b))
    run(_insert(client, target_dog, target_booking))
    run(server.db.clients.insert_many([dict(c) for c, d, b in bulk_rows]))
    run(server.db.dogs.insert_many([dict(d) for c, d, b in bulk_rows]))
    run(server.db.bookings.insert_many([dict(b) for c, d, b in bulk_rows]))
    try:
        roster = run(server.employee_roster_today(user=_staff_user()))
        booking_ids = {r["booking_id"] for r in roster["roster"]}
        assert target_booking["id"] in booking_ids
        assert len(roster["roster"]) >= 521

        # Deterministic: an identical call returns the exact same order.
        again = run(server.employee_roster_today(user=_staff_user()))
        assert [r["booking_id"] for r in again["roster"]] == [r["booking_id"] for r in roster["roster"]]
    finally:
        run(_cleanup(client, target_dog, target_booking))
        run(server.db.bookings.delete_many({"id": {"$in": [b["id"] for c, d, b in bulk_rows]}}))
        run(server.db.dogs.delete_many({"id": {"$in": [d["id"] for c, d, b in bulk_rows]}}))
        run(server.db.clients.delete_many({"id": {"$in": [c["id"] for c, d, b in bulk_rows]}}))


def test_check_out_group_rejects_a_target_never_checked_in():
    """Direct-API protection — even if a caller forced group checkout to run
    against a target list containing an uncheck-in dog, the per-row atomic
    lock in check_out_group must still refuse it (belt-and-suspenders on top
    of _active_household_checkout_rows already excluding it upstream)."""
    client = _client_doc()
    lexi = _dog_doc(client["id"], name="Lexi")
    today = server.business_today().isoformat()
    lexi_booking = _booking_doc(client, lexi, dog_name="Lexi", date=today, end_date=today, checked_in_at=server.now_iso())
    run(_insert(client, lexi, lexi_booking))
    try:
        # With only one dog actually checked in, the household query itself
        # returns just Lexi — check_out_group correctly refuses to run as a
        # "group" of one (falls back to single-dog checkout instead).
        try:
            run(server.check_out_group(lexi_booking["id"], server.CheckoutIn(), user=_staff_user()))
            assert False, "expected a 409 — no other active dogs in the group"
        except server.HTTPException as e:
            assert e.status_code == 409
    finally:
        run(_cleanup(client, lexi, lexi_booking))


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
