"""A client sees an intake form sent back for follow-up, and the form they see carries no staff
review notes or staff-only answers (audit #64). The portal listed only status "sent", and returned
the whole submission. Disposable tag TEST_INTAKE_PORTAL."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_INTAKE_PORTAL"


def _setup():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    tid = f"{TAG}-tpl-{uuid.uuid4().hex[:6]}"
    run(server.db.intake_form_templates.insert_one({
        "id": tid, "name": f"{TAG} Intake", "form_type": "intake", "description": "",
        "fields": [{"id": "f-pub", "label": "Allergies", "field_type": "text"},
                   {"id": "f-staff", "label": "Internal flag", "field_type": "text", "staff_only": True}],
        "tag": TAG}))
    sid = f"{TAG}-sub-{uuid.uuid4().hex[:6]}"
    run(server.db.intake_submissions.insert_one({
        "id": sid, "template_id": tid, "client_id": cid, "status": "needs_follow_up", "created_at": server.now_iso(),
        "answers": {"f-pub": "Peanuts", "f-staff": "Watch this one"},
        "review_notes": "Please confirm the vet name", "reviewed_by": "Staff QA", "reviewed_at": server.now_iso(),
        "tag": TAG}))
    return cid, sid


def teardown_module():
    run(server.db.intake_form_templates.delete_many({"tag": TAG}))
    run(server.db.intake_submissions.delete_many({"tag": TAG}))


def test_a_form_sent_back_for_follow_up_is_listed_without_staff_notes():
    cid, sid = _setup()
    user = {"id": f"{TAG}-u", "role": "client", "client_id": cid}
    listed = run(server.portal_list_assigned_intake(user))["assigned"]
    row = next(r for r in listed if r["id"] == sid)
    for key in ("review_notes", "reviewed_by", "reviewed_at"):
        assert key not in row, key
    assert row["answers"] == {"f-pub": "Peanuts"}, "a staff-only answer stays with staff"
    assert [f["id"] for f in row["template"]["fields"]] == ["f-pub"]
