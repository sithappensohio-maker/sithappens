"""Photo Specials — reusable public portrait events on top of real bookings.

The contract these pin: a special is configuration only, a reservation is a
canonical photography booking, the database (not a read-then-write check) is
what stops two people taking the same slot, cancelling reopens a slot, existing
customers are reused without the page ever revealing who is on file, and the
vaccine exception is narrow, explicit and invisible to every other service.
"""
import _test_env  # noqa: F401 — must run before `import server`
import datetime as dt
import uuid

import pytest
import server
from _test_loop import run
from fastapi import HTTPException

ADMIN = {"id": "ps-admin", "name": "PS Admin", "email": "ps-admin@example.com", "role": "admin"}
TODAY = dt.date.today()

# Every special in this file gets its OWN pair of dates. That is not test
# hygiene theatre: two portrait events running the same hours on the same day
# genuinely do compete for the same photographer, and the shared overlap pool
# correctly makes them block each other. Separate dates keep each test about
# the behaviour it is actually asserting.
_day_seq = iter(range(20, 400, 2))


def _next_days():
    n = next(_day_seq)
    return (TODAY + dt.timedelta(days=n)).isoformat(), (TODAY + dt.timedelta(days=n + 1)).isoformat()


DAY_1, DAY_2 = _next_days()


class _Req:
    """Enough of a Request for rate limiting and client_ip.

    Each reservation comes from its own address by default, because each one is
    a different customer. The per-IP throttle has its own test rather than
    silently capping every other test in the file.
    """

    def __init__(self, ip=None):
        ip = ip or f"203.0.113.{uuid.uuid4().int % 250 + 1}"
        self.client = type("C", (), {"host": ip})()  # noqa: E501
        self.headers = {}
        self.url = type("U", (), {"path": "/api/public/photo-specials/x/reserve"})()
        self.method = "POST"


def _special(**over):
    global DAY_1, DAY_2
    if "dates" not in over:
        DAY_1, DAY_2 = _next_days()
    body = server.PhotoSpecialIn(**{
        "name": f"Howl-O-Ween Portraits {uuid.uuid4().hex[:6]}",
        "headline": "Professional dog portraits",
        "description": "Real studio portraits, not phone snaps.",
        "location_name": "Sit Happens",
        "dates": [DAY_1, DAY_2],
        "start_time": "09:00",
        "end_time": "10:00",
        "slot_minutes": 15,
        "booking_open": True,
        "published": True,
        **over,
    })
    return run(server.admin_create_photo_special(body, ADMIN))


def _reserve(sp, *, time="09:00", day=None, email=None, dog="Bella", **over):
    body = server.PhotoSpecialReserveIn(**{
        "date": day or DAY_1, "time": time,
        "first_name": "Sarah", "last_name": "Jones",
        "email": email or f"sarah{uuid.uuid4().hex[:8]}@example.com",
        "phone": f"614555{uuid.uuid4().int % 10_000_000:07d}",
        "dog_name": dog, "breed": "Corgi",
        **over,
    })
    return run(server.public_photo_special_reserve(sp["slug"], body, _Req()))


# ---------------------------------------------------------------- configuration

def test_a_special_is_configuration_and_owns_no_appointments():
    sp = _special()
    assert sp["slug"] and sp["published"] is True
    assert sp["slot_minutes"] == 15
    # It points at the canonical portrait service rather than inventing one.
    svc = run(server.db.services.find_one({"id": sp["service_id"]}, {"_id": 0}))
    assert svc["service_type"] == "photography"
    assert svc["slug"] == "portrait-session"


def test_the_portrait_service_is_canonical_reused_and_cannot_create_a_charge():
    a = run(server.portrait_service())
    b = run(server.portrait_service())
    assert a["id"] == b["id"], "every special shares one Portrait Session service"
    assert a["duration_minutes"] == 15
    # The appointment reserves time; it never decides what is owed. A zero base
    # price means no reservation can manufacture an amount due — the Register
    # prices the package the customer actually picks, after the session.
    assert a["base_price"] == 0.0
    assert run(server.db.services.count_documents({"slug": "portrait-session"})) == 1


def test_two_specials_share_the_one_service_so_christmas_needs_no_new_code():
    halloween, christmas = _special(), _special(name="Christmas Portraits")
    assert halloween["service_id"] == christmas["service_id"]
    assert halloween["slug"] != christmas["slug"]


# ------------------------------------------------------- recurring schedules

def _howl_o_ween(**over):
    """The real shape: a six-week promotion, weekday evenings and full
    weekends — not a hand-typed list of dates."""
    cfg = {
        "dates": [],
        "start_date": "2026-09-16", "end_date": "2026-10-31",
        "day_hours": {
            "monday": {"open": "16:00", "close": "19:00"},
            "tuesday": {"open": "16:00", "close": "19:00"},
            "wednesday": {"open": "16:00", "close": "19:00"},
            "thursday": {"open": "16:00", "close": "19:00"},
            "friday": {"open": "16:00", "close": "19:00"},
            "saturday": {"open": "07:00", "close": "19:00"},
            "sunday": {"open": "07:00", "close": "19:00"},
        },
        "slot_minutes": 15,
    }
    cfg.update(over)
    return _special(**cfg)


def test_a_date_range_generates_its_own_dates_so_nobody_types_forty_six():
    sp = _howl_o_ween()
    dates = server.photo_special_dates(sp)
    assert len(dates) == 46, f"16 Sep to 31 Oct inclusive is 46 days, got {len(dates)}"
    assert dates[0] == "2026-09-16" and dates[-1] == "2026-10-31"
    assert dates == sorted(dates)


def test_weekday_evenings_and_weekend_mornings_are_different_windows():
    sp = _howl_o_ween()
    # 2026-09-16 is a Wednesday; 2026-09-19 is a Saturday.
    wed = run(server.public_photo_special_availability(sp["slug"], "2026-09-16"))
    sat = run(server.public_photo_special_availability(sp["slug"], "2026-09-19"))
    assert [s["time"] for s in wed["slots"]][:2] == ["16:00", "16:15"]
    assert wed["slots"][-1]["time"] == "18:45", "weekday evenings end at 7pm"
    assert len(wed["slots"]) == 12, "3 hours of 15-minute slots"
    assert [s["time"] for s in sat["slots"]][:2] == ["07:00", "07:15"]
    assert sat["slots"][-1]["time"] == "18:45", "weekends also end at 7pm"
    assert len(sat["slots"]) == 48, "12 hours of 15-minute slots"


def test_a_closed_weekday_drops_out_of_the_schedule_entirely():
    sp = _howl_o_ween(day_hours={
        "monday": {"closed": True},
        "tuesday": {"open": "16:00", "close": "19:00"},
        "wednesday": {"open": "16:00", "close": "19:00"},
        "thursday": {"open": "16:00", "close": "19:00"},
        "friday": {"open": "16:00", "close": "19:00"},
        "saturday": {"open": "07:00", "close": "19:00"},
        "sunday": {"open": "07:00", "close": "19:00"},
    })
    dates = server.photo_special_dates(sp)
    mondays = [d for d in dates if dt.date.fromisoformat(d).weekday() == 0]
    assert mondays == [], "a closed weekday must not appear at all"
    assert len(dates) == 46 - 6, "six Mondays fall in this range"


def test_one_day_can_be_excluded_without_touching_the_rest_of_the_schedule():
    sp = _howl_o_ween(closed_dates=["2026-10-31"])
    dates = server.photo_special_dates(sp)
    assert "2026-10-31" not in dates, "an excluded day is gone"
    assert "2026-10-30" in dates, "and its neighbours are untouched"
    assert len(dates) == 45
    # and it is genuinely unbookable, not merely hidden
    av = run(server.public_photo_special_availability(sp["slug"], "2026-10-31"))
    assert av["closed"] is True and av["slots"] == []


def test_an_explicit_date_list_still_wins_for_a_one_off_event():
    sp = _special(dates=[DAY_1, DAY_2], start_time="09:00", end_time="10:00")
    view = run(server.public_photo_special(sp["slug"]))
    assert view["dates"] == sorted([DAY_1, DAY_2]), "a two-day event does not need a range"


def test_a_special_with_no_weekday_rules_keeps_its_single_window():
    # Everything created before per-day hours existed must behave identically.
    sp = _special(dates=[DAY_1], start_time="09:00", end_time="10:00", day_hours={})
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    assert [s["time"] for s in av["slots"]] == ["09:00", "09:15", "09:30", "09:45"]


def test_the_range_cannot_be_asked_to_generate_forever():
    sp = _howl_o_ween(start_date="2026-01-01", end_date="2099-12-31")
    dates = server.photo_special_dates(sp)
    assert len(dates) <= 400, "a runaway range is capped rather than hanging the page"


def test_an_inverted_or_missing_range_offers_nothing_rather_than_erroring():
    for bad in ({"start_date": "2026-10-31", "end_date": "2026-09-16"}, {"start_date": None, "end_date": None}):
        sp = _howl_o_ween(**bad)
        assert server.photo_special_dates(sp) == []


def test_the_public_page_never_offers_a_date_that_has_already_passed():
    # Half of a six-week promotion is in the past by the middle of it.
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    long_ago = (dt.date.today() - dt.timedelta(days=10)).isoformat()
    ahead = (dt.date.today() + dt.timedelta(days=10)).isoformat()
    sp = _special(dates=[], start_date=long_ago, end_date=ahead, start_time="09:00", end_time="10:00", day_hours={})
    generated = server.photo_special_dates(sp)
    assert long_ago in generated and yesterday in generated, "the schedule itself still knows those days"
    offered = run(server.public_photo_special(sp["slug"]))["dates"]
    assert long_ago not in offered and yesterday not in offered
    assert offered[0] == dt.date.today().isoformat(), "it opens on today, not on week one"
    assert ahead in offered


def test_a_reservation_cannot_be_made_on_a_date_that_has_passed():
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    ahead = (dt.date.today() + dt.timedelta(days=10)).isoformat()
    sp = _special(dates=[], start_date=yesterday, end_date=ahead, start_time="09:00", end_time="10:00", day_hours={})
    with pytest.raises(HTTPException) as e:
        _reserve(sp, day=yesterday, time="09:00")
    assert e.value.status_code == 409
    assert e.value.block["action"] == "pick_date", "the page sends them back to the dates"


def test_front_desk_sees_a_recurring_special_on_a_day_inside_its_range():
    sp = _howl_o_ween()
    out = run(server.admin_photo_specials_today("2026-09-19", ADMIN))
    mine = [x for x in out["specials"] if x["special"]["id"] == sp["id"]]
    assert mine, "a special defined by rules must still show on the day"
    assert mine[0]["timeline"][0]["time"] == "07:00"
    off = run(server.admin_photo_specials_today("2026-11-05", ADMIN))
    assert not [x for x in off["specials"] if x["special"]["id"] == sp["id"]], "and not outside its range"


# ------------------------------------------------------------------ availability

def test_slots_are_generated_at_the_specials_own_length_inside_its_own_window():
    sp = _special(start_time="09:00", end_time="10:00", slot_minutes=15)
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    assert [s["time"] for s in av["slots"]] == ["09:00", "09:15", "09:30", "09:45"]
    assert av["slot_minutes"] == 15


def test_a_day_the_special_does_not_run_offers_nothing():
    sp = _special(dates=[DAY_1])
    av = run(server.public_photo_special_availability(sp["slug"], DAY_2))
    assert av["closed"] is True and av["slots"] == []


def test_a_reserved_time_disappears_from_public_availability():
    sp = _special()
    _reserve(sp, time="09:15")
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    taken = {s["time"]: s["available"] for s in av["slots"]}
    assert taken["09:15"] is False
    assert taken["09:00"] is True, "only the booked time goes"


def test_availability_never_leaks_who_booked_or_how_many():
    sp = _special()
    _reserve(sp, time="09:00", dog="Bella")
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    blob = str(av)
    for leak in ("Bella", "Sarah", "client_id", "dog_id", "booking", "example.invalid"):
        assert leak not in blob, f"public availability leaked {leak!r}"
    assert set(av["slots"][0]) == {"time", "available"}


def test_an_existing_lesson_blocks_the_overlapping_portrait_slot():
    sp = _special()
    run(server.db.bookings.insert_one({
        "id": str(uuid.uuid4()), "date": DAY_1, "time": "09:30", "duration_minutes": 60,
        "service_type": "training", "status": "approved", "dog_id": "d-x", "dog_name": "Rex",
    }))
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    times = {s["time"]: s["available"] for s in av["slots"]}
    assert times["09:30"] is False and times["09:45"] is False, "the shared overlap pool applies"
    assert times["09:00"] is True


def test_closed_booking_offers_no_slots_and_refuses_a_reservation():
    sp = _special(booking_open=False)
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    assert av["closed"] is True
    with pytest.raises(HTTPException) as e:
        _reserve(sp)
    assert e.value.status_code == 409
    assert e.value.block["action"] == "contact_us" and "call" in e.value.detail


def test_max_bookings_sells_the_whole_special_out():
    sp = _special(max_bookings=1)
    _reserve(sp, time="09:00")
    av = run(server.public_photo_special_availability(sp["slug"], DAY_1))
    assert all(s["available"] is False for s in av["slots"]), "a sold-out special offers nothing"


# -------------------------------------------------------------------- reserving

def test_a_reservation_is_a_canonical_photography_booking():
    sp = _special()
    res = _reserve(sp, time="09:00")["reservation"]
    b = run(server.db.bookings.find_one({"id": res["booking_id"]}, {"_id": 0}))
    assert b["service_type"] == "photography"
    assert b["service_id"] == sp["service_id"]
    assert b["date"] == DAY_1 and b["time"] == "09:00"
    assert b["duration_minutes"] == 15
    assert b["photo_special_id"] == sp["id"]
    assert b["status"] == "approved"
    # Pay at the session: the reservation records no money at all.
    assert b.get("actual_price") is None
    assert b.get("amount_paid") in (None, 0)


def test_the_exception_is_visible_when_the_booking_is_read_back_not_just_stored():
    """A fact only the database knows is not visible. Anything that reads a
    booking must be able to see that this one skipped the vaccine gate."""
    sp = _special()
    res = _reserve(sp, time="09:00")["reservation"]
    raw = run(server.db.bookings.find_one({"id": res["booking_id"]}, {"_id": 0}))
    out = server.BookingOut.model_validate(raw).model_dump()
    assert out["vaccine_booking_exception"] == "photo_special"
    assert out["photo_special_id"] == sp["id"]


def test_the_slot_race_is_settled_by_the_database_not_by_a_check():
    sp = _special()
    _reserve(sp, time="09:00")
    # Simulate the loser of a race: availability already said yes, and the
    # insert is what actually decides.
    dup = {
        "id": str(uuid.uuid4()), "photo_special_id": sp["id"], "date": DAY_1, "time": "09:00",
        "status": "approved", "service_type": "photography", "dog_id": "d-y", "dog_name": "Other",
    }
    with pytest.raises(Exception) as e:
        run(server.db.bookings.insert_one(dup))
    assert "duplicate key" in str(e.value).lower(), "ps_slot_unique must reject the second reservation"


def test_the_public_endpoint_turns_a_lost_race_into_a_friendly_refusal():
    sp = _special()
    _reserve(sp, time="09:45")
    with pytest.raises(HTTPException) as e:
        _reserve(sp, time="09:45", dog="Someone Else")
    assert e.value.status_code == 409
    assert "taken" in str(e.value.detail).lower()
    # The page branches on this code (never on the words) to reopen the grid.
    assert e.value.block == {"code": "slot_taken", "action": "pick_time"}


def test_resubmitting_the_same_form_returns_the_same_reservation():
    sp = _special()
    key = uuid.uuid4().hex
    first = _reserve(sp, time="09:00", idempotency_key=key)["reservation"]
    again = _reserve(sp, time="09:00", idempotency_key=key)["reservation"]
    assert first["booking_id"] == again["booking_id"]
    assert run(server.db.bookings.count_documents({"photo_special_id": sp["id"]})) == 1


def test_one_address_cannot_hammer_the_public_endpoint():
    """The throttle is per IP. Same customer, same machine, over and over."""
    sp = _special(start_time="09:00", end_time="13:00", slot_minutes=15)
    ip = f"198.51.100.{uuid.uuid4().int % 250 + 1}"
    slots = [s["time"] for s in run(server.public_photo_special_availability(sp["slug"], DAY_1))["slots"]]
    refused = None
    for i, when in enumerate(slots[:12]):
        body = server.PhotoSpecialReserveIn(
            date=DAY_1, time=when, first_name="Flood", last_name="Er",
            email=f"flood{i}{uuid.uuid4().hex[:6]}@example.com",
            phone=f"614555{uuid.uuid4().int % 10_000_000:07d}", dog_name=f"Dog{i}",
        )
        try:
            run(server.public_photo_special_reserve(sp["slug"], body, _Req(ip)))
        except HTTPException as e:
            if e.status_code == 429:
                refused = i
                break
            raise
    assert refused is not None, "the per-IP rate limit must eventually refuse"
    assert refused >= 5, "but not so early that a normal family booking two dogs is blocked"


def test_the_honeypot_silently_drops_a_bot():
    sp = _special()
    out = _reserve(sp, website="http://spam.example")
    assert out["reservation"] is None
    assert run(server.db.bookings.count_documents({"photo_special_id": sp["id"]})) == 0


# ------------------------------------------------------------ people and dogs

def test_a_new_person_becomes_a_walk_in_owner_with_a_real_dog():
    sp = _special()
    res = _reserve(sp, email="brand.new@example.com", dog="Tank")["reservation"]
    client = run(server.db.clients.find_one({"id": res["client_id"]}, {"_id": 0}))
    dog = run(server.db.dogs.find_one({"id": res["dog_id"]}, {"_id": 0}))
    assert client["client_status"] == "walk_in", "reuses the existing walk-in mechanism"
    assert dog["owner_id"] == client["id"] and dog["name"] == "Tank"


def test_an_existing_client_is_reused_rather_than_duplicated():
    sp = _special()
    email = f"regular{uuid.uuid4().hex[:6]}@example.com"
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": "Regular Customer", "email": email, "phone": "614-555-0123",
        "client_status": "active", "created_at": server.now_iso(),
    }))
    res = _reserve(sp, email=email)["reservation"]
    assert res["client_id"] == cid, "matched by email — no duplicate client"
    after = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
    assert after["client_status"] == "active", "an existing client is not demoted to walk_in"
    assert after["name"] == "Regular Customer", "existing details are never overwritten"


def test_an_existing_client_is_also_found_by_phone():
    sp = _special()
    cid = str(uuid.uuid4())
    phone = "614-555-0777"
    run(server.db.clients.insert_one({
        "id": cid, "name": "Phone Only", "email": "", "phone": phone,
        "client_status": "active", "created_at": server.now_iso(),
    }))
    res = _reserve(sp, email=f"new{uuid.uuid4().hex[:6]}@example.com", phone=phone)["reservation"]
    assert res["client_id"] == cid


def test_the_public_response_cannot_be_used_to_discover_who_is_a_customer():
    sp = _special()
    email = f"known{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.clients.insert_one({
        "id": str(uuid.uuid4()), "name": "Known", "email": email, "client_status": "active",
        "created_at": server.now_iso(),
    }))
    known = _reserve(sp, time="09:00", email=email)["reservation"]
    stranger = _reserve(sp, time="09:15", email=f"nobody{uuid.uuid4().hex[:6]}@example.com")["reservation"]
    assert set(known) == set(stranger), "the two responses must be shaped identically"
    for field in ("client_status", "is_existing_client", "merged", "matched"):
        assert field not in known, f"{field} would reveal whether the address is on file"


def test_a_second_dog_for_the_same_person_takes_its_own_slot():
    sp = _special()
    email = f"two.dogs{uuid.uuid4().hex[:6]}@example.com"
    a = _reserve(sp, time="09:00", email=email, dog="Bella")["reservation"]
    b = _reserve(sp, time="09:15", email=email, dog="Max")["reservation"]
    assert a["client_id"] == b["client_id"], "one owner"
    assert a["dog_id"] != b["dog_id"], "two dogs, two records"
    assert a["time"] != b["time"], "one dog per appointment"


# ----------------------------------------------------------------- vaccines

def test_a_missing_vaccine_record_does_not_block_a_portrait_reservation():
    sp = _special()
    res = _reserve(sp, email=f"novax{uuid.uuid4().hex[:6]}@example.com")["reservation"]
    assert res["booking_id"]


def test_the_exception_is_explicit_and_no_vaccine_record_is_fabricated():
    sp = _special()
    res = _reserve(sp)["reservation"]
    b = run(server.db.bookings.find_one({"id": res["booking_id"]}, {"_id": 0}))
    assert b["vaccine_booking_exception"] == "photo_special", "the exception must be visible in the data"
    dog = run(server.db.dogs.find_one({"id": res["dog_id"]}, {"_id": 0}))
    assert dog["vaccines"] == {}, "the dog's real vaccine state is left exactly as it is"


def test_front_desk_can_still_see_the_dogs_real_vaccine_state():
    sp = _special()
    res = _reserve(sp)["reservation"]
    assert res["vaccines_on_file"] is False, "informational, and honest"
    roster = run(server.admin_photo_special_reservations(sp["id"], DAY_1, ADMIN))
    row = next(r for r in roster["reservations"] if r["booking_id"] == res["booking_id"])
    assert row["vaccines_on_file"] is False
    assert row["vaccine_exception"] == "photo_special"


def test_the_exception_does_not_leak_into_ordinary_bookings():
    # An everyday booking must still go through the canonical vaccine gate; the
    # photo-special exception is a property of photo-special reservations only.
    sp = _special()
    res = _reserve(sp)["reservation"]
    ordinary = run(server.db.bookings.find_one(
        {"photo_special_id": {"$exists": False}, "service_type": {"$ne": "photography"}}, {"_id": 0}
    ))
    if ordinary:
        assert ordinary.get("vaccine_booking_exception") is None
    assert run(server.db.bookings.count_documents(
        {"vaccine_booking_exception": "photo_special", "photo_special_id": {"$exists": False}}
    )) == 0, "nothing outside a photo special may carry the exception"


# -------------------------------------------------------- cancel and no-show

def test_cancelling_a_reservation_reopens_its_slot():
    sp = _special()
    res = _reserve(sp, time="09:30")["reservation"]
    assert run(server.public_photo_special_availability(sp["slug"], DAY_1))["slots"][2]["available"] is False
    run(server.db.bookings.update_one({"id": res["booking_id"]}, {"$set": {"status": "cancelled"}}))
    after = {s["time"]: s["available"] for s in run(server.public_photo_special_availability(sp["slug"], DAY_1))["slots"]}
    assert after["09:30"] is True, "a cancelled reservation must not hold its slot"


def test_a_cancelled_slot_can_be_taken_by_somebody_else():
    sp = _special()
    res = _reserve(sp, time="09:00")["reservation"]
    run(server.db.bookings.update_one({"id": res["booking_id"]}, {"$set": {"status": "cancelled"}}))
    again = _reserve(sp, time="09:00", dog="Second Dog")["reservation"]
    assert again["booking_id"] != res["booking_id"], "the freed slot is genuinely bookable again"


def test_marking_a_no_show_frees_the_slot_and_charges_nothing():
    sp = _special()
    res = _reserve(sp, time="09:15")["reservation"]
    out = run(server.admin_mark_no_show(sp["id"], res["booking_id"], ADMIN))
    assert out["no_show"] is True
    b = run(server.db.bookings.find_one({"id": res["booking_id"]}, {"_id": 0}))
    assert b["status"] == "cancelled" and b["no_show"] is True
    # No deposit, no stored card, no automated fee in this release.
    assert b.get("cancellation_charged") in (None, False)
    assert b.get("cancellation_fee") in (None, 0)
    after = {s["time"]: s["available"] for s in run(server.public_photo_special_availability(sp["slug"], DAY_1))["slots"]}
    assert after["09:15"] is True


# ---------------------------------------------------------------------- admin

def test_the_roster_is_in_time_order_with_what_front_desk_needs():
    sp = _special()
    _reserve(sp, time="09:30", dog="Luna")
    _reserve(sp, time="09:00", dog="Bella")
    roster = run(server.admin_photo_special_reservations(sp["id"], DAY_1, ADMIN))
    assert [r["time"] for r in roster["reservations"]] == ["09:00", "09:30"]
    row = roster["reservations"][0]
    for field in ("dog_name", "client_name", "client_id", "dog_id", "status", "booking_id"):
        assert field in row, f"event day needs {field} to act on the reservation"
    assert roster["booked_count"] == 2


def test_an_admin_can_add_a_reservation_by_hand_through_the_same_rules():
    sp = _special()
    owner = {"id": str(uuid.uuid4()), "name": "Phone Booking", "client_status": "active", "created_at": server.now_iso()}
    run(server.db.clients.insert_one(dict(owner)))
    dog = {"id": str(uuid.uuid4()), "owner_id": owner["id"], "name": "Rufus", "vaccines": {}, "created_at": server.now_iso()}
    run(server.db.dogs.insert_one(dict(dog)))
    row = run(server.admin_add_reservation(
        sp["id"], server.PhotoSpecialManualReservationIn(date=DAY_1, time="09:45", dog_id=dog["id"]), ADMIN))
    assert row["time"] == "09:45" and row["dog_name"] == "Rufus"
    with pytest.raises(HTTPException) as e:
        run(server.admin_add_reservation(
            sp["id"], server.PhotoSpecialManualReservationIn(date=DAY_1, time="09:45", dog_id=dog["id"]), ADMIN))
    assert e.value.status_code == 409, "a manual add obeys the same availability"


def test_a_special_with_reservations_cannot_be_deleted_out_from_under_them():
    sp = _special()
    _reserve(sp)
    with pytest.raises(HTTPException) as e:
        run(server.admin_delete_photo_special(sp["id"], ADMIN))
    assert e.value.status_code == 409


def test_editing_a_special_keeps_its_public_link_working():
    sp = _special()
    body = server.PhotoSpecialIn(name=sp["name"], dates=[DAY_1], start_time="10:00", end_time="11:00",
                                 slot_minutes=15, published=True, booking_open=True)
    updated = run(server.admin_update_photo_special(sp["id"], body, ADMIN))
    assert updated["slug"] == sp["slug"], "the public URL must not move under an edit"
    assert updated["start_time"] == "10:00"


def test_an_unpublished_special_is_not_reachable_publicly():
    sp = _special(published=False)
    with pytest.raises(HTTPException) as e:
        run(server.public_photo_special(sp["slug"]))
    assert e.value.status_code == 404


def test_photo_special_admin_needs_manage_events_and_a_trainer_does_not_have_it():
    dep = server.require_admin_and_permission("manage_events")
    assert run(dep(ADMIN)) is not None
    trainer = {"id": "ps-tr", "name": "Trainer", "role": "employee", "staff_role": "trainer"}
    if not server._perms_for(trainer).get("manage_events"):
        with pytest.raises(HTTPException) as e:
            run(dep(trainer))
        assert e.value.status_code == 403


def test_front_desk_sees_the_day_in_time_order_with_the_gaps():
    """The event-day list is as much about the free times as the booked ones —
    a gap is when the desk can take a walk-up."""
    sp = _special(start_time="09:00", end_time="10:00", slot_minutes=15)
    _reserve(sp, time="09:00", dog="Bella")
    _reserve(sp, time="09:30", dog="Luna")
    out = run(server.admin_photo_specials_today(DAY_1, ADMIN))
    mine = next(x for x in out["specials"] if x["special"]["id"] == sp["id"])
    line = [(t["time"], t.get("dog_name") or "AVAILABLE") for t in mine["timeline"]]
    assert line == [("09:00", "Bella"), ("09:15", "AVAILABLE"), ("09:30", "Luna"), ("09:45", "AVAILABLE")]
    assert mine["booked_count"] == 2
    booked = next(t for t in mine["timeline"] if t.get("dog_name") == "Bella")
    assert booked["vaccines_on_file"] is False, "the desk still sees the real vaccine state"
    for field in ("client_name", "client_id", "booking_id"):
        assert field in booked, f"the desk needs {field} to act on the reservation"


def test_the_event_day_route_is_not_shadowed_by_the_dynamic_sibling():
    import re as _re
    ordered = [(getattr(r, "path", ""), set(r.methods or [])) for r in server.app.routes if hasattr(r, "methods")]
    paths = [p for p, _ in ordered]
    assert "/api/admin/photo-specials/today" in paths
    idx = paths.index("/api/admin/photo-specials/today")
    for earlier, methods in ordered[:idx]:
        if "{" not in earlier or "GET" not in methods:
            continue
        assert not _re.match("^" + _re.sub(r"\{[^}]+\}", "[^/]+", earlier) + "$", "/api/admin/photo-specials/today"), (
            f"{earlier} is registered earlier and would swallow the event-day route"
        )


def test_photo_special_routes_live_in_a_domain_module():
    from domains.photo_specials import routes as ps_routes
    assert hasattr(ps_routes, "register_photo_special_routes")
    assert server.public_photo_special_reserve.__module__ == "domains.photo_specials.routes"
