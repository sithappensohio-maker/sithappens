"""Read-only staff see the board and cannot change it (audit #25: "Read-only staff
can check dogs in, record medicine as given, email report cards and clear the
Action Center"). Check-in, the care actions and report cards need "Check Dogs
In/Out"; clearing the Action Center for everyone needs booking edit. The gate
runs before any lookup, so a missing booking id tells the two apart: a refused
user gets 403, a permitted one gets 404. Disposable tag TEST_READ_ONLY_CARE."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_READ_ONLY_CARE"
MISSING = f"{TAG}-no-such-booking"
READ_ONLY = {"id": f"{TAG}-ro", "role": "employee", "staff_role": "read_only", "name": "RO", "email": "ro@test"}
FRONT_DESK = {"id": f"{TAG}-fd", "role": "employee", "staff_role": "front_desk", "name": "FD", "email": "fd@test"}
RO_ADMIN = {"id": f"{TAG}-ra", "role": "admin", "staff_role": "read_only", "name": "RA", "email": "ra@test"}


def _status(fn):
    try:
        fn()
    except HTTPException as exc:
        return exc.status_code, exc.detail
    return 200, None


def test_read_only_staff_cannot_check_a_dog_in():
    code, detail = _status(lambda: run(server.check_in(MISSING, None, READ_ONLY)))
    assert code == 403, detail
    assert "care_complete" in detail


def test_read_only_staff_cannot_record_a_care_action():
    body = server.CareCompleteIn(initials="RO")
    code, detail = _status(lambda: run(server.complete_care_item(MISSING, "meds-1", body, READ_ONLY)))
    assert code == 403, detail


def test_read_only_staff_cannot_clear_the_action_center_for_everyone():
    code, detail = _status(lambda: run(server.admin_today_brain_clear_all(RO_ADMIN)))
    assert code == 403, detail
    assert "booking_edit" in detail


def test_front_desk_passes_the_care_gate():
    # front desk holds the care permission by default, so it reaches the lookup
    code, _ = _status(lambda: run(server.check_in(MISSING, None, FRONT_DESK)))
    assert code == 404
