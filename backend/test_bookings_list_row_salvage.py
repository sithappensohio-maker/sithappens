"""Regression tests for GET /bookings per-row salvage (2026-08-10 prod
incident: a single malformed booking row made the strict
`response_model=List[BookingOut]` raise ResponseValidationError, so the
entire admin Bookings page 500'd and rendered nothing).

`list_bookings` must now degrade per row instead:
  - legacy statuses are remapped ("canceled" -> "cancelled", "no_show" ->
    "cancelled", plus the existing checked_in/checked_out remaps);
  - missing created_at / display names get safe defaults;
  - a row that still fails BookingOut validation is skipped (and logged),
    never allowed to 500 the whole list.

Calls the async server functions directly via the shared event loop, same
pattern as test_front_desk_checkin.py. Every test creates its own disposable
rows, tagged "TEST_BOOKINGS_SALVAGE", and deletes them in a `finally` block.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run


TAG = "TEST_BOOKINGS_SALVAGE"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _row(**overrides):
    today = server.business_today().isoformat()
    doc = {
        "id": f"{TAG}-{uuid.uuid4()}", "client_id": str(uuid.uuid4()),
        "client_name": f"{TAG} client", "dog_id": str(uuid.uuid4()),
        "dog_name": f"{TAG} dog", "service_type": "daycare",
        "date": today, "status": "approved", "created_at": server.now_iso(),
    }
    doc.update(overrides)
    return doc


async def _cleanup():
    await server.db.bookings.delete_many({"id": {"$regex": f"^{TAG}"}})


def test_legacy_canceled_and_no_show_are_remapped():
    async def body():
        good = _row()
        one_l = _row(status="canceled")
        no_show = _row(status="no_show")
        await server.db.bookings.insert_many([dict(good), dict(one_l), dict(no_show)])
        try:
            out = await server.list_bookings(user=_admin_user())
            by_id = {b.id: b for b in out if b.id.startswith(TAG)}
            assert by_id[good["id"]].status == "approved"
            assert by_id[one_l["id"]].status == "cancelled"
            assert by_id[no_show["id"]].status == "cancelled"
        finally:
            await _cleanup()
    run(body())


def test_missing_created_at_is_salvaged_not_fatal():
    async def body():
        incomplete = _row()
        incomplete.pop("created_at")
        await server.db.bookings.insert_one(dict(incomplete))
        try:
            out = await server.list_bookings(user=_admin_user())
            by_id = {b.id: b for b in out if b.id.startswith(TAG)}
            assert by_id[incomplete["id"]].created_at == ""
        finally:
            await _cleanup()
    run(body())


def test_unsalvageable_row_is_skipped_not_500():
    async def body():
        good = _row()
        broken = {"id": f"{TAG}-broken", "date": good["date"],
                  "service_type": "daycare", "status": "weird_status"}
        await server.db.bookings.insert_many([dict(good), dict(broken)])
        try:
            out = await server.list_bookings(user=_admin_user())
            ids = {b.id for b in out}
            assert good["id"] in ids, "healthy row must survive"
            assert broken["id"] not in ids, "malformed row must be skipped, not returned"
        finally:
            await _cleanup()
    run(body())
