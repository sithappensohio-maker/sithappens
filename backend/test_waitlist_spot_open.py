"""A spot opening for a waitlisted dog shows in Action Required (audit #33).

The portal promised "We'll let you know when a spot opens up", and nothing
ever looked at the waitlist again: a cancel, a decline, a checkout or a
capacity raise freed the spot and nobody was told. Now every active entry
that could be booked right now shows in Action Required (and on the Today
screen), in the order people joined, until it's converted, declined or
removed, its date passes, or the day fills again. Worked out from the real
bookings on every read, so every way a spot opens is caught.

Disposable tag TEST_WAITLIST_SPOT.
"""
import contextlib
import random
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.bookings import waitlist_spots

TAG = "TEST_WAITLIST_SPOT"
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}
ADMIN = {"id": "waitlist-spot-admin", "role": "admin", "name": f"{TAG} admin", "email": "wl-spot@test"}
_used_days = set()


def _day(weekday=2, base=300):
    """A far-future open weekday no other test in this file uses."""
    while True:
        d = date.today() + timedelta(days=base + random.randint(0, 700))
        while d.weekday() != weekday:
            d += timedelta(days=1)
        if d.isoformat() not in _used_days:
            _used_days.add(d.isoformat())
            return d.isoformat()


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


@contextlib.contextmanager
def _families(n):
    ids = [str(uuid.uuid4()) for _ in range(n)]
    fams = []
    for i, cid in enumerate(ids):
        dog = {"id": str(uuid.uuid4()), "name": f"Pup{i}{uuid.uuid4().hex[:4]}", "owner_id": cid, "breed": "Mix",
               "vaccines": dict(VACCINES_OK)}
        client = {"id": cid, "name": f"{TAG} Family {i}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "created_at": server.now_iso()}
        run(server.db.clients.insert_one(dict(client)))
        run(server.db.dogs.insert_one(dict(dog)))
        fams.append((client, dog))
    try:
        yield fams
    finally:
        run(server.db.bookings.delete_many({"client_id": {"$in": ids}}))
        run(server.db.waitlist.delete_many({"client_id": {"$in": ids}}))
        run(server.db.dogs.delete_many({"owner_id": {"$in": ids}}))
        run(server.db.clients.delete_many({"id": {"$in": ids}}))


def _book(fam, day, service="daycare", end=None, **extra):
    client, dog = fam
    b = {"id": str(uuid.uuid4()), "client_id": client["id"], "client_name": client["name"], "dog_id": dog["id"],
         "dog_name": dog["name"], "service_type": service, "date": day, "end_date": end, "status": "approved",
         "created_at": server.now_iso(), **extra}
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _wait(fam, day, joined, service="daycare", end=None, time=None, status="waiting"):
    client, dog = fam
    e = {"id": str(uuid.uuid4()), "dedupe_key": str(uuid.uuid4()), "dog_id": dog["id"], "dog_name": dog["name"],
         "client_id": client["id"], "client_name": client["name"], "service_type": service, "service_id": None,
         "requested_date": day, "requested_end_date": end or day, "time": time, "priority": "normal", "notes": "",
         "status": status, "created_at": joined, "created_by": ADMIN["id"]}
    run(server.db.waitlist.insert_one(dict(e)))
    return e


def _used(day, service="daycare"):
    return run(server._booking_days_count_filtered(day, service))


def _items(user=ADMIN):
    res = run(server._collect_pending_actions(user, limit=300))
    return [i for i in res["items"] if i["type"] == "waitlist_spot_open"]


def _mine(entries, user=ADMIN):
    ids = {f"waitlist_spot_open:{e['id']}" for e in entries}
    return [i for i in _items(user) if i["id"] in ids]


def _cancel(b):
    run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "cancelled"}}))


# ------------------------------------------------------------- the prompt

def test_a_cancellation_opens_the_spot_to_the_waitlist_in_the_order_they_joined():
    with _families(3) as (a, b, c):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            booking = _book(a, day)
            eb = _wait(b, day, "2026-01-01T09:00:00+00:00")
            ec = _wait(c, day, "2026-01-02T09:00:00+00:00")
            assert _mine([eb, ec]) == [], "the day is full"
            _cancel(booking)
            items = _mine([eb, ec])
            assert [i["id"] for i in items] == [f"waitlist_spot_open:{eb['id']}", f"waitlist_spot_open:{ec['id']}"]
            first = items[0]
            assert (first["waitlist_position"], first["waitlist_line"], first["open_spots"]) == (1, 2, 1)
            assert first["deep_link"] == {"screen": "waitlist", "waitlist_entry_id": eb["id"]}
            assert first["required_permission"] == "booking_edit" and first["type_label"] == "Waitlist — Spot Opened"
            assert first["waiting_label"] == "#1 of 2 in line · 1 spot open"
            count = run(server.admin_pending_actions_count(ADMIN))
            assert count["waitlist_spots_open"] == len(_items()) and count["total"] >= count["waitlist_spots_open"]


def test_the_prompt_goes_away_once_the_day_fills_again_and_comes_back_on_a_decline():
    with _families(3) as (a, b, c):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            eb = _wait(b, day, "2026-01-01T09:00:00+00:00")
            assert len(_mine([eb])) == 1
            other = _book(c, day, status="pending")                  # someone else books the spot
            assert _mine([eb]) == []
            run(server.db.bookings.update_one({"id": other["id"]}, {"$set": {"status": "declined"}}))
            assert len(_mine([eb])) == 1, "a decline frees it again"


def test_an_offered_entry_stays_until_converted_or_declined_and_finished_ones_never_show():
    with _families(2) as (a, b):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            offered = _wait(a, day, "2026-01-01T09:00:00+00:00", status="offered")
            items = _mine([offered])
            assert len(items) == 1 and items[0]["status"] == "offered"
            assert items[0]["waiting_label"] == "Offered — waiting on their answer"
            for status in ("declined", "removed", "booked", "expired", "converting"):
                run(server.db.waitlist.update_one({"id": offered["id"]}, {"$set": {"status": status}}))
                assert _mine([offered]) == [], status
            gone = _wait(b, day, "2026-01-02T09:00:00+00:00")
            assert len(_mine([gone])) == 1
            run(server.db.waitlist.delete_one({"id": gone["id"]}))
            assert _mine([gone]) == []


def test_boarding_needs_room_every_night_of_the_stay():
    with _families(3) as (a, b, c):
        d1 = _day(weekday=4)
        d2 = (date.fromisoformat(d1) + timedelta(days=1)).isoformat()
        cap = max(_used(d1, "boarding"), _used(d2, "boarding")) + 1
        with _settings(boarding_capacity=cap):
            stay = _wait(a, d1, "2026-01-01T09:00:00+00:00", service="boarding", end=d2)
            assert len(_mine([stay])) == 1
            fillers = [_book(b, d2, service="boarding", end=d2) for _ in range(cap - _used(d2, "boarding"))]
            assert _mine([stay]) == [], "the second night is full"
            for f in fillers:
                _cancel(f)
            assert len(_mine([stay])) == 1
            range_daycare = _wait(c, d1, "2026-01-02T09:00:00+00:00", end=d2)     # Convert refuses these
            assert _mine([range_daycare]) == []


def test_a_closed_day_a_switched_off_waitlist_or_a_past_date_never_shows():
    with _families(2) as (a, b):
        day = _day()
        past = server.business_today() - timedelta(days=7)
        while past.weekday() != 2:            # an open weekday, so only its date keeps it out
            past -= timedelta(days=1)
        past = past.isoformat()
        with _settings(daycare_capacity=max(_used(day), _used(past)) + 1):
            e = _wait(a, day, "2026-01-01T09:00:00+00:00")
            assert len(_mine([e])) == 1
            with _settings(closed_dates=[day]):
                assert _mine([e]) == [], "never offer a holiday"
            with _settings(feature_visibility__waitlist=False):
                assert _mine([e]) == []
            gone_by = _wait(b, past, "2026-01-02T09:00:00+00:00")
            assert _mine([gone_by]) == []
            with _settings(service_hours__daycare={"wednesday": {"closed": True}}):
                assert _mine([e]) == [], "a closed weekday is never offered either"


def test_a_dog_picked_up_today_does_not_open_a_spot_for_today():
    with _families(2) as (a, b):
        t = server.business_today().isoformat()
        base = _used(t) + run(waitlist_spots._picked_up_today(t))
        # Open all day whatever day and hour the suite runs.
        with _settings(daycare_capacity=base + 1, closed_dates=[], service_hours__daycare={"mode": "24_7"}):
            e = _wait(b, t, "2026-01-01T09:00:00+00:00")
            assert len(_mine([e])) == 1
            gone_home = _book(a, t, checked_out_at=server.now_iso())
            assert _mine([e]) == [], "a pickup this afternoon is not a spot to offer for today"
            _cancel(gone_home)
            assert len(_mine([e])) == 1


def test_a_taken_time_slot_opens_when_its_booking_is_cancelled():
    with _families(2) as (a, b):
        day = _day()
        booking = _book(a, day, service="grooming", time="10:00", duration_minutes=60)
        e = _wait(b, day, "2026-01-01T09:00:00+00:00", service="grooming", time="10:00")
        assert _mine([e]) == []
        _cancel(booking)
        assert len(_mine([e])) == 1


def test_only_staff_who_can_book_see_it(monkeypatch):
    # A role the owner set up to see care alerts but not to book: it sees
    # Action Required, but no waitlist prompt it couldn't act on.
    carer = {"id": str(uuid.uuid4()), "role": "admin", "staff_role": "caretaker", "name": "Carer"}
    real = server._perms_for
    monkeypatch.setattr(server, "_perms_for", lambda u: {"care_complete": True} if u.get("id") == carer["id"] else real(u))
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            e = _wait(a, day, "2026-01-01T09:00:00+00:00")
            assert len(_mine([e])) == 1
            assert run(server.admin_pending_actions_count(carer))["waitlist_spots_open"] == 0
            assert _mine([e], user=carer) == []
            assert "waitlist_spot_open" not in server._ALWAYS_VISIBLE_ACTION_TYPES


def test_the_today_screen_nudges_too():
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            _wait(a, day, "2026-01-01T09:00:00+00:00")
            brain = run(server.admin_today_brain(_=ADMIN))
            item = next(i for i in brain["items"] if i["kind"] == "waitlist_spot_open")
            assert item["cta"] == {"type": "open_screen", "screen": "waitlist"}
            assert server._today_brain_signature(item).startswith("waitlist_spot_open:")



# ---------------- shown only when Convert would really book it (review)

def test_a_dog_already_booked_that_day_is_not_offered_the_spot_again():
    with _families(2) as (a, b):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 2):
            _book(a, day)                                           # booked some other way
            ea = _wait(a, day, "2026-01-01T09:00:00+00:00")
            eb = _wait(b, day, "2026-01-02T09:00:00+00:00")
            items = _mine([ea, eb])
            assert [i["dog_id"] for i in items] == [b[1]["id"]]
            assert (items[0]["waitlist_position"], items[0]["waitlist_line"]) == (1, 1), "and it doesn't hold a place in line"


def test_the_booking_rules_convert_follows_keep_an_entry_off():
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 2, day_to_day__guardrails__max_bookings_per_client_per_day=1):
            e = _wait(a, day, "2026-01-01T09:00:00+00:00")
            assert len(_mine([e])) == 1
            other_dog = {"id": str(uuid.uuid4()), "name": "Second", "owner_id": a[0]["id"], "breed": "Mix"}
            run(server.db.dogs.insert_one(dict(other_dog)))
            _book((a[0], other_dog), day)                           # the family's one booking that day
            assert _mine([e]) == [], "one booking per family per day"
        t = server.business_today().isoformat()
        with _settings(daycare_capacity=_used(t) + run(waitlist_spots._picked_up_today(t)) + 1, closed_dates=[],
                       service_hours__daycare={"mode": "24_7"}, day_to_day__guardrails__same_day_booking_allowed=False):
            today_entry = _wait(a, t, "2026-01-03T09:00:00+00:00")
            assert _mine([today_entry]) == [], "same-day bookings are switched off"


def test_a_stay_longer_than_allowed_or_with_no_pickup_day_is_not_offered():
    with _families(2) as (a, b):
        d1 = _day(weekday=4)
        d4 = (date.fromisoformat(d1) + timedelta(days=3)).isoformat()
        cap = max(_used((date.fromisoformat(d1) + timedelta(days=i)).isoformat(), "boarding") for i in range(4)) + 1
        with _settings(boarding_capacity=cap):
            long_stay = _wait(a, d1, "2026-01-01T09:00:00+00:00", service="boarding", end=d4)
            assert len(_mine([long_stay])) == 1
            with _settings(day_to_day__guardrails__max_consecutive_boarding_nights=2):
                assert _mine([long_stay]) == []
            no_pickup = _wait(b, d1, "2026-01-02T09:00:00+00:00", service="boarding", end=d1)
            assert _mine([no_pickup]) == []


def test_a_time_already_gone_today_is_not_offered():
    with _families(1) as (a,):
        t = server.business_today().isoformat()
        with _settings(closed_dates=[], service_hours__grooming={"mode": "24_7"}):
            early = _wait(a, t, "2026-01-01T09:00:00+00:00", service="grooming", time="00:00")
            assert _mine([early]) == []
            later = _wait(a, _day(), "2026-01-02T09:00:00+00:00", service="grooming", time="00:00")
            assert len(_mine([later])) == 1, "the same time on a later day is open"


def test_a_removed_dog_or_family_is_not_offered():
    with _families(2) as (a, b):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            ea = _wait(a, day, "2026-01-01T09:00:00+00:00")
            eb = _wait(b, day, "2026-01-02T09:00:00+00:00")
            assert len(_mine([ea, eb])) == 2
            run(server.db.dogs.update_one({"id": a[1]["id"]}, {"$set": {"deleted_at": server.now_iso()}}))
            run(server.db.clients.update_one({"id": b[0]["id"]}, {"$set": {"deleted_at": server.now_iso()}}))
            assert _mine([ea, eb]) == []


def test_place_in_line_for_boarding_counts_everyone_after_the_same_nights():
    with _families(3) as (a, b, c):
        d1 = _day(weekday=4)
        day = lambda n: (date.fromisoformat(d1) + timedelta(days=n)).isoformat()
        cap = max(_used(day(i), "boarding") for i in range(8)) + 1
        with _settings(boarding_capacity=cap):
            first = _wait(a, day(0), "2026-01-01T09:00:00+00:00", service="boarding", end=day(3))
            overlap = _wait(b, day(2), "2026-01-02T09:00:00+00:00", service="boarding", end=day(4))   # shares nights 2-3
            apart = _wait(c, day(6), "2026-01-03T09:00:00+00:00", service="boarding", end=day(7))
            by = {i["id"].split(":", 1)[1]: i for i in _mine([first, overlap, apart])}
            assert (by[first["id"]]["waitlist_position"], by[first["id"]]["waitlist_line"]) == (1, 2)
            assert (by[overlap["id"]]["waitlist_position"], by[overlap["id"]]["waitlist_line"]) == (2, 2)
            assert (by[apart["id"]]["waitlist_position"], by[apart["id"]]["waitlist_line"]) == (1, 1)


def test_the_today_nudge_is_only_for_staff_who_can_book(monkeypatch):
    carer = {"id": str(uuid.uuid4()), "role": "admin", "staff_role": "caretaker", "name": "Carer"}
    real = server._perms_for
    monkeypatch.setattr(server, "_perms_for", lambda u: {"care_complete": True} if u.get("id") == carer["id"] else real(u))
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            _wait(a, day, "2026-01-01T09:00:00+00:00")
            assert run(waitlist_spots.today_brain_items(ADMIN))
            assert run(waitlist_spots.today_brain_items(carer)) == []


def test_one_odd_entry_never_blanks_the_whole_list(monkeypatch):
    with _families(2) as (a, b):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 2):
            odd = _wait(a, day, "2026-01-01T09:00:00+00:00")
            fine = _wait(b, day, "2026-01-02T09:00:00+00:00")
            real = waitlist_spots._convert_would_book

            async def _flaky(entry, *rest):
                if entry["id"] == odd["id"]:
                    raise ValueError("bad row")
                return await real(entry, *rest)
            monkeypatch.setattr(waitlist_spots, "_convert_would_book", _flaky)
            assert [i["id"] for i in _mine([odd, fine])] == [f"waitlist_spot_open:{fine['id']}"]



# ------------- every other refusal Convert would meet (second review)

def test_a_dog_whose_vaccines_lapsed_is_not_offered():
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            e = _wait(a, day, "2026-01-01T09:00:00+00:00")
            assert len(_mine([e])) == 1
            run(server.db.dogs.update_one({"id": a[1]["id"]}, {"$set": {"vaccines.rabies": "2020-01-01"}}))
            assert _mine([e]) == [], "Convert refuses an expired rabies"


def test_a_family_due_its_meet_and_greet_or_rejected_is_not_offered():
    with _families(1) as (a,):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            e = _wait(a, day, "2026-01-01T09:00:00+00:00")
            for status in ("prospect", "evaluation_scheduled", "rejected"):
                run(server.db.clients.update_one({"id": a[0]["id"]}, {"$set": {"client_status": status}}))
                assert _mine([e]) == [], status
            run(server.db.clients.update_one({"id": a[0]["id"]}, {"$set": {"client_status": "active"}}))
            assert len(_mine([e])) == 1


def test_a_retired_service_is_not_offered():
    svc = {"id": f"{TAG}-{uuid.uuid4()}", "name": f"{TAG} Grooming", "service_type": "grooming", "active": True,
           "base_price": 50.0, "duration_minutes": 60}
    run(server.db.services.insert_one(dict(svc)))
    try:
        with _families(1) as (a,):
            day = _day()
            e = _wait(a, day, "2026-01-01T09:00:00+00:00", service="grooming", time="10:00")
            run(server.db.waitlist.update_one({"id": e["id"]}, {"$set": {"service_id": svc["id"]}}))
            e["service_id"] = svc["id"]
            assert len(_mine([e])) == 1
            run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"active": False}}))
            assert _mine([e]) == []
    finally:
        run(server.db.services.delete_one({"id": svc["id"]}))


def test_overlapping_appointment_times_are_one_line():
    with _families(3) as (a, b, c):
        day = _day()
        first = _wait(a, day, "2026-01-01T09:00:00+00:00", service="grooming", time="10:00")
        overlap = _wait(b, day, "2026-01-02T09:00:00+00:00", service="training", time="10:30")
        later = _wait(c, day, "2026-01-03T09:00:00+00:00", service="grooming", time="15:00")
        by = {i["id"].split(":", 1)[1]: i for i in _mine([first, overlap, later])}
        assert (by[first["id"]]["waitlist_position"], by[first["id"]]["waitlist_line"]) == (1, 2)
        assert (by[overlap["id"]]["waitlist_position"], by[overlap["id"]]["waitlist_line"]) == (2, 2)
        assert (by[later["id"]]["waitlist_position"], by[later["id"]]["waitlist_line"]) == (1, 1)


def test_a_malformed_entry_never_blanks_the_list():
    with _families(2) as (a, b):
        day = _day()
        with _settings(daycare_capacity=_used(day) + 1):
            _wait(a, day, "2026-01-01T09:00:00+00:00", service="boarding", end="not-a-date")
            fine = _wait(b, day, "2026-01-02T09:00:00+00:00")
            assert len(_mine([fine])) == 1
