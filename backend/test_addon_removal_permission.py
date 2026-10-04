"""Taking a booked add-on off needs booking_edit for staff (audit: "Any
admin-type login can remove a booked add-on without a permission check").
Disposable tag TEST_ADDON_RM."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_ADDON_RM"
OWNER = {"id": f"{TAG}-owner", "name": f"{TAG} owner", "email": f"{TAG.lower()}-o@example.com", "role": "admin"}


def _booking_with_addon():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    bid = f"{TAG}-b-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({"id": bid, "client_id": cid, "client_name": "Pat", "dog_name": "Rex",
                                       "service_type": "daycare", "date": "2031-03-03", "status": "approved",
                                       "estimated_price": 40.0, "tag": TAG,
                                       "add_ons": [{"service_id": "bath", "name": "Bath", "price": 15.0, "qty": 1}]}))
    return bid


def _staff(staff_role):
    u = {"id": f"{TAG}-s-{uuid.uuid4().hex[:6]}", "name": f"{TAG} {staff_role}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
         "role": "admin", "staff_role": staff_role, "active": True, "password_hash": "x", "token_version": 0}
    run(server.db.users.insert_one(dict(u)))
    return u


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.bookings.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"id": {"$regex": f"^{TAG}-s-"}}))


def test_a_read_only_staff_login_cannot_take_an_add_on_off():
    bid = _booking_with_addon()
    with pytest.raises(server.HTTPException) as err:
        run(server.remove_booking_addon(bid, 0, _staff("read_only")))
    assert err.value.status_code == 403
    assert len(run(server.db.bookings.find_one({"id": bid}))["add_ons"]) == 1, "nothing changed"


def test_the_owner_still_can():
    bid = _booking_with_addon()
    run(server.remove_booking_addon(bid, 0, OWNER))
    assert run(server.db.bookings.find_one({"id": bid}))["add_ons"] == []
