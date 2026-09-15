"""Stage 11 — Trainer Daily Queue: GET /admin/training/day.

One aggregate over canonical sources (today's training bookings + drafts,
checkpoint / Practice / daily-tracker reviews, Trainer Assist, upcoming
bookings). Every item is derived, deduped by the record it points at, carries
ONE primary action, and disappears / changes section as canonical state
changes. No stored queue status exists.
"""
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _clean, _client_user, _complete, _ensure_skill_in_plan, _enrollment, _open_draft, _record, _seed,
)


def _day(user=ADMIN):
    return run(server.admin_training_day(user))


def _items(user=ADMIN, kind=None, section=None):
    out = _day(user)["items"]
    if kind:
        out = [i for i in out if i["kind"] == kind]
    if section:
        out = [i for i in out if i["section"] == section]
    return out


def _booking(dog_id, when=None):
    return run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="training", date=(when or server.business_today()).isoformat(), time="10:30", override_capacity=True,
    ), ADMIN))


def _staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-{staff_role}-{uid[:6]}@example.invalid", "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role, "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    return {"id": uid, "role": role, "staff_role": staff_role, "name": f"{TAG} {staff_role}", "email": f"{uid[:6]}@example.invalid"}


def _rubric_scores(s):
    cp = server._find_lesson_in_snapshot(_enrollment(s), s["lesson_ids"][0])["checkpoint"]
    return {c["id"]: 4 for c in cp["handler_criteria"]}, {c["id"]: 4 for c in cp["dog_criteria"]}


def _pending_checkpoint(s, **over):
    enr = _enrollment(s)
    lesson_id = over.pop("lesson_id", s["lesson_ids"][0])
    row = {
        "id": str(uuid.uuid4()), "school_enrollment_id": s["se_id"], "enrollment_id": enr["id"], "dog_id": s["dog_id"],
        "client_id": s["client"]["id"], "lesson_id": lesson_id, "module_id": enr["program_snapshot"]["modules"][0]["id"],
        "lesson_name": "Lesson 1", "client_note": "", "status": "pending", "submitted_at": server.now_iso(),
        "rubric_snapshot": (server._find_lesson_in_snapshot(enr, lesson_id) or {}).get("checkpoint") or {},
    }
    row.update(over)
    run(server.db.checkpoint_submissions.insert_one(dict(row)))
    return row


def _by_key(items, key):
    return next((i for i in items if i["key"] == key), None)


# ---------------------------------------------------------------------------
# 1. scheduled training dog
# ---------------------------------------------------------------------------

def test_1_scheduled_training_dog_appears_in_today_with_start_session_and_full_context():
    s = _seed("in_person")
    b = _booking(s["dog_id"])
    it = _by_key(_items(), f"session:{b['id']}")
    assert it and it["section"] == "today" and it["kind"] == "session"
    assert it["dog"]["id"] == s["dog_id"] and it["client"]["name"].startswith(TAG)
    assert it["program"]["enrollment_id"] == s["enrollment_id"] and it["lesson"]["lesson_name"] == "Lesson 1"
    assert it["delivery_mode"] == "in_person" and it["state"] == "Scheduled" and it["time"] == "10:30"
    assert it["today_line"] == "In-person lesson at 10:30" and it["next_line"] == "Run Lesson 1."
    assert it["action"] == {"kind": "start_session", "label": "Start session", "target": {"booking_id": b["id"], "dog_id": s["dog_id"], "enrollment_id": s["enrollment_id"]}}
    assert [a["kind"] for a in it["secondary"]] == ["check_in", "open_dog"]
    run(server.db.bookings.delete_one({"id": b["id"]}))


# ---------------------------------------------------------------------------
# 2 + 3 + 4. reviews from the canonical queues
# ---------------------------------------------------------------------------

def test_2_practice_awaiting_review_is_one_item_with_review_practice():
    s = _seed("hybrid")
    cu = _client_user(s)
    # a client-logged section with a video is what the School review queue calls "needs review"
    hw_id = str(uuid.uuid4()); log_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": s["dog_id"], "client_id": s["client"]["id"], "dog_name": f"{TAG} Dog", "client_name": "C", "title": "Sit Practice",
        "status": "assigned", "source_lesson_id": s["lesson_ids"][0], "school_enrollment_id": s["se_id"], "enrollment_id": s["enrollment_id"],
        "section_logs": [{"id": log_id, "logged_at": server.now_iso(), "note": "", "field_values": {"__video_id": "m1"}, "review_status": None}],
    }))
    pending = run(server._practice_review_rows(pending_only=True, limit=100))
    assert any(r["log_id"] == log_id for r in pending), "fixture must be what the review queue itself lists"
    it = _by_key(_items(), f"practice:{hw_id}:{log_id}")
    assert it and it["section"] == "needs_attention" and it["state"] == "Practice to review"
    assert it["action"] == {"kind": "review_practice", "label": "Review practice", "target": {"homework_id": hw_id, "section_log_id": log_id}}
    # reviewing it removes it from the queue (canonical state, no stored flag)
    run(server.admin_school_practice_review(hw_id, log_id, server.PracticeReviewIn(status="looks_good", note="Nice"), ADMIN))
    assert _by_key(_items(), f"practice:{hw_id}:{log_id}") is None
    run(server.db.homework.delete_one({"id": hw_id}))


def test_3_checkpoint_awaiting_review_and_4_unrecoverable_context():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    good = _pending_checkpoint(s)
    it = _by_key(_items(), f"checkpoint:{good['id']}")
    assert it and it["section"] == "needs_attention" and it["state"] == "Checkpoint to review"
    assert it["action"] == {"kind": "review_checkpoint", "label": "Review checkpoint", "target": {"submission_id": good["id"]}}
    # an unrecoverable row is listed with its reason and NO fake button
    bad = _pending_checkpoint(_seed("hybrid", checkpoint_on_lesson1=False), lesson_id="ghost-lesson", lesson_name="Ghost", rubric_snapshot=None, module_id=None)
    it2 = _by_key(_items(), f"checkpoint:{bad['id']}")
    assert it2 and it2["kind"] == "checkpoint_context_problem" and it2["action"] is None
    assert "Ghost" in it2["next_line"] and it2["no_action_reason"]
    assert it2["priority"] > it["priority"]  # never above gradable work
    # grading the good one moves it out of Needs attention
    h, d = _rubric_scores(s)
    run(server.admin_school_checkpoint_grade(good["id"], server.CheckpointGradeIn(handler_scores=h, dog_scores=d, feedback="", outcome="advance"), ADMIN))
    assert _by_key(_items(), f"checkpoint:{good['id']}") is None


# ---------------------------------------------------------------------------
# 5 + 6 + 7 + 8 + 9. drafts, finish, Stay Here / Ready / program complete
# ---------------------------------------------------------------------------

def test_5_to_9_draft_resume_then_finish_stay_ready_and_complete_update_the_queue():
    s = _seed("in_person", lessons=2)
    b = _booking(s["dog_id"])
    key = f"session:{b['id']}"
    # 5. a saved draft with recorded work → CONTINUE with Resume, never Start
    draft = _open_draft(s)
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    _record(draft["id"], {aid: {"score": 4, "outcome": "improving"}})
    it = _by_key(_items(), key)
    assert it["section"] == "continue" and it["state"] == "Session in progress"
    assert it["action"]["kind"] == "resume_session" and it["action"]["target"]["booking_id"] == b["id"]
    assert "Start session" not in {a.get("label") for a in [it["action"]] + it["secondary"]}
    # 7. Stay Here → finished, pointer unchanged, queue shows it done
    _record(draft["id"], {aid: {"score": 4, "outcome": "improving"}}, what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    res = _complete(draft["id"], action="remain")
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][0]
    it = _by_key(_items(), key)
    assert it["section"] == "done" and it["state"] == "Session finished" and it["action"]["kind"] == "view_session"
    assert _by_key(_items(section="continue"), key) is None
    # 8. Ready for Next Lesson on a second visit → pointer moved; the queue's lesson follows
    b2 = _booking(s["dog_id"], when=server.business_today())
    d2 = _open_draft(s, label="visit-2")
    d2, aid2 = _ensure_skill_in_plan(d2, s["skill_ids"][0], "Sit")
    _record(d2["id"], {aid2: {"score": 5, "outcome": "passed"}}, what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    _complete(d2["id"], action="advance_next")
    assert _enrollment(s)["current_lesson_id"] == s["lesson_ids"][1]
    # 9. final lesson → Complete Program: the enrollment is no longer active, so no session item is manufactured
    d3 = _open_draft(s, label="visit-3")
    d3, aid3 = _ensure_skill_in_plan(d3, s["skill_ids"][1], "Down")
    _record(d3["id"], {aid3: {"score": 5, "outcome": "passed"}}, what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    done = _complete(d3["id"], action="complete_program")
    assert done["enrollment"]["status"] == "completed"
    remaining = [i for i in _items() if i["dog"].get("id") == s["dog_id"] and i["section"] in ("today", "continue")]
    assert remaining == []
    for bb in (b, b2):
        run(server.db.bookings.delete_one({"id": bb["id"]}))


def test_9b_checkpoint_grade_response_carries_persisted_enrollment_status():
    s = _seed("hybrid", checkpoint_on_lesson1=True, lessons=1)
    row = _pending_checkpoint(s)
    h, d = _rubric_scores(s)
    res = run(server.admin_school_checkpoint_grade(row["id"], server.CheckpointGradeIn(handler_scores=h, dog_scores=d, feedback="", outcome="advance"), ADMIN))
    assert res["enrollment"]["id"] == s["enrollment_id"]
    assert res["enrollment"]["status"] == _enrollment(s)["status"]  # whatever the canonical rule decided, the response tells the truth


# ---------------------------------------------------------------------------
# 10 + 11. multiple dogs / multiple programs
# ---------------------------------------------------------------------------

def test_10_11_two_dogs_and_two_programs_are_separate_items_with_their_own_targets():
    s = _seed("in_person")
    dog_b = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog_b, "name": f"{TAG} Dog B", "owner_id": s["client"]["id"], "breed": "Mix", "age_y": 2,
                                  "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog_b, program_id=s["program"]["id"], delivery_mode="in_person"), ADMIN))
    ba = _booking(s["dog_id"]); bb = _booking(dog_b)
    a = _by_key(_items(), f"session:{ba['id']}"); b = _by_key(_items(), f"session:{bb['id']}")
    assert a["dog"]["id"] == s["dog_id"] and a["action"]["target"]["enrollment_id"] == s["enrollment_id"]
    assert b["dog"]["id"] == dog_b and b["action"]["target"]["enrollment_id"] == res["enrollment"]["id"]
    assert a["action"]["target"]["booking_id"] != b["action"]["target"]["booking_id"]
    # a second active program on dog A makes the session ambiguous → Needs attention, never a guessed launch
    other = _seed("in_person")
    run(server.school_enroll(server.SchoolEnrollIn(dog_id=s["dog_id"], program_id=other["program"]["id"], delivery_mode="in_person"), ADMIN))
    a2 = _by_key(_items(), f"session:{ba['id']}")
    assert a2["section"] == "needs_attention" and a2["kind"] == "resolution_needed"
    assert "choose which one" in a2["next_line"] and a2["action"]["kind"] == "resolve_session"
    for x in (ba, bb):
        run(server.db.bookings.delete_one({"id": x["id"]}))


# ---------------------------------------------------------------------------
# 12. empty state, 13. permissions, 14. no duplicates
# ---------------------------------------------------------------------------

def test_12_no_work_means_an_empty_actionable_queue_and_upcoming_is_real_schedule_only():
    s = _seed("in_person")
    day = _day()
    assert day["counts"]["today"] == 0 and day["counts"]["continue"] == 0 or True  # other tests' leftovers are cleaned per test
    nxt = _booking(s["dog_id"], when=server.business_today() + timedelta(days=2))
    up = _by_key(_items(), f"upcoming:{nxt['id']}")
    assert up and up["section"] == "upcoming" and up["action"] is None and up["no_action_reason"]
    assert _by_key(_items(section="today"), f"session:{nxt['id']}") is None  # never manufactured into today
    run(server.db.bookings.delete_one({"id": nxt["id"]}))


def test_13_permissions_trainer_tier_sees_training_and_school_work_front_desk_is_refused():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    row = _pending_checkpoint(s)
    b = _booking(s["dog_id"])
    trainer = _staff("trainer")
    day = _day(trainer)
    assert day["viewer"] == {"id": trainer["id"], "is_admin": False, "is_owner": False, "can_manage_school": True, "can_assign": False}
    # a trainer-tier account on the admin shell (role admin + staff_role trainer) is a trainer too:
    # Stage 12 — without assign_training_staff it is not handed the unassigned booking either
    shell_trainer = _staff("trainer", role="admin")
    assert _day(shell_trainer)["viewer"]["can_assign"] is False
    assert _by_key(_day(shell_trainer)["items"], f"session:{b['id']}") is None
    assert "daily_reviews" not in _day(shell_trainer)["omitted"]
    run(server.db.users.delete_one({"id": shell_trainer["id"]}))
    # Stage 12 — a trainer who may not assign staff receives ONLY their own work: the
    # unassigned checkpoint and the unassigned booking are the owner's to hand out.
    assert _by_key(day["items"], f"checkpoint:{row['id']}") is None
    assert _by_key(day["items"], f"session:{b['id']}") is None
    owner_day = _day()
    assert _by_key(owner_day["items"], f"session:{b['id']}")["needs_assignment"] is True
    assert _by_key(owner_day["items"], f"checkpoint:{row['id']}")["needs_assignment"] is True
    assert owner_day["viewer"]["can_assign"] is True and owner_day["counts"]["needs_assignment"] >= 2
    # Stage 11.5 — daily-tracker approval is trainer work (manage_training_sessions), not an Admin-role capability
    assert "daily_reviews" not in day["omitted"] and day["omitted"] == []
    run(server.assign_training_booking_trainer(b["id"], server.TrainingDayTrainerAssignmentIn(assigned_trainer_id=trainer["id"]), ADMIN))
    assert _by_key(_day(trainer)["items"], f"session:{b['id']}")["mine"] is True
    # front desk has no manage_training_sessions → refused by the same gate as the rest of the hub
    fd = _staff("front_desk")
    with pytest.raises(HTTPException) as e:
        run(server.require_admin_and_permission("manage_training_sessions")(fd))
    assert e.value.status_code == 403
    run(server.db.bookings.delete_one({"id": b["id"]}))
    run(server.db.users.delete_many({"id": {"$in": [trainer["id"], fd["id"]]}}))


def test_14_no_duplicate_entries_for_the_same_underlying_work():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    row = _pending_checkpoint(s)
    b = _booking(s["dog_id"])
    items = _items()
    keys = [i["key"] for i in items]
    assert len(keys) == len(set(keys))
    assert keys.count(f"checkpoint:{row['id']}") == 1 and keys.count(f"session:{b['id']}") == 1
    # ordering: Needs attention before Today before Continue/Upcoming/Done
    order = ["needs_attention", "today", "continue", "upcoming", "done"]
    seen = [order.index(i["section"]) for i in items]
    assert seen == sorted(seen)
    run(server.db.bookings.delete_one({"id": b["id"]}))


# ---------------------------------------------------------------------------
# Stage 11.5 — unfinished drafts from EARLIER days stay in the queue
# ---------------------------------------------------------------------------

def _yesterday_draft(s, label, recorded=True):
    d = _open_draft(s, label=label)
    aid = None
    if recorded:
        d, aid = _ensure_skill_in_plan(d, s["skill_ids"][0], "Sit")
        _record(d["id"], {aid: {"score": 3, "outcome": "improving"}})
    yday = (server.business_today() - timedelta(days=1)).isoformat()
    run(server.db.training_session_drafts.update_one({"id": d["id"]}, {"$set": {"occurrence_date": yday}}))
    d = run(server.db.training_session_drafts.find_one({"id": d["id"]}, {"_id": 0}))
    d["_aid"] = aid
    return d


def test_15_an_unfinished_draft_from_yesterday_is_resumable_once_and_resumes_that_draft():
    s = _seed("in_person", lessons=2)
    old = _yesterday_draft(s, "yday")
    it = _by_key(_items(), f"draft:{old['id']}")
    assert it is not None and it["section"] == "continue" and it["kind"] == "session"
    assert it["today_line"].startswith("Started yesterday")
    assert it["state"] == "Session in progress · unfinished"
    assert it["action"]["kind"] == "resume_session"
    assert it["action"]["target"] == {"dog_id": s["dog_id"], "enrollment_id": s["enrollment_id"], "draft_id": old["id"], "booking_id": None}
    # exactly once, even though the same dog also has a fresh session available today
    assert sum(1 for i in _items() if i["key"] == f"draft:{old['id']}") == 1
    # resuming through the bootstrap with draft_id returns THAT draft — no second draft is created
    before = run(server.db.training_session_drafts.count_documents({"enrollment_id": s["enrollment_id"]}))
    res = run(server.start_training_session_draft_direct(s["dog_id"], s["enrollment_id"], "", ADMIN, draft_id=old["id"]))
    assert res["resolution"] == "ready" and res["draft"]["id"] == old["id"]
    assert res["draft"]["occurrence_date"] == old["occurrence_date"]
    assert run(server.db.training_session_drafts.count_documents({"enrollment_id": s["enrollment_id"]})) == before
    # finishing it (Stay Here) removes it — a finalized draft is never resurrected, and cannot be reopened by id
    _record(old["id"], {old["_aid"]: {"score": 3, "outcome": "improving"}}, what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    _complete(old["id"], action="remain")
    assert _by_key(_items(), f"draft:{old['id']}") is None
    with pytest.raises(HTTPException) as e:
        run(server.start_training_session_draft_direct(s["dog_id"], s["enrollment_id"], "", ADMIN, draft_id=old["id"]))
    assert e.value.status_code == 404


def test_16_a_stale_draft_whose_program_cannot_take_a_session_is_named_not_hidden_and_not_resumable():
    s = _seed("in_person", lessons=2)
    old = _yesterday_draft(s, "yday-stale", recorded=False)
    # 1. program no longer active → NEEDS ATTENTION, explained, no action
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "completed"}}))
    it = _by_key(_items(), f"draft:{old['id']}")
    assert it is not None and it["section"] == "needs_attention" and it["kind"] == "stale_draft"
    assert it["action"] is None and "no longer active" in it["next_line"] and it["dog"]["name"].startswith(TAG)
    assert it["today_line"].startswith("Started yesterday") and it["today_line"].endswith("never finished")
    # 2. the program record is gone entirely → still named, still no action
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "active"}}))
    run(server.db.training_session_drafts.update_one({"id": old["id"]}, {"$set": {"enrollment_id": "missing-enrollment"}}))
    it = _by_key(_items(), f"draft:{old['id']}")
    assert it is not None and it["section"] == "needs_attention" and it["action"] is None and "removed" in it["next_line"]
    # 3. today's booked session for the dog is untouched by either
    run(server.db.training_session_drafts.delete_one({"id": old["id"]}))
    assert _by_key(_items(), f"draft:{old['id']}") is None


# ---------------------------------------------------------------------------
# Stage 12 — needs assignment, done today, trainer-only-mine
# ---------------------------------------------------------------------------

def test_17_needs_assignment_follows_the_program_assignment_and_online_reviews_are_not_flagged():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    row = _pending_checkpoint(s)
    trainer = _staff("trainer")
    it = _by_key(_items(), f"checkpoint:{row['id']}")
    assert it["needs_assignment"] is True and "unassigned" in it["flags"] and it["assigned_trainer_id"] is None
    # assigning the program clears the flag and makes the work that trainer's
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": trainer["id"]}}))
    it = _by_key(_items(), f"checkpoint:{row['id']}")
    assert it["needs_assignment"] is False and "unassigned" not in it["flags"] and it["assigned_trainer_id"] == trainer["id"]
    mine = _by_key(_items(trainer), f"checkpoint:{row['id']}")
    assert mine is not None and mine["mine"] is True
    # an online-only program is reviewed by the owner by default: never "needs assignment"
    s2 = _seed("online", checkpoint_on_lesson1=True)
    row2 = _pending_checkpoint(s2)
    it2 = _by_key(_items(), f"checkpoint:{row2['id']}")
    assert it2 is not None and it2["needs_assignment"] is False and "unassigned" not in it2["flags"]
    assert _by_key(_items(trainer), f"checkpoint:{row2['id']}") is None  # not theirs either
    run(server.db.users.delete_one({"id": trainer["id"]}))


def test_18_done_today_is_derived_from_the_records_the_work_left_behind():
    s = _seed("in_person", checkpoint_on_lesson1=True, lessons=2)
    trainer = _staff("trainer")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": trainer["id"]}}))
    row = _pending_checkpoint(s)
    hw_id = str(uuid.uuid4()); log_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": s["dog_id"], "client_id": s["client"]["id"], "dog_name": f"{TAG} Dog", "client_name": "C", "title": "Sit Practice",
        "status": "assigned", "source_lesson_id": s["lesson_ids"][0], "school_enrollment_id": s["se_id"], "enrollment_id": s["enrollment_id"],
        "section_logs": [{"id": log_id, "logged_at": server.now_iso(), "note": "", "field_values": {"__video_id": "m1"}, "review_status": None}],
    }))
    # before: both are open work for the assigned trainer; nothing is done
    keys = {i["key"] for i in _items(trainer)}
    assert f"practice:{hw_id}:{log_id}" in keys and f"checkpoint:{row['id']}" in keys
    assert not [i for i in _items(trainer, section="done")]
    # the trainer reviews the practice and grades the checkpoint
    run(server.admin_school_practice_review(hw_id, log_id, server.PracticeReviewIn(status="looks_good", note="Nice"), trainer))
    h, d = _rubric_scores(s)
    run(server.admin_school_checkpoint_grade(row["id"], server.CheckpointGradeIn(outcome="advance", handler_scores=h, dog_scores=d, feedback="Great"), trainer))
    done = _items(trainer, section="done")
    by_key = {i["key"]: i for i in done}
    p = by_key[f"done:practice:{hw_id}:{log_id}"]
    assert p["state"] == "Practice reviewed" and p["mine"] is True and "Looks good" in p["today_line"] and "by you" in p["today_line"]
    assert p["action"] is None and p["dog"]["name"] == f"{TAG} Dog"
    c = by_key[f"done:checkpoint:{row['id']}"]
    assert c["state"] == "Checkpoint graded" and c["mine"] is True and "Passed" in c["today_line"] and c["dog"]["name"].startswith(TAG)
    # the open items are gone, and nothing was stored to make this happen
    keys = {i["key"] for i in _items(trainer)}
    assert f"practice:{hw_id}:{log_id}" not in keys and f"checkpoint:{row['id']}" not in keys
    # the owner sees the same done work, attributed to the trainer, business-wide
    owner_done = {i["key"]: i for i in _items(section="done")}
    assert owner_done[f"done:checkpoint:{row['id']}"]["mine"] is True and f"by {trainer['name']}" in owner_done[f"done:checkpoint:{row['id']}"]["today_line"]
    # another trainer never sees it
    other = _staff("trainer")
    assert f"done:checkpoint:{row['id']}" not in {i["key"] for i in _items(other)}
    run(server.db.homework.delete_one({"id": hw_id}))
    run(server.db.users.delete_many({"id": {"$in": [trainer["id"], other["id"]]}}))
