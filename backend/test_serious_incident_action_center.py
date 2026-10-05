"""A serious incident appears in the Action Center until the owner acknowledges it (audit
#35). A minor one never does. Far-future business date, so no other test's rows match.
Disposable tag TEST_SERIOUS_INC."""
from datetime import date
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_SERIOUS_INC"
DAY = date(2031, 3, 5)
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner@test"}


@pytest.fixture()
def incidents(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: DAY)
    rows = [{"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "dog_name": "Biter", "type": "bite", "severity": "minor",
             "date": DAY.isoformat(), "tag": TAG},
            {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "dog_name": "Scratch", "type": "other", "severity": "minor",
             "date": DAY.isoformat(), "tag": TAG}]
    run(server.db.incidents.insert_many(rows))
    yield rows
    run(server.db.incidents.delete_many({"tag": TAG}))


def _serious_item(out):
    return next((i for i in out.get("items", []) if i.get("kind") == "serious_incident"), None)


def test_a_bite_appears_in_the_action_center_and_a_minor_one_does_not(incidents):
    item = _serious_item(run(server.admin_today_brain(ADMIN)))
    assert item is not None and item["title"] == "1 serious incident to review"
    assert "Biter" in item["subtitle"] and "Scratch" not in item["subtitle"]


def test_acknowledging_it_clears_it(incidents):
    bite = next(r for r in incidents if r["type"] == "bite")
    run(server.acknowledge_incident(bite["id"], ADMIN))
    assert _serious_item(run(server.admin_today_brain(ADMIN))) is None
