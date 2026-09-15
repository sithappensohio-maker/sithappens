"""Stage 7 — the trainer workspace's Wrap Up rides on the UNCHANGED draft
pipeline. These tests pin what the reorganised UI relies on:

  * Save & Close = the autosaved draft keeps every value and re-opens as the
    same draft (no second draft), with the briefing reporting recorded work;
  * Finish Session = the canonical completion endpoint, whose validation stays
    authoritative (409 with the exact gaps the readiness panel mirrors);
  * finishing twice never duplicates the session log or the Practice;
  * hybrid lessons reuse the pre-provisioned Practice instead of creating one;
  * the checkpoint gate still blocks advancement;
  * the client-facing recap never carries the private notes the trainer typed
    in Train (session_note, per-skill notes).
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _activity_for_skill, _clean, _client_user, _complete, _ensure_skill_in_plan,
    _enrollment, _open_draft, _open_session, _record, _seed,
)
import _school_client_flow


def _lesson_practice(s, lesson_index=0):
    """Configure a real Practice recipe on a lesson the way Program Studio does."""
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        name=f"{TAG} Place Practice", tier="foundation", description="5 minutes, twice today.",
        sections=[{"name": "Practice", "items": [{"text": "5 reps"}]}]), ADMIN))
    enr = _enrollment(s)
    snap = enr["program_snapshot"]
    lesson = snap["modules"][0]["lessons"][lesson_index]
    lesson["suggested_homework_template_ids"] = [tpl["id"]]
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"program_snapshot": snap}}))
    return tpl


def _fill(s, draft, **over):
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    fields = dict(what_went_well="Held Place for 20 seconds.", needs_work="Breaks when the door opens.",
                  next_lesson_focus="Door distractions.", client_recap_note="Great session today.",
                  session_note="PRIVATE-SESSION-NOTE")
    fields.update(over)
    _record(draft["id"], {aid: {"score": 3, "outcome": "improving", "client_observation": "Held it with the door open.",
                                "notes": "PRIVATE-SKILL-NOTE"}}, **fields)
    return draft, aid


def test_save_and_close_keeps_every_value_and_reopens_the_same_draft():
    s = _seed("in_person")
    draft, overview = _open_session(s, label="")
    assert overview["briefing"]["session"]["has_recorded_work"] is False
    draft, aid = _fill(s, draft, what_went_well="Half done.", needs_work="", next_lesson_focus="", client_recap_note="")
    again, overview = _open_session(s, label="")
    assert again["id"] == draft["id"]
    assert again["actuals"][aid]["score"] == 3 and again["actuals"][aid]["outcome"] == "improving"
    assert again["actuals"][aid]["client_observation"] == "Held it with the door open."
    assert again["what_went_well"] == "Half done." and again["session_note"] == "PRIVATE-SESSION-NOTE"
    assert overview["briefing"]["session"]["has_recorded_work"] is True
    assert run(server.db.training_session_drafts.count_documents({"enrollment_id": s["enrollment_id"], "status": "draft"})) == 1


def test_finish_is_refused_with_the_exact_gaps_the_readiness_panel_mirrors():
    s = _seed("in_person")
    draft = _open_draft(s)
    with pytest.raises(server.HTTPException) as e:
        _complete(draft["id"], fill_record=False)  # Stage 13 — this test IS the refusal
    detail = e.value.detail
    # the assessment gate fires first for required lesson skills
    assert e.value.status_code == 409
    assert detail.get("error_code") == "lesson_assessment_incomplete" or detail.get("code") == "session_completion_incomplete"
    # once skills are recorded, the four Wrap Up fields are what remain
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    _record(draft["id"], {aid: {"score": 3, "outcome": "improving"}})
    with pytest.raises(server.HTTPException) as e:
        _complete(draft["id"], fill_record=False)  # Stage 13 — this test IS the refusal
    gaps = e.value.detail["gaps"]
    assert gaps == ["Add What Went Well", "Add Needs Work", "Add Next Session Focus",
                    "Add the client recap, or turn off Send Recap for this session"]
    # turning the recap off removes only that requirement
    with pytest.raises(server.HTTPException) as e:
        _complete(draft["id"], send_recap=False, fill_record=False)
    assert e.value.detail["gaps"] == ["Add What Went Well", "Add Needs Work", "Add Next Session Focus"]
    # the draft is untouched by the refusals
    assert run(server.db.training_session_drafts.find_one({"id": draft["id"]}, {"_id": 0, "status": 1}))["status"] == "draft"
    assert run(server.db.training_session_log.count_documents({"enrollment_id": s["enrollment_id"]})) == 0


def test_finish_creates_one_log_and_one_practice_and_a_retry_reuses_both():
    s = _seed("in_person")
    _lesson_practice(s)
    draft = _open_draft(s)
    draft, aid = _fill(s, draft)
    first = _complete(draft["id"], assign_lesson_practice=True)
    assert first["already_completed"] is False
    log_id = first["session_log"]["id"]
    assert first["session_log"]["homework_created"], "the lesson's Practice is created through the engine"
    hw_id = first["session_log"]["homework_created"][0]
    # a retry (double tap / reopened tab) is idempotent
    second = _complete(draft["id"], assign_lesson_practice=True)
    assert second["already_completed"] is True
    assert second["session_log"]["id"] == log_id
    assert run(server.db.training_session_log.count_documents({"enrollment_id": s["enrollment_id"]})) == 1
    assert run(server.db.homework.count_documents({"dog_id": s["dog_id"]})) == 1
    hw = run(server.db.homework.find_one({"id": hw_id}, {"_id": 0}))
    assert hw["source_session_log_id"] == log_id and hw["school_enrollment_id"] == s["se_id"]
    # re-opening the same occurrence shows the completed session, not a new draft
    res = run(server.start_training_session_draft_direct(s["dog_id"], s["enrollment_id"], draft["session_label"], ADMIN))
    assert res["draft"]["id"] == draft["id"] and res["draft"]["status"] == "completed"
    assert run(server.db.training_session_drafts.count_documents({"enrollment_id": s["enrollment_id"]})) == 1


def test_hybrid_finish_reuses_the_pre_provisioned_practice():
    s = _seed("hybrid")
    _lesson_practice(s)
    # Hybrid pre-provisions the lesson's Practice for the client online.
    cu = _client_user(s)
    lesson_id = _enrollment(s)["current_lesson_id"]
    run(_school_client_flow.complete_instructional_steps(s["se_id"], lesson_id, cu))
    pre = run(server.portal_school_start_practice(s["se_id"], lesson_id, cu))["homework_id"]
    draft = _open_draft(s)
    draft, aid = _fill(s, draft)
    res = _complete(draft["id"], assign_lesson_practice=True)
    log = run(server.db.training_session_log.find_one({"id": res["session_log"]["id"]}, {"_id": 0, "homework_created": 1}))
    assert log["homework_created"] == [pre], "the session links the existing Practice — no second copy"
    assert res["session_log"]["homework_created"] == [] or res["session_log"]["homework_created"] == [pre]
    assert run(server.db.homework.count_documents({"dog_id": s["dog_id"]})) == 1
    assert res["homework_conflicts"] == [] or all(c["existing_homework_id"] == pre for c in res["homework_conflicts"])


def test_checkpoint_gate_still_blocks_advancing_and_remaining_is_allowed():
    # Hybrid keeps the checkpoint gate (in-person trainers control progression
    # themselves — `trainer_controls_in_person_progression`).
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    draft = _open_draft(s)
    draft, aid = _fill(s, draft)
    with pytest.raises(server.HTTPException) as e:
        _complete(draft["id"], action="advance_next")
    assert e.value.status_code == 409 and e.value.detail["error_code"] == "checkpoint_required_before_advancement"
    assert run(server.db.training_session_drafts.find_one({"id": draft["id"]}, {"_id": 0, "status": 1}))["status"] == "draft"
    res = _complete(draft["id"], action="remain")
    assert res["session_log"]["advancement_action"] == "remain"
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][0]


def test_client_recap_after_finish_carries_the_handoff_fields_and_never_the_private_notes():
    s = _seed("in_person")
    _lesson_practice(s)
    draft = _open_draft(s)
    draft, aid = _fill(s, draft)
    _complete(draft["id"], assign_lesson_practice=True)
    cu = _client_user(s)
    home = run(server.portal_school_home(s["se_id"], cu))
    recap = home["journey"]["recap"]
    assert recap["went_well"] == "Held Place for 20 seconds." and recap["needs_work"] == "Breaks when the door opens."
    assert recap["next_focus"] == "Door distractions." and recap["trainer_message"] == "Great session today."
    assert recap["practice"] and recap["practice"]["title"]
    assert home["journey"]["last"]["kind"] == "session" if "kind" in home["journey"]["last"] else home["journey"]["last"]
    blob = str(home)
    assert "PRIVATE-SESSION-NOTE" not in blob and "PRIVATE-SKILL-NOTE" not in blob
    # the Practice reaches DO THIS TODAY
    assert any(r.get("session_linked") for r in home["active_practice"])
