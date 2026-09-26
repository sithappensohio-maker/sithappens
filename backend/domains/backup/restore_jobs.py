"""Full restore of a real-size backup: from a file on the server, as a job.

The Settings restore used to read the whole backup in the browser and POST it
as one request. A real business backup is far past what that path allows:
nginx refuses bodies over 25 MB, Cloudflare (every request reaches the box
through the tunnel) refuses bodies over 100 MB and gives up on any request
that runs past 100 seconds, and the restore itself takes minutes. So:

* backups already on the server — the nightly auto-backups, pre-restore
  snapshots, uploaded files — are listed and restored by name, never sent
  over the wire;
* a backup held elsewhere (a laptop, a USB stick) is uploaded in pieces of a
  few MB, each its own file so a retried piece is harmless, then assembled
  and checked on the server before it can be restored;
* the restore runs as a background job the page polls. A restore lock keeps
  two restores (or a job and the old one-shot restore) from overlapping
  across workers; the nightly backup skips while that lock is held (it would
  capture a half-restored database), and a restore won't start while a
  backup is being written.
"""
import asyncio
import gzip
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# One upload piece. Well under nginx's 25 MB body limit and Cloudflare's
# 100 MB, and small enough that a retry after a dropped connection is cheap.
CHUNK_BYTES = 8 * 1024 * 1024
MAX_CHUNK_BYTES = 12 * 1024 * 1024
MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024
STALE_UPLOAD_HOURS = 24
# A running job that hasn't reported in this long most likely lost its
# worker (a restart mid-restore). The restore lock expires on the same clock.
STALLED_AFTER = timedelta(minutes=20)

_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
# Restorable files, by name. Anything else in the folder (media archives,
# partial .tmp writes, config snapshots) is never offered or opened.
_KINDS = (
    (re.compile(r"^sit-happens-\d{4}-\d{2}-\d{2}_\d{6}(_\d+)?\.json\.gz$"), "auto"),
    (re.compile(r"^pre-restore-full-[0-9-]+\.json$"), "snapshot"),
    (re.compile(r"^uploaded-[0-9T_-]+-[A-Za-z0-9._-]{1,80}\.json(\.gz)?$"), "uploaded"),
)


def _kind_of(basename: str) -> Optional[str]:
    for pattern, kind in _KINDS:
        if pattern.match(basename):
            return kind
    return None


def read_backup_file(path: str) -> Dict[str, Any]:
    """Parse a backup file (plain or gzipped JSON). Runs in a worker thread."""
    with open(path, "rb") as fh:
        gz = fh.read(2) == b"\x1f\x8b"
    opener = gzip.open if gz else open
    with opener(path, "rb") as fh:
        raw = fh.read()
    try:
        return json.loads(raw)
    finally:
        del raw


def check_payload(payload: Any, backup_version: int) -> Dict[str, Any]:
    """What the file holds, or a plain reason it can't be restored."""
    if not isinstance(payload, dict) or not isinstance(payload.get("collections"), dict):
        raise HTTPException(status_code=400, detail="This file isn't a Sit Happens backup (no collections).")
    if payload.get("kind") == "config":
        raise HTTPException(status_code=400, detail="This is a config-only file. Use Restore Config instead.")
    version = payload.get("version")
    if not isinstance(version, int) or version < 1:
        raise HTTPException(status_code=400, detail="This file isn't a Sit Happens backup (no version).")
    if version > backup_version:
        raise HTTPException(
            status_code=400,
            detail=f"Backup version {version} is newer than this server (v{backup_version}). Update the server first.")
    counts = {k: len(v) for k, v in payload["collections"].items() if isinstance(v, list)}
    return {"version": version, "exported_at": payload.get("exported_at"),
            "counts": counts, "total_docs": sum(counts.values())}


def _safe_upload_name(filename: str) -> str:
    stem = os.path.basename(str(filename or "backup")).strip()
    for ext in (".gz", ".json"):
        if stem.lower().endswith(ext):
            stem = stem[: -len(ext)]
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_")[:60]
    return stem or "backup"


class UploadStartIn(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(ge=1, le=MAX_UPLOAD_BYTES)


class RestoreJobIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    mode: Literal["replace", "merge"] = "merge"


def make_restore_jobs_domain(*, api, db, logger, now_iso, require_owner, require_admin_and_permission,
                             backup_root_ref, _safe_backup_dir, BACKUP_VERSION, _get_auto_backup_config,
                             _backup_lease_held, _write_pre_restore_snapshot, _restore_collections,
                             _acquire_restore_lock, _refresh_restore_lock, _release_restore_lock,
                             _hold_restore_lock):
    running_tasks: set = set()

    def _root() -> str:
        return os.path.realpath(backup_root_ref())

    def _uploads_dir() -> str:
        return os.path.join(_root(), "uploads")

    def _incoming_dir(upload_id: str) -> str:
        if not _UPLOAD_ID.match(str(upload_id or "")):
            raise HTTPException(status_code=404, detail="Upload not found")
        return os.path.join(_uploads_dir(), ".incoming", upload_id)

    async def _folders() -> List[str]:
        root = _root()
        out = [root]
        try:
            auto = _safe_backup_dir((await _get_auto_backup_config()).get("path"))
            if os.path.realpath(auto) != root:
                out.append(os.path.realpath(auto))
        except Exception:
            pass
        out.append(_uploads_dir())
        return out

    def _resolve(name: str) -> Dict[str, Any]:
        """A restorable backup file strictly inside the backup folder."""
        raw = str(name or "").strip()
        if not raw or raw.startswith(("/", "\\")) or "\\" in raw or ".." in raw.split("/"):
            raise HTTPException(status_code=400, detail="Choose a backup from the list")
        basename = raw.rsplit("/", 1)[-1]
        kind = _kind_of(basename)
        if not kind:
            raise HTTPException(status_code=400, detail="Choose a backup from the list")
        root = _root()
        path = os.path.realpath(os.path.join(root, *raw.split("/")))
        try:
            inside = os.path.commonpath([root, path]) == root
        except ValueError:
            inside = False
        if not inside:
            raise HTTPException(status_code=400, detail="Backups must be inside the backup folder")
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="That backup file isn't there any more")
        return {"name": raw, "path": path, "kind": kind}

    def _row(path: str, kind: str) -> Dict[str, Any]:
        rel = os.path.relpath(path, _root()).replace(os.sep, "/")
        return {
            "name": rel, "kind": kind,
            "size_bytes": os.path.getsize(path),
            "modified_at": datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat(),
        }

    # Listing and downloading are owner-only, like restoring: a backup file
    # holds every record, including live sign-in links (claim_tokens).
    @api.get("/backup/files")
    async def list_backup_files(_: dict = Depends(require_owner)):
        """Every backup on this server that can be restored or downloaded."""
        rows: List[Dict[str, Any]] = []
        seen = set()
        for folder in await _folders():
            if not os.path.isdir(folder):
                continue
            for basename in os.listdir(folder):
                kind = _kind_of(basename)
                path = os.path.realpath(os.path.join(folder, basename))
                if not kind or path in seen or not os.path.isfile(path):
                    continue
                seen.add(path)
                rows.append(_row(path, kind))
        runs = await db.auto_backup_runs.find(
            {"ok": True, "path": {"$ne": None}}, {"_id": 0, "path": 1, "total_docs": 1, "verified": 1}
        ).sort("started_at", -1).to_list(200)
        by_path = {os.path.realpath(str(r["path"])): r for r in runs if r.get("path")}
        for row in rows:
            run = by_path.get(os.path.realpath(os.path.join(_root(), *row["name"].split("/"))))
            if run:
                row["total_docs"] = run.get("total_docs")
                row["verified"] = run.get("verified", True)
        rows.sort(key=lambda r: r["modified_at"], reverse=True)
        return {"files": rows, "backup_root": _root(), "chunk_bytes": CHUNK_BYTES}

    @api.get("/backup/files/download")
    async def download_backup_file(name: str, _: dict = Depends(require_owner)):
        """Stream a server backup for off-machine storage (no size limit, no
        wait for a fresh export)."""
        f = _resolve(name)
        media = "application/gzip" if f["path"].endswith(".gz") else "application/json"
        return FileResponse(f["path"], filename=os.path.basename(f["path"]), media_type=media)

    @api.delete("/backup/files")
    async def delete_uploaded_backup(name: str, _: dict = Depends(require_owner)):
        """Remove an uploaded backup. Nightly backups and snapshots are managed
        by the backup schedule, not deleted from here."""
        f = _resolve(name)
        if f["kind"] != "uploaded":
            raise HTTPException(status_code=400, detail="Only uploaded backups can be deleted here")
        os.remove(f["path"])
        return {"ok": True, "deleted": f["name"]}

    # ───────────────────────── chunked upload ─────────────────────────

    def _prune_stale_uploads() -> None:
        base = os.path.join(_uploads_dir(), ".incoming")
        if not os.path.isdir(base):
            return
        cutoff = datetime.now(timezone.utc).timestamp() - STALE_UPLOAD_HOURS * 3600
        for entry in os.listdir(base):
            path = os.path.join(base, entry)
            try:
                if os.path.getmtime(path) < cutoff:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                pass

    def _meta(upload_id: str) -> Dict[str, Any]:
        folder = _incoming_dir(upload_id)
        try:
            with open(os.path.join(folder, "meta.json"), "r", encoding="utf-8") as fh:
                return json.load(fh)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Upload not found — start it again")

    @api.post("/backup/uploads")
    async def start_backup_upload(body: UploadStartIn, user: dict = Depends(require_owner)):
        """Begin uploading a backup in pieces (see CHUNK_BYTES)."""
        _prune_stale_uploads()
        upload_id = uuid.uuid4().hex
        folder = _incoming_dir(upload_id)
        os.makedirs(folder, exist_ok=True)
        meta = {"upload_id": upload_id, "filename": body.filename, "size_bytes": body.size_bytes,
                "created_at": now_iso(), "by": user.get("id")}
        with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as fh:
            json.dump(meta, fh)
        return {"upload_id": upload_id, "chunk_bytes": CHUNK_BYTES}

    @api.put("/backup/uploads/{upload_id}/chunks/{offset}")
    async def put_backup_upload_chunk(upload_id: str, offset: int, request: Request, _: dict = Depends(require_owner)):
        """One piece, stored as its own file named by where it starts — sending
        the same piece twice just replaces it, so retries are always safe."""
        meta = _meta(upload_id)
        data = await request.body()
        if not data or len(data) > MAX_CHUNK_BYTES:
            raise HTTPException(status_code=400, detail=f"Each piece must be 1 byte to {MAX_CHUNK_BYTES} bytes")
        if offset < 0 or offset + len(data) > int(meta["size_bytes"]):
            raise HTTPException(status_code=400, detail="That piece falls outside the file")
        folder = _incoming_dir(upload_id)
        final = os.path.join(folder, f"{offset:015d}.chunk")
        temp = f"{final}.{uuid.uuid4().hex[:8]}.tmp"
        with open(temp, "wb") as fh:
            fh.write(data)
        os.replace(temp, final)
        return {"ok": True, "offset": offset, "bytes": len(data)}

    @api.delete("/backup/uploads/{upload_id}")
    async def abort_backup_upload(upload_id: str, _: dict = Depends(require_owner)):
        shutil.rmtree(_incoming_dir(upload_id), ignore_errors=True)
        return {"ok": True}

    @api.post("/backup/uploads/{upload_id}/finish")
    async def finish_backup_upload(upload_id: str, _: dict = Depends(require_owner)):
        """Assemble the pieces, check the file is a restorable backup, and put
        it in the backup list. Nothing is restored here."""
        meta = _meta(upload_id)
        folder = _incoming_dir(upload_id)
        size = int(meta["size_bytes"])
        pieces = sorted((int(n.split(".", 1)[0]), n) for n in os.listdir(folder) if n.endswith(".chunk"))
        expected = 0
        for start, name in pieces:
            if start != expected:
                raise HTTPException(status_code=409, detail="Some pieces are missing — send the file again",
                                    headers={"X-Expected-Offset": str(expected)})
            expected += os.path.getsize(os.path.join(folder, name))
        if expected != size:
            raise HTTPException(status_code=409, detail="The upload isn't complete yet — send the file again",
                                headers={"X-Expected-Offset": str(expected)})
        os.makedirs(_uploads_dir(), exist_ok=True)
        with open(os.path.join(folder, pieces[0][1]), "rb") as fh:
            gz = fh.read(2) == b"\x1f\x8b"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        basename = f"uploaded-{stamp}-{_safe_upload_name(meta.get('filename'))}.json{'.gz' if gz else ''}"
        final = os.path.join(_uploads_dir(), basename)
        temp = final + f".{uuid.uuid4().hex[:8]}.tmp"

        def _assemble() -> None:
            with open(temp, "wb") as out:
                for _start, name in pieces:
                    with open(os.path.join(folder, name), "rb") as part:
                        shutil.copyfileobj(part, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())

        try:
            await asyncio.to_thread(_assemble)
            try:
                payload = await asyncio.to_thread(read_backup_file, temp)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"This file couldn't be read as a backup: {type(exc).__name__}")
            info = check_payload(payload, BACKUP_VERSION)
            del payload
            os.replace(temp, final)
            temp = None
        finally:
            if temp and os.path.exists(temp):
                os.remove(temp)
        shutil.rmtree(folder, ignore_errors=True)
        return {**_row(final, "uploaded"), **info}

    # ───────────────────────── restore jobs ─────────────────────────

    async def _save(job_id: str, **fields) -> None:
        fields["updated_at"] = now_iso()
        await db.restore_jobs.update_one({"id": job_id}, {"$set": fields})

    async def _load(path: str) -> Dict[str, Any]:
        try:
            return await asyncio.to_thread(read_backup_file, path)
        except Exception as exc:
            raise RuntimeError(f"The backup file couldn't be read: {type(exc).__name__}: {exc}")

    async def _run(job_id: str, path: str, mode: str) -> None:
        heartbeat = asyncio.create_task(_hold_restore_lock(job_id, lambda: _save(job_id)))
        try:
            await _save(job_id, phase="reading")
            payload = await _load(path)
            info = check_payload(payload, BACKUP_VERSION)
            # Check the file, then let it go while the safety snapshot holds
            # a full copy of the live database — never both in memory at once.
            del payload
            await _save(job_id, phase="snapshot", version=info["version"], exported_at=info["exported_at"],
                        total_docs=info["total_docs"])
            snapshot = await _write_pre_restore_snapshot("full")
            if not snapshot.get("ok"):
                raise RuntimeError(f"Restore stopped because the safety snapshot could not be verified: {snapshot.get('error')}")
            await _save(job_id, phase="restoring", pre_restore_snapshot=snapshot)
            payload = await _load(path)

            async def progress(collection: str, index: int, total: int, docs_done: int, finished: bool) -> None:
                await _save(job_id, current=collection, collections_done=index - (0 if finished else 1),
                            collections_total=total, current_docs_done=docs_done)

            summary, kept_live = await _restore_collections(payload["collections"], mode, progress)
            del payload
            await _save(job_id, status="done", phase="done", summary=summary, kept_live=kept_live,
                        finished_at=now_iso(), current=None)
        except asyncio.CancelledError:
            # The worker is shutting down (a deploy restart) mid-restore.
            try:
                await asyncio.shield(_save(
                    job_id, status="failed", phase="failed", finished_at=now_iso(),
                    error="Interrupted: the server restarted during the restore. Some collections may be restored "
                          "and others not — run the restore again."))
            except BaseException:
                pass
            raise
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else f"{exc}"
            logger.warning("restore job %s failed: %s", job_id, detail)
            try:
                await _save(job_id, status="failed", phase="failed", error=str(detail)[:1000], finished_at=now_iso())
            except Exception:
                logger.exception("restore job %s: could not record the failure", job_id)
        finally:
            heartbeat.cancel()
            await _release_restore_lock(job_id)

    async def _public(job: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not job:
            return None
        job.pop("_id", None)
        if job.get("status") == "running":
            # Running means its worker still holds the lock and still reports
            # in. A worker that died leaves neither.
            holds = await db.restore_jobs.find_one(
                {"_id": "lock", "holder": job.get("id"), "expires_at": {"$gt": datetime.now(timezone.utc)}}, {"_id": 1})
            try:
                seen = datetime.fromisoformat(str(job.get("updated_at")))
                quiet = datetime.now(timezone.utc) - seen > STALLED_AFTER
            except (TypeError, ValueError):
                quiet = False
            job["stalled"] = bool(quiet or not holds)
        return job

    @api.post("/backup/restore-jobs")
    async def start_restore_job(body: RestoreJobIn, user: dict = Depends(require_owner)):
        """Restore a backup that's on the server. Returns at once; poll the job."""
        f = _resolve(body.name)
        job_id = str(uuid.uuid4())
        if not await _acquire_restore_lock(job_id):
            raise HTTPException(status_code=409, detail="A restore is already running. Wait for it to finish.")
        if await _backup_lease_held():
            await _release_restore_lock(job_id)
            raise HTTPException(status_code=409, detail="A backup is being written right now. Try again in a few minutes.")
        job = {"id": job_id, "status": "running", "phase": "queued", "name": f["name"], "kind": f["kind"],
               "mode": body.mode, "started_at": now_iso(), "updated_at": now_iso(),
               "by": user.get("name") or user.get("email") or user.get("id")}
        try:
            await db.restore_jobs.insert_one(dict(job))
        except Exception:
            await _release_restore_lock(job_id)
            raise
        task = asyncio.create_task(_run(job_id, f["path"], body.mode))
        running_tasks.add(task)
        task.add_done_callback(running_tasks.discard)
        return job

    @api.get("/backup/restore-jobs")
    async def list_restore_jobs(limit: int = 10, _: dict = Depends(require_owner)):
        rows = await db.restore_jobs.find({"id": {"$exists": True}}, {"_id": 0}).sort("started_at", -1).to_list(max(1, min(limit, 50)))
        return [await _public(r) for r in rows]

    @api.get("/backup/restore-jobs/{job_id}")
    async def get_restore_job(job_id: str, _: dict = Depends(require_owner)):
        job = await db.restore_jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Restore job not found")
        return await _public(job)

    return {
        "read_backup_file": read_backup_file, "check_payload": check_payload,
        "list_backup_files": list_backup_files, "download_backup_file": download_backup_file,
        "delete_uploaded_backup": delete_uploaded_backup, "start_backup_upload": start_backup_upload,
        "put_backup_upload_chunk": put_backup_upload_chunk, "abort_backup_upload": abort_backup_upload,
        "finish_backup_upload": finish_backup_upload, "start_restore_job": start_restore_job,
        "list_restore_jobs": list_restore_jobs, "get_restore_job": get_restore_job,
        "_restore_job_tasks": running_tasks,
    }
