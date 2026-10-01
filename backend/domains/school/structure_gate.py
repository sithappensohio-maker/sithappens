"""Saving a course live runs the checks Publish runs (audit #53).

Publish refuses a draft with a structural error (_validate_program_structure:
a checkpoint lesson with no Practice, a quiz with no questions, a timer with
no duration, a link to a Practice recipe that no longer exists, ...). "Save
Live Now", "Create Program", the Shop Manager save and the curriculum ZIP
import went straight to the live course without those checks, so a broken
lesson could go live and students reaching it were stuck on "Training setup
needs attention".

Now every live save (create_program, and update_program when not saving a
draft — the ZIP import goes through both) asks this module first:

  * a problem the save would ADD is refused, listed in plain words;
  * a problem already in the live course before the save does not block
    (an unrelated price edit or a one-at-a-time fix still works) — it comes
    back as `_live_problems` so the owner is reminded it is still there.

"Already there" is decided per problem by the identity of the thing it is
on (lesson, block, skill, quiz question, module — never its name, position
or message), compared as a multiset against the live course as stored, so
reordering and renaming never turn an old problem into a new one, while a
new lesson/block/question (fresh id) or a fine thing edited into a broken
state always counts as new. Only errors count — the validator's warnings
never block and are never reported here. Publish keeps its own rule (any
error blocks).
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

_server_globals: Dict[str, Any] = {}

REFUSAL_CODE = "course_structure_problems"

BLOCK_CODES = {"content_block_missing_source", "knowledge_check_invalid_answer",
               "timer_missing_duration", "rep_counter_missing_target"}
LESSON_CODES = {"checkpoint_without_practice", "checkpoint_missing_handler_criteria",
                "checkpoint_missing_dog_criteria", "checkpoint_blank_criterion_name",
                "checkpoint_duplicate_criterion_id"}
QUESTION_CODES = {"module_quiz_blank_question", "module_quiz_too_few_options",
                  "module_quiz_duplicate_option_id", "module_quiz_invalid_correct_option",
                  "module_quiz_invalid_review_lesson"}
MODULE_CODES = {"module_quiz_no_questions", "module_quiz_invalid_passing_score"}
SKILL_CODES = {"broken_prerequisite", "broken_next_skill"}
FINAL_CODE = "checkpoint_multiple_final_assessments"
REF_CODE = "broken_homework_ref"
KNOWN_CODES = BLOCK_CODES | LESSON_CODES | QUESTION_CODES | MODULE_CODES | SKILL_CODES | {FINAL_CODE, REF_CODE}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _all_ids(modules: List[dict]) -> set:
    """Every id in a stored course: modules, skills, lessons, blocks,
    checkpoint criteria, quiz questions and options."""
    ids = set()
    for m in modules or []:
        ids.add(m.get("id"))
        for g in m.get("goals") or []:
            ids.add(g.get("id"))
        for lesson in m.get("lessons") or []:
            ids.add(lesson.get("id"))
            for b in lesson.get("content_blocks") or []:
                ids.add(b.get("id"))
            cp = lesson.get("checkpoint") or {}
            for c in (cp.get("handler_criteria") or []) + (cp.get("dog_criteria") or []):
                ids.add((c or {}).get("id"))
        for q in ((m.get("module_quiz") or {}).get("questions") or []):
            ids.add((q or {}).get("id"))
    ids.discard(None)
    return ids


def problem_key(e: dict, live_ids: set) -> Tuple:
    """Identity of one validator error. An id the live course doesn't have
    (a fresh id minted for a new thing, or a placeholder for an id-less
    legacy one) is "?" on both sides."""
    def n(field: str) -> str:
        v = e.get(field)
        return v if v in live_ids else "?"
    code = e.get("code")
    if code in BLOCK_CODES:
        return (code, n("lesson_id"), n("content_block_id"))
    if code in LESSON_CODES:
        return (code, n("lesson_id"))
    if code in QUESTION_CODES:
        return (code, n("module_id"), n("question_id"))
    if code in MODULE_CODES:
        return (code, n("module_id"))
    if code in SKILL_CODES:
        return (code, n("skill_id"))
    if code == REF_CODE:
        where = ("lesson_id", n("lesson_id")) if e.get("lesson_id") else \
                ("skill_id", n("skill_id")) if e.get("skill_id") else ("module_id", n("module_id"))
        return (code, *where, e.get("homework_template_id"))
    # A code this module doesn't know yet: every id it carries, so it fails closed.
    return (code, *sorted((k, n(k)) for k in e if k.endswith("_id")))


def split(new_errors: List[dict], live_errors: List[dict], live_modules: List[dict]) -> Tuple[List[dict], List[dict]]:
    """(added, already_live): which of `new_errors` the save would add."""
    live_ids = _all_ids(live_modules)
    pool = Counter(problem_key(e, live_ids) for e in live_errors if e.get("code") != FINAL_CODE)
    live_finals = {(loc or {}).get("lesson_id") if (loc or {}).get("lesson_id") in live_ids else "?"
                   for e in live_errors if e.get("code") == FINAL_CODE for loc in e.get("locations") or []}
    added, old = [], []
    for e in new_errors:
        if e.get("code") == FINAL_CODE:
            lessons = {(loc or {}).get("lesson_id") if (loc or {}).get("lesson_id") in live_ids else "?"
                       for loc in e.get("locations") or []}
            (old if lessons <= live_finals else added).append(e)
            continue
        k = problem_key(e, live_ids)
        if pool[k] > 0:
            pool[k] -= 1
            old.append(e)
        else:
            added.append(e)
    return added, old


# ---- plain words -------------------------------------------------------------

def _names(modules: List[dict]) -> Dict[str, Any]:
    out = {"module": {}, "lesson": {}, "skill": {}, "question": {}}
    for mi, m in enumerate(modules or []):
        mname = m.get("name") or f"Module {mi + 1}"
        out["module"][m.get("id")] = (mi, mname)
        for gi, g in enumerate(m.get("goals") or []):
            out["skill"][g.get("id")] = (mi, gi, mname, g.get("name") or f"Skill {gi + 1}")
        for li, lesson in enumerate(m.get("lessons") or []):
            out["lesson"][lesson.get("id")] = (mi, li, mname, lesson.get("name") or f"Lesson {li + 1}")
        for qi, q in enumerate(((m.get("module_quiz") or {}).get("questions") or [])):
            out["question"][(m.get("id"), (q or {}).get("id"))] = qi
    return out


def plain(e: dict, modules: List[dict], names: Optional[dict] = None) -> str:
    """One sentence an owner can act on, naming where the problem is."""
    names = names or _names(modules)
    code, msg = e.get("code"), (e.get("message") or "").strip()
    if code == REF_CODE:
        if e.get("lesson_id") in names["lesson"]:
            _mi, _li, mname, lname = names["lesson"][e["lesson_id"]]
            where = f"Module '{mname}', lesson '{lname}'"
        elif e.get("skill_id") in names["skill"]:
            _mi, _gi, mname, sname = names["skill"][e["skill_id"]]
            where = f"Module '{mname}', skill '{sname}'"
        elif e.get("module_id") in names["module"]:
            where = f"Module '{names['module'][e['module_id']][1]}'"
        else:
            where = "This course"
        return f"{where} links a Practice recipe that no longer exists."
    if code in QUESTION_CODES:
        qi = names["question"].get((e.get("module_id"), e.get("question_id")))
        if qi is not None:
            return f"{msg.rstrip('.')} (question {qi + 1})."
    if code == FINAL_CODE:
        marked = [names["lesson"].get((loc or {}).get("lesson_id")) for loc in e.get("locations") or []]
        listed = ", ".join(f"'{x[3]}' ({x[2]})" for x in marked if x)
        if listed:
            return f"Only one lesson may be marked as the program's Final Assessment. Marked now: {listed}."
    return msg or "This course has a problem that stops it working for students."


def _located(e: dict, modules: List[dict], names: dict) -> dict:
    """The error, plus its plain sentence and where it sits in `modules` (so
    a screen can open a lesson that had no id until this save)."""
    out = {**e, "plain": plain(e, modules, names)}
    if e.get("lesson_id") in names["lesson"]:
        mi, li, _m, _l = names["lesson"][e["lesson_id"]]
        out.update(module_index=mi, lesson_index=li)
    elif e.get("skill_id") in names["skill"]:
        mi, gi, _m, _s = names["skill"][e["skill_id"]]
        out.update(module_index=mi, skill_index=gi)
    elif e.get("module_id") in names["module"]:
        out["module_index"] = names["module"][e["module_id"]][0]
    elif e.get("code") == FINAL_CODE and e.get("locations"):
        first = names["lesson"].get((e["locations"][0] or {}).get("lesson_id"))
        if first:
            out.update(module_index=first[0], lesson_index=first[1], lesson_id=e["locations"][0].get("lesson_id"),
                       module_id=e["locations"][0].get("module_id"))
    return out


# ---- the one check every live save runs --------------------------------------

async def check(new_modules: List[dict], live_modules: Optional[List[dict]]) -> Dict[str, List]:
    """{"added": [...], "already_live": [...]} for a save that would put
    `new_modules` (already id-stamped) live over `live_modules` (as stored;
    None/[] for a brand-new course). Never writes."""
    validate = _g("_validate_program_structure")
    new_errors = (await validate(new_modules or []))["errors"]
    if not new_errors:
        return {"added": [], "already_live": []}
    live_errors = (await validate(live_modules or []))["errors"] if live_modules else []
    added, old = split(new_errors, live_errors, live_modules or [])
    new_names = _names(new_modules)
    return {"added": [_located(e, new_modules, new_names) for e in added],
            "already_live": [plain(e, new_modules, new_names) for e in old]}


def refuse(added: List[dict]) -> None:
    n = len(added)
    msg = (f"This save would put {'a problem' if n == 1 else f'{n} problems'} live that would stop "
           f"students — fix {'it' if n == 1 else 'them'} first. Nothing was saved.")
    raise HTTPException(status_code=422, detail={
        "error_code": REFUSAL_CODE, "message": msg, "msg": msg, "errors": added})


async def gate(new_modules: List[dict], live_modules: Optional[List[dict]]) -> List[str]:
    """Refuse (422) if the save adds a problem; otherwise the plain-words
    list of problems already in the live course."""
    result = await check(new_modules, live_modules)
    if result["added"]:
        refuse(result["added"])
    return result["already_live"]
