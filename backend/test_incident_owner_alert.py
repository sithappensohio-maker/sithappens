"""A serious incident logged by staff (severe, a bite or an injury) emails the owner;
other incidents are recorded and not emailed (audit #35). The staff member is told which
it was. Disposable tag TEST_INC_ALERT."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import email_service
from _test_loop import run

TAG = "TEST_INC_ALERT"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner@test"}


@pytest.fixture()
def dog(monkeypatch):
    monkeypatch.setattr(email_service, "ADMIN_NOTIFICATION_EMAIL", "owner@example.com")
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog"}))
    yield did
    run(server.db.dogs.delete_many({"id": did}))
    run(server.db.incidents.delete_many({"dog_id": did}))
    run(server.db.email_outbox.delete_many({"key": {"$regex": "^incident:owner:"}, "tag": TAG}))


def _log(did, **kw):
    body = server.EmployeeIncidentIn(dog_id=did, description="Something happened here", **kw)
    return run(server.employee_create_incident(body, ADMIN))


def test_a_bite_emails_the_owner(dog):
    out = _log(dog, type="bite", severity="minor")
    assert out["owner_alerted"] is True
    assert run(server.db.email_outbox.count_documents({"key": f"incident:owner:{out['id']}"})) == 1


def test_a_severe_incident_emails_the_owner(dog):
    out = _log(dog, type="behavior", severity="severe")
    assert out["owner_alerted"] is True


def test_a_minor_other_incident_is_recorded_not_emailed(dog):
    out = _log(dog, type="other", severity="minor")
    assert out["owner_alerted"] is False
    assert run(server.db.email_outbox.count_documents({"key": f"incident:owner:{out['id']}"})) == 0
