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
    """Each test starts with none of this file's shifts or hidden payday cards."""
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
