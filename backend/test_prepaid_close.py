"""A program session a trainer finishes closes like a desk checkout (audit #38).

Trainers run lessons from Trainer Day without the desk checking the dog in
and out, so the program credit each session is meant to use was never used.
Now finishing the lesson closes the session on one credit from its own
program ($0), an hourly sweep catches any it couldn't close right then, and a
one-time pass closes the past lessons trainers recorded, with a summary for
the owner on Today.

Disposable tag TEST_PREPAID_CLOSE.
"""
import contextlib
import uuid
from datetime import date, datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.bookings import prepaid_close, prepaid_sessions
from test_session_completion_hardening import _program, _client_and_dog, _cleanup  # noqa: E402

TAG = "TEST_PREPAID_CLOSE"


@contextlib.contextmanager
def _family_with_program(credits=3, other_pack=0):
    with _program() as (prog, admin), _client_and_dog() as (c, dog):
        enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
        lots = [{"id": f"{TAG}-lot-{uuid.uuid4().hex[:6]}", "client_id": c["id"], "service_type": "training",
                 "pack_kind": "training_program", "program_id": prog["id"], "qty_total": credits, "qty_remaining": credits,
                 "value_each": 25.0, "purchased_at": "2026-09-01T10:00:00"}]
        if other_pack:
            lots.append({"id": f"{TAG}-pack-{uuid.uuid4().hex[:6]}", "client_id": c["id"], "service_type": "training",
                         "pack_kind": "training_pack", "qty_total": other_pack, "qty_remaining": other_pack,
                         "value_each": 60.0, "purchased_at": "2026-01-01T10:00:00"})
        for lot in lots:
            run(server.db.credit_lots.insert_one(dict(lot)))
        run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"training_credits": credits + other_pack}}))
        try:
            yield {"client": c, "dog": dog, "prog": prog, "enr": enr, "admin": admin, "lot_id": lots[0]["id"],
                   "pack_id": lots[1]["id"] if other_pack else None}
        finally:
            run(server.db.bookings.delete_many({"client_id": c["id"]}))
            run(server.db.credit_lots.delete_many({"client_id": c["id"]}))
            run(server.db.invoices.delete_many({"client_id": c["id"]}))
            _cleanup(enr["id"])


def _session(f, day=None, **extra):
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": f["dog"]["id"], "dog_name": f["dog"]["name"],
         "client_id": f["client"]["id"], "client_name": f["client"]["name"], "service_type": "training",
         "date": day or date.today().isoformat(), "end_date": None, "time": "10:00", "status": "approved",
         "actual_price": 0.0, "payment_status": "paid", "payment_method": "credits", "created_at": server.now_iso(),
         "credit_lot_id": f["lot_id"], "program_id": f["prog"]["id"], "is_prepaid_program_session": True,
         "program_sale_session_index": 1, "program_sale_session_total": 3}
    b.update(extra)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _finish_lesson(f, b, label=None):
    if b is None:   # started from the dog's profile / Care Board — no booking on the lesson
        started = run(server.start_training_session_draft_direct(f["dog"]["id"], f["enr"]["id"], label or f"s-{uuid.uuid4().hex[:6]}", f["admin"], ""))
    else:
        started = run(server.start_training_session_draft_for_booking(b["id"], f["enr"]["id"], label or f"s-{uuid.uuid4().hex[:6]}", f["admin"]))
    draft_id = started["draft"]["id"]
    sit_id = f["prog"]["modules"][0]["goals"][0]["id"]
    act = next(a for a in started["draft"]["plan"]["activities"] if a.get("skill_id") == sit_id)
    run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(
        actuals={act["id"]: server.SessionActivityActualIn(score=3, outcome="improving", notes="n", mastery_decision="not_yet")},
        what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="r"), f["admin"]))
    return draft_id, run(server.complete_training_session(draft_id, server.SessionCompletionIn(), f["admin"]))


def _get(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _lot(lot_id):
    return run(server.db.credit_lots.find_one({"id": lot_id}))["qty_remaining"]


def _credits(f):
    return run(server.db.clients.find_one({"id": f["client"]["id"]}))["training_credits"]


@pytest.fixture
def fresh_marker():
    before = run(server.db.system_runs.find_one({"_id": prepaid_close.JOB}))
    run(server.db.system_runs.delete_one({"_id": prepaid_close.JOB}))
    yield
    run(server.db.system_runs.delete_one({"_id": prepaid_close.JOB}))
    if before:
        run(server.db.system_runs.insert_one(before))


# ───────────────────────────────────── the trainer finishes the lesson

def test_finishing_the_lesson_closes_the_session_on_one_credit_from_its_program(fresh_marker):
    with _family_with_program(credits=3, other_pack=2) as f:
        b = _session(f)
        _, res = _finish_lesson(f, b)
        assert res["prepaid_session"]["closed"] is True and res["prepaid_session"]["credit_used"] is True
        after = _get(b["id"])
        assert after["status"] == "completed" and after["checked_out_at"] and after["financial_locked"] is True
        assert after["credits_deducted"] == 1 and after["credit_lot_ids"] == [f["lot_id"]] and after["payment_method"] == "credits"
        assert not float(after.get("cash_revenue") or 0) and not float(after.get("amount_paid") or 0)
        assert _lot(f["lot_id"]) == 2 and _lot(f["pack_id"]) == 2 and _credits(f) == 4
        assert after["prepaid_close"]["source"] == "trainer_session"
        assert run(server.db.invoices.find_one({"booking_ids": b["id"]})), "the bill, as at the desk"


def test_with_the_programs_credits_gone_it_closes_at_zero_and_never_touches_another_pack(fresh_marker):
    with _family_with_program(credits=0, other_pack=2) as f:
        b = _session(f)
        _, res = _finish_lesson(f, b)
        after = _get(b["id"])
        assert res["prepaid_session"]["closed"] is True and res["prepaid_session"]["credit_used"] is False
        assert after["status"] == "completed" and float(after["actual_price"]) == 0.0 and after.get("prepaid_no_credit_left")
        assert _lot(f["pack_id"]) == 2 and _credits(f) == 2


def test_a_session_with_something_added_at_the_desk_is_left_for_the_desk(fresh_marker):
    with _family_with_program() as f:
        b = _session(f, checked_in_at=server.now_iso(), add_ons=[{"service_id": "x", "name": "Nails", "price": 15.0, "qty": 1}])
        _, res = _finish_lesson(f, b)
        assert res["prepaid_session"] == {"closed": False, "reason": "add_ons"}
        assert _get(b["id"])["status"] == "approved" and _credits(f) == 3


def test_a_checked_in_session_closes_too_so_the_desk_doesnt_have_to(fresh_marker):
    with _family_with_program() as f:
        b = _session(f, checked_in_at=server.now_iso())
        _, res = _finish_lesson(f, b)
        assert res["prepaid_session"]["closed"] is True and _get(b["id"])["status"] == "completed" and _credits(f) == 2


def test_reopening_and_finishing_again_never_takes_a_second_credit(fresh_marker):
    with _family_with_program() as f:
        b = _session(f)
        draft_id, _ = _finish_lesson(f, b)
        run(server.reopen_training_session(draft_id, server.SessionReopenIn(reason="fix a note"), f["admin"]))
        again = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), f["admin"]))
        assert again["prepaid_session"]["closed"] is False and _credits(f) == 2 and _lot(f["lot_id"]) == 2


def test_a_busy_family_keeps_the_lesson_and_the_sweep_closes_it_later(fresh_marker, monkeypatch):
    with _family_with_program() as f:
        run(prepaid_close._cutoff())   # closing-on-finish already running, as after the first scheduler tick
        b = _session(f)

        async def busy(_cid):
            raise server.HTTPException(status_code=409, detail="busy")
        monkeypatch.setattr(prepaid_close.tab_sync, "acquire_client_guard", busy)
        _, res = _finish_lesson(f, b)
        assert res["prepaid_session"] == {"closed": False, "reason": "busy"}
        assert run(server.db.training_session_log.find_one({"booking_id": b["id"]})), "the lesson is saved regardless"
        assert _get(b["id"])["status"] == "approved"
        monkeypatch.undo()
        run(server.db.system_runs.update_one({"_id": prepaid_close.JOB}, {"$unset": {"last_sweep_at": ""}}))
        out = run(prepaid_close.sweep())
        assert out["closed"] >= 1 and _get(b["id"])["status"] == "completed" and _credits(f) == 2


def test_a_close_that_breaks_midway_hands_the_credit_back_and_the_lesson_still_saves(fresh_marker, monkeypatch):
    with _family_with_program() as f:
        b = _session(f)
        real = server._cash_revenue

        def boom(_row):
            raise RuntimeError("simulated")
        monkeypatch.setattr(server, "_cash_revenue", boom)
        prepaid_close._server_globals["_cash_revenue"] = boom
        try:
            _, res = _finish_lesson(f, b)
        finally:
            prepaid_close._server_globals["_cash_revenue"] = real
        assert res["prepaid_session"]["closed"] is False
        assert _get(b["id"])["status"] == "approved" and not _get(b["id"]).get("checkout_in_progress")
        assert _credits(f) == 3 and _lot(f["lot_id"]) == 3, "exactly what was taken went back"


# ─────────────────────────────── once: past lessons trainers recorded

def _past_log(f, b, days_ago, **extra):
    at = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    run(server.db.training_session_log.insert_one({"id": f"{TAG}-log-{uuid.uuid4().hex[:6]}", "booking_id": b["id"],
                                                    "enrollment_id": f["enr"]["id"], "dog_id": f["dog"]["id"], "at": at,
                                                    "by_user": "Trainer Tess", **extra}))
    return at


def test_the_one_time_pass_closes_past_taught_sessions_dated_the_lesson(fresh_marker):
    with _family_with_program(credits=1) as f:
        run(prepaid_close._cutoff())
        taught = _session(f, day=(date.today() - timedelta(days=9)).isoformat())
        at = _past_log(f, taught, 9)
        second = _session(f, day=(date.today() - timedelta(days=2)).isoformat())
        _past_log(f, second, 2)
        untaught = _session(f, day=(date.today() - timedelta(days=5)).isoformat())
        out = run(prepaid_close.past_pass())
        assert out.get("pass_done_at")
        first = _get(taught["id"])
        assert first["status"] == "completed" and first["checked_out_at"] == at and first["credits_deducted"] == 1
        assert first["prepaid_close"]["source"] == "past_lessons_pass"
        assert not run(server.db.invoices.find_one({"booking_ids": taught["id"]})), "no bills dated today for old lessons"
        after_second = _get(second["id"])
        assert after_second["status"] == "completed" and after_second.get("prepaid_no_credit_left"), "the program's one credit went to the older lesson"
        assert _get(untaught["id"])["status"] == "approved", "a lesson nobody recorded is left alone"
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert [x["credit_used"] for x in fam["closed"]] == [True, False]
        assert run(prepaid_close.past_pass()) == {"skipped": True}, "never runs twice"
        assert _credits(f) == 0


def test_the_pass_lists_what_needs_a_person_instead_of_closing_it(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        moved = _session(f, day=(date.today() + timedelta(days=0)).isoformat())
        _past_log(f, moved, 6)                                     # recorded 6 days ago, then moved to today
        run(server.db.credit_adjustments.insert_one({"id": f"{TAG}-adj", "client_id": "someone-else",
                                                      "adjusted_at": server.now_iso(), "changes": {"training": {"delta": -1}}}))
        out = run(prepaid_close.past_pass())
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert fam["needs_a_look"][0]["why"].startswith("moved to a later date") and not fam["closed"]
        assert _get(moved["id"])["status"] == "approved" and _credits(f) == 3
        run(server.db.credit_adjustments.delete_many({"id": f"{TAG}-adj"}))


def test_a_family_whose_credits_were_changed_by_hand_waits_for_a_person(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f, day=(date.today() - timedelta(days=8)).isoformat())
        _past_log(f, b, 8)
        run(server.db.credit_adjustments.insert_one({"id": f"{TAG}-adj2", "client_id": f["client"]["id"],
                                                      "adjusted_at": server.now_iso(), "changes": {"training": {"delta": -1}}}))
        try:
            out = run(prepaid_close.past_pass())
        finally:
            run(server.db.credit_adjustments.delete_many({"id": f"{TAG}-adj2"}))
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert "changed by hand" in fam["needs_a_look"][0]["why"] and _get(b["id"])["status"] == "approved"


def test_the_owner_sees_one_today_row_per_family_that_stays_hidden(fresh_marker):
    with _family_with_program(credits=2) as f:
        run(prepaid_close._cutoff())
        b = _session(f, day=(date.today() - timedelta(days=4)).isoformat())
        _past_log(f, b, 4)
        run(prepaid_close.past_pass())
        rows = [r for r in run(prepaid_close.today_brain_items({"id": "o", "role": "admin"})) if f["client"]["id"] in r["id"]]
        assert len(rows) == 1 and "1 past lesson closed · 1 training credit used" in rows[0]["title"]
        assert rows[0]["cta"] == {"type": "open_client", "id": f["client"]["id"]}
        assert server._today_brain_signature(rows[0]) == "once"
        on_today = [i for i in run(server.admin_today_brain({"id": f"{TAG}-owner", "role": "admin", "name": "Owner"}))["items"]
                    if i.get("kind") == "prepaid_sessions_closed" and f["client"]["id"] in i["id"]]
        assert len(on_today) == 1
        assert run(prepaid_close.today_brain_items({"id": "e", "role": "employee", "staff_role": "front_desk"})) == []


def test_the_desk_checkout_also_uses_only_the_programs_credits():
    from test_prepaid_sessions import _check_in_out, _user   # the desk flow
    with _family_with_program(credits=0, other_pack=2) as f, _user() as admin:
        b = _session(f)
        after = _check_in_out(b, admin)
        assert after["status"] == "completed" and after.get("prepaid_no_credit_left") and _lot(f["pack_id"]) == 2


def test_the_pass_leaves_lessons_after_the_cutoff_to_closing_on_finish(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(server.db.system_runs.insert_one({"_id": prepaid_close.JOB,
                                              "cutoff": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}))
        before = _session(f, day=(date.today() - timedelta(days=5)).isoformat())
        _past_log(f, before, 5)
        after = _session(f, day=(date.today() - timedelta(days=1)).isoformat())
        _past_log(f, after, 1)
        run(prepaid_close.past_pass())
        assert _get(before["id"])["status"] == "completed"
        assert _get(after["id"])["status"] == "approved" and _credits(f) == 2, "the sweep's, not the pass's"
        run(prepaid_close.sweep())
        assert _get(after["id"])["status"] == "completed" and _get(after["id"])["prepaid_close"]["source"] == "trainer_session"
        assert _credits(f) == 1


def test_a_dog_that_already_paid_for_another_lesson_that_day_waits_for_a_person(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        day = (date.today() - timedelta(days=3)).isoformat()
        b = _session(f, day=day)
        _past_log(f, b, 3)
        paid = {"id": f"{TAG}-paid-{uuid.uuid4().hex[:6]}", "dog_id": f["dog"]["id"], "client_id": f["client"]["id"], "date": day,
                "service_type": "training", "status": "completed", "amount_paid": 60.0, "created_at": server.now_iso()}
        run(server.db.bookings.insert_one(paid))
        out = run(prepaid_close.past_pass())
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert fam["needs_a_look"][0]["why"] == "the dog had another paid training visit that day"
        assert _get(b["id"])["status"] == "approved" and _credits(f) == 3


def test_a_lesson_logged_without_its_booking_closes_the_one_session_that_fits(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f)
        _, res = _finish_lesson(f, None)
        assert res["prepaid_session"]["closed"] is True and _get(b["id"])["status"] == "completed" and _credits(f) == 2


def test_with_two_sessions_that_day_an_unlinked_lesson_closes_neither(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        a, b = _session(f), _session(f, time="15:00")
        _, res = _finish_lesson(f, None)
        assert res["prepaid_session"] == {"closed": False, "reason": "no_session"}
        assert _get(a["id"])["status"] == _get(b["id"])["status"] == "approved" and _credits(f) == 3


def test_a_friends_and_family_session_or_a_reopened_checkout_is_left_for_the_desk(fresh_marker):
    with _family_with_program() as f:
        ff = _session(f, bill_to_client_id="someone-paying")
        _, res = _finish_lesson(f, ff)
        assert res["prepaid_session"] == {"closed": False, "reason": "friends_family"}
        reopened = _session(f, time="14:00", financial_reopened_at=server.now_iso())
        _, res = _finish_lesson(f, reopened)
        assert res["prepaid_session"] == {"closed": False, "reason": "reopened"}
        assert _credits(f) == 3 and _lot(f["lot_id"]) == 3


def test_with_the_family_balance_at_zero_no_lot_is_touched(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(server.db.clients.update_one({"id": f["client"]["id"]}, {"$set": {"training_credits": 0}}))
        b = _session(f)
        _, res = _finish_lesson(f, b)
        assert res["prepaid_session"]["closed"] is True and res["prepaid_session"]["credit_used"] is False
        assert _lot(f["lot_id"]) == 3 and _credits(f) == 0, "never below zero"


def test_the_sweep_leaves_lessons_before_the_cutoff_to_the_one_time_pass(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(server.db.system_runs.insert_one({"_id": prepaid_close.JOB,
                                              "cutoff": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}))
        before = _session(f, day=(date.today() - timedelta(days=5)).isoformat())
        _past_log(f, before, 5)
        run(prepaid_close.sweep())
        assert _get(before["id"])["status"] == "approved" and _credits(f) == 3


def test_a_pass_that_meets_a_busy_family_finishes_on_a_later_run(fresh_marker, monkeypatch):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f, day=(date.today() - timedelta(days=4)).isoformat())
        _past_log(f, b, 4)
        moved = _session(f, time="16:00")
        _past_log(f, moved, 6)                                     # needs a look — listed once, however many runs
        real = prepaid_close.tab_sync.acquire_client_guard

        async def busy(_cid):
            raise server.HTTPException(status_code=409, detail="busy")
        monkeypatch.setattr(prepaid_close.tab_sync, "acquire_client_guard", busy)
        first = run(prepaid_close.past_pass())
        assert "pass_done_at" not in first and _get(b["id"])["status"] == "approved"
        monkeypatch.setattr(prepaid_close.tab_sync, "acquire_client_guard", real)
        second = run(prepaid_close.past_pass())
        assert second.get("pass_done_at") and _get(b["id"])["status"] == "completed"
        fam = next(x for x in second["pass_families"] if x["client_id"] == f["client"]["id"])
        assert len(fam["closed"]) == 1 and [x["booking_id"] for x in fam["needs_a_look"]] == [moved["id"]]
        assert run(prepaid_close.past_pass()) == {"skipped": True}


# ─────────────────────────────────────────── review findings (audit #38)

def test_a_same_day_visit_on_the_tab_or_in_the_archive_waits_for_a_person(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        tab_day = (date.today() - timedelta(days=3)).isoformat()
        old_day = (date.today() - timedelta(days=120)).isoformat()
        on_tab, old = _session(f, day=tab_day), _session(f, day=old_day)
        _past_log(f, on_tab, 3)
        _past_log(f, old, 120)
        run(server.db.bookings.insert_one({"id": f"{TAG}-tab-{uuid.uuid4().hex[:6]}", "dog_id": f["dog"]["id"], "client_id": f["client"]["id"],
                                           "date": tab_day, "service_type": "training", "status": "completed", "payment_status": "unpaid",
                                           "amount_paid": 0.0, "balance_due": 60.0, "actual_price": 60.0, "created_at": server.now_iso()}))
        archived = {"id": f"{TAG}-arch-{uuid.uuid4().hex[:6]}", "dog_id": f["dog"]["id"], "client_id": f["client"]["id"], "date": old_day,
                    "service_type": "training", "status": "completed", "credits_deducted": 1, "created_at": server.now_iso()}
        run(server.db.bookings_archive.insert_one(archived))
        try:
            out = run(prepaid_close.past_pass())
        finally:
            run(server.db.bookings_archive.delete_many({"id": archived["id"]}))
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert sorted(x["booking_id"] for x in fam["needs_a_look"]) == sorted([on_tab["id"], old["id"]])
        assert all(x["why"] == "the dog had another paid training visit that day" for x in fam["needs_a_look"])
        assert not fam["closed"] and _credits(f) == 3


def test_an_unlinked_lesson_whose_close_couldnt_run_is_closed_by_the_sweep(fresh_marker, monkeypatch):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f)

        async def busy(_cid):
            raise server.HTTPException(status_code=409, detail="busy")
        monkeypatch.setattr(prepaid_close.tab_sync, "acquire_client_guard", busy)
        _, res = _finish_lesson(f, None)
        assert res["prepaid_session"] == {"closed": False, "reason": "busy"}
        log = run(server.db.training_session_log.find_one({"enrollment_id": f["enr"]["id"]}))
        assert log["booking_id"] is None and log["prepaid_session_id"] == b["id"]
        with pytest.raises(server.HTTPException):   # a recorded lesson is a lesson that happened
            run(prepaid_sessions.refuse_cancel_if_taught(server.db, _get(b["id"])))
        monkeypatch.undo()
        out = run(prepaid_close.sweep())
        assert out["closed"] == 1 and _get(b["id"])["status"] == "completed" and _credits(f) == 2


def test_the_sweep_matches_an_unlinked_lesson_the_process_never_got_to(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f)
        started = run(server.start_training_session_draft_direct(f["dog"]["id"], f["enr"]["id"], "restart", f["admin"], ""))
        log_id = f"{TAG}-log-{uuid.uuid4().hex[:6]}"
        run(server.db.training_session_log.insert_one({"id": log_id, "booking_id": None,
                                                        "draft_id": started["draft"]["id"], "enrollment_id": f["enr"]["id"],
                                                        "dog_id": f["dog"]["id"], "at": server.now_iso(), "by_user": "Trainer Tess"}))
        run(prepaid_close.sweep())
        assert _get(b["id"])["status"] == "completed" and _credits(f) == 2
        assert run(server.db.training_session_log.find_one({"id": log_id}))["prepaid_session_id"] == b["id"]
        later = _session(f, time="17:00")   # booked onto that day afterwards: the old lesson never moves to it
        run(server.db.system_runs.update_one({"_id": prepaid_close.JOB}, {"$unset": {"last_sweep_at": ""}}))
        run(prepaid_close.sweep())
        assert _get(later["id"])["status"] == "approved" and _credits(f) == 2


def test_the_pass_lists_past_lessons_logged_from_the_dogs_page_instead_of_closing_them(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        day = (date.today() - timedelta(days=5)).isoformat()
        b = _session(f, day=day)
        at = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        run(server.db.training_session_log.insert_one({"id": f"{TAG}-log-{uuid.uuid4().hex[:6]}", "booking_id": None,
                                                        "enrollment_id": f["enr"]["id"], "dog_id": f["dog"]["id"], "at": at}))
        out = run(prepaid_close.past_pass())
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert [x["booking_id"] for x in fam["needs_a_look"]] == [b["id"]] and "dog's page" in fam["needs_a_look"][0]["why"]
        assert _get(b["id"])["status"] == "approved" and _credits(f) == 3


def test_a_pass_cut_off_midway_still_reports_what_it_closed(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f, day=(date.today() - timedelta(days=4)).isoformat())
        _past_log(f, b, 4)
        run(prepaid_close.past_pass())
        # the process died before the summary was written: nothing saved, the claim went stale
        run(server.db.system_runs.update_one({"_id": prepaid_close.JOB}, {"$unset": {"pass_done_at": "", "pass_families": ""},
                                                                          "$set": {"pass_running_since": "2000-01-01T00:00:00+00:00"}}))
        out = run(prepaid_close.past_pass())
        fam = next(x for x in out["pass_families"] if x["client_id"] == f["client"]["id"])
        assert [x["booking_id"] for x in fam["closed"]] == [b["id"]] and fam["closed"][0]["credit_used"] is True
        assert fam["credits_left"] == 2 and _credits(f) == 2


def test_a_full_restore_runs_the_pass_again_and_a_partial_one_does_not(fresh_marker):
    with _family_with_program(credits=3) as f:
        run(prepaid_close._cutoff())
        b = _session(f, day=(date.today() - timedelta(days=4)).isoformat())
        _past_log(f, b, 4)
        run(prepaid_close.past_pass())
        # what a full restore of the night before brings back: the session open, the credit unused
        run(server.db.bookings.replace_one({"id": b["id"]}, dict(b)))
        run(server.db.credit_lots.update_one({"id": f["lot_id"]}, {"$set": {"qty_remaining": 3}}))
        run(server.db.clients.update_one({"id": f["client"]["id"]}, {"$set": {"training_credits": 3}}))
        both = {"bookings": [], "clients": []}
        run(prepaid_close.rearm_after_restore(server.db, both, "replace"))
        run(prepaid_close.rearm_after_restore(server.db, {**both, "credit_lots": []}, "merge"))
        assert run(prepaid_close.past_pass()) == {"skipped": True}, "partial or merge restores leave it alone"
        run(prepaid_close.rearm_after_restore(server.db, {**both, "credit_lots": []}, "replace"))
        run(prepaid_close.run_job())
        assert _get(b["id"])["status"] == "completed" and _credits(f) == 2 and _lot(f["lot_id"]) == 2
        run(prepaid_close.run_job())
        assert _credits(f) == 2, "once"


def test_the_restore_calls_the_rearm_before_and_after():
    import inspect
    from domains.backup import routes as backup_routes
    src = inspect.getsource(backup_routes)
    assert src.count("prepaid_close.rearm_after_restore(db, collections, mode)") == 2
