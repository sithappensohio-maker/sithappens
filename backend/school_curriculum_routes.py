"""Online School — the curriculum-package import route.

Registered the same way `school_suite.py` is: server hands in the pieces it
owns (db, permission dependency, media persistence) so this module stays
testable and server.py stays readable.

The parsing and validation live in `school_curriculum_import`; everything here
is the write path — turning a validated plan into ordinary curriculum through
the SAME `create_program` / `update_program` the Studio uses, so an imported
course is indistinguishable from a hand-built one.
"""
import posixpath
import uuid
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import school_curriculum_import as pkg


class CurriculumPackageIn(BaseModel):
    data: str
    filename: Optional[str] = None
    dry_run: bool = False


def register_curriculum_import(*, api, db, manage_dep, persist_school_media,
                               program_model, create_program, update_program, now_iso,
                               homework_template_model=None, create_homework_template=None):

    async def _ingest(path: str, blob: bytes, mime: str, user: dict, cache: dict) -> str:
        """One packaged file -> one School Resource, reusing an identical one.

        Identity is the file CONTENT, not its name, so re-importing the same
        package — or two lessons sharing one diagram — yields a single
        resource instead of a growing pile of duplicates.
        """
        digest = pkg.media_digest(blob)
        if digest in cache:
            return cache[digest]
        existing = await db.school_resources.find_one(
            {"import_digest": digest, "active": True}, {"_id": 0, "id": 1})
        if existing:
            cache[digest] = existing["id"]
            return existing["id"]

        filename = path.rsplit("/", 1)[-1]
        media_id = str(uuid.uuid4())
        stored = persist_school_media(pkg.data_url(blob, mime), media_id, filename)
        await db.homework_media.insert_one({
            "id": media_id, "homework_id": None, "kind": "school_resource",
            "filename": filename, "uploaded_at": now_iso(), "uploaded_by": user.get("id"),
            "storage_backend": "filesystem", **stored,
        })
        resource_id = str(uuid.uuid4())
        await db.school_resources.insert_one({
            "id": resource_id, "title": filename,
            "kind": "image" if mime.startswith("image/") else "video",
            "media_id": media_id, "active": True, "created_at": now_iso(),
            "created_by": user.get("id"), "import_digest": digest,
        })
        cache[digest] = resource_id
        return resource_id

    @api.post("/admin/school/curriculum/import")
    async def import_curriculum_package(body: CurriculumPackageIn,
                                        user: dict = Depends(manage_dep)):
        """Import a full curriculum from a .zip of manifest.json + media.

        The package is validated in FULL before anything is written, so a
        package that goes wrong half way down leaves no half-built course
        behind. `dry_run` returns the same summary with no writes at all.

        Re-import is by `source_key`: a program imported from the same key is
        updated in place rather than duplicated. What the package declares, the
        package owns; a lesson or block an author added that the package never
        mentions is left alone.
        """
        try:
            manifest, files = pkg.open_package(body.data)
            plan = pkg.validate(manifest, files)
        except pkg.ImportError_ as e:
            raise HTTPException(status_code=422, detail={
                "error_code": "invalid_curriculum_package", "errors": e.errors})

        program_src = plan["program"]
        source_key = plan["source_key"]
        existing = None
        if source_key:
            existing = await db.programs.find_one({"import_source_key": source_key}, {"_id": 0})

        counts = plan["counts"]
        summary = {
            "program_name": program_src.get("name"),
            "program_action": "would_update" if existing else "would_create",
            "modules": counts["modules"], "lessons": counts["lessons"],
            "blocks": counts["blocks"], "images": counts["images"],
            "videos": counts["videos"],
            "unplaced_media": len(plan["unplaced"]),
            "unplaced_media_paths": plan["unplaced"],
            "warnings": plan["warnings"], "errors": [],
        }
        if body.dry_run:
            return summary

        # ---- media first: every reference resolves before the course is written
        cache: dict = {}
        resource_by_path: dict = {}
        for item in plan["media_plan"]:
            path = item["path"]
            if path not in resource_by_path:
                resource_by_path[path] = await _ingest(path, files[path], item["mime"], user, cache)

        # Media shipped in the package that no block references is imported into
        # the School library and reported — never silently dropped.
        for path in plan["unplaced"]:
            ext = posixpath.splitext(path)[1].lower()
            mime = pkg.MEDIA_EXT_MIME.get(ext)
            if mime:
                await _ingest(path, files[path], mime, user, cache)

        # ---- bundled Practice recipes, mirroring the .json template path
        #
        # A package may ship the Practice Coach recipes its lessons link to,
        # because a curriculum written elsewhere cannot know this install's
        # template ids. Each is recreated once per source key and every
        # lesson's link is rewritten to the fresh id. A link the package did
        # NOT bundle is left exactly as authored — it may already exist here.
        hw_map: dict = {}
        bundled = manifest.get('homework_templates') or []
        if bundled and create_homework_template and homework_template_model:
            for tpl in bundled:
                key = (tpl.get('source_key') or tpl.get('id') or '').strip()
                payload = {k: v for k, v in tpl.items()
                           if k not in ('source_key', 'id', 'created_at', 'updated_at')}
                existing_tpl = None
                if key:
                    existing_tpl = await db.homework_templates.find_one(
                        {'import_source_key': key}, {'_id': 0, 'id': 1})
                if existing_tpl:
                    hw_map[key] = existing_tpl['id']
                    continue
                made = await create_homework_template(homework_template_model(**payload), user)
                if key:
                    await db.homework_templates.update_one(
                        {'id': made['id']}, {'$set': {'import_source_key': key}})
                    hw_map[key] = made['id']

        def _remap(ids):
            return [hw_map.get(i, i) for i in (ids or [])]

        # ---- rebuild in the canonical curriculum shape
        modules_out = []
        for module in program_src.get("modules") or []:
            lessons_out = []
            for lesson in module.get("lessons") or []:
                blocks_out = []
                for bi, block in enumerate(lesson.get("content_blocks") or []):
                    out = {k: v for k, v in block.items()
                           if k not in ("media", "source_key")}
                    out["order"] = block.get("order", bi)
                    media_ref = (block.get("media") or "").strip()
                    if media_ref:
                        safe = pkg._safe_member(media_ref)
                        out["resource_id"] = resource_by_path.get(safe)
                        out["url"] = None
                    if block.get("source_key"):
                        out["config"] = {**(out.get("config") or {}),
                                         "import_source_key": block["source_key"]}
                    blocks_out.append(out)
                l_out = {k: v for k, v in lesson.items() if k != "source_key"}
                l_out["content_blocks"] = blocks_out
                if l_out.get("suggested_homework_template_ids"):
                    l_out["suggested_homework_template_ids"] = _remap(
                        l_out["suggested_homework_template_ids"])
                lessons_out.append(l_out)
            m_out = {k: v for k, v in module.items() if k != "source_key"}
            m_out["lessons"] = lessons_out
            modules_out.append(m_out)

        payload = {k: v for k, v in program_src.items()
                   if k not in ("source_key", "modules", "id")}
        payload["modules"] = modules_out
        payload.setdefault("type", "private_lessons")
        payload.setdefault("price", 0)

        model = program_model(**payload)
        if existing:
            saved = await update_program(existing["id"], model, cascade=False,
                                         save_as_draft=False, _=user)
            summary["program_action"] = "updated"
        else:
            saved = await create_program(model, user)
            summary["program_action"] = "created"
        if source_key:
            await db.programs.update_one({"id": saved["id"]},
                                         {"$set": {"import_source_key": source_key}})
        summary["practice_recipes"] = len(hw_map)
        summary["program_id"] = saved["id"]
        return summary

    return import_curriculum_package
