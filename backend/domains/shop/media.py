"""Shop product images: storage, derivatives and delivery.

WHAT WAS WRONG
--------------
Every image was kept as a base64 data URL inside a Mongo document and handed
back inside ordinary JSON. Measured on a 3000x2000 product photo:

    original JPEG on disk          2,455,378 bytes
    the same image as base64       3,273,863 bytes   (+33%)
    GET /shop/media/{id} response  3,273,959 bytes

That 3.12 MB was what a 44-pixel list thumbnail downloaded. Ten products on
a page meant roughly 31 MB of transfer to draw ten postage stamps, and none
of it could be cached by the browser as an image because it was JSON.

WHAT THIS DOES
--------------
Derivatives are generated once, at upload, with Pillow, and stored as real
bytes. They are served from their own route as real images — correct
Content-Type, ETag, cache headers — so the browser caches them, decodes them
natively, and a card downloads a card-sized picture.

Sizes are named after where they are used, not after pixel counts, so a
caller asks for what it is drawing rather than guessing:

    thumb  128px   list rows, cart lines
    card   400px   catalog cards, search results
    pdp    900px   the product page
    zoom  1600px   full-screen view, fetched only when asked for

Quality is deliberately NOT squeezed. Sit Happens is becoming
photography-forward and an over-compressed product photo costs more in sales
than it saves in bytes, so these settings favour the picture.

LEGACY IMAGES
-------------
Nothing needs migrating and nothing needs recreating. A document uploaded
before this existed has only its base64 `data`, and the first request for a
derivative generates the whole set from it and saves them. After that it is
indistinguishable from a new upload. `data` is kept either way: it stays the
archival original, and the old JSON endpoints keep working untouched.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
from typing import Dict, List, Optional, Tuple

from bson.binary import Binary
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

# Named for the job, not the pixels — see the module docstring.
SIZES: Dict[str, int] = {"thumb": 128, "card": 400, "pdp": 900, "zoom": 1600}

# WebP at 84 is visually indistinguishable from the JPEG original at these
# dimensions while being far smaller. method=5 spends a little more CPU at
# upload time (once) to save bytes on every view (forever).
WEBP_QUALITY = 84
WEBP_METHOD = 5
DERIVATIVE_MIME = "image/webp"

# The upload ceiling is unchanged from the original implementation.
ALLOWED_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024

# A decoded image this large is refused before Pillow allocates it — a small
# file can still describe an enormous canvas, which is the classic
# decompression bomb. Pillow has its own global guard; this is a Shop-shaped
# one with a message a human can act on.
MAX_PIXELS = 50_000_000

_db = None
_logger = None


def configure(*, db, logger) -> None:
    global _db, _logger
    _db = db
    _logger = logger


def decode_data_url(raw: str) -> Tuple[str, bytes]:
    """Pull the mime and the real bytes out of a data URL.

    Size is measured from the DECODED bytes, never from a client-supplied
    number and never from the base64 length alone.
    """
    if not isinstance(raw, str) or not raw.startswith("data:"):
        raise HTTPException(status_code=400, detail="Expected base64 data URL")
    try:
        header, b64 = raw.split(",", 1)
        mime = header.split(";")[0].replace("data:", "").lower().strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed data URL")
    if mime not in ALLOWED_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type ({mime}). Allowed: JPEG, PNG, WEBP.")
    try:
        blob = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Malformed image data.")
    if not blob:
        raise HTTPException(status_code=400, detail="Empty image.")
    if len(blob) > MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large ({len(blob) // (1024 * 1024)} MB). Max is 5 MB.")
    return mime, blob


def _open(blob: bytes) -> Image.Image:
    """Open image bytes, or refuse them.

    The declared mime is NOT trusted: a file that says image/jpeg and is not
    one fails here, which is what stops a renamed script or a corrupt upload
    ever reaching storage.
    """
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="That file is not a readable image.")
    w, h = im.size
    if w * h > MAX_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=f"Image dimensions are too large ({w}x{h}).")
    # Phones record orientation in EXIF rather than rotating the pixels, so
    # without this a portrait photo is served on its side.
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode else "RGB")
    return im


def _encode(im: Image.Image, box: int) -> Tuple[bytes, int, int]:
    """One derivative: fit inside `box` on the long edge, never upscaled."""
    out = im.copy()
    out.thumbnail((box, box), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
    return buf.getvalue(), out.width, out.height


def build_derivatives(blob: bytes) -> Dict[str, dict]:
    """Every size, from one decode. Pure — no database, so it is testable on
    its own and cannot half-write anything."""
    im = _open(blob)
    out: Dict[str, dict] = {}
    for name, box in SIZES.items():
        data, w, h = _encode(im, box)
        out[name] = {
            "data": Binary(data),
            "mime": DERIVATIVE_MIME,
            "w": w, "h": h,
            "bytes": len(data),
            # Content-addressed, so a browser holding an old copy can be told
            # "still yours" with a 304 rather than a re-download.
            "etag": hashlib.sha256(data).hexdigest()[:32],
        }
    return out


async def ensure_derivatives(media: dict) -> Optional[dict]:
    """The derivatives for this image, generating them if they are missing.

    This is the whole migration story for images uploaded before the pipeline
    existed: the first request for one builds the set from the archived
    base64 and saves it. Nobody re-uploads anything, no batch job runs, and a
    product whose photo is never viewed simply never costs anything.
    """
    if not media:
        return None
    have = media.get("derivatives") or {}
    if all(name in have for name in SIZES):
        return have
    raw = media.get("data")
    if not raw:
        return have or None
    try:
        _mime, blob = decode_data_url(raw)
        built = build_derivatives(blob)
    except HTTPException:
        # A legacy row we cannot decode must not take the page down; callers
        # fall back to the original JSON route.
        _logger.warning("Shop media %s could not be converted", media.get("id"))
        return have or None
    await _db.shop_media.update_one(
        {"id": media["id"]},
        {"$set": {"derivatives": built,
                  "derivatives_built_at": __import__("datetime").datetime.now(
                      __import__("datetime").timezone.utc).isoformat()}})
    return built


async def derivative(media_id: str, size: str) -> Optional[dict]:
    """One named derivative, built on demand. None when there is no image."""
    if size not in SIZES:
        raise HTTPException(status_code=404, detail="Unknown image size.")
    media = await _db.shop_media.find_one({"id": media_id}, {"_id": 0})
    if not media:
        return None
    built = await ensure_derivatives(media)
    if not built or size not in built:
        return None
    return built[size]


async def is_catalog_public_image(media_id: str) -> bool:
    """May this image be served WITHOUT a session?

    Only when it belongs to something a stranger is allowed to look at: an
    item that is active, published to the shop, AND publicly visible — or
    storefront chrome (a banner, a category cover), which is public by
    nature.

    "Referenced by anything" was the earlier, wrong rule. It meant a product
    marked account-only still handed out its photography to anyone who knew
    the id, which is precisely the accident this guards against.

    Deliberately NOT gated on `public_shop_enabled`: whether the guest
    storefront is switched on is a merchandising decision, and tying image
    delivery to it would break every picture in the signed-in Shop the
    moment somebody turned the public site off.
    """
    published = {"pos_products": "show_online",
                 "credit_packs": "available_online",
                 "programs": "available_online"}
    for coll_name, online_field in published.items():
        hit = await _db[coll_name].find_one(
            {"$or": [{"image_id": media_id}, {"image_ids": media_id}],
             "active": True, online_field: True,
             "publicly_visible": {"$ne": False},
             "archived": {"$ne": True}},
            {"_id": 0, "id": 1})
        if hit:
            return True
    # Storefront chrome — a category cover or the shop banner is public by
    # nature; it is not anybody's private product.
    for coll_name in ("shop_categories", "shop_subcategories"):
        if await _db[coll_name].find_one(
                {"$or": [{"image_id": media_id}, {"mobile_image_id": media_id}]},
                {"_id": 0, "id": 1}):
            return True
    return False


# ───────────────────────────────────────────────────────────── galleries

def gallery_ids(doc: dict) -> List[str]:
    """Every image on a catalog item, primary first.

    Additive by design: a product from before galleries existed has only
    `image_id` and reads back as a one-image gallery, so every caller can be
    written against galleries alone and legacy products keep working with no
    migration. `image_id` is also kept in step on write, so anything still
    reading the old field — Shop Manager tables, the POS register grid, an
    old receipt — sees the primary image exactly as before.
    """
    if not doc:
        return []
    ids = [str(i) for i in (doc.get("image_ids") or []) if i]
    if ids:
        return list(dict.fromkeys(ids))          # de-duped, order preserved
    one = doc.get("image_id")
    return [str(one)] if one else []


def primary_image_id(doc: dict) -> Optional[str]:
    ids = gallery_ids(doc)
    return ids[0] if ids else None


def normalize_gallery(image_ids, fallback_image_id=None) -> List[str]:
    """What to store when a caller sends a gallery. Order is the admin's
    chosen order; duplicates are dropped rather than rejected."""
    ids = [str(i).strip() for i in (image_ids or []) if str(i or "").strip()]
    ids = list(dict.fromkeys(ids))
    if not ids and fallback_image_id:
        ids = [str(fallback_image_id)]
    return ids
