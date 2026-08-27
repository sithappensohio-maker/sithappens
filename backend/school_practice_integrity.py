"""Repair/guard School Practice references so paid enrollments cannot dead-end."""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import HTTPException

try:
    from pymongo.errors import DuplicateKeyError
except Exception:  # pragma: no cover
    class DuplicateKeyError(Exception):
        pass



async def retain_template_if_referenced(*, db, template_id: str, now_iso) -> Optional[dict]:
    """Archive a Practice recipe instead of deleting it when School still references it."""
    if not await db.homework_templates.find_one({"id": template_id}, {"_id": 0, "id": 1}):
        return None
    refs = await db.programs.count_documents({"$or": [
        {"welcome_homework_template_id": template_id},
        {"modules.homework_template_id": template_id},
        {"modules.goals.homework_template_ids": template_id},
        {"modules.lessons.suggested_homework_template_ids": template_id},
    ]})
    frozen = await db.dog_programs.count_documents({"$or": [
        {"program_snapshot.welcome_homework_template_id": template_id},
        {"program_snapshot.modules.homework_template_id": template_id},
        {"program_snapshot.modules.goals.homework_template_ids": template_id},
        {"program_snapshot.modules.lessons.suggested_homework_template_ids": template_id},
    ]})
    if not (refs or frozen):
        return None
    await db.homework_templates.update_one({"id": template_id}, {"$set": {
        "active": False,
        "retained_for_course_refs": True,
        "retained_for_course_refs_at": now_iso(),
    }})
    return {"ok": True, "archived": True, "retained_for_course_refs": True}


async def release_school_homework_reference(*, db, homework: Optional[dict], homework_id: str) -> None:
    """Release a School lesson's auto-Practice claim after explicit deletion."""
    hw = homework or {}
    if not hw.get("source_lesson_id"):
        return
    enr_id = hw.get("school_enrollment_record_id")
    if not enr_id and hw.get("school_enrollment_id"):
        se = await db.school_enrollments.find_one(
            {"id": hw["school_enrollment_id"]}, {"_id": 0, "enrollment_id": 1})
        enr_id = (se or {}).get("enrollment_id")
    if enr_id:
        await db.dog_programs.update_one({"id": enr_id}, {"$pull": {
            "auto_homework_log": {
                "trigger": f"school_lesson:{hw['source_lesson_id']}",
                "homework_id": homework_id,
            }
        }})


def _patch_deletes(*, db, g: dict) -> None:
    api, now_iso = g.get("api"), g.get("now_iso")
    if not api or not now_iso:
        return
    for route in getattr(api, "routes", []):
        methods = set(getattr(route, "methods", set()) or set())
        dep = getattr(route, "dependant", None)
        original = getattr(dep, "call", None) if dep else None
        if not original or getattr(original, "_school_integrity_wrapped", False):
            continue
        path = getattr(route, "path", None)

        if path == "/homework-templates/{template_id}" and "DELETE" in methods:
            async def guarded_template_delete(template_id: str, _: dict, _original=original):
                if not await db.homework_templates.find_one({"id": template_id}, {"_id": 0, "id": 1}):
                    return await _original(template_id, _)
                retained = await retain_template_if_referenced(
                    db=db, template_id=template_id, now_iso=now_iso)
                if retained:
                    return retained
                return await _original(template_id, _)
            guarded_template_delete._school_integrity_wrapped = True
            dep.call = route.endpoint = guarded_template_delete

        elif path == "/homework/{homework_id}" and "DELETE" in methods:
            async def guarded_homework_delete(homework_id: str, _: dict, _original=original):
                hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
                result = await _original(homework_id, _)
                await release_school_homework_reference(
                    db=db, homework=hw, homework_id=homework_id)
                return result
            guarded_homework_delete._school_integrity_wrapped = True
            dep.call = route.endpoint = guarded_homework_delete


def install_school_practice_integrity(*, db, server_globals: dict, patch_delete_routes: bool = True) -> bool:
    g = server_globals
    if g.get("_school_practice_integrity_installed"):
        return False
    names = (
        "_lesson_practice_homework", "_effective_lessons", "_active_homework_conflict",
        "_claim_auto_homework_trigger", "_create_homework_from_template_internal",
        "_finalize_auto_homework_claim", "now_iso",
    )
    missing = [n for n in names if n not in g]
    if missing:
        raise RuntimeError("School Practice integrity missing helpers: " + ", ".join(missing))

    lesson_hw = g["_lesson_practice_homework"]
    effective_lessons = g["_effective_lessons"]
    conflict_for = g["_active_homework_conflict"]
    claim_trigger = g["_claim_auto_homework_trigger"]
    create_hw = g["_create_homework_from_template_internal"]
    finalize = g["_finalize_auto_homework_claim"]
    now_iso = g["now_iso"]
    logger = g.get("logger")

    async def repair_template(enrollment: dict, dog_id: str, lesson: dict, missing_id: str) -> Optional[str]:
        lesson_id, program_id = lesson.get("id"), enrollment.get("program_id")
        if lesson_id and program_id:
            live = await db.programs.find_one({"id": program_id}, {"_id": 0, "modules": 1})
            live_lesson = None
            for module in (live or {}).get("modules") or []:
                live_lesson = next((x for x in effective_lessons(module) if x.get("id") == lesson_id), None)
                if live_lesson:
                    break
            live_ids = list((live_lesson or {}).get("suggested_homework_template_ids") or [])
            valid_ids = []
            for tid in live_ids:
                if await db.homework_templates.find_one({"id": tid}, {"_id": 0, "id": 1}):
                    valid_ids.append(tid)
            if valid_ids:
                snap = dict(enrollment.get("program_snapshot") or {})
                modules = []
                for module in snap.get("modules") or []:
                    mc = dict(module)
                    lessons = []
                    for item in module.get("lessons") or []:
                        lc = dict(item)
                        if lc.get("id") == lesson_id:
                            lc["suggested_homework_template_ids"] = list(valid_ids)
                        lessons.append(lc)
                    mc["lessons"] = lessons
                    modules.append(mc)
                snap["modules"] = modules
                await db.dog_programs.update_one({"id": enrollment["id"]}, {"$set": {"program_snapshot": snap}})
                enrollment["program_snapshot"] = snap
                lesson["suggested_homework_template_ids"] = list(valid_ids)
                if logger:
                    logger.warning("Repaired School Practice recipe reference %s -> %s", missing_id, valid_ids[0])
                return valid_ids[0]

        prior = await db.homework.find_one(
            {"dog_id": dog_id, "template_snapshot.template_id": missing_id},
            {"_id": 0, "id": 1, "template_snapshot": 1}, sort=[("created_at", -1)])
        snap = (prior or {}).get("template_snapshot") or {}
        if prior and snap.get("name"):
            recovered = {
                "id": missing_id,
                "slug": f"{(snap.get('slug') or 'recovered-practice')}-recovered-{missing_id[:8]}",
                "name": snap["name"], "tier": snap.get("tier") or "master",
                "description": snap.get("description") or "", "default_duration_days": 7,
                "cover_color": snap.get("cover_color") or "", "icon": snap.get("icon") or "",
                "global_rules_this_week": list(snap.get("global_rules_this_week") or []),
                "sections": list(snap.get("sections") or []), "practice_coach": snap.get("practice_coach"),
                "is_default": False, "active": False, "created_at": now_iso(),
                "created_by": "System recovery", "recovered_from_homework_id": prior["id"],
            }
            try:
                await db.homework_templates.update_one(
                    {"id": missing_id}, {"$setOnInsert": recovered}, upsert=True)
            except DuplicateKeyError:
                pass
            if await db.homework_templates.find_one({"id": missing_id}, {"_id": 0, "id": 1}):
                return missing_id
        return None

    async def repaired_claim(
        enrollment: dict, dog_id: str, client_id: Optional[str], lesson: dict,
        assigned_by: str, school_enrollment_id: Optional[str] = None,
    ) -> Optional[dict]:
        lesson_id = lesson.get("id")
        existing = await lesson_hw(dog_id, lesson_id, enrollment.get("id"))
        if existing:
            return existing

        ids = list(lesson.get("suggested_homework_template_ids") or [])
        if not ids:
            return None
        template_id = ids[0]
        if not await db.homework_templates.find_one({"id": template_id}, {"_id": 0, "id": 1}):
            template_id = await repair_template(enrollment, dog_id, lesson, template_id)
            if not template_id:
                raise HTTPException(status_code=409, detail={
                    "error_code": "school_practice_reference_unavailable",
                    "message": "Practice could not be restored automatically. Your course progress is safe. Please try again or ask your trainer for help.",
                    "lesson_id": lesson_id,
                })

        trigger, enrollment_id = f"school_lesson:{lesson_id}", enrollment["id"]
        entry = next((x for x in enrollment.get("auto_homework_log") or [] if x.get("trigger") == trigger), None)
        if entry and entry.get("template_id") and entry["template_id"] != template_id:
            await db.dog_programs.update_one({"id": enrollment_id}, {"$pull": {"auto_homework_log": {"trigger": trigger}}})
            entry = None

        if entry and not entry.get("homework_id"):
            for _ in range(4):
                existing = await lesson_hw(dog_id, lesson_id, enrollment.get("id"))
                if existing:
                    return existing
                await asyncio.sleep(0.05)
            await db.dog_programs.update_one({"id": enrollment_id}, {"$pull": {"auto_homework_log": {"trigger": trigger}}})
            entry = None

        if entry and entry.get("homework_id"):
            existing = await db.homework.find_one({"id": entry["homework_id"]}, {"_id": 0})
            if existing:
                return existing
            await db.dog_programs.update_one({"id": enrollment_id}, {"$pull": {"auto_homework_log": {"trigger": trigger}}})
            entry = None

        if not entry:
            conflict = await conflict_for(dog_id, template_id)
            if conflict:
                hw = await db.homework.find_one({"id": conflict["id"]}, {"_id": 0})
                same_school = bool(hw and (
                    hw.get("school_enrollment_record_id") == enrollment.get("id")
                    or hw.get("school_enrollment_id") == school_enrollment_id
                    or str(hw.get("assigned_by") or "").startswith("Online School")))
                if hw and same_school and not hw.get("source_lesson_id"):
                    markers = {"source_lesson_id": lesson_id}
                    if school_enrollment_id:
                        markers.update({"school_enrollment_id": school_enrollment_id,
                                        "school_enrollment_record_id": enrollment.get("id")})
                    await db.homework.update_one({"id": hw["id"]}, {"$set": markers})
                    hw.update(markers)
                    return hw
            if not await claim_trigger(enrollment_id, template_id, trigger):
                for _ in range(4):
                    existing = await lesson_hw(dog_id, lesson_id, enrollment.get("id"))
                    if existing:
                        return existing
                    await asyncio.sleep(0.05)
                return None

        dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
        client = await db.clients.find_one({"id": client_id}, {"_id": 0}) if client_id else None
        hw = await create_hw(
            dog, client, template_id, assigned_by=assigned_by, source_lesson_id=lesson_id,
            school_enrollment_id=school_enrollment_id, school_enrollment_record_id=enrollment.get("id"))
        if hw:
            await finalize(enrollment_id, trigger, hw["id"])
        return hw

    g["_repair_school_practice_template_reference"] = repair_template
    g["_claim_school_lesson_homework"] = repaired_claim
    if patch_delete_routes:
        _patch_deletes(db=db, g=g)
    g["_school_practice_integrity_installed"] = True
    return True
