"""'Send now' on the Monday brief clears today's dedup key by the business day, not the
UTC day, so it can re-send (audit #69: "'Send the Monday brief now' uses the UTC date").
The job itself is stubbed; only the key handling is under test. Disposable tag
TEST_DIGEST_DAY."""
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
    monkeypatch.setattr(server, "business_today", lambda: date(2026, 10, 4))
    run(server.db.notification_log.insert_one({"key": "trainer_monday_digest:2026-10-04", "tag": TAG}))
    yield
    run(server.db.notification_log.delete_many({"tag": TAG}))


def test_send_now_clears_todays_business_day_key(stub_job):
    run(server.admin_force_monday_digest(ADMIN))
    assert run(server.db.notification_log.count_documents({"key": "trainer_monday_digest:2026-10-04"})) == 0
