"""Staff can see and clear a family's marketing opt-out (audit #38: "One click on
'Unsubscribe' blocks every personal email staff send that family, with no way to undo
it"). Clearing it needs the communications permission. Disposable tag TEST_OPT_OUT."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
from fastapi import HTTPException
import server
from _test_loop import run

TAG = "TEST_OPT_OUT"
OWNER = {"id": f"{TAG}-owner", "role": "admin", "name": "Owner QA", "email": "owner@test"}
FRONT_DESK = {"id": f"{TAG}-fd", "role": "employee", "staff_role": "front_desk", "name": "Desk", "email": "fd@test"}


@pytest.fixture()
def family():
    cid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{cid}@example.com",
                                      "marketing_email_opt_out": True, "marketing_email_opt_out_source": "unsubscribe_link",
                                      "tag": TAG}))
    yield cid
    run(server.db.clients.delete_many({"tag": TAG}))


def test_staff_can_clear_a_family_opt_out(family):
    run(server.admin_marketing_email_preference(family, server.MarketingEmailPreferenceIn(opted_out=False), OWNER))
    client = run(server.db.clients.find_one({"id": family}, {"_id": 0}))
    assert client["marketing_email_opt_out"] is False


def test_a_front_desk_login_cannot_clear_it(family):
    # The route's own guard: the permission dependency refuses before the handler runs.
    guard = server.require_admin_and_permission("manage_communications")
    with pytest.raises(HTTPException) as err:
        run(guard(FRONT_DESK))
    assert err.value.status_code == 403
    assert run(server.db.clients.find_one({"id": family}, {"_id": 0}))["marketing_email_opt_out"] is True
