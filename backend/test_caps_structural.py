"""Operational counts must not depend on arbitrary to_list ceilings.

Capacity gates scanned every historical booking through to_list(10000);
vaccine alerts / dashboard health flags stopped at 2000 dogs; the Pending
Actions list counted capped lists while the badge used real counts; the
duplicate finder's ownership counts came from 5000/20000-row slices; bulk
email stopped at 10,000 clients. These tests push each past its old cap or
pin the DB-side computation.
"""
import contextlib
import uuid
from datetime import timedelta

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_CAPS"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _cleanup():
    try:
        yield
    finally:
        run(server.db.bookings.delete_many({"_tag": TAG}))
        run(server.db.bookings_archive.delete_many({"_tag": TAG}))
        run(server.db.dogs.delete_many({"_tag": TAG}))
        run(server.db.clients.delete_many({"_tag": TAG}))
        run(server.db.vaccine_dismissals.delete_many({"_tag": TAG}))
        run(server.db.users.delete_many({"_tag": TAG}))
        run(server.db.payment_ledger.delete_many({"_tag": TAG}))


def _bk(date, **extra):
    row = {"id": str(uuid.uuid4()), "client_id": "c", "dog_id": "d", "service_type": "daycare", "status": "approved",
           "date": date, "created_at": server.now_iso(), "_tag": TAG}
    row.update(extra)
    return row


def test_capacity_count_is_date_bounded_and_uncapped():
    day = "2001-06-15"
    with _cleanup():
        base = run(server._booking_days_count_filtered(day, "daycare"))
        rows = [_bk(day) for _ in range(10_050)]                      # > old 10,000 ceiling
        rows += [_bk("2001-06-14", service_type="daycare", end_date="2001-06-16")]   # stay spanning the day
        rows += [_bk(day, checked_out_at="2001-06-15T20:00:00")]     # freed slot
        rows += [_bk("2001-06-10") for _ in range(20)]               # other days
        rows += [_bk(day, service_type="boarding")]                  # other service
        run(server.db.bookings.insert_many(rows))
        assert run(server._booking_days_count_filtered(day, "daycare")) == base + 10_051
        assert run(server._booking_days_count_filtered("2001-06-14", "daycare")) == 1
        active = run(server._active_capacity_bookings("boarding", start_date=day, end_date=day))
        assert any(b["_tag"] == TAG for b in active) and all(not b.get("checked_out_at") for b in active)
        assert not any(b.get("date") == "2001-06-10" for b in active)


def test_vaccine_alerts_and_health_flags_see_every_dog():
    with _cleanup():
        owner = {"id": str(uuid.uuid4()), "name": f"{TAG} Owner", "email": "", "_tag": TAG}
        run(server.db.clients.insert_one(owner))
        n = 2_100                                                     # > old 2,000 ceiling
        run(server.db.dogs.insert_many([{"id": str(uuid.uuid4()), "name": f"{TAG} {i}", "owner_id": owner["id"],
                                         "vaccines": {"rabies": "2000-01-01"}, "_tag": TAG} for i in range(n)]))
        dismissed_dog = {"id": str(uuid.uuid4()), "name": f"{TAG} dismissed", "owner_id": owner["id"], "vaccines": {"rabies": "2000-01-01"}, "_tag": TAG}
        run(server.db.dogs.insert_one(dismissed_dog))
        run(server.db.vaccine_dismissals.insert_one({"dog_id": dismissed_dog["id"], "until": "2999-01-01T00:00:00+00:00", "_tag": TAG}))
        run(server.db.vaccine_dismissals.insert_one({"dog_id": "stale", "until": "2000-01-01T00:00:00+00:00", "_tag": TAG}))
        alerts = run(server.vaccine_alerts(_admin_user()))
        mine = [a for a in alerts if a.get("owner_name") == owner["name"] or a.get("client_name") == owner["name"] or str(a.get("dog_name", "")).startswith(TAG)]
        assert len(mine) == n, len(mine)
        dm = run(server._active_vaccine_dismissals())
        assert dismissed_dog["id"] in dm and "stale" not in dm
        stats = run(server.dashboard_stats(_admin_user()))
        assert stats["health_flags"] >= n


def test_pending_actions_list_counts_match_the_badge():
    admin = _admin_user()
    listing = run(server.admin_pending_actions(None, 5, admin))
    badge = run(server.admin_pending_actions_count(admin))
    assert listing["counts"]["total"] == badge["total"]
    for t, key in server._PENDING_ACTION_COUNT_KEYS.items():
        assert listing["counts"][t] == badge[key]
    assert listing["counts"]["listed"] == len(listing["items"]) <= 5


def test_duplicate_finder_ownership_counts_are_aggregated_across_archive():
    with _cleanup():
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        future = (server.business_today() + timedelta(days=3)).isoformat()
        run(server.db.bookings.insert_many([_bk(future, client_id=cid, dog_id=did, status="approved"), _bk("2001-01-01", client_id=cid, dog_id=did, status="completed")]))
        run(server.db.bookings_archive.insert_many([_bk("2000-05-05", client_id=cid, dog_id=did, status="completed", archived_at="x")]))
        run(server.db.users.insert_many([{"id": str(uuid.uuid4()), "client_id": cid, "email": f"{uuid.uuid4().hex[:6]}@x.com", "role": "client", "_tag": TAG} for _ in range(2)]))
        run(server.db.payment_ledger.insert_many([{"id": str(uuid.uuid4()), "client_id": cid, "amount": 1, "_tag": TAG} for _ in range(3)]))
        by_client, future_by_client, by_dog, future_by_dog = run(server._booking_ownership_counts(server.business_today().isoformat()))
        assert by_client[cid] == 3 and future_by_client[cid] == 1
        assert by_dog[did] == 3 and future_by_dog[did] == 1
        assert run(server._count_by_field(server.db.users, "client_id", {"client_id": cid}))[cid] == 2
        assert run(server._count_by_field(server.db.payment_ledger, "client_id", {"client_id": cid}))[cid] == 3
