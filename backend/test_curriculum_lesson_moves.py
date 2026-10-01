"""A course edit pushed to enrolled students never strands one (audit #52).

Saving a course with "update enrolled dogs" (or publishing a draft that way)
left anyone sitting on a removed lesson pointed at a lesson that no longer
existed — Continue failed and nothing could move them. The push now moves
them to the nearest lesson that still exists (domains/school/curriculum_moves)
and the preview says who will move where.

Course used here: M1 [A, B, C] · M2 [D, E] · M3 [F].
Disposable tag TEST_LESSON_MOVES.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.school import curriculum_moves

TAG = "TEST_LESSON_MOVES"
ADMIN = {"id": f"{TAG}-owner", "role": "admin", "name": "Owner", "email": "lesson-moves@test"}
BASE = [("M1", ["A", "B", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])]


def _quiz(mname):
    """A Module Quiz good enough to save live (audit #53 runs Publish's checks on every save)."""
    return server.ModuleQuizConfigIn(enabled=True, questions=[server.ModuleQuizQuestionIn(
        id=f"q-{mname}", question="Where does the treat go?", correct_option_id="o1", explanation="Above the nose.",
        options=[server.ModuleQuizOptionIn(id="o1", text="Above the nose"), server.ModuleQuizOptionIn(id="o2", text="On the floor")])])


def _program_in(spec, ids=None, quiz=(), inactive=()):
    ids = ids or {}
    modules = []
    for mi, (mname, lnames) in enumerate(spec):
        gid = ids.get(("g", mname))
        goal = server.GoalIn(**({"id": gid} if gid else {}), name=f"{mname} skill")
        lessons = [server.LessonIn(**({"id": ids[("l", ln)]} if ("l", ln) in ids else {}), name=ln, order=i, active=ln not in inactive,
                                   skill_ids=[gid] if gid else [], success_criteria="ok") for i, ln in enumerate(lnames)]
        modules.append(server.ModuleIn(**({"id": ids[("m", mname)]} if ("m", mname) in ids else {}), name=mname, order=mi,
                                       goals=[goal], lessons=lessons,
                                       module_quiz=_quiz(mname) if mname in quiz else None))
    return server.ProgramIn(name=f"{TAG} {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 3, "unit": "modules"},
                            price=0, delivery_mode="both", modules=modules)


def _ids(prog):
    out = {}
    for m in prog["modules"]:
        out[("m", m["name"])] = m["id"]
        for g in m.get("goals") or []:
            out[("g", m["name"])] = g["id"]
        for lesson in m.get("lessons") or []:
            out[("l", lesson["name"])] = lesson["id"]
    return out


@pytest.fixture
def course():
    prog = run(server.create_program(_program_in(BASE), ADMIN))
    prog = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
    yield prog, _ids(prog)
    run(server.db.programs.delete_many({"id": prog["id"]}))
    run(server.db.dog_programs.delete_many({"program_id": prog["id"]}))
    run(server.db.dogs.delete_many({"id": {"$regex": f"^{TAG}"}}))


def _enroll(prog, ids, lesson, *, module=None, channel="in_person_school", **extra):
    module = module or next(m for m, ls in BASE if lesson in ls)
    dog_id = f"{TAG}-dog-{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": dog_id, "name": f"Rex {lesson}", "owner_id": f"{TAG}-c"}))
    enr = {"id": f"{TAG}-enr-{uuid.uuid4().hex[:6]}", "program_id": prog["id"], "dog_id": dog_id, "status": "active",
           "delivery_channel": channel, "program_snapshot": {"modules": prog["modules"]},
           "current_module_id": ids[("m", module)], "current_lesson_id": ids[("l", lesson)] if lesson else None,
           "goal_progress": server._empty_progress(prog["modules"]), "learn_completed_lesson_ids": [ids[("l", "A")]], **extra}
    run(server.db.dog_programs.insert_one(dict(enr)))
    return enr


def _save(prog, ids, spec, cascade=True, quiz=(), inactive=()):
    return run(server.update_program(prog["id"], _program_in(spec, ids, quiz, inactive), cascade=cascade, save_as_draft=False, _=ADMIN))


def _at(enr):
    row = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0}))
    return row["current_module_id"], row["current_lesson_id"], row


def _named(saved_or_prog, ids_unused=None):
    """name lookup for the program as saved now (new lessons get new ids)."""
    return _ids(run(server.db.programs.find_one({"id": saved_or_prog["id"]}, {"_id": 0})))


def test_on_a_removed_lesson_you_move_to_the_next_lesson_in_the_module(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    saved = _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    assert _at(enr)[:2] == (ids[("m", "M1")], ids[("l", "C")])
    assert [m["rule"] for m in saved["_lesson_moves"]] == ["next_in_module"]
    readiness = server._check_enrollment_module_readiness(_at(enr)[2])
    assert readiness["ok"], readiness


def test_a_replacement_lesson_in_the_same_spot_is_where_you_land(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    saved = _save(prog, ids, [("M1", ["A", "B2", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    assert _at(enr)[1] == _named(saved)[("l", "B2")]


def test_the_last_lesson_of_a_module_removed_moves_you_to_the_next_module(course):
    prog, ids = course
    enr = _enroll(prog, ids, "C")
    _save(prog, ids, [("M1", ["A", "B"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "D")])


@pytest.mark.parametrize("channel", ["online_school", "hybrid_school"])
def test_a_module_quiz_you_havent_passed_still_stands_in_the_way(course, channel):
    prog, ids = course
    _save(prog, ids, BASE, quiz=("M1",))
    prog = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
    enr = _enroll(prog, ids, "C", channel=channel)
    saved = _save(prog, ids, [("M1", ["A", "B"]), ("M2", ["D", "E"]), ("M3", ["F"])], quiz=("M1",))
    assert _at(enr)[:2] == (ids[("m", "M1")], ids[("l", "B")])
    assert saved["_lesson_moves"][0]["rule"] == "held_for_module_quiz"


@pytest.mark.parametrize("channel", ["in_person_school", None])
def test_an_in_person_dog_is_not_held_for_a_quiz_that_never_gates_it(course, channel):
    prog, ids = course
    _save(prog, ids, BASE, quiz=("M1",))
    prog = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
    enr = _enroll(prog, ids, "C", channel=channel)
    saved = _save(prog, ids, [("M1", ["A", "B"]), ("M2", ["D", "E"]), ("M3", ["F"])], quiz=("M1",))
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "D")]), "never back onto a lesson already done"
    assert saved["_lesson_moves"][0]["rule"] == "first_of_next_module"


def test_a_module_quiz_already_passed_lets_you_move_on(course):
    prog, ids = course
    _save(prog, ids, BASE, quiz=("M1",))
    prog = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
    enr = _enroll(prog, ids, "C", channel="online_school")
    run(server.db.school_quiz_attempts.insert_one({"id": f"{TAG}-qa", "enrollment_id": enr["id"], "module_id": ids[("m", "M1")], "passed": True}))
    try:
        _save(prog, ids, [("M1", ["A", "B"]), ("M2", ["D", "E"]), ("M3", ["F"])], quiz=("M1",))
        assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "D")])
    finally:
        run(server.db.school_quiz_attempts.delete_many({"id": f"{TAG}-qa"}))


def test_an_inactive_lesson_is_never_where_you_land(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])], inactive=("C", "D"))
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "E")])


def test_a_removed_module_moves_you_to_the_next_module_and_a_new_first_module_doesnt_pull_you_back(course):
    prog, ids = course
    enr = _enroll(prog, ids, "E")
    _save(prog, ids, [("M0", ["Intro"]), ("M1", ["A", "B", "C"]), ("M3", ["F"])])
    assert _at(enr)[:2] == (ids[("m", "M3")], ids[("l", "F")])


def test_with_everything_after_you_gone_you_land_on_the_last_lesson_left(course):
    prog, ids = course
    enr = _enroll(prog, ids, "E")
    saved = _save(prog, ids, [("M1", ["A", "B", "C"]), ("M2", ["D"])])
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "D")])
    assert saved["_lesson_moves"][0]["rule"] == "last_remaining_lesson"


def test_reordering_or_renaming_moves_nobody(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    ids2 = dict(ids)
    saved = run(server.update_program(prog["id"], _program_in([("M2", ["E", "D"]), ("M1", ["C", "B", "A"]), ("M3", ["F"])], ids2),
                                      cascade=True, save_as_draft=False, _=ADMIN))
    module, lesson, row = _at(enr)
    assert (module, lesson) == (ids[("m", "M1")], ids[("l", "B")]) and saved["_lesson_moves"] == []
    assert not row.get("curriculum_move_history")


def test_only_the_stranded_student_moves(course):
    prog, ids = course
    on_a, on_b = _enroll(prog, ids, "A"), _enroll(prog, ids, "B")
    saved = _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    assert _at(on_a)[1] == ids[("l", "A")] and _at(on_b)[1] == ids[("l", "C")]
    assert [m["enrollment_id"] for m in saved["_lesson_moves"]] == [on_b["id"]]
    assert saved["_cascaded_enrollments"] == 2


def test_a_finished_student_is_never_touched(course):
    prog, ids = course
    enr = _enroll(prog, ids, None, module="M3", lessons_finished_at=server.now_iso(), graduation_ready=True)
    _save(prog, ids, [("M1", ["A", "B", "C"]), ("M2", ["D", "E"])])
    module, lesson, row = _at(enr)
    assert lesson is None and row["graduation_ready"] is True and not row.get("curriculum_move_history")


def test_someone_already_stuck_is_fixed_by_the_next_save(course):
    prog, ids = course
    enr = _enroll(prog, ids, "E")
    run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_lesson_id": "gone-lesson"}}))
    saved = _save(prog, ids, BASE)
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "D")]), "the start of the module they were in"
    assert saved["_lesson_moves"][0]["rule"] == "was_already_missing"


def test_a_lesson_moved_to_another_module_keeps_you_on_it(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["B", "D", "E"]), ("M3", ["F"])])
    assert _at(enr)[:2] == (ids[("m", "M2")], ids[("l", "B")])


def test_an_online_student_can_continue_after_the_move(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B", channel="online_school")
    _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    _m, _l, row = _at(enr)
    pos = server._compute_next_school_position(row, row["current_module_id"], row["current_lesson_id"])
    assert pos["next_lesson_id"] == ids[("l", "D")]


def test_progress_and_the_move_record_are_kept(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B", lesson_step_progress={ids[("l", "A")]: {"done": True}})
    run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {f"goal_progress.{ids[('g', 'M1')]}": {"status": "mastered", "score": 5}}}))
    _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])])
    _m, _l, row = _at(enr)
    assert row["learn_completed_lesson_ids"] == [ids[("l", "A")]] and row["lesson_step_progress"] == {ids[("l", "A")]: {"done": True}}
    assert row["goal_progress"][ids[("g", "M1")]] == {"status": "mastered", "score": 5}
    h = row["curriculum_move_history"][0]
    assert h["from_lesson_name"] == "B" and h["to_lesson_name"] == "C" and h["by"] == ADMIN["id"] and h["source"] == "update"


def test_a_student_who_moved_meanwhile_keeps_their_own_move(course):
    prog, ids = course
    enr = _enroll(prog, ids, "A")
    stale = {**enr, "current_lesson_id": ids[("l", "B")]}   # what the push read; the student has since moved to A
    new_modules = [m.model_dump() for m in _program_in([("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])], ids).modules]
    res = run(curriculum_moves._push_one(stale, new_modules, curriculum_moves.snapshot_base({"name": "x", "type": "private_lessons", "modules": new_modules}),
                                         set(), actor=ADMIN, source="update"))
    assert res == {"move": None}
    assert _at(enr)[1] == ids[("l", "A")]


def test_publish_with_cascade_moves_and_previews_the_same_and_without_moves_nobody(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    draft = _program_in([("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])], ids)
    run(server.update_program(prog["id"], draft, cascade=False, save_as_draft=True, _=ADMIN))
    impact = run(server.program_publish_impact(prog["id"], ADMIN))
    assert impact["students_on_removed_lessons"] == 1 and impact["lesson_moves"][0]["to_lesson_id"] == ids[("l", "C")]
    assert _at(enr)[1] == ids[("l", "B")], "the preview writes nothing"
    published = run(server.publish_program(prog["id"], cascade=True, _=ADMIN))
    assert [m["to_lesson_id"] for m in published["_lesson_moves"]] == [impact["lesson_moves"][0]["to_lesson_id"]]
    assert _at(enr)[1] == ids[("l", "C")] and _at(enr)[2]["curriculum_move_history"][0]["source"] == "publish"


def test_saving_without_updating_enrolled_dogs_moves_nobody(course):
    prog, ids = course
    enr = _enroll(prog, ids, "B")
    saved = _save(prog, ids, [("M1", ["A", "C"]), ("M2", ["D", "E"]), ("M3", ["F"])], cascade=False)
    assert saved["_lesson_moves"] == [] and _at(enr)[1] == ids[("l", "B")]


def test_the_save_preview_route(course):
    prog, ids = course
    enr = _enroll(prog, ids, "C")
    route = next(r for r in server.app.routes if getattr(r, "path", "") == "/api/programs/{program_id}/cascade-preview")
    body = curriculum_moves.CascadePreviewIn(modules=[m.model_dump() for m in _program_in([("M1", ["A", "B"]), ("M2", ["D", "E"]), ("M3", ["F"])], ids).modules])
    out = run(route.endpoint(prog["id"], body, ADMIN))
    assert out["students_on_removed_lessons"] == 1 and out["lesson_moves"][0]["to_lesson_name"] == "D"
    assert out["lesson_moves"][0]["dog_name"] == "Rex C" and _at(enr)[1] == ids[("l", "C")]
    with pytest.raises(server.HTTPException) as e:
        run(route.endpoint("no-such-program", body, ADMIN))
    assert e.value.status_code == 404
