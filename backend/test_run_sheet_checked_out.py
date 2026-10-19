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


def test_each_row_gets_its_own_dog_client_and_program_not_a_mixed_up_one():
    """The enrichment loop batches dog/client/program lookups with $in
    instead of one query per booking (performance pass, same N+1 fix
    care_board_today already used). This proves the batched dict lookups
    still match each row to ITS OWN data, not another row's, with two
    different dogs/clients/programs on the sheet at once."""
    c1, d1 = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    c2, d2 = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    p1 = f"{TAG}-p-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_many([
        {"id": c1, "name": f"{TAG} Pat", "phone": "111-1111", "emerg": "Pat's emergency", "tag": TAG},
        {"id": c2, "name": f"{TAG} Sam", "phone": "222-2222", "emerg": "Sam's emergency", "tag": TAG},
    ]))
    run(server.db.dogs.insert_many([
        {"id": d1, "name": "Rex", "owner_id": c1, "breed": "Mix", "tag": TAG, "vaccines": {}, "active_program_id": p1},
        {"id": d2, "name": "Fido", "owner_id": c2, "breed": "Mix", "tag": TAG, "vaccines": {}},
    ]))
    run(server.db.dog_programs.insert_one({"id": p1, "status": "active", "tag": TAG,
                                           "program_snapshot": {"name": "Rock Solid Recall"}}))
    b1, b2 = f"{TAG}-b-{uuid.uuid4().hex[:6]}", f"{TAG}-b-{uuid.uuid4().hex[:6]}"
    row = lambda bid, dog_id, client_id, name: {
        "id": bid, "dog_id": dog_id, "client_id": client_id, "dog_name": name, "service_type": "daycare",
        "date": TARGET, "end_date": None, "status": "approved", "kennel": "", "time": "",
        "dropoff_time": "", "pickup_time": "", "notes": "", "tag": TAG, "created_at": server.now_iso(),
    }
    run(server.db.bookings.insert_many([row(b1, d1, c1, "Rex"), row(b2, d2, c2, "Fido")]))
    try:
        out = run(server.run_sheet(ADMIN, date_str=TARGET))
        rows = {r["id"]: r for r in out["bookings"]}
        assert rows[b1]["dog"]["name"] == "Rex"
        assert rows[b1]["client_phone"] == "111-1111" and rows[b1]["client_emerg"] == "Pat's emergency"
        assert rows[b1]["active_program_name"] == "Rock Solid Recall"
        assert rows[b2]["dog"]["name"] == "Fido"
        assert rows[b2]["client_phone"] == "222-2222" and rows[b2]["client_emerg"] == "Sam's emergency"
        assert rows[b2]["active_program_name"] is None
    finally:
        run(server.db.dog_programs.delete_many({"tag": TAG}))
