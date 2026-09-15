"""Stage 6 — Trainer 60-second briefing.

The briefing rides inside the EXISTING session-draft bootstrap envelope
(overview.briefing) — no second endpoint, no second fetch — and is built only
from records that already exist: the previous canonical session log for THIS
enrollment attempt, the enrollment's Practice/homework, checkpoint
submissions, client message threads and the curriculum snapshot.

Everything here pins scoping (one dog, one enrollment attempt), truthful
Practice adherence, client-vs-staff attribution, deterministic focus, the
resume-vs-start signal, legacy fallbacks and the permission boundary.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

# Reuse the workspace suite's canonical seed/open/record/complete helpers (and
# its autouse cleanup) so the briefing is exercised through the real spine.
from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _activity_for_skill, _auth, _clean, _complete, _ensure_skill_in_plan,
    _open_draft, _open_session, _pass_live_checkpoint, _record, _seed,
)

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _briefing(s, enrollment_id=None, label=None):
    _draft, overview = _open_session(s, enrollment_id=enrollment_id, label=label)
    return overview["briefing"]


def _session_with_summary(s, *, went_well="Held Place for 20 seconds with movement.",
                          needs_work="Breaks position when the door opens.",
                          next_focus="Door distractions.", score=3, outcome="improving", action="remain"):
    draft = _open_draft(s)
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    _record(draft["id"], {aid: {"score": score, "outcome": outcome, "client_observation": "Nice."}},
            what_went_well=went_well, needs_work=needs_work, next_lesson_focus=next_focus,
            client_recap_note="Nice work today.", session_note="PRIVATE trainer note never in the briefing")
    return _complete(draft["id"], action, assign_lesson_practice=False)


def _insert_hw(s, log_id=None, *, daily=False, total_days=0, logs=(), required=True, created_at=None, dog_id=None, title="Place Practice"):
    hw_id = str(uuid.uuid4())
    doc = {
        "id": hw_id, "dog_id": dog_id or s["dog_id"], "client_id": s["client"]["id"], "title": title,
        "school_lesson_name": title, "status": "assigned", "required": required,
        "created_at": created_at or server.now_iso(), "assigned_by": "Trainer",
        "school_enrollment_record_id": s["enrollment_id"], "school_enrollment_id": s["se_id"],
        "source_session_log_id": log_id, "daily_tracker": daily, "total_days": total_days,
        "template_snapshot": {"sections": [{"id": f"d{i}", "day_number": i, "title": f"Day {i}"} for i in range(1, total_days + 1)]
                              if daily else [{"id": "practice", "title": "Practice"}]},
        "section_logs": list(logs),
    }
    run(server.db.homework.insert_one(doc))
    return hw_id


def _day(n, status="submitted", note="", review_note=None, questions=(), **fv):
    return {"id": str(uuid.uuid4()), "section_id": f"d{n}", "day_number": n, "submission_status": status,
            "logged_at": server.now_iso(), "note": note, "review_note": review_note, "reviewed_by": "TLW Trainer" if review_note else None,
            "field_values": dict(fv), "questions": list(questions)}


def _log(note="", questions=(), **fv):
    return {"id": str(uuid.uuid4()), "section_id": "practice", "logged_at": server.now_iso(), "note": note,
            "field_values": dict(fv), "questions": list(questions)}


def _insert_thread(s, body, *, sender_role="client", category="training", reply=None, dog_id=None):
    now = server.now_iso()
    msgs = [{"id": str(uuid.uuid4()), "sender_role": sender_role, "sender_name": "Owner", "body": body, "created_at": now}]
    if reply:
        msgs.append({"id": str(uuid.uuid4()), "sender_role": "admin", "sender_name": "Garrett", "body": reply, "created_at": now})
    run(server.db.client_message_threads.insert_one({
        "id": str(uuid.uuid4()), "client_id": s["client"]["id"], "dog_id": dog_id or s["dog_id"], "category": category,
        "subject": f"{TAG} thread", "status": "open", "messages": msgs, "created_at": now, "last_message_at": now,
        "last_message_role": "admin" if reply else sender_role, "unread_admin": True,
    }))


def _insert_submission(s, lesson_id, *, status="pending", outcome=None, client_note="", prescription=None, graded_at=None):
    sub_id = str(uuid.uuid4())
    run(server.db.checkpoint_submissions.insert_one({
        "id": sub_id, "school_enrollment_id": s["se_id"], "enrollment_id": s["enrollment_id"], "dog_id": s["dog_id"],
        "client_id": s["client"]["id"], "lesson_id": lesson_id, "lesson_name": "Lesson 1", "client_note": client_note,
        "status": status, "outcome": outcome, "prescription": prescription, "trainer_feedback": "Nearly there.",
        "submitted_at": server.now_iso(), "graded_at": graded_at,
    }))
    return sub_id


# ---------------------------------------------------------------------------
# Today / mode / focus without history
# ---------------------------------------------------------------------------

def test_ordinary_trainer_led_lesson_names_today_and_falls_back_to_the_lesson_objective():
    s = _seed("in_person")
    b = _briefing(s)
    assert b["today"]["lesson_name"] == "Lesson 1"
    assert b["today"]["lesson_number"] == 1 and b["today"]["lesson_count"] == 2
    assert b["today"]["program_name"] == s["program"]["name"]
    assert b["today"]["training_mode"] == "in_person"
    assert b["today"]["is_checkpoint_lesson"] is False and b["checkpoint"] is None
    assert b["last_session"] is None
    assert b["practice"] == {**b["practice"], "state": "not_assigned", "headline": "No home Practice assigned yet."}
    assert b["client_reports"] == []
    assert b["focus"]["source"] == "lesson_objective" and b["focus"]["text"] == "5 in a row."
    assert b["attention"] == []
    # nothing internal leaks through the briefing keys
    assert "session_note" not in str(b) and "enrollment_id" not in str(b)


def test_hybrid_lesson_reports_hybrid_mode():
    s = _seed("hybrid")
    assert _briefing(s)["today"]["training_mode"] == "hybrid"


# ---------------------------------------------------------------------------
# Last session + focus
# ---------------------------------------------------------------------------

def test_previous_session_summary_scores_and_next_focus_drive_the_briefing():
    s = _seed("in_person")
    _session_with_summary(s)
    b = _briefing(s)
    last = b["last_session"]
    assert last["lesson_name"] == "Lesson 1" and last["by"] == ADMIN["name"] and last["when"] == "Today"
    assert last["what_went_well"].startswith("Held Place") and last["needs_work"].startswith("Breaks position")
    assert last["next_lesson_focus"] == "Door distractions."
    # Stage 13 — a session cannot be finished without an explicit mastery decision per
    # required skill, so the briefing always carries one (here: the trainer said not yet)
    assert last["skills"] == [{"name": "Sit", "score": 3, "assessment": "Improving", "mastery": "Not yet mastered"}]
    assert last["advancement_label"] == "Stayed on this lesson" and last["legacy"] is False
    assert last["same_lesson"] is True
    # previous focus wins; the lesson objective becomes the goal line
    assert b["focus"]["source"] == "previous_focus" and b["focus"]["text"] == "Door distractions."
    assert b["focus"]["goal"] == "5 in a row." and b["focus"]["conflict"] is None
    # the previous private note never rides along
    assert "PRIVATE" not in str(b)


def test_focus_conflict_is_shown_not_silently_resolved_when_the_lesson_moved_on():
    s = _seed("in_person")
    _session_with_summary(s, next_focus="Door distractions.", score=5, outcome="passed", action="advance_next")
    b = _briefing(s)
    assert b["today"]["lesson_name"] == "Lesson 2"
    assert b["last_session"]["same_lesson"] is False
    assert b["focus"]["text"] is None
    assert b["focus"]["conflict"] == {"previous": "Door distractions.", "previous_lesson": "Lesson 1", "current_objective": "5 in a row."}


def test_legacy_previous_session_gets_a_summary_line_and_no_blank_fields():
    s = _seed("in_person")
    run(server.db.training_session_log.insert_one({
        "id": f"sesslog-legacy-{uuid.uuid4().hex[:6]}", "dog_id": s["dog_id"], "enrollment_id": s["enrollment_id"],
        "at": "2026-09-03T10:00:00+00:00", "by_user": "Garrett", "lesson_name_at_session": "Lesson 1",
        "advancement_action": "remain",
    }))
    last = _briefing(s)["last_session"]
    assert last["legacy"] is True
    assert last["summary_line"] == "Completed with Garrett · Sep 3 · Stayed on this lesson"
    assert last["what_went_well"] is None and last["needs_work"] is None and last["next_lesson_focus"] is None
    assert last["skills"] == []


# ---------------------------------------------------------------------------
# Practice adherence + quality
# ---------------------------------------------------------------------------

def test_practice_fully_completed_partially_completed_and_none():
    s = _seed("in_person")
    out = _session_with_summary(s)
    log_id = out["session_log"]["id"]
    hw = _insert_hw(s, log_id, daily=True, total_days=3, logs=[_day(1, "approved", review_note="Great."), _day(2, "submitted"), _day(3, "submitted")])
    p = _briefing(s)["practice"]
    assert p["state"] == "completed" and p["headline"] == "3 of 3 planned days completed."
    assert p["planned"] == 3 and p["completed"] == 3 and p["last_practiced_label"] == "Today"
    assert "1 day approved by trainer" in p["quality"]

    run(server.db.homework.update_one({"id": hw}, {"$set": {"section_logs": [_day(1, "approved")]}}))
    p = _briefing(s)["practice"]
    assert p["state"] == "partial" and p["headline"] == "1 of 3 planned days completed."

    run(server.db.homework.update_one({"id": hw}, {"$set": {"section_logs": []}}))
    p = _briefing(s)["practice"]
    assert p["state"] == "none" and p["headline"] == "0 of 3 planned days completed."
    assert p["last_practiced_label"] is None


def test_no_practice_assigned_after_the_last_session_says_so():
    s = _seed("in_person")
    _session_with_summary(s)
    p = _briefing(s)["practice"]
    assert p["state"] == "not_assigned"
    assert p["headline"] == "No home Practice was assigned after the last session."


def test_optional_practice_is_never_framed_as_failure():
    s = _seed("in_person")
    out = _session_with_summary(s)
    _insert_hw(s, out["session_log"]["id"], required=False)
    p = _briefing(s)["practice"]
    assert p["state"] == "optional_incomplete" and p["headline"].startswith("Optional Practice")
    assert p["items"][0]["line"] == "Not started · optional"


def test_practice_needs_redo_leads_with_the_redo_and_the_trainer_note():
    s = _seed("in_person")
    out = _session_with_summary(s)
    _insert_hw(s, out["session_log"]["id"], daily=True, total_days=3,
               logs=[_day(1, "approved"), _day(2, "needs_redo", review_note="Slow down before the door.")])
    b = _briefing(s)
    assert b["practice"]["state"] == "needs_redo"
    assert b["practice"]["headline"] == "Day 2 of Place Practice was sent back for another try."
    assert b["practice"]["detail"] == "Slow down before the door."
    assert [a["kind"] for a in b["attention"]] == ["practice_redo"]


def test_section_log_practice_counts_real_sessions_and_reviews():
    s = _seed("in_person")
    out = _session_with_summary(s)
    _insert_hw(s, out["session_log"]["id"], logs=[
        {**_log(), "review_status": "looks_good", "reviewed_at": server.now_iso()},
        _log(__difficulty="very_hard"),
    ])
    b = _briefing(s)
    p = b["practice"]
    assert p["state"] == "partial" and p["headline"] == "2 Practice sessions logged since the last lesson."
    assert p["sessions_logged"] == 2 and p["review_waiting"] == 1  # the hard, unreviewed one needs a look
    assert "1 session reviewed: looked good" in p["quality"] and "Client marked 1 session hard" in p["quality"]
    assert {"kind": "practice_review", "text": "1 Practice session waiting for your review."} in b["attention"]


# ---------------------------------------------------------------------------
# Client-reported information — attribution
# ---------------------------------------------------------------------------

def test_client_practice_note_and_question_surface_as_client_reports():
    s = _seed("in_person")
    out = _session_with_summary(s)
    _insert_hw(s, out["session_log"]["id"], daily=True, total_days=2, logs=[
        _day(1, "submitted", note="Did well until visitors came over.",
             questions=[{"id": "q1", "text": "Reward every rep or space them out?", "asked_at": server.now_iso(), "answer": None}]),
    ])
    b = _briefing(s)
    kinds = sorted(r["kind"] for r in b["client_reports"])
    assert kinds == ["practice_note", "question"]
    note = next(r for r in b["client_reports"] if r["kind"] == "practice_note")
    assert note["text"] == "Did well until visitors came over." and note["source"] == "Practice note · Place Practice · Day 1"
    q = next(r for r in b["client_reports"] if r["kind"] == "question")
    assert q["unanswered"] is True
    assert {"kind": "client_question", "text": "1 client question unanswered."} in b["attention"]
    assert b["practice"]["state"] == "partial" and b["practice"]["review_waiting"] == 1


def test_staff_replies_and_unrelated_threads_are_never_client_reports():
    s = _seed("in_person")
    _insert_thread(s, "She barks at the mail carrier — normal?", reply="Totally normal at this stage.")
    _insert_thread(s, "Can I pay my boarding invoice next week?", category="billing")
    _insert_thread(s, "Reminder: bring the long line.", sender_role="admin")
    b = _briefing(s)
    texts = [r["text"] for r in b["client_reports"]]
    assert texts == ["She barks at the mail carrier — normal?"]
    assert "Totally normal" not in str(b) and "boarding invoice" not in str(b) and "long line" not in str(b)
    assert b["client_reports"][0]["unanswered"] is False  # staff answered last


# ---------------------------------------------------------------------------
# Checkpoint state
# ---------------------------------------------------------------------------

def test_checkpoint_ready_review_pending_remediation_and_passed():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    lesson1 = s["lesson_ids"][0]
    b = _briefing(s)
    assert b["today"]["is_checkpoint_lesson"] is True
    assert b["checkpoint"]["state"] == "ready" and b["checkpoint"]["action"] is None

    sub = _insert_submission(s, lesson1, client_note="Filmed in the park.")
    b = _briefing(s)
    assert b["checkpoint"]["state"] == "submitted" and b["checkpoint"]["action"] == "review"
    assert b["checkpoint"]["submission_id"] == sub and b["checkpoint"]["detail"].startswith("Client submitted Checkpoint today")
    assert {"kind": "checkpoint_review", "text": "Checkpoint submitted — review it before this lesson."} in b["attention"]
    assert any(r["kind"] == "checkpoint_note" and r["text"] == "Filmed in the park." for r in b["client_reports"])

    run(server.db.checkpoint_submissions.update_one({"id": sub}, {"$set": {
        "status": "graded", "outcome": "prescribe_practice", "graded_at": server.now_iso(),
        "prescription": {"action": "repeat_current_recipe", "min_practice_sessions_required": 2, "tracked_homework_id": None}}}))
    b = _briefing(s)
    assert b["checkpoint"]["state"] == "more_practice" and b["checkpoint"]["remaining"] == 2
    assert b["checkpoint"]["detail"] == "2 more Practice sessions before the client can try again."
    assert any(a["kind"] == "remediation" for a in b["attention"])

    # Graded "advance" while the pointer still sits on the checkpoint lesson
    # (online/hybrid grading) reads as passed + clear to advance.
    run(server.db.checkpoint_submissions.update_one({"id": sub}, {"$set": {"outcome": "advance", "prescription": None}}))
    b = _briefing(s)
    assert b["checkpoint"]["state"] == "passed" and b["checkpoint"]["detail"].startswith("Passed today")
    assert b["attention"] == []
    # A live in-person pass moves the pointer on: the next lesson has no
    # checkpoint, so the briefing simply shows the next lesson.
    run(server.db.checkpoint_submissions.delete_one({"id": sub}))
    _pass_live_checkpoint(s, lesson1)
    b = _briefing(s)
    assert b["today"]["lesson_name"] == "Lesson 2" and b["checkpoint"] is None


# ---------------------------------------------------------------------------
# Resume vs start
# ---------------------------------------------------------------------------

def test_active_draft_with_recorded_work_says_resume_and_never_creates_a_second_draft():
    s = _seed("in_person")
    draft, overview = _open_session(s, label="visit-resume")
    assert overview["briefing"]["session"] == {**overview["briefing"]["session"], "status": "draft", "has_recorded_work": False, "recorded_skills": 0}
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    _record(draft["id"], {aid: {"score": 4, "outcome": "improving"}})
    again, overview = _open_session(s, label="visit-resume")
    assert again["id"] == draft["id"]
    assert overview["briefing"]["session"]["has_recorded_work"] is True
    assert overview["briefing"]["session"]["recorded_skills"] == 1
    assert any(a["kind"] == "resume_session" for a in overview["briefing"]["attention"])
    n = run(server.db.training_session_drafts.count_documents({"enrollment_id": s["enrollment_id"], "status": "draft"}))
    assert n == 1


# ---------------------------------------------------------------------------
# Scoping — dogs and programs
# ---------------------------------------------------------------------------

def test_another_dog_in_the_same_household_never_leaks_into_the_briefing():
    s = _seed("in_person")
    # Dog B, same owner, same program; newer session, Practice and question.
    dog_b = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog_b, "name": f"{TAG} Dog B", "owner_id": s["client"]["id"], "breed": "Mix", "age_y": 2,
                                  "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog_b, program_id=s["program"]["id"], delivery_mode="in_person"), ADMIN))
    sb = {**s, "dog_id": dog_b, "enrollment_id": res["enrollment"]["id"], "se_id": res["school_enrollment"]["id"]}
    out_b = _session_with_summary(sb, next_focus="DOG-B FOCUS", went_well="DOG-B went well")
    _insert_hw(sb, out_b["session_log"]["id"], daily=True, total_days=2, logs=[_day(1, "submitted", note="DOG-B note",
               questions=[{"id": "qb", "text": "DOG-B question?", "asked_at": server.now_iso(), "answer": None}])])
    _insert_thread(sb, "DOG-B message")
    b = _briefing(s)
    assert b["last_session"] is None
    assert b["practice"]["state"] == "not_assigned"
    assert b["client_reports"] == [] and b["attention"] == []
    assert "DOG-B" not in str(b)
    # and dog B's own briefing sees its own context
    bb = _briefing(sb)
    assert bb["last_session"]["next_lesson_focus"] == "DOG-B FOCUS" and bb["practice"]["state"] == "partial"


def test_programs_never_blend_and_a_deliberately_selected_program_is_respected():
    s = _seed("in_person")
    other = _seed("in_person")  # gives us a second program
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=s["dog_id"], program_id=other["program"]["id"], delivery_mode="in_person"), ADMIN))
    sB = {**s, "program": other["program"], "enrollment_id": res["enrollment"]["id"], "se_id": res["school_enrollment"]["id"],
          "skill_ids": other["skill_ids"], "lesson_ids": other["lesson_ids"]}
    out_a = _session_with_summary(s, next_focus="PROGRAM-A FOCUS")
    _insert_hw(s, out_a["session_log"]["id"], daily=True, total_days=2, logs=[_day(1, "submitted", note="PROGRAM-A note")])
    # Two active programs: the explicit selection decides, never a blend.
    bA = _briefing(s)
    bB = _briefing(sB)
    assert bA["today"]["program_name"] == s["program"]["name"] and bA["last_session"]["next_lesson_focus"] == "PROGRAM-A FOCUS"
    assert bA["practice"]["state"] == "partial"
    assert bB["today"]["program_name"] == other["program"]["name"]
    assert bB["last_session"] is None and bB["practice"]["state"] == "not_assigned" and "PROGRAM-A" not in str(bB)
    # A completed historical program stays out of the active one.
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "completed"}}))
    bB = _briefing(sB)
    assert bB["last_session"] is None and "PROGRAM-A" not in str(bB)


# ---------------------------------------------------------------------------
# Permissions — real HTTP
# ---------------------------------------------------------------------------

def _insert_staff(staff_role):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}", "role": "employee", "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False, "token_version": 0}))
    return uid, _auth(uid, email, "employee")


def test_trainer_gets_the_briefing_and_front_desk_is_denied():
    s = _seed("in_person")
    trainer_id, trainer_h = _insert_staff("trainer")
    _fd_id, fd_h = _insert_staff("front_desk")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": trainer_id}}))
    url = f"/api/dogs/{s['dog_id']}/programs/{s['enrollment_id']}/training-session/draft"
    r = run(_http.post(url, headers=trainer_h))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolution"] == "ready" and body["overview"]["briefing"]["today"]["lesson_name"] == "Lesson 1"
    r = run(_http.post(url, headers=fd_h))
    assert r.status_code == 403, r.text
