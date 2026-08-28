"""Skill Performance Log redesign — per-metric applicability state.

The redesigned trainer session recorder gives every performance metric
(duration/distance/repetitions/distraction/environment/handler_help/leash)
an explicit "Not needed for this lesson" state plus optional structured
details, layered ADDITIVELY over the legacy free-text fields:

  * blank            = the trainer has not entered a value yet
  * a value (incl 0) = what actually happened
  * not-needed       = the trainer deliberately marked the metric N/A

These tests pin the backward-compatibility contract: the new state
round-trips through the draft pipeline, legacy actuals without it stay
valid, and none of it can reach a client through the session log's
goal_updates (the only skill-level surface the client history allowlist
reads from).

Same fixture/cleanup convention as test_training_session_workspace.py.
"""
import contextlib
import json
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_SKILL_METRICS"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }))
    try:
        yield c, {"id": did}
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _program():
    admin = _admin_user()
    gid, lid, mid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": 2, "unit": "sessions"}, price=50,
        modules=[server.ModuleIn(
            id=mid, name="Week 1", order=0,
            goals=[server.GoalIn(id=gid, name="Sit", order=0)],
            lessons=[server.LessonIn(id=lid, name="Day 1 · Sit", order=0, skill_ids=[gid])],
        )],
    ), admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


@contextlib.contextmanager
def _session_draft():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = run(server.create_booking(server.BookingIn(
                dog_id=dog["id"], service_type="training",
                date=date.today().isoformat(), override_capacity=True,
            ), admin))
            started = run(server.start_training_session_draft_for_booking(booking["id"], None, "", admin))
            assert started["resolution"] == "ready"
            try:
                yield started["draft"], enr, admin
            finally:
                run(server.db.bookings.delete_one({"id": booking["id"]}))
                run(server.db.training_session_drafts.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.dog_programs.delete_one({"id": enr["id"]}))


def test_metric_state_round_trips_and_blank_zero_not_needed_stay_distinct():
    with _session_draft() as (draft, enr, admin):
        activity_id = draft["plan"]["activities"][0]["id"]
        run(server.update_training_session_draft(
            draft["id"],
            server.TrainingSessionDraftUpdateIn(actuals={
                activity_id: server.SessionActivityActualIn(
                    score=3, outcome="improving",
                    # duration entered as a real (zero) value; distance blank;
                    # leash deliberately marked not-needed — three distinct states.
                    duration_achieved="0 minutes",
                    metrics_not_needed={"leash": True, "distance": False},
                    metric_details={
                        "duration": {"value": 0, "unit": "minutes"},
                        "repetitions": {"attempts": 8, "successful": 6},
                        "handler_help": {"level": "Light", "methods": ["Verbal Cue", "Leash Guidance"]},
                    },
                ),
            }),
            admin,
        ))
        reloaded = run(server.get_training_session_draft(draft["id"], admin))
        actual = reloaded["draft"]["actuals"][activity_id]
        assert actual["metrics_not_needed"] == {"leash": True, "distance": False}
        assert actual["metric_details"]["duration"] == {"value": 0, "unit": "minutes"}
        assert actual["metric_details"]["repetitions"] == {"attempts": 8, "successful": 6}
        # A recorded zero is preserved as a value, never coerced to blank...
        assert actual["duration_achieved"] == "0 minutes"
        # ...while an untouched metric stays genuinely blank, with no
        # invented applicability decision.
        assert actual.get("distance_achieved") in (None, "")
        assert "repetitions" not in actual["metrics_not_needed"]


def test_legacy_actuals_without_metric_state_still_validate_and_reload():
    with _session_draft() as (draft, enr, admin):
        activity_id = draft["plan"]["activities"][0]["id"]
        updated = run(server.update_training_session_draft(
            draft["id"],
            server.TrainingSessionDraftUpdateIn(actuals={
                activity_id: server.SessionActivityActualIn(
                    score=4, outcome="passed", duration_achieved="10 min",
                    distraction_level="medium",
                ),
            }),
            admin,
        ))
        actual = updated["actuals"][activity_id]
        assert actual["duration_achieved"] == "10 min"
        # Legacy rows carry NO applicability metadata — absent, not False.
        assert actual.get("metrics_not_needed") is None
        assert actual.get("metric_details") is None


def test_metric_state_survives_completion_and_never_reaches_goal_updates():
    with _session_draft() as (draft, enr, admin):
        activity_id = draft["plan"]["activities"][0]["id"]
        run(server.update_training_session_draft(
            draft["id"],
            server.TrainingSessionDraftUpdateIn(
                actuals={
                    activity_id: server.SessionActivityActualIn(
                        score=3, outcome="improving",
                        client_observation="Sit is coming along nicely.",
                        notes="Staff-only handling note.",
                        metrics_not_needed={"leash": True},
                        metric_details={"repetitions": {"attempts": 5, "successful": 4}},
                    ),
                },
                # The delivery-enforcement gate requires the full trainer
                # record before completion — unchanged by this redesign.
                what_went_well="Held the sit longer.",
                needs_work="Still creeps forward.",
                next_lesson_focus="Add duration before distance.",
                client_recap_note="Great session — keep practicing short sits.",
            ),
            admin,
        ))
        run(server.complete_training_session(draft["id"], server.SessionCompletionIn(), admin))

        # The completed draft still restores the full metric state on reopen.
        stored = run(server.db.training_session_drafts.find_one({"id": draft["id"]}, {"_id": 0}))
        actual = stored["actuals"][activity_id]
        assert actual["metrics_not_needed"] == {"leash": True}
        assert actual["metric_details"]["repetitions"]["successful"] == 4

        # goal_updates is the only per-skill surface the client history
        # allowlist reads — the new staff-side metric state must not be
        # snapshotted into it.
        log = run(server.db.training_session_log.find_one({"enrollment_id": enr["id"]}, {"_id": 0}))
        assert log is not None
        diffs_json = json.dumps(log.get("goal_updates") or [])
        assert "metrics_not_needed" not in diffs_json
        assert "metric_details" not in diffs_json
        # The staff-only note appears ONLY under the "note" key the client
        # history allowlist already drops — never under any other key.
        for d in (log.get("goal_updates") or []):
            without_note = {k: v for k, v in d.items() if k != "note"}
            assert "Staff-only handling note." not in json.dumps(without_note)
        # The client-safe observation is snapshotted exactly as before.
        assert any(d.get("client_observation") == "Sit is coming along nicely."
                   for d in (log.get("goal_updates") or []))
