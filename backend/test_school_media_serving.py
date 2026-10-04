"""A web page can't be passed off as a practice video (audit #0: "A student can
disguise a web page as a practice video and steal a trainer's or the owner's
login"). The upload accepts only video types, and School media that isn't a
media type is served as a download with nosniff, never rendered on this site.
Disposable tag TEST_SCHOOL_MEDIA."""
import base64
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_SCHOOL_MEDIA"
PAGE = "data:text/html;base64," + base64.b64encode(b"<script>steal()</script>").decode()
VIDEO = "data:video/mp4;base64," + base64.b64encode(b"x" * 64).decode()


def _client_user(client_id):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": "client", "client_id": client_id, "name": f"{TAG} owner",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid", "password_hash": "x",
           "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode({"sub": uid, "email": doc["email"], "role": "client", "ver": 0, "iat": now,
                                "exp": now + datetime.timedelta(hours=2), "type": "access"},
                               server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


@pytest.fixture()
def homework():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    hw = {"id": f"{TAG}-hw-{uuid.uuid4().hex[:6]}", "client_id": cid, "dog_id": f"{TAG}-d", "title": "Sit drills",
          "created_at": server.now_iso()}
    run(server.db.homework.insert_one(dict(hw)))
    owner = _client_user(cid)
    yield {"hw": hw["id"], "owner": owner}
    run(server.db.homework.delete_many({"id": hw["id"]}))
    run(server.db.homework_media.delete_many({"homework_id": hw["id"]}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))


def _upload(v, photo):
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.post(f"/api/homework/{v['hw']}/day/1/video", json={"photo": photo, "filename": "practice.mp4"},
                                   headers={"Authorization": f"Bearer {v['owner']['_token']}"})
    return run(_go())


def test_a_web_page_is_refused_as_a_practice_video(homework):
    r = _upload(homework, PAGE)
    assert r.status_code == 400, r.text
    assert run(server.db.homework_media.count_documents({"homework_id": homework["hw"]})) == 0, "nothing is kept"


def test_a_real_video_is_still_accepted(homework):
    r = _upload(homework, VIDEO)
    assert r.status_code == 200, r.text
    assert run(server.db.homework_media.count_documents({"homework_id": homework["hw"]})) == 1


def test_a_page_stored_under_a_video_type_is_still_served_as_a_download(tmp_path):
    from school_suite_base import school_media_file_response
    f = tmp_path / "practice.html"
    f.write_bytes(b"<script>steal()</script>")
    resp = school_media_file_response(str(f), {"mime": "text/html", "filename": "practice.mp4"})
    assert resp.media_type == "application/octet-stream"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["content-disposition"].startswith("attachment")


def test_a_video_is_still_played_inline_with_nosniff(tmp_path):
    from school_suite_base import school_media_file_response
    f = tmp_path / "practice.mp4"
    f.write_bytes(b"x" * 64)
    resp = school_media_file_response(str(f), {"mime": "video/mp4", "filename": "practice.mp4"})
    assert resp.media_type == "video/mp4"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert "content-disposition" not in resp.headers
