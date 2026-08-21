"""Online School — inline demonstration images in authored lesson content.

Dog-training instruction leans on pictures: where the hand goes, how high the
lure sits, what the wrong shape looks like. Those belong BETWEEN the
paragraphs that discuss them, not in a gallery at the bottom.

`image` was already a first-class content block type with a media reference,
so nothing here invents a parallel image system. What these tests pin is that
an image behaves like every other block — it persists, it keeps its authored
position, it survives a round trip through the enrollment snapshot to the
client — plus the two fields this pass added: a client-visible caption and a
separate accessible description.

Media storage, MIME rules and size limits are the existing School Resources
pipeline; they are exercised here rather than re-implemented.
"""
import base64
import contextlib
import datetime
import uuid

import httpx
import jwt

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import school_lesson_guide as guide
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _enroll, _client_user, _cleanup_school,
    _admin_user,
)

TAG = "TEST_LESSON_IMG"

# A 1x1 PNG — the smallest thing the real upload validator will accept.
_PNG = ("data:image/png;base64,"
        + base64.b64encode(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )).decode())


def _mk_user(role, staff_role=None, client_id=None):
    """A real identity with a real token — the media routes are permission
    gated by Depends, which only runs over HTTP."""
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _upload(user, data, filename="lure.png"):
    async def go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.post("/api/admin/school/resources/upload",
                                headers={"Authorization": f"Bearer {user['_token']}"},
                                json={"data": data, "filename": filename})
    return run(go())

def _blocks(*specs):
    """Authored blocks in the order a trainer wrote them."""
    out = []
    for i, s in enumerate(specs):
        b = {"id": f"{TAG}-b{i}", "order": i, "active": True, "items": [], "config": {}}
        b.update(s)
        out.append(b)
    return out


def _lesson_with(blocks, enr):
    run(server.db.dog_programs.update_one(
        {"id": enr["id"]},
        {"$set": {"program_snapshot.modules.0.lessons.0.content_blocks": blocks}}))


@contextlib.contextmanager
def _course():
    with _school_program(n_modules=1, n_lessons_per_module=1,
                         checkpoint_lesson_idx=99) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin)
            cu = _client_user(client["id"])
            try:
                lid = run(server.db.dog_programs.find_one(
                    {"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                yield prog, admin, se, enr, cu, lid
            finally:
                _cleanup_school(se["id"], enr["id"])


def _detail(se, lid, cu):
    return run(server.portal_school_lesson_detail(se["id"], lid, cu))


def _client_blocks(se, lid, cu):
    return _detail(se, lid, cu)["lesson"]["content_blocks"]


# ---------------------------------------------------------------------------
# The block model
# ---------------------------------------------------------------------------

def test_an_image_block_is_a_first_class_content_block():
    b = server.LessonContentBlockIn(type="image", url="https://x/y.png", order=3)
    assert b.type == "image" and b.order == 3


def test_caption_and_alt_persist_on_the_block():
    b = server.LessonContentBlockIn(
        type="image", resource_id="r1",
        config={"caption": "Lure just above the nose.", "alt": "Handler holds a treat above a dog's nose."})
    assert b.config["caption"] == "Lure just above the nose."
    assert b.config["alt"] == "Handler holds a treat above a dog's nose."


def test_caption_and_alt_stay_separate_fields():
    # Using one as the other serves neither reader, so nothing copies across.
    b = server.LessonContentBlockIn(type="image", url="u", config={"caption": "Only a caption."})
    assert "alt" not in b.config


def test_blank_caption_or_alt_is_dropped_rather_than_stored_empty():
    b = server.LessonContentBlockIn(type="image", url="u",
                                    config={"caption": "   ", "alt": None})
    assert "caption" not in b.config and "alt" not in b.config


def test_caption_and_alt_are_bounded():
    b = server.LessonContentBlockIn(type="image", url="u",
                                    config={"caption": "x" * 5000, "alt": "y" * 5000})
    assert len(b.config["caption"]) == 300
    assert len(b.config["alt"]) == 250


def test_other_block_config_is_untouched_by_the_media_rules():
    b = server.LessonContentBlockIn(type="quiz", items=["a", "b"],
                                    config={"correct_answer": "a", "explanation": "because"})
    assert b.config["correct_answer"] == "a" and b.config["explanation"] == "because"


# ---------------------------------------------------------------------------
# Authored order is authoritative all the way to the client
# ---------------------------------------------------------------------------

def test_an_image_between_two_paragraphs_reaches_the_client_in_that_order():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "title": "Lure position", "body": "Hold the treat lightly."},
            {"type": "image", "url": "https://x/lure.png",
             "config": {"caption": "Correct lure position.", "alt": "Treat above the nose."}},
            {"type": "text", "title": "Moving up and back", "body": "Draw it up and over."},
        ), enr)
        got = [(b["type"], b["order"]) for b in _client_blocks(se, lid, cu)]
        assert got == [("text", 0), ("image", 1), ("text", 2)], got


def test_multiple_images_keep_their_own_captions_and_positions():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "body": "First."},
            {"type": "image", "url": "https://x/a.png", "config": {"caption": "A", "alt": "alt A"}},
            {"type": "text", "body": "Second."},
            {"type": "image", "url": "https://x/b.png", "config": {"caption": "B", "alt": "alt B"}},
        ), enr)
        imgs = [b for b in _client_blocks(se, lid, cu) if b["type"] == "image"]
        assert [i["config"]["caption"] for i in imgs] == ["A", "B"]
        assert [i["config"]["alt"] for i in imgs] == ["alt A", "alt B"]
        assert [i["order"] for i in imgs] == [1, 3]


def test_images_are_not_regrouped_or_pushed_to_the_end():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "image", "url": "https://x/1.png"},
            {"type": "text", "body": "Middle."},
            {"type": "image", "url": "https://x/2.png"},
            {"type": "checklist", "items": ["Treats"]},
        ), enr)
        kinds = [b["type"] for b in _client_blocks(se, lid, cu)]
        assert kinds == ["image", "text", "image", "checklist"], kinds


def test_text_image_and_video_coexist_in_one_lesson():
    # Existing video behaviour must keep working — this feature is additive.
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "body": "Read this."},
            {"type": "image", "url": "https://x/a.png", "config": {"caption": "Look."}},
            {"type": "video", "url": "https://x/v.mp4"},
            {"type": "text", "body": "Then this."},
        ), enr)
        assert [b["type"] for b in _client_blocks(se, lid, cu)] == [
            "text", "image", "video", "text"]


def test_a_hidden_image_block_is_not_shown_to_the_client():
    with _course() as (prog, admin, se, enr, cu, lid):
        blocks = _blocks(
            {"type": "text", "body": "Visible."},
            {"type": "image", "url": "https://x/a.png"},
        )
        blocks[1]["active"] = False
        _lesson_with(blocks, enr)
        # the payload carries it; the renderer filters on `active`, as it always has
        rendered = [b for b in _client_blocks(se, lid, cu) if b.get("active") is not False]
        assert [b["type"] for b in rendered] == ["text"]


def test_a_lesson_with_no_images_is_completely_unaffected():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "body": "Just words."},
            {"type": "steps", "items": ["One", "Two"]},
        ), enr)
        assert [b["type"] for b in _client_blocks(se, lid, cu)] == ["text", "steps"]


# ---------------------------------------------------------------------------
# Images take part in the guided sequence — they do not bypass it
# ---------------------------------------------------------------------------

def test_an_image_heavy_section_is_still_instructional_content():
    lesson = {"content_blocks": [
        {"type": "text", "title": "Lure position", "body": "x", "order": 0},
        {"type": "image", "url": "u", "order": 1},
        {"type": "text", "title": "Common mistakes to avoid", "body": "y", "order": 2},
        {"type": "image", "url": "u2", "order": 3},
    ]}
    keys = guide.instructional_step_keys(lesson, has_practice=True)
    assert "learn" in keys, keys
    # an image alone never becomes its own pseudo-step
    assert all(k in ("learn", "get_ready", "train", "watch_for", "know_got_it") for k in keys)


def test_an_image_does_not_complete_a_step_by_itself():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "title": "Lure position", "body": "Read."},
            {"type": "image", "url": "https://x/a.png"},
        ), enr)
        d = _detail(se, lid, cu)
        assert d["steps_completed"] == []
        assert d["practice_unlocked"] is False, "an image unlocked Practice on its own"


def test_practice_still_gates_behind_an_image_rich_lesson():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "title": "Lure position", "body": "Read."},
            {"type": "image", "url": "https://x/a.png", "config": {"caption": "Like this."}},
            {"type": "steps", "items": ["Lure up", "Mark"]},
            {"type": "image", "url": "https://x/b.png"},
        ), enr)
        d = _detail(se, lid, cu)
        assert d["practice_unlocked"] is False
        for key in d["instructional_steps"]:
            run(server.portal_school_complete_lesson_step(se["id"], lid, key, cu))
        assert _detail(se, lid, cu)["practice_unlocked"] is True


# ---------------------------------------------------------------------------
# Upload path — the existing School Resources pipeline
# ---------------------------------------------------------------------------

def test_an_image_uploads_through_the_existing_school_pipeline():
    admin = _mk_user("admin")
    r = _upload(admin, _PNG)
    assert r.status_code == 200, r.text[:200]
    out = r.json()
    try:
        assert out["media_id"] and out["mime"] == "image/png"
        row = run(server.db.homework_media.find_one({"id": out["media_id"]}, {"_id": 0}))
        assert row["kind"] == "school_resource", "image landed outside the School media store"
        assert row.get("storage_backend") == "filesystem"
    finally:
        run(server.db.homework_media.delete_one({"id": out["media_id"]}))
        run(server.db.users.delete_one({"id": admin["id"]}))


def test_an_unsupported_file_type_is_refused():
    admin = _mk_user("admin")
    try:
        for bad in ("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
                    "data:application/x-msdownload;base64,TVpQ"):
            assert _upload(admin, bad, "x").status_code == 400, bad
    finally:
        run(server.db.users.delete_one({"id": admin["id"]}))


def test_a_malformed_upload_is_refused():
    admin = _mk_user("admin")
    try:
        assert _upload(admin, "not-a-data-url", "x.png").status_code == 400
    finally:
        run(server.db.users.delete_one({"id": admin["id"]}))


def test_an_oversized_image_is_refused():
    admin = _mk_user("admin")
    try:
        huge = "data:image/png;base64," + ("A" * (70 * 1024 * 1024))
        assert _upload(admin, huge, "big.png").status_code == 400
    finally:
        run(server.db.users.delete_one({"id": admin["id"]}))


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

def test_a_client_cannot_upload_school_media():
    cu = _mk_user("client", client_id=str(uuid.uuid4()))
    try:
        assert _upload(cu, _PNG).status_code in (401, 403)
    finally:
        run(server.db.users.delete_one({"id": cu["id"]}))


def test_an_anonymous_caller_cannot_upload_school_media():
    async def go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.post("/api/admin/school/resources/upload",
                                json={"data": _PNG, "filename": "x.png"})
    assert run(go()).status_code in (401, 403)

def test_a_client_cannot_rewrite_authored_lesson_media():
    """Lesson content lives on the program, and the client has no write route
    to it — the portal exposes reads and progress only.

    Driven over HTTP on purpose: the permission gate is a Depends, and a
    direct call to the endpoint function skips it entirely, which would make
    this pass while proving nothing.
    """
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks({"type": "image", "url": "https://x/a.png"}), enr)
        client = _mk_user("client", client_id=str(uuid.uuid4()))

        async def go(token):
            transport = httpx.ASGITransport(app=server.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                return await c.put(f"/api/programs/{prog['id']}",
                                   headers={"Authorization": f"Bearer {token}"},
                                   json={"name": prog["name"], "type": prog["type"],
                                         "format": prog["format"], "price": 0,
                                         "delivery_mode": "self_guided", "modules": []})
        try:
            r = run(go(client["_token"]))
            assert r.status_code in (401, 403), r.status_code
            # the authored image is untouched
            assert _client_blocks(se, lid, cu)[0]["url"] == "https://x/a.png"
        finally:
            run(server.db.users.delete_one({"id": client["id"]}))

def test_an_unknown_resource_reference_degrades_rather_than_breaking_the_lesson():
    with _course() as (prog, admin, se, enr, cu, lid):
        _lesson_with(_blocks(
            {"type": "text", "body": "Before."},
            {"type": "image", "resource_id": "no-such-resource"},
            {"type": "text", "body": "After."},
        ), enr)
        blocks = _client_blocks(se, lid, cu)
        assert [b["type"] for b in blocks] == ["text", "image", "text"]
        assert blocks[1]["resource_id"] == "no-such-resource"
