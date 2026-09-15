"""Stage 9 — same curriculum, different presentation.

Pins the backend side of the role split and, above all, CONSISTENCY: for one
enrollment the client roadmap, the client home, the trainer briefing, the
trainer workspace plan and the admin enrollment record all name the same
current lesson — before and after Stay Here / Ready for Next Lesson / program
completion — and never bleed across dogs or programs.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _clean, _client_user, _complete, _ensure_skill_in_plan, _enrollment, _open_draft, _open_session, _record, _seed,
)


def _surfaces(s, cu):
    """Every role's view of the current lesson for THIS enrollment."""
    detail = run(server.portal_school_detail(s["se_id"], cu))
    home = run(server.portal_school_home(s["se_id"], cu))
    draft, overview = _open_session(s)
    enr = _enrollment(s)
    return {
        "client_course": detail["roadmap"]["current_lesson"]["id"] if detail["roadmap"].get("current_lesson") else None,
        "client_today": (home.get("current_lesson") or {}).get("id"),
        "trainer_briefing": overview["briefing"]["today"]["lesson_name"],
        "trainer_guide": (overview.get("current_lesson_guide") or {}).get("lesson_id"),
        "trainer_plan": next((a.get("lesson_id") for a in draft["plan"]["activities"] if a.get("source") == "skill"), None),
        "admin_pointer": enr["current_lesson_id"],
        "status": enr["status"], "draft": draft,
    }


def _finish(s, draft, action):
    draft, aid = _ensure_skill_in_plan(draft, s["skill_ids"][0], "Sit")
    _record(draft["id"], {aid: {"score": 4, "outcome": "passed"}}, what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    return _complete(draft["id"], action=action)


def _assert_agree(view, lesson_id, lesson_name):
    assert view["client_course"] == lesson_id
    assert view["client_today"] == lesson_id
    assert view["trainer_guide"] == lesson_id
    assert view["trainer_plan"] == lesson_id
    assert view["admin_pointer"] == lesson_id
    assert view["trainer_briefing"] == lesson_name


def test_every_surface_agrees_before_and_after_stay_here_and_ready_for_next_lesson():
    s = _seed("in_person")
    cu = _client_user(s)
    l1, l2 = s["lesson_ids"]
    v = _surfaces(s, cu)
    _assert_agree(v, l1, "Lesson 1")
    # Stay Here → everyone stays on Lesson 1
    _finish(s, v["draft"], "remain")
    v = _surfaces(s, cu)
    _assert_agree(v, l1, "Lesson 1")
    # Ready for Next Lesson → everyone moves to Lesson 2 (a fresh draft label for the second visit)
    draft, _ = _open_session(s, label="second-visit")
    _finish(s, draft, "advance_next")
    detail = run(server.portal_school_detail(s["se_id"], cu))
    home = run(server.portal_school_home(s["se_id"], cu))
    _draft, overview = _open_session(s, label="third-visit")
    assert detail["roadmap"]["current_lesson"]["id"] == l2
    assert home["current_lesson"]["id"] == l2
    assert overview["briefing"]["today"]["lesson_name"] == "Lesson 2"
    assert overview["current_lesson_guide"]["lesson_id"] == l2
    assert _enrollment(s)["current_lesson_id"] == l2
    # the client sees Lesson 1 completed and Lesson 2 current — no surface still calls Lesson 1 current
    statuses = {l["id"]: l["status"] for m in detail["roadmap"]["modules"] for l in m["lessons"]}
    assert statuses[l1] == "completed" and statuses[l2] in ("available", "in_progress")


def test_program_completion_reads_consistently_everywhere():
    s = _seed("in_person", lessons=1)
    cu = _client_user(s)
    draft = _open_draft(s)
    res = _finish(s, draft, "complete_program")
    assert res["enrollment"]["status"] == "completed"
    detail = run(server.portal_school_detail(s["se_id"], cu))
    home = run(server.portal_school_home(s["se_id"], cu))
    assert detail["status"] == "completed"
    assert home["current_action"]["type"] == "course_complete"
    assert home["progress"]["course_pct"] == 100
    assert _enrollment(s)["status"] == "completed"
    # the curriculum history stays visible (roadmap modules still listed)
    assert detail["roadmap"]["modules"]


def test_trainer_guide_is_the_staff_projection_and_the_client_lesson_is_the_client_projection():
    s = _seed("in_person")
    cu = _client_user(s)
    enr = _enrollment(s)
    snap = enr["program_snapshot"]
    lesson = snap["modules"][0]["lessons"][0]
    lesson.update({"trainer_purpose": "PURPOSE-STAFF", "trainer_instructions": "TEACH-STAFF", "trainer_prep_notes": "PREP-STAFF",
                   "advancement_criteria": "ADVANCE-STAFF", "common_mistakes": "Luring too high.", "client_overview": "Client overview.",
                   "content_blocks": [{"id": "b1", "type": "image", "url": "data:image/png;base64,AAA", "config": {"alt": "Hand"}, "order": 1, "active": True}]})
    goal = snap["modules"][0]["goals"][0]
    goal.update({"pass_criteria": "5 clean sits", "trainer_only_guidance": "GUIDE-STAFF"})
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"program_snapshot": snap}}))
    _draft, overview = _open_session(s)
    g = overview["current_lesson_guide"]
    assert g["goal"] == "PURPOSE-STAFF" and g["how_to_teach"] == "TEACH-STAFF" and g["setup"] == "PREP-STAFF"
    assert g["watch_for"] == "Luring too high." and g["advancement_criteria"] == "ADVANCE-STAFF"
    assert g["skills"][0]["pass_criteria"] == "5 clean sits" and g["skills"][0]["trainer_only_guidance"] == "GUIDE-STAFF"
    assert g["content_blocks"][0]["id"] == "b1"  # same authored blocks, same image reference
    assert g["checkpoint"] is None
    # the client lesson never carries the staff fields, but does carry the same block
    client = run(server.portal_school_lesson_detail(s["se_id"], lesson["id"], cu))
    blob = str(client)
    for private in ("PURPOSE-STAFF", "TEACH-STAFF", "PREP-STAFF", "ADVANCE-STAFF", "GUIDE-STAFF"):
        assert private not in blob
    assert client["lesson"]["content_blocks"][0]["id"] == "b1" if "lesson" in client else "b1" in blob
    assert "Luring too high." in blob  # dual-audience field stays shared by design


def test_checkpoint_lesson_guide_carries_the_mark_scheme_only_for_staff():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    cu = _client_user(s)
    _draft, overview = _open_session(s)
    cp = overview["current_lesson_guide"]["checkpoint"]
    assert cp["title"] == "Checkpoint" and cp["pass_readiness_guidance"] == "3+ clean reps."
    assert cp["handler_criteria"][0]["name"] == "Cue clarity"
    assert overview["briefing"]["checkpoint"]["state"] == "ready"
    detail = run(server.portal_school_detail(s["se_id"], cu))
    assert "pass_readiness_guidance" not in str(detail["roadmap"]["checkpoint_rubric"])


def test_legacy_lesson_guide_has_no_blank_sections():
    s = _seed("in_person")
    enr = _enrollment(s)
    snap = enr["program_snapshot"]
    lesson = snap["modules"][0]["lessons"][0]
    for k in ("client_overview", "why_it_matters", "success_criteria", "trainer_instructions", "client_instructions", "common_mistakes"):
        lesson[k] = None
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"program_snapshot": snap}}))
    _draft, overview = _open_session(s)
    g = overview["current_lesson_guide"]
    assert g["goal"] is None and g["how_to_teach"] is None and g["watch_for"] is None and g["success_looks_like"] is None
    assert g["has_structured_content"] is False
    assert g["skills"] and g["skills"][0]["name"] == "Sit"
    assert "—" not in str({k: v for k, v in g.items() if v})


def test_two_dogs_and_two_programs_never_share_a_pointer_or_a_guide():
    s = _seed("in_person")
    other = _seed("in_person")
    # same template on a second dog of the same owner, moved to lesson 2
    dog_b = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": dog_b, "name": f"{TAG} Dog B", "owner_id": s["client"]["id"], "breed": "Mix", "age_y": 2,
                                  "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog_b, program_id=s["program"]["id"], delivery_mode="in_person"), ADMIN))
    sb = {**s, "dog_id": dog_b, "enrollment_id": res["enrollment"]["id"], "se_id": res["school_enrollment"]["id"]}
    _finish(sb, _open_draft(sb), "advance_next")
    # a second program on dog A
    res2 = run(server.school_enroll(server.SchoolEnrollIn(dog_id=s["dog_id"], program_id=other["program"]["id"], delivery_mode="in_person"), ADMIN))
    sp = {**s, "program": other["program"], "enrollment_id": res2["enrollment"]["id"], "se_id": res2["school_enrollment"]["id"], "skill_ids": other["skill_ids"], "lesson_ids": other["lesson_ids"]}
    cu = _client_user(s)
    a = _surfaces(s, cu); b = _surfaces(sb, cu); p = _surfaces(sp, cu)
    assert a["client_course"] == s["lesson_ids"][0] and a["admin_pointer"] == s["lesson_ids"][0]
    assert b["client_course"] == s["lesson_ids"][1] and b["admin_pointer"] == s["lesson_ids"][1]
    assert p["client_course"] == other["lesson_ids"][0] and p["trainer_guide"] == other["lesson_ids"][0]
    assert a["trainer_guide"] != b["trainer_guide"] or a["trainer_briefing"] != b["trainer_briefing"]
    assert p["trainer_guide"] != a["trainer_guide"]
