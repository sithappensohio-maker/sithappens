"""Photo backfill — recompress existing base64 photos in MongoDB to the new
~15× smaller format that client-side compression already applies to new
uploads. Targets dog photos, dog gallery photos, booking report-card photos,
and incident photos. Idempotent: photos already under the size threshold
are skipped so reruns are cheap.

Runs as a background asyncio task so the API stays responsive. Progress
state is held in a single module-level dict — fine for a solo-operator app
running one worker."""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
from typing import Any, Dict, List, Optional

from PIL import Image

logger = logging.getLogger(__name__)

MAX_DIM = 1600  # match the frontend canvas resize
JPEG_QUALITY = 82
SKIP_BELOW_BYTES = 350_000  # photos smaller than ~350 KB are already fine

_DATA_URL_RE = re.compile(r"^data:image/([a-zA-Z+]+);base64,(.+)$", re.DOTALL)

# Module-level progress state. Reset by start_backfill().
_state: Dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "scanned": 0,
    "compressed": 0,
    "skipped": 0,
    "errors": 0,
    "bytes_before": 0,
    "bytes_after": 0,
    "current_stage": None,
    "error_message": None,
}


def get_status() -> Dict[str, Any]:
    """Snapshot of current progress."""
    s = dict(_state)
    s["bytes_saved"] = max(s["bytes_before"] - s["bytes_after"], 0)
    s["mb_saved"] = round(s["bytes_saved"] / (1024 * 1024), 2)
    return s


def _compress_data_url(data_url: str) -> Optional[str]:
    """Decode → resize → re-encode a base64 image data URL. Returns the
    new data URL or None if the image is already small enough / not a
    bitmap we can recompress."""
    if not data_url or not isinstance(data_url, str):
        return None
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        # Already shrunk by a previous run or not a recognised image string.
        return None
    fmt = m.group(1).lower()
    if fmt == "svg+xml":
        return None
    raw = base64.b64decode(m.group(2))
    if len(raw) < SKIP_BELOW_BYTES:
        return None
    try:
        img = Image.open(io.BytesIO(raw))
        # Convert to RGB so PNG / RGBA / palette images get a clean JPEG export.
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        # Resize keeping aspect ratio if any side exceeds MAX_DIM.
        if img.width > MAX_DIM or img.height > MAX_DIM:
            img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        compressed_raw = out.getvalue()
        # Only swap if it's actually smaller — otherwise leave the original.
        if len(compressed_raw) >= len(raw):
            return None
        b64 = base64.b64encode(compressed_raw).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
    except Exception as e:
        logger.warning(f"compress failed: {e}")
        _state["errors"] += 1
        return None


async def _backfill_dogs(db) -> None:
    _state["current_stage"] = "dogs"
    cursor = db.dogs.find({}, projection=None)
    async for dog in cursor:
        _state["scanned"] += 1
        update: Dict[str, Any] = {}
        # Main photo
        if dog.get("photo"):
            before = len(dog["photo"])
            new = _compress_data_url(dog["photo"])
            if new:
                _state["bytes_before"] += before
                _state["bytes_after"] += len(new)
                update["photo"] = new
                _state["compressed"] += 1
            else:
                _state["skipped"] += 1
        # Gallery
        gallery = dog.get("photos") or []
        if gallery:
            new_gallery: List[str] = []
            changed = False
            for p in gallery:
                if not p:
                    continue
                before = len(p)
                new = _compress_data_url(p)
                if new:
                    _state["bytes_before"] += before
                    _state["bytes_after"] += len(new)
                    _state["compressed"] += 1
                    new_gallery.append(new)
                    changed = True
                else:
                    _state["skipped"] += 1
                    new_gallery.append(p)
            if changed:
                update["photos"] = new_gallery
        if update:
            await db.dogs.update_one({"id": dog["id"]}, {"$set": update})
        await asyncio.sleep(0)  # cooperative yield


async def _backfill_bookings(db) -> None:
    """Compress report_card.photos arrays on bookings."""
    _state["current_stage"] = "bookings"
    cursor = db.bookings.find({"report_card.photos": {"$exists": True, "$ne": []}}, projection=None)
    async for bk in cursor:
        _state["scanned"] += 1
        rc = bk.get("report_card") or {}
        photos = rc.get("photos") or []
        if not photos:
            continue
        new_photos: List[str] = []
        changed = False
        for p in photos:
            if not p:
                continue
            before = len(p)
            new = _compress_data_url(p)
            if new:
                _state["bytes_before"] += before
                _state["bytes_after"] += len(new)
                _state["compressed"] += 1
                new_photos.append(new)
                changed = True
            else:
                _state["skipped"] += 1
                new_photos.append(p)
        if changed:
            await db.bookings.update_one({"id": bk["id"]}, {"$set": {"report_card.photos": new_photos}})
        await asyncio.sleep(0)


async def _backfill_incidents(db) -> None:
    _state["current_stage"] = "incidents"
    cursor = db.incidents.find({"photos": {"$exists": True, "$ne": []}}, projection=None)
    async for inc in cursor:
        _state["scanned"] += 1
        photos = inc.get("photos") or []
        if not photos:
            continue
        new_photos: List[str] = []
        changed = False
        for p in photos:
            if not p:
                continue
            before = len(p)
            new = _compress_data_url(p)
            if new:
                _state["bytes_before"] += before
                _state["bytes_after"] += len(new)
                _state["compressed"] += 1
                new_photos.append(new)
                changed = True
            else:
                _state["skipped"] += 1
                new_photos.append(p)
        if changed:
            await db.incidents.update_one({"id": inc["id"]}, {"$set": {"photos": new_photos}})
        await asyncio.sleep(0)


async def _run_backfill(db) -> None:
    """Top-level orchestrator. Resets state, runs each stage, marks done."""
    from datetime import datetime, timezone
    _state.update({
        "running": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "scanned": 0,
        "compressed": 0,
        "skipped": 0,
        "errors": 0,
        "bytes_before": 0,
        "bytes_after": 0,
        "current_stage": "starting",
        "error_message": None,
    })
    try:
        await _backfill_dogs(db)
        await _backfill_bookings(db)
        await _backfill_incidents(db)
        _state["current_stage"] = "done"
    except Exception as e:
        logger.exception("backfill failed")
        _state["error_message"] = str(e)
    finally:
        _state["running"] = False
        from datetime import datetime, timezone
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()


def start_backfill(db) -> Dict[str, Any]:
    """Kick off the backfill if one isn't already running. Returns the
    current state snapshot."""
    if _state.get("running"):
        return get_status()
    asyncio.create_task(_run_backfill(db))
    return get_status()
