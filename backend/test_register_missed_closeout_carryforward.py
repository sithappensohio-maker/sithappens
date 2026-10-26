"""A missed register close-out must not drop the day's real cash activity.

Reported bug: the owner did a cash till draw (owner_draw) one day, forgot to
run the end-of-day closeout for that day, and the next day's expected till
"reverted" to the amount from BEFORE the draw — as if the draw had never
happened.

Root cause: the register's opening-cash resolution jumped straight to the
last CONFIRMED closeout's rollover (_previous_closeout_rollover), however
many days back that was. Any till adjustment or cash sale recorded on an
unclosed day in between was scoped to that day's own date and never folded
into a later day's opening, so it silently vanished from every later day's
"expected cash" until someone went back and formally closed that exact day.

_effective_previous_closeout fixes this by carrying the real previous
closeout's rollover forward through each unclosed day's own net cash change
(via _register_day_cash_flow) before handing it to a later day as its
suggested/expected opening.

Same harness conventions as test_register_expected_cash.py: direct async
server calls on the disposable test DB, synthetic past dates nothing else
in the suite touches, disposable rows tagged TEST_REG_MISSED_CLOSEOUT,
cleanup in finally.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_REG_MISSED_CLOSEOUT"


def _summary(d):
    return run(server._register_day_summary(d))


# ── Test A — one missed day carries its draw forward ─────────────────────────
def test_a_missed_closeout_carries_forward_a_cash_draw():
    closed_day = "2002-03-10"
    missed_day = "2002-03-11"   # draw happened here; never closed out
    today = "2002-03-12"        # the day the owner is looking at
    closeout_id = str(uuid.uuid4())
    till_id = str(uuid.uuid4())
    try:
        # closed_day was properly closed with a confirmed $100 rollover.
        run(server.db.daily_closeouts.insert_one({
            "id": closeout_id, "date": closed_day, "created_at": f"{closed_day}T20:00:00",
            "created_by": TAG, "created_by_name": TAG,
            "cash_counted": 100.0, "rollover_cash": 100.0, "rollover_confirmed": True,
            "status": "closed",
        }))

        # missed_day: a $30 owner draw was taken from the till, but the day
        # was never closed out — no daily_closeouts row for it at all.
        run(server.db.till_adjustments.insert_one({
            "id": till_id, "date": missed_day, "direction": "remove", "amount": 30.0,
            "reason": f"{TAG} owner draw", "adjustment_type": "owner_draw",
            "notes": "", "created_at": f"{missed_day}T18:00:00",
            "created_by": TAG, "created_by_name": TAG,
        }))

        # today never had its own drawer session opened either — nobody
        # closed, nobody manually re-typed an opening number, the register
        # just kept running.
        today_summary = _summary(today)
        # Opening/expected cash must be $100 (confirmed rollover) minus the
        # $30 draw that happened on the unclosed day in between = $70. The
        # bug reverted this straight to $100, as if the draw never happened.
        assert abs(today_summary["totals"]["opening_cash"] - 70.0) < 0.005
        assert abs(today_summary["totals"]["expected_cash"] - 70.0) < 0.005
        assert today_summary["opening_rollover"]["carried_forward_days"] == 1
        assert today_summary["opening_rollover"]["from_date"] == closed_day

        # The missed day itself still shows its own draw when looked at
        # directly, and its own opening is still the real $100 rollover —
        # nothing before IT was skipped.
        missed_summary = _summary(missed_day)
        assert abs(missed_summary["totals"]["till_removals"] - 30.0) < 0.005
        assert abs(missed_summary["totals"]["opening_cash"] - 100.0) < 0.005
        assert abs(missed_summary["totals"]["expected_cash"] - 70.0) < 0.005
        assert missed_summary["opening_rollover"]["carried_forward_days"] == 0
    finally:
        run(server.db.daily_closeouts.delete_many({"id": closeout_id}))
        run(server.db.till_adjustments.delete_many({"id": till_id}))


# ── Test B — two consecutive missed days both carry forward ──────────────────
def test_b_two_consecutive_missed_days_both_carry_forward():
    closed_day = "2002-04-10"
    missed_day_1 = "2002-04-11"  # $30 draw
    missed_day_2 = "2002-04-12"  # $20 cash sale
    today = "2002-04-13"
    closeout_id = str(uuid.uuid4())
    till_id = str(uuid.uuid4())
    sale_row_id = str(uuid.uuid4())
    try:
        run(server.db.daily_closeouts.insert_one({
            "id": closeout_id, "date": closed_day, "created_at": f"{closed_day}T20:00:00",
            "created_by": TAG, "created_by_name": TAG,
            "cash_counted": 100.0, "rollover_cash": 100.0, "rollover_confirmed": True,
            "status": "closed",
        }))
        run(server.db.till_adjustments.insert_one({
            "id": till_id, "date": missed_day_1, "direction": "remove", "amount": 30.0,
            "reason": f"{TAG} owner draw", "adjustment_type": "owner_draw",
            "notes": "", "created_at": f"{missed_day_1}T18:00:00",
            "created_by": TAG, "created_by_name": TAG,
        }))
        run(server.db.retail_sales.insert_one({
            "id": sale_row_id, "date": missed_day_2, "amount": 20.0, "payment_method": "cash",
            "description": f"{TAG} cash sale", "created_at": f"{missed_day_2}T10:00:00",
        }))

        # 100 (confirmed) - 30 (day 1 draw) + 20 (day 2 cash sale) = 90
        today_summary = _summary(today)
        assert abs(today_summary["totals"]["opening_cash"] - 90.0) < 0.005
        assert abs(today_summary["totals"]["expected_cash"] - 90.0) < 0.005
        assert today_summary["opening_rollover"]["carried_forward_days"] == 2
        assert today_summary["opening_rollover"]["from_date"] == closed_day
    finally:
        run(server.db.daily_closeouts.delete_many({"id": closeout_id}))
        run(server.db.till_adjustments.delete_many({"id": till_id}))
        run(server.db.retail_sales.delete_many({"id": sale_row_id}))


# ── Test C — nothing happened on the skipped day: carry-forward is a no-op ───
def test_c_no_activity_on_skipped_day_leaves_rollover_unchanged():
    closed_day = "2002-05-10"
    today = "2002-05-12"  # 2002-05-11 is skipped: never closed, nothing happened
    closeout_id = str(uuid.uuid4())
    try:
        run(server.db.daily_closeouts.insert_one({
            "id": closeout_id, "date": closed_day, "created_at": f"{closed_day}T20:00:00",
            "created_by": TAG, "created_by_name": TAG,
            "cash_counted": 100.0, "rollover_cash": 100.0, "rollover_confirmed": True,
            "status": "closed",
        }))
        today_summary = _summary(today)
        assert abs(today_summary["totals"]["opening_cash"] - 100.0) < 0.005
        assert today_summary["opening_rollover"]["carried_forward_days"] == 1
    finally:
        run(server.db.daily_closeouts.delete_many({"id": closeout_id}))
