"""GET /clients/{id}/visits — the Client hub's visit count is the award
engine's own count (checked-out or completed, live + archived, every dog),
with the tier held and the next tier."""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CLIENT_VISITS"


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    run(server.db.bookings.delete_many({"client_name": TAG}))
    run(server.db.bookings_archive.delete_many({"client_name": TAG}))
    run(server.db.dogs.delete_many({"name": {"$regex": f"^{TAG}"}}))


def _booking(client_id, dog_id, date, **over):
    doc = {"id": str(uuid.uuid4()), "client_id": client_id, "client_name": TAG, "dog_id": dog_id, "date": date,
           "service_type": "daycare", "status": "completed", "checked_out_at": f"{date}T17:00:00+00:00"}
    doc.update(over)
    return doc


def test_visits_count_like_the_award_engine_and_report_the_tiers():
    run(server.seed_trophies_if_empty(server.db))
    cid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    d1, d2 = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.dogs.insert_many([{"id": d1, "name": f"{TAG} Rex", "owner_id": cid}, {"id": d2, "name": f"{TAG} Bea", "owner_id": cid}]))
    live = [_booking(cid, d1, f"2026-08-{i:02d}") for i in range(1, 8)]          # 7 checked out
    live.append(_booking(cid, d2, "2026-08-20", checked_out_at=None, status="completed"))  # legacy completed counts
    live.append(_booking(cid, d2, "2026-08-21", checked_out_at=None, status="approved"))   # never checked out: no
    live.append(_booking(cid, d1, "2026-08-22", checked_out_at=None, status="cancelled"))  # cancelled: no
    run(server.db.bookings.insert_many(live))
    run(server.db.bookings_archive.insert_many([_booking(cid, d2, f"2026-05-{i:02d}") for i in range(1, 4)]))  # 3 archived

    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": "A"}
    out = run(server.client_visits_summary(cid, admin))
    assert out["visits"] == 11
    assert [(r["dog_name"], r["visits"]) for r in out["per_dog"]] == [(f"{TAG} Rex", 7), (f"{TAG} Bea", 4)]
    assert out["last_visit"] == "2026-08-20"
    assert out["held"]["code"] == "client_regular" and out["held"]["threshold"] == 10
    assert out["next"]["code"] == "client_loyal" and out["next"]["remaining"] == 39
    assert [t["threshold"] for t in out["tiers"]] == [10, 50, 100]

    # the client can see their own; another client cannot
    me = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
    assert run(server.client_visits_summary(cid, me))["visits"] == 11
    with pytest.raises(server.HTTPException):
        run(server.client_visits_summary(cid, {"id": "x", "role": "client", "client_id": "someone-else"}))


def test_a_client_with_no_visits_has_no_tier_and_ten_to_go():
    cid = f"{TAG}-empty-{uuid.uuid4().hex[:6]}"
    out = run(server.client_visits_summary(cid, {"id": "a", "role": "admin"}))
    assert out["visits"] == 0 and out["held"] is None and out["per_dog"] == [] and out["last_visit"] is None
    assert out["next"]["threshold"] == 10 and out["next"]["remaining"] == 10
