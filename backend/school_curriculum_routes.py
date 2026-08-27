"""Public School curriculum-import registration with Practice integrity hardening.

Phase 4 removed the old FastAPI ``route.endpoint`` mutation.  The established
import implementation now exposes explicit preflight/post-success hooks, so
bundled Practice validation and in-place refresh are part of the canonical
route call from the moment it is registered.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException

from _school_curriculum_routes_impl import *  # noqa: F401,F403 - preserve public API
from _school_curriculum_routes_impl import register_curriculum_import as _register_impl


def _validate_bundled_recipe(model, payload: dict, source_key: str) -> dict:
    validated = model(**payload).model_dump()
    pc = validated.get("practice_coach") or {}
    if not pc.get("enabled"):
        return validated
    errors = []
    if not str(pc.get("goal") or "").strip():
        errors.append("Today's Goal is required")
    if not str(pc.get("success_today") or "").strip():
        errors.append("Success Today is required")
    if not (pc.get("steps") or []):
        errors.append("at least one guided step is required")
    schedule = pc.get("schedule") or {}
    rounds = schedule.get("rounds_per_day")
    reps = schedule.get("reps_per_round")
    if not isinstance(rounds, (int, float)) or isinstance(rounds, bool) or rounds <= 0:
        errors.append("Rounds per day must be positive")
    if not isinstance(reps, (int, float)) or isinstance(reps, bool) or reps <= 0:
        errors.append("Repetitions per round must be positive")
    if errors:
        raise HTTPException(status_code=422, detail={
            "error_code": "invalid_bundled_practice_recipe",
            "msg": f"Bundled Practice recipe {source_key!r} is invalid: " + "; ".join(errors),
        })
    return validated


def _preserve_recipe_item_ids(validated: dict, existing: dict) -> None:
    """Keep stable Coach item IDs when an older package omitted them."""
    new_pc = validated.get("practice_coach") or {}
    old_pc = (existing or {}).get("practice_coach") or {}
    for field in ("setup_items", "steps", "troubleshooting", "stop_rules", "end_questions"):
        old_items = old_pc.get(field) or []
        for index, item in enumerate(new_pc.get(field) or []):
            if not isinstance(item, dict) or item.get("id"):
                continue
            old_id = old_items[index].get("id") if index < len(old_items) and isinstance(old_items[index], dict) else None
            item["id"] = old_id or f"pc-import-{uuid.uuid4().hex[:8]}"


async def _refresh_bundled_recipes(*, manifest: dict, db, model, now_iso) -> None:
    """Update package-owned Practice Recipes without changing their UUIDs."""
    if not model:
        return
    for tpl in manifest.get("homework_templates") or []:
        key = (tpl.get("source_key") or tpl.get("id") or "").strip()
        if not key:
            continue
        existing = await db.homework_templates.find_one({"import_source_key": key}, {"_id": 0})
        if not existing:
            continue
        payload = {k: v for k, v in tpl.items() if k not in ("source_key", "id", "created_at", "updated_at")}
        validated = _validate_bundled_recipe(model, payload, key)
        _preserve_recipe_item_ids(validated, existing)
        validated.pop("slug", None)
        validated["active"] = True
        validated["updated_at"] = now_iso()
        await db.homework_templates.update_one(
            {"id": existing["id"]},
            {"$set": validated, "$unset": {"retained_for_course_refs": "", "retained_for_course_refs_at": ""}},
        )


def register_curriculum_import(**kwargs):
    """Register the canonical importer with explicit integrity hooks."""
    db = kwargs["db"]
    model = kwargs.get("homework_template_model")
    now_iso = kwargs["now_iso"]

    async def preflight_hook(*, manifest, **_):
        if not model:
            return
        for tpl in manifest.get("homework_templates") or []:
            key = (tpl.get("source_key") or tpl.get("id") or "").strip()
            payload = {k: v for k, v in tpl.items() if k not in ("source_key", "id", "created_at", "updated_at")}
            _validate_bundled_recipe(model, payload, key)

    async def post_success_hook(*, manifest, **_):
        await _refresh_bundled_recipes(manifest=manifest, db=db, model=model, now_iso=now_iso)

    return _register_impl(
        **kwargs,
        preflight_hook=preflight_hook,
        post_success_hook=post_success_hook,
    )
