"""Stage 8 — the simplified trainer decision rides on the UNCHANGED
advancement actions. These tests pin the backend facts the mapping relies
on, against the current School program model:

  Stay Here              → remain          pointer unchanged
  Ready for Next Lesson  → advance_next    next lesson, crosses the module boundary,
                                           stays on the final lesson (never auto-graduates)
  Needs Review           → assign_review   pointer unchanged, recorded as review work
  Ready to Complete      → complete_program (admin + graduation authority) → status completed
  Advanced               → admin-only; employee trainers 403; Front Desk cannot reach the route
  hybrid checkpoint gate blocks advance_next; trainer-led in-person is not gated
  retry is idempotent; one log; the completion response names the next step.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _auth, _clean, _complete, _ensure_skill_in_plan, _enrollment, _open_draft, _record, _seed,
)

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _ready(s, draft, skill_index=0):
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][skill_index], "Skill")
    _record(draft["id"], {aid: {"score": 4, "outcome": "passed", "client_observation": "Solid."}},
            what_went_well="Went well.", needs_work="Needs work.", next_lesson_focus="Next focus.", client_recap_note="Recap.")
    return draft


def _two_module_program(delivery_mode="in_person"):
    """Module 1 (2 lessons) + Module 2 (1 lesson) so the module boundary and the
    final lesson are both reachable through advance_next."""
    s = _seed(delivery_mode, lessons=2)
    prog = s["program"]
    m1 = prog["modules"][0]
    m2_goal = server.GoalIn(name="Heel")
    updated = run(server.update_program(
        prog["id"],
        server.ProgramIn(name=prog["name"], type="private_lessons", format={"count": 2, "unit": "modules"}, price=0, delivery_mode="both",
                         modules=[server.ModuleIn(id=m1["id"], name=m1["name"], order=0, goals=[server.GoalIn(**g) for g in m1["goals"]],
                                                  lessons=[server.LessonIn(id=l["id"], name=l["name"], order=l["order"], active=True, skill_ids=l["skill_ids"], success_criteria="5 in a row.") for l in m1["lessons"]]),
                                  server.ModuleIn(name="Module 2", order=1, goals=[m2_goal], lessons=[])]),
        cascade=True, save_as_draft=False, _=ADMIN))
    m2 = updated["modules"][1]
    updated = run(server.update_program(
        prog["id"],
        server.ProgramIn(name=prog["name"], type="private_lessons", format={"count": 2, "unit": "modules"}, price=0, delivery_mode="both",
                         modules=[server.ModuleIn(id=m1["id"], name=m1["name"], order=0, goals=[server.GoalIn(**g) for g in m1["goals"]],
                                                  lessons=[server.LessonIn(id=l["id"], name=l["name"], order=l["order"], active=True, skill_ids=l["skill_ids"], success_criteria="5 in a row.") for l in m1["lessons"]]),
                                  server.ModuleIn(id=m2["id"], name="Module 2", order=1, goals=[server.GoalIn(**g) for g in m2["goals"]],
                                                  lessons=[server.LessonIn(name="Heel Basics", order=0, active=True, skill_ids=[m2["goals"][0]["id"]], success_criteria="Ten steps.")])]),
        cascade=True, save_as_draft=False, _=ADMIN))
    enr = _enrollment(s)
    snap = enr["program_snapshot"]
    lessons = [(m["id"], l["id"], l["name"]) for m in snap["modules"] for l in server._effective_lessons(m)]
    assert len(lessons) == 3, lessons
    return s, lessons


def test_stay_here_finishes_the_session_but_keeps_the_pointer():
    s = _seed("in_person")
    before = _enrollment(s)["current_lesson_id"]
    draft = _ready(s, _open_draft(s))
    res = _complete(draft["id"], action="remain")
    assert res["session_log"]["advancement_action"] == "remain"
    assert res["enrollment"]["current_lesson_id"] == before
    assert res["enrollment"]["current_lesson_name"] == "Lesson 1" and res["enrollment"]["status"] == "active"
    assert _enrollment(s)["current_lesson_id"] == before
    assert run(server.db.training_session_log.count_documents({"enrollment_id": s["enrollment_id"]})) == 1


def test_needs_review_is_the_existing_assign_review_action_and_keeps_the_pointer():
    s = _seed("in_person")
    before = _enrollment(s)["current_lesson_id"]
    draft = _ready(s, _open_draft(s))
    res = _complete(draft["id"], action="assign_review", advancement_reason="Stay is not solid yet.")
    assert res["session_log"]["advancement_action"] == "assign_review"
    assert res["session_log"]["advancement_reason"] == "Stay is not solid yet."
    assert _enrollment(s)["current_lesson_id"] == before
    # there is no such thing as a needs_review action — the model rejects it
    with pytest.raises(Exception):
        server.SessionCompletionIn(advancement_action="needs_review")


def test_ready_for_next_lesson_moves_within_the_module_then_across_the_boundary_then_stays_on_the_final_lesson():
    s, lessons = _two_module_program()
    (m1, l1, _), (_, l2, n2), (m2, l3, n3) = lessons
    assert _enrollment(s)["current_lesson_id"] == l1
    # 1 → 2 (same module)
    res = _complete(_ready(s, _open_draft(s, label="v1"))["id"], action="advance_next")
    assert res["enrollment"]["current_lesson_id"] == l2 and res["enrollment"]["current_lesson_name"] == n2
    assert res["session_log"]["lesson_change"]["to_lesson_id"] == l2 and not res["session_log"].get("advanced_module")
    # 2 → 3 (module boundary — the engine handles it, the trainer chose the same thing)
    res = _complete(_ready(s, _open_draft(s, label="v2"), skill_index=1)["id"], action="advance_next")
    assert res["enrollment"]["current_module_id"] == m2 and res["enrollment"]["current_lesson_id"] == l3
    assert res["enrollment"]["current_lesson_name"] == n3 and res["enrollment"]["current_module_name"] == "Module 2"
    assert res["session_log"]["advanced_module"]
    # final lesson: advance_next never auto-graduates
    draft = _open_draft(s, label="v3")
    heel = next(a for a in draft["plan"]["activities"] if a.get("source") == "skill")
    _record(draft["id"], {heel["id"]: {"score": 5, "outcome": "reliable"}},
            what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    res = _complete(draft["id"], action="advance_next")
    assert res["session_log"]["at_final_lesson"] is True
    assert res["enrollment"]["status"] == "active" and res["enrollment"]["current_lesson_id"] == l3


def test_ready_to_complete_program_is_explicit_and_authorised():
    s, lessons = _two_module_program()
    m2, l3, _ = lessons[2]
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"current_module_id": m2, "current_lesson_id": l3}}))
    draft = _open_draft(s)
    heel = next(a for a in draft["plan"]["activities"] if a.get("source") == "skill")
    _record(draft["id"], {heel["id"]: {"score": 5, "outcome": "reliable"}},
            what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    res = _complete(draft["id"], action="complete_program")
    assert res["enrollment"]["status"] == "completed" and res["enrollment"]["program_name"] == s["program"]["name"]
    assert _enrollment(s)["status"] == "completed"
    # a retry of the same finish is idempotent — still one log, still completed
    again = _complete(draft["id"], action="complete_program")
    assert again["already_completed"] is True and again["session_log"]["id"] == res["session_log"]["id"]
    assert run(server.db.training_session_log.count_documents({"enrollment_id": s["enrollment_id"]})) == 1


def test_hybrid_checkpoint_blocks_ready_for_next_lesson_but_trainer_led_in_person_is_not_gated():
    hybrid = _seed("hybrid", checkpoint_on_lesson1=True)
    d = _ready(hybrid, _open_draft(hybrid))
    with pytest.raises(server.HTTPException) as e:
        _complete(d["id"], action="advance_next")
    assert e.value.status_code == 409 and e.value.detail["error_code"] == "checkpoint_required_before_advancement"
    assert run(server.db.training_session_drafts.find_one({"id": d["id"]}, {"_id": 0, "status": 1}))["status"] == "draft"
    # Stay Here still finishes the hybrid session
    assert _complete(d["id"], action="remain")["session_log"]["advancement_action"] == "remain"

    inperson = _seed("in_person", checkpoint_on_lesson1=True)
    d = _ready(inperson, _open_draft(inperson))
    res = _complete(d["id"], action="advance_next")
    assert res["enrollment"]["current_lesson_id"] == inperson["lesson_ids"][1], "in-person trainers control progression"


def _insert_staff(staff_role):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}", "role": "employee", "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False, "token_version": 0}))
    return uid, _auth(uid, email, "employee")


def test_employee_trainer_can_stay_or_advance_but_not_use_admin_overrides_and_front_desk_cannot_finish_at_all():
    s = _seed("in_person")
    trainer_id, trainer_h = _insert_staff("trainer")
    _fd_id, fd_h = _insert_staff("front_desk")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": trainer_id}}))
    url = f"/api/dogs/{s['dog_id']}/programs/{s['enrollment_id']}/training-session/draft"
    draft = run(_http.post(url, headers=trainer_h)).json()["draft"]
    aid = next(a["id"] for a in draft["plan"]["activities"] if a.get("source") == "skill")
    r = run(_http.put(f"/api/training-session-drafts/{draft['id']}", headers=trainer_h, json={
        "actuals": {aid: {"score": 4, "outcome": "passed"}}, "what_went_well": "w", "needs_work": "n", "next_lesson_focus": "f", "client_recap_note": "c"}))
    assert r.status_code == 200, r.text
    for action in ("advance_lesson", "advance_module", "skip_lesson", "reopen_previous_lesson", "complete_program"):
        r = run(_http.post(f"/api/training-session-drafts/{draft['id']}/complete", headers=trainer_h,
                           json={"advancement_action": action, "advancement_reason": "x"}))
        assert r.status_code == 403, (action, r.text)
    # Front Desk never reaches the workspace or its completion route
    r = run(_http.post(url, headers=fd_h))
    assert r.status_code == 403
    r = run(_http.post(f"/api/training-session-drafts/{draft['id']}/complete", headers=fd_h, json={"advancement_action": "remain"}))
    assert r.status_code == 403
    # the ordinary trainer choice works for the trainer
    r = run(_http.post(f"/api/training-session-drafts/{draft['id']}/complete", headers=trainer_h, json={"advancement_action": "advance_next"}))
    assert r.status_code == 200, r.text
    assert r.json()["enrollment"]["current_lesson_id"] == s["lesson_ids"][1]
