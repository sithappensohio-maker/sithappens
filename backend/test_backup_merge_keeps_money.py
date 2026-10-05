"""A merge restore keeps the money and state that exist live (audit #8). An older backup used to put a
spent gift card back to its balance, re-credit a redeemed lot, re-open a checked-out visit, un-void a
refund and undo a payment's attribution. For a row that already exists, the protected fields keep their
live value; content still reverts; a missing row is restored whole. Disposable tag TEST_MERGE_MONEY."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_MERGE_MONEY"


def _id():
    return f"{TAG}-{uuid.uuid4().hex[:8]}"


def _merge(collections):
    return run(server._restore_collections(collections, "merge"))


def _one(coll, _id_):
    return run(getattr(server.db, coll).find_one({"id": _id_}, {"_id": 0}))


def teardown_module():
    for coll in ("gift_cards", "credit_lots", "clients", "bookings", "payment_ledger", "refund_idempotency_claims",
                 "invoices", "time_clock_entries", "dog_programs", "school_enrollments", "training_session_drafts",
                 "checkpoint_submissions", "training_session_log"):
        run(getattr(server.db, coll).delete_many({"tag": TAG}))


def test_a_merge_keeps_a_gift_card_balance_spent_after_the_backup_and_takes_its_note():
    gid = _id()
    run(server.db.gift_cards.insert_one({"id": gid, "code": gid, "balance": 20.0, "status": "active",
                                         "money_keys": ["sell:1", "redeem:9"], "note": "live", "tag": TAG}))
    _merge({"gift_cards": [{"id": gid, "code": gid, "balance": 50.0, "status": "active",
                            "money_keys": ["sell:1"], "note": "backup note", "tag": TAG}]})
    row = _one("gift_cards", gid)
    assert row["balance"] == 20.0, "the spend after the backup stays spent"
    assert row["money_keys"] == ["sell:1", "redeem:9"]
    assert row["note"] == "backup note", "content still takes the backup value"


def test_a_merge_keeps_a_voided_gift_card_voided():
    gid = _id()
    run(server.db.gift_cards.insert_one({"id": gid, "code": gid, "balance": 0.0, "status": "voided",
                                         "voided_at": "2031-01-02T00:00:00+00:00", "voided_by": "owner", "tag": TAG}))
    _merge({"gift_cards": [{"id": gid, "code": gid, "balance": 50.0, "status": "active", "tag": TAG}]})
    row = _one("gift_cards", gid)
    assert row["status"] == "voided" and row["voided_at"] == "2031-01-02T00:00:00+00:00"


def test_a_merge_keeps_a_credit_lot_quantity_redeemed_after_the_backup():
    lid = _id()
    run(server.db.credit_lots.insert_one({"id": lid, "client_id": f"{TAG}-c", "service_type": "training",
                                          "qty_total": 3, "qty_remaining": 1, "value_each": 40.0, "tag": TAG}))
    _merge({"credit_lots": [{"id": lid, "client_id": f"{TAG}-c", "service_type": "training", "qty_total": 3,
                             "qty_remaining": 3, "value_each": 40.0, "tag": TAG}]})
    assert _one("credit_lots", lid)["qty_remaining"] == 1


def test_a_merge_keeps_client_credits_spent_after_the_backup_and_takes_the_name():
    cid = _id()
    run(server.db.clients.insert_one({"id": cid, "name": "Live name", "email": f"{cid}@example.com",
                                      "training_credits": 1, "tag": TAG}))
    _merge({"clients": [{"id": cid, "name": "Backup name", "email": f"{cid}@example.com",
                         "training_credits": 3, "tag": TAG}]})
    row = _one("clients", cid)
    assert row["training_credits"] == 1
    assert row["name"] == "Backup name"


def test_a_merge_keeps_a_checked_out_visit_locked_and_paid():
    bid = _id()
    run(server.db.bookings.insert_one({"id": bid, "dog_id": f"{TAG}-d", "client_id": f"{TAG}-c", "service_type": "daycare",
                                       "date": "2031-02-01", "status": "completed", "financial_locked": True,
                                       "financial_revision": 2, "amount_paid": 40.0, "notes": "after", "tag": TAG}))
    _merge({"bookings": [{"id": bid, "dog_id": f"{TAG}-d", "client_id": f"{TAG}-c", "service_type": "daycare",
                          "date": "2031-02-01", "status": "booked", "financial_locked": False,
                          "financial_revision": 1, "amount_paid": 0.0, "notes": "before", "tag": TAG}]})
    row = _one("bookings", bid)
    assert row["status"] == "completed" and row["financial_locked"] is True
    assert row["amount_paid"] == 40.0
    assert row["notes"] == "before"


def test_a_merge_keeps_an_invoice_amount_paid():
    iid = _id()
    run(server.db.invoices.insert_one({"id": iid, "client_id": f"{TAG}-c", "total": 40.0, "amount_paid": 40.0,
                                       "balance": 0.0, "status": "paid", "tag": TAG}))
    _merge({"invoices": [{"id": iid, "client_id": f"{TAG}-c", "total": 40.0, "amount_paid": 0.0,
                          "balance": 40.0, "status": "open", "tag": TAG}]})
    row = _one("invoices", iid)
    assert row["amount_paid"] == 40.0 and row["status"] == "paid"


def test_a_merge_keeps_a_claim_that_finished_after_the_backup():
    rid = _id()
    run(server.db.refund_idempotency_claims.insert_one({"id": rid, "status": "completed", "tag": TAG}))
    _merge({"refund_idempotency_claims": [{"id": rid, "status": "processing", "tag": TAG}]})
    assert _one("refund_idempotency_claims", rid)["status"] == "completed"


def test_a_merge_keeps_a_ledger_rows_attribution():
    lid = _id()
    run(server.db.payment_ledger.insert_one({"id": lid, "invoice_id": "inv-live", "attributed_at": "2031-03-01", "tag": TAG}))
    _merge({"payment_ledger": [{"id": lid, "invoice_id": None, "tag": TAG}]})
    assert _one("payment_ledger", lid)["invoice_id"] == "inv-live"


def test_a_merge_keeps_clock_hours_entered_after_the_backup():
    tid = _id()
    run(server.db.time_clock_entries.insert_one({"id": tid, "user_id": f"{TAG}-u", "clock_in_at": "2031-04-01T08:00:00",
                                                 "clock_out_at": "2031-04-01T12:00:00", "hours": 4.0, "tag": TAG}))
    _merge({"time_clock_entries": [{"id": tid, "user_id": f"{TAG}-u", "clock_in_at": "2031-04-01T08:00:00",
                                    "clock_out_at": None, "hours": 0.0, "tag": TAG}]})
    row = _one("time_clock_entries", tid)
    assert row["hours"] == 4.0 and row["clock_out_at"] == "2031-04-01T12:00:00"


def test_a_missing_gift_card_is_restored_whole_with_its_balance():
    gid = _id()
    _merge({"gift_cards": [{"id": gid, "code": gid, "balance": 50.0, "status": "active", "money_keys": ["sell:1"], "tag": TAG}]})
    row = _one("gift_cards", gid)
    assert row is not None and row["balance"] == 50.0 and row["money_keys"] == ["sell:1"]


def test_a_merge_keeps_a_graduated_students_status_and_lesson_position_on_both_records():
    eid, sid = _id(), _id()
    run(server.db.dog_programs.insert_one({"id": eid, "dog_id": f"{TAG}-d", "status": "completed", "access_state": "active",
                                           "completed_at": "2031-06-01T00:00:00+00:00", "current_lesson_id": "L9",
                                           "goal_progress": {"sit": {"score": 5}}, "tag": TAG}))
    run(server.db.school_enrollments.insert_one({"id": sid, "enrollment_id": eid, "status": "completed",
                                                 "access_state": "active", "completed_at": "2031-06-01T00:00:00+00:00",
                                                 "tag": TAG}))
    _merge({"dog_programs": [{"id": eid, "dog_id": f"{TAG}-d", "status": "active", "completed_at": None,
                              "current_lesson_id": "L1", "goal_progress": {"sit": {"score": 1}}, "tag": TAG}],
            "school_enrollments": [{"id": sid, "enrollment_id": eid, "status": "active", "completed_at": None, "tag": TAG}]})
    prog = _one("dog_programs", eid)
    assert prog["status"] == "completed" and prog["current_lesson_id"] == "L9" and prog["goal_progress"] == {"sit": {"score": 5}}
    assert _one("school_enrollments", sid)["status"] == "completed"


def test_a_merge_does_not_reopen_a_completed_session_draft():
    did = _id()
    run(server.db.training_session_drafts.insert_one({"id": did, "status": "completed", "completed_log_id": "log-1",
                                                      "recap_ready": True, "tag": TAG}))
    _merge({"training_session_drafts": [{"id": did, "status": "draft", "completed_log_id": None, "recap_ready": False, "tag": TAG}]})
    row = _one("training_session_drafts", did)
    assert row["status"] == "completed" and row["completed_log_id"] == "log-1"


def test_a_merge_keeps_a_graded_checkpoint_result():
    cid = _id()
    run(server.db.checkpoint_submissions.insert_one({"id": cid, "status": "graded", "outcome": "advance",
                                                     "dog_overall": 4, "graded_by_name": "Sam", "tag": TAG}))
    _merge({"checkpoint_submissions": [{"id": cid, "status": "pending_grading", "outcome": None, "dog_overall": None, "tag": TAG}]})
    row = _one("checkpoint_submissions", cid)
    assert row["status"] == "graded" and row["outcome"] == "advance" and row["dog_overall"] == 4


def test_a_merge_keeps_a_session_log_as_it_was_written():
    lid = _id()
    run(server.db.training_session_log.insert_one({"id": lid, "enrollment_id": f"{TAG}-e", "prepaid_session_id": "b-live", "tag": TAG}))
    _merge({"training_session_log": [{"id": lid, "enrollment_id": f"{TAG}-e", "prepaid_session_id": None, "tag": TAG}]})
    assert _one("training_session_log", lid)["prepaid_session_id"] == "b-live"


def test_a_merge_does_not_reprice_a_shift_stamped_at_clock_in():
    tid = _id()
    run(server.db.time_clock_entries.insert_one({"id": tid, "user_id": f"{TAG}-u", "clock_in_at": "2031-04-02T08:00:00",
                                                 "clock_out_at": "2031-04-02T16:00:00", "hours": 8.0, "pay_rate": 20.0, "tag": TAG}))
    _merge({"time_clock_entries": [{"id": tid, "user_id": f"{TAG}-u", "clock_in_at": "2031-04-02T08:00:00",
                                    "clock_out_at": "2031-04-02T16:00:00", "hours": 8.0, "pay_rate": 35.0, "tag": TAG}]})
    assert _one("time_clock_entries", tid)["pay_rate"] == 20.0
