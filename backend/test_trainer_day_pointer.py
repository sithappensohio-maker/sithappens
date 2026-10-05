"""Finishing a course on Trainer Day moves the dog's front-desk pointer off the finished course
(audit #67). The completion marked the course completed but left dogs.active_program_id on it, so
the Run Sheet, the course-progress checks and the credit preference kept pointing at a finished
course. The pointer now moves to the dog's other active staff-led course, oldest first, or clears.
Disposable tags TEST_SESSION_COMPLETION (shared fixtures)."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from test_training_session_completion import (
    _admin_user, _cleanup, _client_and_dog, _fail_method_on_collection, _program, _start_and_record,
)


def _pointer(dog_id):
    return (run(server.db.dogs.find_one({"id": dog_id}, {"_id": 0, "active_program_id": 1})) or {}).get("active_program_id")


def _complete(draft_id, admin, advancement="complete_program"):
    return run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action=advancement), admin))


def test_finishing_the_course_releases_the_dogs_pointer():
    with _program() as (prog, admin, sit_id, down_id):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, _ = _start_and_record(prog, admin, dog, sit_id, score=5)
            try:
                assert _pointer(dog["id"]) == enr["id"], "enrolling makes the course the dog's pointer"
                _complete(draft_id, admin)
                assert _pointer(dog["id"]) is None
            finally:
                _cleanup(booking["id"], enr["id"])


def test_finishing_one_course_repoints_to_the_other_active_staff_course():
    with _program() as (prog_a, admin, sit_id, _):
        with _program() as (prog_b, _admin2, _s2, _d2):
            with _client_and_dog() as (c, dog):
                enr_a, booking_a, draft_a, _ = _start_and_record(prog_a, admin, dog, sit_id, score=5)
                enr_b = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_b["id"]), admin))
                try:
                    assert _pointer(dog["id"]) == enr_a["id"], "set-if-empty: the first course keeps the pointer"
                    _complete(draft_a, admin)
                    assert _pointer(dog["id"]) == enr_b["id"]
                finally:
                    _cleanup(booking_a["id"], enr_a["id"])
                    _cleanup(None, enr_b["id"])


def test_when_two_other_courses_are_active_the_oldest_one_takes_the_pointer():
    with _program() as (prog_a, admin, sit_id, _):
        with _program() as (prog_b, _a2, _s2, _d2):
            with _program() as (prog_c, _a3, _s3, _d3):
                with _client_and_dog() as (c, dog):
                    enr_a, booking_a, draft_a, _ = _start_and_record(prog_a, admin, dog, sit_id, score=5)
                    enr_b = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_b["id"]), admin))
                    enr_c = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_c["id"]), admin))
                    # Make B the older of the two other courses, whatever order they were created in.
                    run(server.db.dog_programs.update_one({"id": enr_b["id"]}, {"$set": {"created_at": "2020-01-01T00:00:00+00:00"}}))
                    run(server.db.dog_programs.update_one({"id": enr_c["id"]}, {"$set": {"created_at": "2021-01-01T00:00:00+00:00"}}))
                    try:
                        _complete(draft_a, admin)
                        assert _pointer(dog["id"]) == enr_b["id"]
                    finally:
                        _cleanup(booking_a["id"], enr_a["id"])
                        _cleanup(None, enr_b["id"])
                        _cleanup(None, enr_c["id"])


def test_a_retry_after_a_failed_log_write_still_releases_the_pointer():
    with _program() as (prog, admin, sit_id, _):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, _ = _start_and_record(prog, admin, dog, sit_id, score=4)
            try:
                with _fail_method_on_collection("training_session_log", "update_one"):
                    try:
                        _complete(draft_id, admin, advancement="complete_program")
                        assert False, "expected the simulated failure to propagate"
                    except RuntimeError:
                        pass
                assert _pointer(dog["id"]) is None, "released before the failing stage, so a retry cannot miss it"
                _complete(draft_id, admin, advancement="complete_program")
                assert _pointer(dog["id"]) is None
                assert run(server.db.training_session_log.count_documents({"enrollment_id": enr["id"]})) == 1
            finally:
                _cleanup(booking["id"], enr["id"])


def test_finishing_a_course_leaves_a_pointer_on_some_other_course_alone():
    with _program() as (prog_a, admin, sit_id, _):
        with _program() as (prog_b, _a2, _s2, _d2):
            with _client_and_dog() as (c, dog):
                enr_a, booking_a, draft_a, _ = _start_and_record(prog_a, admin, dog, sit_id, score=5)
                enr_b = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_b["id"]), admin))
                run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"active_program_id": enr_b["id"]}}))
                try:
                    _complete(draft_a, admin)
                    assert _pointer(dog["id"]) == enr_b["id"]
                finally:
                    _cleanup(booking_a["id"], enr_a["id"])
                    _cleanup(None, enr_b["id"])


def test_an_update_that_completes_a_course_still_releases_the_pointer():
    with _program() as (prog, admin, sit_id, _):
        with _client_and_dog() as (c, dog):
            enr, booking, draft_id, _ = _start_and_record(prog, admin, dog, sit_id, score=5)
            try:
                run(server.update_enrollment(dog["id"], enr["id"], server.EnrollmentUpdate(status="completed"), admin))
                assert _pointer(dog["id"]) is None
            finally:
                _cleanup(booking["id"], enr["id"])


def _lot(client_id, program_id, value_each, purchased_at):
    lot = {"id": f"{TAG_LOT}-{uuid.uuid4().hex[:6]}", "client_id": client_id, "pack_id": None, "pack_name": "Training pack",
           "service_type": "training", "program_id": program_id, "qty_total": 1, "qty_remaining": 1,
           "price_paid": value_each, "list_price": value_each, "price_override_id": None, "value_each": value_each,
           "payment_method": "cash", "purchased_at": purchased_at, "created_at": purchased_at, "tag": "TEST_SESSION_COMPLETION"}
    run(server.db.credit_lots.insert_one(dict(lot)))
    return lot


TAG_LOT = "TEST_SESSION_COMPLETION_LOT"


def test_a_training_checkout_after_graduation_draws_the_oldest_lot_not_the_finished_courses(monkeypatch):
    """The money effect of the release, end to end: the finished course's lot is the newer one and is
    worth more. Before the fix the stale pointer drew it first ($50); with the pointer released the
    oldest training lot is drawn ($40)."""
    with _program() as (prog_done, admin, sit_id, _):
        with _program() as (prog_other, _a2, _s2, _d2):
            with _client_and_dog() as (c, dog):
                enr_done, booking_done, draft_done, _ = _start_and_record(prog_done, admin, dog, sit_id, score=5)
                enr_other = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog_other["id"]), admin))
                older = _lot(c["id"], enr_other.get("program_id") or prog_other["id"], 40.0, "2030-01-01T00:00:00+00:00")
                newer = _lot(c["id"], enr_done.get("program_id") or prog_done["id"], 50.0, "2031-01-01T00:00:00+00:00")
                run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"training_credits": 2}}))
                try:
                    _complete(draft_done, admin)   # Trainer Day finishes the first course
                    assert _pointer(dog["id"]) == enr_other["id"], "the dog moves to the course still in progress"
                    booking = run(server.create_booking(server.BookingIn(
                        dog_id=dog["id"], service_type="training", date=date.today().isoformat(), override_capacity=True), admin))
                    run(server.db.bookings.update_one({"id": booking["id"]}, {"$set": {
                        "checked_in_at": server.now_iso(), "checked_in_by": "test"}}))
                    out = run(server._check_out_locked(booking["id"], None, admin))
                    drawn = [r["lot_id"] for r in (out.get("credit_lot_redemptions") or [])]
                    assert drawn == [older["id"]], "the oldest training lot is drawn, not the finished course's"
                finally:
                    run(server.db.credit_lots.delete_many({"tag": "TEST_SESSION_COMPLETION"}))
                    run(server.db.bookings.delete_many({"dog_id": dog["id"]}))
                    _cleanup(booking_done["id"], enr_done["id"])
                    _cleanup(None, enr_other["id"])
