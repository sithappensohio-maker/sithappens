"""Training-school expansion, Phase 10 — closing specific gaps identified
against the required test list that weren't already covered by the
per-phase test files:

  * Reordering modules/lessons/skills preserves their ids.
  * Publishing a draft affects only enrollments created AFTER publish —
    an enrollment created before stays on its original snapshot.
  * A trainer can intentionally move a skill's score backward (no
    "highest score always wins" floor).
  * A skill removed via cascade still shows its real name in historical
    session logs (the log snapshots the name at write time, not a live
    lookup against the possibly-since-edited curriculum).
  * Board-and-train: two session drafts can coexist for the same
    enrollment on the same day under different session_label values.
  * A non-training booking can never spin up a training session draft,
    even if its dog happens to have an active training enrollment.

Same fixture/cleanup convention as the other Phase N test files.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from datetime import date

TAG = "TEST_PHASE10_GAPS"


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


def _make_program_in(name):
    return server.ProgramIn(
        name=name, type="private_lessons", format={"count": 2, "unit": "sessions"}, price=50,
        modules=[
            server.ModuleIn(name="Week 1", order=0, goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")]),
            server.ModuleIn(name="Week 2", order=1, goals=[server.GoalIn(name="Heel")]),
        ],
    )


@contextlib.contextmanager
def _program():
    admin = _admin_user()
    prog = run(server.create_program(_make_program_in(f"{TAG} {uuid.uuid4().hex[:6]}"), admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _make_booking(dog_id, admin, service_type="training"):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type=service_type, date=date.today().isoformat(), override_capacity=True,
    ), admin))


def _cleanup(booking_id, enr_id):
    if booking_id:
        run(server.db.bookings.delete_one({"id": booking_id}))
    run(server.db.training_session_drafts.delete_many({"enrollment_id": enr_id}))
    run(server.db.training_session_log.delete_many({"enrollment_id": enr_id}))
    run(server.db.dog_programs.delete_one({"id": enr_id}))


# ---------------------------------------------------------------------------
# Test #4 — reordering preserves ids
# ---------------------------------------------------------------------------

def test_reordering_modules_preserves_their_ids():
    with _program() as (prog, admin):
        week1_id = prog["modules"][0]["id"]
        week2_id = prog["modules"][1]["id"]
        sit_id = prog["modules"][0]["goals"][0]["id"]
        down_id = prog["modules"][0]["goals"][1]["id"]

        # Swap order — Week 2 first, Week 1 second (matches how the
        # Program Studio's up/down buttons reorder: same ids, new `order`).
        swapped = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=50,
            modules=[
                server.ModuleIn(id=week2_id, name="Week 2", order=0, goals=[server.GoalIn(**g) for g in prog["modules"][1]["goals"]]),
                server.ModuleIn(
                    id=week1_id, name="Week 1", order=1,
                    goals=[
                        server.GoalIn(id=down_id, name="Down", order=0),
                        server.GoalIn(id=sit_id, name="Sit", order=1),
                    ],
                ),
            ],
        )
        updated = run(server.update_program(prog["id"], swapped, cascade=False, save_as_draft=False, _=admin))
        ids_after = {m["id"] for m in updated["modules"]}
        assert ids_after == {week1_id, week2_id}
        week1_after = next(m for m in updated["modules"] if m["id"] == week1_id)
        assert week1_after["order"] == 1
        goal_ids_after = {g["id"] for g in week1_after["goals"]}
        assert goal_ids_after == {sit_id, down_id}


# ---------------------------------------------------------------------------
# Test #7 — publishing affects only future enrollments
# ---------------------------------------------------------------------------

def test_publish_affects_only_enrollments_created_after_publish():
    with _program() as (prog, admin):
        with _client_and_dog() as (c_before, dog_before):
            enr_before = run(server.enroll_dog(dog_before["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                draft_body = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=50,
                    modules=[
                        server.ModuleIn(**prog["modules"][0]),
                        server.ModuleIn(**prog["modules"][1]),
                        server.ModuleIn(name="Week 3 · New", order=2, goals=[server.GoalIn(name="Stay")]),
                    ],
                )
                run(server.update_program(prog["id"], draft_body, cascade=False, save_as_draft=True, _=admin))
                run(server.publish_program(prog["id"], cascade=False, _=admin))

                with _client_and_dog() as (c_after, dog_after):
                    enr_after = run(server.enroll_dog(dog_after["id"], server.EnrollIn(program_id=prog["id"]), admin))
                    try:
                        before_modules = {m["name"] for m in enr_before["program_snapshot"]["modules"]}
                        after_modules = {m["name"] for m in enr_after["program_snapshot"]["modules"]}
                        assert "Week 3 · New" not in before_modules  # existing enrollment untouched
                        assert "Week 3 · New" in after_modules       # new enrollment gets the published curriculum
                    finally:
                        run(server.db.dog_programs.delete_one({"id": enr_after["id"]}))
            finally:
                run(server.db.dog_programs.delete_one({"id": enr_before["id"]}))


# ---------------------------------------------------------------------------
# Test #15 — trainer can intentionally move a skill backward
# ---------------------------------------------------------------------------

def test_trainer_can_move_skill_score_backward():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            sit_id = prog["modules"][0]["goals"][0]["id"]
            try:
                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=4), admin))
                up = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert up["goal_progress"][sit_id]["score"] == 4
                assert up["goal_progress"][sit_id]["status"] == "mastered"

                # Deliberately move it backward — performance declined.
                run(server.update_goal(dog["id"], enr["id"], sit_id, server.GoalUpdate(score=1), admin))
                down = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
                assert down["goal_progress"][sit_id]["score"] == 1  # NOT stuck at 4 — no "highest wins" floor
                assert down["goal_progress"][sit_id]["status"] == "in_progress"
            finally:
                _cleanup(None, enr["id"])


# ---------------------------------------------------------------------------
# Test #11 — removed skill's name survives in historical session logs
# ---------------------------------------------------------------------------

def test_removed_skill_name_preserved_in_session_log_history():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            booking = _make_booking(dog["id"], admin)
            try:
                started = run(server.start_training_session_draft_for_booking(booking["id"], enr["id"], "", admin))
                sit_activity = next(a for a in started["draft"]["plan"]["activities"] if a["name"] == "Sit")
                run(server.update_training_session_draft(
                    started["draft"]["id"], server.TrainingSessionDraftUpdateIn(
                        actuals={sit_activity["id"]: server.SessionActivityActualIn(score=4)},
                    ), admin,
                ))
                result = run(server.complete_training_session(started["draft"]["id"], server.SessionCompletionIn(), admin))
                log_id = result["session_log"]["id"]
                assert result["session_log"]["goal_updates"][0]["skill_name"] == "Sit"

                # Now remove "Sit" from the curriculum entirely via cascade.
                sit_id = sit_activity["skill_id"]
                without_sit = server.ProgramIn(
                    name=prog["name"], type="private_lessons", format=prog["format"], price=50,
                    modules=[
                        server.ModuleIn(id=prog["modules"][0]["id"], name="Week 1", order=0, goals=[
                            server.GoalIn(**{k: v for k, v in g.items() if k != "id"} | {"id": g["id"]})
                            for g in prog["modules"][0]["goals"] if g["id"] != sit_id
                        ]),
                        server.ModuleIn(**prog["modules"][1]),
                    ],
                )
                run(server.update_program(prog["id"], without_sit, cascade=True, save_as_draft=False, _=admin))

                # The historical log must still say "Sit" — never blank —
                # even though "Sit" no longer exists anywhere in the live curriculum.
                log = run(server.db.training_session_log.find_one({"id": log_id}, {"_id": 0}))
                assert log["goal_updates"][0]["skill_name"] == "Sit"

                progress = run(server.portal_progress({"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"]}))
                entry = next(p for p in progress if p["dog_id"] == dog["id"])
                assert "Sit" in entry["session_history"][0]["skills_worked"]
            finally:
                _cleanup(booking["id"], enr["id"])


# ---------------------------------------------------------------------------
# Test #35 — board-and-train: multiple sessions per day via session_label
# ---------------------------------------------------------------------------

def test_board_and_train_supports_multiple_same_day_sessions_via_label():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            try:
                morning = run(server.start_training_session_draft_direct(dog["id"], enr["id"], "morning", admin))
                afternoon = run(server.start_training_session_draft_direct(dog["id"], enr["id"], "afternoon", admin))
                assert morning["draft"]["id"] != afternoon["draft"]["id"]  # two independent drafts, not deduped

                # Resuming "morning" again returns the SAME morning draft, not a third one.
                morning_again = run(server.start_training_session_draft_direct(dog["id"], enr["id"], "morning", admin))
                assert morning_again["draft"]["id"] == morning["draft"]["id"]

                count = run(server.db.training_session_drafts.count_documents({"enrollment_id": enr["id"]}))
                assert count == 2
            finally:
                _cleanup(None, enr["id"])


# ---------------------------------------------------------------------------
# Test #20 — non-training booking can never start a training session
# ---------------------------------------------------------------------------

def test_non_training_booking_cannot_start_a_training_session():
    with _program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            enr = run(server.enroll_dog(dog["id"], server.EnrollIn(program_id=prog["id"]), admin))
            daycare_booking = _make_booking(dog["id"], admin, service_type="daycare")
            try:
                result = run(server.start_training_session_draft_for_booking(daycare_booking["id"], None, "", admin))
                assert result["resolution"] == "not_a_training_booking"
                count = run(server.db.training_session_drafts.count_documents({"enrollment_id": enr["id"]}))
                assert count == 0  # no draft was created despite the dog having an active training enrollment
            finally:
                run(server.db.bookings.delete_one({"id": daycare_booking["id"]}))
                _cleanup(None, enr["id"])
