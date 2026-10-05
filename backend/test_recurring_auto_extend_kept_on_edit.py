"""Editing a recurring schedule in the portal keeps its auto-renew setting (audit #10).
The portal's edit form does not send auto_extend, and the model defaults it to true, so
every edit silently switched a family's auto-renew back on. Disposable tag TEST_RT_AUTOEXT."""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RT_AUTOEXT"
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@contextlib.contextmanager
def _family():
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "created_at": server.now_iso()}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rosie", "owner_id": cid, "breed": "Mix", "vaccines": dict(VACCINES_OK)}))
    try:
        yield cid, did
    finally:
        run(server.db.recurring_templates.delete_many({"dog_id": did}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))


def _service():
    existing = run(server.db.services.find_one({"service_type": "daycare", "active": True}, {"_id": 0, "id": 1}))
    if existing:
        return existing["id"]
    sid = f"{TAG}-svc-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare", "active": True,
                                       "is_default": True, "price": 30.0}))
    return sid


def test_a_portal_edit_that_omits_auto_renew_keeps_it_off():
    sid = _service()
    with _family() as (cid, did):
        tid = f"{TAG}-t-{uuid.uuid4().hex[:6]}"
        run(server.db.recurring_templates.insert_one({
            "id": tid, "dog_id": did, "label": "weekly", "service_type": "daycare", "service_id": sid, "time": "",
            "dropoff_time": "", "weekdays": [0, 2, 4], "notes": "", "default_horizon_weeks": 4, "start_date": "",
            "active": True, "auto_extend": False, "created_at": server.now_iso(), "created_by": "client"}))
        client_user = {"id": f"{TAG}-user", "role": "client", "client_id": cid}
        # The portal's edit form: the schedule's own fields, and no auto_extend.
        body = server.RecurringTemplateIn(dog_id=did, service_type="daycare", service_id=sid, weekdays=[0, 2, 4],
                                          label="weekly", default_horizon_weeks=4, dropoff_time="08:00")
        run(server.update_recurring_template(tid, body, client_user))
        stored = run(server.db.recurring_templates.find_one({"id": tid}, {"_id": 0}))
        assert stored["auto_extend"] is False
        assert stored["dropoff_time"] == "08:00"


def test_an_edit_that_sends_auto_renew_still_changes_it():
    sid = _service()
    with _family() as (cid, did):
        tid = f"{TAG}-t-{uuid.uuid4().hex[:6]}"
        run(server.db.recurring_templates.insert_one({
            "id": tid, "dog_id": did, "label": "weekly", "service_type": "daycare", "service_id": sid, "time": "",
            "dropoff_time": "", "weekdays": [0], "notes": "", "default_horizon_weeks": 4, "start_date": "",
            "active": True, "auto_extend": False, "created_at": server.now_iso(), "created_by": "client"}))
        client_user = {"id": f"{TAG}-user", "role": "client", "client_id": cid}
        body = server.RecurringTemplateIn(dog_id=did, service_type="daycare", service_id=sid, weekdays=[0],
                                          label="weekly", default_horizon_weeks=4, auto_extend=True)
        run(server.update_recurring_template(tid, body, client_user))
        assert run(server.db.recurring_templates.find_one({"id": tid}, {"_id": 0}))["auto_extend"] is True
