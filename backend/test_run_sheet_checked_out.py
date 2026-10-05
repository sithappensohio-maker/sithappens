"""The Run Sheet drops a boarding dog who has already gone home (audit #83). A stay that
spans several days stayed on the sheet for every day in its range, even after checkout.
Disposable tag TEST_RUNSHEET_OUT."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RUNSHEET_OUT"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner-rs@test"}
TARGET = "2031-08-10"


def _stay(checked_out_at=None):
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                                      "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rex", "owner_id": cid, "breed": "Mix", "tag": TAG,
                                   "vaccines": {}}))
    bid = f"{TAG}-b-{uuid.uuid4().hex[:6]}"
    doc = {"id": bid, "dog_id": did, "client_id": cid, "dog_name": "Rex", "service_type": "boarding",
           "date": "2031-08-09", "end_date": "2031-08-12", "status": "completed" if checked_out_at else "approved",
           "kennel": "K1", "time": "", "dropoff_time": "", "pickup_time": "", "notes": "", "tag": TAG,
           "created_at": server.now_iso()}
    if checked_out_at:
        doc["checked_out_at"] = checked_out_at
    run(server.db.bookings.insert_one(doc))
    return bid


def teardown_module():
    for coll in ("clients", "dogs", "bookings"):
        run(getattr(server.db, coll).delete_many({"tag": TAG}))


def test_a_dog_who_went_home_yesterday_is_not_on_todays_run_sheet():
    gone = _stay(checked_out_at="2031-08-09T17:00:00+00:00")
    out = run(server.run_sheet(ADMIN, date_str=TARGET))
    assert gone not in [b["id"] for b in out["bookings"]]


def test_a_dog_still_in_is_on_the_run_sheet():
    staying = _stay()
    out = run(server.run_sheet(ADMIN, date_str=TARGET))
    assert staying in [b["id"] for b in out["bookings"]]
