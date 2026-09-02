"""Lifetime booking reads must see `bookings_archive`.

Completed bookings older than 90 days are moved to `bookings_archive`. These
surfaces read only the hot collection and silently lost history: the
Portal's per-dog visit badge, bulk-email "has ever boarded" audiences, the
admin calendar's past months, booking-reference search, single-booking
detail / group lookups, ledger edits, and the photo-compression backfill.
"""
import contextlib
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`
import server
import photo_backfill
from _test_loop import run

TAG = "TEST_ARCHIVE_READS"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog_name = f"{TAG}dog{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": did, "name": dog_name, "owner_id": c["id"], "breed": "Mix", "age_y": 3}))
    try:
        yield c, {"id": did, "name": dog_name}
    finally:
        run(server.db.bookings.delete_many({"client_id": c["id"]}))
        run(server.db.bookings_archive.delete_many({"client_id": c["id"]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _row(c, dog, **extra):
    row = {"id": str(uuid.uuid4()), "client_id": c["id"], "client_name": c["name"], "dog_id": dog["id"], "dog_name": dog["name"],
           "service_type": "daycare", "status": "completed", "date": "2025-01-10", "checked_out_at": "2025-01-10T20:00:00+00:00",
           "created_at": "2025-01-01T00:00:00+00:00"}
    row.update(extra)
    return row


def test_portal_visit_badge_counts_archived_and_legacy_visits():
    with _client_and_dog() as (c, dog):
        run(server.db.bookings.insert_one(_row(c, dog, date=server.business_today().isoformat())))
        run(server.db.bookings_archive.insert_many([
            _row(c, dog, date="2024-06-01", archived_at="x"),
            _row(c, dog, date="2024-05-01", status="checked_out", checked_out_at=None, archived_at="x"),   # legacy
            _row(c, dog, date="2024-04-01", status="cancelled", checked_out_at=None, archived_at="x"),     # never a visit
        ]))
        me = run(server.portal_me({"id": "u", "role": "client", "client_id": c["id"], "name": c["name"]}))
        assert me["visit_counts"][dog["id"]] == 3


def test_bulk_email_lifetime_service_filter_sees_archived_boarding():
    with _client_and_dog() as (c, dog):
        run(server.db.bookings_archive.insert_one(_row(c, dog, service_type="boarding", date="2024-03-02", end_date="2024-03-05", archived_at="x")))
        recips = run(server._bulk_email_resolve_recipients(["boarding"]))
        assert any(r.get("id") == c["id"] for r in recips), "a client whose only boarding stay was archived must still be in the audience"
        upcoming = run(server._bulk_email_resolve_recipients(["upcoming_bookings"]))
        assert all(r.get("id") != c["id"] for r in upcoming), "archived rows never count as upcoming"


def test_calendar_window_includes_archived_completed_history():
    with _client_and_dog() as (c, dog):
        live = _row(c, dog, date=server.business_today().isoformat(), status="approved", checked_out_at=None)
        old = _row(c, dog, date="2024-02-14", archived_at="x")
        stay = _row(c, dog, service_type="boarding", date="2024-02-27", end_date="2024-03-02", archived_at="x")
        run(server.db.bookings.insert_one(live))
        run(server.db.bookings_archive.insert_many([old, stay]))
        admin = _admin_user()
        feb = run(server.calendar_events(admin, start="2024-02-01", end="2024-03-01"))
        ids = {e.get("id") for e in feb}
        assert old["id"] in ids and stay["id"] in ids, "archived completed rows show in their month"
        assert live["id"] not in ids
        default = run(server.calendar_events(admin))
        dids = {e.get("id") for e in default}
        assert live["id"] in dids and old["id"] not in dids, "default window is around today"


def test_search_detail_and_group_resolve_archived_bookings():
    with _client_and_dog() as (c, dog):
        gid = str(uuid.uuid4())
        hot = _row(c, dog, date=server.business_today().isoformat(), group_id=gid, created_at="2025-02-01T00:00:00+00:00")
        old = _row(c, dog, date="2024-01-05", group_id=gid, archived_at="x")
        run(server.db.bookings.insert_one(hot))
        run(server.db.bookings_archive.insert_one(old))
        admin = _admin_user()
        found = run(server.search(dog["name"], admin))
        assert {b.get("id") for b in found["bookings"]} >= {hot["id"], old["id"]}
        by_ref = run(server.search(old["id"][:8], admin))
        assert any(b.get("id") == old["id"] for b in by_ref["bookings"]), "reference prefix from an old receipt resolves"
        detail = run(server.get_booking(old["id"], admin))
        assert detail["id"] == old["id"] and detail["archived"] is True
        assert run(server.get_booking(hot["id"], admin))["archived"] is False
        grp = run(server.get_booking_group(gid, admin))
        assert grp["count"] == 2 and [b["id"] for b in grp["bookings"]] == [old["id"], hot["id"]]


def test_transaction_edit_lands_on_the_archived_row():
    with _client_and_dog() as (c, dog):
        old = _row(c, dog, date="2024-01-05", archived_at="x", service_id="svc", actual_price=10.0, payment_status="unpaid",
                   checked_out_at=None, status="approved")
        run(server.db.bookings_archive.insert_one(old))
        admin = _admin_user()
        out = run(server.update_transaction(old["id"], server.TransactionUpdateIn(actual_price=12.5), admin))
        assert out["actual_price"] == 12.5
        fresh = run(server.db.bookings_archive.find_one({"id": old["id"]}, {"_id": 0}))
        assert fresh["actual_price"] == 12.5, "edit must update the archived record the reports read"
        assert run(server.db.bookings.find_one({"id": old["id"]})) is None


def test_photo_backfill_scans_archived_report_cards():
    with _client_and_dog() as (c, dog):
        png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pgi9HgAAAABJRU5ErkJggg=="
        run(server.db.bookings_archive.insert_one(_row(c, dog, date="2024-01-05", archived_at="x", report_card={"photos": [png]})))
        before = photo_backfill._state.get("scanned", 0)
        run(photo_backfill._backfill_bookings(server.db))
        assert photo_backfill._state["scanned"] >= before + 1
