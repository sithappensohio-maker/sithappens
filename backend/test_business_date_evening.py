"""Evening: the host computer's date is tomorrow, Ohio's is still today (audit #26).

Production runs in a container on UTC. From 8 PM Eastern (7 PM in winter)
until midnight the computer's calendar says tomorrow, while the business is
still on today. Places that took the computer's date got it wrong every
evening: the Register's returns (every cash return refused, card refunds on
tomorrow's books, a closed day not noticed, the 30-day window a day short),
the Photo Specials booking page (today vanished), a program sold with no
start date (a week late), and the Practice streak (evening practice didn't
count for today). Each now takes the Ohio date.

These tests make the evening happen: the computer's clock reads tomorrow.

Self-contained fixtures (never import another test module).
"""
import contextlib
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
import trophy_service
from _test_loop import run
from domains.photo_specials import routes as photo_routes
from domains.pos import services as pos

TAG = "TEST_EVENING"
ADMIN = {"id": "ev-admin", "name": "Evening QA", "email": "evening@test", "role": "admin"}


def _ohio_today():
    return server.business_today()


class _EveningDate(dt.date):
    """A calendar whose today() is the host computer's: already tomorrow."""
    @classmethod
    def today(cls):
        t = _ohio_today() + dt.timedelta(days=1)
        return cls(t.year, t.month, t.day)


@pytest.fixture
def evening(monkeypatch):
    for module in (pos, photo_routes, trophy_service):
        if hasattr(module, "_date"):
            monkeypatch.setattr(module, "_date", _EveningDate)
        if hasattr(module, "date"):
            monkeypatch.setattr(module, "date", _EveningDate)


@pytest.fixture
def register_open():
    day = _ohio_today().isoformat()
    before = run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day}, {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                                         "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield day
    if before is None:
        run(server.db.cash_drawer_sessions.delete_many({"date": day, "notes": TAG}))


@contextlib.contextmanager
def _product(price=10.0):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} treats", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0.0, "taxable": False,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    try:
        yield pid
    finally:
        run(server.db.pos_products.delete_one({"id": pid}))


def _sell(pid, method="cash", amount=10.0):
    tender = {"method": method, "amount": amount, **({"tendered_amount": amount} if method == "cash" else {})}
    out = run(server._create_pos_sale_impl(server.PosSaleIn(
        lines=[server.PosSaleLineIn(kind="retail", product_id=pid, qty=1)],
        tenders=[server.PosSaleTenderIn(**tender)], idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))
    return out.get("pos_sale_id") or (out.get("sale") or {}).get("id")


def _return(sale_id):
    return run(server.return_pos_sale(sale_id, pos.PosSaleReturnIn(
        lines=[{"line_index": 0, "qty": 1, "restock": False}], reason=f"{TAG} changed mind",
        idempotency_key=f"{TAG}-{uuid.uuid4()}"), ADMIN))


def _cleanup_sale(sale_id):
    run(server.db.retail_sales.delete_many({"pos_sale_id": sale_id}))
    run(server.db.pos_sale_returns.delete_many({"pos_sale_id": sale_id}))
    run(server.db.pos_sales.delete_one({"id": sale_id}))


# ------------------------------------------------------------ the Register

def test_an_evening_cash_return_finds_tonights_drawer_and_lands_on_today(evening, register_open):
    with _product() as pid:
        sale = _sell(pid)
        try:
            out = _return(sale)["returned"]
            assert out["business_date"] == register_open
            rows = run(server.db.retail_sales.find({"pos_sale_return_id": out["id"]}, {"_id": 0}).to_list(5))
            assert [r["date"] for r in rows] == [register_open]
        finally:
            _cleanup_sale(sale)


def test_an_evening_card_refund_lands_on_todays_books(evening, register_open):
    with _product() as pid:
        sale = _sell(pid, method="card")
        try:
            out = _return(sale)["returned"]
            rows = run(server.db.retail_sales.find({"pos_sale_return_id": out["id"]}, {"_id": 0}).to_list(5))
            assert [(r["date"], r["amount"]) for r in rows] == [(register_open, -10.0)]
        finally:
            _cleanup_sale(sale)


def test_an_evening_return_notices_that_today_was_closed_out(evening, register_open):
    with _product() as pid:
        sale = _sell(pid, method="card")
        closeout = str(uuid.uuid4())
        run(server.db.daily_closeouts.insert_one({"id": closeout, "date": register_open, "created_at": server.now_iso(), "notes": TAG}))
        try:
            with pytest.raises(HTTPException) as e:
                _return(sale)
            assert e.value.status_code == 409 and "is closed" in e.value.detail
        finally:
            run(server.db.daily_closeouts.delete_one({"id": closeout}))
            _cleanup_sale(sale)


def test_the_thirty_day_window_counts_ohio_days(evening):
    thirty_days_ago = (_ohio_today() - dt.timedelta(days=30)).isoformat()
    preview = pos.return_preview({"status": "completed", "business_date": thirty_days_ago, "line_items": []})
    assert preview["blocked_reason"] is None


# ------------------------------------------------------------ Photo Specials

class _Req:
    def __init__(self):
        self.client = type("C", (), {"host": f"203.0.113.{uuid.uuid4().int % 250 + 1}"})()
        self.headers = {}
        self.url = type("U", (), {"path": "/api/public/photo-specials/x/reserve"})()
        self.method = "POST"


@contextlib.contextmanager
def _special(start, end):
    today, tomorrow = _ohio_today(), _ohio_today() + dt.timedelta(days=1)
    sp = run(server.admin_create_photo_special(server.PhotoSpecialIn(
        name=f"{TAG} portraits {uuid.uuid4().hex[:6]}", headline="h", description="d", location_name="l",
        dates=[today.isoformat(), tomorrow.isoformat()], start_time=start, end_time=end,
        slot_minutes=15, booking_open=True, published=True), ADMIN))
    try:
        yield sp, today.isoformat(), tomorrow.isoformat()
    finally:
        run(server.db.bookings.delete_many({"photo_special_id": sp["id"]}))
        run(server.db.photo_specials.delete_one({"id": sp["id"]}))


def _clock(monkeypatch, hour, minute=0):
    monkeypatch.setattr(photo_routes, "_ohio_now",
                        lambda: dt.datetime.combine(_ohio_today(), dt.time(hour, minute), tzinfo=trophy_service._BUSINESS_TZ))


def test_todays_photo_special_date_is_still_offered_in_the_evening(evening, monkeypatch):
    _clock(monkeypatch, 20, 30)
    with _special("20:00", "23:00") as (sp, today, _tomorrow):
        offered = run(server.public_photo_special(sp["slug"]))["dates"]
        assert offered[0] == today


def test_times_already_gone_today_are_never_offered_or_booked(monkeypatch):
    _clock(monkeypatch, 10, 0)
    with _special("09:00", "12:00") as (sp, today, _tomorrow):
        slots = {s["time"]: s["available"] for s in run(server.public_photo_special_availability(sp["slug"], today))["slots"]}
        assert slots["09:00"] is False and slots["10:00"] is False and slots["10:15"] is True
        body = server.PhotoSpecialReserveIn(date=today, time="09:30", first_name="Sam", last_name="Lee",
                                            email=f"{uuid.uuid4().hex[:8]}@example.com", phone="6145550101",
                                            dog_name="Bo", breed="Mix")
        with pytest.raises(HTTPException) as e:
            run(server.public_photo_special_reserve(sp["slug"], body, _Req()))
        assert e.value.status_code == 409 and e.value.block["code"] == "time_in_past"


def test_a_page_left_open_overnight_offers_nothing_on_yesterdays_date(monkeypatch):
    _clock(monkeypatch, 9, 0)
    yesterday = (_ohio_today() - dt.timedelta(days=1)).isoformat()
    sp = run(server.admin_create_photo_special(server.PhotoSpecialIn(
        name=f"{TAG} portraits {uuid.uuid4().hex[:6]}", headline="h", description="d", location_name="l",
        dates=[yesterday, _ohio_today().isoformat()], start_time="12:00", end_time="13:00",
        slot_minutes=15, booking_open=True, published=True), ADMIN))
    try:
        slots = run(server.public_photo_special_availability(sp["slug"], yesterday))["slots"]
        assert slots and not any(s["available"] for s in slots)
    finally:
        run(server.db.photo_specials.delete_one({"id": sp["id"]}))


def test_once_every_time_today_has_gone_the_page_opens_on_the_next_date(monkeypatch):
    _clock(monkeypatch, 21, 0)
    with _special("16:00", "19:00") as (sp, today, tomorrow):
        offered = run(server.public_photo_special(sp["slug"]))["dates"]
        assert today not in offered and offered[0] == tomorrow
        # (the desk's own view still has the day)
        assert today in server.photo_special_dates(sp)


# ------------------------------------------------------------ Practice streaks

@contextlib.contextmanager
def _homework(cid, **fields):
    hid = str(uuid.uuid4())
    run(server.db.homework.insert_one({"id": hid, "client_id": cid, **fields}))
    try:
        yield hid
    finally:
        run(server.db.homework.delete_one({"id": hid}))


def test_practice_finished_at_nine_pm_counts_for_that_ohio_day():
    cid = f"{TAG}-{uuid.uuid4()}"
    today = _ohio_today()
    nine_pm_ohio = dt.datetime(today.year, today.month, today.day, 21, 0, tzinfo=trophy_service._BUSINESS_TZ)
    completed_at = nine_pm_ohio.astimezone(dt.timezone.utc).isoformat()   # stored as UTC: already tomorrow there
    with _homework(cid, status="completed", completed_at=completed_at):
        assert run(trophy_service.practice_days(server.db, cid)) == {today}


def test_an_evening_streak_still_counts_yesterday_before_todays_practice(evening):
    """Practised yesterday, not yet tonight: the streak is 1 until midnight."""
    cid = f"{TAG}-{uuid.uuid4()}"
    yesterday = _ohio_today() - dt.timedelta(days=1)
    noon = dt.datetime(yesterday.year, yesterday.month, yesterday.day, 12, 0, tzinfo=trophy_service._BUSINESS_TZ)
    with _homework(cid, status="completed", completed_at=noon.astimezone(dt.timezone.utc).isoformat()):
        assert run(trophy_service._homework_streak_days(server.db, cid)) == 1


def test_the_portal_streak_tile_says_practised_today_after_an_evening_session(monkeypatch):
    """The client practised at 9 PM Ohio time: the tile says done for today."""
    day = dt.date(2030, 1, 8)
    monkeypatch.setattr(server, "business_today", lambda: day)
    cid = f"{TAG}-{uuid.uuid4()}"
    nine_pm = dt.datetime(day.year, day.month, day.day, 21, 0, tzinfo=trophy_service._BUSINESS_TZ)
    with _homework(cid, status="completed", completed_at=nine_pm.astimezone(dt.timezone.utc).isoformat()):
        tile = run(server.portal_homework_streak({"id": f"u-{cid}", "role": "client", "client_id": cid}))
        assert tile["completed_today"] is True and tile["current_streak"] == 1


# ------------------------------------------------------------ a program sold with no start date

def test_a_program_sold_with_no_start_date_starts_on_the_weekday_from_ohios_today(monkeypatch):
    """Sold on a Tuesday evening for Tuesday sessions: the first is that
    Tuesday (today), not a week later."""
    tuesday = dt.date(2030, 1, 8)                       # (a Tuesday, well away from the real calendar)
    monkeypatch.setattr(server, "business_today", lambda: tuesday)
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "training_credits": 0}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                   "vaccines": {"rabies": "2031-01-01", "dhpp": "2031-01-01", "bordetella": "2031-01-01"}}))
    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} program {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"},
        price=100, delivery_mode="trainer_led"), ADMIN))
    day = tuesday.isoformat()
    run(server.db.cash_drawer_sessions.insert_one({"date": day, "opening_cash": 0.0, "opened_at": server.now_iso(),
                                                   "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}))
    try:
        out = run(server.sell_training_program(cid, server.SellProgramIn(
            program_id=prog["id"], payment_method="cash", dog_id=did, schedule_day_of_week=tuesday.weekday(),
            schedule_time="10:00"), ADMIN))
        dates = sorted(b["date"] for b in out["scheduled_bookings"])
        assert dates and dates[0] == day
    finally:
        run(server.db.cash_drawer_sessions.delete_many({"date": day, "notes": TAG}))
        for coll in ("bookings", "dog_programs", "school_enrollments", "homework"):
            run(server.db[coll].delete_many({"dog_id": did}))
        for coll in ("credit_lots", "retail_sales"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))


def test_a_program_sale_skips_a_holiday_from_the_real_settings(monkeypatch):
    """Closed dates come from the business settings document, so a sale never
    books a closed day. (An older lookup read a document that does not exist,
    so holidays were booked.)"""
    tuesday = dt.date(2030, 1, 8)
    monkeypatch.setattr(server, "business_today", lambda: tuesday)
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "training_credits": 0}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                   "vaccines": {"rabies": "2031-01-01", "dhpp": "2031-01-01", "bordetella": "2031-01-01"}}))
    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} program {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 3, "unit": "sessions"},
        price=150, delivery_mode="trainer_led"), ADMIN))
    day = tuesday.isoformat()
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"closed_dates": ["2030-01-15"]}}))
    run(server.db.cash_drawer_sessions.insert_one({"date": day, "opening_cash": 0.0, "opened_at": server.now_iso(),
                                                   "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}))
    try:
        out = run(server.sell_training_program(cid, server.SellProgramIn(
            program_id=prog["id"], payment_method="cash", dog_id=did, schedule_day_of_week=tuesday.weekday(),
            schedule_time="10:00"), ADMIN))
        dates = sorted(b["date"] for b in out["scheduled_bookings"])
        assert dates == ["2030-01-08", "2030-01-22", "2030-01-29"], "the closed Jan 15 is skipped"
        assert {"date": "2030-01-15", "reason": "business_closed"} in [
            {k: w.get(k) for k in ("date", "reason")} for w in out.get("schedule_warnings", [])]
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))
        run(server.db.cash_drawer_sessions.delete_many({"date": day, "notes": TAG}))
        for coll in ("bookings", "dog_programs", "school_enrollments", "homework"):
            run(server.db[coll].delete_many({"dog_id": did}))
        for coll in ("credit_lots", "retail_sales"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.programs.delete_one({"id": prog["id"]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))
