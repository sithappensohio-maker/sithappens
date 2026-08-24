"""Online School — the curriculum-package import route.

Registered the same way `school_suite.py` is: server hands in the pieces it
owns (db, permission dependency, media persistence) so this module stays
testable and server.py stays readable.

The parsing and validation live in `school_curriculum_import`; everything here
is the write path — turning a validated plan into ordinary curriculum through
the SAME `create_program` / `update_program` the Studio uses, so an imported
course is indistinguishable from a hand-built one.
"""
import logging
import os
import posixpath
import uuid
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import school_curriculum_import as pkg

logger = logging.getLogger("sithappens")


class MediaStorageError(Exception):
    """School media could not be written to disk.

    A misconfigured server, not a bad package: the author did nothing wrong
    and no amount of re-editing their .zip will help. Carries the real cause
    and path for the server log; the client is told what is wrong in terms it
    can act on, without being handed the server's filesystem layout.
    """

    def __init__(self, path: str, cause: BaseException):
        super().__init__(str(cause))
        self.path = path
        self.cause = cause


class CurriculumPackageIn(BaseModel):
    data: str
    filename: Optional[str] = None
    dry_run: bool = False
    # "merge" (default) adds what is new and leaves anything an author has
    # already touched alone. "replace" deliberately refreshes declared nodes
    # from the package. Neither deletes.
    mode: str = "replace"
    # Program Studio's normal "upload a newer ZIP" workflow refreshes the
    # curriculum from the package but must not accidentally reset business
    # settings the owner may have changed after the first import (price, Shop
    # visibility, tax setup, fulfillment, etc.). API callers can still request
    # a literal package-owned replace by leaving this false.
    preserve_local_settings: bool = True
    # Online School students read their frozen program_snapshot. When an owner
    # intentionally refreshes a course ZIP, this opt-in updates ACTIVE
    # snapshots through update_program's existing cascade path, which preserves
    # progress for surviving skill ids instead of stranding current students on
    # the old text/images.
    cascade_active_enrollments: bool = True
    # An admin's answer to "an existing course already owns this pathway — is
    # this package that course?". Absent, the import refuses to guess. The
    # field name is retained for API compatibility with the earlier
    # archived-course-only confirmation flow.
    adopt_program_id: Optional[str] = None


# Fields that belong to the local business/catalog configuration rather than
# the authored lesson body. A Program Studio ZIP refresh should not silently
# zero a price, hide/show a product, change tax treatment, or move fulfillment
# just because the package was rebuilt to replace lesson text/images.
_LOCAL_SETTINGS_PRESERVED_ON_PACKAGE_UPDATE = (
    "price",
    "welcome_homework_template_id",
    "welcome_email_template_slug",
    "available_online",
    "online_description",
    "image_id",
    "category_id",
    "subcategory_id",
    "publicly_visible",
    "show_public_price",
    "requires_dog",
    "requires_approval",
    "requires_completed_onboarding",
    "show_at_register",
    "featured",
    "taxable",
    "tax_exempt_reason",
    "delivery_mode",
    "purchase_fulfillment",
    "school_default_trainer_id",
    "free_enrollment_enabled",
)


def _pathway_slug(program_src: dict) -> str:
    """The pathway slug `create_program` would derive for this package.

    Mirrors server.py on purpose: the point is to find the course that already
    owns the slug this import WOULD claim, and a near-miss would silently stop
    finding it.
    """
    slug = (program_src.get("slug") or "").strip()
    if slug:
        return slug
    name = (program_src.get("name") or "").strip()
    return name.lower().replace(" ", "_")[:40] if name else ""


def _strip_source_keys(modules):
    """Remove the transient __source_key markers before the curriculum models
    ever see them."""
    out = []
    for m in modules:
        m2 = {k: v for k, v in m.items() if k != "__source_key"}
        m2["lessons"] = [{k: v for k, v in l.items() if k != "__source_key"}
                         for l in (m.get("lessons") or [])]
        out.append(m2)
    return out


def _rebuild_key_map(program_src, saved_modules, previous):
    """Map each package source key to the id the server assigned.

    Modules and lessons cannot carry an extra field through the curriculum
    models, so their identity is remembered here on the program instead.
    Matching is positional against what was just saved, which is exact
    because the merge above produced that very list.
    """
    key_map = dict(previous or {})
    src_modules = program_src.get("modules") or []
    for i, src_m in enumerate(src_modules):
        mk = (src_m.get("source_key") or "").strip()
        if mk and f"module:{mk}" not in key_map and i < len(saved_modules):
            key_map[f"module:{mk}"] = saved_modules[i].get("id")
        saved_lessons = (saved_modules[i].get("lessons") or []) if i < len(saved_modules) else []
        for j, src_l in enumerate(src_m.get("lessons") or []):
            lk = (src_l.get("source_key") or "").strip()
            if lk and f"lesson:{lk}" not in key_map and j < len(saved_lessons):
                key_map[f"lesson:{lk}"] = saved_lessons[j].get("id")
    return key_map

def register_curriculum_import(*, api, db, manage_dep, persist_school_media,
                               program_model, create_program, update_program, now_iso,
                               homework_template_model=None, create_homework_template=None):

    async def _ingest(path: str, blob: bytes, mime: str, user: dict, cache: dict,
                      created: list) -> str:
        """One packaged file -> one School Resource, reusing an identical one.

        Identity is the file CONTENT, not its name, so re-importing the same
        package — or two lessons sharing one diagram — yields a single
        resource instead of a growing pile of duplicates.
        """
        # Digest the ORIGINAL bytes, not the optimised ones: that keeps
        # re-import dedupe anchored to the source file even if the
        # optimisation policy is ever tuned.
        digest = pkg.media_digest(blob)
        if digest in cache:
            return cache[digest]
        existing = await db.school_resources.find_one(
            {"import_digest": digest, "active": True}, {"_id": 0, "id": 1})
        if existing:
            cache[digest] = existing["id"]
            return existing["id"]

        # An inline demonstration image is a web asset wherever it came from,
        # so a packaged one gets the same treatment a Studio upload does
        # instead of shipping a 10 MB photograph to every student.
        blob, mime = pkg.optimize_lesson_image(blob, mime)
        filename = path.rsplit("/", 1)[-1]
        media_id = str(uuid.uuid4())
        try:
            stored = persist_school_media(pkg.data_url(blob, mime), media_id, filename)
        except OSError as e:
            # Permission denied, read-only mount, missing directory, disk full:
            # all the same story to a caller — this server cannot store media.
            raise MediaStorageError(path, e) from e
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
        # Only what THIS request created, so a rollback can undo its own work
        # without touching resources an earlier import already established.
        created.append({"media_id": media_id, "resource_id": resource_id,
                        "storage_path": stored.get("storage_path")})
        return resource_id


    async def _rollback_media(created: list) -> None:
        """Undo this request's media writes.

        Media is ingested before the course is written, so a storage failure
        half way through would otherwise leave orphan School Resources
        pointing at files that were never finished — visible in the media
        library, attached to no lesson, and impossible to explain later.
        """
        for item in created:
            try:
                if item.get("storage_path") and os.path.exists(item["storage_path"]):
                    os.remove(item["storage_path"])
            except OSError:
                pass
            await db.homework_media.delete_one({"id": item["media_id"]})
            await db.school_resources.delete_one({"id": item["resource_id"]})

    @api.post("/admin/school/curriculum/import")
    async def import_curriculum_package(body: CurriculumPackageIn,
                                        user: dict = Depends(manage_dep)):
        """Import a full curriculum from a .zip of manifest.json + media.

        The package is validated in FULL before anything is written, so a
        package that goes wrong half way down leaves no half-built course
        behind. `dry_run` returns the same summary with no writes at all.

        Re-import prefers `source_key`: a program imported from the same key is
        updated in place rather than duplicated. If a rebuilt package has a new
        source key but exactly one stored course already owns the same pathway
        slug, the admin is asked to confirm that exact in-place update instead
        of being trapped by the slug uniqueness check. What the package
        declares, the package owns; a lesson or block an author added that the
        package never mentions is left alone.
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

        # ---- another stored course may already own this pathway
        #
        # A re-built ZIP can legitimately arrive with a different source_key
        # (for example after exporting/re-authoring the package), while the
        # course's stable pathway slug is still the same. Likewise, "Delete" in
        # Programs is intentionally a soft archive, so an archived row still
        # owns its slug and package key. Refusing these cases dead-ends the owner
        # with a duplicate-slug error even though the safe outcome is obvious:
        # preserve the existing program id and update that course in place.
        #
        # We still never GUESS. If source_key did not identify the program, an
        # unambiguous single slug owner is offered back to the admin and nothing
        # is written until that exact program id is confirmed. This works for
        # active or archived courses and for rows previously claimed by an older
        # package key.
        pathway_match = None
        pathway_slug = _pathway_slug(program_src)
        if existing is None and pathway_slug:
            owners = await db.programs.find(
                {"slug": pathway_slug}, {"_id": 0}).to_list(5)
            if len(owners) == 1:
                pathway_match = owners[0]

        if pathway_match is not None and body.adopt_program_id != pathway_match["id"]:
            # Not an error the author can fix by editing the package. It is a
            # confirmation question, not a failure: nothing is written until
            # the owner confirms the one exact course the server found.
            prior_key = (pathway_match.get("import_source_key") or "").strip()
            raise HTTPException(status_code=409, detail={
                "error_code": "archived_course_adoption_required",
                "msg": ("A course already uses this pathway. Confirm whether "
                        "to update that existing course from this ZIP."),
                "program_id": pathway_match["id"],
                "program_name": pathway_match.get("name"),
                "pathway_slug": pathway_slug,
                "existing_active": bool(pathway_match.get("active")),
                "source_key_changed": bool(prior_key and source_key and prior_key != source_key),
                # If the package declares active: true, confirming an archived
                # course brings it back. Said out loud rather than done quietly.
                "will_reactivate": bool(
                    not pathway_match.get("active") and program_src.get("active", True)),
                "modules": counts["modules"], "lessons": counts["lessons"],
                "images": counts["images"],
                "practice_recipes": len(manifest.get("homework_templates") or []),
            })
        if body.adopt_program_id:
            if pathway_match is None or body.adopt_program_id != pathway_match.get("id"):
                # The catalogue moved between asking and answering — someone
                # renamed the course, changed its pathway, or a different row
                # became the unique owner. Applying a stale answer could
                # overwrite the wrong course.
                raise HTTPException(status_code=409, detail={
                    "error_code": "adoption_no_longer_available",
                    "msg": ("That course can no longer be updated from this "
                            "confirmation. Re-run the import to see the current options."),
                })
            existing = pathway_match

        summary = {
            "program_name": program_src.get("name"),
            "program_action": ("would_adopt" if pathway_match is not None
                               else "would_update" if existing else "would_create"),
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
        created: list = []
        try:
            for item in plan["media_plan"]:
                path = item["path"]
                if path not in resource_by_path:
                    resource_by_path[path] = await _ingest(
                        path, files[path], item["mime"], user, cache, created)

            # Media shipped in the package that no block references is imported
            # into the School library and reported — never silently dropped.
            for path in plan["unplaced"]:
                ext = posixpath.splitext(path)[1].lower()
                mime = pkg.MEDIA_EXT_MIME.get(ext)
                if mime:
                    await _ingest(path, files[path], mime, user, cache, created)
        except MediaStorageError as e:
            # The course is written last, so nothing of it exists yet; undo the
            # media already stored and the import is as if it never ran.
            await _rollback_media(created)
            logger.exception(
                "School curriculum import failed: cannot store media for %r at %s",
                e.path, getattr(e.cause, "filename", None) or "the media directory")
            # `msg` is the key the client's formatErr renders, so the owner
            # reads the sentence rather than "[object Object]".
            raise HTTPException(status_code=503, detail={
                "error_code": "school_media_unwritable",
                "msg": ("School media storage is not writable. "
                        "Check server storage configuration."),
            })

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
                l_out["__source_key"] = lesson.get("source_key") or ""
                l_out["content_blocks"] = blocks_out
                if l_out.get("suggested_homework_template_ids"):
                    l_out["suggested_homework_template_ids"] = _remap(
                        l_out["suggested_homework_template_ids"])
                lessons_out.append(l_out)
            m_out = {k: v for k, v in module.items() if k != "source_key"}
            m_out["__source_key"] = module.get("source_key") or ""
            m_out["lessons"] = lessons_out
            modules_out.append(m_out)

        key_map = dict((existing or {}).get("import_key_map") or {})
        if existing:
            modules_out, _add = pkg.merge_curriculum(
                existing.get("modules") or [], modules_out, key_map, body.mode)
        modules_out = _strip_source_keys(modules_out)

        payload = {k: v for k, v in program_src.items()
                   if k not in ("source_key", "modules", "id")}
        if existing and body.mode == "merge":
            # A course an author has been polishing keeps its own name and
            # settings on an ordinary re-import; "replace" is how you push
            # those from the package.
            for field in ("name", "focus", "description", "price", "delivery_mode"):
                if field in existing:
                    payload[field] = existing[field]
        if existing and body.preserve_local_settings:
            # Program Studio's normal ZIP refresh is about curriculum content.
            # Preserve the owner's local commerce/operational choices even when
            # the lesson tree itself is intentionally refreshed from source.
            for field in _LOCAL_SETTINGS_PRESERVED_ON_PACKAGE_UPDATE:
                if field in existing:
                    payload[field] = existing[field]
        # The pathway slug is IDENTITY, not content: it is what other courses'
        # prerequisites point at, and what makes duplicate-pathway detection
        # mean anything. `create_program` derives one from the name, but
        # `update_program` writes the body verbatim - so a package that does
        # not declare a slug would blank it on every re-import, silently
        # breaking any course whose prerequisite pointed here and leaving this
        # course no longer defending its own pathway. Carry it over instead.
        if existing and not (payload.get("slug") or "").strip():
            payload["slug"] = existing.get("slug") or ""
        payload["modules"] = modules_out
        payload.setdefault("type", "private_lessons")
        payload.setdefault("price", 0)

        model = program_model(**payload)
        if existing:
            saved = await update_program(existing["id"], model,
                                         cascade=body.cascade_active_enrollments,
                                         save_as_draft=False, _=user)
            # Reusing the id preserves enrollments/history. When the caller opts
            # into cascade (the Program Studio ZIP updater does), update_program
            # refreshes ACTIVE snapshots while preserving progress on surviving
            # skill ids.
            summary["program_action"] = "adopted" if pathway_match is not None else "updated"
            summary["active_enrollments_refreshed"] = int(
                saved.get("_cascaded_enrollments") or 0)
        else:
            saved = await create_program(model, user)
            summary["program_action"] = "created"
            summary["active_enrollments_refreshed"] = 0
        if source_key:
            fresh = await db.programs.find_one({"id": saved["id"]}, {"_id": 0, "modules": 1})
            new_map = _rebuild_key_map(program_src, (fresh or {}).get("modules") or [], key_map)
            await db.programs.update_one(
                {"id": saved["id"]},
                {"$set": {"import_source_key": source_key, "import_key_map": new_map}})
        summary["practice_recipes"] = len(hw_map)
        summary["mode"] = body.mode
        summary["program_id"] = saved["id"]
        return summary

    return import_curriculum_package
