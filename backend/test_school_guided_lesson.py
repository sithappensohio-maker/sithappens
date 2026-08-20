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


# ---------------------------------------------------------------------------
# Nobody mid-course gets stranded
# ---------------------------------------------------------------------------

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
