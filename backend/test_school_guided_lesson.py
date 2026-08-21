"""Online School — the guided lesson progression and its Practice gate.

A lesson is a sequence, not a menu: the client works through the instructional
material, and only then does Practice open. The gate is the point of this
suite, so it is tested where it is ENFORCED — the portal endpoints — not by
asking the browser nicely.

Three things get equal weight here:

  * the progression itself (opening a step is not completing it; completing
    one persists; completion is idempotent),
  * that the gate cannot be walked around by calling the API directly, by
    naming a step that is not instructional, or by pointing at someone else's
    enrollment,
  * that nobody already mid-course is stranded by a rule that did not exist
    when they did the work.

Fixtures are the existing Phase-4 ones, so the program/enrollment/practice
flow is the real one rather than a hand-built imitation.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import school_lesson_guide as guide
import _school_client_flow
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _enroll, _client_user, _cleanup_school,
    _admin_user,
)


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _course(n_lessons=2):
    """A real enrolled course. Yields (se, enrollment, client_user, lesson_id)."""
    with _school_program(n_modules=1, n_lessons_per_module=n_lessons,
                         checkpoint_lesson_idx=99) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin)
            cu = _client_user(client["id"])
            try:
                lesson_id = run(server.db.dog_programs.find_one(
                    {"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                yield se, enr, cu, lesson_id
            finally:
                _cleanup_school(se["id"], enr["id"])


def _detail(se, lesson_id, cu):
    return run(server.portal_school_lesson_detail(se["id"], lesson_id, cu))


def _complete_step(se, lesson_id, key, cu):
    return run(server.portal_school_complete_lesson_step(se["id"], lesson_id, key, cu))


def _start_practice_raw(se, lesson_id, cu):
    """The endpoint with NOTHING satisfying the gate first — the bypass path."""
    return run(server.portal_school_start_practice(se["id"], lesson_id, cu))


def _enrollment(enr):
    return run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))


def _make_block_lesson(enr, lesson_id):
    """Give the current fixture the real Course Builder shape, including one
    authored Quick Check, without changing its Practice template."""
    blocks = [
        {"id": "learn-block", "type": "text", "title": "Why this matters", "body": "Understand the goal.", "order": 1, "active": True},
        {"id": "ready-block", "type": "checklist", "title": "Before you begin", "items": ["Treats ready"], "order": 2, "active": True},
        {"id": "train-block", "type": "steps", "title": "Step-by-step lesson", "items": ["Lure", "Mark"], "order": 3, "active": True},
        {"id": "watch-block", "type": "text", "title": "Common mistakes to avoid", "body": "Do not repeat the cue.", "order": 4, "active": True},
        {"id": "success-block", "type": "text", "title": "What success looks like", "body": "Five clean repetitions.", "order": 5, "active": True},
        {"id": "quick-one", "type": "quiz", "title": "Quick Check", "body": "When should you mark?",
         "items": ["When the rear touches the floor", "Before the dog moves"],
         "config": {"correct_answer": "When the rear touches the floor", "explanation": "Mark the completed behavior."},
         "order": 6, "active": True},
    ]
    run(server.db.dog_programs.update_one(
        {"id": enr["id"], "program_snapshot.modules.lessons.id": lesson_id},
        {"$set": {"program_snapshot.modules.0.lessons.0.content_blocks": blocks}},
    ))


# ---------------------------------------------------------------------------
# The sequence itself (pure)
# ---------------------------------------------------------------------------

def test_the_sequence_only_contains_steps_the_lesson_actually_has():
    lesson = {"client_overview": "Why.", "success_criteria": "Five in a row."}
    keys = [s["key"] for s in guide.build_guide(lesson, has_practice=True)]
    assert keys == ["learn", "know_got_it", "practice", "next_step"], keys
    # ...and no empty placeholder for the steps the trainer never authored
    assert "get_ready" not in keys and "train" not in keys


def test_steps_are_renumbered_so_the_client_never_sees_a_gap():
    lesson = {"client_overview": "Why.", "success_criteria": "Five."}
    steps = guide.build_guide(lesson, has_practice=True)
    assert [s["n"] for s in steps] == [1, 2, 3, 4]
    assert all(s["total"] == 4 for s in steps)


def test_out_of_order_historical_markers_do_not_present_as_completed_until_prerequisites_exist():
    lesson = {"client_overview": "Why.", "equipment_needed": "Treats.",
              "client_instructions": "Lure."}
    assert guide.contiguous_completed_steps(lesson, ["train"], has_practice=True) == []
    assert guide.contiguous_completed_steps(lesson, ["learn", "train"], has_practice=True) == ["learn"]
    assert guide.contiguous_completed_steps(lesson, ["train", "get_ready", "learn"], has_practice=True) == [
        "learn", "get_ready", "train"]


def test_only_instructional_steps_gate_practice():
    lesson = {"client_overview": "Why.", "equipment_needed": "Treats.",
              "client_instructions": "Lure.", "common_mistakes": "Repeating.",
              "success_criteria": "Five."}
    assert guide.instructional_step_keys(lesson, has_practice=True) == [
        "learn", "get_ready", "train", "watch_for", "know_got_it"]


def test_only_a_lesson_with_no_instructional_content_is_ungated():
    """The exemption is a tautology, not a bypass.

    A lesson with even ONE authored instructional step presents the guided
    sequence and is gated. Only a lesson with nothing instructional to
    complete is exempt — because there is nothing a client could do to
    satisfy a gate there.
    """
    one_step = {"client_overview": "Just this."}
    assert guide.instructional_step_keys(one_step, has_practice=True) == ["learn"]
    assert guide.guide_is_active(one_step, has_practice=True) is True

    for empty in ({}, {"content_blocks": [{"type": "practice", "order": 1}]},
                  {"content_blocks": [{"type": "quiz", "order": 1}]}):
        assert guide.instructional_step_keys(empty, has_practice=True) == []
        assert guide.missing_instructional_steps(empty, [], has_practice=True) == []


def test_a_single_step_lesson_is_gated_and_completable():
    # Option A from review: no lesson shape can be gated without also
    # offering the client a way to satisfy it.
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]},
            {"$set": {"program_snapshot.modules.0.lessons.0.success_criteria": "",
                      "program_snapshot.modules.0.lessons.0.why_it_matters": ""}}))
        d = _detail(se, lid, cu)
        assert d["instructional_steps"] == ["learn"], d["instructional_steps"]
        assert d["practice_unlocked"] is False, "a one-step lesson slipped the gate"
        with pytest.raises(server.HTTPException):
            _start_practice_raw(se, lid, cu)
        _complete_step(se, lid, "learn", cu)
        assert _detail(se, lid, cu)["practice_unlocked"] is True

def test_authored_content_is_never_dropped():
    # A text block matching no keyword still lands in a visible step.
    lesson = {"content_blocks": [
        {"type": "text", "title": "Something unexpected", "body": "x", "order": 1},
        {"type": "steps", "title": "Train", "items": ["a", "b"], "order": 2},
    ]}
    keys = [s["key"] for s in guide.build_guide(lesson)]
    assert "learn" in keys and "train" in keys


# ---------------------------------------------------------------------------
# Instructional progression
# ---------------------------------------------------------------------------

def test_reading_a_step_does_not_complete_it():
    # Fetching the lesson is what "opening a section" does. It must not count.
    with _course() as (se, enr, cu, lid):
        _detail(se, lid, cu)
        _detail(se, lid, cu)
        d = _detail(se, lid, cu)
        assert d["steps_completed"] == [], "merely opening the lesson completed a step"
        assert d["practice_unlocked"] is False


def test_explicitly_finishing_a_step_persists_it():
    with _course() as (se, enr, cu, lid):
        out = _complete_step(se, lid, "learn", cu)
        assert "learn" in out["steps_completed"]
        # persisted, not just returned — a refresh reads the same thing
        assert _detail(se, lid, cu)["steps_completed"] == ["learn"]
        assert "learn" in _enrollment(enr)["lesson_step_progress"][lid]


def test_progress_survives_a_reload_and_is_per_lesson():
    with _course(n_lessons=2) as (se, enr, cu, lid):
        _complete_step(se, lid, "learn", cu)
        fresh = _enrollment(enr)
        assert fresh["lesson_step_progress"][lid] == ["learn"]
        # a different lesson keeps its own progress
        other = [l["id"] for m in (fresh["program_snapshot"]["modules"])
                 for l in m["lessons"] if l["id"] != lid]
        assert other, "fixture should have a second lesson"
        assert other[0] not in fresh.get("lesson_step_progress", {})


def test_completing_the_same_step_twice_is_idempotent():
    # A double-tap, or a retried request, records the step once.
    with _course() as (se, enr, cu, lid):
        _complete_step(se, lid, "learn", cu)
        _complete_step(se, lid, "learn", cu)
        _complete_step(se, lid, "learn", cu)
        assert _enrollment(enr)["lesson_step_progress"][lid] == ["learn"]


def test_a_client_cannot_complete_train_before_learn_and_get_ready():
    """The old implementation only validated that Train was a real key; it
    did not validate its POSITION, so clients could complete steps 1-5 in any
    order. The server now owns that order too."""
    with _course() as (se, enr, cu, lid):
        _make_block_lesson(enr, lid)
        d = _detail(se, lid, cu)
        assert d["instructional_steps"][:3] == ["learn", "get_ready", "train"]
        with pytest.raises(server.HTTPException) as e:
            _complete_step(se, lid, "train", cu)
        assert e.value.status_code == 409
        assert e.value.detail["error_code"] == "instructional_step_out_of_order"
        assert e.value.detail["required_step"] == "learn"
        assert _detail(se, lid, cu)["steps_completed"] == []

        _complete_step(se, lid, "learn", cu)
        with pytest.raises(server.HTTPException) as e2:
            _complete_step(se, lid, "train", cu)
        assert e2.value.detail["required_step"] == "get_ready"
        assert _detail(se, lid, cu)["steps_completed"] == ["learn"]


def test_an_old_out_of_order_marker_is_repaired_instead_of_skipping_the_step_later():
    """Production briefly allowed Train to be completed before Learn/Get Ready.

    Hiding that bad marker is not enough: if it remains in storage, completing
    the missing prerequisites later would make Train silently become complete
    and the student would still skip it. The next legitimate completion repairs
    the per-lesson ledger back to the canonical prefix.
    """
    with _course() as (se, enr, cu, lid):
        _make_block_lesson(enr, lid)
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]},
            {"$set": {f"lesson_step_progress.{lid}": ["train"]}},
        ))
        d = _detail(se, lid, cu)
        assert "train" in _enrollment(enr)["lesson_step_progress"][lid]
        assert "train" not in d["steps_completed"]
        # The server gate must use the SAME legitimate prefix, not the raw
        # corrupt set. A stale Train marker cannot disappear from the lock
        # reason or make Practice closer to unlocked than the tracker shows.
        with pytest.raises(server.HTTPException) as practice_err:
            _start_practice_raw(se, lid, cu)
        assert practice_err.value.detail["error_code"] == "instructional_steps_incomplete"
        assert "train" in practice_err.value.detail["missing_steps"]
        with pytest.raises(server.HTTPException) as e:
            _complete_step(se, lid, "watch_for", cu)
        assert e.value.detail["required_step"] == "learn"

        _complete_step(se, lid, "learn", cu)
        assert _enrollment(enr)["lesson_step_progress"][lid] == ["learn"]
        _complete_step(se, lid, "get_ready", cu)
        assert _enrollment(enr)["lesson_step_progress"][lid] == ["learn", "get_ready"]
        # Train must still be the next real action; the stale marker cannot
        # resurrect itself after its prerequisites are satisfied.
        assert "train" not in _detail(se, lid, cu)["steps_completed"]
        _complete_step(se, lid, "train", cu)
        assert _detail(se, lid, cu)["steps_completed"][:3] == ["learn", "get_ready", "train"]


def test_completed_steps_stay_readable():
    # Progression must not become a one-way wizard.
    with _course() as (se, enr, cu, lid):
        _complete_step(se, lid, "learn", cu)
        d = _detail(se, lid, cu)
        assert d["lesson"]["client_overview"], "completed teaching material vanished"
        assert "learn" in d["steps_completed"]


# ---------------------------------------------------------------------------
# The Practice gate
# ---------------------------------------------------------------------------

def test_practice_is_locked_until_the_material_is_done():
    with _course() as (se, enr, cu, lid):
        d = _detail(se, lid, cu)
        assert d["practice_unlocked"] is False
        assert d["practice_locked_reason"], "a lock with no reason is not actionable"
        with pytest.raises(server.HTTPException) as e:
            _start_practice_raw(se, lid, cu)
        assert e.value.status_code == 403
        assert e.value.detail["error_code"] == "instructional_steps_incomplete"


def test_a_partially_finished_lesson_still_locks_practice():
    with _course() as (se, enr, cu, lid):
        _complete_step(se, lid, "learn", cu)          # one of two
        assert _detail(se, lid, cu)["practice_unlocked"] is False
        with pytest.raises(server.HTTPException) as e:
            _start_practice_raw(se, lid, cu)
        assert e.value.status_code == 403


def test_finishing_every_step_unlocks_practice():
    with _course() as (se, enr, cu, lid):
        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        d = _detail(se, lid, cu)
        assert d["practice_unlocked"] is True
        assert d["practice_locked_reason"] is None
        started = _start_practice_raw(se, lid, cu)
        assert started["homework_id"]


def test_the_lock_reason_names_what_is_outstanding():
    with _course() as (se, enr, cu, lid):
        reason = _detail(se, lid, cu)["practice_locked_reason"]
        assert "Learn" in reason or "lesson material" in reason, reason


def test_a_client_cannot_skip_ahead_by_completing_practice_itself():
    # "practice" and "quick_check" are not instructional steps; naming them
    # must not satisfy the gate.
    with _course() as (se, enr, cu, lid):
        for bogus in ("practice", "quick_check", "next_step", "not_a_step"):
            with pytest.raises(server.HTTPException) as e:
                _complete_step(se, lid, bogus, cu)
            assert e.value.status_code == 422, bogus
        assert _detail(se, lid, cu)["practice_unlocked"] is False


def test_the_gate_is_enforced_on_the_endpoint_not_only_in_the_payload():
    # The bypass this exists to stop: ignore the UI, call the API.
    with _course() as (se, enr, cu, lid):
        with pytest.raises(server.HTTPException):
            _start_practice_raw(se, lid, cu)
        # and the failed attempt left no partial state behind
        assert _detail(se, lid, cu)["steps_completed"] == []
        assert _enrollment(enr).get("learn_completed_lesson_ids") in (None, [])


def test_the_client_and_server_agree_on_when_the_sequence_is_shown():
    # If they disagreed in the unsafe direction — server gates, browser
    # renders flat — Practice would lock with no control to unlock it.
    import pathlib, re
    assert guide.GUIDE_MIN_CONTENT_STEPS == 1
    js = (pathlib.Path(__file__).resolve().parents[1] / "frontend" / "src" /
          "components" / "school" / "student" / "lesson" / "LessonGuide.jsx")
    m = re.search(r"GUIDE_MIN_CONTENT_STEPS = (\d+)", js.read_text(encoding="utf-8"))
    assert m and int(m.group(1)) == guide.GUIDE_MIN_CONTENT_STEPS, (
        "client and server disagree on when the guided sequence is shown")

# ---------------------------------------------------------------------------
# Quick Check follows Practice
# ---------------------------------------------------------------------------

def test_quick_check_is_locked_until_the_lesson_has_been_practised():
    with _course() as (se, enr, cu, lid):
        assert _detail(se, lid, cu)["quick_check_unlocked"] is False
        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        started = _start_practice_raw(se, lid, cu)
        # starting practice is not practising
        assert _detail(se, lid, cu)["quick_check_unlocked"] is False
        run(server.log_section(started["homework_id"],
                               server.SectionLogIn(section_id="practice"), cu))
        assert _detail(se, lid, cu)["quick_check_unlocked"] is True

def test_an_enrollment_from_before_this_rule_keeps_its_practice():
    # They passed the OLD learn boundary; the new one must not re-lock them.
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$addToSet": {"learn_completed_lesson_ids": lid}}))
        d = _detail(se, lid, cu)
        assert d["practice_unlocked"] is True, "a mid-course student was locked out"
        assert _start_practice_raw(se, lid, cu)["homework_id"]


def test_an_already_practised_lesson_is_never_re_locked():
    with _course() as (se, enr, cu, lid):
        started = run(_school_client_flow.start_practice(se["id"], lid, cu))
        run(server.log_section(started["homework_id"],
                               server.SectionLogIn(section_id="practice"), cu))
        # wipe the step record — simulating progress that predates the feature
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$unset": {"lesson_step_progress": ""}}))
        assert _detail(se, lid, cu)["practice_unlocked"] is True


def test_a_completed_lesson_does_not_regress():
    with _course(n_lessons=2) as (se, enr, cu, lid):
        started = run(_school_client_flow.start_practice(se["id"], lid, cu))
        run(server.log_section(started["homework_id"],
                               server.SectionLogIn(section_id="practice"), cu))
        run(server.portal_school_advance(se["id"], cu))
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$unset": {"lesson_step_progress": ""}}))
        d = _detail(se, lid, cu)
        assert d["status"] == "completed"
        assert d["practice_unlocked"] is True, "a finished lesson re-locked itself"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_a_client_cannot_write_progress_onto_another_clients_enrollment():
    with _course() as (se, enr, cu, lid):
        stranger = _client_user(str(uuid.uuid4()))
        with pytest.raises(server.HTTPException) as e:
            _complete_step(se, lid, "learn", stranger)
        assert e.value.status_code in (403, 404)
        assert _enrollment(enr).get("lesson_step_progress") in (None, {})


def test_a_client_cannot_read_another_clients_lesson_progress():
    with _course() as (se, enr, cu, lid):
        stranger = _client_user(str(uuid.uuid4()))
        with pytest.raises(server.HTTPException) as e:
            _detail(se, lid, stranger)
        assert e.value.status_code in (403, 404)


def test_progress_is_scoped_per_enrollment_not_per_lesson_id():
    # Two dogs on the same program must never share step progress.
    with _school_program(n_modules=1, n_lessons_per_module=1,
                         checkpoint_lesson_idx=99) as (prog, admin):
        with _client_and_dog() as (c1, d1), _client_and_dog() as (c2, d2):
            se1, e1 = _enroll(prog, d1, admin)
            se2, e2 = _enroll(prog, d2, admin)
            u1, u2 = _client_user(c1["id"]), _client_user(c2["id"])
            try:
                lid = run(server.db.dog_programs.find_one(
                    {"id": e1["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                _complete_step(se1, lid, "learn", u1)
                assert _detail(se1, lid, u1)["steps_completed"] == ["learn"]
                assert _detail(se2, lid, u2)["steps_completed"] == [], "progress leaked between dogs"
            finally:
                _cleanup_school(se1["id"], e1["id"])
                _cleanup_school(se2["id"], e2["id"])


# ---------------------------------------------------------------------------
# The existing Practice engine is untouched
# ---------------------------------------------------------------------------

def test_practice_still_runs_through_the_ordinary_engine():
    with _course() as (se, enr, cu, lid):
        started = run(_school_client_flow.start_practice(se["id"], lid, cu))
        hw = run(server.db.homework.find_one({"id": started["homework_id"]}, {"_id": 0}))
        assert hw and hw["dog_id"], "School forked its own practice engine"
        # unchanged: starting practice still records the old learn boundary
        assert lid in (_enrollment(enr).get("learn_completed_lesson_ids") or [])


def test_starting_practice_twice_returns_the_same_assignment():
    with _course() as (se, enr, cu, lid):
        a = run(_school_client_flow.start_practice(se["id"], lid, cu))
        b = run(_school_client_flow.start_practice(se["id"], lid, cu))
        assert a["homework_id"] == b["homework_id"]


# ---------------------------------------------------------------------------
# The compatibility shortcut must never become a new-user bypass
# ---------------------------------------------------------------------------

def test_a_new_student_cannot_trigger_the_legacy_shortcut_via_complete_lesson():
    """The regression that made this section exist.

    `learn_completed_lesson_ids` is what marks a pre-feature enrollment as
    already past the old boundary. `complete-lesson` also writes it, and used
    to accept ANY current lesson — so a brand-new student could call it on a
    practice-bearing lesson, land in the compatibility branch, and open
    Practice having read nothing.
    """
    with _course() as (se, enr, cu, lid):
        assert _detail(se, lid, cu)["practice_unlocked"] is False
        with pytest.raises(server.HTTPException) as e:
            run(server.portal_school_complete_lesson(se["id"], lid, cu))
        assert e.value.status_code == 422
        assert e.value.detail["error_code"] == "lesson_has_practice"
        # nothing was written, so the shortcut was never armed
        assert _enrollment(enr).get("learn_completed_lesson_ids") in (None, [])
        assert _detail(se, lid, cu)["practice_unlocked"] is False
        with pytest.raises(server.HTTPException) as e2:
            _start_practice_raw(se, lid, cu)
        assert e2.value.status_code == 403


def test_the_only_writer_of_the_legacy_signal_on_a_practice_lesson_is_gated():
    # Start-Practice is the sole remaining writer, and it runs the gate first.
    with _course() as (se, enr, cu, lid):
        with pytest.raises(server.HTTPException):
            _start_practice_raw(se, lid, cu)
        assert _enrollment(enr).get("learn_completed_lesson_ids") in (None, [])
        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        _start_practice_raw(se, lid, cu)
        assert lid in _enrollment(enr)["learn_completed_lesson_ids"]


def test_a_no_practice_lesson_still_answers_to_the_progression():
    # Complete is that lesson's terminal action, so it needs the material too.
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]},
            {"$set": {"program_snapshot.modules.0.lessons.0.suggested_homework_template_ids": []}}))
        with pytest.raises(server.HTTPException) as e:
            run(server.portal_school_complete_lesson(se["id"], lid, cu))
        assert e.value.status_code == 403
        assert e.value.detail["error_code"] == "instructional_steps_incomplete"
        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        out = run(server.portal_school_complete_lesson(se["id"], lid, cu))
        assert out["learn_completed"] is True


def test_a_genuine_pre_feature_enrollment_is_still_honoured():
    # The compatibility rule must keep working for data written before this
    # feature existed — that is the whole reason it is there.
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$addToSet": {"learn_completed_lesson_ids": lid}}))
        assert _detail(se, lid, cu)["practice_unlocked"] is True
        assert _start_practice_raw(se, lid, cu)["homework_id"]


def test_genuine_pre_feature_boundary_displays_material_as_complete_not_contradictory():
    """If old progress is being honoured, the tracker must not say Learn is
    current while Practice is already unlocked. With no guided ledger, the old
    boundary grants the whole instructional prefix for display purposes."""
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$addToSet": {"learn_completed_lesson_ids": lid}}))
        d = _detail(se, lid, cu)
        assert d["practice_unlocked"] is True
        assert d["steps_completed"] == d["instructional_steps"]


def test_legacy_signal_cannot_bypass_a_lesson_once_guided_tracking_has_started():
    """Legacy compatibility is only for a lesson with NO per-step ledger. Once
    the student enters the guided model, missing steps are authoritative even
    if an old/bad learn marker also exists."""
    with _course() as (se, enr, cu, lid):
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]},
            {"$set": {f"lesson_step_progress.{lid}": ["learn"]},
             "$addToSet": {"learn_completed_lesson_ids": lid}},
        ))
        d = _detail(se, lid, cu)
        assert d["steps_completed"] == ["learn"]
        assert d["practice_unlocked"] is False
        with pytest.raises(server.HTTPException) as blocked:
            _start_practice_raw(se, lid, cu)
        assert blocked.value.status_code == 403
        assert blocked.value.detail["error_code"] == "instructional_steps_incomplete"

def test_preprovisioned_practice_is_not_a_side_door_around_the_lesson_gate():
    """Online School pre-creates the current lesson's homework so Practice is
    instant when it unlocks. That implementation detail must not expose a
    second route through the School Practice screen or the generic homework
    API before Learn/Get Ready/Train/etc. are complete."""
    with _course() as (se, enr, cu, lid):
        hw = run(server._lesson_practice_homework(se["dog_id"], lid, enr["id"]))
        assert hw, "fixture should pre-provision the first lesson Practice"

        home = run(server.portal_school_home(se["id"], cu))
        assert hw["id"] not in {x["id"] for x in (home.get("active_practice") or [])}

        with pytest.raises(server.HTTPException) as open_err:
            run(server.get_homework_detail(hw["id"], cu))
        assert open_err.value.status_code == 409
        assert open_err.value.detail["error_code"] == "instructional_steps_incomplete"

        with pytest.raises(server.HTTPException) as log_err:
            run(server.log_section(hw["id"], server.SectionLogIn(section_id="practice"), cu))
        assert log_err.value.status_code == 409
        assert log_err.value.detail["error_code"] == "instructional_steps_incomplete"

        # Less-obvious generic Practice endpoints must not become side doors
        # either. Asking a Coach-mode question used to create a draft
        # section_log, and any non-empty section_logs list was then counted as
        # "practised". Video upload similarly interacted with Practice before
        # the lesson gate. Both are refused before writing anything.
        with pytest.raises(server.HTTPException) as ask_err:
            run(server.ask_section_question(
                hw["id"], "practice", server.DayQuestionIn(text="Can you help?"), cu))
        assert ask_err.value.status_code == 409
        assert ask_err.value.detail["error_code"] == "instructional_steps_incomplete"

        with pytest.raises(server.HTTPException) as video_err:
            run(server.upload_practice_video(
                hw["id"],
                server.CertificateUploadIn(photo="data:video/mp4;base64,AAAA", filename="practice.mp4"),
                cu))
        assert video_err.value.status_code == 409
        assert video_err.value.detail["error_code"] == "instructional_steps_incomplete"

        untouched = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
        assert untouched.get("section_logs") in (None, [])
        assert _detail(se, lid, cu)["practiced"] is False

        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        home2 = run(server.portal_school_home(se["id"], cu))
        assert hw["id"] in {x["id"] for x in (home2.get("active_practice") or [])}
        assert run(server.get_homework_detail(hw["id"], cu))["id"] == hw["id"]
        run(server.log_section(hw["id"], server.SectionLogIn(section_id="practice"), cu))
        assert _detail(se, lid, cu)["practiced"] is True


def test_client_cannot_mark_school_practice_complete_without_logging_a_session():
    """The generic Homework complete endpoint used to become a post-material
    shortcut: mark the pre-provisioned assignment completed -> practiced=True ->
    Quick Check unlocked, with no Practice log at all."""
    with _course() as (se, enr, cu, lid):
        d = _detail(se, lid, cu)
        for key in d["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        started = _start_practice_raw(se, lid, cu)

        with pytest.raises(server.HTTPException) as bypass:
            run(server.complete_homework(
                started["homework_id"], server.HomeworkCompleteIn(), cu))
        assert bypass.value.status_code == 409
        assert bypass.value.detail["error_code"] == "practice_session_required"
        assert _detail(se, lid, cu)["practiced"] is False

        run(server.log_section(started["homework_id"],
                               server.SectionLogIn(section_id="practice"), cu))
        completed = run(server.complete_homework(
            started["homework_id"], server.HomeworkCompleteIn(), cu))
        assert completed["status"] == "completed"
        assert _detail(se, lid, cu)["practiced"] is True


def test_practice_session_counts_ignore_question_placeholders_too():
    """Checkpoint remediation uses a numeric practice-session requirement. It
    must use the same definition as the lesson Practice gate."""
    with _course() as (se, enr, cu, lid):
        for key in _detail(se, lid, cu)["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        started = _start_practice_raw(se, lid, cu)
        hw_id = started["homework_id"]

        run(server.ask_section_question(
            hw_id, "practice", server.DayQuestionIn(text="Can you check this?"), cu))
        assert run(server._count_practice_sessions_since(hw_id, None)) == 0
        assert _detail(se, lid, cu)["practiced"] is False

        run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))
        assert run(server._count_practice_sessions_since(hw_id, None)) == 1
        assert _detail(se, lid, cu)["practiced"] is True


def test_draft_question_placeholder_is_not_a_practice_session():
    # Coach-mode questions may need a placeholder log to hold the thread. That
    # container is not evidence the dog was trained. A normal submitted
    # section log (no draft status) still counts exactly as before.
    base = {"daily_tracker": False, "status": "assigned"}
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"submission_status": "draft", "questions": [{"text": "help"}]}
    ]}) is False
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"section_id": "practice", "logged_at": "now"}
    ]}) is True


def test_daily_tracker_drafts_rest_and_skip_do_not_count_as_practice():
    base = {"daily_tracker": True, "status": "assigned"}
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"submission_status": "in_progress"}
    ]}) is False
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"submission_status": "rest", "is_rest_day": True}
    ]}) is False
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"submission_status": "skipped", "is_skipped": True}
    ]}) is False
    assert server._lesson_is_practiced({**base, "section_logs": [
        {"submission_status": "submitted"}
    ]}) is True
    assert server._lesson_is_practiced({**base, "section_logs": [], "status": "completed"}) is True


def test_home_action_moves_to_practice_as_soon_as_instructional_steps_are_done():
    """The legacy learn_completed signal is written by Start Practice, so Home
    must use the real guided-step state or it sends a student who just finished
    Step 5 back to 'Start lesson' instead of forward to Practice."""
    with _course() as (se, enr, cu, lid):
        d = _detail(se, lid, cu)
        for key in d["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        fresh = _enrollment(enr)
        assert lid not in set(fresh.get("learn_completed_lesson_ids") or [])
        home = run(server.portal_school_home(se["id"], cu))
        assert home["lesson_state"]["instructional_complete"] is True
        assert home["current_action"]["type"] == "practice"

# ---------------------------------------------------------------------------
# Final state-machine edge cases found in the consolidation audit
# ---------------------------------------------------------------------------

def test_completed_lesson_progress_is_review_only_even_by_direct_api_call():
    with _course(n_lessons=2) as (se, enr, cu, lid):
        _make_block_lesson(enr, lid)
        fresh = _enrollment(enr)
        second = fresh["program_snapshot"]["modules"][0]["lessons"][1]["id"]
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$set": {"current_lesson_id": second}}))

        with pytest.raises(server.HTTPException) as step_err:
            _complete_step(se, lid, "learn", cu)
        assert step_err.value.status_code == 409
        assert step_err.value.detail["error_code"] == "completed_lesson_read_only"




def test_inline_images_stay_with_the_authored_section_instead_of_all_falling_into_train():
    """The real free-course manifest puts a demonstration after Steps, a
    finished-position image after success criteria, and a mistake image after
    common mistakes. Guided grouping must preserve those semantic placements."""
    lesson = {"content_blocks": [
        {"id": "intro", "type": "text", "title": "What you are teaching", "body": "x", "order": 0},
        {"id": "steps", "type": "steps", "title": "Step-by-step lesson", "items": ["x"], "order": 1},
        {"id": "demo", "type": "image", "title": "Demonstration", "resource_id": "r1", "order": 2},
        {"id": "success", "type": "text", "title": "What a good repetition looks like", "body": "x", "order": 3},
        {"id": "finished", "type": "image", "title": "Finished position", "resource_id": "r2", "order": 4},
        {"id": "mistakes", "type": "text", "title": "Common mistakes to avoid", "body": "x", "order": 5},
        {"id": "wrong", "type": "image", "title": "Common mistake", "resource_id": "r3", "order": 6},
    ]}
    grouped = guide.group_blocks(lesson["content_blocks"])
    assert [b["id"] for b in grouped["train"]] == ["steps", "demo"]
    assert [b["id"] for b in grouped["know_got_it"]] == ["success", "finished"]
    assert [b["id"] for b in grouped["watch_for"]] == ["mistakes", "wrong"]


def test_historical_practice_log_cannot_override_an_incomplete_guided_ledger_for_advance_or_module_quiz():
    """Once a lesson has entered per-step tracking, an old Practice log is not
    permission to skip the remaining lesson material. This pins the downstream
    gates too, not only Start Practice."""
    with _course(n_lessons=1) as (se, enr, cu, lid):
        d = _detail(se, lid, cu)
        for key in d["instructional_steps"]:
            _complete_step(se, lid, key, cu)
        started = _start_practice_raw(se, lid, cu)
        run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
        assert _detail(se, lid, cu)["practiced"] is True

        # Simulate the production-shaped inconsistent history: Practice exists,
        # but this lesson's new guided ledger says only Learn is legitimately done.
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$set": {f"lesson_step_progress.{lid}": ["learn"]}}))
        d2 = _detail(se, lid, cu)
        assert d2["practiced"] is True
        assert d2["steps_completed"] == ["learn"]
        assert d2["practice_unlocked"] is False

        with pytest.raises(server.HTTPException) as adv:
            run(server.portal_school_advance(se["id"], cu))
        assert adv.value.status_code == 422
        assert adv.value.detail["error_code"] == "instructional_steps_incomplete"

        module_id = _enrollment(enr)["current_module_id"]
        quiz_cfg = {
            "enabled": True, "title": "Boundary Quiz", "passing_score": 80,
            "questions": [{
                "id": "q", "type": "multiple_choice", "question": "Ready?",
                "options": [{"id": "yes", "text": "Yes"}, {"id": "no", "text": "No"}],
                "correct_option_id": "yes",
            }],
        }
        run(server.db.dog_programs.update_one(
            {"id": enr["id"]}, {"$set": {"program_snapshot.modules.0.module_quiz": quiz_cfg}}))
        roadmap = run(server._school_roadmap(_enrollment(enr), se["dog_id"]))
        assert roadmap["current_lesson_instructional_complete"] is False
        assert roadmap["module_quiz_available"] is False
        quiz = run(server.portal_school_module_quiz(se["id"], module_id, cu))
        assert quiz["status"] == "locked"
        assert quiz["questions"] is None


def test_historical_practice_log_cannot_override_incomplete_material_for_checkpoint():
    """Checkpoint is downstream of material AND Practice. A stale real Practice
    log from an older build cannot make the checkpoint upload a side door."""
    with _school_program(n_modules=1, n_lessons_per_module=1,
                         checkpoint_lesson_idx=0) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin)
            cu = _client_user(client["id"])
            try:
                lid = _enrollment(enr)["current_lesson_id"]
                d = _detail(se, lid, cu)
                for key in d["instructional_steps"]:
                    _complete_step(se, lid, key, cu)
                started = _start_practice_raw(se, lid, cu)
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
                run(server.db.dog_programs.update_one(
                    {"id": enr["id"]}, {"$set": {f"lesson_step_progress.{lid}": ["learn"]}}))

                with pytest.raises(server.HTTPException) as blocked:
                    run(server.portal_school_submit_checkpoint(
                        se["id"], lid,
                        server.CheckpointSubmissionIn(
                            video="data:video/mp4;base64,AAAA", filename="proof.mp4"), cu))
                assert blocked.value.status_code == 422
                assert blocked.value.detail["error_code"] == "instructional_steps_incomplete"
            finally:
                _cleanup_school(se["id"], enr["id"])
