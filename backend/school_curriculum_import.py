"""Online School — full-curriculum import from a ZIP package.

A curriculum author works in documents and folders, not in a database. This
accepts one .zip containing a `manifest.json` plus the image and media files it
references by relative path, and turns it into a real School program whose
lessons already have their demonstration images sitting between the paragraphs
that discuss them.

THE FORMAT IS NOT NEW. `programStudioPolish.js` already defines a program
template — `{sit_happens_template: "online_school_program", version: 2,
program, homework_templates}` — and Program Studio already imports and exports
it. This is that same document at version 3, with two additions:

  * every structural node may carry a `source_key`, so a re-import can
    recognise what it created before instead of duplicating it;
  * an image or video block may carry `media` — a relative path into the ZIP —
    instead of a `resource_id`, because a package has files and a database has
    ids, and the importer is what converts one into the other.

A version-2 template with no media and no source keys still imports.

VALIDATION HAPPENS FIRST, IN FULL. Nothing is written until the whole package
has been checked, so a package that is broken half way down does not leave a
half-built course behind.

The result is ORDINARY curriculum. An imported image becomes a content block
with a `resource_id`, a caption and an alt text — the same block Program Studio
writes by hand — so there is no imported-media model to maintain and every
imported image is editable, movable and removable like any other.
"""
import base64
import binascii
import hashlib
import io
import json
import posixpath
import zipfile
from typing import Any, Dict, List, Optional, Tuple

MANIFEST_NAME = "manifest.json"
TEMPLATE_KIND = "online_school_program"
SUPPORTED_VERSIONS = (2, 3)

# Deliberately the SAME image types the School Resources pipeline already
# accepts, minus HEIC: HEIC does not decode in Chromium, Firefox or Edge, so an
# HEIC lesson image would render broken for most students. It stays valid for
# other resource uses; it is simply not something a package may plant inline.
IMAGE_EXT_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
}
VIDEO_EXT_MIME = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".m4v": "video/x-m4v", ".3gp": "video/3gpp",
}
MEDIA_EXT_MIME = {**IMAGE_EXT_MIME, **VIDEO_EXT_MIME}

# Bounds for an untrusted archive. Sized for a REAL course: a 24-module
# curriculum with a few images per lesson and the odd video sits comfortably
# inside these, so a legitimate package is never inconvenienced.
MAX_MEDIA_BYTES = 50 * 1024 * 1024        # per member; matches the School Resource ceiling
MAX_PACKAGE_BYTES = 200 * 1024 * 1024     # total uncompressed
MAX_ENTRIES = 2000                        # members

# A zip bomb is a tiny archive that claims to expand enormously. Real lesson
# media barely compresses at all (JPEG, PNG and MP4 are already compressed),
# and even JSON rarely beats about 20x, so a member expanding by more than
# this is not curriculum. Only applied above a floor, because a handful of
# highly-compressible bytes can hit a big ratio innocently.
MAX_COMPRESSION_RATIO = 200
COMPRESSION_RATIO_FLOOR = 4096            # bytes of compressed data

# Unix mode bits carried in a ZIP entry's external attributes.
_S_IFMT = 0o170000
_S_IFREG = 0o100000
_S_IFLNK = 0o120000
_S_IFDIR = 0o040000

# Block types the curriculum schema already supports. The importer does not get
# to invent one.
BLOCK_TYPES = {
    "text", "video", "image", "steps", "trainer_tip", "warning", "checklist",
    "quiz", "timer", "rep_counter", "download", "practice", "checkpoint",
}
MEDIA_BLOCK_TYPES = {"image", "video", "download"}


class ImportError_(Exception):
    """A package-level problem. Carries every issue found, not just the first —
    an author fixing a package wants the whole list."""

    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__("; ".join(errors[:5]))


# ---------------------------------------------------------------------------
# Reading the package
# ---------------------------------------------------------------------------

def _decode_package(data: str) -> bytes:
    """Accept a data: URL or bare base64, and refuse anything oversized."""
    raw = (data or "").strip()
    if raw.startswith("data:"):
        if "," not in raw:
            raise ImportError_(["That upload is not a readable file."])
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        raise ImportError_(["That upload is not a readable file."])
    if not blob:
        raise ImportError_(["The package is empty."])
    if len(blob) > MAX_PACKAGE_BYTES:
        raise ImportError_([f"Package too large. Max is {MAX_PACKAGE_BYTES // (1024*1024)} MB."])
    return blob


def _safe_member(name: str) -> Optional[str]:
    """Normalise a ZIP entry name, or None if it tries to escape.

    A package is untrusted input: `../`, an absolute path and a Windows drive
    letter all get refused rather than normalised into something surprising.
    """
    if not name or name.endswith("/"):
        return None
    n = name.replace("\\", "/")
    if n.startswith("/") or (len(n) > 1 and n[1] == ":"):
        return None
    normalised = posixpath.normpath(n)
    if normalised.startswith("../") or normalised == ".." or normalised.startswith("/"):
        return None
    if any(part == ".." for part in normalised.split("/")):
        return None
    return normalised


def _entry_problem(info) -> Optional[str]:
    """Why this archive member must not be read, or None if it is fine.

    Checked BEFORE any decompression, so a hostile archive is refused rather
    than absorbed.
    """
    mode = (info.external_attr >> 16) & _S_IFMT
    if mode == _S_IFLNK:
        return "is a symlink"
    if mode and mode not in (_S_IFREG, _S_IFDIR):
        return "is not a regular file"
    if info.file_size > MAX_MEDIA_BYTES:
        return f"is larger than {MAX_MEDIA_BYTES // (1024 * 1024)} MB"
    if (info.compress_size >= COMPRESSION_RATIO_FLOOR
            and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO):
        return "expands far more than any real curriculum file would"
    return None


def open_package(data: str) -> Tuple[dict, Dict[str, bytes]]:
    """Return (manifest, files-by-normalised-path). Raises ImportError_."""
    blob = _decode_package(data)
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise ImportError_(["That file is not a .zip package."])

    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise ImportError_([f"Package has too many files (max {MAX_ENTRIES})."])

    files: Dict[str, bytes] = {}
    rejected: List[str] = []
    total = 0
    for info in infos:
        if info.is_dir():
            continue
        safe = _safe_member(info.filename)
        if safe is None:
            rejected.append(f"{info.filename} (escapes the package)")
            continue
        problem = _entry_problem(info)
        if problem:
            rejected.append(f"{safe} ({problem})")
            continue
        total += info.file_size
        if total > MAX_PACKAGE_BYTES:
            raise ImportError_([
                f"Package contents expand beyond "
                f"{MAX_PACKAGE_BYTES // (1024 * 1024)} MB."])
        # The header's declared size is a claim, not a fact, so read with a
        # hard cap and refuse anything that keeps going past it.
        with zf.open(info) as fh:
            blob = fh.read(MAX_MEDIA_BYTES + 1)
        if len(blob) > MAX_MEDIA_BYTES:
            rejected.append(f"{safe} (larger than it declared)")
            continue
        files[safe] = blob

    if rejected:
        raise ImportError_([f"Rejected archive entry: {r}" for r in rejected[:5]])

    manifest_path = next((p for p in files if posixpath.basename(p) == MANIFEST_NAME
                          and p.count("/") <= 1), None)
    if not manifest_path:
        raise ImportError_([f"Package has no {MANIFEST_NAME}."])
    try:
        manifest = json.loads(files[manifest_path].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ImportError_([f"{MANIFEST_NAME} is not valid JSON: {e}"])
    if not isinstance(manifest, dict):
        raise ImportError_([f"{MANIFEST_NAME} must be a JSON object."])

    # Media paths in the manifest are relative to the manifest's own folder.
    root = posixpath.dirname(manifest_path)
    if root:
        files = {p[len(root) + 1:]: b for p, b in files.items() if p.startswith(root + "/")}
    return manifest, files


# ---------------------------------------------------------------------------
# Validating the manifest, completely, before anything is written
# ---------------------------------------------------------------------------

def _txt(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def validate(manifest: dict, files: Dict[str, bytes]) -> dict:
    """Check the whole package and return a plan. Raises ImportError_ with
    every problem found."""
    errors: List[str] = []
    warnings: List[str] = []

    kind = manifest.get("sit_happens_template")
    if kind != TEMPLATE_KIND:
        errors.append(f'Not a Sit Happens curriculum package (expected '
                      f'sit_happens_template "{TEMPLATE_KIND}").')
    version = manifest.get("version")
    if version not in SUPPORTED_VERSIONS:
        errors.append(f"Unsupported package version {version!r}. Supported: "
                      f"{', '.join(str(v) for v in SUPPORTED_VERSIONS)}.")
    program = manifest.get("program")
    if not isinstance(program, dict):
        errors.append("Manifest has no `program` object.")
        raise ImportError_(errors)
    if not _txt(program.get("name")):
        errors.append("The program needs a name.")
    modules = program.get("modules")
    if not isinstance(modules, list) or not modules:
        errors.append("The program needs at least one module.")
        raise ImportError_(errors)

    seen_keys: Dict[str, str] = {}

    def claim(kind_: str, key: str, where: str):
        if not key:
            return
        token = f"{kind_}:{key}"
        if token in seen_keys:
            errors.append(f"Duplicate {kind_} source_key {key!r} "
                          f"({where} and {seen_keys[token]}).")
        else:
            seen_keys[token] = where

    claim("program", _txt(program.get("source_key")), "program")

    used_media: set = set()
    media_plan: List[dict] = []
    counts = {"modules": 0, "lessons": 0, "blocks": 0, "images": 0, "videos": 0}

    for mi, module in enumerate(modules):
        where_m = f"module {mi + 1}"
        if not isinstance(module, dict):
            errors.append(f"{where_m} is not an object."); continue
        if not _txt(module.get("name")):
            errors.append(f"{where_m} needs a name.")
        claim("module", _txt(module.get("source_key")), where_m)
        counts["modules"] += 1

        lessons = module.get("lessons") or []
        if not isinstance(lessons, list):
            errors.append(f"{where_m}: `lessons` must be a list."); lessons = []
        for li, lesson in enumerate(lessons):
            where_l = f"{where_m}, lesson {li + 1}"
            if not isinstance(lesson, dict):
                errors.append(f"{where_l} is not an object."); continue
            if not _txt(lesson.get("name")):
                errors.append(f"{where_l} needs a name.")
            claim("lesson", _txt(lesson.get("source_key")), where_l)
            counts["lessons"] += 1

            blocks = lesson.get("content_blocks") or []
            if not isinstance(blocks, list):
                errors.append(f"{where_l}: `content_blocks` must be a list."); blocks = []
            for bi, block in enumerate(blocks):
                where_b = f"{where_l}, block {bi + 1}"
                if not isinstance(block, dict):
                    errors.append(f"{where_b} is not an object."); continue
                btype = block.get("type")
                if btype not in BLOCK_TYPES:
                    errors.append(f"{where_b}: unsupported block type {btype!r}.")
                    continue
                claim("block", _txt(block.get("source_key")), where_b)
                counts["blocks"] += 1

                media_ref = _txt(block.get("media"))
                if media_ref:
                    if btype not in MEDIA_BLOCK_TYPES:
                        errors.append(f"{where_b}: a {btype} block cannot carry media.")
                        continue
                    safe = _safe_member(media_ref)
                    if safe is None:
                        errors.append(f"{where_b}: unsafe media path {media_ref!r}.")
                        continue
                    if safe not in files:
                        errors.append(f"{where_b}: media file {media_ref!r} is not in the package.")
                        continue
                    ext = posixpath.splitext(safe)[1].lower()
                    mime = MEDIA_EXT_MIME.get(ext)
                    if not mime:
                        errors.append(f"{where_b}: unsupported media type {ext or media_ref!r}.")
                        continue
                    if btype == "image" and ext not in IMAGE_EXT_MIME:
                        errors.append(f"{where_b}: {ext} is not a usable inline lesson image.")
                        continue
                    used_media.add(safe)
                    media_plan.append({"path": safe, "mime": mime, "block": where_b})
                    counts["images" if btype == "image" else "videos"] += 1
                elif btype == "image" and not _txt(block.get("url")) and not _txt(block.get("resource_id")):
                    errors.append(f"{where_b}: an image block needs `media`, `url` or `resource_id`.")

    # Media shipped in the package that no block references. Never discarded —
    # imported into the School library and reported so the author can place it.
    declared = {p for p in files
                if posixpath.splitext(p)[1].lower() in MEDIA_EXT_MIME}
    unplaced = sorted(declared - used_media)

    if errors:
        raise ImportError_(errors)

    return {"program": program, "counts": counts, "media_plan": media_plan,
            "unplaced": unplaced, "warnings": warnings,
            "version": version, "source_key": _txt(program.get("source_key"))}


# ---------------------------------------------------------------------------
# Inline lesson images are web assets, wherever they came from
# ---------------------------------------------------------------------------

# The same numbers the browser-side compressor uses for a Program Studio
# upload (frontend/src/lib/imageCompress.js) and the same ones photo_backfill
# already applies server-side. An inline demonstration image should be
# web-appropriate whether an author dragged it into the Studio or shipped it
# inside a package — 1600px is still more than double the ~755px a lesson
# actually renders, so hand position and lure height survive intact.
# A decompression bomb can be a few kilobytes that claim a 60000x60000
# canvas. 80 megapixels is far beyond any demonstration photograph.
MAX_IMAGE_PIXELS = 80_000_000
IMAGE_MAX_DIM = 1600
JPEG_QUALITY = 82
WEBP_QUALITY = 82


def optimize_lesson_image(blob: bytes, mime: str) -> Tuple[bytes, str]:
    """Bound an inline lesson image, without wrecking what it is.

    Format is PRESERVED rather than flattened to JPEG. A photograph and a
    diagram need different things: re-encoding a transparent PNG of a body
    -position diagram as JPEG would paste it onto white and soften every
    edge and label. So a JPEG stays a JPEG, a PNG stays a PNG with its alpha,
    and a WebP stays a WebP.

    Returns the original untouched when it is already fine, when the result
    would be no smaller, or when the bytes cannot be decoded at all — a
    lesson image that survives import slightly too large is a far better
    outcome than one that fails to import.
    """
    if mime not in IMAGE_EXT_MIME.values():
        return blob, mime            # video and anything else: untouched
    try:
        from PIL import Image
    except Exception:                # pragma: no cover - Pillow is pinned
        return blob, mime
    try:
        # Pillow's own guard against a small file that declares an enormous
        # canvas; without it, .load() would try to allocate all of it.
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        img = Image.open(io.BytesIO(blob))
        img.load()
    except Exception:
        return blob, mime

    oversized = img.width > IMAGE_MAX_DIM or img.height > IMAGE_MAX_DIM
    if not oversized and len(blob) < 350_000:
        return blob, mime            # already a sensible web asset

    try:
        if oversized:
            img.thumbnail((IMAGE_MAX_DIM, IMAGE_MAX_DIM), Image.LANCZOS)
        out = io.BytesIO()
        if mime == "image/png":
            # Keep transparency and the crisp flat colour a diagram needs.
            img.save(out, format="PNG", optimize=True)
        elif mime == "image/webp":
            img.save(out, format="WEBP", quality=WEBP_QUALITY, method=4)
        else:
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True,
                     progressive=True)
        processed = out.getvalue()
    except Exception:
        return blob, mime

    # Shrinking the pixels is the point, so a resized image wins even if the
    # byte count barely moved. An unresized re-encode only wins if smaller.
    if oversized or len(processed) < len(blob):
        return processed, mime
    return blob, mime


# ---------------------------------------------------------------------------
# Re-import: add what is new, never quietly overwrite an author
# ---------------------------------------------------------------------------

# The intended workflow is import -> polish in Program Studio -> maybe import
# an updated package later. If a re-import replaced everything it declares,
# that middle step would be thrown away every time, so MERGE is the default
# and refreshing from source is something you ask for.
#
#   merge   (default) — a node the package has seen before is left exactly as
#                       it is locally; only genuinely NEW modules, lessons and
#                       blocks are added.
#   replace           — declared nodes are refreshed from the package.
#
# NEITHER mode deletes. A lesson or block an author added by hand is never
# removed just because the package does not mention it.
IMPORT_MODES = ("merge", "replace")


def _block_key(block: dict) -> str:
    return ((block or {}).get("config") or {}).get("import_source_key") or ""


def merge_curriculum(existing_modules: List[dict], incoming: List[dict],
                     key_map: Dict[str, str], mode: str = "merge") -> Tuple[List[dict], Dict[str, str]]:
    """Combine a package with what is already stored.

    Identity comes from `source_key`. Modules and lessons cannot carry an
    extra field through the curriculum models, so their keys live in
    `key_map` on the program document; blocks keep theirs in `config`, which
    is a free dict and survives the round trip.

    Returns (modules_to_save, key_map_additions).
    """
    mode = mode if mode in IMPORT_MODES else "merge"
    existing_modules = list(existing_modules or [])
    additions: Dict[str, str] = {}

    by_id = {m.get("id"): m for m in existing_modules if m.get("id")}
    used_module_ids = set()
    out: List[dict] = []

    for inc_m in incoming:
        m_key = (inc_m.get("__source_key") or "").strip()
        local_m = by_id.get(key_map.get(f"module:{m_key}")) if m_key else None
        if local_m is None:
            out.append({k: v for k, v in inc_m.items() if k != "__source_key"})
            continue
        used_module_ids.add(local_m.get("id"))
        merged = dict(local_m) if mode == "merge" else {
            **{k: v for k, v in inc_m.items() if k != "__source_key"},
            "id": local_m.get("id"),
        }
        merged["lessons"] = _merge_lessons(
            local_m.get("lessons") or [], inc_m.get("lessons") or [], key_map, mode)
        out.append(merged)

    # Anything already stored that this package never mentioned stays put.
    for m in existing_modules:
        if m.get("id") not in used_module_ids and m not in out:
            if not any(o.get("id") == m.get("id") for o in out):
                out.append(m)

    for i, m in enumerate(out):
        m["order"] = i
    return out, additions


def _merge_lessons(local_lessons: List[dict], incoming_lessons: List[dict],
                   key_map: Dict[str, str], mode: str) -> List[dict]:
    by_id = {l.get("id"): l for l in local_lessons if l.get("id")}
    used = set()
    out: List[dict] = []
    for inc_l in incoming_lessons:
        l_key = (inc_l.get("__source_key") or "").strip()
        local_l = by_id.get(key_map.get(f"lesson:{l_key}")) if l_key else None
        if local_l is None:
            out.append({k: v for k, v in inc_l.items() if k != "__source_key"})
            continue
        used.add(local_l.get("id"))
        merged = dict(local_l) if mode == "merge" else {
            **{k: v for k, v in inc_l.items() if k != "__source_key"},
            "id": local_l.get("id"),
        }
        merged["content_blocks"] = _merge_blocks(
            local_l.get("content_blocks") or [], inc_l.get("content_blocks") or [], mode)
        out.append(merged)
    for l in local_lessons:
        if l.get("id") not in used and not any(o.get("id") == l.get("id") for o in out):
            out.append(l)
    for i, l in enumerate(out):
        l["order"] = i
    return out


def _merge_blocks(local_blocks: List[dict], incoming_blocks: List[dict],
                  mode: str) -> List[dict]:
    """Blocks carry their own source key, so this needs no map.

    In merge mode a block the package has placed before keeps whatever the
    author did to it — its position, its caption, its picture. Only a block
    the package has never placed here is added, and it is appended rather
    than inserted, because an author who has reordered a lesson should not
    have new material pushed into the middle of it.
    """
    local_by_key = {_block_key(b): b for b in local_blocks if _block_key(b)}
    out = list(local_blocks)
    for inc_b in incoming_blocks:
        key = _block_key(inc_b)
        local_b = local_by_key.get(key) if key else None
        if local_b is None:
            out.append(inc_b)
            continue
        if mode == "replace":
            idx = out.index(local_b)
            out[idx] = {**inc_b, "id": local_b.get("id")}
    for i, b in enumerate(out):
        b["order"] = i
    return out


def media_digest(blob: bytes) -> str:
    """Content identity for a media file, so re-importing the same package
    reuses the resource it already created instead of uploading it again."""
    return hashlib.sha256(blob).hexdigest()


def data_url(blob: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(blob).decode()}"
