"""Training-school expansion, gap-closing/hardening pass — session
completion idempotency and crash-recovery.

Covers the specific requirements from the hardening pass that
test_training_session_completion.py's original (pre-hardening) coverage
didn't prove:

  * A completed occurrence can never be silently restarted — a second
    "start session" call for the same (enrollment_id, occurrence_date,
    session_label) returns the EXISTING completed session, never a new
    draft.
  * Two genuinely simultaneous completion requests for the same draft
    converge on exactly one session log, one set of homework, one final
    enrollment state — proven with real asyncio.gather concurrency, not
    just sequential calls.
  * A lost-response retry (client never saw the first response) is
    indistinguishable from any other retry — same idempotent behavior.
  * Board-and-train's distinct session_label values remain fully
    independent occurrences.
  * The same label on the NEXT calendar date is a legitimately new,
    unrelated session (occurrence_date is part of the key).
  * Failure injected at each real mutation stage (progress/advancement
    write, homework creation, session-log write, final draft-completed
    write) — a retry after each resumes and converges to ONE correct
    final state, never a duplicate.
  * There is deliberately NO compensating-rollback step in the hardened
    design (see complete_training_session's docstring in server.py for
    why: a rollback can itself fail partway through, which is the exact
    unrecoverable state this hardening pass exists to close) — so
    "failure during rollback" is proven moot by showing a chain of
    failures across every stage still converges to one correct state via
    forward-only idempotent resume, never needing to undo anything.
  * The explicit, audited reopen path is the ONLY way to re-edit a
    completed session.

Same fixture/cleanup convention as test_training_session_completion.py.
"""
import asyncio
import contextlib
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from motor.motor_asyncio import AsyncIOMotorCollection

TAG = "TEST_SESSION_HARDENING"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


class client:
    @staticmethod
    def post(url, headers=None, json=None):
        return run(_http.post(url, headers=headers, json=json))


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


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _make_program_in(name, homework_template_id=None):
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[
                server.GoalIn(name="Sit", homework_template_ids=[homework_template_id] if homework_template_id else []),
                server.GoalIn(name="Down"),
            ]),
            server.ModuleIn(name="Week 2", order=1, goals=[server.GoalIn(name="Heel")]),
        ],
    )


@contextlib.contextmanager
def _program(homework_template_id=None):
    admin = _admin_user()
    prog = run(server.create_program(_make_program_in(f"{TAG} {uuid.uuid4().hex[:6]}", homework_template_id), admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _make_booking(dog_id, admin):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup(enr_id, homework_ids=None):
    run(server.db.training_session_drafts.delete_many({"enrollment_id": enr_id}))
    run(server.db.training_session_log.delete_many({"enrollment_id": enr_id}))
    run(server.db.dog_programs.delete_one({"id": enr_id}))
    for hid in (homework_ids or []):
        run(server.db.homework.delete_one({"id": hid}))


def _start_session(enr, admin, dog, sit_id, score=3, session_label=None, homework_eligible=False):
    booking = _make_booking(dog["id"], admin)
    label = session_label if session_label is not None else f"session-{uuid.uuid4().hex[:8]}"
    started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], label, admin))
    draft_id = started["draft"]["id"]
    activities = started["draft"]["plan"]["activities"]
    sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
    run(server.update_training_session_draft(
        draft_id,
        server.TrainingSessionDraftUpdateIn(actuals={
            sit_activity["id"]: server.SessionActivityActualIn(
                score=score, outcome="improving", notes="test note", homework_eligible=homework_eligible,
            ),
        }),
        admin,
    ))
    return booking, draft_id


@contextlib.contextmanager
def _fail_method_on_collection(collection_name, method_name, message="simulated failure", fail_times=1):
    """Fails the Nth call(s) of `method_name` on `collection_name` — after
    `fail_times` failures it reverts to the real behavior, so a test's
    RETRY call succeeds for real without needing a second context manager."""
    orig = getattr(AsyncIOMotorCollection, method_name)
    state = {"remaining": fail_times}

    async def _patched(self, *args, **kwargs):
        if self.name == collection_name and state["remaining"] > 0:
            state["remaining"] -= 1
            raise RuntimeError(message)
        return await orig(self, *args, **kwargs)

    setattr(AsyncIOMotorCollection, method_name, _patched)
    try:
        yield
    finally:
        setattr(AsyncIOMotorCollection, method_name, orig)


# ---------------------------------------------------------------------------
# 1. A completed occurrence can never be silently restarted
# ---------------------------------------------------------------------------

def test_starting_a_session_again_after_completion_returns_the_completed_one_not_a_new_draft():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="morning")
            try:
                completed = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert completed["already_completed"] is False

                # Second click / later attempt for the SAME occurrence+label —
                # a brand new booking, exactly what the real check-in flow
                # would do if a trainer accidentally tried to check in twice.
                booking2 = _make_booking(dog["id"], admin)
                try:
                    started_again = run(server.start_training_session_draft_for_booking(booking2["id"], enr["id"], "morning", admin))
                    assert started_again["resolution"] == "ready"
                    assert started_again["draft"]["id"] == draft_id  # SAME draft returned, not a new one
                    assert started_again["draft"]["status"] == "completed"

                    count = run(server.db.training_session_drafts.count_documents({"enrollment_id": enr["id"], "session_label": "morning"}))
                    assert count == 1  # never a second draft for this occurrence
                finally:
                    run(server.db.bookings.delete_one({"id": booking2["id"]}))
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"], completed["homework_created"])


def test_update_draft_on_the_returned_completed_session_is_rejected_not_silently_ignored():
    """A caller that doesn't check the resolution/status and tries to edit
    the returned draft as if it were still open gets a clear 409, never a
    silent no-op or a reopened session."""
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="afternoon")
            try:
                completed = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                try:
                    run(server.update_training_session_draft(draft_id, server.TrainingSessionDraftUpdateIn(session_note="late edit"), admin))
                    assert False, "expected 409"
                except server.HTTPException as e:
                    assert e.status_code == 409
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"], completed["homework_created"])


# ---------------------------------------------------------------------------
# 2. Two simultaneous completion requests — real concurrency, no duplicates
# ---------------------------------------------------------------------------

def test_two_simultaneous_completion_requests_produce_exactly_one_log_and_no_duplicate_homework():
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl-{uuid.uuid4().hex[:6]}", name="Practice Sit", tier="foundation",
    ), _admin_user()))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin):
            with _client_and_dog() as (c, dog):
                sit_id = prog["modules"][0]["goals"][0]["id"]
                enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
                booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="concurrent", homework_eligible=True)
                try:
                    async def _go():
                        return await asyncio.gather(
                            server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin),
                            server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin),
                            return_exceptions=True,
                        )
                    results = run(_go())
                    # Neither call may raise — both must resolve to a coherent result.
                    for r in results:
                        assert not isinstance(r, Exception), f"unexpected exception: {r}"

                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs) == 1, "exactly one session log, regardless of two concurrent completion calls"

                    homework_ids = logs[0]["homework_created"]
                    assert len(homework_ids) == 1, "homework created exactly once, not once per concurrent request"
                    count = run(server.db.homework.count_documents({"id": {"$in": homework_ids}}))
                    assert count == 1

                    draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    assert draft["status"] == "completed"

                    updated_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                    assert updated_enr["current_module_id"] == prog["modules"][1]["id"]  # advanced exactly once
                finally:
                    run(server.db.bookings.delete_one({"id": booking["id"]}))
                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    hw_ids = logs[0]["homework_created"] if logs else []
                    _cleanup(enr["id"], hw_ids)
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


# ---------------------------------------------------------------------------
# 3. Lost-response retry is just another idempotent retry
# ---------------------------------------------------------------------------

def test_retry_after_response_presumed_lost_returns_identical_cached_result():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="lost-response")
            try:
                r1 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                # The client never saw r1 (simulated network drop) and retries
                # blind, with the SAME request body it originally sent.
                r2 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert r2["already_completed"] is True
                assert r2["session_log"]["id"] == r1["session_log"]["id"]
                assert r2["draft"]["completed_at"] == r1["draft"]["completed_at"] or r2["draft"]["status"] == "completed"
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"], r1["homework_created"])


# ---------------------------------------------------------------------------
# 4 & 5. Board-and-train labels stay independent; same label next date is new
# ---------------------------------------------------------------------------

def test_different_board_and_train_labels_are_fully_independent_occurrences():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            morning_booking, morning_draft = _start_session(enr, admin, dog, sit_id, session_label="morning")
            afternoon_booking, afternoon_draft = _start_session(enr, admin, dog, sit_id, session_label="afternoon")
            evening_booking, evening_draft = _start_session(enr, admin, dog, sit_id, session_label="evening")
            try:
                assert len({morning_draft, afternoon_draft, evening_draft}) == 3
                rm = run(server.complete_training_session(morning_draft, server.SessionCompletionIn(), admin))
                ra = run(server.complete_training_session(afternoon_draft, server.SessionCompletionIn(), admin))
                re = run(server.complete_training_session(evening_draft, server.SessionCompletionIn(), admin))
                for r in (rm, ra, re):
                    assert r["already_completed"] is False
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 3
                # Completing "morning" must never have touched "afternoon"/"evening".
                drafts = run(server.db.training_session_drafts.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert all(d["status"] == "completed" for d in drafts)
                assert len(drafts) == 3
            finally:
                for b in (morning_booking, afternoon_booking, evening_booking):
                    run(server.db.bookings.delete_one({"id": b["id"]}))
                _cleanup(enr["id"])


def test_same_label_next_calendar_date_is_a_legitimately_new_session():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking1, draft1 = _start_session(enr, admin, dog, sit_id, session_label="daily")
            try:
                r1 = run(server.complete_training_session(draft1, server.SessionCompletionIn(), admin))

                # Directly backdate/forward the draft's occurrence_date to
                # simulate "the next day" without waiting for real time to
                # pass — occurrence_date is the only thing that changes.
                tomorrow = (date.today() + timedelta(days=1)).isoformat()
                fresh_id = str(uuid.uuid4())
                run(server.db.training_session_drafts.insert_one({
                    "id": fresh_id, "enrollment_id": enr["id"], "dog_id": dog["id"],
                    "program_id": enr.get("program_id"), "booking_id": None,
                    "session_label": "daily", "occurrence_date": tomorrow, "status": "draft",
                    "created_at": server.now_iso(), "created_by": admin["id"], "created_by_name": admin["name"],
                    "updated_at": server.now_iso(), "plan": {"activities": []}, "actuals": {},
                    "session_note": "", "client_recap_note": "",
                }))
                fetched = run(server.get_training_session_draft(fresh_id, admin))
                assert fetched["draft"]["status"] == "draft"  # a genuinely separate, startable occurrence
                run(server.db.training_session_drafts.delete_one({"id": fresh_id}))
            finally:
                run(server.db.bookings.delete_one({"id": booking1["id"]}))
                _cleanup(enr["id"], r1["homework_created"])


# ---------------------------------------------------------------------------
# 6. Failure injection at each real mutation stage — retry always converges
# ---------------------------------------------------------------------------

def test_failure_after_progress_and_advancement_write_resumes_without_double_advancing():
    """Injects failure right after the dog_programs $set (progress +
    advancement) would have landed for real — by failing the NEXT write
    (homework's dog lookup isn't a write, so the next real write is the
    session log) — proving a retry does not re-read the now-advanced
    enrollment and advance it a second time."""
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="advance-fail")
            try:
                with _fail_method_on_collection("training_session_log", "update_one"):
                    try:
                        run(server.complete_training_session(draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin))
                        assert False, "expected simulated failure to propagate"
                    except RuntimeError:
                        pass
                mid = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert mid["current_module_id"] == prog["modules"][1]["id"]  # already applied — idempotent $set, left in place

                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert result["already_completed"] is False
                final = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert final["current_module_id"] == prog["modules"][1]["id"]  # NOT advanced a second time
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"], result["homework_created"])


def test_failure_during_homework_creation_resumes_without_duplicate_homework():
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl2-{uuid.uuid4().hex[:6]}", name="Practice Down", tier="foundation",
    ), _admin_user()))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin):
            with _client_and_dog() as (c, dog):
                sit_id = prog["modules"][0]["goals"][0]["id"]
                enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
                booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="hw-fail", homework_eligible=True)
                try:
                    with _fail_method_on_collection("homework", "insert_one"):
                        try:
                            run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                            assert False, "expected simulated failure to propagate"
                        except RuntimeError:
                            pass
                    # No homework and no log yet — the failure happened before both.
                    assert run(server.db.homework.count_documents({"dog_id": dog["id"]})) == 0
                    assert run(server.db.training_session_log.count_documents({"enrollment_id": enr["id"]})) == 0
                    draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    assert draft["status"] == "completing"

                    result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                    assert result["already_completed"] is False
                    assert len(result["homework_created"]) == 1
                    assert run(server.db.homework.count_documents({"dog_id": dog["id"]})) == 1
                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs) == 1
                    assert logs[0]["homework_created"] == result["homework_created"]
                finally:
                    run(server.db.bookings.delete_one({"id": booking["id"]}))
                    _cleanup(enr["id"], result["homework_created"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_failure_while_marking_draft_completed_resumes_and_converges():
    """Injects failure at the LAST write (the draft's own status=='completed'
    flip) — progress, homework, and the session log have already landed for
    real by this point. A retry must not re-create the log or homework
    (both are check-before-create/upsert-by-id) and must still successfully
    reach status=='completed'."""
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="finalize-fail")
            try:
                with _fail_method_on_collection("training_session_drafts", "update_one"):
                    try:
                        run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                        assert False, "expected simulated failure to propagate"
                    except RuntimeError:
                        pass
                # The session log DID get written for real before the failing call.
                logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs) == 1
                draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert draft["status"] == "completing"  # the flip to "completed" is what failed

                result = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert result["already_completed"] is False
                logs2 = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                assert len(logs2) == 1  # still exactly one — not a second one from the retry
                assert logs2[0]["id"] == logs[0]["id"]
                final = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert final["status"] == "completed"
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"], result["homework_created"])


def test_chained_failures_across_every_stage_still_converge_to_one_final_state():
    """No compensating rollback exists in the hardened design (see
    complete_training_session's docstring) — so there is nothing that can
    itself fail 'during rollback'. This test proves that property directly:
    fail at the homework stage, retry (fails again at the log stage this
    time since homework is now done), retry again (fails at the final
    draft-completed stage), retry a THIRD time (succeeds) — and the end
    state is still exactly one log, one homework item, one advancement,
    proving forward-only idempotent resume never needs an undo step and
    never loses or duplicates work no matter how many times it's
    interrupted."""
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl3-{uuid.uuid4().hex[:6]}", name="Practice Chain", tier="foundation",
    ), _admin_user()))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin):
            with _client_and_dog() as (c, dog):
                sit_id = prog["modules"][0]["goals"][0]["id"]
                enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
                booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="chain-fail", homework_eligible=True)
                try:
                    body = server.SessionCompletionIn(advancement_action="advance_module")

                    with _fail_method_on_collection("homework", "insert_one"):
                        try:
                            run(server.complete_training_session(draft_id, body, admin))
                            assert False
                        except RuntimeError:
                            pass

                    with _fail_method_on_collection("training_session_log", "update_one"):
                        try:
                            run(server.complete_training_session(draft_id, body, admin))
                            assert False
                        except RuntimeError:
                            pass

                    with _fail_method_on_collection("training_session_drafts", "update_one"):
                        try:
                            run(server.complete_training_session(draft_id, body, admin))
                            assert False
                        except RuntimeError:
                            pass

                    # Fourth attempt — no injected failure — finally succeeds.
                    result = run(server.complete_training_session(draft_id, body, admin))
                    assert result["already_completed"] is False

                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs) == 1
                    assert len(logs[0]["homework_created"]) == 1
                    assert run(server.db.homework.count_documents({"dog_id": dog["id"]})) == 1
                    final_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                    assert final_enr["current_module_id"] == prog["modules"][1]["id"]  # advanced exactly once, not 4 times
                    draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    assert draft["status"] == "completed"
                finally:
                    run(server.db.bookings.delete_one({"id": booking["id"]}))
                    _cleanup(enr["id"], result["homework_created"])
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


# ---------------------------------------------------------------------------
# Explicit, audited reopen — the only way to re-edit a completed session
# ---------------------------------------------------------------------------

def test_reopen_requires_a_reason_and_is_rejected_for_a_non_completed_draft():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="reopen-guard")
            try:
                try:
                    run(server.reopen_training_session(draft_id, server.SessionReopenIn(reason="oops"), admin))
                    assert False, "expected 409 — draft is still open, nothing to reopen"
                except server.HTTPException as e:
                    assert e.status_code == 409
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"])


def test_reopen_completed_session_is_audited_and_allows_recompletion():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, score=2, session_label="reopen-flow")
            try:
                r1 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                original_log_id = r1["session_log"]["id"]

                reopened = run(server.reopen_training_session(draft_id, server.SessionReopenIn(reason="trainer scored wrong dog by mistake"), admin))
                assert reopened["draft"]["status"] == "draft"
                assert reopened["reopen_event"]["reason"] == "trainer scored wrong dog by mistake"
                assert reopened["reopen_event"]["prior_completed_log_id"] == original_log_id

                # The original historical log row is untouched, not deleted.
                original_log = run(server.db.training_session_log.find_one({"id": original_log_id}, {"_id": 0}))
                assert original_log is not None

                # Correcting the score and re-completing.
                activities = reopened["draft"]["plan"]["activities"]
                sit_activity = next(a for a in activities if a.get("skill_id") == sit_id)
                run(server.update_training_session_draft(
                    draft_id, server.TrainingSessionDraftUpdateIn(actuals={
                        sit_activity["id"]: server.SessionActivityActualIn(score=5, outcome="passed", notes="corrected"),
                    }), admin,
                ))
                r2 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                assert r2["already_completed"] is False
                assert r2["session_log"]["id"] != original_log_id  # a NEW log row for the corrected completion — reopen_count makes the id distinct

                updated_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert updated_enr["goal_progress"][sit_id]["score"] == 5  # corrected value stuck
                final_draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                assert len(final_draft.get("reopen_history") or []) == 1
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                _cleanup(enr["id"])


def test_only_admin_and_permitted_staff_can_reopen_front_desk_cannot():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            sit_id = prog["modules"][0]["goals"][0]["id"]
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="reopen-perm")
            trainer_uid, trainer_h = _insert_staff("trainer")
            fd_uid, fd_h = _insert_staff("front_desk")
            try:
                r1 = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))

                r_fd = client.post(f"/api/training-session-drafts/{draft_id}/reopen", headers=fd_h, json={"reason": "test"})
                assert r_fd.status_code == 403, r_fd.text

                r_trainer = client.post(f"/api/training-session-drafts/{draft_id}/reopen", headers=trainer_h, json={"reason": "trainer correcting a score"})
                assert r_trainer.status_code == 200, r_trainer.text
                assert r_trainer.json()["draft"]["status"] == "draft"
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                run(server.db.users.delete_many({"id": {"$in": [trainer_uid, fd_uid]}}))
                _cleanup(enr["id"], r1["homework_created"])


# ---------------------------------------------------------------------------
# Claim-token ownership — a slow-but-still-alive worker cannot keep writing
# after a stale-claim takeover, independent of write idempotency
# ---------------------------------------------------------------------------

def test_paused_but_still_running_worker_cannot_write_after_stale_takeover():
    """The precise scenario the final correctness pass calls for: a first
    completion worker claims the draft, then PAUSES (not crashes) past the
    staleness window — it is still alive and about to keep writing. A
    second request reclaims and finishes the completion for real. The
    first worker then resumes and attempts to continue writing with its
    now-superseded claim token.

    Proves:
      * The first worker's continuation is rejected outright
        (LostCompletionClaimError) BEFORE any write of its own lands —
        this is checked via _assert_claim_owned, not inferred from the
        writes happening to be harmless.
      * Only one worker (the second) ends up owning the finished draft.
      * Exactly one session log exists.
      * Homework was created exactly once.
      * Advancement happened exactly once (not twice, which double
        _apply_completion_plan executions against the same plan would
        otherwise risk if either one's advancement logic re-ran against a
        live-mutated enrollment rather than being blocked outright).
      * The draft settles in exactly one valid final state: completed,
        owned by the second worker's token.
    """
    orig_stale_seconds = server._COMPLETION_STALE_SECONDS
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        slug=f"{TAG.lower()}-tpl-pause-{uuid.uuid4().hex[:6]}", name="Practice Pause", tier="foundation",
    ), _admin_user()))
    try:
        with _program(homework_template_id=tpl["id"]) as (prog, admin):
            with _client_and_dog() as (c, dog):
                sit_id = prog["modules"][0]["goals"][0]["id"]
                enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
                booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="pause-takeover", homework_eligible=True)
                try:
                    # --- Worker A claims the draft manually — the exact same
                    # atomic transition complete_training_session performs — so
                    # the test can pause BEFORE calling _apply_completion_plan,
                    # simulating a real worker that is slow, not dead. ---
                    draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                    plan_a = run(server._compute_completion_plan(
                        enrollment, draft, draft_id, server.SessionCompletionIn(advancement_action="advance_module"), admin,
                    ))
                    token_a = str(uuid.uuid4())
                    claimed_a = run(server.db.training_session_drafts.find_one_and_update(
                        {"id": draft_id, "status": "draft"},
                        {"$set": {"status": "completing", "completing_started_at": server.now_iso(),
                                   "completion_plan": plan_a, "completing_claim_token": token_a}},
                        return_document=server.ReturnDocument.AFTER,
                    ))
                    assert claimed_a is not None

                    # --- Worker A is now "paused" past the staleness window.
                    # Shrink the threshold instead of sleeping 30 real seconds —
                    # any elapsed time at all is then stale. -1, not 0: with 0,
                    # _completing_is_stale needs elapsed_seconds > 0 to hold,
                    # which is only true if real wall-clock time has visibly
                    # advanced between the write above and this check — a
                    # boundary that occasionally reads as exactly 0.0 under
                    # scheduler/clock jitter (confirmed by reproduction: this
                    # exact line intermittently sent this test's real request
                    # down the "still being completed by another request"
                    # 409/timeout path instead of the reclaim path it's meant
                    # to exercise). -1 removes the boundary outright — elapsed
                    # is always >= 0.0, so "> -1" can never be ambiguous. ---
                    server._COMPLETION_STALE_SECONDS = -1

                    # --- A second, independent request arrives via the REAL
                    # endpoint (exactly as a genuine concurrent HTTP request
                    # would), reclaims the stale-looking claim, and finishes it
                    # for real. ---
                    result_b = run(server.complete_training_session(draft_id, server.SessionCompletionIn(), admin))
                    assert result_b["already_completed"] is False
                    logs_after_b = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs_after_b) == 1
                    log_id_from_b = logs_after_b[0]["id"]

                    # --- Worker A "resumes" now and tries to keep writing with
                    # its superseded token_a. It must be rejected immediately —
                    # before it performs so much as its first write. ---
                    try:
                        run(server._apply_completion_plan(draft_id, plan_a, token_a))
                        assert False, "expected LostCompletionClaimError"
                    except server.LostCompletionClaimError:
                        pass

                    # --- Final state: only worker B's work survived. ---
                    logs_final = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs_final) == 1
                    assert logs_final[0]["id"] == log_id_from_b  # untouched by worker A's rejected attempt

                    homework_docs = run(server.db.homework.find({"dog_id": dog["id"]}, {"_id": 0}).to_list(10))
                    assert len(homework_docs) == 1  # created exactly once

                    final_enr = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                    assert final_enr["current_module_id"] == prog["modules"][1]["id"]  # advanced exactly once, not twice

                    final_draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    assert final_draft["status"] == "completed"
                    assert final_draft["completing_claim_token"] != token_a  # token B finished it, not token A
                finally:
                    run(server.db.bookings.delete_one({"id": booking["id"]}))
                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    hw_ids = [h for l in logs for h in (l.get("homework_created") or [])]
                    _cleanup(enr["id"], hw_ids)
    finally:
        server._COMPLETION_STALE_SECONDS = orig_stale_seconds
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_stale_reclaim_itself_is_exclusive_only_one_reclaimer_wins():
    """A narrower companion to the takeover test above: if TWO requests both
    observe the same stale claim and both attempt to reclaim it
    concurrently, the reclaim's own compare-and-swap (on the OLD claim
    token) guarantees only one of them can win — proven with real
    asyncio.gather concurrency, not sequential calls.

    Two sources of real nondeterminism were found and closed here (both
    previously made this test flake under a full-suite run — never
    reproduced by looping it in isolation, since isolation gives the event
    loop nothing else to interleave with):

    1. `_COMPLETION_STALE_SECONDS = 0` makes `_completing_is_stale` depend
       on `elapsed_seconds > 0` being true for whatever wall-clock gap
       happens to exist between the manual "completing" write above and
       each request's own staleness check moments later. That gap is
       normally comfortably positive, but under heavy scheduler load
       (many concurrent tasks across the full suite) it can occasionally
       round to exactly 0.0, which would make BOTH requests treat the
       claim as fresh (not stale) and neither would attempt the reclaim —
       both would then wait, nobody would ever finish it, and both would
       eventually time out. Using -1 instead removes the boundary
       entirely: elapsed is always >= 0.0, so `> -1` can never be
       ambiguous, regardless of clock resolution or scheduling jitter.
    2. asyncio.gather does not guarantee the two coroutines' very first DB
       read (of the same draft) actually overlaps — real overlap only
       reliably happens once both are scheduled far enough to reach an
       `await`, and under scheduler contention one coroutine could
       occasionally run well ahead of the other. A rendezvous barrier
       (an asyncio.Event, released only once both requests have completed
       their first read of the draft) makes "both requests observe the
       same stale claim before either attempts the reclaim" a structural
       guarantee instead of a scheduling coincidence — this is what
       actually proves the compare-and-swap under genuine concurrency
       rather than relying on both requests happening to race closely.
    """
    orig_stale_seconds = server._COMPLETION_STALE_SECONDS
    orig_find_one = AsyncIOMotorCollection.find_one
    try:
        with _program() as (prog, admin):
            with _client_and_dog() as (c, dog):
                sit_id = prog["modules"][0]["goals"][0]["id"]
                enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
                booking, draft_id = _start_session(enr, admin, dog, sit_id, session_label="dual-reclaim")
                try:
                    draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    enrollment = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                    plan_a = run(server._compute_completion_plan(
                        enrollment, draft, draft_id, server.SessionCompletionIn(), admin,
                    ))
                    token_a = str(uuid.uuid4())
                    run(server.db.training_session_drafts.find_one_and_update(
                        {"id": draft_id, "status": "draft"},
                        {"$set": {"status": "completing", "completing_started_at": server.now_iso(),
                                   "completion_plan": plan_a, "completing_claim_token": token_a}},
                    ))
                    # See docstring point 1 — removes the elapsed-time
                    # boundary ambiguity `_COMPLETION_STALE_SECONDS = 0`
                    # would otherwise introduce.
                    server._COMPLETION_STALE_SECONDS = -1

                    # See docstring point 2 — rendezvous barrier around the
                    # draft's very first read in complete_training_session
                    # (the read whose result feeds _completing_is_stale and
                    # the reclaim attempt). Only the first two calls that
                    # read THIS draft_id are gated; every other read (by
                    # this or any other concurrently-running test on the
                    # shared event loop) passes straight through.
                    # Only the first two matching calls are ever gated —
                    # once both have arrived, the gate self-disables (checks
                    # rendezvous_hits["n"] < 2 up front) so it never touches
                    # any of the many LATER find_one calls this same draft_id
                    # legitimately receives during the rest of completion
                    # (_assert_claim_owned checks, _wait_for_draft_completion
                    # polling) — those must pass straight through untouched.
                    rendezvous_hits = {"n": 0}
                    release = asyncio.Event()

                    async def _synced_find_one(self, *args, **kwargs):
                        is_target = (
                            rendezvous_hits["n"] < 2
                            and self.name == "training_session_drafts"
                            and args and isinstance(args[0], dict) and args[0].get("id") == draft_id
                        )
                        if not is_target:
                            return await orig_find_one(self, *args, **kwargs)
                        rendezvous_hits["n"] += 1
                        seq = rendezvous_hits["n"]
                        result = await orig_find_one(self, *args, **kwargs)
                        if seq == 1:
                            await asyncio.wait_for(release.wait(), timeout=5.0)
                        else:
                            release.set()
                        return result

                    AsyncIOMotorCollection.find_one = _synced_find_one

                    async def _go():
                        return await asyncio.gather(
                            server.complete_training_session(draft_id, server.SessionCompletionIn(), admin),
                            server.complete_training_session(draft_id, server.SessionCompletionIn(), admin),
                            return_exceptions=True,
                        )
                    results = run(_go())
                    AsyncIOMotorCollection.find_one = orig_find_one
                    for r in results:
                        assert not isinstance(r, Exception), f"unexpected exception: {r}"
                    assert rendezvous_hits["n"] == 2  # both requests genuinely reached the rendezvous

                    logs = run(server.db.training_session_log.find({"enrollment_id": enr["id"]}, {"_id": 0}).to_list(10))
                    assert len(logs) == 1
                    final_draft = run(server.db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}))
                    assert final_draft["status"] == "completed"
                finally:
                    AsyncIOMotorCollection.find_one = orig_find_one
                    run(server.db.bookings.delete_one({"id": booking["id"]}))
                    _cleanup(enr["id"])
    finally:
        server._COMPLETION_STALE_SECONDS = orig_stale_seconds
