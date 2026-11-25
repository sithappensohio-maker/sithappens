"""A boarding dog checked out after its stay ended: the app asks, never assumes.

Before this a late boarding dog could be checked out with the extra-nights
counter left at 0 — the extra nights free, nobody asked (owner, 2026-11-25).
Now: no nights and no answer → refused with the question and nothing changes.
"Stayed" adds the nights by the existing extra-night rule. "Missed check out"
charges the booked nights only. Disposable tag TEST_LATE_STAY.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from fastapi import HTTPException
from _test_loop import run
from domains.bookings import late_stay
from test_late_day_checkout import ADMIN, _days_ago, _et, _row, _today

TAG = "TEST_LATE_STAY"


@pytest.fixture(autouse=True)
def _register_open():
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


@contextlib.contextmanager
def _stay(*, ended_days_ago=2, nights=2, dogs=1, credits=0, rate=50.0, **over):
    """A checked-in boarding stay of `nights` nights that ended `ended_days_ago` days ago."""
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": credits, "account_balance": 0.0}))
    if credits:
        run(server.db.credit_lots.insert_one({
            "id": str(uuid.uuid4()), "client_id": cid, "service_type": "boarding", "pack_name": f"{TAG} pack",
            "qty_total": credits, "qty_remaining": credits, "value_each": rate, "recognize_at_sale": True,
            "purchased_at": server.now_iso()}))
    start, end = _days_ago(ended_days_ago + nights), _days_ago(ended_days_ago)
    group_id = str(uuid.uuid4()) if dogs > 1 else None
    rows = []
    for i in range(dogs):
        did, bid = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"Stay{i}", "vaccines": {"rabies": "2099-01-01"}}))
        doc = {"id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": f"Stay{i}",
               "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
               "pickup_time": "10:00", "estimated_price": rate * nights, "unit_price": rate,
               "pricing_snapshot": {"unit_price": rate}, "credit_units_required": nights,
               "checked_in_at": _et(start, "10:00"), "checked_in_by": "test", "checked_out_at": None,
               "created_at": server.now_iso(), "group_id": group_id}
        doc.update(over)
        run(server.db.bookings.insert_one(dict(doc)))
        rows.append(doc)
    try:
        yield rows
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "credit_lots", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _paid(**body):
    return server.CheckoutIn(**{"use_credits": False, "payment_method": "card", "payment_status": "paid", **body})


def _checkout(bid, **body):
    return run(server.check_out(bid, _paid(**body), user=ADMIN))


def _ask(bid):
    for r in server.app.routes:
        if getattr(r, "path", "").endswith("/bookings/{booking_id}/late-stay-checkout") and "GET" in r.methods:
            return run(r.endpoint(bid, ADMIN))
    raise AssertionError("late-stay route not registered")


# ── the gate ──────────────────────────────────────────────────────────────

def test_a_late_stay_with_no_nights_and_no_answer_is_refused_and_changes_nothing():
    with _stay(ended_days_ago=3) as (b,):
        with pytest.raises(HTTPException) as e:
            _checkout(b["id"])
        d = e.value.detail
        assert e.value.status_code == 409 and d["code"] == late_stay.QUESTION_CODE
        assert d["nights"] == 3 and d["original_end_date"] == b["end_date"] and d["booking_ids"] == [b["id"]]
        assert "3 extra nights" in d["message"] and "missed check out" in d["message"]
        s = _row(b["id"])
        assert s["status"] == "approved" and not s.get("checked_out_at") and not s.get("checkout_in_progress")
        assert s["end_date"] == b["end_date"] and "late_stay_checkout" not in s


def test_missed_check_out_charges_only_the_booked_nights():
    with _stay(ended_days_ago=3, nights=2) as (b,):
        out = _checkout(b["id"], late_stay_resolution="missed_checkout")
        s = _row(b["id"])
        assert out["status"] == "completed" and s["end_date"] == b["end_date"]
        assert s["actual_price"] == 100.0 and not s.get("extra_nights")
        rec = s["late_stay_checkout"]
        assert rec["resolution"] == "missed_checkout" and rec["days_late"] == 3 and rec["extra_nights"] == 0
        assert rec["original_end_date"] == b["end_date"] and rec["by"] == ADMIN["id"] and rec["business_day"] == _today()
        # BookingOut drops what it doesn't declare, and CheckoutIn ignores an undeclared answer.
        assert "late_stay_checkout" in server.BookingOut.model_fields
        assert "late_stay_resolution" in server.CheckoutIn.model_fields


def test_stayed_adds_the_nights_and_bills_them_at_the_stays_rate():
    with _stay(ended_days_ago=2, nights=2) as (b,):
        _checkout(b["id"], late_stay_resolution="stayed", extra_nights=2, extra_nights_use_credits=False)
        s = _row(b["id"])
        assert s["status"] == "completed" and s["end_date"] == _today()
        assert s["extra_nights"]["count"] == 2 and s["extra_nights"]["charge"] == 100.0
        assert s["actual_price"] == 200.0
        assert s["late_stay_checkout"]["resolution"] == "stayed" and s["late_stay_checkout"]["extra_nights"] == 2


def test_stayed_uses_boarding_credits_first():
    with _stay(ended_days_ago=1, nights=2, credits=1) as (b,):
        _checkout(b["id"], late_stay_resolution="stayed", extra_nights=1, extra_nights_use_credits=True)
        s = _row(b["id"])
        assert s["extra_nights"]["credits_used"] == 1 and s["extra_nights"]["charge"] == 0
        assert run(server.db.clients.find_one({"id": b["client_id"]}, {"_id": 0}))["boarding_credits"] == 0


def test_nights_sent_without_an_answer_count_as_stayed():
    """Adding nights IS the answer — older callers and the plain counter keep working."""
    with _stay(ended_days_ago=1) as (b,):
        _checkout(b["id"], extra_nights=1, extra_nights_use_credits=False)
        s = _row(b["id"])
        assert s["status"] == "completed" and s["late_stay_checkout"]["resolution"] == "stayed"


@pytest.mark.parametrize("body,msg", [
    ({"late_stay_resolution": "missed_checkout", "extra_nights": 1}, late_stay.MSG_MISSED_WITH_NIGHTS),
    ({"late_stay_resolution": "stayed"}, late_stay.MSG_STAYED_NO_NIGHTS),
])
def test_an_answer_that_contradicts_the_nights_is_refused(body, msg):
    with _stay(ended_days_ago=1) as (b,):
        with pytest.raises(HTTPException) as e:
            _checkout(b["id"], **body)
        assert e.value.status_code == 400 and e.value.detail == msg
        s = _row(b["id"])
        assert s["status"] == "approved" and not s.get("checked_out_at") and "late_stay_checkout" not in s


# ── when it does not apply ────────────────────────────────────────────────

def test_a_stay_ending_today_is_never_asked():
    with _stay(ended_days_ago=0) as (b,):
        assert _ask(b["id"]) == {"applies": False}
        out = _checkout(b["id"])
        assert out["status"] == "completed" and "late_stay_checkout" not in _row(b["id"])


def test_an_answer_on_an_on_time_stay_is_ignored():
    with _stay(ended_days_ago=0) as (b,):
        _checkout(b["id"], late_stay_resolution="missed_checkout")
        assert "late_stay_checkout" not in _row(b["id"])


def test_only_a_checked_in_boarding_stay_is_asked():
    today = _today()
    base = {"service_type": "boarding", "date": _days_ago(4), "end_date": _days_ago(2), "status": "approved",
            "checked_in_at": _et(_days_ago(4), "10:00")}
    assert late_stay.applies(base, today)
    assert not late_stay.applies({**base, "service_type": "daycare"}, today)
    assert not late_stay.applies({**base, "checked_in_at": None}, today)
    assert not late_stay.applies({**base, "checked_out_at": server.now_iso()}, today)
    assert not late_stay.applies({**base, "status": "completed"}, today)
    assert not late_stay.applies({**base, "late_day_resolution": "stayed_overnight"}, today)
    assert not late_stay.applies({**base, "end_date": today}, today)
    # Back-filled today for past dates: it arrived today, so it isn't "still here".
    assert not late_stay.applies({**base, "checked_in_at": _et(today, "00:01")}, today)
    # A reopened checkout whose departure stands already has its day on record.
    assert not late_stay.applies({**base, "financial_reopened_at": server.now_iso(),
                                  "financial_reopen_history": [{}]}, today)


# ── the screen's question ─────────────────────────────────────────────────

def test_the_screen_is_told_the_question_and_the_nights():
    with _stay(ended_days_ago=4) as (b,):
        out = _ask(b["id"])
        assert out["applies"] is True and out["code"] == late_stay.QUESTION_CODE
        assert out["nights"] == 4 and out["dog_names"] == ["Stay0"]
        assert [r["value"] for r in out["resolutions"]] == ["stayed", "missed_checkout"]
        assert "late_stay_checkout" not in _row(b["id"])  # asking saves nothing


# ── household checkout ────────────────────────────────────────────────────

def test_a_household_checkout_is_refused_before_any_dog_is_locked():
    with _stay(ended_days_ago=2, dogs=2) as (a, b):
        assert sorted(_ask(a["id"])["dog_names"]) == ["Stay0", "Stay1"]
        with pytest.raises(HTTPException) as e:
            run(server.check_out_group(a["id"], _paid(), ADMIN))
        assert e.value.status_code == 409 and e.value.detail["code"] == late_stay.QUESTION_CODE
        assert sorted(e.value.detail["booking_ids"]) == sorted([a["id"], b["id"]])
        for row in (a, b):
            s = _row(row["id"])
            assert s["status"] == "approved" and not s.get("checkout_in_progress") and not s.get("checked_out_at")


def test_a_household_answer_that_contradicts_the_nights_is_refused_before_any_dog_is_locked():
    with _stay(ended_days_ago=2, dogs=2) as (a, b):
        with pytest.raises(HTTPException) as e:
            run(server.check_out_group(a["id"], _paid(late_stay_resolution="missed_checkout", extra_nights=1), ADMIN))
        assert e.value.status_code == 400 and e.value.detail == late_stay.MSG_MISSED_WITH_NIGHTS
        for row in (a, b):
            s = _row(row["id"])
            assert s["status"] == "approved" and not s.get("checkout_in_progress") and not s.get("checked_out_at")


def test_a_household_missed_check_out_stamps_every_dog():
    with _stay(ended_days_ago=2, dogs=2) as (a, b):
        run(server.check_out_group(a["id"], _paid(late_stay_resolution="missed_checkout"), ADMIN))
        for row in (a, b):
            s = _row(row["id"])
            assert s["status"] == "completed" and s["end_date"] == row["end_date"]
            assert s["late_stay_checkout"]["resolution"] == "missed_checkout"
