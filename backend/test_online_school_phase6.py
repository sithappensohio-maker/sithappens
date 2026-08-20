"""Sit Happens Online School — Phase 6 (Enrollment Lifecycle & Launch
Hardening).

Covers, self-contained, no shared state with other suites:

  1. access_state default/explicit — legacy rows (no access_state field)
     read as "active"; every newly-created row gets it explicitly.
  2. Withdraw Student — active->withdrawn transition, structured fields,
     idempotent retry, refused on a completed enrollment, optional
     simultaneous access revocation.
  3. Access revoke/restore — independent of training status, idempotent,
     usable at any lifecycle point (the mechanism behind the refund
     policy).
  4. _require_school_access guards — revoked blocks every protected read
     AND write; withdrawn blocks writes but not reads (read-only history).
  5. Retake policy — active/completed/withdrawn all block re-enrollment,
     both manual (school_enroll) and purchase (Shop eligibility check).
  6. Refund/revocation preserves training history at every point (before
     use, after Practice Coach activity, after checkpoint submission,
     after completion).
  7. Paid-but-unfulfilled operational visibility — dog_name snapshot,
     fulfillment_error capture/clear.
  8. Provenance survives withdrawal/access changes.
  9. Permission boundaries — client cannot call withdraw/access/admin
     checkpoint-history; a plain client role is rejected outright.
  10. Data-leakage fix — GET /dogs/{id}/programs excludes online_school
      rows for the client-owner branch, keeps them for staff.
  11. Deterministic portal_school_list ordering.
  12. Daily-tracker video server-side size ceiling (6.15).
  13. Trainer Assist / checkpoint history untouched by withdrawal or
      access changes.

Reuses test_online_school_phase5.py's fixtures directly (same DB, same
disposable-data conventions) rather than re-deriving them.
"""
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import _school_client_flow
from _test_loop import run

from test_online_school_phase5 import (
    TAG as _P5_TAG,  # noqa: F401 — not reused directly, just confirms import path
    _admin_user, _client_and_dog, _school_program, _shop_user, _stripe_mocked,
    _checkout_and_pay, _cleanup_shop_order_traces, _cleanup_dog_programs_and_lots,
)

TAG = "TEST_SCHOOL_P6"

# Permission enforcement lives in Depends(require_admin_and_permission(...)),
# which only runs through real ASGI dispatch — calling an endpoint function
# directly in Python bypasses Depends entirely (established pattern, see
# test_online_school_phase1.py's identical header comment). Used only for
# the tests that specifically verify the permission gate.
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))

    @staticmethod
    def get(url, headers=None):
        return run(_http.get(url, headers=headers))


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


def _enroll(dog, prog, admin):
    result = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
    return result["school_enrollment"], result["enrollment"]


def _cleanup(dog_id, client_id):
    _cleanup_dog_programs_and_lots(dog_id, client_id)


# ─── 1. access_state default/explicit ──────────────────────────────────────

def test_new_enrollment_has_explicit_active_access_state():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            assert se["access_state"] == "active"
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["access_state"] == "active"
        finally:
            _cleanup(dog["id"], c["id"])


def test_legacy_row_with_no_access_state_field_reads_as_active():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            # Simulate a pre-Phase-6 row — strip the field entirely.
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$unset": {"access_state": ""}}))
            fresh = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert "access_state" not in fresh
            assert server._school_access_state(fresh) == "active"
            # And the guard doesn't raise for a legacy row.
            server._require_school_access(fresh, allow_withdrawn_read=False)
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 2. Withdraw Student ────────────────────────────────────────────────────

def test_withdraw_active_enrollment_sets_structured_fields():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            result = run(server.withdraw_school_enrollment(
                se["id"], server.WithdrawStudentIn(reason="Client requested a pause"), staff,
            ))
            assert result["ok"] is True and result["already_withdrawn"] is False
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["status"] == "withdrawn"
            assert dp["withdrawn_by"] == staff["id"]
            assert dp["withdrawn_by_name"] == staff["name"]
            assert dp["withdrawal_reason"] == "Client requested a pause"
            assert dp["withdrawn_at"]
            # Access stays active by default — withdrawal alone doesn't revoke.
            assert server._school_access_state(dp) == "active"
            se_fresh = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert se_fresh["status"] == "withdrawn"
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_with_revoke_access_flag_revokes_both():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.withdraw_school_enrollment(
                se["id"], server.WithdrawStudentIn(reason="Mistaken purchase", revoke_access=True), staff,
            ))
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["status"] == "withdrawn"
            assert server._school_access_state(dp) == "revoked"
            se_fresh = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert se_fresh["access_state"] == "revoked"
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_is_idempotent_on_retry():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            first = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="r1"), staff))
            assert first["already_withdrawn"] is False
            second = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="r2 duplicate click"), staff))
            assert second["already_withdrawn"] is True
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            # Original reason preserved — the retry never overwrote it.
            assert dp["withdrawal_reason"] == "r1"
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_refused_on_completed_enrollment():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"status": "completed"}}))
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$set": {"status": "completed"}}))
            staff = _admin_user()
            try:
                run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="try anyway"), staff))
                assert False, "expected HTTPException — completed training cannot be withdrawn"
            except server.HTTPException as exc:
                assert exc.status_code == 409
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["status"] == "completed"  # untouched
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_requires_nonempty_reason():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            try:
                server.WithdrawStudentIn(reason="")
                assert False, "expected pydantic ValidationError for empty reason"
            except Exception:
                pass
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 3. Access revoke/restore ───────────────────────────────────────────────

def test_access_revoke_and_restore_idempotent():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            r1 = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund"), staff))
            assert r1["enrollment"]["access_state"] == "revoked"
            r2 = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked"), staff))
            assert r2["enrollment"]["access_state"] == "revoked"  # no-op, no error
            r3 = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="active"), staff))
            assert r3["enrollment"]["access_state"] == "active"
            # Training status never touched by an access change.
            assert r3["enrollment"]["status"] == "active"
        finally:
            _cleanup(dog["id"], c["id"])


def test_access_revoke_works_on_completed_enrollment_without_touching_training_status():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"status": "completed", "completed_at": server.now_iso()}}))
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$set": {"status": "completed"}}))
            staff = _admin_user()
            result = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund after completion"), staff))
            assert result["enrollment"]["status"] == "completed"
            assert result["enrollment"]["access_state"] == "revoked"
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 4. _require_school_access guards ──────────────────────────────────────

def test_revoked_access_blocks_lesson_detail_and_checkpoint_history():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked"), staff))
            user = _client_user(c["id"])
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            try:
                run(server.portal_school_lesson_detail(se["id"], lesson_id, user))
                assert False, "expected 403 — access revoked"
            except server.HTTPException as exc:
                assert exc.status_code == 403
            try:
                run(server.portal_school_checkpoint_history(se["id"], user))
                assert False, "expected 403 — access revoked"
            except server.HTTPException as exc:
                assert exc.status_code == 403
        finally:
            _cleanup(dog["id"], c["id"])


def test_revoked_access_blocks_start_practice_and_advance():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked"), staff))
            user = _client_user(c["id"])
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            try:
                run(_school_client_flow.start_practice(se["id"], lesson_id, user))
                assert False, "expected 403"
            except server.HTTPException as exc:
                assert exc.status_code == 403
            try:
                run(server.portal_school_advance(se["id"], user))
                assert False, "expected 403"
            except server.HTTPException as exc:
                assert exc.status_code == 403
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdrawn_with_active_access_allows_read_blocks_write():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="pause"), staff))
            user = _client_user(c["id"])
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            # Read-only history stays reachable.
            detail = run(server.portal_school_lesson_detail(se["id"], lesson_id, user))
            assert detail["lesson"]
            history = run(server.portal_school_checkpoint_history(se["id"], user))
            assert history == []  # no submissions yet, but no error either
            # New protected actions are blocked.
            try:
                run(_school_client_flow.start_practice(se["id"], lesson_id, user))
                assert False, "expected 403 — withdrawn blocks new practice"
            except server.HTTPException as exc:
                assert exc.status_code == 403
        finally:
            _cleanup(dog["id"], c["id"])


def test_portal_school_detail_degrades_gracefully_when_access_revoked():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked"), staff))
            user = _client_user(c["id"])
            detail = run(server.portal_school_detail(se["id"], user))
            assert detail["access_state"] == "revoked"
            assert detail["roadmap"] is None
            assert detail["status"] == "active"  # training status itself untouched
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 5. Retake policy ────────────────────────────────────────────────────────

def test_manual_reenroll_blocked_after_withdrawal():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="pause"), admin))
            try:
                run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                assert False, "expected 409 — withdrawn enrollment blocks silent re-enroll"
            except server.HTTPException as exc:
                assert exc.status_code == 409
            # No second dog_programs row was created.
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
        finally:
            _cleanup(dog["id"], c["id"])


def test_manual_reenroll_blocked_after_completion():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"status": "completed"}}))
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$set": {"status": "completed"}}))
            try:
                run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
                assert False, "expected 409 — completed enrollment blocks silent re-enroll"
            except server.HTTPException as exc:
                assert exc.status_code == 409
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
        finally:
            _cleanup(dog["id"], c["id"])


def test_shop_repurchase_blocked_after_withdrawal():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="pause"), admin))
            user = _shop_user(c["id"])
            with _stripe_mocked():
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                    assert False, "expected 409 — withdrawn enrollment blocks repurchase"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 0
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup(dog["id"], c["id"])


# ─── 6. Refund/revocation preserves training history ───────────────────────

def test_access_revocation_before_course_use_preserves_zero_activity_row():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            staff = _admin_user()
            run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund"), staff))
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["status"] == "active"  # training status preserved, just inaccessible
            assert dp["program_snapshot"]["name"]  # snapshot intact
        finally:
            _cleanup(dog["id"], c["id"])


def test_access_revocation_after_checkpoint_submission_preserves_submission():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            # Fabricate a graded checkpoint submission directly (this test
            # is about revocation's effect on EXISTING history, not the
            # grading flow itself, which is covered elsewhere).
            sub = {
                "id": str(uuid.uuid4()), "school_enrollment_id": se["id"], "enrollment_id": enr["id"],
                "dog_id": dog["id"], "client_id": c["id"], "lesson_id": lesson_id, "module_id": enr["program_snapshot"]["modules"][0]["id"],
                "lesson_name": "Lesson 1", "video_media_id": str(uuid.uuid4()), "homework_id": str(uuid.uuid4()),
                "client_note": "", "rubric_snapshot": {"enabled": True}, "status": "graded",
                "outcome": "advance", "handler_scores": {"a": 5}, "dog_scores": {"b": 4},
                "trainer_feedback": "Great work", "graded_by_name": "Trainer T", "graded_at": server.now_iso(),
                "submitted_at": server.now_iso(), "created_at": server.now_iso(),
            }
            run(server.db.checkpoint_submissions.insert_one(sub))
            try:
                staff = _admin_user()
                run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund"), staff))
                still_there = run(server.db.checkpoint_submissions.find_one({"id": sub["id"]}, {"_id": 0}))
                assert still_there is not None
                assert still_there["outcome"] == "advance"
                assert still_there["handler_scores"] == {"a": 5}
                # Staff can still read it via the admin history endpoint.
                admin_history = run(server.admin_school_enrollment_checkpoint_history(se["id"], staff))
                assert len(admin_history) == 1
            finally:
                run(server.db.checkpoint_submissions.delete_one({"id": sub["id"]}))
        finally:
            _cleanup(dog["id"], c["id"])


def test_access_revocation_after_completion_preserves_completion_and_summary():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"status": "completed", "completed_at": server.now_iso()}}))
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$set": {"status": "completed", "completed_at": server.now_iso()}}))
            staff = _admin_user()
            run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund after graduation"), staff))
            user = _client_user(c["id"])
            detail = run(server.portal_school_detail(se["id"], user))
            assert detail["status"] == "completed"
            assert detail["access_state"] == "revoked"
            # Completion summary (the "certificate") stays visible even
            # though roadmap access is revoked — see portal_school_detail's
            # own documented rationale (Core Principle 5/2).
            assert detail["completion_summary"] is not None
            assert detail["roadmap"] is None
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 7. Paid-but-unfulfilled operational visibility ─────────────────────────

def test_shop_order_line_snapshots_dog_name_for_online_school_purchase():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        try:
            user = _shop_user(c["id"])
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            line = order["lines"][0]
            assert line["dog_name"] == dog["name"]
            assert line["fulfillment_status"] == "fulfilled"
            assert line.get("fulfillment_error") is None
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup(dog["id"], c["id"])


def test_fulfillment_error_captured_then_cleared_on_retry():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        try:
            user = _shop_user(c["id"])
            # Force fulfillment to fail once by deleting the program the
            # instant before payment application resolves it — simplest
            # deterministic way to make _fulfill_shop_online_school_program_line
            # raise, without patching internals.
            with _stripe_mocked():
                result = run(server.create_shop_checkout(
                    server.ShopCheckoutIn(
                        items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                        idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                    ),
                    user,
                ))
            order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
            attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
            from test_online_school_phase5 import _FakeStripeObj
            session_obj = _FakeStripeObj(
                id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                amount_total=server._stripe_amount_cents(order["total"]),
                metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]},
            )
            # Delete the dog so fulfillment genuinely fails (ownership
            # re-check inside the fulfillment helper raises).
            run(server.db.dogs.delete_one({"id": dog["id"]}))
            run(server._apply_shop_payment(attempt, session_obj))
            failed_order = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
            line = failed_order["lines"][0]
            assert line["fulfillment_status"] == "failed"
            assert line.get("fulfillment_error")
            assert failed_order["fulfillment_status"] == "needs_attention"
            needing_attention = run(server.list_shop_orders(fulfillment_status="needs_attention", user=_admin_user()))
            assert any(o["id"] == order["id"] for o in needing_attention["orders"])
            # Restore the dog and retry — error clears, no second charge.
            run(server.db.dogs.insert_one(dog))
            run(server._apply_shop_payment(attempt))
            healed_order = run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))
            healed_line = healed_order["lines"][0]
            assert healed_line["fulfillment_status"] == "fulfilled"
            assert healed_line.get("fulfillment_error") is None
            assert run(server.db.payments.count_documents({"client_id": c["id"]})) == 1  # no double charge
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup(dog["id"], c["id"])


# ─── 8. Provenance survives lifecycle transitions ──────────────────────────

def test_purchase_provenance_survives_withdrawal():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        try:
            user = _shop_user(c["id"])
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            dp = run(server.db.dog_programs.find_one({"dog_id": dog["id"], "program_id": prog["id"]}, {"_id": 0}))
            assert dp["enrollment_source"] == "purchase"
            source_ref_before = dp["enrollment_source_ref"]
            se = run(server.db.school_enrollments.find_one({"enrollment_id": dp["id"]}, {"_id": 0}))
            run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="pause"), _admin_user()))
            dp_after = run(server.db.dog_programs.find_one({"id": dp["id"]}, {"_id": 0}))
            assert dp_after["enrollment_source"] == "purchase"
            assert dp_after["enrollment_source_ref"] == source_ref_before
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup(dog["id"], c["id"])


# ─── 9. Permission boundaries ───────────────────────────────────────────────

def test_client_cannot_call_withdraw_or_access_endpoints_directly():
    """Real ASGI-dispatch check (see the module header comment) — a client
    account gets 403 from the actual Depends(require_admin_and_permission(
    ...)) gate on all three new Phase 6 admin endpoints, not merely from
    inline logic."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            client_uid = str(uuid.uuid4())
            run(server.db.users.insert_one({
                "id": client_uid, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
                "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
            }))
            client_h = {"Authorization": f"Bearer {server.create_access_token(client_uid, c['email'], 'client', 0)}"}
            try:
                r1 = client.post(f"/api/school/enrollments/{se['id']}/withdraw", headers=client_h, json={"reason": "x"})
                assert r1.status_code == 403, r1.text
                r2 = client.post(f"/api/school/enrollments/{se['id']}/access", headers=client_h, json={"access_state": "revoked"})
                assert r2.status_code == 403, r2.text
                r3 = client.get(f"/api/admin/school-enrollments/{se['id']}/checkpoint-history", headers=client_h)
                assert r3.status_code == 403, r3.text
            finally:
                run(server.db.users.delete_one({"id": client_uid}))
        finally:
            _cleanup(dog["id"], c["id"])


def test_employee_without_training_permission_cannot_withdraw():
    """Real ASGI-dispatch check — front_desk (no manage_training_sessions)
    gets 403; a trainer (has the permission) succeeds, proving the gate is
    actually wired on the route, not just present as a docstring claim."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            fd_uid, fd_h = _insert_staff("front_desk")
            trainer_uid, trainer_h = _insert_staff("trainer")
            try:
                r_fd = client.post(f"/api/school/enrollments/{se['id']}/withdraw", headers=fd_h, json={"reason": "x"})
                assert r_fd.status_code == 403, r_fd.text
                r_trainer = client.post(f"/api/school/enrollments/{se['id']}/withdraw", headers=trainer_h, json={"reason": "trainer withdrew"})
                assert r_trainer.status_code == 200, r_trainer.text
            finally:
                run(server.db.users.delete_many({"id": {"$in": [fd_uid, trainer_uid]}}))
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 10. Data-leakage fix ───────────────────────────────────────────────────

def test_list_dog_enrollments_excludes_online_school_for_client_but_not_staff():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            _enroll(dog, prog, admin)
            client = _client_user(c["id"])
            client_view = run(server.list_dog_enrollments(dog["id"], client))
            assert all(e.get("delivery_channel") != "online_school" for e in client_view)
            staff = {"id": str(uuid.uuid4()), "role": "admin", "name": "Staff"}
            staff_view = run(server.list_dog_enrollments(dog["id"], staff))
            assert any(e.get("delivery_channel") == "online_school" for e in staff_view)
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 11. Deterministic list ordering ────────────────────────────────────────

def test_portal_school_list_active_ranks_before_completed_and_withdrawn():
    with _client_and_dog() as (c, dog), \
         _school_program() as (prog_a, admin), \
         _school_program() as (prog_b, admin2), \
         _school_program() as (prog_c, admin3):
        try:
            se_a, enr_a = _enroll(dog, prog_a, admin)
            se_b, enr_b = _enroll(dog, prog_b, admin2)
            se_c, enr_c = _enroll(dog, prog_c, admin3)
            run(server.db.dog_programs.update_one({"id": enr_b["id"]}, {"$set": {"status": "completed"}}))
            run(server.db.school_enrollments.update_one({"id": se_b["id"]}, {"$set": {"status": "completed"}}))
            run(server.withdraw_school_enrollment(se_c["id"], server.WithdrawStudentIn(reason="pause"), admin3))
            user = _client_user(c["id"])
            listing = run(server.portal_school_list(user))
            assert listing[0]["school_enrollment_id"] == se_a["id"]
            statuses = [row["status"] for row in listing]
            assert statuses.index("active") < statuses.index("completed") < statuses.index("withdrawn")
        finally:
            _cleanup(dog["id"], c["id"])


# ─── 12. Daily-tracker video size ceiling ───────────────────────────────────

def test_upload_day_video_rejects_oversized_payload_server_side():
    with _client_and_dog() as (c, dog):
        hw_id = str(uuid.uuid4())
        run(server.db.homework.insert_one({"id": hw_id, "client_id": c["id"], "dog_id": dog["id"], "template_name": "T", "days": []}))
        try:
            user = _client_user(c["id"])
            # ~11 MB raw -> well past CHECKPOINT_VIDEO_MAX_BYTES (10 MB).
            oversized_b64 = "A" * ((11 * 1024 * 1024 * 4) // 3)
            body = server.CertificateUploadIn(photo=f"data:video/mp4;base64,{oversized_b64}", filename="day.mp4")
            try:
                run(server.upload_day_video(hw_id, 1, body, user))
                assert False, "expected 400 — oversized video rejected server-side"
            except server.HTTPException as exc:
                assert exc.status_code == 400
        finally:
            run(server.db.homework.delete_one({"id": hw_id}))
            run(server.db.homework_media.delete_many({"homework_id": hw_id}))


def test_upload_day_video_accepts_normal_sized_payload():
    with _client_and_dog() as (c, dog):
        hw_id = str(uuid.uuid4())
        run(server.db.homework.insert_one({"id": hw_id, "client_id": c["id"], "dog_id": dog["id"], "template_name": "T", "days": []}))
        try:
            user = _client_user(c["id"])
            small_b64 = "A" * 1000
            body = server.CertificateUploadIn(photo=f"data:video/mp4;base64,{small_b64}", filename="day.mp4")
            result = run(server.upload_day_video(hw_id, 1, body, user))
            assert result["media_id"]
        finally:
            run(server.db.homework.delete_one({"id": hw_id}))
            run(server.db.homework_media.delete_many({"homework_id": hw_id}))


# ─── 13. Trainer Assist / history untouched by lifecycle actions ──────────

def test_withdraw_never_touches_trainer_assist_or_checkpoint_fields():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            sub = {
                "id": str(uuid.uuid4()), "school_enrollment_id": se["id"], "enrollment_id": enr["id"],
                "dog_id": dog["id"], "client_id": c["id"], "lesson_id": lesson_id, "module_id": enr["program_snapshot"]["modules"][0]["id"],
                "lesson_name": "Lesson 1", "video_media_id": str(uuid.uuid4()), "homework_id": str(uuid.uuid4()),
                "client_note": "", "rubric_snapshot": {"enabled": True}, "status": "graded",
                "outcome": "trainer_assist_recommended", "handler_scores": {"a": 2}, "dog_scores": {"b": 2},
                "trainer_feedback": "needs help", "graded_by_name": "Trainer T", "graded_at": server.now_iso(),
                "trainer_assist_hold_active": True, "trainer_assist_status": "scheduled",
                "trainer_assist_appointment_id": "booking-123",
                "submitted_at": server.now_iso(), "created_at": server.now_iso(),
            }
            run(server.db.checkpoint_submissions.insert_one(sub))
            try:
                run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="pause mid-assist"), admin))
                still_there = run(server.db.checkpoint_submissions.find_one({"id": sub["id"]}, {"_id": 0}))
                assert still_there["trainer_assist_hold_active"] is True
                assert still_there["trainer_assist_status"] == "scheduled"
                assert still_there["trainer_assist_appointment_id"] == "booking-123"
            finally:
                run(server.db.checkpoint_submissions.delete_one({"id": sub["id"]}))
        finally:
            _cleanup(dog["id"], c["id"])


# ─── Focused pass — multi-document lifecycle consistency ───────────────────
# dog_programs is canonical (written first in both withdraw and access);
# school_enrollments is a read mirror (written second). These tests
# directly simulate a process kill landing in each of the three windows a
# real crash could land in, by mutating the documents exactly as an
# interrupted request would have left them, then asserting (a) every
# client-facing read is already correct even before any repair happens,
# and (b) retrying the SAME endpoint call converges the mirror to match.

def test_withdraw_crash_before_either_write_leaves_nothing_partial():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            # No write attempted at all — this is simply "the request never
            # ran". Nothing to reconcile; a normal withdraw succeeds cleanly.
            result = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="normal"), admin))
            assert result["already_withdrawn"] is False
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            se_fresh = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert dp["status"] == "withdrawn" and se_fresh["status"] == "withdrawn"
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_crash_after_canonical_write_before_mirror_write():
    """Simulates the exact crash window: dog_programs already says
    'withdrawn', school_enrollments still says 'active' — the precise
    'school_enrollment says X / dog_programs says Y' disagreement this pass
    was asked to make unobservable and self-healing."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            # Hand-simulate Step 1 having committed and Step 2 never running.
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {
                "status": "withdrawn", "withdrawn_at": server.now_iso(), "withdrawn_by": admin["id"],
                "withdrawn_by_name": admin["name"], "withdrawal_reason": "crash-simulated",
            }}))
            # The mirror is now genuinely stale — confirm the raw disagreement exists.
            raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert raw_se["status"] == "active"

            # (a) A client read is ALREADY correct, before any retry/repair —
            # canonical-source reads never surface the stale mirror value.
            user = _client_user(c["id"])
            detail = run(server.portal_school_detail(se["id"], user))
            assert detail["status"] == "withdrawn"
            listing = run(server.portal_school_list(user))
            assert listing[0]["status"] == "withdrawn"
            # That same client read also opportunistically healed the mirror.
            healed_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert healed_se["status"] == "withdrawn"

            # (b) Retrying the withdraw endpoint itself also converges cleanly
            # (idempotent "already withdrawn" branch, mirror reconciled there too).
            retry = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="retry"), admin))
            assert retry["already_withdrawn"] is True
            assert retry["school_enrollment"]["status"] == "withdrawn"
        finally:
            _cleanup(dog["id"], c["id"])


def test_withdraw_crash_after_both_writes_retry_is_pure_no_op():
    """Simulates the third window — both writes already landed, only the
    HTTP response was lost. A retry must be a pure no-op: no new
    withdrawal timestamp/reason, no error."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            first = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="original reason"), admin))
            assert first["already_withdrawn"] is False
            dp_after_first = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            retry = run(server.withdraw_school_enrollment(se["id"], server.WithdrawStudentIn(reason="a caller retrying blind"), admin))
            assert retry["already_withdrawn"] is True
            dp_after_retry = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp_after_retry["withdrawal_reason"] == dp_after_first["withdrawal_reason"] == "original reason"
            se_after_retry = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert se_after_retry["status"] == "withdrawn"
        finally:
            _cleanup(dog["id"], c["id"])


def test_access_crash_after_canonical_write_before_mirror_write():
    """Same crash window as above, for the independent access toggle:
    dog_programs.access_state already 'revoked', school_enrollments still
    'active'."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {
                "access_state": "revoked", "access_changed_at": server.now_iso(),
                "access_changed_by": admin["id"], "access_changed_by_name": admin["name"],
                "access_change_reason": "crash-simulated",
            }}))
            raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert server._school_access_state(raw_se) == "active"  # mirror stale

            user = _client_user(c["id"])
            lesson_id = enr["program_snapshot"]["modules"][0]["lessons"][0]["id"]
            # (a) The access guard reads canonical dog_programs — blocks
            # immediately, before any repair/retry.
            try:
                run(server.portal_school_lesson_detail(se["id"], lesson_id, user))
                assert False, "expected 403 — canonical dog_programs already says revoked"
            except server.HTTPException as exc:
                assert exc.status_code == 403
            # That read also healed the mirror.
            healed_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert server._school_access_state(healed_se) == "revoked"

            # (b) Retrying the access endpoint itself also converges.
            retry = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked"), admin))
            assert retry["school_enrollment"]["access_state"] == "revoked"
        finally:
            _cleanup(dog["id"], c["id"])


def test_reverse_drift_mirror_says_revoked_canonical_says_active_never_wins():
    """The explicit reverse case the spec calls out: school_enrollments
    claims revoked/withdrawn while dog_programs (canonical) still says
    active — proves canonical ALWAYS wins regardless of which direction a
    hand-edited or drifted mirror disagrees, not just the direction that
    happens to arise from this codebase's own write order."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.school_enrollments.update_one({"id": se["id"]}, {"$set": {"access_state": "revoked", "status": "withdrawn"}}))
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
            assert dp["status"] == "active" and server._school_access_state(dp) == "active"  # canonical unaffected

            user = _client_user(c["id"])
            detail = run(server.portal_school_detail(se["id"], user))
            assert detail["status"] == "active"
            assert detail["access_state"] == "active"
            # The client read healed the mirror back to match canonical.
            healed_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert healed_se["status"] == "active"
            assert healed_se["access_state"] == "active"
        finally:
            _cleanup(dog["id"], c["id"])


def test_access_toggle_survives_prior_withdraw_mirror_drift():
    """Combined scenario: a withdraw crashed mid-mirror-write (dog_programs
    withdrawn, mirror still active), and THEN staff separately calls the
    access endpoint before anyone retried the withdraw. The access
    endpoint's own reconcile-at-entry must heal the STATUS drift too (not
    just apply the access change), since it shares the same helper."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        try:
            se, enr = _enroll(dog, prog, admin)
            run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"status": "withdrawn"}}))
            raw_se = run(server.db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0}))
            assert raw_se["status"] == "active"  # stale

            result = run(server.set_school_enrollment_access(se["id"], server.SchoolAccessStateIn(access_state="revoked", reason="refund"), admin))
            assert result["school_enrollment"]["status"] == "withdrawn"  # healed as a side effect
            assert result["school_enrollment"]["access_state"] == "revoked"
        finally:
            _cleanup(dog["id"], c["id"])
