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
import os
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


def _post(user, data, dry_run=False, mode=None):
    async def go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test",
                                     timeout=60) as c:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await c.post("/api/admin/school/curriculum/import", headers=headers,
                                json={"data": data, "filename": "course.zip",
                                      "dry_run": dry_run,
                                      **({"mode": mode} if mode else {})})
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
    assert any("escapes the package" in e for e in r.json()["detail"]["errors"])


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


def test_an_ordinary_re_import_does_not_overwrite_an_existing_lesson():
    """MERGE is the default, and merge protects the author.

    The workflow is import -> polish in Program Studio -> maybe import an
    updated package later. If the second import replaced everything it
    declared, the polishing would be thrown away every single time.
    """
    admin = _admin()
    first = _post(admin, _zip(_manifest(), _MEDIA)).json()
    man = _manifest()
    man["program"]["modules"][0]["lessons"][0]["name"] = "Lesson 1 - Teach a Square Sit"
    second = _post(admin, _zip(man, _MEDIA)).json()
    assert second["program_id"] == first["program_id"]
    assert second["mode"] == "merge"
    assert _program()["modules"][0]["lessons"][0]["name"].endswith("Clean Sit"), (
        "an ordinary re-import silently renamed a lesson the author may have edited")


def test_replace_mode_deliberately_refreshes_from_the_package():
    # The escape hatch: destructive refresh exists, but you ask for it.
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    man = _manifest()
    man["program"]["modules"][0]["lessons"][0]["name"] = "Lesson 1 - Teach a Square Sit"
    r = _post(admin, _zip(man, _MEDIA), mode="replace")
    assert r.status_code == 200, r.text[:300]
    assert r.json()["mode"] == "replace"
    assert _program()["modules"][0]["lessons"][0]["name"].endswith("Square Sit")


def test_a_re_import_adds_genuinely_new_material():
    # Merge is not "do nothing" - a new lesson in the package still arrives.
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    man = _manifest()
    man["program"]["modules"][0]["lessons"].append({
        "source_key": "m1l2", "name": "Lesson 2 - Sit Without a Lure", "order": 1,
        "active": True, "client_overview": "Fade the food.",
        "content_blocks": [_block("text", 0, source_key="l2-b0", body="Empty hand.")],
    })
    _post(admin, _zip(man, _MEDIA))
    names = [l["name"] for l in _program()["modules"][0]["lessons"]]
    assert len(names) == 2, names
    assert any("Without a Lure" in n for n in names)


def test_manual_edits_survive_the_whole_documented_sequence():
    """The exact sequence from review: import, polish, re-import.

    Position, picture, caption, alt text and lesson prose are all edited by
    hand between the two imports, and every one of them must still be there
    afterwards.
    """
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    prog = _program()
    lesson = prog["modules"][0]["lessons"][0]
    blocks = lesson["content_blocks"]

    # 2. move the first image to the front   3. replace its picture
    img = next(b for b in blocks if b["type"] == "image")
    blocks.remove(img)
    img["resource_id"] = "author-picked-resource"
    #    4. edit the caption                 5. edit the alt text
    img["config"] = {**img["config"], "caption": "AUTHOR CAPTION",
                     "alt": "AUTHOR ALT"}
    blocks.insert(0, img)
    #    6. edit some lesson text
    txt = next(b for b in blocks if b["type"] == "text")
    txt["body"] = "AUTHOR REWROTE THIS."
    for i, b in enumerate(blocks):
        b["order"] = i
    run(server.db.programs.update_one(
        {"id": prog["id"]},
        {"$set": {"modules.0.lessons.0.content_blocks": blocks,
                  "modules.0.lessons.0.client_overview": "AUTHOR OVERVIEW."}}))

    # 7. re-import the SAME package
    _post(admin, _zip(_manifest(), _MEDIA))
    after = _program()["modules"][0]["lessons"][0]
    a_img = next(b for b in after["content_blocks"] if b["type"] == "image")
    assert after["content_blocks"][0]["type"] == "image", "the author reorder was undone"
    assert a_img["resource_id"] == "author-picked-resource", "the replaced image was reverted"
    assert a_img["config"]["caption"] == "AUTHOR CAPTION"
    assert a_img["config"]["alt"] == "AUTHOR ALT"
    assert any(b.get("body") == "AUTHOR REWROTE THIS." for b in after["content_blocks"])
    assert after["client_overview"] == "AUTHOR OVERVIEW."

    # 8. re-import a CHANGED package - still non-destructive by default
    man = _manifest()
    man["program"]["modules"][0]["lessons"][0]["content_blocks"][0]["body"] = "PACKAGE V2 TEXT."
    _post(admin, _zip(man, _MEDIA))
    after2 = _program()["modules"][0]["lessons"][0]
    assert any(b.get("body") == "AUTHOR REWROTE THIS." for b in after2["content_blocks"])
    assert not any(b.get("body") == "PACKAGE V2 TEXT." for b in after2["content_blocks"])


def test_neither_mode_deletes_a_block_the_author_added():
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    prog = _program()
    blocks = prog["modules"][0]["lessons"][0]["content_blocks"]
    blocks.append({"id": "author-block", "type": "text", "title": "Author note",
                   "body": "Added by hand.", "url": None, "resource_id": None,
                   "items": [], "config": {}, "order": len(blocks), "active": True})
    run(server.db.programs.update_one(
        {"id": prog["id"]}, {"$set": {"modules.0.lessons.0.content_blocks": blocks}}))
    for mode in ("merge", "replace"):
        _post(admin, _zip(_manifest(), _MEDIA), mode=mode)
        bodies = [b.get("body") for b in _program()["modules"][0]["lessons"][0]["content_blocks"]]
        assert "Added by hand." in bodies, f"{mode} deleted an author-added block"


def test_an_invalid_mode_falls_back_to_the_safe_one():
    admin = _admin()
    _post(admin, _zip(_manifest(), _MEDIA))
    man = _manifest()
    man["program"]["modules"][0]["lessons"][0]["name"] = "Renamed"
    _post(admin, _zip(man, _MEDIA), mode="obliterate")
    assert _program()["modules"][0]["lessons"][0]["name"].endswith("Clean Sit")


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


# ---------------------------------------------------------------------------
# Archive resource limits — a package is untrusted input
# ---------------------------------------------------------------------------

def _raw_zip(build) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        build(zf)
    return "data:application/zip;base64," + base64.b64encode(buf.getvalue()).decode()


def test_a_decompression_bomb_is_refused_without_being_expanded():
    # A few kB of zeros that expand to ~40 MB: the ratio gives it away before
    # anything is read.
    admin = _admin()

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        zf.writestr("media/bomb.png", b"\x00" * (40 * 1024 * 1024))

    r = _post(admin, _raw_zip(build))
    assert r.status_code == 422
    assert any("expands far more" in e for e in r.json()["detail"]["errors"]), \
        r.json()["detail"]["errors"]
    assert _program() is None


def test_a_member_larger_than_the_ceiling_is_refused():
    admin = _admin()

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        # incompressible, so it is genuinely oversized rather than a bomb
        zf.writestr("media/huge.png", os.urandom(2 * 1024 * 1024))

    import school_curriculum_import as p2
    original = p2.MAX_MEDIA_BYTES
    p2.MAX_MEDIA_BYTES = 1024 * 1024        # 1 MB, so the test stays fast
    try:
        r = _post(admin, _raw_zip(build))
        assert r.status_code == 422
        assert any("larger than" in e for e in r.json()["detail"]["errors"])
        assert _program() is None
    finally:
        p2.MAX_MEDIA_BYTES = original


def test_too_many_members_is_refused():
    admin = _admin()

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        for i in range(30):
            zf.writestr(f"media/f{i}.png", b"x")

    import school_curriculum_import as p2
    original = p2.MAX_ENTRIES
    p2.MAX_ENTRIES = 10
    try:
        r = _post(admin, _raw_zip(build))
        assert r.status_code == 422
        assert any("too many files" in e for e in r.json()["detail"]["errors"])
        assert _program() is None
    finally:
        p2.MAX_ENTRIES = original


def test_the_total_uncompressed_size_is_bounded():
    admin = _admin()

    # Compressible enough that the ZIP itself stays small, but not so
    # compressible that it reads as a bomb — this has to reach the
    # per-member accumulation rather than tripping an earlier guard.
    chunk = os.urandom(30 * 1024) * 10          # 300 KB, ratio about 10x

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        for i in range(6):
            zf.writestr(f"media/p{i}.png", chunk)

    import school_curriculum_import as p2
    original = p2.MAX_PACKAGE_BYTES
    p2.MAX_PACKAGE_BYTES = 1024 * 1024
    try:
        r = _post(admin, _raw_zip(build))
        assert r.status_code == 422
        errs = r.json()["detail"]["errors"]
        # Either total guard is correct: the encoded package or its expanded
        # contents. Both say the same thing to an author.
        assert any("expand beyond" in e or "too large" in e for e in errs), errs
        assert _program() is None
    finally:
        p2.MAX_PACKAGE_BYTES = original


def test_a_symlink_member_is_refused():
    admin = _admin()

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        info = zipfile.ZipInfo("media/link.png")
        info.external_attr = (0o120777 << 16)      # S_IFLNK
        zf.writestr(info, "/etc/passwd")

    r = _post(admin, _raw_zip(build))
    assert r.status_code == 422
    assert any("symlink" in e for e in r.json()["detail"]["errors"])
    assert _program() is None


def test_a_non_regular_member_is_refused():
    admin = _admin()

    def build(zf):
        zf.writestr("manifest.json", json.dumps(_manifest(blocks=[])))
        info = zipfile.ZipInfo("media/dev.png")
        info.external_attr = (0o020666 << 16)      # character device
        zf.writestr(info, "x")

    r = _post(admin, _raw_zip(build))
    assert r.status_code == 422
    assert any("not a regular file" in e for e in r.json()["detail"]["errors"])


def test_an_ordinary_package_is_not_tripped_by_any_of_these_limits():
    # The guards must not inconvenience a legitimate curriculum.
    admin = _admin()
    r = _post(admin, _zip(_manifest(), _MEDIA))
    assert r.status_code == 200, r.text[:300]


# ---------------------------------------------------------------------------
# Imported images are web assets, like Studio uploads
# ---------------------------------------------------------------------------

def _big_jpeg(w=2600, h=2000):
    """A photograph-shaped image: smooth gradients with some texture, which is
    what a real demonstration photo looks like to a JPEG encoder."""
    from PIL import Image
    import random
    random.seed(3)
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 255) // w, (y * 255) // h,
                        ((x + y) // 3 + random.randint(0, 12)) % 256)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=95)
    return out.getvalue()


def _big_transparent_png(w=2400, h=1800):
    from PIL import Image
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        for x in range(0, w, 150):
            for dx in range(60):
                if x + dx < w:
                    px[x + dx, y] = (30, 170, 90, 255)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _stored_bytes_and_image(block):
    res = run(server.db.school_resources.find_one({"id": block["resource_id"]}, {"_id": 0}))
    med = run(server.db.homework_media.find_one({"id": res["media_id"]}, {"_id": 0}))
    path = med.get("path") or med.get("storage_path")
    from PIL import Image
    img = Image.open(path)
    return os.path.getsize(path), img, med


def test_a_huge_packaged_photo_cannot_become_a_huge_lesson_payload():
    # The regression this section exists for: the importer used to store the
    # original bytes, so a 10 MB photograph reached every student intact.
    admin = _admin()
    big = _big_jpeg()
    assert len(big) > 500_000, len(big)   # a realistically hefty demo photo
    blocks = [_block("text", 0, source_key="t", body="Read."),
              _block("image", 1, source_key="i", media="media/big.jpg",
                     config={"caption": "Big.", "alt": "A large photograph."})]
    r = _post(admin, _zip(_manifest(blocks=blocks), {"media/big.jpg": big}))
    assert r.status_code == 200, r.text[:300]
    img_block = [b for b in _blocks_of(_program()) if b["type"] == "image"][0]
    size, stored, med = _stored_bytes_and_image(img_block)
    assert max(stored.width, stored.height) <= 1600, (stored.width, stored.height)
    assert size < len(big) / 2, f"{size} vs original {len(big)}"
    assert med["mime"] == "image/jpeg", "a photograph should stay a photograph"


def test_a_transparent_diagram_keeps_its_format_and_transparency():
    # Flattening a diagram to JPEG would paste it on white and soften every
    # label, so format is preserved rather than normalised.
    admin = _admin()
    png = _big_transparent_png()
    blocks = [_block("image", 0, source_key="d", media="media/diagram.png",
                     config={"caption": "Setup.", "alt": "A room layout diagram."})]
    r = _post(admin, _zip(_manifest(blocks=blocks), {"media/diagram.png": png}))
    assert r.status_code == 200, r.text[:300]
    img_block = [b for b in _blocks_of(_program()) if b["type"] == "image"][0]
    size, stored, med = _stored_bytes_and_image(img_block)
    assert med["mime"] == "image/png", "a diagram was converted away from PNG"
    assert stored.mode in ("RGBA", "LA", "P"), f"transparency was lost (mode={stored.mode})"
    assert max(stored.width, stored.height) <= 1600


def test_an_already_web_sized_image_is_left_alone():
    admin = _admin()
    small = _png(64, 64)
    blocks = [_block("image", 0, source_key="s", media="media/small.png")]
    r = _post(admin, _zip(_manifest(blocks=blocks), {"media/small.png": small}))
    assert r.status_code == 200
    img_block = [b for b in _blocks_of(_program()) if b["type"] == "image"][0]
    size, stored, _med = _stored_bytes_and_image(img_block)
    assert (stored.width, stored.height) == (64, 64)
    assert size == len(small), "a small image was needlessly re-encoded"


def test_video_is_not_run_through_the_image_optimizer():
    admin = _admin()
    clip = b"\x00\x00\x00\x18ftypmp42" + os.urandom(4096)
    blocks = [_block("video", 0, source_key="v", media="media/clip.mp4")]
    r = _post(admin, _zip(_manifest(blocks=blocks), {"media/clip.mp4": clip}))
    assert r.status_code == 200, r.text[:300]
    blk = [b for b in _blocks_of(_program()) if b["type"] == "video"][0]
    size, _i, med = (None, None, None)
    res = run(server.db.school_resources.find_one({"id": blk["resource_id"]}, {"_id": 0}))
    med = run(server.db.homework_media.find_one({"id": res["media_id"]}, {"_id": 0}))
    path = med.get("path") or med.get("storage_path")
    assert os.path.getsize(path) == len(clip), "the video was altered"


def test_re_import_still_dedupes_after_optimisation():
    # The digest is taken on the ORIGINAL bytes, so optimisation cannot make
    # the same source file look new.
    admin = _admin()
    big = _big_jpeg(1800, 1400)
    blocks = [_block("image", 0, source_key="i", media="media/big.jpg")]
    pkg_data = _zip(_manifest(blocks=blocks), {"media/big.jpg": big})
    _post(admin, pkg_data)
    first = run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}}))
    _post(admin, pkg_data)
    second = run(server.db.school_resources.count_documents({"import_digest": {"$exists": True}}))
    assert first == second == 1, (first, second)


# ---------------------------------------------------------------------------
# Unwritable media storage — a misconfigured server, not a bad package
#
# Production shipped with a bind mount the container could not write to. The
# health check stayed green, the importer got EACCES out of write_bytes, and
# the owner was shown a bare "Internal server error" that told them nothing
# and blamed nothing. These tests hold that shut from both ends: the failure
# is reported as what it is, and it leaves NOTHING behind.
# ---------------------------------------------------------------------------

import contextlib
import tempfile
from pathlib import Path


@contextlib.contextmanager
def _media_root_unwritable():
    """Point School media at a FILE, so a real write raises a real OSError.

    Deliberately not a stubbed persistence function: the failure has to come
    out of `path.write_bytes` the way it did in production, or the test is
    only checking that mocks work.
    """
    fd, name = tempfile.mkstemp(prefix="not-a-directory-")
    os.close(fd)
    original = server.SCHOOL_MEDIA_ROOT
    server.SCHOOL_MEDIA_ROOT = Path(name)
    try:
        yield name
    finally:
        server.SCHOOL_MEDIA_ROOT = original
        with contextlib.suppress(OSError):
            os.unlink(name)


def _import_residue():
    return {
        "programs": run(server.db.programs.count_documents({"name": {"$regex": f"^{TAG}"}})),
        "resources": run(server.db.school_resources.count_documents(
            {"import_digest": {"$exists": True}})),
        "media": run(server.db.homework_media.count_documents({"kind": "school_resource"})),
        "recipes": run(server.db.homework_templates.count_documents(
            {"name": {"$regex": f"^{TAG}"}})),
    }


def test_unwritable_media_storage_is_reported_as_a_storage_problem():
    admin = _admin()
    with _media_root_unwritable():
        r = _post(admin, _zip(_manifest(), _MEDIA))
    assert r.status_code == 503, f"{r.status_code}: {r.text[:300]}"
    detail = r.json()["detail"]
    assert detail["error_code"] == "school_media_unwritable"
    assert "not writable" in detail["msg"]
    assert "server storage configuration" in detail["msg"]


def test_the_storage_error_does_not_leak_the_servers_filesystem():
    # An owner needs to know what to fix, not where the server keeps its files.
    admin = _admin()
    with _media_root_unwritable() as root:
        r = _post(admin, _zip(_manifest(), _MEDIA))
    body = r.text
    # The real path the write failed on, in either slash convention.
    assert root not in body, f"the response leaked the media path: {body[:300]}"
    assert root.replace("\\", "/") not in body
    assert os.path.basename(root) not in body
    for leak in ("Traceback", "PermissionError", "NotADirectoryError",
                 "FileNotFoundError", "Errno", "write_bytes"):
        assert leak not in body, f"the response leaked {leak!r}: {body[:300]}"


def test_unwritable_media_storage_creates_no_program():
    admin = _admin()
    with _media_root_unwritable():
        _post(admin, _zip(_manifest(), _MEDIA))
    assert _program() is None, "a half-built program survived a storage failure"


def test_unwritable_media_storage_creates_no_practice_recipes():
    admin = _admin()
    with _media_root_unwritable():
        r = _post(admin, _zip(_with_practice(), _MEDIA))
    assert r.status_code == 503
    assert run(server.db.homework_templates.count_documents(
        {"name": f"{TAG} Clean Sit Practice"})) == 0


def test_unwritable_media_storage_leaves_no_dangling_resources_or_media():
    admin = _admin()
    before = _import_residue()
    with _media_root_unwritable():
        _post(admin, _zip(_manifest(), _MEDIA))
    assert _import_residue() == before, "a storage failure left rows behind"


def test_a_storage_failure_part_way_through_rolls_back_the_earlier_writes():
    """The nastier case: the FIRST image stores, the second cannot.

    Nothing is rolled back by ordering here — the importer has to undo its own
    completed work, or the media library fills with orphan resources attached
    to no lesson.
    """
    admin = _admin()
    before = _import_residue()
    real = server._persist_school_media_data_url
    stored_paths = []

    def flaky(raw, media_id, filename):
        if stored_paths:
            raise PermissionError(13, "Permission denied")
        out = real(raw, media_id, filename)
        stored_paths.append(out["storage_path"])
        return out

    server._persist_school_media_data_url = flaky
    try:
        r = _post(admin, _zip(_manifest(), _MEDIA))
    finally:
        server._persist_school_media_data_url = real

    assert r.status_code == 503, r.text[:200]
    assert len(stored_paths) == 1, "the test never got past the first image"
    assert _import_residue() == before, "the first image's rows were not rolled back"
    assert not os.path.exists(stored_paths[0]), "the orphan file was left on disk"


def test_a_successful_import_is_unaffected_by_the_new_guard():
    # The whole point of the rollback is that it never fires on a good import.
    admin = _admin()
    r = _post(admin, _zip(_manifest(), _MEDIA))
    assert r.status_code == 200, r.text[:300]
    assert r.json()["images"] == 2
    imgs = [b for b in _blocks_of(_program()) if b["type"] == "image"]
    assert len(imgs) == 2
    for b in imgs:
        res = run(server.db.school_resources.find_one({"id": b["resource_id"]}, {"_id": 0}))
        med = run(server.db.homework_media.find_one({"id": res["media_id"]}, {"_id": 0}))
        assert os.path.exists(med["storage_path"]), "an image was not actually stored"


# ---------------------------------------------------------------------------
# The deployment preflight
# ---------------------------------------------------------------------------

def test_the_preflight_passes_on_a_writable_directory(tmp_path):
    from school_media_preflight import check_school_media_writable
    ok, detail = check_school_media_writable(tmp_path / "media")
    assert ok, detail
    assert (tmp_path / "media").is_dir()


def test_the_preflight_fails_when_storage_cannot_be_written():
    from school_media_preflight import check_school_media_writable
    fd, name = tempfile.mkstemp(prefix="not-a-directory-")
    os.close(fd)
    try:
        ok, detail = check_school_media_writable(name)
        assert not ok
        assert detail
    finally:
        with contextlib.suppress(OSError):
            os.unlink(name)


def test_the_preflight_leaves_no_probe_file_behind(tmp_path):
    from school_media_preflight import check_school_media_writable
    ok, _ = check_school_media_writable(tmp_path)
    assert ok
    assert list(tmp_path.iterdir()) == [], "the preflight left litter in the media directory"
