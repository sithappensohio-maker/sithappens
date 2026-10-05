"""'Send now' on the Monday brief clears this week's dedup key, so it can re-send (audit #69).

The job keys its dedup on the Monday of the week. 'Send now' used to clear the key
for the day it was pressed, so on a Tuesday through Sunday the stale Monday key stayed
and the job skipped without sending. The job itself is stubbed; only the key handling
is under test. Disposable tag TEST_DIGEST_DAY."""
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import daily_jobs
from _test_loop import run

TAG = "TEST_DIGEST_DAY"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


@pytest.fixture()
def stub_job(monkeypatch):
    async def fake(_db):
        return {"sent": 0}
    monkeypatch.setattr(daily_jobs, "run_trainer_monday_digest_job", fake)
    yield monkeypatch
    run(server.db.notification_log.delete_many({"tag": TAG}))


def _seed_key(key):
    run(server.db.notification_log.insert_one({"key": key, "tag": TAG}))


def test_send_now_on_the_monday_clears_that_monday_key(stub_job):
    stub_job.setattr(server, "business_today", lambda: date(2026, 10, 5))
    _seed_key("trainer_monday_digest:2026-10-05")
    run(server.admin_force_monday_digest(ADMIN))
    assert run(server.db.notification_log.count_documents({"key": "trainer_monday_digest:2026-10-05"})) == 0


def test_send_now_on_a_wednesday_clears_this_weeks_monday_key(stub_job):
    # The job's key is the Monday of this week (2026-10-05), not today (2026-10-07).
    stub_job.setattr(server, "business_today", lambda: date(2026, 10, 7))
    _seed_key("trainer_monday_digest:2026-10-05")
    run(server.admin_force_monday_digest(ADMIN))
    assert run(server.db.notification_log.count_documents({"key": "trainer_monday_digest:2026-10-05"})) == 0
