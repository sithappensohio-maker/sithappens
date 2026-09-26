"""End of Day covers the whole day, not only visits that started on it.

Audit #9 (2026-09-25): the wrap-up loaded only bookings whose `date` was the
day being closed. A boarding or Board & Train dog on its last day started
days earlier, so End of Day could say "All clear" with that dog still
checked in, or with its pickup left unpaid, and the pickup's money and
report card never showed.

These pin: on-premises covers every open check-in (due out, overdue,
reopened, day visits, stayovers — Board & Train included), unpaid follows
the checkout day and the live bill, revenue is the day's visit money, care
totals count the day itself, and the bathroom counter keeps per-day counts
without losing a tap.

Past dates keep other tests' open check-ins (stamped "now") out of the day.
"""
import asyncio
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.operations import end_of_day

TAG = "TEST_EOD_PICKUPS"
ADMIN = {"id": "eod-admin", "role": "admin", "name": "Pat Owner", "email": "eod-admin@example.com"}
D = date(2003, 4, 16)  # a Wednesday; nothing else in the suite uses 2003
DAY = D.isoformat()


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    ids = [b["id"] for b in run(server.db.bookings.find({"client_name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(None))]
    run(server.db.bookings.delete_many({"id": {"$in": ids}}))
    run(server.db.invoices.delete_many({"booking_ids": {"$in": ids}}))
    run(server.db.payment_ledger.delete_many({"booking_id": {"$in": ids}}))
    run(server.db.services.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.programs.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.clients.delete_many({"id": "eod-client"}))


def _tab(balance):
    run(server.db.clients.update_one({"id": "eod-client"}, {"$set": {"account_balance": balance, "name": f"{TAG} Owner"}}, upsert=True))


def _iso(day, hh, mm=0):
    """A UTC timestamp for a business-local wall-clock moment."""
    return datetime.combine(day, time(hh, mm), tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat()


def _visit(service="boarding", start=D, end=None, checked_in=None, checked_out=None, status="approved", **over):
    b = {
        "id": str(uuid.uuid4()), "dog_id": f"dog-{uuid.uuid4()}", "dog_name": f"Dog {uuid.uuid4().hex[:5]}",
        "client_id": "eod-client", "client_name": f"{TAG} Owner", "service_type": service, "status": status,
        "date": start.isoformat(), "end_date": end.isoformat() if end else None,
        "checked_in_at": checked_in, "checked_out_at": checked_out, "created_at": server.now_iso(),
    }
    b.update(over)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _snap(day=DAY):
    return run(server._admin_end_of_day_snapshot(day))


def _ids(rows):
    return {r["booking_id"] for r in rows}


def _row(rows, bid):
    return next(r for r in rows if r["booking_id"] == bid)


# ───────────────────────────────────────────── who is still here

def test_a_boarding_dog_due_out_today_that_started_earlier_blocks_the_day():
    b = _visit(start=D - timedelta(days=3), end=D, checked_in=_iso(D - timedelta(days=3), 8))
    snap = _snap()
    assert b["id"] in _ids(snap["still_on_premises"])
    row = _row(snap["still_on_premises"], b["id"])
    assert row["reason"] == "due_out"
    assert "Due out" in row["note"]
    assert snap["all_clear"] is False and snap["hard_clear"] is False
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_stay_running_past_the_day_is_a_stayover_on_every_night_not_just_the_first():
    b = _visit(start=D - timedelta(days=2), end=D + timedelta(days=2), checked_in=_iso(D - timedelta(days=2), 9))
    snap = _snap()
    assert b["id"] in _ids(snap["boarding_stayovers"])
    assert b["id"] not in _ids(snap["still_on_premises"])
    assert _row(snap["boarding_stayovers"], b["id"])["stay_kind"] == "boarding"
    assert snap["all_clear"] is True
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_an_overdue_stay_blocks_with_how_late_it_is():
    b = _visit(start=D - timedelta(days=5), end=D - timedelta(days=2), checked_in=_iso(D - timedelta(days=5), 9))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert row["reason"] == "overdue" and row["days_late"] == 2
    assert "2 days ago" in row["note"]
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_daycare_dog_never_checked_out_yesterday_still_blocks_today():
    b = _visit(service="daycare", start=D - timedelta(days=1), checked_in=_iso(D - timedelta(days=1), 8))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert row["reason"] == "overdue" and row["days_late"] == 1
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_todays_daycare_dog_still_checked_in_blocks():
    b = _visit(service="daycare", start=D, checked_in=_iso(D, 8))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert row["reason"] == "on_site"
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_board_and_train_is_a_stayover_until_its_pickup_day_then_blocks():
    b = _visit(service="training", start=D - timedelta(days=10), end=D + timedelta(days=4), checked_in=_iso(D - timedelta(days=10), 9))
    snap = _snap()
    assert b["id"] in _ids(snap["boarding_stayovers"]) and b["id"] not in _ids(snap["still_on_premises"])
    assert _row(snap["boarding_stayovers"], b["id"])["stay_kind"] == "board_train"
    pickup = (D + timedelta(days=4)).isoformat()
    # Its pickup day is in the future of D, so check the rule directly.
    assert end_of_day.classify(b, pickup, True)[0] == "due_out"
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_board_and_train_drop_off_day_is_not_a_false_blocker():
    b = _visit(service="training", start=D, end=D + timedelta(days=14), checked_in=_iso(D, 9))
    snap = _snap()
    assert b["id"] in _ids(snap["boarding_stayovers"])
    assert b["id"] not in _ids(snap["still_on_premises"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_reopened_checkout_blocks_until_checked_out_again():
    b = _visit(start=D - timedelta(days=2), end=D + timedelta(days=3), checked_in=_iso(D - timedelta(days=2), 9),
               financial_reopened_at=_iso(D, 10))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert row["reason"] == "reopened"
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_dog_that_arrived_after_the_day_is_not_on_that_days_list():
    b = _visit(start=D - timedelta(days=1), end=D + timedelta(days=2), checked_in=_iso(D + timedelta(days=1), 9))
    snap = _snap()
    assert b["id"] not in _ids(snap["still_on_premises"]) | _ids(snap["boarding_stayovers"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_closed_visit_without_a_checkout_time_is_not_on_premises():
    # "completed" set by a money edit, never checked out: the visit is closed.
    b = _visit(service="daycare", start=D, checked_in=_iso(D, 8), status="completed")
    assert b["id"] not in _ids(_snap()["still_on_premises"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def _service(board_train):
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} {'B&T' if board_train else 'Private lesson'}",
           "service_type": "training", "base_price": 100}
    if board_train:
        prog = {"id": str(uuid.uuid4()), "name": f"{TAG} program", "type": "board_train", "estimated_weeks": 2}
        run(server.db.programs.insert_one(dict(prog)))
        svc["package_program_id"] = prog["id"]
    run(server.db.services.insert_one(dict(svc)))
    return svc


def test_board_and_train_is_known_by_its_service_not_its_dates():
    bt = _visit(service="training", start=D - timedelta(days=3), end=D + timedelta(days=11),
                checked_in=_iso(D - timedelta(days=3), 9), service_id=_service(True)["id"])
    # A lesson dragged across three days on the calendar is still a lesson.
    lesson = _visit(service="training", start=D, end=D + timedelta(days=2), checked_in=_iso(D, 10),
                    service_id=_service(False)["id"])
    snap = _snap()
    assert bt["id"] in _ids(snap["boarding_stayovers"])
    assert lesson["id"] in _ids(snap["still_on_premises"])
    assert lesson["id"] not in _ids(snap["boarding_stayovers"])
    run(server.db.bookings.delete_many({"id": {"$in": [bt["id"], lesson["id"]]}}))


def test_a_back_dated_walk_in_that_arrived_today_is_not_late():
    b = _visit(service="daycare", start=D - timedelta(days=2), checked_in=_iso(D, 9))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert row["reason"] == "on_site" and "days_late" not in row
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_stay_with_no_pickup_date_says_so():
    b = _visit(start=D - timedelta(days=1), end=None, checked_in=_iso(D - timedelta(days=1), 9))
    row = _row(_snap()["still_on_premises"], b["id"])
    assert "No pickup date" in row["note"]
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_an_early_arrival_for_a_later_stay_is_a_stayover_that_says_so():
    b = _visit(start=D + timedelta(days=2), end=D + timedelta(days=5), checked_in=_iso(D, 18))
    row = _row(_snap()["boarding_stayovers"], b["id"])
    assert "Arrived early" in row["note"]
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_row_with_a_broken_date_does_not_break_the_snapshot():
    b = _visit(service="daycare", start=D, checked_in=_iso(D, 8))
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"date": "2003-4-1", "end_date": "soon"}}))
    snap = _snap()
    assert b["id"] in _ids(snap["still_on_premises"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_stay_checked_in_after_its_pickup_day_counts_from_arrival():
    b = {"id": "late", "service_type": "boarding", "date": (D - timedelta(days=6)).isoformat(),
         "end_date": (D - timedelta(days=2)).isoformat(), "checked_in_at": _iso(D - timedelta(days=1), 11)}
    reason, note, late = end_of_day.classify(b, DAY, True, DAY)
    assert reason == "overdue" and late == 1
    assert "1 day ago" in note and "due out" in note
    reason, note, _late = end_of_day.classify(b, (D - timedelta(days=1)).isoformat(), True, DAY)
    assert reason == "due_out" and "Checked in" in note


def test_the_stuck_checkout_list_includes_day_visits():
    # Day visits store end_date null; the old query only matched a missing
    # or empty one, so the resolver never listed them.
    today = server.business_today()
    b = _visit(service="daycare", start=today - timedelta(days=2), checked_in=_iso(today - timedelta(days=2), 8))
    listing = next(r.endpoint for r in server.app.routes
                   if getattr(r, "path", "").endswith("/admin/bookings/stuck-checkouts") and "GET" in r.methods)
    walk_in = _visit(service="daycare", start=today - timedelta(days=2), checked_in=server.now_iso())
    rows = run(listing(_=ADMIN))
    assert b["id"] in {r["id"] for r in rows}
    assert walk_in["id"] not in {r["id"] for r in rows}   # back-dated, checked in today: not stuck
    run(server.db.bookings.delete_many({"id": {"$in": [b["id"], walk_in["id"]]}}))


# ───────────────────────────────────────────── what is still owed

def test_a_boarding_pickup_left_unpaid_is_on_its_checkout_days_list_not_its_first_days():
    # Checked out 10:30 PM local — already the next day in UTC.
    b = _visit(start=D - timedelta(days=3), end=D, checked_in=_iso(D - timedelta(days=3), 8),
               checked_out=_iso(D, 22, 30), status="completed", checked_out_by="eod-admin",
               actual_price=300.0, amount_paid=0.0, payment_status="paid_partial")
    snap = _snap()
    assert b["id"] in _ids(snap["unpaid_bookings"])
    assert _row(snap["unpaid_bookings"], b["id"])["amount"] == 300.0
    assert snap["completed_count"] >= 1
    assert b["id"] in _ids(snap["missing_report_cards"])
    assert snap["all_clear"] is False
    first_day = _snap((D - timedelta(days=3)).isoformat())
    assert b["id"] not in _ids(first_day["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_pickup_paid_on_its_bill_after_checkout_is_not_unpaid():
    b = _visit(start=D - timedelta(days=2), end=D, checked_in=_iso(D - timedelta(days=2), 8),
               checked_out=_iso(D, 17), status="completed", checked_out_by="eod-admin",
               actual_price=200.0, amount_paid=0.0, payment_status="paid_partial")
    inv = {"id": str(uuid.uuid4()), "booking_ids": [b["id"]], "status": "PAID", "balance": 0.0,
           "total": 200.0, "amount_paid": 200.0, "created_at": _iso(D, 17)}
    run(server.db.invoices.insert_one(dict(inv)))
    assert b["id"] not in _ids(_snap()["unpaid_bookings"])
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "PARTIALLY_PAID", "balance": 75.0}}))
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 75.0
    run(server.db.invoices.delete_one({"id": inv["id"]}))
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_an_old_completed_row_without_a_checkout_time_counts_on_its_date():
    b = _visit(service="daycare", start=D, status="completed", actual_price=40.0, payment_status="unpaid")
    assert b["id"] in _ids(_snap()["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_same_day_visit_checked_out_the_next_morning_belongs_to_the_next_day():
    b = _visit(service="daycare", start=D - timedelta(days=1), checked_in=_iso(D - timedelta(days=1), 8),
               checked_out=_iso(D, 7), status="completed", checked_out_by="eod-admin",
               actual_price=45.0, amount_paid=0.0, payment_status="paid_partial")
    assert b["id"] in _ids(_snap()["unpaid_bookings"])
    assert b["id"] not in _ids(_snap((D - timedelta(days=1)).isoformat())["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def _pickup(**over):
    base = dict(start=D - timedelta(days=2), end=D, checked_in=_iso(D - timedelta(days=2), 8),
                checked_out=_iso(D, 17), status="completed", checked_out_by="eod-admin")
    base.update(over)
    return _visit(**base)


def _bill(bids, balance, made=None, **over):
    inv = {"id": str(uuid.uuid4()), "booking_ids": bids, "status": "OPEN", "balance": balance,
           "created_at": made or _iso(D, 17), "correction_ops": []}
    inv.update(over)
    run(server.db.invoices.insert_one(dict(inv)))
    return inv


def _correction(bid, amount, at, op="op-1"):
    run(server.db.payment_ledger.insert_one({"id": str(uuid.uuid4()), "booking_id": bid, "type": "charge",
                                             "amount": amount, "source": "correction", "correction_op_id": op,
                                             "created_at": at}))


def test_a_charge_added_after_the_bill_was_paid_is_still_owed_until_the_tab_is_paid():
    _tab(20.0)
    b = _pickup(actual_price=120.0, amount_paid=0.0, payment_status="paid_partial", balance_due=20.0)
    _bill([b["id"]], 0.0, status="PAID")
    _correction(b["id"], 20.0, _iso(D, 19))
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 20.0
    # Paid at the counter on the tab: the visit is never touched, the tab is.
    _tab(0.0)
    assert b["id"] not in _ids(_snap()["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_voiding_the_bill_payment_after_a_correction_shows_the_whole_debt():
    # Paid $100 on the bill, $20 charge went on the tab, then the $100 payment was voided.
    _tab(120.0)
    b = _pickup(actual_price=120.0, amount_paid=0.0, payment_status="paid_partial", balance_due=20.0)
    _bill([b["id"]], 100.0, status="OPEN")
    _correction(b["id"], 20.0, _iso(D, 19), op="op-v")
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 120.0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_corrections_from_before_a_reopen_are_not_owed_again():
    _tab(50.0)
    b = _pickup(actual_price=50.0, amount_paid=0.0, payment_status="paid_partial", balance_due=50.0)
    _bill([b["id"]], 0.0, status="PAID")
    _correction(b["id"], 20.0, _iso(D, 9), op="op-early")   # before this checkout (17:00)
    assert b["id"] not in _ids(_snap()["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_credits_visit_owes_only_its_correction():
    b = _pickup(actual_price=40.0, amount_paid=0.0, payment_status="paid_partial", payment_method="credits", balance_due=10.0)
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 10.0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_bill_for_two_dogs_is_not_counted_twice():
    a = _pickup(actual_price=50.0, amount_paid=0.0, payment_status="paid_partial", balance_due=50.0)
    c = _pickup(actual_price=50.0, amount_paid=0.0, payment_status="paid_partial", balance_due=50.0)
    _bill([a["id"], c["id"]], 50.0, status="PARTIALLY_PAID")
    owed = {r["booking_id"]: r["amount"] for r in _snap()["unpaid_bookings"]}
    assert owed.get(a["id"], 0) + owed.get(c["id"], 0) == 50.0
    run(server.db.bookings.delete_many({"id": {"$in": [a["id"], c["id"]]}}))


def test_a_reopened_dog_on_a_shared_bill_does_not_take_the_other_dogs_share():
    # Group bill of $100 ($50 each); dog A reopened and checked out again for $60.
    a = _pickup(actual_price=60.0, amount_paid=0.0, payment_status="paid_partial", balance_due=60.0,
                checked_out=_iso(D, 18))
    c = _pickup(actual_price=50.0, amount_paid=0.0, payment_status="paid_partial", balance_due=50.0,
                checked_out=_iso(D, 16))
    _bill([a["id"], c["id"]], 100.0, made=_iso(D, 16, 1))
    owed = {r["booking_id"]: r["amount"] for r in _snap()["unpaid_bookings"]}
    assert owed[a["id"]] == 60.0 and owed[c["id"]] == 50.0
    run(server.db.bookings.delete_many({"id": {"$in": [a["id"], c["id"]]}}))


def test_a_bill_from_before_a_reopened_checkout_does_not_hide_the_new_debt():
    b = _pickup(actual_price=150.0, amount_paid=0.0, payment_status="paid_partial", balance_due=150.0)
    _bill([b["id"]], 100.0, made=_iso(D - timedelta(days=1), 17))
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 150.0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_bill_without_a_balance_falls_back_to_the_visit():
    b = _pickup(actual_price=80.0, amount_paid=0.0, payment_status="paid_partial", balance_due=80.0)
    _bill([b["id"]], None)
    assert _row(_snap()["unpaid_bookings"], b["id"])["amount"] == 80.0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_an_income_record_entered_later_keeps_its_visit_date():
    # POST /transactions stamps checked_out_at "now" but nobody checked the dog out.
    later = D + timedelta(days=2)
    b = _visit(service="daycare", start=D, checked_in=_iso(later, 9), checked_out=_iso(later, 9),
               status="completed", actual_price=40.0, amount_paid=0.0, payment_status="unpaid", balance_due=40.0)
    assert b["id"] in _ids(_snap()["unpaid_bookings"])
    assert b["id"] not in _ids(_snap(later.isoformat())["unpaid_bookings"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_rows_closed_by_the_stuck_checkout_tool_are_not_pickups():
    before = _snap()["completed_count"]
    b = _pickup(service="daycare", start=D - timedelta(days=3), end=None, actual_price=0.0,
                admin_checkout_resolution={"by": "eod-admin", "reason": "went home", "at": _iso(D, 9)})
    snap = _snap()
    assert snap["completed_count"] == before
    assert b["id"] not in _ids(snap["missing_report_cards"])
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_revenue_is_the_days_visit_money_from_the_register():
    snap = _snap()
    assert snap["revenue_cash"] == round(float(snap["register"]["incoming_sources"]["booking_payments"]), 2)


def test_a_boarding_pickup_paid_at_checkout_shows_in_that_days_revenue():
    before = _snap()["revenue_cash"]
    b = _visit(start=D - timedelta(days=4), end=D, checked_in=_iso(D - timedelta(days=4), 8),
               checked_out=_iso(D, 16), paid_at=_iso(D, 16), status="completed", checked_out_by="eod-admin",
               actual_price=260.0, amount_paid=260.0, payment_status="paid", payment_method="card")
    assert round(_snap()["revenue_cash"] - before, 2) == 260.0
    run(server.db.bookings.delete_one({"id": b["id"]}))


# ───────────────────────────────────────────── care for the day itself

def _item(kind, days):
    return {"id": str(uuid.uuid4()), "kind": kind, "time": "08:00", "label": kind.title(),
            "days": {d.isoformat(): {"status": s, "completed_at": _iso(d, 8)} for d, s in days}}


def test_care_totals_count_the_day_not_the_whole_stay():
    y = D - timedelta(days=1)
    stray = {"index": 0, "at": _iso(D, 12), "by_name": "Old app"}         # matched nothing
    carried = _iso(D, 8)                                                    # also a Care Board record
    b = _visit(start=D - timedelta(days=2), end=D + timedelta(days=1), checked_in=_iso(D - timedelta(days=2), 9),
               care_items=[_item("feeding", [(y, "completed"), (D, "completed")]),
                           _item("medication", [(D, "completed")]),
                           _item("medication", [(D, "skipped")])],
               feeding_log=[{"index": 0, "at": _iso(y, 8), "care_item_id": "x", "day": y.isoformat()}],
               medication_log=[stray, {"index": 0, "at": carried}, {"index": 0, "at": _iso(y, 20)}],
               bathroom_log={"pee": 9, "poop": 4},
               bathroom_days={y.isoformat(): {"pee": 5, "poop": 2}, DAY: {"pee": 4, "poop": 2}})
    counts = end_of_day.care_counts(run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0})), DAY)
    assert counts == {"feedings": 1, "medications": 2, "pee": 4, "poop": 2}
    # The stay started two days earlier: the old snapshot never looked at it.
    assert _snap()["care_log_totals"] == counts
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_older_visits_without_day_counts_only_count_a_one_day_visit():
    one_day = {"id": "x", "date": DAY, "end_date": None, "bathroom_log": {"pee": 3, "poop": 1}}
    stay = {"id": "y", "date": (D - timedelta(days=2)).isoformat(), "end_date": (D + timedelta(days=1)).isoformat(),
            "bathroom_log": {"pee": 12, "poop": 6}}
    assert end_of_day.care_counts(one_day, DAY)["pee"] == 3
    assert end_of_day.care_counts(stay, DAY)["pee"] == 0


def test_once_tracked_per_day_the_day_records_are_the_whole_truth():
    # An old-app tap after a Care Board completion would otherwise count twice.
    b = {"id": "z", "date": DAY, "end_date": None, "care_per_day_since": DAY,
         "care_items": [_item("feeding", [(D, "completed")])],
         "feeding_log": [{"index": 0, "at": _iso(D, 8, 10)}]}
    assert end_of_day.care_counts(b, DAY)["feedings"] == 1


def test_a_one_day_visit_counts_taps_from_before_and_after_per_day_counting():
    b = {"id": "w", "date": DAY, "end_date": None, "bathroom_log": {"pee": 3, "poop": 0},
         "bathroom_days": {DAY: {"pee": 1}}}
    assert end_of_day.care_counts(b, DAY)["pee"] == 3


def test_a_dog_checked_in_before_its_booking_date_has_its_trips_counted():
    b = _visit(start=D + timedelta(days=1), end=D + timedelta(days=4), checked_in=_iso(D, 19),
               bathroom_log={"pee": 2, "poop": 0}, bathroom_days={DAY: {"pee": 2}})
    assert _snap()["care_log_totals"]["pee"] == 2
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_malformed_day_count_does_not_break_the_totals():
    b = {"id": "v", "date": DAY, "end_date": None, "bathroom_days": {DAY: 3}, "bathroom_log": {"pee": "x"}}
    assert end_of_day.care_counts(b, DAY)["pee"] == 0


def test_the_snapshot_keeps_its_shape():
    snap = _snap()
    for k in ("date", "register", "staff_readiness", "still_on_premises", "boarding_stayovers", "unpaid_bookings",
              "missing_report_cards", "optional_report_cards", "revenue_cash", "completed_count",
              "care_log_totals", "hard_clear", "all_clear"):
        assert k in snap
    assert set(snap["care_log_totals"]) == {"feedings", "medications", "pee", "poop"}
    via_route = run(server.admin_end_of_day(date=DAY, _=ADMIN))
    assert via_route["date"] == DAY and via_route["all_clear"] == snap["all_clear"]


# ───────────────────────────────────────────── the bathroom counter

def _tick(bid, kind, delta=1):
    return run(server.employee_bathroom_tick(bid, server.BathroomTickIn(kind=kind, delta=delta), user=ADMIN))


def test_bathroom_ticks_keep_the_total_and_todays_count():
    today = server.business_today().isoformat()
    b = _visit(service="daycare", start=server.business_today(), checked_in=server.now_iso())
    assert _tick(b["id"], "pee")["bathroom_log"]["pee"] == 1
    _tick(b["id"], "pee")
    _tick(b["id"], "poop")
    out = _tick(b["id"], "pee", -1)
    assert out["bathroom_log"] == {"pee": 1, "poop": 1}
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_days"][today] == {"pee": 1, "poop": 1}
    _tick(b["id"], "pee", -1)
    _tick(b["id"], "pee", -1)  # nothing left to undo
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_log"]["pee"] == 0 and doc["bathroom_days"][today]["pee"] == 0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_taps_landing_together_are_all_counted():
    b = _visit(service="daycare", start=server.business_today(), checked_in=server.now_iso())

    async def burst():
        await asyncio.gather(*[
            server.employee_bathroom_tick(b["id"], server.BathroomTickIn(kind="poop", delta=1), user=ADMIN)
            for _ in range(8)])
    run(burst())
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_log"]["poop"] == 8
    assert doc["bathroom_days"][server.business_today().isoformat()]["poop"] == 8
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_older_counters_are_repaired_before_counting():
    b = _visit(service="daycare", start=server.business_today(), checked_in=server.now_iso(), bathroom_log=None)
    assert _tick(b["id"], "pee")["bathroom_log"] == {"pee": 1, "poop": 0}
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"bathroom_log": {"pee": "3", "poop": None}}}))
    assert _tick(b["id"], "pee")["bathroom_log"] == {"pee": 4, "poop": 0}
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_undo_of_an_earlier_days_tap_takes_it_from_the_total_only():
    today = server.business_today().isoformat()
    b = _visit(service="boarding", start=server.business_today() - timedelta(days=1),
               end=server.business_today() + timedelta(days=1), checked_in=server.now_iso(),
               bathroom_log={"pee": 2, "poop": 0}, bathroom_days={})
    assert _tick(b["id"], "pee", -1)["bathroom_log"]["pee"] == 1
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert (doc.get("bathroom_days") or {}).get(today, {}).get("pee", 0) == 0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_undo_takes_a_tap_back_from_the_day_that_holds_it():
    today = server.business_today()
    y = (today - timedelta(days=1)).isoformat()
    b = _visit(service="boarding", start=today - timedelta(days=1), end=today + timedelta(days=1),
               checked_in=server.now_iso(), bathroom_log={"pee": 1, "poop": 0}, bathroom_days={y: {"pee": 1}})
    assert _tick(b["id"], "pee", -1)["bathroom_log"]["pee"] == 0
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_days"][y]["pee"] == 0
    run(server.db.bookings.delete_one({"id": b["id"]}))


def test_a_broken_day_count_is_repaired_before_counting():
    today = server.business_today().isoformat()
    b = _visit(service="daycare", start=server.business_today(), checked_in=server.now_iso(),
               bathroom_log={"pee": 0, "poop": 0}, bathroom_days={today: {"pee": "2"}})
    _tick(b["id"], "pee")
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_days"][today]["pee"] == 3
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {f"bathroom_days.{today}": 5}}))
    _tick(b["id"], "poop")
    doc = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert doc["bathroom_days"][today] == {"poop": 1}
    run(server.db.bookings.delete_one({"id": b["id"]}))
