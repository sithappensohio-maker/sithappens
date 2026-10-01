"""Saving a course live runs the checks Publish runs (audit #53).

"Save Live Now", "Create Program" and the Shop Manager save used to put a
course live without Publish's structural checks, so a broken lesson (a
checkpoint with no Practice, a timer with no duration, a link to a recipe
that's gone, ...) went live and students got stuck. Now a save that would
ADD a problem is refused with the problems in plain words; a problem the
live course already had doesn't block (a price edit or a one-at-a-time fix
still works) and is returned as `_live_problems`.

Disposable tag TEST_LIVE_SAVE.
"""
import copy
import inspect
import re
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run
from domains.school import structure_gate

TAG = "TEST_LIVE_SAVE"
ADMIN = {"id": f"{TAG}-owner", "role": "admin", "name": "Owner", "email": "live-save@test"}


def _module(name, order, lessons, quiz=None):
    return {"name": name, "order": order, "goals": [{"name": f"{name} skill"}],
            "lessons": [{"name": ln, "order": i, "active": True, "success_criteria": "ok",
                         "content_blocks": [{"type": "text", "title": "Intro", "body": "Hi"}]} for i, ln in enumerate(lessons)],
            **({"module_quiz": quiz} if quiz else {})}


def _body(modules, **extra):
    return server.ProgramIn(name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons",
                            format={"count": 2, "unit": "modules"}, price=50, delivery_mode="both",
                            modules=modules, **extra)


@pytest.fixture
def course():
    prog = run(server.create_program(_body([_module("Foundations", 0, ["Name game", "Hand target"]),
                                            _module("Distance", 1, ["Long line"])]), ADMIN))
    yield prog["id"]
    run(server.db.programs.delete_many({"id": prog["id"]}))
    run(server.db.homework_templates.delete_many({"name": {"$regex": f"^{TAG}"}}))


def _live(pid):
    return run(server.db.programs.find_one({"id": pid}, {"_id": 0}))


def _save(pid, doc):
    return run(server.update_program(pid, server.ProgramIn(**doc), cascade=False, save_as_draft=False, _=ADMIN))


def _refused(fn):
    with pytest.raises(server.HTTPException) as e:
        fn()
    assert e.value.status_code == 422
    assert e.value.detail["error_code"] == "course_structure_problems"
    return e.value.detail


def _break_live(pid, path, value):
    """Something broke the course after it went live (a recipe deleted
    elsewhere, an old save) — written straight to the stored course."""
    run(server.db.programs.update_one({"id": pid}, {"$set": {path: value}}))


def _timer(seconds, title="Hold"):
    return {"type": "timer", "title": title, "config": {"seconds": seconds}}


# ---- a save that adds a problem is refused -----------------------------------

def test_save_live_that_adds_a_broken_lesson_is_refused_and_nothing_is_written(course):
    before = _live(course)
    doc = copy.deepcopy(before)
    doc["modules"][0]["lessons"].append({"name": "Stay", "order": 2, "active": True,
                                         "content_blocks": [_timer(0)]})
    detail = _refused(lambda: _save(course, doc))
    [p] = detail["errors"]
    assert p["code"] == "timer_missing_duration" and "Stay" in p["plain"]
    assert (p["module_index"], p["lesson_index"]) == (0, 2), "a lesson that only got its id in this save is still findable"
    assert detail["msg"] == detail["message"] and "Nothing was saved" in detail["message"]
    assert _live(course)["modules"] == before["modules"]


def test_a_checkpoint_lesson_with_no_practice_is_refused(course):
    doc = _live(course)
    doc["modules"][0]["lessons"][1]["checkpoint"] = {
        "enabled": True, "title": "Check", "handler_criteria": [{"name": "Cue"}], "dog_criteria": [{"name": "Speed"}]}
    detail = _refused(lambda: _save(course, doc))
    assert [p["code"] for p in detail["errors"]] == ["checkpoint_without_practice"]


def test_a_fine_lesson_edited_into_a_broken_one_is_refused(course):
    doc = _live(course)
    doc["modules"][1]["lessons"][0]["content_blocks"][0] = {**doc["modules"][1]["lessons"][0]["content_blocks"][0],
                                                            "type": "video", "url": None, "resource_id": None}
    assert [p["code"] for p in _refused(lambda: _save(course, doc))["errors"]] == ["content_block_missing_source"]


def test_create_program_with_a_broken_lesson_is_refused_and_creates_nothing():
    body = _body([_module("Foundations", 0, ["Name game"])])
    body.modules[0].lessons[0].content_blocks.append(server.LessonContentBlockIn(type="rep_counter", title="Reps", config={"target": 0}))
    name = body.name
    detail = _refused(lambda: run(server.create_program(body, ADMIN)))
    assert detail["errors"][0]["code"] == "rep_counter_missing_target"
    assert run(server.db.programs.count_documents({"name": name})) == 0


# ---- a problem already live does not block -----------------------------------

def test_a_price_edit_on_a_course_that_is_already_broken_goes_through_and_says_so(course):
    _break_live(course, "modules.0.lessons.0.suggested_homework_template_ids", ["deleted-recipe"])
    doc = _live(course)
    doc["price"] = 75
    saved = _save(course, doc)
    assert _live(course)["price"] == 75
    assert saved["_live_problems"] == ["Module 'Foundations', lesson 'Name game' links a Practice recipe that no longer exists."]


def test_the_shop_manager_hide_toggle_on_a_broken_course_goes_through(course):
    _break_live(course, "modules.1.lessons.0.content_blocks.0.type", "video")
    doc = _live(course)
    doc["active"] = False
    _save(course, doc)
    assert _live(course)["active"] is False


def test_reordering_and_renaming_never_turn_an_old_problem_into_a_new_one(course):
    _break_live(course, "modules.0.lessons.1.content_blocks", [{"id": "blk-t", "type": "timer", "title": "Hold", "config": {}}])
    doc = _live(course)
    doc["modules"].reverse()
    for i, m in enumerate(doc["modules"]):
        m["order"], m["name"] = i, m["name"] + " (renamed)"
        m["lessons"].reverse()
        for j, lesson in enumerate(m["lessons"]):
            lesson["order"], lesson["name"] = j, lesson["name"] + "!"
    saved = _save(course, doc)
    assert len(saved["_live_problems"]) == 1 and "Hand target!" in saved["_live_problems"][0]


def test_fixing_one_old_problem_at_a_time_works(course):
    _break_live(course, "modules.0.lessons.0.content_blocks", [_timer(0) | {"id": "t1"}, _timer(0, "Again") | {"id": "t2"}])
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["content_blocks"][0]["config"]["seconds"] = 30
    saved = _save(course, doc)
    assert len(saved["_live_problems"]) == 1


def test_an_old_problem_never_lets_a_new_one_of_the_same_kind_through(course):
    _break_live(course, "modules.0.lessons.0.suggested_homework_template_ids", ["gone-1"])
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["suggested_homework_template_ids"].append("gone-2")
    detail = _refused(lambda: _save(course, doc))
    assert len(detail["errors"]) == 1 and detail["errors"][0]["homework_template_id"] == "gone-2"


def test_a_second_missing_prerequisite_on_the_same_skill_is_new(course):
    # Both problems carry the same identity (code + skill), so they are
    # counted, not merely matched.
    _break_live(course, "modules.0.goals.0.prerequisite_skill_ids", ["gone-skill-a"])
    doc = _live(course)
    doc["modules"][0]["goals"][0]["prerequisite_skill_ids"].append("gone-skill-b")
    assert [p["code"] for p in _refused(lambda: _save(course, doc))["errors"]] == ["broken_prerequisite"]


def test_fixing_one_block_while_breaking_another_in_the_same_lesson_is_refused(course):
    _break_live(course, "modules.0.lessons.0.content_blocks", [{"id": "t-old", **_timer(0)}])
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["content_blocks"] = [{"id": "t-old", **_timer(30)}, _timer(0, "New one")]
    assert len(_refused(lambda: _save(course, doc))["errors"]) == 1


def test_swapping_one_dead_recipe_link_for_another_is_new(course):
    _break_live(course, "modules.0.lessons.0.suggested_homework_template_ids", ["gone-1"])
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["suggested_homework_template_ids"] = ["gone-2"]
    assert _refused(lambda: _save(course, doc))["errors"][0]["homework_template_id"] == "gone-2"


def test_an_old_problem_on_something_stored_without_an_id_is_still_old(course):
    # A legacy block written before blocks had ids gets one minted by the save;
    # its problem must not suddenly count as new.
    _break_live(course, "modules.0.lessons.0.content_blocks", [_timer(0)])
    doc = _live(course)
    doc["price"] = 55
    saved = _save(course, doc)
    assert len(saved["_live_problems"]) == 1


def test_an_old_problem_and_a_new_one_together_list_only_the_new_one(course):
    _break_live(course, "modules.0.lessons.0.content_blocks", [{"id": "t-old", **_timer(0)}])
    doc = _live(course)
    doc["modules"][1]["lessons"][0]["content_blocks"].append(_timer(0, "New"))
    detail = _refused(lambda: _save(course, doc))
    assert len(detail["errors"]) == 1 and "Long line" in detail["errors"][0]["plain"]


def test_a_stored_timer_that_is_not_a_number_is_a_problem_not_a_crash(course):
    _break_live(course, "modules.0.lessons.0.content_blocks", [{"id": "t-txt", **_timer("30s")}])
    doc = _live(course)
    doc["price"] = 60
    saved = _save(course, doc)
    assert any("timer block with no duration" in p for p in saved["_live_problems"])
    v = run(server._validate_program_structure([{"id": "m", "lessons": [{"id": "l", "name": "L", "content_blocks": [
        {"id": "b", "type": "timer", "config": {"seconds": "2.5"}}]}]}]))
    assert v["valid"], "a decimal duration is a duration"


def test_a_second_final_assessment_is_refused_naming_both(course):
    final = {"enabled": True, "assessment_type": "final_assessment", "title": "Final",
             "handler_criteria": [{"id": "h", "name": "Cue"}], "dog_criteria": [{"id": "d", "name": "Speed"}]}
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(name=f"{TAG} Practice"), ADMIN))
    doc = _live(course)
    for lesson in (doc["modules"][1]["lessons"][0],):
        lesson.update(checkpoint=dict(final), suggested_homework_template_ids=[tpl["id"]])
    _save(course, doc)
    doc = _live(course)
    doc["modules"][0]["lessons"][0].update(checkpoint=dict(final), suggested_homework_template_ids=[tpl["id"]])
    detail = _refused(lambda: _save(course, doc))
    [p] = detail["errors"]
    assert p["code"] == "checkpoint_multiple_final_assessments"
    assert "'Name game' (Foundations)" in p["plain"] and "'Long line' (Distance)" in p["plain"]


def test_a_quiz_problem_names_the_question(course):
    doc = _live(course)
    doc["modules"][0]["module_quiz"] = {"enabled": True, "passing_score": 80, "questions": [
        {"id": "q1", "question": "Sit?", "options": [{"id": "a", "text": "Yes"}, {"id": "b", "text": "No"}], "correct_option_id": "a"},
        {"id": "q2", "question": "Down?", "options": [{"id": "a", "text": "Yes"}, {"id": "b", "text": "No"}], "correct_option_id": "zzz"}]}
    [p] = _refused(lambda: _save(course, doc))["errors"]
    assert p["code"] == "module_quiz_invalid_correct_option" and p["plain"].endswith("(question 2).")


# ---- what is not a live save is unchanged ------------------------------------

def test_a_draft_with_a_problem_still_saves(course):
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["content_blocks"].append(_timer(0))
    run(server.update_program(course, server.ProgramIn(**doc), cascade=False, save_as_draft=True, _=ADMIN))
    assert _live(course)["draft"]["modules"][0]["lessons"][0]["content_blocks"][-1]["type"] == "timer"


def test_the_refusal_reaches_the_screen_with_its_list(course):
    import datetime
    import jwt
    uid = f"{TAG}-u-{uuid.uuid4().hex[:6]}"
    run(server.db.users.insert_one({"id": uid, "role": "admin", "name": "QA", "email": f"{uid}@example.invalid",
                                    "password_hash": "x", "active": True, "token_version": 0}))
    now = datetime.datetime.now(datetime.timezone.utc)
    tok = jwt.encode({"sub": uid, "email": f"{uid}@example.invalid", "role": "admin", "ver": 0, "iat": now,
                      "exp": now + datetime.timedelta(hours=1), "type": "access"}, server.JWT_SECRET, algorithm=server.JWT_ALG)
    doc = _live(course)
    doc["modules"][0]["lessons"][0]["content_blocks"].append(_timer(0))
    payload = server.ProgramIn(**doc).model_dump(mode="json")

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.put(f"/api/programs/{course}", json=payload, headers={"Authorization": f"Bearer {tok}"})
    try:
        r = run(go())
    finally:
        run(server.db.users.delete_many({"id": uid}))
    assert r.status_code == 422, r.text[:300]
    d = r.json()["detail"]
    assert d["error_code"] == "course_structure_problems" and d["errors"][0]["plain"]


# ---- the rule itself ---------------------------------------------------------

def test_every_error_the_validator_can_raise_has_an_identity_rule():
    src = inspect.getsource(server._validate_program_structure)
    error_codes = set(re.findall(r'errors\.append\(\{\s*"code":\s*"([a-z_]+)"', src))
    assert error_codes, "the validator source moved — this guard must see its codes"
    assert error_codes <= structure_gate.KNOWN_CODES, error_codes - structure_gate.KNOWN_CODES


def test_an_unknown_code_counts_as_new_unless_everything_about_it_matches():
    live = [{"id": "m1", "lessons": [{"id": "l1"}]}]
    old = [{"code": "future_thing", "module_id": "m1", "lesson_id": "l1"}]
    same = [{"code": "future_thing", "module_id": "m1", "lesson_id": "l1"}]
    moved = [{"code": "future_thing", "module_id": "m1", "lesson_id": "fresh"}]
    assert structure_gate.split(same, old, live) == ([], same)
    assert structure_gate.split(moved, old, live) == (moved, [])
