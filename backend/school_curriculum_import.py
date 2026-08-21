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

MAX_MEDIA_BYTES = 50 * 1024 * 1024        # matches the School Resource ceiling
MAX_PACKAGE_BYTES = 200 * 1024 * 1024
MAX_ENTRIES = 2000

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
            rejected.append(info.filename)
            continue
        if info.file_size > MAX_MEDIA_BYTES:
            rejected.append(f"{safe} (too large)")
            continue
        total += info.file_size
        if total > MAX_PACKAGE_BYTES:
            raise ImportError_(["Package contents exceed the size limit."])
        files[safe] = zf.read(info)

    if rejected:
        raise ImportError_([f"Unsafe or oversized entry rejected: {r}" for r in rejected[:5]])

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


def media_digest(blob: bytes) -> str:
    """Content identity for a media file, so re-importing the same package
    reuses the resource it already created instead of uploading it again."""
    return hashlib.sha256(blob).hexdigest()


def data_url(blob: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(blob).decode()}"
