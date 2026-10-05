"""A booking lives in one place after a merge restore (audit #8). The nightly archive moves a
finished booking from bookings to bookings_archive, but a backup taken before the move still holds
it in bookings, so a merge put it back live: the same booking in both collections, and its visits
counted twice. A merge now skips the copy that is not the live one. Disposable tag TEST_MERGE_TWIN."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_MERGE_TWIN"


def _booking(**over):
    b = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "dog_id": f"{TAG}-dog", "client_id": f"{TAG}-c",
         "dog_name": "Rex", "service_type": "daycare", "date": "2031-05-01", "end_date": "2031-05-01",
         "status": "completed", "tag": TAG, "created_at": server.now_iso()}
    b.update(over)
    return b


def _ids(coll, ids):
    return sorted(r["id"] for r in run(getattr(server.db, coll).find({"id": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(50)))


def teardown_module():
    run(server.db.bookings.delete_many({"tag": TAG}))
    run(server.db.bookings_archive.delete_many({"tag": TAG}))


def test_a_merge_does_not_bring_an_archived_booking_back_live():
    archived = _booking(archived_at=server.now_iso())
    run(server.db.bookings_archive.insert_one(dict(archived)))
    summary, _kept = run(server._restore_collections({"bookings": [dict(archived)]}, "merge"))
    assert _ids("bookings", [archived["id"]]) == [], "the archived booking stays out of bookings"
    assert _ids("bookings_archive", [archived["id"]]) == [archived["id"]], "and stays in the archive, once"
    assert summary["bookings"].get("skipped_other_copy") == 1


def test_a_merge_does_not_copy_a_live_booking_into_the_archive():
    live = _booking()
    run(server.db.bookings.insert_one(dict(live)))
    run(server._restore_collections({"bookings_archive": [dict(live)]}, "merge"))
    assert _ids("bookings", [live["id"]]) == [live["id"]], "the live booking stays live, once"
    assert _ids("bookings_archive", [live["id"]]) == [], "and is not copied into the archive"


def test_an_ordinary_booking_still_restores():
    fresh = _booking()
    summary, _kept = run(server._restore_collections({"bookings": [dict(fresh)]}, "merge"))
    assert _ids("bookings", [fresh["id"]]) == [fresh["id"]]
    assert "skipped_other_copy" not in summary["bookings"]
