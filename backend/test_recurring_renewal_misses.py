"""A weekly schedule's automatic renewal never books a closed day, and every
day it couldn't book shows in Action Required (audit #35).

The scheduler renewed regulars' schedules as an admin, so holidays in
Settings → closed dates were booked (that check was clients-only), and a day
it couldn't book — full, closed, any refusal — vanished: only a count was
kept, no screen read it, and the booked-through date moved past the day.

Disposable tag TEST_RENEWAL_MISS.
"""
import contextlib
import uuid
from datetime import timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
from domains.bookings import renewal_misses

TAG = "TEST_RENEWAL_MISS"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} admin",
         "role": "admin", "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def _service():
    existing = run(server.db.services.find_one({"service_type": "daycare", "active": True}, {"_id": 0, "id": 1}))
    if existing:
        return existing["id"]
    sid = f"{TAG}-svc-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare", "active": True,
                                       "is_default": True, "price": 30.0}))
    return sid


@contextlib.contextmanager
def _family():
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "created_at": server.now_iso()}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rosie", "owner_id": cid, "breed": "Mix", "vaccines": dict(VACCINES_OK)}))
    try:
        yield cid, did
    finally:
        run(server.db.bookings.delete_many({"$or": [{"dog_id": did}, {"notes": {"$regex": TAG}}]}))
        run(server.db.recurring_templates.delete_many({"$or": [{"dog_id": did}, {"id": {"$regex": f"^{TAG}"}}]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.users.delete_many({"id": {"$regex": f"^{TAG}"}}))


def _template(did, sid, **extra):
    today = server.business_today()
    doc = {"id": f"{TAG}-t-{uuid.uuid4().hex[:6]}", "dog_id": did, "label": f"{TAG} weekly", "service_type": "daycare",
           "service_id": sid, "time": "", "dropoff_time": "", "weekdays": [0, 1, 2, 3, 4, 5, 6], "notes": "",
           "default_horizon_weeks": 1, "start_date": "", "active": True, "auto_extend": True,
           "last_booked_through": (today + timedelta(days=5)).isoformat(), "created_at": server.now_iso(), "created_by": "admin"}
    doc.update(extra)
    run(server.db.recurring_templates.insert_one(dict(doc)))
    return doc


def _window():
    start = server.business_today() + timedelta(days=6)
    return start, [(start + timedelta(days=i)).isoformat() for i in range(8)]


def _used(day):
    return run(server._booking_days_count_filtered(day, "daycare"))


@contextlib.contextmanager
def _trouble():
    """A holiday H, a closed weekday W and a full day F inside the renewal window."""
    start, days = _window()
    h, w, f = days[1], days[3], days[5]
    w_name = server.DEFAULT_DAYS[(start + timedelta(days=3)).weekday()]
    cap = max(_used(d) for d in days) + 1
    hours = {d: {"closed": d == w_name, "open": "07:00", "close": "19:00"} for d in server.DEFAULT_DAYS}   # only W is closed
    with _settings(closed_dates=[h], daycare_capacity=cap, service_hours__daycare=hours):
        for _ in range(cap - _used(f)):
            run(server.db.bookings.insert_one({"id": str(uuid.uuid4()), "dog_id": f"{TAG}-filler", "client_id": f"{TAG}-x",
                                               "service_type": "daycare", "date": f, "status": "approved", "notes": f"{TAG} filler"}))
        yield h, w, f


def _items(user=None):
    res = run(server._collect_pending_actions(user or {"id": "x", "role": "admin"}, limit=300))
    return [i for i in res["items"] if i["type"] == "recurring_renewal_missed"]


def _mine(t, user=None):
    return [i for i in _items(user) if i["template_id"] == t["id"]]


def _misses(t):
    return run(server.db.recurring_templates.find_one({"id": t["id"]}, {"_id": 0})).get("renewal_misses") or []


# ------------------------------------------------------------- the renewal

def test_the_renewal_skips_a_holiday_and_keeps_every_day_it_couldnt_book():
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        assert not run(server.db.bookings.find_one({"dog_id": did, "date": h, "status": {"$ne": "cancelled"}}, {"_id": 1})), \
            "never a holiday"
        got = {m["date"]: (m["code"], m["label"]) for m in _misses(t)}
        assert got == {h: ("closed_date", "closed"), w: ("closed_day", "closed"), f: ("capacity_full", "full")}
        items = _mine(t)
        assert len(items) == 1
        assert [d["date"] for d in items[0]["missed_days"]] == sorted([h, w, f])
        assert "couldn't book" in items[0]["summary"] and "Rosie" in items[0]["summary"]
        assert items[0]["deep_link"] == {"screen": "recurring", "recurring_template_id": t["id"]}
        count = run(server.admin_pending_actions_count({"id": "x", "role": "admin"}))
        assert count["recurring_renewals_missed"] == len(_items())


def test_running_again_keeps_one_entry_per_day_and_never_lists_an_already_booked_day():
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {
            "last_booked_through": (server.business_today() + timedelta(days=5)).isoformat()}}))   # e.g. after a restore
        run(server._auto_extend_recurring_templates_once())
        dates = [m["date"] for m in _misses(t)]
        assert sorted(dates) == sorted([h, w, f]), "one entry per date; days already booked are not misses"


# -------------------------------------------------------- how an item clears

def test_the_item_clears_as_each_day_is_dealt_with():
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        run(server.db.bookings.insert_one({"id": str(uuid.uuid4()), "dog_id": did, "client_id": cid, "service_type": "daycare",
                                           "date": f, "status": "approved", "notes": f"{TAG} squeezed in"}))
        assert [d["date"] for d in _mine(t)[0]["missed_days"]] == sorted([h, w]), "booked by hand: off the list"
        weekdays = [int(x) for x in t["weekdays"] if x != server.date.fromisoformat(w).weekday()]
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {"weekdays": weekdays}}))
        assert [d["date"] for d in _mine(t)[0]["missed_days"]] == [h], "no longer on the schedule's days"
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$push": {"renewal_misses": {
            "date": "2020-01-01", "code": "capacity_full", "label": "full", "dog_id": did, "recorded_at": server.now_iso()}}}))
        assert [d["date"] for d in _mine(t)[0]["missed_days"]] == [h], "a day gone by is not listed"
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {"active": False}}))
        assert _mine(t) == [], "a paused schedule is not followed up"
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {"active": True}}))
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {"dog_id": f"{TAG}-other-dog"}}))
        assert _mine(t) == [], "misses of a dog the schedule no longer books"


def test_followed_up_hides_what_was_shown_and_a_later_miss_comes_back():
    sid = _service()
    admin = _admin()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        item = _mine(t)[0]
        later = (server.business_today() + timedelta(days=20)).isoformat()
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$push": {"renewal_misses": {   # missed after the page was shown
            "date": later, "code": "capacity_full", "label": "full", "dog_id": did, "recorded_at": item["recorded_through"] + "Z"}}}))
        r = run(_http.post(f"/api/recurring-templates/{t['id']}/followed-up", json={"through": item["recorded_through"]}, headers=_auth(admin)))
        assert r.status_code == 200, r.text
        assert [d["date"] for d in _mine(t)[0]["missed_days"]] == [later], "only what staff saw is marked"
        run(_http.post(f"/api/recurring-templates/{t['id']}/followed-up", json={"through": "2000-01-01T00:00:00"}, headers=_auth(admin)))
        assert [d["date"] for d in _mine(t)[0]["missed_days"]] == [later], "an older mark never brings back what was followed up"
        assert run(_http.post(f"/api/recurring-templates/{TAG}-nope/followed-up", json={"through": item["recorded_through"]},
                              headers=_auth(admin))).status_code == 404


def test_a_schedule_that_cannot_renew_at_all_shows_until_it_renews_again():
    sid = _service()
    with _family() as (cid, did):
        t = _template(did, sid)
        run(server.db.dogs.update_one({"id": did}, {"$set": {"vaccines": {"rabies": "2020-01-01"}}}))
        run(server._auto_extend_recurring_templates_once())
        items = _mine(t)
        assert len(items) == 1 and "stopped renewing" in items[0]["summary"] and items[0]["renewal_block"]["label"] == "vaccines"
        today_row = run(renewal_misses.today_brain_items({"id": "x", "role": "admin"}))[0]
        assert "stopped renewing" in today_row["title"] and "0 day" not in today_row["title"]
        run(server.db.dogs.update_one({"id": did}, {"$set": {"vaccines": dict(VACCINES_OK)}}))
        run(server.extend_recurring_template(t["id"], server.ExtendTemplateIn(weeks=1), {"id": "staff", "role": "admin"}))
        left = _mine(t)
        assert all(not i["renewal_block"] and "stopped renewing" not in i["summary"] for i in left),             "a successful renewal clears it (any day it then couldn't book is its own line)"


# ------------------------------------------------------------ who sees what

def test_only_staff_who_can_book_see_it(monkeypatch):
    sid = _service()
    carer = {"id": f"{TAG}-carer", "role": "admin", "staff_role": "caretaker"}
    real = server._perms_for
    monkeypatch.setattr(server, "_perms_for", lambda u: {"care_complete": True} if u.get("id") == carer["id"] else real(u))
    with _family() as (cid, did), _trouble() as (h, w, f):
        _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        assert _items(carer) == [] and run(server.admin_pending_actions_count(carer))["recurring_renewals_missed"] == 0
        assert "recurring_renewal_missed" not in server._ALWAYS_VISIBLE_ACTION_TYPES
        assert run(renewal_misses.today_brain_items(carer)) == []


def test_clients_never_see_the_notes():
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {
            "renewal_block": {"code": "error", "reason": "Traceback ...", "since": server.now_iso()},
            "renewal_misses_handled_at": "2000-01-01T00:00:00"}}))
        client_user = {"id": "c-user", "role": "client", "client_id": cid}
        rows = run(server.list_recurring_templates(client_user))
        mine = next(r for r in rows if r["id"] == t["id"])
        body = server.RecurringTemplateIn(**{k: t[k] for k in ("dog_id", "service_type", "service_id", "weekdays", "label", "default_horizon_weeks")},
                                         dropoff_time="08:00")
        edited = run(server.update_recurring_template(t["id"], body, client_user))
        for field in ("renewal_misses", "renewal_block", "renewal_misses_handled_at", "last_auto_extend_result"):
            assert field not in mine and field not in edited, field


def test_the_today_screen_nudges_too():
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        _template(did, sid)
        run(server._auto_extend_recurring_templates_once())
        brain = run(server.admin_today_brain(_={"id": "x", "role": "admin"}))
        item = next(i for i in brain["items"] if i["kind"] == "recurring_renewal_missed")
        assert item["cta"] == {"type": "open_screen", "screen": "recurring"}
        assert server._today_brain_signature(item).startswith("recurring_renewal_missed:")


# -------------------------------------------- holidays for everyone else

def test_staff_extend_skips_a_holiday_but_one_staff_booking_may_still_be_made():
    sid = _service()
    with _family() as (cid, did):
        start, days = _window()
        h, h2 = days[2], days[6]
        hours = {d: {"closed": False, "open": "07:00", "close": "19:00"} for d in server.DEFAULT_DAYS}
        with _settings(closed_dates=[h, h2], service_hours__daycare=hours):
            t = _template(did, sid, last_booked_through=(server.business_today() + timedelta(days=5)).isoformat())
            res = run(server.extend_recurring_template(t["id"], server.ExtendTemplateIn(weeks=1), {"id": "staff", "role": "admin"}))
            assert any(s["date"] == h for s in res["skipped"])
            assert not run(server.db.bookings.find_one({"dog_id": did, "date": h}, {"_id": 1}))
            one = run(server.create_booking(server.BookingIn(dog_id=did, service_type="daycare", date=h, override_capacity=True),
                                            {"id": "staff", "role": "admin"}))
            assert one["date"] == h, "staff can still book one day on purpose"
            # A client's own booking on a holiday is still refused, word for word.
            version = int(run(server.get_settings()).get("waiver_version", 1))
            run(server.db.waiver_signatures.insert_one({"id": f"{TAG}-w-{uuid.uuid4().hex[:6]}", "client_id": cid,
                                                        "waiver_version": version, "signed_at": server.now_iso()}))
            try:
                client_user = {"id": "c-user", "role": "client", "client_id": cid}
                with pytest.raises(HTTPException) as e:
                    run(server.create_booking(server.BookingIn(dog_id=did, service_type="daycare", date=h2), client_user))
                assert e.value.block["code"] == "closed_date" and e.value.detail.startswith("Sit Happens is closed on")
            finally:
                run(server.db.waiver_signatures.delete_many({"client_id": cid}))



def test_a_manual_extend_keeps_the_days_it_couldnt_book_too():
    # Staff's Extend button and a client's own Extend are renewals as well.
    sid = _service()
    with _family() as (cid, did), _trouble() as (h, w, f):
        t = _template(did, sid)
        res = run(server.extend_recurring_template(t["id"], server.ExtendTemplateIn(weeks=1), {"id": "staff", "role": "admin"}))
        assert {s["date"] for s in res["skipped"]} >= {h, w, f}
        assert sorted(m["date"] for m in _misses(t)) == sorted([h, w, f])
        assert len(_mine(t)) == 1
