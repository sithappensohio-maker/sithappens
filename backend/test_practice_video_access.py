"""Trainers can play a client's practice video (audit #50).

A trainer with a staff login could open the homework review queue and
approve or send back a day, but the practice video was owner-only, so it sat
on "Loading video…". Staff who review training (manage_training_sessions —
the queue's own permission) can now play it; the family can, other families
and other staff still can't.

Disposable tag TEST_PRACTICE_VIDEO.
"""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_PRACTICE_VIDEO"
VIDEO = "data:video/mp4;base64,AAAAIGZ0eXBpc29t"


@pytest.fixture(autouse=True)
def _clean_overrides(monkeypatch):
    monkeypatch.setattr(server, "_ROLE_OVERRIDES", {})


def _mk_user(role, staff_role=None, client_id=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}", "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode({"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
                                "exp": now + datetime.timedelta(hours=2), "type": "access"}, server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


@pytest.fixture(scope="module")
def video():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    hw = {"id": f"{TAG}-hw-{uuid.uuid4().hex[:6]}", "client_id": cid, "dog_id": f"{TAG}-d", "title": "Sit drills", "created_at": server.now_iso()}
    m = {"id": f"{TAG}-m-{uuid.uuid4().hex[:6]}", "homework_id": hw["id"], "kind": "video", "data": VIDEO, "filename": "practice.mp4"}
    run(server.db.homework.insert_one(dict(hw)))
    run(server.db.homework_media.insert_one(dict(m)))
    yield {"cid": cid, "hw": hw["id"], "media": m["id"]}
    run(server.db.homework.delete_many({"id": hw["id"]}))
    run(server.db.homework_media.delete_many({"homework_id": hw["id"]}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))


def _get(v, user):
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.get(f"/api/homework/{v['hw']}/media/{v['media']}", headers={"Authorization": f"Bearer {user['_token']}"})
    return run(_go())


@pytest.mark.parametrize("staff_role", ["trainer", "manager"])
def test_staff_who_review_training_can_play_the_practice_video(video, staff_role):
    r = _get(video, _mk_user("employee", staff_role))
    assert r.status_code == 200, r.text
    assert r.json()["data"] == VIDEO


def test_the_owner_and_the_family_still_can(video):
    assert _get(video, _mk_user("admin")).status_code == 200
    assert _get(video, _mk_user("client", client_id=video["cid"])).status_code == 200


@pytest.mark.parametrize("role,staff_role", [("employee", "front_desk"), ("employee", "read_only"), ("employee", "daycare_staff")])
def test_staff_who_dont_review_training_cannot(video, role, staff_role):
    assert _get(video, _mk_user(role, staff_role)).status_code == 403


def test_another_family_cannot(video):
    assert _get(video, _mk_user("client", client_id=f"{TAG}-someone-else")).status_code == 403


def test_a_homework_with_no_family_on_it_is_not_open_to_everyone():
    hw = {"id": f"{TAG}-orphan-{uuid.uuid4().hex[:6]}", "client_id": None, "title": "Old", "created_at": server.now_iso()}
    m = {"id": f"{TAG}-om-{uuid.uuid4().hex[:6]}", "homework_id": hw["id"], "kind": "video", "data": VIDEO}
    run(server.db.homework.insert_one(dict(hw)))
    run(server.db.homework_media.insert_one(dict(m)))
    try:
        v = {"hw": hw["id"], "media": m["id"]}
        assert _get(v, _mk_user("employee", "front_desk")).status_code == 403, "no family on either side is not a match"
        assert _get(v, _mk_user("employee", "trainer")).status_code == 200
    finally:
        run(server.db.homework.delete_many({"id": hw["id"]}))
        run(server.db.homework_media.delete_many({"homework_id": hw["id"]}))
