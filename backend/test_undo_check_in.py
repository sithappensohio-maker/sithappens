"""Undo a check-in made by mistake, keeping the booking
(domains/bookings/undo_check_in.py). Uses the real check-in and checkout.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException
from test_late_day_checkout import ADMIN  # noqa: F401 — shared helper
from test_pos_checkout_integrity import _open_register_day

TAG = "TEST_UNDO_CHECK_IN"
BATH = {"service_id": "svc-bath", "name": "Bath", "price": 15.0, "qty": 1, "added_at": "2026-11-25T10:00:00+00:00"}


@contextlib.contextmanager
def _visit(**extra):
    fam, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    today = server.business_today().isoformat()
    run(server.db.clients.insert_one({"id": fam, "name": f"{TAG} family", "email": f"{fam}@example.com",
                                      "credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": fam, "name": "Rex", "vaccines": {"rabies": "2099-01-01"}}))
    doc = {"id": bid, "client_id": fam, "client_name": f"{TAG} family", "dog_id": did, "dog_name": "Rex",
           "service_type": "daycare", "date": today, "end_date": today, "status": "approved", "notes": "bring lunch",
           "estimated_price": 55.0, "unit_price": 40.0, "pricing_snapshot": {"unit_price": 40.0},
           "credit_units_required": 1, "checked_out_at": None, "created_at": server.now_iso(), "add_ons": [dict(BATH)], **extra}
    run(server.db.bookings.insert_one(dict(doc)))
    try:
        yield bid
    finally:
        async def tidy():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events"):
                await server.db[c].delete_many({"client_id": fam})
            await server.db.dogs.delete_many({"owner_id": fam})
            await server.db.clients.delete_many({"id": fam})
        run(tidy())


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _refused(fn, status):
    try:
        fn()
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e
    raise AssertionError(f"expected a {status} refusal")


def test_undo_puts_the_dog_back_to_expected_and_keeps_the_booking_as_it_was():
    with _visit() as bid:
        before = _row(bid)
        run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
        assert _row(bid)["checked_in_at"]
        out = run(server.undo_check_in(bid, ADMIN))
        after = _row(bid)
        assert not after.get("checked_in_at") and not after.get("checked_in_by") and not out.get("checked_in_at")
        # Everything else about the booking is untouched.
        for key in ("status", "date", "end_date", "estimated_price", "add_ons", "notes", "credit_units_required", "client_id", "dog_id"):
            assert after[key] == before[key], key
        # A record of the mistaken check-in is kept.
        rec = after["check_in_undone"]
        assert rec["checked_in_at"] and rec["by"] == ADMIN["id"] and rec["at"]
        # The dog can be checked in again, and then checked out normally.
        run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
        assert _row(bid)["checked_in_at"]
        with _open_register_day():
            done = run(server.check_out(bid, server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
        # (A dog checked in a moment ago is a half day: $20 + the $15 bath.)
        assert done["status"] == "completed" and done["actual_price"] == 35.0
        assert done["checked_in_at"] and done["checked_out_at"]


def test_a_second_tap_changes_nothing():
    with _visit() as bid:
        run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
        run(server.undo_check_in(bid, ADMIN))
        first = _row(bid)["check_in_undone"]
        run(server.undo_check_in(bid, ADMIN))
        assert _row(bid)["check_in_undone"] == first
    with _visit() as bid:   # never checked in at all: still nothing to do, no error
        out = run(server.undo_check_in(bid, ADMIN))
        assert not out.get("checked_in_at") and "check_in_undone" not in _row(bid)


def test_it_is_refused_once_the_visit_is_checked_out_reopened_or_has_money_on_it():
    with _visit() as bid, _open_register_day():
        run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
        run(server.check_out(bid, server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
        e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
        assert "already been checked out" in e.detail
    with _visit(checked_in_at="2026-11-25T13:00:00+00:00", financial_reopened_at="2026-11-25T15:00:00+00:00") as bid:
        e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
        assert "reopened" in e.detail and _row(bid)["checked_in_at"]
    with _visit(checked_in_at="2026-11-25T13:00:00+00:00", amount_paid=20.0, payment_status="paid_partial") as bid:
        e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
        assert "Money has already been recorded" in e.detail and _row(bid)["checked_in_at"]
    with _visit(status="cancelled", checked_in_at=None) as bid:
        _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
    _refused(lambda: run(server.undo_check_in("no-such-booking", ADMIN)), 404)


def test_only_staff_who_may_check_in_may_undo_it():
    with _visit(checked_in_at="2026-11-25T13:00:00+00:00") as bid:
        nobody = {"id": "x", "role": "employee", "staff_role": "read_only", "permissions": {}}
        _refused(lambda: run(server.undo_check_in(bid, nobody)), 403)
        assert _row(bid)["checked_in_at"]


def test_paid_addons_and_credits_bought_at_drop_off_are_left_alone():
    paid_bath = {**BATH, "name": "Bath (paid online)", "price": 0.0, "line_total": 0.0, "paid_online": True,
                 "prepaid_amount": 15.0, "prepaid_order_id": "order-1", "prepaid_ref": "shop_order:order-1:item:line-1"}
    with _visit(add_ons=[paid_bath], estimated_price=40.0) as bid:
        fam = _row(bid)["client_id"]
        run(server.db.clients.update_one({"id": fam}, {"$set": {"credits": 1}}))
        run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), ADMIN))
        run(server.undo_check_in(bid, ADMIN))
        after = _row(bid)
        assert after["add_ons"] == [paid_bath] and after["estimated_price"] == 40.0
        assert run(server.db.clients.find_one({"id": fam}, {"_id": 0}))["credits"] == 1


def test_a_visit_from_an_earlier_day_is_checked_out_not_un_checked_in():
    from datetime import timedelta
    yesterday = (server.business_today() - timedelta(days=1)).isoformat()
    with _visit(date=yesterday, end_date=yesterday, checked_in_at=f"{yesterday}T13:00:00+00:00") as bid:
        e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
        assert "earlier day" in e.detail and "Check Rex out instead" in e.detail
        assert _row(bid)["checked_in_at"], "still on the Front Desk list, where it can be checked out"
    # A boarding dog part-way through a stay that has not ended can still be undone.
    start = (server.business_today() - timedelta(days=1)).isoformat()
    end = (server.business_today() + timedelta(days=2)).isoformat()
    with _visit(service_type="boarding", date=start, end_date=end, checked_in_at=f"{start}T13:00:00+00:00") as bid:
        run(server.undo_check_in(bid, ADMIN))
        assert not _row(bid).get("checked_in_at")


def test_a_prepaid_session_whose_lesson_was_recorded_cannot_be_undone():
    with _visit(service_type="training", is_prepaid_program_session=True, payment_status="paid", actual_price=0,
                checked_in_at=server.now_iso()) as bid:
        run(server.undo_check_in(bid, ADMIN))        # no lesson recorded yet: fine
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": server.now_iso()}}))
        log_id = str(uuid.uuid4())
        run(server.db.training_session_log.insert_one({"id": log_id, "booking_id": bid}))
        try:
            e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
            assert "already recorded" in e.detail and _row(bid)["checked_in_at"]
        finally:
            run(server.db.training_session_log.delete_one({"id": log_id}))


def test_it_waits_for_a_checkout_that_is_in_progress():
    from datetime import datetime, timedelta, timezone
    fresh = datetime.now(timezone.utc).isoformat()
    old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    with _visit(checked_in_at=server.now_iso(), checkout_in_progress=True, checkout_started_at=fresh) as bid:
        e = _refused(lambda: run(server.undo_check_in(bid, ADMIN)), 409)
        assert "being checked out right now" in e.detail and _row(bid)["checked_in_at"]
    # A hold left behind by a checkout that died long ago does not block it for ever.
    with _visit(checked_in_at=server.now_iso(), checkout_in_progress=True, checkout_started_at=old) as bid:
        run(server.undo_check_in(bid, ADMIN))
        assert not _row(bid).get("checked_in_at")


def test_the_audit_log_names_it():
    assert server._audit_action_for("POST", "/api/bookings/abc/undo-check-in") == "booking_check_in_undone"
    assert server._audit_action_for("POST", "/api/bookings/abc/check-in") == "booking_checked_in"
    assert "booking_check_in_undone" in server.AUDIT_ACTION_GROUPS["bookings"]
