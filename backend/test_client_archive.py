"""Archiving a family / removing a dog, and bringing a family back (audit #36).

"Archive client" hid the family and turned its login off, and nothing else:
its weekly schedules kept booking, its visits stayed on the calendar, its
waitlist stayed open, anything could still book its dogs, and an archive
could never be undone.

Disposable tag TEST_CLIENT_ARCHIVE.
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
from domains.bookings.blocks import block_of
from domains.clients import archive

TAG = "TEST_CLIENT_ARCHIVE"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}
ADMIN = {"id": f"{TAG}-staff", "role": "admin", "name": "QA Owner"}


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} admin",
         "role": "admin", "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _day(n):
    return (server.business_today() + timedelta(days=n)).isoformat()


@contextlib.contextmanager
def _family(dogs=("Rosie",)):
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Smith", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "created_at": server.now_iso()}))
    ids = []
    for name in dogs:
        did = f"{TAG}-d-{uuid.uuid4().hex[:6]}"
        run(server.db.dogs.insert_one({"id": did, "name": name, "owner_id": cid, "breed": "Mix", "vaccines": dict(VACCINES_OK)}))
        ids.append(did)
    try:
        yield cid, ids
    finally:
        run(server.db.bookings.delete_many({"$or": [{"dog_id": {"$in": ids}}, {"client_id": cid}, {"bill_to_client_id": cid}]}))
        run(server.db.recurring_templates.delete_many({"dog_id": {"$in": ids}}))
        run(server.db.waitlist.delete_many({"$or": [{"dog_id": {"$in": ids}}, {"client_id": cid}]}))
        run(server.db.reschedule_requests.delete_many({"client_id": cid}))
        run(server.db.claim_tokens.delete_many({"client_id": cid}))
        run(server.db.dogs.delete_many({"owner_id": cid}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.users.delete_many({"$or": [{"client_id": cid}, {"id": {"$regex": f"^{TAG}"}}]}))


def _booking(cid, did, date, **extra):
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": did, "dog_name": "Rosie", "client_id": cid, "client_name": f"{TAG} Smith",
         "service_type": "daycare", "date": date, "status": "approved", "notes": TAG, "created_at": server.now_iso()}
    b.update(extra)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _template(did, **extra):
    doc = {"id": f"{TAG}-t-{uuid.uuid4().hex[:6]}", "dog_id": did, "label": f"{TAG} weekly", "service_type": "daycare",
           "service_id": "x", "weekdays": [0, 2, 4], "default_horizon_weeks": 4, "active": True, "auto_extend": True,
           "last_booked_through": _day(20), "created_at": server.now_iso()}
    doc.update(extra)
    run(server.db.recurring_templates.insert_one(dict(doc)))
    return doc


def _login(cid):
    u = {"id": f"{TAG}-u-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Smith",
         "role": "client", "client_id": cid, "password_hash": server.hash_password("pw-" + TAG), "token_version": 3}
    run(server.db.users.insert_one(dict(u)))
    return u


def _archive(cid):
    return run(archive.archive_client(cid, ADMIN))


def _refused(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value


# ───────────────────────────────────────────── rule 1: refused while busy

def test_archive_is_refused_while_a_dog_is_here_or_visits_are_still_booked():
    admin = _admin()
    with _family(("Rosie", "Max")) as (cid, (rosie, mx)):
        upcoming = _booking(cid, rosie, _day(7))
        here = _booking(cid, mx, _day(-2), checked_in_at=server.now_iso())                     # an overdue stay still on site
        request = _booking(cid, rosie, _day(-3), status="pending")                             # a request, even a past one
        stay = _booking(cid, rosie, _day(-1), end_date=_day(2), service_type="boarding")       # a stay running through today
        mg = _booking(cid, "", _day(5), status="pending", is_meet_greet=True, service_type="other")   # no dog on a Meet & Greet
        friend = _booking(f"{TAG}-other", f"{TAG}-other-dog", _day(9), bill_to_client_id=cid)  # a friend's dog this family pays for
        _booking(cid, rosie, _day(3), status="cancelled")
        _booking(cid, rosie, _day(-5), status="completed", checked_out_at=server.now_iso())
        _booking(cid, rosie, _day(-4))   # past, never checked in: stale, not busy
        r = run(_http.delete(f"/api/clients/{cid}", headers=_auth(admin)))
        assert r.status_code == 409, r.text
        block = r.json()["block"]
        assert block["code"] == "archive_blocked" and block["action"] == "check_out"
        assert [x["id"] for x in block["on_site"]] == [here["id"]]
        assert {x["id"] for x in block["upcoming"]} == {upcoming["id"], request["id"], stay["id"], mg["id"], friend["id"]}
        assert block["total"] == 6
        assert next(x for x in block["upcoming"] if x["id"] == friend["id"])["paid_for_by_this_family"] is True
        assert "can't be archived yet" in r.json()["detail"]
        c = run(server.db.clients.find_one({"id": cid}))
        assert not c.get("deleted_at") and not run(server.db.dogs.find_one({"id": rosie})).get("deleted_at"), "a refusal writes nothing"


def test_a_paid_visit_is_listed_as_not_cancellable_here():
    with _family() as (cid, (did,)):
        _booking(cid, did, _day(4), payment_status="paid", is_prepaid_program_session=True, service_type="training")
        e = _refused(archive.archive_client(cid, ADMIN))
        row = block_of(e)["upcoming"][0]
        assert row["can_cancel"] is False and row["prepaid"] is True and block_of(e)["action"] == "cancel_bookings"


# ──────────────────────────────── what an archive does, and never re-stamps

def test_archive_pauses_schedules_closes_requests_and_turns_off_the_login():
    with _family(("Rosie", "Old")) as (cid, (rosie, old)):
        run(server.db.dogs.update_one({"id": old}, {"$set": {"deleted_at": "2025-01-01T00:00:00", "deleted_by": "x"}}))
        t = _template(rosie)
        stopped = _template(rosie, active=False)
        run(server.db.waitlist.insert_one({"dedupe_key": str(uuid.uuid4()), "id": f"{TAG}-w", "dog_id": rosie, "client_id": cid, "status": "waiting", "service_type": "daycare"}))
        run(server.db.reschedule_requests.insert_one({"id": f"{TAG}-rr", "client_id": cid, "dog_id": rosie, "status": "pending"}))
        run(server.db.claim_tokens.insert_one({"token": f"{TAG}-tok", "client_id": cid, "used": False}))
        u = _login(cid)
        out = _archive(cid)
        assert out["ok"] and out["paused_schedules"] == 1
        c = run(server.db.clients.find_one({"id": cid}))
        stamp = c["deleted_at"]
        assert run(server.db.dogs.find_one({"id": rosie}))["deleted_at"] == stamp
        assert run(server.db.dogs.find_one({"id": old}))["deleted_at"] == "2025-01-01T00:00:00", "a dog removed before keeps its own stamp"
        tt = run(server.db.recurring_templates.find_one({"id": t["id"]}))
        assert tt["active"] is False and tt["paused_reason"] == "family_archived" and tt["paused_at"] == stamp
        assert "paused_reason" not in run(server.db.recurring_templates.find_one({"id": stopped["id"]})), "already paused: left as it was"
        assert run(server.db.waitlist.find_one({"id": f"{TAG}-w"}))["status"] == "removed"
        assert run(server.db.reschedule_requests.find_one({"id": f"{TAG}-rr"}))["status"] == "declined"
        assert not run(server.db.claim_tokens.find_one({"token": f"{TAG}-tok"}))
        uu = run(server.db.users.find_one({"id": u["id"]}))
        assert uu["active"] is False and uu["token_version"] == 4 and uu["deactivated_at"] == stamp
        rec = c["archive_record"]
        assert rec["dog_ids"] == [rosie] and rec["user_ids"] == [u["id"]] and rec["template_ids"] == [t["id"]]
        again = _archive(cid)
        assert again.get("already_archived") and run(server.db.clients.find_one({"id": cid}))["deleted_at"] == stamp, "never re-stamped"


# ──────────────────────────── rule 3: nothing books an archived family's dog

def test_nothing_books_checks_in_or_moves_a_visit_for_an_archived_family():
    admin = _admin()
    with _family() as (cid, (did,)):
        legacy = _booking(cid, did, _day(-1))   # left over from before this fix

        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": server.now_iso()}}))
        run(server.db.dogs.update_one({"id": did}, {"$set": {"deleted_at": server.now_iso()}}))
        r = run(_http.post("/api/bookings", json={"dog_id": did, "date": _day(8), "service_type": "daycare"}, headers=_auth(admin)))
        assert r.status_code == 409 and r.json()["block"]["code"] == "family_archived", r.text
        assert "Restore the family first" in r.json()["detail"]
        r = run(_http.post(f"/api/bookings/{legacy['id']}/check-in", json={"vaccine_ack": True}, headers=_auth(admin)))
        assert r.status_code == 409 and r.json()["block"]["code"] == "family_archived", r.text
        e = _refused(server._update_booking_with_capacity(legacy, {"date": _day(9)}))
        assert block_of(e)["code"] == "family_archived"
        assert run(server.db.bookings.find_one({"id": legacy["id"]}))["date"] == legacy["date"]
        r = run(_http.post("/api/waitlist", json={"dog_id": did, "service_type": "daycare", "requested_date": _day(8)}, headers=_auth(admin)))
        assert r.status_code == 409, r.text
        r = run(_http.post("/api/recurring-templates", json={"dog_id": did, "service_type": "daycare", "weekdays": [0]}, headers=_auth(admin)))
        assert r.status_code == 409, r.text
        r = run(_http.post("/api/dogs", json={"owner_id": cid, "name": "New pup"}, headers=_auth(admin)))
        assert r.status_code == 409 and "Restore the family first" in r.text
        assert renewal_misses.label("family_archived", "x") == "family archived"


def test_a_renewal_of_an_archived_dog_stops_with_one_visible_reason():
    """A schedule switched back on by hand (or left over) never books: the
    whole renewal is refused once, and says why."""
    with _family() as (cid, (did,)):
        t = _template(did, last_booked_through=_day(3))
        run(server.db.dogs.update_one({"id": did}, {"$set": {"deleted_at": server.now_iso()}}))
        run(server._auto_extend_recurring_templates_once())
        tt = run(server.db.recurring_templates.find_one({"id": t["id"]}))
        assert tt["renewal_block"]["label"] == "dog removed" and tt["last_booked_through"] == _day(3)
        assert run(server.db.bookings.count_documents({"dog_id": did})) == 0


def test_a_client_never_books_or_edits_a_removed_dog():
    with _family(("Rosie", "Gone")) as (cid, (rosie, gone)):
        u = _login(cid)
        run(server.db.dogs.update_one({"id": gone}, {"$set": {"deleted_at": server.now_iso()}}))
        r = run(_http.post("/api/bookings", json={"dog_id": gone, "date": _day(8), "service_type": "daycare"}, headers=_auth(u)))
        assert r.status_code == 409 and r.json()["block"] == {"code": "dog_removed", "action": "contact_us"}, r.text
        assert "no longer on your account" in r.json()["detail"]
        rows = run(_http.get("/api/recurring-templates", headers=_auth(u))).json()
        assert rows == [] or all(x["dog_id"] != gone for x in rows)


def test_logging_a_past_service_is_still_allowed_but_not_a_visit_to_come():
    with _family() as (cid, (did,)):
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": server.now_iso()}}))
        svc = {"id": f"{TAG}-svc", "name": f"{TAG} Daycare", "service_type": "daycare", "active": True, "base_price": 30.0}
        run(server.db.services.replace_one({"id": svc["id"]}, dict(svc), upsert=True))
        try:
            e = _refused(server.log_service(server.LogServiceIn(dog_id=did, service_id=svc["id"], date=_day(5), status="approved"), ADMIN))
            assert block_of(e)["code"] == "family_archived"
            done = run(server.log_service(server.LogServiceIn(dog_id=did, service_id=svc["id"], date=_day(-5), status="completed"), ADMIN))
            assert done   # a past service is only a money record: still allowed
        finally:
            run(server.db.services.delete_one({"id": svc["id"]}))


# ───────────────────────────────────────── rule 4: Restore and Resume

def test_restore_brings_back_the_family_its_dogs_and_login_but_not_the_schedules():
    admin = _admin()
    with _family(("Rosie", "Old")) as (cid, (rosie, old)):
        run(server.db.dogs.update_one({"id": old}, {"$set": {"deleted_at": "2025-01-01T00:00:00"}}))
        t = _template(rosie, last_booked_through=_day(30))
        u = _login(cid)
        _archive(cid)
        r = run(_http.post(f"/api/clients/{cid}/restore", headers=_auth(admin)))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["restored_dogs"] == ["Rosie"] and body["still_removed"] == ["Old"] and body["paused_schedules"] == 1
        c = run(server.db.clients.find_one({"id": cid}))
        assert "deleted_at" not in c, "$unset — the Clients list reads {deleted_at: {$exists: False}}"
        assert "deleted_at" not in run(server.db.dogs.find_one({"id": rosie}))
        assert run(server.db.dogs.find_one({"id": old}))["deleted_at"] == "2025-01-01T00:00:00"
        uu = run(server.db.users.find_one({"id": u["id"]}))
        assert uu["active"] is True and uu["token_version"] == 4 and "deactivated_at" not in uu, "old sessions stay dead"
        assert run(server.db.recurring_templates.find_one({"id": t["id"]}))["active"] is False, "schedules stay paused"
        assert run(_http.post(f"/api/clients/{cid}/restore", headers=_auth(admin))).status_code == 409
        page = run(_http.get("/api/clients/page", params={"q": f"{TAG} Smith"}, headers=_auth(admin))).json()
        assert cid in [x["id"] for x in page["items"]]
        # Resume books again from today, and misses from before never come back.
        run(server.db.recurring_templates.update_one({"id": t["id"]}, {"$set": {"renewal_block": {"code": "x"}}}))
        r = run(_http.post(f"/api/recurring-templates/{t['id']}/resume", headers=_auth(admin)))
        assert r.status_code == 200, r.text
        tt = run(server.db.recurring_templates.find_one({"id": t["id"]}))
        assert tt["active"] is True and tt["last_booked_through"] == _day(-1)
        assert "renewal_block" not in tt and "paused_reason" not in tt and tt["renewal_misses_handled_at"]


def test_resume_is_refused_while_the_family_is_archived():
    with _family() as (cid, (did,)):
        t = _template(did)
        _archive(cid)
        e = _refused(archive.resume_template(t["id"], ADMIN))
        assert block_of(e)["code"] == "family_archived"


def test_show_archived_lists_only_archived_families_with_the_dogs_restore_brings_back():
    admin = _admin()
    with _family() as (cid, (did,)):
        _archive(cid)
        live = run(_http.get("/api/clients/page", params={"q": f"{TAG} Smith"}, headers=_auth(admin))).json()
        assert cid not in [x["id"] for x in live["items"]]
        arch = run(_http.get("/api/clients/page", params={"q": f"{TAG} Smith", "archived": True}, headers=_auth(admin))).json()
        row = next(x for x in arch["items"] if x["id"] == cid)
        assert row["deleted_at"] and row["archived_by_name"] == "QA Owner" and row["dogs"] == [{"id": did, "name": "Rosie"}]


def test_a_family_archived_before_this_fix_restores_by_its_stamp_but_never_a_merged_duplicate():
    with _family(("Rosie", "Dupe")) as (cid, (rosie, dupe)):
        stamp = "2026-01-02T03:04:05"
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": stamp}}))
        run(server.db.dogs.update_one({"id": rosie}, {"$set": {"deleted_at": stamp}}))
        run(server.db.dogs.update_one({"id": dupe}, {"$set": {"deleted_at": stamp, "archived": True, "duplicate_of_dog_id": rosie}}))
        u = _login(cid)
        run(server.db.users.update_one({"id": u["id"]}, {"$set": {"active": False, "deactivated_at": stamp}}))
        out = run(archive.restore_client(cid, ADMIN))
        assert out["restored_dogs"] == ["Rosie"] and out["logins_restored"] == 1
        assert run(server.db.dogs.find_one({"id": dupe}))["deleted_at"] == stamp


# ─────────────────────────────── logins, removing one dog, the nightly sync

def test_a_login_never_opens_an_archived_family_even_if_the_login_came_back_on():
    with _family() as (cid, (did,)):
        u = _login(cid)
        _archive(cid)
        run(server.db.users.update_one({"id": u["id"]}, {"$set": {"active": True}}))   # e.g. a backup restore (logins aren't backed up)
        r = run(_http.post("/api/auth/login", json={"email": u["email"], "password": "pw-" + TAG}))
        assert r.status_code == 403, r.text
        run(server.db.claim_tokens.insert_one({"token": f"{TAG}-late", "client_id": cid, "email": u["email"], "used": False,
                                               "expires_at": (server.datetime.now(server.timezone.utc) + timedelta(days=2)).isoformat()}))
        r = run(_http.post(f"/api/claim/{TAG}-late/login"))
        assert r.status_code == 400 and "closed" in r.json()["detail"]


def test_removing_one_dog_is_refused_while_it_is_booked_then_pauses_its_schedule():
    admin = _admin()
    with _family(("Rosie", "Max")) as (cid, (rosie, mx)):
        b = _booking(cid, mx, _day(6))
        t = _template(mx)
        r = run(_http.delete(f"/api/dogs/{mx}", headers=_auth(admin)))
        assert r.status_code == 409 and [x["id"] for x in r.json()["block"]["upcoming"]] == [b["id"]]
        run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "cancelled"}}))
        assert run(_http.delete(f"/api/dogs/{mx}", headers=_auth(admin))).status_code == 200
        d = run(server.db.dogs.find_one({"id": mx}))
        assert d["deleted_at"] and not run(server.db.dogs.find_one({"id": rosie})).get("deleted_at")
        assert run(server.db.recurring_templates.find_one({"id": t["id"]}))["paused_reason"] == "dog_removed"
        stamp = d["deleted_at"]
        run(_http.delete(f"/api/dogs/{mx}", headers=_auth(admin)))
        assert run(server.db.dogs.find_one({"id": mx}))["deleted_at"] == stamp, "never re-stamped"


def test_the_nightly_sync_catches_families_archived_before_this_fix():
    with _family(("Rosie", "Gone")) as (cid, (rosie, gone)):
        stamp = "2026-02-03T04:05:06"
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": stamp}}))
        run(server.db.dogs.update_one({"id": rosie}, {"$set": {"deleted_at": stamp}}))
        t = _template(rosie)
        run(server.db.waitlist.insert_one({"dedupe_key": str(uuid.uuid4()), "id": f"{TAG}-w2", "dog_id": rosie, "client_id": cid, "status": "offered"}))
        u = _login(cid)
        out = run(archive.sync(server.db))
        assert out["schedules"] >= 1 and out["logins"] >= 1
        tt = run(server.db.recurring_templates.find_one({"id": t["id"]}))
        assert tt["active"] is False and tt["paused_at"] == stamp and tt["paused_reason"] == "family_archived"
        assert run(server.db.waitlist.find_one({"id": f"{TAG}-w2"}))["status"] == "removed"
        uu = run(server.db.users.find_one({"id": u["id"]}))
        assert uu["active"] is False and uu["deactivated_at"] == stamp
        assert run(archive.restore_client(cid, ADMIN))["logins_restored"] == 1, "Restore undoes what the sync did too"


def test_restore_is_labelled_in_the_audit_log():
    assert server._audit_action_for("POST", "/api/clients/abc-123-def/restore") == "client_restored"
    assert "client_restored" in server.AUDIT_ACTION_GROUPS["clients"]


# ───────────────────────────────────────── review round (audit #36)

def test_the_refusal_says_plainly_when_a_visit_is_already_paid_for():
    with _family() as (cid, (did,)):
        _booking(cid, did, _day(4), payment_status="paid", is_prepaid_program_session=True, service_type="training")
        _booking(cid, did, _day(5))
        detail = _refused(archive.archive_client(cid, ADMIN)).detail
        assert "1 of them is already paid for and can't be cancelled here yet" in detail
        assert "can be archived once it has taken place" in detail


def test_a_waitlist_convert_cut_off_by_a_restart_never_blocks_the_archive_forever():
    with _family() as (cid, (did,)):
        long_ago = (server.datetime.now(server.timezone.utc) - timedelta(minutes=30)).isoformat()
        run(server.db.waitlist.insert_one({"dedupe_key": str(uuid.uuid4()), "id": f"{TAG}-stuck", "dog_id": did, "client_id": cid, "status": "converting",
                                           "converting_at": long_ago}))
        run(server.db.waitlist.insert_one({"dedupe_key": str(uuid.uuid4()), "id": f"{TAG}-live", "dog_id": did, "client_id": cid, "status": "converting",
                                           "converting_at": server.now_iso()}))
        e = _refused(archive.archive_client(cid, ADMIN))
        assert "being booked" in e.detail, "a convert happening right now still waits"
        run(server.db.waitlist.delete_one({"id": f"{TAG}-live"}))
        assert _archive(cid)["ok"]
        assert run(server.db.waitlist.find_one({"id": f"{TAG}-stuck"}))["status"] == "removed"


def test_an_older_archive_never_brings_back_a_dog_removed_on_its_own_before_it():
    with _family(("Rosie", "Old")) as (cid, (rosie, old)):
        stamp = "2026-03-04T05:06:07"
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": stamp}}))
        run(server.db.dogs.update_many({"id": {"$in": [rosie, old]}}, {"$set": {"deleted_at": stamp}}))   # the old code re-stamped both
        run(server.db.audit_log.insert_one({"id": f"{TAG}-al", "action": "dog_deleted", "record_id": old, "status": 200,
                                            "ts": "2025-12-01T00:00:00", "method": "DELETE", "path": f"/api/dogs/{old}"}))
        try:
            out = run(archive.restore_client(cid, ADMIN))
            assert out["restored_dogs"] == ["Rosie"]
            assert run(server.db.dogs.find_one({"id": old}))["deleted_at"] == stamp
        finally:
            run(server.db.audit_log.delete_many({"id": f"{TAG}-al"}))


def test_a_merged_duplicates_schedule_moves_to_the_main_dog_and_keeps_renewing():
    with _family(("Rex", "Rex dup")) as (cid, (main, dup)):
        run(server.db.dogs.update_one({"id": dup}, {"$set": {"deleted_at": server.now_iso(), "archived": True, "duplicate_of_dog_id": main}}))
        t = _template(dup)
        run(server.db.waitlist.insert_one({"dedupe_key": str(uuid.uuid4()), "id": f"{TAG}-wm", "dog_id": dup, "client_id": cid, "status": "waiting"}))
        out = run(archive.sync(server.db))
        assert out["moved_to_main_dog"] >= 2
        tt = run(server.db.recurring_templates.find_one({"id": t["id"]}))
        assert tt["dog_id"] == main and tt["active"] is True and tt["merged_from_dog_id"] == dup
        assert run(server.db.waitlist.find_one({"id": f"{TAG}-wm"}))["status"] == "waiting"
        # Rows still keyed to the duplicate belong to the live dog: never hidden as "removed".
        scope = run(archive.gone(server.db))
        assert dup in scope.dogs and dup in scope.merged
        assert dup not in archive.not_gone(scope)["dog_id"]["$nin"]
        assert ("recurring_templates", "dog_id") in server._DOG_MERGE_REF_COLLECTIONS, "a merge moves them from now on"


def test_removing_a_dog_closes_its_school_notifications():
    with _family(("Rosie", "Max")) as (cid, (rosie, mx)):
        run(server.db.school_notifications.insert_one({"id": f"{TAG}-n", "dog_id": mx, "client_id": cid,
                                                       "audience": "school_staff", "resolved_at": None}))
        try:
            run(archive.remove_dog(mx, ADMIN))
            n = run(server.db.school_notifications.find_one({"id": f"{TAG}-n"}))
            assert n["resolved_at"] and n["resolved_by"] == "dog_removed"
        finally:
            run(server.db.school_notifications.delete_many({"id": f"{TAG}-n"}))


def test_income_edits_cant_bring_a_visit_back_for_an_archived_family():
    with _family() as (cid, (did,)):
        b = _booking(cid, did, _day(6), status="cancelled")
        run(server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": server.now_iso()}}))
        e = _refused(server.update_transaction(b["id"], server.TransactionUpdateIn(status="approved"), ADMIN))
        assert block_of(e)["code"] == "family_archived"
        assert run(server.db.bookings.find_one({"id": b["id"]}))["status"] == "cancelled"


def test_a_booking_that_raced_an_archive_is_taken_back():
    """The family was archived while the booking was being checked: the booking
    never stays on a family nothing can check in."""
    from unittest.mock import patch
    admin = _admin()
    with _family() as (cid, (did,)):
        real = server._assert_capacity_available

        async def archive_meanwhile(*a, **kw):
            await server.db.clients.update_one({"id": cid}, {"$set": {"deleted_at": server.now_iso()}})
            return await real(*a, **kw)
        with patch.object(server, "_assert_capacity_available", new=archive_meanwhile):
            r = run(_http.post("/api/bookings", json={"dog_id": did, "date": _day(8), "service_type": "daycare"}, headers=_auth(admin)))
        assert r.status_code == 409 and r.json()["block"]["code"] == "family_archived", r.text
        assert run(server.db.bookings.count_documents({"dog_id": did})) == 0


def test_open_trainer_assist_cases_of_an_archived_family_wait_but_history_stays():
    with _family() as (cid, (did,)):
        rows = [{"id": f"{TAG}-ta-open", "trainer_assist_hold_active": True},
                {"id": f"{TAG}-ta-done", "trainer_assist_hold_active": False, "trainer_assist_completed_at": server.now_iso()}]
        for r in rows:
            run(server.db.checkpoint_submissions.insert_one({**r, "school_enrollment_id": f"{TAG}-se", "dog_id": did, "client_id": cid,
                                                             "outcome": "trainer_assist_recommended", "status": "graded"}))
        try:
            ids = {x["id"] for x in run(server.admin_school_trainer_assist_queue(ADMIN))}
            assert {f"{TAG}-ta-open", f"{TAG}-ta-done"} <= ids
            _archive(cid)
            ids = {x["id"] for x in run(server.admin_school_trainer_assist_queue(ADMIN))}
            assert f"{TAG}-ta-open" not in ids and f"{TAG}-ta-done" in ids
        finally:
            run(server.db.checkpoint_submissions.delete_many({"school_enrollment_id": f"{TAG}-se"}))


def test_the_pipeline_hides_a_removed_dogs_live_program_but_keeps_its_history():
    with _family() as (cid, (did,)):
        chan = sorted(server.STAFF_SCHOOL_DELIVERY_CHANNELS)[0]
        for st in ("active", "completed"):
            run(server.db.dog_programs.insert_one({"id": f"{TAG}-dp-{st}", "dog_id": did, "client_id": cid, "status": st,
                                                   "delivery_channel": chan, "program_snapshot": {"name": "Basics", "type": "group"}}))
        try:
            run(server.db.dogs.update_one({"id": did}, {"$set": {"deleted_at": server.now_iso()}}))
            res = run(server.programs_pipeline(ADMIN))
            rows = res if isinstance(res, list) else (res.get("rows") or res.get("items") or res.get("enrollments") or [])
            ids = {r.get("id") or r.get("enrollment_id") for r in rows}
            assert f"{TAG}-dp-completed" in ids and f"{TAG}-dp-active" not in ids
        finally:
            run(server.db.dog_programs.delete_many({"id": {"$regex": f"^{TAG}-dp"}}))
