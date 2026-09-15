"""Training Experience Clarity Pass — Stage 3: the post-lesson client handoff
(`portal_school_home.journey.recap`).

Traced flow under test: trainer draft → complete_training_session →
training_session_log (client-safe + STAFF-ONLY fields) → homework created
with source_session_log_id and linked back as log.homework_created →
journey.recap on the client Today payload.

What these tests protect:
  * a real finalized session surfaces what_went_well / needs_work /
    next_lesson_focus / client_recap_note and the Practice it assigned;
  * private trainer fields (session_note, per-skill notes, booking/draft ids,
    activities) never reach the client payload, and raw enums never render;
  * prominence is DERIVED: prominent until the client starts that Practice,
    reduced after; with no Practice it fades after three days;
  * legacy logs missing the modern fields still yield a safe recap;
  * online enrollments with no trainer session get no recap at all;
  * two dogs, or two programs on one dog, never blend — and a newer session
    on ANOTHER enrollment never wins.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _client_user, _cleanup_school, TAG,
)
from test_trainer_lesson_workspace import (  # noqa: E402
    _open_draft, _record, _complete, _activity_for_skill, ADMIN,
)


def _enroll(prog, dog, admin, delivery_mode):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"], delivery_mode=delivery_mode), admin))
    return res["school_enrollment"], res["enrollment"]


@contextlib.contextmanager
def _course(delivery_mode="in_person", n_lessons=2):
    run(server.db.users.update_one({"id": ADMIN["id"]}, {"$set": {**ADMIN, "password_hash": "x", "active": True,
        "must_change_password": False, "needs_password": False, "token_version": 0}}, upsert=True))
    with _school_program(n_modules=1, n_lessons_per_module=n_lessons, checkpoint_lesson_idx=99) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin, delivery_mode)
            cu = _client_user(client["id"])
            s = {"dog_id": dog["id"], "enrollment_id": enr["id"], "se_id": se["id"],
                 "skill_ids": [g["id"] for g in prog["modules"][0]["goals"]], "prog": prog, "dog": dog}
            try:
                yield se, enr, cu, s
            finally:
                run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.training_session_drafts.delete_many({"enrollment_id": enr["id"]}))
                run(server.db.homework.delete_many({"dog_id": dog["id"]}))
                _cleanup_school(se["id"], enr["id"])


def _home(se, cu):
    return run(server.portal_school_home(se["id"], cu))


def _recap(se, cu):
    return _home(se, cu)["journey"]["recap"]


def _real_session(s, *, assign_practice=None, action="remain", **summary):
    """A genuinely finalized trainer session through the workspace API."""
    draft = _open_draft(s)
    aid = _activity_for_skill(draft, s["skill_ids"][0])
    fields = {
        "what_went_well": "Stayed on Place for 20 seconds while the door opened.",
        "needs_work": "Breaking position when someone walks in.",
        "next_lesson_focus": "Door distractions and longer duration.",
        "client_recap_note": "Lexi did great once we slowed the setup down. Keep resets calm.",
        "session_note": "PRIVATE-SESSION-NOTE owner argued about pricing",
        "practice_note": "Keep the leash loose and reset calmly if she gets up.",
    }
    fields.update(summary)
    _record(draft["id"], {aid: {
        "score": 4, "outcome": "improving",
        "notes": "PRIVATE-SKILL-NOTE handler timing is off",
        "client_observation": "Held Place for 20 seconds with mild distraction.",
    }}, **fields)
    kw = {} if assign_practice is None else {"assign_lesson_practice": assign_practice}
    return _complete(draft["id"], action=action, **kw)


def _log(hw_id, cu):
    run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))


def _bare_log(enr, dog, at=None, **fields):
    doc = {"id": f"sesslog-{uuid.uuid4().hex[:8]}", "dog_id": dog["id"], "enrollment_id": enr["id"],
           "by_user": f"{TAG} trainer", "at": at or server.now_iso()}
    doc.update(fields)
    run(server.db.training_session_log.insert_one(doc))
    return doc


import re

_FORBIDDEN = ("PRIVATE", "session_note", "advancement_reason", "draft_id", "booking_id", "activities",
              "goal_updates", "not_yet", "needs_more_work", "advance_next", "remain", "mastered")


def _assert_clean(obj):
    blob = str(obj)
    for bad in _FORBIDDEN:
        assert not re.search(rf"{bad}", blob), (bad, blob[:300])


# ---------------------------------------------------------------------------

def test_real_trainer_led_session_becomes_a_prominent_recap_with_its_practice():
    with _course("in_person") as (se, enr, cu, s):
        out = _real_session(s)
        assert out["homework_created"], "the lesson's Practice should be assigned by the session"
        home = _home(se, cu)
        r = home["journey"]["recap"]
        assert r["prominence"] == "prominent"
        assert r["lesson_name"] == "Lesson 1.1"
        assert r["went_well"] == "Stayed on Place for 20 seconds while the door opened."
        assert r["needs_work"] == "Breaking position when someone walks in."
        assert r["next_focus"] == "Door distractions and longer duration."
        assert r["trainer_message"].startswith("Lexi did great")
        assert r["outcome_label"] == "Staying on this lesson for now."
        assert r["observations"][0] == {"skill": "Skill M0L0", "observation": "Held Place for 20 seconds with mild distraction.", "outcome": "Improving"}
        p = r["practice"]
        assert p["id"] == out["homework_created"][0]
        assert p["state"] == "due" and r["practice_state"] == "due"
        assert p["title"] == "Lesson 1.1"
        assert p["note"].startswith("Keep the leash loose")
        # The linked row is the same row Today's practice list exposes — one canonical Practice.
        assert any(hw["id"] == p["id"] for hw in home["active_practice"])
        # LAST in the journey is the same session, told briefly.
        assert home["journey"]["last"]["kind"] == "session"


def test_private_trainer_fields_and_raw_enums_never_reach_the_client():
    with _course("in_person") as (se, enr, cu, s):
        _real_session(s)
        home = _home(se, cu)
        _assert_clean(home["journey"])
        _assert_clean(home["active_practice"])
        # And the raw log really does hold the private note (so the test proves stripping, not absence).
        raw = run(server.db.training_session_log.find_one({"enrollment_id": enr["id"]}, {"_id": 0}))
        assert "PRIVATE-SESSION-NOTE" in raw["session_note"]
        assert "PRIVATE-SKILL-NOTE" in raw["goal_updates"][0]["note"]


def test_prominence_reduces_once_the_client_starts_that_practice_and_stays_accessible():
    with _course("in_person") as (se, enr, cu, s):
        out = _real_session(s)
        hw_id = out["homework_created"][0]
        assert _recap(se, cu)["prominence"] == "prominent"
        _log(hw_id, cu)
        r = _recap(se, cu)
        assert r["prominence"] == "reduced"
        assert r["practice"]["state"] == "started" and r["practice"]["sessions_logged"] == 1
        # Still accessible: the recap content is intact, just not dominant.
        assert r["went_well"] and r["needs_work"] and r["next_focus"]


def test_practice_already_completed_reads_as_caught_up():
    with _course("in_person") as (se, enr, cu, s):
        out = _real_session(s)
        hw_id = out["homework_created"][0]
        run(server.db.homework.update_one({"id": hw_id}, {"$set": {"status": "completed", "completed_at": server.now_iso()}}))
        r = _recap(se, cu)
        assert r["practice"]["state"] == "completed" and r["prominence"] == "reduced"


def test_no_practice_assigned_is_explicit_and_fades_after_three_days():
    with _course("in_person") as (se, enr, cu, s):
        out = _real_session(s, assign_practice=False)
        assert not out["homework_created"]
        r = _recap(se, cu)
        assert r["practice"] is None and r["practice_state"] == "none"
        assert r["prominence"] == "prominent"
        old = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
        run(server.db.training_session_log.update_many({"enrollment_id": enr["id"]}, {"$set": {"at": old}}))
        assert _recap(se, cu)["prominence"] == "reduced"


def test_hybrid_recap_keeps_the_online_gate_honest():
    with _course("hybrid") as (se, enr, cu, s):
        _real_session(s)
        # Hybrid pre-provisions the lesson's Practice online; the session REUSES
        # that row and links it on the persisted log (not in the response's
        # "created" list) — the recap must follow the persisted link.
        log = run(server.db.training_session_log.find_one({"enrollment_id": enr["id"]}, {"_id": 0, "homework_created": 1}))
        r = _recap(se, cu)
        assert log["homework_created"] and r["practice"]["id"] == log["homework_created"][0]
        # Hybrid keeps the reading gate: the assigned Practice is real but locked
        # until the lesson material is done — the recap must say so, not hide it.
        assert r["practice"]["state"] == "locked" and r["prominence"] == "prominent"
        lid = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
        run(_school_client_flow.complete_instructional_steps(se["id"], lid, cu))
        assert _recap(se, cu)["practice"]["state"] == "due"


def test_online_enrollment_without_a_trainer_session_has_no_recap():
    with _course("online") as (se, enr, cu, s):
        assert _recap(se, cu) is None


def test_legacy_log_without_modern_fields_gives_a_minimal_safe_recap():
    with _course("in_person") as (se, enr, cu, s):
        _bare_log(enr, s["dog"], lesson_name_at_session="Place With Distractions")
        r = _recap(se, cu)
        assert r["lesson_name"] == "Place With Distractions"
        assert r["went_well"] is None and r["needs_work"] is None and r["next_focus"] is None
        assert r["trainer_message"] is None and r["practice"] is None
        assert r["prominence"] == "prominent"  # fresh session, nothing else to show
        assert "None" not in str({k: v for k, v in r.items() if v is not None})


def test_recap_note_is_dropped_when_it_only_repeats_the_summary_and_kept_when_it_adds_something():
    with _course("in_person") as (se, enr, cu, s):
        _bare_log(enr, s["dog"], what_went_well="Great focus today.", client_recap_note="Great focus today.")
        assert _recap(se, cu)["trainer_message"] is None
        run(server.db.training_session_log.delete_many({"enrollment_id": enr["id"]}))
        _bare_log(enr, s["dog"], what_went_well="Great focus today.", client_recap_note="Keep sessions short this week.")
        assert _recap(se, cu)["trainer_message"] == "Keep sessions short this week."


def test_client_observations_fall_back_when_the_summary_fields_are_empty():
    with _course("in_person") as (se, enr, cu, s):
        _bare_log(enr, s["dog"], goal_updates=[
            {"goal_id": "g1", "skill_name": "Place", "client_observation": "Held for 20 seconds.", "session_outcome": "improving", "note": "PRIVATE"},
            {"goal_id": "g2", "skill_name": "Door", "client_observation": "Breaks when the door opens.", "session_outcome": "needs_more_work", "note": "PRIVATE"},
        ])
        r = _recap(se, cu)
        assert r["went_well"] == "Place: Held for 20 seconds."
        assert r["needs_work"] == "Door: Breaks when the door opens."
        assert [o["outcome"] for o in r["observations"]] == ["Improving", "Needs more work"]
        _assert_clean(r)


def test_two_dogs_in_one_household_never_share_a_recap():
    with _course("in_person") as (se_a, enr_a, cu, s):
        dog_b = {"id": str(uuid.uuid4()), "name": f"{TAG} Dog B", "owner_id": s["dog"]["owner_id"], "breed": "Mix", "age_y": 2,
                 "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
        run(server.db.dogs.insert_one(dog_b))
        se_b, enr_b = _enroll(s["prog"], dog_b, ADMIN, "in_person")
        try:
            _real_session(s, what_went_well="Only dog A.")
            assert _recap(se_a, cu)["went_well"] == "Only dog A."
            assert _recap(se_b, cu) is None
        finally:
            run(server.db.training_session_log.delete_many({"enrollment_id": enr_b["id"]}))
            run(server.db.homework.delete_many({"dog_id": dog_b["id"]}))
            _cleanup_school(se_b["id"], enr_b["id"])
            run(server.db.dogs.delete_one({"id": dog_b["id"]}))


def test_two_programs_on_one_dog_and_a_newer_session_elsewhere_never_wins():
    with _course("in_person") as (se1, enr1, cu, s):
        with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog2, admin2):
            se2, enr2 = _enroll(prog2, s["dog"], ADMIN, "in_person")
            try:
                older = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
                _bare_log(enr1, s["dog"], at=older, what_went_well="Program one, earlier today.")
                _bare_log(enr2, s["dog"], what_went_well="Program two, just now.")
                r1, r2 = _recap(se1, cu), _recap(se2, cu)
                assert r1["went_well"] == "Program one, earlier today."
                assert r2["went_well"] == "Program two, just now."
                assert "Program two" not in str(r1) and "Program one" not in str(r2)
            finally:
                run(server.db.training_session_log.delete_many({"enrollment_id": enr2["id"]}))
                _cleanup_school(se2["id"], enr2["id"])


def test_newer_session_replaces_the_older_prominent_recap():
    with _course("in_person") as (se, enr, cu, s):
        _bare_log(enr, s["dog"], at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), what_went_well="Yesterday.")
        assert _recap(se, cu)["went_well"] == "Yesterday."
        _real_session(s, what_went_well="Today's lesson.")
        r = _recap(se, cu)
        assert r["went_well"] == "Today's lesson." and r["prominence"] == "prominent"
