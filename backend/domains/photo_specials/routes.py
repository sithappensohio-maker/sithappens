"""Photo Specials — public, reusable portrait-event booking.

A Photo Special is CONFIGURATION ONLY: a name, some marketing copy, the dates
and hours it runs, how long a session is, and which photography service the
Register prices from. It owns no appointments of its own.

A reservation IS an ordinary `bookings` row — `service_type: "photography"`,
a real `service_id`, a real date and time — tagged with `photo_special_id`.
That single decision is what keeps this feature thin: the schedule, Front Desk
check-in, the Register, sales tax, cancellation and reporting all already know
how to handle a photography booking, and none of them needed a special case.

Halloween is simply the first special created with it; Christmas, Valentine's
and the rest are new rows in this collection, not new code.

Two deliberate exceptions, both narrow and both explicit:

* Vaccines. A member of the public reserving a fifteen-minute portrait is not
  going to stop and upload a rabies certificate, and a portrait is a short,
  controlled, one-to-one appointment. So a missing vaccine record does not
  block a Photo Special reservation. Nothing is fabricated: the dog's vaccine
  state is left exactly as it is, the booking carries
  `vaccine_booking_exception: "photo_special"` so the exception is visible in
  the data, and Front Desk still sees the real vaccine state on the event-day
  list. Daycare, boarding, training and grooming are untouched.

* Price. The reservation never decides what anyone owes. The portrait session
  service exists to define the appointment's length, not its price, so it
  carries a base price of zero and the booking is created with no
  `actual_price` at all — exactly like every other unpaid booking. The money
  happens afterwards at the Register, where the customer picks the package
  they actually want and the existing sales-tax logic runs. There is no second
  checkout here and no price is copied onto the booking as financial truth.
"""
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field

PORTRAIT_SERVICE_SLUG = "portrait-session"
PORTRAIT_SERVICE_NAME = "Portrait Session"
# The appointment's length is the point of this service; its price is not.
# Zero means a reservation can never manufacture an amount owed — the Register
# is where the customer's actual package is rung up.
PORTRAIT_SERVICE_DURATION_MIN = 15
PORTRAIT_SERVICE_BASE_PRICE = 0.0

VACCINE_EXCEPTION = "photo_special"
ACTIVE_BOOKING_STATUSES = ["pending", "approved", "completed"]
IMAGE_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:80] or "photo-special"


def _clean(v: Optional[str], limit: int) -> str:
    return (v or "").strip()[:limit]


def _hhmm_to_min(v: str) -> Optional[int]:
    try:
        hh, mm = str(v).split(":")[:2]
        h, m = int(hh), int(mm)
    except Exception:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def _min_to_hhmm(total: int) -> str:
    hh, mm = divmod(total, 60)
    return f"{hh:02d}:{mm:02d}"


def _digits(v: Optional[str]) -> str:
    return re.sub(r"\D", "", v or "")


class PhotoSpecialIn(BaseModel):
    """Everything the owner configures. Creating the next portrait event is
    filling this in again — never another build."""

    name: str = Field(min_length=2, max_length=160)
    slug: Optional[str] = Field(default=None, max_length=80)
    headline: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=3000)
    location_name: str = Field(default="", max_length=160)
    location_address: str = Field(default="", max_length=300)
    what_to_expect: List[str] = Field(default_factory=list, max_length=10)
    packages_blurb: str = Field(default="", max_length=2000)
    arrival_notes: str = Field(default="", max_length=600)
    cancellation_notes: str = Field(default="", max_length=600)
    # Which photography service the Register prices from. Reused across every
    # special — Christmas does not need its own service.
    service_id: Optional[str] = Field(default=None, max_length=64)
    dates: List[str] = Field(default_factory=list, max_length=31)
    start_time: str = Field(default="09:00", max_length=5)
    end_time: str = Field(default="15:00", max_length=5)
    slot_minutes: int = Field(default=15, ge=5, le=240)
    dogs_per_slot: int = Field(default=1, ge=1, le=6)
    max_bookings: Optional[int] = Field(default=None, ge=0, le=10000)
    booking_open: bool = True
    published: bool = False


class PhotoSpecialImageIn(BaseModel):
    data: str = Field(min_length=10)
    filename: str = Field(default="hero", max_length=140)


class ReserveIn(BaseModel):
    """What the public page collects. Deliberately short — every extra field
    is another reason someone abandons a fifteen-minute portrait booking."""

    date: str = Field(min_length=8, max_length=10)
    time: str = Field(min_length=3, max_length=5)
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(default="", max_length=60)
    email: EmailStr
    phone: str = Field(min_length=7, max_length=40)
    dog_name: str = Field(min_length=1, max_length=60)
    breed: str = Field(default="", max_length=80)
    dog_notes: str = Field(default="", max_length=600)
    idempotency_key: Optional[str] = Field(default=None, max_length=80)
    website: str = Field(default="", max_length=200)  # honeypot — humans never see it


class ManualReservationIn(BaseModel):
    date: str = Field(min_length=8, max_length=10)
    time: str = Field(min_length=3, max_length=5)
    dog_id: str = Field(min_length=1, max_length=64)
    notes: str = Field(default="", max_length=600)


def register_photo_special_routes(
    *, api, db, logger, now_iso, get_settings, enforce_rate_limit, client_ip,
    require_admin_and_permission, slot_overlaps, notify_client_booking_approved,
) -> Dict[str, Any]:
    """Register the public + admin Photo Specials routes. Returns the callables
    the in-process suite drives directly."""

    manage = require_admin_and_permission("manage_events")

    # ---------------------------------------------------------------- helpers

    async def _portrait_service() -> dict:
        """The one canonical photography service every special points at.

        Created on demand rather than by a migration so a fresh database (and
        every test database) has it without a manual setup step. It is an
        ordinary services row — not a Photo Special-specific fake — so it shows
        up in Settings → Services and can be edited there like any other.
        """
        svc = await db.services.find_one({"slug": PORTRAIT_SERVICE_SLUG}, {"_id": 0})
        if svc:
            return svc
        svc = {
            "id": str(uuid.uuid4()),
            "slug": PORTRAIT_SERVICE_SLUG,
            "name": PORTRAIT_SERVICE_NAME,
            "service_type": "photography",
            # Zero on purpose: the appointment reserves time, it does not price
            # the portraits. See this module's docstring.
            "base_price": PORTRAIT_SERVICE_BASE_PRICE,
            "duration_minutes": PORTRAIT_SERVICE_DURATION_MIN,
            "capacity_per_slot": 1,
            "active": True,
            "is_default": False,
            "created_at": now_iso(),
        }
        await db.services.insert_one(dict(svc))
        svc.pop("_id", None)
        return svc

    async def _special_by(query: dict, *, published_only: bool = False) -> dict:
        q = dict(query)
        if published_only:
            q["published"] = True
        sp = await db.photo_specials.find_one(q, {"_id": 0})
        if not sp:
            raise HTTPException(status_code=404, detail="Photo special not found")
        return sp

    async def _booked_times(special_id: str, day: str) -> Dict[str, int]:
        """How many live reservations sit on each time of this special's day.
        Cancelled and rejected rows are absent by construction, which is what
        makes a cancellation reopen its slot with no extra bookkeeping."""
        rows = await db.bookings.find(
            {"photo_special_id": special_id, "date": day, "status": {"$in": ACTIVE_BOOKING_STATUSES}},
            {"_id": 0, "time": 1},
        ).to_list(2000)
        out: Dict[str, int] = {}
        for r in rows:
            t = r.get("time") or ""
            out[t] = out.get(t, 0) + 1
        return out

    async def _other_service_blocks(day: str) -> List[dict]:
        """Live training/grooming/photography appointments that are NOT part of
        this special. The shared overlap pool is why a portrait can never be
        booked on top of a lesson."""
        return await db.bookings.find(
            {
                "date": day,
                "status": {"$in": ACTIVE_BOOKING_STATUSES},
                "service_type": {"$in": ["training", "grooming", "photography"]},
                "time": {"$nin": ["", None]},
            },
            {"_id": 0, "id": 1, "time": 1, "duration_minutes": 1, "service_type": 1, "photo_special_id": 1, "checked_out_at": 1},
        ).to_list(2000)

    async def _total_booked(special_id: str) -> int:
        return await db.bookings.count_documents(
            {"photo_special_id": special_id, "status": {"$in": ACTIVE_BOOKING_STATUSES}}
        )

    async def _availability(sp: dict, day: str) -> dict:
        """Candidate slots for one day of one special.

        Generated at the SPECIAL's own slot length inside the SPECIAL's own
        window — deliberately not through the shared 30-minute
        /bookings/time-slots grid, which training and grooming depend on and
        which cannot express a fifteen-minute portrait. The conflict rules are
        the shared ones.
        """
        if day not in (sp.get("dates") or []):
            return {"date": day, "slot_minutes": sp.get("slot_minutes"), "closed": True, "slots": []}

        start = _hhmm_to_min(sp.get("start_time") or "")
        end = _hhmm_to_min(sp.get("end_time") or "")
        dur = int(sp.get("slot_minutes") or 15)
        per_slot = int(sp.get("dogs_per_slot") or 1)
        if start is None or end is None or dur <= 0 or end <= start:
            return {"date": day, "slot_minutes": dur, "closed": True, "slots": []}

        mine = await _booked_times(sp["id"], day)
        others = await _other_service_blocks(day)
        sold_out_overall = False
        cap = sp.get("max_bookings")
        if cap is not None:
            sold_out_overall = await _total_booked(sp["id"]) >= int(cap)

        slots = []
        for total in range(start, end, dur):
            if total + dur > end:
                continue
            label = _min_to_hhmm(total)
            taken = mine.get(label, 0)
            blocked = False
            for b in others:
                if b.get("checked_out_at") or b.get("photo_special_id") == sp["id"]:
                    continue
                bstart = _hhmm_to_min(b.get("time") or "")
                if bstart is None:
                    continue
                bdur = int(b.get("duration_minutes") or 0) or dur
                if slot_overlaps(total, dur, bstart, bdur):
                    blocked = True
                    break
            # The public page is told only whether it can have the time. Who
            # holds it, and how many others are on the books, stays private.
            slots.append({"time": label, "available": (not blocked) and taken < per_slot and not sold_out_overall})
        return {"date": day, "slot_minutes": dur, "closed": False, "slots": slots}

    def _public_view(sp: dict) -> dict:
        """Exactly what the marketing page needs, and nothing internal."""
        return {
            "slug": sp.get("slug"),
            "name": sp.get("name"),
            "headline": sp.get("headline") or "",
            "description": sp.get("description") or "",
            "location_name": sp.get("location_name") or "",
            "location_address": sp.get("location_address") or "",
            "what_to_expect": sp.get("what_to_expect") or [],
            "packages_blurb": sp.get("packages_blurb") or "",
            "arrival_notes": sp.get("arrival_notes") or "",
            "cancellation_notes": sp.get("cancellation_notes") or "",
            "dates": sp.get("dates") or [],
            "start_time": sp.get("start_time"),
            "end_time": sp.get("end_time"),
            "slot_minutes": sp.get("slot_minutes"),
            "booking_open": bool(sp.get("booking_open")),
            "has_hero_image": bool(sp.get("hero_image_id")),
        }

    async def _resolve_owner_and_dog(body: ReserveIn) -> tuple:
        """Reuse the person if we can safely recognise them; otherwise create a
        walk-in owner and dog.

        Matching is by email first, then by digits-only phone — the same rule
        the Meet & Greet request already uses. Existing records are never
        overwritten: a blank field may be filled in, nothing else is touched.
        Crucially the caller's response is identical either way, so this
        endpoint can never be used to discover whether an address is on file.
        """
        email = str(body.email).strip().lower()
        full_name = " ".join(p for p in [body.first_name.strip(), body.last_name.strip()] if p).strip()
        phone_digits = _digits(body.phone)

        client = await db.clients.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0}
        )
        if not client and phone_digits:
            for cand in await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "phone": 1, "email": 1}).to_list(5000):
                if _digits(cand.get("phone")) and _digits(cand.get("phone")) == phone_digits:
                    client = cand
                    break

        if client:
            fill: Dict[str, Any] = {}
            if body.phone.strip() and not (client.get("phone") or "").strip():
                fill["phone"] = body.phone.strip()
            if email and not (client.get("email") or "").strip():
                fill["email"] = email
            if fill:
                await db.clients.update_one({"id": client["id"]}, {"$set": fill})
                client = {**client, **fill}
        else:
            client = {
                "id": str(uuid.uuid4()),
                "name": full_name or email,
                "phone": body.phone.strip(),
                "email": email,
                "address": "", "emerg": "",
                "credits": 0, "training_credits": 0, "boarding_credits": 0,
                "account_balance": 0.0, "waiver": False, "referred_by_code": None,
                # The same walk-in mechanism the front desk uses — not a second
                # kind of customer.
                "client_status": "walk_in",
                "evaluation_notes": "",
                "created_at": now_iso(),
            }
            await db.clients.insert_one(dict(client))

        dog_name = body.dog_name.strip()
        dog = await db.dogs.find_one(
            {"owner_id": client["id"], "name": {"$regex": f"^{re.escape(dog_name)}$", "$options": "i"}}, {"_id": 0}
        )
        if not dog:
            dog = {
                "id": str(uuid.uuid4()),
                "owner_id": client["id"],
                "name": dog_name,
                "breed": _clean(body.breed, 80),
                "age_y": 0, "age_m": 0, "sex": "Male", "fixed": "No",
                # Left genuinely empty. The reservation does not pretend this
                # dog has paperwork it has never handed in.
                "vaccines": {},
                "notes": _clean(body.dog_notes, 600),
                "training_logs": [],
                "created_at": now_iso(),
            }
            await db.dogs.insert_one(dict(dog))
        elif body.dog_notes.strip() and not (dog.get("notes") or "").strip():
            await db.dogs.update_one({"id": dog["id"]}, {"$set": {"notes": _clean(body.dog_notes, 600)}})
        return client, dog

    def _reservation_row(b: dict, dog: Optional[dict] = None) -> dict:
        vax = (dog or {}).get("vaccines") or {}
        return {
            "booking_id": b.get("id"),
            "date": b.get("date"),
            "time": b.get("time"),
            "dog_id": b.get("dog_id"),
            "dog_name": b.get("dog_name"),
            "client_id": b.get("client_id"),
            "client_name": b.get("client_name"),
            "status": b.get("status"),
            "checked_in_at": b.get("checked_in_at"),
            "no_show": bool(b.get("no_show")),
            "notes": b.get("notes") or "",
            # Front Desk still sees the truth about this dog even though the
            # reservation was allowed without it. Informational only.
            "vaccines_on_file": bool(vax),
            "vaccine_exception": b.get("vaccine_booking_exception"),
        }

    # ----------------------------------------------------------------- public

    @api.get("/public/photo-specials/{slug}")
    async def public_photo_special(slug: str):
        sp = await _special_by({"slug": slug}, published_only=True)
        return _public_view(sp)

    @api.get("/public/photo-specials/{slug}/hero")
    async def public_photo_special_hero(slug: str):
        """The event's picture, served straight from the record it belongs to —
        same convention as the event banner."""
        sp = await _special_by({"slug": slug}, published_only=True)
        media = await db.photo_special_media.find_one({"id": sp.get("hero_image_id")}, {"_id": 0}) if sp.get("hero_image_id") else None
        if not media:
            raise HTTPException(status_code=404, detail="No image")
        import base64

        from fastapi.responses import Response
        return Response(
            content=base64.b64decode(media["b64"]),
            media_type=media.get("mime") or "image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    @api.get("/public/photo-specials/{slug}/availability")
    async def public_photo_special_availability(slug: str, date: str = Query(default="")):
        sp = await _special_by({"slug": slug}, published_only=True)
        if not sp.get("booking_open"):
            return {"date": date, "closed": True, "slots": [], "slot_minutes": sp.get("slot_minutes")}
        day = (date or "").strip() or ((sp.get("dates") or [None])[0] or "")
        if not day:
            return {"date": "", "closed": True, "slots": [], "slot_minutes": sp.get("slot_minutes")}
        return await _availability(sp, day)

    @api.post("/public/photo-specials/{slug}/reserve")
    async def public_photo_special_reserve(slug: str, body: ReserveIn, request: Request):
        """Reserve one portrait slot. No account, no payment, no deposit.

        Rate-limited and honeypotted like the other public writes. The winning
        request is decided by a unique index, not by the availability check
        above — see the DuplicateKeyError branch.
        """
        sp = await _special_by({"slug": slug}, published_only=True)
        ip = client_ip(request)
        await enforce_rate_limit(request, "photo_special_ip", ip, limit=10, window_seconds=3600)
        await enforce_rate_limit(request, "photo_special_email_ip", f"{ip}|{str(body.email).lower()}", limit=5, window_seconds=3600)

        if (body.website or "").strip():
            logger.info("photo_specials: honeypot tripped from %s — dropped", ip)
            return {"ok": True, "reservation": None}

        # Idempotency FIRST. A resubmitted form — a double tap, a flaky
        # connection, a browser retry — must get back the reservation it
        # already made. Checking availability first would tell that customer
        # their own slot had been taken, which is both wrong and alarming.
        if body.idempotency_key:
            prior = await db.bookings.find_one(
                {"photo_special_id": sp["id"], "reservation_idempotency_key": body.idempotency_key}, {"_id": 0}
            )
            if prior:
                dog = await db.dogs.find_one({"id": prior.get("dog_id")}, {"_id": 0}) if prior.get("dog_id") else None
                return {"ok": True, "reservation": _reservation_row(prior, dog)}

        if not sp.get("booking_open"):
            raise HTTPException(status_code=409, detail="Booking for this session has closed.")

        day, when = body.date.strip(), body.time.strip()
        avail = await _availability(sp, day)
        if avail.get("closed") or not any(s["time"] == when and s["available"] for s in avail.get("slots") or []):
            raise HTTPException(status_code=409, detail="That time has just been taken. Please choose another.")

        service = await _portrait_service()
        client, dog = await _resolve_owner_and_dog(body)

        booking = {
            "id": str(uuid.uuid4()),
            "dog_id": dog["id"],
            "dog_name": dog["name"],
            "client_id": client["id"],
            "client_name": client.get("name") or "",
            "date": day,
            "time": when,
            "duration_minutes": int(sp.get("slot_minutes") or service.get("duration_minutes") or 15),
            "service_type": "photography",
            "service_id": service["id"],
            "status": "approved",
            "notes": _clean(body.dog_notes, 600),
            "created_at": now_iso(),
            "photo_special_id": sp["id"],
            "reservation_idempotency_key": body.idempotency_key or None,
            # Narrow, explicit and visible in the data. This booking was allowed
            # without vaccine documentation BECAUSE it is a photo special; it
            # says nothing about the dog and nothing about any other service.
            "vaccine_booking_exception": VACCINE_EXCEPTION,
            # No actual_price. The Register decides what is owed, after the
            # session, when the customer picks a package.
        }
        try:
            await db.bookings.insert_one(dict(booking))
        except Exception as e:  # pragma: no cover - exercised via the index test
            if "duplicate key" not in str(e).lower():
                raise
            # Someone else's insert landed first. The index is the authority.
            raise HTTPException(status_code=409, detail="That time has just been taken. Please choose another.")
        booking.pop("_id", None)

        try:
            await notify_client_booking_approved(booking, client)
        except Exception as e:
            logger.warning("photo_specials: confirmation email failed for %s: %s", booking["id"], e)

        return {"ok": True, "reservation": _reservation_row(booking, dog)}

    # ------------------------------------------------------------------ admin

    @api.get("/admin/photo-specials")
    async def admin_list_photo_specials(user: dict = Depends(manage)):
        rows = await db.photo_specials.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for sp in rows:
            sp["booked_count"] = await _total_booked(sp["id"])
        return {"specials": rows}

    @api.post("/admin/photo-specials")
    async def admin_create_photo_special(body: PhotoSpecialIn, user: dict = Depends(manage)):
        service = await _portrait_service()
        slug = slugify(body.slug or body.name)
        if await db.photo_specials.find_one({"slug": slug}, {"_id": 0}):
            slug = f"{slug}-{uuid.uuid4().hex[:6]}"
        doc = {
            **body.model_dump(),
            "id": str(uuid.uuid4()),
            "slug": slug,
            "service_id": body.service_id or service["id"],
            "hero_image_id": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.photo_specials.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @api.get("/admin/photo-specials/today")
    async def admin_photo_specials_today(date: str = Query(default=""), user: dict = Depends(manage)):
        """Front Desk's event-day view: every special running today, each with
        its appointments in time order and the gaps left in between.

        A gap is as useful as a booking on the day — it is when the desk can
        take a walk-up — so free times are returned alongside the reservations
        rather than being left for the screen to work out.
        """
        from datetime import date as _date
        day = (date or "").strip() or _date.today().isoformat()
        specials = await db.photo_specials.find({"dates": day}, {"_id": 0}).to_list(50)
        out = []
        for sp in specials:
            rows = await db.bookings.find(
                {"photo_special_id": sp["id"], "date": day, "status": {"$in": ACTIVE_BOOKING_STATUSES}}, {"_id": 0},
            ).to_list(2000)
            by_time = {r.get("time"): r for r in rows}
            dogs = {d["id"]: d for d in await db.dogs.find(
                {"id": {"$in": [r.get("dog_id") for r in rows if r.get("dog_id")]}},
                {"_id": 0, "id": 1, "vaccines": 1},
            ).to_list(2000)}
            av = await _availability(sp, day)
            timeline = []
            for slot in av.get("slots") or []:
                booked = by_time.get(slot["time"])
                timeline.append(
                    {**_reservation_row(booked, dogs.get(booked.get("dog_id"))), "available": False}
                    if booked else
                    {"time": slot["time"], "date": day, "available": True}
                )
            out.append({"special": {"id": sp["id"], "name": sp["name"], "slug": sp.get("slug")},
                        "date": day, "timeline": timeline, "booked_count": len(rows)})
        return {"date": day, "specials": out}

    @api.get("/admin/photo-specials/{special_id}")
    async def admin_get_photo_special(special_id: str, user: dict = Depends(manage)):
        return await _special_by({"id": special_id})

    @api.put("/admin/photo-specials/{special_id}")
    async def admin_update_photo_special(special_id: str, body: PhotoSpecialIn, user: dict = Depends(manage)):
        sp = await _special_by({"id": special_id})
        slug = slugify(body.slug or body.name)
        clash = await db.photo_specials.find_one({"slug": slug, "id": {"$ne": special_id}}, {"_id": 0})
        if clash:
            slug = sp["slug"]
        update = {**body.model_dump(), "slug": slug, "updated_at": now_iso()}
        update["service_id"] = body.service_id or sp.get("service_id") or (await _portrait_service())["id"]
        await db.photo_specials.update_one({"id": special_id}, {"$set": update})
        return {**sp, **update}

    @api.delete("/admin/photo-specials/{special_id}")
    async def admin_delete_photo_special(special_id: str, user: dict = Depends(manage)):
        await _special_by({"id": special_id})
        booked = await _total_booked(special_id)
        if booked:
            raise HTTPException(status_code=409, detail=f"{booked} reservation(s) exist. Cancel them first or just close booking.")
        await db.photo_specials.delete_one({"id": special_id})
        await db.photo_special_media.delete_many({"special_id": special_id})
        return {"ok": True}

    @api.post("/admin/photo-specials/{special_id}/hero-image")
    async def admin_upload_hero_image(special_id: str, body: PhotoSpecialImageIn, user: dict = Depends(manage)):
        sp = await _special_by({"id": special_id})
        raw = body.data
        if not raw.startswith("data:"):
            raise HTTPException(status_code=400, detail="Expected a base64 image data URL.")
        try:
            header, b64 = raw.split(",", 1)
            mime = header.split(";")[0].replace("data:", "").lower().strip()
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed image upload.")
        if mime not in IMAGE_ALLOWED_MIME:
            raise HTTPException(status_code=400, detail="Use a JPEG, PNG or WEBP picture.")
        approx = (len(b64) * 3) // 4
        if approx > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail=f"That picture is {approx // (1024 * 1024)} MB. Max is 5 MB.")
        media_id = str(uuid.uuid4())
        await db.photo_special_media.insert_one({
            "id": media_id, "special_id": special_id, "mime": mime, "b64": b64,
            "filename": _clean(body.filename, 140) or "hero", "size_bytes": approx, "created_at": now_iso(),
        })
        await db.photo_special_media.delete_many({"special_id": special_id, "id": {"$ne": media_id}})
        await db.photo_specials.update_one({"id": special_id}, {"$set": {"hero_image_id": media_id, "updated_at": now_iso()}})
        return {"ok": True, "hero_image_id": media_id}

    @api.get("/admin/photo-specials/{special_id}/reservations")
    async def admin_photo_special_reservations(special_id: str, date: str = Query(default=""), user: dict = Depends(manage)):
        sp = await _special_by({"id": special_id})
        query: Dict[str, Any] = {"photo_special_id": special_id}
        if (date or "").strip():
            query["date"] = date.strip()
        rows = await db.bookings.find(query, {"_id": 0}).to_list(3000)
        rows.sort(key=lambda b: (b.get("date") or "", b.get("time") or ""))
        dog_ids = [b.get("dog_id") for b in rows if b.get("dog_id")]
        dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "vaccines": 1}).to_list(3000)}
        live = [b for b in rows if b.get("status") in ACTIVE_BOOKING_STATUSES]
        return {
            "special": sp,
            "reservations": [_reservation_row(b, dogs.get(b.get("dog_id"))) for b in rows],
            "booked_count": len(live),
            "max_bookings": sp.get("max_bookings"),
        }

    @api.post("/admin/photo-specials/{special_id}/reservations")
    async def admin_add_reservation(special_id: str, body: ManualReservationIn, user: dict = Depends(manage)):
        """Add a reservation by hand — a phone booking, or someone at the desk.
        Goes through the same availability and the same unique index."""
        sp = await _special_by({"id": special_id})
        avail = await _availability(sp, body.date.strip())
        if avail.get("closed") or not any(s["time"] == body.time.strip() and s["available"] for s in avail.get("slots") or []):
            raise HTTPException(status_code=409, detail="That time is not available.")
        dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
        if not dog:
            raise HTTPException(status_code=404, detail="Dog not found")
        client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0}) or {}
        service = await _portrait_service()
        booking = {
            "id": str(uuid.uuid4()),
            "dog_id": dog["id"], "dog_name": dog.get("name"),
            "client_id": client.get("id"), "client_name": client.get("name") or "",
            "date": body.date.strip(), "time": body.time.strip(),
            "duration_minutes": int(sp.get("slot_minutes") or 15),
            "service_type": "photography", "service_id": service["id"],
            "status": "approved", "notes": _clean(body.notes, 600),
            "created_at": now_iso(), "photo_special_id": special_id,
            "vaccine_booking_exception": VACCINE_EXCEPTION,
        }
        try:
            await db.bookings.insert_one(dict(booking))
        except Exception as e:
            if "duplicate key" not in str(e).lower():
                raise
            raise HTTPException(status_code=409, detail="That time has just been taken.")
        booking.pop("_id", None)
        return _reservation_row(booking, dog)

    @api.post("/admin/photo-specials/{special_id}/reservations/{booking_id}/no-show")
    async def admin_mark_no_show(special_id: str, booking_id: str, user: dict = Depends(manage)):
        """Mark a no-show. No fee, no stored card, no automated charge — this
        release deliberately has none of that. Cancelling frees the slot, which
        is the behaviour that actually matters on the day."""
        b = await db.bookings.find_one({"id": booking_id, "photo_special_id": special_id}, {"_id": 0})
        if not b:
            raise HTTPException(status_code=404, detail="Reservation not found")
        update = {"no_show": True, "status": "cancelled", "cancelled_at": now_iso()}
        await db.bookings.update_one({"id": booking_id}, {"$set": update})
        return _reservation_row({**b, **update})

    return {
        "public_photo_special": public_photo_special,
        "public_photo_special_hero": public_photo_special_hero,
        "public_photo_special_availability": public_photo_special_availability,
        "public_photo_special_reserve": public_photo_special_reserve,
        "admin_list_photo_specials": admin_list_photo_specials,
        "admin_create_photo_special": admin_create_photo_special,
        "admin_get_photo_special": admin_get_photo_special,
        "admin_update_photo_special": admin_update_photo_special,
        "admin_delete_photo_special": admin_delete_photo_special,
        "admin_upload_hero_image": admin_upload_hero_image,
        "admin_photo_special_reservations": admin_photo_special_reservations,
        "admin_add_reservation": admin_add_reservation,
        "admin_mark_no_show": admin_mark_no_show,
        "admin_photo_specials_today": admin_photo_specials_today,
        "portrait_service": _portrait_service,
        "photo_special_availability": _availability,
    }
