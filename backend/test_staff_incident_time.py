"""An incident logged from the Staff Portal records the local time it happened, not UTC
(audit #34: "Incidents logged from the Staff Portal record the time 4-5 hours wrong").
Disposable tag TEST_INCIDENT_TIME."""
import uuid
from datetime import datetime

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_INCIDENT_TIME"
STAFF = {"id": f"{TAG}-staff", "role": "admin", "name": "Owner QA", "email": "owner@test"}


@pytest.fixture()
def dog():
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog"}))
    yield did
    run(server.db.dogs.delete_many({"id": did}))
    run(server.db.incidents.delete_many({"dog_id": did}))


def test_the_incident_time_is_the_local_clock(dog, monkeypatch):
    monkeypatch.setattr(server, "now_local", lambda: datetime(2026, 10, 5, 9, 30))
    out = run(server.employee_create_incident(server.EmployeeIncidentIn(dog_id=dog, description="Bit a toy"), STAFF))
    doc = out if isinstance(out, dict) and "time" in out else run(server.db.incidents.find_one({"dog_id": dog}, {"_id": 0}))
    assert doc["time"] == "09:30"
