"""A full restore of a real-size backup works (domains/backup/restore_jobs.py).

The old restore sent the whole backup in one request. Behind nginx (25 MB)
and the Cloudflare tunnel (100 MB, 100-second timeout) a real business backup
(~150 MB) could never arrive, and the restore would outlive the request
anyway. Now backups on the server restore by name as a background job, and a
backup from elsewhere is uploaded in pieces first.

Real HTTP with real tokens (httpx.ASGITransport), so the owner-only gates are
under test too. Every backup file lives in a pytest tmp folder.
"""
import asyncio
import contextlib
import datetime
import gzip
import json
import os
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_LARGE_RESTORE"


@pytest.fixture(autouse=True)
def _backup_root(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "BACKUP_ROOT", str(tmp_path))
    run(server.db.app_settings.update_one({"_id": "auto_backup"}, {"$set": {"path": str(tmp_path)}}, upsert=True))
    yield tmp_path
    run(server.db.restore_jobs.update_one({"_id": "lock"}, {"$set": {"holder": None}}))


def _mk_user(role, staff_role=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode({"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
                                "exp": now + datetime.timedelta(hours=2), "type": "access"},
                               server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


@contextlib.contextmanager
def _people():
    who = {"owner": _mk_user("admin"), "manager": _mk_user("employee", "manager"),
           "client": _mk_user("client")}
    try:
        yield who
    finally:
        run(server.db.users.delete_many({"id": {"$in": [u["id"] for u in who.values()]}}))


def _call(method, path, user=None, **kw):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            headers.update(kw.pop("headers", {}))
            return await http.request(method, f"/api{path}", headers=headers, **kw)
    return run(_go())


def _payload(collections, version=None):
    return {"version": version or server.BACKUP_VERSION, "exported_at": server.now_iso(), "collections": collections}


def _auto_file(folder, payload, *, corrupt=False):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d_%H%M%S_%f")
    path = os.path.join(str(folder), f"sit-happens-{stamp}.json.gz")
    with open(path, "wb") as fh:
        fh.write(b"not gzip at all" if corrupt else gzip.compress(json.dumps(payload).encode()))
    return os.path.basename(path)


def _upload(owner, data: bytes, filename="backup.json", piece=1000, order=None):
    start = _call("POST", "/backup/uploads", owner, json={"filename": filename, "size_bytes": len(data)})
    assert start.status_code == 200, start.text
    uid = start.json()["upload_id"]
    offsets = list(range(0, len(data), piece))
    for off in (order(offsets) if order else offsets):
        r = _call("PUT", f"/backup/uploads/{uid}/chunks/{off}", owner, content=data[off:off + piece],
                  headers={"Content-Type": "application/octet-stream"})
        assert r.status_code == 200, r.text
    return uid


def _wait(job_id, owner):
    for _ in range(1200):
        job = _call("GET", f"/backup/restore-jobs/{job_id}", owner).json()
        if job["status"] != "running":
            return job
        run(asyncio.sleep(0.05))
    raise AssertionError(f"restore job {job_id} never finished: {job}")


def test_a_backup_uploaded_in_pieces_is_checked_listed_and_restorable():
    card_id = f"{TAG}-card-{uuid.uuid4().hex[:6]}"
    data = gzip.compress(json.dumps(_payload({
        "gift_cards": [{"id": card_id, "code": f"LR{uuid.uuid4().hex[:8]}", "balance": 12.5, "status": "active"}],
    })).encode())
    try:
        with _people() as who:
            # Pieces out of order, and one sent twice (a retry) — both harmless.
            uid = _upload(who["owner"], data, "laptop copy.json.gz", piece=97,
                          order=lambda offs: list(reversed(offs)) + [offs[0]])
            done = _call("POST", f"/backup/uploads/{uid}/finish", who["owner"])
            assert done.status_code == 200, done.text
            info = done.json()
            assert info["kind"] == "uploaded" and info["name"].startswith("uploads/uploaded-")
            assert info["name"].endswith("-laptop-copy.json.gz")
            assert info["counts"] == {"gift_cards": 1} and info["size_bytes"] == len(data)

            listed = _call("GET", "/backup/files", who["owner"]).json()["files"]
            assert any(f["name"] == info["name"] for f in listed)

            job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": info["name"], "mode": "merge"})
            assert job.status_code == 200, job.text
            final = _wait(job.json()["id"], who["owner"])
            assert final["status"] == "done", final
            assert final["summary"]["gift_cards"]["upserted"] == 1
            assert final["pre_restore_snapshot"]["ok"] is True
            assert run(server.db.gift_cards.find_one({"id": card_id}))["balance"] == 12.5
    finally:
        run(server.db.gift_cards.delete_one({"id": card_id}))


def test_an_incomplete_or_unusable_upload_is_refused(_backup_root):
    with _people() as who:
        owner = who["owner"]
        body = json.dumps(_payload({"clients": []})).encode()
        uid = _upload(owner, body, piece=50, order=lambda offs: [o for o in offs if o != 50])
        r = _call("POST", f"/backup/uploads/{uid}/finish", owner)
        assert r.status_code == 409 and r.headers.get("x-expected-offset") == "50"

        r = _call("PUT", f"/backup/uploads/{uid}/chunks/{len(body)}", owner, content=b"x")
        assert r.status_code == 400, "a piece past the end of the file"

        for bad, why in ((b"{not json", "couldn't be read"),
                         (json.dumps({"kind": "config", "version": 1, "collections": {}}).encode(), "config-only"),
                         (json.dumps(_payload({}, version=server.BACKUP_VERSION + 1)).encode(), "newer than this server")):
            uid = _upload(owner, bad)
            r = _call("POST", f"/backup/uploads/{uid}/finish", owner)
            assert r.status_code == 400 and why in r.text, r.text
        uploads = os.path.join(str(_backup_root), "uploads")
        assert not [n for n in os.listdir(uploads) if n.startswith("uploaded-")], "a refused file stayed listed"


def test_only_the_owner_uploads_restores_or_deletes(_backup_root):
    name = _auto_file(_backup_root, _payload({"clients": []}))
    with _people() as who:
        mgr, client = who["manager"], who["client"]
        # A backup holds every record, live sign-in links included: owner only,
        # even for a manager who may export CSVs.
        for user in (mgr, client):
            assert _call("GET", "/backup/files", user).status_code == 403
            assert _call("GET", "/backup/files/download", user, params={"name": name}).status_code == 403
            assert _call("POST", "/backup/uploads", user, json={"filename": "x.json", "size_bytes": 10}).status_code == 403
            assert _call("POST", "/backup/restore-jobs", user, json={"name": name}).status_code == 403
            assert _call("DELETE", "/backup/files", user, params={"name": name}).status_code == 403
            assert _call("GET", "/backup/restore-jobs", user).status_code == 403
        assert _call("GET", "/backup/files", who["owner"]).status_code == 200


def test_names_outside_the_backup_folder_are_never_opened(_backup_root):
    _auto_file(_backup_root, _payload({"clients": []}))
    with _people() as who:
        for name in ("../secrets.json", "/etc/passwd", "uploads/../../x.json", "sub\\sit-happens-x.json.gz",
                     "sit-happens-school-media-2026-09-26_030000.tar.gz", "notes.json",
                     "sit-happens-2026-09-26_030000.json.gz.1234.tmp"):
            r = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name})
            assert r.status_code in (400, 404), (name, r.status_code)
            assert _call("GET", "/backup/files/download", who["owner"], params={"name": name}).status_code in (400, 404)


def test_a_replace_job_restores_exactly_the_file_and_downloads_match(_backup_root):
    row = {"id": f"{TAG}-psm-{uuid.uuid4().hex[:6]}", "special_id": TAG, "mime": "image/png", "b64": "AAAA"}
    before = run(server.db.photo_special_media.find({}, {"_id": 0}).to_list(None))
    name = _auto_file(_backup_root, _payload({"photo_special_media": [row]}))
    try:
        with _people() as who:
            raw = open(os.path.join(str(_backup_root), name), "rb").read()
            dl = _call("GET", "/backup/files/download", who["owner"], params={"name": name})
            assert dl.status_code == 200 and dl.content == raw

            job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name, "mode": "replace"}).json()
            final = _wait(job["id"], who["owner"])
            assert final["status"] == "done", final
            assert final["collections_total"] == 1 and final["collections_done"] == 1
            assert run(server.db.photo_special_media.find({}, {"_id": 0}).to_list(None)) == [row]
    finally:
        run(server.db.photo_special_media.delete_many({}))
        if before:
            run(server.db.photo_special_media.insert_many(before))


def test_one_restore_at_a_time_and_never_during_a_backup(_backup_root):
    name = _auto_file(_backup_root, _payload({"clients": []}))
    with _people() as who:
        assert run(server._acquire_restore_lock("someone-else"))
        try:
            r = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name})
            assert r.status_code == 409 and "already running" in r.text
            body = server.BackupRestoreIn(version=server.BACKUP_VERSION, collections={}, mode="merge")
            with pytest.raises(server.HTTPException) as exc:
                run(server.backup_restore(body=body, _=who["owner"]))
            assert exc.value.status_code == 409
            # And the nightly backup stays off while a restore runs.
            skipped = run(server._run_auto_backup_once(trigger="manual"))
            assert skipped["status"] == "skipped" and "restore" in skipped["error"].lower()
        finally:
            run(server._release_restore_lock("someone-else"))

        lease = {"_id": server._BACKUP_LEASE_ID, "owner": "another-worker",
                 "acquired_at": datetime.datetime.now(datetime.timezone.utc),
                 "expires_at": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)}
        run(server.db.app_settings.replace_one({"_id": server._BACKUP_LEASE_ID}, lease, upsert=True))
        try:
            r = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name})
            assert r.status_code == 409 and "backup is being written" in r.text
            assert run(server._acquire_restore_lock("probe")), "a refused start must not keep the lock"
            run(server._release_restore_lock("probe"))
        finally:
            run(server.db.app_settings.delete_one({"_id": server._BACKUP_LEASE_ID}))


def test_a_failed_job_says_why_and_frees_the_lock(_backup_root):
    name = _auto_file(_backup_root, {}, corrupt=True)
    with _people() as who:
        job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name}).json()
        final = _wait(job["id"], who["owner"])
        assert final["status"] == "failed" and "couldn't be read" in final["error"]
        assert run(server._acquire_restore_lock("probe"))
        run(server._release_restore_lock("probe"))


def test_a_job_whose_worker_went_away_is_reported_as_stalled():
    job_id = f"{TAG}-{uuid.uuid4().hex[:6]}"
    old = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)).isoformat()
    run(server.db.restore_jobs.insert_one({"id": job_id, "status": "running", "phase": "restoring",
                                           "started_at": old, "updated_at": old}))
    try:
        with _people() as who:
            assert _call("GET", f"/backup/restore-jobs/{job_id}", who["owner"]).json()["stalled"] is True
    finally:
        run(server.db.restore_jobs.delete_one({"id": job_id}))


def test_uploaded_backups_can_be_deleted_scheduled_ones_cannot(_backup_root):
    auto = _auto_file(_backup_root, _payload({"clients": []}))
    with _people() as who:
        uid = _upload(who["owner"], json.dumps(_payload({"clients": []})).encode())
        name = _call("POST", f"/backup/uploads/{uid}/finish", who["owner"]).json()["name"]
        assert _call("DELETE", "/backup/files", who["owner"], params={"name": auto}).status_code == 400
        assert _call("DELETE", "/backup/files", who["owner"], params={"name": name}).status_code == 200
        assert not any(f["name"] == name for f in _call("GET", "/backup/files", who["owner"]).json()["files"])


def test_a_lease_left_by_a_dead_backup_does_not_block_restores_for_hours(_backup_root):
    name = _auto_file(_backup_root, _payload({"clients": []}))
    now = datetime.datetime.now(datetime.timezone.utc)
    lease = {"_id": server._BACKUP_LEASE_ID, "owner": "a-worker-that-died",
             "acquired_at": now - datetime.timedelta(hours=2), "expires_at": now + datetime.timedelta(hours=2)}
    run(server.db.app_settings.replace_one({"_id": server._BACKUP_LEASE_ID}, lease, upsert=True))
    try:
        with _people() as who:
            job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name})
            assert job.status_code == 200, job.text
            assert _wait(job.json()["id"], who["owner"])["status"] == "done"
    finally:
        run(server.db.app_settings.delete_one({"_id": server._BACKUP_LEASE_ID}))


def test_a_restart_mid_restore_is_recorded_and_frees_the_lock(_backup_root):
    name = _auto_file(_backup_root, _payload({"clients": []}))
    with _people() as who:
        job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name}).json()
        for task in list(server._restore_job_tasks):
            task.cancel()
        run(asyncio.sleep(0.2))
        final = _call("GET", f"/backup/restore-jobs/{job['id']}", who["owner"]).json()
        assert final["status"] == "failed" and "restarted" in final["error"]
        assert run(server._acquire_restore_lock("probe"))
        run(server._release_restore_lock("probe"))


def test_a_running_job_without_its_lock_is_shown_as_stalled_at_once():
    job_id = f"{TAG}-{uuid.uuid4().hex[:6]}"
    fresh = datetime.datetime.now(datetime.timezone.utc).isoformat()
    run(server.db.restore_jobs.insert_one({"id": job_id, "status": "running", "phase": "restoring",
                                           "started_at": fresh, "updated_at": fresh}))
    try:
        with _people() as who:
            assert _call("GET", f"/backup/restore-jobs/{job_id}", who["owner"]).json()["stalled"] is True
    finally:
        run(server.db.restore_jobs.delete_one({"id": job_id}))


def test_a_merge_finds_rows_on_an_index_and_in_batches(_backup_root):
    coll = "school_experience_feedback_history"
    before = run(server.db[coll].find({}, {"_id": 0}).to_list(None))
    rows = [{"id": f"{TAG}-h-{i}", "note": i} for i in range(2500)]
    for idx in run(server.db[coll].index_information()):
        if idx != "_id_":
            run(server.db[coll].drop_index(idx))
    try:
        with _people() as who:
            name = _auto_file(_backup_root, _payload({coll: rows}))
            first = _wait(_call("POST", "/backup/restore-jobs", who["owner"], json={"name": name}).json()["id"], who["owner"])
            again = _wait(_call("POST", "/backup/restore-jobs", who["owner"], json={"name": name}).json()["id"], who["owner"])
            assert first["summary"][coll]["upserted"] == 2500 and again["summary"][coll]["upserted"] == 2500
            assert run(server.db[coll].count_documents({"id": {"$regex": f"^{TAG}-h-"}})) == 2500
            keys = [spec["key"][0][0] for spec in run(server.db[coll].index_information()).values()]
            assert "id" in keys, "the merge made the index it looks rows up with"
    finally:
        run(server.db[coll].delete_many({}))
        if before:
            run(server.db[coll].insert_many(before))


def test_merging_the_same_backup_twice_never_doubles_rows_without_an_id(_backup_root):
    """Found by the full-size drill: every merge used to add a second copy of
    each drawer session, email template, sign-in link, notification-log entry…"""
    tag = uuid.uuid4().hex[:8]
    rows = {
        "cash_drawer_sessions": {"date": f"2099-01-01-{tag}", "closing_cash_counted": 120.0},
        "claim_tokens": {"token": f"{TAG}-{tag}", "email": "x@example.invalid", "used": False},
        "email_templates": {"slug": f"{TAG.lower()}-{tag}", "subject": "hi"},
        "notification_log": {"key": f"{TAG}-{tag}", "sent_at": "2026-09-26T00:00:00+00:00"},
        "settings": {"key": f"{TAG}-{tag}", "value": 1},
        "task_dismissals": {"item_id": f"{TAG}-{tag}", "signature": "s"},
        "vaccine_dismissals": {"dog_id": f"{TAG}-{tag}", "until": "2099-01-01"},
        "shop_favorites": {"client_id": f"{TAG}-{tag}", "kind": "product", "ref_id": "p"},
    }
    name = _auto_file(_backup_root, _payload({c: [doc] for c, doc in rows.items()}))
    try:
        with _people() as who:
            for _ in range(2):
                job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name, "mode": "merge"}).json()
                assert _wait(job["id"], who["owner"])["status"] == "done"
            for c, doc in rows.items():
                assert run(server.db[c].count_documents(doc)) == 1, f"{c} doubled on a second merge"
    finally:
        for c, doc in rows.items():
            run(server.db[c].delete_many(doc))


def test_a_settings_row_with_its_own_string_id_keeps_it_and_keyless_rows_stay_single(_backup_root):
    tag = uuid.uuid4().hex[:8]
    named = {"_id": f"{TAG}-{tag}", "closed_dates": ["2026-12-25"]}
    keyless = {"marker": f"{TAG}-{tag}", "closed_dates": []}
    run(server.db.settings.insert_one(dict(named)))
    try:
        exported = run(server._export_collection_docs("settings"))
        assert any(d.get("_id") == named["_id"] for d in exported), "a string _id must survive the backup"
        run(server.db.settings.delete_one({"_id": named["_id"]}))
        name = _auto_file(_backup_root, _payload({"settings": [named, keyless]}))
        with _people() as who:
            for _ in range(2):
                job = _call("POST", "/backup/restore-jobs", who["owner"], json={"name": name, "mode": "merge"}).json()
                assert _wait(job["id"], who["owner"])["status"] == "done"
        assert run(server.db.settings.find_one({"_id": named["_id"]}))["closed_dates"] == ["2026-12-25"]
        assert run(server.db.settings.count_documents({"marker": keyless["marker"]})) == 1
    finally:
        run(server.db.settings.delete_many({"$or": [{"_id": named["_id"]}, {"marker": keyless["marker"]}]}))
