"""Care Board: every day of a stay is its own day, and the staff roster and
the Care Board are one record.

Audit #2 (2026-09-25), two confirmed pet-safety bugs:
  A. A multi-day stay was ONE day. Ticking Friday's 8:00 Apoquel showed
     Saturday, Sunday and Monday as done (nothing flagged a missed dose), and
     an unticked Friday made every later dose "missed" from midnight.
  B. A dose ticked on the staff (Employee) roster never reached the Care
     Board, Action Required or the Kennel Board, and vice versa — so the
     dose could be given twice.

These pin: per-day records, the clock applying on every day, one shared
record for both screens (with a refused second tick), yesterday's
unrecorded doses staying visible and alerting until someone says what
happened, the schedule following the dog's profile (the old roster read the
profile live), and the older data — whole-stay records, old roster ticks,
taps from a roster screen still on the old app — landing on the right day.
"""
import asyncio
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CARE_PER_DAY"
ADMIN = {"id": "care-admin", "role": "admin", "name": "Pat Owner", "email": "care-admin@example.com"}
STAFF = {"id": "care-staff", "role": "employee", "name": "Jamie Tran", "email": "jamie@example.com"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    ids = [d["id"] for d in run(server.db.dogs.find({"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(200))]
    run(server.db.bookings.delete_many({"dog_id": {"$in": ids}}))
    run(server.db.dogs.delete_many({"id": {"$in": ids}}))


@pytest.fixture()
def clock(monkeypatch):
    """Set the business clock (minutes since local midnight)."""
    def set_to(hh, mm=0):
        monkeypatch.setattr(server, "_now_business_minutes", lambda: hh * 60 + mm)
    set_to(10)
    return set_to


def _today():
    return server.business_today()


def _iso(day, hh, mm=0):
    """A UTC timestamp for a business-local wall-clock moment."""
    return datetime.combine(day, time(hh, mm), tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat()


def _stay(*, meds=(("Apoquel", ["08:00"]),), feeds=(), start_offset=-1, end_offset=1,
          checked_in=(-1, 6), care_items=None, since_offset=-1, logs=None):
    """A boarding stay around today. checked_in=(day offset, hour) or None.
    since_offset: tracked per day since (None = a booking from before this
    change, first read today)."""
    today = _today()
    dog = {
        "id": str(uuid.uuid4()), "name": f"{TAG} {uuid.uuid4().hex[:5]}", "owner_id": "care-client",
        "medications": [{"id": str(uuid.uuid4()), "name": n, "dosage": "1 tablet", "times": t, "with_food": False, "notes": ""}
                        for n, t in meds],
        "feeding_schedule": [{"id": str(uuid.uuid4()), "time": t, "amount": "1 cup", "food_type": "Kibble", "notes": ""}
                             for t in feeds],
    }
    run(server.db.dogs.insert_one(dict(dog)))
    booking = {
        "id": str(uuid.uuid4()), "dog_id": dog["id"], "dog_name": dog["name"],
        "client_id": "care-client", "client_name": f"{TAG} Owner", "service_type": "boarding",
        "status": "approved",
        "date": (today + timedelta(days=start_offset)).isoformat(),
        "end_date": (today + timedelta(days=end_offset)).isoformat(),
        "dropoff_time": "09:00", "pickup_time": "17:00", "created_at": server.now_iso(),
    }
    if checked_in:
        booking["checked_in_at"] = _iso(today + timedelta(days=checked_in[0]), checked_in[1])
    if care_items is not None:
        booking["care_items"] = care_items
    if since_offset is not None:
        booking["care_per_day_since"] = (today + timedelta(days=since_offset)).isoformat()
    if logs:
        booking["medication_log"] = logs
    run(server.db.bookings.insert_one(dict(booking)))
    return booking


def _dog_meds(b, meds):
    run(server.db.dogs.update_one({"id": b["dog_id"]}, {"$set": {"medications": [
        {"id": str(uuid.uuid4()), "name": n, "dosage": d, "times": t, "with_food": False, "notes": ""} for n, d, t in meds]}}))


def _board():
    return run(server.care_board_today(user=ADMIN))


def _board_rows(bid):
    b = _board()
    return [r for r in b["feedings"] + b["medications"] if r["booking_id"] == bid]


def _row(bid, time_str, kind="medication"):
    return next(r for r in _board_rows(bid) if r["time"] == time_str and r["kind"] == kind)


def _alerts(bid):
    return [a for a in run(server._collect_overdue_medication_actions()) if a["deep_link"]["booking_id"] == bid]


def _kennel_med_overdue(bid):
    board = run(server.get_kennel_board(user=ADMIN))
    card = next(c for cards in board["groups"].values() for c in cards if c["booking_id"] == bid)
    return card["warnings"]["med_overdue"]


def _roster_row(bid):
    return next(r for r in run(server.employee_roster_today(user=STAFF))["roster"] if r["booking_id"] == bid)


def _complete(bid, iid, **kw):
    return run(server.complete_care_item(bid, iid, server.CareCompleteIn(initials=kw.pop("initials", "jt"), **kw), ADMIN))


def _roster_tick(bid, iid, kind="medication", index=0, **kw):
    fn = server.employee_log_medication if kind == "medication" else server.employee_log_feeding
    return run(fn(bid, server.MedFeedLogIn(index=index, care_item_id=iid, **kw), user=STAFF))


# ───────────────────────────────────────────── A. each day is its own day

def test_a_dose_given_yesterday_is_not_done_today(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    yesterday = (_today() - timedelta(days=1)).isoformat()
    _complete(b["id"], iid, day=yesterday)

    clock(7)
    row = _row(b["id"], "08:00")
    assert row["derived_status"] == "not_due" and row["status"] == "pending", "yesterday's tick is not today's"
    assert "completed_initials" not in row, "yesterday's initials don't leak onto today"

    clock(10)
    row = _row(b["id"], "08:00")
    assert row["derived_status"] == "missed" and row["due_minutes_delta"] == 120, "today's dose is due by today's clock"
    [alert] = _alerts(b["id"])
    assert alert["id"] == f"overdue_medication:{b['id']}:{iid}"
    assert alert["waiting_minutes"] == 120 and alert["waiting_label"] == "2h overdue", "no more '0m overdue'"
    assert _kennel_med_overdue(b["id"]) is True, "a day-1 tick no longer hides later doses on the Kennel Board"

    _complete(b["id"], iid, initials="ab")
    row = _row(b["id"], "08:00")
    assert row["derived_status"] == "completed" and row["completed_initials"] == "AB"
    assert _alerts(b["id"]) == [] and _kennel_med_overdue(b["id"]) is False
    days = run(server.db.bookings.find_one({"id": b["id"]}))["care_items"][0]["days"]
    assert set(days) == {yesterday, _today().isoformat()}, "each day keeps its own record"
    assert days[yesterday]["completed_initials"] == "JT"


def test_a_later_day_is_timed_by_its_own_clock_not_missed_from_midnight(clock):
    b = _stay(meds=(("Evening pill", ["20:00"]),))
    clock(0, 5)
    assert _row(b["id"], "20:00")["derived_status"] == "not_due", "a 20:00 dose isn't missed at 00:05"
    today = _today().isoformat()
    assert [a for a in _alerts(b["id"]) if a["requested_date"] == today] == [], "tonight's dose isn't overdue yet"
    clock(19, 45)
    assert _row(b["id"], "20:00")["derived_status"] == "due_now"


def test_an_old_whole_stay_record_counts_only_for_the_day_it_was_made(clock):
    yesterday = _today() - timedelta(days=1)
    legacy = {"id": str(uuid.uuid4()), "kind": "medication", "time": "08:00", "label": "Apoquel", "amount": "1 tablet",
              "status": "completed", "completed_at": _iso(yesterday, 8, 5), "completed_initials": "JT",
              "completed_by_name": "Jo"}
    b = _stay(care_items=[legacy])
    row = _row(b["id"], "08:00")
    assert row["derived_status"] == "missed", "Friday's old record no longer covers Saturday"
    assert "completed_at" not in row

    today_legacy = {**legacy, "id": str(uuid.uuid4()), "completed_at": server.now_iso()}
    b2 = _stay(care_items=[today_legacy])
    assert _row(b2["id"], "08:00")["derived_status"] == "completed", "an old record made today still counts today"


# ──────────────────────────────── B. the roster and the Care Board are one

def test_a_roster_tick_is_the_care_board_record(clock):
    b = _stay(meds=(("Apoquel", ["08:00", "20:00"]),), feeds=("07:30",), start_offset=0, checked_in=(0, 6))
    row = _roster_row(b["id"])
    care = row["care_today"]
    assert [(c["kind"], c["time"]) for c in care] == [("feeding", "07:30"), ("medication", "08:00"), ("medication", "20:00")], \
        "one roster row per dose time, from the same schedule the Care Board uses"
    morning = next(c for c in care if c["time"] == "08:00")
    assert morning["id"] == _row(b["id"], "08:00")["id"], "same item ids on both screens"
    assert _alerts(b["id"]), "08:00 dose is overdue at 10:00 before anyone ticks it"

    res = _roster_tick(b["id"], morning["id"], index=0)
    assert res["ok"] and res["entry"]["care_item_id"] == morning["id"] and res["entry"]["label"] == "Apoquel"
    assert res["entry"]["day"] == _today().isoformat() and res["entry"]["index"] == 0

    board_row = _row(b["id"], "08:00")
    assert board_row["derived_status"] == "completed", "the Care Board sees the roster's tick"
    assert board_row["completed_initials"] == "JT" and board_row["source"] == "roster"
    assert _alerts(b["id"]) == [], "…and the Overdue Medication alert clears"
    assert _kennel_med_overdue(b["id"]) is False
    assert _row(b["id"], "20:00")["derived_status"] == "not_due", "the evening dose is a separate dose"

    doc = run(server.db.bookings.find_one({"id": b["id"]}))
    assert len(doc["medication_log"]) == 1 and doc["medication_log"][0]["by_name"] == "Jamie Tran", \
        "the client's care log still gets its entry"

    with pytest.raises(HTTPException) as again:
        _roster_tick(b["id"], morning["id"], index=0)
    assert again.value.status_code == 409 and "Already given today" in again.value.detail and "JT" in again.value.detail
    with pytest.raises(HTTPException) as board_again:
        _complete(b["id"], morning["id"])
    assert board_again.value.status_code == 409, "the Care Board can't record it a second time either"
    assert len(run(server.db.bookings.find_one({"id": b["id"]}))["medication_log"]) == 1


def test_a_care_board_tick_shows_on_the_roster(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    _complete(b["id"], iid, initials="pw")
    [c] = _roster_row(b["id"])["care_today"]
    assert c["derived_status"] == "completed" and c["completed_initials"] == "PW" and c["source"] == "care_board"
    with pytest.raises(HTTPException) as e:
        _roster_tick(b["id"], iid)
    assert e.value.status_code == 409 and "PW" in e.value.detail


def test_a_skipped_dose_can_still_be_given_later(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    run(server.skip_care_item(b["id"], iid, server.CareSkipIn(initials="jt", reason="Dog refused", note="retry at 11"), ADMIN))
    assert _row(b["id"], "08:00")["derived_status"] == "skipped"
    _roster_tick(b["id"], iid)
    assert _row(b["id"], "08:00")["derived_status"] == "completed"


def test_a_tap_from_a_roster_screen_still_on_the_old_app_records_its_dose(clock):
    b = _stay(meds=(("Apoquel", ["08:00", "20:00"]),))
    clock(8, 10)
    res = run(server.employee_log_medication(b["id"], server.MedFeedLogIn(index=0, note="hidden in cheese"), user=STAFF))
    assert res["entry"]["index"] == 0 and res["entry"]["note"] == "hidden in cheese", "the old entry shape is kept"
    assert _row(b["id"], "08:00")["derived_status"] == "completed", "matched to the dose closest to the tap"
    assert _row(b["id"], "20:00")["derived_status"] == "not_due"
    # a position the dog's list doesn't have is only logged, as before
    run(server.employee_log_medication(b["id"], server.MedFeedLogIn(index=7), user=STAFF))
    doc = run(server.db.bookings.find_one({"id": b["id"]}))
    assert len(doc["medication_log"]) == 2 and "care_item_id" not in doc["medication_log"][1]


def test_a_tap_for_an_item_not_on_the_visit_is_refused(clock):
    b = _stay()
    _board()
    with pytest.raises(HTTPException) as e:
        _roster_tick(b["id"], "not-a-real-item")
    assert e.value.status_code == 404
    assert not run(server.db.bookings.find_one({"id": b["id"]})).get("medication_log")


def test_two_taps_at_once_record_one_dose(clock):
    b = _stay(meds=(("Apoquel", ["08:00"]), ("Gabapentin", ["08:00"])))
    items = _roster_row(b["id"])["care_today"]
    a, g = items[0]["id"], items[1]["id"]

    async def both(first, second):
        return await asyncio.gather(
            server.employee_log_medication(b["id"], server.MedFeedLogIn(index=0, care_item_id=first), user=STAFF),
            server.employee_log_medication(b["id"], server.MedFeedLogIn(index=0, care_item_id=second), user=STAFF),
            return_exceptions=True)

    same = run(both(a, a))
    assert sorted(type(r).__name__ for r in same) == ["HTTPException", "dict"], "one of two simultaneous ticks is refused"
    other = run(both(g, g))  # the other med is its own dose: one of its two ticks lands too
    assert sum(isinstance(r, dict) for r in other) == 1
    doc = run(server.db.bookings.find_one({"id": b["id"]}))
    assert len(doc["medication_log"]) == 2, "exactly one log entry per dose"
    today = _today().isoformat()
    assert all(it["days"][today]["status"] == "completed" for it in doc["care_items"]), "neither tick was lost"


# ──────────────────────────────────── yesterday's unrecorded doses

def test_yesterdays_unrecorded_doses_stay_listed_until_resolved(clock):
    yesterday = (_today() - timedelta(days=1)).isoformat()
    b = _stay(meds=(("Apoquel", ["08:00", "20:00"]),), checked_in=(-1, 6))
    morning = _row(b["id"], "08:00")["id"]
    _complete(b["id"], morning, day=yesterday)

    earlier = [r for r in _board()["earlier"] if r["booking_id"] == b["id"]]
    assert [(r["time"], r["day"], r["derived_status"]) for r in earlier] == [("20:00", yesterday, "missed")]
    run(server.skip_care_item(b["id"], earlier[0]["id"], server.CareSkipIn(initials="jt", reason="Sleeping", day=yesterday), ADMIN))
    assert not [r for r in _board()["earlier"] if r["booking_id"] == b["id"]], "recording it clears the list"


def test_doses_before_the_dog_arrived_are_not_counted(clock):
    late_arrival = _stay(meds=(("Apoquel", ["08:00", "20:00"]),), checked_in=(-1, 15))
    times = [r["time"] for r in _board()["earlier"] if r["booking_id"] == late_arrival["id"]]
    assert times == ["20:00"], "the 08:00 dose was the owner's — the dog arrived at 15:00"

    not_here = _stay(checked_in=None)
    arrived_today = _stay(checked_in=(0, 7))
    ids = {r["booking_id"] for r in _board()["earlier"]}
    assert not_here["id"] not in ids and arrived_today["id"] not in ids


# ──────────────────────────────────────────── writes: days, reset, edit

def test_a_day_must_be_within_the_visit_and_not_in_the_future(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    for bad, status in (((_today() + timedelta(days=1)).isoformat(), 400),
                        ((_today() - timedelta(days=5)).isoformat(), 400),
                        ("yesterday", 422)):
        with pytest.raises(HTTPException) as e:
            _complete(b["id"], iid, day=bad)
        assert e.value.status_code == status, bad


def test_reset_undoes_one_day_only(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    yesterday = (_today() - timedelta(days=1)).isoformat()
    _complete(b["id"], iid, day=yesterday)
    _complete(b["id"], iid)
    out = run(server.reset_care_item(b["id"], iid, None, ADMIN))
    [item] = out["items"]
    assert item["status"] == "pending" and "skip_reason" not in item and item["derived_status"] in ("not_due", "due_now", "missed")
    days = run(server.db.bookings.find_one({"id": b["id"]}))["care_items"][0]["days"]
    assert list(days) == [yesterday], "yesterday's record survives today's undo"


def test_reset_also_clears_an_old_record_for_its_own_day(clock):
    legacy = {"id": str(uuid.uuid4()), "kind": "medication", "time": "08:00", "label": "Apoquel",
              "status": "completed", "completed_at": server.now_iso(), "completed_initials": "JT"}
    b = _stay(care_items=[legacy])
    run(server.reset_care_item(b["id"], legacy["id"], None, ADMIN))
    assert _row(b["id"], "08:00")["derived_status"] == "missed"
    stored = run(server.db.bookings.find_one({"id": b["id"]}))["care_items"][0]
    assert stored["status"] == "pending" and "completed_at" not in stored


def test_editing_the_schedule_keeps_every_recorded_day(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    yesterday = (_today() - timedelta(days=1)).isoformat()
    _complete(b["id"], iid, day=yesterday)
    _complete(b["id"], iid)
    body = server.CareScheduleIn(items=[
        server.CareItemSetupIn(id=iid, kind="medication", time="08:00", label="Apoquel 16mg"),
        server.CareItemSetupIn(kind="feeding", time="13:00", label="Lunch"),
    ])
    out = run(server.set_booking_care(b["id"], body, ADMIN))
    kept = next(i for i in out["items"] if i["id"] == iid)
    assert kept["derived_status"] == "completed" and kept["label"] == "Apoquel 16mg"
    days = run(server.db.bookings.find_one({"id": b["id"]}))["care_items"]
    assert set(next(i for i in days if i["id"] == iid)["days"]) == {yesterday, _today().isoformat()}


def test_midnight_doses_sort_first_not_last(clock):
    b = _stay(meds=(("Night pill", ["00:00"]), ("Morning pill", ["08:00"])))
    assert [r["time"] for r in _board_rows(b["id"])] == ["00:00", "08:00"]


# ───────────────────────── the schedule follows the dog's profile

def test_a_med_added_to_the_profile_mid_stay_appears_on_every_screen(clock):
    b = _stay()
    assert [c["label"] for c in _roster_row(b["id"])["care_today"]] == ["Apoquel"]
    _dog_meds(b, [("Apoquel", "1 tablet", ["08:00"]), ("Insulin", "4 units", ["09:00"])])
    assert [c["label"] for c in _roster_row(b["id"])["care_today"]] == ["Apoquel", "Insulin"], \
        "the old roster showed the profile live — the new one must too"
    insulin = _row(b["id"], "09:00")
    assert insulin["label"] == "Insulin" and insulin["derived_status"] == "missed"
    assert any(a["deep_link"]["care_item_id"] == insulin["id"] for a in _alerts(b["id"]))


def test_a_med_taken_off_the_profile_stops_being_due_but_keeps_its_history(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    yesterday = (_today() - timedelta(days=1)).isoformat()
    _complete(b["id"], iid, day=yesterday)
    _dog_meds(b, [])
    assert _board_rows(b["id"]) == [] and _alerts(b["id"]) == [] and _kennel_med_overdue(b["id"]) is False
    [stored] = run(server.db.bookings.find_one({"id": b["id"]}))["care_items"]
    assert stored["retired_on"] == _today().isoformat() and yesterday in stored["days"], "history stays"
    with pytest.raises(HTTPException) as e:
        _roster_tick(b["id"], iid)
    assert e.value.status_code == 404
    _dog_meds(b, [("Apoquel", "1 tablet", ["08:00"])])
    assert _row(b["id"], "08:00")["id"] == iid, "put back on the profile, it's the same item again"


def test_a_dose_change_on_the_profile_updates_the_visit(clock):
    b = _stay()
    _board()
    _dog_meds(b, [("Apoquel", "2 tablets", ["08:00"])])
    assert _row(b["id"], "08:00")["amount"] == "2 tablets"


def test_a_hand_set_schedule_does_not_follow_the_profile(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    run(server.set_booking_care(b["id"], server.CareScheduleIn(items=[
        server.CareItemSetupIn(id=iid, kind="medication", time="08:00", label="Apoquel", amount="half tablet")]), ADMIN))
    _dog_meds(b, [("Apoquel", "1 tablet", ["08:00"]), ("Insulin", "4 units", ["09:00"])])
    assert [(r["label"], r["amount"]) for r in _board_rows(b["id"])] == [("Apoquel", "half tablet")]


# ─────────────────────── yesterday's misses keep alerting until resolved

def test_last_nights_missed_dose_keeps_alerting_until_someone_records_it(clock):
    b = _stay(meds=(("Evening pill", ["20:00"]),))
    yesterday = (_today() - timedelta(days=1)).isoformat()
    clock(9)
    [alert] = _alerts(b["id"])
    iid = alert["deep_link"]["care_item_id"]
    assert alert["id"] == f"overdue_medication:{b['id']}:{iid}:{yesterday}", "its own id — never collides with today's"
    assert alert["requested_date"] == yesterday and alert["deep_link"]["day"] == yesterday
    assert alert["waiting_minutes"] == 13 * 60 and alert["waiting_label"] == "13h overdue"
    assert _kennel_med_overdue(b["id"]) is True
    _complete(b["id"], iid, day=yesterday)
    assert _alerts(b["id"]) == [] and _kennel_med_overdue(b["id"]) is False


def test_a_dose_too_late_to_miss_before_midnight_still_alerts_next_morning(clock):
    b = _stay(meds=(("Late pill", ["23:45"]),))
    clock(7)
    [alert] = _alerts(b["id"])
    assert alert["requested_time"] == "23:45" and alert["requested_date"] == (_today() - timedelta(days=1)).isoformat()


def test_a_roster_tap_records_the_day_the_roster_was_showing(clock):
    b = _stay(meds=(("Evening pill", ["20:00"]),))
    yesterday = (_today() - timedelta(days=1)).isoformat()
    clock(0, 10)
    iid = _row(b["id"], "20:00")["id"]
    res = _roster_tick(b["id"], iid, day=yesterday)
    assert res["entry"]["day"] == yesterday
    clock(20, 45)
    assert _row(b["id"], "20:00")["derived_status"] == "missed", "tonight's dose is NOT marked given by last night's tap"


# ─────────────────────────────── the day this change ships

def test_the_day_this_ships_does_not_flag_yesterday(clock):
    legacy = {"id": str(uuid.uuid4()), "kind": "medication", "time": "20:00", "label": "Apoquel",
              "amount": "1 tablet", "status": "pending"}
    b = _stay(meds=(("Apoquel", ["20:00"]),), care_items=[legacy], since_offset=None)
    assert [r for r in _board()["earlier"] if r["booking_id"] == b["id"]] == [], \
        "the old screens never recorded per day — don't call all of yesterday 'not recorded'"
    assert _alerts(b["id"]) == []
    assert run(server.db.bookings.find_one({"id": b["id"]}))["care_per_day_since"] == _today().isoformat()


def test_this_mornings_old_roster_ticks_carry_over(clock):
    today = _today()
    items = [{"id": str(uuid.uuid4()), "kind": "medication", "time": t, "label": "Apoquel", "amount": "1 tablet",
              "status": "pending"} for t in ("08:00", "20:00")]
    tick = {"index": 0, "note": "", "photo": "", "at": _iso(today, 8, 12), "by_id": "x", "by_name": "Jamie Tran"}
    b = _stay(meds=(("Apoquel", ["08:00", "20:00"]),), care_items=items, since_offset=None, logs=[tick])
    morning = _row(b["id"], "08:00")
    assert morning["derived_status"] == "completed" and morning["completed_initials"] == "JT" and morning["source"] == "roster"
    assert _row(b["id"], "20:00")["derived_status"] == "not_due"


# ─────────────────────────────────────────────────── payload hygiene

def test_the_roster_leaves_photo_proofs_out_of_its_copy_of_the_logs(clock):
    b = _stay()
    iid = _row(b["id"], "08:00")["id"]
    _roster_tick(b["id"], iid, photo="data:image/jpeg;base64," + "A" * 5000)
    [entry] = _roster_row(b["id"])["medication_log"]
    assert entry["has_photo"] is True and "photo" not in entry
    assert run(server.db.bookings.find_one({"id": b["id"]}))["medication_log"][0]["photo"].startswith("data:image/"), \
        "the proof itself is kept for the client's care log"


def test_an_oversized_photo_is_refused():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        server.MedFeedLogIn(index=0, photo="x" * 2_000_001)
