"""Public School curriculum-import registration with Practice integrity hardening.

The established import implementation lives unchanged in
``_school_curriculum_routes_impl``.  This thin public layer adds two guarantees
that matter once courses are sold to students:

1. install the School Practice reference-repair layer after server.py's
   canonical Practice helpers/routes exist;
2. refresh bundled Practice Recipes in place on ZIP re-import so lesson and
   enrollment references keep a stable UUID while authored coaching content is
   updated.
"""
from __future__ import annotations

import inspect
import uuid

from fastapi import HTTPException

from _school_curriculum_routes_impl import *  # noqa: F401,F403 - preserve public API
from _school_curriculum_routes_impl import register_curriculum_import as _register_impl
from _school_curriculum_routes_impl import pkg
from school_practice_integrity import install_school_practice_integrity


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
        existing = await db.homework_templates.find_one(
            {"import_source_key": key}, {"_id": 0})
        if not existing:
            # The established importer creates missing recipes and relinks the
            # course before this post-success refresh runs.
            continue
        payload = {k: v for k, v in tpl.items()
                   if k not in ("source_key", "id", "created_at", "updated_at")}
        validated = _validate_bundled_recipe(model, payload, key)
        _preserve_recipe_item_ids(validated, existing)
        validated.pop("slug", None)  # identity stays with the stored recipe
        validated["active"] = True
        validated["updated_at"] = now_iso()
        await db.homework_templates.update_one(
            {"id": existing["id"]},
            {"$set": validated,
             "$unset": {"retained_for_course_refs": "", "retained_for_course_refs_at": ""}},
        )


def register_curriculum_import(**kwargs):
    """Register the canonical importer, then add paid-course integrity guards."""
    caller = inspect.currentframe().f_back
    server_globals = caller.f_globals
    endpoint = _register_impl(**kwargs)

    # Patch the already-built importer route's call target. Its FastAPI
    # dependency graph is unchanged, so authentication/authorization remains
    # exactly the canonical implementation's.
    api = kwargs["api"]
    db = kwargs["db"]
    model = kwargs.get("homework_template_model")
    now_iso = kwargs["now_iso"]

    async def hardened_import(body, user):
        # Validate bundled recipes before the canonical importer writes
        # anything; existing recipe rows previously skipped this validation.
        try:
            manifest, files = pkg.open_package(body.data)
            pkg.validate(manifest, files)
        except pkg.ImportError_ as exc:
            raise HTTPException(status_code=422, detail={
                "error_code": "invalid_curriculum_package",
                "errors": exc.errors,
            }) from exc
        if model:
            for tpl in manifest.get("homework_templates") or []:
                key = (tpl.get("source_key") or tpl.get("id") or "").strip()
                payload = {k: v for k, v in tpl.items()
                           if k not in ("source_key", "id", "created_at", "updated_at")}
                _validate_bundled_recipe(model, payload, key)

        result = await endpoint(body, user)
        if not body.dry_run:
            await _refresh_bundled_recipes(
                manifest=manifest, db=db, model=model, now_iso=now_iso)
        return result

    hardened_import.__name__ = endpoint.__name__
    hardened_import.__doc__ = endpoint.__doc__
    for route in getattr(api, "routes", []):
        dependant = getattr(route, "dependant", None)
        if (getattr(route, "path", None) == "/admin/school/curriculum/import"
                and dependant and dependant.call is endpoint):
            dependant.call = hardened_import
            route.endpoint = hardened_import
            break

    install_school_practice_integrity(db=db, server_globals=server_globals)
    return hardened_import
