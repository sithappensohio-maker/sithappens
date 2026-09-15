"""Public-site domain — the logged-out website and the contact questionnaire.

Moved out of server.py unchanged (route paths, request/response shapes, permissions
and error behaviour are identical); only the module that owns them changed.
"""
import re
import uuid

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Any, Dict, List, Literal, Optional

import email_service

# -------- Contact inquiry (public "Tell us about your dog" questionnaire) --------
# The landing page's second door: someone who doesn't yet know whether they
# want daycare, boarding, training or Online School. Saved as an `inquiries`
# row (the authoritative record, surfaced in Action Required), merged into a
# `prospect` client like a Meet & Greet request, and the operator is emailed
# through the durable outbox path. Vocabulary is server-owned so the email,
# the admin list and the public form can never disagree.
INQUIRY_INTERESTS = {
    "daycare": "Daycare",
    "boarding": "Boarding",
    "in_person_training": "In-person training",
    "online_school": "Online School",
    "grooming": "Grooming",
    "not_sure": "Not sure — help me choose",
}
INQUIRY_CONCERNS = {
    "puppy_basics": "Puppy basics",
    "leash_pulling": "Pulling on leash",
    "jumping": "Jumping",
    "barking": "Barking",
    "recall": "Not coming when called",
    "house_training": "House training",
    "separation_anxiety": "Separation anxiety",
    "reactivity": "Reactive to dogs or people",
    "bite_history": "Has growled, snapped, or bitten",
    "other": "Other",
}
INQUIRY_PREFERRED_CONTACT = {"call": "Call", "text": "Text", "email": "Email"}
INQUIRY_START_TIMING = {"asap": "As soon as possible", "next_month": "In the next month", "exploring": "Just exploring"}
INQUIRY_YES_NO_UNSURE = {"yes": "Yes", "no": "No", "not_sure": "Not sure"}
INQUIRY_STATUSES = ("new", "contacted", "closed")


class ContactInquiryIn(BaseModel):
    # Required — who, which dog, what for
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=1, max_length=40)
    preferred_contact: Literal["call", "text", "email"]
    dog_name: str = Field(min_length=1, max_length=80)
    breed: str = Field(min_length=1, max_length=120)
    dog_age: str = Field(min_length=1, max_length=40)
    interests: List[Literal["daycare", "boarding", "in_person_training", "online_school", "grooming", "not_sure"]] = Field(min_length=1)
    concerns: List[Literal["puppy_basics", "leash_pulling", "jumping", "barking", "recall", "house_training",
                           "separation_anxiety", "reactivity", "bite_history", "other"]] = Field(min_length=1)
    message: str = Field(min_length=1, max_length=4000)
    # Optional
    dog_sex: Literal["male", "female", ""] = ""
    fixed: Literal["yes", "no", "not_sure", ""] = ""
    vaccines_current: Literal["yes", "no", "not_sure", ""] = ""
    previous_training: str = Field(default="", max_length=1000)
    household: str = Field(default="", max_length=1000)
    zip: str = Field(default="", max_length=20)
    start_timing: Literal["asap", "next_month", "exploring", ""] = ""
    heard_from: str = Field(default="", max_length=200)
    # Honeypot — hidden on the real form; bots fill it in. Never stored.
    website: str = Field(default="", max_length=500)


class InquiryPatchIn(BaseModel):
    status: Optional[Literal["new", "contacted", "closed"]] = None
    admin_notes: Optional[str] = Field(default=None, max_length=4000)


def _inquiry_labels() -> dict:
    return {
        "interests": INQUIRY_INTERESTS, "concerns": INQUIRY_CONCERNS,
        "preferred_contact": INQUIRY_PREFERRED_CONTACT, "start_timing": INQUIRY_START_TIMING,
        "yes_no_unsure": INQUIRY_YES_NO_UNSURE, "statuses": list(INQUIRY_STATUSES),
    }


def _inquiry_summary_lines(inq: dict) -> List[str]:
    """Plain-language rows shared by the operator email and the prospect note."""
    interests = ", ".join(INQUIRY_INTERESTS.get(i, i) for i in (inq.get("interests") or [])) or "—"
    concerns = ", ".join(INQUIRY_CONCERNS.get(c, c) for c in (inq.get("concerns") or [])) or "—"
    return [f"Interested in: {interests}.", f"Goals / concerns: {concerns}."]


# -------- Public website (logged-out sithappens.app) --------
# The app doubles as the public website. These two endpoints are the only
# data the public pages need that the existing public endpoints don't already
# serve (/public/services, /public/school/storefront, /public/shop/*,
# /settings/public, /branding). Nothing here duplicates a record: business
# info lives in settings, programs in `programs`.

def _public_site_info(s: dict, _default_settings) -> dict:
    site = {**(_default_settings().get("public_site") or {}), **(s.get("public_site") or {})}
    # Legacy flat keys (already used on receipts) win when set.
    if s.get("business_name"):
        site["business_name"] = s["business_name"]
    for key in ("phone", "email"):
        if s.get(key):
            site[key] = s[key]
    if not site.get("map_url"):
        import urllib.parse
        q = ", ".join(x for x in (site.get("address_line"), f"{site.get('city', '')}, {site.get('state', '')} {site.get('zip', '')}".strip(", ")) if x)
        site["map_url"] = "https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote(q) if q else ""
    return site


_PUBLIC_PROGRAM_TYPE_LABELS = {
    "private_lessons": "Private lessons",
    "group_class": "Group classes",
    "day_train": "Day training",
    "board_train": "Board & Train",
    "service_dog": "Service dog training",
}
_PUBLIC_PROGRAM_TYPE_ORDER = {k: i for i, k in enumerate(_PUBLIC_PROGRAM_TYPE_LABELS)}


def register_public_site_routes(
    *, api, db, logger, require_admin_and_permission, get_settings, now_iso,
    enforce_rate_limit, client_ip, default_feature_visibility, stay_policies,
    notify_admin_contact_inquiry, send_contact_inquiry_received, default_settings,
):
    """Register the public website + inquiry routes onto the existing app.

    Pure move out of server.py: identical paths, bodies, permissions and errors.
    The private helper names the moved code already used are bound to the injected
    dependencies here so the bodies themselves did not have to change."""
    _enforce_rate_limit = enforce_rate_limit
    _client_ip = client_ip
    _default_feature_visibility = default_feature_visibility

    @api.get("/public/contact-inquiry-options")
    async def public_contact_inquiry_options():
        """The questionnaire's choices, so the public form renders the same words
        the operator will read in the email and the admin list."""
        return _inquiry_labels()

    @api.post("/public/contact-inquiry")
    async def submit_contact_inquiry(body: ContactInquiryIn, request: Request):
        """Public — no account required. Saves the questionnaire, creates or
        merges a `prospect` client, emails the operator (durable outbox) and sends
        the submitter a short acknowledgement. The submitter's request never fails
        because an email did. Rate-limited like every other unauthenticated write."""
        email = body.email.lower()
        ip = _client_ip(request)
        await _enforce_rate_limit(request, "contact_inquiry_ip", ip, limit=10, window_seconds=3600)
        await _enforce_rate_limit(request, "contact_inquiry_email_ip", f"{ip}|{email}", limit=5, window_seconds=3600)

        if (body.website or "").strip():
            # A bot filled the hidden field. Say "ok" so it learns nothing; keep nothing.
            logger.info("contact_inquiry: honeypot tripped from %s — dropped", ip)
            return {"ok": True}

        name = body.name.strip()
        dog_name = body.dog_name.strip()
        inquiry_id = str(uuid.uuid4())
        received = now_iso()
        inquiry = {
            "id": inquiry_id,
            "created_at": received,
            "status": "new",
            "name": name,
            "email": email,
            "phone": body.phone.strip(),
            "preferred_contact": body.preferred_contact,
            "dog_name": dog_name,
            "breed": body.breed.strip(),
            "dog_age": body.dog_age.strip(),
            "interests": list(dict.fromkeys(body.interests)),
            "concerns": list(dict.fromkeys(body.concerns)),
            "message": body.message.strip(),
            "dog_sex": body.dog_sex,
            "fixed": body.fixed,
            "vaccines_current": body.vaccines_current,
            "previous_training": body.previous_training.strip(),
            "household": body.household.strip(),
            "zip": body.zip.strip(),
            "start_timing": body.start_timing,
            "heard_from": body.heard_from.strip(),
            "admin_notes": "",
            "source_ip": ip,
        }

        # Prospect record — same auto-merge rule as /auth/register and the Meet &
        # Greet form: reuse a client with this email rather than creating a twin.
        note = " ".join([f"Contact inquiry ({received}).", f"Dog: {dog_name}.", *_inquiry_summary_lines(inquiry)])
        existing_client = await db.clients.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0},
        )
        if existing_client:
            client_id = existing_client["id"]
            prior_notes = (existing_client.get("evaluation_notes") or "").strip()
            update_fields = {"evaluation_notes": f"{prior_notes}\n{note}".strip() if prior_notes else note}
            if inquiry["phone"] and not existing_client.get("phone"):
                update_fields["phone"] = inquiry["phone"]
            await db.clients.update_one({"id": client_id}, {"$set": update_fields})
            client_doc = {**existing_client, **update_fields}
            merged = True
        else:
            client_id = str(uuid.uuid4())
            client_doc = {
                "id": client_id, "name": name, "address": "", "phone": inquiry["phone"], "email": email,
                "emerg": "", "credits": 0, "waiver": False, "referred_by_code": None,
                "client_status": "prospect", "evaluation_notes": note, "created_at": received,
            }
            await db.clients.insert_one(dict(client_doc))
            merged = False
        inquiry["client_id"] = client_id
        inquiry["client_merged"] = merged
        await db.inquiries.insert_one(dict(inquiry))

        # Operator alert — durable (outbox retry, notification_log stamp); the
        # `inquiries` row is the authoritative record and is already in Action Required.
        try:
            sent_now = await notify_admin_contact_inquiry(inquiry, _inquiry_labels())
            if not sent_now:
                logger.warning("contact_inquiry: admin alert for %s not sent immediately (queued/skipped — %s)",
                               inquiry_id, email_service.last_send_error)
        except Exception as e:
            logger.error("contact_inquiry: admin alert dispatch crashed for %s: %s", inquiry_id, e)
        try:
            await send_contact_inquiry_received(to_email=email, client_name=name, dog_name=dog_name)
        except Exception as e:
            logger.warning("contact_inquiry: acknowledgement email failed for %s: %s", email, e)

        return {"ok": True, "id": inquiry_id}

    @api.get("/inquiries")
    async def list_inquiries(status: Optional[str] = None, _: dict = Depends(require_admin_and_permission("clients_edit"))):
        q: Dict[str, Any] = {}
        if status and status != "all":
            if status not in INQUIRY_STATUSES:
                raise HTTPException(status_code=400, detail="Unknown status.")
            q["status"] = status
        rows = await db.inquiries.find(q, {"_id": 0, "source_ip": 0}).sort("created_at", -1).to_list(2000)
        counts = {s: await db.inquiries.count_documents({"status": s}) for s in INQUIRY_STATUSES}
        return {"items": rows, "counts": counts, "labels": _inquiry_labels()}

    @api.patch("/inquiries/{inquiry_id}")
    async def update_inquiry(inquiry_id: str, body: InquiryPatchIn, user: dict = Depends(require_admin_and_permission("clients_edit"))):
        row = await db.inquiries.find_one({"id": inquiry_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Inquiry not found.")
        update: Dict[str, Any] = {"updated_at": now_iso(), "updated_by": user.get("name") or user.get("email") or ""}
        if body.status is not None:
            update["status"] = body.status
            if body.status == "contacted" and not row.get("contacted_at"):
                update["contacted_at"] = update["updated_at"]
        if body.admin_notes is not None:
            update["admin_notes"] = body.admin_notes.strip()
        await db.inquiries.update_one({"id": inquiry_id}, {"$set": update})
        row.update(update)
        row.pop("source_ip", None)
        return row

    @api.get("/public/site")
    async def public_site():
        """Everything the logged-out website needs about the business: contact
        details, hours, service area, the photography headline, whether the Meet &
        Greet door is open, and the generated stay policy. Read-only, no auth."""
        s = await get_settings()
        try:
            stay = await stay_policies()
        except Exception as e:  # never let a pricing hiccup blank the homepage
            logger.warning("public_site: stay policy unavailable: %s", e)
            stay = None
        return {
            "site": _public_site_info(s, default_settings),
            "business_hours": s.get("business_hours") or {},
            "photography_page": s.get("photography_page") or {"headline": "Capture the moments worth keeping."},
            "meet_greet_enabled": bool((s.get("meet_greet") or {}).get("enabled", True)),
            "feature_visibility": {**_default_feature_visibility(), **(s.get("feature_visibility") or {})},
            "service_descriptions": s.get("service_descriptions") or {},
            "stay": stay,
        }

    @api.get("/public/training-programs")
    async def public_training_programs():
        """In-person training programs for the public Training page — the same
        `programs` rows admins manage and trainers enroll dogs into. Online School
        programs are served by /public/school/storefront and are excluded here.
        A program stays off the website when it is inactive, dog-specific, or
        marked not publicly visible; its price shows only when show_public_price
        allows and a real price is set."""
        rows = await db.programs.find(
            {
                "active": True,
                "$or": [{"owner_dog_id": None}, {"owner_dog_id": {"$exists": False}}],
                "publicly_visible": {"$ne": False},
                "type": {"$nin": ["self_guided", "online"]},
                "delivery_mode": {"$nin": ["self_guided", "online"]},
            },
            {"_id": 0, "id": 1, "slug": 1, "name": 1, "type": 1, "description": 1, "focus": 1, "format": 1,
             "min_age_months": 1, "prereq_slugs": 1, "price": 1, "show_public_price": 1, "available_online": 1,
             "featured": 1, "image_id": 1, "online_description": 1},
        ).to_list(500)
        name_by_slug = {r.get("slug"): r.get("name") for r in rows if r.get("slug")}
        out = []
        for p in rows:
            price = p.get("price")
            show_price = p.get("show_public_price", True) is not False and isinstance(price, (int, float)) and price > 0
            out.append({
                "id": p.get("id"), "slug": p.get("slug"), "name": p.get("name"),
                "type": p.get("type") or "private_lessons",
                "type_label": _PUBLIC_PROGRAM_TYPE_LABELS.get(p.get("type"), "Training"),
                "description": p.get("description") or "", "focus": p.get("focus") or "",
                "online_description": p.get("online_description") or "",
                "format": p.get("format") or None,
                "min_age_months": p.get("min_age_months"),
                "prerequisites": [name_by_slug.get(sl, sl) for sl in (p.get("prereq_slugs") or [])],
                "price": float(price) if show_price else None,
                "available_online": bool(p.get("available_online")),
                "featured": bool(p.get("featured")),
                "image_url": f"/api/public/shop/media/{p['image_id']}" if p.get("image_id") else None,
            })
        out.sort(key=lambda r: (_PUBLIC_PROGRAM_TYPE_ORDER.get(r["type"], 99), r["name"] or ""))
        return {"programs": out, "type_labels": _PUBLIC_PROGRAM_TYPE_LABELS}

    # The admin inquiry endpoints are also driven in-process by the existing suite
    # (server.list_inquiries / server.update_inquiry), so hand the callables back for
    # server.py to re-export rather than leaving a second copy behind.
    return {"list_inquiries": list_inquiries, "update_inquiry": update_inquiry}
