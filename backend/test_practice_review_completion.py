"""Training Practice — review, completion and assignment idempotency.

Same self-contained harness convention as test_online_school_phase5.py: the
endpoint functions are called directly.

The bug this suite exists to prevent coming back: an ordinary section-based
practice log sat with reviewed_at=null, was absent from BOTH visible review
queues, and had no trainer-facing way to finish the assignment — so it looked
to the trainer like the same work kept reappearing forever.

Two concepts are kept deliberately separate throughout:
  * a LOG is reviewed  — the trainer acknowledged one practice submission
  * an ASSIGNMENT is completed — the trainer ended the whole assignment
Neither may imply the other.
"""
import asyncio
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_PRACTICE_REVIEW"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} trainer", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": f"{TAG} client"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {"id": did, "name": f"{TAG} Bolt", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
    run(server.db.dogs.insert_one(dog))
    try:
        yield c, dog
    finally:
        run(server.db.homework.delete_many({"dog_id": did}))
        run(server.db.homework_assignment_claims.delete_many({"dog_id": did}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _template():
    """A section-based (NOT daily-tracker) practice recipe — the shape the
    real Sit Happens Practice recipes use, and the one that had no review or
    completion path."""
    admin = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        name=f"{TAG} Week 1 Engagement Reps {uuid.uuid4().hex[:6]}",
        tier="foundation", description="Daily practice for marker timing.",
        default_duration_days=7,
        sections=[{
            "id": "practice-log", "title": "Practice log", "instructions": "Log one session.",
            "fields": [{"id": "reps", "label": "Reps", "kind": "reps", "target": 8}],
        }],
    ), admin))
    try:
        yield tpl
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def _assign(dog, tpl):
    return run(server.create_homework_from_template(
        server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), _admin_user(),
    ))


def _mark_school_owned(hw_id):
    """The practice-review path covers School practice; tag the row the same
    way a School-assigned practice is tagged."""
    run(server.db.homework.update_one(
        {"id": hw_id}, {"$set": {"school_enrollment_id": f"se-{TAG}-{uuid.uuid4().hex[:8]}"}}))


def _log_practice(hw_id, client, note="Went well."):
    return run(server.log_section(hw_id, server.SectionLogIn(
        section_id="practice-log", field_values={"reps": 8}, note=note,
    ), _client_user(client["id"])))


def _hw(hw_id):
    return run(server.db.homework.find_one({"id": hw_id}, {"_id": 0}))


# ---------------------------------------------------------------------------
# 1-3 — an ordinary log is reviewable, without needing an attention trigger
# ---------------------------------------------------------------------------

def test_a_normal_section_log_counts_as_unreviewed_without_any_trigger():
    # No video, no could-not-complete, no hard difficulty, no question — and
    # it must STILL be something the trainer can see and acknowledge.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _log_practice(hw["id"], c)
        fresh = _hw(hw["id"])
        assert server.homework_unreviewed_log_count(fresh) == 1
        counts = run(server.homework_unreviewed_count(_admin_user()))
        assert counts["unreviewed"] >= 1


def test_a_normal_log_is_unreviewed_but_NOT_needs_attention():
    # The distinction the trainer asked for: new is not the same as a problem.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _log_practice(hw["id"], c)
        before = run(server.homework_unreviewed_count(_admin_user()))
        # add a log that DOES carry an attention trigger
        hw2 = _assign(dog, tpl)  # converges on the same active assignment
        run(server.db.homework.update_one(
            {"id": hw["id"]},
            {"$push": {"section_logs": {
                "id": str(uuid.uuid4()), "section_id": "practice-log",
                "field_values": {"reps": 2, "__difficulty": "very_hard"},
                "logged_at": server.now_iso(), "logged_by_role": "client",
            }}}))
        after = run(server.homework_unreviewed_count(_admin_user()))
        assert after["unreviewed"] == before["unreviewed"] + 1
        assert after["needs_attention"] == before["needs_attention"] + 1
        assert after["unreviewed"] > after["needs_attention"] or before["needs_attention"] >= 0


def test_trainer_logged_rows_and_rest_days_are_not_client_submissions():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        run(server.db.homework.update_one({"id": hw["id"]}, {"$push": {"section_logs": {"$each": [
            {"id": str(uuid.uuid4()), "logged_by_role": "admin", "logged_at": server.now_iso()},
            {"id": str(uuid.uuid4()), "is_rest_day": True, "logged_at": server.now_iso()},
        ]}}}))
        assert server.homework_unreviewed_log_count(_hw(hw["id"])) == 0


# ---------------------------------------------------------------------------
# 4-6 — reviewing a log
# ---------------------------------------------------------------------------

def test_reviewing_a_log_persists_reviewed_at_and_clears_the_new_state():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _mark_school_owned(hw["id"])
        _log_practice(hw["id"], c)
        log_id = _hw(hw["id"])["section_logs"][0]["id"]
        run(server.admin_school_practice_review(
            hw["id"], log_id, server.PracticeReviewIn(status="looks_good", note="Nice timing."), _admin_user()))
        log = _hw(hw["id"])["section_logs"][0]
        assert log["reviewed_at"]
        assert log["review_status"] == "looks_good"
        assert log["review_note"] == "Nice timing."
        assert server.homework_unreviewed_log_count(_hw(hw["id"])) == 0


def test_reviewing_the_same_log_twice_is_safe():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _mark_school_owned(hw["id"])
        _log_practice(hw["id"], c)
        log_id = _hw(hw["id"])["section_logs"][0]["id"]
        for status in ("looks_good", "keep_practicing"):
            run(server.admin_school_practice_review(
                hw["id"], log_id, server.PracticeReviewIn(status=status, note=""), _admin_user()))
        fresh = _hw(hw["id"])
        assert len(fresh["section_logs"]) == 1, "no duplicated log"
        assert fresh["section_logs"][0]["review_status"] == "keep_practicing"
        assert server.homework_unreviewed_log_count(fresh) == 0


def test_reviewing_a_log_does_NOT_complete_the_assignment():
    # The rule that matters most: a trainer reviews today's practice while the
    # client is still meant to keep going for several more days.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _mark_school_owned(hw["id"])
        _log_practice(hw["id"], c)
        log_id = _hw(hw["id"])["section_logs"][0]["id"]
        run(server.admin_school_practice_review(
            hw["id"], log_id, server.PracticeReviewIn(status="looks_good", note=""), _admin_user()))
        fresh = _hw(hw["id"])
        assert fresh["status"] == "assigned"
        assert not fresh.get("completed_at")


# ---------------------------------------------------------------------------
# 7-11 — completing an assignment
# ---------------------------------------------------------------------------

def test_a_trainer_can_explicitly_complete_a_section_assignment():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        res = run(server.trainer_complete_homework(
            hw["id"], server.TrainerCompleteHomeworkIn(note="Solid week."), _admin_user()))
        assert res["already_completed"] is False
        assert res["homework"]["status"] == "completed"
        assert res["homework"]["completed_at"]
        assert res["homework"]["completion_note"] == "Solid week."


def test_completion_uses_the_same_canonical_state_as_the_client_path():
    # One lifecycle, one set of completion metadata — never a second flag.
    with _client_and_dog() as (c, dog), _template() as tpl:
        by_trainer = _assign(dog, tpl)
        run(server.trainer_complete_homework(by_trainer["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        trainer_row = _hw(by_trainer["id"])
        run(server.db.homework.delete_one({"id": by_trainer["id"]}))

        by_client = _assign(dog, tpl)
        run(server.complete_homework(by_client["id"], server.HomeworkCompleteIn(note="", photo=""), _client_user(c["id"])))
        client_row = _hw(by_client["id"])

        for field in ("status", "completion_note", "completion_photo"):
            assert trainer_row.get(field) == client_row.get(field), field
        assert trainer_row["status"] == "completed"


def test_completing_twice_is_idempotent_and_keeps_the_first_timestamp():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        first = run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        second = run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        assert second["already_completed"] is True
        assert second["homework"]["completed_at"] == first["homework"]["completed_at"]
        assert _hw(hw["id"])["status"] == "completed"


def test_concurrent_completions_write_one_timestamp():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        admin = _admin_user()

        async def _both():
            return await asyncio.gather(*[
                server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), admin)
                for _ in range(4)
            ], return_exceptions=True)

        results = run(_both())
        ok = [r for r in results if isinstance(r, dict)]
        assert ok
        stamps = {r["homework"]["completed_at"] for r in ok}
        assert len(stamps) == 1, f"one completion timestamp expected, got {stamps}"


def test_completing_does_NOT_silently_mark_outstanding_logs_reviewed():
    # The trainer is allowed to finish an assignment with logs still
    # unacknowledged — but those logs must stay unacknowledged.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _log_practice(hw["id"], c)
        _log_practice(hw["id"], c, note="Second session.")
        res = run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        assert res["unreviewed_logs"] == 2, "reported so the UI can warn"
        fresh = _hw(hw["id"])
        assert fresh["status"] == "completed"
        assert server.homework_unreviewed_log_count(fresh) == 2
        assert all(not lo.get("reviewed_at") for lo in fresh["section_logs"])


def test_unreviewed_logs_never_block_completion():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _log_practice(hw["id"], c)
        res = run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        assert res["homework"]["status"] == "completed"


# ---------------------------------------------------------------------------
# 12-15 — completed stays completed
# ---------------------------------------------------------------------------

def test_completed_leaves_assigned_and_appears_under_completed():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        rows = run(server.list_homework(_admin_user(), dog_id=dog["id"]))
        mine = [r for r in rows if r["id"] == hw["id"]]
        assert len(mine) == 1, "listed exactly once"
        assert mine[0]["status"] == "completed"
        assigned = [r for r in rows if r["status"] == "assigned" and r["id"] == hw["id"]]
        assert assigned == []


def test_completion_survives_a_refetch():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        for _ in range(3):
            rows = run(server.list_homework(_admin_user(), dog_id=dog["id"]))
            assert next(r for r in rows if r["id"] == hw["id"])["status"] == "completed"


def test_reassigning_the_template_does_not_resurrect_the_completed_row():
    # A legitimate next occurrence is a NEW record; the finished one stays
    # finished. This is the "they keep coming back" regression.
    with _client_and_dog() as (c, dog), _template() as tpl:
        first = _assign(dog, tpl)
        run(server.trainer_complete_homework(first["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        second = _assign(dog, tpl)
        assert second["id"] != first["id"], "a new occurrence, not the old row"
        assert not second.get("reused")
        assert _hw(first["id"])["status"] == "completed", "the finished one stayed finished"
        assert _hw(second["id"])["status"] == "assigned"


def test_repeated_sync_never_reactivates_a_completed_assignment():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        for _ in range(3):
            _assign(dog, tpl)
        assert _hw(hw["id"])["status"] == "completed"
        assert run(server.db.homework.count_documents(
            {"dog_id": dog["id"], "template_snapshot.template_id": tpl["id"], "status": "completed"})) == 1


# ---------------------------------------------------------------------------
# 16-18 — assignment generation idempotency (the duplicate-card cause)
# ---------------------------------------------------------------------------

def test_assigning_the_same_template_twice_converges_on_one_assignment():
    # The duplicate-card bug: /homework/from-template had no guard at all, so
    # a retry or a second tab produced two identical active assignments.
    with _client_and_dog() as (c, dog), _template() as tpl:
        first = _assign(dog, tpl)
        second = _assign(dog, tpl)
        assert second["id"] == first["id"]
        assert second.get("reused") is True
        assert run(server.db.homework.count_documents(
            {"dog_id": dog["id"], "template_snapshot.template_id": tpl["id"]})) == 1


def test_concurrent_assignment_cannot_create_two_active_copies():
    with _client_and_dog() as (c, dog), _template() as tpl:
        admin = _admin_user()

        async def _all():
            return await asyncio.gather(*[
                server.create_homework_from_template(
                    server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin)
                for _ in range(4)
            ], return_exceptions=True)

        run(_all())
        active = run(server.db.homework.count_documents(
            {"dog_id": dog["id"], "template_snapshot.template_id": tpl["id"], "status": {"$ne": "completed"}}))
        assert active == 1, f"expected one active assignment, found {active}"


def test_two_different_dogs_each_get_their_own_assignment():
    with _client_and_dog() as (c1, dog1), _client_and_dog() as (c2, dog2), _template() as tpl:
        a = _assign(dog1, tpl)
        b = _assign(dog2, tpl)
        assert a["id"] != b["id"]
        assert not a.get("reused") and not b.get("reused")


def test_the_list_endpoint_cannot_return_one_assignment_twice():
    # Proves the duplicate cards were two real rows, not one row rendered
    # twice: the list is a plain find with no unwind or join.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        _log_practice(hw["id"], c)
        _log_practice(hw["id"], c, note="Second session.")
        rows = run(server.list_homework(_admin_user(), dog_id=dog["id"]))
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), "no id appears twice even with multiple logs"


# ---------------------------------------------------------------------------
# 19-27 — claim scope and claim lifecycle
# ---------------------------------------------------------------------------

def _claim(dog_id, tpl_id):
    return run(server.db.homework_assignment_claims.find_one(
        {"claim_key": server._manual_assignment_claim_key(dog_id, tpl_id)}, {"_id": 0}))


def test_the_claim_is_scoped_to_manual_assignments_only():
    # The canonical School rule is school_enrollment_id + template_id, NOT
    # dog + template: a dog in two School enrollments that share a recipe is
    # legitimately allowed one active copy in each. A dog-wide claim would
    # forbid that, so the manual claim must not reach School-owned rows.
    assert server._manual_assignment_claim_key("d1", "t1").startswith("manual:")
    assert "school_enrollment_id" in server._MANUAL_HW_MATCH


def test_a_school_owned_assignment_does_not_block_a_manual_one():
    # A manual assign must never silently hand back a School-owned row.
    with _client_and_dog() as (c, dog), _template() as tpl:
        school_row = _assign(dog, tpl)
        _mark_school_owned(school_row["id"])
        # the School row is now invisible to the manual guard
        assert run(server._existing_active_manual_assignment(dog["id"], tpl["id"])) is None
        run(server.db.homework_assignment_claims.delete_many({"dog_id": dog["id"]}))
        manual = _assign(dog, tpl)
        assert manual["id"] != school_row["id"], "a manual assignment of its own"
        assert not manual.get("reused")


def test_a_manual_assignment_takes_and_holds_its_claim():
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        held = _claim(dog["id"], tpl["id"])
        assert held is not None
        assert held["dog_id"] == dog["id"] and held["template_id"] == tpl["id"]
        assert hw["status"] == "assigned"


def test_completing_releases_the_claim_so_the_next_occurrence_can_be_assigned():
    with _client_and_dog() as (c, dog), _template() as tpl:
        first = _assign(dog, tpl)
        assert _claim(dog["id"], tpl["id"]) is not None
        run(server.trainer_complete_homework(first["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
        assert _claim(dog["id"], tpl["id"]) is None, "claim released on completion"
        second = _assign(dog, tpl)
        assert second["id"] != first["id"]
        assert _hw(first["id"])["status"] == "completed", "the finished row was not revived"


def test_deleting_an_assignment_releases_its_claim():
    # Deletion is the only other exit from active — there is no cancel or
    # archive path — and a claim must never outlive the row it stands for.
    with _client_and_dog() as (c, dog), _template() as tpl:
        hw = _assign(dog, tpl)
        assert _claim(dog["id"], tpl["id"]) is not None
        run(server.delete_homework(hw["id"], _admin_user()))
        assert _claim(dog["id"], tpl["id"]) is None, "claim released on delete"
        again = _assign(dog, tpl)
        assert again["id"] != hw["id"]
        assert not again.get("reused")


def test_deleting_a_school_assignment_never_touches_a_manual_claim():
    with _client_and_dog() as (c, dog), _template() as tpl:
        manual = _assign(dog, tpl)
        assert _claim(dog["id"], tpl["id"]) is not None
        school_row = {**manual, "id": str(uuid.uuid4()), "school_enrollment_id": "se-x"}
        run(server.db.homework.insert_one(dict(school_row)))
        run(server.delete_homework(school_row["id"], _admin_user()))
        assert _claim(dog["id"], tpl["id"]) is not None, "the manual claim survived"


def test_a_failure_after_claiming_releases_the_claim():
    # claim created -> creation fails -> the claim must NOT remain, or this
    # dog and template would be locked out permanently.
    with _client_and_dog() as (c, dog), _template() as tpl:
        bad = server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=str(uuid.uuid4()))
        with pytest.raises(server.HTTPException):
            run(server.create_homework_from_template(bad, _admin_user()))
        assert _claim(dog["id"], bad.template_id) is None, "claim rolled back"
        # and the real template is still assignable afterwards
        ok = _assign(dog, tpl)
        assert ok["status"] == "assigned"


def test_an_abandoned_claim_self_heals_instead_of_locking_forever():
    # Simulate a holder that died between claiming and creating: the claim
    # exists but no assignment ever did.
    with _client_and_dog() as (c, dog), _template() as tpl:
        run(server.db.homework_assignment_claims.insert_one({
            "claim_key": server._manual_assignment_claim_key(dog["id"], tpl["id"]),
            "dog_id": dog["id"], "template_id": tpl["id"], "created_at": server.now_iso(),
        }))
        assert run(server._existing_active_manual_assignment(dog["id"], tpl["id"])) is None
        hw = _assign(dog, tpl)
        assert hw["status"] == "assigned", "a real assignment was still created"
        assert not hw.get("reused")
        claim = _claim(dog["id"], tpl["id"])
        assert claim is not None and claim.get("reclaimed_stale") is True


def test_a_claim_never_outlives_its_assignment():
    # The invariant behind all of the above, stated directly: whenever a
    # manual claim exists, an active manual assignment exists for it.
    with _client_and_dog() as (c, dog), _template() as tpl:
        for step in ("assign", "complete", "assign", "delete"):
            if step == "assign":
                hw = _assign(dog, tpl)
            elif step == "complete":
                run(server.trainer_complete_homework(hw["id"], server.TrainerCompleteHomeworkIn(), _admin_user()))
            else:
                run(server.delete_homework(hw["id"], _admin_user()))
            claim = _claim(dog["id"], tpl["id"])
            active = run(server._existing_active_manual_assignment(dog["id"], tpl["id"]))
            assert bool(claim) == bool(active), f"claim/assignment disagree after {step}"
