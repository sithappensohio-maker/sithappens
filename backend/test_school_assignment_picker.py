"""Admin "Assign School Program" — the picker's data contract and the assignment.

The reported defect was a blank modal body: the picker rendered a group per
known curriculum type and `null` for every empty one, so any condition that
produced no matching group showed nothing at all and explained nothing. The
data condition that triggers it is ordinary — `GET /programs` returns only
ACTIVE programs, and an archived or draft curriculum is simply absent, while
the same course stays reachable from the client side through an existing
enrollment's own program snapshot.

These tests pin the contract the picker depends on, and the assignment it
performs: one canonical School enrollment, no duplicates on repeat, no
invented money, and permissions enforced on the server rather than by which
buttons happen to render.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _client_user, _cleanup_school, _admin_user,
)

TAG = "TEST_ASSIGN_PICKER"


def _programs_for(user, **kw):
    return run(server.list_programs(user=user, **kw))


def _enroll_via_endpoint(dog_id, program_id, user, delivery_mode=None):
    body = server.SchoolEnrollIn(dog_id=dog_id, program_id=program_id,
                                 **({"delivery_mode": delivery_mode} if delivery_mode else {}))
    return run(server.school_enroll(body, user))


@contextlib.contextmanager
def _cleanup(dog_id):
    try:
        yield
    finally:
        rows = run(server.db.dog_programs.find({"dog_id": dog_id}, {"_id": 0, "id": 1}).to_list(20))
        for r in rows:
            se = run(server.db.school_enrollments.find_one({"enrollment_id": r["id"]}, {"_id": 0, "id": 1}))
            if se:
                _cleanup_school(se["id"], r["id"])
            else:
                run(server.db.dog_programs.delete_one({"id": r["id"]}))


# ---------------------------------------------------------------------------
# The picker's data contract
# ---------------------------------------------------------------------------

def test_an_active_program_is_offered_to_the_picker():
    # The regression the blank modal needed: an eligible program must actually
    # reach the list the picker groups.
    with _school_program() as (prog, admin):
        ids = [p["id"] for p in _programs_for(admin)]
        assert prog["id"] in ids, "an active program was missing from the assign picker"


def test_an_online_school_program_is_offered_like_any_other():
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one({"id": prog["id"]},
                                          {"$set": {"delivery_mode": "self_guided"}}))
        rows = _programs_for(admin)
        mine = next((p for p in rows if p["id"] == prog["id"]), None)
        assert mine, "a self-guided (Online School) program was filtered out of the picker"
        assert mine.get("delivery_mode") == "self_guided"


def test_an_inactive_program_is_absent_and_that_is_the_blank_modals_cause():
    # Not a bug in itself — but it is why the body could legitimately be empty,
    # which is exactly the case the modal now has to explain rather than render
    # as nothing at all.
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"active": False}}))
        assert prog["id"] not in [p["id"] for p in _programs_for(admin)]
        # ...and it comes back the moment it is activated again
        assert prog["id"] in [p["id"] for p in _programs_for(admin, include_inactive=True)]


def test_direct_admin_assignment_cannot_bypass_archived_program_filter():
    """The picker hides inactive programs, but the server is the authority. A
    guessed/direct POST must not newly enroll a dog in an archived course."""
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"active": False}}))
        with _client_and_dog() as (_client, dog):
            with _cleanup(dog["id"]):
                with pytest.raises(server.HTTPException) as e:
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
                assert e.value.status_code == 422
                assert "archived" in str(e.value.detail).lower() or "inactive" in str(e.value.detail).lower()
                assert run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"]})) == 0


def test_every_offered_program_carries_what_the_picker_groups_by():
    # The picker groups by `type` and labels with /programs/meta. A program
    # whose type is outside that set used to disappear silently.
    with _school_program() as (prog, admin):
        meta_keys = {t["key"] for t in run(server.programs_meta(admin))["types"]}
        for p in _programs_for(admin):
            assert p.get("type"), f"program {p['id']} has no type to group by"
        assert prog["type"] in meta_keys


def test_a_client_cannot_read_the_admin_program_catalogue_in_full():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, _dog):
            cu = _client_user(client["id"])
            rows = _programs_for(cu)
            mine = next((p for p in rows if p["id"] == prog["id"]), None)
            if mine is not None:
                assert "modules" not in mine, "client saw internal curriculum structure"


# ---------------------------------------------------------------------------
# The assignment itself
# ---------------------------------------------------------------------------

def test_assigning_creates_one_canonical_school_enrollment():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                res = _enroll_via_endpoint(dog["id"], prog["id"], admin)
                se, enr = res["school_enrollment"], res["enrollment"]
                # the SAME structures a paid/free client enrollment produces
                assert run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
                stored = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert stored["program_snapshot"], "no curriculum snapshot — not the canonical path"
                assert stored.get("current_lesson_id"), "enrollment has no progress pointer"


def test_the_client_can_then_open_the_course():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                res = _enroll_via_endpoint(dog["id"], prog["id"], admin)
                cu = _client_user(client["id"])
                listing = run(server.portal_school_list(cu))
                rows = listing if isinstance(listing, list) else (listing.get("enrollments") or [])
                mine = [r for r in rows if r.get("program_id") == prog["id"]
                        and r.get("dog_id") == dog["id"]]
                assert mine, "the assigned course is invisible to the client"
                # ...and it is a real, openable course, not just a listing row
                assert mine[0].get("program_name") == prog["name"]
                assert mine[0].get("current_lesson_name"), "no lesson to start"


def test_assigning_twice_does_not_duplicate_anything():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                first = _enroll_via_endpoint(dog["id"], prog["id"], admin)
                try:
                    second = _enroll_via_endpoint(dog["id"], prog["id"], admin)
                    same = second["school_enrollment"]["id"] == first["school_enrollment"]["id"]
                    assert same, "a second assignment created a second School enrollment"
                except server.HTTPException as e:
                    # surfacing the existing enrollment as a conflict is equally correct
                    assert e.status_code == 409, e.status_code
                assert run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"})) == 1
                assert run(server.db.school_enrollments.count_documents(
                    {"dog_id": dog["id"], "status": {"$ne": "withdrawn"}})) == 1

def test_a_repeat_assignment_never_resets_progress():
    with _school_program(n_lessons_per_module=2) as (prog, admin):
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                res = _enroll_via_endpoint(dog["id"], prog["id"], admin)
                enr_id = res["enrollment"]["id"]
                lid = run(server.db.dog_programs.find_one(
                    {"id": enr_id}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                cu = _client_user(client["id"])
                run(server.portal_school_complete_lesson_step(
                    res["school_enrollment"]["id"], lid, "learn", cu))
                before = run(server.db.dog_programs.find_one({"id": enr_id}, {"_id": 0}))
                try:
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
                except server.HTTPException:
                    pass
                after = run(server.db.dog_programs.find_one({"id": enr_id}, {"_id": 0}))
                assert after["lesson_step_progress"] == before["lesson_step_progress"]
                assert after["current_lesson_id"] == before["current_lesson_id"]

# ---------------------------------------------------------------------------
# A complimentary assignment must not invent money
# ---------------------------------------------------------------------------

def test_a_manual_assignment_creates_no_money_records():
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"price": 499.0}}))
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                before = {c: run(server.db[c].count_documents({})) for c in (
                    "payments", "pos_sales", "invoices", "shop_orders", "cash_drawer_sessions")}
                _enroll_via_endpoint(dog["id"], prog["id"], admin)
                after = {c: run(server.db[c].count_documents({})) for c in before}
                assert after == before, f"assignment invented money rows: {before} -> {after}"
                # and nothing was attributed to this client either
                assert run(server.db.payments.count_documents({"client_id": client["id"]})) == 0
                assert run(server.db.invoices.count_documents({"client_id": client["id"]})) == 0


def test_a_manual_assignment_touches_no_stripe_object():
    calls = []
    import stripe as _stripe
    orig_session = getattr(_stripe.checkout.Session, "create", None)
    orig_intent = getattr(_stripe.PaymentIntent, "create", None)
    _stripe.checkout.Session.create = lambda *a, **k: calls.append("session")
    _stripe.PaymentIntent.create = lambda *a, **k: calls.append("intent")
    try:
        with _school_program() as (prog, admin):
            run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"price": 499.0}}))
            with _client_and_dog() as (client, dog):
                with _cleanup(dog["id"]):
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
        assert calls == [], f"a complimentary assignment called Stripe: {calls}"
    finally:
        if orig_session:
            _stripe.checkout.Session.create = orig_session
        if orig_intent:
            _stripe.PaymentIntent.create = orig_intent


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_a_client_cannot_call_the_assignment_endpoint():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, dog):
            cu = _client_user(client["id"])
            with pytest.raises(server.HTTPException) as e:
                _enroll_via_endpoint(dog["id"], prog["id"], cu)
            assert e.value.status_code in (401, 403)
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"]})) == 0


def test_an_unknown_dog_cannot_be_assigned():
    with _school_program() as (prog, admin):
        with pytest.raises(server.HTTPException) as e:
            _enroll_via_endpoint(str(uuid.uuid4()), prog["id"], admin)
        assert e.value.status_code == 404


def test_an_unknown_program_cannot_be_assigned():
    with _client_and_dog() as (client, dog):
        with pytest.raises(server.HTTPException) as e:
            _enroll_via_endpoint(dog["id"], str(uuid.uuid4()), _admin_user())
        assert e.value.status_code == 404


def test_online_assignment_requires_school_permission_specifically():
    with _school_program() as (prog, admin):
        with _client_and_dog() as (client, dog):
            with _cleanup(dog["id"]):
                trainer = {"id": str(uuid.uuid4()), "role": "admin", "staff_role": "trainer",
                           "name": f"{TAG} trainer"}
                perms = server._perms_for(trainer)
                if not perms.get("manage_school"):
                    with pytest.raises(server.HTTPException) as e:
                        _enroll_via_endpoint(dog["id"], prog["id"], trainer, delivery_mode="online")
                    assert e.value.status_code == 403

# ---------------------------------------------------------------------------
# Dog eligibility is enforced server-side, not merely labelled in the picker
# ---------------------------------------------------------------------------

def test_admin_assignment_enforces_program_minimum_age():
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one(
            {"id": prog["id"]}, {"$set": {"min_age_months": 12}}))
        with _client_and_dog() as (_client, dog):
            with _cleanup(dog["id"]):
                # Explicit legacy age fields are accepted when birthday is not
                # present, but the server — not the UI badge — is authoritative.
                run(server.db.dogs.update_one(
                    {"id": dog["id"]},
                    {"$set": {"birthday": "", "age_y": 0, "age_m": 6}}))
                with pytest.raises(server.HTTPException) as e:
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
                assert e.value.status_code == 422
                assert e.value.detail["code"] == "school_dog_too_young"
                assert run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"]})) == 0


def test_admin_assignment_requires_known_age_when_program_has_minimum():
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one(
            {"id": prog["id"]}, {"$set": {"min_age_months": 4}}))
        with _client_and_dog() as (_client, dog):
            with _cleanup(dog["id"]):
                run(server.db.dogs.update_one(
                    {"id": dog["id"]},
                    {"$set": {"birthday": "", "age_y": 0, "age_m": 0}}))
                with pytest.raises(server.HTTPException) as e:
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
                assert e.value.status_code == 422
                assert e.value.detail["code"] == "school_dog_age_required"
                assert run(server.db.dog_programs.count_documents(
                    {"dog_id": dog["id"], "program_id": prog["id"]})) == 0


def test_birthday_is_used_for_minimum_age_instead_of_stale_age_fields():
    with _school_program() as (prog, admin):
        run(server.db.programs.update_one(
            {"id": prog["id"]}, {"$set": {"min_age_months": 12}}))
        with _client_and_dog() as (_client, dog):
            with _cleanup(dog["id"]):
                today = server.business_today()
                # Six-month-old birthday but stale age_y says 5. Birthday must
                # win, otherwise the requirement is meaningless over time.
                month = today.month - 6
                year = today.year
                while month <= 0:
                    month += 12
                    year -= 1
                day = min(today.day, 28)
                birthday = f"{year:04d}-{month:02d}-{day:02d}"
                run(server.db.dogs.update_one(
                    {"id": dog["id"]},
                    {"$set": {"birthday": birthday, "age_y": 5, "age_m": 0}}))
                with pytest.raises(server.HTTPException) as e:
                    _enroll_via_endpoint(dog["id"], prog["id"], admin)
                assert e.value.detail["code"] == "school_dog_too_young"
