"""GET /admin/client-visit-counts — the Clients directory's per-card visit
number, one round trip per page, no ceiling on the count."""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_VISIT_COUNTS_BATCH"


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    run(server.db.bookings.delete_many({"client_name": TAG}))
    run(server.db.bookings_archive.delete_many({"client_name": TAG}))


def _visit(cid, i, **over):
    doc = {"id": str(uuid.uuid4()), "client_id": cid, "client_name": TAG, "dog_id": "d", "date": f"2025-01-{(i % 28) + 1:02d}",
           "service_type": "daycare", "status": "completed", "checked_out_at": "2025-01-01T17:00:00+00:00"}
    doc.update(over)
    return doc


def test_counts_every_visit_across_live_and_archive_with_no_ceiling():
    run(server.seed_trophies_if_empty(server.db))
    big = f"{TAG}-big-{uuid.uuid4().hex[:6]}"
    mid = f"{TAG}-mid-{uuid.uuid4().hex[:6]}"
    none = f"{TAG}-none-{uuid.uuid4().hex[:6]}"
    # 120 live + 300 archived = 420 visits: past every tier and past any
    # "reasonable" page size, so a capped read would show.
    run(server.db.bookings.insert_many([_visit(big, i) for i in range(120)]))
    run(server.db.bookings_archive.insert_many([_visit(big, i) for i in range(300)]))
    run(server.db.bookings.insert_many([_visit(mid, i) for i in range(12)] + [
        _visit(mid, 99, status="approved", checked_out_at=None),   # never checked out: no
        _visit(mid, 98, status="cancelled", checked_out_at=None),  # cancelled: no
    ]))
    admin = {"id": str(uuid.uuid4()), "role": "admin"}
    out = run(server.client_visit_counts(",".join([big, mid, none]), admin))
    assert out[big]["visits"] == 420
    assert out[big]["held"]["code"] == "client_legend" and out[big]["next"] is None
    assert out[mid]["visits"] == 12
    assert out[mid]["held"]["code"] == "client_regular" and out[mid]["next"] == {"code": "client_loyal", "name": "Loyal Pack Member", "threshold": 50, "remaining": 38}
    assert out[none] == {"visits": 0, "held": None, "next": {"code": "client_regular", "name": "Regular", "threshold": 10, "remaining": 10}}
    assert run(server.client_visit_counts("", admin)) == {}
