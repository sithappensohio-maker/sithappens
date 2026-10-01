"""A course edit pushed to enrolled students never strands one (audit #52).

A program edit saved with "update enrolled dogs" (update_program cascade),
a draft published the same way (publish_program cascade) and the curriculum
ZIP import all push the new program to every active enrollment. A student's
place is only the pointer pair current_module_id / current_lesson_id —
lessons before it count as done — and the push used to leave that pointer on
a lesson that no longer existed: Continue failed (500), Trainer Day said the
lesson "needs Admin resolution", and nothing could move the student.

Now the push repairs the pointer of anyone on a removed lesson, in the app's
own lesson order (modules by (order, name), lessons by _effective_lesson_list):
  1. the next lesson in the same module (the lesson now in the student's
     spot — a replacement lesson counts);
  2. if the module has nothing after, and it has a Module Quiz this student
     hasn't passed, hold on the module's last remaining lesson so the quiz
     gate still applies (online/hybrid only — in person the trainer moves
     the dog and the quiz never gates it);
  3. otherwise the first lesson of the next module that has one;
  4. otherwise the last lesson that still exists;
  5. nothing left at all: the pointer stays and the move is reported.
Reordering, renaming or editing a lesson never moves anyone. Inactive lessons
are never a destination. Progress on surviving lessons is kept as-is (it is
positional). Every move is recorded on the enrollment
(curriculum_move_history), the push returns the list, and the same rule
previews it (publish-impact and POST /programs/{id}/cascade-preview).
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

_server_globals: Dict[str, Any] = {}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def snapshot_base(update: dict) -> Dict[str, Any]:
    """The snapshot both pushes have always written (keys unchanged)."""
    return {
        "name": update["name"], "type": update["type"], "slug": update.get("slug"),
        "description": update.get("description", ""), "focus": update.get("focus", ""),
        "format": update.get("format"), "modules": update.get("modules") or [],
        "completion_rule": update.get("completion_rule") or _g("_default_completion_rule")(),
        "estimated_weeks": update.get("estimated_weeks"),
        "school_support": update.get("school_support") or {},
        "school_onboarding": update.get("school_onboarding") or {},
        "recommended_next_program_slugs": list(update.get("recommended_next_program_slugs") or []),
        "prereq_slugs": list(update.get("prereq_slugs") or []),
    }


def _sorted_modules(modules: List[dict]) -> List[dict]:
    return sorted(modules or [], key=lambda m: (m.get("order", 0), m.get("name") or ""))


def _lessons(module: Optional[dict]) -> List[dict]:
    return _g("_effective_lesson_list")(module) if module else []


def _active(lesson: dict) -> bool:
    return lesson.get("active", True) is not False


def _find_lesson(modules: List[dict], lesson_id: str):
    for m in modules:
        for lesson in _lessons(m):
            if lesson.get("id") == lesson_id:
                return m, lesson
    return None, None


async def repaired_position(enrollment: dict, new_modules: List[dict]) -> Optional[Dict[str, Any]]:
    """Where this student should be in `new_modules`, or None when their
    position is fine. Never writes."""
    cur_lesson_id = enrollment.get("current_lesson_id")
    cur_module_id = enrollment.get("current_module_id")
    if not cur_lesson_id:
        return None   # finished, or no position yet
    new_sorted = _sorted_modules(new_modules)
    old_sorted = _sorted_modules((enrollment.get("program_snapshot") or {}).get("modules") or [])
    old_home, old_lesson = _find_lesson(old_sorted, cur_lesson_id)
    from_names = {"from_module_id": cur_module_id, "from_lesson_id": cur_lesson_id,
                  "from_module_name": (old_home or {}).get("name") or "", "from_lesson_name": (old_lesson or {}).get("name") or ""}

    def move(module: Optional[dict], lesson: Optional[dict], rule: str) -> Dict[str, Any]:
        return {**from_names, "rule": rule,
                "to_module_id": (module or {}).get("id") if module else cur_module_id,
                "to_lesson_id": (lesson or {}).get("id") if lesson else cur_lesson_id,
                "to_module_name": (module or {}).get("name") or "", "to_lesson_name": (lesson or {}).get("name") or ""}

    now_home, now_lesson = _find_lesson(new_sorted, cur_lesson_id)
    if now_home is not None:   # the lesson still exists: reordering or editing moves nobody
        return None if now_home.get("id") == cur_module_id else move(now_home, now_lesson, "lesson_moved_module")

    was_missing = old_home is None   # already broken before this push
    if was_missing:
        old_home = next((m for m in old_sorted if m.get("id") == cur_module_id), None)
    passed = set()
    if old_lesson is not None:
        old_lessons = _lessons(old_home)
        idx = next(i for i, l in enumerate(old_lessons) if l.get("id") == cur_lesson_id)
        passed = {l.get("id") for l in old_lessons[:idx]}
    new_home = next((m for m in new_sorted if old_home and m.get("id") == old_home.get("id")), None)

    if new_home is not None:
        home_lessons = _lessons(new_home)
        after = [i for i, l in enumerate(home_lessons) if l.get("id") in passed]
        start = max(after) + 1 if after else 0
        nxt = next((l for l in home_lessons[start:] if _active(l)), None)
        if nxt:
            return move(new_home, nxt, "was_already_missing" if was_missing else "next_in_module")
        remaining = [l for l in home_lessons if _active(l)]
        # The quiz only gates students who move themselves on (online/hybrid);
        # an in-person dog's trainer moves it past the quiz, so no hold.
        quiz_gates = _g("_school_delivery_mode_for_enrollment")(enrollment) in ("online", "hybrid")
        if remaining and quiz_gates and await _g("_module_quiz_gate_blocks")(
                {"id": enrollment.get("id"), "program_snapshot": {"modules": new_modules}}, new_home.get("id")):
            return move(new_home, remaining[-1], "held_for_module_quiz")
        start_idx = new_sorted.index(new_home) + 1
    elif old_home is not None:   # the module itself was removed: after the last survivor before it
        before = {m.get("id") for m in old_sorted[:old_sorted.index(old_home)]}
        survivors = [i for i, m in enumerate(new_sorted) if m.get("id") in before]
        start_idx = max(survivors) + 1 if survivors else 0
    else:
        start_idx = 0

    for module in new_sorted[start_idx:]:
        first = next((l for l in _lessons(module) if _active(l)), None)
        if first:
            return move(module, first, "was_already_missing" if was_missing else "first_of_next_module")
    for module in reversed(new_sorted):
        remaining = [l for l in _lessons(module) if _active(l)]
        if remaining:
            return move(module, remaining[-1], "last_remaining_lesson")
    return move(None, None, "no_lessons_left")


def _merged_progress(enrollment: dict, new_modules: List[dict], surviving_goal_ids: set) -> Dict[str, Any]:
    merged = _g("_empty_progress")(new_modules)
    for gid, prog in (enrollment.get("goal_progress") or {}).items():
        if gid in surviving_goal_ids and gid in merged:
            merged[gid] = prog
    return merged


async def _push_one(enrollment: dict, new_modules: List[dict], base: dict, surviving_goal_ids: set,
                    *, actor: dict, source: str) -> Optional[Dict[str, Any]]:
    """Push the snapshot to one enrollment and repair its position, never over
    a move the student (or staff) made meanwhile. None when it is no longer
    active; otherwise {"move": dict | None}."""
    db = _g("db")
    enr = enrollment
    for _attempt in range(5):
        merged = _merged_progress(enr, new_modules, surviving_goal_ids)
        move = await repaired_position(enr, new_modules)
        set_doc: Dict[str, Any] = {"program_snapshot": base, "goal_progress": merged}
        update: Dict[str, Any] = {"$set": set_doc}
        if move and move["rule"] != "no_lessons_left":
            set_doc.update({"current_module_id": move["to_module_id"], "current_lesson_id": move["to_lesson_id"]})
            update["$push"] = {"curriculum_move_history": {
                "id": str(uuid.uuid4()), "at": _g("now_iso")(), "by": actor.get("id"),
                "by_name": actor.get("name") or actor.get("email") or "", "source": source, **move}}
        res = await db.dog_programs.update_one(
            {"id": enr["id"], "status": "active", "current_module_id": enr.get("current_module_id"),
             "current_lesson_id": enr.get("current_lesson_id")}, update)
        if res.matched_count:
            return {"move": move}
        enr = await db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0})
        if not enr or enr.get("status") != "active":
            return None
    # Kept changing under us: the snapshot still goes out (as it always did);
    # the position is left to the student's own latest move.
    await db.dog_programs.update_one({"id": enr["id"], "status": "active"}, {"$set": {
        "program_snapshot": base, "goal_progress": _merged_progress(enr, new_modules, surviving_goal_ids)}})
    return {"move": {"rule": "changed_during_save", "from_module_id": enr.get("current_module_id"),
                     "from_lesson_id": enr.get("current_lesson_id"), "to_module_id": enr.get("current_module_id"),
                     "to_lesson_id": enr.get("current_lesson_id")}}


async def _with_dog_names(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    dog_ids = list({r.get("dog_id") for r in rows if r.get("dog_id")})
    names = {}
    if dog_ids:
        async for d in _g("db").dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "name": 1}):
            names[d["id"]] = d.get("name") or ""
    for r in rows:
        r["dog_name"] = names.get(r.get("dog_id"), "")
    return sorted(rows, key=lambda r: (r.get("dog_name") or "", r.get("enrollment_id") or ""))


async def push(program_id: str, update: dict, *, actor: dict, source: str) -> Dict[str, Any]:
    """The one push both update_program and publish_program use."""
    new_modules = update.get("modules") or []
    base = snapshot_base(update)
    surviving = {g.get("id") for m in new_modules for g in (m.get("goals") or []) if g.get("id")}
    cascaded, moves = 0, []
    async for enr in _g("db").dog_programs.find({"program_id": program_id, "status": "active"}, {"_id": 0}):
        res = await _push_one(enr, new_modules, base, surviving, actor=actor, source=source)
        if res is None:
            continue
        cascaded += 1
        if res.get("move"):
            moves.append({"enrollment_id": enr["id"], "dog_id": enr.get("dog_id"),
                          "delivery_channel": enr.get("delivery_channel"), **res["move"]})
    return {"cascaded": cascaded, "moves": await _with_dog_names(moves)}


async def preview(program_id: str, new_modules: List[dict]) -> Dict[str, Any]:
    """Who a push of `new_modules` would move, and where. Never writes."""
    moves = []
    async for enr in _g("db").dog_programs.find(
            {"program_id": program_id, "status": "active"},
            {"_id": 0, "id": 1, "dog_id": 1, "delivery_channel": 1, "current_module_id": 1, "current_lesson_id": 1,
             "program_snapshot.modules": 1}):
        move = await repaired_position(enr, new_modules)
        if move:
            moves.append({"enrollment_id": enr["id"], "dog_id": enr.get("dog_id"),
                          "delivery_channel": enr.get("delivery_channel"), **move})
    moves = await _with_dog_names(moves)
    return {"students_on_removed_lessons": sum(1 for m in moves if m["rule"] != "lesson_moved_module"),
            "lesson_moves": moves}


class CascadePreviewIn(BaseModel):
    modules: List[Dict[str, Any]] = []


def register_routes(*, api, server_globals: dict) -> None:
    need = server_globals["require_admin_and_permission"]

    async def cascade_preview(program_id: str, body: CascadePreviewIn,
                              _: dict = Depends(need("manage_training_content"))):
        """Save Live's preview: who an "update enrolled dogs" save of these
        modules would move. Never writes."""
        if not await _g("db").programs.find_one({"id": program_id}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Program not found")
        try:
            modules = [_g("ModuleIn")(**m).model_dump() for m in (body.modules or [])]
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Those modules can't be read: {exc}")
        return await preview(program_id, _g("_stamp_ids")(modules))

    api.add_api_route("/programs/{program_id}/cascade-preview", cascade_preview, methods=["POST"])
