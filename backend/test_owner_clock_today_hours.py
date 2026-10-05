"""The owner's clock tile shows today's hours after a clock-out (audit #61). The
clock endpoint returned only the open entry, so the tile read a missing field and
showed 0.00h. Disposable tag TEST_CLOCK_TODAY."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_CLOCK_TODAY"


def test_time_clock_current_reports_hours_already_worked_today():
    owner = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "role": "admin", "name": "Owner QA", "email": "owner-clock@test"}
    today = server.business_today().isoformat()
    entry_id = f"{TAG}-{uuid.uuid4().hex[:6]}"
    run(server.db.time_clock_entries.insert_one({
        "id": entry_id, "user_id": owner["id"], "clock_in_at": f"{today}T08:00:00",
        "clock_out_at": f"{today}T10:30:00", "hours": 2.5, "tag": TAG}))
    try:
        out = run(server.time_clock_current(owner))
        assert out["open"] is None
        assert out["today_hours"] == 2.5
    finally:
        run(server.db.time_clock_entries.delete_many({"tag": TAG}))
