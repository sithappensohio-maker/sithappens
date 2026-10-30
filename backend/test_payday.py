"""Payday: the pay schedule says when staff are paid, and on payday the app
says who is owed what (domains/staff/payday.py).

A payday pays every shift since the previous payday, up to the day before.
The amounts come from the Payroll Tax estimate, so the owner (a draw, not
payroll) is never in them. The Today feed shows a payday card to staff who
can see payroll, until it is dismissed; paydays from before the schedule was
saved never show one. Disposable tag TEST_PAYDAY; the saved schedule row is
put back as it was after the module.
"""
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.staff.payday import CADENCE_DAYS, latest_payday, pay_period, payday_period, saved_schedule

TAG = "TEST_PAYDAY"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
_saved_schedule = None


def setup_module():
    global _saved_schedule
    _saved_schedule = run(server.db.settings.find_one({"id": "payroll_schedule"}, {"_id": 0}))


def teardown_module():
    run(server.db.payroll_payments.delete_many({"request_id": {"$regex": f"^{TAG}"}}))
    run(server.db.till_adjustments.delete_many({"reason": {"$regex": "^Payroll: paid Payday "}}))
    run(server.db.daily_closeouts.delete_many({"tag": TAG}))
    run(server.db.time_clock_entries.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"tag": TAG}))
    run(server.db.task_dismissals.delete_many({"item_id": {"$regex": "^payday-due:"}, "dismissed_by": TAG}))
    run(server.db.settings.delete_one({"id": "payroll_schedule"}))
    if _saved_schedule:
        run(server.db.settings.insert_one(dict(_saved_schedule)))


def _user(role="employee", rate=None, **extra):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
         "name": f"Payday {uuid.uuid4().hex[:4]}", "role": role, "active": True, "password_hash": "x",
         "token_version": 0, "tag": TAG, **extra}
    if rate is not None:
        u["hourly_rate"] = rate
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _shift(user, day: date, hours, open_shift=False):
    clock_in = datetime(day.year, day.month, day.day, 13, 0, tzinfo=timezone.utc)   # 9 AM in Ohio
    doc = {"id": f"{TAG}-s-{uuid.uuid4().hex[:8]}", "user_id": user["id"], "user_name": user["name"],
           "clock_in_at": clock_in.isoformat(),
           "clock_out_at": None if open_shift else (clock_in + timedelta(hours=hours)).isoformat(),
           "break_minutes": 0, "hours": None if open_shift else float(hours), "tag": TAG}
    run(server.db.time_clock_entries.insert_one(doc))
    return doc


def _fresh():
    """Each test starts with none of this file's shifts, payments or hidden payday cards."""
    run(server.db.payroll_payments.delete_many({"request_id": {"$regex": f"^{TAG}"}}))
    run(server.db.time_clock_entries.delete_many({"tag": TAG}))
    run(server.db.task_dismissals.delete_many({"item_id": {"$regex": "^payday-due:"}}))


def _set_schedule(admin, cadence, anchor: date):
    res = run(_http.put("/api/admin/payroll/schedule", headers=_auth(admin),
                        json={"cadence": cadence, "anchor_payday": anchor.isoformat()}))
    assert res.status_code == 200, res.text
    return res.json()


def _row(body, user):
    return next((u for u in body["per_user"] if u["user_id"] == user["id"]), None)


def _save_row(cadence, anchor: date, set_on: date):
    """A schedule as it would have been saved on an earlier day."""
    run(server.db.settings.delete_one({"id": "payroll_schedule"}))
    run(server.db.settings.insert_one({"id": "payroll_schedule", "cadence": cadence,
                                       "anchor_payday": anchor.isoformat(), "set_on": set_on.isoformat()}))


def _payday_items(admin):
    out = run(server.admin_today_brain(admin))
    return ([i for i in out["items"] if i["kind"] == "payday_due"],
            [i for i in out["hidden"] if i["kind"] == "payday_due"])


def test_paydays_repeat_both_ways_from_the_anchor_and_pay_up_to_the_day_before():
    anchor = date(2026, 10, 30)
    assert latest_payday(anchor, 14, date(2026, 10, 30)) == date(2026, 10, 30)
    assert latest_payday(anchor, 14, date(2026, 11, 12)) == date(2026, 10, 30)
    assert latest_payday(anchor, 14, date(2026, 11, 13)) == date(2026, 11, 13)
    # An anchor that hasn't come yet still places the paydays before it.
    assert latest_payday(anchor, 14, date(2026, 10, 29)) == date(2026, 10, 16)
    assert pay_period(date(2026, 10, 30), 14) == (date(2026, 10, 16), date(2026, 10, 29))
    assert pay_period(date(2026, 10, 30), 7) == (date(2026, 10, 23), date(2026, 10, 29))


def _simulate(initial, saves, first=date(2026, 10, 1), last=date(2027, 1, 31)):
    """Live through every day: apply that day's schedule saves first, then pay
    the payday if its card shows. Returns the (start, end) of every paid period."""
    sched = {"id": "payroll_schedule", "cadence": initial[0], "anchor_payday": initial[1].isoformat(), "set_on": "2026-09-01"}
    paid = []
    day = first
    while day <= last:
        for on, cadence, anchor in saves:
            if on == day:
                sched = saved_schedule(sched, cadence, anchor, day)
        every = CADENCE_DAYS[sched["cadence"]]
        if latest_payday(date.fromisoformat(sched["anchor_payday"]), every, day) == day and day.isoformat() >= sched["set_on"]:
            start, end, before_change = payday_period(sched, day)
            if not before_change:
                paid.append((start, end))
        day += timedelta(days=1)
    return paid


FRI = date(2026, 10, 30)
SCHEDULE_CHANGES = {
    "biweekly to weekly, saved on the unpaid payday": (("biweekly", date(2026, 10, 16)), [(FRI, "weekly", FRI)]),
    "biweekly to weekly, saved before the payday": (("biweekly", date(2026, 10, 16)), [(date(2026, 10, 27), "weekly", FRI)]),
    "weekly Fridays to Mondays, saved midweek": (("weekly", date(2026, 10, 23)), [(date(2026, 10, 28), "weekly", date(2026, 11, 2))]),
    "weekly Fridays to Saturdays": (("weekly", date(2026, 10, 23)), [(date(2026, 10, 28), "weekly", date(2026, 10, 31))]),
    "weekly Fridays to every other Monday": (("weekly", date(2026, 10, 23)), [(date(2026, 10, 28), "biweekly", date(2026, 10, 26))]),
    "Fridays to Thursdays, saved on the Friday payday": (("weekly", date(2026, 10, 23)), [(FRI, "weekly", date(2026, 10, 29))]),
    "changed on payday, changed back the next day": (("weekly", date(2026, 10, 23)), [(FRI, "weekly", date(2026, 11, 2)), (date(2026, 10, 31), "weekly", FRI)]),
    "weekly to biweekly the day after payday": (("weekly", date(2026, 10, 23)), [(date(2026, 10, 31), "biweekly", FRI)]),
    "biweekly to weekly on a Monday": (("biweekly", FRI), [(date(2026, 11, 9), "weekly", date(2026, 11, 9))]),
    "three changes in a row": (("weekly", date(2026, 10, 23)), [(date(2026, 10, 28), "biweekly", date(2026, 11, 6)),
                                                               (date(2026, 11, 2), "weekly", date(2026, 11, 2)),
                                                               (date(2026, 11, 20), "biweekly", date(2026, 11, 27))]),
    "same paydays saved again two ways": (("biweekly", date(2026, 10, 16)), [(date(2026, 10, 31), "biweekly", date(2026, 11, 13)),
                                                                           (date(2026, 11, 5), "biweekly", date(2026, 10, 2))]),
}


def test_every_day_worked_is_paid_exactly_once_through_any_schedule_change():
    for name, (initial, saves) in SCHEDULE_CHANGES.items():
        paid = _simulate(initial, saves)
        assert len(paid) >= 5, name
        for (_, end), (start, _) in zip(paid, paid[1:]):
            # Each paid period starts the day after the previous one ended: no gap, no overlap.
            assert start == end + timedelta(days=1), f"{name}: {paid}"


def test_random_schedule_histories_also_pay_every_day_exactly_once():
    rng = random.Random(7)
    for _ in range(300):
        initial = (rng.choice(["weekly", "biweekly"]), date(2026, 10, 1) + timedelta(days=rng.randrange(-20, 20)))
        saves, day = [], date(2026, 10, 5)
        for _ in range(rng.randint(1, 4)):
            day += timedelta(days=rng.randint(0, 20))   # 0: two saves on the same day
            saves.append((day, rng.choice(["weekly", "biweekly"]), day + timedelta(days=rng.randrange(-20, 21))))
        paid = _simulate(initial, saves, last=date(2027, 3, 31))
        for (_, end), (start, _) in zip(paid, paid[1:]):
            assert start == end + timedelta(days=1), f"{initial} {saves}: {paid}"


def test_payday_says_what_each_staff_member_is_owed_for_the_period():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    alex = _user(rate=20.0)
    bea = _user(rate=15.0)
    owner = _user(role="admin", rate=40.0, is_owner=True)
    open_before = _set_schedule(admin, "biweekly", today)["open_shifts"]

    _shift(alex, today - timedelta(days=14), 4)   # first day of the period: paid
    _shift(alex, today - timedelta(days=3), 8)
    _shift(alex, today - timedelta(days=15), 6)   # previous period: not paid today
    _shift(alex, today, 5)                        # payday itself: next period
    _shift(bea, today - timedelta(days=1), 10)    # last day of the period: paid
    _shift(bea, today - timedelta(days=2), 0, open_shift=True)
    _shift(owner, today - timedelta(days=4), 8)   # a draw, never payroll

    body = _set_schedule(admin, "biweekly", today)
    assert body["configured"] is True
    assert body["payday"] == today.isoformat() and body["is_today"] is True
    assert body["period_start"] == (today - timedelta(days=14)).isoformat()
    assert body["period_end"] == (today - timedelta(days=1)).isoformat()
    assert body["next_payday"] == (today + timedelta(days=14)).isoformat()
    assert _row(body, alex)["gross"] == 240.0     # (4 + 8) h x $20
    assert _row(body, bea)["gross"] == 150.0      # 10 h x $15
    assert _row(body, owner) is None
    assert body["open_shifts"] - open_before == 1


def test_today_feed_shows_the_payday_card_until_it_is_dismissed():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    cara = _user(rate=18.0)
    _shift(cara, today - timedelta(days=5), 5)
    _set_schedule(admin, "biweekly", today)

    shown, _ = _payday_items(admin)
    assert len(shown) == 1
    card = shown[0]
    assert card["id"] == f"payday-due:{today.isoformat()}"
    assert card["priority"] == "urgent"
    assert card["title"].startswith("Payday today — you owe $")
    assert f"{cara['name']} $90.00" in card["subtitle"]
    assert card["cta"] == {"type": "open_screen", "screen": "staff", "tab": "payroll"}
    # Stamped now, so it sorts with today's other to-dos rather than below them.
    assert card["ts"] != f"{today.isoformat()}T00:00:00"

    run(_http.post("/api/admin/today-brain/dismiss", headers=_auth(admin),
                   json={"item_id": card["id"], "signature": card["signature"]}))
    run(server.db.task_dismissals.update_one({"item_id": card["id"]}, {"$set": {"dismissed_by": TAG}}))
    shown, hidden = _payday_items(admin)
    assert shown == [] and [i["id"] for i in hidden] == [card["id"]]


def test_a_payday_from_before_the_schedule_was_saved_never_shows_a_card():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    dev = _user(rate=25.0)
    payday = today - timedelta(days=3)
    _shift(dev, payday - timedelta(days=2), 4)
    body = _set_schedule(admin, "biweekly", payday)
    assert body["payday"] == payday.isoformat() and body["is_today"] is False
    assert _row(body, dev)["gross"] == 100.0       # the amounts are still there to look at
    shown, hidden = _payday_items(admin)
    assert shown == [] and hidden == []


def test_staff_who_cannot_see_payroll_get_no_card_and_no_amounts():
    _fresh()
    today = server.business_today()
    owner_admin = _user(role="admin")
    trainer = _user(role="admin", staff_role="trainer")
    eli = _user(rate=20.0)
    _shift(eli, today - timedelta(days=2), 3)
    _set_schedule(owner_admin, "biweekly", today)
    shown, hidden = _payday_items(trainer)
    assert shown == [] and hidden == []
    res = run(_http.get("/api/admin/payroll/payday", headers=_auth(trainer)))
    assert res.status_code == 403


def test_the_card_also_needs_payroll_access(monkeypatch):
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    jo = _user(rate=20.0)
    _shift(jo, today - timedelta(days=2), 2)
    _set_schedule(admin, "biweekly", today)
    full = server._perms_for(admin)
    # Seeing pay without being able to open Staff -> Payroll: the card's Open would go nowhere.
    monkeypatch.setattr(server, "_perms_for", lambda u: {**full, "payroll": False})
    assert _payday_items(admin) == ([], [])


def test_saving_the_same_paydays_again_keeps_an_unpaid_paydays_card():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    fay = _user(rate=20.0)
    payday = today - timedelta(days=3)
    _shift(fay, payday - timedelta(days=2), 5)
    _save_row("biweekly", payday, set_on=payday - timedelta(days=20))
    assert [i["id"] for i in _payday_items(admin)[0]] == [f"payday-due:{payday.isoformat()}"]

    # The same paydays, entered as the next one instead of the last one.
    _set_schedule(admin, "biweekly", payday + timedelta(days=14))
    saved = run(server.db.settings.find_one({"id": "payroll_schedule"}, {"_id": 0}))
    assert saved["set_on"] == (payday - timedelta(days=20)).isoformat()
    assert "paid_through" not in saved
    assert [i["id"] for i in _payday_items(admin)[0]] == [f"payday-due:{payday.isoformat()}"]


def test_new_paydays_never_count_days_the_old_schedule_already_paid():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    gus = _user(rate=10.0)
    old_payday = today - timedelta(days=3)   # weekly, paid three days ago
    _save_row("weekly", old_payday, set_on=today - timedelta(days=30))
    _shift(gus, old_payday - timedelta(days=2), 8)   # paid on the old payday
    _shift(gus, today - timedelta(days=2), 3)        # worked since: still owed

    body = _set_schedule(admin, "biweekly", today)
    assert body["period_start"] == old_payday.isoformat()
    assert body["period_end"] == (today - timedelta(days=1)).isoformat()
    assert _row(body, gus)["gross"] == 30.0


def test_correcting_a_wrong_setup_does_not_treat_its_paydays_as_paid():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    hal = _user(rate=10.0)
    # Set up today with the wrong weekday; its "payday" a week ago was never real.
    _save_row("weekly", today - timedelta(days=7), set_on=today)
    _shift(hal, today - timedelta(days=10), 4)

    body = _set_schedule(admin, "biweekly", today)
    assert body["period_start"] == (today - timedelta(days=14)).isoformat()
    assert _row(body, hal)["gross"] == 40.0


def test_a_payday_from_before_the_change_owes_nothing_itself():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    ivy = _user(rate=10.0)
    old_payday = today - timedelta(days=1)
    _save_row("weekly", old_payday, set_on=today - timedelta(days=30))
    _shift(ivy, today - timedelta(days=3), 5)

    # Its unpaid hours go on the new schedule's first payday (see the simulation test).
    body = _set_schedule(admin, "biweekly", old_payday)
    assert body["payday"] == old_payday.isoformat()
    assert body["before_schedule_change"] is True
    assert body["per_user"] == [] and body["totals"]["gross"] == 0.0
    assert _payday_items(admin) == ([], [])


def test_switching_to_weekly_on_an_unpaid_payday_still_owes_the_whole_period():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    kim = _user(rate=10.0)
    _save_row("biweekly", today, set_on=today - timedelta(days=30))   # payday today, not paid yet
    _shift(kim, today - timedelta(days=12), 4)   # first week of the biweekly period
    _shift(kim, today - timedelta(days=2), 3)

    body = _set_schedule(admin, "weekly", today)
    assert body["period_start"] == (today - timedelta(days=14)).isoformat()
    assert _row(body, kim)["gross"] == 70.0
    assert [i["id"] for i in _payday_items(admin)[0]] == [f"payday-due:{today.isoformat()}"]


def test_no_schedule_means_no_payday():
    admin = _user(role="admin")
    run(server.db.settings.delete_one({"id": "payroll_schedule"}))
    body = run(_http.get("/api/admin/payroll/payday", headers=_auth(admin))).json()
    assert body == {"configured": False}
    shown, hidden = _payday_items(admin)
    assert shown == [] and hidden == []


# ───────────── Mark paid (owner, 2026-10-30: "nothing to mark her paid") ─────────────

def _pay(admin, payday, person, amount, request_id=None, **extra):
    body = {"user_id": person["id"], "amount": amount, "payment_method": "transfer",
            "request_id": request_id or f"{TAG}-{uuid.uuid4().hex[:10]}", **extra}
    return run(_http.post(f"/api/admin/payroll/payday/{payday}/payments", headers=_auth(admin), json=body))


def _card_for(admin, person):
    shown, _ = _payday_items(admin)
    return [c for c in shown if person["name"] in c["subtitle"]]


def test_marking_someone_paid_clears_what_they_are_owed_and_their_name_from_today():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    dana = _user(rate=18.0)
    _shift(dana, today - timedelta(days=5), 5)        # $90 owed
    _set_schedule(admin, "biweekly", today)
    assert _card_for(admin, dana)

    part = _pay(admin, today.isoformat(), dana, 50)
    assert part.status_code == 200, part.text
    row = _row(part.json(), dana)
    assert (row["paid"], row["remaining"]) == (50.0, 40.0)
    assert any(f"{dana['name']} $40.00" in c["subtitle"] for c in _card_for(admin, dana)), "the card shows what is left"

    rest = _pay(admin, today.isoformat(), dana, 40)
    row = _row(rest.json(), dana)
    assert (row["paid"], row["remaining"]) == (90.0, 0.0)
    assert [p["amount"] for p in row["payments"]] == [50.0, 40.0]
    assert _card_for(admin, dana) == [], "nobody marked paid is nagged about"
    # Not an expense: the P&L already counts payroll from timecards.
    assert run(server.db.expenses.count_documents({"description": {"$regex": dana["name"]}})) == 0


def test_the_card_goes_once_everyone_is_paid():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    eli = _user(rate=20.0)
    _shift(eli, today - timedelta(days=3), 2)
    body = _set_schedule(admin, "biweekly", today)
    for u in body["per_user"]:                        # everyone with hours this period, not just this file's
        if u["remaining"] <= 0.005:
            continue
        res = run(_http.post(f"/api/admin/payroll/payday/{today.isoformat()}/payments", headers=_auth(admin),
                             json={"user_id": u["user_id"], "amount": u["remaining"], "payment_method": "cash",
                                   "request_id": f"{TAG}-{uuid.uuid4().hex[:10]}"}))
        assert res.status_code == 200, res.text
    shown, _ = _payday_items(admin)
    assert shown == []
    assert res.json()["totals"]["remaining"] == 0


def test_the_same_mark_paid_sent_twice_is_recorded_once():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    fay = _user(rate=20.0)
    _shift(fay, today - timedelta(days=2), 3)
    _set_schedule(admin, "biweekly", today)
    rid = f"{TAG}-{uuid.uuid4().hex[:10]}"
    first, again = _pay(admin, today.isoformat(), fay, 60, rid), _pay(admin, today.isoformat(), fay, 60, rid)
    assert first.json()["payment"]["id"] == again.json()["payment"]["id"]
    assert run(server.db.payroll_payments.count_documents({"request_id": rid})) == 1
    assert _row(again.json(), fay)["paid"] == 60.0


def test_cash_from_the_register_drawer_lowers_the_drawer_and_undo_puts_it_back():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    gus = _user(rate=20.0)
    _shift(gus, today - timedelta(days=2), 4)
    _set_schedule(admin, "biweekly", today)
    paid_on = "2003-03-10"   # a past day nobody closed out, so the real register day is untouched
    res = _pay(admin, today.isoformat(), gus, 80, payment_method="cash", from_cash_drawer=True, paid_on=paid_on)
    assert res.status_code == 200, res.text
    payment = res.json()["payment"]
    adj = run(server.db.till_adjustments.find_one({"id": payment["till_adjustment_id"]}, {"_id": 0}))
    assert adj and (adj["direction"], adj["amount"], adj["date"]) == ("remove", 80.0, paid_on)
    assert gus["name"] in adj["reason"]

    check = _pay(admin, today.isoformat(), gus, 1, payment_method="check", from_cash_drawer=True)
    assert check.json()["payment"]["till_adjustment_id"] is None, "only cash comes out of the drawer"

    undo = run(_http.delete(f"/api/admin/payroll/payments/{payment['id']}", headers=_auth(admin)))
    assert undo.status_code == 200, undo.text
    assert run(server.db.till_adjustments.count_documents({"id": adj["id"]})) == 0
    assert run(server.db.payroll_payments.count_documents({"id": payment["id"]})) == 0
    assert _row(undo.json(), gus)["paid"] == 1.0
    assert run(server.db.deleted_records.count_documents({"collection": "payroll_payments", "record_id": payment["id"]})) == 1


def test_a_drawer_payment_on_a_closed_out_day_is_refused_with_nothing_recorded():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    hal = _user(rate=20.0)
    _shift(hal, today - timedelta(days=2), 4)
    _set_schedule(admin, "biweekly", today)
    closed = "2003-03-11"
    run(server.db.daily_closeouts.insert_one({"id": f"{TAG}-close", "date": closed, "status": "closed", "tag": TAG}))
    try:
        res = _pay(admin, today.isoformat(), hal, 80, payment_method="cash", from_cash_drawer=True, paid_on=closed)
        assert res.status_code >= 400, res.text
        assert _row(_set_schedule(admin, "biweekly", today), hal)["paid"] == 0
    finally:
        run(server.db.daily_closeouts.delete_one({"id": f"{TAG}-close"}))


def test_mark_paid_refuses_the_wrong_payday_someone_not_owed_a_future_date_and_no_access():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    ivy = _user(rate=20.0)
    stranger = _user(rate=20.0)
    _shift(ivy, today - timedelta(days=2), 1)
    _set_schedule(admin, "biweekly", today)
    assert _pay(admin, (today - timedelta(days=14)).isoformat(), ivy, 20).status_code == 422, "before the schedule began"
    assert _pay(admin, (today - timedelta(days=3)).isoformat(), ivy, 20).status_code == 422, "not a payday"
    assert _pay(admin, today.isoformat(), stranger, 20).status_code == 404
    assert _pay(admin, today.isoformat(), ivy, 20, paid_on=(today + timedelta(days=1)).isoformat()).status_code == 422
    staff = _user(role="employee", staff_role="trainer")
    assert _pay(staff, today.isoformat(), ivy, 20).status_code == 403
    assert _row(_set_schedule(admin, "biweekly", today), ivy)["paid"] == 0


def test_someone_paid_whose_hours_were_then_removed_still_shows_their_payment():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    jo = _user(rate=20.0)
    shift = _shift(jo, today - timedelta(days=2), 2)
    _set_schedule(admin, "biweekly", today)
    _pay(admin, today.isoformat(), jo, 40)
    run(server.db.time_clock_entries.delete_one({"id": shift["id"]}))
    row = _row(_set_schedule(admin, "biweekly", today), jo)
    assert row and (row["gross"], row["paid"], row["remaining"]) == (0.0, 40.0, -40.0)



def test_a_w2_payment_of_take_home_settles_the_gross_and_takes_only_the_cash_from_the_drawer():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    kim = _user(rate=20.0, tax_status="w2")
    _shift(kim, today - timedelta(days=2), 5)          # $100 gross
    body = _set_schedule(admin, "biweekly", today)
    assert _row(body, kim)["tax_status"] == "w2"
    res = _pay(admin, today.isoformat(), kim, 100, withheld=23.9, payment_method="cash", from_cash_drawer=True,
               paid_on="2003-03-12")
    assert res.status_code == 200, res.text
    payment, row = res.json()["payment"], _row(res.json(), kim)
    assert (row["paid"], row["remaining"]) == (100.0, 0.0), "the withheld part is the IRS's, not still owed to her"
    assert payment["handed_over"] == 76.1
    adj = run(server.db.till_adjustments.find_one({"id": payment["till_adjustment_id"]}, {"_id": 0}))
    assert adj["amount"] == 76.1, "only the cash handed over left the drawer"
    assert _pay(admin, today.isoformat(), kim, 10, withheld=10).status_code == 422


def test_an_earlier_payday_can_be_opened_and_paid_late():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    lou = _user(rate=10.0)
    earlier = today - timedelta(days=14)
    _save_row("biweekly", today, today - timedelta(days=60))
    _shift(lou, earlier - timedelta(days=3), 2)        # paid on the earlier payday
    _shift(lou, today - timedelta(days=3), 4)          # paid today
    old = run(_http.get(f"/api/admin/payroll/payday?payday={earlier.isoformat()}", headers=_auth(admin))).json()
    assert old["payday"] == earlier.isoformat() and old["is_latest"] is False
    assert _row(old, lou)["remaining"] == 20.0
    late = _pay(admin, earlier.isoformat(), lou, 20)
    assert late.status_code == 200 and _row(late.json(), lou)["remaining"] == 0
    now = run(_http.get("/api/admin/payroll/payday", headers=_auth(admin))).json()
    assert now["is_latest"] is True and now["previous_payday"] == earlier.isoformat()
    assert _row(now, lou)["remaining"] == 40.0, "a late payment for the earlier payday doesn't count against today's"


def test_payments_still_count_after_the_schedule_changes_on_payday():
    """Paid on the old schedule's payday a week ago, then that same day the schedule moved to
    paydays on other days. The new schedule's first payday pays from where the old paydays
    stopped, so it holds the hours already paid a week ago: those must not be owed again."""
    _fresh()
    today = server.business_today()
    old_payday = today - timedelta(days=7)
    first_new = today - timedelta(days=3)               # weekly from here: not a payday on the change day
    admin = _user(role="admin")
    max_ = _user(rate=10.0)
    _save_row("biweekly", old_payday, today - timedelta(days=60))
    _shift(max_, old_payday - timedelta(days=3), 6)    # $60, paid on the old payday
    _shift(max_, today - timedelta(days=5), 2)         # $20, worked after it
    assert _pay(admin, old_payday.isoformat(), max_, 60).status_code == 200
    # The change exactly as saved_schedule writes it when saved on the old payday.
    from domains.staff.payday import saved_schedule
    old = run(server.db.settings.find_one({"id": "payroll_schedule"}, {"_id": 0}))
    run(server.db.settings.replace_one({"id": "payroll_schedule"}, saved_schedule(old, "weekly", first_new, old_payday)))
    body = run(_http.get("/api/admin/payroll/payday", headers=_auth(admin))).json()
    assert body["payday"] == first_new.isoformat()
    assert body["period_start"] <= (old_payday - timedelta(days=3)).isoformat(), "the period holds the paid hours"
    row = _row(body, max_)
    assert (row["gross"], row["paid"], row["remaining"]) == (80.0, 60.0, 20.0)
    assert [p["payday"] for p in row["payments"]] == [old_payday.isoformat()], "and the payment can still be undone"


def test_a_retry_after_a_crash_takes_the_cash_from_the_drawer_once():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    ned = _user(rate=20.0)
    _shift(ned, today - timedelta(days=2), 2)
    _set_schedule(admin, "biweekly", today)
    rid = f"{TAG}-{uuid.uuid4().hex[:10]}"
    # As if the server stopped after saving the payment and before the drawer entry.
    run(server.db.payroll_payments.insert_one({
        "id": f"{TAG}-crashed", "request_id": rid, "payday": today.isoformat(), "period_start": "2000-01-01",
        "period_end": "2000-01-02", "user_id": ned["id"], "name": ned["name"], "amount": 40.0, "withheld": 0.0,
        "handed_over": 40.0, "payment_method": "cash", "paid_on": "2003-03-13", "from_cash_drawer": True,
        "till_adjustment_id": None, "created_at": "2026-10-30T12:00:00"}))
    for _ in range(2):
        res = _pay(admin, today.isoformat(), ned, 40, rid, payment_method="cash", from_cash_drawer=True, paid_on="2003-03-13")
        assert res.status_code == 200, res.text
    adjs = run(server.db.till_adjustments.find({"notes": f"payroll_request:{rid}"}, {"_id": 0}).to_list(None))
    assert len(adjs) == 1 and adjs[0]["amount"] == 40.0
    assert run(server.db.payroll_payments.find_one({"request_id": rid}))["till_adjustment_id"] == adjs[0]["id"]


def test_undoing_a_payment_needs_the_delete_records_permission():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    oli = _user(rate=20.0)
    _shift(oli, today - timedelta(days=2), 2)
    _set_schedule(admin, "biweekly", today)
    payment = _pay(admin, today.isoformat(), oli, 40).json()["payment"]
    bookkeeper = _user(role="employee", staff_role="manager",
                       permission_overrides={"finance_reports": True, "delete_records": False})
    assert server._perms_for(bookkeeper)["finance_reports"] and not server._perms_for(bookkeeper)["delete_records"]
    assert run(_http.delete(f"/api/admin/payroll/payments/{payment['id']}", headers=_auth(bookkeeper))).status_code == 403
    assert run(server.db.payroll_payments.count_documents({"id": payment["id"]})) == 1


def test_someone_who_worked_with_no_pay_rate_is_flagged_not_shown_as_paid():
    _fresh()
    today = server.business_today()
    admin = _user(role="admin")
    pia = _user()                                       # no hourly rate
    _shift(pia, today - timedelta(days=2), 3)
    body = _set_schedule(admin, "biweekly", today)
    row = _row(body, pia)
    assert row["no_rate"] is True and row["paid"] == 0
    cards = _payday_items(admin)[0]
    assert cards and f"{pia['name']}: no pay rate set" in cards[0]["subtitle"]
