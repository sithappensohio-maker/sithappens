"""A note on a finished visit can be fixed (audit #37).

The booking edit window sends the date and times with every save. The server
checked every field it was sent against the checked-out / paid lock, changed
or not, so fixing a note on a finished visit was refused as "financial
record is locked". Now only what actually changes counts, and a real change
to a locked field is refused in plain words.

Disposable tag TEST_FINISHED_EDIT.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import guards

TAG = "TEST_FINISHED_EDIT"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} admin",
         "role": "admin", "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


@contextlib.contextmanager
def _visit(**extra):
    """A visit that was checked out and paid (the lock), as staff open it."""
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": f"{TAG}-dog", "dog_name": "Rosie", "client_id": f"{TAG}-c",
         "client_name": f"{TAG} Smith", "service_type": "daycare", "date": "2026-09-01", "status": "completed",
         "dropoff_time": "08:00", "pickup_time": "", "notes": "Old note", "actual_price": 30.0, "payment_status": "paid",
         "amount_paid": 30.0, "checked_in_at": "2026-09-01T12:00:00+00:00", "checked_out_at": "2026-09-01T21:00:00+00:00",
         "created_at": "2026-08-20T10:00:00+00:00"}
    b.update(extra)
    run(server.db.bookings.insert_one(dict(b)))
    try:
        yield b
    finally:
        run(server.db.bookings.delete_many({"id": b["id"]}))


@contextlib.contextmanager
def _staff():
    u = _admin()
    try:
        yield u
    finally:
        run(server.db.users.delete_one({"id": u["id"]}))


def _window_save(b, **changes):
    """What the edit window sends (AdminBookingModal.jsx): the stored values —
    blank times stay blank and the kennel stays. The window side of that is
    pinned by the mounted adminBookingEditNote.test.js."""
    body = {"notes": b.get("notes") or "", "date": b["date"], "end_date": None, "kennel": b.get("kennel") or "",
            "dropoff_time": b.get("dropoff_time") or "", "pickup_time": b.get("pickup_time") or "", "time": ""}
    body.update(changes)
    return body


def test_a_note_on_a_checked_out_paid_visit_can_be_fixed():
    with _staff() as admin, _visit(kennel="A3") as b:
        r = run(_http.patch(f"/api/bookings/{b['id']}", json=_window_save(b, notes="Picked up by grandma"), headers=_auth(admin)))
        assert r.status_code == 200, r.text
        after = run(server.db.bookings.find_one({"id": b["id"]}))
        assert after["notes"] == "Picked up by grandma"
        assert after["actual_price"] == 30.0 and after["payment_status"] == "paid" and after["date"] == "2026-09-01"
        assert (after["dropoff_time"], after["pickup_time"], after["kennel"]) == ("08:00", "", "A3"), "nothing else touched"


def test_a_note_can_be_cleared_and_times_fixed_too():
    with _staff() as admin, _visit() as b:
        r = run(_http.patch(f"/api/bookings/{b['id']}", json=_window_save(b, notes="", pickup_time="17:30"), headers=_auth(admin)))
        assert r.status_code == 200, r.text
        after = run(server.db.bookings.find_one({"id": b["id"]}))
        assert after["notes"] == "" and after["pickup_time"] == "17:30"


def test_a_finished_stay_saved_with_its_own_dates_is_not_a_change():
    with _staff() as admin:
        with _visit(service_type="boarding", end_date="2026-09-04") as b:
            r = run(_http.patch(f"/api/bookings/{b['id']}", json=_window_save(b, end_date="2026-09-04", notes="Loved the pool"), headers=_auth(admin)))
            assert r.status_code == 200, r.text
        with _visit(service_type="boarding", end_date=None) as b:   # an older stay stored without an end date
            r = run(_http.patch(f"/api/bookings/{b['id']}", json=_window_save(b, end_date=b["date"], notes="x"), headers=_auth(admin)))
            assert r.status_code == 200, r.text


def test_really_moving_a_paid_visit_is_refused_in_plain_words_and_writes_nothing():
    with _staff() as admin, _visit() as b:
        r = run(_http.patch(f"/api/bookings/{b['id']}", json=_window_save(b, date="2026-09-02", notes="new"), headers=_auth(admin)))
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert detail == ("This visit is already checked out or paid for, so its date can't be changed here. "
                          "Notes and times can still be edited.")
        after = run(server.db.bookings.find_one({"id": b["id"]}))
        assert after["date"] == "2026-09-01" and after["notes"] == "Old note", "a refusal changes nothing, the note included"


def test_the_plain_message_names_what_cant_change():
    assert guards.locked_edit_message({"status"}).startswith("This visit is already checked out or paid for, so its status can't")
    msg = guards.locked_edit_message({"date", "service_id", "actual_price"})
    assert "its date, service and price or payment can't be changed here" in msg and "refund or adjustment" in msg
    assert "financial record" not in msg
