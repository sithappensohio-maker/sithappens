"""The visit report is emailed at checkout, not when a staff note is saved mid-visit (audit #79).
A note saved while the dog was still in stamped the report as attempted, which then blocked the
real checkout email. Disposable tag TEST_RC_CHECKOUT."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RC_CHECKOUT"


def _booking(**extra):
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": f"{TAG}-d", "client_id": f"{TAG}-c",
         "dog_name": "Rex", "service_type": "daycare", "date": "2031-08-10", "end_date": "2031-08-10",
         "status": "approved", "tag": TAG, "report_card": {"notes": "Had a great day"}, "feeding_log": [],
         "medication_log": [], "bathroom_log": {"pee": 1, "poop": 0}}
    b.update(extra)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def teardown_module():
    run(server.db.bookings.delete_many({"tag": TAG}))


def test_a_mid_visit_note_does_not_send_or_stamp_the_report():
    b = _booking()
    out = run(server._maybe_send_report_card_email(b))
    assert out == {"sent": False, "attempted": False, "reason": "not checked out"}
    stored = run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0}))
    assert "report_card_email_attempted_at" not in stored


def test_the_report_is_still_considered_once_the_dog_is_checked_out():
    b = _booking(checked_out_at="2031-08-10T21:00:00+00:00", status="completed")
    out = run(server._maybe_send_report_card_email(b))
    assert out.get("reason") != "not checked out"
