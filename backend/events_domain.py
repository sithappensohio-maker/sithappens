"""Public event preregistration — a reusable events domain.

The first event is the Sit Happens Doggy Trunk or Treat + Dog Costume Contest
(Saturday October 24, 2026, free). Anyone can preregister from a permanent,
token-free URL (`/events/<slug>`) without an account; a signed-in client gets
prefilled and can pick which of their dogs are coming, but nobody is ever
created or duplicated in `clients` / `dogs` because they registered. Staff
run the day from an admin dashboard: totals, search, check-in with undo,
walk-ins, costume contestant numbers and CSV exports.

Collections
    events               one document per event (unique slug)
    event_registrations  one document per household registration
    event_counters       per-event atomic sequences (confirmation #, contestant #)

Registered on the canonical API router by `register_events_routes(...)` from
server.py, following the School-module pattern, so server.py only grows by a
few lines.
"""
from __future__ import annotations

import base64
import csv
import io
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

import qrcode

import email_service

# ---------------------------------------------------------------------------
# Limits / vocabulary
# ---------------------------------------------------------------------------
MAX_ADULTS = 20
MAX_CHILDREN = 20
MAX_DOGS = 10
HEARD_FROM = ("client", "facebook", "instagram", "local_business", "friend", "flyer", "other")
HEARD_FROM_LABELS = {
    "client": "Sit Happens client",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "local_business": "Local business",
    "friend": "Friend / family",
    "flyer": "Flyer / QR code",
    "other": "Other",
}
SOURCES = ("online", "walk_in", "admin")
STATUSES = ("registered", "cancelled")

EVENT_PUBLIC_FIELDS = (
    "id", "slug", "name", "name_line_1", "name_line_2", "description", "start_at", "end_at",
    "location_name", "location_address", "admission", "registration_open", "registration_closes_at",
    "walk_ins_allowed", "features", "highlights", "rules", "rules_acknowledgment", "hero_image_url",
)

RULES_ACK = ("I understand that dogs must remain leashed, retractable leashes are not permitted, "
             "owners are responsible for their dogs, and Sit Happens staff may ask a dog to leave the "
             "busy event area if necessary for safety.")

# The first event. Idempotent by slug: seeded once, then edited in the app,
# never overwritten by a restart.
TRUNK_OR_TREAT_2026 = {
    "slug": "trunk-or-treat-2026",
    "name": "Sit Happens Doggy Trunk or Treat + Dog Costume Contest",
    "name_line_1": "Sit Happens Doggy Trunk or Treat",
    "name_line_2": "+ Dog Costume Contest",
    "description": ("Bring the whole family and your leashed dog for an afternoon of treats, costumes and "
                    "trunk-to-trunk fun at Sit Happens Dog Training. Preregistration is free and helps us "
                    "plan treats and parking — walk-ins are welcome too."),
    "start_at": "2026-10-24T14:00:00-04:00",
    "end_at": "2026-10-24T17:00:00-04:00",
    "location_name": "Sit Happens Dog Training",
    "location_address": "",
    "admission": "free",
    "capacity": None,
    "registration_open": True,
    "registration_closes_at": None,
    "published": True,
    "walk_ins_allowed": True,
    "confirmation_prefix": "SH-TOT",
    "notify_on_registration": True,
    "features": {"costume_contest": True, "walk_ins": True},
    "highlights": [
        {"icon": "fa-car-side", "color": "#f26522", "title": "Doggy Trunk or Treat", "body": "Decorated trunks, dog treats at every stop."},
        {"icon": "fa-hat-wizard", "color": "#8cc63f", "title": "Dog Costume Contest", "body": "Enter your dog (or the two of you together)."},
        {"icon": "fa-camera-retro", "color": "#00a9e0", "title": "Photo Booth", "body": "Take home a picture of your costumed pup."},
        {"icon": "fa-bone", "color": "#f26522", "title": "Trick for a Treat", "body": "Show us a sit, a shake or a spin for a snack."},
        {"icon": "fa-trophy", "color": "#8cc63f", "title": "Best Decorated Trunk", "body": "Bragging rights for the best trunk."},
        {"icon": "fa-bag-shopping", "color": "#00a9e0", "title": "Shop specials & fun", "body": "Event-day deals and games in the shop."},
    ],
    "rules": [
        "Preregistration is encouraged. Walk-ins are welcome.",
        "Leashed dogs only.",
        "No retractable leashes.",
        "Owners are responsible for their dogs at all times.",
    ],
    "rules_acknowledgment": RULES_ACK,
    "hero_image_url": "",
    # Photo booth — the flyer's price list. Sold through the real register
    # (one hidden catalog product per package); nothing is printed on the spot.
    "photos_enabled": True,
    "photos_title": "Halloween Pet Photos",
    "photo_packages": [
        {"key": "digital-1", "name": "1 Edited Digital", "price": 15.0, "digitals": 1, "print": "", "popular": False},
        {"key": "digital-3", "name": "3 Edited Digitals", "price": 30.0, "digitals": 3, "print": "", "popular": True},
        {"key": "digital-5", "name": "5 Edited Digitals", "price": 40.0, "digitals": 5, "print": "", "popular": False},
        {"key": "print-5x7", "name": "5×7 Framed Print", "price": 25.0, "digitals": 0, "print": "5×7", "popular": False},
        {"key": "print-8x10", "name": "8×10 Framed Print", "price": 35.0, "digitals": 0, "print": "8×10", "popular": False},
        {"key": "bundle-3-5x7", "name": "3 Digitals + 5×7 Framed Print", "price": 45.0, "digitals": 3, "print": "5×7", "popular": False},
        {"key": "bundle-5-8x10", "name": "5 Digitals + 8×10 Framed Print", "price": 60.0, "digitals": 5, "print": "8×10", "popular": False},
    ],
}
PHOTO_ORDER_STATUSES = ("ordered", "paid", "ready", "sent")
PRINT_STATUSES = ("none", "pending", "ready", "picked_up", "mailed")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def _clean(value: Optional[str], limit: int) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()[:limit]


def _search_re(term: str) -> Dict[str, str]:
    return {"$regex": re.escape(term), "$options": "i"}


def _pad_contestant(n: Optional[int]) -> str:
    return f"{int(n):03d}" if n else ""


BANNER_ALLOWED_MIME = ("image/jpeg", "image/png", "image/webp")
MAX_BANNER_BYTES = 5 * 1024 * 1024
# Uploadable pictures on an event: the homepage banner background and the
# flyer shown on the event page. Each is stored in `event_media` and
# referenced from the event as `<kind>_image_id`.
IMAGE_KINDS = ("banner", "flyer")


def _public_event(ev: dict) -> dict:
    out = {k: ev.get(k) for k in EVENT_PUBLIC_FIELDS}
    # The homepage banner background, if one was uploaded: the page builds
    # `<api>/public/events/<slug>/banner?v=<version>` from this (no file
    # extension on purpose — production nginx serves image-looking paths
    # statically). The version changes with every upload so caches refresh.
    for kind in IMAGE_KINDS:
        out[f"{kind}_image_version"] = _image_version(ev, kind)
    return out


def _image_version(ev: dict, kind: str) -> Optional[str]:
    return (ev.get(f"{kind}_image_id") or "")[:8] or None


class BannerImageIn(BaseModel):
    """`data` is a base64 data-URL (`data:image/jpeg;base64,...`), same
    convention as Shop media uploads."""
    data: str = Field(min_length=10)
    filename: str = Field(default="banner", max_length=140)


def _registration_closed(ev: dict) -> bool:
    if not ev.get("registration_open", True):
        return True
    closes = ev.get("registration_closes_at")
    if closes:
        try:
            return datetime.fromisoformat(str(closes).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except ValueError:
            return False
    return False


def _receipt(reg: dict, *, duplicate: bool = False, email_sent: bool = False) -> dict:
    """What the person who registered gets back: their own registration only."""
    return {
        "id": reg["id"],
        "confirmation_number": reg["confirmation_number"],
        "primary_contact": reg["primary_contact"],
        "email": reg["email"],
        "adults": reg["adults"],
        "children": reg["children"],
        "dogs": [
            {"name": d["name"], "costume_entered": bool(d.get("costume_entered")),
             "costume_theme": d.get("costume_theme") or "", "dog_and_human": bool(d.get("dog_and_human")),
             "contestant_number": d.get("contestant_number")}
            for d in reg.get("dogs") or []
        ],
        "costume_contest": bool(reg.get("costume_contest")),
        "checked_in": bool(reg.get("checked_in")),
        "duplicate": duplicate,
        "email_sent": email_sent,
    }


# ---------------------------------------------------------------------------
# Pydantic input models
# ---------------------------------------------------------------------------
class EventDogIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    dog_id: Optional[str] = Field(default=None, max_length=80)
    costume_entered: bool = False
    costume_theme: str = Field(default="", max_length=120)
    dog_and_human: bool = False
    costume_notes: str = Field(default="", max_length=300)


class EventRegistrationIn(BaseModel):
    primary_contact: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=7, max_length=40)
    adults: int = Field(ge=1, le=MAX_ADULTS)
    children: int = Field(default=0, ge=0, le=MAX_CHILDREN)
    dogs: List[EventDogIn] = Field(default_factory=list, max_length=MAX_DOGS)
    costume_contest: bool = False
    heard_from: Literal["client", "facebook", "instagram", "local_business", "friend", "flyer", "other"]
    heard_from_other: str = Field(default="", max_length=120)
    rules_acknowledged: bool
    marketing_consent: bool = False
    idempotency_key: Optional[str] = Field(default=None, max_length=80)
    website: str = Field(default="", max_length=200)  # honeypot — humans never see it


class WalkInIn(BaseModel):
    primary_contact: str = Field(min_length=2, max_length=120)
    email: Optional[str] = Field(default="", max_length=160)
    phone: Optional[str] = Field(default="", max_length=40)
    adults: int = Field(default=1, ge=1, le=MAX_ADULTS)
    children: int = Field(default=0, ge=0, le=MAX_CHILDREN)
    dogs: List[EventDogIn] = Field(default_factory=list, max_length=MAX_DOGS)
    costume_contest: bool = False
    notes: str = Field(default="", max_length=300)
    check_in: bool = True  # a walk-in is standing in front of you


class RegistrationPatchIn(BaseModel):
    status: Optional[Literal["registered", "cancelled"]] = None
    admin_notes: Optional[str] = Field(default=None, max_length=500)


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")
PREFIX_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,11}$")


def _parse_when(value: Optional[str], field: str) -> Optional[str]:
    """Accept any ISO-8601 datetime; store it normalized and timezone-aware."""
    if value in (None, ""):
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field}: enter a valid date and time.")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:80] or "event"


class EventHighlightIn(BaseModel):
    icon: str = Field(default="fa-paw", max_length=40)
    color: str = Field(default="#8cc63f", max_length=20)
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(default="", max_length=200)


class PhotoPackageIn(BaseModel):
    key: Optional[str] = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(ge=0, le=10000)
    digitals: int = Field(default=0, ge=0, le=50)
    print: str = Field(default="", max_length=20)
    popular: bool = False


class PhotoOrderIn(BaseModel):
    registration_id: Optional[str] = Field(default=None, max_length=80)
    client_id: Optional[str] = Field(default=None, max_length=80)
    primary_contact: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(default="", max_length=40)
    dogs: List[str] = Field(default_factory=list, max_length=10)
    contestant_numbers: List[int] = Field(default_factory=list, max_length=10)
    shot_ref: str = Field(default="", max_length=120)
    package_key: str = Field(min_length=1, max_length=40)
    qty: int = Field(default=1, ge=1, le=10)
    notes: str = Field(default="", max_length=500)


class PhotoOrderPatchIn(BaseModel):
    primary_contact: Optional[str] = Field(default=None, min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    dogs: Optional[List[str]] = Field(default=None, max_length=10)
    shot_ref: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)
    status: Optional[Literal["paid", "ready"]] = None  # ready ⇄ paid only; "sent" comes from /send, "paid" from /checkout
    print_status: Optional[Literal["none", "pending", "ready", "picked_up", "mailed"]] = None
    delivery_link: Optional[str] = Field(default=None, max_length=2000)


class PhotoTenderIn(BaseModel):
    method: Literal["cash", "card", "check", "venmo", "paypal", "other"]
    amount: float = Field(gt=0)
    tendered_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class PhotoCheckoutIn(BaseModel):
    tenders: List[PhotoTenderIn] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    workstation_id: Optional[str] = Field(default=None, max_length=100)


class PhotoSendIn(BaseModel):
    delivery_link: str = Field(min_length=8, max_length=2000)
    message: str = Field(default="", max_length=500)


class EventIn(BaseModel):
    """Everything about an event the owner can edit. Used to create and to
    fully update; the seed uses the same shape."""
    name: str = Field(min_length=2, max_length=160)
    slug: Optional[str] = Field(default=None, max_length=80)
    name_line_1: str = Field(default="", max_length=120)
    name_line_2: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    start_at: str = Field(min_length=4, max_length=40)
    end_at: Optional[str] = Field(default=None, max_length=40)
    location_name: str = Field(default="", max_length=160)
    location_address: str = Field(default="", max_length=300)
    admission: str = Field(default="free", max_length=40)
    capacity: Optional[int] = Field(default=None, ge=0, le=100000)
    registration_open: bool = True
    registration_closes_at: Optional[str] = Field(default=None, max_length=40)
    published: bool = False
    walk_ins_allowed: bool = True
    confirmation_prefix: str = Field(default="SH-EV", max_length=12)
    notify_on_registration: bool = True  # email the operator on every online preregistration
    costume_contest: bool = True
    highlights: List[EventHighlightIn] = Field(default_factory=list, max_length=12)
    rules: List[str] = Field(default_factory=list, max_length=12)
    rules_acknowledgment: str = Field(default=RULES_ACK, max_length=600)
    hero_image_url: str = Field(default="", max_length=2000)
    photos_enabled: bool = True
    photos_title: str = Field(default="", max_length=80)
    photo_packages: List[PhotoPackageIn] = Field(default_factory=list, max_length=20)


def _package_docs(body: EventIn, existing: Optional[dict]) -> List[dict]:
    """Photo packages from the editor; the hidden catalog product each one
    already sells through survives an edit (matched by key)."""
    old = {pk.get("key"): pk for pk in ((existing or {}).get("photo_packages") or [])}
    seen: set = set()
    out = []
    for pk in body.photo_packages:
        key = (pk.key or slugify(pk.name)).strip().lower()[:40] or slugify(pk.name)
        if key in seen:
            raise HTTPException(status_code=422, detail=f"Two photo packages share the key '{key}'.")
        seen.add(key)
        out.append({"key": key, "name": _clean(pk.name, 80), "price": round(float(pk.price), 2), "digitals": int(pk.digitals),
                    "print": _clean(pk.print, 20), "popular": bool(pk.popular), "product_id": (old.get(key) or {}).get("product_id")})
    return out


def _event_doc_from_in(body: EventIn, existing: Optional[dict] = None) -> dict:
    slug = (body.slug or "").strip().lower() or slugify(body.name)
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=422, detail="Link name can only use lowercase letters, numbers and dashes.")
    prefix = (body.confirmation_prefix or "").strip().upper() or "SH-EV"
    if not PREFIX_RE.match(prefix):
        raise HTTPException(status_code=422, detail="Confirmation prefix: 2 to 12 capital letters, numbers or dashes.")
    start = _parse_when(body.start_at, "Start")
    end = _parse_when(body.end_at, "End")
    if end and start and end < start:
        raise HTTPException(status_code=422, detail="The event cannot end before it starts.")
    rules = [_clean(r, 200) for r in body.rules]
    return {
        "slug": slug,
        "name": _clean(body.name, 160),
        "name_line_1": _clean(body.name_line_1, 120),
        "name_line_2": _clean(body.name_line_2, 120),
        "description": (body.description or "").strip()[:2000],
        "start_at": start, "end_at": end,
        "location_name": _clean(body.location_name, 160),
        "location_address": _clean(body.location_address, 300),
        "admission": _clean(body.admission, 40) or "free",
        "capacity": body.capacity or None,
        "registration_open": bool(body.registration_open),
        "registration_closes_at": _parse_when(body.registration_closes_at, "Preregistration closes"),
        "published": bool(body.published),
        "walk_ins_allowed": bool(body.walk_ins_allowed),
        "confirmation_prefix": prefix,
        "notify_on_registration": bool(body.notify_on_registration),
        "features": {"costume_contest": bool(body.costume_contest), "walk_ins": bool(body.walk_ins_allowed)},
        "highlights": [{"icon": _clean(h.icon, 40) or "fa-paw", "color": _clean(h.color, 20) or "#8cc63f",
                        "title": _clean(h.title, 80), "body": _clean(h.body, 200)} for h in body.highlights if _clean(h.title, 80)],
        "rules": [r for r in rules if r],
        "rules_acknowledgment": (body.rules_acknowledgment or "").strip()[:600] or RULES_ACK,
        "hero_image_url": (body.hero_image_url or "").strip()[:2000],
        "photos_enabled": bool(body.photos_enabled),
        "photos_title": _clean(body.photos_title, 80),
        "photo_packages": _package_docs(body, existing),
    }


class EventPatchIn(BaseModel):
    registration_open: Optional[bool] = None
    published: Optional[bool] = None
    walk_ins_allowed: Optional[bool] = None
    capacity: Optional[int] = Field(default=None, ge=0, le=100000)
    hero_image_url: Optional[str] = Field(default=None, max_length=2000)
    description: Optional[str] = Field(default=None, max_length=2000)
    location_address: Optional[str] = Field(default=None, max_length=300)


# ---------------------------------------------------------------------------
# Startup: indexes + seed
# ---------------------------------------------------------------------------
async def ensure_events_indexes(db) -> None:
    await db.events.create_index([("slug", 1)], unique=True, name="events_slug_unique")
    await db.event_registrations.create_index([("event_id", 1), ("confirmation_number", 1)], unique=True,
                                              name="event_reg_confirmation_unique")
    await db.event_registrations.create_index(
        [("event_id", 1), ("idempotency_key", 1)], unique=True, name="event_reg_idempotency_unique",
        partialFilterExpression={"idempotency_key": {"$type": "string"}})
    await db.event_registrations.create_index([("event_id", 1), ("email", 1)], name="event_reg_email")
    await db.event_registrations.create_index([("event_id", 1), ("created_at", -1)], name="event_reg_created")


async def seed_default_events(db) -> None:
    """Insert the first event if its slug is missing. Never overwrites edits."""
    if await db.events.find_one({"slug": TRUNK_OR_TREAT_2026["slug"]}, {"_id": 1}):
        return
    now = _now_iso()
    await db.events.insert_one({"id": str(uuid.uuid4()), **TRUNK_OR_TREAT_2026, "created_at": now, "updated_at": now})


# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
async def _next_seq(db, event_id: str, kind: str) -> int:
    row = await db.event_counters.find_one_and_update(
        {"_id": f"{event_id}:{kind}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return int(row["seq"])


async def _new_confirmation_number(db, ev: dict) -> str:
    seq = await _next_seq(db, ev["id"], "confirmation")
    return f"{ev.get('confirmation_prefix') or 'SH-EV'}-{seq:04d}"


async def _assign_contestant_numbers(db, ev: dict, dogs: List[dict], costume_contest: bool) -> List[dict]:
    """One contestant number per competing dog, never reused within an event."""
    out = []
    for d in dogs:
        d = dict(d)
        if costume_contest and d.get("costume_entered") and not d.get("contestant_number"):
            d["contestant_number"] = await _next_seq(db, ev["id"], "contestant")
        elif not (costume_contest and d.get("costume_entered")):
            d["costume_entered"] = False
            d["contestant_number"] = None
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------
async def _summary(db, event_id: str) -> dict:
    pipeline = [
        {"$match": {"event_id": event_id, "status": "registered"}},
        {"$project": {
            "adults": 1, "children": 1, "checked_in": 1, "source": 1,
            "dog_count": {"$size": {"$ifNull": ["$dogs", []]}},
            "costume_entries": {"$size": {"$filter": {"input": {"$ifNull": ["$dogs", []]}, "as": "d",
                                                      "cond": {"$eq": ["$$d.costume_entered", True]}}}},
        }},
        {"$group": {
            "_id": None, "households": {"$sum": 1}, "adults": {"$sum": "$adults"}, "children": {"$sum": "$children"},
            "dogs": {"$sum": "$dog_count"}, "costume_entries": {"$sum": "$costume_entries"},
            "checked_in": {"$sum": {"$cond": [{"$eq": ["$checked_in", True]}, 1, 0]}},
            "walk_ins": {"$sum": {"$cond": [{"$eq": ["$source", "walk_in"]}, 1, 0]}},
        }},
    ]
    rows = await db.event_registrations.aggregate(pipeline).to_list(1)
    r = rows[0] if rows else {}
    adults, children = int(r.get("adults") or 0), int(r.get("children") or 0)
    return {
        "households": int(r.get("households") or 0),
        "adults": adults, "children": children, "people": adults + children,
        "dogs": int(r.get("dogs") or 0),
        "costume_entries": int(r.get("costume_entries") or 0),
        "checked_in": int(r.get("checked_in") or 0),
        "walk_ins": int(r.get("walk_ins") or 0),
    }


def _row(reg: dict) -> dict:
    """Admin-facing row (full detail; never returned publicly)."""
    reg = {k: v for k, v in reg.items() if k != "_id"}
    reg["dog_count"] = len(reg.get("dogs") or [])
    reg["dog_names"] = ", ".join(d.get("name", "") for d in reg.get("dogs") or [])
    reg["people"] = int(reg.get("adults") or 0) + int(reg.get("children") or 0)
    reg["costume_entries"] = sum(1 for d in reg.get("dogs") or [] if d.get("costume_entered"))
    reg["heard_from_label"] = HEARD_FROM_LABELS.get(reg.get("heard_from") or "", reg.get("heard_from") or "")
    return reg


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def register_events_routes(*, api, db, get_current_user, require_admin_and_permission,
                           enforce_rate_limit, client_ip, logger,
                           create_pos_sale=None, price_pos_cart=None, require_take_payments=None,
                           pos_sale_model=None, pos_line_model=None, pos_tender_model=None) -> None:
    manage = require_admin_and_permission("manage_events")
    edit = require_admin_and_permission("edit_events")

    async def _optional_user(request: Request) -> Optional[dict]:
        """A signed-in client is a convenience, never a requirement: a bad or
        missing token simply means 'guest'."""
        if not (request.headers.get("Authorization") or "").lower().startswith("bearer "):
            return None
        try:
            return await get_current_user(request, None)
        except HTTPException:
            return None
        except Exception as exc:  # pragma: no cover — never block a registration on auth plumbing
            logger.warning("events: optional auth failed: %s", exc)
            return None

    async def _event_by_slug(slug: str, *, published_only: bool) -> dict:
        q: Dict[str, Any] = {"slug": slug}
        if published_only:
            q["published"] = True
        ev = await db.events.find_one(q, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        return ev

    async def _event_by_id(event_id: str) -> dict:
        ev = await db.events.find_one({"id": event_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        return ev

    async def _reg(event_id: str, rid: str) -> dict:
        reg = await db.event_registrations.find_one({"event_id": event_id, "id": rid}, {"_id": 0})
        if not reg:
            raise HTTPException(status_code=404, detail="Registration not found")
        return reg

    # ----- public ----------------------------------------------------------
    @api.get("/public/events")
    async def public_events():
        """Published events that haven't ended yet, soonest first — what the
        website's nav, homepage banner and the client portal card show. Same
        public fields as the event page; nothing about attendees."""
        now = datetime.now(timezone.utc)
        out = []
        async for ev in db.events.find({"published": True}, {"_id": 0}).sort("start_at", 1):
            end_raw = ev.get("end_at") or ev.get("start_at")
            try:
                end = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00"))
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                end = None
            if end and end < now:
                continue
            item = _public_event(ev)
            item["registration_closed"] = _registration_closed(ev)
            out.append(item)
        return {"events": out}

    async def _public_image(slug: str, kind: str) -> Response:
        """An uploaded event picture as a real image response (public,
        cacheable; the `?v=` the page appends busts caches on re-upload).
        No file extension on these paths: production nginx serves
        image-looking paths statically before the API proxy sees them."""
        if kind not in IMAGE_KINDS:
            raise HTTPException(status_code=404, detail="No such image")
        ev = await _event_by_slug(slug, published_only=True)
        mid = ev.get(f"{kind}_image_id")
        m = await db.event_media.find_one({"id": mid, "event_id": ev["id"]}, {"_id": 0, "mime": 1, "b64": 1}) if mid else None
        if not m:
            raise HTTPException(status_code=404, detail=f"No {kind} image")
        try:
            data = base64.b64decode(m["b64"])
        except Exception:
            raise HTTPException(status_code=404, detail=f"No {kind} image")
        return Response(content=data, media_type=m["mime"], headers={"Cache-Control": "public, max-age=3600"})

    @api.get("/public/events/{slug}/images/{kind}")
    async def public_event_image(slug: str, kind: str):
        return await _public_image(slug, kind)

    @api.get("/public/events/{slug}/banner")
    async def public_event_banner(slug: str):
        """Older alias of /images/banner."""
        return await _public_image(slug, "banner")

    @api.get("/public/events/{slug}")
    async def public_event(slug: str):
        """The event page's data. Nothing about who registered is exposed."""
        ev = await _event_by_slug(slug, published_only=True)
        out = _public_event(ev)
        out["registration_closed"] = _registration_closed(ev)
        return {"event": out, "limits": {"adults": MAX_ADULTS, "children": MAX_CHILDREN, "dogs": MAX_DOGS},
                "heard_from": [{"key": k, "label": HEARD_FROM_LABELS[k]} for k in HEARD_FROM]}

    @api.post("/public/events/{slug}/register")
    async def public_event_register(slug: str, body: EventRegistrationIn, request: Request):
        """Preregister — no account needed. Rate-limited and honeypotted like
        the other public writes; duplicate-safe by idempotency key and by
        (event, email); attaches a signed-in client's id without ever creating
        or changing a client or dog record."""
        ev = await _event_by_slug(slug, published_only=True)
        email = str(body.email).strip().lower()
        ip = client_ip(request)
        await enforce_rate_limit(request, "event_register_ip", ip, limit=10, window_seconds=3600)
        await enforce_rate_limit(request, "event_register_email_ip", f"{ip}|{email}", limit=5, window_seconds=3600)

        if (body.website or "").strip():
            logger.info("events: honeypot tripped from %s — dropped", ip)
            return {"ok": True, "registration": None}

        if not body.rules_acknowledged:
            raise HTTPException(status_code=422, detail="Please acknowledge the event rules to preregister.")
        if _registration_closed(ev):
            raise HTTPException(status_code=409, detail="Preregistration for this event has closed.")
        if len(_digits(body.phone)) < 7:
            raise HTTPException(status_code=422, detail="Please enter a phone number we can reach you at.")

        # Same browser retried the same submission → the same registration.
        if body.idempotency_key:
            existing = await db.event_registrations.find_one(
                {"event_id": ev["id"], "idempotency_key": body.idempotency_key}, {"_id": 0})
            if existing:
                return {"ok": True, "registration": _receipt(existing, duplicate=True)}
        # Same household registering twice online → tell them they're already in.
        existing = await db.event_registrations.find_one(
            {"event_id": ev["id"], "email": email, "status": "registered", "source": "online"}, {"_id": 0})
        if existing:
            return {"ok": True, "registration": _receipt(existing, duplicate=True)}

        if ev.get("capacity"):
            count = await db.event_registrations.count_documents({"event_id": ev["id"], "status": "registered"})
            if count >= int(ev["capacity"]):
                raise HTTPException(status_code=409, detail="This event is full.")

        # Signed-in client? Link the registration and keep only dog ids that are really theirs.
        user = await _optional_user(request)
        client_id = user.get("client_id") if user and user.get("role") == "client" else None
        own_dog_ids: set = set()
        if client_id:
            own_dog_ids = {d["id"] async for d in db.dogs.find({"owner_id": client_id, "deleted_at": {"$exists": False}}, {"_id": 0, "id": 1})}

        contest_on = bool((ev.get("features") or {}).get("costume_contest", True))
        costume_contest = bool(body.costume_contest and contest_on)
        dogs = []
        for d in body.dogs:
            dogs.append({
                "name": _clean(d.name, 60),
                "dog_id": d.dog_id if (d.dog_id and d.dog_id in own_dog_ids) else None,
                "costume_entered": bool(costume_contest and d.costume_entered),
                "costume_theme": _clean(d.costume_theme, 120),
                "dog_and_human": bool(d.dog_and_human),
                "costume_notes": _clean(d.costume_notes, 300),
                "contestant_number": None,
            })
        dogs = [d for d in dogs if d["name"]]
        if costume_contest and not any(d["costume_entered"] for d in dogs):
            costume_contest = False
        dogs = await _assign_contestant_numbers(db, ev, dogs, costume_contest)

        now = _now_iso()
        reg = {
            "id": str(uuid.uuid4()),
            "event_id": ev["id"],
            "confirmation_number": await _new_confirmation_number(db, ev),
            "client_id": client_id,
            "primary_contact": _clean(body.primary_contact, 120),
            "email": email,
            "phone": _clean(body.phone, 40),
            "phone_digits": _digits(body.phone),
            "adults": int(body.adults),
            "children": int(body.children),
            "dogs": dogs,
            "costume_contest": costume_contest,
            "heard_from": body.heard_from,
            "heard_from_other": _clean(body.heard_from_other, 120) if body.heard_from == "other" else "",
            "source": "online",
            "rules_acknowledged": True,
            "marketing_consent": bool(body.marketing_consent),  # only ever what they ticked
            "status": "registered",
            "checked_in": False, "checked_in_at": None, "checked_in_by": None,
            "idempotency_key": body.idempotency_key or None,
            "created_at": now, "updated_at": now,
        }
        try:
            await db.event_registrations.insert_one(dict(reg))
        except Exception as exc:
            # A concurrent double-tap raced past the lookups above: the unique
            # idempotency index caught it, so hand back the one that won.
            if body.idempotency_key:
                existing = await db.event_registrations.find_one(
                    {"event_id": ev["id"], "idempotency_key": body.idempotency_key}, {"_id": 0})
                if existing:
                    return {"ok": True, "registration": _receipt(existing, duplicate=True)}
            logger.error("events: registration insert failed: %s", exc)
            raise HTTPException(status_code=500, detail="Couldn't save your registration. Please try again.")

        email_sent = False
        try:
            email_sent = await email_service.send_event_registration_confirmed(to_email=email, event=ev, registration=reg)
        except Exception as exc:  # the registration stands whether or not the email goes out
            logger.warning("events: confirmation email failed for %s: %s", reg["confirmation_number"], exc)
        # Operator alert (durable: outbox retry). Off per event if the owner
        # prefers. Duplicates never reach here, so one household = one email.
        if ev.get("notify_on_registration", True):
            try:
                total = await db.event_registrations.count_documents({"event_id": ev["id"], "status": "registered"})
                await email_service.notify_admin_event_registration(ev, reg, total)
            except Exception as exc:
                logger.warning("events: operator alert failed for %s: %s", reg["confirmation_number"], exc)
        return {"ok": True, "registration": _receipt(reg, email_sent=bool(email_sent))}

    @api.get("/portal/events/prefill")
    async def portal_event_prefill(user: dict = Depends(get_current_user)):
        """What a signed-in client already told us, so the form can prefill.
        Client accounts only; nothing is written."""
        if user.get("role") != "client":
            raise HTTPException(status_code=403, detail="Client account required")
        cid = user.get("client_id")
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1, "email": 1, "phone": 1}) if cid else None
        dogs = []
        if cid:
            async for d in db.dogs.find({"owner_id": cid, "deleted_at": {"$exists": False}}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1):
                dogs.append({"id": d["id"], "name": d.get("name") or "Dog"})
        return {
            "client_id": cid,
            "name": (client or {}).get("name") or user.get("name") or "",
            "email": (client or {}).get("email") or user.get("email") or "",
            "phone": (client or {}).get("phone") or "",
            "dogs": dogs,
        }

    # ----- admin / staff ---------------------------------------------------
    @api.get("/admin/events")
    async def admin_list_events(user: dict = Depends(manage)):
        events = await db.events.find({}, {"_id": 0}).sort("start_at", -1).to_list(200)
        out = []
        for ev in events:
            out.append({**ev, "summary": await _summary(db, ev["id"]), "registration_closed": _registration_closed(ev)})
        return {"events": out}

    @api.get("/admin/events/{event_id}")
    async def admin_get_event(event_id: str, user: dict = Depends(manage)):
        return await _event_admin_view(event_id)

    async def _event_admin_view(event_id: str) -> dict:
        ev = await _event_by_id(event_id)
        regs = await db.event_registrations.count_documents({"event_id": event_id})
        return {"event": {**ev, "registration_closed": _registration_closed(ev), "registration_count": regs,
                          **{f"{k}_image_version": _image_version(ev, k) for k in IMAGE_KINDS}},
                "summary": await _summary(db, event_id)}

    @api.post("/admin/events")
    async def admin_create_event(body: EventIn, user: dict = Depends(edit)):
        doc = _event_doc_from_in(body)
        if await db.events.find_one({"slug": doc["slug"]}, {"_id": 1}):
            raise HTTPException(status_code=409, detail="That link name is already used by another event.")
        now = _now_iso()
        doc.update({"id": str(uuid.uuid4()), "created_at": now, "updated_at": now,
                    "created_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}})
        await db.events.insert_one(dict(doc))
        return await _event_admin_view(doc["id"])

    @api.put("/admin/events/{event_id}")
    async def admin_update_event(event_id: str, body: EventIn, user: dict = Depends(edit)):
        """Full edit. Changing the link name is allowed but the old QR code
        would stop working, so the editor warns; everything else is free."""
        existing = await _event_by_id(event_id)
        doc = _event_doc_from_in(body, existing)
        clash = await db.events.find_one({"slug": doc["slug"], "id": {"$ne": event_id}}, {"_id": 1})
        if clash:
            raise HTTPException(status_code=409, detail="That link name is already used by another event.")
        doc["updated_at"] = _now_iso()
        await db.events.update_one({"id": event_id}, {"$set": doc})
        return await _event_admin_view(event_id)

    @api.delete("/admin/events/{event_id}")
    async def admin_delete_event(event_id: str, user: dict = Depends(edit)):
        """Only an event nobody has registered for can be deleted; otherwise
        unpublish it so the history (and the CSV) stays."""
        await _event_by_id(event_id)
        if await db.event_registrations.count_documents({"event_id": event_id}):
            raise HTTPException(status_code=409, detail="This event has registrations. Unpublish it instead of deleting it.")
        await db.events.delete_one({"id": event_id})
        await db.event_media.delete_many({"event_id": event_id})
        await db.event_counters.delete_many({"_id": {"$regex": "^" + re.escape(event_id) + ":"}})
        return {"ok": True}

    @api.patch("/admin/events/{event_id}")
    async def admin_patch_event(event_id: str, body: EventPatchIn, user: dict = Depends(manage)):
        await _event_by_id(event_id)
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        if "capacity" in patch and patch["capacity"] == 0:
            patch["capacity"] = None
        patch["updated_at"] = _now_iso()
        await db.events.update_one({"id": event_id}, {"$set": patch})
        ev = await _event_by_id(event_id)
        return {"event": {**ev, "registration_closed": _registration_closed(ev)}, "summary": await _summary(db, event_id)}

    @api.get("/admin/events/{event_id}/registrations")
    async def admin_list_registrations(event_id: str, q: str = Query(default=""),
                                       status: str = Query(default="all"),
                                       user: dict = Depends(manage)):
        await _event_by_id(event_id)
        query: Dict[str, Any] = {"event_id": event_id}
        if status in STATUSES:
            query["status"] = status
        term = (q or "").strip()[:80]
        if term:
            ors = [{"primary_contact": _search_re(term)}, {"email": _search_re(term)},
                   {"confirmation_number": _search_re(term)}, {"dogs.name": _search_re(term)}]
            digits = _digits(term)
            if len(digits) >= 3:
                ors.append({"phone_digits": _search_re(digits)})
                ors.append({"confirmation_number": _search_re(digits)})
            query["$or"] = ors
        rows = await db.event_registrations.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return {"registrations": [_row(r) for r in rows], "count": len(rows)}

    @api.get("/admin/events/{event_id}/registrations/{rid}")
    async def admin_get_registration(event_id: str, rid: str, user: dict = Depends(manage)):
        return {"registration": _row(await _reg(event_id, rid))}

    @api.patch("/admin/events/{event_id}/registrations/{rid}")
    async def admin_patch_registration(event_id: str, rid: str, body: RegistrationPatchIn, user: dict = Depends(manage)):
        await _reg(event_id, rid)
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        patch["updated_at"] = _now_iso()
        await db.event_registrations.update_one({"event_id": event_id, "id": rid}, {"$set": patch})
        return {"registration": _row(await _reg(event_id, rid))}

    @api.post("/admin/events/{event_id}/registrations/{rid}/check-in")
    async def admin_check_in(event_id: str, rid: str, user: dict = Depends(manage)):
        reg = await _reg(event_id, rid)
        if reg.get("status") != "registered":
            raise HTTPException(status_code=409, detail="This registration is cancelled.")
        if not reg.get("checked_in"):
            await db.event_registrations.update_one({"event_id": event_id, "id": rid}, {"$set": {
                "checked_in": True, "checked_in_at": _now_iso(),
                "checked_in_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""},
                "updated_at": _now_iso()}})
        return {"registration": _row(await _reg(event_id, rid)), "summary": await _summary(db, event_id)}

    @api.post("/admin/events/{event_id}/registrations/{rid}/undo-check-in")
    async def admin_undo_check_in(event_id: str, rid: str, user: dict = Depends(manage)):
        await _reg(event_id, rid)
        await db.event_registrations.update_one({"event_id": event_id, "id": rid}, {"$set": {
            "checked_in": False, "checked_in_at": None, "checked_in_by": None, "updated_at": _now_iso()}})
        return {"registration": _row(await _reg(event_id, rid)), "summary": await _summary(db, event_id)}

    @api.post("/admin/events/{event_id}/walk-in")
    async def admin_walk_in(event_id: str, body: WalkInIn, user: dict = Depends(manage)):
        """Someone at the door who never preregistered. Counts immediately; a
        staff member may add a second registration for the same person on
        purpose, so there is no dedupe here."""
        ev = await _event_by_id(event_id)
        if not ev.get("walk_ins_allowed", True):
            raise HTTPException(status_code=409, detail="Walk-ins are not allowed for this event.")
        email = (body.email or "").strip().lower()
        phone = _clean(body.phone, 40)
        if not email and len(_digits(phone)) < 7:
            raise HTTPException(status_code=422, detail="A phone number or email is required.")
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=422, detail="That email doesn't look right.")
        contest_on = bool((ev.get("features") or {}).get("costume_contest", True))
        costume_contest = bool(body.costume_contest and contest_on)
        dogs = [{
            "name": _clean(d.name, 60), "dog_id": None,
            "costume_entered": bool(costume_contest and (d.costume_entered or len(body.dogs) == 1)),
            "costume_theme": _clean(d.costume_theme, 120), "dog_and_human": bool(d.dog_and_human),
            "costume_notes": _clean(d.costume_notes, 300), "contestant_number": None,
        } for d in body.dogs if _clean(d.name, 60)]
        if costume_contest and not any(d["costume_entered"] for d in dogs):
            costume_contest = False
        dogs = await _assign_contestant_numbers(db, ev, dogs, costume_contest)
        now = _now_iso()
        by = {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}
        reg = {
            "id": str(uuid.uuid4()), "event_id": ev["id"],
            "confirmation_number": await _new_confirmation_number(db, ev),
            "client_id": None,
            "primary_contact": _clean(body.primary_contact, 120),
            "email": email, "phone": phone, "phone_digits": _digits(phone),
            "adults": int(body.adults), "children": int(body.children),
            "dogs": dogs, "costume_contest": costume_contest,
            "heard_from": "", "heard_from_other": "",
            "source": "walk_in", "rules_acknowledged": True, "marketing_consent": False,
            "status": "registered",
            "checked_in": bool(body.check_in), "checked_in_at": now if body.check_in else None,
            "checked_in_by": by if body.check_in else None,
            "admin_notes": _clean(body.notes, 300),
            "created_by": by, "idempotency_key": None,
            "created_at": now, "updated_at": now,
        }
        await db.event_registrations.insert_one(dict(reg))
        return {"registration": _row(reg), "summary": await _summary(db, event_id)}

    async def _store_image(event_id: str, kind: str, body: "BannerImageIn", user: dict) -> dict:
        """Save an uploaded picture (JPEG/PNG/WEBP, 5 MB ceiling measured from
        the real base64 length) and point the event at it, dropping the
        previous one."""
        if kind not in IMAGE_KINDS:
            raise HTTPException(status_code=404, detail="No such image")
        ev = await _event_by_id(event_id)
        raw = body.data
        if not raw.startswith("data:"):
            raise HTTPException(status_code=400, detail="Expected a base64 image data URL.")
        try:
            header, b64 = raw.split(",", 1)
            mime = header.split(";")[0].replace("data:", "").lower().strip()
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed image upload.")
        if mime not in BANNER_ALLOWED_MIME:
            raise HTTPException(status_code=400, detail="Use a JPEG, PNG or WEBP picture.")
        approx = (len(b64) * 3) // 4
        if approx > MAX_BANNER_BYTES:
            raise HTTPException(status_code=400, detail=f"That picture is {approx // (1024 * 1024)} MB. Max is 5 MB.")
        media_id = str(uuid.uuid4())
        await db.event_media.insert_one({"id": media_id, "event_id": event_id, "kind": kind, "mime": mime, "b64": b64,
                                         "filename": _clean(body.filename, 140) or kind, "size_bytes": approx,
                                         "uploaded_at": _now_iso(), "uploaded_by": user.get("id")})
        old = ev.get(f"{kind}_image_id")
        await db.events.update_one({"id": event_id}, {"$set": {f"{kind}_image_id": media_id, "updated_at": _now_iso()}})
        if old:
            await db.event_media.delete_one({"id": old})
        return await _event_admin_view(event_id)

    async def _remove_image(event_id: str, kind: str) -> dict:
        if kind not in IMAGE_KINDS:
            raise HTTPException(status_code=404, detail="No such image")
        ev = await _event_by_id(event_id)
        if ev.get(f"{kind}_image_id"):
            await db.event_media.delete_one({"id": ev[f"{kind}_image_id"]})
            await db.events.update_one({"id": event_id}, {"$set": {f"{kind}_image_id": None, "updated_at": _now_iso()}})
        return await _event_admin_view(event_id)

    @api.post("/admin/events/{event_id}/images/{kind}")
    async def admin_upload_event_image(event_id: str, kind: str, body: BannerImageIn, user: dict = Depends(edit)):
        """`banner` = the picture behind the homepage banner (words and button
        stay the app's); `flyer` = the picture on the event page."""
        return await _store_image(event_id, kind, body, user)

    @api.delete("/admin/events/{event_id}/images/{kind}")
    async def admin_delete_event_image(event_id: str, kind: str, user: dict = Depends(edit)):
        return await _remove_image(event_id, kind)

    @api.post("/admin/events/{event_id}/banner-image")
    async def admin_upload_banner_image(event_id: str, body: BannerImageIn, user: dict = Depends(edit)):
        """Older alias of /images/banner."""
        return await _store_image(event_id, "banner", body, user)

    @api.delete("/admin/events/{event_id}/banner-image")
    async def admin_delete_banner_image(event_id: str, user: dict = Depends(edit)):
        return await _remove_image(event_id, "banner")

    # ----- photo booth -------------------------------------------------------
    async def _photo_product_for(ev: dict, pkg: dict) -> str:
        """The hidden register product a package sells through. Created on
        first use and kept in step with the package's name and price, so
        the sale hits the register, the drawer, sales tax and the P&L
        exactly like merchandise."""
        title = ev.get("photos_title") or "Event photos"
        name = f"{title} — {pkg['name']}"
        pid = pkg.get("product_id")
        prod = await db.pos_products.find_one({"id": pid}, {"_id": 0, "id": 1}) if pid else None
        fields = {"name": name, "price": float(pkg["price"]), "category": "Event photos", "taxable": True,
                  "description": f"{ev.get('name') or 'Event'} photo package", "active": True, "track_inventory": False,
                  "show_online": False, "show_at_register": False, "sales_destination": "internal",
                  "event_photo_package": {"event_id": ev["id"], "key": pkg["key"]}, "updated_at": _now_iso()}
        if prod:
            await db.pos_products.update_one({"id": pid}, {"$set": fields})
            return pid
        pid = str(uuid.uuid4())
        await db.pos_products.insert_one({"id": pid, "sku": None, "cost": None, "low_stock_threshold": None, "stock_on_hand": 0,
                                          "created_at": _now_iso(), **fields})
        await db.events.update_one({"id": ev["id"], "photo_packages.key": pkg["key"]}, {"$set": {"photo_packages.$.product_id": pid}})
        return pid

    def _order_row(o: dict) -> dict:
        o = {k: v for k, v in o.items() if k != "_id"}
        o["list_total"] = round(float(o.get("package_price") or 0) * int(o.get("qty") or 1), 2)
        o["print"] = (o.get("package") or {}).get("print") or ""
        o["digitals"] = int((o.get("package") or {}).get("digitals") or 0)
        return o

    async def _photo_summary(event_id: str) -> dict:
        rows = await db.event_photo_orders.find({"event_id": event_id}, {"_id": 0, "status": 1, "total": 1, "package": 1, "print_status": 1}).to_list(5000)
        paid = [r for r in rows if r.get("status") in ("paid", "ready", "sent")]
        return {
            "orders": len(rows),
            "revenue": round(sum(float(r.get("total") or 0) for r in paid), 2),
            "unpaid": sum(1 for r in rows if r.get("status") == "ordered"),
            "to_send": sum(1 for r in rows if r.get("status") in ("paid", "ready") and int((r.get("package") or {}).get("digitals") or 0) > 0),
            "sent": sum(1 for r in rows if r.get("status") == "sent"),
            "prints_pending": sum(1 for r in rows if (r.get("package") or {}).get("print") and r.get("status") != "ordered" and (r.get("print_status") or "pending") in ("pending", "ready")),
        }

    async def _photo_order(event_id: str, oid: str) -> dict:
        o = await db.event_photo_orders.find_one({"event_id": event_id, "id": oid}, {"_id": 0})
        if not o:
            raise HTTPException(status_code=404, detail="Photo order not found")
        return o

    async def _photo_view(event_id: str, oid: str) -> dict:
        return {"order": _order_row(await _photo_order(event_id, oid)), "summary": await _photo_summary(event_id)}

    @api.get("/admin/events/{event_id}/photo-orders/summary")
    async def admin_photo_summary(event_id: str, user: dict = Depends(manage)):
        await _event_by_id(event_id)
        return await _photo_summary(event_id)

    @api.get("/admin/events/{event_id}/photo-orders")
    async def admin_list_photo_orders(event_id: str, q: str = Query(default=""), status: str = Query(default="all"),
                                      user: dict = Depends(manage)):
        await _event_by_id(event_id)
        query: Dict[str, Any] = {"event_id": event_id}
        if status in PHOTO_ORDER_STATUSES:
            query["status"] = status
        term = (q or "").strip()[:80]
        if term:
            rx = _search_re(term)
            query["$or"] = [{"primary_contact": rx}, {"email": rx}, {"order_number": rx}, {"dogs": rx}, {"shot_ref": rx}, {"phone_digits": _search_re(_digits(term))} if len(_digits(term)) >= 3 else {"order_number": rx}]
        rows = await db.event_photo_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return {"orders": [_order_row(r) for r in rows], "count": len(rows)}

    @api.post("/admin/events/{event_id}/photo-orders")
    async def admin_create_photo_order(event_id: str, body: PhotoOrderIn, user: dict = Depends(manage)):
        ev = await _event_by_id(event_id)
        if not ev.get("photos_enabled", True):
            raise HTTPException(status_code=409, detail="Photos are switched off for this event.")
        pkg = next((pk for pk in ev.get("photo_packages") or [] if pk.get("key") == body.package_key), None)
        if not pkg:
            raise HTTPException(status_code=422, detail="Pick a photo package.")
        client_id = body.client_id
        reg = None
        if body.registration_id:
            reg = await db.event_registrations.find_one({"event_id": event_id, "id": body.registration_id}, {"_id": 0, "id": 1, "client_id": 1, "confirmation_number": 1})
            if not reg:
                raise HTTPException(status_code=404, detail="That registration isn't on this event.")
            client_id = client_id or reg.get("client_id")
        if client_id and not await db.clients.find_one({"id": client_id}, {"_id": 1}):
            client_id = None
        product_id = await _photo_product_for(ev, pkg)
        seq = await _next_seq(db, ev["id"], "photo")
        now = _now_iso()
        by = {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}
        order = {
            "id": str(uuid.uuid4()), "event_id": ev["id"],
            "order_number": f"{ev.get('confirmation_prefix') or 'SH-EV'}-P{seq:04d}",
            "registration_id": reg["id"] if reg else None, "confirmation_number": (reg or {}).get("confirmation_number"),
            "client_id": client_id,
            "primary_contact": _clean(body.primary_contact, 120), "email": str(body.email).strip().lower(),
            "phone": _clean(body.phone, 40), "phone_digits": _digits(body.phone),
            "dogs": [_clean(d, 60) for d in body.dogs if _clean(d, 60)],
            "contestant_numbers": [int(n) for n in body.contestant_numbers if n],
            "shot_ref": _clean(body.shot_ref, 120), "notes": _clean(body.notes, 500),
            "package_key": pkg["key"], "package_name": pkg["name"], "package_price": float(pkg["price"]),
            "package": {"digitals": int(pkg.get("digitals") or 0), "print": pkg.get("print") or "", "product_id": product_id},
            "qty": int(body.qty),
            "status": "ordered", "print_status": "pending" if pkg.get("print") else "none",
            "pos_sale_id": None, "receipt_number": None, "subtotal": None, "tax_amount": None, "total": None, "paid_at": None, "paid_by": None,
            "delivery_link": "", "sent_at": None, "sent_by": None,
            "created_at": now, "created_by": by, "updated_at": now,
        }
        await db.event_photo_orders.insert_one(dict(order))
        return {"order": _order_row(order), "summary": await _photo_summary(event_id)}

    @api.get("/admin/events/{event_id}/photo-orders/{oid}")
    async def admin_get_photo_order(event_id: str, oid: str, user: dict = Depends(manage)):
        return await _photo_view(event_id, oid)

    @api.patch("/admin/events/{event_id}/photo-orders/{oid}")
    async def admin_patch_photo_order(event_id: str, oid: str, body: PhotoOrderPatchIn, user: dict = Depends(manage)):
        o = await _photo_order(event_id, oid)
        patch: Dict[str, Any] = {}
        if body.primary_contact is not None:
            patch["primary_contact"] = _clean(body.primary_contact, 120)
        if body.email is not None:
            patch["email"] = str(body.email).strip().lower()
        if body.phone is not None:
            patch["phone"] = _clean(body.phone, 40); patch["phone_digits"] = _digits(body.phone)
        if body.dogs is not None:
            patch["dogs"] = [_clean(d, 60) for d in body.dogs if _clean(d, 60)]
        if body.shot_ref is not None:
            patch["shot_ref"] = _clean(body.shot_ref, 120)
        if body.notes is not None:
            patch["notes"] = _clean(body.notes, 500)
        if body.delivery_link is not None:
            patch["delivery_link"] = body.delivery_link.strip()[:2000]
        if body.print_status is not None:
            patch["print_status"] = body.print_status
        if body.status is not None:
            if o.get("status") == "ordered":
                raise HTTPException(status_code=409, detail="Take payment first.")
            if o.get("status") == "sent" and body.status != "ready":
                raise HTTPException(status_code=409, detail="This order was already sent.")
            patch["status"] = body.status
        patch["updated_at"] = _now_iso()
        await db.event_photo_orders.update_one({"event_id": event_id, "id": oid}, {"$set": patch})
        return await _photo_view(event_id, oid)

    @api.delete("/admin/events/{event_id}/photo-orders/{oid}")
    async def admin_delete_photo_order(event_id: str, oid: str, user: dict = Depends(manage)):
        o = await _photo_order(event_id, oid)
        if o.get("status") != "ordered":
            raise HTTPException(status_code=409, detail="A paid order can't be deleted. Refund it through the register instead.")
        await db.event_photo_orders.delete_one({"event_id": event_id, "id": oid})
        return {"ok": True, "summary": await _photo_summary(event_id)}

    def _pos_lines(o: dict):
        return [pos_line_model(kind="retail", product_id=(o.get("package") or {}).get("product_id"), qty=int(o.get("qty") or 1))]

    @api.post("/admin/events/{event_id}/photo-orders/{oid}/preview")
    async def admin_preview_photo_order(event_id: str, oid: str, user: dict = Depends(manage)):
        """What the register will charge (subtotal, tax, total) — priced by
        the same code as every Front Desk cart."""
        if price_pos_cart is None:
            raise HTTPException(status_code=503, detail="The register is not available.")
        o = await _photo_order(event_id, oid)
        priced, _caches = await price_pos_cart(_pos_lines(o), None, can_price=False, client_id=o.get("client_id"))
        return {"subtotal": priced.get("subtotal"), "tax_amount": priced.get("tax_amount"), "total": priced.get("total"), "tax_rate_pct": priced.get("tax_rate_pct")}

    @api.post("/admin/events/{event_id}/photo-orders/{oid}/checkout")
    async def admin_checkout_photo_order(event_id: str, oid: str, body: PhotoCheckoutIn, user: dict = Depends(manage)):
        """Rings the order through the real register: one sale of the
        package's hidden product, the given tenders, the same receipt, drawer,
        tax and P&L behaviour as any Front Desk sale. Idempotent per order."""
        if create_pos_sale is None or pos_sale_model is None:
            raise HTTPException(status_code=503, detail="The register is not available.")
        o = await _photo_order(event_id, oid)
        if o.get("status") != "ordered":
            return await _photo_view(event_id, oid)
        if require_take_payments is not None:
            require_take_payments(user)
        sale_body = pos_sale_model(
            lines=_pos_lines(o), discount=None, client_id=o.get("client_id"),
            tenders=[pos_tender_model(method=t.method, amount=t.amount, tendered_amount=t.tendered_amount, notes=t.notes) for t in body.tenders],
            workstation_id=body.workstation_id, idempotency_key=f"event-photo:{o['id']}:{body.idempotency_key}"[:128],
        )
        result = await create_pos_sale(sale_body, user)
        sale = result.get("sale") or {}
        now = _now_iso()
        await db.event_photo_orders.update_one({"event_id": event_id, "id": oid}, {"$set": {
            "status": "paid", "pos_sale_id": result.get("pos_sale_id") or sale.get("id"),
            "receipt_number": sale.get("receipt_number"), "subtotal": sale.get("subtotal"), "tax_amount": sale.get("tax_amount"),
            "total": sale.get("total"), "paid_at": now, "paid_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""},
            "updated_at": now}})
        view = await _photo_view(event_id, oid)
        view["pos"] = {k: result.get(k) for k in ("pos_sale_id", "pos_print_receipt_token", "pos_open_drawer_token")}
        return view

    @api.post("/admin/events/{event_id}/photo-orders/{oid}/send")
    async def admin_send_photo_order(event_id: str, oid: str, body: PhotoSendIn, user: dict = Depends(manage)):
        """Email the customer their download link and mark the order sent."""
        ev = await _event_by_id(event_id)
        o = await _photo_order(event_id, oid)
        if o.get("status") == "ordered":
            raise HTTPException(status_code=409, detail="Take payment before sending the photos.")
        link = body.delivery_link.strip()
        if not re.match(r"^https?://", link, re.I):
            raise HTTPException(status_code=422, detail="The download link must start with http:// or https://.")
        if not o.get("email"):
            raise HTTPException(status_code=422, detail="This order has no email address.")
        sent_now = False
        try:
            sent_now = await email_service.send_event_photos_ready(to_email=o["email"], event=ev, order=o, link=link, message=body.message.strip())
        except Exception as exc:
            logger.warning("events: photos-ready email failed for %s: %s", o.get("order_number"), exc)
        now = _now_iso()
        await db.event_photo_orders.update_one({"event_id": event_id, "id": oid}, {"$set": {
            "status": "sent", "delivery_link": link, "sent_at": now, "email_sent_now": bool(sent_now),
            "sent_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}, "updated_at": now}})
        return await _photo_view(event_id, oid)

    @api.get("/admin/events/{event_id}/photo-orders.csv")
    async def admin_photo_orders_csv(event_id: str, user: dict = Depends(manage)):
        ev = await _event_by_id(event_id)
        rows = await db.event_photo_orders.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(5000)
        header = ["Order #", "Name", "Email", "Phone", "Dogs", "Contestant #s", "Shot reference", "Package", "Qty", "Digitals", "Print",
                  "Subtotal", "Tax", "Total", "Status", "Receipt #", "Paid at", "Print status", "Download link", "Sent at", "Notes", "Confirmation #", "Created at"]
        data = [[r.get("order_number"), r.get("primary_contact"), r.get("email"), r.get("phone"), "; ".join(r.get("dogs") or []),
                 "; ".join(f"#{int(n):03d}" for n in (r.get("contestant_numbers") or [])), r.get("shot_ref"), r.get("package_name"), r.get("qty"),
                 (r.get("package") or {}).get("digitals"), (r.get("package") or {}).get("print"), r.get("subtotal"), r.get("tax_amount"), r.get("total"),
                 r.get("status"), r.get("receipt_number"), r.get("paid_at"), r.get("print_status"), r.get("delivery_link"), r.get("sent_at"),
                 r.get("notes"), r.get("confirmation_number"), r.get("created_at")] for r in rows]
        return _csv_response(f"{ev['slug']}-photo-orders.csv", header, data)

    @api.get("/admin/events/{event_id}/qr")
    async def admin_event_qr(event_id: str, request: Request, origin: str = Query(default=""),
                             size: int = Query(default=10, ge=4, le=40), user: dict = Depends(manage)):
        """The flyer QR code: encodes the event's permanent public address.
        Prefers APP_PUBLIC_URL; a browser may pass its own origin when that is
        not configured (local/dev). `size` is the module size in pixels, so
        size=30 is print-ready.

        The path deliberately has no `.png` suffix: production nginx answers
        image-looking paths from the static folder before the API proxy sees
        them, so `/qr.png` was a 404 that never reached the backend. The
        PNG name for the download comes from Content-Disposition instead."""
        ev = await _event_by_id(event_id)
        base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
        if not base:
            o = (origin or "").strip().rstrip("/")
            base = o if re.match(r"^https?://[A-Za-z0-9.\-]+(:\d+)?$", o) else str(request.base_url).rstrip("/")
        url = f"{base}/events/{ev['slug']}"
        img = qrcode.make(url, box_size=int(size), border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png",
                        headers={"Content-Disposition": f'inline; filename="{ev["slug"]}-qr.png"',
                                 "X-Event-Url": url, "Cache-Control": "no-store"})

    async def _contestants(event_id: str) -> List[dict]:
        rows = await db.event_registrations.find(
            {"event_id": event_id, "status": "registered", "dogs.costume_entered": True}, {"_id": 0}).to_list(2000)
        out = []
        for r in rows:
            for d in r.get("dogs") or []:
                if d.get("costume_entered"):
                    out.append({
                        "contestant_number": d.get("contestant_number"),
                        "contestant_label": f"#{_pad_contestant(d.get('contestant_number'))}" if d.get("contestant_number") else "",
                        "dog_name": d.get("name") or "", "owner": r.get("primary_contact") or "",
                        "costume_theme": d.get("costume_theme") or "", "dog_and_human": bool(d.get("dog_and_human")),
                        "notes": d.get("costume_notes") or "", "checked_in": bool(r.get("checked_in")),
                        "registration_id": r["id"], "confirmation_number": r.get("confirmation_number"),
                        "source": r.get("source"),
                    })
        out.sort(key=lambda c: (c["contestant_number"] is None, c["contestant_number"] or 0))
        return out

    @api.get("/admin/events/{event_id}/costume-contest")
    async def admin_costume_contest(event_id: str, user: dict = Depends(manage)):
        await _event_by_id(event_id)
        rows = await _contestants(event_id)
        return {"contestants": rows, "count": len(rows)}

    def _csv_response(filename: str, header: List[str], rows: List[List[Any]]) -> Response:
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(header)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
        return Response(content=out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @api.get("/admin/events/{event_id}/export.csv")
    async def admin_export_csv(event_id: str, user: dict = Depends(manage)):
        ev = await _event_by_id(event_id)
        rows = await db.event_registrations.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(5000)
        header = ["Confirmation #", "Primary contact", "Email", "Phone", "Adults", "Children", "Dogs", "Dog names",
                  "Costume contest", "Costume entries", "Contestant numbers", "Source", "Heard from", "Marketing consent",
                  "Status", "Checked in", "Checked in at", "Checked in by", "Registered at"]
        data = []
        for r in rows:
            dogs = r.get("dogs") or []
            entries = [d for d in dogs if d.get("costume_entered")]
            data.append([
                r.get("confirmation_number"), r.get("primary_contact"), r.get("email"), r.get("phone"),
                r.get("adults"), r.get("children"), len(dogs), "; ".join(d.get("name", "") for d in dogs),
                "yes" if r.get("costume_contest") else "no",
                "; ".join(f"{d.get('name', '')}" + (f" ({d.get('costume_theme')})" if d.get("costume_theme") else "") + (" [dog+human]" if d.get("dog_and_human") else "") for d in entries),
                "; ".join(f"#{_pad_contestant(d.get('contestant_number'))}" for d in entries if d.get("contestant_number")),
                r.get("source"), HEARD_FROM_LABELS.get(r.get("heard_from") or "", r.get("heard_from") or "") + (f": {r.get('heard_from_other')}" if r.get("heard_from_other") else ""),
                "yes" if r.get("marketing_consent") else "no",
                r.get("status"), "yes" if r.get("checked_in") else "no", r.get("checked_in_at") or "",
                (r.get("checked_in_by") or {}).get("name") or "", r.get("created_at"),
            ])
        return _csv_response(f"{ev['slug']}-registrations.csv", header, data)

    @api.get("/admin/events/{event_id}/costume-contest.csv")
    async def admin_costume_csv(event_id: str, user: dict = Depends(manage)):
        ev = await _event_by_id(event_id)
        rows = await _contestants(event_id)
        header = ["Contestant #", "Dog name", "Owner", "Costume / theme", "Dog + human", "Checked in", "Notes", "Confirmation #", "Source"]
        data = [[c["contestant_label"], c["dog_name"], c["owner"], c["costume_theme"], "yes" if c["dog_and_human"] else "no",
                 "yes" if c["checked_in"] else "no", c["notes"], c["confirmation_number"], c["source"]] for c in rows]
        return _csv_response(f"{ev['slug']}-costume-contest.csv", header, data)
