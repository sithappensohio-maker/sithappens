"""Online School — importing a full curriculum from a ZIP package.

A curriculum author works in documents and folders. This suite drives the real
endpoint with real .zip bytes built in memory, so what is tested is what an
author would actually upload.

The three things that matter most here:

  * `manifest.json` ordering is authoritative — a text/image/text lesson
    imports as text, image, text, and the image lands as an ORDINARY content
    block with a resource id, caption and alt text, indistinguishable from one
    an author added by hand;
  * a bad package writes NOTHING — validation runs over the whole manifest
    before any course data is touched, so a package that breaks half way down
    cannot leave a half-built program behind;
  * re-importing the same package updates rather than duplicates, and media is
    matched by content so the same picture is never uploaded twice.
"""
import base64
import datetime
import io
import json
import uuid
import zipfile

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import school_curriculum_import as pkg
from _test_loop import run

TAG = "TEST_CURRIC_IMPORT"


# ---------------------------------------------------------------------------
# Building real packages
# ---------------------------------------------------------------------------

def _png(w=8, h=8, rgb=(10, 120, 200)) -> bytes:
    """A genuinely valid PNG, so nothing here depends on a fixture file."""
    import struct
    import zlib
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def _zip(manifest, files=None, manifest_name="manifest.json") -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        if manifest is not None:
            payload = manifest if isinstance(manifest, str) else json.dumps(manifest)
            zf.writestr(manifest_name, payload)
        for path, blob in (files or {}).items():
            zf.writestr(path, blob)
    return "data:application/zip;base64," + base64.b64encode(buf.getvalue()).decode()


def _block(kind, order, **kw):
    b = {"type": kind, "order": order}
    b.update(kw)
    return b


def _manifest(source_key=f"{TAG}-course", name=None, blocks=None, extra_modules=None,
              version=3):
    """The realistic shape: a Sit Happens course with a mixed-media lesson."""
    lesson_blocks = blocks if blocks is not None else [
        _block("text", 0, source_key="b-intro", title="Why a clean sit matters",
               body="A clean sit is the foundation for door manners and greetings."),
        _block("image", 1, source_key="b-lure", media="media/lure-position.png",
               config={"caption": "Correct lure position: above and slightly behind the nose.",
                       "alt": "A handler holds a treat above a dog's nose."}),
        _block("text", 2, source_key="b-move", title="Moving the lure",
               body="Draw the treat up and back. The nose follows and the rear folds."),
        _block("image", 3, source_key="b-done", media="media/finished-sit.png",
               config={"caption": "Weight back, front feet still.",
                       "alt": "A dog sitting squarely."}),
        _block("checklist", 4, source_key="b-prep", title="Before you begin",
               items=["Soft treats", "A quiet room"]),
        _block("quiz", 5, source_key="b-check", title="Quick check",
               body="Where should the treat be?",
               items=["Above the nose", "On the floor"],
               config={"correct_answer": "Above the nose"}),
    ]
    modules = [{
        "source_key": "m1", "name": "Module 1 — Foundations", "order": 0,
        "goals": [{"source_key": "g1", "name": "Sit"}],
        "lessons": [{
            "source_key": "m1l1", "name": "Lesson 1 — Teach a Clean Sit", "order": 0,
            "active": True, "client_overview": "Teach a square, calm sit.",
            "success_criteria": "Three clean folds in a row.",
            "content_blocks": lesson_blocks,
        }],
    }]
    if extra_modules:
        modules.extend(extra_modules)
    return {
        "sit_happens_template": "online_school_program",
        "version": version,
        "program": {
            "source_key": source_key,
            "name": name or f"{TAG} Sit & Down Foundations",
            "type": "private_lessons", "delivery_mode": "self_guided",
            "format": {"count": len(modules), "unit": "modules"}, "price": 0,
            "modules": modules,
        },
    }


_MEDIA = {"media/lure-position.png": _png(),
          "media/finished-sit.png": _png(rgb=(200, 90, 40))}


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

def _admin():
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": "admin", "name": f"{TAG} admin",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": "admin", "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _post(user, data, dry_run=False):
    async def go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test",
                                     timeout=60) as c:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await c.post("/api/admin/school/curriculum/import", headers=headers,
                                json={"data": data, "filename": "course.zip",
                                      "dry_run": dry_run})
    return run(go())


def _cleanup():
    progs = run(server.db.programs.find(
        {"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(50))
    for p in progs:
        run(server.db.programs.delete_one({"id": p["id"]}))
    res = run(server.db.school_resources.find(
        {"import_digest": {"$exists": True}}, {"_id": 0, "id": 1, "media_id": 1}).to_list(200))
    for r in res:
        run(server.db.homework_media.delete_one({"id": r.get("media_id")}))
        run(server.db.school_resources.delete_one({"id": r["id"]}))
    run(server.db.users.delete_many({"name": f"{TAG} admin"}))


@pytest.fixture(autouse=True)
def _clean():
    _cleanup()
    yield
    _cleanup()


def _program(name_prefix=TAG):
    return run(server.db.programs.find_one({"name": {"$regex": f"^{name_prefix}"}}, {"_id": 0}))


def _blocks_of(prog, m=0, l=0):
    return prog["modules"][m]["lessons"][l]["content_blocks"]


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------

def test_a_full_package_imports_into_a_real_program():
    admin = _admin()
    r = _post(admin, _zip(_manifest(), _MEDIA))
    assert r.status_code == 200, r.text[:400]
    s = r.json()
    assert s["program_action"] == "created"
    assert (s["modules"], s["lessons"], s["images"]) == (1, 1, 2), s
    prog = _program()
    assert prog and prog["modules"][0]["lessons"][0]["name"].endswith("Teach a Clean Sit")


def test_manifest_order_is_authoritative():
    # text -> image -> text -> image -> checklist -> quiz, exactly as authored.
    admin = _admin()
    assert _post(admin, _zip(_manifest(), _MEDIA)).status_code == 200
    kinds = [b["type"] for b in _blocks_of(_program())]
    assert kinds == ["text", "image", "text", "image", "checklist", "quiz"], kinds
    assert [b["order"] for b in _blocks_of(_program())] == [0, 1, 2, 3, 4, 5]


def test_an_imported_image_is_an_ordinary_editable_block():
    admin = _admin()
    assert _post(admin, _zip(_manifest(), _MEDIA)).status_code == 200
    img = [b for b in _blocks_of(_program()) if b["type"] == "image"][0]
    # exactly what Program Studio writes by hand
    assert img["resource_id"], "no resource reference — not a normal image block"
    assert img["config"]["caption"].startswith("Correct lure position")
    assert img["config"]["alt"].startswith("A handler holds")
    assert img.get("url") in (None, "")
    # and the resource is an ordinary School Resource
    res = run(server.db.school_resources.find_one({"id": img["resource_id"]}, {"_id": 0}))
    assert res["kind"] == "image" and res["active"] is True
    media = run(server.db.homework_media.find_one({"id": res["media_id"]}, {"_id": 0}))
    assert media["kind"] == "school_resource" and media["mime"] == "image/png"


def test_there_is_no_separate_imported_media_model():
    admin = _admin()
    assert _post(admin, _zip(_manifest(), _MEDIA)).status_code == 200
    img = [b for b in _blocks_of(_program()) if b["type"] == "image"][0]
    # the block carries no import-only fields beyond the source key we keep
    assert "media" not in img
    assert set(img.keys()) <= {"id", "type", "title", "body", "url", "resource_id",
                               "items", "config", "order", "active"}


def test_existing_block_types_survive_the_round_trip():
    admin = _admin()
    assert _post(admin, _zip(_manifest(), _MEDIA)).status_code == 200
    blocks = _blocks_of(_program())
    checklist = next(b for b in blocks if b["type"] == "checklist")
    quiz = next(b for b in blocks if b["type"] == "quiz")
    assert checklist["items"] == ["Soft treats", "A quiet room"]
    assert quiz["config"]["correct_answer"] == "Above the nose"


def test_a_video_block_can_reference_packaged_media():
    admin = _admin()
    blocks = [
        _block("text", 0, body="Read this."),
        _block("video", 1, media="media/clip.mp4"),
    ]
    files = {**_MEDIA, "media/clip.mp4": b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64}
    r = _post(admin, _zip(_manifest(blocks=blocks), files))
    assert r.status_code == 200, r.text[:300]
    assert r.json()["videos"] == 1
    vid = [b for b in _blocks_of(_program()) if b["type"] == "video"][0]
    assert vid["resource_id"]


# ---------------------------------------------------------------------------
# Unplaced media is retained, never discarded
# ---------------------------------------------------------------------------

def test_media_with_no_block_reference_is_kept_and_reported():
    admin = _admin()
    files = {**_MEDIA, "media/spare-diagram.png": _png(rgb=(20, 200, 120))}
    r = _post(admin, _zip(_manifest(), files))
    assert r.status_code == 200
    s = r.json()
    assert s["unplaced_media"] == 1
    assert s["unplaced_media_paths"] == ["media/spare-diagram.png"]
    # ...and it really is in the library, not just counted
    titles = [x["title"] for x in run(server.db.school_resources.find(
        {"import_digest": {"$exists": True}}, {"_id": 0, "title": 1}).to_list(50))]
    assert "spare-diagram.png" in titles


def test_a_package_with_no_unplaced_media_reports_zero():
    admin = _admin()
    s = _post(admin, _zip(_manifest(), _MEDIA)).json()
    assert s["unplaced_media"] == 0 and s["unplaced_media_paths"] == []


# ---------------------------------------------------------------------------
# A bad package writes nothing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mutate,expect", [
    (lambda m: m.update({"sit_happens_template": "something_else"}), "Sit Happens curriculum package"),
    (lambda m: m.update({"version": 99}), "Unsupported package version"),
    (lambda m: m.pop("program"), "no `program`"),
    (lambda m: m["program"].update({"name": ""}), "needs a name"),
    (lambda m: m["program"].update({"modules": []}), "at least one module"),
])
def test_an_invalid_manifest_is_refused(mutate, expect):
    admin = _admin()
    man = _manifest()
    mutate(man)
    r = _post(admin, _zip(man, _MEDIA))
    assert r.status_code == 422, r.status_code
    body = r.json()["detail"]
    assert body["error_code"] == "invalid_curriculum_package"
    assert any(expect in e for e in body["errors"]), body["errors"]
    assert _program() is None, "a rejected package still created a program"


def test_a_missing_media_file_is_refused_before_anything_is_written():
    admin = _admin()
    r = _post(admin, _zip(_manifest(), {"media/lure-position.png": _png()}))  # second file absent
    assert r.status_code == 422
    assert any("finished-sit.png" in e for e in r.json()["detail"]["errors"])
    assert _program() is None
    # and no orphan resource was created for the file that WAS present
    assert run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}})) == 0


def test_path_traversal_is_refused():
    admin = _admin()
    for evil in ("../escape.png", "media/../../escape.png", "/etc/passwd"):
        blocks = [_block("image", 0, media=evil)]
        r = _post(admin, _zip(_manifest(blocks=blocks), _MEDIA))
        assert r.status_code == 422, evil
    assert _program() is None


def test_a_zip_entry_that_escapes_the_package_is_refused():
    # Not just the manifest reference — the archive member itself.
    admin = _admin()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(_manifest()))
        zf.writestr("../evil.png", _png())
    data = "data:application/zip;base64," + base64.b64encode(buf.getvalue()).decode()
    r = _post(admin, data)
    assert r.status_code == 422
    assert any("Unsafe" in e for e in r.json()["detail"]["errors"])


def test_duplicate_source_keys_are_refused():
    admin = _admin()
    blocks = [_block("text", 0, source_key="dup", body="a"),
              _block("text", 1, source_key="dup", body="b")]
    r = _post(admin, _zip(_manifest(blocks=blocks), _MEDIA))
    assert r.status_code == 422
    assert any("Duplicate block source_key" in e for e in r.json()["detail"]["errors"])
    assert _program() is None


def test_an_unsupported_media_type_is_refused():
    admin = _admin()
    blocks = [_block("image", 0, media="media/logo.svg")]
    r = _post(admin, _zip(_manifest(blocks=blocks), {**_MEDIA, "media/logo.svg": b"<svg/>"}))
    assert r.status_code == 422
    assert any("unsupported media type" in e.lower() or "usable inline" in e.lower()
               for e in r.json()["detail"]["errors"])


def test_heic_is_not_accepted_as_an_inline_lesson_image():
    # It does not render in Chromium, Firefox or Edge; accepting it would ship
    # a broken picture to most students.
    admin = _admin()
    blocks = [_block("image", 0, media="media/photo.heic")]
    r = _post(admin, _zip(_manifest(blocks=blocks), {**_MEDIA, "media/photo.heic": b"\x00" * 32}))
    assert r.status_code == 422


def test_a_non_zip_upload_is_refused():
    admin = _admin()
    r = _post(admin, "data:application/zip;base64," + base64.b64encode(b"not a zip").decode())
    assert r.status_code == 422
    assert any("not a .zip" in e for e in r.json()["detail"]["errors"])


def test_a_package_with_no_manifest_is_refused():
    admin = _admin()
    r = _post(admin, _zip(None, _MEDIA))
    assert r.status_code == 422
    assert any("no manifest.json" in e for e in r.json()["detail"]["errors"])


def test_every_problem_is_reported_not_just_the_first():
    admin = _admin()
    man = _manifest()
    man["program"]["modules"][0]["name"] = ""
    man["program"]["modules"][0]["lessons"][0]["name"] = ""
    r = _post(admin, _zip(man, _MEDIA))
    assert r.status_code == 422
    assert len(r.json()["detail"]["errors"]) >= 2


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

def test_a_dry_run_reports_without_writing():
    admin = _admin()
    r = _post(admin, _zip(_manifest(), _MEDIA), dry_run=True)
    assert r.status_code == 200
    s = r.json()
    assert s["program_action"] == "would_create"
    assert (s["modules"], s["lessons"], s["images"]) == (1, 1, 2)
    assert _program() is None, "a dry run created a program"
    assert run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}})) == 0


# ---------------------------------------------------------------------------
# Re-import
# ---------------------------------------------------------------------------

def test_re_importing_the_same_package_updates_instead_of_duplicating():
    admin = _admin()
    first = _post(admin, _zip(_manifest(), _MEDIA)).json()
    second = _post(admin, _zip(_manifest(), _MEDIA)).json()
    assert first["program_action"] == "created"
    assert second["program_action"] == "updated"
    assert second["program_id"] == first["program_id"]
    assert run(server.db.programs.count_documents({"name": {"$regex": f"^{TAG}"}})) == 1


def test_re_import_does_not_upload_the_same_image_twice():
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    after_first = run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}}))
    _post(admin, _zip(_manifest(), _MEDIA))
    after_second = run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}}))
    assert after_first == after_second == 2, (after_first, after_second)


def test_re_import_does_not_multiply_content_blocks():
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    before = len(_blocks_of(_program()))
    _post(admin, _zip(_manifest(), _MEDIA))
    assert len(_blocks_of(_program())) == before


def test_a_different_source_key_is_a_different_course():
    admin = _admin()
    _post(admin, _zip(_manifest(source_key=f"{TAG}-a", name=f"{TAG} Course A"), _MEDIA))
    _post(admin, _zip(_manifest(source_key=f"{TAG}-b", name=f"{TAG} Course B"), _MEDIA))
    assert run(server.db.programs.count_documents({"name": {"$regex": f"^{TAG}"}})) == 2


def test_an_updated_package_changes_the_course_in_place():
    admin = _admin()
    first = _post(admin, _zip(_manifest(), _MEDIA)).json()
    man = _manifest()
    man["program"]["modules"][0]["lessons"][0]["name"] = "Lesson 1 — Teach a Square Sit"
    second = _post(admin, _zip(man, _MEDIA)).json()
    assert second["program_id"] == first["program_id"]
    assert _program()["modules"][0]["lessons"][0]["name"].endswith("Square Sit")


# ---------------------------------------------------------------------------
# Backwards compatibility
# ---------------------------------------------------------------------------

def test_a_version_2_package_with_no_media_still_imports():
    # The template Program Studio already exports today.
    admin = _admin()
    man = {
        "sit_happens_template": "online_school_program", "version": 2,
        "program": {
            "name": f"{TAG} Legacy Template", "type": "private_lessons",
            "format": {"count": 1, "unit": "modules"}, "price": 0,
            "modules": [{"name": "Module 1", "order": 0, "goals": [{"name": "Sit"}],
                         "lessons": [{"name": "Lesson 1", "order": 0, "active": True,
                                      "client_overview": "Text only."}]}],
        },
    }
    r = _post(admin, _zip(man))
    assert r.status_code == 200, r.text[:300]
    assert r.json()["images"] == 0
    assert run(server.db.programs.find_one({"name": f"{TAG} Legacy Template"}, {"_id": 0}))


def test_the_existing_csv_importer_is_untouched():
    # The ZIP importer is additive; the modules+goals CSV path still exists.
    import pathlib
    csv_lib = (pathlib.Path(__file__).resolve().parents[1] / "frontend" / "src" /
               "lib" / "csvImport.js").read_text(encoding="utf-8")
    assert "parseProgramCsv" in csv_lib and "module_name" in csv_lib


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

def test_an_anonymous_caller_cannot_import_a_curriculum():
    r = _post(None, _zip(_manifest(), _MEDIA))
    assert r.status_code in (401, 403)
    assert _program() is None


def test_a_client_cannot_import_a_curriculum():
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": "client", "client_id": str(uuid.uuid4()),
           "name": f"{TAG} client", "email": f"{uuid.uuid4().hex[:8]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": "client", "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    try:
        r = _post(doc, _zip(_manifest(), _MEDIA))
        assert r.status_code in (401, 403)
        assert _program() is None
    finally:
        run(server.db.users.delete_one({"id": uid}))


# ---------------------------------------------------------------------------
# Package reader units
# ---------------------------------------------------------------------------

def test_safe_member_rejects_escapes_and_accepts_ordinary_paths():
    for bad in ("../x.png", "/abs/x.png", "a/../../x.png", "C:/x.png", "media/"):
        assert pkg._safe_member(bad) is None, bad
    assert pkg._safe_member("media/x.png") == "media/x.png"
    assert pkg._safe_member("media\\x.png") == "media/x.png"


def test_media_identity_is_content_not_filename():
    a, b = _png(), _png()
    assert pkg.media_digest(a) == pkg.media_digest(b)
    assert pkg.media_digest(a) != pkg.media_digest(_png(rgb=(1, 2, 3)))


# ---------------------------------------------------------------------------
# Practice configuration travels with the package
# ---------------------------------------------------------------------------

def _with_practice(source_key=f"{TAG}-practice"):
    man = _manifest(source_key=source_key, name=f"{TAG} Practice Course")
    man["homework_templates"] = [{
        "source_key": "recipe-sit", "name": f"{TAG} Clean Sit Practice",
        "tier": "foundation", "description": "Short daily reps.",
        "default_duration_days": 7,
    }]
    man["program"]["modules"][0]["lessons"][0]["suggested_homework_template_ids"] = ["recipe-sit"]
    return man


def test_a_bundled_practice_recipe_is_created_and_relinked():
    # A curriculum written elsewhere cannot know this install's template ids,
    # so the package ships the recipe and the importer rewrites the link.
    admin = _admin()
    r = _post(admin, _zip(_with_practice(), _MEDIA))
    assert r.status_code == 200, r.text[:300]
    assert r.json()["practice_recipes"] == 1
    lesson = _program(f"{TAG} Practice Course")["modules"][0]["lessons"][0]
    linked = lesson["suggested_homework_template_ids"]
    assert linked and linked[0] != "recipe-sit", "the source key was never remapped"
    tpl = run(server.db.homework_templates.find_one({"id": linked[0]}, {"_id": 0}))
    assert tpl and tpl["name"] == f"{TAG} Clean Sit Practice"
    run(server.db.homework_templates.delete_one({"id": linked[0]}))


def test_re_importing_does_not_duplicate_the_practice_recipe():
    admin = _admin()
    _post(admin, _zip(_with_practice(), _MEDIA))
    first = run(server.db.homework_templates.count_documents(
        {"name": f"{TAG} Clean Sit Practice"}))
    _post(admin, _zip(_with_practice(), _MEDIA))
    second = run(server.db.homework_templates.count_documents(
        {"name": f"{TAG} Clean Sit Practice"}))
    assert first == second == 1, (first, second)
    run(server.db.homework_templates.delete_many({"name": f"{TAG} Clean Sit Practice"}))


def test_a_practice_link_the_package_did_not_bundle_is_left_alone():
    # It may already be a real recipe on this install; dropping it would break
    # a working lesson.
    admin = _admin()
    man = _manifest(source_key=f"{TAG}-keep", name=f"{TAG} Keep Links")
    man["program"]["modules"][0]["lessons"][0]["suggested_homework_template_ids"] = ["already-here"]
    assert _post(admin, _zip(man, _MEDIA)).status_code == 200
    lesson = _program(f"{TAG} Keep Links")["modules"][0]["lessons"][0]
    assert lesson["suggested_homework_template_ids"] == ["already-here"]
