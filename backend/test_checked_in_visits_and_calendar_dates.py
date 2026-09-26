"""A dog on site leaves by checkout; a calendar move can't invent end dates.

A. A visit whose dog was checked in and not checked out could be cancelled,
   declined, marked a no-show or completed from Income. Every on-site screen
   (End of Day, Care Board, Kennel Board, roster) then dropped a dog that was
   still here. Now each refuses with what to do (check out), the write only
   lands if nobody checked the dog in meanwhile, and a check-in made by
   mistake is taken back explicitly — and recorded — by a staff cancel.

B. The Schedule calendar sent `end − 1 day` as the end date for every event
   it moved: a timed lesson ended the day before it started (missed
   checkout, urgent "may be stuck", a past visit in the portal) and a
   stretched lesson became a multi-day stay. Now only a stay (boarding,
   Board & Train) carries an end date, a stay needs its pickup after its
   drop-off and keeps its length when moved, and a checked-in visit can't
   start after today.
"""
import os
import uuid
from datetime import timedelta

import pymongo
import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ONSITE_CAL"
ADMIN = {"id": "onsite-admin", "role": "admin", "name": "Pat Owner", "email": "onsite-admin@example.com"}
CLIENT_ID = "onsite-client"
CLIENT = {"id": "onsite-client-user", "role": "client", "client_id": CLIENT_ID, "name": "Dana"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    run(server.db.clients.update_one({"id": CLIENT_ID}, {"$set": {"name": f"{TAG} Owner", "credits": 0}}, upsert=True))
    yield
    ids = [b["id"] for b in run(server.db.bookings.find({"client_name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(None))]
    run(server.db.bookings.delete_many({"id": {"$in": ids}}))
    run(server.db.payment_ledger.delete_many({"booking_id": {"$in": ids}}))
    run(server.db.booking_financial_events.delete_many({"booking_id": {"$in": ids}}))
    run(server.db.clients.delete_many({"id": CLIENT_ID}))
    run(server.db.services.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.programs.delete_many({"name": {"$regex": f"^{TAG}"}}))


def _today():
    return server.business_today()


def _visit(service="daycare", start=None, end=None, checked_in=True, **over):
    start = start or _today()
    b = {
        "id": str(uuid.uuid4()), "dog_id": f"dog-{uuid.uuid4()}", "dog_name": "Biscuit",
        "client_id": CLIENT_ID, "client_name": f"{TAG} Owner", "service_type": service, "status": "approved",
        "date": start.isoformat(), "end_date": end.isoformat() if end else None,
        "checked_in_at": server.now_iso() if checked_in else None, "checked_out_at": None,
        "checked_in_by": "staff-1", "created_at": server.now_iso(),
    }
    b.update(over)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _get(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _refused(coro):
    with pytest.raises(HTTPException) as err:
        run(coro)
    return err.value


# ───────────────────────────────────────── A. a dog on site leaves by checkout

def test_staff_cancel_of_a_checked_in_dog_says_to_check_out():
    b = _visit()
    err = _refused(server.cancel_booking(b["id"], False, ADMIN))
    assert err.status_code == 409 and "Check out" in err.detail
    assert err.block["code"] == "checked_in" and err.block["action"] == "undo_check_in"
    now = _get(b["id"])
    assert now["status"] == "approved" and now["checked_in_at"]


def test_a_mistaken_check_in_is_taken_back_and_recorded_by_the_cancel():
    b = _visit()
    run(server.cancel_booking(b["id"], False, ADMIN, True))
    now = _get(b["id"])
    assert now["status"] == "cancelled"
    assert not now.get("checked_in_at") and not now.get("checked_in_by")
    assert now["check_in_undone"]["checked_in_at"] == b["checked_in_at"]
    assert now["check_in_undone"]["by"] == ADMIN["id"]


def test_a_mistaken_check_in_can_still_take_the_cancellation_charge():
    b = _visit(actual_price=40.0)
    out = run(server.cancel_booking(b["id"], True, ADMIN, True))
    now = _get(b["id"])
    assert now["status"] == "cancelled" and now["cancellation_charged"] is True and out["cancellation_fee"] >= 0
    assert not now.get("checked_in_at")


def test_a_client_cannot_cancel_a_visit_while_the_dog_is_here():
    b = _visit(start=_today() + timedelta(days=5), end=_today() + timedelta(days=8), service="boarding")
    for undo in (False, True):
        err = _refused(server.cancel_booking(b["id"], False, CLIENT, undo))
        assert err.status_code == 409 and err.block["action"] == "contact_us"
    assert _get(b["id"])["status"] == "approved"


def test_a_visit_not_checked_in_cancels_as_before():
    b = _visit(checked_in=False)
    run(server.cancel_booking(b["id"], False, ADMIN))
    assert _get(b["id"])["status"] == "cancelled"


def _check_in_behind_the_cancel(monkeypatch, bid):
    """Check the dog in just after the cancel read the visit (as a second
    screen would), by hooking the timestamp the cancel takes next."""
    raw = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    real = server.now_iso
    fired = []

    def now_iso():
        if not fired:
            fired.append(1)
            raw.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": real(), "checked_in_by": "staff-2"}})
        return real()
    monkeypatch.setattr(server, "now_iso", now_iso)


def test_a_check_in_landing_during_a_cancel_wins(monkeypatch):
    b = _visit(checked_in=False)
    _check_in_behind_the_cancel(monkeypatch, b["id"])
    err = _refused(server.cancel_booking(b["id"], False, ADMIN))
    assert err.status_code == 409 and err.block["code"] == "checked_in"
    now = _get(b["id"])
    assert now["status"] == "approved" and now["checked_in_at"]


def test_a_check_in_landing_during_a_charged_cancel_leaves_no_charge(monkeypatch):
    b = _visit(checked_in=False, actual_price=60.0)
    balance = run(server.db.clients.find_one({"id": CLIENT_ID}, {"_id": 0, "account_balance": 1})).get("account_balance") or 0
    _check_in_behind_the_cancel(monkeypatch, b["id"])
    err = _refused(server.cancel_booking(b["id"], True, ADMIN))
    assert err.status_code == 409
    now = _get(b["id"])
    assert now["status"] == "approved" and now["checked_in_at"] and not now.get("cancellation_charged")
    assert run(server.db.payment_ledger.count_documents({"booking_id": b["id"]})) == 0
    after = run(server.db.clients.find_one({"id": CLIENT_ID}, {"_id": 0, "account_balance": 1})).get("account_balance") or 0
    assert after == balance


def test_declining_a_checked_in_visit_is_refused():
    b = _visit()
    err = _refused(server.reject_booking(b["id"], ADMIN))
    assert err.status_code == 409 and err.block["action"] == "check_out"
    assert _get(b["id"])["status"] == "approved"
    p = _visit(checked_in=False, status="pending")
    run(server.reject_booking(p["id"], ADMIN))
    assert _get(p["id"])["status"] == "rejected"


def test_income_cannot_complete_a_visit_while_the_dog_is_here():
    b = _visit(service_id="svc-x", actual_price=30.0)
    err = _refused(server.update_transaction(b["id"], server.TransactionUpdateIn(payment_status="paid"), ADMIN))
    assert err.status_code == 409 and "Check Biscuit out" in err.detail
    now = _get(b["id"])
    assert now["status"] == "approved" and not now.get("payment_status")


def test_a_photo_special_guest_who_was_checked_in_is_not_a_no_show():
    b = _visit(service="photography", photo_special_id="ps-onsite", time="10:00")
    err = _refused(server.admin_mark_no_show("ps-onsite", b["id"], ADMIN))
    assert err.status_code == 409 and "can't be a no-show" in err.detail
    assert _get(b["id"])["status"] == "approved"
    gone = _visit(service="photography", photo_special_id="ps-onsite", checked_in=False, time="10:15")
    run(server.admin_mark_no_show("ps-onsite", gone["id"], ADMIN))
    assert _get(gone["id"])["status"] == "cancelled"


# ───────────────────────────────────────── B. only a stay carries an end date

def _move(b, date, end=None):
    return run(server.reschedule_booking(b["id"], server.RescheduleIn(date=date.isoformat(), end_date=end.isoformat() if end else None), ADMIN))


def test_a_timed_lesson_dragged_to_a_day_keeps_no_end_date():
    t = _today() + timedelta(days=10)
    b = _visit(service="training", start=t, checked_in=False, time="10:30")
    new = t + timedelta(days=2)
    _move(b, new, new - timedelta(days=1))      # what the old calendar sent
    now = _get(b["id"])
    assert now["date"] == new.isoformat() and now["end_date"] is None and now["time"] == "10:30"


def test_a_stretched_day_visit_stays_one_day():
    t = _today() + timedelta(days=12)
    b = _visit(service="daycare", start=t, checked_in=False)
    _move(b, t, t + timedelta(days=3))
    assert _get(b["id"])["end_date"] is None


def test_a_moved_boarding_stay_keeps_its_nights():
    t = _today() + timedelta(days=20)
    b = _visit(service="boarding", start=t, end=t + timedelta(days=3), checked_in=False)
    _move(b, t + timedelta(days=7))
    now = _get(b["id"])
    assert now["date"] == (t + timedelta(days=7)).isoformat() and now["end_date"] == (t + timedelta(days=10)).isoformat()


def test_a_boarding_stay_needs_a_night():
    t = _today() + timedelta(days=25)
    b = _visit(service="boarding", start=t, end=t + timedelta(days=2), checked_in=False)
    err = _refused(server.reschedule_booking(b["id"], server.RescheduleIn(date=t.isoformat(), end_date=t.isoformat()), ADMIN))
    assert err.status_code == 400 and err.block["code"] == "boarding_zero_nights"
    assert _get(b["id"])["end_date"] == (t + timedelta(days=2)).isoformat()


def _bt_service(weeks=2):
    prog = {"id": str(uuid.uuid4()), "name": f"{TAG} B&T", "type": "board_train", "estimated_weeks": weeks}
    run(server.db.programs.insert_one(dict(prog)))
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} B&T service", "service_type": "training", "package_program_id": prog["id"]}
    run(server.db.services.insert_one(dict(svc)))
    return svc


def test_a_moved_board_and_train_keeps_its_length():
    t = _today() + timedelta(days=30)
    svc = _bt_service()
    b = _visit(service="training", start=t, end=t + timedelta(days=14), checked_in=False, service_id=svc["id"])
    _move(b, t + timedelta(days=3))
    assert _get(b["id"])["end_date"] == (t + timedelta(days=17)).isoformat()
    # A Board & Train that lost its pickup date gets its program's length back.
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"end_date": None}}))
    _move(b, t + timedelta(days=4))
    assert _get(b["id"])["end_date"] == (t + timedelta(days=18)).isoformat()


def test_a_lesson_is_not_a_stay_just_because_it_spans_days():
    t = _today() + timedelta(days=40)
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Private lesson", "service_type": "training"}
    run(server.db.services.insert_one(dict(svc)))
    b = _visit(service="training", start=t, end=t + timedelta(days=2), checked_in=False, service_id=svc["id"])
    _move(b, t + timedelta(days=1))
    assert _get(b["id"])["end_date"] is None


def test_a_checked_in_visit_cannot_start_after_today():
    t = _today()
    b = _visit(service="boarding", start=t, end=t + timedelta(days=3))
    err = _refused(server.reschedule_booking(b["id"], server.RescheduleIn(date=(t + timedelta(days=1)).isoformat()), ADMIN))
    assert err.status_code == 409 and err.block["code"] == "checked_in"
    # Extending the stay (the pickup) is fine.
    _move(b, t, t + timedelta(days=5))
    assert _get(b["id"])["end_date"] == (t + timedelta(days=5)).isoformat()


def test_editing_a_day_visit_clears_a_bad_end_date():
    t = _today() + timedelta(days=15)
    b = _visit(service="grooming", start=t, end=t - timedelta(days=1), checked_in=False, time="09:00")
    run(server.patch_booking(b["id"], server.BookingPatchIn(date=t.isoformat(), notes="bath"), ADMIN))
    now = _get(b["id"])
    assert now["end_date"] is None and now["notes"] == "bath"


def test_the_calendar_only_lets_boarding_be_stretched():
    t = _today() + timedelta(days=50)
    lesson = _visit(service="training", start=t, checked_in=False, time="11:00")
    stay = _visit(service="boarding", start=t, end=t + timedelta(days=2), checked_in=False)
    events = run(server.calendar_events(ADMIN, start=t.isoformat(), end=(t + timedelta(days=5)).isoformat()))
    by_id = {e["id"]: e for e in events}
    assert by_id[lesson["id"]]["durationEditable"] is False
    assert by_id[lesson["id"]]["extendedProps"]["spans_days"] is False
    assert "durationEditable" not in by_id[stay["id"]]
    assert by_id[stay["id"]]["extendedProps"]["spans_days"] is True


def test_a_checked_in_day_visit_cannot_move_later_and_is_told_to_check_out():
    b = _visit(service="daycare")
    err = _refused(server.reschedule_booking(b["id"], server.RescheduleIn(date=(_today() + timedelta(days=1)).isoformat()), ADMIN))
    assert err.status_code == 409 and "pickup" not in err.detail and "out first" in err.detail


def test_income_names_a_reopened_checkout():
    b = _visit(service_id="svc-x", financial_reopened_at=server.now_iso())
    err = _refused(server.update_transaction(b["id"], server.TransactionUpdateIn(actual_price=25.0), ADMIN))
    assert "reopened" in err.detail


def test_a_waitlisted_day_visit_range_is_not_quietly_cut_to_one_day():
    entry = {"id": str(uuid.uuid4()), "status": "waiting", "dog_id": "dog-x", "client_name": f"{TAG} Owner",
             "service_type": "daycare", "requested_date": (_today() + timedelta(days=3)).isoformat(),
             "requested_end_date": (_today() + timedelta(days=5)).isoformat(), "created_at": server.now_iso()}
    run(server.db.waitlist.insert_one(dict(entry)))
    try:
        err = _refused(server.convert_waitlist_to_booking(entry["id"], ADMIN))
        assert err.status_code == 409 and err.block["code"] == "day_visit_range"
        assert run(server.db.waitlist.find_one({"id": entry["id"]}, {"_id": 0}))["status"] == "waiting"
    finally:
        run(server.db.waitlist.delete_one({"id": entry["id"]}))


def test_removing_an_income_row_keeps_a_visit_that_is_checked_in():
    b = _visit(service_id="svc-x", checked_in=False)
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"checked_in_at": server.now_iso()}}))
    run(server.delete_transaction(b["id"], ADMIN))
    now = _get(b["id"])
    assert now is not None and now["checked_in_at"] and not now.get("service_id")
