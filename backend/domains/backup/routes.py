"""Backup, restore, auto-backup and backup-safety endpoints.

Moved out of server.py verbatim; only the owning module changed. Everything the
moved code still needs is injected, and every moved name is handed back so the
host module can re-export it under its original name.
"""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


logger = logging.getLogger("sithappens")


def make_backup_domain(*, BACKUP_COLLECTIONS, backup_root_ref, BACKUP_VERSION, CONFIG_BACKUP_VERSION, CONFIG_COLLECTIONS, ConfigRestoreIn, DuplicateKeyError, ReturnDocument, school_media_root_ref, STRING_ID_COLLECTIONS, SchoolMediaRestoreIn, _BACKUP_LEASE_ID, _BACKUP_PROCESS_ID, _CRITICAL_BACKUP_COLLECTIONS, _DISK_PROBE_PATHS, _build_config_payload, _business_day_utc_bounds, _disk_row, _export_collection_docs, _perms_for, _read_mounts, _safe_parse_iso, _school_media_archive_path, _validated_school_media_members, _write_school_media_archive, api, business_today, db, logger, now_iso, now_local, require_admin, require_admin_and_permission, require_owner):
    def _safe_backup_dir(path: Optional[str] = None) -> str:
        requested = os.path.realpath(path or backup_root_ref())
        try:
            common = os.path.commonpath([backup_root_ref(), requested])
        except ValueError:
            common = ""
        if common != backup_root_ref():
            raise ValueError(f"Backup folder must be {backup_root_ref()} or a subfolder inside it")
        return requested

    async def _acquire_backup_lease(trigger: str, ttl_minutes: int = 240) -> bool:
        """Mongo-backed mutex shared by every uvicorn worker."""
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=max(15, ttl_minutes))
        query = {
            "_id": _BACKUP_LEASE_ID,
            "$or": [
                {"owner": _BACKUP_PROCESS_ID},
                {"expires_at": {"$exists": False}},
                {"expires_at": {"$lte": now}},
            ],
        }
        update = {"$set": {
            "owner": _BACKUP_PROCESS_ID,
            "trigger": trigger,
            "acquired_at": now,
            "expires_at": expires,
        }}
        try:
            row = await db.app_settings.find_one_and_update(
                query, update, upsert=True, return_document=ReturnDocument.AFTER
            )
            return bool(row and row.get("owner") == _BACKUP_PROCESS_ID)
        except DuplicateKeyError:
            return False

    async def _release_backup_lease() -> None:
        await db.app_settings.delete_one({"_id": _BACKUP_LEASE_ID, "owner": _BACKUP_PROCESS_ID})

    @api.post("/admin/compress-photos")
    async def admin_compress_photos(_: dict = Depends(require_admin)):
        """Kick off a one-time background job that recompresses every base64
        photo in dogs, bookings.report_card, and incidents to the smaller JPEG
        format used by the frontend compressor. Idempotent: photos already
        under ~350 KB are skipped, so re-running is cheap. Returns the current
        progress snapshot — poll `GET /admin/compress-photos/status` to watch."""
        import photo_backfill
        return photo_backfill.start_backfill(db)

    @api.get("/admin/compress-photos/status")
    async def admin_compress_photos_status(_: dict = Depends(require_admin)):
        """Snapshot of the photo backfill (running / counts / bytes saved)."""
        import photo_backfill
        return photo_backfill.get_status()

    @api.get("/backup/export")
    async def backup_export(user: dict = Depends(require_admin)):
        """Download a full JSON backup of every business collection. User accounts
        are intentionally excluded — passwords are hashed and migration of users
        should go through a separate restore flow.

        Sprint 110di-24 — Permission Matrix wiring: `data_export` matrix key is
        now consulted so admins with that toggle off can't pull a full data dump."""
        perms = _perms_for(user)
        if not perms.get("data_export"):
            raise HTTPException(status_code=403, detail="Missing permission: data_export")
        return await _build_backup_payload()


    # ─────────────── Sprint 110di-23 · Config-only Export/Import ───────────────
    # A trimmed slice of the backup that ONLY contains "configurability" data:
    # the master `settings` blob (branding, feature_visibility,
    # client_portal_controls, booking_flow_controls, dashboard_widgets,
    # interface appearance, email templates/branding, payment-plan settings,
    # and named app_settings rows (auto_backup, quarterly_tax, …).
    #
    # Lets the operator carry their configuration between staging/prod or back
    # up just their themes/toggles WITHOUT bundling client/dog/booking data.
    # Restore is always a full overwrite of the named config keys ("replace"
    # semantics for these specific collections only) — predictable backup/restore.

    async def _write_pre_restore_snapshot(kind: str) -> Dict[str, Any]:
        """Atomically write and parse-verify the current state before a restore."""
        snapshot_dir = _safe_backup_dir()
        temp_path: Optional[str] = None
        media_archive_path: Optional[str] = None
        try:
            os.makedirs(snapshot_dir, exist_ok=True)
            if kind == "config":
                payload = await _build_config_payload()
            else:
                payload = await _build_backup_payload()
            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
            filename = f"pre-restore-{kind}-{ts}.json"
            full_path = os.path.join(snapshot_dir, filename)
            temp_path = full_path + f".{os.getpid()}.tmp"
            body = _json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
            import hashlib
            checksum = hashlib.sha256(body).hexdigest()
            with open(temp_path, "wb") as fh:
                fh.write(body)
                fh.flush()
                os.fsync(fh.fileno())
            with open(temp_path, "rb") as fh:
                readback = fh.read()
            if hashlib.sha256(readback).hexdigest() != checksum:
                raise RuntimeError("Pre-restore snapshot checksum verification failed")
            verified = _json.loads(readback.decode("utf-8"))
            if not isinstance(verified.get("collections"), dict):
                raise RuntimeError("Pre-restore snapshot is missing its collections map")
            os.replace(temp_path, full_path)
            temp_path = None
            size = os.path.getsize(full_path)
            return {
                "ok": True,
                "verified": True,
                "path": full_path,
                "filename": filename,
                "size_bytes": size,
                "sha256": checksum,
                "created_at": now_iso(),
            }
        except Exception as exc:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
            logger.warning("pre-restore snapshot (%s) failed: %s", kind, exc)
            return {"ok": False, "verified": False, "error": str(exc), "created_at": now_iso()}

    @api.get("/backup/export-config")
    async def backup_export_config(user: dict = Depends(require_admin)):
        """Download a JSON snapshot of just the configuration collections —
        branding, feature visibility, portal controls, dashboard widgets, card
        themes, email templates, payment-plan settings, and named app_settings
        rows. No client/dog/booking data is included.

        Sprint 110di-24 — Gated on the `settings` matrix key (which is what
        governs editing settings in the first place) so a non-settings admin
        can't smuggle config out via export."""
        perms = _perms_for(user)
        if not perms.get("settings"):
            raise HTTPException(status_code=403, detail="Missing permission: settings")
        return await _build_config_payload()

    @api.post("/backup/restore-config")
    async def backup_restore_config(body: ConfigRestoreIn, _: dict = Depends(require_admin_and_permission("data_export"))):
        """Restore configuration from a config-only backup file. Always replaces
        the listed config collections with the snapshot contents. Collections
        NOT in the payload are left untouched. Anything outside the configured
        allow-list is silently ignored — so you can't accidentally wipe clients
        by uploading the wrong file."""
        if body.kind != "config":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"This file looks like a '{body.kind or 'full'}' export, not a config export. "
                    "Use the full Restore panel for full backups, or re-download via Config Export."
                ),
            )
        if body.version > CONFIG_BACKUP_VERSION:
            raise HTTPException(
                status_code=400,
                detail=f"Config backup version {body.version} is newer than this server (v{CONFIG_BACKUP_VERSION}). Update the server first.",
            )
        # Safety net: snapshot the CURRENT config to disk BEFORE we touch anything
        # so a bad restore can always be rolled back from /app/backups. Failure to
        # write the snapshot is logged but doesn't abort the restore — better to
        # let the operator restore than block on a disk error.
        pre_snapshot = await _write_pre_restore_snapshot("config")
        if not pre_snapshot.get("ok"):
            raise HTTPException(
                status_code=507,
                detail=f"Restore stopped because the safety snapshot could not be verified: {pre_snapshot.get('error')}",
            )
        summary = {}
        for c, docs in (body.collections or {}).items():
            if c not in CONFIG_COLLECTIONS:
                continue
            docs = [d for d in (docs or []) if isinstance(d, dict)]
            # Full-replace semantics: drop the collection, then bulk-insert.
            # Config docs are tiny (handful of rows max) so wiping is cheap and
            # predictable — matches user expectation for "restore this config".
            await db[c].delete_many({})
            if docs:
                await db[c].insert_many(docs)
            summary[c] = {"mode": "replace", "inserted": len(docs)}
        return {
            "ok": True,
            "summary": summary,
            "restored_at": now_iso(),
            "pre_restore_snapshot": pre_snapshot,
        }


    # ─────────────── Sprint 110av · Disk Usage Monitor ───────────────
    # Shows free/used space for every path the container can see. Helps the
    # operator know when they're running out of room for backups / Mongo data
    # before disaster strikes. Works inside an unprivileged container — uses
    # pure shutil.disk_usage (no host privileges needed).
    import shutil

    # Paths the container is *likely* to care about. Anything that doesn't
    # exist is silently skipped; anything mounted from the host shows up via
    # /proc/mounts scan below.

    @api.get("/admin/disk-usage")
    async def admin_disk_usage(_: dict = Depends(require_admin_and_permission("data_export"))):
        """Snapshot of disk usage for every meaningful path inside the container.
        Includes a `likely_ephemeral` flag so the operator knows when a path lives
        on the container overlay (i.e. will be lost on rebuild) vs a real host
        mount. Used by Admin → Settings → Backup & Restore → Disk usage tile.
        """
        mounts = _read_mounts()
        rows: List[Dict[str, Any]] = []
        seen_paths = set()
        # Probe the curated list first so labels are nice
        for path, label in _DISK_PROBE_PATHS:
            if not os.path.exists(path):
                continue
            row = _disk_row(path, label, mounts)
            if row:
                rows.append(row)
                seen_paths.add(path)
        # Now scan /proc/mounts for any real host-mounted filesystems we missed
        interesting_fs = {"ext4", "xfs", "btrfs", "zfs", "nfs", "nfs4", "cifs", "smb"}
        for m in mounts:
            mp = m["mountpoint"]
            if mp in seen_paths:
                continue
            if m["fs_type"] not in interesting_fs:
                continue
            # Skip system paths the operator can't act on
            if mp == "/" or mp.startswith("/proc") or mp.startswith("/sys") or mp.startswith("/dev"):
                continue
            row = _disk_row(mp, mp, mounts)
            if row:
                rows.append(row)
                seen_paths.add(mp)
        return {
            "checked_at": now_iso(),
            "mountpoints": rows,
        }


    # ─────────────── Sprint 110av · Auto-Backup (Tier A) ───────────────
    # Nightly snapshot of every business collection → gzipped JSON file. Runs
    # inside the FastAPI process via a lightweight asyncio loop (no extra
    # dependency). The operator points `path` at a host-mounted folder so
    # backups survive container rebuilds.
    import gzip
    import json as _json

    async def _get_auto_backup_config() -> Dict[str, Any]:
        """Returns the auto-backup config, seeding defaults if missing."""
        row = await db.app_settings.find_one({"_id": "auto_backup"}, {"_id": 0})
        if not row:
            row = {
                "enabled": False,
                "hour": 3,             # 3 AM local
                "minute": 0,
                "path": backup_root_ref(),
                "retain_days": 30,
                "last_run": None,      # filled in by the runner
                "last_ok": None,
                "last_verified": None,
                "last_error": None,
                "last_size_bytes": None,
                "last_sha256": None,
                "last_file": None,
            }
            await db.app_settings.update_one(
                {"_id": "auto_backup"}, {"$set": row}, upsert=True
            )
        # Migrate legacy/unsafe paths back to the persistent bind mount.
        try:
            safe_path = _safe_backup_dir(row.get("path"))
        except ValueError:
            safe_path = backup_root_ref()
            await db.app_settings.update_one(
                {"_id": "auto_backup"},
                {"$set": {
                    "path": safe_path,
                    "last_error": f"Unsafe legacy backup path reset to {safe_path}",
                }},
                upsert=True,
            )
            row["path"] = safe_path
            row["last_error"] = f"Unsafe legacy backup path reset to {safe_path}"
        else:
            row["path"] = safe_path
        return row

    async def _save_auto_backup_config(patch: Dict[str, Any]) -> Dict[str, Any]:
        await db.app_settings.update_one(
            {"_id": "auto_backup"}, {"$set": patch}, upsert=True
        )
        return await _get_auto_backup_config()

    async def _build_backup_payload() -> Dict[str, Any]:
        payload = {
            "version": BACKUP_VERSION,
            "exported_at": now_iso(),
            "collections": {},
        }
        for c in BACKUP_COLLECTIONS:
            payload["collections"][c] = await _export_collection_docs(c)
        payload["collection_counts"] = {
            name: len(items) for name, items in payload["collections"].items()
        }
        payload["total_docs"] = sum(payload["collection_counts"].values())
        return payload

    async def _run_auto_backup_once(trigger: str = "scheduled") -> Dict[str, Any]:
        """Write, atomically publish, parse-verify, and prune one backup."""
        cfg = await _get_auto_backup_config()
        started = now_iso()
        acquired = await _acquire_backup_lease(trigger)
        if not acquired:
            return {
                "id": str(uuid.uuid4()),
                "trigger": trigger,
                "started_at": started,
                "finished_at": now_iso(),
                "ok": False,
                "status": "skipped",
                "path": None,
                "size_bytes": 0,
                "collections": 0,
                "total_docs": 0,
                "pruned": [],
                "error": "Another backup is already running",
            }
        temp_path: Optional[str] = None
        try:
            # The Mongo lease serializes workers. This second check prevents a
            # second worker from starting another scheduled backup immediately
            # after a very fast first run releases the lease. Failed runs remain
            # retryable on the same day.
            if trigger == "scheduled":
                day_start, day_end = _business_day_utc_bounds(business_today().isoformat())
                existing = await db.auto_backup_runs.find_one({
                    "trigger": "scheduled",
                    "ok": True,
                    "started_at": {"$gte": day_start, "$lt": day_end},
                })
                if existing:
                    return {
                        "id": str(uuid.uuid4()),
                        "trigger": trigger,
                        "started_at": started,
                        "finished_at": now_iso(),
                        "ok": False,
                        "status": "skipped",
                        "path": existing.get("path"),
                        "size_bytes": 0,
                        "collections": 0,
                        "total_docs": 0,
                        "pruned": [],
                        "error": "A verified scheduled backup already completed today",
                    }
            target_dir = _safe_backup_dir(cfg.get("path"))
            os.makedirs(target_dir, exist_ok=True)
            payload = await _build_backup_payload()
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S_%f")
            fname = f"sit-happens-{ts}.json.gz"
            full_path = os.path.join(target_dir, fname)
            temp_path = full_path + f".{os.getpid()}.tmp"
            body = _json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
            import hashlib
            body_sha256 = hashlib.sha256(body).hexdigest()
            with gzip.open(temp_path, "wb", compresslevel=6) as fh:
                fh.write(body)
            with gzip.open(temp_path, "rb") as fh:
                verified_body = fh.read()
            readback_sha256 = hashlib.sha256(verified_body).hexdigest()
            if readback_sha256 != body_sha256:
                raise RuntimeError("Backup checksum verification failed after disk write")
            verified = _json.loads(verified_body.decode("utf-8"))
            verified_collections = verified.get("collections") or {}
            missing_critical = [c for c in _CRITICAL_BACKUP_COLLECTIONS if c not in verified_collections]
            verified_counts = {k: len(v or []) for k, v in verified_collections.items() if isinstance(v, list)}
            expected_counts = payload.get("collection_counts") or {}
            mismatched_counts = {
                k: {"expected": expected_counts.get(k), "actual": verified_counts.get(k)}
                for k in expected_counts
                if verified_counts.get(k) != expected_counts.get(k)
            }
            if missing_critical or mismatched_counts:
                raise RuntimeError(
                    f"Backup verification failed; missing={missing_critical}, count_mismatches={mismatched_counts}"
                )
            media_backup = _write_school_media_archive(target_dir, ts)
            media_archive_path = media_backup.get("path")
            os.replace(temp_path, full_path)
            temp_path = None
            size = os.path.getsize(full_path)
            retain = max(1, int(cfg.get("retain_days") or 30))
            cutoff = datetime.now(timezone.utc) - timedelta(days=retain)
            recent_window = datetime.now(timezone.utc) - timedelta(days=7)
            pruned: List[str] = []
            all_files = sorted(
                (f for f in os.listdir(target_dir)
                 if f.startswith("sit-happens-") and f.endswith(".json.gz")),
                reverse=True,
            )
            seen_days: set = set()
            for old in all_files:
                try:
                    stamp = old.split("sit-happens-", 1)[1].split(".json.gz", 1)[0]
                    # Accept both legacy filenames and new microsecond filenames.
                    try:
                        file_dt = datetime.strptime(stamp, "%Y-%m-%d_%H%M%S_%f").replace(tzinfo=timezone.utc)
                    except ValueError:
                        file_dt = datetime.strptime(stamp, "%Y-%m-%d_%H%M%S").replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                day_key = file_dt.date().isoformat()
                if file_dt < cutoff:
                    try:
                        os.remove(os.path.join(target_dir, old))
                        media_old = os.path.join(target_dir, f"sit-happens-school-media-{stamp}.tar.gz")
                        if os.path.exists(media_old):
                            os.remove(media_old); pruned.append(os.path.basename(media_old))
                        pruned.append(old)
                    except Exception:
                        pass
                    continue
                if file_dt >= recent_window:
                    seen_days.add(day_key)
                    continue
                if day_key in seen_days:
                    try:
                        os.remove(os.path.join(target_dir, old))
                        media_old = os.path.join(target_dir, f"sit-happens-school-media-{stamp}.tar.gz")
                        if os.path.exists(media_old):
                            os.remove(media_old); pruned.append(os.path.basename(media_old))
                        pruned.append(old)
                    except Exception:
                        pass
                else:
                    seen_days.add(day_key)
            run_row = {
                "id": str(uuid.uuid4()),
                "trigger": trigger,
                "started_at": started,
                "finished_at": now_iso(),
                "ok": True,
                "status": "ok",
                "verified": True,
                "path": full_path,
                "size_bytes": size,
                "sha256": body_sha256,
                "school_media_archive": media_backup.get("path"),
                "school_media_verified": media_backup.get("verified", False),
                "school_media_files": media_backup.get("files", 0),
                "school_media_size_bytes": media_backup.get("size_bytes", 0),
                "collections": len(payload["collections"]),
                "collection_counts": expected_counts,
                "total_docs": payload.get("total_docs", 0),
                "pruned": pruned,
                "error": None,
            }
            await db.auto_backup_runs.insert_one(dict(run_row))
            await _save_auto_backup_config({
                "path": target_dir,
                "last_run": run_row["finished_at"],
                "last_ok": True,
                "last_verified": True,
                "last_error": None,
                "last_size_bytes": size,
                "last_sha256": body_sha256,
                "last_file": full_path,
            })
            return run_row
        except Exception as e:
            if media_archive_path and os.path.exists(media_archive_path):
                try: os.remove(media_archive_path)
                except Exception: pass
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
            err = f"{type(e).__name__}: {e}"
            run_row = {
                "id": str(uuid.uuid4()),
                "trigger": trigger,
                "started_at": started,
                "finished_at": now_iso(),
                "ok": False,
                "status": "failed",
                "verified": False,
                "path": None,
                "size_bytes": 0,
                "collections": 0,
                "total_docs": 0,
                "pruned": [],
                "error": err,
            }
            await db.auto_backup_runs.insert_one(dict(run_row))
            await _save_auto_backup_config({
                "last_run": run_row["finished_at"],
                "last_ok": False,
                "last_verified": False,
                "last_error": err,
            })
            logger.warning("auto-backup run failed: %s", err)
            return run_row
        finally:
            await _release_backup_lease()

    async def _maybe_auto_backup_tick() -> Dict[str, Any]:
        """Scheduler job replacing the old per-worker `_auto_backup_loop` (which
        every uvicorn worker started, so scheduled backups fired twice). Runs the
        scheduled backup once per business day at/after the configured HH:MM;
        `_run_auto_backup_once` keeps its own lease + same-day guard, and a failed
        attempt is retried no more than hourly."""
        cfg = await _get_auto_backup_config()
        if not cfg.get("enabled"):
            return {"skipped": "disabled"}
        now = now_local()
        hour, minute = int(cfg.get("hour") or 3), int(cfg.get("minute") or 0)
        if (now.hour, now.minute) < (hour, minute):
            return {"skipped": "before_window", "at": f"{hour:02d}:{minute:02d}"}
        today = business_today().isoformat()
        marker = await db.system_runs.find_one({"_id": "auto_backup_tick"}) or {}
        if marker.get("date") == today and marker.get("ok"):
            return {"skipped": "done_today", "path": marker.get("path")}
        last_attempt = marker.get("attempted_at") or ""
        if marker.get("date") == today and last_attempt and last_attempt > (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat():
            return {"skipped": "retry_later", "error": marker.get("error")}
        result = await _run_auto_backup_once(trigger="scheduled")
        ok = bool(result.get("ok")) or (result.get("status") == "skipped" and bool(result.get("path")))
        await db.system_runs.update_one(
            {"_id": "auto_backup_tick"},
            {"$set": {"date": today, "attempted_at": now_iso(), "ok": ok, "status": result.get("status"),
                      "path": result.get("path"), "error": result.get("error")}},
            upsert=True,
        )
        return {"ok": ok, "status": result.get("status"), "path": result.get("path"), "error": result.get("error")}

    class AutoBackupConfigIn(BaseModel):
        enabled: Optional[bool] = None
        hour: Optional[int] = Field(default=None, ge=0, le=23)
        minute: Optional[int] = Field(default=None, ge=0, le=59)
        path: Optional[str] = Field(default=None, max_length=500)
        retain_days: Optional[int] = Field(default=None, ge=1, le=3650)

    @api.get("/admin/auto-backup/config")
    async def get_auto_backup_config(_: dict = Depends(require_admin_and_permission("settings"))):
        cfg = await _get_auto_backup_config()
        # Augment with current path state so the UI can warn about ephemeral mounts
        mounts = _read_mounts()
        safe_path = _safe_backup_dir(cfg.get("path"))
        path_row = _disk_row(safe_path, "Backup target", mounts) if os.path.exists(safe_path) else None
        cfg["path_exists"] = path_row is not None
        cfg["path_info"] = path_row
        cfg["backup_root"] = backup_root_ref()
        cfg["persistent_mount_required"] = True
        return cfg

    @api.put("/admin/auto-backup/config")
    async def put_auto_backup_config(body: AutoBackupConfigIn, _: dict = Depends(require_admin_and_permission("settings"))):
        patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "path" in patch:
            try:
                patch["path"] = _safe_backup_dir(patch["path"])
                os.makedirs(patch["path"], exist_ok=True)
                probe = os.path.join(patch["path"], f".write-test-{os.getpid()}")
                with open(probe, "w", encoding="utf-8") as fh:
                    fh.write("ok")
                os.remove(probe)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Backup folder is not safe/writable: {exc}")
        cfg = await _save_auto_backup_config(patch)
        cfg["backup_root"] = backup_root_ref()
        cfg["persistent_mount_required"] = True
        return cfg

    @api.post("/admin/auto-backup/run-now")
    async def run_auto_backup_now(_: dict = Depends(require_admin_and_permission("data_export"))):
        """Trigger a backup immediately, regardless of the schedule."""
        return await _run_auto_backup_once(trigger="manual")

    @api.get("/admin/auto-backup/runs")
    async def list_auto_backup_runs(limit: int = 30, _: dict = Depends(require_admin_and_permission("data_export"))):
        rows = await db.auto_backup_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(limit)
        return rows


    # ─────────────── Phase 7 · Backup / Restore Safety + Pre-Update Guardrails ───────────────

    def _backup_age_hours(run: Optional[Dict[str, Any]]) -> Optional[float]:
        if not run:
            return None
        dt = _safe_parse_iso(run.get("finished_at") or run.get("started_at") or run.get("last_run"))
        if not dt:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600, 2)

    def _backup_file_info(path: Optional[str]) -> Dict[str, Any]:
        if not path:
            return {"path": None, "exists": False, "size_bytes": 0, "size_mb": 0}
        try:
            exists = os.path.exists(path)
            size = os.path.getsize(path) if exists else 0
            mtime = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).isoformat() if exists else None
            return {
                "path": path,
                "exists": exists,
                "size_bytes": size,
                "size_mb": round(size / (1024 ** 2), 2),
                "modified_at": mtime,
            }
        except Exception as e:
            return {"path": path, "exists": False, "size_bytes": 0, "size_mb": 0, "error": str(e)}

    @api.get("/admin/backup-safety/report")
    async def admin_backup_safety_report(_: dict = Depends(require_admin_and_permission("data_export"))):
        """Pre-update safety report. Read-only.

        This does not replace the host-level ./backup-now.sh tarball, but it gives the
        operator a fast app-side sanity check: recent backup, file existence/size,
        disk pressure, critical collection counts, and a clear go/no-go flag before
        pulling a new branch on the Bazzite box.
        """
        cfg = await _get_auto_backup_config()
        runs = await db.auto_backup_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(10)
        successful = [r for r in runs if (r.get("ok") or r.get("status") == "ok") and r.get("verified", True)]
        latest_ok = successful[0] if successful else None
        latest_file = (latest_ok or {}).get("path") or cfg.get("last_file")
        file_info = _backup_file_info(latest_file)
        age_hours = _backup_age_hours(latest_ok) if latest_ok else None

        counts: Dict[str, int] = {}
        for c in _CRITICAL_BACKUP_COLLECTIONS:
            try:
                counts[c] = await db[c].count_documents({})
            except Exception:
                counts[c] = -1

        disk = await admin_disk_usage(_={})
        backup_target = _safe_backup_dir(cfg.get("path"))
        target_row = None
        for row in disk.get("mountpoints", []):
            if row.get("path") == backup_target or backup_target.startswith(str(row.get("path", "")).rstrip("/") + "/"):
                target_row = row
                break
        danger_paths = [d for d in disk.get("mountpoints", []) if d.get("verdict") == "danger"]
        warn_paths = [d for d in disk.get("mountpoints", []) if d.get("verdict") == "warn"]

        warnings: List[Dict[str, Any]] = []
        def warn(key: str, severity: str, title: str, detail: str):
            warnings.append({"key": key, "severity": severity, "title": title, "detail": detail})

        if not latest_ok:
            warn("no_in_app_backup", "danger", "No successful in-app backup found", "Run Auto-Backup → Run now, or use ./backup-now.sh before updates.")
        elif age_hours is not None and age_hours > 72:
            warn("backup_old", "danger", "Latest in-app backup is older than 72 hours", f"Latest successful run is about {age_hours} hours old.")
        elif age_hours is not None and age_hours > 24:
            warn("backup_stale", "warn", "Latest in-app backup is older than 24 hours", f"Latest successful run is about {age_hours} hours old.")

        if latest_ok and not file_info.get("exists"):
            warn("backup_file_missing", "danger", "Latest backup file is missing", f"Expected file: {latest_file}")
        if latest_ok and int((latest_ok or {}).get("school_media_files") or 0) > 0:
            media_path = (latest_ok or {}).get("school_media_archive")
            if not media_path or not os.path.isfile(str(media_path)):
                warn("school_media_backup_missing", "danger", "School media backup is missing", "The latest database backup references School videos/resources, but its matching media archive is not present.")
            elif not (latest_ok or {}).get("school_media_verified", False):
                warn("school_media_backup_unverified", "danger", "School media backup was not verified", "Run a fresh Auto-Backup before an update or restore.")
        if file_info.get("exists") and file_info.get("size_bytes", 0) < 10_000 and (counts.get("clients", 0) or counts.get("dogs", 0)):
            warn("backup_tiny", "danger", "Latest backup file looks suspiciously small", f"File size is only {file_info.get('size_mb')} MB.")
        if danger_paths:
            warn("disk_danger", "danger", "Disk space danger", f"{len(danger_paths)} mount/path(s) are over the danger threshold.")
        elif warn_paths:
            warn("disk_warn", "warn", "Disk space warning", f"{len(warn_paths)} mount/path(s) need attention or may be ephemeral.")
        if target_row and target_row.get("likely_ephemeral"):
            warn("backup_ephemeral", "danger", "Backup target may be ephemeral", f"{backup_target} is on {target_row.get('fs_type')} storage. Backups may not survive rebuilds.")

        # Login users are intentionally separate because hashed-password migration
        # is a sensitive operation. Make this clear every time before migrations.
        warn("users_separate", "info", "User login accounts are separate", "Full data backup protects business data. For new-machine migration, also use Users → Export with hashes.")

        checklist = [
            {
                "key": "fresh_backup",
                "ok": bool(latest_ok and (age_hours is None or age_hours <= 24) and file_info.get("exists")),
                "label": "Fresh app backup exists",
                "detail": "Run Settings → Backup & Restore → Auto-Backup → Run now before code updates.",
            },
            {
                "key": "host_backup",
                "ok": None,
                "label": "Host tarball backup confirmed",
                "detail": "On Bazzite, run ./backup-now.sh and confirm ~/sit-happens-backups has a new .tar.gz file.",
            },
            {
                "key": "disk_ok",
                "ok": not danger_paths,
                "label": "Disk has safe free space",
                "detail": f"{len(danger_paths)} danger path(s), {len(warn_paths)} warning path(s).",
            },
            {
                "key": "rollback_branch",
                "ok": None,
                "label": "Rollback branch/tag exists",
                "detail": "Before changing branches, keep backup-before-top-tier-test or create a new rollback branch.",
            },
            {
                "key": "no_volume_delete",
                "ok": True,
                "label": "Never use destructive Docker volume commands",
                "detail": "Do not run docker compose down -v, docker volume rm, reset_db.py unless intentionally restoring with a verified backup.",
            },
        ]
        danger_count = sum(1 for w in warnings if w.get("severity") == "danger")
        return {
            "checked_at": now_iso(),
            "pre_update_ok": danger_count == 0,
            "auto_backup": cfg,
            "latest_success": latest_ok,
            "latest_age_hours": age_hours,
            "latest_file": file_info,
            "critical_counts": counts,
            "disk_summary": {"danger": len(danger_paths), "warn": len(warn_paths), "backup_target": target_row},
            "warnings": warnings,
            "checklist": checklist,
            "runs": runs,
        }

    @api.post("/admin/backup-safety/validate-latest")
    async def admin_backup_safety_validate_latest(_: dict = Depends(require_admin_and_permission("data_export"))):
        """Open and parse the latest in-app backup without restoring it.

        This is a safe restore-drill-light: it proves the backup file is readable JSON,
        contains the expected structure, and includes business-critical collections.
        It does NOT write to MongoDB and does NOT mutate data.
        """
        cfg = await _get_auto_backup_config()
        runs = await db.auto_backup_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(25)
        latest = next((r for r in runs if (r.get("ok") or r.get("status") == "ok") and r.get("verified", True) and r.get("path")), None)
        path = (latest or {}).get("path") or cfg.get("last_file")
        info = _backup_file_info(path)
        if not path or not info.get("exists"):
            raise HTTPException(status_code=404, detail="No readable latest in-app backup file found")
        try:
            import hashlib
            if str(path).endswith(".gz"):
                with gzip.open(path, "rb") as fh:
                    raw_payload = fh.read()
            else:
                with open(path, "rb") as fh:
                    raw_payload = fh.read()
            calculated_sha256 = hashlib.sha256(raw_payload).hexdigest()
            payload = _json.loads(raw_payload.decode("utf-8"))
        except Exception as e:
            return {
                "ok": False,
                "path": path,
                "file": info,
                "error": f"Could not parse backup: {type(e).__name__}: {e}",
                "validated_at": now_iso(),
            }
        collections = payload.get("collections") or {}
        missing_critical = [c for c in _CRITICAL_BACKUP_COLLECTIONS if c not in collections]
        missing_known = [c for c in BACKUP_COLLECTIONS if c not in collections]
        counts = {k: len(v or []) for k, v in collections.items() if isinstance(v, list)}
        total_docs = sum(counts.values())
        warnings: List[Dict[str, Any]] = []
        expected_sha256 = (latest or {}).get("sha256") or cfg.get("last_sha256")
        if expected_sha256 and calculated_sha256 != expected_sha256:
            warnings.append({"severity": "danger", "title": "Checksum mismatch", "detail": "The backup file no longer matches the checksum recorded when it was created."})
        if missing_critical:
            warnings.append({"severity": "danger", "title": "Missing critical collections", "detail": ", ".join(missing_critical)})
        if missing_known:
            warnings.append({"severity": "warn", "title": "Backup missing newer known collections", "detail": ", ".join(missing_known[:20]) + ("…" if len(missing_known) > 20 else "")})
        if total_docs == 0:
            warnings.append({"severity": "danger", "title": "Backup contains zero documents", "detail": "This does not look like a usable business backup."})
        media_validation = {"required": False, "verified": True, "files": 0, "archive": None, "error": None}
        if int((latest or {}).get("school_media_files") or 0) > 0:
            import tarfile
            media_validation["required"] = True
            media_validation["archive"] = (latest or {}).get("school_media_archive")
            media_validation["files"] = int((latest or {}).get("school_media_files") or 0)
            try:
                media_path = str(media_validation["archive"] or "")
                if not media_path or not os.path.isfile(media_path):
                    raise RuntimeError("Matching School media archive is missing")
                with tarfile.open(media_path, "r:gz") as tf:
                    members = _validated_school_media_members(tf)
                    archived_files = sum(1 for m in members if m.isfile())
                if archived_files != media_validation["files"]:
                    raise RuntimeError(f"Expected {media_validation['files']} School media files but archive contains {archived_files}")
                media_validation["verified"] = True
            except Exception as exc:
                media_validation["verified"] = False
                media_validation["error"] = str(getattr(exc, "detail", exc))
                warnings.append({"severity": "danger", "title": "School media backup is not restorable", "detail": media_validation["error"]})
        ok = not any(w.get("severity") == "danger" for w in warnings)
        run_row = {
            "id": str(uuid.uuid4()),
            "type": "validate_latest",
            "created_at": now_iso(),
            "ok": ok,
            "path": path,
            "size_bytes": info.get("size_bytes"),
            "sha256": calculated_sha256,
            "expected_sha256": expected_sha256,
            "version": payload.get("version"),
            "exported_at": payload.get("exported_at"),
            "collections": len(collections),
            "total_docs": total_docs,
            "school_media": media_validation,
            "warnings": warnings,
        }
        try:
            await db.backup_restore_drills.insert_one(run_row)
        except Exception:
            pass
        run_row.pop("_id", None)
        return {
            "ok": ok,
            "path": path,
            "file": info,
            "sha256": calculated_sha256,
            "expected_sha256": expected_sha256,
            "version": payload.get("version"),
            "exported_at": payload.get("exported_at"),
            "collections": len(collections),
            "total_docs": total_docs,
            "counts": counts,
            "missing_critical": missing_critical,
            "missing_known": missing_known,
            "school_media": media_validation,
            "warnings": warnings,
            "validated_at": run_row["created_at"],
        }

    @api.get("/admin/backup-safety/validations")
    async def admin_backup_safety_validations(limit: int = 10, _: dict = Depends(require_admin_and_permission("data_export"))):
        rows = await db.backup_restore_drills.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return rows

    @api.get("/admin/backup-safety/school-media-archives")
    async def admin_school_media_archives(_: dict = Depends(require_admin_and_permission("data_export"))):
        """List verified-looking School media sidecars available for recovery."""
        root = _safe_backup_dir()
        os.makedirs(root, exist_ok=True)
        rows: List[Dict[str, Any]] = []
        import tarfile
        for name in sorted(os.listdir(root), reverse=True):
            if not (name.startswith("sit-happens-school-media-") and name.endswith(".tar.gz")):
                continue
            path = os.path.join(root, name)
            if not os.path.isfile(path):
                continue
            verified = False
            file_count = 0
            error = None
            try:
                with tarfile.open(path, "r:gz") as tf:
                    members = _validated_school_media_members(tf)
                    file_count = sum(1 for m in members if m.isfile())
                    verified = True
            except HTTPException as exc:
                error = str(exc.detail)
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
            rows.append({
                "filename": name,
                "size_bytes": os.path.getsize(path),
                "modified_at": datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat(),
                "files": file_count,
                "verified": verified,
                "error": error,
            })
        return {"archives": rows, "media_root": school_media_root_ref()}

    @api.get("/admin/backup-safety/school-media-archives/{filename}")
    async def admin_download_school_media_archive(filename: str, _: dict = Depends(require_admin_and_permission("data_export"))):
        """Download one verified-path School media archive for off-machine storage."""
        path = _school_media_archive_path(filename)
        return FileResponse(path, filename=os.path.basename(path), media_type="application/gzip")

    @api.post("/admin/backup-safety/restore-school-media")
    async def admin_restore_school_media(body: SchoolMediaRestoreIn, _: dict = Depends(require_owner)):
        """Restore filesystem-backed School media from a verified backup sidecar.

        The archive must already live in backup_root_ref(). Before replacement we archive
        the currently-live media, validate every tar member against path traversal,
        extract alongside the live directory, and then swap directories. Mongo is
        untouched; pair this with the matching JSON restore when doing full DR.
        """
        import tarfile
        import tempfile

        archive_path = _school_media_archive_path(body.filename)
        media_root = os.path.realpath(school_media_root_ref())
        media_parent = os.path.dirname(media_root)
        os.makedirs(media_parent, exist_ok=True)

        # Preserve the current bytes before touching the live media directory.
        pre_stamp = "pre-restore-" + datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S_%f")
        pre_restore = _write_school_media_archive(_safe_backup_dir(), pre_stamp)

        temp_parent = tempfile.mkdtemp(prefix=".school-media-restore-", dir=media_parent)
        staged_root = os.path.join(temp_parent, "school_media")
        old_root = media_root + ".pre-restore-" + uuid.uuid4().hex
        old_moved = False
        try:
            with tarfile.open(archive_path, "r:gz") as tf:
                members = _validated_school_media_members(tf)
                tf.extractall(temp_parent, members=members)
            if not os.path.isdir(staged_root):
                raise HTTPException(status_code=400, detail="Archive does not contain a school_media folder")
            restored_files = sum(len(names) for _, _, names in os.walk(staged_root))

            if os.path.exists(media_root):
                os.replace(media_root, old_root)
                old_moved = True
            os.replace(staged_root, media_root)
            if old_moved and os.path.isdir(old_root):
                shutil.rmtree(old_root, ignore_errors=True)
                old_moved = False

            run_row = {
                "id": str(uuid.uuid4()),
                "type": "restore_school_media",
                "created_at": now_iso(),
                "ok": True,
                "archive": body.filename,
                "restored_files": restored_files,
                "pre_restore_archive": pre_restore.get("filename"),
                "pre_restore_verified": pre_restore.get("verified", False),
            }
            try:
                await db.backup_restore_drills.insert_one(dict(run_row))
            except Exception:
                pass
            run_row.pop("_id", None)
            return run_row
        except Exception:
            # If the live directory was moved but the staged swap failed, put it back.
            if old_moved and os.path.exists(old_root) and not os.path.exists(media_root):
                try:
                    os.replace(old_root, media_root)
                    old_moved = False
                except Exception:
                    logger.exception("Could not roll back School media restore directory swap")
            raise
        finally:
            shutil.rmtree(temp_parent, ignore_errors=True)
            if old_moved and os.path.isdir(old_root):
                shutil.rmtree(old_root, ignore_errors=True)


    # ─────────────── Sprint 110ax · Dog Fact of the Day ───────────────
    # Daily sticky engagement: a single curated "fun fact" appears on both the
    # client portal and the admin dashboard. Same fact for everyone same day —
    class BackupRestoreIn(BaseModel):
        version: int
        collections: dict
        mode: Literal["replace", "merge"] = "replace"  # replace = wipe & restore; merge = upsert by id

    @api.post("/backup/restore")
    async def backup_restore(body: BackupRestoreIn, _: dict = Depends(require_owner)):
        """Restore from a backup JSON. Two modes:
           - replace: drops each collection and bulk-inserts the backup contents
           - merge:   upserts each document by `id` (existing docs with same id are overwritten; new ones added)
        User accounts are never touched."""
        if body.version > BACKUP_VERSION:
            raise HTTPException(
                status_code=400,
                detail=f"Backup version {body.version} is newer than this server (v{BACKUP_VERSION}). Update the server first.",
            )
        # Safety net: snapshot the CURRENT full state to disk BEFORE we touch
        # anything so a bad restore can always be rolled back from /app/backups.
        # Logged + returned to the UI; non-fatal on disk errors.
        pre_snapshot = await _write_pre_restore_snapshot("full")
        if not pre_snapshot.get("ok"):
            raise HTTPException(
                status_code=507,
                detail=f"Restore stopped because the safety snapshot could not be verified: {pre_snapshot.get('error')}",
            )
        # Older versions are accepted — they simply contain fewer collections.
        # Collections not in the payload are left alone (never wiped), so restoring
        # a v1 snapshot won't blow away homework_templates, trophies, etc.
        summary = {}
        for c, docs in (body.collections or {}).items():
            if c not in BACKUP_COLLECTIONS:
                continue
            docs = [d for d in (docs or []) if isinstance(d, dict)]
            is_string_id = c in STRING_ID_COLLECTIONS
            if body.mode == "replace":
                await db[c].delete_many({})
                if docs:
                    await db[c].insert_many(docs)
                summary[c] = {"mode": "replace", "inserted": len(docs)}
            else:  # merge
                upserts = 0
                for doc in docs:
                    # Pick the right natural key per collection
                    if is_string_id and isinstance(doc.get("_id"), str):
                        key_filter = {"_id": doc["_id"]}
                        await db[c].update_one(key_filter, {"$set": doc}, upsert=True)
                        upserts += 1
                        continue
                    key = doc.get("id")
                    if not key:
                        await db[c].insert_one(doc)
                        upserts += 1
                        continue
                    await db[c].update_one({"id": key}, {"$set": doc}, upsert=True)
                    upserts += 1
                summary[c] = {"mode": "merge", "upserted": upserts}
        return {
            "ok": True,
            "summary": summary,
            "restored_at": now_iso(),
            "pre_restore_snapshot": pre_snapshot,
        }


    # ───────────────────────── Trophies ─────────────────────────────

    return {"_safe_backup_dir": _safe_backup_dir, "_acquire_backup_lease": _acquire_backup_lease, "_release_backup_lease": _release_backup_lease, "admin_compress_photos": admin_compress_photos, "admin_compress_photos_status": admin_compress_photos_status, "backup_export": backup_export, "_write_pre_restore_snapshot": _write_pre_restore_snapshot, "backup_export_config": backup_export_config, "backup_restore_config": backup_restore_config, "admin_disk_usage": admin_disk_usage, "_get_auto_backup_config": _get_auto_backup_config, "_save_auto_backup_config": _save_auto_backup_config, "_build_backup_payload": _build_backup_payload, "_run_auto_backup_once": _run_auto_backup_once, "_maybe_auto_backup_tick": _maybe_auto_backup_tick, "AutoBackupConfigIn": AutoBackupConfigIn, "get_auto_backup_config": get_auto_backup_config, "put_auto_backup_config": put_auto_backup_config, "run_auto_backup_now": run_auto_backup_now, "list_auto_backup_runs": list_auto_backup_runs, "_backup_age_hours": _backup_age_hours, "_backup_file_info": _backup_file_info, "admin_backup_safety_report": admin_backup_safety_report, "admin_backup_safety_validate_latest": admin_backup_safety_validate_latest, "admin_backup_safety_validations": admin_backup_safety_validations, "admin_school_media_archives": admin_school_media_archives, "admin_download_school_media_archive": admin_download_school_media_archive, "admin_restore_school_media": admin_restore_school_media, "BackupRestoreIn": BackupRestoreIn, "backup_restore": backup_restore}
