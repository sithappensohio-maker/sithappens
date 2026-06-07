from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import asyncio
import secrets
import logging
import contextvars
import traceback
from collections import deque
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
from typing import List, Optional, Literal, Dict, Any

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Query, Body, UploadFile, File
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from email_service import (
    notify_admin_new_booking,
    notify_admin_bulk_booking,
    notify_admin_new_client,
    notify_admin_homework_section_log,
    notify_admin_homework_completed,
    notify_admin_first_booking,
    notify_admin_quote_request,
    notify_admin_pl_report,
    notify_client_booking_approved,
    notify_client_certificate_issued,
    notify_client_day_reviewed,
    notify_client_homework_assigned,
    notify_client_low_credits,
    notify_client_pack_receipt,
    notify_client_quote_received,
    send_account_claim,
)
import email_service

from trophy_service import (
    seed_trophies_if_empty,
    award_trophy,
    check_dog_trophies,
    check_client_trophies,
    render_share_card_png,
)
from trophies_data import TIER_COLORS

# -------- Config --------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
DAYCARE_CAPACITY = int(os.environ.get("DAYCARE_CAPACITY", "30"))

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

# Give email_service a handle to the DB so it can look up admin email
# customizations and branding (one-time wire-up — avoids circular imports).
email_service.set_db(db)

app = FastAPI(title="Sit Happens API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("sithappens")


# -------- Recent errors ring buffer --------
# In-memory rolling log of the last 20 unhandled errors so admins can see
# problems on the Settings page without having to SSH into the server.
# Survives nothing beyond a process restart — that's fine for a solo-op CRM.
RECENT_ERRORS: deque = deque(maxlen=20)


# -------- Global exception handler --------
# Logs the full traceback for any unexpected error so issues surface in logs
# instead of being silently returned as opaque 500s.
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    from fastapi import HTTPException as _HTTPExc
    if isinstance(exc, _HTTPExc):
        # Let FastAPI handle expected HTTP errors normally.
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    tb = traceback.format_exc()
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    RECENT_ERRORS.appendleft({
        "id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
        "method": request.method,
        "path": str(request.url.path),
        "type": type(exc).__name__,
        "message": str(exc)[:500],
        "traceback": tb[-2000:],  # last 2KB is plenty for diagnosis
    })
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# -------- Health check (no auth) --------
@api.get("/health")
async def health():
    """Liveness probe for Docker / load balancers. Returns 200 if the API
    process is up and Mongo is reachable."""
    try:
        await db.command("ping")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"mongo unreachable: {e}")


# -------- Helpers --------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Sprint 110bg — Business timezone. The whole app's "today" / "this month" /
# "this week" boundaries are anchored on US Eastern (operator is in Warren OH).
# Storage timestamps remain in UTC (now_iso) so backups & cross-tz queries stay
# consistent — only DAY-LEVEL operator-facing math uses this.
BUSINESS_TZ = ZoneInfo("America/New_York")


def business_today() -> date:
    """Return today's date in the business timezone (US Eastern)."""
    return datetime.now(BUSINESS_TZ).date()


def now_local() -> datetime:
    """Naive local datetime (no tzinfo) — handy for hour/minute comparisons in
    the auto-backup loop where we want wall-clock semantics."""
    return datetime.now(BUSINESS_TZ).replace(tzinfo=None)


# Context-var flag used by bulk-booking endpoints (recurring, multi-dates) to
# suppress the per-booking admin notification. After the bulk loop completes,
# the bulk endpoint sends a SINGLE summary email instead — so the admin gets
# one alert per bulk action, not one per generated date.
_suppress_admin_booking_email: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "suppress_admin_booking_email", default=False
)


async def get_current_user(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    token = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_employee_or_admin(user: dict = Depends(get_current_user)) -> dict:
    """Allow employees and admins through; clients are blocked.
    Use this on any endpoint that staff need (clock-in, today's roster, etc.).
    Sensitive endpoints (income, P&L, settings, billing) keep `require_admin`."""
    if user.get("role") not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


# -------- Models --------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    referred_by_code: Optional[str] = None  # optional referral code from another client

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str
    name: str
    role: str
    client_id: Optional[str] = None

class AuthOut(BaseModel):
    token: str
    user: UserOut

class ClientIn(BaseModel):
    name: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    emerg: Optional[str] = ""
    credits: int = 0  # daycare credits (back-compat — kept as plain `credits` field)
    training_credits: int = 0  # 1-on-1 / lesson credits
    boarding_credits: int = 0  # overnight stay credits — 1 credit = 1 night
    referred_by_code: Optional[str] = None  # set on creation if referred by another client
    photo: Optional[str] = ""  # base64 data URL of the client's profile photo (small avatar). Optional.
    photo_gallery_url: Optional[str] = ""  # per-client link to their photo gallery (e.g. PicTime, Pixieset)
    photo_gallery_pin: Optional[str] = ""  # per-client PIN required to download photos from the gallery
    photo_gallery_has_new: bool = False  # admin-set nudge: pulses a "NEW" badge on the portal gallery CTA
    # Sprint 110aw — Meet-n-Greet / Temperament-eval lifecycle. Default `active`
    # so existing clients aren't affected. When `Settings → evaluation
    # → require_evaluation_first` is on, *new* clients are created as
    # `prospect` and can only book the evaluation service until staff mark them
    # `active` (or `rejected`).
    client_status: Optional[Literal["prospect", "evaluation_scheduled", "evaluated", "active", "rejected"]] = "active"
    evaluation_notes: Optional[str] = ""  # admin notes from the meet-n-greet

class ClientOut(ClientIn):
    id: str
    waiver: bool = False
    portal_email: Optional[str] = None  # the login email of linked user
    dogs: Optional[List[Dict[str, Any]]] = None  # lightweight [{id, name, breed}] for admin listing
    last_login_at: Optional[str] = None  # ISO timestamp of the client's most recent portal login
    login_count: int = 0  # total number of times this client has logged in
    # Sprint 110g — per-pool stamp of the most recent "low credit" email we
    # fired, so the idempotency guard can avoid spamming and the UI can show
    # "client was notified".
    low_credit_emailed_at: Optional[Dict[str, Any]] = None
    created_at: str

class PortalAccountIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)

class Vaccines(BaseModel):
    rabies: Optional[str] = ""  # ISO date
    bordetella: Optional[str] = ""
    dhpp: Optional[str] = ""

class TrainingLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str
    note: str
    tags: List[str] = []

class FeedingItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    time: str = ""           # HH:MM
    amount: str = ""         # "2 cups"
    food_type: str = ""      # "Kibble - Purina Pro Plan"
    notes: str = ""

class MedicationItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    dosage: str = ""
    times: List[str] = []    # ["08:00","20:00"]
    with_food: bool = False
    notes: str = ""

class TrainingSkill(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    level: Literal["intro", "practicing", "reliable", "proofed"] = "intro"
    notes: str = ""
    updated_at: Optional[str] = ""

class DogIn(BaseModel):
    owner_id: str
    name: str
    breed: Optional[str] = ""
    age_y: int = 0
    age_m: int = 0
    birthday: Optional[str] = ""
    sex: Literal["Male", "Female"] = "Male"
    fixed: Literal["Yes", "No"] = "No"
    vaccines: Vaccines = Field(default_factory=Vaccines)
    notes: Optional[str] = ""
    photo: Optional[str] = ""
    feeding_schedule: List[FeedingItem] = []
    medications: List[MedicationItem] = []
    training_skills: List[TrainingSkill] = []
    vet_name: Optional[str] = ""
    vet_phone: Optional[str] = ""
    photos: List[str] = []  # gallery photos (base64)
    tags: List[str] = []  # free-form labels (e.g., 'service_dog_candidate', 'puppy_class')

class DogOut(DogIn):
    id: str
    training_logs: List[TrainingLog] = []
    created_at: str

class TrainingLogIn(BaseModel):
    date: str
    note: str
    tags: List[str] = []

class BookingIn(BaseModel):
    dog_id: str
    date: str  # YYYY-MM-DD
    service_type: Literal["daycare", "boarding", "training", "grooming", "photography"] = "daycare"
    grooming_type: Optional[Literal["bath", "nail_trim"]] = None  # only relevant when service_type=grooming
    end_date: Optional[str] = None  # for boarding
    time: Optional[str] = ""  # HH:MM appointment time — used for training/grooming/photography
    notes: Optional[str] = ""
    kennel: Optional[str] = ""
    dropoff_time: Optional[str] = ""
    pickup_time: Optional[str] = ""
    # Admin-only overrides
    override_vaccines: bool = False
    override_capacity: bool = False
    check_in_now: bool = False
    # Sprint 110an — add-ons selected at booking time. Each id refers to a
    # service whose `is_addon=True` AND whose `addon_for` includes this
    # booking's `service_type`. Prices are resolved server-side at booking
    # time (with legacy-pricing overrides honoured), then snapshotted onto
    # `booking.add_ons` so the rate is locked in even if the catalog
    # changes later.
    addon_service_ids: List[str] = []
    # Sprint 110aw — optional service pre-selection at booking time. Lets the
    # admin link a booking to a specific service row up-front (e.g. a
    # Board-and-Train package). When set, the booking auto-enrolls the dog in
    # any linked training program after insert.
    service_id: Optional[str] = None

class RecurringBookingIn(BaseModel):
    dog_id: str
    start_date: str
    end_date: str  # inclusive end of recurrence window
    service_type: Literal["daycare", "training"] = "daycare"
    weekdays: List[int]  # 0=Mon ... 6=Sun
    notes: Optional[str] = ""

class RescheduleIn(BaseModel):
    date: str
    end_date: Optional[str] = None

class ReportCard(BaseModel):
    photos: List[str] = []          # base64 data URIs
    mood_tags: List[str] = []
    note: Optional[str] = ""
    created_at: Optional[str] = ""
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None

class BookingOut(BaseModel):
    id: str
    dog_id: str
    dog_name: str
    client_id: str
    client_name: str
    date: str
    end_date: Optional[str] = None
    service_type: str
    status: Literal["pending", "approved", "rejected", "completed", "cancelled"]
    notes: Optional[str] = ""
    created_at: str
    checked_in_at: Optional[str] = None
    checked_out_at: Optional[str] = None
    report_card: Optional[ReportCard] = None
    kennel: Optional[str] = ""
    dropoff_time: Optional[str] = ""
    pickup_time: Optional[str] = ""
    time: Optional[str] = ""  # appointment time slot for training/grooming/photography
    duration_minutes: Optional[int] = 0  # blocks the schedule for time-slotted services
    cost: Optional[int] = 0
    grooming_type: Optional[str] = None
    # Income tracking (Sprint 16) — populated when the booking is logged as
    # a paid service. Backward-compatible; existing rows return None / "".
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    actual_price: Optional[float] = None
    payment_status: Optional[Literal["unpaid", "paid", "refunded", "comped"]] = None
    payment_method: Optional[Literal["cash", "card", "transfer", "credits", "check", "other"]] = None
    paid_at: Optional[str] = None
    # Sprint 17 — credit lot tracking. credit_value is accrued at approval,
    # promoted to actual_price at check-out.
    credit_value: Optional[float] = None
    credit_lot_ids: Optional[List[str]] = None
    credit_service_type: Optional[str] = None  # 'daycare' or 'training' — which pool was charged
    # Sprint 29 — add-ons logged at check-out (bath, nail trim, etc.). Each
    # row contributes to `actual_price` and the weekly income tally.
    add_ons: Optional[List[Dict[str, Any]]] = None
    # Sprint 37 — boarding stay extensions logged at check-out. Carries the
    # count, credits used, billed nights, per-night rate and total charge so
    # admin UI / income reports can render the extension cleanly.
    extra_nights: Optional[Dict[str, Any]] = None
    # Sprint 110 — multi-dog household discount applied at check-out.
    multi_dog_discount: Optional[Dict[str, Any]] = None
    # Sprint 94 — silent audit: who/where the check-in / check-out happened.
    checked_in_by: Optional[str] = None
    checked_in_by_name: Optional[str] = None
    checked_in_lat: Optional[float] = None
    checked_in_lng: Optional[float] = None
    checked_in_accuracy_m: Optional[float] = None
    checked_out_by: Optional[str] = None
    checked_out_by_name: Optional[str] = None
    checked_out_lat: Optional[float] = None
    checked_out_lng: Optional[float] = None
    checked_out_accuracy_m: Optional[float] = None
    # Sprint 110as — late-cancel / no-show fee tracking. Set when a staff
    # member cancels with `?forfeit=true` so P&L can count the booking as
    # revenue even though it never happened.
    cancelled_at: Optional[str] = None
    cancellation_charged: Optional[bool] = None
    cancellation_fee: Optional[float] = None
    # Sprint 110aw — Sales tax snapshot. When `sales_tax.enabled` and the
    # service type is in `applies_to`, `actual_price` includes tax and these
    # fields carry the breakdown so year-end filing / reports stay honest.
    tax_amount: Optional[float] = None
    tax_rate_pct: Optional[float] = None
    # Sprint 110aw — Board-and-Train. If the chosen service had a
    # `package_program_id`, this is the id of the auto-created program
    # enrollment for the dog. Helps the UI surface "Training included" badges.
    package_enrolled_program_id: Optional[str] = None
    # Sprint 110ce/cf — prepaid training-program session metadata. Drives the
    # "Reschedule" button on the client portal and the per-session "X of Y"
    # label on the trainer's schedule.
    is_prepaid_program_session: Optional[bool] = None
    program_id: Optional[str] = None
    program_sale_session_index: Optional[int] = None
    program_sale_session_total: Optional[int] = None
    credit_lot_id: Optional[str] = None
    rescheduled_from: Optional[str] = None
    rescheduled_at: Optional[str] = None
    rescheduled_via_request: Optional[str] = None
    # Sprint 110co — Care logs captured by staff on the floor during the
    # visit (feeding/medication confirmations, pee/poop counter). Surfaced
    # alongside the report card so clients can see exactly how their dog
    # was cared for — turns the data into a love-letter for every report.
    feeding_log: Optional[List[Dict[str, Any]]] = None
    medication_log: Optional[List[Dict[str, Any]]] = None
    bathroom_log: Optional[Dict[str, Any]] = None

class ReportCardIn(BaseModel):
    photos: List[str] = []
    mood_tags: List[str] = []
    note: Optional[str] = ""


class CheckoutAddOn(BaseModel):
    """One add-on service tacked on at check-out (bath, nail trim, etc.)."""
    service_id: str
    name: str
    price: float = Field(ge=0)
    qty: int = Field(default=1, ge=1, le=20)


class CheckoutIn(BaseModel):
    """Body for `POST /bookings/{id}/check-out`. All fields optional so existing
    callers (legacy clients) still work — defaults to the previous behaviour:
    use any pre-deducted credits, no add-ons, no payment-method override."""
    use_credits: Optional[bool] = True  # False → refund pre-deducted credits, charge instead
    payment_method: Optional[Literal["cash", "card", "transfer", "credits", "check", "other"]] = None
    payment_status: Optional[Literal["unpaid", "paid"]] = None  # defaults inferred below
    base_price: Optional[float] = None  # override the auto-tally amount for the base service
    add_ons: List[CheckoutAddOn] = []
    # ── Boarding stay extension ──
    # Number of EXTRA nights the dog actually stayed beyond the original end_date.
    # Defaults to 0 (no extension). Updates booking.end_date, optionally consumes
    # additional boarding credits, and bills the difference at checkout.
    extra_nights: int = Field(default=0, ge=0, le=60)
    extra_nights_use_credits: bool = True  # if client has boarding credits, draw from them first
    extra_nights_rate: Optional[float] = None  # per-night rate override; if not provided + credits exhausted, uses booking_rules.boarding_rate
    # ── Geolocation (silent capture) ──
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None


class CheckInIn(BaseModel):
    """Body for `POST /bookings/{id}/check-in` — all optional; carries silent
    geolocation when the caller (admin/employee) provides it."""
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    # Sprint 110an — add-ons selected at check-in (admin Quick Check-in or
    # client-portal check-in). Resolved + appended to booking.add_ons,
    # honouring the legacy-pricing override per add-on.
    addon_service_ids: List[str] = []


class BookingAddonsIn(BaseModel):
    """Body for `POST /bookings/{id}/add-ons` — add-ons attached after the
    booking was created (e.g. client adds a nail trim from the portal,
    or admin tacks one on before check-out). Each id is validated against
    `is_addon` + `addon_for` server-side."""
    addon_service_ids: List[str] = Field(min_length=1, max_length=20)


# -------- Auth --------
@api.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Auto-merge (Sprint 69): if an admin already created a client record with this
    # email and no portal account is linked yet, attach the new user to THAT client
    # instead of creating a duplicate. Skips when the existing client already has
    # a user — that case is handled by the email-uniqueness check above.
    existing_client = await db.clients.find_one(
        {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}},
        {"_id": 0},
    )
    linked_user = None
    if existing_client:
        linked_user = await db.users.find_one(
            {"client_id": existing_client["id"]}, {"_id": 0, "id": 1}
        )

    # Validate referral code (if any) — uppercase, must match an existing client's referral_code
    ref_code: Optional[str] = None
    raw_ref = (body.referred_by_code or "").upper().strip()
    if raw_ref:
        ref = await db.clients.find_one({"referral_code": raw_ref}, {"_id": 0, "id": 1})
        if ref:
            ref_code = raw_ref

    if existing_client and not linked_user:
        # Re-use the admin-created record — preserves dogs, credits, history.
        client_id = existing_client["id"]
        # Only fill in referral_by_code if it's not already set (don't overwrite admin's data).
        if ref_code and not existing_client.get("referred_by_code"):
            await db.clients.update_one(
                {"id": client_id}, {"$set": {"referred_by_code": ref_code}}
            )
        client_doc = existing_client
        merged = True
    else:
        client_id = str(uuid.uuid4())
        client_doc = {
            "id": client_id,
            "name": body.name,
            "address": "",
            "phone": "",
            "email": email,
            "emerg": "",
            "credits": 0,
            "waiver": False,
            "referred_by_code": ref_code,
            "created_at": now_iso(),
        }
        await db.clients.insert_one(client_doc)
        merged = False

    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": "client",
        "client_id": client_id,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    # Best-effort: alert the operator that a new client just signed up (or merged).
    try:
        await notify_admin_new_client(user, {**client_doc, "_merged": merged})
    except Exception:
        pass
    token = create_access_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": {k: user.get(k) for k in ["id", "email", "name", "role", "client_id"]}}


@api.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Record last-login timestamp so admin can see who's actually using the app.
    # Best-effort — don't block the login if this fails.
    try:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"last_login_at": now_iso()}, "$inc": {"login_count": 1}},
        )
    except Exception:
        pass
    token = create_access_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {k: user.get(k) for k in ["id", "email", "name", "role", "client_id"]},
    }


@api.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return user


# -------- Clients --------
@api.get("/clients", response_model=List[ClientOut])
async def list_clients(_: dict = Depends(require_admin)):
    items = await db.clients.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    # Pull all dogs once (without photos) and group by owner — avoids N+1.
    dogs = await db.dogs.find({}, {"_id": 0, "id": 1, "name": 1, "breed": 1, "owner_id": 1}).to_list(2000)
    dogs_by_owner: Dict[str, List[Dict[str, Any]]] = {}
    for d in dogs:
        dogs_by_owner.setdefault(d.get("owner_id", ""), []).append(
            {"id": d.get("id"), "name": d.get("name", ""), "breed": d.get("breed", "")}
        )
    # attach portal email + dogs + last-login info
    for c in items:
        u = await db.users.find_one({"client_id": c["id"]}, {"_id": 0, "email": 1, "last_login_at": 1, "login_count": 1})
        c["portal_email"] = u["email"] if u else None
        c["last_login_at"] = u.get("last_login_at") if u else None
        c["login_count"] = int(u.get("login_count") or 0) if u else 0
        c["dogs"] = sorted(dogs_by_owner.get(c["id"], []), key=lambda x: (x.get("name") or "").lower())
    return items

@api.post("/clients", response_model=ClientOut)
async def create_client(body: ClientIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "waiver": False, "created_at": now_iso()})
    # Normalise referred_by_code: uppercase + strip, drop if invalid (no matching referrer)
    code = (doc.get("referred_by_code") or "").upper().strip()
    if code:
        ref = await db.clients.find_one({"referral_code": code}, {"_id": 0, "id": 1})
        doc["referred_by_code"] = code if ref else None
    else:
        doc["referred_by_code"] = None
    # Sprint 110aw — Meet-n-Greet gate. When the setting is ON and the admin
    # didn't explicitly set a status, default new clients to `prospect`.
    if doc.get("client_status") in (None, "active"):
        settings_x = await get_settings()
        if (settings_x.get("evaluation") or {}).get("require_evaluation_first"):
            doc["client_status"] = "prospect"
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    doc["portal_email"] = None
    return doc


# Sprint 110aw — Dedicated endpoint to advance a client through the
# evaluation pipeline (`prospect` → `evaluation_scheduled` → `evaluated`
# → `active` / `rejected`). Cleaner than dumping into PUT /clients since
# it tracks an audit timestamp + accepts an optional admin note.
class ClientStatusIn(BaseModel):
    status: Literal["prospect", "evaluation_scheduled", "evaluated", "active", "rejected"]
    note: Optional[str] = ""


@api.post("/clients/{client_id}/status", response_model=ClientOut)
async def set_client_status(client_id: str, body: ClientStatusIn, user: dict = Depends(require_admin)):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    update = {
        "client_status": body.status,
        "client_status_set_at": now_iso(),
        "client_status_set_by": user.get("id"),
    }
    if body.note:
        # Append to evaluation_notes, preserving prior notes
        prior = (existing.get("evaluation_notes") or "").strip()
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        new_note = f"[{stamp} · {body.status}] {body.note.strip()}"
        update["evaluation_notes"] = f"{prior}\n{new_note}".strip() if prior else new_note
    await db.clients.update_one({"id": client_id}, {"$set": update})
    existing.update(update)
    u = await db.users.find_one({"client_id": client_id}, {"_id": 0, "email": 1})
    existing["portal_email"] = u["email"] if u else None
    return existing

@api.put("/clients/{client_id}", response_model=ClientOut)
async def update_client(client_id: str, body: ClientIn, _: dict = Depends(require_admin)):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    update = body.model_dump()
    await db.clients.update_one({"id": client_id}, {"$set": update})
    existing.update(update)
    u = await db.users.find_one({"client_id": client_id}, {"_id": 0, "email": 1})
    existing["portal_email"] = u["email"] if u else None
    return existing

@api.get("/clients/{client_id}", response_model=ClientOut)
async def get_client(client_id: str, _: dict = Depends(require_employee_or_admin)):
    """Fetch a single client doc. Used by the checkout modal (admin AND
    employee) to read live credit balances when deciding whether to offer
    'pay with credits'."""
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    u = await db.users.find_one({"client_id": client_id}, {"_id": 0, "email": 1})
    existing["portal_email"] = u["email"] if u else None
    return existing

@api.delete("/clients/{client_id}")
async def delete_client(client_id: str, _: dict = Depends(require_admin)):
    await db.clients.delete_one({"id": client_id})
    await db.dogs.delete_many({"owner_id": client_id})
    await db.users.delete_many({"client_id": client_id})
    return {"ok": True}

@api.post("/clients/{client_id}/portal-account", response_model=UserOut)
async def create_portal_account(client_id: str, body: PortalAccountIn, _: dict = Depends(require_admin)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing and existing.get("client_id") != client_id:
        raise HTTPException(status_code=400, detail="Email already used")
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": {"password_hash": hash_password(body.password)}})
        u = await db.users.find_one({"id": existing["id"]}, {"_id": 0, "password_hash": 0})
        return u
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": client["name"],
        "role": "client",
        "client_id": client_id,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    user.pop("password_hash", None)
    user.pop("_id", None)
    return user


# -------- Account Claim (email-based password setup) --------
CLAIM_TOKEN_EXPIRY_DAYS = 7


def _build_claim_url(token: str) -> str:
    base = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
    if not base:
        return f"/claim/{token}"
    return f"{base}/claim/{token}"


class ClaimVerifyOut(BaseModel):
    valid: bool
    client_name: Optional[str] = None
    email: Optional[str] = None
    is_reset: bool = False
    expires_at: Optional[str] = None


class ClaimSetIn(BaseModel):
    password: str = Field(min_length=6)


# -------- Client files (Sprint 84) --------
# Admin uploads PDFs, photos, short videos to a specific client. Optionally
# tags to a specific dog (e.g. "Rocky's loose-leash homework"). Clients see
# them in the portal under a "Training Files & Homework" section.
#
# Storage: base64 inline in Mongo for consistency with existing photo storage.
# Capped at 10 MB per file to keep doc size sane.
CLIENT_FILE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB

class ClientFileIn(BaseModel):
    name: str
    content_type: str
    data: str  # base64-encoded content (data URI or raw base64 both accepted)
    note: Optional[str] = ""
    dog_id: Optional[str] = None  # optional — file tagged to a specific dog

def _strip_data_uri(s: str) -> str:
    """Accept either a raw base64 string or a `data:...;base64,...` URI."""
    if s.startswith("data:") and ";base64," in s:
        return s.split(";base64,", 1)[1]
    return s

@api.post("/clients/{client_id}/files")
async def upload_client_file(client_id: str, body: ClientFileIn, user: dict = Depends(require_admin)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    raw_b64 = _strip_data_uri(body.data or "")
    if not raw_b64:
        raise HTTPException(status_code=400, detail="File is empty.")
    # Approximate byte count from base64 length (4 chars → 3 bytes)
    approx_bytes = (len(raw_b64) * 3) // 4
    if approx_bytes > CLIENT_FILE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large. Max {CLIENT_FILE_MAX_BYTES // (1024*1024)} MB.")
    if body.dog_id:
        # Verify the dog belongs to this client (so admin can't accidentally tag the wrong dog)
        owned = await db.dogs.find_one({"id": body.dog_id, "owner_id": client_id}, {"_id": 0, "id": 1})
        if not owned:
            raise HTTPException(status_code=400, detail="That dog doesn't belong to this client.")
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "dog_id": body.dog_id,
        "name": (body.name or "untitled").strip()[:160],
        "content_type": (body.content_type or "application/octet-stream").strip()[:120],
        "data": raw_b64,
        "size_bytes": approx_bytes,
        "note": (body.note or "").strip()[:500],
        "uploaded_at": now_iso(),
        "uploaded_by": user.get("name", "admin"),
    }
    await db.client_files.insert_one(doc)
    # Return without the base64 payload — front end fetches that on demand
    return {k: doc[k] for k in doc if k not in ("data", "_id")}

@api.get("/clients/{client_id}/files")
async def list_client_files(client_id: str, _: dict = Depends(require_admin)):
    files = await db.client_files.find(
        {"client_id": client_id},
        {"_id": 0, "data": 0},  # exclude base64 payload — fetched per file on download
    ).sort("uploaded_at", -1).to_list(500)
    return files

@api.get("/portal/files")
async def list_my_files(user: dict = Depends(get_current_user)):
    """Client portal — lists files the admin has uploaded to this client.
    Excludes the base64 payload; clients click an item to download it."""
    if not user.get("client_id"):
        return []
    files = await db.client_files.find(
        {"client_id": user["client_id"]},
        {"_id": 0, "data": 0},
    ).sort("uploaded_at", -1).to_list(500)
    return files

@api.get("/files/{file_id}/download")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    """Fetch the actual file bytes. Admin OR the owner client only."""
    f = await db.client_files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    is_admin = user.get("role") == "admin"
    is_owner = user.get("client_id") and user["client_id"] == f["client_id"]
    if not (is_admin or is_owner):
        raise HTTPException(status_code=403, detail="Not your file.")
    return {
        "id": f["id"],
        "name": f["name"],
        "content_type": f["content_type"],
        "data": f["data"],  # raw base64
        "size_bytes": f.get("size_bytes", 0),
    }

@api.delete("/files/{file_id}")
async def delete_file(file_id: str, _: dict = Depends(require_admin)):
    res = await db.client_files.delete_one({"id": file_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}



# -------- Bookings cold-storage archive (Sprint 88) --------
# Completed / cancelled / rejected bookings older than ARCHIVE_AFTER_DAYS get
# moved out of the hot `bookings` collection into `bookings_archive`. Keeps
# the main collection snappy and the active queue uncluttered while preserving
# every historical record for tax/legal/customer-history lookups.
ARCHIVE_AFTER_DAYS = 90
ARCHIVE_TERMINAL_STATUSES = ["completed", "cancelled", "canceled", "rejected"]

async def _archive_old_bookings_once() -> dict:
    """Move terminal-status bookings whose `date` is older than the cutoff out
    of `bookings` and into `bookings_archive`. Idempotent — safe to call as
    often as you like."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=ARCHIVE_AFTER_DAYS)).strftime("%Y-%m-%d")
    cursor = db.bookings.find(
        {"status": {"$in": ARCHIVE_TERMINAL_STATUSES}, "date": {"$lt": cutoff}},
        {"_id": 0},
    )
    moved = 0
    async for b in cursor:
        b["archived_at"] = now_iso()
        try:
            await db.bookings_archive.insert_one(b)
            await db.bookings.delete_one({"id": b["id"]})
            moved += 1
        except Exception as e:
            logger.warning("archive: failed for booking %s: %s", b.get("id"), e)
    return {"moved": moved, "cutoff_date": cutoff}

@api.post("/admin/bookings/archive-now")
async def archive_now(_: dict = Depends(require_admin)):
    """Manual trigger. Background scheduler also runs this nightly."""
    return await _archive_old_bookings_once()

# Once-per-UTC-day guard so we don't re-archive on every dashboard load.
async def _maybe_archive_today():
    try:
        today = business_today().isoformat()
        marker = await db.system_runs.find_one({"_id": "archive_bookings"})
        if marker and marker.get("date") == today:
            return
        result = await _archive_old_bookings_once()
        await db.system_runs.update_one(
            {"_id": "archive_bookings"},
            {"$set": {"date": today, "ran_at": now_iso(), "moved": result["moved"]}},
            upsert=True,
        )
        if result["moved"]:
            logger.info("Archived %d old bookings (cutoff %s)", result["moved"], result["cutoff_date"])
    except Exception as e:
        logger.warning("auto-archive failed (non-fatal): %s", e)

@api.get("/admin/bookings/archive")
async def list_archived(skip: int = 0, limit: int = 100, _: dict = Depends(require_admin)):
    """Paged read of the archive. Newest archived first."""
    total = await db.bookings_archive.count_documents({})
    items = await db.bookings_archive.find({}, {"_id": 0}).sort("archived_at", -1).skip(int(skip)).limit(int(limit)).to_list(int(limit))
    return {"total": total, "skip": skip, "limit": limit, "items": items}




@api.post("/clients/send-claim-emails/bulk")
async def send_claim_emails_bulk(_: dict = Depends(require_admin)):
    """Send a claim email to EVERY client who has an email on file but no
    portal user yet. Designed for one-shot recovery after a data migration
    (e.g. moving off Emergent) where login credentials weren't preserved.

    Returns a per-client breakdown so the admin can see exactly who got an
    email, who was skipped (no email), and who errored."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(2000)
    # Build the set of client_ids that already have a portal user — these get skipped
    # (re-sending a reset to them would still work, but the intent of this button is
    # to onboard people who can't log in at all).
    users_with_link = await db.users.find({"client_id": {"$ne": None}}, {"_id": 0, "client_id": 1}).to_list(5000)
    linked_ids = {u["client_id"] for u in users_with_link if u.get("client_id")}

    sent: List[Dict[str, Any]] = []
    skipped_no_email: List[Dict[str, Any]] = []
    skipped_already_linked: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for c in clients:
        target_email = (c.get("email") or "").strip().lower()
        if not target_email:
            skipped_no_email.append({"id": c["id"], "name": c.get("name", "")})
            continue
        if c["id"] in linked_ids:
            skipped_already_linked.append({"id": c["id"], "name": c.get("name", ""), "email": target_email})
            continue
        try:
            # Mint a fresh token (invalidate any previously unused ones for safety)
            await db.claim_tokens.delete_many({"client_id": c["id"], "used": False})
            token = secrets.token_urlsafe(32)
            expires_at = datetime.now(timezone.utc) + timedelta(days=CLAIM_TOKEN_EXPIRY_DAYS)
            await db.claim_tokens.insert_one({
                "token": token,
                "client_id": c["id"],
                "email": target_email,
                "is_reset": False,
                "used": False,
                "created_at": now_iso(),
                "expires_at": expires_at.isoformat(),
            })
            claim_url = _build_claim_url(token)
            await send_account_claim(
                to_email=target_email,
                client_name=c.get("name", ""),
                claim_url=claim_url,
                is_reset=False,
                expires_days=CLAIM_TOKEN_EXPIRY_DAYS,
            )
            sent.append({"id": c["id"], "name": c.get("name", ""), "email": target_email})
        except Exception as e:
            logger.warning("bulk-claim: failed for %s (%s): %s", c.get("name"), target_email, e)
            errors.append({"id": c["id"], "name": c.get("name", ""), "email": target_email, "error": str(e)[:200]})

    return {
        "ok": True,
        "total_clients": len(clients),
        "sent_count": len(sent),
        "skipped_no_email_count": len(skipped_no_email),
        "skipped_already_linked_count": len(skipped_already_linked),
        "errors_count": len(errors),
        "sent": sent,
        "skipped_no_email": skipped_no_email,
        "skipped_already_linked": skipped_already_linked,
        "errors": errors,
    }


@api.post("/clients/{client_id}/send-claim-email")
async def send_claim_email(client_id: str, _: dict = Depends(require_admin)):
    """Generate a one-time claim/reset token for this client and email it.
    Re-callable any time — issuing a new token invalidates older unused ones."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    target_email = (client.get("email") or "").strip().lower()
    if not target_email:
        raise HTTPException(
            status_code=400,
            detail="This client has no email on file. Add an email first.",
        )

    existing_user = await db.users.find_one({"client_id": client_id})
    is_reset = bool(existing_user)
    if existing_user:
        target_email = existing_user["email"]

    await db.claim_tokens.delete_many({"client_id": client_id, "used": False})

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=CLAIM_TOKEN_EXPIRY_DAYS)
    await db.claim_tokens.insert_one({
        "token": token,
        "client_id": client_id,
        "email": target_email,
        "is_reset": is_reset,
        "used": False,
        "created_at": now_iso(),
        "expires_at": expires_at.isoformat(),
    })

    claim_url = _build_claim_url(token)
    try:
        await send_account_claim(
            to_email=target_email,
            client_name=client.get("name", ""),
            claim_url=claim_url,
            is_reset=is_reset,
            expires_days=CLAIM_TOKEN_EXPIRY_DAYS,
        )
    except Exception as e:
        logger.warning("send_claim_email: failed to dispatch email to %s: %s", target_email, e)

    return {
        "ok": True,
        "is_reset": is_reset,
        "sent_to": target_email,
        "expires_at": expires_at.isoformat(),
    }


@api.get("/claim/{token}", response_model=ClaimVerifyOut)
async def verify_claim_token(token: str):
    """Public — verify a claim/reset token and return who it's for."""
    rec = await db.claim_tokens.find_one({"token": token, "used": False}, {"_id": 0})
    if not rec:
        return ClaimVerifyOut(valid=False)
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except Exception:
        return ClaimVerifyOut(valid=False)
    if datetime.now(timezone.utc) > exp:
        return ClaimVerifyOut(valid=False)
    # Look up display name: prefer client name (if token tied to a client),
    # fall back to user.name (used for admin/staff resets without a client_id).
    display_name = ""
    if rec.get("client_id"):
        client = await db.clients.find_one({"id": rec["client_id"]}, {"_id": 0, "name": 1})
        display_name = (client or {}).get("name", "")
    elif rec.get("user_id"):
        u = await db.users.find_one({"id": rec["user_id"]}, {"_id": 0, "name": 1})
        display_name = (u or {}).get("name", "")
    return ClaimVerifyOut(
        valid=True,
        client_name=display_name,
        email=rec.get("email", ""),
        is_reset=bool(rec.get("is_reset", False)),
        expires_at=rec.get("expires_at"),
    )


@api.post("/claim/{token}", response_model=AuthOut)
async def consume_claim_token(token: str, body: ClaimSetIn):
    """Public — set the password using a valid claim/reset token and auto-log in.
    Handles three cases:
      1. Token tied to a client_id + existing portal user → update user's password.
      2. Token tied to a client_id only (no user yet)     → create the portal user.
      3. Token tied to a user_id (no client_id)           → admin/staff password reset.
    """
    rec = await db.claim_tokens.find_one({"token": token, "used": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="This link is invalid or has already been used.")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="This link is invalid.")
    if datetime.now(timezone.utc) > exp:
        raise HTTPException(status_code=400, detail="This link has expired. Request a new password reset.")

    client_id = rec.get("client_id")
    user_id_on_token = rec.get("user_id")
    email = (rec.get("email") or "").lower()
    new_hash = hash_password(body.password)

    # Case 3: admin/staff reset — token tied directly to a user_id, no client.
    if user_id_on_token and not client_id:
        existing_user = await db.users.find_one({"id": user_id_on_token})
        if not existing_user:
            raise HTTPException(status_code=400, detail="That account no longer exists.")
        await db.users.update_one(
            {"id": existing_user["id"]},
            {"$set": {"password_hash": new_hash}},
        )
        await db.claim_tokens.update_one({"token": token}, {"$set": {"used": True, "used_at": now_iso()}})
        access = create_access_token(existing_user["id"], existing_user["email"], existing_user.get("role", "admin"))
        return AuthOut(
            token=access,
            user=UserOut(
                id=existing_user["id"],
                email=existing_user["email"],
                name=existing_user.get("name", ""),
                role=existing_user.get("role", "admin"),
                client_id=existing_user.get("client_id"),
            ),
        )

    # Cases 1 + 2: client claim or client reset — token tied to client_id.
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=400, detail="The client account no longer exists.")

    existing_user = await db.users.find_one({"client_id": client_id})

    if existing_user:
        await db.users.update_one(
            {"id": existing_user["id"]},
            {"$set": {"password_hash": new_hash}},
        )
        user_id = existing_user["id"]
        user_email = existing_user["email"]
        user_name = existing_user.get("name") or client.get("name", "")
    else:
        conflict = await db.users.find_one({"email": email})
        if conflict:
            raise HTTPException(status_code=400, detail="This email is already in use. Contact your trainer.")
        user_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": user_id,
            "email": email,
            "password_hash": new_hash,
            "name": client.get("name", email),
            "role": "client",
            "client_id": client_id,
            "created_at": now_iso(),
        })
        user_email = email
        user_name = client.get("name", email)

    await db.claim_tokens.update_one({"token": token}, {"$set": {"used": True, "used_at": now_iso()}})

    access = create_access_token(user_id, user_email, "client")
    return AuthOut(
        token=access,
        user=UserOut(id=user_id, email=user_email, name=user_name, role="client", client_id=client_id),
    )


# -------- Public forgot-password (self-service for everyone) --------
class ForgotPasswordIn(BaseModel):
    email: str

@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Public — anyone can request a password reset for their email.
    For security, ALWAYS returns ok regardless of whether the email exists.
    This prevents attackers from probing the DB for valid emails."""
    email = (body.email or "").strip().lower()
    if not email:
        return {"ok": True}

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        # Don't leak the existence/non-existence of accounts.
        return {"ok": True}

    # Mint a fresh token and invalidate any old unused ones for this user.
    await db.claim_tokens.delete_many({
        "$or": [
            {"user_id": user["id"], "used": False},
            {"client_id": user.get("client_id"), "used": False} if user.get("client_id") else {"_unused": True},
        ]
    })
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=CLAIM_TOKEN_EXPIRY_DAYS)
    await db.claim_tokens.insert_one({
        "token": token,
        "user_id": user["id"],
        "client_id": user.get("client_id"),  # may be None for admins
        "email": email,
        "is_reset": True,
        "used": False,
        "created_at": now_iso(),
        "expires_at": expires_at.isoformat(),
    })

    claim_url = _build_claim_url(token)
    display_name = user.get("name") or ""
    if user.get("client_id") and not display_name:
        c = await db.clients.find_one({"id": user["client_id"]}, {"_id": 0, "name": 1})
        display_name = (c or {}).get("name", "")
    try:
        await send_account_claim(
            to_email=email,
            client_name=display_name,
            claim_url=claim_url,
            is_reset=True,
            expires_days=CLAIM_TOKEN_EXPIRY_DAYS,
        )
    except Exception as e:
        logger.warning("forgot_password: email dispatch failed for %s: %s", email, e)

    return {"ok": True}




# -------- Dogs --------
async def _resolve_client_scope(user: dict) -> Optional[str]:
    """Return client_id if user is a client (to filter), None if admin (no filter)."""
    if user.get("role") == "admin":
        return None
    return user.get("client_id")

@api.get("/dogs", response_model=List[DogOut])
async def list_dogs(user: dict = Depends(get_current_user)):
    scope = await _resolve_client_scope(user)
    q = {} if scope is None else {"owner_id": scope}
    # Strip gallery photos from list payload — they balloon the response when
    # multiple dogs have 5+ images each. Detail endpoint `/dogs/{id}` returns
    # the full record (with gallery) for the edit modal.
    items = await db.dogs.find(q, {"_id": 0, "photos": 0}).sort("name", 1).to_list(1000)
    return items


@api.get("/dogs/{dog_id}", response_model=DogOut)
async def get_dog(dog_id: str, user: dict = Depends(get_current_user)):
    """Full dog record including gallery photos. Use this when the user
    opens the edit modal so the list endpoint can stay lightweight."""
    scope = await _resolve_client_scope(user)
    q = {"id": dog_id} if scope is None else {"id": dog_id, "owner_id": scope}
    dog = await db.dogs.find_one(q, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    return dog

@api.post("/dogs", response_model=DogOut)
async def create_dog(body: DogIn, _: dict = Depends(require_admin)):
    client = await db.clients.find_one({"id": body.owner_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Owner not found")
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "training_logs": [], "created_at": now_iso()})
    await db.dogs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/dogs/{dog_id}", response_model=DogOut)
async def update_dog(dog_id: str, body: DogIn, _: dict = Depends(require_admin)):
    existing = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Dog not found")
    update = body.model_dump()
    await db.dogs.update_one({"id": dog_id}, {"$set": update})
    existing.update(update)
    return existing

@api.delete("/dogs/{dog_id}")
async def delete_dog(dog_id: str, _: dict = Depends(require_admin)):
    await db.dogs.delete_one({"id": dog_id})
    return {"ok": True}

@api.post("/dogs/{dog_id}/training-logs", response_model=DogOut)
async def add_training_log(dog_id: str, body: TrainingLogIn, _: dict = Depends(require_admin)):
    existing = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Dog not found")
    log = TrainingLog(date=body.date, note=body.note, tags=body.tags).model_dump()
    await db.dogs.update_one({"id": dog_id}, {"$push": {"training_logs": log}})
    existing["training_logs"] = existing.get("training_logs", []) + [log]
    # If a `sessions` completion rule is configured on the active enrollment,
    # this new log might tip it over the threshold — check now.
    active_id = existing.get("active_program_id")
    if active_id:
        enrollment = await db.dog_programs.find_one({"id": active_id}, {"_id": 0})
        if enrollment and enrollment.get("status") == "active":
            rule = enrollment.get("completion_rule") or {}
            if rule.get("type") == "sessions":
                started = enrollment.get("started_at", "")[:10]
                logs_since = [
                    lg for lg in existing["training_logs"]
                    if (lg.get("date") or "") >= started
                ]
                await _auto_complete_if_satisfied(enrollment, sessions_logged=len(logs_since))
    return existing


# -------- Bookings --------
def _dates_in_range(start: str, end: Optional[str]) -> List[str]:
    s = datetime.fromisoformat(start).date()
    e = datetime.fromisoformat(end).date() if end else s
    if e < s:
        e = s
    out = []
    cur = s
    while cur <= e:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out

async def _booking_days_count(target_date: str) -> int:
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending"]}}, {"_id": 0}
    ).to_list(2000)
    count = 0
    for b in bookings:
        days = _dates_in_range(b["date"], b.get("end_date"))
        if target_date in days:
            count += 1
    return count

@api.get("/bookings", response_model=List[BookingOut])
async def list_bookings(
    user: dict = Depends(get_current_user),
    status_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_all: bool = False,
):
    """Lists bookings. By default returns a tight rolling window (90 days
    back to 90 days forward) so admin screens stay snappy as historical
    bookings pile up. Pass `include_all=true` for the full table (CSV
    exports, reconciliation) or `start_date` / `end_date` for a custom range."""
    q: Dict = {}
    if status_filter:
        q["status"] = status_filter
    # Admins + employees see all bookings (employees need this to run the
    # facility). Clients see only their own.
    if user.get("role") == "client":
        q["client_id"] = user.get("client_id")
    if not include_all:
        if not start_date:
            start_date = (business_today() - timedelta(days=90)).isoformat()
        if not end_date:
            end_date = (business_today() + timedelta(days=90)).isoformat()
        q["date"] = {"$gte": start_date, "$lte": end_date}
    items = await db.bookings.find(q, {"_id": 0}).sort("date", 1).to_list(3000)
    return items

def _service_cost(rules: dict, service_type: str, days: int) -> int:
    # Credits only apply to daycare. Boarding and training are pay-on-the-day.
    if service_type == "daycare":
        return int(rules.get("daycare_cost", 1)) * max(days, 1)
    return 0


async def _validate_dog_vaccines(dog: dict, required: List[str]) -> None:
    today = business_today().isoformat()
    vaccines = dog.get("vaccines") or {}
    for v in required:
        d = vaccines.get(v, "")
        if not d or d < today:
            raise HTTPException(status_code=400, detail=f"{v.title()} vaccine missing or expired")


@api.post("/bookings", response_model=BookingOut)
async def create_booking(body: BookingIn, user: dict = Depends(get_current_user)):
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog["owner_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    settings = await get_settings()
    rules = settings.get("booking_rules", {})
    required = settings.get("required_vaccines", ["rabies"])
    daycare_cap = int(settings.get("daycare_capacity", DAYCARE_CAPACITY))
    boarding_cap = int(settings.get("boarding_capacity", 10))

    # Sprint 110aw — Meet-n-Greet gate. Prospect / rejected clients cannot
    # book regular services; admin can override by passing the booking through
    # manually with `override_capacity=True` (treated as a force-flag).
    cstat = client.get("client_status") or "active"
    if cstat in ("prospect", "evaluation_scheduled", "rejected"):
        # Admin override path: respect explicit override_capacity intent so
        # admin can still schedule the evaluation booking itself.
        if user.get("role") != "admin" or not body.override_capacity:
            if cstat == "rejected":
                raise HTTPException(
                    status_code=400,
                    detail="This client has been marked rejected — bookings are disabled.",
                )
            raise HTTPException(
                status_code=400,
                detail="This client needs to complete a Meet-n-Greet evaluation before booking. Please schedule one first.",
            )

    # Waiver check for clients
    if user.get("role") != "admin" and bool(settings.get("waiver_required_for_booking", True)):
        sig = await db.waiver_signatures.find_one({"client_id": client["id"]}, sort=[("signed_at", -1)])
        current_version = int(settings.get("waiver_version", 1))
        if not sig or int(sig.get("waiver_version", 1)) < current_version:
            raise HTTPException(status_code=400, detail="Waiver must be signed before booking")

    # Vaccine check (multi-vaccine via settings)
    is_admin = user.get("role") == "admin"
    if not (is_admin and body.override_vaccines):
        await _validate_dog_vaccines(dog, required)

    # Closed-day enforcement (clients only — admin can override by creating manually).
    # Blocks any booking whose start date OR any day in its range falls on a closed date.
    if not is_admin:
        closed = set(settings.get("closed_dates") or [])
        if closed:
            booking_dates = _dates_in_range(body.date, body.end_date)
            hit = [d for d in booking_dates if d in closed]
            if hit:
                pretty = ", ".join(hit[:3]) + ("…" if len(hit) > 3 else "")
                raise HTTPException(status_code=400, detail=f"Sit Happens is closed on {pretty}. Please pick another date.")

    # Advance-booking limit (clients only) — exempt daycare so regulars can
    # set up long-running recurring schedules without bumping the global cap.
    if user.get("role") != "admin" and body.service_type != "daycare":
        max_adv = int(rules.get("max_advance_days", 60))
        if max_adv > 0:
            limit_date = (business_today() + timedelta(days=max_adv)).isoformat()
            if body.date > limit_date:
                raise HTTPException(status_code=400, detail=f"Bookings allowed up to {max_adv} days in advance")

    # Capacity check
    if not (is_admin and body.override_capacity):
        if body.service_type == "daycare":
            if await _booking_days_count_filtered(body.date, "daycare") >= daycare_cap:
                raise HTTPException(status_code=400, detail="Daycare is fully booked for that date")
        elif body.service_type == "boarding":
            if await _booking_days_count_filtered(body.date, "boarding") >= boarding_cap:
                raise HTTPException(status_code=400, detail="Boarding is fully booked for that date")

    # Time-slot conflict check for time-based services. Shared pool: a Training
    # at 2pm blocks a Grooming at 2pm, etc. Admins can override.
    duration_minutes_used = 0
    if body.service_type in TIME_SLOTTED_SERVICES and (body.time or "").strip():
        duration_minutes_used = await _get_default_duration(body.service_type)
        if not (is_admin and body.override_capacity) and duration_minutes_used > 0:
            new_start = _hhmm_to_min(body.time)
            if new_start is not None:
                existing_slots = await db.bookings.find(
                    {
                        "date": body.date,
                        "status": {"$in": ["pending", "approved", "completed"]},
                        "service_type": {"$in": list(TIME_SLOTTED_SERVICES)},
                        "time": {"$ne": ""},
                    },
                    {"_id": 0, "time": 1, "service_type": 1, "duration_minutes": 1, "dog_name": 1},
                ).to_list(500)
                for b in existing_slots:
                    bstart = _hhmm_to_min(b.get("time") or "")
                    if bstart is None:
                        continue
                    bdur = int(b.get("duration_minutes") or 0) or await _get_default_duration(b.get("service_type"))
                    if _slot_overlaps(new_start, duration_minutes_used, bstart, bdur):
                        raise HTTPException(
                            status_code=400,
                            detail=f"That time conflicts with an existing {b.get('service_type')} appointment at {b.get('time')}.",
                        )

    # Credit cost — daycare only; boarding/training are pay-on-the-day.
    # Clients can book even with 0 credits (they'll settle on arrival); credits
    # are deducted on approval IF they have any (otherwise the booking is approved
    # with a balance owed at drop-off — admin tracks it manually).
    days = _dates_in_range(body.date, body.end_date)
    cost = _service_cost(rules, body.service_type, len(days))

    auto_approve = bool(rules.get("auto_approve", False))
    status_val = "approved" if (is_admin or auto_approve) else "pending"

    doc = {
        "id": str(uuid.uuid4()),
        "dog_id": dog["id"],
        "dog_name": dog["name"],
        "client_id": client["id"],
        "client_name": client["name"],
        "date": body.date,
        "end_date": body.end_date,
        "service_type": body.service_type,
        "grooming_type": body.grooming_type if body.service_type == "grooming" else None,
        "status": status_val,
        "notes": body.notes or "",
        "kennel": body.kennel or "",
        "time": body.time or "",
        "duration_minutes": duration_minutes_used,  # snapshot for future conflict checks
        "dropoff_time": body.dropoff_time or "",
        "pickup_time": body.pickup_time or "",
        "created_at": now_iso(),
        "cost": cost,
    }
    if is_admin and body.check_in_now:
        doc["checked_in_at"] = now_iso()
    # NOTE: credits are no longer deducted at booking time or on approval —
    # they're only deducted at checkout (see check_out()). This makes credit
    # use predictable and prevents accidental deductions for bookings that get
    # rescheduled, cancelled before drop-off, or paid with cash on the day.
    doc["credits_deducted"] = 0
    # Sprint 110an — attach any add-ons the client picked at booking time
    # (e.g. "Add a nail trim with my daycare"). Snapshots include price &
    # legacy-pricing override so the rate is locked in for this booking.
    if body.addon_service_ids:
        doc["add_ons"] = await resolve_addon_snapshots(
            client.get("id"),
            body.addon_service_ids,
            body.service_type,
        )
    # Sprint 110aw — Optional service pre-selection. When the caller picks a
    # specific service row (e.g. a Board-and-Train package), snapshot it onto
    # the booking so check-out / auto-enroll can use it.
    if body.service_id:
        svc_row = await db.services.find_one(
            {"id": body.service_id},
            {"_id": 0, "id": 1, "name": 1, "base_price": 1},
        )
        if svc_row:
            doc["service_id"] = svc_row["id"]
            doc["service_name"] = svc_row.get("name")
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    # Sprint 110aw — Board-and-Train: if the chosen service is wired to a
    # training program, auto-enroll the dog. Idempotent — skips if the dog
    # is already actively enrolled in that program.
    try:
        if doc.get("service_id"):
            svc_row = await db.services.find_one(
                {"id": doc["service_id"]},
                {"_id": 0, "package_program_id": 1, "name": 1},
            )
            prog_id = (svc_row or {}).get("package_program_id")
            if prog_id:
                existing_active = await db.dog_programs.find_one(
                    {"dog_id": doc["dog_id"], "program_id": prog_id, "status": "active"},
                    {"_id": 0, "id": 1},
                )
                if not existing_active:
                    program = await db.programs.find_one({"id": prog_id}, {"_id": 0})
                    if program:
                        started = doc.get("date") or business_today().isoformat()
                        target = _suggest_target_date(started, program.get("format") or {})
                        enrollment = {
                            "id": _gid(),
                            "dog_id": doc["dog_id"],
                            "program_id": prog_id,
                            "program_snapshot": {
                                "name": program["name"],
                                "type": program.get("type"),
                                "slug": program.get("slug"),
                                "description": program.get("description", ""),
                                "focus": program.get("focus", ""),
                                "format": program.get("format"),
                                "modules": program.get("modules") or [],
                                "completion_rule": program.get("completion_rule") or _default_completion_rule(),
                            },
                            "status": "active",
                            "started_at": started,
                            "target_completion_date": target,
                            "completed_at": None,
                            "on_hold_at": None,
                            "goal_progress": _empty_progress(program.get("modules") or []),
                            "sessions_count": 0,
                            "trainer_notes": f"Auto-enrolled from Board-and-Train package · booking {doc['id']}",
                            "created_at": now_iso(),
                            "source_booking_id": doc["id"],
                        }
                        await db.dog_programs.insert_one(enrollment)
                        if not (await db.dogs.find_one({"id": doc["dog_id"]}, {"_id": 0, "active_program_id": 1}) or {}).get("active_program_id"):
                            await db.dogs.update_one(
                                {"id": doc["dog_id"]},
                                {"$set": {"active_program_id": enrollment["id"]}},
                            )
                        doc["package_enrolled_program_id"] = enrollment["id"]
                        await db.bookings.update_one(
                            {"id": doc["id"]},
                            {"$set": {"package_enrolled_program_id": enrollment["id"]}},
                        )
    except Exception as exc:
        logger.warning("board-and-train auto-enroll failed for booking %s: %s", doc.get("id"), exc)
    # Best-effort notification: tell admin when a client books from the portal.
    # Admin-created bookings (via Quick Check-in etc.) don't trigger an alert to themselves.
    # In bulk-create flows (recurring / multi-dates), this is suppressed and the
    # bulk endpoint sends ONE summary email after the loop.
    if not is_admin and not _suppress_admin_booking_email.get():
        try:
            await notify_admin_new_booking(doc, client)
        except Exception:
            pass
    # 🎉 First-ever booking for this client? Send a celebratory email to the operator,
    # and if they came in via a referral code, the referrer is auto-credited on
    # this client's FIRST CHECKOUT — see check_out() below.
    try:
        booking_count = await db.bookings.count_documents({"client_id": client["id"]})
        if booking_count == 1:
            await notify_admin_first_booking(doc, client)
    except Exception:
        pass
    return doc


@api.get("/admin/vaccine-cert-uploads")
async def admin_list_vaccine_uploads(include_reviewed: bool = False, _: dict = Depends(require_admin)):
    """List recent client-uploaded vaccine certificates. Unreviewed first."""
    dogs = await db.dogs.find(
        {"vaccine_certs": {"$exists": True, "$ne": {}}},
        {"_id": 0, "id": 1, "name": 1, "owner_id": 1, "vaccine_certs": 1, "vaccines": 1},
    ).to_list(500)
    out = []
    for d in dogs:
        certs = d.get("vaccine_certs") or {}
        vaccines = d.get("vaccines") or {}
        for vacc, info in certs.items():
            if not info or not isinstance(info, dict):
                continue
            reviewed = bool(info.get("reviewed_at"))
            if reviewed and not include_reviewed:
                continue
            out.append({
                "dog_id": d["id"],
                "dog_name": d.get("name", ""),
                "owner_id": d.get("owner_id"),
                "vaccine": vacc,
                "expires_on": info.get("expires_on") or vaccines.get(vacc, ""),
                "photo": info.get("photo"),
                "uploaded_at": info.get("uploaded_at"),
                "uploaded_by": info.get("uploaded_by", ""),
                "reviewed_at": info.get("reviewed_at"),
                "reviewed_by": info.get("reviewed_by", ""),
            })
    # Owner names
    owner_ids = list({x["owner_id"] for x in out if x.get("owner_id")})
    if owner_ids:
        owners = await db.clients.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        omap = {o["id"]: o["name"] for o in owners}
        for x in out:
            x["client_name"] = omap.get(x.get("owner_id"), "")
    out.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
    return out


@api.post("/admin/dogs/{dog_id}/vaccine-cert/{vaccine}/review")
async def admin_review_vaccine_cert(dog_id: str, vaccine: str, user: dict = Depends(require_admin)):
    """Mark a client-uploaded vaccine cert as reviewed/approved. Doesn't change the
    expiry — the client already set the expiry when uploading so they could keep
    booking. To reject/correct, edit the dog from the Dogs screen."""
    if vaccine not in ("rabies", "bordetella", "dhpp"):
        raise HTTPException(status_code=400, detail="Invalid vaccine type")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "vaccine_certs": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    certs = dict(dog.get("vaccine_certs") or {})
    if vaccine not in certs:
        raise HTTPException(status_code=404, detail="No cert uploaded for this vaccine")
    certs[vaccine] = dict(certs[vaccine])
    certs[vaccine]["reviewed_at"] = now_iso()
    certs[vaccine]["reviewed_by"] = user.get("name", "Admin")
    await db.dogs.update_one({"id": dog_id}, {"$set": {"vaccine_certs": certs}})
    return {"ok": True, "dog_id": dog_id, "vaccine": vaccine}


@api.delete("/admin/dogs/{dog_id}/vaccine-cert/{vaccine}")
async def admin_reject_vaccine_cert(dog_id: str, vaccine: str, _: dict = Depends(require_admin)):
    """Reject a client-uploaded vaccine cert: removes the cert image AND clears the
    associated vaccine expiry so the dog can no longer book until reuploaded."""
    if vaccine not in ("rabies", "bordetella", "dhpp"):
        raise HTTPException(status_code=400, detail="Invalid vaccine type")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "vaccine_certs": 1, "vaccines": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    certs = dict(dog.get("vaccine_certs") or {})
    vaccines = dict(dog.get("vaccines") or {})
    certs.pop(vaccine, None)
    vaccines[vaccine] = ""  # clear expiry to block future bookings
    await db.dogs.update_one(
        {"id": dog_id},
        {"$set": {"vaccine_certs": certs, "vaccines": vaccines}},
    )
    return {"ok": True, "dog_id": dog_id, "vaccine": vaccine, "rejected": True}




async def _booking_days_count_filtered(target_date: str, service_type: str) -> int:
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending", "completed"]}, "service_type": service_type}, {"_id": 0}
    ).to_list(2000)
    count = 0
    for b in bookings:
        # Once a booking is checked out, its slot frees up for the day.
        if b.get("checked_out_at"):
            continue
        days = _dates_in_range(b["date"], b.get("end_date"))
        if target_date in days:
            count += 1
    return count


@api.post("/bookings/recurring")
async def create_recurring(body: RecurringBookingIn, user: dict = Depends(get_current_user)):
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog["owner_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    await _validate_dog_vaccines(dog, required)

    start = datetime.fromisoformat(body.start_date).date()
    end = datetime.fromisoformat(body.end_date).date()
    if end < start:
        raise HTTPException(status_code=400, detail="End date before start date")
    weekdays = set(int(w) for w in body.weekdays)
    if not weekdays:
        raise HTTPException(status_code=400, detail="Select at least one weekday")

    created = []
    skipped = []
    # Suppress per-booking admin email so the operator doesn't get N alerts in a row;
    # we send a single summary email below after the loop completes.
    token = _suppress_admin_booking_email.set(True)
    try:
        cur = start
        while cur <= end:
            if cur.weekday() in weekdays:
                try:
                    bk = await create_booking(
                        BookingIn(dog_id=body.dog_id, date=cur.isoformat(), service_type=body.service_type, notes=body.notes or ""),
                        user,
                    )
                    created.append(bk)
                except HTTPException as e:
                    skipped.append({"date": cur.isoformat(), "reason": e.detail})
            cur += timedelta(days=1)
    finally:
        _suppress_admin_booking_email.reset(token)
    # ONE summary email — only for non-admin (client portal) actions.
    if user.get("role") != "admin" and created:
        try:
            client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0}) or {}
            await notify_admin_bulk_booking(
                created, client, service_type=body.service_type, skipped=skipped, kind="recurring"
            )
        except Exception:
            pass
    return {"created": created, "skipped": skipped}


@api.put("/bookings/{booking_id}/reschedule", response_model=BookingOut)
async def reschedule_booking(booking_id: str, body: RescheduleIn, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    update = {"date": body.date, "end_date": body.end_date}
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)
    return booking



# ────────────────────── Recurring Schedule Templates ──────────────────────
# Saved presets that bind a dog to a weekly cadence (e.g. Daisy · M/W/F daycare)
# so the admin can roll the schedule forward N weeks with one click instead of
# re-entering weekdays + service every quarter. Each "extend" reuses the
# already-tested `/bookings/recurring` engine under the hood.

class RecurringTemplateIn(BaseModel):
    dog_id: str
    label: Optional[str] = ""  # admin-facing nickname, e.g. "Daisy · M/W/F"
    service_type: Literal["daycare", "training"] = "daycare"
    weekdays: List[int] = Field(min_length=1, max_length=7)  # 0=Mon..6=Sun
    notes: Optional[str] = ""
    default_horizon_weeks: int = Field(default=12, ge=1, le=52)
    # When the schedule should first kick in. Empty/missing = "today on save".
    # The Extend endpoint honors this until the schedule has been booked
    # through at least once, after which it advances normally.
    start_date: Optional[str] = ""
    active: bool = True


class ExtendTemplateIn(BaseModel):
    weeks: Optional[int] = None  # if omitted, uses template's default_horizon_weeks


@api.get("/recurring-templates")
async def list_recurring_templates(user: dict = Depends(get_current_user)):
    """All saved recurring schedules. Admin sees every dog's; clients see only
    their own dogs' schedules."""
    query: Dict[str, Any] = {}
    is_admin = user.get("role") == "admin"
    if not is_admin:
        my_dogs = await db.dogs.find({"owner_id": user.get("client_id")}, {"_id": 0, "id": 1}).to_list(200)
        query["dog_id"] = {"$in": [d["id"] for d in my_dogs]}
    rows = await db.recurring_templates.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    dog_ids = list({r["dog_id"] for r in rows if r.get("dog_id")})
    dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1}).to_list(500)}
    client_ids = list({d.get("owner_id") for d in dogs.values() if d.get("owner_id")})
    clients = {c["id"]: c for c in await db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for r in rows:
        dog = dogs.get(r.get("dog_id")) or {}
        r["dog_name"] = dog.get("name") or "(unknown dog)"
        r["client_name"] = clients.get(dog.get("owner_id"), {}).get("name") or ""
    return rows


async def _assert_dog_owned_by_client(dog_id: str, user: dict) -> dict:
    """Returns the dog if the caller is admin or the dog's owner; else 403/404."""
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")
    return dog


@api.post("/recurring-templates")
async def create_recurring_template(body: RecurringTemplateIn, user: dict = Depends(get_current_user)):
    dog = await _assert_dog_owned_by_client(body.dog_id, user)
    # Clients can't self-book training — recurring training is locked to admin too,
    # matching the existing portal training-booking restriction.
    if user.get("role") != "admin" and body.service_type == "training":
        raise HTTPException(status_code=403, detail="Training schedules are set up by the team — please request a free evaluation.")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["weekdays"] = sorted(set(int(w) for w in doc["weekdays"] if 0 <= int(w) <= 6))
    if not doc.get("label"):
        wd_short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        days = "/".join(wd_short[w] for w in doc["weekdays"])
        doc["label"] = f"{dog['name']} · {days} {doc['service_type']}"
    doc["last_booked_through"] = None  # last ISO end-date we extended through
    doc["created_at"] = now_iso()
    doc["created_by"] = user.get("role") or "client"
    await db.recurring_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _load_owned_template(template_id: str, user: dict) -> dict:
    t = await db.recurring_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if user.get("role") != "admin":
        # Ensure the template's dog belongs to this client
        await _assert_dog_owned_by_client(t["dog_id"], user)
    return t


@api.put("/recurring-templates/{template_id}")
async def update_recurring_template(template_id: str, body: RecurringTemplateIn, user: dict = Depends(get_current_user)):
    existing = await _load_owned_template(template_id, user)
    if user.get("role") != "admin" and body.service_type == "training":
        raise HTTPException(status_code=403, detail="Training schedules are set up by the team.")
    # Client can't move a template onto a dog they don't own
    if body.dog_id != existing["dog_id"]:
        await _assert_dog_owned_by_client(body.dog_id, user)
    update = body.model_dump()
    update["weekdays"] = sorted(set(int(w) for w in update["weekdays"] if 0 <= int(w) <= 6))
    await db.recurring_templates.update_one({"id": template_id}, {"$set": update})
    existing.update(update)
    return existing


@api.delete("/recurring-templates/{template_id}")
async def delete_recurring_template(template_id: str, user: dict = Depends(get_current_user)):
    await _load_owned_template(template_id, user)
    await db.recurring_templates.delete_one({"id": template_id})
    return {"ok": True}


@api.post("/recurring-templates/{template_id}/extend")
async def extend_recurring_template(
    template_id: str, body: ExtendTemplateIn, user: dict = Depends(get_current_user)
):
    """Create bookings for this template starting from max(today, last_booked_through+1)
    forward through `weeks` weeks (default = template.default_horizon_weeks).
    Idempotent in practice: the underlying `/bookings/recurring` engine refuses
    to double-book a slot, returning each clash as a `skipped` entry."""
    t = await _load_owned_template(template_id, user)
    if not t.get("active", True):
        raise HTTPException(status_code=400, detail="Template is inactive")
    weeks = int(body.weeks or t.get("default_horizon_weeks") or 12)
    weeks = max(1, min(weeks, 52))
    today = business_today()
    last = t.get("last_booked_through")
    start_candidate = today
    # First extend: honor the template's preferred start_date (if any future date)
    if not last and t.get("start_date"):
        try:
            preferred = datetime.fromisoformat(t["start_date"]).date()
            if preferred > today:
                start_candidate = preferred
        except ValueError:
            pass
    elif last:
        try:
            start_candidate = max(today, datetime.fromisoformat(last).date() + timedelta(days=1))
        except ValueError:
            start_candidate = today
    end = start_candidate + timedelta(weeks=weeks)
    result = await create_recurring(
        RecurringBookingIn(
            dog_id=t["dog_id"],
            start_date=start_candidate.isoformat(),
            end_date=end.isoformat(),
            service_type=t["service_type"],
            weekdays=t["weekdays"],
            notes=t.get("notes") or "",
        ),
        user,
    )
    await db.recurring_templates.update_one(
        {"id": template_id},
        {"$set": {"last_booked_through": end.isoformat(), "last_extended_at": now_iso()}},
    )
    return {
        "template_id": template_id,
        "window": {"from": start_candidate.isoformat(), "to": end.isoformat(), "weeks": weeks},
        "created": len(result.get("created", [])),
        "skipped": result.get("skipped", []),
    }






@api.post("/bookings/{booking_id}/approve", response_model=BookingOut)
async def approve_booking(booking_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Booking is {booking['status']}")
    # Credits are deducted at CHECKOUT, not approval. Approval just confirms
    # the spot is reserved.
    update = {"status": "approved"}
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)
    # Best-effort confirmation email to the client
    try:
        client_doc = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
        if client_doc:
            await notify_client_booking_approved(booking, client_doc)
    except Exception:
        pass
    return booking


def _credit_balance_field(service_type: str) -> Optional[str]:
    """Map service_type → the integer balance field on the client document.
    Returns None for services that don't use credit pools (e.g. grooming)."""
    return {
        "daycare": "credits",
        "training": "training_credits",
        "boarding": "boarding_credits",
    }.get(service_type)



async def _consume_credit_lots(
    client_id: str,
    qty: int,
    service_type: str = "daycare",
    prefer_program_id: Optional[str] = None,
) -> tuple:
    """FIFO consumption: oldest lot first, filtered by `service_type` so daycare
    credits and training credits stay in their own pools.

    Sprint 110bx — when `prefer_program_id` is set (typically the dog's active
    training program), lots tagged with that `program_id` are exhausted FIRST
    (oldest-first within that program), then we fall back to other lots in the
    same service pool. Lets "Buddy's Puppy Preschool session" pull from his
    Puppy Preschool lot before generic training credits.

    Returns (total_value, [lot_ids_touched]). If lots don't cover qty, the
    remainder is valued at $0 — preserves balance integrity without inventing
    revenue."""
    remaining = qty
    total_value = 0.0
    touched: List[str] = []

    async def _drain(filter_extra: dict):
        nonlocal remaining, total_value
        if remaining <= 0:
            return
        cursor = db.credit_lots.find(
            {"client_id": client_id, "qty_remaining": {"$gt": 0},
             "service_type": service_type, **filter_extra},
            {"_id": 0},
        ).sort("purchased_at", 1)
        async for lot in cursor:
            if remaining <= 0:
                break
            take = min(remaining, int(lot.get("qty_remaining") or 0))
            if take <= 0:
                continue
            value = float(lot.get("value_each") or 0) * take
            await db.credit_lots.update_one(
                {"id": lot["id"]},
                {"$inc": {"qty_remaining": -take}, "$set": {"last_redeemed_at": now_iso()}},
            )
            total_value += value
            touched.append(lot["id"])
            remaining -= take

    if prefer_program_id:
        await _drain({"program_id": prefer_program_id})
    await _drain({})  # Fall back to any remaining lot in this service pool
    return round(total_value, 2), touched


async def _restore_credit_lots(lot_ids: List[str], qty: int) -> None:
    """Restore lot quantities (used when cancelling/rejecting an approved
    booking). Distributes the restore proportionally — simplest: just bump
    the first lot in the list by qty."""
    if not lot_ids or qty <= 0:
        return
    remaining = qty
    # Restore in reverse order so the most-recently-consumed lot is restored first.
    for lot_id in reversed(lot_ids):
        if remaining <= 0:
            break
        await db.credit_lots.update_one({"id": lot_id}, {"$inc": {"qty_remaining": remaining}})
        remaining = 0  # restore the full quantity into the first available lot

@api.post("/bookings/{booking_id}/reject", response_model=BookingOut)
async def reject_booking(booking_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "rejected"}})
    booking["status"] = "rejected"
    return booking

@api.delete("/bookings/{booking_id}")
async def cancel_booking(booking_id: str, forfeit: bool = False, user: dict = Depends(get_current_user)):
    """Cancel a booking.

    Default behavior (`forfeit=False`): credits previously deducted are refunded
    to the client and the booking drops out of the P&L.

    When `forfeit=True` (admin / employee only — i.e. "charge the client for the
    cancellation"): credits stay deducted (or cash price stays on the books),
    the booking is marked with `cancellation_charged=True` plus a snapshot
    `cancellation_fee`, and downstream P&L queries treat it as revenue. Useful
    for late-cancels / no-shows where the policy is "we keep the money".
    """
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    # Admins + employees can cancel any booking; clients only their own.
    if user.get("role") == "client" and booking["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    # Clients cannot trigger a charge — only staff can do that.
    if forfeit and user.get("role") == "client":
        raise HTTPException(status_code=403, detail="Only staff can issue a cancellation charge")
    # Cancellation cutoff for clients only (admins + employees bypass)
    if user.get("role") == "client":
        settings = await get_settings()
        cutoff_hours = int(settings.get("booking_rules", {}).get("cancellation_cutoff_hours", 24))
        try:
            start_dt = datetime.fromisoformat(booking["date"]).replace(tzinfo=timezone.utc)
            if start_dt - datetime.now(timezone.utc) < timedelta(hours=cutoff_hours):
                raise HTTPException(status_code=400, detail=f"Cancellations must be at least {cutoff_hours}h in advance")
        except ValueError:
            pass
    update_payload: Dict[str, Any] = {"status": "cancelled", "cancelled_at": now_iso()}
    if forfeit:
        # Snapshot the fee at the moment of cancellation so later price changes
        # don't retroactively alter what the client was charged.
        fee = float(booking.get("actual_price") or 0)
        if not fee:
            fee = float(booking.get("credit_value") or 0)
        if not fee and booking.get("service_id"):
            svc = await db.services.find_one(
                {"id": booking["service_id"]}, {"_id": 0, "base_price": 1}
            )
            fee = float((svc or {}).get("base_price") or 0)
        update_payload["cancellation_charged"] = True
        update_payload["cancellation_fee"] = round(fee, 2)
    else:
        # Refund credits (daycare or training) if previously approved
        if booking["status"] == "approved":
            refund = int(booking.get("credits_deducted") or 0)
            if refund > 0:
                credit_pool = booking.get("credit_service_type") or booking.get("service_type") or "daycare"
                balance_field = _credit_balance_field(credit_pool) or "credits"
                await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {balance_field: refund}})
                await _restore_credit_lots(booking.get("credit_lot_ids") or [], refund)
    await db.bookings.update_one({"id": booking_id}, {"$set": update_payload})
    return {"ok": True, "forfeit": forfeit, "cancellation_fee": update_payload.get("cancellation_fee", 0)}

@api.get("/bookings/availability")
async def availability(date_str: str, dog_id: str, user: dict = Depends(get_current_user)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    today = business_today().isoformat()
    vac_ok = True
    missing = []
    for v in required:
        d = (dog.get("vaccines") or {}).get(v, "")
        if not d or d < today:
            vac_ok = False
            missing.append(v)
    daycare_cap = int(settings.get("daycare_capacity", DAYCARE_CAPACITY))
    booked = await _booking_days_count_filtered(date_str, "daycare")
    open_slots = max(daycare_cap - booked, 0)
    return {
        "date": date_str,
        "capacity": daycare_cap,
        "booked": booked,
        "open_slots": open_slots,
        "vaccine_ok": vac_ok,
        "missing_vaccines": missing,
        "rabies_expiration": (dog.get("vaccines") or {}).get("rabies", ""),
    }


# Time-slotted services share a single conflict pool so a 2pm Training also
# blocks 2pm Grooming etc. (Matches the user's "shared slot pool" preference.)
TIME_SLOTTED_SERVICES = ("training", "grooming", "photography")


def _slot_overlaps(a_start_min: int, a_dur: int, b_start_min: int, b_dur: int) -> bool:
    """Return True when two [start, start+duration) intervals overlap."""
    return (a_start_min < b_start_min + b_dur) and (b_start_min < a_start_min + a_dur)


def _hhmm_to_min(s: str) -> Optional[int]:
    try:
        hh, mm = s.split(":")[:2]
        return int(hh) * 60 + int(mm)
    except Exception:
        return None


async def _get_default_duration(service_type: str) -> int:
    """Default duration in minutes for time-slotted services. Pulls from the
    `is_default` service of that type; falls back to 60."""
    if service_type not in TIME_SLOTTED_SERVICES:
        return 0
    svc = await db.services.find_one(
        {"service_type": service_type, "is_default": True, "active": True},
        {"_id": 0, "duration_minutes": 1},
    )
    return int((svc or {}).get("duration_minutes") or 60)


@api.get("/bookings/time-slots")
async def list_time_slots(
    date_str: str,
    service_type: Literal["training", "grooming", "photography"],
    duration: Optional[int] = None,
    user: dict = Depends(get_current_user),
):
    """Return the candidate slots for a given date and time-slotted service.
    Each slot is marked available/blocked; the blocking pool is shared across
    training/grooming/photography so the operator never double-books their time.

    Slot granularity is 30-min. The window comes from Settings → service_hours
    (per-weekday open/close), so Saturday-only or evenings-only schedules work
    out of the box. Days marked `closed` return no slots.
    """
    if not duration or duration <= 0:
        duration = await _get_default_duration(service_type)

    # Resolve the day's open/close from settings (with safe fallback to 08–18
    # in case the settings schema is missing for some reason).
    open_min, close_min = 8 * 60, 18 * 60
    day_closed = False
    try:
        the_date = date.fromisoformat(date_str)
        dow = DEFAULT_DAYS[the_date.weekday()]
        settings = await get_settings()
        svc_hrs = (settings.get("service_hours") or {}).get(service_type)
        if isinstance(svc_hrs, dict) and isinstance(svc_hrs.get(dow), dict):
            day_cfg = svc_hrs[dow]
            if day_cfg.get("closed"):
                day_closed = True
            else:
                o = _hhmm_to_min(day_cfg.get("open") or "")
                c = _hhmm_to_min(day_cfg.get("close") or "")
                if o is not None:
                    open_min = o
                if c is not None:
                    close_min = c
    except Exception:
        pass

    if day_closed:
        return {
            "date": date_str,
            "service_type": service_type,
            "duration_minutes": duration,
            "closed": True,
            "slots": [],
        }

    # Pull every active time-slotted booking on this date — we'll see if each
    # candidate slot overlaps any of them.
    existing = await db.bookings.find(
        {
            "date": date_str,
            "status": {"$in": ["pending", "approved", "completed"]},
            "service_type": {"$in": list(TIME_SLOTTED_SERVICES)},
            "time": {"$ne": ""},
        },
        {"_id": 0, "time": 1, "service_type": 1, "duration_minutes": 1, "service_id": 1, "dog_id": 1, "id": 1},
    ).to_list(500)
    # Hydrate each existing booking with its service's duration if not stored on the booking.
    svc_cache: Dict[str, int] = {}
    async def _booking_dur(b: dict) -> int:
        d = int(b.get("duration_minutes") or 0)
        if d > 0:
            return d
        st = b.get("service_type")
        if st in svc_cache:
            return svc_cache[st]
        d = await _get_default_duration(st)
        svc_cache[st] = d
        return d

    # Generate candidate slots: open → close every 30 min.
    candidates: List[Dict[str, Any]] = []
    for total in range(open_min, close_min, 30):
        # Don't propose a slot whose end would land past closing.
        if total + duration > close_min:
            continue
        hh, mm = divmod(total, 60)
        label = f"{hh:02d}:{mm:02d}"
        blocked_by = None
        for b in existing:
            bstart = _hhmm_to_min(b.get("time") or "")
            if bstart is None:
                continue
            bdur = await _booking_dur(b)
            if _slot_overlaps(total, duration, bstart, bdur):
                blocked_by = b.get("service_type") or "other"
                break
        candidates.append({"time": label, "available": blocked_by is None, "blocked_by": blocked_by})
    return {
        "date": date_str,
        "service_type": service_type,
        "duration_minutes": duration,
        "closed": False,
        "slots": candidates,
    }


# Catch-all booking-by-id MUST come AFTER any literal /bookings/<thing> routes
# (availability, time-slots, conflicts) or it will shadow them. FastAPI
# matches in order.
@api.get("/bookings/conflicts")
async def booking_conflicts(dog_id: str, date_str: str, _: dict = Depends(get_current_user)):
    """Return any pending/approved/completed bookings for this dog on the given date."""
    bookings = await db.bookings.find(
        {"dog_id": dog_id, "status": {"$in": ["approved", "pending", "completed"]}}, {"_id": 0}
    ).to_list(500)
    conflicts = []
    for b in bookings:
        days = _dates_in_range(b["date"], b.get("end_date"))
        if date_str in days:
            conflicts.append({
                "id": b["id"], "date": b["date"], "end_date": b.get("end_date"),
                "service_type": b["service_type"], "status": b["status"],
            })
    return {"conflicts": conflicts}


@api.get("/bookings/{booking_id}", response_model=BookingOut)
async def get_booking(booking_id: str, user: dict = Depends(get_current_user)):
    """Single-booking detail. Used by the admin Schedule's booking-detail
    modal so we can show notes / payment / homework history without paging
    through the full /bookings list."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    # Admins + employees can fetch any booking; clients only their own.
    if user.get("role") == "client" and b.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your booking")
    return b



@api.get("/portal/me")
async def portal_me(user: dict = Depends(get_current_user)):
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0}) if cid else None
    if not client:
        return {"client": {"id": "", "name": user.get("name"), "credits": 0}, "visit_counts": {}, "referral_code": None}

    # Ensure the client has a referral code minted (one-time, server-generated).
    if not client.get("referral_code"):
        code = secrets.token_urlsafe(4).replace("-", "").replace("_", "").upper()[:6]
        # Re-roll on the (unlikely) chance of collision.
        for _ in range(3):
            if not await db.clients.find_one({"referral_code": code}):
                break
            code = secrets.token_urlsafe(4).replace("-", "").replace("_", "").upper()[:6]
        await db.clients.update_one({"id": cid}, {"$set": {"referral_code": code}})
        client["referral_code"] = code

    # Visit counts per dog (status=completed counts as a real visit).
    dog_ids = [d["id"] async for d in db.dogs.find({"owner_id": cid}, {"_id": 0, "id": 1})]
    visit_counts: Dict[str, int] = {}
    if dog_ids:
        pipeline = [
            {"$match": {"dog_id": {"$in": dog_ids}, "status": "completed"}},
            {"$group": {"_id": "$dog_id", "count": {"$sum": 1}}},
        ]
        async for row in db.bookings.aggregate(pipeline):
            visit_counts[row["_id"]] = int(row.get("count") or 0)
        for d in dog_ids:
            visit_counts.setdefault(d, 0)

    return {
        "client": client,
        "visit_counts": visit_counts,
        "referral_code": client.get("referral_code"),
    }


# -------- Referral lookup (admin only, used to validate referral codes during seed/sign-up) --------
@api.get("/referrals/lookup/{code}")
async def lookup_referral_code(code: str, _: dict = Depends(require_admin)):
    """Return the client owning this referral code, or 404. Admin uses this when manually
    crediting a referral, or wiring it into the sign-up flow."""
    client = await db.clients.find_one({"referral_code": code.upper()}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if not client:
        raise HTTPException(status_code=404, detail="No client with that referral code")
    return client


@api.post("/clients/{client_id}/credit-referral")
async def credit_referral(client_id: str, body: dict, user: dict = Depends(require_admin)):
    """Admin helper: comp a daycare credit to {client_id} as a thank-you for referring
    {referred_client_id} (passed in body). Writes a `credit_adjustments` entry + a
    `referrals` collection entry for the audit trail."""
    referred = (body or {}).get("referred_client_id")
    note = (body or {}).get("note", "Referral bonus")
    bonus = int((body or {}).get("bonus", 1))
    if not referred:
        raise HTTPException(status_code=400, detail="Missing referred_client_id")
    if bonus < 1 or bonus > 10:
        raise HTTPException(status_code=400, detail="Bonus must be between 1 and 10")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Referrer not found")
    rclient = await db.clients.find_one({"id": referred}, {"_id": 0})
    if not rclient:
        raise HTTPException(status_code=404, detail="Referred client not found")

    await db.clients.update_one({"id": client_id}, {"$inc": {"credits": bonus}})
    log = {
        "id": str(uuid.uuid4()),
        "referrer_id": client_id,
        "referrer_name": client.get("name", ""),
        "referred_id": referred,
        "referred_name": rclient.get("name", ""),
        "bonus_credits": bonus,
        "note": note,
        "created_by": user.get("name", "Admin"),
        "created_at": now_iso(),
    }
    await db.referrals.insert_one(log)
    await db.credit_adjustments.insert_one({
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "changes": {"daycare": {"before": int(client.get("credits") or 0), "delta": bonus, "after": int(client.get("credits") or 0) + bonus}},
        "note": f"Referral bonus — referred {rclient.get('name','')}",
        "adjusted_by": user.get("name", "Admin"),
        "adjusted_at": now_iso(),
    })
    log.pop("_id", None)
    return log


# -------- Vaccine cert self-upload (client portal) --------
class VaccineUpdateIn(BaseModel):
    vaccine: Literal["rabies", "bordetella", "dhpp"]
    expires_on: str  # ISO date "YYYY-MM-DD"
    photo: Optional[str] = ""  # base64 data URL of cert photo


@api.post("/portal/dogs/{dog_id}/vaccine-update")
async def portal_update_vaccine(dog_id: str, body: VaccineUpdateIn, user: dict = Depends(get_current_user)):
    """Client uploads a new vaccine cert photo + expiry date. Pending admin review,
    but we update the expiry immediately so they're unblocked from booking."""
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog or dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=404, detail="Dog not found")
    # Validate date
    try:
        date.fromisoformat(body.expires_on)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid expiry date")
    vaccines = dict(dog.get("vaccines") or {})
    vaccines[body.vaccine] = body.expires_on
    update_doc: Dict[str, Any] = {"vaccines": vaccines}
    if body.photo:
        certs = dict(dog.get("vaccine_certs") or {})
        certs[body.vaccine] = {
            "photo": body.photo,
            "uploaded_at": now_iso(),
            "uploaded_by": user.get("name", ""),
            "expires_on": body.expires_on,
        }
        update_doc["vaccine_certs"] = certs
    await db.dogs.update_one({"id": dog_id}, {"$set": update_doc})
    return {"ok": True, "dog_id": dog_id, "vaccine": body.vaccine, "expires_on": body.expires_on}


@api.post("/dogs/{dog_id}/vaccine-cert")
async def admin_attach_vaccine_cert(dog_id: str, body: VaccineUpdateIn, user: dict = Depends(require_admin)):
    """Admin counterpart to `portal_update_vaccine` — attach a cert photo +
    expiry the admin already has (e.g. emailed/texted by the client at sign-up).
    Marked as admin-uploaded so it's considered pre-verified and skips the
    Pending Vaccine Reviews queue."""
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    try:
        date.fromisoformat(body.expires_on)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid expiry date")
    vaccines = dict(dog.get("vaccines") or {})
    vaccines[body.vaccine] = body.expires_on
    update_doc: Dict[str, Any] = {"vaccines": vaccines}
    if body.photo:
        certs = dict(dog.get("vaccine_certs") or {})
        certs[body.vaccine] = {
            "photo": body.photo,
            "uploaded_at": now_iso(),
            "uploaded_by": user.get("name", "admin"),
            "uploaded_by_admin": True,
            "expires_on": body.expires_on,
            # Admin-uploaded certs are pre-verified — skip the pending review queue.
            "reviewed_at": now_iso(),
            "reviewed_by": user.get("name", "admin"),
        }
        update_doc["vaccine_certs"] = certs
    await db.dogs.update_one({"id": dog_id}, {"$set": update_doc})
    return {"ok": True, "dog_id": dog_id, "vaccine": body.vaccine, "expires_on": body.expires_on}



# -------- Portal self-service: profile + dogs --------
class PortalProfileIn(BaseModel):
    name: str = Field(min_length=1)
    address: Optional[str] = ""
    phone: Optional[str] = ""
    emerg: Optional[str] = ""

class PortalDogIn(BaseModel):
    """Fields a client is allowed to set on their own dog. Excludes training_skills, feeding_schedule, medications which stay admin-only."""
    name: str = Field(min_length=1)
    breed: Optional[str] = ""
    age_y: int = 0
    age_m: int = 0
    birthday: Optional[str] = ""
    sex: Literal["Male", "Female"] = "Male"
    fixed: Literal["Yes", "No"] = "No"
    vaccines: Vaccines = Field(default_factory=Vaccines)
    notes: Optional[str] = ""
    photo: Optional[str] = ""
    vet_name: Optional[str] = ""
    vet_phone: Optional[str] = ""

async def _require_client_with_record(user: dict) -> str:
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    if not cid:
        raise HTTPException(status_code=400, detail="No client record linked. Contact your trainer.")
    return cid

@api.put("/portal/me")
async def update_portal_me(body: PortalProfileIn, user: dict = Depends(get_current_user)):
    cid = await _require_client_with_record(user)
    update = body.model_dump()
    await db.clients.update_one({"id": cid}, {"$set": update})
    # also keep user.name in sync
    await db.users.update_one({"id": user["id"]}, {"$set": {"name": body.name}})
    client = await db.clients.find_one({"id": cid}, {"_id": 0})
    return {"client": client}

@api.post("/portal/gallery/mark-seen")
async def portal_gallery_mark_seen(user: dict = Depends(get_current_user)):
    """Client opened their photo gallery — clear the admin-set 'new photos available' nudge.
    Idempotent. Best-effort; never blocks the client from reaching the gallery."""
    cid = await _require_client_with_record(user)
    await db.clients.update_one({"id": cid}, {"$set": {"photo_gallery_has_new": False}})
    return {"ok": True}

@api.post("/portal/dogs", response_model=DogOut)
async def portal_create_dog(body: PortalDogIn, user: dict = Depends(get_current_user)):
    cid = await _require_client_with_record(user)
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "owner_id": cid,
        "feeding_schedule": [],
        "medications": [],
        "training_skills": [],
        "photos": [],
        "training_logs": [],
        "created_at": now_iso(),
    })
    await db.dogs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/portal/dogs/{dog_id}", response_model=DogOut)
async def portal_update_dog(dog_id: str, body: PortalDogIn, user: dict = Depends(get_current_user)):
    cid = await _require_client_with_record(user)
    existing = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Dog not found")
    if existing.get("owner_id") != cid:
        raise HTTPException(status_code=403, detail="Not your dog")
    update = body.model_dump()
    await db.dogs.update_one({"id": dog_id}, {"$set": update})
    existing.update(update)
    return existing



@api.post("/bookings/{booking_id}/check-in", response_model=BookingOut)
async def check_in(
    booking_id: str,
    body: Optional[CheckInIn] = None,
    user: dict = Depends(require_employee_or_admin),
):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    body = body or CheckInIn()
    ts = now_iso()
    update = {
        "checked_in_at": ts,
        "checked_in_by": user["id"],
        "checked_in_by_name": user.get("display_name") or user.get("name"),
        "checked_in_lat": body.lat,
        "checked_in_lng": body.lng,
        "checked_in_accuracy_m": body.accuracy_m,
    }
    # Sprint 110an — admin can tack on add-ons during quick check-in. Resolves
    # legacy-pricing + appends to the existing add_ons list (no overwrite).
    if body.addon_service_ids:
        new_addons = await resolve_addon_snapshots(
            booking.get("client_id"),
            body.addon_service_ids,
            booking.get("service_type") or "",
        )
        update["add_ons"] = list(booking.get("add_ons") or []) + new_addons
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)
    return booking


@api.post("/bookings/{booking_id}/add-ons", response_model=BookingOut)
async def attach_booking_addons(
    booking_id: str,
    body: BookingAddonsIn,
    user: dict = Depends(get_current_user),
):
    """Add one or more add-ons to an existing booking (e.g. client adds a
    nail trim from the portal, or admin tacks on a service before check-out).
    Append-only — does not replace prior add-ons. Honours legacy pricing."""
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    # Clients can only modify their own bookings
    if user.get("role") != "admin" and booking.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your booking")
    new_addons = await resolve_addon_snapshots(
        booking.get("client_id"),
        body.addon_service_ids,
        booking.get("service_type") or "",
    )
    merged = list(booking.get("add_ons") or []) + new_addons
    await db.bookings.update_one({"id": booking_id}, {"$set": {"add_ons": merged}})
    booking["add_ons"] = merged
    return booking


@api.delete("/bookings/{booking_id}/add-ons/{addon_index}", response_model=BookingOut)
async def remove_booking_addon(
    booking_id: str,
    addon_index: int,
    user: dict = Depends(get_current_user),
):
    """Remove a previously-attached add-on by its index in `booking.add_ons`.
    Index-based because clients can have multiple of the same add-on
    (e.g. two nail trims) and we can't dedupe by service_id."""
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if user.get("role") != "admin" and booking.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your booking")
    if booking.get("checked_out_at"):
        raise HTTPException(status_code=400, detail="Booking already checked out — add-ons are locked in.")
    addons = list(booking.get("add_ons") or [])
    if addon_index < 0 or addon_index >= len(addons):
        raise HTTPException(status_code=404, detail="Add-on not found at that index")
    addons.pop(addon_index)
    await db.bookings.update_one({"id": booking_id}, {"$set": {"add_ons": addons}})
    booking["add_ons"] = addons
    return booking

async def _maybe_send_low_credit_email(client_id: str, service_type: str, new_balance: int) -> None:
    """Sprint 110g — Fire the low-credit "heads up" email when a credit pool
    drops to <= 2.

    Idempotency: we stamp the client doc with the LAST balance we emailed at
    (per pool) so re-checkouts within the same low-credit episode don't spam.
    A subsequent credit refill that lifts the balance above 2 clears the stamp,
    so the next time they dip down again the next email goes through.

    Threshold is "2 or fewer" matching the existing dashboard `low_credits`
    Today's Tasks signal (server.py line 6350-6354), so the email + dashboard
    pip in lockstep.
    """
    THRESHOLD = 2
    if new_balance > THRESHOLD:
        # Lift above threshold — clear any prior stamp so a future dip re-arms.
        stamp_key = f"low_credit_emailed_at.{service_type}"
        await db.clients.update_one(
            {"id": client_id, stamp_key: {"$exists": True}},
            {"$unset": {stamp_key: ""}},
        )
        return
    # Inside the warn-zone. Only email if we haven't already for THIS balance.
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client or not client.get("email"):
        return
    last = (client.get("low_credit_emailed_at") or {}).get(service_type)
    if isinstance(last, dict) and last.get("balance") == new_balance:
        return  # already emailed for this exact balance — skip
    try:
        await notify_client_low_credits(client, service_type, new_balance)
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {f"low_credit_emailed_at.{service_type}": {
                "balance": new_balance,
                "at": now_iso(),
            }}},
        )
    except Exception as exc:
        logger.warning("Low-credit email failed for client=%s pool=%s: %s", client_id, service_type, exc)


async def _compute_multi_dog_discount(booking: dict, *, exclude_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Sprint 110 — return the dollar discount that should apply to the
    booking being checked out, given the multi-dog household setting.

    Sprint 110h — discount config is now PER SERVICE TYPE (daycare/boarding/
    training/grooming/photography all configurable separately). The legacy
    flat fields are read as the fallback so existing installs keep working.

    Rules:
      - Master toggle must be on.
      - Service-specific entry must be enabled with a value > 0.
      - Discount applies ONLY if the same client has at least one other
        booking on the same date that's already been checked out (status
        completed, has checked_out_at) and is NOT this booking.
      - First dog full price → subsequent dogs (in checkout order) discounted.
    """
    settings = await get_settings()
    if not settings.get("multi_dog_discount_enabled"):
        return None

    service_type = booking.get("service_type") or "daycare"
    per_service = settings.get("multi_dog_discount_by_service") or {}
    cfg = per_service.get(service_type)
    if not cfg:
        # Legacy single-config fallback (applied to all services as before)
        cfg = {
            "enabled": True,
            "mode": settings.get("multi_dog_discount_mode") or "percent",
            "value": float(settings.get("multi_dog_discount_value") or 0),
            "label": settings.get("multi_dog_discount_label") or "Multi-dog discount",
        }
    if not cfg.get("enabled"):
        return None
    mode = (cfg.get("mode") or "percent").lower()
    if mode not in ("percent", "flat"):
        return None
    value = float(cfg.get("value") or 0)
    if value <= 0:
        return None

    client_id = booking.get("client_id")
    booking_date = booking.get("date")
    if not client_id or not booking_date:
        return None

    sibling_q = {
        "client_id": client_id,
        "date": booking_date,
        "status": "completed",
        "checked_out_at": {"$exists": True, "$ne": None},
    }
    if exclude_id:
        sibling_q["id"] = {"$ne": exclude_id}
    sibling_count = await db.bookings.count_documents(sibling_q)
    if sibling_count < 1:
        return None

    base_price = float(booking.get("actual_price") or 0)
    if base_price <= 0:
        return None
    if mode == "percent":
        pct = max(0.0, min(100.0, value))
        amount = round(base_price * pct / 100.0, 2)
    else:
        amount = round(min(base_price, value), 2)
    label = cfg.get("label") or "Multi-dog discount"
    return {
        "amount": amount,
        "mode": mode,
        "value": value,
        "label": label,
        "service_type": service_type,
        "sibling_count": sibling_count,
    }


@api.get("/bookings/{booking_id}/discount-preview")
async def discount_preview(booking_id: str, _: dict = Depends(require_employee_or_admin)):
    """Pre-checkout preview of the multi-dog discount that WILL apply at
    check-out time, given the current siblings already checked out today
    and the configured base/service price. Used by the checkout modal so
    the client sees the discount BEFORE submit."""
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    # Resolve a tentative price the same way check_out() would.
    tentative_price = float(booking.get("actual_price") or 0)
    # Sprint 110ar — Training visits are package-paid; never auto-suggest a
    # catalog price in the preview (admin types the amount manually when one
    # is owed). Without this the modal showed e.g. "$75" on a $0 visit.
    if tentative_price <= 0 and booking.get("service_type") != "training":
        default_svc = await db.services.find_one(
            {"service_type": booking.get("service_type"), "is_default": True, "active": True},
            {"_id": 0},
        )
        if default_svc:
            unit = float(default_svc.get("base_price") or 0)
            # Sprint 110am — honour the client's legacy-pricing override in the
            # check-out preview so admins see the locked rate before confirming.
            pricing = await resolve_client_price(
                booking.get("client_id"),
                "service",
                default_svc.get("id") or "",
                unit,
            )
            unit = pricing["effective_price"]
            if booking.get("service_type") == "boarding":
                try:
                    s = date.fromisoformat(booking.get("date"))
                    e = date.fromisoformat(booking.get("end_date") or booking.get("date"))
                    nights = max(1, (e - s).days or 1)
                except Exception:
                    nights = 1
                tentative_price = unit * nights
            else:
                tentative_price = unit
    preview_booking = {**booking, "actual_price": round(tentative_price, 2)}
    disc = await _compute_multi_dog_discount(preview_booking, exclude_id=booking_id)
    return {
        "eligible": bool(disc and disc["amount"] > 0),
        "preview_base_price": round(tentative_price, 2),
        "discount": disc,
    }


@api.post("/bookings/{booking_id}/check-out", response_model=BookingOut)
async def check_out(
    booking_id: str,
    body: Optional[CheckoutIn] = None,
    user: dict = Depends(require_employee_or_admin),
):
    """Check the dog out, optionally adding services or switching the payment.
    All body fields are optional — calling with no body keeps the prior behaviour."""
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    body = body or CheckoutIn()
    ts = now_iso()
    update: Dict[str, Any] = {
        "checked_out_at": ts,
        "status": "completed",
        "checked_out_by": user["id"],
        "checked_out_by_name": user.get("display_name") or user.get("name"),
        "checked_out_lat": body.lat,
        "checked_out_lng": body.lng,
        "checked_out_accuracy_m": body.accuracy_m,
    }

    had_credit = bool(booking.get("credit_value")) and not booking.get("actual_price")
    use_credits = bool(body.use_credits)

    # Resolve a sensible service value for income tracking. Admin's manual
    # base_price wins; otherwise fall back to the booking's default service price.
    # For BOARDING the per-night rate is multiplied by the actual nights stayed
    # so a 3-night boarding at $50/night auto-prefills as $150.
    # Sprint 110am — when no manual override is given, look up the client's
    # legacy-pricing rate so grandfathered customers keep their locked price.
    async def _resolve_service_value(default_for_zero: float = 0.0) -> float:
        if body.base_price is not None:
            return float(body.base_price)
        default_svc = await db.services.find_one(
            {"service_type": booking.get("service_type"), "is_default": True, "active": True},
            {"_id": 0},
        )
        if default_svc:
            list_price = float(default_svc.get("base_price") or 0)
            pricing = await resolve_client_price(
                booking.get("client_id"),
                "service",
                default_svc.get("id") or "",
                list_price,
            )
            unit_price = pricing["effective_price"]
            if booking.get("service_type") == "boarding":
                try:
                    start_d = date.fromisoformat(booking.get("date"))
                    end_d = date.fromisoformat(booking.get("end_date") or booking.get("date"))
                    nights_stayed = max(1, (end_d - start_d).days or 1)
                except Exception:
                    nights_stayed = 1
                return unit_price * nights_stayed
            return unit_price
        return default_for_zero

    # ── Case A: client chose to KEEP using the credits that were already deducted.
    if had_credit and use_credits:
        # Income value: prefer admin's manual override, then the lot value, then
        # the default service price — that way even legacy lots that have $0
        # value still record the day's income correctly.
        lot_val = float(booking.get("credit_value") or 0)
        if body.base_price is not None:
            svc_value = float(body.base_price)
        elif lot_val > 0:
            svc_value = lot_val
        else:
            svc_value = await _resolve_service_value(lot_val)
        update["actual_price"] = round(svc_value, 2)
        update["payment_status"] = "paid"
        update["payment_method"] = "credits"
        update["paid_at"] = ts

    # ── Case B: client wants to PAY today instead — refund the pre-deducted credits.
    elif had_credit and not use_credits:
        deducted = int(booking.get("credits_deducted") or 0)
        lot_ids = booking.get("credit_lot_ids") or []
        svc_type = booking.get("credit_service_type") or "daycare"
        if deducted > 0:
            await _restore_credit_lots(lot_ids, deducted)
            balance_field = _credit_balance_field(svc_type) or "credits"
            await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {balance_field: deducted}})
        # Clear credit fields on the booking so the income tally treats it as a paid service.
        update["credit_value"] = 0.0
        update["credit_lot_ids"] = []
        update["credit_service_type"] = None
        update["credits_deducted"] = 0
        # Fall through to base-price logic below.

    # ── Case C: NEW — booking had NO pre-deduction (the normal case now that
    # credits are checkout-time only). If the admin opts to settle from credits
    # and the client has enough, consume them. If not, silently fall through
    # to the cash/card path below — don't block the checkout on a credit shortfall.
    elif not had_credit and use_credits and not booking.get("actual_price"):
        svc_type = booking.get("service_type") or "daycare"
        # Boarding consumes one credit per night; everything else is 1 credit.
        nights = 1
        if svc_type == "boarding":
            try:
                start_d = date.fromisoformat(booking.get("date"))
                end_d = date.fromisoformat(booking.get("end_date") or booking.get("date"))
                nights = max(1, (end_d - start_d).days or 1)
            except Exception:
                nights = 1
        balance_field = _credit_balance_field(svc_type) or "credits"
        client_doc = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
        available = int((client_doc or {}).get(balance_field) or 0)
        if available >= nights and nights > 0:
            # Sprint 110bx — prefer the dog's active training program's lot
            prefer_pid = None
            if svc_type == "training" and booking.get("dog_id"):
                dog_doc = await db.dogs.find_one({"id": booking["dog_id"]},
                                                 {"_id": 0, "active_program_id": 1})
                if dog_doc and dog_doc.get("active_program_id"):
                    enrol = await db.dog_programs.find_one(
                        {"id": dog_doc["active_program_id"]},
                        {"_id": 0, "program_id": 1},
                    )
                    if enrol:
                        prefer_pid = enrol.get("program_id")
            credit_value, lot_ids = await _consume_credit_lots(
                booking["client_id"], nights, svc_type,
                prefer_program_id=prefer_pid,
            )
            await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {balance_field: -nights}})
            # Sprint 110g — fire low-credit email if this checkout dropped the
            # pool to ≤ 2. Idempotent per (client, pool, threshold) so we
            # never spam the client with multiple "2 left" emails.
            new_balance = available - nights
            await _maybe_send_low_credit_email(booking["client_id"], svc_type, new_balance)
            # Income value: prefer admin's manual override; fall back to lot value;
            # if the lot has no $ data, use the default service price so income is
            # still recorded correctly.
            if body.base_price is not None:
                svc_value = float(body.base_price)
            elif credit_value > 0:
                svc_value = float(credit_value)
            else:
                svc_value = await _resolve_service_value(float(credit_value))
            update["credit_value"] = round(float(credit_value), 2)
            update["credit_lot_ids"] = lot_ids
            update["credit_service_type"] = svc_type
            update["credits_deducted"] = nights
            update["actual_price"] = round(svc_value, 2)
            update["payment_status"] = "paid"
            update["payment_method"] = "credits"
            update["paid_at"] = ts
            # Skip the "will_charge" branch below — we're done settling this booking.
            had_credit = True
            use_credits = True
        else:
            # Not enough credits — silently fall through to charge cash/card.
            use_credits = False

    # Determine base price / service tag for paid-today bookings (no credits, or credits refunded).
    will_charge = use_credits is False or not had_credit
    base_price = 0.0
    # For boarding, the per-night service price is multiplied by the actual
    # nights stayed so a 3-night stay at $50/night auto-prefills as $150.
    def _maybe_apply_nights(unit: float) -> float:
        if booking.get("service_type") != "boarding":
            return unit
        try:
            start_d = date.fromisoformat(booking.get("date"))
            end_d = date.fromisoformat(booking.get("end_date") or booking.get("date"))
            nights_stayed = max(1, (end_d - start_d).days or 1)
        except Exception:
            nights_stayed = 1
        return unit * nights_stayed

    if will_charge and not booking.get("actual_price"):
        # Honour explicit override from the modal.
        if body.base_price is not None:
            base_price = float(body.base_price)
            update["actual_price"] = base_price
        elif not booking.get("service_id"):
            # Sprint 110ar — Training visits are sold via packages, so a
            # check-out without an explicit amount means "$0 owed today".
            # Don't pre-fill from the catalog (was causing phantom revenue).
            if booking.get("service_type") == "training":
                base_price = 0.0
                update["actual_price"] = 0.0
            else:
                default_svc = await db.services.find_one(
                    {"service_type": booking.get("service_type"), "is_default": True, "active": True},
                    {"_id": 0},
                )
                if default_svc:
                    update["service_id"] = default_svc["id"]
                    update["service_name"] = default_svc["name"]
                    unit_price = float(default_svc.get("base_price") or 0)
                    base_price = _maybe_apply_nights(unit_price)
                    update["actual_price"] = round(base_price, 2)
        else:
            base_price = float(booking.get("actual_price") or 0)
    elif booking.get("actual_price"):
        base_price = float(booking["actual_price"])

    # ── Boarding stay extension: dog stayed past their original end_date.
    # Update booking.end_date, optionally consume extra boarding credits, and
    # bill the difference. Only meaningful for boarding bookings.
    extra_nights = int(body.extra_nights or 0)
    extra_charge_total = 0.0
    extra_nights_billed = 0
    extra_credits_used = 0
    if extra_nights > 0 and booking.get("service_type") == "boarding":
        # Extend end_date by N days from the existing end_date (or date if no end_date).
        try:
            base_end = booking.get("end_date") or booking.get("date")
            new_end = (date.fromisoformat(base_end) + timedelta(days=extra_nights)).isoformat()
            update["end_date"] = new_end
        except Exception:
            pass
        # First, try to draw from remaining boarding credits if the client opted in.
        client_doc = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
        if body.extra_nights_use_credits and client_doc:
            available = int(client_doc.get("boarding_credits") or 0)
            extra_credits_used = min(extra_nights, available)
            if extra_credits_used > 0:
                extra_credit_value, extra_lot_ids = await _consume_credit_lots(
                    booking["client_id"], extra_credits_used, "boarding"
                )
                await db.clients.update_one(
                    {"id": booking["client_id"]}, {"$inc": {"boarding_credits": -extra_credits_used}}
                )
                # Sprint 110g — low-credit email when extra-night burns drop pool.
                await _maybe_send_low_credit_email(
                    booking["client_id"], "boarding", available - extra_credits_used
                )
                # Stack onto whatever credit_value already existed on the booking.
                prev_credit_value = float(booking.get("credit_value") or 0)
                update["credit_value"] = round(prev_credit_value + float(extra_credit_value), 2)
                update["credits_deducted"] = int(booking.get("credits_deducted") or 0) + extra_credits_used
                # Track lots for refund-on-cancel safety.
                update["credit_lot_ids"] = list(booking.get("credit_lot_ids") or []) + list(extra_lot_ids or [])
        # Whatever nights weren't covered by credits get billed.
        extra_nights_billed = extra_nights - extra_credits_used
        if extra_nights_billed > 0:
            settings = await get_settings()
            rules = (settings.get("booking_rules") or {})
            per_night = body.extra_nights_rate if body.extra_nights_rate is not None else float(rules.get("boarding_rate") or 0)
            extra_charge_total = round(extra_nights_billed * float(per_night), 2)
            if extra_charge_total > 0:
                # Add this charge to actual_price (will be combined with base + add-ons below).
                prev_price = float(update.get("actual_price") or booking.get("actual_price") or 0)
                update["actual_price"] = round(prev_price + extra_charge_total, 2)
        # Audit trail on the booking so income reporting can reflect the extension.
        update["extra_nights"] = {
            "count": extra_nights,
            "credits_used": extra_credits_used,
            "billed_nights": extra_nights_billed,
            "per_night_rate": float(body.extra_nights_rate) if body.extra_nights_rate is not None else None,
            "charge": extra_charge_total,
            "added_at": ts,
        }

    # ── Add-ons: sum prices, persist line items, fold into actual_price.
    # Sprint 110an — pre-attached add-ons (added at booking or check-in) live
    # on booking.add_ons already. We merge those with any new ones the admin
    # is adding right now at check-out, dedupe by (service_id + added_at) to
    # avoid double-billing, and tally the combined total.
    add_on_total = 0.0
    add_on_rows: List[Dict[str, Any]] = []
    seen_keys = set()
    # Pre-attached first (preserves price-at-time-of-booking semantics)
    for ao in (booking.get("add_ons") or []):
        key = (ao.get("service_id"), ao.get("added_at"))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        line_total = float(ao.get("price") or 0) * int(ao.get("qty") or 1)
        add_on_total += line_total
        add_on_rows.append({
            "service_id": ao.get("service_id"),
            "name": ao.get("name"),
            "icon": ao.get("icon"),
            "price": float(ao.get("price") or 0),
            "list_price": ao.get("list_price"),
            "price_override_id": ao.get("price_override_id"),
            "qty": int(ao.get("qty") or 1),
            "line_total": round(line_total, 2),
            "added_at": ao.get("added_at"),
            "added_stage": ao.get("added_stage") or "booking",
        })
    # New add-ons specified in this check-out call (admin POS upsell moment)
    for ao in body.add_ons:
        line_total = float(ao.price) * int(ao.qty)
        add_on_total += line_total
        add_on_rows.append({
            "service_id": ao.service_id,
            "name": ao.name,
            "price": float(ao.price),
            "qty": int(ao.qty),
            "line_total": round(line_total, 2),
            "added_at": ts,
            "added_stage": "checkout",
        })
    if add_on_rows:
        update["add_ons"] = add_on_rows
        # Add-ons stack on top of whatever the base ended up being.
        prev_price = float(update.get("actual_price") or booking.get("actual_price") or 0)
        update["actual_price"] = round(prev_price + add_on_total, 2)

    # ── Sprint 110: multi-dog household discount.
    # Auto-applied to the 2nd-and-later dog of the same client on the same
    # date. The first dog checked out that day pays full price; subsequent
    # checkouts get the configured percent-or-flat discount. We compute it
    # AFTER add-ons + extra nights but BEFORE finalizing payment, so the
    # discount is visible as its own line on the receipt.
    multi_dog_discount_amount = 0.0
    if (update.get("actual_price") or 0) > 0:
        try:
            # Pass the merged view (booking + update) so the discount calc
            # sees the price we're ABOUT to commit, not the pre-checkout value.
            merged_for_discount = {**booking, **update}
            discount = await _compute_multi_dog_discount(merged_for_discount, exclude_id=booking_id)
            if discount and discount["amount"] > 0:
                multi_dog_discount_amount = round(discount["amount"], 2)
                prev_price = float(update.get("actual_price") or 0)
                new_price = max(0.0, round(prev_price - multi_dog_discount_amount, 2))
                update["actual_price"] = new_price
                update["multi_dog_discount"] = {
                    "amount": multi_dog_discount_amount,
                    "mode": discount["mode"],
                    "value": discount["value"],
                    "label": discount["label"],
                    "service_type": discount.get("service_type"),
                    "based_on_price": prev_price,
                    "sibling_count": discount["sibling_count"],
                    "applied_at": ts,
                }
        except Exception as exc:
            logger.warning("multi-dog discount calc failed for %s: %s", booking_id, exc)

    # Resolve payment_status / payment_method when a charge is involved.
    is_paid_today = update.get("payment_method") == "credits"
    # Sprint 110aw — Sales tax. Tax is calculated on the PRE-TAX total
    # (base + add-ons + extra-night charges, minus discounts already applied
    # via update["actual_price"]) only when the service type is in the
    # configured `applies_to` list and the booking is being PAID in cash/card
    # (not via credits redemption — credits already include tax in the lot).
    # We add tax to `actual_price` so existing P&L code keeps working; the
    # tax slice is also captured in `tax_amount` for accurate filing.
    if not is_paid_today and (update.get("actual_price") or 0) > 0:
        try:
            settings_tx = await get_settings()
            tx_cfg = (settings_tx or {}).get("sales_tax") or {}
            if tx_cfg.get("enabled"):
                applies = (tx_cfg.get("applies_to") or {})
                svc = booking.get("service_type") or ""
                if applies.get(svc):
                    rate_pct = float(tx_cfg.get("rate_pct") or 0)
                    if rate_pct > 0:
                        pre_tax = float(update["actual_price"])
                        tax_amount = round(pre_tax * (rate_pct / 100.0), 2)
                        update["tax_amount"] = tax_amount
                        update["tax_rate_pct"] = rate_pct
                        update["actual_price"] = round(pre_tax + tax_amount, 2)
        except Exception as exc:
            logger.warning("sales tax calc failed for %s: %s", booking_id, exc)
    if not is_paid_today and (update.get("actual_price") or 0) > 0:
        if body.payment_method:
            update["payment_method"] = body.payment_method
        if body.payment_status:
            update["payment_status"] = body.payment_status
        elif "payment_status" not in update and not booking.get("payment_status"):
            update["payment_status"] = "unpaid"
        if update.get("payment_status") == "paid":
            update["paid_at"] = ts

    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)

    # 🎁 Referral reward: when the referred client COMPLETES their first-ever
    # appointment (any service), credit the referrer one free daycare day.
    # Guarded by referrals collection so it only ever fires once per referred client.
    try:
        client_id = booking.get("client_id")
        if client_id:
            client = await db.clients.find_one({"id": client_id}, {"_id": 0})
            ref_code = (client or {}).get("referred_by_code") or ""
            ref_code = ref_code.upper().strip()
            if ref_code and not await db.referrals.find_one({"referred_id": client_id}):
                # Was this the client's first checkout?
                prior = await db.bookings.count_documents({
                    "client_id": client_id,
                    "checked_out_at": {"$ne": None, "$exists": True},
                    "id": {"$ne": booking_id},
                })
                if prior == 0:
                    referrer = await db.clients.find_one({"referral_code": ref_code}, {"_id": 0})
                    # Don't credit self-referrals
                    if referrer and referrer.get("id") != client_id:
                        await db.clients.update_one(
                            {"id": referrer["id"]},
                            {"$inc": {"credits": 1}},
                        )
                        now = now_iso()
                        await db.referrals.insert_one({
                            "id": str(uuid.uuid4()),
                            "referrer_id": referrer["id"],
                            "referrer_name": referrer.get("name", ""),
                            "referred_id": client_id,
                            "referred_name": client.get("name", ""),
                            "bonus_credits": 1,
                            "trigger_booking_id": booking_id,
                            "trigger_service_type": booking.get("service_type", ""),
                            "note": "Auto-credit on first completed appointment",
                            "created_by": "system",
                            "created_at": now,
                        })
                        await db.credit_adjustments.insert_one({
                            "id": str(uuid.uuid4()),
                            "client_id": referrer["id"],
                            "client_name": referrer.get("name", ""),
                            "changes": {"daycare": {
                                "before": int(referrer.get("credits") or 0),
                                "delta": 1,
                                "after": int(referrer.get("credits") or 0) + 1,
                            }},
                            "note": f"Referral bonus — referred {client.get('name','')}",
                            "adjusted_by": "system",
                            "adjusted_at": now,
                        })
    except Exception as exc:
        logger.warning("Referral auto-credit hook failed: %s", exc)

    # 🏆 Re-evaluate client trophies for the dog's owner (visit count tiers)
    # AND for the referrer (successful-referrals tiers, if a referral row was
    # just inserted above).
    try:
        owner_id = booking.get("client_id")
        if owner_id:
            await check_client_trophies(db, owner_id)
        if ref_credit_referrer_id := await db.referrals.find_one(
            {"referred_id": booking.get("client_id"), "trigger_booking_id": booking_id},
            {"_id": 0, "referrer_id": 1},
        ):
            rid = ref_credit_referrer_id.get("referrer_id")
            if rid:
                await check_client_trophies(db, rid)
    except Exception as exc:
        logger.warning("Trophy check on checkout failed: %s", exc)

    return booking

@api.post("/bookings/{booking_id}/report-card", response_model=BookingOut)
async def save_report_card(booking_id: str, body: ReportCardIn, user: dict = Depends(require_employee_or_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    rc = {
        "photos": body.photos,
        "mood_tags": body.mood_tags,
        "note": body.note or "",
        "created_at": now_iso(),
        "created_by": user["id"],
        "created_by_name": user.get("display_name") or user.get("name"),
    }
    await db.bookings.update_one({"id": booking_id}, {"$set": {"report_card": rc}})
    booking["report_card"] = rc
    return booking

# -------- Vaccine Alerts --------
@api.get("/vaccine-alerts")
async def vaccine_alerts(_: dict = Depends(require_admin)):
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    warn_days = int(settings.get("vaccine_warning_days", 30))
    today = business_today().isoformat()
    in_warn = (business_today() + timedelta(days=warn_days)).isoformat()
    now_dt = datetime.now(timezone.utc)
    dismissals = await db.vaccine_dismissals.find({}, {"_id": 0}).to_list(2000)
    dismiss_map = {}
    for d in dismissals:
        try:
            until = datetime.fromisoformat(d["until"])
        except Exception:
            continue
        if until > now_dt:
            dismiss_map[d["dog_id"]] = d["until"]

    dogs = await db.dogs.find({}, {"_id": 0}).to_list(2000)
    clients = {c["id"]: c["name"] for c in await db.clients.find({}, {"_id": 0}).to_list(2000)}
    alerts = []
    for d in dogs:
        if d["id"] in dismiss_map:
            continue
        vaccines = d.get("vaccines") or {}
        flagged_vax = None
        flagged_status = None
        flagged_date = ""
        for v in required:
            r = vaccines.get(v, "")
            if not r:
                if flagged_status != "expired":
                    flagged_vax, flagged_status, flagged_date = v, "missing", ""
            elif r < today:
                flagged_vax, flagged_status, flagged_date = v, "expired", r
                break
            elif r <= in_warn:
                if flagged_status not in ("expired", "missing"):
                    flagged_vax, flagged_status, flagged_date = v, "expiring", r
        if flagged_vax:
            alerts.append({
                "dog_id": d["id"],
                "dog_name": d["name"],
                "owner_id": d["owner_id"],
                "owner_name": clients.get(d["owner_id"], "—"),
                "vaccine": flagged_vax,
                "rabies": flagged_date,  # back-compat with frontend label
                "status": flagged_status,
            })
    return alerts

class DismissIn(BaseModel):
    dog_id: str

@api.post("/vaccine-alerts/{dog_id}/dismiss")
async def dismiss_alert(dog_id: str, _: dict = Depends(require_admin)):
    until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.vaccine_dismissals.update_one(
        {"dog_id": dog_id},
        {"$set": {"dog_id": dog_id, "until": until}},
        upsert=True,
    )
    return {"ok": True, "until": until}


# -------- Settings --------
DEFAULT_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DEFAULT_VACCINES = ["rabies", "bordetella", "dhpp"]
DEFAULT_MOOD_TAGS = ["Playful", "Calm", "Napped Well", "Made a Friend", "Worked on Training", "Star of the Day", "Tired Pup", "Extra Hungry"]

DEFAULT_WAIVER_TEXT = """**1. Assumption of Risk**
I, the Client, acknowledge that dog training, daycare, and boarding involve inherent risks of injury, disease, or death to animals and humans. I recognize that dogs are unpredictable animals and I assume all risks associated with my dog's participation in any service provided by Sit Happens Dog Training.

**2. Balanced Training Methods & Professional Tools**
I acknowledge and agree that Sit Happens Dog Training utilizes Balanced Training Methods. This includes a combination of positive reinforcement (food, toys, praise) and fair, clear corrections using professional tools. I authorize the use of tools including, but not limited to, slip leads, prong collars, and electronic collars (e-collars) as deemed appropriate for my dog's behavior modification and safety.

**3. Health & Vaccination Requirements**
I certify that my dog is in good health and is current on the following vaccinations: Rabies, Bordetella, and DHPP/DA2PP. I understand that Sit Happens reserves the right to deny entry to any animal lacking verifiable records or exhibiting symptoms of illness.

**4. Primitive Breed & Wolf-Dog Hybrid Clause**
Clients owning primitive breeds, high-drive working dogs, or wolf-dog hybrids acknowledge that these animals require specialized management. The Client assumes full legal and financial responsibility for any unpredictable behavior inherent to these breeds.

**5. Photography & Media Release**
I grant Sit Happens Dog Training and Sit Happens Pet Photography permission to capture and use media (photos and videos) of my dog for training logs, marketing, social media, and educational purposes. I waive all rights to compensation for the use of such media.

**6. Indemnification & Hold Harmless**
I agree to indemnify, defend, and hold harmless Sit Happens Dog Training, Garrett Compston, and all associated staff from any and all claims, damages, or liabilities arising from my dog's behavior, including but not limited to, injury to other dogs, staff, or damage to property."""

def _default_hours_grid(open_t="07:00", close_t="19:00"):
    return {d: {"open": open_t, "close": close_t, "closed": d == "sunday"} for d in DEFAULT_DAYS}

def _default_settings() -> dict:
    return {
        "id": "global",
        "business_hours": _default_hours_grid("07:00", "19:00"),
        "service_hours": {
            "daycare": _default_hours_grid("07:00", "19:00"),
            "boarding": {"mode": "24_7"},
            "training": _default_hours_grid("09:00", "17:00"),
            "grooming": _default_hours_grid("09:00", "17:00"),
            "photography": _default_hours_grid("09:00", "17:00"),
        },
        "daycare_capacity": DAYCARE_CAPACITY,
        "boarding_capacity": 10,
        "kennels": ["Kennel A", "Kennel B", "Kennel C", "Kennel D", "Suite 1", "Suite 2"],
        "booking_rules": {
            "max_advance_days": 60,
            "cancellation_cutoff_hours": 24,
            "auto_approve": False,
            "daycare_cost": 1,
            "boarding_cost_per_night": 1,
            "training_cost": 1,
        },
        "required_vaccines": DEFAULT_VACCINES,
        "vaccine_warning_days": 30,
        "mood_tags": DEFAULT_MOOD_TAGS,
        "waiver_text": DEFAULT_WAIVER_TEXT,
        "waiver_required_for_booking": True,
        "waiver_version": 1,
        "service_descriptions": {
            "daycare": "Drop your dog off for the day to play, socialise, and get supervised exercise.",
            "boarding": "Overnight stays in our climate-controlled kennels with daily playtime.",
            "training": "1-on-1 sessions with your trainer working through your dog's training program.",
            "grooming": "Bath services and nail trims — keep your pup looking sharp.",
            "photography": "Professional pet photography sessions. Capture your pup's personality with a custom shoot.",
        },
        # External links shown on the client portal. Blank = button hidden.
        "client_portal_links": {
            "website_url": "",
            "photo_gallery_url": "",
        },
        # Sprint 110aw — Sales tax (single flat rate, configurable scope).
        "sales_tax": {
            "enabled": False,
            "rate_pct": 0.0,           # e.g. 8.875 for NY
            "label": "Sales Tax",
            "applies_to": {            # which revenue lines are taxable
                "daycare": False,
                "boarding": False,
                "training": False,
                "grooming": True,      # commonly taxable in many states
                "photography": True,
                "retail": True,
                "credit_packs": False,
            },
        },
        # Sprint 110aw — Birthday auto-email toggle. Default ON to preserve
        # existing behavior (the email job has been firing since Sprint 38).
        "birthday_email": {
            "enabled": True,
        },
        # Sprint 110aw — Meet-n-Greet / Temperament Evaluation requirement.
        # When `require_evaluation_first=True`, new prospect clients can only
        # book the evaluation service until they're marked `client_status=active`.
        "evaluation": {
            "require_evaluation_first": False,
        },
    }

async def get_settings() -> dict:
    s = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = _default_settings()
        await db.settings.insert_one(s.copy())
    # backfill any missing top-level keys (forward compat)
    defaults = _default_settings()
    changed = False
    for k, v in defaults.items():
        if k not in s:
            s[k] = v
            changed = True
    # Nested backfill for service_hours so new services (e.g. grooming) show up for existing installs
    if isinstance(s.get("service_hours"), dict):
        for svc_key, svc_default in (defaults.get("service_hours") or {}).items():
            if svc_key not in s["service_hours"]:
                s["service_hours"][svc_key] = svc_default
                changed = True
    # Nested backfill for service_descriptions
    if isinstance(s.get("service_descriptions"), dict):
        for svc_key, svc_default in (defaults.get("service_descriptions") or {}).items():
            if svc_key not in s["service_descriptions"]:
                s["service_descriptions"][svc_key] = svc_default
                changed = True
    # Backfill client_portal_links
    if not isinstance(s.get("client_portal_links"), dict):
        s["client_portal_links"] = defaults.get("client_portal_links", {})
        changed = True
    else:
        for lk, lv in (defaults.get("client_portal_links") or {}).items():
            if lk not in s["client_portal_links"]:
                s["client_portal_links"][lk] = lv
                changed = True
    if changed:
        await db.settings.update_one({"id": "global"}, {"$set": s}, upsert=True)
    return s

class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    business_hours: Optional[dict] = None
    service_hours: Optional[dict] = None
    daycare_capacity: Optional[int] = None
    boarding_capacity: Optional[int] = None
    kennels: Optional[List[str]] = None
    booking_rules: Optional[dict] = None
    required_vaccines: Optional[List[str]] = None
    vaccine_warning_days: Optional[int] = None
    mood_tags: Optional[List[Any]] = None  # accepts legacy List[str] OR new List[{label, icon}]
    waiver_text: Optional[str] = None
    waiver_required_for_booking: Optional[bool] = None
    waiver_version: Optional[int] = None
    service_descriptions: Optional[dict] = None
    client_portal_links: Optional[dict] = None
    closed_dates: Optional[List[str]] = None  # ISO dates the business is closed (holidays, vacations)
    # Branding (Sprint 68) — admin-set, applies to everyone (login screen, portal, admin shell)
    brand_primary: Optional[str] = None      # CSS color for the primary action (default #8cc63f green)
    brand_accent: Optional[str] = None       # CSS color for accents/highlights (default #00a9e0 blue)
    brand_warning: Optional[str] = None      # CSS color for warnings/alerts (default #f26522 orange)
    brand_font_family: Optional[str] = None  # one of: Inter, Nunito, Poppins, Roboto, System
    # Footer pill (Sprint 76)
    brand_footer_text: Optional[str] = None  # text shown in the bottom-right pill (default "Sit Happens")
    brand_footer_url: Optional[str] = None   # link target (default "" = no link, just text)
    # Card gradients (Sprint 78) — colors auto-applied to semantic card surfaces
    grad_hero_color: Optional[str] = None     # default #8cc63f — credit balance, dashboard hero stat
    grad_info_color: Optional[str] = None     # default #00a9e0 — info banners, secondary stat tiles
    grad_warning_color: Optional[str] = None  # default #f59e0b — vaccine expiring, low credits
    grad_danger_color: Optional[str] = None   # default #ef4444 — vaccine missing, server errors
    grad_success_color: Optional[str] = None  # default #8cc63f — approved bookings, trophies earned
    # Sprint 105 — notification preferences
    email_per_step: Optional[bool] = None  # when True, fire an email on EVERY homework step completion (default False; daily roll-up is always on)
    # Sprint 110 — multi-dog household discount (auto-applied at check-out for
    # the 2nd-and-later dog from the same client on the same date)
    multi_dog_discount_enabled: Optional[bool] = None
    multi_dog_discount_mode: Optional[Literal["percent", "flat"]] = None  # default "percent"
    multi_dog_discount_value: Optional[float] = None  # 10 = 10% or $10 depending on mode
    multi_dog_discount_label: Optional[str] = None    # display label on the receipt
    # Sprint 110h — per-service-type discount config so daycare and boarding
    # can have totally different discount tiers (e.g. 15% off daycare, $20 off
    # boarding nights, training waived). Keyed by service_type → {enabled, mode, value, label}.
    multi_dog_discount_by_service: Optional[Dict[str, Dict[str, Any]]] = None

@api.get("/settings")
async def fetch_settings(_: dict = Depends(require_admin)):
    return await get_settings()

@api.get("/branding")
async def fetch_branding():
    """Unauthenticated endpoint — returns just the brand colors + font so the
    login screen can theme itself before the user has a token."""
    s = await get_settings()
    return {
        "brand_primary":     s.get("brand_primary")     or "#8cc63f",
        "brand_accent":      s.get("brand_accent")      or "#00a9e0",
        "brand_warning":     s.get("brand_warning")     or "#f26522",
        "brand_font_family": s.get("brand_font_family") or "Inter",
        "brand_footer_text": s.get("brand_footer_text") or "Sit Happens",
        "brand_footer_url":  s.get("brand_footer_url")  or "",
        "grad_hero_color":    s.get("grad_hero_color")    or "#8cc63f",
        "grad_info_color":    s.get("grad_info_color")    or "#00a9e0",
        "grad_warning_color": s.get("grad_warning_color") or "#f59e0b",
        "grad_danger_color":  s.get("grad_danger_color")  or "#ef4444",
        "grad_success_color": s.get("grad_success_color") or "#8cc63f",
    }

@api.get("/settings/public")
async def fetch_public_settings(user: dict = Depends(get_current_user)):
    """Limited settings exposed to clients for booking validation."""
    s = await get_settings()
    return {
        "service_hours": s.get("service_hours"),
        "kennels": s.get("kennels"),
        "booking_rules": s.get("booking_rules"),
        "mood_tags": s.get("mood_tags"),
        "required_vaccines": s.get("required_vaccines"),
        "waiver_text": s.get("waiver_text"),
        "waiver_version": s.get("waiver_version", 1),
        "waiver_required_for_booking": s.get("waiver_required_for_booking", True),
        "service_descriptions": s.get("service_descriptions") or {},
        "client_portal_links": s.get("client_portal_links") or {},
        "closed_dates": s.get("closed_dates") or [],
    }

@api.put("/settings")
async def save_settings(body: SettingsIn, _: dict = Depends(require_admin)):
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        return await get_settings()
    await db.settings.update_one({"id": "global"}, {"$set": update}, upsert=True)
    return await get_settings()


# -------- Change Password --------
class ChangePwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)

@api.post("/auth/change-password")
async def change_password(body: ChangePwIn, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}


# -------- Per-user UI Preferences (Sprint 68) --------
# Each user (admin or client) can pick their own text size. Stored on the user
# document under `preferences`. Read via GET /me/preferences, write via PUT.
ALLOWED_TEXT_SIZES = ["S", "M", "L", "XL"]

class PreferencesIn(BaseModel):
    text_size: Optional[str] = None  # one of S/M/L/XL

@api.get("/me/preferences")
async def get_my_prefs(user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "preferences": 1})
    return (full or {}).get("preferences") or {"text_size": "M"}

@api.put("/me/preferences")
async def set_my_prefs(body: PreferencesIn, user: dict = Depends(get_current_user)):
    update = {}
    if body.text_size is not None:
        ts = body.text_size.upper()
        if ts not in ALLOWED_TEXT_SIZES:
            raise HTTPException(status_code=400, detail=f"text_size must be one of {ALLOWED_TEXT_SIZES}")
        update["preferences.text_size"] = ts
    if not update:
        return await get_my_prefs(user)
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return await get_my_prefs(user)


# -------- Waivers --------
class WaiverSignIn(BaseModel):
    typed_name: str = Field(min_length=2)
    accepted: bool = True
    dog_names: Optional[str] = ""  # free-text list of dogs covered

@api.get("/waivers/me")
async def my_waiver(user: dict = Depends(get_current_user)):
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    if not cid:
        return {"signed": False}
    settings = await get_settings()
    current_version = int(settings.get("waiver_version", 1))
    sig = await db.waiver_signatures.find_one(
        {"client_id": cid}, {"_id": 0}, sort=[("signed_at", -1)]
    )
    if not sig:
        return {"signed": False, "current_version": current_version}
    return {
        "signed": True,
        "current_version": current_version,
        "signature": sig,
        "needs_resign": int(sig.get("waiver_version", 1)) < current_version,
    }

@api.post("/waivers/sign")
async def sign_waiver(body: WaiverSignIn, request: Request, user: dict = Depends(get_current_user)):
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    if not cid:
        raise HTTPException(status_code=400, detail="No client record linked to your account")
    if not body.accepted:
        raise HTTPException(status_code=400, detail="You must accept the terms to sign")
    settings = await get_settings()
    sig = {
        "id": str(uuid.uuid4()),
        "client_id": cid,
        "client_name": user.get("name", ""),
        "typed_name": body.typed_name.strip(),
        "dog_names": body.dog_names or "",
        "waiver_version": int(settings.get("waiver_version", 1)),
        "waiver_text_snapshot": settings.get("waiver_text", ""),
        "ip": request.headers.get("x-forwarded-for", request.client.host if request.client else ""),
        "user_agent": request.headers.get("user-agent", ""),
        "signed_at": now_iso(),
    }
    await db.waiver_signatures.insert_one(sig)
    sig.pop("_id", None)
    return sig

@api.get("/waivers")
async def list_waivers(_: dict = Depends(require_admin)):
    items = await db.waiver_signatures.find({}, {"_id": 0}).sort("signed_at", -1).to_list(2000)
    return items

@api.get("/clients/{client_id}/waiver")
async def client_waiver(client_id: str, _: dict = Depends(require_admin)):
    sig = await db.waiver_signatures.find_one({"client_id": client_id}, {"_id": 0}, sort=[("signed_at", -1)])
    return sig or {"signed": False}


# -------- Incident Reports --------
class IncidentIn(BaseModel):
    dog_id: str
    date: str           # YYYY-MM-DD
    time: Optional[str] = ""  # HH:MM
    type: Literal["bite", "injury", "escape", "illness", "property_damage", "behavior", "other"] = "other"
    severity: Literal["minor", "moderate", "severe"] = "minor"
    description: str = Field(min_length=3)
    witnesses: Optional[str] = ""
    action_taken: Optional[str] = ""
    photos: List[str] = []
    vet_required: bool = False
    follow_up_required: bool = False

class IncidentOut(IncidentIn):
    id: str
    dog_name: str
    client_id: str
    client_name: str
    reported_by: str
    created_at: str

@api.get("/incidents", response_model=List[IncidentOut])
async def list_incidents(_: dict = Depends(require_admin), dog_id: Optional[str] = None):
    q = {"dog_id": dog_id} if dog_id else {}
    items = await db.incidents.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items

@api.post("/incidents", response_model=IncidentOut)
async def create_incident(body: IncidentIn, user: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "reported_by": user.get("name", "Admin"),
        "created_at": now_iso(),
    })
    await db.incidents.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/incidents/{incident_id}", response_model=IncidentOut)
async def update_incident(incident_id: str, body: IncidentIn, _: dict = Depends(require_admin)):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    update = body.model_dump()
    await db.incidents.update_one({"id": incident_id}, {"$set": update})
    existing.update(update)
    return existing

@api.delete("/incidents/{incident_id}")
async def delete_incident(incident_id: str, _: dict = Depends(require_admin)):
    await db.incidents.delete_one({"id": incident_id})
    return {"ok": True}


# -------- Booking Edit (Admin) --------
class BookingPatchIn(BaseModel):
    notes: Optional[str] = None
    kennel: Optional[str] = None
    dropoff_time: Optional[str] = None
    pickup_time: Optional[str] = None
    time: Optional[str] = None  # appointment time for training/grooming/photography

@api.patch("/bookings/{booking_id}", response_model=BookingOut)
async def patch_booking(booking_id: str, body: BookingPatchIn, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if update:
        await db.bookings.update_one({"id": booking_id}, {"$set": update})
        booking.update(update)
    return booking


# -------- Dog Lifetime Stats --------
@api.get("/dogs/{dog_id}/stats")
async def dog_stats(dog_id: str, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    bookings = await db.bookings.find({"dog_id": dog_id}, {"_id": 0}).to_list(2000)
    daycare_days = 0
    boarding_nights = 0
    training_sessions = 0
    last_visit = None
    today = business_today().isoformat()
    for b in bookings:
        if b["status"] in ("cancelled", "rejected"):
            continue
        days = _dates_in_range(b["date"], b.get("end_date"))
        past_days = [d for d in days if d <= today]
        if b["service_type"] == "daycare":
            daycare_days += len(past_days)
        elif b["service_type"] == "boarding":
            boarding_nights += len(past_days)
        elif b["service_type"] == "training":
            training_sessions += len(past_days)
        if past_days:
            last_visit = max(past_days) if not last_visit else max(last_visit, max(past_days))
    incidents_count = await db.incidents.count_documents({"dog_id": dog_id})
    homework_completed = await db.homework.count_documents({"dog_id": dog_id, "status": "completed"})
    homework_assigned = await db.homework.count_documents({"dog_id": dog_id, "status": "assigned"})
    return {
        "dog_id": dog_id,
        "daycare_days": daycare_days,
        "boarding_nights": boarding_nights,
        "training_sessions": training_sessions,
        "last_visit": last_visit,
        "incidents": incidents_count,
        "homework_completed": homework_completed,
        "homework_assigned": homework_assigned,
    }


# -------- Search --------
@api.get("/search")
async def search(q: str, _: dict = Depends(require_admin)):
    q = q.strip().lower()
    if len(q) < 1:
        return {"clients": [], "dogs": []}
    clients = await db.clients.find({}, {"_id": 0}).to_list(2000)
    dogs = await db.dogs.find({}, {"_id": 0}).to_list(2000)
    client_hits = []
    for c in clients:
        if q in (c.get("name") or "").lower() or q in (c.get("email") or "").lower() or q in (c.get("phone") or "").lower():
            client_hits.append({"id": c["id"], "name": c["name"], "email": c.get("email"), "phone": c.get("phone")})
    dog_hits = []
    owner_name = {c["id"]: c["name"] for c in clients}
    for d in dogs:
        if q in (d.get("name") or "").lower() or q in (d.get("breed") or "").lower():
            dog_hits.append({"id": d["id"], "name": d["name"], "breed": d.get("breed"), "owner_name": owner_name.get(d.get("owner_id"), ""), "owner_id": d.get("owner_id")})
    return {"clients": client_hits[:10], "dogs": dog_hits[:10]}


# -------- Homework Assignments --------
class HomeworkIn(BaseModel):
    dog_id: str
    title: str = Field(min_length=2)
    instructions: str = ""
    video_url: Optional[str] = ""
    due_date: Optional[str] = ""

class HomeworkCompleteIn(BaseModel):
    note: Optional[str] = ""
    photo: Optional[str] = ""

@api.get("/homework")
async def list_homework(user: dict = Depends(get_current_user), dog_id: Optional[str] = None):
    q = {}
    if user.get("role") != "admin":
        q["client_id"] = user.get("client_id")
    if dog_id:
        q["dog_id"] = dog_id
    items = await db.homework.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    # Sprint 107 — enrich daily-tracker rows with streak/total_days so the
    # admin Homework list can show a live progress bar without an extra fetch
    # per row. Non-tracker homework is returned unchanged.
    for it in items:
        if it.get("daily_tracker"):
            try:
                prog = _compute_daily_progress(it)
                it["total_days"] = len(prog)
                it["streak"] = _streak_count(prog)
            except Exception:
                pass
    return items

@api.post("/homework")
async def create_homework(body: HomeworkIn, user: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "status": "assigned",
        "created_at": now_iso(),
        "assigned_by": user.get("name", "Admin"),
        "completed_at": None,
        "completion_note": "",
        "completion_photo": "",
    })
    await db.homework.insert_one(doc)
    doc.pop("_id", None)
    # Best-effort: let the client know they have new homework.
    if client:
        try:
            await notify_client_homework_assigned(doc, client)
        except Exception:
            pass
    return doc

@api.delete("/homework/{homework_id}")
async def delete_homework(homework_id: str, _: dict = Depends(require_admin)):
    await db.homework.delete_one({"id": homework_id})
    return {"ok": True}

@api.post("/homework/{homework_id}/complete")
async def complete_homework(homework_id: str, body: HomeworkCompleteIn, user: dict = Depends(get_current_user)):
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    update = {
        "status": "completed",
        "completed_at": now_iso(),
        "completion_note": body.note or "",
        "completion_photo": body.photo or "",
    }
    await db.homework.update_one({"id": homework_id}, {"$set": update})
    hw.update(update)
    # Notify the operator when a client completes homework (skip admin-triggered marks).
    if user.get("role") != "admin":
        try:
            client = await db.clients.find_one({"id": hw.get("client_id")}, {"_id": 0}) or {}
            dog = await db.dogs.find_one({"id": hw.get("dog_id")}, {"_id": 0}) or {}
            await notify_admin_homework_completed(hw, client, dog)
        except Exception:
            pass
    # 🏆 Re-evaluate trophy eligibility for the client (streak + completed counts).
    try:
        if hw.get("client_id"):
            await check_client_trophies(db, hw["client_id"])
    except Exception as exc:
        logger.warning("Client trophy check failed: %s", exc)
    return hw


# -------- Homework Templates Library --------
from homework_templates_data import SEED_TEMPLATES

TIERS = ["foundation", "intermediate", "advanced", "specialty", "master"]


class HomeworkTemplateIn(BaseModel):
    slug: Optional[str] = ""
    name: str = Field(min_length=2)
    tier: Literal["foundation", "intermediate", "advanced", "specialty", "master"] = "master"
    description: Optional[str] = ""
    default_duration_days: int = 7
    cover_color: Optional[str] = ""
    icon: Optional[str] = ""
    global_rules_this_week: List[str] = []
    sections: List[dict] = []
    active: bool = True


class HomeworkFromTemplateIn(BaseModel):
    dog_id: str
    template_id: str
    title_override: Optional[str] = ""
    instructions_override: Optional[str] = ""
    due_date: Optional[str] = ""
    video_url: Optional[str] = ""
    custom_global_rules: Optional[List[str]] = None  # if provided, replaces template rules


class SectionLogIn(BaseModel):
    section_id: str
    date: Optional[str] = ""  # YYYY-MM-DD, defaults today
    field_values: Dict[str, object] = {}
    note: Optional[str] = ""


@api.get("/homework-templates")
async def list_homework_templates(_: dict = Depends(get_current_user)):
    tpls = await db.homework_templates.find({"active": True}, {"_id": 0}).to_list(500)
    # Sort by tier (foundation → master) then name
    order = {t: i for i, t in enumerate(TIERS)}
    tpls.sort(key=lambda t: (order.get(t.get("tier"), 99), t.get("name", "")))
    return tpls


@api.post("/homework-templates")
async def create_homework_template(body: HomeworkTemplateIn, user: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "slug": doc.get("slug") or doc["name"].lower().replace(" ", "_")[:40],
        "is_default": False,
        "active": True,
        "created_at": now_iso(),
        "created_by": user.get("name", "Admin"),
    })
    await db.homework_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/homework-templates/{template_id}")
async def update_homework_template(template_id: str, body: HomeworkTemplateIn, _: dict = Depends(require_admin)):
    tpl = await db.homework_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    update = body.model_dump()
    update.pop("slug", None)  # don't allow slug edit via PUT
    update.pop("is_default", None)  # never let the API flip system-vs-custom
    update.pop("active", None)  # active is toggled only via DELETE (soft) / seed (restore)
    # Mark system templates as customized so seed-standard skips overwriting them
    if tpl.get("is_default"):
        update["customized"] = True
    await db.homework_templates.update_one({"id": template_id}, {"$set": update})
    return {**tpl, **update}


@api.delete("/homework-templates/{template_id}")
async def delete_homework_template(template_id: str, _: dict = Depends(require_admin)):
    tpl = await db.homework_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    # System-seeded templates are soft-deleted (so reseed restores them).
    if tpl.get("is_default"):
        await db.homework_templates.update_one({"id": template_id}, {"$set": {"active": False}})
    else:
        await db.homework_templates.delete_one({"id": template_id})
    return {"ok": True}


@api.post("/homework-templates/seed-standard")
async def seed_homework_templates(_: dict = Depends(require_admin)):
    """Idempotent — upserts by slug. Re-running refreshes content for default
    templates that haven't been customized."""
    seeded = 0
    for tpl in SEED_TEMPLATES:
        existing = await db.homework_templates.find_one({"slug": tpl["slug"]}, {"_id": 0})
        doc = {
            **tpl,
            "is_default": True,
            "active": True,
        }
        if existing:
            # Preserve user customizations: only overwrite if still untouched.
            if existing.get("is_default") and not existing.get("customized"):
                await db.homework_templates.update_one(
                    {"id": existing["id"]},
                    {"$set": {**doc, "updated_at": now_iso()}},
                )
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now_iso()
            await db.homework_templates.insert_one(doc)
            seeded += 1
    total = await db.homework_templates.count_documents({"active": True})
    return {"seeded": seeded, "total_active": total}


@api.post("/homework/from-template")
async def create_homework_from_template(body: HomeworkFromTemplateIn, user: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    tpl = await db.homework_templates.find_one({"id": body.template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})

    # Compute due_date from default_duration_days if none provided.
    due = body.due_date or ""
    if not due and tpl.get("default_duration_days"):
        due = (business_today() + timedelta(days=int(tpl["default_duration_days"]))).isoformat()

    snapshot = {
        "template_id": tpl["id"],
        "slug": tpl.get("slug"),
        "name": tpl.get("name"),
        "tier": tpl.get("tier"),
        "description": tpl.get("description"),
        "cover_color": tpl.get("cover_color"),
        "icon": tpl.get("icon"),
        "global_rules_this_week": body.custom_global_rules if body.custom_global_rules is not None else tpl.get("global_rules_this_week", []),
        "sections": tpl.get("sections", []),
    }

    # Sprint 110ad — Carry the `daily_tracker` flag from the template through to
    # the new homework instance, otherwise day-pip / Today's-plan UX is lost
    # and the plan rendered as a session-log template (the screenshot bug).
    is_daily_tracker = bool(tpl.get("daily_tracker"))
    total_days = 0
    if is_daily_tracker:
        secs = [s for s in tpl.get("sections", []) if s.get("day_number")]
        total_days = len(secs) or int(tpl.get("default_duration_days") or 0)

    doc = {
        "id": str(uuid.uuid4()),
        "dog_id": dog["id"],
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "title": body.title_override or tpl["name"],
        "instructions": body.instructions_override or tpl.get("description", ""),
        "video_url": body.video_url or "",
        "due_date": due,
        "status": "assigned",
        "created_at": now_iso(),
        "assigned_by": user.get("name", "Admin"),
        "completed_at": None,
        "completion_note": "",
        "completion_photo": "",
        "template_snapshot": snapshot,
        "section_logs": [],
        "daily_tracker": is_daily_tracker,
        "total_days": total_days,
    }
    await db.homework.insert_one(doc)
    doc.pop("_id", None)
    # Best-effort: let the client know they have new homework.
    if client:
        try:
            await notify_client_homework_assigned(doc, client)
        except Exception:
            pass
    return doc


@api.post("/homework/{homework_id}/section-log")
async def log_section(homework_id: str, body: SectionLogIn, user: dict = Depends(get_current_user)):
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("template_snapshot"):
        raise HTTPException(status_code=400, detail="This homework has no template sections to log against")
    # Validate section_id exists in snapshot
    section_ids = {s["id"] for s in hw["template_snapshot"].get("sections", [])}
    if body.section_id not in section_ids:
        raise HTTPException(status_code=400, detail="Unknown section_id")

    entry = {
        "id": str(uuid.uuid4()),
        "section_id": body.section_id,
        "date": body.date or business_today().isoformat(),
        "field_values": body.field_values or {},
        "note": body.note or "",
        "logged_by": user.get("name", ""),
        "logged_at": now_iso(),
    }
    await db.homework.update_one(
        {"id": homework_id},
        {"$push": {"section_logs": entry}},
    )
    hw["section_logs"] = (hw.get("section_logs") or []) + [entry]
    # Notify the operator when a client logs a session (skip self-logs by admin).
    if user.get("role") != "admin":
        try:
            client = await db.clients.find_one({"id": hw.get("client_id")}, {"_id": 0}) or {}
            dog = await db.dogs.find_one({"id": hw.get("dog_id")}, {"_id": 0}) or {}
            await notify_admin_homework_section_log(hw, entry, client, dog)
        except Exception:
            pass
    return hw


@api.delete("/homework/{homework_id}/section-log/{log_id}")
async def delete_section_log(homework_id: str, log_id: str, user: dict = Depends(get_current_user)):
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.homework.update_one(
        {"id": homework_id},
        {"$pull": {"section_logs": {"id": log_id}}},
    )
    return {"ok": True}


@api.get("/homework/{homework_id}/report")
async def homework_report(homework_id: str, user: dict = Depends(get_current_user)):
    """Aggregated stats per section. Numeric fields → total, avg, max, count;
    text fields → most-recent value; rating_5 → avg + trend."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    snap = hw.get("template_snapshot") or {}
    logs = hw.get("section_logs") or []

    numeric_kinds = {"reps", "sets", "duration_sec", "duration_min", "distance_ft", "success_rate", "rating_5"}
    text_kinds = {"text", "longtext"}

    report = {"homework_id": homework_id, "sections": [], "total_logs": len(logs), "days_logged": len({log.get("date", "") for log in logs if log.get("date")})}
    for section in snap.get("sections", []):
        section_logs = [log for log in logs if log["section_id"] == section["id"]]
        section_logs.sort(key=lambda x: x.get("date", ""))
        section_summary = {
            "section_id": section["id"],
            "title": section.get("title"),
            "log_count": len(section_logs),
            "last_logged": section_logs[-1]["date"] if section_logs else None,
            "fields": [],
        }
        for field in section.get("fields", []):
            fid = field["id"]
            kind = field.get("kind")
            vals = [log["field_values"].get(fid) for log in section_logs if log["field_values"].get(fid) not in (None, "")]
            field_summary = {"field_id": fid, "label": field.get("label"), "kind": kind, "target": field.get("target"), "reverse": field.get("reverse", False)}
            if kind in numeric_kinds:
                nums = []
                for v in vals:
                    try:
                        nums.append(float(v))
                    except (TypeError, ValueError):
                        continue
                if nums:
                    field_summary.update({
                        "total": sum(nums),
                        "avg": round(sum(nums) / len(nums), 1),
                        "max": max(nums),
                        "min": min(nums),
                        "count": len(nums),
                        "trend": _trend(nums),
                    })
                else:
                    field_summary.update({"total": 0, "avg": 0, "max": 0, "min": 0, "count": 0, "trend": "flat"})
            elif kind in text_kinds:
                field_summary["latest"] = vals[-1] if vals else ""
                field_summary["entries"] = [{"date": log.get("date", ""), "value": log["field_values"].get(fid)} for log in section_logs if log["field_values"].get(fid)]
            elif kind == "checkbox":
                yeses = sum(1 for v in vals if v is True or str(v).lower() == "true")
                field_summary.update({"yes_count": yeses, "entry_count": len(vals)})
            section_summary["fields"].append(field_summary)
        report["sections"].append(section_summary)
    return report


def _trend(nums: List[float]) -> str:
    if len(nums) < 2:
        return "flat"
    first = sum(nums[: len(nums) // 2]) / max(1, len(nums) // 2)
    last = sum(nums[len(nums) // 2:]) / max(1, len(nums) - len(nums) // 2)
    if last > first * 1.10:
        return "up"
    if last < first * 0.90:
        return "down"
    return "flat"


# ────────────────────────── Daily Tracker (homework) ──────────────────────────
# A homework can be authored as a "daily tracker": instead of section_logs being
# free-form, each section has a `day_number` (1, 2, 3…). Days unlock sequentially
# — the client submits a day's check-in, the admin reviews+approves, and then
# day N+1 unlocks. This sits ON TOP of the existing template/section schema:
# legacy templates without day_number continue to work in single-section logger.
class DailyTrackerSectionIn(BaseModel):
    day_number: int = Field(ge=1, le=120)
    # Sprint 110j — raised from 200 → 2000 chars so longer day-focus
    # descriptions don't get rejected/truncated on save.
    day_focus: str = Field(min_length=1, max_length=2000)
    instructions: Optional[str] = ""
    equipment: Optional[List[str]] = []  # e.g., ["high-value treats", "6-ft leash"]
    fields: List[dict] = []  # [{id, label, kind, ...}] — same shape as legacy fields
    # Sprint 103 — "Homework-Driven Tracker": named checklist steps for the day.
    # Each step is `{id?, label, minutes?}` — when ALL steps are checked the day auto-submits.
    # Backward-compatible: trackers without steps still work via the field/metric flow.
    steps: Optional[List[dict]] = []
    # Sprint 105 — printable per-day resources (PDFs, images). Each resource is
    # `{id, name, kind: "file"|"image"|"link", media_id?, url?}`. media_id refers
    # to /api/homework-media uploads. url is for external links.
    resources: Optional[List[dict]] = []


class DailyTrackerCreateIn(BaseModel):
    dog_id: str
    title: str = Field(min_length=2, max_length=120)
    instructions: Optional[str] = ""
    video_url: Optional[str] = ""
    days: List[DailyTrackerSectionIn] = Field(min_length=1, max_length=120)
    global_rules_this_week: Optional[List[str]] = []
    save_as_template: Optional[bool] = False
    template_name: Optional[str] = ""  # used if save_as_template=True
    # Sprint 105 — plan-level resources, shared across all days (e.g. a
    # 1-page summary the client takes outside every day).
    resources: Optional[List[dict]] = []


class DaySubmitIn(BaseModel):
    field_values: Dict[str, object] = {}
    note: Optional[str] = ""
    mood: Optional[int] = None  # 1-5
    photo: Optional[str] = ""   # base64 data-url (small previews only)
    video_media_id: Optional[str] = ""   # id of an uploaded video in homework_media


class DayRestIn(BaseModel):
    note: Optional[str] = ""  # optional reason ("vet visit", "sick", etc.)


class DayQuestionIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class DayAnswerIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class CertificateUploadIn(BaseModel):
    photo: str = Field(min_length=1)  # base64 data-url, image or pdf data
    filename: Optional[str] = "certificate"


class ReminderSettingsIn(BaseModel):
    """Client-controlled practice reminders for daily-tracker homework."""
    enabled: bool = False
    days: List[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]] = []
    time: Optional[str] = ""  # HH:MM 24-hour local time


class DayReviewIn(BaseModel):
    action: Literal["approve", "needs_redo"]
    note: Optional[str] = ""


def _normalize_resources(items: list) -> list:
    """Sanitize a list of resource dicts. Each resource = {id, name, kind, media_id?, url?}.
    Kind is `file`, `image`, or `link`. media_id refers to homework_media uploads;
    url is for external links. Drops empty/invalid entries."""
    out = []
    for r in items or []:
        if not isinstance(r, dict):
            continue
        kind = (r.get("kind") or "file").strip().lower()
        if kind not in ("file", "image", "link"):
            kind = "file"
        name = (r.get("name") or "").strip()[:140]
        media_id = (r.get("media_id") or "").strip() or None
        url = (r.get("url") or "").strip() or None
        if not media_id and not url:
            continue
        if not name:
            name = "Resource"
        out.append({
            "id": (r.get("id") or "").strip() or f"res-{uuid.uuid4().hex[:8]}",
            "kind": kind,
            "name": name,
            "media_id": media_id,
            "url": url,
        })
    return out



def _compute_daily_progress(hw: dict) -> List[dict]:
    """Walk template_snapshot.sections (sorted by day_number) and emit a
    per-day status: locked / available / submitted / approved / needs_redo.

    Sprint 110p — once a client submits a day's log, the NEXT day unlocks
    immediately so they can advance themselves (client-driven advancement
    system). Trainer can still flag a day `needs_redo` later — that re-locks
    subsequent days via the normal chain because `needs_redo` is NOT a
    pass status.
    """
    snap = hw.get("template_snapshot") or {}
    sections = sorted(
        [s for s in snap.get("sections", []) if s.get("day_number")],
        key=lambda s: int(s.get("day_number") or 0),
    )
    if not sections:
        return []
    logs_by_day: Dict[int, dict] = {}
    for log in hw.get("section_logs") or []:
        dn = log.get("day_number")
        if dn:
            logs_by_day[int(dn)] = log  # latest one wins (we never push duplicates per day)
    progress: List[dict] = []
    prev_passed = True
    for s in sections:
        dn = int(s["day_number"])
        log = logs_by_day.get(dn)
        status = "locked"
        if prev_passed and not log:
            status = "available"
        if log:
            status = log.get("submission_status") or "submitted"
        progress.append({
            "day_number": dn,
            "day_focus": s.get("day_focus") or s.get("title", ""),
            "title": s.get("title", ""),
            "instructions": s.get("instructions", ""),
            "equipment": s.get("equipment") or [],
            "fields": s.get("fields", []),
            "steps": s.get("steps") or [],
            "step_states": (log or {}).get("step_states") or {},
            "resources": s.get("resources") or [],
            "section_id": s.get("id"),
            "status": status,           # locked | available | submitted | approved | needs_redo | rest | skipped
            "is_rest_day": bool(log and log.get("is_rest_day")),
            "is_skipped": bool(log and log.get("is_skipped")),
            "questions": (log or {}).get("questions") or [],
            "log": log,                  # full submission incl. mood/photo/note
        })
        # Sprint 110p — `submitted` is now a pass status too, so the next day
        # unlocks the moment the client logs the current one.
        prev_passed = status in ("approved", "submitted", "rest", "skipped")
    return progress


def _streak_count(progress: List[dict]) -> int:
    """Count consecutive passed days from Day 1 forward — approved, rest, or skipped."""
    n = 0
    for p in progress:
        if p.get("status") in ("approved", "rest", "skipped"):
            n += 1
        else:
            break
    return n


@api.get("/homework/{homework_id}")
async def get_homework_detail(homework_id: str, user: dict = Depends(get_current_user)):
    """Single-homework detail. Enriched with `daily_progress` + `streak` when
    the homework is a daily-tracker."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if hw.get("daily_tracker"):
        prog = _compute_daily_progress(hw)
        hw["daily_progress"] = prog
        hw["streak"] = _streak_count(prog)
        hw["total_days"] = len(prog)
    return hw


@api.post("/homework/daily-tracker")
async def create_daily_tracker(body: DailyTrackerCreateIn, user: dict = Depends(require_admin)):
    """Build a daily-tracker homework from a per-day plan. Optionally also
    save the structure as a reusable template (for next time)."""
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})

    # Normalise each day into a section (with id, fields w/ id, day_number, day_focus)
    sections: List[dict] = []
    for d in sorted(body.days, key=lambda x: x.day_number):
        sec_id = f"day-{d.day_number}"
        fields: List[dict] = []
        for f in d.fields or []:
            fid = (f.get("id") or "").strip() or f"f-{uuid.uuid4().hex[:6]}"
            fields.append({
                "id": fid,
                "label": (f.get("label") or "Untitled").strip(),
                "kind": f.get("kind") or "text",
                "target": f.get("target"),
                "placeholder": f.get("placeholder") or "",
            })
        sections.append({
            "id": sec_id,
            "day_number": int(d.day_number),
            "day_focus": d.day_focus.strip(),
            "title": f"Day {d.day_number} · {d.day_focus.strip()}",
            "instructions": (d.instructions or "").strip(),
            "equipment": [(e or "").strip() for e in (d.equipment or []) if (e or "").strip()],
            "fields": fields,
            # Sprint 103 — normalize steps with stable ids so toggle endpoints
            # can target them across resubmissions.
            "steps": [
                {
                    "id": (s.get("id") or "").strip() or f"step-{uuid.uuid4().hex[:6]}",
                    # Sprint 110j — raised from 200 → 2000 chars so long
                    # step instructions like "Charge the Marker (2 mins): Low
                    # distraction. Sit with your dog. Say your marker word
                    # (e.g., 'Yes!') or click, and immediately give a
                    # high-value treat. Do this 10-15 times without asking
                    # for anything." don't get chopped mid-sentence.
                    "label": (s.get("label") or "Step").strip()[:2000],
                    "minutes": int(s["minutes"]) if isinstance(s.get("minutes"), (int, float)) and int(s["minutes"]) > 0 else None,
                    "description": (s.get("description") or "").strip()[:5000] or None,
                    "notes": (s.get("notes") or "").strip()[:5000] or None,
                }
                for s in (d.steps or [])
                if (s.get("label") or "").strip()
            ],
            "resources": _normalize_resources(d.resources or []),
        })

    due = (business_today() + timedelta(days=len(sections))).isoformat()
    snapshot = {
        "kind": "daily_tracker",
        "name": body.title,
        "description": body.instructions or "",
        "global_rules_this_week": body.global_rules_this_week or [],
        "sections": sections,
    }
    doc = {
        "id": str(uuid.uuid4()),
        "dog_id": dog["id"],
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "title": body.title,
        "instructions": body.instructions or "",
        "video_url": body.video_url or "",
        "due_date": due,
        "status": "assigned",
        "daily_tracker": True,
        "total_days": len(sections),
        "created_at": now_iso(),
        "assigned_by": user.get("name", "Admin"),
        "completed_at": None,
        "completion_note": "",
        "completion_photo": "",
        "template_snapshot": snapshot,
        "section_logs": [],
        "resources": _normalize_resources(body.resources or []),  # Sprint 105 — plan-level resources shared across all days
    }
    await db.homework.insert_one(doc)
    doc.pop("_id", None)

    if body.save_as_template and body.template_name:
        # Persist as a reusable template (custom, not default).
        tpl_doc = {
            "id": str(uuid.uuid4()),
            "slug": body.template_name.lower().replace(" ", "_")[:40],
            "name": body.template_name,
            "tier": "specialty",
            "description": body.instructions or "",
            "default_duration_days": len(sections),
            "cover_color": "#22d3ee",
            "icon": "fa-calendar-check",
            "global_rules_this_week": body.global_rules_this_week or [],
            "sections": sections,
            "daily_tracker": True,
            "is_default": False,
            "active": True,
            "created_at": now_iso(),
            "created_by": user.get("name", "Admin"),
        }
        await db.homework_templates.insert_one(tpl_doc)

    if client:
        try:
            await notify_client_homework_assigned(doc, client)
        except Exception:
            pass
    return doc


@api.post("/homework/{homework_id}/day/{day_number}/submit")
async def submit_day(
    homework_id: str,
    day_number: int,
    body: DaySubmitIn,
    user: dict = Depends(get_current_user),
):
    """Client (or admin on client's behalf) submits a day's check-in. Becomes
    `submitted` and lands in the admin review queue. If the previous day isn't
    yet approved, this is rejected. Resubmitting a `needs_redo` day re-queues it."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")
    prog = _compute_daily_progress(hw)
    cur = next((p for p in prog if p["day_number"] == day_number), None)
    if not cur:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    if cur["status"] == "locked":
        raise HTTPException(status_code=400, detail="Previous day hasn't been approved yet")
    if cur["status"] == "approved":
        raise HTTPException(status_code=400, detail="Day already approved")

    field_values = {}
    for k, v in (body.field_values or {}).items():
        field_values[str(k)] = v
    if body.mood is not None:
        field_values["__mood"] = max(1, min(5, int(body.mood)))
    if body.photo:
        field_values["__photo"] = body.photo  # base64 data-url; small previews ok
    if body.video_media_id:
        field_values["__video_id"] = body.video_media_id

    section_id = f"day-{day_number}"
    new_log = {
        "id": str(uuid.uuid4()),
        "section_id": section_id,
        "day_number": int(day_number),
        "date": business_today().isoformat(),
        "field_values": field_values,
        "note": (body.note or "").strip(),
        "submission_status": "submitted",
        "is_rest_day": False,
        "questions": [],  # preserved across resubmissions — see below
        "logged_by": user.get("name", ""),
        "logged_by_id": user.get("id"),
        "logged_by_role": user.get("role", "client"),
        "logged_at": now_iso(),
    }
    # Preserve any existing questions on resubmit so the conversation thread
    # doesn't reset when the client redoes a day.
    existing_log = next(
        (lo for lo in (hw.get("section_logs") or []) if int(lo.get("day_number") or 0) == int(day_number)),
        None,
    )
    if existing_log and existing_log.get("questions"):
        new_log["questions"] = existing_log["questions"]
    # Replace any existing log for that day (needs_redo flow).
    await db.homework.update_one(
        {"id": homework_id},
        {"$pull": {"section_logs": {"day_number": int(day_number)}}},
    )
    await db.homework.update_one(
        {"id": homework_id},
        {"$push": {"section_logs": new_log}},
    )

    # Best-effort: notify the operator that there's a new review pending
    if user.get("role") != "admin":
        try:
            client = await db.clients.find_one({"id": hw.get("client_id")}, {"_id": 0}) or {}
            dog = await db.dogs.find_one({"id": hw.get("dog_id")}, {"_id": 0}) or {}
            await notify_admin_homework_section_log(hw, new_log, client, dog)
        except Exception as exc:
            logger.warning("Daily tracker submit notify failed: %s", exc)

    # Return the refreshed homework with progress.
    return await get_homework_detail(homework_id, user)


@api.post("/homework/{homework_id}/day/{day_number}/review")
async def review_day(
    homework_id: str,
    day_number: int,
    body: DayReviewIn,
    user: dict = Depends(require_admin),
):
    """Admin approves a submitted day (unlocks the next) or sends it back."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")
    # Find the existing log for that day
    log = next(
        (lo for lo in (hw.get("section_logs") or []) if int(lo.get("day_number") or 0) == int(day_number)),
        None,
    )
    if not log:
        raise HTTPException(status_code=404, detail=f"No submission for Day {day_number}")
    if log.get("submission_status") == "approved" and body.action == "approve":
        # Idempotent — return current state
        return await get_homework_detail(homework_id, user)

    new_status = "approved" if body.action == "approve" else "needs_redo"
    patch = {
        "section_logs.$.submission_status": new_status,
        "section_logs.$.review_note": (body.note or "").strip(),
        "section_logs.$.reviewed_at": now_iso(),
        "section_logs.$.reviewed_by": user.get("name", "Admin"),
        "section_logs.$.reviewed_by_id": user.get("id"),
    }
    await db.homework.update_one(
        {"id": homework_id, "section_logs.day_number": int(day_number)},
        {"$set": patch},
    )

    # If this was the final day and admin approves → mark homework completed.
    refreshed = await db.homework.find_one({"id": homework_id}, {"_id": 0}) or {}
    prog = _compute_daily_progress(refreshed)
    all_approved = bool(prog) and all(p["status"] == "approved" for p in prog)
    if all_approved and refreshed.get("status") != "completed":
        await db.homework.update_one(
            {"id": homework_id},
            {"$set": {"status": "completed", "completed_at": now_iso()}},
        )
        # Trophy re-evaluation for the client
        try:
            if refreshed.get("client_id"):
                await check_client_trophies(db, refreshed["client_id"])
        except Exception as exc:
            logger.warning("Trophy check after daily-tracker completion failed: %s", exc)

    # Notify the client of the review outcome
    try:
        client = await db.clients.find_one({"id": refreshed.get("client_id")}, {"_id": 0}) or {}
        if client.get("email"):
            await notify_client_day_reviewed(refreshed, day_number, new_status, body.note or "", client)
    except Exception as exc:
        logger.warning("Daily tracker review notify failed: %s", exc)

    return await get_homework_detail(homework_id, user)


@api.post("/homework/{homework_id}/day/{day_number}/rest")
async def mark_rest_day(
    homework_id: str,
    day_number: int,
    body: DayRestIn,
    user: dict = Depends(get_current_user),
):
    """Client marks today as a rest day. Auto-passes (no admin approval needed),
    preserves the streak, unlocks the next day. Used for sick days, vet visits,
    travel, etc. — real life shouldn't break a training streak."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")
    prog = _compute_daily_progress(hw)
    cur = next((p for p in prog if p["day_number"] == day_number), None)
    if not cur:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    if cur["status"] == "locked":
        raise HTTPException(status_code=400, detail="Previous day hasn't passed yet")
    if cur["status"] == "approved":
        raise HTTPException(status_code=400, detail="Day already approved")

    # Preserve any prior question thread (resubmissions shouldn't wipe it)
    existing_log = next(
        (lo for lo in (hw.get("section_logs") or []) if int(lo.get("day_number") or 0) == int(day_number)),
        None,
    )
    new_log = {
        "id": str(uuid.uuid4()),
        "section_id": f"day-{day_number}",
        "day_number": int(day_number),
        "date": business_today().isoformat(),
        "field_values": {},
        "note": (body.note or "").strip(),
        "submission_status": "rest",   # special status → auto-passes
        "is_rest_day": True,
        "questions": (existing_log or {}).get("questions") or [],
        "logged_by": user.get("name", ""),
        "logged_by_id": user.get("id"),
        "logged_by_role": user.get("role", "client"),
        "logged_at": now_iso(),
    }
    await db.homework.update_one({"id": homework_id}, {"$pull": {"section_logs": {"day_number": int(day_number)}}})
    await db.homework.update_one({"id": homework_id}, {"$push": {"section_logs": new_log}})

    # If the rest day was the final day → mark hw complete (mirrors approve logic)
    refreshed = await db.homework.find_one({"id": homework_id}, {"_id": 0}) or {}
    new_prog = _compute_daily_progress(refreshed)
    all_passed = bool(new_prog) and all(p["status"] in ("approved", "rest") for p in new_prog)
    if all_passed and refreshed.get("status") != "completed":
        await db.homework.update_one(
            {"id": homework_id},
            {"$set": {"status": "completed", "completed_at": now_iso()}},
        )
    return await get_homework_detail(homework_id, user)


@api.post("/homework/{homework_id}/day/{day_number}/ask")
async def ask_question(
    homework_id: str,
    day_number: int,
    body: DayQuestionIn,
    user: dict = Depends(get_current_user),
):
    """Client (or admin) posts a question about a specific day. Threaded
    conversation tied to that day's log entry."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")

    log = next(
        (lo for lo in (hw.get("section_logs") or []) if int(lo.get("day_number") or 0) == int(day_number)),
        None,
    )
    question = {
        "id": str(uuid.uuid4()),
        "text": body.text.strip(),
        "asked_at": now_iso(),
        "asked_by": user.get("name", ""),
        "asked_by_role": user.get("role", "client"),
        "answer": "",
        "answered_at": None,
        "answered_by": "",
    }
    if log:
        await db.homework.update_one(
            {"id": homework_id, "section_logs.day_number": int(day_number)},
            {"$push": {"section_logs.$.questions": question}},
        )
    else:
        # No submission yet for this day → create a placeholder log so the
        # question still has somewhere to live. Status stays "available" until
        # the client actually submits.
        placeholder = {
            "id": str(uuid.uuid4()),
            "section_id": f"day-{day_number}",
            "day_number": int(day_number),
            "date": business_today().isoformat(),
            "field_values": {},
            "note": "",
            "submission_status": "draft",
            "is_rest_day": False,
            "questions": [question],
            "logged_by": user.get("name", ""),
            "logged_by_role": user.get("role", "client"),
            "logged_at": now_iso(),
        }
        await db.homework.update_one({"id": homework_id}, {"$push": {"section_logs": placeholder}})

    return await get_homework_detail(homework_id, user)


@api.post("/homework/{homework_id}/day/{day_number}/answer/{question_id}")
async def answer_question(
    homework_id: str,
    day_number: int,
    question_id: str,
    body: DayAnswerIn,
    user: dict = Depends(require_admin),
):
    """Admin answers a client's question on a specific day."""
    res = await db.homework.update_one(
        {"id": homework_id, "section_logs.day_number": int(day_number), "section_logs.questions.id": question_id},
        {
            "$set": {
                "section_logs.$[d].questions.$[q].answer": body.text.strip(),
                "section_logs.$[d].questions.$[q].answered_at": now_iso(),
                "section_logs.$[d].questions.$[q].answered_by": user.get("name", "Admin"),
            }
        },
        array_filters=[{"d.day_number": int(day_number)}, {"q.id": question_id}],
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return await get_homework_detail(homework_id, user)


# ────────────────────────── Daily-tracker media (video) ──────────────────────────
@api.post("/homework/{homework_id}/day/{day_number}/video")
async def upload_day_video(
    homework_id: str,
    day_number: int,
    body: CertificateUploadIn,  # reuse — single base64 payload
    user: dict = Depends(get_current_user),
):
    """Upload a short clip (~10s recommended) for a day's check-in. Stored in
    a separate `homework_media` collection so big payloads don't bloat the
    homework doc (Mongo 16 MB per-doc cap)."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0, "client_id": 1})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    media_id = str(uuid.uuid4())
    await db.homework_media.insert_one({
        "id": media_id,
        "homework_id": homework_id,
        "day_number": int(day_number),
        "kind": "video",
        "data": body.photo,
        "filename": (body.filename or "video"),
        "uploaded_at": now_iso(),
        "uploaded_by": user.get("id"),
    })
    return {"media_id": media_id}


# ────────────────────── Sprint 106 — Direct file upload for resources ──────────────────────
ALLOWED_RESOURCE_MIME = {
    "application/pdf": "file",
    "image/jpeg": "image", "image/jpg": "image",
    "image/png": "image", "image/webp": "image", "image/heic": "image",
}
MAX_RESOURCE_BYTES = 10 * 1024 * 1024  # 10 MB ceiling so the DB doesn't bloat


class ResourceFileUploadIn(BaseModel):
    """Direct file upload payload. `data` is a base64 data-URL (e.g.,
    `data:application/pdf;base64,JVBERi...`). Backend pulls the MIME from the
    prefix, validates it against the allow-list, and rejects files > 10 MB."""
    data: str = Field(min_length=10)
    filename: str = Field(min_length=1, max_length=140)


@api.post("/homework/resource-upload")
async def upload_resource_file(body: ResourceFileUploadIn, user: dict = Depends(require_admin)):
    """Admin-only file upload for homework resources (per-day or per-plan).
    Returns the media_id + auto-detected `kind` (file/image) for the resource
    record. PDFs and common image formats only; 10 MB ceiling. Stored in
    `homework_media` so it shares the same storage path as the existing
    video uploads."""
    raw = body.data
    if not raw.startswith("data:"):
        raise HTTPException(status_code=400, detail="Expected base64 data URL")
    # Parse `data:<mime>;base64,<...>`
    try:
        header, b64 = raw.split(",", 1)
        mime = header.split(";")[0].replace("data:", "").lower().strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed data URL")
    kind = ALLOWED_RESOURCE_MIME.get(mime)
    if not kind:
        raise HTTPException(status_code=400, detail=f"Unsupported file type ({mime}). Allowed: PDF, JPG, PNG, WEBP, HEIC.")
    # Approximate size from base64 length (4 b64 chars = 3 bytes)
    approx_bytes = (len(b64) * 3) // 4
    if approx_bytes > MAX_RESOURCE_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large ({approx_bytes // (1024 * 1024)} MB). Max is 10 MB.")
    media_id = str(uuid.uuid4())
    await db.homework_media.insert_one({
        "id": media_id,
        "homework_id": None,  # not tied to a specific homework yet — resources can be reused
        "kind": "resource",
        "mime": mime,
        "resource_kind": kind,
        "data": raw,
        "filename": (body.filename or "resource")[:140],
        "size_bytes": approx_bytes,
        "uploaded_at": now_iso(),
        "uploaded_by": user.get("id"),
    })
    return {
        "media_id": media_id,
        "kind": kind,        # file or image
        "mime": mime,
        "filename": body.filename,
        "size_bytes": approx_bytes,
    }


@api.get("/homework/resource/{media_id}")
async def get_resource_file(media_id: str, user: dict = Depends(get_current_user)):
    """Stream a resource blob. Clients can read it if the file is referenced
    by a homework they own, OR if it's a generic resource (homework_id=None).
    Admins can read anything."""
    m = await db.homework_media.find_one({"id": media_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Resource not found")
    if user.get("role") != "admin":
        # Check that at least one of the user's homework references this media_id.
        cid = user.get("client_id")
        found = await db.homework.find_one(
            {
                "client_id": cid,
                "$or": [
                    {"resources.media_id": media_id},
                    {"template_snapshot.sections.resources.media_id": media_id},
                ],
            },
            {"_id": 0, "id": 1},
        )
        if not found:
            raise HTTPException(status_code=403, detail="Not allowed")
    return {
        "id": m["id"],
        "kind": m.get("resource_kind") or "file",
        "mime": m.get("mime"),
        "data": m.get("data"),
        "filename": m.get("filename"),
    }





@api.get("/homework/{homework_id}/media/{media_id}")
async def get_day_media(homework_id: str, media_id: str, user: dict = Depends(get_current_user)):
    """Stream back a media blob (video) belonging to a homework."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0, "client_id": 1})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    m = await db.homework_media.find_one({"id": media_id, "homework_id": homework_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    return {"id": m["id"], "kind": m.get("kind"), "data": m.get("data"), "filename": m.get("filename")}


# ────────────────────────── Daily-tracker completion certificate ──────────────────────────
@api.post("/homework/{homework_id}/certificate")
async def upload_certificate(
    homework_id: str,
    body: CertificateUploadIn,
    user: dict = Depends(require_admin),
):
    """Trainer uploads a personalised certificate for a completed daily-tracker.
    Stored as base64 (or PDF data-url). Surfaces in the client portal as a
    'Download your certificate' CTA."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")
    await db.homework.update_one(
        {"id": homework_id},
        {"$set": {
            "certificate": body.photo,
            "certificate_filename": (body.filename or "certificate").strip(),
            "certificate_uploaded_at": now_iso(),
            "certificate_uploaded_by": user.get("name", "Admin"),
        }},
    )
    # Email the client a notice
    try:
        client = await db.clients.find_one({"id": hw.get("client_id")}, {"_id": 0}) or {}
        if client.get("email"):
            await notify_client_certificate_issued(hw, client)
    except Exception as exc:
        logger.warning("Cert notify failed: %s", exc)
    return {"ok": True}


@api.delete("/homework/{homework_id}/certificate")
async def remove_certificate(homework_id: str, _: dict = Depends(require_admin)):
    await db.homework.update_one(
        {"id": homework_id},
        {"$unset": {"certificate": "", "certificate_filename": "", "certificate_uploaded_at": "", "certificate_uploaded_by": ""}},
    )
    return {"ok": True}


# ────────────────────────── Client reminder settings ──────────────────────────
@api.get("/portal/reminder-settings")
async def get_reminder_settings(user: dict = Depends(get_current_user)):
    """Client reads their own practice-reminder preferences."""
    if user.get("role") != "client" or not user.get("client_id"):
        raise HTTPException(status_code=403, detail="Client only")
    c = await db.clients.find_one({"id": user["client_id"]}, {"_id": 0}) or {}
    return {
        "enabled": bool(c.get("homework_reminder_enabled")),
        "days": c.get("homework_reminder_days") or [],
        "time": c.get("homework_reminder_time") or "18:00",
    }


@api.put("/portal/reminder-settings")
async def set_reminder_settings(body: ReminderSettingsIn, user: dict = Depends(get_current_user)):
    """Client saves practice-reminder preferences. Sent as a daily email cron."""
    if user.get("role") != "client" or not user.get("client_id"):
        raise HTTPException(status_code=403, detail="Client only")
    # Light validation
    t = (body.time or "").strip() or "18:00"
    if t and (len(t) != 5 or t[2] != ":" or not t[:2].isdigit() or not t[3:].isdigit()):
        raise HTTPException(status_code=400, detail="time must be HH:MM")
    await db.clients.update_one(
        {"id": user["client_id"]},
        {"$set": {
            "homework_reminder_enabled": bool(body.enabled),
            "homework_reminder_days": body.days or [],
            "homework_reminder_time": t,
        }},
    )
    return {"ok": True}


@api.get("/dogs/{dog_id}/timeline")
async def dog_timeline(dog_id: str, limit: int = 80, user: dict = Depends(get_current_user)):
    """Unified activity stream for a single dog: bookings (check-in/out, completed),
    report cards, daily-tracker submissions/approvals, photos added, trophies,
    vaccines updated, payments. Ordered newest-first."""
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    # Permission: clients only see their own dogs
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")

    events: List[dict] = []

    # ── Bookings (one event per visit; report-card if present folds in)
    async for b in db.bookings.find({"dog_id": dog_id}, {"_id": 0}).sort("date", -1).limit(limit):
        evt = {
            "id": f"booking-{b['id']}",
            "ts": b.get("check_in_at") or (b.get("date", "") + "T00:00:00"),
            "kind": "booking",
            "service": b.get("service_type"),
            "status": b.get("status"),
            "title": _fmt_service(b),
            "date": b.get("date"),
            "end_date": b.get("end_date"),
            "report_card": b.get("report_card") or None,
            # Sprint 110co — care logs captured during the visit.
            "feeding_log": b.get("feeding_log") or [],
            "medication_log": b.get("medication_log") or [],
            "bathroom_log": b.get("bathroom_log") or None,
            "actual_price": b.get("actual_price"),
            "paid": b.get("paid", False),
        }
        events.append(evt)

    # ── Homework: assigned, day approvals, completions, certificate issued
    async for hw in db.homework.find({"dog_id": dog_id}, {"_id": 0}).sort("created_at", -1).limit(50):
        events.append({
            "id": f"hw-assigned-{hw['id']}",
            "ts": hw.get("created_at"),
            "kind": "homework_assigned",
            "title": hw.get("title", "Homework"),
            "homework_id": hw["id"],
            "daily_tracker": bool(hw.get("daily_tracker")),
        })
        if hw.get("status") == "completed":
            events.append({
                "id": f"hw-completed-{hw['id']}",
                "ts": hw.get("completed_at") or hw.get("created_at"),
                "kind": "homework_completed",
                "title": hw.get("title", ""),
                "homework_id": hw["id"],
                "has_cert": bool(hw.get("certificate")),
            })
        # Daily-tracker individual approved days
        if hw.get("daily_tracker"):
            for log in hw.get("section_logs") or []:
                if log.get("submission_status") == "approved":
                    events.append({
                        "id": f"day-approved-{hw['id']}-{log.get('day_number')}",
                        "ts": log.get("reviewed_at") or log.get("logged_at"),
                        "kind": "day_approved",
                        "title": f"Day {log.get('day_number')} approved — {hw.get('title','')}",
                        "homework_id": hw["id"],
                        "day_number": log.get("day_number"),
                        "mood": (log.get("field_values") or {}).get("__mood"),
                    })

    # ── Photo gallery additions (we don't store per-photo timestamps in the
    # array, so we surface a single rolled-up event if the dog has photos)
    photo_count = len(dog.get("photos") or [])
    if photo_count:
        events.append({
            "id": f"photos-{dog_id}",
            "ts": dog.get("updated_at") or dog.get("created_at"),
            "kind": "photos_added",
            "title": f"{photo_count} photo{'s' if photo_count != 1 else ''} on file",
            "count": photo_count,
        })

    # ── Incident log
    async for inc in db.incidents.find({"dog_id": dog_id}, {"_id": 0}).sort("date", -1).limit(20):
        events.append({
            "id": f"incident-{inc['id']}",
            "ts": inc.get("date") + "T00:00:00" if inc.get("date") else inc.get("created_at"),
            "kind": "incident",
            "title": inc.get("title", "Incident"),
            "severity": inc.get("severity"),
            "notes": inc.get("notes"),
        })

    # Sort newest-first by timestamp (treat missing as oldest)
    events.sort(key=lambda e: e.get("ts") or "0000", reverse=True)
    return events[:limit]


@api.get("/dogs/{dog_id}/behavior-trend")
async def dog_behavior_trend(dog_id: str, days: int = 60, user: dict = Depends(get_current_user)):
    """Aggregate mood (1-5) data points from daily-tracker submissions over the
    last N days into a sparkline-friendly series. Used by the Dog Hub + portal."""
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "owner_id": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")

    cutoff = (business_today() - timedelta(days=int(days))).isoformat()
    points: List[dict] = []
    async for hw in db.homework.find({"dog_id": dog_id, "daily_tracker": True}, {"_id": 0, "section_logs": 1, "title": 1}):
        for log in hw.get("section_logs") or []:
            m = (log.get("field_values") or {}).get("__mood")
            if not m:
                continue
            d = log.get("date") or ""
            if d < cutoff:
                continue
            points.append({"date": d, "mood": int(m), "plan": hw.get("title", "")})
    points.sort(key=lambda p: p["date"])
    if not points:
        return {"points": [], "avg": None, "trend": "flat", "count": 0}
    moods = [p["mood"] for p in points]
    avg = round(sum(moods) / len(moods), 2)
    # Simple trend: compare first half avg vs last half avg
    half = max(1, len(moods) // 2)
    first_half = sum(moods[:half]) / half
    last_half = sum(moods[-half:]) / half
    if last_half >= first_half + 0.4:
        trend = "up"
    elif last_half <= first_half - 0.4:
        trend = "down"
    else:
        trend = "flat"
    return {"points": points, "avg": avg, "trend": trend, "count": len(points)}


def _fmt_service(b: dict) -> str:
    """Format a booking row into a short timeline title."""
    svc = b.get("service_type") or "visit"
    date_s = b.get("date") or ""
    if b.get("status") == "completed":
        return f"{svc.capitalize()} on {date_s}"
    if b.get("check_in_at") and not b.get("check_out_at"):
        return f"Checked in for {svc} on {date_s}"
    return f"{svc.capitalize()} booked for {date_s}"


@api.post("/admin/homework/send-monday-digest")
async def admin_force_monday_digest(_: dict = Depends(require_admin)):
    """Force-fire the trainer Monday digest now (bypasses dedup for this week).
    Use this to preview the email or re-send after fixing something."""
    from daily_jobs import run_trainer_monday_digest_job
    from datetime import datetime, timezone as _tz
    today = datetime.now(_tz.utc).date().isoformat()
    await db.notification_log.delete_many({"key": {"$regex": f"^trainer_monday_digest:{today}$"}})
    return await run_trainer_monday_digest_job(db)


@api.post("/admin/homework/send-weekly-digest")
async def admin_force_weekly_digest(_: dict = Depends(require_admin)):
    """Force-fire the homework weekly digest (ignores the once-per-week dedup).
    Useful for: testing, sending early, or re-sending after a fix."""
    from daily_jobs import run_homework_weekly_digest_job
    from datetime import datetime, timedelta, timezone as _tz
    # Bust the dedup keys for THIS week so the job re-sends.
    today = datetime.now(_tz.utc).date()
    monday = today - timedelta(days=today.weekday())
    week_start = monday.isoformat()
    await db.notification_log.delete_many({"key": {"$regex": f"^hw_digest:.*:{week_start}$"}})
    result = await run_homework_weekly_digest_job(db)
    return result




# ────────────────────── Sprint 103 — Homework-Driven Tracker ──────────────────────
# Steps are checkable sub-tasks within a day. Toggling all steps auto-submits
# the day. A "catch-up" endpoint handles missed days with 3 strategies.

class StepToggleIn(BaseModel):
    step_id: str = Field(min_length=1, max_length=80)
    done: bool


@api.post("/homework/{homework_id}/day/{day_number}/toggle-step")
async def toggle_day_step(homework_id: str, day_number: int, body: StepToggleIn, user: dict = Depends(get_current_user)):
    """Check/uncheck a single step within a day. The day's section_log stays
    `in_progress` until the client (or admin) explicitly hits Mark Complete via
    `/day/{n}/submit` — checking steps alone never auto-submits, so the client
    still has time to fill in mood, note, photo, and any extra fields before the
    day moves to the admin review queue."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")

    snap = hw.get("template_snapshot") or {}
    section = next(
        (s for s in (snap.get("sections") or []) if int(s.get("day_number") or 0) == int(day_number)),
        None,
    )
    if not section:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    steps_def = section.get("steps") or []
    if not steps_def:
        raise HTTPException(status_code=400, detail="This day has no steps configured")
    if body.step_id not in {s.get("id") for s in steps_def}:
        raise HTTPException(status_code=404, detail=f"Step {body.step_id} not found on day {day_number}")

    # Make sure the day is available (no skipping ahead)
    prog = _compute_daily_progress(hw)
    cur = next((p for p in prog if p["day_number"] == day_number), None)
    if not cur:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    if cur["status"] == "locked":
        raise HTTPException(status_code=400, detail="Previous day hasn't been approved yet")

    # Find-or-create the day's section_log
    logs = hw.get("section_logs") or []
    existing_idx = next(
        (i for i, lo in enumerate(logs) if int(lo.get("day_number") or 0) == int(day_number)),
        None,
    )
    if existing_idx is None:
        log = {
            "id": str(uuid.uuid4()),
            "section_id": f"day-{day_number}",
            "day_number": int(day_number),
            "date": business_today().isoformat(),
            "field_values": {},
            "step_states": {},
            "note": "",
            "submission_status": "in_progress",
            "is_rest_day": False,
            "questions": [],
            "logged_by": user.get("name", ""),
            "logged_by_id": user.get("id"),
            "logged_by_role": user.get("role", "client"),
            "logged_at": now_iso(),
        }
        logs.append(log)
    else:
        log = logs[existing_idx]
        if log.get("submission_status") == "approved":
            raise HTTPException(status_code=400, detail="Day already approved")

    states = dict(log.get("step_states") or {})
    states[body.step_id] = bool(body.done)
    log["step_states"] = states

    # Sprint 110ah — don't auto-submit when all steps check off. The client
    # still needs to fill in mood/note/photo/extra fields before tapping
    # "Mark Complete" themselves. Tracked via `all_done` flag for the live feed.
    all_done = all(states.get(s["id"]) for s in steps_def)

    if existing_idx is None:
        await db.homework.update_one({"id": homework_id}, {"$set": {"section_logs": logs}})
    else:
        await db.homework.update_one(
            {"id": homework_id},
            {"$set": {f"section_logs.{existing_idx}": log}},
        )

    refreshed = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    refreshed["daily_progress"] = _compute_daily_progress(refreshed)
    refreshed["streak"] = _streak_count(refreshed["daily_progress"])
    refreshed["total_days"] = len(refreshed["daily_progress"])

    # Sprint 105 — log a step_event for the live feed + nightly rollup.
    if user.get("role") != "admin":
        step_label = next((s.get("label") for s in steps_def if s.get("id") == body.step_id), body.step_id)
        try:
            await db.step_events.insert_one({
                "id": str(uuid.uuid4()),
                "homework_id": homework_id,
                "client_id": refreshed.get("client_id"),
                "client_name": refreshed.get("client_name"),
                "dog_id": refreshed.get("dog_id"),
                "dog_name": refreshed.get("dog_name"),
                "day_number": int(day_number),
                "step_id": body.step_id,
                "step_label": step_label,
                "homework_title": refreshed.get("title"),
                "done": bool(body.done),
                "all_done": bool(all_done),
                "ts": now_iso(),
            })
        except Exception as e:
            logger.warning("step_event insert failed: %s", e)

    # Notify admin only when a real Mark Complete submission flips status to
    # `submitted` — toggle-step alone no longer auto-submits.

    # Sprint 105 — per-step email (off by default, opt-in via settings.email_per_step)
    if body.done and user.get("role") != "admin":
        try:
            settings = await get_settings()
            if bool(settings.get("email_per_step")):
                step_label = next((s.get("label") for s in steps_def if s.get("id") == body.step_id), body.step_id)
                await _send_per_step_email(refreshed, day_number, step_label, len(steps_def))
        except Exception as e:
            logger.warning("per-step email failed: %s", e)

    return refreshed


class CatchUpIn(BaseModel):
    strategy: Literal["shift_forward", "skip_missed", "double_up"]
    missed_day_number: int = Field(ge=1, le=120)


@api.post("/homework/{homework_id}/catch-up")
async def homework_catch_up(homework_id: str, body: CatchUpIn, user: dict = Depends(get_current_user)):
    """Apply one of 3 catch-up strategies after a client misses a day:
      * shift_forward — leave missed day as-is, extend due_date by 1
      * skip_missed   — mark missed day status=skipped so the next day unlocks
      * double_up     — copy missed day's steps into today's available day
    """
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    if user.get("role") != "admin" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not hw.get("daily_tracker"):
        raise HTTPException(status_code=400, detail="Not a daily-tracker homework")

    snap = hw.get("template_snapshot") or {}
    sections = sorted(
        [s for s in (snap.get("sections") or []) if s.get("day_number")],
        key=lambda s: int(s["day_number"]),
    )
    missed_section = next(
        (s for s in sections if int(s["day_number"]) == int(body.missed_day_number)),
        None,
    )
    if not missed_section:
        raise HTTPException(status_code=404, detail=f"Day {body.missed_day_number} not found")

    logs = list(hw.get("section_logs") or [])

    if body.strategy == "skip_missed":
        existing_idx = next(
            (i for i, lo in enumerate(logs) if int(lo.get("day_number") or 0) == int(body.missed_day_number)),
            None,
        )
        skip_log = {
            "id": str(uuid.uuid4()),
            "section_id": f"day-{body.missed_day_number}",
            "day_number": int(body.missed_day_number),
            "date": business_today().isoformat(),
            "field_values": {},
            "step_states": {},
            "note": "Skipped via catch-up",
            "submission_status": "skipped",
            "is_skipped": True,
            "is_rest_day": False,
            "questions": [],
            "logged_by": user.get("name", ""),
            "logged_by_id": user.get("id"),
            "logged_by_role": user.get("role", "client"),
            "logged_at": now_iso(),
        }
        if existing_idx is None:
            logs.append(skip_log)
        else:
            logs[existing_idx] = skip_log
        await db.homework.update_one({"id": homework_id}, {"$set": {"section_logs": logs}})

    elif body.strategy == "shift_forward":
        try:
            cur_due = datetime.fromisoformat(hw.get("due_date") or business_today().isoformat()).date()
        except Exception:
            cur_due = business_today()
        new_due = (cur_due + timedelta(days=1)).isoformat()
        await db.homework.update_one({"id": homework_id}, {"$set": {"due_date": new_due}})

    elif body.strategy == "double_up":
        # 1. Mark the missed day as skipped FIRST so the next day unlocks
        skip_log = {
            "id": str(uuid.uuid4()),
            "section_id": f"day-{body.missed_day_number}",
            "day_number": int(body.missed_day_number),
            "date": business_today().isoformat(),
            "field_values": {},
            "step_states": {},
            "note": "Carried forward via catch-up",
            "submission_status": "skipped",
            "is_skipped": True,
            "is_rest_day": False,
            "questions": [],
            "logged_by": user.get("name", ""),
            "logged_by_id": user.get("id"),
            "logged_by_role": user.get("role", "client"),
            "logged_at": now_iso(),
        }
        existing_idx = next(
            (i for i, lo in enumerate(logs) if int(lo.get("day_number") or 0) == int(body.missed_day_number)),
            None,
        )
        if existing_idx is None:
            logs.append(skip_log)
        else:
            logs[existing_idx] = skip_log
        await db.homework.update_one({"id": homework_id}, {"$set": {"section_logs": logs}})

        # 2. Recompute progress with the skip applied, find the now-available next day
        refreshed_tmp = await db.homework.find_one({"id": homework_id}, {"_id": 0})
        prog_now = _compute_daily_progress(refreshed_tmp)
        next_avail = next(
            (p for p in prog_now if p["status"] == "available" and int(p["day_number"]) > int(body.missed_day_number)),
            None,
        )
        if not next_avail:
            raise HTTPException(status_code=400, detail="No available day to double up onto")
        next_dn = int(next_avail["day_number"])
        sections_mut = snap.get("sections") or []
        next_section = next((s for s in sections_mut if int(s.get("day_number") or 0) == next_dn), None)
        missed_steps = missed_section.get("steps") or []
        if next_section is not None and missed_steps:
            new_steps = list(next_section.get("steps") or []) + [
                {"id": f"carryover-{s['id']}", "label": f"(catch-up) {s['label']}"} for s in missed_steps
            ]
            next_section["steps"] = new_steps
            await db.homework.update_one(
                {"id": homework_id},
                {"$set": {"template_snapshot.sections": sections_mut}},
            )

    refreshed = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    refreshed["daily_progress"] = _compute_daily_progress(refreshed)
    refreshed["streak"] = _streak_count(refreshed["daily_progress"])
    refreshed["total_days"] = len(refreshed["daily_progress"])
    refreshed["catch_up_applied"] = body.strategy
    return refreshed


@api.get("/portal/today-plan")
async def portal_today_plan(user: dict = Depends(get_current_user)):
    """Unified "what should I do today?" feed for the client portal. Pulls the
    NEXT-AVAILABLE day from every active daily-tracker homework owned by this
    client, returning a single flat checklist grouped by dog → homework."""
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    if not cid:
        raise HTTPException(status_code=400, detail="No client linked")

    today = business_today().isoformat()
    yesterday = (business_today() - timedelta(days=1)).isoformat()
    plan: List[dict] = []

    async for hw in db.homework.find(
        {"client_id": cid, "daily_tracker": True, "status": {"$ne": "completed"}},
        {"_id": 0},
    ):
        prog = _compute_daily_progress(hw)
        current = next((p for p in prog if p["status"] in ("available", "in_progress", "submitted", "needs_redo")), None)
        if not current:
            continue
        missed = None
        for p in prog:
            if p["day_number"] >= current["day_number"]:
                break
            if p["status"] in ("available", "in_progress"):
                missed = p["day_number"]
                break
        step_states = current.get("step_states") or {}
        plan.append({
            "homework_id": hw["id"],
            "dog_id": hw.get("dog_id"),
            "dog_name": hw.get("dog_name", ""),
            "title": hw.get("title", ""),
            "day_number": current["day_number"],
            "total_days": len(prog),
            # Sprint 110p — full per-day status list so the portal can render a
            # greyed-out pip strip showing the whole advancement chain at-a-glance
            # (Day 1 done / Day 2 today / Day 3,4,5 locked).
            "day_statuses": [
                {"day_number": p["day_number"], "status": p["status"]}
                for p in prog
            ],
            "day_focus": current.get("day_focus", ""),
            "instructions": current.get("instructions", ""),
            "status": current["status"],
            "steps": [
                {
                    "id": s["id"],
                    "label": s["label"],
                    "done": bool(step_states.get(s["id"])),
                    "minutes": s.get("minutes"),
                    "description": s.get("description") or "",
                    "notes": s.get("notes") or "",
                }
                for s in current.get("steps") or []
            ],
            "fields": current.get("fields") or [],
            "resources": current.get("resources") or [],
            "plan_resources": hw.get("resources") or [],
            "all_done": bool(current.get("steps")) and all(step_states.get(s["id"]) for s in current.get("steps") or []),
            "missed_yesterday": missed is not None,
            "missed_day_number": missed,
            "streak": _streak_count(prog),
        })
    plan.sort(key=lambda p: (not p["missed_yesterday"], p["dog_name"]))
    return {"date": today, "yesterday": yesterday, "items": plan, "count": len(plan)}



# ────────────────────── Sprint 105 — Resources + Step Events ──────────────────────

class ResourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    kind: Literal["file", "image", "link"] = "file"
    media_id: Optional[str] = None
    url: Optional[str] = None


@api.post("/homework/{homework_id}/resource")
async def add_plan_resource(homework_id: str, body: ResourceIn, _: dict = Depends(require_admin)):
    """Attach a printable resource (PDF/image/link) to a plan. Shows up under
    every day card in the client portal so they can grab it on the way out."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    res = _normalize_resources([body.model_dump()])
    if not res:
        raise HTTPException(status_code=400, detail="Resource needs a media_id or url")
    cur = hw.get("resources") or []
    cur.append(res[0])
    await db.homework.update_one({"id": homework_id}, {"$set": {"resources": cur}})
    return {"resources": cur}


@api.delete("/homework/{homework_id}/resource/{resource_id}")
async def remove_plan_resource(homework_id: str, resource_id: str, _: dict = Depends(require_admin)):
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    cur = [r for r in (hw.get("resources") or []) if r.get("id") != resource_id]
    await db.homework.update_one({"id": homework_id}, {"$set": {"resources": cur}})
    return {"resources": cur}


@api.post("/homework/{homework_id}/day/{day_number}/resource")
async def add_day_resource(homework_id: str, day_number: int, body: ResourceIn, _: dict = Depends(require_admin)):
    """Attach a printable resource to a specific day only (e.g., Day 1 has a
    leash-positioning diagram, Day 4 has a recall cue chart)."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    snap = hw.get("template_snapshot") or {}
    sections = snap.get("sections") or []
    section = next((s for s in sections if int(s.get("day_number") or 0) == int(day_number)), None)
    if not section:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    res = _normalize_resources([body.model_dump()])
    if not res:
        raise HTTPException(status_code=400, detail="Resource needs a media_id or url")
    section["resources"] = (section.get("resources") or []) + [res[0]]
    await db.homework.update_one({"id": homework_id}, {"$set": {"template_snapshot.sections": sections}})
    return {"resources": section["resources"]}


@api.delete("/homework/{homework_id}/day/{day_number}/resource/{resource_id}")
async def remove_day_resource(homework_id: str, day_number: int, resource_id: str, _: dict = Depends(require_admin)):
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    snap = hw.get("template_snapshot") or {}
    sections = snap.get("sections") or []
    section = next((s for s in sections if int(s.get("day_number") or 0) == int(day_number)), None)
    if not section:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")
    section["resources"] = [r for r in (section.get("resources") or []) if r.get("id") != resource_id]
    await db.homework.update_one({"id": homework_id}, {"$set": {"template_snapshot.sections": sections}})
    return {"resources": section["resources"]}


@api.get("/admin/homework/recent-steps")
async def admin_recent_step_events(
    since_hours: int = 24,
    _: dict = Depends(require_admin),
):
    """Live feed of step completions across all clients. Powers the in-app
    "what just happened" panel; default 24h window."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, min(168, since_hours)))).isoformat()
    events: List[dict] = []
    async for ev in db.step_events.find(
        {"ts": {"$gte": cutoff}, "done": True},
        {"_id": 0},
    ).sort("ts", -1).limit(200):
        events.append(ev)
    return {"events": events, "count": len(events), "since": cutoff}


async def _send_per_step_email(hw: dict, day_number: int, step_label: str, total_steps: int) -> None:
    """Fire a tiny per-step email to ADMIN_NOTIFICATION_EMAIL. Only called when
    settings.email_per_step is on (off by default). Subject keeps it scannable."""
    try:
        from email_service import _send, ADMIN_NOTIFICATION_EMAIL  # type: ignore
    except Exception:
        return
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    subj = f"[Step done] {hw.get('dog_name', '?')} · Day {day_number} · {step_label[:60]}"
    body_html = f"""
    <p>Step completed for <strong>{hw.get('dog_name', '?')}</strong> ({hw.get('client_name', '?')}).</p>
    <ul>
      <li><strong>Plan:</strong> {hw.get('title', '—')}</li>
      <li><strong>Day:</strong> {day_number} of {hw.get('total_days') or '?'}</li>
      <li><strong>Step:</strong> {step_label}</li>
    </ul>
    <p style="color:#9ca3af; font-size:12px;">To turn off per-step emails, go to Settings → Notifications and switch off "Email me on every step".</p>
    """
    try:
        await _send(ADMIN_NOTIFICATION_EMAIL, subj, body_html)
    except Exception:
        pass




@api.get("/admin/homework/pending-reviews")
async def list_pending_reviews(_: dict = Depends(require_admin)):
    """All days across all daily-tracker homework that are awaiting admin
    review (status=submitted). Ordered oldest-submitted first."""
    items: List[dict] = []
    cursor = db.homework.find(
        {"daily_tracker": True, "section_logs.submission_status": "submitted"},
        {"_id": 0},
    )
    async for hw in cursor:
        for log in hw.get("section_logs") or []:
            if log.get("submission_status") != "submitted":
                continue
            items.append({
                "homework_id": hw["id"],
                "dog_id": hw.get("dog_id"),
                "dog_name": hw.get("dog_name"),
                "client_id": hw.get("client_id"),
                "client_name": hw.get("client_name"),
                "title": hw.get("title"),
                "day_number": int(log.get("day_number") or 0),
                "total_days": int(hw.get("total_days") or 0),
                "submitted_at": log.get("logged_at"),
                "note": log.get("note"),
                "has_photo": bool((log.get("field_values") or {}).get("__photo")),
            })
    items.sort(key=lambda x: x.get("submitted_at") or "")
    return items


# ────────────────────── Sprint 110r — Homework Analytics ──────────────────────

@api.get("/admin/homework/analytics")
async def homework_analytics(_: dict = Depends(require_admin)):
    """Per-template + global metrics for daily-tracker homework plans.

    Returned shape:
      {
        "global": { active_plans, completed_plans, completion_rate, avg_streak },
        "templates": [
          {
            "template_id": str|None,            # None for one-off custom plans grouped together
            "title": str,
            "total_days": int,
            "assigned_count": int,
            "active_count": int,
            "completed_count": int,
            "completion_rate": float (0-100),
            "avg_days_to_complete": float|None,   # calendar days
            "dropoff_day_stale": int|None,        # last-logged day on stale (>14d) plans
            "dropoff_day_engagement": int|None,   # day with the steepest unlog rate
            "per_day": [
              { "day_number", "submitted", "approved", "needs_redo", "questions",
                "mood_avg": float|None,
                "engagement_pct": float (0-100) }
            ],
            "recent_completions": [ {dog_name, client_name, completed_at} ],
          }, ...
        ],
      }
    """
    STALE_DAYS = 14
    now_dt = datetime.now(timezone.utc)
    stale_cutoff = now_dt - timedelta(days=STALE_DAYS)

    # Pull all daily-tracker homework — small dataset for a solo operator, OK
    # to aggregate in Python for simplicity + readable code.
    homeworks: List[dict] = await db.homework.find(
        {"daily_tracker": True}, {"_id": 0}
    ).to_list(20000)

    # Group by template_id; one-off plans (no template_id) bucketed under
    # `None` per user spec (1.a — group as "Custom").
    groups: Dict[Optional[str], List[dict]] = {}
    for hw in homeworks:
        key = hw.get("template_id") or None
        groups.setdefault(key, []).append(hw)

    # Lookup template titles for any template ids we still have records for
    template_ids = [k for k in groups.keys() if k]
    tpl_titles: Dict[str, str] = {}
    if template_ids:
        async for t in db.homework_templates.find(
            {"id": {"$in": template_ids}}, {"_id": 0, "id": 1, "name": 1}
        ):
            tpl_titles[t["id"]] = t.get("name") or "Untitled template"

    def _parse_dt(value: Any) -> Optional[datetime]:
        if not value:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    templates_out: List[Dict[str, Any]] = []
    global_active = 0
    global_completed = 0
    global_streak_sum = 0
    global_streak_count = 0

    for template_id, plans in groups.items():
        if not plans:
            continue
        # Title fallback: latest plan's template_snapshot title → otherwise
        # the title field → "Custom (one-off)" for the no-template bucket.
        title = None
        if template_id and template_id in tpl_titles:
            title = tpl_titles[template_id]
        if not title:
            # Take the most-recently-created plan as the representative title
            latest = sorted(plans, key=lambda p: p.get("created_at") or "", reverse=True)[0]
            snap = latest.get("template_snapshot") or {}
            title = snap.get("name") or snap.get("title") or latest.get("title") or "Custom plan"
        if template_id is None:
            title = "Custom (one-off)"

        # Use the latest plan's snapshot for total_days (curriculum length).
        # If plans diverge, fall back to the max.
        total_days = 0
        for hw in plans:
            snap = hw.get("template_snapshot") or {}
            sects = [s for s in snap.get("sections") or [] if s.get("day_number")]
            total_days = max(total_days, len(sects))

        assigned_count = len(plans)
        completed_count = sum(1 for p in plans if p.get("status") == "completed")
        active_count = sum(1 for p in plans if p.get("status") != "completed")
        completion_rate = round(100.0 * completed_count / assigned_count, 1) if assigned_count else 0.0

        # Avg days-to-complete (only count completed; uses calendar days
        # between created_at and completed_at, falls back to last log time
        # if completed_at is missing).
        days_list: List[float] = []
        for p in plans:
            if p.get("status") != "completed":
                continue
            start = _parse_dt(p.get("created_at"))
            end = _parse_dt(p.get("completed_at"))
            if not end:
                # fall back to latest section log time
                latest_log = None
                for log in p.get("section_logs") or []:
                    lt = _parse_dt(log.get("logged_at"))
                    if lt and (latest_log is None or lt > latest_log):
                        latest_log = lt
                end = latest_log
            if start and end and end >= start:
                days_list.append((end - start).total_seconds() / 86400.0)
        avg_days_to_complete = round(sum(days_list) / len(days_list), 1) if days_list else None

        # Per-day breakdown across ALL plans in this template (not just completed)
        per_day_acc: Dict[int, Dict[str, Any]] = {}
        for dn in range(1, max(total_days, 1) + 1):
            per_day_acc[dn] = {
                "day_number": dn,
                "submitted": 0,
                "approved": 0,
                "needs_redo": 0,
                "questions": 0,
                "mood_sum": 0,
                "mood_count": 0,
                "logged_count": 0,
            }
        for p in plans:
            for log in p.get("section_logs") or []:
                dn = int(log.get("day_number") or 0)
                if dn not in per_day_acc:
                    continue
                bucket = per_day_acc[dn]
                bucket["logged_count"] += 1
                status = log.get("submission_status") or "submitted"
                if status == "submitted":
                    bucket["submitted"] += 1
                elif status == "approved":
                    bucket["approved"] += 1
                elif status == "needs_redo":
                    bucket["needs_redo"] += 1
                bucket["questions"] += len(log.get("questions") or [])
                mood = (log.get("field_values") or {}).get("__mood")
                try:
                    moodv = int(mood) if mood is not None else 0
                    if 1 <= moodv <= 5:
                        bucket["mood_sum"] += moodv
                        bucket["mood_count"] += 1
                except Exception:
                    pass

        per_day_out: List[Dict[str, Any]] = []
        for dn in sorted(per_day_acc.keys()):
            b = per_day_acc[dn]
            engagement = round(100.0 * b["logged_count"] / assigned_count, 1) if assigned_count else 0.0
            per_day_out.append({
                "day_number": dn,
                "submitted": b["submitted"],
                "approved": b["approved"],
                "needs_redo": b["needs_redo"],
                "questions": b["questions"],
                "mood_avg": round(b["mood_sum"] / b["mood_count"], 2) if b["mood_count"] else None,
                "engagement_pct": engagement,
                "logged_count": b["logged_count"],
            })

        # Drop-off day A — stale plans: of plans with no activity in 14+ days
        # and still not completed, which day_number was last logged before
        # they went stale? Report the most-common.
        stale_last_days: Dict[int, int] = {}
        for p in plans:
            if p.get("status") == "completed":
                continue
            last_log_dt: Optional[datetime] = None
            last_log_dn: Optional[int] = None
            for log in p.get("section_logs") or []:
                lt = _parse_dt(log.get("logged_at"))
                if not lt:
                    continue
                if last_log_dt is None or lt > last_log_dt:
                    last_log_dt = lt
                    last_log_dn = int(log.get("day_number") or 0)
            if last_log_dn is None:
                # never logged — counts as drop at day 0/1 → bucket Day 1
                last_log_dn = 1
                last_log_dt = _parse_dt(p.get("created_at"))
            if last_log_dt and last_log_dt < stale_cutoff:
                stale_last_days[last_log_dn] = stale_last_days.get(last_log_dn, 0) + 1
        dropoff_day_stale = max(stale_last_days, key=stale_last_days.get) if stale_last_days else None

        # Drop-off day B — engagement-drop: the day_number with the largest
        # negative delta in engagement_pct compared to its predecessor.
        # First-day → second-day drop is usually biggest signal.
        dropoff_day_engagement: Optional[int] = None
        if len(per_day_out) >= 2:
            biggest_drop = 0.0
            for i in range(1, len(per_day_out)):
                drop = per_day_out[i - 1]["engagement_pct"] - per_day_out[i]["engagement_pct"]
                if drop > biggest_drop:
                    biggest_drop = drop
                    dropoff_day_engagement = per_day_out[i]["day_number"]

        # Recent completions (last 8)
        recent_completions: List[Dict[str, Any]] = []
        completed_plans = [p for p in plans if p.get("status") == "completed"]
        completed_plans.sort(key=lambda p: p.get("completed_at") or p.get("updated_at") or "", reverse=True)
        for p in completed_plans[:8]:
            recent_completions.append({
                "homework_id": p.get("id"),
                "dog_name": p.get("dog_name", ""),
                "client_name": p.get("client_name", ""),
                "completed_at": p.get("completed_at") or "",
            })

        # Roll into global counters
        global_active += active_count
        global_completed += completed_count

        templates_out.append({
            "template_id": template_id,
            "title": title,
            "total_days": total_days,
            "assigned_count": assigned_count,
            "active_count": active_count,
            "completed_count": completed_count,
            "completion_rate": completion_rate,
            "avg_days_to_complete": avg_days_to_complete,
            "dropoff_day_stale": dropoff_day_stale,
            "dropoff_day_engagement": dropoff_day_engagement,
            "per_day": per_day_out,
            "recent_completions": recent_completions,
        })

    # Sort templates: most-assigned first (the curricula you actually use)
    templates_out.sort(key=lambda t: (-t["assigned_count"], t["title"].lower()))

    # Global avg streak across active plans — uses _compute_daily_progress so
    # it matches what the client sees.
    for hw in homeworks:
        if hw.get("status") == "completed":
            continue
        prog = _compute_daily_progress(hw)
        streak = _streak_count(prog)
        global_streak_sum += streak
        global_streak_count += 1

    total_assigned = global_active + global_completed
    global_completion_rate = round(100.0 * global_completed / total_assigned, 1) if total_assigned else 0.0
    avg_streak = round(global_streak_sum / global_streak_count, 1) if global_streak_count else 0.0

    return {
        "global": {
            "active_plans": global_active,
            "completed_plans": global_completed,
            "total_assigned": total_assigned,
            "completion_rate": global_completion_rate,
            "avg_streak": avg_streak,
        },
        "templates": templates_out,
    }


# -------- Service-Dog Training Curriculum --------
from training_data import (
    CATEGORIES as TRAINING_CATEGORIES,
    SEED_COMMANDS,
    SCORE_SCALE,
    compute_badges,
    progress_summary,
)


class CommandIn(BaseModel):
    name: str = Field(min_length=1)
    category: Literal["engagement", "obedience", "public_access", "task"]
    description: Optional[str] = ""
    video_url: Optional[str] = ""
    order: int = 100
    active: bool = True


class CommandOut(CommandIn):
    id: str
    is_default: bool = False


async def _seed_commands_if_empty():
    count = await db.commands.count_documents({})
    if count == 0:
        docs = []
        for c in SEED_COMMANDS:
            docs.append({
                "id": str(uuid.uuid4()),
                "name": c["name"],
                "category": c["category"],
                "description": c.get("description", ""),
                "video_url": "",
                "order": c.get("order", 100),
                "active": True,
                "is_default": True,
                "created_at": now_iso(),
            })
        await db.commands.insert_many(docs)


@api.get("/training/meta")
async def training_meta(user: dict = Depends(get_current_user)):
    """Public metadata: categories + score scale. Used by both admin and portal."""
    return {"categories": TRAINING_CATEGORIES, "scale": SCORE_SCALE}


@api.get("/commands")
async def list_commands(user: dict = Depends(get_current_user)):
    await _seed_commands_if_empty()
    docs = await db.commands.find({"active": True}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda c: (c["category"], c.get("order", 100), c["name"]))
    return docs


@api.post("/commands", response_model=CommandOut)
async def create_command(body: CommandIn, _: dict = Depends(require_admin)):
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "is_default": False, "created_at": now_iso()}
    await db.commands.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/commands/{command_id}", response_model=CommandOut)
async def update_command(command_id: str, body: CommandIn, _: dict = Depends(require_admin)):
    existing = await db.commands.find_one({"id": command_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Command not found")
    update = body.model_dump()
    await db.commands.update_one({"id": command_id}, {"$set": update})
    existing.update(update)
    return existing


@api.delete("/commands/{command_id}")
async def delete_command(command_id: str, _: dict = Depends(require_admin)):
    # Soft-delete: mark inactive so historical references still resolve
    await db.commands.update_one({"id": command_id}, {"$set": {"active": False}})
    return {"ok": True}


# ----- Per-dog curriculum -----
class CurriculumEntryIn(BaseModel):
    command_id: str
    level: int = Field(ge=0, le=5)
    notes: Optional[str] = ""
    in_homework: bool = False


async def _dog_or_403(dog_id: str, user: dict) -> dict:
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")
    return dog


async def _commands_by_id() -> Dict[str, dict]:
    docs = await db.commands.find({"active": True}, {"_id": 0}).to_list(500)
    return {c["id"]: c for c in docs}


def _curriculum_map(dog: dict) -> Dict[str, dict]:
    """Normalise dog.curriculum (stored as list of entries) into {command_id: entry}."""
    return {e["command_id"]: e for e in (dog.get("curriculum") or [])}


@api.get("/dogs/{dog_id}/training")
async def get_dog_training(dog_id: str, user: dict = Depends(get_current_user)):
    """Returns dog curriculum (commands + scores), progress summary, and earned badges."""
    await _seed_commands_if_empty()
    dog = await _dog_or_403(dog_id, user)
    commands = await _commands_by_id()
    curric = _curriculum_map(dog)
    items = []
    for cid, cmd in commands.items():
        entry = curric.get(cid) or {}
        items.append({
            "command": cmd,
            "level": int(entry.get("level") or 0),
            "notes": entry.get("notes") or "",
            "in_homework": bool(entry.get("in_homework")),
            "last_session_at": entry.get("last_session_at"),
        })
    items.sort(key=lambda x: (x["command"]["category"], x["command"].get("order", 100), x["command"]["name"]))
    cgc_pass = bool(dog.get("cgc_mock_passed_at"))
    return {
        "dog_id": dog_id,
        "items": items,
        "progress": progress_summary(curric, commands),
        "badges": compute_badges(curric, commands, cgc_pass=cgc_pass),
        "cgc_mock_passed_at": dog.get("cgc_mock_passed_at"),
    }


@api.put("/dogs/{dog_id}/training/{command_id}")
async def update_curriculum_entry(dog_id: str, command_id: str, body: CurriculumEntryIn, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    curric = dog.get("curriculum") or []
    found = False
    for e in curric:
        if e.get("command_id") == command_id:
            e["level"] = body.level
            e["notes"] = body.notes or ""
            e["in_homework"] = body.in_homework
            found = True
            break
    if not found:
        curric.append({
            "command_id": command_id,
            "level": body.level,
            "notes": body.notes or "",
            "in_homework": body.in_homework,
        })
    await db.dogs.update_one({"id": dog_id}, {"$set": {"curriculum": curric}})
    return {"ok": True}


# ----- Training Sessions -----
class SessionScoreIn(BaseModel):
    command_id: str
    score: int = Field(ge=0, le=5)


class TrainingSessionIn(BaseModel):
    date: str  # YYYY-MM-DD
    environment: Literal["home", "store", "park", "vet", "training_facility", "other"] = "home"
    distraction: int = Field(ge=1, le=10, default=1)
    notes: Optional[str] = ""
    scores: List[SessionScoreIn] = []
    cgc_mock_pass: bool = False


@api.post("/dogs/{dog_id}/training-sessions")
async def log_training_session(dog_id: str, body: TrainingSessionIn, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    session = {
        "id": str(uuid.uuid4()),
        "dog_id": dog_id,
        "date": body.date,
        "environment": body.environment,
        "distraction": body.distraction,
        "notes": body.notes or "",
        "scores": [s.model_dump() for s in body.scores],
        "cgc_mock_pass": bool(body.cgc_mock_pass),
        "created_at": now_iso(),
    }
    await db.training_sessions.insert_one(session)

    # Apply scores into the dog's curriculum (highest score wins per command)
    curric = dog.get("curriculum") or []
    by_id = {e.get("command_id"): e for e in curric}
    for s in body.scores:
        entry = by_id.get(s.command_id)
        if entry:
            if int(s.score) > int(entry.get("level") or 0):
                entry["level"] = int(s.score)
            entry["last_session_at"] = body.date
        else:
            new = {
                "command_id": s.command_id,
                "level": int(s.score),
                "notes": "",
                "in_homework": False,
                "last_session_at": body.date,
            }
            curric.append(new)
            by_id[s.command_id] = new

    update_fields = {"curriculum": curric}
    if body.cgc_mock_pass:
        update_fields["cgc_mock_passed_at"] = body.date
    await db.dogs.update_one({"id": dog_id}, {"$set": update_fields})
    session.pop("_id", None)
    return session


@api.get("/dogs/{dog_id}/training-sessions")
async def list_training_sessions(dog_id: str, user: dict = Depends(get_current_user)):
    await _dog_or_403(dog_id, user)
    docs = await db.training_sessions.find({"dog_id": dog_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda x: (x.get("date") or "", x.get("created_at") or ""), reverse=True)
    return docs


# -------- Training Programs --------
from programs_data import SEED_PROGRAMS, PROGRAM_TYPES, GOAL_STATUS, ENROLLMENT_STATUS, COMPLETION_RULE_TYPES, _default_completion_rule


def _gid() -> str:
    return str(uuid.uuid4())


def _build_program_doc(seed: dict) -> dict:
    """Stamp seed definition with UUIDs for every module/goal."""
    modules = []
    for m_i, m in enumerate(seed["modules"]):
        goals = []
        for g_i, g in enumerate(m.get("goals", [])):
            goals.append({
                "id": _gid(),
                "name": g["name"],
                "description": g.get("description", ""),
                "order": g_i,
                "command_id": g.get("command_id"),
                "manual_only": False,
            })
        modules.append({
            "id": _gid(),
            "name": m["name"],
            "description": m.get("description", ""),
            "order": m_i,
            "goals": goals,
        })
    return {
        "id": _gid(),
        "slug": seed["slug"],
        "name": seed["name"],
        "type": seed["type"],
        "description": seed.get("description", ""),
        "focus": seed.get("focus", ""),
        "format": seed.get("format", {"count": 1, "unit": "sessions"}),
        "min_age_months": seed.get("min_age_months", 0),
        "prereq_slugs": seed.get("prereq_slugs", []),
        "modules": modules,
        "completion_rule": _default_completion_rule(),
        "active": True,
        "is_default": True,
        "owner_dog_id": None,
        "created_at": now_iso(),
    }


async def _seed_programs_if_empty():
    if await db.programs.count_documents({"is_default": True}) == 0:
        docs = [_build_program_doc(s) for s in SEED_PROGRAMS]
        await db.programs.insert_many(docs)


class GoalIn(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    description: Optional[str] = ""
    order: int = 0
    command_id: Optional[str] = None
    manual_only: bool = False  # if true, goal is a checkbox not a 0-5 score


class ModuleIn(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    description: Optional[str] = ""
    order: int = 0
    goals: List[GoalIn] = []
    # Sprint 110bx — homework auto-assigned when this module flips to "mastered"
    homework_template_id: Optional[str] = None


class ProgramIn(BaseModel):
    name: str = Field(min_length=1)
    slug: Optional[str] = ""
    type: Literal["private_lessons", "board_train", "service_dog", "custom"]
    description: Optional[str] = ""
    focus: Optional[str] = ""
    format: Dict = Field(default_factory=lambda: {"count": 1, "unit": "sessions"})
    min_age_months: int = 0
    prereq_slugs: List[str] = []
    modules: List[ModuleIn] = []
    completion_rule: Dict = Field(default_factory=_default_completion_rule)
    price: float = 0  # client-facing price for this program (whole package)
    active: bool = True
    # Sprint 110bx — auto-assigned on enrollment ("welcome homework")
    welcome_homework_template_id: Optional[str] = None


def _stamp_ids(modules: List[dict]) -> List[dict]:
    out = []
    for m_i, m in enumerate(modules):
        mid = m.get("id") or _gid()
        goals = []
        for g_i, g in enumerate(m.get("goals") or []):
            goals.append({
                "id": g.get("id") or _gid(),
                "name": g["name"],
                "description": g.get("description", ""),
                "order": g.get("order", g_i),
                "command_id": g.get("command_id"),
                "manual_only": bool(g.get("manual_only")),
            })
        out.append({
            "id": mid,
            "name": m["name"],
            "description": m.get("description", ""),
            "order": m.get("order", m_i),
            "goals": goals,
            "homework_template_id": m.get("homework_template_id"),
        })
    return out


@api.get("/programs/meta")
async def programs_meta(user: dict = Depends(get_current_user)):
    return {
        "types": PROGRAM_TYPES,
        "goal_status": GOAL_STATUS,
        "enrollment_status": ENROLLMENT_STATUS,
        "completion_rule_types": COMPLETION_RULE_TYPES,
    }


@api.get("/programs")
async def list_programs(user: dict = Depends(get_current_user), include_custom: bool = True):
    await _seed_programs_if_empty()
    query = {"active": True}
    progs = await db.programs.find(query, {"_id": 0}).to_list(500)
    if not include_custom:
        progs = [p for p in progs if p.get("type") != "custom"]
    progs.sort(key=lambda p: (p.get("type", ""), p.get("name", "")))
    # Clients get a slimmer view — they don't need to see internal modules/goals.
    if user.get("role") != "admin":
        slim = []
        for p in progs:
            slim.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "slug": p.get("slug"),
                "type": p.get("type"),
                "description": p.get("description", ""),
                "focus": p.get("focus", ""),
                "format": p.get("format") or {"count": 0, "unit": "sessions"},
                "min_age_months": p.get("min_age_months", 0),
                "price": float(p.get("price") or 0),
                "module_count": len(p.get("modules") or []),
            })
        return slim
    return progs


@api.post("/programs")
async def create_program(body: ProgramIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = _gid()
    doc["slug"] = doc.get("slug") or doc["name"].lower().replace(" ", "_")[:40]
    doc["modules"] = _stamp_ids(doc.get("modules") or [])
    doc["is_default"] = False
    doc["owner_dog_id"] = None
    doc["created_at"] = now_iso()
    await db.programs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/programs/{program_id}/active-enrollments-count")
async def program_active_enrollments_count(program_id: str, _: dict = Depends(require_admin)):
    """Lightweight count used by the program editor to ask the admin whether to
    cascade an edit onto currently-enrolled dogs."""
    count = await db.dog_programs.count_documents({"program_id": program_id, "status": "active"})
    return {"count": count}




@api.put("/programs/{program_id}")
async def update_program(program_id: str, body: ProgramIn, cascade: bool = False, _: dict = Depends(require_admin)):
    """Edit a program. When `cascade=true`, also pushes the updated snapshot to
    every **active** enrollment of this program:
      • Goals that still exist keep their score / notes / status.
      • New goals start at "not_started".
      • Removed goals have their progress dropped (per user choice).
    Completed / withdrawn / on-hold enrollments are left untouched so trainer
    history stays trustworthy."""
    existing = await db.programs.find_one({"id": program_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Program not found")
    update = body.model_dump()
    update["modules"] = _stamp_ids(update.get("modules") or [])
    await db.programs.update_one({"id": program_id}, {"$set": update})
    existing.update(update)

    cascaded = 0
    if cascade:
        new_modules = update.get("modules") or []
        # All goal IDs still present in the updated program
        surviving_goal_ids = {g.get("id") for m in new_modules for g in (m.get("goals") or []) if g.get("id")}
        new_snapshot_base = {
            "name": update["name"],
            "type": update["type"],
            "slug": update.get("slug"),
            "description": update.get("description", ""),
            "focus": update.get("focus", ""),
            "format": update.get("format"),
            "modules": new_modules,
            "completion_rule": update.get("completion_rule") or _default_completion_rule(),
        }
        cursor = db.dog_programs.find({"program_id": program_id, "status": "active"}, {"_id": 0})
        async for enr in cursor:
            old_progress = enr.get("goal_progress") or {}
            # Drop progress entries for goals that no longer exist; init new goals.
            merged = _empty_progress(new_modules)
            for gid, prog in old_progress.items():
                if gid in surviving_goal_ids and gid in merged:
                    merged[gid] = prog
            await db.dog_programs.update_one(
                {"id": enr["id"]},
                {"$set": {"program_snapshot": new_snapshot_base, "goal_progress": merged}},
            )
            cascaded += 1

    existing["_cascaded_enrollments"] = cascaded
    return existing


@api.delete("/programs/{program_id}")
async def delete_program(program_id: str, _: dict = Depends(require_admin)):
    # Soft delete — existing enrollments are unaffected
    await db.programs.update_one({"id": program_id}, {"$set": {"active": False}})
    return {"ok": True}


# ----- Enrollments -----
class EnrollIn(BaseModel):
    program_id: str
    started_at: Optional[str] = None
    target_completion_date: Optional[str] = None
    trainer_notes: Optional[str] = ""


def _empty_progress(modules: List[dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for m in modules:
        for g in (m.get("goals") or []):
            out[g["id"]] = {"status": "not_started", "score": 0, "notes": "", "last_session_at": None}
    return out


def _enrollment_summary(enrollment: dict) -> dict:
    """Augment with totals + mastered counts derived from program_snapshot.modules."""
    total = 0
    mastered = 0
    in_progress = 0
    for m in (enrollment.get("program_snapshot", {}).get("modules") or []):
        for g in (m.get("goals") or []):
            total += 1
            p = (enrollment.get("goal_progress") or {}).get(g["id"]) or {}
            if p.get("status") == "mastered" or int(p.get("score") or 0) >= 4:
                mastered += 1
            elif p.get("status") == "in_progress" or int(p.get("score") or 0) >= 1:
                in_progress += 1
    pct = int(round(100 * mastered / total)) if total else 0
    return {**enrollment, "total_goals": total, "mastered_goals": mastered,
            "in_progress_goals": in_progress, "mastered_pct": pct}


async def _check_completion_rule(enrollment: dict, *, sessions_logged: int = 0) -> bool:
    """Evaluate the enrollment's `completion_rule` against current progress.
    Returns True if the rule is satisfied (program should auto-complete).
    `sessions_logged` only matters for the "sessions" rule type."""
    rule = enrollment.get("completion_rule") or _default_completion_rule()
    rtype = rule.get("type") or "percent"
    if rtype == "manual":
        return False  # admin-only

    summary = _enrollment_summary(enrollment)
    total = summary["total_goals"]
    mastered = summary["mastered_goals"]
    pct = summary["mastered_pct"]

    if rtype == "all_mastered":
        return total > 0 and mastered == total
    if rtype == "percent":
        threshold = int(rule.get("threshold") or 80)
        return total > 0 and pct >= threshold
    if rtype == "sessions":
        target = int(rule.get("threshold") or rule.get("count") or 0)
        return target > 0 and sessions_logged >= target
    return False


async def _auto_complete_if_satisfied(enrollment: dict, *, sessions_logged: int = 0) -> dict:
    """If the enrollment's completion rule is satisfied AND it's still
    active, mark it completed and clear `dogs.active_program_id` so a new
    enrollment can take its place. Returns the (possibly mutated) enrollment."""
    if enrollment.get("status") != "active":
        return enrollment
    satisfied = await _check_completion_rule(enrollment, sessions_logged=sessions_logged)
    if not satisfied:
        return enrollment
    update = {
        "status": "completed",
        "completed_at": now_iso(),
        "auto_completed": True,
    }
    await db.dog_programs.update_one({"id": enrollment["id"]}, {"$set": update})
    enrollment.update(update)
    # Clear the dog's pointer if it was pointing at this enrollment, then
    # pick another active one if available.
    dog = await db.dogs.find_one({"id": enrollment["dog_id"]}, {"_id": 0})
    if dog and dog.get("active_program_id") == enrollment["id"]:
        other = await db.dog_programs.find_one(
            {"dog_id": enrollment["dog_id"], "status": "active", "id": {"$ne": enrollment["id"]}},
            {"_id": 0},
        )
        await db.dogs.update_one({"id": enrollment["dog_id"]}, {"$set": {"active_program_id": (other or {}).get("id")}})
    return enrollment


def _suggest_target_date(started: str, fmt: dict) -> Optional[str]:
    """Estimate completion date from program format."""
    try:
        d0 = date.fromisoformat(started)
    except Exception:
        return None
    count = int((fmt or {}).get("count") or 1)
    unit = (fmt or {}).get("unit") or "sessions"
    if unit == "weeks":
        delta_days = count * 7
    elif unit == "days":
        delta_days = count
    elif unit == "months":
        delta_days = count * 30
    else:  # sessions — assume ~1 per week
        delta_days = count * 7
    return (d0 + timedelta(days=delta_days)).isoformat()


@api.post("/dogs/{dog_id}/programs")
async def enroll_dog(dog_id: str, body: EnrollIn, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    program = await db.programs.find_one({"id": body.program_id}, {"_id": 0})
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    started = body.started_at or business_today().isoformat()
    target = body.target_completion_date or _suggest_target_date(started, program.get("format") or {})
    enrollment = {
        "id": _gid(),
        "dog_id": dog_id,
        "program_id": body.program_id,
        "program_snapshot": {
            "name": program["name"],
            "type": program["type"],
            "slug": program.get("slug"),
            "description": program.get("description", ""),
            "focus": program.get("focus", ""),
            "format": program.get("format"),
            "modules": program.get("modules") or [],
            "completion_rule": program.get("completion_rule") or _default_completion_rule(),
            "welcome_homework_template_id": program.get("welcome_homework_template_id"),
        },
        "status": "active",
        "started_at": started,
        "target_completion_date": target,
        "completed_at": None,
        "on_hold_at": None,
        "goal_progress": _empty_progress(program.get("modules") or []),
        "sessions_count": 0,
        "trainer_notes": body.trainer_notes or "",
        "created_at": now_iso(),
    }
    await db.dog_programs.insert_one(enrollment)
    # If the dog has no active_program_id yet, point at this one (used for run-sheet display).
    if not dog.get("active_program_id"):
        await db.dogs.update_one({"id": dog_id}, {"$set": {"active_program_id": enrollment["id"]}})
    enrollment.pop("_id", None)
    # Sprint 110bx — fire welcome-homework auto-assign if the program defines one
    try:
        await _auto_assign_welcome_homework(enrollment)
    except Exception as exc:
        logger.warning("Welcome homework auto-assign failed: %s", exc)
    return _enrollment_summary(enrollment)


@api.get("/dogs/{dog_id}/programs")
async def list_dog_enrollments(dog_id: str, user: dict = Depends(get_current_user)):
    await _dog_or_403(dog_id, user)
    enrollments = await db.dog_programs.find({"dog_id": dog_id}, {"_id": 0}).to_list(200)
    enrollments.sort(key=lambda e: (0 if e.get("status") == "active" else 1, e.get("created_at") or ""), reverse=False)
    # Active first, then by created_at descending for the rest
    active = [e for e in enrollments if e.get("status") == "active"]
    other = sorted([e for e in enrollments if e.get("status") != "active"],
                   key=lambda e: e.get("created_at") or "", reverse=True)
    enrollments = active + other
    return [_enrollment_summary(e) for e in enrollments]


class EnrollmentUpdate(BaseModel):
    status: Optional[Literal["active", "completed", "on_hold", "withdrawn"]] = None
    trainer_notes: Optional[str] = None
    target_completion_date: Optional[str] = None


@api.put("/dogs/{dog_id}/programs/{enrollment_id}")
async def update_enrollment(dog_id: str, enrollment_id: str, body: EnrollmentUpdate, _: dict = Depends(require_admin)):
    enrollment = await db.dog_programs.find_one({"id": enrollment_id, "dog_id": dog_id}, {"_id": 0})
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    update: Dict = {}
    if body.status:
        update["status"] = body.status
        if body.status == "completed":
            update["completed_at"] = now_iso()
        if body.status == "on_hold":
            update["on_hold_at"] = now_iso()
        if body.status == "active":
            await db.dogs.update_one({"id": dog_id}, {"$set": {"active_program_id": enrollment_id}})
        elif body.status in ("completed", "on_hold", "withdrawn"):
            # If this was the dog's active pointer, clear it so the run-sheet stops showing it
            dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
            if (dog or {}).get("active_program_id") == enrollment_id:
                # If there's another active enrollment, point at it; otherwise null
                other = await db.dog_programs.find_one(
                    {"dog_id": dog_id, "status": "active", "id": {"$ne": enrollment_id}},
                    {"_id": 0},
                )
                await db.dogs.update_one({"id": dog_id}, {"$set": {"active_program_id": (other or {}).get("id")}})
    if body.trainer_notes is not None:
        update["trainer_notes"] = body.trainer_notes
    if body.target_completion_date is not None:
        update["target_completion_date"] = body.target_completion_date
    if update:
        await db.dog_programs.update_one({"id": enrollment_id}, {"$set": update})
        enrollment.update(update)
    return _enrollment_summary(enrollment)


class GoalUpdate(BaseModel):
    status: Optional[Literal["not_started", "in_progress", "mastered"]] = None
    score: Optional[int] = Field(default=None, ge=0, le=5)
    notes: Optional[str] = None



# ─── Sprint 110bx + 110bz · Auto-homework engine for training programs ────
#
# Triggers:
#   1. On enrollment → assign BOTH:
#        a. `program.welcome_homework_template_id` (if set)
#        b. The first module's `homework_template_id` (if set) — module 1
#           is "starting" the moment the dog enrols.
#   2. On a module being fully mastered → assign the **NEXT** module's
#      `homework_template_id`. Each per-module homework is the homework FOR
#      that module, sent when the client begins it (not when they finish it).
#
# Each trigger creates a real `homework` row from the template snapshot AND
# emails the client (via existing notify_client_homework_assigned).
#
# Idempotency: we don't auto-assign the same template to the same dog twice
# from the same enrollment + trigger. Stored in dog_programs.auto_homework_log
# so the state is per-enrollment (re-enrolling after completion can re-fire).

def _already_auto_assigned(enrollment: dict, template_id: str, trigger: str) -> bool:
    log = enrollment.get("auto_homework_log") or []
    return any(e.get("template_id") == template_id and e.get("trigger") == trigger
               for e in log)


async def _record_auto_assign(enrollment_id: str, template_id: str, trigger: str,
                              homework_id: str) -> None:
    await db.dog_programs.update_one(
        {"id": enrollment_id},
        {"$push": {"auto_homework_log": {
            "template_id": template_id,
            "trigger": trigger,           # "enrollment" or "module:<goal_id>"
            "homework_id": homework_id,
            "assigned_at": now_iso(),
        }}},
    )


async def _create_homework_from_template_internal(
    dog: dict, client: Optional[dict], template_id: str,
    assigned_by: str = "Auto-assigned",
) -> Optional[dict]:
    """Internal homework-from-template creator. Mirrors the body of
    /homework/from-template but callable from auto-triggers. Returns the
    new doc, or None if the template/dog is invalid."""
    tpl = await db.homework_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        return None
    due = ""
    if tpl.get("default_duration_days"):
        due = (business_today() + timedelta(days=int(tpl["default_duration_days"]))).isoformat()
    is_daily = bool(tpl.get("daily_tracker"))
    total_days = 0
    if is_daily:
        secs = [s for s in tpl.get("sections", []) if s.get("day_number")]
        total_days = len(secs) or int(tpl.get("default_duration_days") or 0)
    doc = {
        "id": str(uuid.uuid4()),
        "dog_id": dog["id"],
        "dog_name": dog.get("name", ""),
        "client_id": dog.get("owner_id", ""),
        "client_name": (client or {}).get("name", ""),
        "title": tpl["name"],
        "instructions": tpl.get("description", ""),
        "video_url": "",
        "due_date": due,
        "status": "assigned",
        "created_at": now_iso(),
        "assigned_by": assigned_by,
        "completed_at": None,
        "completion_note": "",
        "completion_photo": "",
        "template_snapshot": {
            "template_id": tpl["id"],
            "slug": tpl.get("slug"),
            "name": tpl.get("name"),
            "tier": tpl.get("tier"),
            "description": tpl.get("description"),
            "cover_color": tpl.get("cover_color"),
            "icon": tpl.get("icon"),
            "global_rules_this_week": tpl.get("global_rules_this_week", []),
            "sections": tpl.get("sections", []),
        },
        "section_logs": [],
        "daily_tracker": is_daily,
        "total_days": total_days,
        "auto_assigned": True,  # marker so admin can spot trigger-driven rows
    }
    await db.homework.insert_one(doc)
    doc.pop("_id", None)
    if client:
        try:
            await notify_client_homework_assigned(doc, client)
        except Exception as exc:
            logger.warning("Auto-homework email failed for %s: %s", doc.get("id"), exc)
    return doc


async def _auto_assign_welcome_homework(enrollment: dict) -> Optional[dict]:
    """Called immediately after a new dog_programs row is inserted.

    Assigns BOTH:
      1. The program's welcome homework (if set).
      2. The first module's homework (if set) — Module 1 is "starting" so its
         homework should land in the client's lap right away.
    """
    snap = enrollment.get("program_snapshot") or {}
    dog = await db.dogs.find_one({"id": enrollment["dog_id"]}, {"_id": 0})
    if not dog:
        return None
    client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0})

    last_hw = None
    # Welcome homework
    welcome_id = snap.get("welcome_homework_template_id")
    if welcome_id and not _already_auto_assigned(enrollment, welcome_id, "enrollment"):
        hw = await _create_homework_from_template_internal(
            dog, client, welcome_id,
            assigned_by=f"Auto · {snap.get('name', 'Program')} welcome",
        )
        if hw:
            await _record_auto_assign(enrollment["id"], welcome_id, "enrollment", hw["id"])
            last_hw = hw

    # First module's homework — "module 1 is starting now"
    modules = snap.get("modules") or []
    if modules:
        first_module = modules[0]
        first_module_hw = first_module.get("homework_template_id")
        first_trigger = f"module_start:{first_module.get('id')}"
        if first_module_hw and not _already_auto_assigned(enrollment, first_module_hw, first_trigger):
            hw = await _create_homework_from_template_internal(
                dog, client, first_module_hw,
                assigned_by=f"Auto · {first_module.get('name', 'Module 1')} starting",
            )
            if hw:
                await _record_auto_assign(enrollment["id"], first_module_hw, first_trigger, hw["id"])
                last_hw = hw
    return last_hw


async def _auto_assign_module_homework(enrollment: dict, just_mastered_goal_id: str) -> Optional[dict]:
    """Called when a goal flips to `mastered`. If that goal completes its
    parent module (all sibling goals mastered too), advance to the NEXT
    module and assign THAT module's homework template — because the client
    is now starting the next module.

    Sprint 110bz — semantics fix: the per-module homework field means
    "homework for THIS module, sent when the client begins it" (not "sent
    when this module is mastered"). Module 1's homework goes out at enrol
    (see _auto_assign_welcome_homework). Module 2..N's homework goes out
    when the previous module is mastered.
    """
    snap = enrollment.get("program_snapshot") or {}
    modules = snap.get("modules") or []
    # Find the parent module (index) of this goal
    parent_module = None
    parent_idx = -1
    for i, m in enumerate(modules):
        if any(g.get("id") == just_mastered_goal_id for g in m.get("goals", [])):
            parent_module = m
            parent_idx = i
            break
    if not parent_module:
        return None

    # All goals in the just-mastered module must now be mastered (look up current progress)
    fresh = await db.dog_programs.find_one({"id": enrollment["id"]}, {"_id": 0}) or enrollment
    progress = fresh.get("goal_progress") or {}
    module_goal_ids = [g["id"] for g in parent_module.get("goals", [])]
    all_mastered = all(
        (progress.get(gid) or {}).get("status") == "mastered"
        for gid in module_goal_ids
    )
    if not all_mastered:
        return None

    # We just finished `parent_module`. The NEXT module is starting — assign
    # ITS homework_template_id.
    next_idx = parent_idx + 1
    if next_idx >= len(modules):
        # Last module just got mastered — nothing more to assign here. Program
        # completion will be handled by _auto_complete_if_satisfied.
        return None
    next_module = modules[next_idx]
    template_id = next_module.get("homework_template_id")
    if not template_id:
        return None

    trigger = f"module_start:{next_module['id']}"
    if _already_auto_assigned(fresh, template_id, trigger):
        return None
    dog = await db.dogs.find_one({"id": enrollment["dog_id"]}, {"_id": 0})
    if not dog:
        return None
    client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0})
    hw = await _create_homework_from_template_internal(
        dog, client, template_id,
        assigned_by=f"Auto · {next_module.get('name', 'Next module')} starting",
    )
    if hw:
        await _record_auto_assign(enrollment["id"], template_id, trigger, hw["id"])
    return hw



@api.put("/dogs/{dog_id}/programs/{enrollment_id}/goals/{goal_id}")
async def update_goal(dog_id: str, enrollment_id: str, goal_id: str, body: GoalUpdate, _: dict = Depends(require_admin)):
    enrollment = await db.dog_programs.find_one({"id": enrollment_id, "dog_id": dog_id}, {"_id": 0})
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    progress = enrollment.get("goal_progress") or {}
    cur = progress.get(goal_id) or {"status": "not_started", "score": 0, "notes": "", "last_session_at": None}
    prior_status = cur.get("status")
    if body.status is not None:
        cur["status"] = body.status
    if body.score is not None:
        cur["score"] = body.score
        # Auto-bump status: 0=not_started, 1-3=in_progress, 4-5=mastered
        if body.score >= 4:
            cur["status"] = "mastered"
        elif body.score >= 1:
            cur["status"] = "in_progress"
        else:
            cur["status"] = "not_started"
    if body.notes is not None:
        cur["notes"] = body.notes
    progress[goal_id] = cur
    await db.dog_programs.update_one({"id": enrollment_id}, {"$set": {"goal_progress": progress}})
    enrollment["goal_progress"] = progress

    # Sprint 110bx — auto-assign that module's homework when it flips to "mastered"
    if cur.get("status") == "mastered" and prior_status != "mastered":
        try:
            await _auto_assign_module_homework(enrollment, goal_id)
        except Exception as exc:
            logger.warning("Auto-homework module trigger failed: %s", exc)

    # Auto-complete the enrollment if the configured completion_rule is now satisfied.
    enrollment = await _auto_complete_if_satisfied(enrollment)
    # 🏆 Re-evaluate trophy eligibility for this dog (skill mastery + program completion).
    try:
        await check_dog_trophies(db, dog_id)
    except Exception as exc:
        logger.warning("Dog trophy check failed for %s: %s", dog_id, exc)
    return _enrollment_summary(enrollment)


class CustomProgramIn(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = ""
    focus: Optional[str] = ""
    format: Dict = Field(default_factory=lambda: {"count": 1, "unit": "sessions"})
    modules: List[ModuleIn] = []


@api.post("/dogs/{dog_id}/programs/custom")
async def create_custom_and_enroll(dog_id: str, body: CustomProgramIn, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    program_doc = {
        "id": _gid(),
        "name": body.name,
        "slug": f"custom_{dog_id[:8]}_{int(datetime.now().timestamp())}",
        "type": "custom",
        "description": body.description or "",
        "focus": body.focus or "",
        "format": body.format or {"count": 1, "unit": "sessions"},
        "min_age_months": 0,
        "prereq_slugs": [],
        "modules": _stamp_ids([m.model_dump() for m in body.modules]),
        "active": True,
        "is_default": False,
        "owner_dog_id": dog_id,
        "created_at": now_iso(),
    }
    await db.programs.insert_one(program_doc)
    # Auto-enroll
    return await enroll_dog(dog_id, EnrollIn(program_id=program_doc["id"]), _=_)


# Idempotent re-seed (admin can also wipe and re-import standards from settings if desired)
@api.post("/programs/seed-standard")
async def seed_standard(_: dict = Depends(require_admin)):
    await _seed_programs_if_empty()
    count = await db.programs.count_documents({"is_default": True})
    return {"ok": True, "default_programs": count}


# Run-sheet/dashboard helper: which dogs have which active programs
@api.get("/programs/active-summary")
async def active_summary(_: dict = Depends(require_admin)):
    cursor = db.dog_programs.find({"status": "active"}, {"_id": 0}).sort("started_at", -1)
    rows = await cursor.to_list(500)
    by_type: Dict[str, int] = {}
    for r in rows:
        t = (r.get("program_snapshot") or {}).get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    return {"total": len(rows), "by_type": by_type, "active": [_enrollment_summary(r) for r in rows[:20]]}


@api.get("/programs/pipeline")
async def programs_pipeline(
    _: dict = Depends(require_admin),
    status: Optional[str] = None,
    type: Optional[str] = None,
    search: Optional[str] = None,
):
    """All-dogs training overview. Joins enrollments → dogs → clients with computed
    progress, days_since_start, days_to_target. Supports filtering."""
    query: Dict = {}
    if status:
        query["status"] = status
    rows = await db.dog_programs.find(query, {"_id": 0}).to_list(2000)
    if type:
        rows = [r for r in rows if (r.get("program_snapshot") or {}).get("type") == type]

    # Batch-load all dogs + clients referenced by these enrollments in just
    # two queries instead of N+1 round trips. Strip heavy photo fields from
    # dogs since pipeline only renders the small thumbnail.
    dog_ids = list({r["dog_id"] for r in rows if r.get("dog_id")})
    dogs_list = await db.dogs.find(
        {"id": {"$in": dog_ids}},
        {"_id": 0, "photos": 0, "training_logs": 0, "feeding_schedule": 0, "medications": 0},
    ).to_list(2000) if dog_ids else []
    dog_map = {d["id"]: d for d in dogs_list}

    client_ids = list({d.get("owner_id") for d in dogs_list if d.get("owner_id")})
    clients_list = await db.clients.find(
        {"id": {"$in": client_ids}}, {"_id": 0, "name": 1, "id": 1}
    ).to_list(2000) if client_ids else []
    client_map = {c["id"]: c for c in clients_list}

    out = []
    today = business_today()
    for r in rows:
        dog = dog_map.get(r["dog_id"])
        if not dog:
            continue
        client = client_map.get(dog.get("owner_id")) if dog.get("owner_id") else None
        if search:
            haystack = f"{dog.get('name','')} {(client or {}).get('name','')} {r['program_snapshot'].get('name','')}".lower()
            if search.lower() not in haystack:
                continue
        summary = _enrollment_summary(r)
        # days since / until
        days_since = None
        days_to_target = None
        try:
            if summary.get("started_at"):
                days_since = (today - date.fromisoformat(summary["started_at"])).days
            if summary.get("target_completion_date"):
                days_to_target = (date.fromisoformat(summary["target_completion_date"]) - today).days
        except Exception:
            pass
        out.append({
            **summary,
            "dog_id": dog["id"],
            "dog_name": dog.get("name"),
            "dog_photo": dog.get("photo") or "",
            "client_id": (client or {}).get("id"),
            "client_name": (client or {}).get("name"),
            "days_since_start": days_since,
            "days_to_target": days_to_target,
        })

    # Sort: active first, then overdue (negative days_to_target), then by recency
    def sort_key(x):
        active = 0 if x["status"] == "active" else 1
        overdue = 0 if (x.get("days_to_target") is not None and x["days_to_target"] < 0) else 1
        return (active, overdue, -(x.get("days_since_start") or 0))
    out.sort(key=sort_key)
    return out


# ----- Dog tags (lightweight, per-dog) -----
class TagsIn(BaseModel):
    tags: List[str] = []


@api.put("/dogs/{dog_id}/tags")
async def update_dog_tags(dog_id: str, body: TagsIn, _: dict = Depends(require_admin)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    cleaned = sorted({t.strip() for t in body.tags if t and t.strip()})
    await db.dogs.update_one({"id": dog_id}, {"$set": {"tags": cleaned}})
    return {"tags": cleaned}


@api.get("/dogs/tags/all")
async def all_dog_tags(_: dict = Depends(require_admin)):
    """Distinct tags currently in use, with counts."""
    pipeline = [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.dogs.aggregate(pipeline).to_list(500)
    return [{"tag": r["_id"], "count": r["count"]} for r in rows]


# -------- Run Sheet --------
@api.get("/run-sheet")
async def run_sheet(_: dict = Depends(require_admin), date_str: Optional[str] = None):
    target = date_str or business_today().isoformat()
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending", "completed"]}}, {"_id": 0}
    ).to_list(2000)
    relevant = []
    for b in bookings:
        days = _dates_in_range(b["date"], b.get("end_date"))
        if target in days:
            relevant.append(b)

    # Enrich with dog care data + client
    out = []
    for b in relevant:
        dog = await db.dogs.find_one({"id": b["dog_id"]}, {"_id": 0})
        client = await db.clients.find_one({"id": b["client_id"]}, {"_id": 0})
        active_program_name = None
        if dog and dog.get("active_program_id"):
            enr = await db.dog_programs.find_one({"id": dog["active_program_id"]}, {"_id": 0})
            if enr and enr.get("status") == "active":
                active_program_name = (enr.get("program_snapshot") or {}).get("name")
        out.append({
            **b,
            "dog": dog,
            "client_phone": (client or {}).get("phone", ""),
            "client_emerg": (client or {}).get("emerg", ""),
            "active_program_name": active_program_name,
        })
    # Sort: boarding first, then daycare, then grooming, then training; secondary by dropoff_time
    order = {"boarding": 0, "daycare": 1, "grooming": 2, "training": 3}
    out.sort(key=lambda x: (order.get(x["service_type"], 9), x.get("dropoff_time") or "z"))
    return {"date": target, "bookings": out}


# -------- Dashboard --------
@api.post("/admin/daily-jobs/run-now")
async def admin_run_daily_jobs(_: dict = Depends(require_admin)):
    """Manually trigger the daily-jobs runner (bypasses the once-per-day gate).
    Useful for testing birthday/vaccine emails on demand. Force-clears today's
    `last_run` flag so the runner actually fires."""
    from daily_jobs import maybe_run_daily
    await db.system_runs.update_one(
        {"id": "daily"}, {"$set": {"last_run": None}}, upsert=True,
    )
    result = await maybe_run_daily(db)
    return {"ok": True, "result": result}



@api.get("/dashboard/stats")
async def dashboard_stats(_: dict = Depends(require_admin)):
    # Lazy daily-jobs trigger — at most one run per UTC day, fully non-blocking.
    # Birthday + vaccine-renewal emails fire from here so we don't need
    # a separate scheduler process for a solo-operator deploy.
    try:
        from daily_jobs import maybe_run_daily
        asyncio.create_task(maybe_run_daily(db))
    except Exception as e:
        logger.warning("daily_jobs trigger failed (non-fatal): %s", e)
    # Same lazy-daily pattern for cold-storage archival of old bookings.
    asyncio.create_task(_maybe_archive_today())
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    warn_days = int(settings.get("vaccine_warning_days", 30))
    daycare_cap = int(settings.get("daycare_capacity", DAYCARE_CAPACITY))
    today = business_today().isoformat()
    in_warn = (business_today() + timedelta(days=warn_days)).isoformat()
    # Projection skips heavy base64 photo fields — dashboard roster needs
    # feeding/medications/training_skills for the care-icon badges, but the
    # photo arrays + raw training_logs are the bandwidth hogs.
    dog_proj = {"_id": 0, "photo": 0, "photos": 0, "training_logs": 0}
    dogs = await db.dogs.find({}, dog_proj).to_list(2000)
    # Build the same "active dismissal" map used by /vaccine-alerts so the
    # Health Flags tile + the alert list stay in lock-step. (Bug fix: previously
    # the tile counter didn't decrease when alerts were hidden/cleared.)
    now_dt = datetime.now(timezone.utc)
    dismissals = await db.vaccine_dismissals.find({}, {"_id": 0}).to_list(2000)
    dismissed_dog_ids = set()
    for d in dismissals:
        try:
            until = datetime.fromisoformat(d["until"])
        except Exception:
            continue
        if until > now_dt:
            dismissed_dog_ids.add(d["dog_id"])
    health_flags = 0
    for d in dogs:
        if d["id"] in dismissed_dog_ids:
            continue
        vac = d.get("vaccines") or {}
        flagged = False
        for v in required:
            r = vac.get(v, "")
            if not r or r < today or r <= in_warn:
                flagged = True
                break
        if flagged:
            health_flags += 1

    # Only need bookings whose date range overlaps today — pull a tight
    # window instead of every booking in the DB.
    business_todayt = business_today()
    win_start = (business_todayt - timedelta(days=60)).isoformat()  # boarding stays might span back
    win_end = (business_todayt + timedelta(days=1)).isoformat()
    today_bookings = await db.bookings.find(
        {
            "status": {"$in": ["approved", "pending", "completed"]},
            "date": {"$gte": win_start, "$lte": win_end},
        },
        {"_id": 0},
    ).to_list(2000)
    # Build dog map for enrichment
    dog_map = {d["id"]: d for d in dogs}
    # Pre-fetch only the clients we actually need (instead of all clients) so
    # the roster rows can show "credits remaining" per dog at a glance.
    today_client_ids = list({b.get("client_id") for b in today_bookings if b.get("client_id")})
    client_bal_map = {}
    if today_client_ids:
        for c in await db.clients.find(
            {"id": {"$in": today_client_ids}},
            {"_id": 0, "id": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1},
        ).to_list(2000):
            client_bal_map[c["id"]] = {
                "credits": int(c.get("credits") or 0),
                "training_credits": int(c.get("training_credits") or 0),
                "boarding_credits": int(c.get("boarding_credits") or 0),
            }
    daycare_today = 0
    boarding_today = 0
    training_today = 0
    grooming_today = 0
    photography_today = 0
    roster = []
    for b in today_bookings:
        days = _dates_in_range(b["date"], b.get("end_date"))
        if today in days:
            # Live counts: a dog that's already checked out no longer occupies its slot.
            already_out = bool(b.get("checked_out_at"))
            svc = b["service_type"]
            if not already_out:
                if   svc == "daycare":     daycare_today += 1
                elif svc == "boarding":    boarding_today += 1
                elif svc == "training":    training_today += 1
                elif svc == "grooming":    grooming_today += 1
                elif svc == "photography": photography_today += 1
            enriched = dict(b)
            enriched["dog"] = dog_map.get(b["dog_id"], {})
            enriched["client_credits"] = client_bal_map.get(b.get("client_id"), {
                "credits": 0, "training_credits": 0, "boarding_credits": 0,
            })
            roster.append(enriched)
    return {
        "daycare_occupancy": daycare_today,
        "daycare_capacity": daycare_cap,
        "boarding_today": boarding_today,
        "training_today": training_today,
        # Sprint 110ac — surface grooming & photography day counts so the
        # admin dashboard hero tiles cover all five service categories.
        "grooming_today": grooming_today,
        "photography_today": photography_today,
        "health_flags": health_flags,
        "total_dogs": len(dogs),
        "today_roster": roster,
        "upcoming_birthdays": _upcoming_birthdays(dogs, days_ahead=14),
        "first_time_bookings_today": await _first_time_bookings_today(today, dog_map),
    }


async def _first_time_bookings_today(today: str, dog_map: dict) -> list:
    """Celebratory banner: bookings created today by clients who had no prior bookings.
    Used to surface 'first booking from {Name}!' on the admin dashboard."""
    tomorrow = (business_today() + timedelta(days=1)).isoformat()
    today_prefix_lo = f"{today}T"
    today_prefix_hi = f"{tomorrow}T"
    # Pull just the bookings created in today's window (indexed on created_at).
    new_today = await db.bookings.find(
        {"created_at": {"$gte": today_prefix_lo, "$lt": today_prefix_hi}},
        {"_id": 0},
    ).to_list(200)
    if not new_today:
        return []
    client_ids = list({b.get("client_id") for b in new_today if b.get("client_id")})
    if not client_ids:
        return []
    # For each client, find the earliest booking created_at in one aggregation.
    pipeline = [
        {"$match": {"client_id": {"$in": client_ids}}},
        {"$group": {"_id": "$client_id", "first_created": {"$min": "$created_at"}}},
    ]
    first_map = {}
    async for row in db.bookings.aggregate(pipeline):
        first_map[row["_id"]] = row.get("first_created") or ""
    seen = set()
    out = []
    for b in new_today:
        cid = b.get("client_id")
        if not cid or cid in seen:
            continue
        first_iso = first_map.get(cid, "")
        if not first_iso or not first_iso.startswith(today):
            continue
        seen.add(cid)
        dog = dog_map.get(b.get("dog_id", ""), {})
        out.append({
            "booking_id": b.get("id"),
            "client_id": cid,
            "client_name": b.get("client_name", ""),
            "dog_id": b.get("dog_id"),
            "dog_name": dog.get("name") or b.get("dog_name", ""),
            "service_type": b.get("service_type"),
            "date": b.get("date"),
            "end_date": b.get("end_date"),
        })
    return out


def _upcoming_birthdays(dogs: list, days_ahead: int = 14) -> list:
    today = business_today()
    out = []
    for d in dogs:
        bd = d.get("birthday") or ""
        if not bd or len(bd) < 10:
            continue
        try:
            m, day_n = int(bd[5:7]), int(bd[8:10])
            this_year = date(today.year, m, day_n)
            next_year = date(today.year + 1, m, day_n)
            target = this_year if this_year >= today else next_year
            delta = (target - today).days
            if 0 <= delta <= days_ahead:
                bday_year = int(bd[0:4])
                age_then = target.year - bday_year
                out.append({
                    "dog_id": d["id"],
                    "dog_name": d["name"],
                    "birthday": bd,
                    "next": target.isoformat(),
                    "days": delta,
                    "turning": age_then,
                })
        except Exception:
            continue
    out.sort(key=lambda x: x["days"])
    return out


# -------- Today's Brain — Unified Admin Action Queue (Sprint 102) --------
@api.get("/admin/today-brain")
async def admin_today_brain(_: dict = Depends(require_admin)):
    """Single prioritized 'what needs my attention' feed for the admin
    dashboard. Auto-resolving — items disappear when the underlying
    condition is resolved (no manual dismiss). Returns items grouped
    only by priority+kind for fast UI rendering.

    Priorities:
        urgent  → red    (overdue vaccines, no-checkin past 10 AM, pending hw reviews)
        warn    → orange (expiring vaccines, unanswered hw questions, low credits, pending bookings)
        info    → green  (pipeline ready for cert, new signups, monday digest preview)
    """
    today_iso = business_today().isoformat()
    now_dt = datetime.now(timezone.utc)
    items: List[dict] = []

    # 1. Homework day-submissions waiting for review (urgent)
    pending_count = 0
    async for hw in db.homework.find({"daily_tracker": True}, {"_id": 0, "id": 1, "dog_name": 1, "client_name": 1, "section_logs": 1, "title": 1}):
        for lo in hw.get("section_logs") or []:
            if lo.get("submission_status") == "submitted":
                pending_count += 1
    if pending_count > 0:
        items.append({
            "id": f"hw-reviews:{pending_count}",
            "kind": "hw_review",
            "priority": "urgent",
            "title": f"{pending_count} homework day-submission{'s' if pending_count != 1 else ''} waiting for review",
            "subtitle": "Tap to open the review queue",
            "ts": now_dt.isoformat(),
            "cta": {"type": "open_screen", "screen": "homework"},
            "icon": "fa-clipboard-check",
        })

    # 2. Vaccines expiring/expired (urgent if expired, warn if expiring)
    try:
        settings = await get_settings()
        required = settings.get("required_vaccines", ["rabies"])
        warn_days = int(settings.get("vaccine_warning_days", 30))
        in_warn = (business_today() + timedelta(days=warn_days)).isoformat()
        dismissals = await db.vaccine_dismissals.find({}, {"_id": 0}).to_list(2000)
        dismissed = set()
        for d in dismissals:
            try:
                if datetime.fromisoformat(d["until"]) > now_dt:
                    dismissed.add(d["dog_id"])
            except Exception:
                continue
        clients_map = {c["id"]: c["name"] for c in await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)}
        async for d in db.dogs.find({}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1, "vaccines": 1}):
            if d["id"] in dismissed:
                continue
            vaccines = d.get("vaccines") or {}
            for v in required:
                r = vaccines.get(v, "")
                if not r:
                    items.append({
                        "id": f"vax-missing:{d['id']}:{v}",
                        "kind": "vaccine_missing",
                        "priority": "urgent",
                        "title": f"{d['name']} · {v.upper()} missing",
                        "subtitle": f"Owner: {clients_map.get(d['owner_id'], '—')}",
                        "ts": "0000",  # sort to bottom of urgent group
                        "cta": {"type": "open_dog", "id": d["id"]},
                        "icon": "fa-shield-virus",
                    })
                    break
                elif r < today_iso:
                    items.append({
                        "id": f"vax-expired:{d['id']}:{v}",
                        "kind": "vaccine_expired",
                        "priority": "urgent",
                        "title": f"{d['name']} · {v.upper()} expired",
                        "subtitle": f"Owner: {clients_map.get(d['owner_id'], '—')} · expired {r}",
                        "ts": r,
                        "cta": {"type": "open_dog", "id": d["id"]},
                        "icon": "fa-shield-virus",
                    })
                    break
                elif r <= in_warn:
                    items.append({
                        "id": f"vax-warn:{d['id']}:{v}",
                        "kind": "vaccine_expiring",
                        "priority": "warn",
                        "title": f"{d['name']} · {v.upper()} expires {r}",
                        "subtitle": f"Owner: {clients_map.get(d['owner_id'], '—')}",
                        "ts": r,
                        "cta": {"type": "open_dog", "id": d["id"]},
                        "icon": "fa-shield-virus",
                    })
                    break
    except Exception as e:
        logger.warning("today-brain vaccines query failed: %s", e)

    # 3. Dogs booked today not checked in (urgent if past 10 AM local-ish; using UTC hour as proxy)
    try:
        hour_utc = now_dt.hour  # admin reads this dashboard mid-day; rough heuristic
        if hour_utc >= 14:  # ~10 AM ET / 7 AM PT
            no_in = []
            async for b in db.bookings.find(
                {"date": today_iso, "status": "approved", "checked_in_at": {"$in": [None, ""]}},
                {"_id": 0, "id": 1, "dog_name": 1, "client_name": 1, "service_type": 1, "dropoff_time": 1},
            ):
                no_in.append(b)
            if no_in:
                items.append({
                    "id": f"no-checkin:{today_iso}:{len(no_in)}",
                    "kind": "no_checkin",
                    "priority": "urgent",
                    "title": f"{len(no_in)} dog{'s' if len(no_in) != 1 else ''} booked today not yet checked in",
                    "subtitle": ", ".join(b.get("dog_name", "?") for b in no_in[:4]) + (f" · +{len(no_in)-4} more" if len(no_in) > 4 else ""),
                    "ts": now_dt.isoformat(),
                    "cta": {"type": "open_screen", "screen": "dashboard"},
                    "icon": "fa-circle-exclamation",
                })
    except Exception as e:
        logger.warning("today-brain no-checkin query failed: %s", e)

    # 4. Low credits (warn) — any client with any pool ≤ 2
    try:
        low_clients = []
        async for c in db.clients.find(
            {"$or": [{"credits": {"$lte": 2}}, {"training_credits": {"$lte": 2}}, {"boarding_credits": {"$lte": 2}}]},
            {"_id": 0, "id": 1, "name": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1},
        ):
            pools = []
            if (c.get("credits") or 0) <= 2:
                pools.append(f"{c.get('credits') or 0} daycare")
            if (c.get("training_credits") or 0) <= 2:
                pools.append(f"{c.get('training_credits') or 0} training")
            if (c.get("boarding_credits") or 0) <= 2:
                pools.append(f"{c.get('boarding_credits') or 0} boarding")
            low_clients.append((c, pools))
        # Only flag clients with at least one daycare/training/boarding booking in last 60d
        # so we don't spam alerts for inactive prospects.
        if low_clients:
            cutoff = (business_today() - timedelta(days=60)).isoformat()
            active_ids = set()
            async for b in db.bookings.find(
                {"date": {"$gte": cutoff}, "status": {"$in": ["approved", "completed"]}},
                {"_id": 0, "client_id": 1},
            ):
                active_ids.add(b.get("client_id"))
            for c, pools in low_clients[:12]:  # cap to avoid 100-line list on big DBs
                if c["id"] not in active_ids:
                    continue
                items.append({
                    "id": f"low-credits:{c['id']}",
                    "kind": "low_credits",
                    "priority": "warn",
                    "title": f"{c['name']} · {' · '.join(pools)} left",
                    "subtitle": "Active client — consider offering a credit pack",
                    "ts": now_dt.isoformat(),
                    "cta": {"type": "open_client", "id": c["id"]},
                    "icon": "fa-coins",
                })
    except Exception as e:
        logger.warning("today-brain low-credits query failed: %s", e)

    # 5. Pending bookings awaiting admin approval (warn)
    try:
        pending = await db.bookings.count_documents({"status": "pending"})
        if pending > 0:
            items.append({
                "id": f"booking-pending:{pending}",
                "kind": "booking_pending",
                "priority": "warn",
                "title": f"{pending} booking request{'s' if pending != 1 else ''} awaiting approval",
                "subtitle": "Tap to open the Bookings queue",
                "ts": now_dt.isoformat(),
                "cta": {"type": "open_screen", "screen": "bookings"},
                "icon": "fa-hourglass-half",
            })
    except Exception as e:
        logger.warning("today-brain pending-bookings failed: %s", e)

    # 6. Unanswered homework questions (warn)
    try:
        unanswered = 0
        async for hw in db.homework.find({"daily_tracker": True}, {"_id": 0, "section_logs": 1}):
            for lo in hw.get("section_logs") or []:
                for q in lo.get("questions") or []:
                    if not q.get("answer"):
                        unanswered += 1
        if unanswered > 0:
            items.append({
                "id": f"hw-questions:{unanswered}",
                "kind": "hw_question",
                "priority": "warn",
                "title": f"{unanswered} unanswered client question{'s' if unanswered != 1 else ''}",
                "subtitle": "Daily-tracker homework questions need a reply",
                "ts": now_dt.isoformat(),
                "cta": {"type": "open_screen", "screen": "homework"},
                "icon": "fa-comments",
            })
    except Exception as e:
        logger.warning("today-brain hw-questions failed: %s", e)

    # 7. Pipeline enrollments ready for certificate (info — ≥95% overall)
    try:
        ready = []
        async for ep in db.dog_programs.find(
            {"status": "active", "overall_pct": {"$gte": 95}},
            {"_id": 0, "id": 1, "dog_id": 1, "dog_name": 1, "program_name": 1, "overall_pct": 1},
        ):
            ready.append(ep)
        for ep in ready[:8]:
            items.append({
                "id": f"pipeline-ready:{ep['id']}",
                "kind": "pipeline_ready",
                "priority": "info",
                "title": f"{ep.get('dog_name', '?')} · {ep.get('program_name', '?')} at {int(ep.get('overall_pct') or 0)}%",
                "subtitle": "Eligible for certificate — finish & print",
                "ts": now_dt.isoformat(),
                "cta": {"type": "open_dog", "id": ep.get("dog_id")},
                "icon": "fa-medal",
            })
    except Exception as e:
        logger.warning("today-brain pipeline-ready failed: %s", e)

    # 8. New client signups in last 24h (info)
    try:
        yesterday = (now_dt - timedelta(hours=24)).isoformat()
        signups = []
        async for c in db.clients.find(
            {"created_at": {"$gte": yesterday}},
            {"_id": 0, "id": 1, "name": 1, "created_at": 1, "email": 1},
        ).sort("created_at", -1).limit(8):
            signups.append(c)
        for c in signups:
            items.append({
                "id": f"new-signup:{c['id']}",
                "kind": "new_signup",
                "priority": "info",
                "title": f"New signup · {c.get('name', '—')}",
                "subtitle": c.get("email", ""),
                "ts": c.get("created_at") or now_dt.isoformat(),
                "cta": {"type": "open_client", "id": c["id"]},
                "icon": "fa-user-plus",
            })
    except Exception as e:
        logger.warning("today-brain new-signups failed: %s", e)

    # 9. Trainer Monday digest hint (info, Mondays only)
    if now_dt.weekday() == 0:  # Monday
        items.append({
            "id": f"monday-digest:{today_iso}",
            "kind": "monday_digest",
            "priority": "info",
            "title": "Monday digest is ready to send",
            "subtitle": "Tap to preview the week-ahead summary email",
            "ts": now_dt.isoformat(),
            "cta": {"type": "send_monday_digest"},
            "icon": "fa-envelope-open-text",
        })

    # 10. Clients with today's tracker steps still incomplete (warn — Sprint 103)
    try:
        steps_incomplete = 0
        clients_lagging = set()
        async for hw in db.homework.find(
            {"daily_tracker": True, "status": {"$ne": "completed"}},
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "dog_name": 1, "template_snapshot": 1, "section_logs": 1},
        ):
            snap = hw.get("template_snapshot") or {}
            sections = sorted(
                [s for s in (snap.get("sections") or []) if s.get("day_number") and (s.get("steps") or [])],
                key=lambda s: int(s["day_number"]),
            )
            if not sections:
                continue
            logs_by_day = {int(lo.get("day_number") or 0): lo for lo in (hw.get("section_logs") or [])}
            # Find current available day
            prev_passed = True
            for s in sections:
                dn = int(s["day_number"])
                lo = logs_by_day.get(dn)
                if prev_passed and not lo:
                    states = {}
                    steps = s.get("steps") or []
                    if steps and not all(states.get(st["id"]) for st in steps):
                        steps_incomplete += 1
                        clients_lagging.add(hw.get("client_name", ""))
                    break
                if lo and lo.get("submission_status") in ("approved", "rest", "skipped"):
                    prev_passed = True
                    continue
                break
        if steps_incomplete > 0:
            items.append({
                "id": f"steps-incomplete:{steps_incomplete}",
                "kind": "steps_incomplete",
                "priority": "warn",
                "title": f"{steps_incomplete} tracker{'s' if steps_incomplete != 1 else ''} have today's steps still open",
                "subtitle": ", ".join(sorted(clients_lagging))[:120] or "Clients haven't started today's steps",
                "ts": now_dt.isoformat(),
                "cta": {"type": "open_screen", "screen": "homework"},
                "icon": "fa-list-check",
            })
    except Exception as e:
        logger.warning("today-brain steps-incomplete failed: %s", e)

    # Sort: priority (urgent=0, warn=1, info=2) then within priority newest-first
    prio_order = {"urgent": 0, "warn": 1, "info": 2}
    items.sort(key=lambda it: (prio_order.get(it["priority"], 9), -1 * len(it.get("ts", ""))))
    # Within priority, sort by ts descending (string compare works for ISO dates)
    items.sort(key=lambda it: (prio_order.get(it["priority"], 9), it.get("ts", "") or ""), reverse=False)
    # Stable two-pass: priority asc, then ts desc within
    items.sort(key=lambda it: it.get("ts", ""), reverse=True)
    items.sort(key=lambda it: prio_order.get(it["priority"], 9))

    # Sprint 109b — attach a state-signature to every item so the dismissal
    # logic below knows when the underlying condition has changed (and the
    # item should reappear despite a prior dismiss).
    for it in items:
        it["signature"] = _today_brain_signature(it)

    # Filter out anything the admin has dismissed *whose signature still
    # matches*. If the underlying state has shifted (e.g. credits dropped
    # further, vaccine moved closer to expiry, count went up), the dismissal
    # no longer applies → item reappears.
    dismissed_map: Dict[str, str] = {}
    async for dm in db.task_dismissals.find({}, {"_id": 0, "item_id": 1, "signature": 1}):
        dismissed_map[dm["item_id"]] = dm.get("signature") or ""
    if dismissed_map:
        items = [it for it in items if dismissed_map.get(it["id"]) != it["signature"]]

    counts = {
        "urgent": sum(1 for it in items if it["priority"] == "urgent"),
        "warn":   sum(1 for it in items if it["priority"] == "warn"),
        "info":   sum(1 for it in items if it["priority"] == "info"),
        "total":  len(items),
    }
    return {"items": items, "counts": counts, "generated_at": now_dt.isoformat()}


def _today_brain_signature(item: dict) -> str:
    """Build a deterministic state-fingerprint for a today-brain item so a
    dismissal naturally expires when the underlying condition changes.

    Examples:
      - low_credits → "2|1|0" (the 3 credit pools). Drop any pool → new sig → reappears.
      - vaccine_expiring → the expiry date. New expiry recorded → new sig → reappears.
      - booking_pending → the current pending count. Count goes up → reappears.
      - new_signup → empty (one-time dismiss; tied to client_id in the id already).
      - monday_digest / no_checkin → today's date (auto-expires next day).
    """
    kind = item.get("kind") or ""
    title = item.get("title") or ""
    subtitle = item.get("subtitle") or ""
    if kind in ("vaccine_expiring", "vaccine_expired", "vaccine_missing"):
        # ts holds the expiry date (or "0000" for missing). Stable per state.
        return f"{kind}:{item.get('ts') or ''}"
    if kind == "low_credits":
        # subtitle is generic; pull the pool counts out of the title
        # ("Name · 2 daycare · 0 training · 1 boarding left").
        nums = "|".join([t for t in title.replace("·", " ").split() if t.isdigit()])
        return f"low:{nums or title}"
    if kind in ("booking_pending", "hw_review", "hw_question"):
        # Title carries the count → encode it as the signature.
        nums = "|".join([t for t in title.split() if t.isdigit()])
        return f"{kind}:{nums or title}"
    if kind == "pipeline_ready":
        # Bucket overall_pct into 5% steps so a 1% bump doesn't re-spam.
        nums = [int(t) for t in title.replace("%", " ").split() if t.isdigit()]
        pct_bucket = (nums[0] // 5) * 5 if nums else 0
        return f"pipeline:{item.get('id','').split(':')[-1]}:{pct_bucket}"
    if kind in ("monday_digest", "no_checkin", "steps_incomplete"):
        # Date-scoped — these auto-roll over at midnight UTC anyway.
        return f"{kind}:{business_today().isoformat()}"
    if kind == "new_signup":
        # One-time dismiss tied to the client id — no state to track.
        return "once"
    # Fallback: hash of title+subtitle so unknown item kinds still behave sanely.
    return f"hash:{hash(title + '|' + subtitle) & 0xFFFFFFFF:08x}"


# ────────────────────── Sprint 109b — Today's Tasks dismissals ──────────────────────

class TodayBrainDismissIn(BaseModel):
    item_id: str = Field(min_length=1, max_length=300)
    signature: str = Field(default="", max_length=300)


@api.post("/admin/today-brain/dismiss")
async def admin_today_brain_dismiss(body: TodayBrainDismissIn, user: dict = Depends(require_admin)):
    """Hide a single Today's Tasks row. The dismissal is keyed by
    (item_id, signature) — so once the underlying state changes (the
    signature shifts), the item naturally re-appears next dashboard load."""
    await db.task_dismissals.update_one(
        {"item_id": body.item_id},
        {"$set": {
            "item_id": body.item_id,
            "signature": body.signature or "",
            "dismissed_at": now_iso(),
            "dismissed_by": user.get("email") or user.get("id"),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/admin/today-brain/clear-all")
async def admin_today_brain_clear_all(user: dict = Depends(require_admin)):
    """Dismiss every currently-visible Today's Tasks row in one shot. Each
    row's state-signature is captured so any that flip back to a new state
    (e.g. credits drop further, a fresh vaccine expires) reappear automatically."""
    # Build the current list exactly as the tile sees it (with signatures),
    # then upsert one dismissal per item.
    current = await admin_today_brain(_=user)
    count = 0
    for it in current.get("items", []):
        await db.task_dismissals.update_one(
            {"item_id": it["id"]},
            {"$set": {
                "item_id": it["id"],
                "signature": it.get("signature") or "",
                "dismissed_at": now_iso(),
                "dismissed_by": user.get("email") or user.get("id"),
            }},
            upsert=True,
        )
        count += 1
    return {"ok": True, "dismissed": count}


@api.post("/admin/today-brain/restore")
async def admin_today_brain_restore(body: TodayBrainDismissIn, _: dict = Depends(require_admin)):
    """Undo a single dismissal (item re-appears immediately)."""
    res = await db.task_dismissals.delete_one({"item_id": body.item_id})
    return {"ok": True, "removed": res.deleted_count}




# -------- Calendar Events --------
@api.get("/events")
async def calendar_events(_: dict = Depends(require_admin)):
    # Sprint 110at — keep completed bookings on the calendar (they used to
    # disappear the moment the dog was checked out). They render with a
    # muted gray tone so the active queue (pending/approved) still pops.
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending", "completed"]}}, {"_id": 0}
    ).to_list(2000)
    events = []
    for b in bookings:
        end = b.get("end_date") or b["date"]
        # FullCalendar treats end as exclusive
        try:
            end_excl = (datetime.fromisoformat(end).date() + timedelta(days=1)).isoformat()
        except Exception:
            end_excl = end
        # daycare green, boarding blue, training purple, grooming pink, photography amber
        _svc_colors = {
            "daycare":     "#8cc63f",
            "boarding":    "#00a9e0",
            "training":    "#a855f7",
            "grooming":    "#ec4899",
            "photography": "#f59e0b",
        }
        color = _svc_colors.get(b["service_type"], "#64748b")
        if b["status"] == "pending":
            color = "#f26522"
        elif b["status"] == "completed":
            # Muted slate so completed bookings stay visible without competing
            # with today's live queue.
            color = "#64748b"
        # Add grooming sub-type to title so it shows on the calendar at a glance
        svc_label = b["service_type"]
        if b["service_type"] == "grooming" and b.get("grooming_type"):
            gt = "bath" if b["grooming_type"] == "bath" else "nail trim"
            svc_label = f"grooming · {gt}"
        # Training (and grooming/photography) have appointment times — promote the event
        # from all-day to a timed event so FullCalendar renders the time prefix
        # automatically (e.g. "2:16pm Buddy (training)").
        appt_time = (b.get("time") or "").strip()
        is_timed = bool(appt_time) and b["service_type"] in TIME_SLOTTED_SERVICES
        title = f"{b['dog_name']} ({svc_label})"
        event = {
            "id": b["id"],
            "title": title,
            "backgroundColor": color,
            "borderColor": color,
            "extendedProps": {
                "status": b["status"],
                "client_id": b.get("client_id"),
                "client_name": b["client_name"],
                "service_type": b["service_type"],
                "grooming_type": b.get("grooming_type"),
                "time": appt_time,
            },
        }
        if is_timed:
            # FullCalendar prefers ISO datetime for timed events
            try:
                hh, mm = appt_time.split(":")[0:2]
                event["start"] = f"{b['date']}T{int(hh):02d}:{int(mm):02d}:00"
                # Use the booking's stored duration when present (admin-configured
                # per-service-tier minutes) so photography sessions render at
                # their actual length on the calendar. Falls back to the service
                # default, then 60 min as a final safety net.
                stored_dur = int(b.get("duration_minutes") or 0)
                if stored_dur <= 0:
                    stored_dur = await _get_default_duration(b["service_type"]) or 60
                end_dt = datetime.fromisoformat(event["start"]) + timedelta(minutes=stored_dur)
                event["end"] = end_dt.isoformat()
                event["allDay"] = False
            except Exception:
                event["start"] = b["date"]
                event["end"] = end_excl
        else:
            event["start"] = b["date"]
            event["end"] = end_excl
        events.append(event)
    return events


# -------- Backup & Restore --------
# Sprint 110aj — expanded backup to cover EVERYTHING the user touches.
# Earlier the snapshot only captured 9 collections, so homework templates,
# trophies, programs, credits, training sessions, time-clock history, etc.
# were silently lost on restore. Now we capture every catalog + every piece
# of per-dog / per-client progress + retail + financial state.
#
# Intentionally excluded:
#   • users               — passwords are hashed; use /admin/users/export-with-hashes
#                            for credentialed migrations between hosts.
#   • vaccine_dismissals  — audit trail, can balloon to thousands of rows.
#   • notification_log    — email-send audit; not needed for DR.
#   • commands            — admin command audit.
#   • system_runs         — cron-job audit.
BACKUP_COLLECTIONS = [
    # Core directory
    "clients", "dogs", "bookings", "incidents",
    "waiver_signatures", "client_files", "claim_tokens",
    # Settings + catalog (the "templates" the user explicitly called out)
    "settings", "app_settings", "services", "credit_packs",
    "homework_templates", "recurring_templates", "shift_templates",
    "programs", "trophies", "commands",
    # Per-dog / per-client progress
    "homework", "homework_media", "step_events",
    "dog_programs", "training_sessions",
    "awarded_trophies", "referrals",
    # Financial state
    "expenses", "retail_sales", "credit_lots", "credit_adjustments",
    "price_overrides", "payment_transactions",
    # Front-desk inbox + admin task state
    "quote_requests", "tasks", "task_dismissals",
    # Staff scheduling + actual clocked hours (drives payroll)
    "shifts", "time_clock_entries", "time_off_requests",
    # Tax tracker
    "tax_payments", "mileage_log",
    # Dog Trivia + Fact of the Day (engagement content + per-client streak history)
    # NOTE: trivia_daily is intentionally excluded — it's a 1-row daily cache
    # that regenerates from trivia_questions on the next portal hit. Including
    # it would create duplicate rows on restore (no stable key field).
    "trivia_questions", "trivia_attempts", "dog_facts",
    # Sprint 110by — admin email customization (per-template overrides + singleton branding)
    "email_templates", "email_settings",
    # Sprint 110bx — homework auto-assign audit trail (program-driven sends)
    "notification_log",
    # Sprint 110cf — client-initiated reschedule requests (need history)
    "reschedule_requests",
    # Sprint 110ch — payment plans for big-ticket items + their settings
    "payment_plans", "payment_plan_settings",
    # Vaccine reminder dismissals so restored state doesn't re-fire stale alerts
    "vaccine_dismissals",
]
# Collections whose primary key is a string `_id` (no separate `id` field).
# These get special handling during export (we preserve `_id`) and restore
# (we upsert by `_id` instead of `id`).
#   • `app_settings`           — stores rows like {_id: "quarterly_tax", ...}
#   • `email_settings`         — singleton {_id: "singleton", brand_*, ...}
#   • `payment_plan_settings`  — singleton {_id: "singleton", agreement_html, ...}
STRING_ID_COLLECTIONS = {"app_settings", "email_settings", "payment_plan_settings"}
# Bumped to v4 with the email customization + notification log additions.
# Restore accepts older v1/v2/v3 backups too (missing collections are left
# untouched rather than wiped).
BACKUP_VERSION = 4

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
async def backup_export(_: dict = Depends(require_admin)):
    """Download a full JSON backup of every business collection. User accounts
    are intentionally excluded — passwords are hashed and migration of users
    should go through a separate restore flow."""
    payload = {
        "version": BACKUP_VERSION,
        "exported_at": now_iso(),
        "collections": {},
    }
    for c in BACKUP_COLLECTIONS:
        if c in STRING_ID_COLLECTIONS:
            # Preserve string-typed _id so restore can roundtrip the named key.
            docs = await db[c].find({}).to_list(50000)
            cleaned: List[Dict[str, Any]] = []
            for d in docs:
                _id = d.get("_id")
                if isinstance(_id, str):
                    d["_id"] = _id  # keep as-is
                else:
                    d.pop("_id", None)  # drop ObjectId — collection isn't actually keyed by it
                cleaned.append(d)
            payload["collections"][c] = cleaned
        else:
            docs = await db[c].find({}, {"_id": 0}).to_list(50000)
            payload["collections"][c] = docs
    return payload


# ─────────────── Sprint 110av · Disk Usage Monitor ───────────────
# Shows free/used space for every path the container can see. Helps the
# operator know when they're running out of room for backups / Mongo data
# before disaster strikes. Works inside an unprivileged container — uses
# pure shutil.disk_usage (no host privileges needed).
import shutil

# Paths the container is *likely* to care about. Anything that doesn't
# exist is silently skipped; anything mounted from the host shows up via
# /proc/mounts scan below.
_DISK_PROBE_PATHS = [
    ("/app",            "App code & data"),
    ("/app/data",       "App data dir"),
    ("/app/backups",    "Backups"),
    ("/data",           "Mongo data dir"),
    ("/data/db",        "Mongo db dir"),
    ("/mnt/ext",        "External mount"),
    ("/mnt/backups",    "Backups mount"),
    ("/var/lib/mongo",  "Mongo system dir"),
]

# Filesystem types that suggest data won't survive container rebuilds.
# (Overlay = container layer; tmpfs = RAM; ramfs = RAM.)
_EPHEMERAL_FS_TYPES = {"overlay", "tmpfs", "ramfs", "overlay2"}


def _read_mounts() -> List[Dict[str, str]]:
    """Parse /proc/mounts → list of {device, mountpoint, fs_type}."""
    rows: List[Dict[str, str]] = []
    try:
        with open("/proc/mounts") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 3:
                    continue
                rows.append({
                    "device": parts[0],
                    "mountpoint": parts[1],
                    "fs_type": parts[2],
                })
    except Exception:
        pass
    return rows


def _disk_row(path: str, label: str, mounts: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    """Build a usage row for `path` if it exists. Returns None on failure."""
    try:
        total, used, free = shutil.disk_usage(path)
    except Exception:
        return None
    pct_used = round((used / total) * 100, 1) if total else 0.0
    # Find the most specific mountpoint that contains `path`
    best = {"mountpoint": "/", "fs_type": "unknown", "device": "?"}
    for m in mounts:
        if path == m["mountpoint"] or path.startswith(m["mountpoint"].rstrip("/") + "/"):
            if len(m["mountpoint"]) > len(best["mountpoint"]):
                best = m
    fs_type = best["fs_type"]
    likely_ephemeral = fs_type in _EPHEMERAL_FS_TYPES
    verdict = (
        "danger" if pct_used >= 90 else
        "warn" if pct_used >= 70 or likely_ephemeral else
        "ok"
    )
    return {
        "path": path,
        "label": label,
        "mountpoint": best["mountpoint"],
        "fs_type": fs_type,
        "device": best["device"],
        "total_bytes": total,
        "used_bytes": used,
        "free_bytes": free,
        "total_gb": round(total / (1024 ** 3), 2),
        "used_gb": round(used / (1024 ** 3), 2),
        "free_gb": round(free / (1024 ** 3), 2),
        "pct_used": pct_used,
        "likely_ephemeral": likely_ephemeral,
        "verdict": verdict,
    }


@api.get("/admin/disk-usage")
async def admin_disk_usage(_: dict = Depends(require_admin)):
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
            "path": "/app/backups",
            "retain_days": 30,
            "last_run": None,      # filled in by the runner
            "last_ok": None,
            "last_error": None,
            "last_size_bytes": None,
            "last_file": None,
        }
        await db.app_settings.update_one(
            {"_id": "auto_backup"}, {"$set": row}, upsert=True
        )
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
        if c in STRING_ID_COLLECTIONS:
            docs = await db[c].find({}).to_list(50000)
            cleaned: List[Dict[str, Any]] = []
            for d in docs:
                _id = d.get("_id")
                if isinstance(_id, str):
                    d["_id"] = _id
                else:
                    d.pop("_id", None)
                cleaned.append(d)
            payload["collections"][c] = cleaned
        else:
            docs = await db[c].find({}, {"_id": 0}).to_list(50000)
            payload["collections"][c] = docs
    return payload


async def _run_auto_backup_once(trigger: str = "scheduled") -> Dict[str, Any]:
    """Write a gzipped snapshot to disk and prune older files past retention."""
    cfg = await _get_auto_backup_config()
    started = now_iso()
    try:
        target_dir = cfg.get("path") or "/app/backups"
        os.makedirs(target_dir, exist_ok=True)
        payload = await _build_backup_payload()
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
        fname = f"sit-happens-{ts}.json.gz"
        full_path = os.path.join(target_dir, fname)
        body = _json.dumps(payload, separators=(",", ":")).encode("utf-8")
        with gzip.open(full_path, "wb", compresslevel=6) as fh:
            fh.write(body)
        size = os.path.getsize(full_path)
        # Prune older files past retention. Sprint 110ck — also dedupe within
        # retention: keep ALL files from the last 7 days (so you have hourly
        # safety nets after a fresh backup) but only ONE file per calendar day
        # for files older than that. Prevents the backup folder from ballooning
        # to GBs when the operator triggers many manual backups in a row.
        retain = max(1, int(cfg.get("retain_days") or 30))
        cutoff = datetime.now(timezone.utc) - timedelta(days=retain)
        recent_window = datetime.now(timezone.utc) - timedelta(days=7)
        pruned: List[str] = []
        # Walk files newest-first so we keep the LATEST snapshot per day.
        all_files = sorted(
            (f for f in os.listdir(target_dir)
             if f.startswith("sit-happens-") and f.endswith(".json.gz")),
            reverse=True,
        )
        seen_days: set = set()
        for old in all_files:
            try:
                stamp = old.split("sit-happens-", 1)[1].split(".json.gz", 1)[0]
                file_dt = datetime.strptime(stamp, "%Y-%m-%d_%H%M%S").replace(tzinfo=timezone.utc)
            except Exception:
                continue
            day_key = file_dt.date().isoformat()
            # Past retention → always delete.
            if file_dt < cutoff:
                try:
                    os.remove(os.path.join(target_dir, old))
                    pruned.append(old)
                except Exception:
                    pass
                continue
            # Within the last 7 days → keep all.
            if file_dt >= recent_window:
                seen_days.add(day_key)
                continue
            # Older than 7 days but within retain — dedupe to 1/day (newest wins).
            if day_key in seen_days:
                try:
                    os.remove(os.path.join(target_dir, old))
                    pruned.append(old)
                except Exception:
                    pass
            else:
                seen_days.add(day_key)
        # Record run history
        run_row = {
            "id": str(uuid.uuid4()),
            "trigger": trigger,
            "started_at": started,
            "finished_at": now_iso(),
            "ok": True,
            "path": full_path,
            "size_bytes": size,
            "collections": len(payload["collections"]),
            "total_docs": sum(len(v) for v in payload["collections"].values()),
            "pruned": pruned,
            "error": None,
        }
        await db.auto_backup_runs.insert_one(run_row)
        await _save_auto_backup_config({
            "last_run": run_row["finished_at"],
            "last_ok": True,
            "last_error": None,
            "last_size_bytes": size,
            "last_file": full_path,
        })
        run_row.pop("_id", None)
        return run_row
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        run_row = {
            "id": str(uuid.uuid4()),
            "trigger": trigger,
            "started_at": started,
            "finished_at": now_iso(),
            "ok": False,
            "path": None,
            "size_bytes": 0,
            "collections": 0,
            "total_docs": 0,
            "pruned": [],
            "error": err,
        }
        await db.auto_backup_runs.insert_one(run_row)
        await _save_auto_backup_config({
            "last_run": run_row["finished_at"],
            "last_ok": False,
            "last_error": err,
        })
        run_row.pop("_id", None)
        logger.warning("auto-backup run failed: %s", err)
        return run_row


def _seconds_until_next_run(hour: int, minute: int) -> float:
    """Compute seconds until the next HH:MM (US Eastern wall clock)."""
    now = now_local()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return max(60.0, (target - now).total_seconds())


_auto_backup_task: Optional[asyncio.Task] = None


async def _auto_backup_loop():
    """Background loop — sleeps until next scheduled run, then fires."""
    while True:
        try:
            cfg = await _get_auto_backup_config()
            if not cfg.get("enabled"):
                # Re-check every 5 minutes so toggling it on takes effect quickly
                await asyncio.sleep(300)
                continue
            wait = _seconds_until_next_run(
                int(cfg.get("hour") or 3),
                int(cfg.get("minute") or 0),
            )
            logger.info("auto-backup: next run in %.0fs", wait)
            await asyncio.sleep(wait)
            # Re-check config — operator may have disabled it while we slept
            cfg = await _get_auto_backup_config()
            if cfg.get("enabled"):
                await _run_auto_backup_once(trigger="scheduled")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("auto-backup loop error: %s", e)
            await asyncio.sleep(60)


class AutoBackupConfigIn(BaseModel):
    enabled: Optional[bool] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    path: Optional[str] = None
    retain_days: Optional[int] = Field(default=None, ge=1, le=3650)


@api.get("/admin/auto-backup/config")
async def get_auto_backup_config(_: dict = Depends(require_admin)):
    cfg = await _get_auto_backup_config()
    # Augment with current path state so the UI can warn about ephemeral mounts
    mounts = _read_mounts()
    path_row = _disk_row(cfg.get("path") or "/app/backups", "Backup target", mounts) if os.path.exists(cfg.get("path") or "") else None
    cfg["path_exists"] = path_row is not None
    cfg["path_info"] = path_row
    return cfg


@api.put("/admin/auto-backup/config")
async def put_auto_backup_config(body: AutoBackupConfigIn, _: dict = Depends(require_admin)):
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "path" in patch:
        # Ensure the target dir exists (create if needed); silently ignore failures
        try:
            os.makedirs(patch["path"], exist_ok=True)
        except Exception:
            pass
    cfg = await _save_auto_backup_config(patch)
    return cfg


@api.post("/admin/auto-backup/run-now")
async def run_auto_backup_now(_: dict = Depends(require_admin)):
    """Trigger a backup immediately, regardless of the schedule."""
    return await _run_auto_backup_once(trigger="manual")


@api.get("/admin/auto-backup/runs")
async def list_auto_backup_runs(limit: int = 30, _: dict = Depends(require_admin)):
    rows = await db.auto_backup_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return rows


# ─────────────── Sprint 110ax · Dog Fact of the Day ───────────────
# Daily sticky engagement: a single curated "fun fact" appears on both the
# client portal and the admin dashboard. Same fact for everyone same day —
# deterministic rotation by day-of-year over active facts, so two users
# comparing notes both see the same one.
from dog_facts_seed import DOG_FACTS_SEED


async def _seed_dog_facts_if_empty():
    """Idempotent. Seeds the curated library on first boot."""
    n = await db.dog_facts.count_documents({})
    if n > 0:
        return
    rows = []
    for i, item in enumerate(DOG_FACTS_SEED):
        rows.append({
            "id": str(uuid.uuid4()),
            "text": item["text"],
            "tag": item.get("tag") or "fun",
            "emoji": item.get("emoji") or "🐶",
            "active": True,
            "seeded": True,
            "created_at": now_iso(),
            "sort_order": i,
        })
    if rows:
        await db.dog_facts.insert_many(rows)
        logger.info("Seeded %d dog facts", len(rows))


async def _todays_fact() -> Optional[Dict[str, Any]]:
    """Pick today's fact deterministically. Stable for the calendar day."""
    facts = await db.dog_facts.find(
        {"active": True}, {"_id": 0}
    ).sort("sort_order", 1).to_list(2000)
    if not facts:
        return None
    today = business_today()
    # day-of-year + year offset for slow drift between years
    idx = (today.toordinal()) % len(facts)
    return facts[idx]


@api.get("/dog-facts/today")
async def dog_fact_today(user: dict = Depends(get_current_user)):
    """Public-ish endpoint (any authenticated user). Returns today's fact."""
    fact = await _todays_fact()
    if not fact:
        return {"fact": None, "date": business_today().isoformat()}
    return {"fact": fact, "date": business_today().isoformat()}


@api.get("/dog-facts")
async def list_dog_facts(active_only: bool = False, _: dict = Depends(require_admin)):
    q = {"active": True} if active_only else {}
    rows = await db.dog_facts.find(q, {"_id": 0}).sort("sort_order", 1).to_list(2000)
    return rows


class DogFactIn(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    tag: Optional[str] = "fun"
    emoji: Optional[str] = "🐶"
    active: Optional[bool] = True


@api.post("/dog-facts")
async def create_dog_fact(body: DogFactIn, user: dict = Depends(require_admin)):
    # Push new ones to the end of the rotation so they get their turn
    max_sort = await db.dog_facts.find({}, {"_id": 0, "sort_order": 1}).sort("sort_order", -1).to_list(1)
    next_sort = (max_sort[0]["sort_order"] + 1) if max_sort else 0
    doc = {
        "id": str(uuid.uuid4()),
        "text": body.text.strip(),
        "tag": (body.tag or "fun").strip(),
        "emoji": (body.emoji or "🐶")[:4],
        "active": True if body.active is None else bool(body.active),
        "seeded": False,
        "created_at": now_iso(),
        "created_by": user.get("id"),
        "sort_order": next_sort,
    }
    await db.dog_facts.insert_one(doc)
    doc.pop("_id", None)
    return doc


class DogFactPatch(BaseModel):
    text: Optional[str] = None
    tag: Optional[str] = None
    emoji: Optional[str] = None
    active: Optional[bool] = None


@api.patch("/dog-facts/{fact_id}")
async def update_dog_fact(fact_id: str, body: DogFactPatch, _: dict = Depends(require_admin)):
    existing = await db.dog_facts.find_one({"id": fact_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Fact not found")
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "text" in update:
        update["text"] = update["text"].strip()[:500]
    if "emoji" in update:
        update["emoji"] = (update["emoji"] or "🐶")[:4]
    if "tag" in update:
        update["tag"] = (update["tag"] or "fun").strip()[:40]
    await db.dog_facts.update_one({"id": fact_id}, {"$set": update})
    existing.update(update)
    return existing


@api.delete("/dog-facts/{fact_id}")
async def delete_dog_fact(fact_id: str, _: dict = Depends(require_admin)):
    res = await db.dog_facts.delete_one({"id": fact_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"ok": True}


class DogFactGenerateIn(BaseModel):
    count: int = Field(default=3, ge=1, le=10)
    style_hint: Optional[str] = ""


@api.post("/dog-facts/generate")
async def generate_dog_facts(body: DogFactGenerateIn, _: dict = Depends(require_admin)):
    """Ask the Emergent LLM to generate fresh facts and stage them as inactive
    so the admin can review before publishing. Uses Claude Haiku — cheap +
    fast for this kind of bite-size text."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="EMERGENT_LLM_KEY not configured")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"emergentintegrations not available: {e}")
    existing = await db.dog_facts.find({}, {"_id": 0, "text": 1}).limit(200).to_list(200)
    recent_sample = " ".join(r["text"][:60] for r in existing[-30:])
    prompt = (
        f"Generate {body.count} short, warm, accurate, family-friendly fun facts about dogs. "
        f"Each one should be ONE sentence, under 200 characters, and DELIGHTFUL to read. "
        f"Avoid duplicating these recent ones: {recent_sample}\n\n"
        f"{('Voice hint: ' + body.style_hint) if body.style_hint else ''}\n"
        f"Output strict JSON: {{\"facts\": [{{\"text\": \"...\", \"tag\": \"anatomy|behavior|breed|health|fun|training|myth-buster\", \"emoji\": \"single emoji\"}}]}}"
    )
    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"dog-facts-{uuid.uuid4().hex[:8]}",
                    system_message="You are a warm, knowledgeable dog enthusiast. Always return strict JSON.")
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    import json as _json
    import re as _re
    raw = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
    m = _re.search(r"\{[\s\S]*\}", raw)
    if not m:
        raise HTTPException(status_code=502, detail="LLM did not return JSON")
    try:
        parsed = _json.loads(m.group(0))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM JSON parse failed: {e}")
    items = parsed.get("facts") or []
    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail="LLM returned no fact list")
    # Stage as inactive so admin reviews before they go live in rotation
    max_sort = await db.dog_facts.find({}, {"_id": 0, "sort_order": 1}).sort("sort_order", -1).to_list(1)
    base = (max_sort[0]["sort_order"] + 1) if max_sort else 0
    docs = []
    for i, it in enumerate(items):
        text = (it.get("text") or "").strip()
        if len(text) < 5:
            continue
        docs.append({
            "id": str(uuid.uuid4()),
            "text": text[:500],
            "tag": (it.get("tag") or "fun").strip()[:40],
            "emoji": (it.get("emoji") or "✨")[:4],
            "active": False,  # staged — admin must approve
            "seeded": False,
            "ai_generated": True,
            "created_at": now_iso(),
            "sort_order": base + i,
        })
    if docs:
        await db.dog_facts.insert_many(docs)
        for d in docs:
            d.pop("_id", None)
    return {"created": len(docs), "facts": docs}


# ─────────────── Sprint 110bp · CSV import for dog facts ───────────────
DOG_FACTS_CSV_NAMESPACE = uuid.UUID("4fd03d11-d164-44c0-bcfc-67614a1b7d5a")
DOG_FACTS_CSV_HEADERS = ["text", "tag", "emoji"]
DOG_FACTS_CSV_TEMPLATE_ROWS = [
    {"text": "Dogs have three eyelids — including a 'haw' that protects the eye.",
     "tag": "anatomy", "emoji": "👁️"},
    {"text": "A dog's nose print is as unique as a human fingerprint.",
     "tag": "fun", "emoji": "🐶"},
]


@api.get("/admin/dog-facts/import-csv/template")
async def dog_facts_import_csv_template(_: dict = Depends(require_admin)):
    """Download a CSV template with two example rows."""
    import io as _io
    buf = _io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=DOG_FACTS_CSV_HEADERS)
    writer.writeheader()
    for row in DOG_FACTS_CSV_TEMPLATE_ROWS:
        writer.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="dog-facts-import-template.csv"'},
    )


@api.post("/admin/dog-facts/import-csv")
async def dog_facts_import_csv(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    """Bulk-import dog facts from a CSV file.

    Required header: text. Optional: tag (default "fun"), emoji (default "🐶").
    Each fact is keyed by uuid5(text) → re-uploading the same row updates
    it (tag/emoji edits) instead of duplicating.
    """
    import io as _io
    raw = await file.read()
    try:
        text_data = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = raw.decode("latin-1", errors="replace")
    reader = csv.DictReader(_io.StringIO(text_data))
    if not reader.fieldnames or "text" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must have a 'text' header column")

    # Find next sort_order so new facts land at the end of the rotation
    max_sort = await db.dog_facts.find({}, {"_id": 0, "sort_order": 1}).sort("sort_order", -1).to_list(1)
    next_sort = (max_sort[0]["sort_order"] + 1) if max_sort else 0

    created = 0
    updated = 0
    skipped: List[dict] = []
    for line_no, row in enumerate(reader, start=2):
        txt = (row.get("text") or "").strip()
        tag = (row.get("tag") or "fun").strip().lower()[:40] or "fun"
        emoji = (row.get("emoji") or "🐶").strip()[:4] or "🐶"
        if not txt:
            skipped.append({"line": line_no, "reason": "empty text"})
            continue
        if len(txt) < 3:
            skipped.append({"line": line_no, "reason": "text too short (<3 chars)"})
            continue
        if len(txt) > 500:
            txt = txt[:500]
        fid = str(uuid.uuid5(DOG_FACTS_CSV_NAMESPACE, txt))
        existing = await db.dog_facts.find_one({"id": fid}, {"_id": 0})
        doc = {
            "id": fid,
            "text": txt,
            "tag": tag,
            "emoji": emoji,
            "active": True,
            "seeded": False,
            "created_at": existing.get("created_at") if existing else now_iso(),
            "sort_order": existing.get("sort_order") if existing else next_sort,
            "curated": True,
        }
        if existing:
            await db.dog_facts.update_one({"id": fid}, {"$set": doc})
            updated += 1
        else:
            await db.dog_facts.insert_one(doc)
            next_sort += 1
            created += 1
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "skipped_count": len(skipped),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Sprint 110bi · Dog Trivia Game (Wordle-style daily question + adaptive quiz)
# Collections:
#   trivia_questions   {id, question, choices[4], correct_index, difficulty, tag, active}
#   trivia_daily       {date, question_id}   one doc per ISO Eastern date
#   trivia_attempts    {client_id, date, question_id, chosen_index, correct, …}
#   trivia_quiz_attempts {client_id, played_at, score, total, ...}
# ─────────────────────────────────────────────────────────────────────────────
TRIVIA_DIFFICULTIES = ("easy", "medium", "hard")
TRIVIA_TAGS = ("breeds", "behavior", "health", "history", "training", "anatomy", "fun", "myth")

# Default streak milestones — the operator can fully replace these via
# /admin/trivia/rewards. Each entry: {days, label, perk_type (informational)}.
DEFAULT_TRIVIA_MILESTONES = [
    {"days": 7,  "label": "🐾 One-week streak — free puzzle toy at pickup!", "perk_type": "puzzle_toy"},
    {"days": 14, "label": "🦴 Two-week streak — $5 retail credit on next checkout.", "perk_type": "retail_credit"},
    {"days": 30, "label": "🏆 30-day master — free upgrade to deluxe service on your next booking.", "perk_type": "service_upgrade"},
]


async def _get_trivia_rewards() -> List[dict]:
    row = await db.app_settings.find_one({"_id": "trivia_rewards"}, {"_id": 0})
    if row and isinstance(row.get("milestones"), list) and row["milestones"]:
        return row["milestones"]
    return list(DEFAULT_TRIVIA_MILESTONES)


class TriviaGenerateIn(BaseModel):
    count: int = Field(default=25, ge=1, le=50)
    difficulty_mix: Optional[str] = None  # "easy,medium,hard" weights, defaults to balanced


async def _ensure_trivia_seeded(min_count: int = 30) -> int:
    """If the question pool is empty (or below `min_count`), kick off an AI
    generation pass so the daily question always has something to pick. Returns
    the current pool size."""
    count = await db.trivia_questions.count_documents({"active": True})
    if count >= min_count:
        return count
    try:
        await _trivia_ai_generate(min_count - count)
    except Exception as e:
        logger.warning("trivia seed failed: %s", e)
    return await db.trivia_questions.count_documents({"active": True})


async def _trivia_ai_generate(count: int, difficulty_mix: Optional[str] = None) -> List[dict]:
    """Call the Emergent LLM key (Claude Sonnet) to generate `count` trivia
    questions and insert them as active. Returns the inserted docs."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="EMERGENT_LLM_KEY not configured")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"emergentintegrations not available: {e}")
    # Recent questions to avoid duplicates
    existing = await db.trivia_questions.find(
        {}, {"_id": 0, "question": 1}
    ).sort("created_at", -1).limit(80).to_list(80)
    recent_sample = " | ".join(r["question"][:70] for r in existing[-40:]) or "(none yet)"
    mix = difficulty_mix or "balanced — roughly 40% easy, 40% medium, 20% hard"
    prompt = (
        f"Generate {count} fun, accurate, family-friendly DOG trivia questions for a dog "
        f"daycare's client portal. Each question must be ONE multiple-choice question with "
        f"EXACTLY 4 answer choices. Topics: {', '.join(TRIVIA_TAGS)}. Difficulty mix: {mix}. "
        f"AVOID duplicating these recent questions: {recent_sample}\n\n"
        f"Constraints:\n"
        f"- question ≤ 130 chars\n"
        f"- each choice ≤ 60 chars, plausible distractors (no obvious throwaway)\n"
        f"- correct_index is 0-3\n"
        f"- difficulty: \"easy\" | \"medium\" | \"hard\"\n"
        f"- tag: one of {list(TRIVIA_TAGS)}\n"
        f"- no breed bias, no medical-advice questions that could be misread\n\n"
        f"Return strict JSON: {{\"questions\":[{{\"question\":\"...\",\"choices\":[\"a\",\"b\",\"c\",\"d\"],"
        f"\"correct_index\":0,\"difficulty\":\"easy\",\"tag\":\"breeds\"}}]}}"
    )
    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"trivia-{uuid.uuid4().hex[:8]}",
                    system_message=(
                        "You are a warm, knowledgeable canine educator writing kid-safe "
                        "trivia for a dog daycare's family portal. Always return STRICT JSON only."
                    ))
            .with_model("anthropic", "claude-sonnet-4-6")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    import json as _json
    import re as _re
    raw = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
    m = _re.search(r"\{[\s\S]*\}", raw)
    if not m:
        raise HTTPException(status_code=502, detail="LLM did not return JSON")
    try:
        parsed = _json.loads(m.group(0))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM JSON parse failed: {e}")
    items = parsed.get("questions") or []
    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail="LLM returned no question list")
    docs: List[dict] = []
    for it in items:
        q = (it.get("question") or "").strip()
        choices = it.get("choices") or []
        ci = it.get("correct_index")
        diff = (it.get("difficulty") or "medium").strip().lower()
        tag = (it.get("tag") or "fun").strip().lower()
        if not q or not isinstance(choices, list) or len(choices) != 4:
            continue
        if not isinstance(ci, int) or ci < 0 or ci > 3:
            continue
        if diff not in TRIVIA_DIFFICULTIES:
            diff = "medium"
        if tag not in TRIVIA_TAGS:
            tag = "fun"
        docs.append({
            "id": str(uuid.uuid4()),
            "question": q[:200],
            "choices": [str(c)[:80] for c in choices],
            "correct_index": ci,
            "difficulty": diff,
            "tag": tag,
            "source": "ai",
            "active": True,
            "created_at": now_iso(),
            "times_used": 0,
        })
    if docs:
        await db.trivia_questions.insert_many(docs)
        for d in docs:
            d.pop("_id", None)
    return docs


async def _get_or_create_today_question(date_str: str) -> Optional[dict]:
    """Idempotently pick today's daily question. Same question for every client
    on the same date (Wordle-style)."""
    row = await db.trivia_daily.find_one({"date": date_str}, {"_id": 0})
    qid = row["question_id"] if row else None
    if qid:
        q = await db.trivia_questions.find_one({"id": qid, "active": True}, {"_id": 0})
        if q:
            return q
        # Active flag flipped — pick a new one
    # Make sure we have questions to choose from
    await _ensure_trivia_seeded(min_count=30)
    # Prefer least-recently-used question to spread variety
    candidates = await db.trivia_questions.find(
        {"active": True}, {"_id": 0}
    ).sort([("times_used", 1), ("created_at", 1)]).limit(20).to_list(20)
    if not candidates:
        return None
    # Pick deterministically by hashing date — so the same date always picks
    # the same question if the candidate pool order changes.
    import hashlib
    idx = int(hashlib.sha256(date_str.encode("utf-8")).hexdigest(), 16) % len(candidates)
    pick = candidates[idx]
    await db.trivia_daily.update_one(
        {"date": date_str}, {"$set": {"date": date_str, "question_id": pick["id"]}},
        upsert=True,
    )
    await db.trivia_questions.update_one(
        {"id": pick["id"]}, {"$inc": {"times_used": 1}}
    )
    return pick


async def _compute_streak(client_id: str, today_d: date) -> Dict[str, int]:
    """Return current_streak / best_streak / total_correct for a client.
    Streak counts consecutive prior days the client answered correctly,
    INCLUDING today if answered correctly. Missing today (not yet played)
    does NOT break the streak — it just hasn't been extended yet."""
    rows = await db.trivia_attempts.find(
        {"client_id": client_id}, {"_id": 0, "date": 1, "correct": 1}
    ).sort("date", -1).to_list(2000)
    total_correct = sum(1 for r in rows if r.get("correct"))
    # Current streak: walk backwards from today/yesterday
    by_date = {r["date"]: bool(r.get("correct")) for r in rows}
    current = 0
    d = today_d
    # If today not yet played, start checking from yesterday so absence today
    # doesn't kill the streak
    if d.isoformat() not in by_date:
        d = d - timedelta(days=1)
    while d.isoformat() in by_date:
        if not by_date[d.isoformat()]:
            break
        current += 1
        d = d - timedelta(days=1)
    # Best streak: scan all attempts in date order
    sorted_dates = sorted(by_date.keys())
    best = 0
    run = 0
    prev_d = None
    for ds in sorted_dates:
        if not by_date[ds]:
            run = 0
            prev_d = None
            continue
        if prev_d is None:
            run = 1
        else:
            try:
                gap = (date.fromisoformat(ds) - prev_d).days
                run = run + 1 if gap == 1 else 1
            except Exception:
                run = 1
        best = max(best, run)
        try:
            prev_d = date.fromisoformat(ds)
        except Exception:
            prev_d = None
    return {
        "current_streak": current,
        "best_streak": max(best, current),
        "total_correct": total_correct,
    }


def _strip_correct(q: dict) -> dict:
    """Sanitize a question for portal clients — never leak correct_index."""
    return {
        "id": q["id"],
        "question": q["question"],
        "choices": q["choices"],
        "difficulty": q.get("difficulty"),
        "tag": q.get("tag"),
    }


@api.get("/portal/trivia/daily")
async def portal_trivia_daily(user: dict = Depends(get_current_user)):
    cid = await _require_client_with_record(user)
    today_d = business_today()
    date_str = today_d.isoformat()
    q = await _get_or_create_today_question(date_str)
    if not q:
        raise HTTPException(status_code=503, detail="No trivia questions available yet")
    prior = await db.trivia_attempts.find_one(
        {"client_id": cid, "date": date_str}, {"_id": 0}
    )
    stats = await _compute_streak(cid, today_d)
    out = {
        "date": date_str,
        "question": _strip_correct(q),
        "already_answered": bool(prior),
        **stats,
    }
    if prior:
        # Reveal result + correct answer once they've answered
        out["was_correct"] = bool(prior.get("correct"))
        out["chosen_index"] = prior.get("chosen_index")
        out["correct_index"] = q["correct_index"]
    return out


class TriviaAnswerIn(BaseModel):
    question_id: str
    chosen_index: int = Field(ge=0, le=3)


@api.post("/portal/trivia/daily/answer")
async def portal_trivia_daily_answer(
    body: TriviaAnswerIn,
    user: dict = Depends(get_current_user),
):
    cid = await _require_client_with_record(user)
    today_d = business_today()
    date_str = today_d.isoformat()
    q = await _get_or_create_today_question(date_str)
    if not q or q["id"] != body.question_id:
        raise HTTPException(status_code=400, detail="Wrong question for today")
    prior = await db.trivia_attempts.find_one({"client_id": cid, "date": date_str}, {"_id": 0})
    if prior:
        raise HTTPException(status_code=409, detail="Already answered today")
    correct = (body.chosen_index == q["correct_index"])
    await db.trivia_attempts.insert_one({
        "id": str(uuid.uuid4()),
        "client_id": cid,
        "date": date_str,
        "question_id": q["id"],
        "chosen_index": body.chosen_index,
        "correct": correct,
        "answered_at": now_iso(),
    })
    stats = await _compute_streak(cid, today_d)
    milestone = None
    if correct:
        rewards = await _get_trivia_rewards()
        match = next((r for r in rewards if int(r.get("days") or 0) == stats["current_streak"]), None)
        if match:
            milestone = {
                "days": stats["current_streak"],
                "label": match.get("label") or f"🎉 {stats['current_streak']}-day streak!",
                "perk_type": match.get("perk_type") or "",
            }
            # Stamp the milestone so admin can spot it in client record
            await db.clients.update_one(
                {"id": cid},
                {"$push": {"trivia_milestones": {
                    "days": stats["current_streak"],
                    "earned_on": date_str,
                    "label": milestone["label"],
                    "perk_type": milestone["perk_type"],
                }}},
            )
    return {
        "correct": correct,
        "correct_index": q["correct_index"],
        "current_streak": stats["current_streak"],
        "best_streak": stats["best_streak"],
        "total_correct": stats["total_correct"],
        "milestone": milestone,
    }


@api.get("/portal/trivia/leaderboard")
async def portal_trivia_leaderboard(user: dict = Depends(get_current_user)):
    cid = await _require_client_with_record(user)
    today_d = business_today()
    # Compute streak/total for every client who has answered at least once.
    attempts = await db.trivia_attempts.find(
        {}, {"_id": 0, "client_id": 1, "date": 1, "correct": 1}
    ).to_list(50000)
    by_client: Dict[str, List[dict]] = {}
    for a in attempts:
        by_client.setdefault(a["client_id"], []).append(a)
    rows = []
    for cli, atts in by_client.items():
        # Build {date: correct?} for this client
        by_date = {a["date"]: bool(a.get("correct")) for a in atts}
        total = sum(1 for v in by_date.values() if v)
        # Current streak
        d = today_d
        if d.isoformat() not in by_date:
            d = d - timedelta(days=1)
        cur = 0
        while d.isoformat() in by_date and by_date[d.isoformat()]:
            cur += 1
            d = d - timedelta(days=1)
        # Best streak
        srt = sorted(by_date.keys())
        best = 0; run = 0; prev = None
        for ds in srt:
            if not by_date[ds]:
                run = 0; prev = None; continue
            if prev is None: run = 1
            else:
                try: run = run + 1 if (date.fromisoformat(ds) - prev).days == 1 else 1
                except Exception: run = 1
            best = max(best, run)
            try: prev = date.fromisoformat(ds)
            except Exception: prev = None
        rows.append({
            "client_id": cli,
            "current_streak": cur,
            "best_streak": max(best, cur),
            "total_correct": total,
        })
    # Attach dog name(s) (anonymized — first names only)
    if rows:
        cids = [r["client_id"] for r in rows]
        clients = await db.clients.find(
            {"id": {"$in": cids}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(len(cids))
        cmap = {c["id"]: (c.get("name") or "Anonymous").split(" ")[0] for c in clients}
        dogs = await db.dogs.find(
            {"client_id": {"$in": cids}, "$or": [{"deleted": {"$ne": True}}, {"deleted": {"$exists": False}}]},
            {"_id": 0, "client_id": 1, "name": 1},
        ).to_list(2000)
        dmap: Dict[str, List[str]] = {}
        for d_ in dogs:
            dmap.setdefault(d_["client_id"], []).append(d_.get("name") or "")
        for r in rows:
            r["display_name"] = cmap.get(r["client_id"], "Player")
            r["dogs"] = [n for n in dmap.get(r["client_id"], []) if n][:3]
            r["is_me"] = (r["client_id"] == cid)
    # Rank by current_streak, then best_streak, then total_correct
    rows.sort(key=lambda r: (-r["current_streak"], -r["best_streak"], -r["total_correct"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    top10 = rows[:10]
    me = next((r for r in rows if r.get("is_me")), None)
    return {"top": top10, "me": me, "total_players": len(rows)}


@api.get("/portal/trivia/quiz")
async def portal_trivia_quiz(
    count: int = 5,
    user: dict = Depends(get_current_user),
):
    """Adaptive quiz: starts easy and ramps to hard. Excludes today's daily
    question. Returns choices stripped of correct_index."""
    await _require_client_with_record(user)
    count = max(1, min(int(count), 10))
    today_d = business_today()
    daily = await db.trivia_daily.find_one({"date": today_d.isoformat()}, {"_id": 0})
    exclude_id = daily.get("question_id") if daily else None
    # Adaptive ladder: easy → medium → hard
    ladder: List[str] = []
    for i in range(count):
        pct = i / max(1, count - 1)
        if pct < 0.4:
            ladder.append("easy")
        elif pct < 0.75:
            ladder.append("medium")
        else:
            ladder.append("hard")
    out: List[dict] = []
    used_ids: set = set()
    if exclude_id:
        used_ids.add(exclude_id)
    for diff in ladder:
        # Try the requested difficulty first, fall back to any
        for filt in (
            {"active": True, "difficulty": diff, "id": {"$nin": list(used_ids)}},
            {"active": True, "id": {"$nin": list(used_ids)}},
        ):
            pool = await db.trivia_questions.find(filt, {"_id": 0}).limit(50).to_list(50)
            if pool:
                import random as _r
                q = _r.choice(pool)
                out.append(_strip_correct(q))
                used_ids.add(q["id"])
                break
    return {"questions": out}


@api.post("/portal/trivia/quiz/answer")
async def portal_trivia_quiz_answer(
    body: TriviaAnswerIn,
    user: dict = Depends(get_current_user),
):
    """Reveals the correct answer without writing to attempts (quiz-mode is
    just for fun — only the daily question affects the streak)."""
    await _require_client_with_record(user)
    q = await db.trivia_questions.find_one(
        {"id": body.question_id, "active": True}, {"_id": 0, "correct_index": 1},
    )
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return {
        "correct": body.chosen_index == q["correct_index"],
        "correct_index": q["correct_index"],
    }


# ── Admin trivia management ──
@api.get("/admin/trivia/rewards")
async def admin_trivia_rewards_get(_: dict = Depends(require_admin)):
    return {
        "milestones": await _get_trivia_rewards(),
        "defaults": list(DEFAULT_TRIVIA_MILESTONES),
    }


class TriviaRewardsIn(BaseModel):
    milestones: List[Dict[str, Any]]


@api.put("/admin/trivia/rewards")
async def admin_trivia_rewards_put(
    body: TriviaRewardsIn, _: dict = Depends(require_admin),
):
    # Validate + normalize. Each milestone needs days (int) + label (str).
    cleaned: List[dict] = []
    seen_days: set = set()
    for m in body.milestones:
        try:
            days = int(m.get("days") or 0)
        except Exception:
            continue
        label = (m.get("label") or "").strip()
        if days <= 0 or days > 3650 or not label:
            continue
        if days in seen_days:
            continue  # de-dupe
        seen_days.add(days)
        cleaned.append({
            "days": days,
            "label": label[:200],
            "perk_type": (m.get("perk_type") or "").strip()[:50],
        })
    cleaned.sort(key=lambda x: x["days"])
    await db.app_settings.update_one(
        {"_id": "trivia_rewards"},
        {"$set": {"milestones": cleaned}},
        upsert=True,
    )
    return {"milestones": cleaned}


@api.get("/admin/trivia/leaderboard")
async def admin_trivia_leaderboard(_: dict = Depends(require_admin)):
    """Full leaderboard for admin — same math as the client-facing one, but
    every player (not just top-10), full client names, dog names, last-played
    date, and the list of streak milestones earned so the admin can award
    perks at next checkout."""
    today_d = business_today()
    attempts = await db.trivia_attempts.find(
        {}, {"_id": 0, "client_id": 1, "date": 1, "correct": 1}
    ).to_list(50000)
    if not attempts:
        return {"players": [], "total_players": 0, "total_attempts": 0,
                "pending_milestones": []}
    by_client: Dict[str, List[dict]] = {}
    for a in attempts:
        by_client.setdefault(a["client_id"], []).append(a)
    rows = []
    for cli, atts in by_client.items():
        by_date = {a["date"]: bool(a.get("correct")) for a in atts}
        total_attempts = len(atts)
        total_correct = sum(1 for v in by_date.values() if v)
        # current streak
        d = today_d
        if d.isoformat() not in by_date:
            d = d - timedelta(days=1)
        cur = 0
        while d.isoformat() in by_date and by_date[d.isoformat()]:
            cur += 1
            d = d - timedelta(days=1)
        # best streak
        srt = sorted(by_date.keys())
        best = 0; run = 0; prev = None
        for ds in srt:
            if not by_date[ds]:
                run = 0; prev = None; continue
            if prev is None:
                run = 1
            else:
                try: run = run + 1 if (date.fromisoformat(ds) - prev).days == 1 else 1
                except Exception: run = 1
            best = max(best, run)
            try: prev = date.fromisoformat(ds)
            except Exception: prev = None
        last_played = max(by_date.keys())
        rows.append({
            "client_id": cli,
            "current_streak": cur,
            "best_streak": max(best, cur),
            "total_correct": total_correct,
            "total_attempts": total_attempts,
            "accuracy_pct": round((total_correct / total_attempts) * 100, 1) if total_attempts else 0.0,
            "last_played": last_played,
        })
    # Attach FULL client name + email + dogs + earned milestones
    cids = [r["client_id"] for r in rows]
    clients = await db.clients.find(
        {"id": {"$in": cids}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "trivia_milestones": 1},
    ).to_list(len(cids))
    cmap = {c["id"]: c for c in clients}
    dogs = await db.dogs.find(
        {"client_id": {"$in": cids},
         "$or": [{"deleted": {"$ne": True}}, {"deleted": {"$exists": False}}]},
        {"_id": 0, "client_id": 1, "name": 1},
    ).to_list(5000)
    dmap: Dict[str, List[str]] = {}
    for d_ in dogs:
        dmap.setdefault(d_["client_id"], []).append(d_.get("name") or "")
    for r in rows:
        c = cmap.get(r["client_id"], {})
        r["name"] = c.get("name") or "Unknown"
        r["email"] = c.get("email") or ""
        r["phone"] = c.get("phone") or ""
        r["dogs"] = [n for n in dmap.get(r["client_id"], []) if n]
        r["milestones"] = c.get("trivia_milestones") or []  # [{days,earned_on}]
    rows.sort(key=lambda r: (-r["current_streak"], -r["best_streak"], -r["total_correct"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    # Pending perks: any milestones earned but not yet marked redeemed
    pending = []
    for r in rows:
        for m in r["milestones"]:
            if not m.get("redeemed_at"):
                pending.append({
                    "client_id": r["client_id"],
                    "client_name": r["name"],
                    "dogs": r["dogs"],
                    "days": m.get("days"),
                    "earned_on": m.get("earned_on"),
                })
    pending.sort(key=lambda x: x.get("earned_on") or "")
    return {
        "players": rows,
        "total_players": len(rows),
        "total_attempts": sum(r["total_attempts"] for r in rows),
        "pending_milestones": pending,
    }


class TriviaMilestoneRedeemIn(BaseModel):
    client_id: str
    days: int
    earned_on: str


@api.post("/admin/trivia/milestones/redeem")
async def admin_trivia_redeem_milestone(
    body: TriviaMilestoneRedeemIn,
    admin: dict = Depends(require_admin),
):
    """Mark a streak-milestone perk as redeemed (operator just applied the
    free puzzle toy / retail credit / service upgrade at checkout)."""
    res = await db.clients.update_one(
        {"id": body.client_id, "trivia_milestones": {"$elemMatch": {
            "days": body.days, "earned_on": body.earned_on,
        }}},
        {"$set": {
            "trivia_milestones.$.redeemed_at": now_iso(),
            "trivia_milestones.$.redeemed_by": admin["id"],
        }},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return {"ok": True}


@api.get("/admin/trivia/questions")
async def admin_trivia_list(_: dict = Depends(require_admin)):
    rows = await db.trivia_questions.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    active = sum(1 for r in rows if r.get("active", True))
    return {"questions": rows, "active": active, "total": len(rows)}


class TriviaQuestionIn(BaseModel):
    question: str
    choices: List[str]
    correct_index: int = Field(ge=0, le=3)
    difficulty: str = "medium"
    tag: str = "fun"
    active: bool = True


def _validate_trivia_in(body: TriviaQuestionIn) -> dict:
    q = (body.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Question text is required")
    if len(body.choices) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 choices required")
    cleaned_choices = [str(c).strip() for c in body.choices]
    if any(not c for c in cleaned_choices):
        raise HTTPException(status_code=400, detail="All 4 choices must be filled in")
    if len({c.lower() for c in cleaned_choices}) != 4:
        raise HTTPException(status_code=400, detail="Choices must be unique")
    diff = (body.difficulty or "medium").strip().lower()
    if diff not in TRIVIA_DIFFICULTIES:
        diff = "medium"
    tag = (body.tag or "fun").strip().lower()
    if tag not in TRIVIA_TAGS:
        tag = "fun"
    return {
        "question": q[:200],
        "choices": [c[:80] for c in cleaned_choices],
        "correct_index": int(body.correct_index),
        "difficulty": diff,
        "tag": tag,
    }


@api.post("/admin/trivia/questions")
async def admin_trivia_create(
    body: TriviaQuestionIn, _: dict = Depends(require_admin),
):
    """Operator-authored trivia question. Same shape as AI-generated, but
    marked `source: "manual"` so it's distinguishable in the admin list."""
    payload = _validate_trivia_in(body)
    doc = {
        "id": str(uuid.uuid4()),
        **payload,
        "source": "manual",
        "active": bool(body.active),
        "created_at": now_iso(),
        "times_used": 0,
    }
    await db.trivia_questions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/admin/trivia/questions/{qid}")
async def admin_trivia_update(
    qid: str, body: TriviaQuestionIn, _: dict = Depends(require_admin),
):
    """Full edit of an existing question (typo fixes, better distractors, etc.)."""
    payload = _validate_trivia_in(body)
    res = await db.trivia_questions.update_one(
        {"id": qid}, {"$set": {**payload, "active": bool(body.active)}}
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Question not found")
    return await db.trivia_questions.find_one({"id": qid}, {"_id": 0})


@api.post("/admin/trivia/generate")
async def admin_trivia_generate(
    body: TriviaGenerateIn,
    _: dict = Depends(require_admin),
):
    docs = await _trivia_ai_generate(body.count, body.difficulty_mix)
    return {"created": len(docs), "questions": docs}


@api.delete("/admin/trivia/questions/{qid}")
async def admin_trivia_delete(qid: str, _: dict = Depends(require_admin)):
    res = await db.trivia_questions.delete_one({"id": qid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"ok": True}


@api.put("/admin/trivia/questions/{qid}/active")
async def admin_trivia_toggle_active(
    qid: str, body: Dict[str, bool] = Body(...),
    _: dict = Depends(require_admin),
):
    active = bool(body.get("active", True))
    res = await db.trivia_questions.update_one({"id": qid}, {"$set": {"active": active}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"ok": True, "active": active}


# ─────────────── Sprint 110bp · CSV import for trivia questions ───────────────
# Bulk-load operator-written questions from a spreadsheet. Idempotent: each
# row is keyed by uuid5(question_text) so re-uploading the same CSV updates
# rather than duplicates.

TRIVIA_CSV_NAMESPACE = uuid.UUID("5e8e4dac-aaaa-4111-9999-547269766961")
TRIVIA_CSV_HEADERS = [
    "question", "choice_a", "choice_b", "choice_c", "choice_d",
    "correct_letter", "difficulty", "tag",
]
TRIVIA_CSV_TEMPLATE_ROWS = [
    {
        "question": "Which dog breed is famously known for its distinct black spots on a white coat?",
        "choice_a": "Dalmatian", "choice_b": "Great Dane",
        "choice_c": "Border Collie", "choice_d": "Boxer",
        "correct_letter": "A", "difficulty": "easy", "tag": "breeds",
    },
    {
        "question": "What is the technical name for the moisture-retaining skin that covers a dog's nose?",
        "choice_a": "Tapetum", "choice_b": "Rhinarium",
        "choice_c": "Vibrissae", "choice_d": "Philtrum",
        "correct_letter": "B", "difficulty": "medium", "tag": "anatomy",
    },
]


@api.get("/admin/trivia/import-csv/template")
async def trivia_import_csv_template(_: dict = Depends(require_admin)):
    """Download a CSV template with two example rows."""
    import io as _io
    buf = _io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=TRIVIA_CSV_HEADERS)
    writer.writeheader()
    for row in TRIVIA_CSV_TEMPLATE_ROWS:
        writer.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="trivia-import-template.csv"'},
    )


@api.post("/admin/trivia/import-csv")
async def trivia_import_csv(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    """Bulk-import trivia questions from a CSV file.

    Required headers: question, choice_a..d, correct_letter (A/B/C/D),
    difficulty (easy/medium/hard), tag (breeds/behavior/health/history/
    anatomy/training/fun/myth).

    Rows with missing/invalid data are skipped and reported back to the caller.
    Each question is keyed by uuid5(question_text) → re-uploading updates
    instead of duplicating.
    """
    import io as _io
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")  # handle Excel's BOM
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    reader = csv.DictReader(_io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no headers")
    missing = [h for h in TRIVIA_CSV_HEADERS if h not in reader.fieldnames]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required headers: {', '.join(missing)}",
        )

    created = 0
    updated = 0
    skipped: List[dict] = []
    for line_no, row in enumerate(reader, start=2):  # row 1 is the header
        q = (row.get("question") or "").strip()
        choices = [
            (row.get("choice_a") or "").strip(),
            (row.get("choice_b") or "").strip(),
            (row.get("choice_c") or "").strip(),
            (row.get("choice_d") or "").strip(),
        ]
        letter = (row.get("correct_letter") or "").strip().upper()
        diff = (row.get("difficulty") or "medium").strip().lower()
        tag = (row.get("tag") or "fun").strip().lower()

        if not q:
            skipped.append({"line": line_no, "reason": "empty question"})
            continue
        if any(not c for c in choices):
            skipped.append({"line": line_no, "reason": "all 4 choices required"})
            continue
        if letter not in {"A", "B", "C", "D"}:
            skipped.append({"line": line_no, "reason": "correct_letter must be A/B/C/D"})
            continue
        if len({c.lower() for c in choices}) != 4:
            skipped.append({"line": line_no, "reason": "choices must be unique"})
            continue
        if diff not in TRIVIA_DIFFICULTIES:
            diff = "medium"
        if tag not in TRIVIA_TAGS:
            tag = "fun"
        ci = "ABCD".index(letter)
        qid = str(uuid.uuid5(TRIVIA_CSV_NAMESPACE, q))
        doc = {
            "id": qid,
            "question": q[:200],
            "choices": [c[:80] for c in choices],
            "correct_index": ci,
            "difficulty": diff,
            "tag": tag,
            "source": "manual",
            "active": True,
            "curated": True,
            "created_at": now_iso(),
            "times_used": 0,
        }
        existing = await db.trivia_questions.find_one({"id": qid}, {"_id": 0})
        if existing:
            doc["times_used"] = existing.get("times_used", 0)
            doc["created_at"] = existing.get("created_at", doc["created_at"])
            await db.trivia_questions.update_one({"id": qid}, {"$set": doc})
            updated += 1
        else:
            await db.trivia_questions.insert_one(doc)
            created += 1
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "skipped_count": len(skipped),
    }


# ─────────────── Sprint 110aw · Sales tax collected report ───────────────
# Year-to-date / arbitrary-window tax tally for sales-tax filing. Combines
# booking-level `tax_amount` and retail-level `tax_amount`.

@api.get("/admin/sales-tax/summary")
async def sales_tax_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """Return tax collected in the window. Defaults to current calendar year.
    Splits booking-tax vs retail-tax + breakdown by month."""
    today = business_today()
    sd = start_date or f"{today.year}-01-01"
    ed = end_date or today.isoformat()
    # Booking-level tax
    bk_rows = await db.bookings.find(
        {
            "date": {"$gte": sd, "$lte": ed},
            "tax_amount": {"$exists": True, "$gt": 0},
            "status": {"$in": ["completed", "approved"]},
        },
        {"_id": 0, "id": 1, "date": 1, "service_type": 1, "actual_price": 1, "tax_amount": 1, "tax_rate_pct": 1, "client_name": 1, "dog_name": 1},
    ).to_list(10000)
    rt_rows = await db.retail_sales.find(
        {"date": {"$gte": sd, "$lte": ed}, "tax_amount": {"$exists": True, "$gt": 0}},
        {"_id": 0, "id": 1, "date": 1, "description": 1, "amount": 1, "tax_amount": 1, "tax_rate_pct": 1, "client_name": 1},
    ).to_list(10000)
    bk_total = round(sum(float(r.get("tax_amount") or 0) for r in bk_rows), 2)
    rt_total = round(sum(float(r.get("tax_amount") or 0) for r in rt_rows), 2)
    # Month breakdown
    by_month: Dict[str, Dict[str, float]] = {}
    for r in bk_rows:
        ym = (r.get("date") or "")[:7]
        slot = by_month.setdefault(ym, {"bookings": 0.0, "retail": 0.0})
        slot["bookings"] += float(r.get("tax_amount") or 0)
    for r in rt_rows:
        ym = (r.get("date") or "")[:7]
        slot = by_month.setdefault(ym, {"bookings": 0.0, "retail": 0.0})
        slot["retail"] += float(r.get("tax_amount") or 0)
    months = [
        {"month": k, "bookings_tax": round(v["bookings"], 2),
         "retail_tax": round(v["retail"], 2),
         "total_tax": round(v["bookings"] + v["retail"], 2)}
        for k, v in sorted(by_month.items())
    ]
    return {
        "start_date": sd,
        "end_date": ed,
        "bookings_tax_total": bk_total,
        "retail_tax_total": rt_total,
        "total_tax_collected": round(bk_total + rt_total, 2),
        "booking_count": len(bk_rows),
        "retail_count": len(rt_rows),
        "by_month": months,
    }


# ─────────────── Sprint 110aw · Year-end payroll export (1099/W2 prep) ───────────────
# Single endpoint returning a CSV that an accountant / QuickBooks / Gusto can
# ingest. Per-employee: name, email, total hours, gross wages (rate × hours)
# for the requested calendar year. Optionally includes a per-employee detail
# section breaking out each clocked entry.
from fastapi.responses import StreamingResponse
import io
import csv


@api.get("/admin/payroll/year-end.csv")
async def payroll_year_end_csv(
    year: Optional[int] = None,
    detail: bool = False,
    _: dict = Depends(require_admin),
):
    """Year-end gross-wages CSV. Pass `?detail=true` to also dump every
    clocked-in/out entry for the year (handy for 1099/W2 reconciliation)."""
    y = int(year or business_today().year)
    start_iso = f"{y}-01-01T00:00:00"
    end_iso = f"{y + 1}-01-01T00:00:00"
    # All clocked-in entries with a clock-out in the year
    entries = await db.time_clock_entries.find(
        {
            "clock_in_at": {"$gte": start_iso, "$lt": end_iso},
            "clock_out_at": {"$ne": None, "$exists": True},
        },
        {"_id": 0},
    ).to_list(10000)
    uids = list({e["user_id"] for e in entries if e.get("user_id")})
    users = await db.users.find(
        {"id": {"$in": uids}},
        {
            "_id": 0, "id": 1, "name": 1, "display_name": 1, "email": 1,
            "phone": 1, "hourly_rate": 1, "active": 1, "is_owner": 1,
            "tax_status": 1, "address_street": 1, "address_city": 1,
            "address_state": 1, "address_zip": 1,
        },
    ).to_list(500) if uids else []
    # Sprint 110bf — sole-prop owner does NOT get a 1099/W2; their pay is a draw
    user_by_id = {u["id"]: u for u in users if not u.get("is_owner")}

    # Aggregate per-employee
    per_user: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        uid = e.get("user_id")
        if not uid:
            continue
        if uid not in user_by_id:
            # Owner (filtered above) or deleted user — skip from 1099/W2 export.
            continue
        try:
            t_in = datetime.fromisoformat((e["clock_in_at"] or "").replace("Z", "+00:00"))
            t_out = datetime.fromisoformat((e["clock_out_at"] or "").replace("Z", "+00:00"))
            hrs = max(0.0, (t_out - t_in).total_seconds() / 3600.0)
        except Exception:
            hrs = 0.0
        row = per_user.setdefault(uid, {"hours": 0.0, "gross": 0.0, "entries": 0})
        u = user_by_id.get(uid, {})
        rate = float(u.get("hourly_rate") or 0)
        row["hours"] += hrs
        row["gross"] += hrs * rate
        row["entries"] += 1

    # Sprint 110bu — group by tax_status so the CPA sees W-2 / 1099 / other
    # separately, each with its own sub-total.
    GROUP_ORDER = [
        ("w2",    "W-2 EMPLOYEES",         "Issue W-2 by Jan 31"),
        ("1099",  "1099-NEC CONTRACTORS",  "Issue 1099-NEC if total ≥ $600"),
        ("other", "OTHER / UNCLASSIFIED",  "Set tax_status in Staff → Edit before filing"),
    ]
    grouped: Dict[str, List[str]] = {k: [] for k, _, _ in GROUP_ORDER}
    for uid in per_user.keys():
        u = user_by_id.get(uid, {})
        status = (u.get("tax_status") or "1099").lower()
        if status not in grouped:
            status = "other"
        grouped[status].append(uid)

    # Build the CSV
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"Year-end payroll summary — {y}"])
    w.writerow([])

    grand_hours = 0.0
    grand_gross = 0.0
    grand_entries = 0
    for status_code, label, hint in GROUP_ORDER:
        uids_in_group = grouped[status_code]
        if not uids_in_group:
            continue
        w.writerow([label, hint])
        w.writerow([
            "Employee", "Email", "Phone", "Street", "City", "State", "Zip",
            "Hourly rate", "Active", "Total hours", "Gross wages (USD)",
            "Clocked entries",
        ])
        sub_hours = 0.0
        sub_gross = 0.0
        sub_entries = 0
        for uid in sorted(uids_in_group,
                          key=lambda i: (user_by_id.get(i, {}).get("name") or "").lower()):
            u = user_by_id.get(uid, {})
            agg = per_user[uid]
            w.writerow([
                u.get("display_name") or u.get("name") or "(unknown)",
                u.get("email", ""),
                u.get("phone", ""),
                u.get("address_street", ""),
                u.get("address_city", ""),
                u.get("address_state", ""),
                u.get("address_zip", ""),
                f"{float(u.get('hourly_rate') or 0):.2f}",
                "Yes" if u.get("active", True) else "No",
                f"{agg['hours']:.2f}",
                f"{agg['gross']:.2f}",
                agg["entries"],
            ])
            sub_hours += agg["hours"]
            sub_gross += agg["gross"]
            sub_entries += agg["entries"]
        w.writerow([
            f"  Subtotal — {label}", "", "", "", "", "", "", "", "",
            f"{sub_hours:.2f}", f"{sub_gross:.2f}", sub_entries,
        ])
        w.writerow([])
        grand_hours += sub_hours
        grand_gross += sub_gross
        grand_entries += sub_entries

    w.writerow([
        "GRAND TOTAL", "", "", "", "", "", "", "", "",
        f"{grand_hours:.2f}", f"{grand_gross:.2f}", grand_entries,
    ])

    if detail and entries:
        w.writerow([])
        w.writerow(["DETAIL — every clocked entry"])
        w.writerow(["Employee", "Clock-in", "Clock-out", "Hours", "Rate", "Gross"])
        for e in sorted(entries, key=lambda r: (r.get("user_id"), r.get("clock_in_at") or "")):
            if e.get("user_id") not in user_by_id:
                continue
            u = user_by_id.get(e.get("user_id"), {})
            try:
                t_in = datetime.fromisoformat((e["clock_in_at"] or "").replace("Z", "+00:00"))
                t_out = datetime.fromisoformat((e["clock_out_at"] or "").replace("Z", "+00:00"))
                hrs = max(0.0, (t_out - t_in).total_seconds() / 3600.0)
            except Exception:
                hrs = 0.0
            rate = float(u.get("hourly_rate") or 0)
            w.writerow([
                u.get("display_name") or u.get("name") or "(unknown)",
                e.get("clock_in_at", ""),
                e.get("clock_out_at", ""),
                f"{hrs:.2f}",
                f"{rate:.2f}",
                f"{hrs * rate:.2f}",
            ])

    buf.seek(0)
    fname = f"sit-happens-payroll-{y}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# Sprint 110o — Auto-backup feature removed (never worked reliably across the
# unprivileged Docker container ↔ Bazzite host boundary). Admin uses manual
# Download Backup / Restore and the host-side rclone systemd timer instead.



# -------- User credential migration (admin-only) --------
# Use this when moving an instance to a new host and you want clients to keep
# their existing passwords (bcrypt hashes are portable as long as both ends use
# the same bcrypt implementation, which they do).
#
# Flow:
#   1. Admin hits GET  /api/admin/users/export-with-hashes on the SOURCE instance
#      → downloads a JSON file containing { users: [ {id, email, name, role, client_id, password_hash, ...} ] }
#   2. Admin hits POST /api/admin/users/import-with-hashes on the TARGET instance
#      → uploads that JSON. Existing users (by email) are updated, new ones inserted.
#
# Security: requires admin auth on both ends. The hash itself is not the
# password — it's already what the DB stores; exposing it is equivalent to
# stealing the DB file, which the admin can already do.
class UserImportIn(BaseModel):
    users: List[Dict[str, Any]]
    mode: str = "merge"  # "merge" = upsert by email; "replace_clients_only" = also wipe non-admin users first


@api.get("/admin/users/export-with-hashes")
async def admin_users_export_with_hashes(_: dict = Depends(require_admin)):
    """Export every user record INCLUDING password_hash. Admin-only.
    Use this to migrate logins between hosts so clients keep their passwords."""
    users = await db.users.find({}, {"_id": 0}).to_list(5000)
    return {
        "version": BACKUP_VERSION,
        "exported_at": now_iso(),
        "user_count": len(users),
        "users": users,
    }


@api.post("/admin/users/import-with-hashes")
async def admin_users_import_with_hashes(body: UserImportIn, current: dict = Depends(require_admin)):
    """Import users (with hashes) from an export-with-hashes dump.
    Safety: never touches the calling admin's own user record. Existing users
    with the same email are updated in place (preserves their `id`). New users
    are inserted as-is."""
    inserted = 0
    updated = 0
    skipped_no_email = 0
    skipped_self = 0

    if body.mode == "replace_clients_only":
        # Wipe everyone EXCEPT the calling admin so we don't lock ourselves out.
        await db.users.delete_many({"id": {"$ne": current["id"]}})

    for u in body.users:
        email = (u.get("email") or "").strip().lower()
        if not email:
            skipped_no_email += 1
            continue
        if email == (current.get("email") or "").lower():
            skipped_self += 1
            continue
        # Defensive: only keep known fields
        doc = {
            "email": email,
            "password_hash": u.get("password_hash"),
            "name": u.get("name") or "",
            "role": u.get("role") or "client",
            "client_id": u.get("client_id"),
            "created_at": u.get("created_at") or now_iso(),
        }
        if not doc["password_hash"]:
            skipped_no_email += 1  # tracked as skipped — useless without a hash
            continue
        existing = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
        if existing:
            await db.users.update_one({"email": email}, {"$set": doc})
            updated += 1
        else:
            doc["id"] = u.get("id") or str(uuid.uuid4())
            await db.users.insert_one(doc)
            inserted += 1

    return {
        "ok": True,
        "inserted": inserted,
        "updated": updated,
        "skipped_no_email_or_hash": skipped_no_email,
        "skipped_self": skipped_self,
    }




# -------- Recent server errors (admin only) --------
@api.get("/admin/recent-errors")
async def admin_recent_errors(_: dict = Depends(require_admin)):
    """Return the last 20 unhandled server errors from the in-memory ring
    buffer. Useful for catching API regressions on the Settings page without
    needing SSH access. Buffer survives only until the next backend restart."""
    return {"errors": list(RECENT_ERRORS), "count": len(RECENT_ERRORS)}


@api.post("/admin/recent-errors/clear")
async def admin_recent_errors_clear(_: dict = Depends(require_admin)):
    """Empty the recent-errors ring buffer."""
    RECENT_ERRORS.clear()
    return {"cleared": True}



@api.get("/admin/income/export.csv")
async def admin_income_csv(
    year: Optional[int] = None,
    _: dict = Depends(require_admin),
):
    """Year-end income export as CSV — what the accountant wants in January.
    Defaults to the current year. Rows are individual paid bookings + sold
    credit packs, columns include date, client, dog, service, amount,
    payment method, payment status. Designed to open clean in Excel/Sheets.
    """
    from fastapi.responses import Response
    yr = year or business_today().year
    start = f"{yr}-01-01"
    end = f"{yr}-12-31"
    # Paid / completed bookings within the year
    paid_bookings = await db.bookings.find(
        {
            "date": {"$gte": start, "$lte": end},
            "$or": [{"actual_price": {"$gt": 0}}, {"credit_value": {"$gt": 0}}],
        },
        {"_id": 0},
    ).to_list(50000)
    # Sprint 110cj — skip training-program credit redemptions; the program
    # revenue is recorded once in `retail_sales` at sale-time, so listing the
    # per-session checkouts again would double-count.
    program_lot_ids = await _get_training_program_lot_ids()
    paid_bookings = [b for b in paid_bookings if not _is_program_credit_redemption(b, program_lot_ids)]
    # Credit-pack sales (revenue is recognized at sell-time on these lots).
    # Sprint 110cj — exclude `pack_kind=training_program` lots here; their
    # sale is already recorded in `retail_sales` (source_kind=
    # training_program_sale) and shows up below as a "Training Revenue" row.
    sold_packs = await db.credit_lots.find(
        {"sold_at": {"$gte": f"{yr}-01-01T00:00:00", "$lte": f"{yr}-12-31T23:59:59"},
         "pack_kind": {"$ne": "training_program"}},
        {"_id": 0},
    ).to_list(50000)
    # Expenses in the same year
    expenses = await db.expenses.find(
        {"date": {"$gte": start, "$lte": end}},
        {"_id": 0},
    ).to_list(50000)
    # Retail sales in the same year (Sprint 110cb — training-program sales
    # are pulled separately and labeled distinctly from retail merchandise)
    retail_sales = await db.retail_sales.find(
        {"date": {"$gte": start, "$lte": end}},
        {"_id": 0},
    ).to_list(50000)

    out_rows: List[List[str]] = [
        ["Date", "Type", "Client", "Dog", "Service / Pack", "Amount (USD)", "Payment method", "Payment status", "Booking/Lot ID"]
    ]
    for b in paid_bookings:
        amt = float(b.get("actual_price") or b.get("credit_value") or 0)
        if amt <= 0:
            continue
        out_rows.append([
            b.get("date", ""), "Service", b.get("client_name", ""), b.get("dog_name", ""),
            b.get("service_type", ""), f"{amt:.2f}",
            b.get("payment_method", "") or "", b.get("payment_status", "") or "", b.get("id", ""),
        ])
    for lot in sold_packs:
        sold_at = (lot.get("sold_at") or "")[:10]
        out_rows.append([
            sold_at, "Credit Pack", lot.get("client_name", ""), "",
            lot.get("pack_name", "") or lot.get("service_type", ""), f"{float(lot.get('paid_amount', 0)):.2f}",
            lot.get("payment_method", "") or "", "paid", lot.get("id", ""),
        ])
    # Expenses as negative-amount rows so the trailing TOTAL line nets correctly.
    for e in expenses:
        amt = float(e.get("amount") or 0)
        if amt <= 0:
            continue
        out_rows.append([
            e.get("date", ""), "Expense", "", "",
            e.get("description", "") + (f" ({e.get('category')})" if e.get("category") else ""),
            f"-{amt:.2f}",
            e.get("payment_method", "") or "", "paid", e.get("id", ""),
        ])
    # Retail sales — positive revenue rows. Training program sales are split
    # into their own "Training Revenue" row type so the operator + accountant
    # can tell merchandise apart from services.
    for s in retail_sales:
        amt = float(s.get("amount") or 0)
        if amt <= 0:
            continue
        row_type = "Training Revenue" if s.get("source_kind") == "training_program_sale" else "Retail"
        out_rows.append([
            s.get("date", ""), row_type, s.get("client_name", "") or "", "",
            s.get("description", "") + (f" ({s.get('category')})" if s.get("category") else ""),
            f"{amt:.2f}",
            s.get("payment_method", "") or "", "paid", s.get("id", ""),
        ])

    # Trailing summary row keeps the totals visible in Excel without a pivot.
    total = sum(float(r[5]) for r in out_rows[1:])
    out_rows.append([])
    out_rows.append(["", "", "", "", f"{yr} NET TOTAL", f"{total:.2f}", "", "", ""])

    # CSV escape — minimal but correct.
    def esc(v: str) -> str:
        s = str(v)
        if any(ch in s for ch in [",", "\"", "\n"]):
            return "\"" + s.replace("\"", "\"\"") + "\""
        return s

    csv_body = "\n".join(",".join(esc(c) for c in row) for row in out_rows)
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="sit-happens-income-{yr}.csv"'},
    )


@api.get("/admin/marketing-qr")
async def admin_marketing_qr(
    size: int = 1024,
    ref: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """High-resolution QR code pointing at the public app URL — for printing on flyers/cards.
    Optional `ref` query param is appended to the URL for tracking (e.g. ?ref=flyer1).
    Returns a PNG with strong error-correction so partial damage on print still scans."""
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from io import BytesIO
    from fastapi.responses import Response

    target_url = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
    if not target_url:
        raise HTTPException(status_code=500, detail="APP_PUBLIC_URL is not configured.")
    if ref:
        sep = "&" if "?" in target_url else "?"
        target_url = f"{target_url}{sep}ref={ref}"

    # Pick a box_size that lands close to the requested pixel size.
    # A v2 (25x25) QR with border 4 gives 33 modules; box_size = size/33.
    box = max(8, min(40, int(size / 33)))
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=box,
        border=4,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    filename = f"sit-happens-qr{('-' + ref) if ref else ''}.png"
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-QR-Target-Url": target_url,
        },
    )



@api.post("/admin/clients/{client_id}/impersonation-token")
async def admin_impersonation_token(client_id: str, _: dict = Depends(require_admin)):
    """Mint a short-lived (15 min) access token for the user record linked to a
    client, so an admin can log into the client portal as that client and see
    the *exact* same UI the client sees. Tokens carry an `impersonator=true`
    flag so audit logs can identify them later if needed."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    # Find the linked user record (created during signup/account claim).
    user = await db.users.find_one({"client_id": client_id, "role": "client"}, {"_id": 0, "id": 1, "email": 1, "role": 1})
    if not user:
        raise HTTPException(
            status_code=400,
            detail="This client doesn't have a portal account yet. Send them a Claim Account email first.",
        )
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": "client",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "type": "access",
        "imp": True,  # short-lived impersonation flag (informational; not enforced)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    return {
        "token": token,
        "expires_in_minutes": 15,
        "client_name": client.get("name", ""),
        "client_id": client_id,
    }


@api.get("/admin/clients/{client_id}/portal-snapshot")
async def admin_client_portal_snapshot(client_id: str, _: dict = Depends(require_admin)):
    """Read-only snapshot of what a client would see in their portal — for admin testing/QA.
    No state changes, no impersonation token: just an aggregated payload."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    dogs = await db.dogs.find({"owner_id": client_id}, {"_id": 0}).to_list(200)
    bookings = await db.bookings.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(200)

    # Active enrollments per dog (mirrors what PortalTrainingCard fetches)
    enrollments_by_dog: Dict[str, list] = {}
    if dogs:
        dog_ids = [d["id"] for d in dogs]
        enrolls = await db.program_enrollments.find(
            {"dog_id": {"$in": dog_ids}, "status": "active"},
            {"_id": 0},
        ).to_list(200)
        for e in enrolls:
            enrollments_by_dog.setdefault(e["dog_id"], []).append(e)

    # Homework assigned to this client
    homework = await db.homework.find(
        {"client_id": client_id, "status": {"$in": ["assigned", "in_progress"]}},
        {"_id": 0},
    ).sort("due_date", 1).to_list(200)
    # Sprint 110m — attach a quick per-plan progress summary so the portal
    # can render a circular progress ring on each plan card without fetching
    # per-plan endpoints.
    for hw in homework:
        if not hw.get("daily_tracker"):
            continue
        days = _compute_daily_progress(hw)
        total = len(days)
        completed = sum(1 for d in days if d["status"] in ("approved", "submitted", "rest"))
        current = next(
            (d["day_number"] for d in days if d["status"] in ("available", "needs_redo", "draft")),
            (days[-1]["day_number"] if days else 0),
        )
        hw["progress_summary"] = {
            "total_days": total,
            "completed_days": completed,
            "current_day": current,
            "pct": int(round(100 * completed / total)) if total > 0 else 0,
        }

    # Waiver status
    settings = await get_settings()
    waiver_version = settings.get("waiver_version", 1)
    sig = await db.waiver_signatures.find_one(
        {"client_id": client_id},
        {"_id": 0},
        sort=[("signed_at", -1)],
    )
    waiver = {
        "signed": bool(sig),
        "needs_resign": bool(sig and sig.get("waiver_version", 1) < waiver_version),
        "signature": sig,
    }

    return {
        "client": client,
        "dogs": dogs,
        "bookings": bookings,
        "enrollments_by_dog": enrollments_by_dog,
        "homework": homework,
        "waiver": waiver,
        "waiver_required": bool(settings.get("waiver_required_for_booking", True)),
    }


class BackupRestoreIn(BaseModel):
    version: int
    collections: dict
    mode: Literal["replace", "merge"] = "replace"  # replace = wipe & restore; merge = upsert by id


@api.post("/backup/restore")
async def backup_restore(body: BackupRestoreIn, _: dict = Depends(require_admin)):
    """Restore from a backup JSON. Two modes:
       - replace: drops each collection and bulk-inserts the backup contents
       - merge:   upserts each document by `id` (existing docs with same id are overwritten; new ones added)
    User accounts are never touched."""
    if body.version > BACKUP_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Backup version {body.version} is newer than this server (v{BACKUP_VERSION}). Update the server first.",
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
    return {"ok": True, "summary": summary, "restored_at": now_iso()}


# ───────────────────────── Trophies ─────────────────────────────

class TrophyIn(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=1)
    description: Optional[str] = ""
    category: Literal["dog", "client"]
    tier: Literal["bronze", "silver", "gold", "platinum"] = "bronze"
    icon: Optional[str] = "fa-trophy"
    custom_image: Optional[str] = ""  # base64 data URL
    # Sprint 110ak — how the uploaded custom_image is displayed:
    #   "circle"   — current behaviour, cover-crop into a perfect circle
    #   "contain"  — fit the whole design inside the circle (tier ring kept)
    #   "freeform" — no clip, rectangular card, no tier ring (image IS the trophy)
    image_fit: Literal["circle", "contain", "freeform"] = "circle"
    # Sprint 110al — focal point inside the badge for `circle` mode (0-100%).
    # CSS object-position semantics: 50/50 is centred (legacy default), 0/0
    # pins the image's top-left to the badge's top-left, 100/100 the opposite
    # corner. Ignored for `contain` and `freeform`.
    image_offset_x: int = Field(default=50, ge=0, le=100)
    image_offset_y: int = Field(default=50, ge=0, le=100)
    trigger_type: Literal["auto", "manual"] = "manual"
    trigger_kind: Optional[str] = ""
    threshold: int = 0
    active: bool = True


class TrophyPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[Literal["bronze", "silver", "gold", "platinum"]] = None
    icon: Optional[str] = None
    custom_image: Optional[str] = None
    image_fit: Optional[Literal["circle", "contain", "freeform"]] = None
    image_offset_x: Optional[int] = Field(default=None, ge=0, le=100)
    image_offset_y: Optional[int] = Field(default=None, ge=0, le=100)
    threshold: Optional[int] = None
    active: Optional[bool] = None


class ManualAwardIn(BaseModel):
    note: Optional[str] = ""


@api.get("/trophies/catalog")
async def list_trophy_catalog(_: dict = Depends(get_current_user)):
    """Return all trophy definitions. Tier color palette returned alongside."""
    items = await db.trophies.find({}, {"_id": 0}).to_list(500)
    items.sort(key=lambda t: (t.get("category", ""), t.get("trigger_type", ""), int(t.get("threshold") or 0)))
    return {"trophies": items, "tier_colors": TIER_COLORS}


@api.post("/trophies/catalog")
async def create_custom_trophy(body: TrophyIn, _: dict = Depends(require_admin)):
    if await db.trophies.find_one({"code": body.code}):
        raise HTTPException(status_code=400, detail="A trophy with that code already exists")
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "is_default": False, "created_at": now_iso()})
    await db.trophies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/trophies/catalog/{code}")
async def update_trophy(code: str, body: TrophyPatch, _: dict = Depends(require_admin)):
    existing = await db.trophies.find_one({"code": code}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Trophy not found")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if patch:
        await db.trophies.update_one({"code": code}, {"$set": patch})
        existing.update(patch)
        # If the admin changed the custom image (uploaded one or cleared it),
        # propagate it onto ALL previously-awarded rows for this trophy so the
        # new picture immediately shows up on dog/client cards, share-cards, etc.
        # Without this, awards made before the upload would stay stuck on the
        # icon placeholder.
        if "custom_image" in patch:
            await db.awarded_trophies.update_many(
                {"trophy_code": code},
                {"$set": {"trophy_custom_image": patch["custom_image"] or ""}},
            )
        # Sprint 110ak — same propagation for the new image_fit toggle so
        # historical awards reflect the admin's latest layout choice on the
        # wall + share cards.
        if "image_fit" in patch:
            await db.awarded_trophies.update_many(
                {"trophy_code": code},
                {"$set": {"trophy_image_fit": patch["image_fit"] or "circle"}},
            )
        # Sprint 110al — propagate focal-point repositioning to historical awards.
        offset_patch = {}
        if "image_offset_x" in patch:
            offset_patch["trophy_image_offset_x"] = int(patch["image_offset_x"])
        if "image_offset_y" in patch:
            offset_patch["trophy_image_offset_y"] = int(patch["image_offset_y"])
        if offset_patch:
            await db.awarded_trophies.update_many(
                {"trophy_code": code},
                {"$set": offset_patch},
            )
    return existing


@api.delete("/trophies/catalog/{code}")
async def delete_trophy(code: str, _: dict = Depends(require_admin)):
    existing = await db.trophies.find_one({"code": code}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Trophy not found")
    if existing.get("is_default"):
        # Soft-disable defaults rather than deleting (keeps history valid).
        await db.trophies.update_one({"code": code}, {"$set": {"active": False}})
        return {"ok": True, "deactivated": True}
    await db.trophies.delete_one({"code": code})
    return {"ok": True, "deleted": True}


def _serialize_awarded(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        r = {k: v for k, v in r.items() if k != "_id"}
        out.append(r)
    return out


@api.get("/dogs/{dog_id}/trophies")
async def list_dog_trophies(dog_id: str, user: dict = Depends(get_current_user)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "owner_id": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = await db.awarded_trophies.find(
        {"recipient_type": "dog", "recipient_id": dog_id, "revoked": {"$ne": True}},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(200)
    return _serialize_awarded(rows)


@api.get("/clients/{client_id}/trophies")
async def list_client_trophies(client_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin" and user.get("client_id") != client_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = await db.awarded_trophies.find(
        {"recipient_type": "client", "recipient_id": client_id, "revoked": {"$ne": True}},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(200)
    return _serialize_awarded(rows)


@api.post("/dogs/{dog_id}/trophies/{code}/award")
async def manual_award_dog(dog_id: str, code: str, body: ManualAwardIn, user: dict = Depends(require_admin)):
    row = await award_trophy(
        db, recipient_type="dog", recipient_id=dog_id, trophy_code=code,
        awarded_by=user.get("name") or "Admin", note=body.note or "",
    )
    if not row:
        raise HTTPException(status_code=400, detail="Dog already has this trophy (or trophy/code invalid)")
    return row


@api.post("/clients/{client_id}/trophies/{code}/award")
async def manual_award_client(client_id: str, code: str, body: ManualAwardIn, user: dict = Depends(require_admin)):
    row = await award_trophy(
        db, recipient_type="client", recipient_id=client_id, trophy_code=code,
        awarded_by=user.get("name") or "Admin", note=body.note or "",
    )
    if not row:
        raise HTTPException(status_code=400, detail="Client already has this trophy (or trophy/code invalid)")
    return row


@api.delete("/awarded-trophies/{awarded_id}")
async def revoke_awarded_trophy(awarded_id: str, _: dict = Depends(require_admin)):
    res = await db.awarded_trophies.update_one({"id": awarded_id}, {"$set": {"revoked": True, "revoked_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Trophy award not found")
    return {"ok": True}


@api.post("/awarded-trophies/{awarded_id}/seen")
async def mark_awarded_seen(awarded_id: str, user: dict = Depends(get_current_user)):
    """Client portal calls this after showing the new-trophy celebration toast."""
    row = await db.awarded_trophies.find_one({"id": awarded_id}, {"_id": 0, "client_id": 1})
    if not row:
        raise HTTPException(status_code=404, detail="Award not found")
    if user.get("role") != "admin" and user.get("client_id") != row.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.awarded_trophies.update_one({"id": awarded_id}, {"$set": {"seen_by_client": True}})
    return {"ok": True}




class QuoteRequestIn(BaseModel):
    kind: Literal["service", "program"]
    item_id: str
    message: Optional[str] = ""


@api.post("/portal/quote-request")
async def portal_quote_request(body: QuoteRequestIn, user: dict = Depends(get_current_user)):
    """Client submits 'Request a Quote' from the portal — fires an email to the
    operator with the client's contact info + which service/program they're
    interested in. Logs to `quote_requests` collection for the admin to follow up."""
    if user.get("role") != "client" or not user.get("client_id"):
        raise HTTPException(status_code=403, detail="Clients only")
    client = await db.clients.find_one({"id": user["client_id"]}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client record not found")
    # Resolve the requested item.
    if body.kind == "service":
        item = await db.services.find_one({"id": body.item_id, "active": True}, {"_id": 0})
    else:
        item = await db.programs.find_one({"id": body.item_id, "active": True}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Service or program not found")
    summary = {
        "kind": body.kind,
        "name": item.get("name", ""),
        "price": float(item.get("price") or item.get("base_price") or 0),
    }
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": client["id"],
        "client_name": client.get("name", ""),
        "client_email": client.get("email", ""),
        "client_phone": client.get("phone", ""),
        "kind": body.kind,
        "item_id": body.item_id,
        "item_name": summary["name"],
        "listed_price": summary["price"],
        "message": (body.message or "").strip(),
        "status": "open",
        "created_at": now_iso(),
    }
    await db.quote_requests.insert_one(doc)
    try:
        await notify_admin_quote_request(client, summary, doc["message"])
    except Exception as exc:
        logger.warning("Quote-request admin email failed: %s", exc)
    try:
        await notify_client_quote_received(client, summary, doc["message"])
    except Exception as exc:
        logger.warning("Quote-request client auto-responder failed: %s", exc)
    doc.pop("_id", None)
    return {"ok": True, "request_id": doc["id"]}


@api.get("/admin/quote-requests")
async def admin_list_quote_requests(_: dict = Depends(require_admin), status: Optional[str] = None):
    query = {}
    if status:
        query["status"] = status
    rows = await db.quote_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@api.post("/admin/quote-requests/{request_id}/close")
async def admin_close_quote_request(request_id: str, _: dict = Depends(require_admin)):
    res = await db.quote_requests.update_one(
        {"id": request_id}, {"$set": {"status": "closed", "closed_at": now_iso()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Quote request not found")
    return {"ok": True}


@api.get("/portal/incentives")
async def portal_incentives(user: dict = Depends(get_current_user)):
    """Sprint 110b — Homework Client Incentives bundle. Returns the client's
    current homework streak, the milestone they just hit, and the NEXT
    milestone to chase (so the portal can show a "X days to next badge"
    motivator). Aggregates trophies the client has earned + which ones are
    still locked but achievable in the homework category."""
    from trophy_service import _homework_streak_days, _count_homework_completed  # type: ignore
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    if not cid:
        raise HTTPException(status_code=400, detail="No client linked")

    streak = await _homework_streak_days(db, cid)
    completed = await _count_homework_completed(db, cid)

    # Streak-tier ladder for the visual fire display in the portal.
    # Each rung = (threshold, label, emoji).
    LADDER = [
        (3,   "Streak Sparked",       "🔥"),
        (7,   "Homework Hero",        "🔥🔥"),
        (14,  "Two-Week Champ",       "🔥🔥🔥"),
        (30,  "Month-Long Master",    "🔥🔥🔥🔥"),
        (60,  "Iron Streak",          "🛡️🔥"),
        (100, "Centurion",            "👑🔥"),
    ]
    current_milestone = None
    next_milestone = None
    for thresh, label, emoji in LADDER:
        if streak >= thresh:
            current_milestone = {"threshold": thresh, "label": label, "emoji": emoji}
        elif next_milestone is None:
            next_milestone = {
                "threshold": thresh,
                "label": label,
                "emoji": emoji,
                "days_to_go": max(0, thresh - streak),
            }

    # Pull every homework trophy (locked + earned) so the portal can render a
    # progress ladder of "what's next to unlock".
    hw_trophies = await db.trophies.find(
        {"trigger_kind": {"$in": ["homework_streak_days", "homework_completed"]}, "active": True},
        {"_id": 0},
    ).to_list(200)
    earned_rows = await db.awarded_trophies.find(
        {"recipient_type": "client", "recipient_id": cid, "revoked": {"$ne": True}},
        {"_id": 0, "trophy_code": 1, "awarded_at": 1, "id": 1},
    ).to_list(500)
    earned_codes = {r["trophy_code"]: r for r in earned_rows}

    def _progress_for(t: dict) -> dict:
        kind = t.get("trigger_kind")
        thresh = int(t.get("threshold") or 0)
        cur = streak if kind == "homework_streak_days" else completed
        earned = t["code"] in earned_codes
        return {
            "code": t["code"],
            "name": t.get("name"),
            "description": t.get("description"),
            "tier": t.get("tier"),
            "icon": t.get("icon"),
            "kind": kind,
            "threshold": thresh,
            "current": int(cur),
            "earned": earned,
            "earned_at": earned_codes.get(t["code"], {}).get("awarded_at") if earned else None,
            "awarded_id": earned_codes.get(t["code"], {}).get("id") if earned else None,
            "pct": min(100, int(round(100 * cur / thresh))) if thresh > 0 else 0,
        }

    progress = [_progress_for(t) for t in hw_trophies]
    progress.sort(key=lambda r: (r["kind"], r["threshold"]))

    # Completed plans with certificates → for the "Shareable Certificates" carousel
    certificates: list = []
    async for hw in db.homework.find(
        {"client_id": cid, "status": "completed", "certificate": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "title": 1, "dog_name": 1, "completed_at": 1, "share_token": 1, "certificate_filename": 1},
    ).sort("completed_at", -1).limit(20):
        certificates.append({
            "homework_id": hw["id"],
            "title": hw.get("title", ""),
            "dog_name": hw.get("dog_name", ""),
            "completed_at": hw.get("completed_at", ""),
            "share_token": hw.get("share_token"),  # null until generated; UI calls /share-link to mint
            "filename": hw.get("certificate_filename", "certificate"),
        })

    # Sprint 110c — "Refer a friend, both get a trophy" bolt-on.
    # Fetch the client's referral_code (auto-minted in /portal/me if missing)
    # plus their successful-referral count and the referral trophy ladder so
    # the portal can render a complete shareable referral card.
    client_doc = await db.clients.find_one({"id": cid}, {"_id": 0, "referral_code": 1, "name": 1})
    ref_code = (client_doc or {}).get("referral_code")
    successful_referrals = await db.referrals.count_documents({"referrer_id": cid})
    # Sprint 110d — recent referrals mini-feed: first name only (privacy)
    # + created_at so the UI can render "Alex joined 3 weeks ago".
    recent_refs: list = []
    async for r in db.referrals.find(
        {"referrer_id": cid},
        {"_id": 0, "referred_name": 1, "referred_id": 1, "created_at": 1, "trigger_service_type": 1},
    ).sort("created_at", -1).limit(5):
        full = (r.get("referred_name") or "").strip()
        first = full.split()[0] if full else "Friend"
        recent_refs.append({
            "first_name": first,
            "joined_at": r.get("created_at", ""),
            "service": r.get("trigger_service_type", ""),
        })
    REF_LADDER = [
        (1,  "Friend Bringer",   "🤝"),
        (3,  "Pack Builder",     "🐾🐾🐾"),
        (10, "Ambassador",       "📣"),
    ]
    current_ref_milestone = None
    next_ref_milestone = None
    for thresh, label, emoji in REF_LADDER:
        if successful_referrals >= thresh:
            current_ref_milestone = {"threshold": thresh, "label": label, "emoji": emoji}
        elif next_ref_milestone is None:
            next_ref_milestone = {
                "threshold": thresh,
                "label": label,
                "emoji": emoji,
                "left": max(0, thresh - successful_referrals),
            }
    referral_block = {
        "code": ref_code,
        "successful_count": successful_referrals,
        "recent": recent_refs,
        "ladder": [{"threshold": t, "label": l, "emoji": e} for t, l, e in REF_LADDER],
        "current_milestone": current_ref_milestone,
        "next_milestone": next_ref_milestone,
        "share_text": (
            f"Hey! I love {(await get_settings()).get('brand_footer_text') or 'Sit Happens'} for my pup. "
            f"Sign up with my code {ref_code} and we both unlock a trophy "
            f"once you complete your first appointment."
            if ref_code else ""
        ),
    }

    return {
        "streak_days": streak,
        "completed_plans": completed,
        "current_milestone": current_milestone,
        "next_milestone": next_milestone,
        "streak_ladder": [{"threshold": t, "label": l, "emoji": e} for t, l, e in LADDER],
        "trophy_progress": progress,
        "certificates": certificates,
        "referral": referral_block,
    }


# ────────── Sprint 110b: Shareable certificate links ──────────
@api.post("/homework/{homework_id}/share-link")
async def homework_share_link(homework_id: str, user: dict = Depends(get_current_user)):
    """Mint (or return existing) a public share token for a completed
    homework's certificate. Token-based so a client can share the link on
    social/text without exposing their portal login."""
    hw = await db.homework.find_one({"id": homework_id}, {"_id": 0})
    if not hw:
        raise HTTPException(status_code=404, detail="Homework not found")
    # Only the owning client (or admin) can mint a share link
    if user.get("role") == "client" and hw.get("client_id") != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your homework")
    if not hw.get("certificate"):
        raise HTTPException(status_code=400, detail="No certificate uploaded yet")
    token = hw.get("share_token")
    if not token:
        # Short, URL-safe token — 22 chars from uuid4 hex is unguessable in practice
        token = uuid.uuid4().hex[:22]
        await db.homework.update_one(
            {"id": homework_id},
            {"$set": {"share_token": token, "share_token_created_at": now_iso()}},
        )
    return {
        "share_token": token,
        "share_url": f"/share/cert/{token}",  # frontend route renders the public view
        "homework_id": homework_id,
        "dog_name": hw.get("dog_name", ""),
        "title": hw.get("title", ""),
    }


@api.get("/share/cert/{token}")
async def public_certificate_view(token: str):
    """PUBLIC (no auth) endpoint that returns the certificate metadata + image
    bytes for the share page. Token is unguessable — anyone with the link can
    view, by design (that's what shareable means)."""
    hw = await db.homework.find_one(
        {"share_token": token},
        {"_id": 0, "certificate": 1, "certificate_filename": 1, "title": 1,
         "dog_name": 1, "client_name": 1, "completed_at": 1, "id": 1},
    )
    if not hw:
        raise HTTPException(status_code=404, detail="Certificate not found")
    # We surface a settings-driven brand name so the share page can render
    # "Issued by X" without leaking any other settings info.
    settings = await get_settings()
    return {
        "homework_id": hw["id"],
        "title": hw.get("title", ""),
        "dog_name": hw.get("dog_name", ""),
        "client_name": hw.get("client_name", ""),
        "completed_at": hw.get("completed_at", ""),
        "certificate": hw.get("certificate", ""),
        "filename": hw.get("certificate_filename") or "certificate",
        "brand_name": settings.get("brand_footer_text") or "Sit Happens",
    }


@api.get("/portal/trophies")
async def portal_trophies(user: dict = Depends(get_current_user)):
    """Returns trophies for the current client + their dogs, plus an
    `unseen` list for the celebration toast."""
    cid = user.get("client_id")
    if user.get("role") != "client" or not cid:
        return {"client_trophies": [], "dog_trophies": [], "unseen": []}
    client_rows = await db.awarded_trophies.find(
        {"recipient_type": "client", "recipient_id": cid, "revoked": {"$ne": True}},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(200)
    dogs = await db.dogs.find({"owner_id": cid}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    dog_ids = [d["id"] for d in dogs]
    dog_rows = []
    if dog_ids:
        dog_rows = await db.awarded_trophies.find(
            {"recipient_type": "dog", "recipient_id": {"$in": dog_ids}, "revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(500)
    unseen = [r for r in (client_rows + dog_rows) if not r.get("seen_by_client")]
    return {
        "client_trophies": _serialize_awarded(client_rows),
        "dog_trophies": _serialize_awarded(dog_rows),
        "unseen": _serialize_awarded(unseen),
    }


@api.get("/trophies/share-card/{awarded_id}.png")
async def trophy_share_card(awarded_id: str):
    """Public PNG share card. Anyone with the awarded_id (uuid) can fetch — safe
    since IDs are unguessable and the image only shows public info."""
    row = await db.awarded_trophies.find_one({"id": awarded_id, "revoked": {"$ne": True}}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Award not found")
    # Backfill the trophy image for awards minted before we started snapshotting
    # it (so the share PNG always reflects the *current* catalog image when the
    # award doesn't have its own).
    if not row.get("trophy_custom_image"):
        trophy = await db.trophies.find_one(
            {"code": row.get("trophy_code")},
            {"_id": 0, "custom_image": 1, "image_fit": 1, "image_offset_x": 1, "image_offset_y": 1},
        )
        if trophy and trophy.get("custom_image"):
            row["trophy_custom_image"] = trophy["custom_image"]
            row["trophy_image_fit"] = trophy.get("image_fit") or "circle"
            row["trophy_image_offset_x"] = trophy.get("image_offset_x", 50)
            row["trophy_image_offset_y"] = trophy.get("image_offset_y", 50)
    # Backfill image_fit for awards minted before Sprint 110ak (defaults to
    # legacy "circle" behaviour so historical shares stay pixel-identical).
    if not row.get("trophy_image_fit"):
        trophy = await db.trophies.find_one(
            {"code": row.get("trophy_code")},
            {"_id": 0, "image_fit": 1, "image_offset_x": 1, "image_offset_y": 1},
        )
        row["trophy_image_fit"] = (trophy or {}).get("image_fit") or "circle"
        row.setdefault("trophy_image_offset_x", (trophy or {}).get("image_offset_x", 50))
        row.setdefault("trophy_image_offset_y", (trophy or {}).get("image_offset_y", 50))
    try:
        png = render_share_card_png(row)
    except Exception as exc:
        logger.warning("Share card render failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to render share card")
    return Response(content=png, media_type="image/png")


@api.get("/trophies/leaderboard")
async def trophies_leaderboard(_: dict = Depends(require_admin), limit: int = 5):
    """Top dogs and top clients by trophy count (excluding revoked)."""
    pipeline_dog = [
        {"$match": {"recipient_type": "dog", "revoked": {"$ne": True}}},
        {"$group": {"_id": "$recipient_id", "count": {"$sum": 1}, "last": {"$max": "$awarded_at"}}},
        {"$sort": {"count": -1, "last": -1}},
        {"$limit": limit},
    ]
    pipeline_client = [
        {"$match": {"recipient_type": "client", "revoked": {"$ne": True}}},
        {"$group": {"_id": "$recipient_id", "count": {"$sum": 1}, "last": {"$max": "$awarded_at"}}},
        {"$sort": {"count": -1, "last": -1}},
        {"$limit": limit},
    ]
    dog_rows = await db.awarded_trophies.aggregate(pipeline_dog).to_list(limit)
    client_rows = await db.awarded_trophies.aggregate(pipeline_client).to_list(limit)
    dog_ids = [r["_id"] for r in dog_rows]
    client_ids = [r["_id"] for r in client_rows]
    dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "name": 1, "breed": 1, "owner_id": 1, "photo": 1}).to_list(50)}
    owner_ids = [d.get("owner_id") for d in dogs.values() if d.get("owner_id")]
    clients = {c["id"]: c for c in await db.clients.find({"id": {"$in": client_ids + owner_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)}
    return {
        "top_dogs": [
            {
                "dog_id": r["_id"],
                "dog_name": (dogs.get(r["_id"]) or {}).get("name", "—"),
                "breed": (dogs.get(r["_id"]) or {}).get("breed", ""),
                "photo": (dogs.get(r["_id"]) or {}).get("photo", ""),
                "owner_id": (dogs.get(r["_id"]) or {}).get("owner_id"),
                "owner_name": (clients.get((dogs.get(r["_id"]) or {}).get("owner_id")) or {}).get("name", ""),
                "trophy_count": r["count"],
            }
            for r in dog_rows
        ],
        "top_clients": [
            {
                "client_id": r["_id"],
                "client_name": (clients.get(r["_id"]) or {}).get("name", "—"),
                "trophy_count": r["count"],
            }
            for r in client_rows
        ],
    }




# -------- Startup --------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.clients.create_index("id", unique=True)
    await db.dogs.create_index("id", unique=True)
    await db.bookings.create_index("id", unique=True)
    # Performance indexes — hot query paths used by Dashboard, Schedule,
    # Bookings, Pipeline, Income. All safe to create; existing data uses
    # them on next query. Each wrapped individually so one failure (e.g.
    # legacy collection with a conflicting index def) never aborts startup.
    perf_indexes = [
        (db.bookings, [("date", 1), ("status", 1)], {}),
        (db.bookings, "dog_id", {}),
        (db.bookings, "client_id", {}),
        (db.bookings, "status", {}),
        (db.dogs, "owner_id", {}),
        (db.homework, "dog_id", {}),
        (db.homework, "client_id", {}),
        (db.homework, [("status", 1), ("created_at", -1)], {}),
        (db.dog_programs, "dog_id", {}),
        (db.dog_programs, [("dog_id", 1), ("status", 1)], {}),
        (db.credit_lots, [("client_id", 1), ("purchased_at", -1)], {}),
        (db.credit_lots, [("client_id", 1), ("service_type", 1), ("qty_remaining", 1)], {}),
        (db.incidents, [("date", -1), ("dog_id", 1)], {}),
        (db.vaccine_dismissals, "dog_id", {}),
        (db.awarded_trophies, [("recipient_type", 1), ("recipient_id", 1), ("trophy_code", 1)], {}),
        (db.awarded_trophies, "client_id", {}),
        (db.awarded_trophies, "dog_id", {}),
        (db.trophies, "code", {"unique": True}),
        # Sprint 110ck — Income/P&L hot paths. Every income endpoint scans
        # retail_sales + expenses + time_clock_entries by date; with no
        # index that's a full collection scan per request.
        (db.retail_sales, "date", {}),
        (db.retail_sales, [("date", 1), ("source_kind", 1)], {}),
        (db.expenses, "date", {}),
        (db.time_clock_entries, "clock_in_at", {}),
        (db.time_clock_entries, [("user_id", 1), ("clock_in_at", 1)], {}),
        # `pack_kind=training_program` filter used by the double-count fix
        # and by `/clients/{id}/training-program-summary`.
        (db.credit_lots, [("pack_kind", 1)], {}),
        (db.credit_lots, "id", {"unique": True}),
        # New collections from recent sprints.
        (db.payment_plans, "client_id", {}),
        (db.payment_plans, [("client_id", 1), ("status", 1)], {}),
        (db.reschedule_requests, [("status", 1), ("created_at", -1)], {}),
        (db.reschedule_requests, "client_id", {}),
        (db.reschedule_requests, "booking_id", {}),
        # Sprint 110cn — new staff-portal collections.
        (db.punch_corrections, [("status", 1), ("created_at", -1)], {}),
        (db.punch_corrections, "user_id", {}),
    ]
    for coll, key, opts in perf_indexes:
        try:
            await coll.create_index(key, **opts)
        except Exception as e:
            logger.warning(f"Could not create index {key} on {coll.name}: {e}")
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_pw),
            "name": os.environ.get("ADMIN_NAME", "Admin"),
            "role": "admin",
            "client_id": None,
            "created_at": now_iso(),
        })
        logger.info("Seeded admin %s", admin_email)
    elif not verify_password(admin_pw, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pw)}})
        logger.info("Updated admin password")
    # Seed settings (idempotent)
    await get_settings()
    # Seed trophies catalog (idempotent)
    try:
        await seed_trophies_if_empty(db)
    except Exception as exc:
        logger.warning("Trophy seeding failed: %s", exc)
    # Sprint 110av — start the auto-backup loop. Loop honors the
    # `enabled` flag on every iteration so disabling the feature simply
    # makes it a no-op (it doesn't get cancelled).
    global _auto_backup_task
    if _auto_backup_task is None or _auto_backup_task.done():
        _auto_backup_task = asyncio.create_task(_auto_backup_loop())
    # Sprint 110ax — seed the dog-facts library on first boot
    try:
        await _seed_dog_facts_if_empty()
    except Exception as exc:
        logger.warning("Dog facts seeding failed: %s", exc)


@app.on_event("shutdown")
async def shutdown():
    global _auto_backup_task
    if _auto_backup_task and not _auto_backup_task.done():
        _auto_backup_task.cancel()
        try:
            await _auto_backup_task
        except (asyncio.CancelledError, Exception):
            pass
    mongo_client.close()


# ────────────────────────── Services Catalog + Income Tracking ──────────────────────────
from services_data import SEED_SERVICES


class ServiceIn(BaseModel):
    slug: Optional[str] = ""
    name: str = Field(min_length=1)
    # Sprint 110s — short description shown on the client portal services list
    # (rendered by ServicesByCategory.jsx → ServiceTile). Plain text, ~500
    # chars is plenty for a 1-2 sentence pitch.
    description: Optional[str] = Field(default="", max_length=500)
    base_price: float = 0.0
    service_type: Optional[Literal["daycare", "boarding", "training", "grooming", "photography", "other"]] = "other"
    color: Optional[str] = "#64748b"
    icon: Optional[str] = "fa-tag"
    # How many minutes the service blocks on the schedule. Used for slot
    # conflicts on time-based services (training / grooming / photography).
    # Daycare and boarding ignore this since they're date-based, not time-based.
    duration_minutes: Optional[int] = 60
    active: bool = True
    # Sprint 110an — opt-in add-on flow. When `is_addon=True`, the service
    # is hidden from the main booking list and instead surfaces as an
    # "add-on" tile under any base service whose `service_type` is in
    # `addon_for`. Examples: nail trim shows under daycare + grooming;
    # extra-night boarding shows under boarding; spotlight training shows
    # under daycare + training. Add-ons are billed alongside the base
    # service at booking-confirm or check-out via the existing `add_ons`
    # array on bookings.
    is_addon: bool = False
    addon_for: List[Literal["daycare", "boarding", "training", "grooming", "photography", "other"]] = []
    # Sprint 110aw — Board-and-Train package. When this service is booked,
    # the system auto-enrolls the dog in `package_program_id` so the trainer
    # has a curriculum + homework ready before drop-off. Best paired with a
    # boarding-type service (the multi-night stay carries the training inside).
    package_program_id: Optional[str] = None


class LogServiceIn(BaseModel):
    """Quick-log a completed-or-upcoming service. Creates a booking row with
    service_id + actual_price baked in so it shows up in both Bookings and
    Income views."""
    dog_id: str
    service_id: str
    date: Optional[str] = ""  # YYYY-MM-DD; defaults today
    actual_price: Optional[float] = None  # falls back to service.base_price
    notes: Optional[str] = ""
    status: Literal["pending", "approved", "completed"] = "completed"
    payment_status: Literal["unpaid", "paid", "refunded", "comped"] = "paid"
    payment_method: Literal["cash", "card", "transfer", "credits", "other"] = "cash"


class TransactionUpdateIn(BaseModel):
    actual_price: Optional[float] = None
    payment_status: Optional[Literal["unpaid", "paid", "refunded", "comped"]] = None
    payment_method: Optional[Literal["cash", "card", "transfer", "credits", "check", "other"]] = None
    status: Optional[Literal["pending", "approved", "rejected", "completed", "cancelled"]] = None
    service_id: Optional[str] = None


@api.get("/services")
async def list_services(
    user: dict = Depends(get_current_user),
    include_inactive: bool = False,
    # Sprint 110an — booking + check-in flows can filter to just the eligible
    # add-ons for a base service type, while the catalog editor still gets
    # the full list. Three modes:
    #   addons_only=true       → only add-ons (optionally filtered by `for`)
    #   for=daycare            → returns BASE services + addons eligible for daycare
    #   default (no params)    → unchanged: every active service
    addons_only: bool = False,
    for_service_type: Optional[str] = Query(default=None, alias="for"),
):
    q: Dict = {} if include_inactive else {"active": True}
    if addons_only:
        q["is_addon"] = True
        if for_service_type:
            q["addon_for"] = for_service_type
    items = await db.services.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    # Sprint 110bv — when a client browses, rewrite catalog prices to their
    # locked-in legacy rates so the portal never shows the wrong price.
    if user.get("role") == "client" and user.get("client_id"):
        await _apply_client_overrides(items, user["client_id"], "service", "base_price")
    return items


@api.get("/services/addons")
async def list_eligible_addons(
    for_service_type: str = Query(alias="for"),
    user: dict = Depends(get_current_user),
):
    """Add-ons eligible to be tacked on to a base service of the given type.
    Used by the client booking form, admin quick check-in modal, and the
    check-out add-on picker so the same source of truth gates all three."""
    q = {"active": True, "is_addon": True, "addon_for": for_service_type}
    items = await db.services.find(q, {"_id": 0}).sort("base_price", 1).to_list(200)
    # Sprint 110bv — apply client's legacy add-on overrides too
    if user.get("role") == "client" and user.get("client_id"):
        await _apply_client_overrides(items, user["client_id"], "service", "base_price")
    return items


# Sprint 110t — public, no-auth catalog of active services used by the
# landing/login page so prospects can see what's offered before they sign up.
# Returns only marketing-safe fields (name, description, price, category,
# color, icon). Internal admin flags + slug omitted. Add-ons excluded so
# the public landing page only shows top-level services.
@api.get("/public/services")
async def public_list_services():
    items = await db.services.find(
        {"active": True, "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}]},
        {"_id": 0, "id": 1, "name": 1, "description": 1, "base_price": 1,
         "service_type": 1, "color": 1, "icon": 1, "duration_minutes": 1},
    ).sort("name", 1).to_list(500)
    return items


@api.post("/services")
async def create_service(body: ServiceIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["slug"] = doc.get("slug") or doc["name"].lower().replace(" ", "_")[:40]
    doc["created_at"] = now_iso()
    doc["is_default"] = False
    await db.services.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/services/{service_id}")
async def update_service(service_id: str, body: ServiceIn, _: dict = Depends(require_admin)):
    existing = await db.services.find_one({"id": service_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Service not found")
    update = body.model_dump()
    update.pop("slug", None)  # slug is immutable
    update.pop("is_default", None)  # is_default is server-managed
    await db.services.update_one({"id": service_id}, {"$set": update})
    return {**existing, **update}


@api.delete("/services/{service_id}")
async def delete_service(service_id: str, _: dict = Depends(require_admin)):
    existing = await db.services.find_one({"id": service_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Service not found")
    if existing.get("is_default"):
        await db.services.update_one({"id": service_id}, {"$set": {"active": False}})
    else:
        await db.services.delete_one({"id": service_id})
    return {"ok": True}


@api.post("/services/seed-standard")
async def seed_services(_: dict = Depends(require_admin)):
    seeded = 0
    for svc in SEED_SERVICES:
        if await db.services.find_one({"slug": svc["slug"]}, {"_id": 0}):
            continue
        doc = {**svc, "id": str(uuid.uuid4()), "is_default": True, "active": True, "created_at": now_iso()}
        await db.services.insert_one(doc)
        seeded += 1
    total = await db.services.count_documents({"active": True})
    return {"seeded": seeded, "total_active": total}


# ----- Transactions = bookings with service_id + actual_price -----
@api.post("/transactions")
async def log_service(body: LogServiceIn, user: dict = Depends(require_admin)):
    """Creates a booking row tagged with service_id + price. Use this for
    walk-ins, one-off lessons, or any income event not started from the
    normal booking flow."""
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    svc = await db.services.find_one({"id": body.service_id}, {"_id": 0})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0})
    price = body.actual_price if body.actual_price is not None else float(svc.get("base_price") or 0)

    booking_id = str(uuid.uuid4())
    doc = {
        "id": booking_id,
        "dog_id": dog["id"],
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "date": body.date or business_today().isoformat(),
        "end_date": None,
        "service_type": svc.get("service_type") or "other",
        "status": body.status,
        "notes": body.notes or "",
        "created_at": now_iso(),
        "checked_in_at": now_iso() if body.status == "completed" else None,
        "checked_out_at": now_iso() if body.status == "completed" else None,
        "kennel": "",
        "dropoff_time": "",
        "pickup_time": "",
        "cost": 0,
        "credits_deducted": 0,
        "service_id": svc["id"],
        "service_name": svc["name"],
        "actual_price": price,
        "payment_status": body.payment_status,
        "payment_method": body.payment_method,
        "paid_at": now_iso() if body.payment_status == "paid" else None,
    }
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/transactions/{transaction_id}")
async def update_transaction(transaction_id: str, body: TransactionUpdateIn, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": transaction_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Transaction not found")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    # If a service_id is being set, also refresh service_name + default price (only if price not also being set)
    if body.service_id:
        svc = await db.services.find_one({"id": body.service_id}, {"_id": 0})
        if not svc:
            raise HTTPException(status_code=404, detail="Service not found")
        update["service_name"] = svc.get("name")
        if body.actual_price is None and booking.get("actual_price") in (None, 0):
            update["actual_price"] = float(svc.get("base_price") or 0)
    # Auto-stamp paid_at on transition to paid
    if body.payment_status == "paid" and not booking.get("paid_at"):
        update["paid_at"] = now_iso()
    # Auto-mark complete when invoice is paid (the "automation" the user asked for)
    if body.payment_status == "paid" and booking.get("status") not in ("completed", "cancelled", "rejected"):
        update.setdefault("status", "completed")
    await db.bookings.update_one({"id": transaction_id}, {"$set": update})
    return {**booking, **update}


@api.delete("/transactions/{transaction_id}")
async def delete_transaction(transaction_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": transaction_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # If it was created via log_service (no real check-in flow), hard-delete.
    # Otherwise, just strip the income fields and leave the booking intact.
    if booking.get("service_id") and not booking.get("checked_in_at"):
        await db.bookings.delete_one({"id": transaction_id})
    else:
        await db.bookings.update_one(
            {"id": transaction_id},
            {"$unset": {"service_id": "", "service_name": "", "actual_price": "", "payment_status": "", "payment_method": "", "paid_at": ""}},
        )
    return {"ok": True}


def _week_bounds(ref: Optional[date] = None) -> tuple:
    """Returns (monday_iso, sunday_iso) for the week containing `ref` (default today)."""
    ref = ref or business_today()
    monday = ref - timedelta(days=ref.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


@api.get("/transactions")
async def list_transactions(
    _: dict = Depends(require_admin),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    dog_id: Optional[str] = None,
    service_id: Optional[str] = None,
    status: Optional[str] = None,
    payment_status: Optional[str] = None,
    revenue_only: bool = True,
):
    """Returns booking rows annotated as transactions.
    Default (`revenue_only=true`): only rows tagged with a service or non-zero
    actual_price — keeps the Income screen focused on real revenue events.
    Set `revenue_only=false` to include legacy approved/pending bookings that
    haven't been priced yet (useful for backfill / migrations)."""
    q: Dict = {}
    if start_date or end_date:
        date_q: Dict = {}
        if start_date:
            date_q["$gte"] = start_date
        if end_date:
            date_q["$lte"] = end_date
        q["date"] = date_q
    if dog_id:
        q["dog_id"] = dog_id
    if service_id:
        q["service_id"] = service_id
    if status:
        q["status"] = status
    if payment_status:
        q["payment_status"] = payment_status

    rows = await db.bookings.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    enriched = []
    for r in rows:
        # Skip rejected and unchargeable cancellations — keep cancelled bookings
        # where the operator explicitly charged a no-show / late-cancel fee so
        # they show up as revenue events.
        if r.get("status") == "rejected":
            continue
        is_cancel_fee = r.get("status") == "cancelled" and r.get("cancellation_charged")
        if r.get("status") == "cancelled" and not is_cancel_fee:
            continue
        is_revenue = bool(r.get("service_id")) or bool(r.get("actual_price")) or bool(is_cancel_fee)
        if revenue_only:
            if is_revenue:
                enriched.append(r)
        else:
            if is_revenue or r.get("status") in ("approved", "completed", "pending"):
                enriched.append(r)
    return enriched


async def _get_training_program_lot_ids() -> set:
    """Sprint 110cj — Returns the set of credit_lot IDs whose `pack_kind` is
    `training_program`. Bookings that consume credits from these lots must NOT
    be counted as completed/paid revenue on the Income screens, because the
    program's revenue was already recognized up-front at the point of sale
    (recorded in `retail_sales` with `source_kind=training_program_sale`).
    Counting them again at checkout-time would double-count the same dollar.
    Daycare/boarding credit packs are unaffected — their revenue is only
    recognized at checkout, so credit-paid bookings DO count there.
    """
    cursor = db.credit_lots.find(
        {"pack_kind": "training_program"},
        {"_id": 0, "id": 1},
    )
    return {lot["id"] async for lot in cursor}


def _is_program_credit_redemption(booking: dict, program_lot_ids: set) -> bool:
    """Return True if this booking is paid from a training-program credit lot.
    Identified by the `is_prepaid_program_session` flag (set at sell-time) OR
    by any of its `credit_lot_ids` belonging to a training-program lot (set
    at checkout-time when credits are consumed)."""
    if booking.get("is_prepaid_program_session"):
        return True
    if booking.get("payment_method") != "credits":
        return False
    for lid in (booking.get("credit_lot_ids") or []):
        if lid in program_lot_ids:
            return True
    return False


@api.get("/transactions/weekly-summary")
async def weekly_summary(_: dict = Depends(require_admin), ref_date: Optional[str] = None):
    """Mon-Sun income tally. Default = current week. Pass ?ref_date=YYYY-MM-DD
    to inspect any other week. Returns cash + credits split so you can read
    real-money revenue separately from credit redemptions."""
    try:
        ref = date.fromisoformat(ref_date) if ref_date else business_today()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ref_date")
    monday_iso, sunday_iso = _week_bounds(ref)

    rows = await db.bookings.find(
        {"date": {"$gte": monday_iso, "$lte": sunday_iso}},
        {"_id": 0},
    ).to_list(2000)

    # Sprint 110cj — exclude training-program credit redemptions from income
    # totals; their revenue was already counted at sell-time.
    program_lot_ids = await _get_training_program_lot_ids()

    completed_total = 0.0
    booked_total = 0.0
    paid_total = 0.0
    unpaid_total = 0.0
    credits_redeemed = 0
    completed_count = 0
    booked_count = 0
    by_service: Dict[str, Dict] = {}

    for r in rows:
        if r.get("status") in ("cancelled", "rejected"):
            continue
        # Skip price contribution for training-program credit redemptions to
        # avoid double-counting (program revenue is in retail_sales).
        is_program_credit = _is_program_credit_redemption(r, program_lot_ids)
        price = 0.0 if is_program_credit else float(r.get("actual_price") or 0)
        if r.get("status") == "completed":
            completed_total += price
            completed_count += 1
        elif r.get("status") in ("approved", "pending"):
            booked_total += price
            booked_count += 1
        if r.get("payment_status") == "paid":
            paid_total += price
        elif r.get("status") in ("completed", "approved"):
            unpaid_total += price
        credits_redeemed += int(r.get("credits_deducted") or 0)

        # Don't pollute by_service with $0 program-redemption rows.
        if is_program_credit:
            continue
        svc_key = r.get("service_name") or r.get("service_type") or "Other"
        b = by_service.setdefault(svc_key, {"name": svc_key, "count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] += price

    # Retail sales in the same week. Sprint 110cb — training-program sales
    # are split into their own "training revenue" bucket so the operator can
    # tell merchandise apart from services on the Income screen.
    retail_rows_all = await db.retail_sales.find(
        {"date": {"$gte": monday_iso, "$lte": sunday_iso}},
        {"_id": 0, "amount": 1, "source_kind": 1},
    ).to_list(2000)
    retail_rows = [x for x in retail_rows_all if x.get("source_kind") != "training_program_sale"]
    training_rows = [x for x in retail_rows_all if x.get("source_kind") == "training_program_sale"]
    retail_total = round(sum(float(x.get("amount") or 0) for x in retail_rows), 2)
    retail_count = len(retail_rows)
    training_revenue_total = round(sum(float(x.get("amount") or 0) for x in training_rows), 2)
    training_revenue_count = len(training_rows)
    other_revenue_total = round(retail_total + training_revenue_total, 2)

    return {
        "week_start": monday_iso,
        "week_end": sunday_iso,
        "completed_total": round(completed_total, 2),
        "booked_total": round(booked_total, 2),
        "paid_total": round(paid_total, 2),
        "unpaid_total": round(unpaid_total, 2),
        "credits_redeemed": credits_redeemed,
        "completed_count": completed_count,
        "booked_count": booked_count,
        "by_service": sorted(by_service.values(), key=lambda x: -x["total"]),
        "retail_total": retail_total,
        "retail_count": retail_count,
        "training_revenue_total": training_revenue_total,
        "training_revenue_count": training_revenue_count,
        "service_total": round(completed_total, 2),
        "gross_total": round(completed_total + other_revenue_total, 2),
    }


@api.get("/transactions/summary-range")
async def summary_range(
    _: dict = Depends(require_admin),
    start_date: str = ...,
    end_date: str = ...,
):
    """Aggregate income over an arbitrary date range (for monthly / quarterly views)."""
    rows = await db.bookings.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(5000)
    # Sprint 110cj — exclude training-program credit redemptions (already
    # counted as Training Revenue at sale-time).
    program_lot_ids = await _get_training_program_lot_ids()
    completed_total = 0.0
    paid_total = 0.0
    by_day: Dict[str, float] = {}
    for r in rows:
        if r.get("status") in ("cancelled", "rejected"):
            continue
        price = 0.0 if _is_program_credit_redemption(r, program_lot_ids) else float(r.get("actual_price") or 0)
        if r.get("status") == "completed":
            completed_total += price
            by_day[r["date"]] = round(by_day.get(r["date"], 0) + price, 2)
        if r.get("payment_status") == "paid":
            paid_total += price
    # Expenses in the same window so the UI can show NET (income - expenses)
    exp_rows = await db.expenses.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(5000)
    expenses_total = round(sum(float(e.get("amount") or 0) for e in exp_rows), 2)
    by_category: Dict[str, Dict] = {}
    for e in exp_rows:
        cat = (e.get("category") or "Uncategorized").strip() or "Uncategorized"
        b = by_category.setdefault(cat, {"name": cat, "count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] = round(b["total"] + float(e.get("amount") or 0), 2)

    # Retail sales in the same window — folded into completed_total + by_day
    # so NET maths include external-POS retail revenue too.
    # Sprint 110cb — split out training-program sales (source_kind=
    # "training_program_sale") into their OWN bucket. They're a service, not
    # retail merchandise, so the Income screen shows them as "Training Revenue"
    # on a separate stat tile and they don't pollute the Retail total.
    retail_rows_all = await db.retail_sales.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(5000)
    retail_rows = [r for r in retail_rows_all if r.get("source_kind") != "training_program_sale"]
    training_rows = [r for r in retail_rows_all if r.get("source_kind") == "training_program_sale"]
    retail_total = round(sum(float(r.get("amount") or 0) for r in retail_rows), 2)
    training_revenue_total = round(sum(float(r.get("amount") or 0) for r in training_rows), 2)
    other_revenue_total = round(retail_total + training_revenue_total, 2)
    for r in retail_rows_all:
        d = r.get("date")
        if d:
            by_day[d] = round(by_day.get(d, 0) + float(r.get("amount") or 0), 2)

    # Labor cost in the same window — uses the payroll tax estimator so the
    # Income page shows TRUE cost (gross + employer burden), not just gross wages.
    tax = await _get_payroll_tax_settings()
    tc_entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(10000)
    uids = list({e["user_id"] for e in tc_entries})
    rate_users = await db.users.find(
        {"id": {"$in": uids}}, {"_id": 0, "id": 1, "hourly_rate": 1, "name": 1, "display_name": 1}
    ).to_list(500) if uids else []
    rate_map = {u["id"]: u for u in rate_users}
    # YTD pre-period for cap math
    try:
        ytd_start = f"{datetime.strptime(end_date, '%Y-%m-%d').year}-01-01"
    except Exception:
        ytd_start = f"{business_today().year}-01-01"
    pre = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{ytd_start}T00:00:00", "$lt": f"{start_date}T00:00:00"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(50000)
    pre_hours: Dict[str, float] = {}
    for e in pre:
        pre_hours[e["user_id"]] = pre_hours.get(e["user_id"], 0) + float(e.get("hours") or 0)
    period_hours: Dict[str, float] = {}
    for e in tc_entries:
        period_hours[e["user_id"]] = period_hours.get(e["user_id"], 0) + float(e.get("hours") or 0)
    labor_gross = 0.0
    labor_burden = 0.0
    for uid, hrs in period_hours.items():
        u = rate_map.get(uid, {})
        rate = float(u.get("hourly_rate") or 0)
        ytd = pre_hours.get(uid, 0) * rate
        c = _compute_payroll_tax(hrs, rate, ytd, tax)
        labor_gross += c["gross"]
        labor_burden += c["employer_burden"]
    labor_gross = round(labor_gross, 2)
    labor_burden = round(labor_burden, 2)
    labor_total = round(labor_gross + labor_burden, 2)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "completed_total": round(completed_total + other_revenue_total, 2),
        "service_total": round(completed_total, 2),
        "retail_total": retail_total,
        "retail_count": len(retail_rows),
        "training_revenue_total": training_revenue_total,
        "training_revenue_count": len(training_rows),
        "paid_total": round(paid_total + other_revenue_total, 2),
        "expenses_total": expenses_total,
        "labor_gross": labor_gross,
        "labor_burden": labor_burden,
        "labor_total": labor_total,
        "net_total": round(completed_total + other_revenue_total - expenses_total - labor_total, 2),
        "net_before_labor": round(completed_total + other_revenue_total - expenses_total, 2),
        "expenses_by_category": sorted(by_category.values(), key=lambda x: -x["total"]),
        "expense_count": len(exp_rows),
        "by_day": [{"date": d, "total": v} for d, v in sorted(by_day.items())],
    }


# ────────────────────────── Profit & Loss Report ──────────────────────────
@api.get("/reports/pl")
async def pl_report_json(
    start_date: str,
    end_date: str,
    _: dict = Depends(require_admin),
):
    """JSON snapshot of all P&L data (used by both UI preview and PDF render)."""
    import pl_report
    return await pl_report.build_pl_data(db, start_date, end_date)


@api.get("/reports/pl/pdf")
async def pl_report_pdf(
    start_date: str,
    end_date: str,
    _: dict = Depends(require_admin),
):
    """Download a printable Profit & Loss PDF for the given range."""
    import pl_report
    from fastapi.responses import Response
    settings = await get_settings()
    brand_name = settings.get("brand_name") or "Sit Happens"
    data = await pl_report.build_pl_data(db, start_date, end_date)
    pdf_bytes = await asyncio.to_thread(pl_report.render_pl_pdf, data, brand_name)
    filename = f"PL_{start_date}_to_{end_date}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.post("/reports/pl/email-now")
async def pl_report_email_now(
    start_date: str,
    end_date: str,
    admin: dict = Depends(require_admin),
):
    """Generate the P&L PDF and email it to ADMIN_NOTIFICATION_EMAIL right now."""
    import pl_report
    settings = await get_settings()
    brand_name = settings.get("brand_name") or "Sit Happens"
    data = await pl_report.build_pl_data(db, start_date, end_date)
    pdf_bytes = await asyncio.to_thread(pl_report.render_pl_pdf, data, brand_name)
    try:
        await email_service.notify_admin_pl_report(pdf_bytes, start_date, end_date, data)
        return {"ok": True, "to": email_service.ADMIN_NOTIFICATION_EMAIL,
                "start_date": start_date, "end_date": end_date,
                "net": data["net"]}
    except Exception as e:
        logger.warning("PL email send failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Email send failed: {e}")


# ────────────────────────── Employees + Time Clock (Sprint 92) ──────────────────────────
# Employees are stored in the same `users` collection (role="employee") so
# auth/JWT logic stays consistent. Extra employee-only profile fields live
# alongside the standard ones (display_name, hourly_rate, active).
# Time clock entries live in `time_clock_entries`.

class EmployeeIn(BaseModel):
    email: EmailStr
    name: str
    display_name: Optional[str] = ""  # Short name shown on the run sheet / time card
    hourly_rate: float = 0.0
    active: bool = True
    phone: Optional[str] = ""
    notes: Optional[str] = ""
    is_owner: bool = False  # Sprint 110bf — exclude from payroll tax math (owner's draw)
    # Sprint 110bu — W-2 prep: tax classification + mailing address
    tax_status: Literal["w2", "1099", "other"] = "1099"
    address_street: Optional[str] = ""
    address_city: Optional[str] = ""
    address_state: Optional[str] = ""
    address_zip: Optional[str] = ""


class EmployeeCreateIn(EmployeeIn):
    password: str = Field(min_length=6)


class EmployeeOut(EmployeeIn):
    id: str
    role: str = "employee"
    created_at: Optional[str] = None
    last_login_at: Optional[str] = None


def _employee_doc_to_out(u: dict) -> dict:
    """Strip sensitive fields and shape a user doc as EmployeeOut."""
    return {
        "id": u["id"],
        "email": u.get("email", ""),
        "name": u.get("name", ""),
        "display_name": u.get("display_name", "") or u.get("name", ""),
        "hourly_rate": float(u.get("hourly_rate") or 0),
        "active": u.get("active", True),
        "phone": u.get("phone", ""),
        "notes": u.get("notes", ""),
        "is_owner": bool(u.get("is_owner", False)),
        "tax_status": u.get("tax_status") or "1099",
        "address_street": u.get("address_street", ""),
        "address_city": u.get("address_city", ""),
        "address_state": u.get("address_state", ""),
        "address_zip": u.get("address_zip", ""),
        "role": "employee",
        "created_at": u.get("created_at"),
        "last_login_at": u.get("last_login_at"),
    }


async def _get_owner_user_ids() -> set:
    """Return the set of user ids flagged as owner (single-owner enforced, but
    returned as a set for clean exclusion logic). Empty set when no owner."""
    rows = await db.users.find(
        {"role": "employee", "is_owner": True}, {"_id": 0, "id": 1}
    ).to_list(10)
    return {r["id"] for r in rows}


async def _enforce_single_owner(new_owner_id: Optional[str]) -> None:
    """When promoting an employee to owner, demote any previous owner so we
    never have two. Called from create/update employee."""
    if not new_owner_id:
        return
    await db.users.update_many(
        {"role": "employee", "is_owner": True, "id": {"$ne": new_owner_id}},
        {"$set": {"is_owner": False}},
    )


@api.get("/admin/employees")
async def list_employees(_: dict = Depends(require_admin)):
    rows = await db.users.find(
        {"role": "employee"}, {"_id": 0, "password_hash": 0}
    ).sort("name", 1).to_list(500)
    return [_employee_doc_to_out(u) for u in rows]


@api.post("/admin/employees", response_model=EmployeeOut)
async def create_employee(body: EmployeeCreateIn, _: dict = Depends(require_admin)):
    existing = await db.users.find_one({"email": body.email.lower()}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")
    doc = {
        "id": str(uuid.uuid4()),
        "email": body.email.lower(),
        "name": body.name,
        "display_name": body.display_name or body.name,
        "hourly_rate": float(body.hourly_rate or 0),
        "active": body.active,
        "phone": body.phone or "",
        "notes": body.notes or "",
        "is_owner": bool(body.is_owner),
        "tax_status": body.tax_status,
        "address_street": body.address_street or "",
        "address_city": body.address_city or "",
        "address_state": body.address_state or "",
        "address_zip": body.address_zip or "",
        "role": "employee",
        "password_hash": hash_password(body.password),
        "created_at": now_iso(),
        "login_count": 0,
    }
    await db.users.insert_one(doc)
    if doc["is_owner"]:
        await _enforce_single_owner(doc["id"])
    return _employee_doc_to_out(doc)


@api.put("/admin/employees/{user_id}", response_model=EmployeeOut)
async def update_employee(user_id: str, body: EmployeeIn, _: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": user_id, "role": "employee"}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Employee not found")
    update = {
        "email": body.email.lower(),
        "name": body.name,
        "display_name": body.display_name or body.name,
        "hourly_rate": float(body.hourly_rate or 0),
        "active": body.active,
        "phone": body.phone or "",
        "notes": body.notes or "",
        "is_owner": bool(body.is_owner),
        "tax_status": body.tax_status,
        "address_street": body.address_street or "",
        "address_city": body.address_city or "",
        "address_state": body.address_state or "",
        "address_zip": body.address_zip or "",
    }
    await db.users.update_one({"id": user_id}, {"$set": update})
    if update["is_owner"]:
        await _enforce_single_owner(user_id)
    u.update(update)
    return _employee_doc_to_out(u)


@api.post("/admin/employees/{user_id}/reset-password")
async def admin_reset_employee_password(user_id: str, body: dict, _: dict = Depends(require_admin)):
    new_pw = (body or {}).get("password", "")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    res = await db.users.update_one(
        {"id": user_id, "role": "employee"},
        {"$set": {"password_hash": hash_password(new_pw)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"ok": True}


@api.delete("/admin/employees/{user_id}")
async def deactivate_employee(user_id: str, _: dict = Depends(require_admin)):
    """Soft-deactivate (sets active=False). Never hard-delete so historical
    time-clock entries keep a referenceable owner."""
    res = await db.users.update_one(
        {"id": user_id, "role": "employee"}, {"$set": {"active": False}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"ok": True}


# ── Owner (sole-prop / self-pay) ──
@api.get("/admin/owner")
async def get_owner(_: dict = Depends(require_admin)):
    """Returns the single employee flagged as owner, or null."""
    row = await db.users.find_one(
        {"role": "employee", "is_owner": True},
        {"_id": 0, "password_hash": 0},
    )
    return {"owner": _employee_doc_to_out(row) if row else None}


@api.get("/admin/owner/draw-summary")
async def owner_draw_summary(_: dict = Depends(require_admin)):
    """Today / MTD / YTD draw for the owner: hours × hourly_rate."""
    row = await db.users.find_one(
        {"role": "employee", "is_owner": True},
        {"_id": 0, "id": 1, "name": 1, "display_name": 1, "hourly_rate": 1},
    )
    if not row:
        return {"owner": None}
    today = business_today()
    rate = float(row.get("hourly_rate") or 0)
    spans = {
        "today":     (f"{today.isoformat()}T00:00:00", f"{today.isoformat()}T23:59:59.999Z"),
        "month":     (f"{today.strftime('%Y-%m-01')}T00:00:00", f"{today.isoformat()}T23:59:59.999Z"),
        "year":      (f"{today.year}-01-01T00:00:00", f"{today.isoformat()}T23:59:59.999Z"),
    }
    out = {}
    now_dt = datetime.now(timezone.utc)
    for label, (s, e) in spans.items():
        # Settled hours: closed clock entries
        entries = await db.time_clock_entries.find(
            {"user_id": row["id"], "clock_in_at": {"$gte": s, "$lte": e},
             "clock_out_at": {"$ne": None, "$exists": True}},
            {"_id": 0, "hours": 1},
        ).to_list(10000)
        hrs = sum(float(x.get("hours") or 0) for x in entries)
        # Plus any currently-open shift projected to "now" (matches today-pnl)
        open_rows = await db.time_clock_entries.find(
            {"user_id": row["id"], "clock_in_at": {"$gte": s, "$lte": e},
             "$or": [{"clock_out_at": None}, {"clock_out_at": {"$exists": False}}]},
            {"_id": 0, "clock_in_at": 1, "break_minutes": 1},
        ).to_list(50)
        for r in open_rows:
            try:
                ci = datetime.fromisoformat((r.get("clock_in_at") or "").replace("Z", "+00:00"))
                br = float(r.get("break_minutes") or 0) / 60.0
                hrs += max(0.0, (now_dt - ci).total_seconds() / 3600.0 - br)
            except Exception:
                pass
        hrs = round(hrs, 2)
        out[label] = {"hours": hrs, "draw": round(hrs * rate, 2)}
    return {
        "owner": {
            "id": row["id"],
            "name": row.get("display_name") or row.get("name") or "Owner",
            "hourly_rate": rate,
        },
        **out,
    }


# ── Time clock ──
class ClockInIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    note: Optional[str] = ""


class ClockOutIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    break_minutes: Optional[float] = 0
    note: Optional[str] = ""


def _ensure_employee(user: dict) -> None:
    if user.get("role") not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="Staff access required")


@api.get("/time-clock/current")
async def time_clock_current(user: dict = Depends(require_employee_or_admin)):
    """Returns the currently-open clock entry for the calling user (or None)."""
    open_entry = await db.time_clock_entries.find_one(
        {"user_id": user["id"], "clock_out_at": None}, {"_id": 0}
    )
    return {"open": open_entry}


@api.post("/time-clock/clock-in")
async def time_clock_in(body: ClockInIn, user: dict = Depends(require_employee_or_admin)):
    # Prevent double clock-in
    existing = await db.time_clock_entries.find_one(
        {"user_id": user["id"], "clock_out_at": None}, {"_id": 0, "id": 1}
    )
    if existing:
        raise HTTPException(status_code=400, detail="You're already clocked in. Clock out first.")
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("display_name") or user.get("name", ""),
        "clock_in_at": now_iso(),
        "clock_in_lat": body.lat,
        "clock_in_lng": body.lng,
        "clock_in_accuracy_m": body.accuracy_m,
        "clock_in_note": (body.note or "").strip(),
        "clock_out_at": None,
        "break_minutes": 0,
        "hours": None,
        "created_at": now_iso(),
    }
    await db.time_clock_entries.insert_one(entry)
    entry.pop("_id", None)
    return entry


@api.post("/time-clock/clock-out")
async def time_clock_out(body: ClockOutIn, user: dict = Depends(require_employee_or_admin)):
    open_entry = await db.time_clock_entries.find_one(
        {"user_id": user["id"], "clock_out_at": None}, {"_id": 0}
    )
    if not open_entry:
        raise HTTPException(status_code=400, detail="No open clock-in to close.")
    out_iso = now_iso()
    ci = datetime.fromisoformat(open_entry["clock_in_at"].replace("Z", "+00:00"))
    co = datetime.fromisoformat(out_iso.replace("Z", "+00:00"))
    break_min = float(body.break_minutes or 0)
    hours = max((co - ci).total_seconds() / 3600.0 - (break_min / 60.0), 0.0)
    update = {
        "clock_out_at": out_iso,
        "clock_out_lat": body.lat,
        "clock_out_lng": body.lng,
        "clock_out_accuracy_m": body.accuracy_m,
        "clock_out_note": (body.note or "").strip(),
        "break_minutes": break_min,
        "hours": round(hours, 3),
    }
    await db.time_clock_entries.update_one({"id": open_entry["id"]}, {"$set": update})
    open_entry.update(update)
    return open_entry


@api.get("/time-clock/me")
async def time_clock_me(
    days: int = 30,
    user: dict = Depends(require_employee_or_admin),
):
    """Return the calling user's clock entries from the last N days plus totals.

    Sprint 110ba — adds pay calculations using the user's `hourly_rate`:
      • per-entry `gross` (hours × rate)
      • `total_gross` for the window
      • `this_week` / `last_week` totals (weekly period Sun → Sat)
      • `ytd_hours` / `ytd_gross` (calendar-year totals)
      • `live` block: if a shift is currently open, running hours + pay so far
    No-op friendly: when `hourly_rate` is unset, gross values come back as 0
    so the UI can fall back to hours-only.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
    entries = await db.time_clock_entries.find(
        {"user_id": user["id"], "clock_in_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("clock_in_at", -1).to_list(2000)
    me = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hourly_rate": 1, "name": 1, "display_name": 1, "email": 1}
    ) or {}
    rate = float(me.get("hourly_rate") or 0)

    def _gross(hrs: float) -> float:
        return round(float(hrs or 0) * rate, 2)

    # Annotate per-entry gross
    for e in entries:
        e["gross"] = _gross(e.get("hours"))
        e["hourly_rate"] = rate

    closed = [e for e in entries if e.get("clock_out_at") and e.get("hours") is not None]
    total_hours = round(sum(float(e["hours"]) for e in closed), 2)
    total_gross = round(total_hours * rate, 2)

    # Week boundary helper (Sunday start, Saturday end — U.S. payroll standard)
    today = business_today()
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    last_sunday = sunday - timedelta(days=7)
    last_saturday = sunday - timedelta(days=1)

    def _in_range(e, start_d: date, end_d: date) -> bool:
        try:
            d = datetime.fromisoformat((e.get("clock_in_at") or "").replace("Z", "+00:00")).date()
        except Exception:
            return False
        return start_d <= d <= end_d

    this_week_entries = [e for e in closed if _in_range(e, sunday, today)]
    last_week_entries = [e for e in closed if _in_range(e, last_sunday, last_saturday)]
    this_week_hours = round(sum(float(e["hours"]) for e in this_week_entries), 2)
    last_week_hours = round(sum(float(e["hours"]) for e in last_week_entries), 2)

    # YTD — query independently of the `days` window so it's accurate even
    # for short windows
    ytd_start = f"{today.year}-01-01T00:00:00"
    ytd = await db.time_clock_entries.find(
        {"user_id": user["id"], "clock_in_at": {"$gte": ytd_start},
         "clock_out_at": {"$ne": None, "$exists": True}, "hours": {"$ne": None}},
        {"_id": 0, "hours": 1},
    ).to_list(5000)
    ytd_hours = round(sum(float(r.get("hours") or 0) for r in ytd), 2)
    ytd_gross = round(ytd_hours * rate, 2)

    # Live running shift (if any)
    live = None
    open_entry = next((e for e in entries if not e.get("clock_out_at")), None)
    if open_entry:
        try:
            t_in = datetime.fromisoformat((open_entry["clock_in_at"] or "").replace("Z", "+00:00"))
            elapsed_hrs = max(0.0, (datetime.now(timezone.utc) - t_in).total_seconds() / 3600.0)
            br = float(open_entry.get("break_minutes") or 0) / 60.0
            elapsed_hrs = max(0.0, elapsed_hrs - br)
            hours_rounded = round(elapsed_hrs, 2)
            live = {
                "entry_id": open_entry["id"],
                "clock_in_at": open_entry["clock_in_at"],
                "hours_so_far": hours_rounded,
                "gross_so_far": round(hours_rounded * rate, 2),
            }
        except Exception:
            pass

    return {
        "entries": entries,
        "total_hours": total_hours,
        "total_gross": total_gross,
        "hourly_rate": rate,
        "days": days,
        "this_week": {
            "start": sunday.isoformat(),
            "end": today.isoformat(),
            "hours": this_week_hours,
            "gross": _gross(this_week_hours),
        },
        "last_week": {
            "start": last_sunday.isoformat(),
            "end": last_saturday.isoformat(),
            "hours": last_week_hours,
            "gross": _gross(last_week_hours),
        },
        "ytd": {"year": today.year, "hours": ytd_hours, "gross": ytd_gross},
        "live": live,
    }


# Sprint 110bb — Bulk pay snapshot of every employee for the admin's Staff
# list. Same math as /time-clock/me but loops across all active employees in
# a single round-trip so the admin can see labor pacing mid-week.
@api.get("/admin/staff/pay-snapshot")
async def staff_pay_snapshot(_: dict = Depends(require_admin)):
    employees = await db.users.find(
        {"role": "employee", "active": True},
        {"_id": 0, "id": 1, "name": 1, "display_name": 1, "email": 1, "hourly_rate": 1, "is_owner": 1},
    ).to_list(500)
    if not employees:
        return {"snapshot": [], "totals": {"this_week_hours": 0, "this_week_gross": 0, "ytd_gross": 0}}
    today = business_today()
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    last_sunday = sunday - timedelta(days=7)
    last_saturday = sunday - timedelta(days=1)
    ytd_start = f"{today.year}-01-01T00:00:00"
    uids = [u["id"] for u in employees]
    # YTD entries — one query for all employees
    rows = await db.time_clock_entries.find(
        {"user_id": {"$in": uids}, "clock_in_at": {"$gte": ytd_start}},
        {"_id": 0, "user_id": 1, "clock_in_at": 1, "clock_out_at": 1, "hours": 1, "break_minutes": 1},
    ).to_list(20000)
    by_user: Dict[str, Dict[str, Any]] = {}
    for u in employees:
        by_user[u["id"]] = {
            "user_id": u["id"],
            "name": u.get("display_name") or u.get("name") or u.get("email"),
            "email": u.get("email"),
            "hourly_rate": float(u.get("hourly_rate") or 0),
            "is_owner": bool(u.get("is_owner", False)),
            "this_week_hours": 0.0,
            "last_week_hours": 0.0,
            "ytd_hours": 0.0,
            "live": None,
        }
    for r in rows:
        slot = by_user.get(r.get("user_id"))
        if not slot:
            continue
        ci = r.get("clock_in_at") or ""
        co = r.get("clock_out_at")
        hrs = float(r.get("hours") or 0)
        # Closed entry: count it
        if co and hrs:
            try:
                d = datetime.fromisoformat(ci.replace("Z", "+00:00")).date()
            except Exception:
                continue
            slot["ytd_hours"] += hrs
            if sunday <= d <= today:
                slot["this_week_hours"] += hrs
            elif last_sunday <= d <= last_saturday:
                slot["last_week_hours"] += hrs
        elif not co:
            # Currently clocked in — build a live block
            try:
                t_in = datetime.fromisoformat(ci.replace("Z", "+00:00"))
                elapsed = max(0.0, (datetime.now(timezone.utc) - t_in).total_seconds() / 3600.0)
                br = float(r.get("break_minutes") or 0) / 60.0
                elapsed = max(0.0, elapsed - br)
                slot["live"] = {
                    "hours_so_far": round(elapsed, 2),
                    "gross_so_far": round(elapsed * slot["hourly_rate"], 2),
                    "clock_in_at": ci,
                }
            except Exception:
                pass
    snapshot = []
    for s in by_user.values():
        s["this_week_hours"] = round(s["this_week_hours"], 2)
        s["last_week_hours"] = round(s["last_week_hours"], 2)
        s["ytd_hours"] = round(s["ytd_hours"], 2)
        rate = s["hourly_rate"]
        s["this_week_gross"] = round(s["this_week_hours"] * rate, 2)
        s["last_week_gross"] = round(s["last_week_hours"] * rate, 2)
        s["ytd_gross"] = round(s["ytd_hours"] * rate, 2)
        snapshot.append(s)
    snapshot.sort(key=lambda x: -x["this_week_gross"])
    totals = {
        "this_week_hours": round(sum(s["this_week_hours"] for s in snapshot), 2),
        "this_week_gross": round(sum(s["this_week_gross"] for s in snapshot), 2),
        "ytd_gross": round(sum(s["ytd_gross"] for s in snapshot), 2),
        "currently_clocked_in": sum(1 for s in snapshot if s["live"]),
        "week_start": sunday.isoformat(),
        "week_end": today.isoformat(),
    }
    return {"snapshot": snapshot, "totals": totals}


# ─────────────────────────────────────────────────────────────────────────────
# Quarterly Tax Estimate (Sole-Proprietor / Schedule C)
# ─────────────────────────────────────────────────────────────────────────────
# Computes YTD net profit and projects annual federal SE + income tax + state +
# local tax for a Warren, OH sole proprietor. Defaults are reasonable 2026
# Schedule-C figures; the operator can override every rate from the UI.

QUARTERLY_TAX_DEFAULTS = {
    "se_tax_taxable_pct": 92.35,    # IRS allows 92.35% of net SE earnings to be taxed
    "ss_rate_pct": 12.4,            # Sole-prop pays both halves of Social Security
    "ss_wage_base": 176100.0,       # 2026 estimated SS wage base
    "medicare_rate_pct": 2.9,       # Sole-prop pays both halves of Medicare
    "federal_income_pct": 12.0,     # Effective rate guess (12% bracket sole-prop, married/single)
    "state_income_pct": 2.75,       # Ohio top effective
    "local_income_pct": 2.5,        # Warren city
    "estimated_payments_made": 0.0, # YTD federal quarterly payments already mailed in
    "mileage_rate_per_mile": 0.70,  # 2026 IRS standard mileage rate for business use
    "filing_status": "single",      # informational only
}


async def _get_quarterly_tax_settings() -> Dict[str, Any]:
    row = await db.app_settings.find_one({"_id": "quarterly_tax"}, {"_id": 0})
    if not row:
        row = dict(QUARTERLY_TAX_DEFAULTS)
        await db.app_settings.update_one(
            {"_id": "quarterly_tax"}, {"$set": row}, upsert=True
        )
        return row
    # Backfill missing keys so older docs still work after we add new fields
    patched = {**QUARTERLY_TAX_DEFAULTS, **row}
    return patched


def _quarter_for(month: int) -> int:
    return (month - 1) // 3 + 1


def _quarter_due_dates(year: int) -> List[Dict[str, str]]:
    """IRS estimated payment deadlines. Q4 deadline lands in *next* January."""
    return [
        {"quarter": 1, "due": f"{year}-04-15", "period": f"Jan 1 – Mar 31, {year}"},
        {"quarter": 2, "due": f"{year}-06-15", "period": f"Apr 1 – May 31, {year}"},
        {"quarter": 3, "due": f"{year}-09-15", "period": f"Jun 1 – Aug 31, {year}"},
        {"quarter": 4, "due": f"{year + 1}-01-15", "period": f"Sep 1 – Dec 31, {year}"},
    ]


@api.get("/admin/quarterly-tax")
async def admin_quarterly_tax(
    _: dict = Depends(require_admin),
    year: Optional[int] = None,
):
    """YTD sole-proprietor tax estimate.

    Income  = service bookings (status=completed) + retail sales
    Expense = recorded expenses + labor cost (gross wages + employer burden)
    Net     = income - expense
    SE Tax  = (Net × 92.35%) × (SS rate up to wage base + Medicare rate)
    Income  = (Net - 50% of SE) × (federal + state + local)
    """
    today = business_today()
    yr = int(year or today.year)
    start = f"{yr}-01-01"
    end = f"{yr}-12-31" if yr < today.year else today.isoformat()

    settings = await _get_quarterly_tax_settings()

    # ---- Income: bookings (completed) + retail sales --------------------------
    booking_rows = await db.bookings.find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    service_income = 0.0
    for r in booking_rows:
        if r.get("status") == "completed":
            service_income += float(r.get("actual_price") or 0)
    retail_rows = await db.retail_sales.find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    retail_income = sum(float(r.get("amount") or 0) for r in retail_rows)
    gross_income = service_income + retail_income

    # ---- Expenses: recorded + labor (gross + employer burden) ----------------
    expense_rows = await db.expenses.find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    recorded_expenses = sum(float(e.get("amount") or 0) for e in expense_rows)

    # ---- Mileage deduction (IRS standard rate × YTD business miles) ----------
    mileage_rate = float(settings.get("mileage_rate_per_mile") or 0)
    mileage_rows = await db.mileage_log.find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    mileage_ytd_miles = sum(float(m.get("miles") or 0) for m in mileage_rows)
    mileage_deduction_ytd = round(mileage_ytd_miles * mileage_rate, 2)

    # Labor: total YTD gross + employer burden (mirrors summary_range pattern)
    payroll_tax = await _get_payroll_tax_settings()
    tc_entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{start}T00:00:00",
                         "$lte": f"{end}T23:59:59.999Z"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(50000)
    uids = list({e["user_id"] for e in tc_entries})
    rate_users = await db.users.find(
        {"id": {"$in": uids}}, {"_id": 0, "id": 1, "hourly_rate": 1, "is_owner": 1}
    ).to_list(500) if uids else []
    rate_map = {u["id"]: float(u.get("hourly_rate") or 0) for u in rate_users}
    owner_ids = {u["id"] for u in rate_users if u.get("is_owner")}
    hours_by_user: Dict[str, float] = {}
    for e in tc_entries:
        hours_by_user[e["user_id"]] = hours_by_user.get(e["user_id"], 0) + float(e.get("hours") or 0)
    labor_gross = 0.0
    labor_burden = 0.0
    owner_draw_ytd = 0.0
    owner_draw_hours = 0.0
    for uid, hrs in hours_by_user.items():
        rate = rate_map.get(uid, 0.0)
        if uid in owner_ids:
            # Owner's pay is a DRAW (out of net profit) — never an expense
            # and never subject to employer payroll tax burden.
            owner_draw_ytd += hrs * rate
            owner_draw_hours += hrs
            continue
        c = _compute_payroll_tax(hrs, rate, 0.0, payroll_tax)
        labor_gross += c["gross"]
        labor_burden += c["employer_burden"]
    labor_total = labor_gross + labor_burden
    total_expenses = recorded_expenses + labor_total + mileage_deduction_ytd

    net_profit = gross_income - total_expenses

    # ---- SE tax --------------------------------------------------------------
    se_taxable = max(0.0, net_profit) * (float(settings["se_tax_taxable_pct"]) / 100.0)
    ss_taxable = min(se_taxable, float(settings["ss_wage_base"]))
    ss_tax = ss_taxable * (float(settings["ss_rate_pct"]) / 100.0)
    medicare_tax = se_taxable * (float(settings["medicare_rate_pct"]) / 100.0)
    se_tax = ss_tax + medicare_tax

    # ---- Income tax (federal + state + local) --------------------------------
    se_deduction = se_tax * 0.5  # half of SE is deductible above the line
    taxable_income = max(0.0, net_profit - se_deduction)
    federal_tax = taxable_income * (float(settings["federal_income_pct"]) / 100.0)
    state_tax = taxable_income * (float(settings["state_income_pct"]) / 100.0)
    local_tax = taxable_income * (float(settings["local_income_pct"]) / 100.0)
    income_tax_total = federal_tax + state_tax + local_tax

    total_tax_ytd = se_tax + income_tax_total
    estimated_payments = float(settings.get("estimated_payments_made") or 0)
    balance_owed_ytd = max(0.0, total_tax_ytd - estimated_payments)

    # ---- Quarterly breakdown -------------------------------------------------
    # Split YTD owed evenly into 4 buckets. Mark quarters that are "past due"
    # vs "upcoming" based on today's calendar quarter.
    quarters = _quarter_due_dates(yr)
    per_quarter = round(total_tax_ytd / 4.0, 2)
    current_q = _quarter_for(today.month) if yr == today.year else 4
    for q in quarters:
        q["suggested_payment"] = per_quarter
        q["status"] = (
            "current" if q["quarter"] == current_q
            else "past" if q["quarter"] < current_q
            else "upcoming"
        )
    next_q = next((q for q in quarters if q["status"] in ("current", "upcoming")), quarters[-1])

    # Recorded payments override the legacy settings field — sum what's been
    # actually logged via /admin/quarterly-tax/payments for this tax year.
    pay_rows = await db.tax_payments.find({"year": yr}, {"_id": 0}).to_list(500)
    recorded_payments_total = round(sum(float(p.get("amount") or 0) for p in pay_rows), 2)
    by_quarter_paid: Dict[int, float] = {}
    for p in pay_rows:
        q_idx = int(p.get("quarter") or 0)
        if q_idx:
            by_quarter_paid[q_idx] = round(by_quarter_paid.get(q_idx, 0) + float(p.get("amount") or 0), 2)
    for q in quarters:
        q["paid"] = by_quarter_paid.get(q["quarter"], 0.0)
        q["remaining"] = round(max(0.0, q["suggested_payment"] - q["paid"]), 2)

    # Use the larger of: legacy setting OR recorded payments (recorded wins
    # if any payment has been logged, otherwise the settings value still works
    # so the operator can simply type a number if they don't want to log
    # individual payments).
    payments_applied = recorded_payments_total if recorded_payments_total > 0 else estimated_payments
    balance_owed_ytd = max(0.0, total_tax_ytd - payments_applied)

    return {
        "year": yr,
        "as_of": today.isoformat(),
        "period": {"start": start, "end": end},
        "income": {
            "service_bookings": round(service_income, 2),
            "retail_sales": round(retail_income, 2),
            "gross": round(gross_income, 2),
        },
        "expenses": {
            "recorded": round(recorded_expenses, 2),
            "labor_gross": round(labor_gross, 2),
            "labor_burden": round(labor_burden, 2),
            "labor_total": round(labor_total, 2),
            "mileage_miles": round(mileage_ytd_miles, 1),
            "mileage_deduction": mileage_deduction_ytd,
            "mileage_rate": round(mileage_rate, 3),
            "total": round(total_expenses, 2),
        },
        "net_profit": round(net_profit, 2),
        "owner_draw_ytd": round(owner_draw_ytd, 2),
        "owner_draw_hours": round(owner_draw_hours, 2),
        "se_tax": {
            "taxable_base": round(se_taxable, 2),
            "social_security": round(ss_tax, 2),
            "medicare": round(medicare_tax, 2),
            "total": round(se_tax, 2),
            "deductible_half": round(se_deduction, 2),
        },
        "income_tax": {
            "taxable_income": round(taxable_income, 2),
            "federal": round(federal_tax, 2),
            "state": round(state_tax, 2),
            "local": round(local_tax, 2),
            "total": round(income_tax_total, 2),
        },
        "total_tax_ytd": round(total_tax_ytd, 2),
        "estimated_payments_made": round(estimated_payments, 2),
        "recorded_payments_total": recorded_payments_total,
        "payments_applied": round(payments_applied, 2),
        "balance_owed_ytd": round(balance_owed_ytd, 2),
        "quarters": quarters,
        "current_quarter": current_q,
        "next_quarter_due": next_q,
        "settings": settings,
        "disclaimer": (
            "Estimator only. Sole-proprietor Schedule C math with 2026 default "
            "rates. Adjust federal/state/local % to match your actual bracket. "
            "Not a substitute for a CPA."
        ),
    }


@api.put("/admin/quarterly-tax/settings")
async def admin_quarterly_tax_settings(
    body: Dict[str, Any] = Body(...),
    _: dict = Depends(require_admin),
):
    """Save the configurable quarterly-tax rates (federal %, state %, local %,
    SS wage base, estimated payments already made, etc.). Only known keys are
    persisted so we don't accidentally store typos from the client."""
    allowed = set(QUARTERLY_TAX_DEFAULTS.keys())
    patch = {k: v for k, v in (body or {}).items() if k in allowed}
    if not patch:
        raise HTTPException(400, "No valid fields to update.")
    # Coerce numerics
    for k, v in list(patch.items()):
        if k == "filing_status":
            patch[k] = str(v or "single").strip().lower()
        else:
            try:
                patch[k] = float(v)
            except Exception:
                raise HTTPException(400, f"Invalid number for {k}")
    await db.app_settings.update_one(
        {"_id": "quarterly_tax"}, {"$set": patch}, upsert=True
    )
    return {"ok": True, "settings": await _get_quarterly_tax_settings(),
            "defaults": dict(QUARTERLY_TAX_DEFAULTS)}


@api.get("/admin/quarterly-tax/settings")
async def admin_quarterly_tax_settings_get(_: dict = Depends(require_admin)):
    return {
        "current": await _get_quarterly_tax_settings(),
        "defaults": dict(QUARTERLY_TAX_DEFAULTS),
    }


# ─── Recorded tax payments (one-click "Mark Quarter Paid" tracker) ────────────
class TaxPaymentIn(BaseModel):
    year: int
    quarter: int                       # 1-4
    amount: float
    payment_date: Optional[str] = None  # ISO date; defaults to today
    payment_method: Optional[str] = "EFTPS"  # or "Check", "Card", etc.
    memo: Optional[str] = ""


@api.get("/admin/quarterly-tax/payments")
async def list_tax_payments(
    _: dict = Depends(require_admin),
    year: Optional[int] = None,
):
    q: Dict[str, Any] = {}
    if year:
        q["year"] = int(year)
    rows = await db.tax_payments.find(q, {"_id": 0}).sort([("payment_date", -1)]).to_list(2000)
    total = round(sum(float(r.get("amount") or 0) for r in rows), 2)
    return {"payments": rows, "total": total}


@api.post("/admin/quarterly-tax/payments")
async def add_tax_payment(
    body: TaxPaymentIn,
    _: dict = Depends(require_admin),
):
    if body.quarter not in (1, 2, 3, 4):
        raise HTTPException(400, "quarter must be 1-4")
    if body.amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    doc = {
        "id": str(uuid.uuid4()),
        "year": int(body.year),
        "quarter": int(body.quarter),
        "amount": round(float(body.amount), 2),
        "payment_date": body.payment_date or business_today().isoformat(),
        "payment_method": (body.payment_method or "EFTPS").strip(),
        "memo": (body.memo or "").strip(),
        "created_at": now_iso(),
    }
    await db.tax_payments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/admin/quarterly-tax/payments/{pid}")
async def delete_tax_payment(pid: str, _: dict = Depends(require_admin)):
    res = await db.tax_payments.delete_one({"id": pid})
    if not res.deleted_count:
        raise HTTPException(404, "Payment not found")
    return {"ok": True}


# ─── Sprint 110bq · Business mileage log (IRS Schedule C deduction) ──────────
# Tracks daily business miles. Sum × `mileage_rate_per_mile` becomes a deduction
# inside admin_quarterly_tax. Quick-log widget on Dashboard.

class MileageIn(BaseModel):
    miles: float = Field(gt=0, le=2000)
    date: Optional[str] = None       # ISO YYYY-MM-DD, defaults to today_local
    purpose: Optional[str] = ""      # "client pickup", "supply run", etc.
    destination: Optional[str] = ""  # free-text


@api.get("/admin/mileage")
async def list_mileage(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """Return mileage rows in the window. Defaults to current calendar year."""
    today = business_today()
    sd = start_date or f"{today.year}-01-01"
    ed = end_date or today.isoformat()
    q = {"date": {"$gte": sd, "$lte": ed}}
    rows = await db.mileage_log.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(2000)
    return {"rows": rows, "range": {"start": sd, "end": ed}}


@api.get("/admin/mileage/recent-trips")
async def mileage_recent_trips(_: dict = Depends(require_admin)):
    """Return the most-recent unique (purpose, destination) pairs across all
    history. Used by the Dashboard widget to one-tap-fill repeat trips."""
    # Pull most-recent 500 entries (more than enough to dedupe down to 10 unique)
    rows = await db.mileage_log.find(
        {}, {"_id": 0, "purpose": 1, "destination": 1, "miles": 1, "created_at": 1}
    ).sort([("created_at", -1)]).to_list(500)
    seen = set()
    out: List[dict] = []
    for r in rows:
        purpose = (r.get("purpose") or "").strip()
        dest = (r.get("destination") or "").strip()
        if not purpose and not dest:
            continue
        key = (purpose.lower(), dest.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "purpose": purpose,
            "destination": dest,
            "last_miles": float(r.get("miles") or 0),
        })
        if len(out) >= 10:
            break
    return {"trips": out}



@api.get("/admin/mileage/summary")
async def mileage_summary(
    year: Optional[int] = None,
    _: dict = Depends(require_admin),
):
    """Quick tiles for the Dashboard: today / month-to-date / YTD totals."""
    today = business_today()
    yr = int(year or today.year)
    settings = await _get_quarterly_tax_settings()
    rate = float(settings.get("mileage_rate_per_mile") or 0)

    today_iso = today.isoformat()
    month_start = f"{today.year}-{today.month:02d}-01"
    year_start = f"{yr}-01-01"
    year_end = f"{yr}-12-31"

    # Pull every row in the relevant year — small enough to aggregate in Python
    rows = await db.mileage_log.find(
        {"date": {"$gte": year_start, "$lte": year_end}}, {"_id": 0}
    ).to_list(20000)
    today_miles = sum(float(r.get("miles") or 0) for r in rows if r.get("date") == today_iso)
    mtd_miles = sum(float(r.get("miles") or 0) for r in rows if r.get("date", "") >= month_start)
    ytd_miles = sum(float(r.get("miles") or 0) for r in rows)

    # Combined marginal tax rate so we can show "real dollars saved" per trip.
    # Formula mirrors the quarterly-tax math:
    #   SE rate effective on profit  = se_taxable_pct × (SS + Medicare)
    #   Income tax on profit         = (federal + state + local) × (1 − ½ × SE rate)
    # Sum = total tax saved per $1 deducted. Good enough for a motivation chip.
    se_taxable = float(settings.get("se_tax_taxable_pct", 92.35)) / 100.0
    ss_rate = float(settings.get("ss_rate_pct", 12.4)) / 100.0
    medi_rate = float(settings.get("medicare_rate_pct", 2.9)) / 100.0
    fed = float(settings.get("federal_income_pct", 12.0)) / 100.0
    state = float(settings.get("state_income_pct", 2.75)) / 100.0
    local = float(settings.get("local_income_pct", 2.5)) / 100.0
    se_effective = se_taxable * (ss_rate + medi_rate)
    income_effective = (fed + state + local) * (1.0 - 0.5 * se_effective)
    combined_rate = se_effective + income_effective  # roughly 0.30 – 0.35 for sole-prop

    today_ded = today_miles * rate
    mtd_ded = mtd_miles * rate
    ytd_ded = ytd_miles * rate
    return {
        "today_miles": round(today_miles, 1),
        "today_deduction": round(today_ded, 2),
        "today_tax_savings": round(today_ded * combined_rate, 2),
        "mtd_miles": round(mtd_miles, 1),
        "mtd_deduction": round(mtd_ded, 2),
        "mtd_tax_savings": round(mtd_ded * combined_rate, 2),
        "ytd_miles": round(ytd_miles, 1),
        "ytd_deduction": round(ytd_ded, 2),
        "ytd_tax_savings": round(ytd_ded * combined_rate, 2),
        "rate_per_mile": round(rate, 3),
        "combined_tax_rate_pct": round(combined_rate * 100, 1),
        "entry_count_ytd": len(rows),
        "year": yr,
    }


@api.post("/admin/mileage")
async def create_mileage(body: MileageIn, user: dict = Depends(require_admin)):
    today_iso = business_today().isoformat()
    date_str = (body.date or today_iso).strip()
    # Sanity: only accept YYYY-MM-DD
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Date must be YYYY-MM-DD")
    doc = {
        "id": str(uuid.uuid4()),
        "date": date_str,
        "miles": round(float(body.miles), 2),
        "purpose": (body.purpose or "").strip()[:200],
        "destination": (body.destination or "").strip()[:200],
        "created_at": now_iso(),
        "created_by": user.get("id"),
    }
    await db.mileage_log.insert_one(doc)
    doc.pop("_id", None)
    return doc


class MileagePatch(BaseModel):
    miles: Optional[float] = None
    date: Optional[str] = None
    purpose: Optional[str] = None
    destination: Optional[str] = None


@api.put("/admin/mileage/{mid}")
async def update_mileage(mid: str, body: MileagePatch, _: dict = Depends(require_admin)):
    existing = await db.mileage_log.find_one({"id": mid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Mileage entry not found")
    update: Dict[str, Any] = {}
    if body.miles is not None:
        if body.miles <= 0 or body.miles > 2000:
            raise HTTPException(400, "Miles must be > 0 and ≤ 2000")
        update["miles"] = round(float(body.miles), 2)
    if body.date is not None:
        try:
            datetime.strptime(body.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "Date must be YYYY-MM-DD")
        update["date"] = body.date
    if body.purpose is not None:
        update["purpose"] = body.purpose.strip()[:200]
    if body.destination is not None:
        update["destination"] = body.destination.strip()[:200]
    if update:
        await db.mileage_log.update_one({"id": mid}, {"$set": update})
        existing.update(update)
    return existing


@api.delete("/admin/mileage/{mid}")
async def delete_mileage(mid: str, _: dict = Depends(require_admin)):
    res = await db.mileage_log.delete_one({"id": mid})
    if not res.deleted_count:
        raise HTTPException(404, "Mileage entry not found")
    return {"ok": True}


@api.get("/admin/quarterly-tax/cpa.pdf")
async def quarterly_tax_cpa_pdf(
    year: Optional[int] = None,
    _: dict = Depends(require_admin),
):
    """One-page Schedule C summary PDF for the operator's CPA. Pulls the
    same numbers as the Quarterly Tax tab plus expense-by-category and the
    full list of recorded payments for the year."""
    from cpa_report import render_cpa_pdf  # local import — keeps cold-start lean

    # Reuse the live estimator math by calling it directly. The function reads
    # from `db` (closure) so we get exactly what the UI sees.
    payload = await admin_quarterly_tax(_=_, year=year)  # type: ignore[arg-type]

    yr = int(payload["year"])
    start = payload["period"]["start"]
    end = payload["period"]["end"]

    # Expenses grouped by category for the period
    exp_rows = await db.expenses.find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    cat_buckets: Dict[str, Dict[str, Any]] = {}
    for e in exp_rows:
        cat = (e.get("category") or "Uncategorized").strip() or "Uncategorized"
        b = cat_buckets.setdefault(cat, {"name": cat, "count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] = round(b["total"] + float(e.get("amount") or 0), 2)
    expenses_by_category = list(cat_buckets.values())

    # Recorded quarterly payments for the year (oldest → newest)
    payments = await db.tax_payments.find(
        {"year": yr}, {"_id": 0},
    ).sort("payment_date", 1).to_list(2000)

    # Brand from settings if available
    settings_row = await db.app_settings.find_one({"_id": "brand"}, {"_id": 0}) or {}
    brand_name = settings_row.get("name") or "Sit Happens"

    pdf_bytes = render_cpa_pdf(payload, expenses_by_category, payments, brand_name=brand_name)
    fname = f"cpa-tax-summary-{yr}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─── Time-off requests (employee submits, admin approves) ─────────────────────
TIME_OFF_TYPES = {"vacation", "sick", "personal", "unpaid", "other"}
TIME_OFF_STATUSES = {"pending", "approved", "rejected", "cancelled"}


class TimeOffIn(BaseModel):
    start_date: str
    end_date: str
    request_type: str = "vacation"
    reason: Optional[str] = ""


class TimeOffReview(BaseModel):
    status: str           # "approved" | "rejected"
    admin_notes: Optional[str] = ""


@api.get("/employee/time-off")
async def employee_list_time_off(user: dict = Depends(require_employee_or_admin)):
    rows = await db.time_off_requests.find(
        {"user_id": user["id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {"requests": rows}


@api.post("/employee/time-off")
async def employee_submit_time_off(
    body: TimeOffIn,
    user: dict = Depends(require_employee_or_admin),
):
    if body.start_date > body.end_date:
        raise HTTPException(400, "start_date must be on or before end_date")
    if body.request_type not in TIME_OFF_TYPES:
        raise HTTPException(400, f"request_type must be one of {sorted(TIME_OFF_TYPES)}")
    # Try to look up the requester's display name for admin lists
    me = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "name": 1, "display_name": 1, "email": 1}
    ) or {}
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": me.get("display_name") or me.get("name") or me.get("email") or "Employee",
        "start_date": body.start_date,
        "end_date": body.end_date,
        "request_type": body.request_type,
        "reason": (body.reason or "").strip(),
        "status": "pending",
        "created_at": now_iso(),
        "reviewed_at": None,
        "reviewed_by": None,
        "admin_notes": "",
    }
    await db.time_off_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/employee/time-off/{rid}")
async def employee_cancel_time_off(
    rid: str,
    user: dict = Depends(require_employee_or_admin),
):
    row = await db.time_off_requests.find_one({"id": rid}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Request not found")
    if row.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(403, "Not your request")
    if row.get("status") not in ("pending",):
        raise HTTPException(400, "Only pending requests can be cancelled")
    await db.time_off_requests.update_one(
        {"id": rid}, {"$set": {"status": "cancelled", "reviewed_at": now_iso()}}
    )
    return {"ok": True}


@api.get("/admin/time-off")
async def admin_list_time_off(
    _: dict = Depends(require_admin),
    status: Optional[str] = None,
):
    q: Dict[str, Any] = {}
    if status:
        if status not in TIME_OFF_STATUSES:
            raise HTTPException(400, f"status must be one of {sorted(TIME_OFF_STATUSES)}")
        q["status"] = status
    rows = await db.time_off_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {
        "requests": rows,
        "pending_count": sum(1 for r in rows if r.get("status") == "pending"),
    }


@api.put("/admin/time-off/{rid}")
async def admin_review_time_off(
    rid: str,
    body: TimeOffReview,
    admin: dict = Depends(require_admin),
):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "status must be 'approved' or 'rejected'")
    res = await db.time_off_requests.update_one(
        {"id": rid},
        {"$set": {
            "status": body.status,
            "reviewed_at": now_iso(),
            "reviewed_by": admin["id"],
            "admin_notes": (body.admin_notes or "").strip(),
        }},
    )
    if not res.matched_count:
        raise HTTPException(404, "Request not found")
    return await db.time_off_requests.find_one({"id": rid}, {"_id": 0})


# ─── Weekly pay history (last N weeks) ────────────────────────────────────────
@api.get("/employee/pay-history")
async def employee_pay_history(
    weeks: int = 12,
    user: dict = Depends(require_employee_or_admin),
):
    """Returns the calling employee's per-week pay summary for the last `weeks`
    weeks (Sunday-anchored). Each row: { week_start, week_end, hours, gross,
    days_worked }. Helpful for trend charts in the staff portal."""
    weeks = max(1, min(int(weeks), 52))
    me = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hourly_rate": 1}
    ) or {}
    rate = float(me.get("hourly_rate") or 0)
    today = business_today()
    # Anchor on Sunday (weekday() returns Mon=0..Sun=6 ⇒ Sunday = (wd+1) % 7 days back)
    days_back_to_sunday = (today.weekday() + 1) % 7
    current_sunday = today - timedelta(days=days_back_to_sunday)
    earliest_sunday = current_sunday - timedelta(weeks=weeks - 1)
    cutoff = f"{earliest_sunday.isoformat()}T00:00:00"
    entries = await db.time_clock_entries.find(
        {"user_id": user["id"], "clock_in_at": {"$gte": cutoff},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "clock_in_at": 1, "hours": 1},
    ).to_list(10000)

    # Bucket by week-start (Sunday) date
    buckets: Dict[str, Dict[str, Any]] = {}
    for w in range(weeks):
        wk_start = current_sunday - timedelta(weeks=weeks - 1 - w)
        wk_end = wk_start + timedelta(days=6)
        buckets[wk_start.isoformat()] = {
            "week_start": wk_start.isoformat(),
            "week_end": wk_end.isoformat(),
            "hours": 0.0,
            "gross": 0.0,
            "days_worked": set(),
        }
    for e in entries:
        try:
            ci = datetime.fromisoformat((e["clock_in_at"]).replace("Z", "+00:00")).date()
        except Exception:
            continue
        wk_start = ci - timedelta(days=(ci.weekday() + 1) % 7)
        key = wk_start.isoformat()
        if key not in buckets:
            continue  # outside requested window
        h = float(e.get("hours") or 0)
        buckets[key]["hours"] += h
        buckets[key]["gross"] += h * rate
        buckets[key]["days_worked"].add(ci.isoformat())

    rows = []
    for v in buckets.values():
        rows.append({
            "week_start": v["week_start"],
            "week_end": v["week_end"],
            "hours": round(v["hours"], 2),
            "gross": round(v["gross"], 2),
            "days_worked": len(v["days_worked"]),
        })
    rows.sort(key=lambda r: r["week_start"])  # oldest → newest for chart-friendliness
    total_hours = round(sum(r["hours"] for r in rows), 2)
    total_gross = round(sum(r["gross"] for r in rows), 2)
    best = max(rows, key=lambda r: r["gross"], default=None)
    return {
        "weeks": rows,
        "hourly_rate": rate,
        "total_hours": total_hours,
        "total_gross": total_gross,
        "best_week": best,
    }


@api.get("/time-clock/me.csv")
async def time_clock_me_csv(
    days: int = 90,
    user: dict = Depends(require_employee_or_admin),
):
    """Download a CSV of the caller's own timecard for the last `days` days.
    Includes per-entry gross pay. Handy for staff to keep their own records."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
    entries = await db.time_clock_entries.find(
        {"user_id": user["id"], "clock_in_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("clock_in_at", 1).to_list(5000)
    me = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hourly_rate": 1, "name": 1, "display_name": 1, "email": 1}
    ) or {}
    rate = float(me.get("hourly_rate") or 0)
    buf = io.StringIO()
    w = csv.writer(buf)
    name = me.get("display_name") or me.get("name") or me.get("email") or "Me"
    w.writerow([f"Timecard — {name} — last {days} days"])
    w.writerow([f"Hourly rate: ${rate:.2f}"])
    w.writerow([])
    w.writerow(["Date", "Clock-in", "Clock-out", "Break (min)", "Hours", "Gross ($)"])
    grand_h = 0.0
    for e in entries:
        date_str = (e.get("clock_in_at") or "")[:10]
        hrs = float(e.get("hours") or 0)
        grand_h += hrs
        w.writerow([
            date_str,
            e.get("clock_in_at", ""),
            e.get("clock_out_at", "") or "",
            int(e.get("break_minutes") or 0),
            f"{hrs:.2f}",
            f"{hrs * rate:.2f}",
        ])
    w.writerow([])
    w.writerow(["TOTAL", "", "", "", f"{grand_h:.2f}", f"{grand_h * rate:.2f}"])
    buf.seek(0)
    fname = f"timecard-{name.replace(' ', '_')}-{business_today().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@api.get("/admin/time-clock")
async def admin_time_clock_list(
    start_date: str,
    end_date: str,
    user_id: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """Admin view: all clock entries in a date window, optionally filtered to one employee.
    Returns entries + per-employee subtotals + grand total + estimated payroll cost."""
    q: Dict[str, Any] = {
        "clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"}
    }
    if user_id:
        q["user_id"] = user_id
    entries = await db.time_clock_entries.find(q, {"_id": 0}).sort("clock_in_at", -1).to_list(5000)
    # Pull rate per user for payroll cost
    user_ids = list({e["user_id"] for e in entries})
    users = await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "display_name": 1, "hourly_rate": 1}
    ).to_list(1000) if user_ids else []
    user_map = {u["id"]: u for u in users}

    per_user: Dict[str, Dict[str, Any]] = {}
    grand_hours = 0.0
    grand_cost = 0.0
    for e in entries:
        u = user_map.get(e["user_id"], {})
        name = u.get("display_name") or u.get("name") or "Unknown"
        rate = float(u.get("hourly_rate") or 0)
        slot = per_user.setdefault(e["user_id"], {
            "user_id": e["user_id"], "name": name, "hourly_rate": rate,
            "hours": 0.0, "cost": 0.0, "entry_count": 0,
        })
        hrs = float(e.get("hours") or 0)
        slot["hours"] = round(slot["hours"] + hrs, 2)
        slot["cost"] = round(slot["cost"] + hrs * rate, 2)
        slot["entry_count"] += 1
        grand_hours += hrs
        grand_cost += hrs * rate
    return {
        "start_date": start_date,
        "end_date": end_date,
        "entries": entries,
        "per_user": sorted(per_user.values(), key=lambda x: -x["hours"]),
        "grand_hours": round(grand_hours, 2),
        "grand_cost": round(grand_cost, 2),
    }


class TimeClockEditIn(BaseModel):
    clock_in_at: Optional[str] = None
    clock_out_at: Optional[str] = None
    break_minutes: Optional[float] = None
    note: Optional[str] = None


@api.put("/admin/time-clock/{entry_id}")
async def admin_edit_time_clock(
    entry_id: str, body: TimeClockEditIn, admin: dict = Depends(require_admin),
):
    """Admin override — fix a missed clock-out, adjust times, etc. Stamps edit metadata."""
    entry = await db.time_clock_entries.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    update: Dict[str, Any] = {
        "edited_by_admin_at": now_iso(),
        "edited_by_admin_id": admin["id"],
    }
    if body.clock_in_at is not None:
        update["clock_in_at"] = body.clock_in_at
    if body.clock_out_at is not None:
        update["clock_out_at"] = body.clock_out_at
    if body.break_minutes is not None:
        update["break_minutes"] = float(body.break_minutes)
    if body.note is not None:
        update["admin_note"] = body.note
    # Recompute hours
    ci_raw = update.get("clock_in_at", entry.get("clock_in_at"))
    co_raw = update.get("clock_out_at", entry.get("clock_out_at"))
    brk = update.get("break_minutes", entry.get("break_minutes") or 0)
    if ci_raw and co_raw:
        try:
            ci = datetime.fromisoformat(ci_raw.replace("Z", "+00:00"))
            co = datetime.fromisoformat(co_raw.replace("Z", "+00:00"))
            update["hours"] = round(max((co - ci).total_seconds() / 3600.0 - (float(brk) / 60.0), 0.0), 3)
        except Exception:
            pass
    await db.time_clock_entries.update_one({"id": entry_id}, {"$set": update})
    entry.update(update)
    return entry


@api.delete("/admin/time-clock/{entry_id}")
async def admin_delete_time_clock(entry_id: str, _: dict = Depends(require_admin)):
    res = await db.time_clock_entries.delete_one({"id": entry_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}


# ── Employee-portal helpers (read-only data the staff need to do their job) ──
@api.get("/employee/me")
async def employee_me(user: dict = Depends(require_employee_or_admin)):
    """Self-profile + today's clock status for the employee dashboard."""
    open_entry = await db.time_clock_entries.find_one(
        {"user_id": user["id"], "clock_out_at": None}, {"_id": 0}
    )
    today = business_today().isoformat()
    today_entries = await db.time_clock_entries.find(
        {"user_id": user["id"], "clock_in_at": {"$gte": f"{today}T00:00:00"}},
        {"_id": 0},
    ).sort("clock_in_at", -1).to_list(50)
    today_hours = round(sum(float(e.get("hours") or 0) for e in today_entries if e.get("clock_out_at")), 2)
    return {
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "name": user.get("name"),
            "display_name": user.get("display_name") or user.get("name"),
            "role": user.get("role"),
            "hourly_rate": float(user.get("hourly_rate") or 0),
        },
        "open_entry": open_entry,
        "today_entries": today_entries,
        "today_hours": today_hours,
    }


# ────────────────────────── Shifts + Tasks (Sprint 93 — Phase 2 & 3) ──────────────────────────
# Schema:
#   shift_templates: {id, user_id, day_of_week (0=Mon..6=Sun), start_time HH:MM, end_time HH:MM, role, active}
#   shifts:           {id, user_id, date (YYYY-MM-DD), start_time, end_time, source ("template"|"manual"),
#                      template_id, notes, status, created_by, created_at}
#   tasks:            {id, kind ("todo"|"vaccine_review"), title, description, ref_id, ref_label,
#                      assigned_to, status ("open"|"in_progress"|"done"|"cancelled"),
#                      due_at, created_by, claimed_at, completed_at, completed_by, created_at}
#   bookings.assigned_to: optional employee user_id (for run-sheet ownership)
#   dogs.vaccine_certs.{vac}.assigned_to: optional employee user_id

VARIANCE_FLAG_MINUTES = 30  # |scheduled - actual| > this many minutes flips a "flag"


class ShiftTemplateIn(BaseModel):
    user_id: str
    day_of_week: int = Field(ge=0, le=6)  # 0=Mon..6=Sun
    start_time: str  # HH:MM
    end_time: str
    role: Optional[str] = ""
    active: bool = True


class ShiftIn(BaseModel):
    user_id: str
    date: str  # YYYY-MM-DD
    start_time: str
    end_time: str
    role: Optional[str] = ""
    notes: Optional[str] = ""


@api.get("/admin/shift-templates")
async def list_shift_templates(_: dict = Depends(require_admin)):
    rows = await db.shift_templates.find({}, {"_id": 0}).sort([("user_id", 1), ("day_of_week", 1)]).to_list(500)
    return rows


@api.post("/admin/shift-templates")
async def create_shift_template(body: ShiftTemplateIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.shift_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/admin/shift-templates/{tid}")
async def update_shift_template(tid: str, body: ShiftTemplateIn, _: dict = Depends(require_admin)):
    res = await db.shift_templates.update_one({"id": tid}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


@api.delete("/admin/shift-templates/{tid}")
async def delete_shift_template(tid: str, _: dict = Depends(require_admin)):
    await db.shift_templates.delete_one({"id": tid})
    return {"ok": True}


@api.get("/admin/shifts")
async def list_shifts(
    start_date: str,
    end_date: str,
    user_id: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    q: Dict[str, Any] = {"date": {"$gte": start_date, "$lte": end_date}}
    if user_id:
        q["user_id"] = user_id
    rows = await db.shifts.find(q, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).to_list(2000)
    return rows


@api.post("/admin/shifts")
async def create_shift(body: ShiftIn, admin: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["source"] = "manual"
    doc["template_id"] = None
    doc["status"] = "scheduled"
    doc["created_by"] = admin["id"]
    doc["created_at"] = now_iso()
    await db.shifts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/admin/shifts/{sid}")
async def update_shift(sid: str, body: ShiftIn, _: dict = Depends(require_admin)):
    res = await db.shifts.update_one({"id": sid}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shift not found")
    return {"ok": True}


@api.delete("/admin/shifts/{sid}")
async def delete_shift(sid: str, _: dict = Depends(require_admin)):
    await db.shifts.delete_one({"id": sid})
    return {"ok": True}


@api.post("/admin/shifts/generate")
async def generate_shifts_from_templates(body: dict, _: dict = Depends(require_admin)):
    """Apply all active shift_templates to every weekday in [start_date, end_date].
    Idempotent: skips dates where the same user already has a shift covering the same
    start_time (so re-running won't duplicate)."""
    start_date = body.get("start_date")
    end_date = body.get("end_date")
    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="start_date and end_date required")
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    if end < start:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")
    templates = await db.shift_templates.find({"active": True}, {"_id": 0}).to_list(500)
    created = 0
    skipped = 0
    d = start
    while d <= end:
        dow = d.weekday()  # 0=Mon..6=Sun
        for t in templates:
            if t["day_of_week"] != dow:
                continue
            iso = d.isoformat()
            existing = await db.shifts.find_one(
                {"user_id": t["user_id"], "date": iso, "start_time": t["start_time"]},
                {"_id": 0, "id": 1},
            )
            if existing:
                skipped += 1
                continue
            doc = {
                "id": str(uuid.uuid4()),
                "user_id": t["user_id"],
                "date": iso,
                "start_time": t["start_time"],
                "end_time": t["end_time"],
                "role": t.get("role", ""),
                "notes": "",
                "source": "template",
                "template_id": t["id"],
                "status": "scheduled",
                "created_at": now_iso(),
            }
            await db.shifts.insert_one(doc)
            created += 1
        d = d + timedelta(days=1)
    return {"created": created, "skipped": skipped, "start_date": start_date, "end_date": end_date}


@api.get("/admin/shifts/scheduled-vs-actual")
async def shifts_scheduled_vs_actual(
    start_date: str, end_date: str,
    user_id: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    """For each scheduled shift in the range, find the matching clock entry (same
    user, same date) and compute variance. Flags shifts where |sched - actual|
    > VARIANCE_FLAG_MINUTES."""
    qs: Dict[str, Any] = {"date": {"$gte": start_date, "$lte": end_date}}
    if user_id:
        qs["user_id"] = user_id
    shifts = await db.shifts.find(qs, {"_id": 0}).sort("date", 1).to_list(2000)
    # Pull all entries in window
    entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"}},
        {"_id": 0},
    ).to_list(5000)
    # Group entries by (user_id, date)
    entries_by_key: Dict[tuple, List[dict]] = {}
    for e in entries:
        ci = e.get("clock_in_at", "")
        dt = ci[:10] if len(ci) >= 10 else ""
        entries_by_key.setdefault((e["user_id"], dt), []).append(e)

    def parse_hhmm(s):
        try:
            h, m = s.split(":")
            return int(h) * 60 + int(m)
        except Exception:
            return None

    rows = []
    for s in shifts:
        sched_start_min = parse_hhmm(s["start_time"])
        sched_end_min = parse_hhmm(s["end_time"])
        sched_minutes = (sched_end_min - sched_start_min) if (sched_start_min is not None and sched_end_min is not None) else 0
        matches = entries_by_key.get((s["user_id"], s["date"]), [])
        actual_minutes = 0
        first_in = None
        last_out = None
        for e in matches:
            if e.get("clock_out_at"):
                actual_minutes += round(float(e.get("hours") or 0) * 60)
                if not first_in or e["clock_in_at"] < first_in:
                    first_in = e["clock_in_at"]
                if not last_out or e["clock_out_at"] > last_out:
                    last_out = e["clock_out_at"]
        variance_min = actual_minutes - sched_minutes
        flagged = abs(variance_min) > VARIANCE_FLAG_MINUTES
        status = "missed" if actual_minutes == 0 else ("matched" if not flagged else ("over" if variance_min > 0 else "under"))
        rows.append({
            **s,
            "scheduled_minutes": sched_minutes,
            "actual_minutes": actual_minutes,
            "variance_minutes": variance_min,
            "flagged": flagged,
            "match_status": status,
            "first_in": first_in,
            "last_out": last_out,
        })
    return {"shifts": rows, "variance_threshold_minutes": VARIANCE_FLAG_MINUTES}


# ────────────────────────── Payroll Tax Estimator (Sprint 96) ──────────────────────────
# Sensible defaults for Warren, Ohio (2026 rates). Every rate is editable via
# /api/admin/payroll-tax-settings so the owner can adjust as they get rated
# (e.g. Ohio SUTA changes yearly, BWC rate depends on policy/class code).
#
# IMPORTANT: This is an ESTIMATOR for budgeting only — not a substitute for
# payroll software or a CPA. Withholding amounts vary by W-4 selections,
# YTD totals, exemptions, etc. The take-home estimate uses simple flat brackets.

DEFAULT_PAYROLL_TAX_SETTINGS = {
    # Employer-paid (added on top of gross)
    "employer_social_security_pct": 6.2,
    "social_security_wage_cap": 176100,  # 2026 estimate
    "employer_medicare_pct": 1.45,
    "futa_pct": 0.6,  # effective (after state credit)
    "futa_wage_cap": 7000,
    "suta_pct": 2.7,  # Ohio new-employer rate
    "suta_wage_cap": 9000,
    "workers_comp_pct": 1.5,  # estimate for pet care class

    # Employee-withheld (shown for take-home calc; employer doesn't pay these)
    "employee_social_security_pct": 6.2,
    "employee_medicare_pct": 1.45,
    "federal_income_tax_pct": 11.0,  # rough 12% bracket - standard ded effective
    "ohio_income_tax_pct": 2.75,
    "warren_city_tax_pct": 2.5,
}


async def _get_payroll_tax_settings() -> Dict[str, float]:
    """Load saved tax settings, merge with defaults so missing keys still work."""
    row = await db.settings.find_one({"id": "payroll_tax"}, {"_id": 0}) or {}
    out = dict(DEFAULT_PAYROLL_TAX_SETTINGS)
    for k, v in row.items():
        if k in out and isinstance(v, (int, float)):
            out[k] = float(v)
    return out


@api.get("/admin/payroll-tax-settings")
async def get_payroll_tax_settings(_: dict = Depends(require_admin)):
    settings = await _get_payroll_tax_settings()
    return {"defaults": DEFAULT_PAYROLL_TAX_SETTINGS, "current": settings}


@api.put("/admin/payroll-tax-settings")
async def update_payroll_tax_settings(body: dict, _: dict = Depends(require_admin)):
    # Whitelist only known keys
    update: Dict[str, Any] = {}
    for k in DEFAULT_PAYROLL_TAX_SETTINGS.keys():
        if k in body:
            try:
                update[k] = float(body[k])
            except (TypeError, ValueError):
                pass
    update["id"] = "payroll_tax"
    await db.settings.update_one({"id": "payroll_tax"}, {"$set": update}, upsert=True)
    return await _get_payroll_tax_settings()


def _compute_payroll_tax(hours: float, rate: float, ytd_gross: float, tax: Dict[str, float]) -> Dict[str, float]:
    """Compute employer burden + employee withholdings for a single pay period.
    YTD gross is used to respect wage caps on FICA / FUTA / SUTA."""
    gross = round(hours * rate, 2)

    # Wage-capped employer FICA + unemployment
    ss_cap_left = max(tax["social_security_wage_cap"] - ytd_gross, 0)
    ss_taxable = min(gross, ss_cap_left)
    futa_cap_left = max(tax["futa_wage_cap"] - ytd_gross, 0)
    futa_taxable = min(gross, futa_cap_left)
    suta_cap_left = max(tax["suta_wage_cap"] - ytd_gross, 0)
    suta_taxable = min(gross, suta_cap_left)

    emp_ss = ss_taxable * tax["employer_social_security_pct"] / 100
    emp_medi = gross * tax["employer_medicare_pct"] / 100
    emp_futa = futa_taxable * tax["futa_pct"] / 100
    emp_suta = suta_taxable * tax["suta_pct"] / 100
    emp_wc = gross * tax["workers_comp_pct"] / 100
    employer_burden = round(emp_ss + emp_medi + emp_futa + emp_suta + emp_wc, 2)
    total_cost = round(gross + employer_burden, 2)

    # Employee withholdings (estimate — not actual payroll calc)
    ee_ss = ss_taxable * tax["employee_social_security_pct"] / 100
    ee_medi = gross * tax["employee_medicare_pct"] / 100
    ee_fed = gross * tax["federal_income_tax_pct"] / 100
    ee_state = gross * tax["ohio_income_tax_pct"] / 100
    ee_local = gross * tax["warren_city_tax_pct"] / 100
    employee_withholdings = round(ee_ss + ee_medi + ee_fed + ee_state + ee_local, 2)
    take_home = round(gross - employee_withholdings, 2)

    return {
        "gross": gross,
        "employer_breakdown": {
            "social_security": round(emp_ss, 2),
            "medicare": round(emp_medi, 2),
            "futa": round(emp_futa, 2),
            "suta": round(emp_suta, 2),
            "workers_comp": round(emp_wc, 2),
        },
        "employer_burden": employer_burden,
        "total_cost": total_cost,
        "employee_breakdown": {
            "social_security": round(ee_ss, 2),
            "medicare": round(ee_medi, 2),
            "federal_income_tax": round(ee_fed, 2),
            "ohio_income_tax": round(ee_state, 2),
            "warren_city_tax": round(ee_local, 2),
        },
        "employee_withholdings": employee_withholdings,
        "estimated_take_home": take_home,
    }


@api.get("/admin/payroll/estimate")
async def payroll_estimate(
    start_date: str, end_date: str, _: dict = Depends(require_admin),
):
    """Estimate per-employee employer cost (gross + taxes + workers comp) and
    employee take-home pay for the given pay period. Uses YTD gross from
    completed clock entries since Jan 1 to respect FICA/FUTA/SUTA wage caps.

    Owner (`is_owner=True`) is EXCLUDED — sole-prop owners don't pay employer
    payroll tax on their own draw. See `/admin/owner/draw-summary`."""
    owner_ids = await _get_owner_user_ids()
    tax = await _get_payroll_tax_settings()
    _filter: Dict[str, Any] = {
        "clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"},
        "clock_out_at": {"$ne": None, "$exists": True},
    }
    if owner_ids:
        _filter["user_id"] = {"$nin": list(owner_ids)}
    period_entries = await db.time_clock_entries.find(
        _filter,
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(5000)
    user_ids = list({e["user_id"] for e in period_entries})
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "display_name": 1, "hourly_rate": 1},
    ).to_list(500) if user_ids else []
    user_map = {u["id"]: u for u in users}

    # YTD gross per user — for wage cap math
    try:
        ytd_start = f"{datetime.strptime(end_date, '%Y-%m-%d').year}-01-01"
    except Exception:
        ytd_start = f"{business_today().year}-01-01"
    ytd_entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{ytd_start}T00:00:00", "$lte": f"{start_date}T00:00:00"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(50000)
    ytd_hours: Dict[str, float] = {}
    for e in ytd_entries:
        ytd_hours[e["user_id"]] = ytd_hours.get(e["user_id"], 0) + float(e.get("hours") or 0)

    # Tally period hours per user
    period_hours: Dict[str, float] = {}
    for e in period_entries:
        period_hours[e["user_id"]] = period_hours.get(e["user_id"], 0) + float(e.get("hours") or 0)

    per_user = []
    grand_gross = 0.0
    grand_burden = 0.0
    grand_total_cost = 0.0
    grand_withhold = 0.0
    grand_take_home = 0.0
    for uid, hrs in period_hours.items():
        u = user_map.get(uid, {})
        rate = float(u.get("hourly_rate") or 0)
        ytd_gross = ytd_hours.get(uid, 0) * rate
        calc = _compute_payroll_tax(hrs, rate, ytd_gross, tax)
        per_user.append({
            "user_id": uid,
            "name": u.get("display_name") or u.get("name") or "Unknown",
            "email": u.get("email", ""),
            "hourly_rate": rate,
            "hours": round(hrs, 2),
            "ytd_gross_before_period": round(ytd_gross, 2),
            **calc,
        })
        grand_gross += calc["gross"]
        grand_burden += calc["employer_burden"]
        grand_total_cost += calc["total_cost"]
        grand_withhold += calc["employee_withholdings"]
        grand_take_home += calc["estimated_take_home"]

    per_user.sort(key=lambda x: -x["total_cost"])
    return {
        "start_date": start_date,
        "end_date": end_date,
        "tax_settings": tax,
        "per_user": per_user,
        "totals": {
            "gross": round(grand_gross, 2),
            "employer_burden": round(grand_burden, 2),
            "total_cost": round(grand_total_cost, 2),
            "employee_withholdings": round(grand_withhold, 2),
            "estimated_take_home": round(grand_take_home, 2),
        },
        "disclaimer": "Estimator only — not a substitute for payroll software or a CPA. Withholding varies by W-4, YTD wages, exemptions. Verify with your accountant before issuing checks.",
    }


@api.get("/admin/payroll/csv")
@api.get("/admin/payroll/csv")
async def payroll_csv(
    start_date: str, end_date: str, _: dict = Depends(require_admin),
):
    """Export a payroll-ready CSV for the given pay period.
    Columns: Employee · Email · Pay period start · Pay period end · Hours ·
    Hourly rate · Gross pay · Shifts · Late/early flags."""
    from fastapi.responses import Response
    entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0},
    ).to_list(5000)
    user_ids = list({e["user_id"] for e in entries})
    users = await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "display_name": 1, "hourly_rate": 1, "is_owner": 1}
    ).to_list(500) if user_ids else []
    # Sprint 110bf — exclude sole-prop owner (their pay is a draw, not payroll).
    user_map = {u["id"]: u for u in users if not u.get("is_owner")}

    # Pull scheduled-vs-actual to count flags
    sva = await db.shifts.find(
        {"date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0}
    ).to_list(2000)
    entries_by_key: Dict[tuple, List[dict]] = {}
    for e in entries:
        ci = e.get("clock_in_at", "")
        dt = ci[:10] if len(ci) >= 10 else ""
        entries_by_key.setdefault((e["user_id"], dt), []).append(e)

    flags_per_user: Dict[str, int] = {}
    shifts_per_user: Dict[str, int] = {}
    for s in sva:
        shifts_per_user[s["user_id"]] = shifts_per_user.get(s["user_id"], 0) + 1
        try:
            sh, sm = s["start_time"].split(":")
            eh, em = s["end_time"].split(":")
            sched_min = int(eh)*60 + int(em) - (int(sh)*60 + int(sm))
        except Exception:
            sched_min = 0
        actual_min = sum(round(float(e.get("hours") or 0) * 60) for e in entries_by_key.get((s["user_id"], s["date"]), []) if e.get("clock_out_at"))
        if abs(actual_min - sched_min) > VARIANCE_FLAG_MINUTES:
            flags_per_user[s["user_id"]] = flags_per_user.get(s["user_id"], 0) + 1

    per_user: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        if e["user_id"] not in user_map:
            # Owner (excluded above) or deleted user.
            continue
        u = user_map.get(e["user_id"], {})
        slot = per_user.setdefault(e["user_id"], {
            "name": u.get("display_name") or u.get("name") or "Unknown",
            "email": u.get("email", ""),
            "rate": float(u.get("hourly_rate") or 0),
            "hours": 0.0,
        })
        slot["hours"] = round(slot["hours"] + float(e.get("hours") or 0), 3)

    # Pull tax settings + YTD gross per user for accurate cap math
    tax = await _get_payroll_tax_settings()
    try:
        ytd_start = f"{datetime.strptime(end_date, '%Y-%m-%d').year}-01-01"
    except Exception:
        ytd_start = f"{business_today().year}-01-01"
    ytd_pre = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{ytd_start}T00:00:00", "$lte": f"{start_date}T00:00:00"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(50000)
    ytd_hours_pre: Dict[str, float] = {}
    for e in ytd_pre:
        ytd_hours_pre[e["user_id"]] = ytd_hours_pre.get(e["user_id"], 0) + float(e.get("hours") or 0)

    # Build CSV with tax columns
    lines = ["Employee,Email,Period Start,Period End,Hours,Hourly Rate,Gross Pay,Employer Burden,Total Cost,Est. Net Pay,Shifts,Flags"]
    for uid, p in sorted(per_user.items(), key=lambda x: x[1]["name"]):
        ytd_gross = ytd_hours_pre.get(uid, 0) * p["rate"]
        calc = _compute_payroll_tax(p["hours"], p["rate"], ytd_gross, tax)
        lines.append(",".join([
            f'"{p["name"]}"', f'"{p["email"]}"', start_date, end_date,
            f"{p['hours']:.2f}", f"{p['rate']:.2f}", f"{calc['gross']:.2f}",
            f"{calc['employer_burden']:.2f}",
            f"{calc['total_cost']:.2f}",
            f"{calc['estimated_take_home']:.2f}",
            str(shifts_per_user.get(uid, 0)),
            str(flags_per_user.get(uid, 0)),
        ]))
    csv = "\n".join(lines)
    filename = f"payroll_{start_date}_to_{end_date}.csv"
    return Response(content=csv, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ────────────────────────── Tasks (Phase 3) ──────────────────────────
class TaskIn(BaseModel):
    kind: Literal["todo", "vaccine_review"] = "todo"
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = ""
    ref_id: Optional[str] = None  # e.g. dog_id for vaccine_review
    ref_label: Optional[str] = ""
    assigned_to: Optional[str] = None  # employee user_id; None means unassigned
    due_at: Optional[str] = None  # ISO


@api.get("/admin/tasks")
async def list_tasks(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if assigned_to:
        q["assigned_to"] = assigned_to if assigned_to != "unassigned" else None
    rows = await db.tasks.find(q, {"_id": 0}).sort([("status", 1), ("created_at", -1)]).to_list(1000)
    return rows


@api.post("/admin/tasks")
async def create_task(body: TaskIn, admin: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "open"
    doc["created_by"] = admin["id"]
    doc["created_at"] = now_iso()
    doc["claimed_at"] = None
    doc["completed_at"] = None
    doc["completed_by"] = None
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/admin/tasks/{tid}")
async def update_task(tid: str, body: TaskIn, _: dict = Depends(require_admin)):
    res = await db.tasks.update_one({"id": tid}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@api.delete("/admin/tasks/{tid}")
async def delete_task(tid: str, _: dict = Depends(require_admin)):
    await db.tasks.delete_one({"id": tid})
    return {"ok": True}


@api.post("/tasks/{tid}/claim")
async def claim_task(tid: str, user: dict = Depends(require_employee_or_admin)):
    """Employee self-claims an unassigned task."""
    res = await db.tasks.update_one(
        {"id": tid, "assigned_to": None, "status": "open"},
        {"$set": {"assigned_to": user["id"], "claimed_at": now_iso(), "status": "in_progress"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=400, detail="Task is not available to claim")
    return {"ok": True}


@api.post("/tasks/{tid}/complete")
async def complete_task(tid: str, user: dict = Depends(require_employee_or_admin)):
    """Mark task done. Admins can complete anyone's; employees only their own."""
    task = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if user.get("role") != "admin" and task.get("assigned_to") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your task")
    await db.tasks.update_one(
        {"id": tid},
        {"$set": {"status": "done", "completed_at": now_iso(), "completed_by": user["id"]}},
    )
    return {"ok": True}


# ── Assignment on existing entities ──
class AssignBookingIn(BaseModel):
    assigned_to: Optional[str] = None  # None = unassigned


@api.put("/admin/bookings/{booking_id}/assign")
async def assign_booking(booking_id: str, body: AssignBookingIn, _: dict = Depends(require_admin)):
    res = await db.bookings.update_one(
        {"id": booking_id}, {"$set": {"assigned_to": body.assigned_to}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"ok": True}


class AssignVaxIn(BaseModel):
    dog_id: str
    vaccine: str
    assigned_to: Optional[str] = None


@api.put("/admin/vaccine-cert-uploads/assign")
async def assign_vaccine_review(body: AssignVaxIn, _: dict = Depends(require_admin)):
    field = f"vaccine_certs.{body.vaccine}.assigned_to"
    res = await db.dogs.update_one(
        {"id": body.dog_id, f"vaccine_certs.{body.vaccine}": {"$exists": True}},
        {"$set": {field: body.assigned_to}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vaccine cert not found")
    return {"ok": True}


# ── Employee aggregator ──
@api.get("/employee/my-tasks")
async def employee_my_tasks(user: dict = Depends(require_employee_or_admin)):
    """Everything assigned to (or claimable by) the calling employee:
        - generic tasks assigned to them
        - bookings on the run-sheet assigned to them
        - vaccine reviews assigned to them
        - plus a list of unassigned/open tasks they can claim"""
    today = business_today().isoformat()
    mine_tasks = await db.tasks.find(
        {"assigned_to": user["id"], "status": {"$in": ["open", "in_progress"]}},
        {"_id": 0},
    ).to_list(500)
    unassigned = await db.tasks.find(
        {"assigned_to": None, "status": "open"}, {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    mine_bookings = await db.bookings.find(
        {"date": today, "assigned_to": user["id"], "status": {"$in": ["approved", "completed"]}},
        {"_id": 0},
    ).to_list(200)
    # Vaccine reviews assigned to me
    dogs_with_vax = await db.dogs.find(
        {"vaccine_certs": {"$exists": True}},
        {"_id": 0, "id": 1, "name": 1, "vaccine_certs": 1},
    ).to_list(500)
    my_vax = []
    for d in dogs_with_vax:
        for vac, info in (d.get("vaccine_certs") or {}).items():
            if not isinstance(info, dict):
                continue
            if info.get("assigned_to") == user["id"] and not info.get("reviewed_at"):
                my_vax.append({
                    "dog_id": d["id"],
                    "dog_name": d["name"],
                    "vaccine": vac,
                    "uploaded_at": info.get("uploaded_at"),
                    "expires_on": info.get("expires_on"),
                })
    return {
        "tasks": mine_tasks,
        "unassigned_tasks": unassigned,
        "today_bookings": mine_bookings,
        "vaccine_reviews": my_vax,
    }


# ── Employee schedule view ──
@api.get("/employee/my-shifts")
async def employee_my_shifts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(require_employee_or_admin),
):
    """Upcoming + recent shifts for the calling user. Defaults to next 14 days."""
    s = start_date or business_today().isoformat()
    e = end_date or (business_today() + timedelta(days=14)).isoformat()
    rows = await db.shifts.find(
        {"user_id": user["id"], "date": {"$gte": s, "$lte": e}},
        {"_id": 0},
    ).sort([("date", 1), ("start_time", 1)]).to_list(500)
    return {"start_date": s, "end_date": e, "shifts": rows}



@api.get("/admin/today-pnl")
async def today_pnl(_: dict = Depends(require_admin)):
    """Live 'am I profitable today?' gauge — expected revenue minus labor cost
    for today. Bookings count if approved or completed; price falls back to the
    service catalog `base_price` when actual_price isn't set yet. Labor uses
    real clocked hours; any currently-open shift is projected to "now"."""
    today = business_today().isoformat()
    now_dt = datetime.now(timezone.utc)
    # ── Expected revenue today (includes "no-show" / late-cancel charges
    # — see DELETE /bookings/{id}?forfeit=true)
    bookings = await db.bookings.find(
        {
            "date": today,
            "$or": [
                {"status": {"$in": ["approved", "completed"]}},
                {"status": "cancelled", "cancellation_charged": True},
            ],
        },
        {"_id": 0, "actual_price": 1, "credit_value": 1, "service_id": 1, "service_type": 1, "service_name": 1, "status": 1, "payment_status": 1, "dog_id": 1, "client_id": 1, "dog_name": 1, "end_date": 1, "date": 1, "grooming_type": 1, "cancellation_charged": 1, "cancellation_fee": 1, "payment_method": 1, "credit_lot_ids": 1, "is_prepaid_program_session": 1},
    ).to_list(2000)
    # Sprint 110cj — drop training-program credit redemptions (already counted
    # as Training Revenue at sell-time) so the gauge doesn't double-count.
    program_lot_ids = await _get_training_program_lot_ids()
    bookings = [b for b in bookings if not _is_program_credit_redemption(b, program_lot_ids)]
    # Build a service-id → base_price lookup
    svc_ids = list({b.get("service_id") for b in bookings if b.get("service_id")})
    svcs_by_id = await db.services.find(
        {"id": {"$in": svc_ids}}, {"_id": 0, "id": 1, "base_price": 1}
    ).to_list(200) if svc_ids else []
    svc_price = {s["id"]: float(s.get("base_price") or 0) for s in svcs_by_id}
    # Build a service_type → default active service for fallback when booking
    # has no service_id (legacy/quick-add bookings)
    default_svcs = await db.services.find(
        {"active": True}, {"_id": 0, "id": 1, "service_type": 1, "base_price": 1, "is_default": 1}
    ).to_list(500)
    default_by_type: Dict[str, float] = {}
    default_svc_id_by_type: Dict[str, str] = {}
    for s in default_svcs:
        st = s.get("service_type")
        if not st:
            continue
        # Prefer explicit defaults; otherwise first active service for that type
        if s.get("is_default") or st not in default_by_type:
            default_by_type[st] = float(s.get("base_price") or 0)
            default_svc_id_by_type[st] = s.get("id")
    # Sprint 110ay — Bulk-load active legacy pricing for today's clients so the
    # forecast revenue reflects each client's grandfathered rate (not catalog).
    today_date = business_today()
    client_ids = list({b.get("client_id") for b in bookings if b.get("client_id")})
    overrides_by_pair: Dict[tuple, float] = {}
    if client_ids:
        ovr_rows = await db.price_overrides.find(
            {"client_id": {"$in": client_ids}, "target_kind": "service"},
            {"_id": 0, "client_id": 1, "target_code": 1, "override_price": 1, "expires_on": 1},
        ).to_list(2000)
        for row in ovr_rows:
            if _override_is_active(row, today_date):
                overrides_by_pair[(row["client_id"], row["target_code"])] = float(row.get("override_price") or 0)
    revenue = 0.0
    booked_count = 0
    completed_count = 0
    # Sprint 110az — track legacy-pricing impact so the UI can show
    # "$X above/below catalog (Y legacy clients)".
    legacy_delta = 0.0
    legacy_client_set: set = set()
    catalog_forecast = 0.0
    for b in bookings:
        booked_count += 1
        is_completed = b.get("status") == "completed"
        if is_completed:
            completed_count += 1
        # Cancellation fee — late-cancel/no-show charges recognized as revenue
        # using the snapshot stored at cancel time.
        if b.get("status") == "cancelled" and b.get("cancellation_charged"):
            revenue += float(b.get("cancellation_fee") or 0)
            catalog_forecast += float(b.get("cancellation_fee") or 0)
            continue
        # Sprint 110ar — For COMPLETED bookings, the `actual_price` (even if
        # explicitly 0) is the source of truth. Don't fall back to catalog
        # defaults — that was producing phantom revenue after the admin
        # checked out at $0 (e.g. training visits paid by package).
        if is_completed:
            revenue += float(b.get("actual_price") or 0)
            catalog_forecast += float(b.get("actual_price") or 0)
            continue
        # ── For not-yet-completed bookings, estimate the forecast price.
        price = float(b.get("actual_price") or 0)
        if not price:
            price = float(b.get("credit_value") or 0)
        # Sprint 110ay — Honor each client's grandfathered (legacy) pricing
        # before falling back to the catalog. Compares against the booking's
        # service_id when set, or the default service id for the service_type.
        client_id_for_lookup = b.get("client_id")
        legacy_svc_id = b.get("service_id") or default_svc_id_by_type.get(b.get("service_type") or "")
        legacy_price = None
        if client_id_for_lookup and legacy_svc_id:
            legacy_price = overrides_by_pair.get((client_id_for_lookup, legacy_svc_id))
        # Compute boarding nights once for both branches
        nights = 1
        if b.get("service_type") == "boarding":
            try:
                d1 = datetime.strptime(b.get("date"), "%Y-%m-%d").date()
                d2 = datetime.strptime(b.get("end_date") or b.get("date"), "%Y-%m-%d").date()
                nights = max((d2 - d1).days, 1)
            except Exception:
                nights = 1
        if not price and legacy_price is not None:
            price = float(legacy_price)
            if b.get("service_type") == "boarding":
                price = price * nights
        if not price and b.get("service_id"):
            price = svc_price.get(b["service_id"], 0)
        # Training is normally pre-paid via packages — never auto-estimate
        # individual visits, since the admin enters the amount manually at
        # check-out only when a non-package session is involved.
        if not price and b.get("service_type") and b.get("service_type") != "training":
            price = default_by_type.get(b["service_type"], 0)
            if price and b.get("service_type") == "boarding":
                price = price * nights
        revenue += price
        # ── Catalog-equivalent forecast (what we WOULD make at the public
        # rate) — for the legacy-delta UI badge. Mirrors the same fallback
        # chain but skips the override.
        catalog_unit = 0.0
        if b.get("service_id"):
            catalog_unit = svc_price.get(b["service_id"], 0)
        if not catalog_unit and b.get("service_type") and b.get("service_type") != "training":
            catalog_unit = default_by_type.get(b["service_type"], 0)
        catalog_price = catalog_unit * nights if (catalog_unit and b.get("service_type") == "boarding") else catalog_unit
        # If price was already set (actual_price / credit_value), and there's
        # no clean catalog estimate, use price for the catalog forecast too —
        # avoids artificial deltas on bookings the admin manually priced.
        if catalog_price == 0 and price > 0 and legacy_price is None:
            catalog_price = price
        catalog_forecast += catalog_price
        # Tally the legacy impact only when an active override actually fired
        if legacy_price is not None and catalog_price > 0:
            legacy_delta += (price - catalog_price)
            if client_id_for_lookup:
                legacy_client_set.add(client_id_for_lookup)
    revenue = round(revenue, 2)
    catalog_forecast = round(catalog_forecast, 2)
    legacy_delta = round(legacy_delta, 2)

    # ── Retail sales today (external POS — adds to gross revenue)
    retail_rows = await db.retail_sales.find(
        {"date": today}, {"_id": 0, "amount": 1},
    ).to_list(2000)
    retail_total = round(sum(float(r.get("amount") or 0) for r in retail_rows), 2)
    retail_count = len(retail_rows)
    revenue = round(revenue + retail_total, 2)

    # ── Labor cost today
    today_start = f"{today}T00:00:00"
    today_end = f"{today}T23:59:59.999Z"
    entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": today_start, "$lte": today_end}},
        {"_id": 0},
    ).to_list(500)
    user_ids = list({e["user_id"] for e in entries})
    users = await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "display_name": 1, "hourly_rate": 1, "is_owner": 1}
    ).to_list(500) if user_ids else []
    user_map = {u["id"]: u for u in users}
    labor_cost = 0.0
    labor_hours = 0.0
    owner_draw_today = 0.0
    owner_hours_today = 0.0
    open_shifts = 0
    per_employee: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        u = user_map.get(e["user_id"], {})
        rate = float(u.get("hourly_rate") or 0)
        is_owner_u = bool(u.get("is_owner", False))
        if e.get("clock_out_at"):
            hrs = float(e.get("hours") or 0)
        else:
            # Project an open shift to "now" for live cost
            try:
                ci = datetime.fromisoformat(e["clock_in_at"].replace("Z", "+00:00"))
                break_min = float(e.get("break_minutes") or 0)
                hrs = max((now_dt - ci).total_seconds() / 3600.0 - (break_min / 60.0), 0.0)
                open_shifts += 1
            except Exception:
                hrs = 0
        cost = hrs * rate
        labor_cost += cost
        labor_hours += hrs
        if is_owner_u:
            owner_draw_today += cost
            owner_hours_today += hrs
        slot = per_employee.setdefault(e["user_id"], {
            "user_id": e["user_id"],
            "name": u.get("display_name") or u.get("name") or "Unknown",
            "hourly_rate": rate, "hours": 0.0, "cost": 0.0, "is_clocked_in": False,
            "is_owner": is_owner_u,
        })
        slot["hours"] = round(slot["hours"] + hrs, 2)
        slot["cost"] = round(slot["cost"] + cost, 2)
        if not e.get("clock_out_at"):
            slot["is_clocked_in"] = True
    labor_cost = round(labor_cost, 2)
    labor_hours = round(labor_hours, 2)
    # Add employer tax burden (~12-14%) for the true cost basis on the dashboard
    tax = await _get_payroll_tax_settings()
    # Effective combined rate as a rough multiplier (no YTD cap math here — today
    # is a single day, caps almost never hit; the proper period-based math lives
    # in /transactions/summary-range and /admin/payroll/estimate)
    burden_rate = (
        tax["employer_social_security_pct"] + tax["employer_medicare_pct"]
        + tax["futa_pct"] + tax["suta_pct"] + tax["workers_comp_pct"]
    ) / 100.0
    labor_burden = round(labor_cost * burden_rate, 2)
    labor_total = round(labor_cost + labor_burden, 2)
    net = round(revenue - labor_total, 2)
    margin_pct = round((net / revenue * 100.0), 1) if revenue > 0 else None

    return {
        "date": today,
        "revenue": revenue,
        "service_revenue": round(revenue - retail_total, 2),
        "retail_revenue": retail_total,
        "retail_count": retail_count,
        "labor_cost": labor_cost,        # gross wages (legacy field name kept for back-compat)
        "labor_burden": labor_burden,    # employer-side payroll tax + workers comp
        "labor_total": labor_total,      # gross + burden
        "labor_hours": labor_hours,
        "owner_draw_today": round(owner_draw_today, 2),
        "owner_hours_today": round(owner_hours_today, 2),
        "net": net,
        "margin_pct": margin_pct,
        "booked_count": booked_count,
        "completed_count": completed_count,
        "open_shifts": open_shifts,
        "per_employee": sorted(per_employee.values(), key=lambda x: -x["cost"]),
        # Sprint 110az — legacy-pricing impact summary
        "legacy_delta": legacy_delta,                # negative = below catalog
        "legacy_client_count": len(legacy_client_set),
        "catalog_forecast": catalog_forecast,
    }



@api.get("/employee/roster-today")
async def employee_roster_today(user: dict = Depends(require_employee_or_admin)):
    """Today's run-sheet roster — dogs on-site + emergency contact phone for each.
    Strips financial/credit/owner-PII fields the employee doesn't need."""
    today = business_today().isoformat()
    bookings = await db.bookings.find(
        {"date": today, "status": {"$in": ["approved", "completed"]}},
        {"_id": 0},
    ).sort("dropoff_time", 1).to_list(500)
    # Pull dog + client info for each booking
    dog_ids = list({b["dog_id"] for b in bookings if b.get("dog_id")})
    client_ids = list({b["client_id"] for b in bookings if b.get("client_id")})
    dogs = await db.dogs.find(
        {"id": {"$in": dog_ids}},
        # Sprint 110cn — surface `vaccines` so the roster card can flag
        # missing/expiring rabies/dhpp/bordetella before staff lets the dog in.
        {"_id": 0, "photo": 0, "photos": 0, "training_logs": 0},
    ).to_list(1000) if dog_ids else []
    clients = await db.clients.find(
        {"id": {"$in": client_ids}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "emerg": 1, "address": 1},
    ).to_list(1000) if client_ids else []
    dog_map = {d["id"]: d for d in dogs}
    client_map = {c["id"]: c for c in clients}
    roster = []
    for b in bookings:
        d = dog_map.get(b.get("dog_id"), {})
        c = client_map.get(b.get("client_id"), {})
        roster.append({
            "booking_id": b["id"],
            "dog_id": b.get("dog_id"),
            "dog_name": b.get("dog_name") or d.get("name"),
            "breed": d.get("breed"),
            "service_type": b.get("service_type"),
            "kennel": b.get("kennel"),
            "dropoff_time": b.get("dropoff_time"),
            "pickup_time": b.get("pickup_time"),
            "checked_in_at": b.get("checked_in_at"),
            "checked_out_at": b.get("checked_out_at"),
            "status": b.get("status"),
            "notes": b.get("notes"),
            "feeding_schedule": d.get("feeding_schedule") or [],
            "medications": d.get("medications") or [],
            "vet_name": d.get("vet_name"),
            "vet_phone": d.get("vet_phone"),
            "client_name": b.get("client_name") or c.get("name"),
            "client_phone": c.get("phone"),
            "client_emergency": c.get("emerg"),
            # Sprint 110cn — vaccine expiry data + completion log so the
            # roster card can render warning banners + confirmation checkboxes.
            "vaccines": d.get("vaccines") or {},
            "is_birthday": _is_dog_birthday_today(d.get("birthday") or d.get("date_of_birth"), today),
            "feeding_log": b.get("feeding_log") or [],
            "medication_log": b.get("medication_log") or [],
            "bathroom_log": b.get("bathroom_log") or {"pee": 0, "poop": 0},
        })
    return {"date": today, "roster": roster}


def _is_dog_birthday_today(dob: Optional[str], today: str) -> bool:
    """Returns True if the dog's birthday is today (same month/day, any year)."""
    if not dob or len(dob) < 10:
        return False
    return dob[5:10] == today[5:10]


# ─────────────────────── Sprint 110cn — Floor logging ───────────────────────
# Staff-facing endpoints for the run sheet's day-to-day micro-actions:
# medication confirmation, feeding confirmation, bathroom counters, and
# incident reporting straight from the floor. All append to JSON arrays on
# the booking doc itself so they're naturally linked to the visit and roll
# up nicely into the post-visit report card.

class MedFeedLogIn(BaseModel):
    index: int = Field(ge=0, lt=50)              # which scheduled med/feeding
    note: Optional[str] = Field(default="", max_length=200)
    photo: Optional[str] = ""                    # data:image/...;base64 (≤ ~800kB)


@api.post("/employee/bookings/{booking_id}/log-feeding")
async def employee_log_feeding(
    booking_id: str, body: MedFeedLogIn, user: dict = Depends(require_employee_or_admin),
):
    """Append a 'fed' confirmation to the booking's feeding_log."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "id": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    entry = {
        "index": body.index,
        "note": (body.note or "").strip(),
        "photo": body.photo or "",
        "at": now_iso(),
        "by_id": user.get("id"),
        "by_name": user.get("name") or user.get("email"),
    }
    await db.bookings.update_one({"id": booking_id}, {"$push": {"feeding_log": entry}})
    return {"ok": True, "entry": entry}


@api.post("/employee/bookings/{booking_id}/log-medication")
async def employee_log_medication(
    booking_id: str, body: MedFeedLogIn, user: dict = Depends(require_employee_or_admin),
):
    """Append a 'given' confirmation to the booking's medication_log. Photo
    proof is encouraged for liability."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "id": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    entry = {
        "index": body.index,
        "note": (body.note or "").strip(),
        "photo": body.photo or "",
        "at": now_iso(),
        "by_id": user.get("id"),
        "by_name": user.get("name") or user.get("email"),
    }
    await db.bookings.update_one({"id": booking_id}, {"$push": {"medication_log": entry}})
    return {"ok": True, "entry": entry}


class BathroomTickIn(BaseModel):
    kind: Literal["pee", "poop"]
    delta: int = Field(default=1, ge=-1, le=1)   # +1 or -1 (undo)


@api.post("/employee/bookings/{booking_id}/bathroom")
async def employee_bathroom_tick(
    booking_id: str, body: BathroomTickIn, user: dict = Depends(require_employee_or_admin),
):
    """Bump the pee/poop counter on a booking. Crucial for boarding clients
    who want a transparent record of their dog's bathroom habits."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "id": 1, "bathroom_log": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    log = b.get("bathroom_log") or {"pee": 0, "poop": 0}
    log[body.kind] = max(0, int(log.get(body.kind, 0)) + body.delta)
    await db.bookings.update_one({"id": booking_id}, {"$set": {"bathroom_log": log}})
    return {"ok": True, "bathroom_log": log}


class EmployeeIncidentIn(BaseModel):
    dog_id: str
    type: Literal["bite", "injury", "escape", "illness", "property_damage", "behavior", "other"] = "other"
    severity: Literal["minor", "moderate", "severe"] = "minor"
    description: str = Field(min_length=3, max_length=1000)
    action_taken: Optional[str] = Field(default="", max_length=500)
    photo: Optional[str] = ""                    # single photo data URL
    vet_required: bool = False


@api.post("/employee/incidents")
async def employee_create_incident(body: EmployeeIncidentIn, user: dict = Depends(require_employee_or_admin)):
    """Staff-facing incident logger. Auto-stamps time, employee, and on-site
    state so we have a defensible record without the operator typing it later."""
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    client = await db.clients.find_one({"id": dog["owner_id"]}, {"_id": 0, "name": 1, "id": 1})
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "dog_id": body.dog_id,
        "dog_name": dog["name"],
        "client_id": dog["owner_id"],
        "client_name": (client or {}).get("name", ""),
        "date": business_today().isoformat(),
        "time": now.strftime("%H:%M"),
        "type": body.type,
        "severity": body.severity,
        "description": body.description.strip(),
        "witnesses": "",
        "action_taken": (body.action_taken or "").strip(),
        "photos": [body.photo] if body.photo else [],
        "vet_required": bool(body.vet_required),
        "follow_up_required": body.severity in ("moderate", "severe"),
        "reported_by": user.get("name") or user.get("email") or "Staff",
        "created_at": now_iso(),
    }
    await db.incidents.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ──────────── Punch correction requests ────────────
class PunchCorrectionIn(BaseModel):
    target_entry_id: Optional[str] = ""          # which time_clock_entries row, optional
    target_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    requested_clock_in: Optional[str] = ""       # ISO datetime
    requested_clock_out: Optional[str] = ""      # ISO datetime
    reason: str = Field(min_length=3, max_length=500)


@api.get("/employee/punch-corrections")
async def employee_list_punch_corrections(user: dict = Depends(require_employee_or_admin)):
    """Staff sees their own correction requests. Admin sees all."""
    q: Dict[str, Any] = {} if user.get("role") == "admin" else {"user_id": user.get("id")}
    items = await db.punch_corrections.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api.post("/employee/punch-corrections")
async def employee_create_punch_correction(body: PunchCorrectionIn, user: dict = Depends(require_employee_or_admin)):
    """Submit a correction request — admin will approve/deny + apply."""
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id"),
        "user_name": user.get("name") or user.get("email"),
        "target_entry_id": body.target_entry_id or "",
        "target_date": body.target_date,
        "requested_clock_in": body.requested_clock_in or "",
        "requested_clock_out": body.requested_clock_out or "",
        "reason": body.reason.strip(),
        "status": "pending",                     # pending | approved | denied
        "decided_by_id": "",
        "decided_by_name": "",
        "decided_at": "",
        "admin_note": "",
        "created_at": now_iso(),
    }
    await db.punch_corrections.insert_one(doc)
    doc.pop("_id", None)
    return doc


class PunchCorrectionDecisionIn(BaseModel):
    decision: Literal["approved", "denied"]
    admin_note: Optional[str] = Field(default="", max_length=500)


@api.post("/employee/punch-corrections/{cid}/decision")
async def employee_decide_punch_correction(
    cid: str, body: PunchCorrectionDecisionIn, user: dict = Depends(require_admin),
):
    """Admin approves/denies a correction. On approve, the requested
    clock_in/clock_out get applied to the time_clock_entries row (or a new
    row is created if target_entry_id is empty)."""
    req = await db.punch_corrections.find_one({"id": cid}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] != "pending":
        raise HTTPException(status_code=409, detail="Already decided")
    update = {
        "status": body.decision,
        "decided_by_id": user.get("id"),
        "decided_by_name": user.get("name") or user.get("email"),
        "decided_at": now_iso(),
        "admin_note": (body.admin_note or "").strip(),
    }
    await db.punch_corrections.update_one({"id": cid}, {"$set": update})

    if body.decision == "approved":
        # Apply to a time_clock_entries row.
        target_id = req.get("target_entry_id")
        patch = {}
        if req.get("requested_clock_in"):
            patch["clock_in_at"] = req["requested_clock_in"]
        if req.get("requested_clock_out"):
            patch["clock_out_at"] = req["requested_clock_out"]
        if target_id:
            await db.time_clock_entries.update_one({"id": target_id}, {"$set": patch})
        elif patch:
            # Create a fresh entry — staff forgot to clock in/out entirely.
            row = {
                "id": str(uuid.uuid4()),
                "user_id": req["user_id"],
                "user_name": req["user_name"],
                "clock_in_at": patch.get("clock_in_at", ""),
                "clock_out_at": patch.get("clock_out_at", ""),
                "created_at": now_iso(),
                "corrected_via_request_id": cid,
            }
            await db.time_clock_entries.insert_one(row)

    req.update(update)
    return req


# ──────────── Staff trivia (no scoring, just learning) ────────────
@api.get("/employee/trivia/quiz")
async def employee_trivia_quiz(count: int = 5, _: dict = Depends(require_employee_or_admin)):
    """Adaptive practice quiz for staff. Same question pool as the client
    portal, but answering doesn't touch streaks/leaderboards — it's pure
    learning. Helps staff get smarter about breeds, behavior, training."""
    count = max(1, min(int(count), 10))
    ladder: List[str] = []
    for i in range(count):
        pct = i / max(1, count - 1)
        ladder.append("easy" if pct < 0.4 else "medium" if pct < 0.75 else "hard")
    out: List[dict] = []
    used: set = set()
    for diff in ladder:
        for filt in (
            {"active": True, "difficulty": diff, "id": {"$nin": list(used)}},
            {"active": True, "id": {"$nin": list(used)}},
        ):
            pool = await db.trivia_questions.find(filt, {"_id": 0}).limit(50).to_list(50)
            if pool:
                import random as _r
                q = _r.choice(pool)
                out.append(_strip_correct(q))
                used.add(q["id"])
                break
    return {"questions": out}


@api.post("/employee/trivia/answer")
async def employee_trivia_answer(body: TriviaAnswerIn, _: dict = Depends(require_employee_or_admin)):
    """Reveal the correct answer + the educational explanation, no scoring."""
    q = await db.trivia_questions.find_one({"id": body.question_id, "active": True}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return {
        "correct": body.chosen_index == q["correct_index"],
        "correct_index": q["correct_index"],
        "explanation": q.get("explanation") or "",
    }





# ────────────────────────── Expenses ──────────────────────────
class ExpenseIn(BaseModel):
    date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    description: str = Field(min_length=1, max_length=200)
    amount: float = Field(ge=0)
    category: Optional[str] = ""
    notes: Optional[str] = ""
    payment_method: Optional[Literal["cash", "card", "transfer", "check", "other"]] = "card"
    # Sprint 110ap — optional photo/PDF/scan of the receipt for IRS audit
    # peace-of-mind. Stored inline as a base64 data URL (`data:image/jpeg;…`
    # or `data:application/pdf;…`). Front-end compresses images to <800kB
    # before upload; PDFs are passed through as-is up to ~2MB. Empty string
    # means no receipt on file.
    receipt_image: Optional[str] = ""
    receipt_filename: Optional[str] = ""


@api.get("/expenses")
async def list_expenses(
    _: dict = Depends(require_admin),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """List expenses, optionally filtered to a date window. Newest first."""
    q: Dict[str, Any] = {}
    if start_date or end_date:
        q["date"] = {}
        if start_date:
            q["date"]["$gte"] = start_date
        if end_date:
            q["date"]["$lte"] = end_date
    cursor = db.expenses.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)])
    return await cursor.to_list(2000)


@api.post("/expenses")
async def create_expense(body: ExpenseIn, user: dict = Depends(require_admin)):
    """Log an out-of-pocket business expense (food, supplies, utilities, etc.).
    These flow into the Income screen's monthly/range view so you can see NET
    instead of just gross income."""
    doc = {
        "id": str(uuid.uuid4()),
        "date": body.date,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "category": (body.category or "").strip(),
        "notes": (body.notes or "").strip(),
        "payment_method": body.payment_method or "card",
        "receipt_image": (body.receipt_image or "") or None,
        "receipt_filename": (body.receipt_filename or "").strip() or None,
        "created_at": now_iso(),
        "created_by": user.get("id"),
    }
    # Strip None so we don't store empty receipt keys for legacy rows
    doc = {k: v for k, v in doc.items() if v is not None}
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseIn, _: dict = Depends(require_admin)):
    existing = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    patch = {
        "date": body.date,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "category": (body.category or "").strip(),
        "notes": (body.notes or "").strip(),
        "payment_method": body.payment_method or "card",
        "updated_at": now_iso(),
    }
    # Receipt is editable — empty string means "remove the receipt", non-empty
    # replaces it. We intentionally don't clobber an existing receipt when
    # `receipt_image` is omitted entirely (Pydantic default).
    if body.receipt_image is not None:
        patch["receipt_image"] = body.receipt_image or None
        patch["receipt_filename"] = (body.receipt_filename or "").strip() or None
        # Drop None values so Mongo's $set doesn't store explicit nulls
        if patch["receipt_image"] is None:
            patch.pop("receipt_image")
            patch.pop("receipt_filename", None)
            await db.expenses.update_one(
                {"id": expense_id},
                {"$unset": {"receipt_image": "", "receipt_filename": ""}},
            )
    await db.expenses.update_one({"id": expense_id}, {"$set": patch})
    return {**existing, **patch}


@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, _: dict = Depends(require_admin)):
    res = await db.expenses.delete_one({"id": expense_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}


@api.get("/expenses/categories")
async def expense_categories(_: dict = Depends(require_admin)):
    """Unique category strings seen so far — used to power autocomplete."""
    cats = await db.expenses.distinct("category")
    cats = sorted([c for c in cats if c])
    return {"categories": cats}


# ────────────────────────── Retail Sales ──────────────────────────
# User has an external POS for actual checkout. This is just a lightweight
# revenue ledger so retail $$ flows into the same Income / P&L tally as
# services. No inventory, no checkout, no tax math — just a row per sale.
class RetailSaleIn(BaseModel):
    date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    description: str = Field(min_length=1, max_length=200)
    amount: float = Field(ge=0)
    category: Optional[str] = ""
    notes: Optional[str] = ""
    payment_method: Optional[Literal["cash", "card", "transfer", "check", "credits", "other"]] = "card"
    client_id: Optional[str] = None  # optional — link a sale to a specific client
    # Sprint 110aw — Sales tax. If true, `amount` is the TOTAL the customer
    # paid (incl. tax) and the backend back-calculates the tax slice. If false
    # or absent, the line is tax-exempt (e.g. a wholesale item).
    apply_tax: Optional[bool] = None


@api.get("/retail-sales")
async def list_retail_sales(
    _: dict = Depends(require_admin),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """List retail sales, optionally filtered to a date window. Newest first."""
    q: Dict[str, Any] = {}
    if start_date or end_date:
        q["date"] = {}
        if start_date:
            q["date"]["$gte"] = start_date
        if end_date:
            q["date"]["$lte"] = end_date
    cursor = db.retail_sales.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)])
    return await cursor.to_list(2000)


@api.post("/retail-sales")
async def create_retail_sale(body: RetailSaleIn, user: dict = Depends(require_admin)):
    """Log a retail sale (treats, leash, food bag, etc.) from your external POS.
    Flows into the Income screen + P&L PDF alongside service revenue."""
    client_name = ""
    if body.client_id:
        c = await db.clients.find_one({"id": body.client_id}, {"_id": 0, "name": 1})
        if c:
            client_name = c.get("name") or ""
    doc = {
        "id": str(uuid.uuid4()),
        "date": body.date,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "category": (body.category or "").strip(),
        "notes": (body.notes or "").strip(),
        "payment_method": body.payment_method or "card",
        "client_id": body.client_id or None,
        "client_name": client_name,
        "created_at": now_iso(),
        "created_by": user.get("id"),
    }
    # Sprint 110aw — Tax breakout. When sales_tax is enabled, retail is tax-
    # applicable by default (unless the row explicitly says otherwise).
    try:
        settings_tx = await get_settings()
        tx_cfg = (settings_tx or {}).get("sales_tax") or {}
        if tx_cfg.get("enabled") and float(tx_cfg.get("rate_pct") or 0) > 0:
            applies = (tx_cfg.get("applies_to") or {})
            should_tax = body.apply_tax if body.apply_tax is not None else applies.get("retail", True)
            if should_tax:
                rate_pct = float(tx_cfg["rate_pct"])
                # Treat `amount` as TOTAL incl. tax (matches a typical POS receipt).
                total = doc["amount"]
                pre_tax = round(total / (1 + rate_pct / 100.0), 2)
                doc["tax_amount"] = round(total - pre_tax, 2)
                doc["tax_rate_pct"] = rate_pct
                doc["pre_tax_amount"] = pre_tax
    except Exception as exc:
        logger.warning("retail tax calc failed: %s", exc)
    await db.retail_sales.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/retail-sales/{sale_id}")
async def update_retail_sale(sale_id: str, body: RetailSaleIn, _: dict = Depends(require_admin)):
    existing = await db.retail_sales.find_one({"id": sale_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Retail sale not found")
    client_name = existing.get("client_name") or ""
    if body.client_id and body.client_id != existing.get("client_id"):
        c = await db.clients.find_one({"id": body.client_id}, {"_id": 0, "name": 1})
        client_name = (c or {}).get("name") or ""
    elif not body.client_id:
        client_name = ""
    patch = {
        "date": body.date,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "category": (body.category or "").strip(),
        "notes": (body.notes or "").strip(),
        "payment_method": body.payment_method or "card",
        "client_id": body.client_id or None,
        "client_name": client_name,
        "updated_at": now_iso(),
    }
    await db.retail_sales.update_one({"id": sale_id}, {"$set": patch})
    return {**existing, **patch}


@api.delete("/retail-sales/{sale_id}")
async def delete_retail_sale(sale_id: str, _: dict = Depends(require_admin)):
    res = await db.retail_sales.delete_one({"id": sale_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Retail sale not found")
    return {"ok": True}


@api.get("/retail-sales/categories")
async def retail_sale_categories(_: dict = Depends(require_admin)):
    """Unique category strings seen so far — used to power autocomplete."""
    cats = await db.retail_sales.distinct("category")
    cats = sorted([c for c in cats if c])
    return {"categories": cats}


# ──────────────────────── Legacy Pricing (per-client price overrides) ──────────
# Sprint 110am — Some clients are grandfathered into the OLD prices when an
# admin raises the public rate. We never modify the catalog row itself —
# instead each grandfathered client gets one row per (target_kind, target_code)
# with the locked rate and an optional expiry date. Booking creation +
# credit-pack purchase + check-out price-resolution all consult this table
# server-side, so the client portal / public booking flow can never bypass it
# even if the catalog later shows a different number.


class PriceOverrideIn(BaseModel):
    target_kind: Literal["service", "credit_pack"]
    # The catalog row's `id` (uuid). Stable across rename and price edits, so
    # an override survives even if the admin renames "Daycare" later.
    target_code: str = Field(min_length=1)
    override_price: float = Field(ge=0)
    # ISO date `YYYY-MM-DD`. Empty / null = grandfathered forever.
    expires_on: Optional[str] = None
    note: Optional[str] = ""


class PriceOverridePatch(BaseModel):
    override_price: Optional[float] = Field(default=None, ge=0)
    expires_on: Optional[str] = None
    note: Optional[str] = None


def _override_is_active(row: dict, today: Optional[date] = None) -> bool:
    """An override is active when expires_on is empty OR ≥ today."""
    exp = (row or {}).get("expires_on")
    if not exp:
        return True
    today = today or business_today()
    try:
        return date.fromisoformat(exp) >= today
    except Exception:
        return True  # malformed date — assume still active rather than silently dropping rate



async def _apply_client_overrides(
    items: List[Dict[str, Any]],
    client_id: Optional[str],
    target_kind: str,  # "service" or "credit_pack"
    price_field: str,  # "base_price" for services, "price" for credit_packs
) -> List[Dict[str, Any]]:
    """Sprint 110bv — bulk-rewrite catalog prices to a client's locked-in
    legacy rates. Used by `/services` and `/credit-packs` so a grandfathered
    client never sees the new catalog price in the portal.

    Mutates each item in place:
      - adds `legacy_price` = original list price (so the UI can show "was $X")
      - adds `has_legacy_override = True` when this client has an active row
      - overwrites `price_field` with the override price
    Items without an active override are returned unchanged.
    """
    if not client_id or not items:
        return items
    codes = [str(it.get("id") or it.get("code") or "")
             for it in items if it.get("id") or it.get("code")]
    if not codes:
        return items
    rows = await db.price_overrides.find(
        {"client_id": client_id, "target_kind": target_kind, "target_code": {"$in": codes}},
        {"_id": 0, "target_code": 1, "override_price": 1, "expires_on": 1, "id": 1},
    ).to_list(500)
    overrides_by_code: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if _override_is_active(row):
            overrides_by_code[row["target_code"]] = row
    for it in items:
        code = str(it.get("id") or it.get("code") or "")
        ovr = overrides_by_code.get(code)
        if not ovr:
            continue
        list_price = float(it.get(price_field) or 0)
        it["legacy_price"] = list_price
        it["has_legacy_override"] = True
        it[price_field] = float(ovr.get("override_price") or 0)
    return items



async def resolve_client_price(
    client_id: Optional[str],
    target_kind: str,
    target_code: str,
    list_price: float,
) -> dict:
    """Return `{effective_price, list_price, override_id, override_row}` for the
    given client + catalog item. When no active override exists, effective ==
    list. Used by booking-create + credit-pack-sell so the same source of
    truth covers both."""
    out = {
        "effective_price": float(list_price or 0),
        "list_price": float(list_price or 0),
        "override_id": None,
        "override_row": None,
    }
    if not client_id or not target_code:
        return out
    row = await db.price_overrides.find_one(
        {"client_id": client_id, "target_kind": target_kind, "target_code": target_code},
        {"_id": 0},
    )
    if row and _override_is_active(row):
        out["effective_price"] = float(row.get("override_price") or 0)
        out["override_id"] = row.get("id")
        out["override_row"] = row
    return out


async def resolve_addon_snapshots(
    client_id: Optional[str],
    addon_service_ids: List[str],
    base_service_type: str,
) -> List[Dict[str, Any]]:
    """Sprint 110an — turn a list of add-on `service_id`s into the snapshot
    dicts we store on `booking.add_ons`. Validates each one:
      • exists and is active,
      • has `is_addon=True`,
      • base_service_type is in its `addon_for` list.
    Resolves the per-client legacy-pricing override per add-on so
    grandfathered customers keep their locked rate. Raises 400 on any
    invalid id so we never silently drop a paid add-on at booking time.
    """
    if not addon_service_ids:
        return []
    addons = await db.services.find(
        {"id": {"$in": list(addon_service_ids)}, "active": True},
        {"_id": 0},
    ).to_list(100)
    by_id = {a["id"]: a for a in addons}
    snapshots: List[Dict[str, Any]] = []
    for aid in addon_service_ids:
        svc = by_id.get(aid)
        if not svc:
            raise HTTPException(status_code=400, detail=f"Unknown / inactive add-on `{aid}`")
        if not svc.get("is_addon"):
            raise HTTPException(status_code=400, detail=f"Service `{svc.get('name')}` is not flagged as an add-on")
        eligible = svc.get("addon_for") or []
        if eligible and base_service_type not in eligible:
            raise HTTPException(
                status_code=400,
                detail=f"`{svc.get('name')}` isn't eligible as an add-on for {base_service_type} services",
            )
        list_price = float(svc.get("base_price") or 0)
        pricing = await resolve_client_price(client_id, "service", aid, list_price)
        snapshots.append({
            "service_id": aid,
            "name": svc.get("name") or "Add-on",
            "icon": svc.get("icon") or "fa-plus",
            "price": pricing["effective_price"],
            "list_price": list_price,
            "price_override_id": pricing["override_id"],
            "qty": 1,
            "added_at": now_iso(),
        })
    return snapshots


@api.get("/clients/{client_id}/price-overrides")
async def list_client_price_overrides(client_id: str, _: dict = Depends(require_admin), include_expired: bool = False):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    rows = await db.price_overrides.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    if not include_expired:
        rows = [r for r in rows if _override_is_active(r)]
    # Enrich with the catalog row so the UI can show "Daycare · was $35 → now $30"
    svc_codes = [r["target_code"] for r in rows if r["target_kind"] == "service"]
    pack_ids = [r["target_code"] for r in rows if r["target_kind"] == "credit_pack"]
    svcs = {s["id"]: s for s in await db.services.find({"id": {"$in": svc_codes}}, {"_id": 0}).to_list(500)} if svc_codes else {}
    packs = {p["id"]: p for p in await db.credit_packs.find({"id": {"$in": pack_ids}}, {"_id": 0}).to_list(500)} if pack_ids else {}
    for r in rows:
        if r["target_kind"] == "service":
            s = svcs.get(r["target_code"])
            r["target_name"] = (s or {}).get("name") or r["target_code"]
            r["list_price"] = float((s or {}).get("base_price") or 0)
        else:
            p = packs.get(r["target_code"])
            r["target_name"] = (p or {}).get("name") or r["target_code"]
            r["list_price"] = float((p or {}).get("price") or 0)
        r["active"] = _override_is_active(r)
        r["savings"] = round(r["list_price"] - float(r["override_price"]), 2)
    rows.sort(key=lambda r: (not r["active"], r["target_kind"], r["target_name"]))
    return {"overrides": rows}


@api.post("/clients/{client_id}/price-overrides")
async def create_client_price_override(client_id: str, body: PriceOverrideIn, user: dict = Depends(require_admin)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    # Validate the catalog item exists so we don't accumulate orphan overrides
    if body.target_kind == "service":
        target = await db.services.find_one({"id": body.target_code}, {"_id": 0, "name": 1, "base_price": 1})
    else:
        target = await db.credit_packs.find_one({"id": body.target_code}, {"_id": 0, "name": 1, "price": 1})
    if not target:
        raise HTTPException(status_code=404, detail=f"Unknown {body.target_kind} `{body.target_code}`")
    # Light date validation
    if body.expires_on:
        try:
            date.fromisoformat(body.expires_on)
        except Exception:
            raise HTTPException(status_code=422, detail="expires_on must be YYYY-MM-DD or empty")
    # Upsert — one override per (client, kind, code). New value wins.
    existing = await db.price_overrides.find_one(
        {"client_id": client_id, "target_kind": body.target_kind, "target_code": body.target_code},
        {"_id": 0, "id": 1},
    )
    doc = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "client_id": client_id,
        "target_kind": body.target_kind,
        "target_code": body.target_code,
        "override_price": float(body.override_price),
        "expires_on": body.expires_on or None,
        "note": (body.note or "").strip(),
        "created_by": user.get("name", "Admin"),
        "created_at": now_iso() if not existing else None,
        "updated_at": now_iso(),
    }
    doc = {k: v for k, v in doc.items() if v is not None}
    await db.price_overrides.update_one(
        {"client_id": client_id, "target_kind": body.target_kind, "target_code": body.target_code},
        {"$set": doc},
        upsert=True,
    )
    doc.pop("_id", None)
    return doc


@api.put("/price-overrides/{override_id}")
async def update_price_override(override_id: str, body: PriceOverridePatch, _: dict = Depends(require_admin)):
    row = await db.price_overrides.find_one({"id": override_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Override not found")
    patch: Dict[str, Any] = {"updated_at": now_iso()}
    if body.override_price is not None:
        patch["override_price"] = float(body.override_price)
    if body.expires_on is not None:
        if body.expires_on == "":
            patch["expires_on"] = None
        else:
            try:
                date.fromisoformat(body.expires_on)
            except Exception:
                raise HTTPException(status_code=422, detail="expires_on must be YYYY-MM-DD or empty")
            patch["expires_on"] = body.expires_on
    if body.note is not None:
        patch["note"] = body.note.strip()
    await db.price_overrides.update_one({"id": override_id}, {"$set": patch})
    return {**row, **patch}


@api.delete("/price-overrides/{override_id}")
async def delete_price_override(override_id: str, _: dict = Depends(require_admin)):
    res = await db.price_overrides.delete_one({"id": override_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Override not found")
    return {"ok": True, "deleted": 1}


# ────────────────────────── Credit Packs + FIFO Lots ──────────────────────────
from credit_packs_data import SEED_CREDIT_PACKS


class CreditPackIn(BaseModel):
    slug: Optional[str] = ""
    name: str = Field(min_length=1)
    qty: int = Field(ge=1)
    price: float = Field(ge=0)
    service_type: Optional[str] = "daycare"
    icon: Optional[str] = ""
    color: Optional[str] = ""
    active: bool = True


class SellCreditPackIn(BaseModel):
    pack_id: str
    payment_method: Optional[Literal["cash", "card", "transfer", "check", "other"]] = "cash"
    note: Optional[str] = ""


class SellCreditPackItem(BaseModel):
    pack_id: str
    quantity: int = Field(ge=1, le=50)


class SellCreditPacksBulkIn(BaseModel):
    items: List[SellCreditPackItem] = Field(min_length=1, max_length=20)
    payment_method: Optional[Literal["cash", "card", "transfer", "check", "other"]] = "cash"
    note: Optional[str] = ""


@api.get("/credit-packs")
async def list_credit_packs(user: dict = Depends(get_current_user), include_inactive: bool = False):
    q: Dict = {} if include_inactive else {"active": True}
    packs = await db.credit_packs.find(q, {"_id": 0}).sort("qty", 1).to_list(200)
    # Sprint 110bv — rewrite to client's legacy price when applicable
    if user.get("role") == "client" and user.get("client_id"):
        await _apply_client_overrides(packs, user["client_id"], "credit_pack", "price")
    # Compute value_each AFTER override so it reflects what the client actually pays
    for p in packs:
        p["value_each"] = round(float(p.get("price") or 0) / max(int(p.get("qty") or 1), 1), 2)
    return packs


@api.post("/credit-packs")
async def create_credit_pack(body: CreditPackIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["slug"] = doc.get("slug") or doc["name"].lower().replace(" ", "_")[:40]
    doc["is_default"] = False
    doc["created_at"] = now_iso()
    await db.credit_packs.insert_one(doc)
    doc.pop("_id", None)
    doc["value_each"] = round(doc["price"] / max(doc["qty"], 1), 2)
    return doc


@api.put("/credit-packs/{pack_id}")
async def update_credit_pack(pack_id: str, body: CreditPackIn, _: dict = Depends(require_admin)):
    existing = await db.credit_packs.find_one({"id": pack_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Pack not found")
    update = body.model_dump()
    update.pop("slug", None)
    update.pop("is_default", None)
    await db.credit_packs.update_one({"id": pack_id}, {"$set": update})
    merged = {**existing, **update}
    merged["value_each"] = round(float(merged.get("price") or 0) / max(int(merged.get("qty") or 1), 1), 2)
    return merged


@api.delete("/credit-packs/{pack_id}")
async def delete_credit_pack(pack_id: str, _: dict = Depends(require_admin)):
    existing = await db.credit_packs.find_one({"id": pack_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Pack not found")
    if existing.get("is_default"):
        await db.credit_packs.update_one({"id": pack_id}, {"$set": {"active": False}})
    else:
        await db.credit_packs.delete_one({"id": pack_id})
    return {"ok": True}


class CreditAdjustIn(BaseModel):
    daycare: int = 0       # positive = add, negative = subtract
    training: int = 0
    boarding: int = 0
    note: Optional[str] = ""


@api.post("/clients/{client_id}/adjust-credits")
async def adjust_client_credits(client_id: str, body: CreditAdjustIn, user: dict = Depends(require_admin)):
    """Manual +/- credit adjustment for fixing mistakes or comping a client.
    Does NOT touch credit_lots (no revenue change). Writes a `credit_adjustments`
    entry so you have an audit trail. Refuses to take a balance below zero."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    pool_map = {
        "daycare": ("credits", int(body.daycare or 0)),
        "training": ("training_credits", int(body.training or 0)),
        "boarding": ("boarding_credits", int(body.boarding or 0)),
    }
    if not any(delta for _, delta in pool_map.values()):
        raise HTTPException(status_code=400, detail="No adjustment specified.")

    # Validate no balance would go negative.
    for pool, (field, delta) in pool_map.items():
        if delta == 0:
            continue
        current = int(client.get(field) or 0)
        if current + delta < 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot subtract {abs(delta)} {pool} credit(s): client only has {current}.",
            )

    inc_doc: Dict[str, int] = {}
    changes: Dict[str, Dict[str, int]] = {}
    for pool, (field, delta) in pool_map.items():
        if delta:
            inc_doc[field] = delta
            changes[pool] = {
                "before": int(client.get(field) or 0),
                "delta": delta,
                "after": int(client.get(field) or 0) + delta,
            }

    await db.clients.update_one({"id": client_id}, {"$inc": inc_doc})
    # Sprint 110g — if a manual adjustment lifts any low-credit pool back above
    # the threshold, clear its email-sent stamp so the NEXT dip re-fires the
    # heads-up email instead of silently being skipped by the idempotency guard.
    for pool, (field, delta) in pool_map.items():
        if delta and (int(client.get(field) or 0) + delta) > 2:
            await db.clients.update_one(
                {"id": client_id, f"low_credit_emailed_at.{pool}": {"$exists": True}},
                {"$unset": {f"low_credit_emailed_at.{pool}": ""}},
            )
    log_entry = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "changes": changes,
        "note": body.note or "",
        "adjusted_by": user.get("name", "Admin"),
        "adjusted_at": now_iso(),
    }
    await db.credit_adjustments.insert_one(log_entry)
    log_entry.pop("_id", None)
    return log_entry


@api.get("/clients/{client_id}/credit-adjustments")
async def list_credit_adjustments(client_id: str, _: dict = Depends(require_admin)):
    items = await db.credit_adjustments.find(
        {"client_id": client_id}, {"_id": 0}
    ).sort("adjusted_at", -1).to_list(100)
    return items




@api.post("/credit-packs/seed-standard")
async def seed_credit_packs(_: dict = Depends(require_admin)):
    seeded = 0
    backfilled = 0
    for pack in SEED_CREDIT_PACKS:
        existing = await db.credit_packs.find_one({"slug": pack["slug"]}, {"_id": 0})
        if existing:
            # Backfill icon onto pre-existing default packs (one-time, idempotent).
            if not existing.get("icon") and pack.get("icon"):
                await db.credit_packs.update_one({"id": existing["id"]}, {"$set": {"icon": pack["icon"]}})
                backfilled += 1
            continue
        doc = {**pack, "id": str(uuid.uuid4()), "is_default": True, "active": True, "created_at": now_iso()}
        await db.credit_packs.insert_one(doc)
        seeded += 1
    total = await db.credit_packs.count_documents({"active": True})
    return {"seeded": seeded, "icon_backfilled": backfilled, "total_active": total}


# ─────────────── Sprint 110bw · Sell training programs as credit packs ───────────────
#
# Mirrors the credit-pack sell flow but for `programs`. Selling a program:
#   • Creates a `credit_lots` row tagged `pack_kind="training_program"` +
#     `program_id` so the per-program breakdown can be assembled at any time
#     (Q1c "hybrid" — global counter + per-program ledger).
#   • Increments `clients.training_credits` by the program's session count.
#   • Optionally enrols a specific dog (`dog_id` field — Q2c "optional dropdown").

class SellProgramIn(BaseModel):
    program_id: str
    payment_method: Literal["cash", "card", "venmo", "check", "other", "complimentary"] = "cash"
    override_price: Optional[float] = Field(default=None, ge=0)
    dog_id: Optional[str] = None       # If set, auto-creates a dog_programs row
    started_at: Optional[str] = None   # YYYY-MM-DD, defaults to today
    note: Optional[str] = ""
    # Sprint 110ce — recurring session scheduling. When set (and program type
    # is NOT board_train), auto-creates N weekly bookings on the chosen
    # day-of-week/time, prepaid via the credit lot. Board & Train programs
    # don't need this — the dog is already on-site.
    schedule_day_of_week: Optional[int] = Field(default=None, ge=0, le=6)  # 0=Mon ... 6=Sun
    schedule_time: Optional[str] = None  # HH:MM (24h)
    schedule_start_date: Optional[str] = None  # YYYY-MM-DD, defaults to next instance of weekday from today
    schedule_override_closures: bool = False  # set to True to ignore closed-day warnings


@api.post("/clients/{client_id}/sell-program")
async def sell_training_program(
    client_id: str,
    body: SellProgramIn,
    user: dict = Depends(require_admin),
):
    """Sell a training program — issues N training_credits where N = program
    session count, creates a per-program credit_lot for ledger/audit, and
    optionally enrols a specific dog so progress tracking starts immediately.

    Pricing: defaults to program.price, overrideable via `override_price`
    (admin discount). Does NOT trigger Stripe — same as sell-pack, this is
    the manual-payment path."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    program = await db.programs.find_one({"id": body.program_id}, {"_id": 0})
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    if not program.get("active", True):
        raise HTTPException(status_code=400, detail="Program is inactive")

    fmt = program.get("format") or {}
    qty = int(fmt.get("count") or 0)
    if qty <= 0:
        raise HTTPException(status_code=400,
                            detail="Program format.count must be > 0 to sell as credits")
    unit = fmt.get("unit") or "sessions"

    list_price = float(program.get("price") or 0)
    effective_price = float(body.override_price) if body.override_price is not None else list_price
    value_each = round(effective_price / max(qty, 1), 2)

    # If a dog is specified, make sure it belongs to this client.
    dog = None
    if body.dog_id:
        dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
        if not dog:
            raise HTTPException(404, "Dog not found")
        if dog.get("owner_id") != client_id:
            raise HTTPException(400, "Dog does not belong to this client")

    lot = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        # Re-uses the credit_lots schema. `pack_kind` distinguishes pack
        # sales ("credit_pack") from program sales ("training_program").
        "pack_kind": "training_program",
        "pack_id": program["id"],
        "pack_name": program["name"],
        "program_id": program["id"],
        "program_name": program["name"],
        "service_type": "training",
        "qty_total": qty,
        "qty_remaining": qty,
        "unit": unit,
        "price_paid": round(effective_price, 2),
        "list_price": round(list_price, 2),
        "value_each": value_each,
        "payment_method": body.payment_method,
        "note": body.note or "",
        "sold_by": user.get("name", "Admin"),
        "purchased_at": now_iso(),
    }
    await db.credit_lots.insert_one(lot)
    await db.clients.update_one({"id": client_id}, {"$inc": {"training_credits": qty}})

    # Sprint 110ca — record the sale as income immediately. Unlike credit packs
    # (which use deferred revenue recognition because each credit can be used
    # months later), training programs are a fixed commitment up-front, so the
    # operator wants the full sale price on the books on sale day. We write to
    # `retail_sales` because that's the collection the Income screen + monthly
    # P&L PDF + year-end CSV already aggregate.
    if effective_price > 0:
        income_doc = {
            "id": str(uuid.uuid4()),
            "date": business_today().isoformat(),
            "description": f"Training Program · {program['name']}",
            "amount": round(effective_price, 2),
            "category": "Training Program",
            "notes": body.note or "",
            "payment_method": body.payment_method or "card",
            "client_id": client_id,
            "client_name": client.get("name") or "",
            "created_at": now_iso(),
            "created_by": user.get("id"),
            # Back-link so the audit trail joins program sale → income row → lot
            "source_kind": "training_program_sale",
            "source_id": lot["id"],
            "program_id": program["id"],
        }
        # Training is a service, not retail — keep it out of the retail sales
        # tax bucket (sales_tax.applies_to.retail) which is for tangible goods.
        # Operator can still recognize service tax separately if they configure
        # it on the program/service catalog.
        await db.retail_sales.insert_one(income_doc)
        income_doc.pop("_id", None)
        lot["income_event_id"] = income_doc["id"]
        await db.credit_lots.update_one(
            {"id": lot["id"]},
            {"$set": {"income_event_id": income_doc["id"]}},
        )

    enrollment_summary = None
    if dog:
        # Don't double-enrol — return existing active enrollment if there is one.
        existing = await db.dog_programs.find_one(
            {"dog_id": dog["id"], "program_id": program["id"], "status": "active"},
            {"_id": 0},
        )
        if existing:
            enrollment_summary = _enrollment_summary(existing)
        else:
            started = body.started_at or business_today().isoformat()
            target = _suggest_target_date(started, fmt)
            enrollment = {
                "id": _gid(),
                "dog_id": dog["id"],
                "program_id": program["id"],
                "program_snapshot": {
                    "name": program["name"],
                    "type": program.get("type", "custom"),
                    "slug": program.get("slug"),
                    "description": program.get("description", ""),
                    "focus": program.get("focus", ""),
                    "format": fmt,
                    "modules": program.get("modules") or [],
                    "completion_rule": program.get("completion_rule") or _default_completion_rule(),
                    "welcome_homework_template_id": program.get("welcome_homework_template_id"),
                },
                "status": "active",
                "started_at": started,
                "target_completion_date": target,
                "completed_at": None,
                "on_hold_at": None,
                "goal_progress": _empty_progress(program.get("modules") or []),
                "sessions_count": 0,
                "trainer_notes": "",
                "created_at": now_iso(),
                "credit_lot_id": lot["id"],  # back-link for audit
            }
            await db.dog_programs.insert_one(enrollment)
            if not dog.get("active_program_id"):
                await db.dogs.update_one({"id": dog["id"]},
                                         {"$set": {"active_program_id": enrollment["id"]}})
            enrollment.pop("_id", None)
            # Sprint 110bx — fire welcome homework auto-assign
            try:
                await _auto_assign_welcome_homework(enrollment)
            except Exception as exc:
                logger.warning("Sell-program welcome homework failed: %s", exc)
            enrollment_summary = _enrollment_summary(enrollment)

    # Sprint 110ce — recurring session scheduling. Skipped entirely for
    # board_train (the dog is on-site so weekly bookings don't make sense)
    # and for sales without a target dog (can't book a session for nobody).
    scheduled_bookings: list = []
    schedule_warnings: list = []
    can_schedule = (
        dog is not None
        and body.schedule_day_of_week is not None
        and body.schedule_time
        and (program.get("type") or "custom") != "board_train"
    )
    if can_schedule:
        # Pull closed dates so we can skip them (or warn the admin)
        settings_doc = await db.settings.find_one({"_id": "main"}, {"_id": 0}) or {}
        closed_dates = set(settings_doc.get("closed_dates") or [])

        # Anchor date: schedule_start_date if provided, else next instance of
        # the chosen weekday (including today if today matches)
        from datetime import date as _date, timedelta as _td
        if body.schedule_start_date:
            anchor = _date.fromisoformat(body.schedule_start_date)
        else:
            anchor = _date.today()
        # Roll forward to the desired weekday
        wd_target = body.schedule_day_of_week
        delta = (wd_target - anchor.weekday()) % 7
        first_date = anchor + _td(days=delta)

        # Generate `qty` weekly dates, skipping closed days (and adding extra
        # weeks at the end if any get skipped) — UNLESS override_closures is
        # set, in which case we include closed dates verbatim.
        generated: list = []
        cursor = first_date
        attempts = 0
        max_attempts = qty * 5  # safety net to avoid infinite loops
        while len(generated) < qty and attempts < max_attempts:
            iso = cursor.isoformat()
            if iso in closed_dates and not body.schedule_override_closures:
                schedule_warnings.append({
                    "date": iso,
                    "reason": "business_closed",
                    "note": "Skipped — business closed; rolled forward 7 days.",
                })
                cursor += _td(days=7)
                attempts += 1
                continue
            generated.append(iso)
            cursor += _td(days=7)
            attempts += 1

        # Now create the bookings. Each is prepaid ($0 actual_price) and tied
        # back to the credit lot so the books stay clean.
        for iso_date in generated:
            booking = {
                "id": _gid(),
                "dog_id": dog["id"],
                "dog_name": dog.get("name", ""),
                "client_id": client_id,
                "client_name": client.get("name", ""),
                "service_type": "training",
                "date": iso_date,
                "end_date": None,
                "time": body.schedule_time,
                "kennel": "",
                "notes": f"Program · {program['name']} · session {generated.index(iso_date) + 1} of {qty}",
                "status": "approved",
                "actual_price": 0.0,
                "payment_status": "paid",
                "payment_method": "credits",
                "created_at": now_iso(),
                "created_by": user.get("id"),
                # Sprint 110ce back-links — these let cancel/reschedule restore
                # the credit slot and let the trainer see "this is session X of Y"
                "credit_lot_id": lot["id"],
                "program_id": program["id"],
                "program_sale_session_index": generated.index(iso_date) + 1,
                "program_sale_session_total": qty,
                "is_prepaid_program_session": True,
            }
            await db.bookings.insert_one(booking)
            booking.pop("_id", None)
            scheduled_bookings.append(booking)

    lot.pop("_id", None)
    return {
        "lot": lot,
        "enrollment": enrollment_summary,  # null when dog_id not provided
        "client_balance": int((client.get("training_credits") or 0)) + qty,
        "scheduled_bookings": scheduled_bookings,
        "schedule_warnings": schedule_warnings,
    }

@api.post("/bookings/{booking_id}/reschedule-next-week")
async def reschedule_prepaid_session(booking_id: str, _: dict = Depends(require_admin)):
    """Sprint 110ce — push a prepaid program session forward to the next
    available same-weekday slot, skipping business-closure dates AND any other
    bookings already scheduled for that dog on the candidate date. Doesn't
    touch the credit lot (no re-credit because nothing was charged in the
    first place; the session is just moving in time)."""
    bk = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not bk:
        raise HTTPException(404, "Booking not found")
    if not bk.get("is_prepaid_program_session"):
        raise HTTPException(400, "This endpoint is only for prepaid program sessions")
    from datetime import date as _date, timedelta as _td
    settings_doc = await db.settings.find_one({"_id": "main"}, {"_id": 0}) or {}
    closed_dates = set(settings_doc.get("closed_dates") or [])
    cur_date = _date.fromisoformat(bk["date"])
    # Try the next 12 weeks; skip closures + dog-double-booked dates
    for i in range(1, 13):
        candidate = cur_date + _td(days=7 * i)
        iso = candidate.isoformat()
        if iso in closed_dates:
            continue
        conflict = await db.bookings.find_one(
            {"dog_id": bk["dog_id"], "date": iso,
             "id": {"$ne": booking_id},
             "status": {"$ne": "cancelled"}},
            {"_id": 0, "id": 1},
        )
        if conflict:
            continue
        await db.bookings.update_one({"id": booking_id}, {"$set": {
            "date": iso,
            "rescheduled_from": bk["date"],
            "rescheduled_at": now_iso(),
        }})
        updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        return {"ok": True, "booking": updated, "from": bk["date"], "to": iso}
    raise HTTPException(409, "No open slot found in the next 12 weeks on that weekday")



# ────────── Sprint 110cf · Client-initiated reschedule requests ──────────
#
# Flow: client taps "Reschedule" on a prepaid program session in the portal,
# picks 1–3 alternate dates/times. We store a `reschedule_requests` row in
# status="pending" + email the admin with one-click approve links. Admin
# picks the slot that works → booking moves, credit is untouched, client
# gets a confirmation email. If none of the slots work, admin declines and
# the client gets a "we'll be in touch" email; the original booking stays.

class RescheduleProposedSlot(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM


class RescheduleRequestIn(BaseModel):
    proposed_slots: List[RescheduleProposedSlot] = Field(..., min_length=1, max_length=3)
    client_note: Optional[str] = ""


@api.post("/portal/bookings/{booking_id}/request-reschedule")
async def request_reschedule(
    booking_id: str,
    body: RescheduleRequestIn,
    current: dict = Depends(get_current_user),
):
    """Client portal — propose 1-3 alternate slots for a prepaid program session."""
    bk = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not bk:
        raise HTTPException(404, "Booking not found")
    if not bk.get("is_prepaid_program_session"):
        raise HTTPException(400, "Reschedule requests are only for prepaid program sessions")
    if current.get("role") == "client" and bk.get("client_id") != current.get("client_id"):
        raise HTTPException(403, "Not your booking")
    if bk.get("status") == "cancelled":
        raise HTTPException(400, "This booking is cancelled")

    # Don't allow piling up duplicate pending requests on the same booking
    existing = await db.reschedule_requests.find_one(
        {"booking_id": booking_id, "status": "pending"},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(409, "There's already a pending reschedule request for this session")

    req_doc = {
        "id": _gid(),
        "booking_id": booking_id,
        "client_id": bk.get("client_id"),
        "client_name": bk.get("client_name"),
        "dog_id": bk.get("dog_id"),
        "dog_name": bk.get("dog_name"),
        "current_date": bk.get("date"),
        "current_time": bk.get("time"),
        "proposed_slots": [s.model_dump() for s in body.proposed_slots],
        "client_note": body.client_note or "",
        "status": "pending",
        "created_at": now_iso(),
        "created_by": current.get("id"),
    }
    await db.reschedule_requests.insert_one(req_doc)
    req_doc.pop("_id", None)

    # Email admin (best-effort)
    try:
        proposed_list_html = "<br/>".join(
            f"• {s.date} at {s.time}" for s in body.proposed_slots
        )
        await email_service._dispatch(
            slug="admin_reschedule_request",
            to_email=os.environ.get("ADMIN_NOTIFICATION_EMAIL", ""),
            ctx={
                "client_name": bk.get("client_name", ""),
                "dog_name": bk.get("dog_name", ""),
                "current_date": bk.get("date", ""),
                "current_time": bk.get("time", ""),
                "proposed_count": len(body.proposed_slots),
                "proposed_plural": "" if len(body.proposed_slots) == 1 else "s",
                "proposed_list": proposed_list_html,
            },
            rows=[
                ("Currently", f"{bk.get('date','')} at {bk.get('time','')}"),
                ("Client", bk.get("client_name", "")),
                ("Dog", bk.get("dog_name", "")),
            ] + ([("Client's note", body.client_note)] if body.client_note else []),
            cta_url=f"{os.environ.get('APP_PUBLIC_URL', '')}/" if os.environ.get("APP_PUBLIC_URL") else None,
            show_install=False,
        )
    except Exception as exc:
        logger.warning("Reschedule request email failed: %s", exc)

    return req_doc


@api.get("/admin/reschedule-requests")
async def list_reschedule_requests(
    status: Optional[str] = "pending",
    _: dict = Depends(require_admin),
):
    """Inbox of client-initiated reschedule requests."""
    q: dict = {}
    if status:
        q["status"] = status
    rows = await db.reschedule_requests.find(q, {"_id": 0}).sort([("created_at", -1)]).to_list(200)
    return rows


@api.get("/portal/reschedule-requests")
async def list_my_reschedule_requests(current: dict = Depends(get_current_user)):
    """Client portal — list pending/recent reschedule requests for this client."""
    if not current.get("client_id"):
        raise HTTPException(400, "No client linked to this account")
    rows = await db.reschedule_requests.find(
        {"client_id": current["client_id"]}, {"_id": 0},
    ).sort([("created_at", -1)]).to_list(50)
    return rows


class RescheduleApproveIn(BaseModel):
    slot_index: int = Field(..., ge=0, le=2)


@api.post("/admin/reschedule-requests/{req_id}/approve")
async def approve_reschedule_request(
    req_id: str,
    body: RescheduleApproveIn,
    _: dict = Depends(require_admin),
):
    """Approve one of the proposed slots — moves the booking, leaves credits
    alone, and emails the client a confirmation."""
    req = await db.reschedule_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, f"Request is already {req.get('status')}")
    slots = req.get("proposed_slots") or []
    if body.slot_index >= len(slots):
        raise HTTPException(400, "slot_index out of range")
    chosen = slots[body.slot_index]

    bk = await db.bookings.find_one({"id": req["booking_id"]}, {"_id": 0})
    if not bk:
        raise HTTPException(404, "Original booking is gone")
    original_date = bk.get("date")
    await db.bookings.update_one(
        {"id": req["booking_id"]},
        {"$set": {
            "date": chosen["date"],
            "time": chosen["time"],
            "rescheduled_from": original_date,
            "rescheduled_at": now_iso(),
            "rescheduled_via_request": req_id,
        }},
    )
    await db.reschedule_requests.update_one(
        {"id": req_id},
        {"$set": {
            "status": "approved",
            "approved_slot_index": body.slot_index,
            "approved_at": now_iso(),
        }},
    )

    # Email client
    client = await db.clients.find_one({"id": req["client_id"]}, {"_id": 0}) or {}
    if client.get("email"):
        try:
            await email_service._dispatch(
                slug="client_reschedule_approved",
                to_email=client["email"],
                ctx={
                    "first_name": (client.get("name") or "there").split(" ")[0],
                    "client_name": client.get("name", ""),
                    "dog_name": req.get("dog_name", ""),
                    "new_date": chosen["date"],
                    "new_time": chosen["time"],
                    "original_date": original_date,
                },
                rows=[
                    ("Dog", req.get("dog_name", "")),
                    ("New date", chosen["date"]),
                    ("New time", chosen["time"]),
                ],
                cta_url=f"{os.environ.get('APP_PUBLIC_URL', '')}/" if os.environ.get("APP_PUBLIC_URL") else None,
            )
        except Exception as exc:
            logger.warning("Approval email failed: %s", exc)

    updated = await db.reschedule_requests.find_one({"id": req_id}, {"_id": 0})
    return updated


class RescheduleDeclineIn(BaseModel):
    reason: Optional[str] = ""


@api.post("/admin/reschedule-requests/{req_id}/decline")
async def decline_reschedule_request(
    req_id: str,
    body: RescheduleDeclineIn,
    _: dict = Depends(require_admin),
):
    """Mark a reschedule request as declined and let the client know we'll
    follow up. Original booking is untouched."""
    req = await db.reschedule_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, f"Request is already {req.get('status')}")
    await db.reschedule_requests.update_one(
        {"id": req_id},
        {"$set": {
            "status": "declined",
            "decline_reason": body.reason or "",
            "declined_at": now_iso(),
        }},
    )
    client = await db.clients.find_one({"id": req["client_id"]}, {"_id": 0}) or {}
    if client.get("email"):
        try:
            await email_service._dispatch(
                slug="client_reschedule_declined",
                to_email=client["email"],
                ctx={
                    "first_name": (client.get("name") or "there").split(" ")[0],
                    "client_name": client.get("name", ""),
                    "dog_name": req.get("dog_name", ""),
                    "original_date": req.get("current_date", ""),
                    "decline_reason": body.reason or "",
                },
                rows=[("Dog", req.get("dog_name", ""))],
            )
        except Exception as exc:
            logger.warning("Decline email failed: %s", exc)
    updated = await db.reschedule_requests.find_one({"id": req_id}, {"_id": 0})
    return updated





@api.get("/admin/clients/{client_id}/training-credits")
async def client_training_credits_breakdown(
    client_id: str,
    _: dict = Depends(require_admin),
):
    """Per-program breakdown of a client's outstanding training credits.

    Aggregates `credit_lots` rows where pack_kind=training_program and
    qty_remaining > 0, grouped by program. Used by the client profile to
    show "3 of 4 Puppy Preschool left" alongside the global total.
    """
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "training_credits": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    lots = await db.credit_lots.find(
        {"client_id": client_id, "pack_kind": "training_program",
         "qty_remaining": {"$gt": 0}},
        {"_id": 0},
    ).sort([("purchased_at", 1)]).to_list(500)

    by_program: Dict[str, Dict[str, Any]] = {}
    for lot in lots:
        pid = lot.get("program_id") or lot.get("pack_id") or "unknown"
        bucket = by_program.setdefault(pid, {
            "program_id": pid,
            "program_name": lot.get("program_name") or lot.get("pack_name") or "Training",
            "unit": lot.get("unit") or "sessions",
            "qty_remaining": 0,
            "qty_total": 0,
            "lots": [],
        })
        bucket["qty_remaining"] += int(lot.get("qty_remaining") or 0)
        bucket["qty_total"] += int(lot.get("qty_total") or 0)
        bucket["lots"].append({
            "lot_id": lot.get("id"),
            "purchased_at": lot.get("purchased_at"),
            "qty_remaining": int(lot.get("qty_remaining") or 0),
            "qty_total": int(lot.get("qty_total") or 0),
            "price_paid": float(lot.get("price_paid") or 0),
            "value_each": float(lot.get("value_each") or 0),
        })

    return {
        "global_training_credits": int(client.get("training_credits") or 0),
        "by_program": list(by_program.values()),
        "lots_count": len(lots),
    }



@api.post("/clients/{client_id}/sell-pack")
async def sell_credit_pack(client_id: str, body: SellCreditPackIn, user: dict = Depends(require_admin)):
    """Sell a pack to a client — increments their credit balance AND creates a
    FIFO credit_lot tagged with the per-credit value. Does NOT generate a
    revenue event (income is recognized when each credit is redeemed at
    check-out)."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    pack = await db.credit_packs.find_one({"id": body.pack_id}, {"_id": 0})
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")
    qty = int(pack["qty"])
    # Sprint 110am — honour a legacy-pricing override if one is active for this
    # client + pack. Falls back to the catalog price when no override exists.
    pricing = await resolve_client_price(client_id, "credit_pack", pack["id"], float(pack["price"]))
    effective_price = pricing["effective_price"]
    value_each = round(effective_price / max(qty, 1), 2)
    svc_type = pack.get("service_type") or "daycare"
    lot = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "pack_id": pack["id"],
        "pack_name": pack["name"],
        "service_type": svc_type,
        "qty_total": qty,
        "qty_remaining": qty,
        "price_paid": effective_price,
        "list_price": float(pack["price"]),
        "price_override_id": pricing["override_id"],
        "value_each": value_each,
        "payment_method": body.payment_method,
        "note": body.note or "",
        "sold_by": user.get("name", "Admin"),
        "purchased_at": now_iso(),
    }
    await db.credit_lots.insert_one(lot)
    balance_field = _credit_balance_field(svc_type) or "credits"
    await db.clients.update_one({"id": client_id}, {"$inc": {balance_field: qty}})
    lot.pop("_id", None)
    return lot


@api.post("/clients/{client_id}/sell-packs")
async def sell_credit_packs_bulk(client_id: str, body: SellCreditPacksBulkIn, user: dict = Depends(require_admin)):
    """Sell multiple credit packs to a client in a single transaction.
    Each {pack_id, quantity} pair mints `quantity` separate FIFO lots so
    accounting + redemption logic stays unchanged. Returns the list of new
    lots plus a per-pool totals summary (qty + price)."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Pre-fetch every pack referenced so we fail fast on unknown ids before
    # any mutations land.
    pack_ids = [it.pack_id for it in body.items]
    packs = {p["id"]: p for p in await db.credit_packs.find({"id": {"$in": pack_ids}}, {"_id": 0}).to_list(200)}
    missing = [pid for pid in pack_ids if pid not in packs]
    if missing:
        raise HTTPException(status_code=404, detail=f"Pack(s) not found: {', '.join(missing)}")

    new_lots: List[Dict] = []
    pool_increments: Dict[str, int] = {"daycare": 0, "training": 0, "boarding": 0}
    totals_by_pool = {
        "daycare": {"qty": 0, "price": 0.0},
        "training": {"qty": 0, "price": 0.0},
        "boarding": {"qty": 0, "price": 0.0},
    }

    now = now_iso()
    for item in body.items:
        pack = packs[item.pack_id]
        qty = int(pack["qty"])
        # Sprint 110am — same legacy-pricing resolution as the single-sell path
        pricing = await resolve_client_price(client_id, "credit_pack", pack["id"], float(pack["price"]))
        effective_price = pricing["effective_price"]
        value_each = round(effective_price / max(qty, 1), 2)
        svc_type = pack.get("service_type") or "daycare"
        pool_key = svc_type if svc_type in pool_increments else "daycare"
        for _ in range(item.quantity):
            lot = {
                "id": str(uuid.uuid4()),
                "client_id": client_id,
                "pack_id": pack["id"],
                "pack_name": pack["name"],
                "service_type": svc_type,
                "qty_total": qty,
                "qty_remaining": qty,
                "price_paid": effective_price,
                "list_price": float(pack["price"]),
                "price_override_id": pricing["override_id"],
                "value_each": value_each,
                "payment_method": body.payment_method,
                "note": body.note or "",
                "sold_by": user.get("name", "Admin"),
                "purchased_at": now,
            }
            new_lots.append(lot)
            pool_increments[pool_key] += qty
            totals_by_pool[pool_key]["qty"] += qty
            totals_by_pool[pool_key]["price"] += effective_price

    await db.credit_lots.insert_many(new_lots)
    inc_doc: Dict[str, int] = {}
    if pool_increments["daycare"]:
        inc_doc["credits"] = pool_increments["daycare"]
    if pool_increments["training"]:
        inc_doc["training_credits"] = pool_increments["training"]
    if pool_increments["boarding"]:
        inc_doc["boarding_credits"] = pool_increments["boarding"]
    if inc_doc:
        await db.clients.update_one({"id": client_id}, {"$inc": inc_doc})

    # Strip mongo _id from response payload defensively (insert_many mutates).
    for lot in new_lots:
        lot.pop("_id", None)
    for pool in totals_by_pool.values():
        pool["price"] = round(pool["price"], 2)
    grand_total = round(sum(p["price"] for p in totals_by_pool.values()), 2)

    # Build line-items for the receipt (group identical packs into one row).
    receipt_lines: List[Dict] = []
    for item in body.items:
        pack = packs[item.pack_id]
        unit_price = float(pack["price"])
        receipt_lines.append({
            "pack_id": pack["id"],
            "name": pack["name"],
            "qty": item.quantity,
            "unit_price": unit_price,
            "line_total": round(unit_price * item.quantity, 2),
            "service_type": pack.get("service_type") or "daycare",
            "pack_qty": int(pack["qty"]),
        })

    receipt = {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "client_email": client.get("email", ""),
        "lines": receipt_lines,
        "totals": totals_by_pool,
        "total_price": grand_total,
        "payment_method": body.payment_method,
        "note": body.note or "",
        "sold_by": user.get("name", "Admin"),
        "sold_at": now,
    }

    # Best-effort: email the client a receipt copy.
    try:
        await notify_client_pack_receipt(
            client=client,
            lines=receipt_lines,
            totals=totals_by_pool,
            payment_method=body.payment_method or "cash",
            note=body.note or "",
            sold_by=user.get("name", "Admin"),
            sold_at=now,
        )
    except Exception:
        pass

    return {
        "lots": new_lots,
        "totals": totals_by_pool,
        "total_price": grand_total,
        "lots_created": len(new_lots),
        "receipt": receipt,
    }


@api.get("/clients/{client_id}/credit-lots")
async def list_client_lots(client_id: str, _: dict = Depends(require_admin)):
    lots = await db.credit_lots.find({"client_id": client_id}, {"_id": 0}).sort("purchased_at", -1).to_list(200)
    return lots


@api.get("/clients/{client_id}/receipts")
async def list_client_receipts(client_id: str, _: dict = Depends(require_admin)):
    """Group credit_lots into receipts (one per bulk-sale transaction). All
    lots created in the same `POST /sell-packs` call share an identical
    `purchased_at` timestamp + payment_method + sold_by, so we group on that.
    Returns receipts shaped exactly like the `receipt` object the sell-packs
    endpoint emits, so the frontend can reuse the same ReceiptModal."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    lots = await db.credit_lots.find({"client_id": client_id}, {"_id": 0}).sort("purchased_at", -1).to_list(500)

    # Group by (purchased_at, payment_method, sold_by, note) — each tuple
    # represents one cart checkout.
    groups: Dict[tuple, Dict] = {}
    for lot in lots:
        key = (
            lot.get("purchased_at", ""),
            lot.get("payment_method", "cash") or "cash",
            lot.get("sold_by", "") or "",
            lot.get("note", "") or "",
        )
        bucket = groups.setdefault(key, {
            "sold_at": lot.get("purchased_at", ""),
            "payment_method": lot.get("payment_method", "cash") or "cash",
            "sold_by": lot.get("sold_by", "") or "",
            "note": lot.get("note", "") or "",
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "client_email": client.get("email", ""),
            "_lines_by_pack": {},  # pack_id -> aggregated line
            "totals": {"daycare": {"qty": 0, "price": 0.0}, "training": {"qty": 0, "price": 0.0}},
        })
        pack_id = lot.get("pack_id", "")
        pack_qty = int(lot.get("qty_total") or 0)
        unit_price = float(lot.get("price_paid") or 0)
        svc = lot.get("service_type") or "daycare"
        line = bucket["_lines_by_pack"].setdefault(pack_id, {
            "pack_id": pack_id,
            "name": lot.get("pack_name", "Pack"),
            "qty": 0,
            "unit_price": unit_price,
            "line_total": 0.0,
            "service_type": svc,
            "pack_qty": pack_qty,
        })
        line["qty"] += 1
        line["line_total"] = round(line["unit_price"] * line["qty"], 2)
        pool = bucket["totals"]["training"] if svc == "training" else bucket["totals"]["daycare"]
        pool["qty"] += pack_qty
        pool["price"] = round(pool["price"] + unit_price, 2)

    out: List[Dict] = []
    for bucket in groups.values():
        lines = list(bucket.pop("_lines_by_pack").values())
        bucket["lines"] = lines
        bucket["total_price"] = round(bucket["totals"]["daycare"]["price"] + bucket["totals"]["training"]["price"], 2)
        bucket["line_count"] = len(lines)
        bucket["lot_count"] = sum(ln["qty"] for ln in lines)
        out.append(bucket)
    out.sort(key=lambda r: r["sold_at"], reverse=True)
    return out


# ────────────────────────── Multi-Date Bookings ──────────────────────────
class MultiDateBookingIn(BaseModel):
    dog_id: str
    dates: List[str] = Field(min_length=1, max_length=60)  # YYYY-MM-DD strings
    service_type: Literal["daycare", "training", "grooming", "photography"] = "daycare"
    notes: Optional[str] = ""
    grooming_type: Optional[Literal["bath", "nail_trim"]] = None
    time: Optional[str] = ""  # HH:MM — used by time-slotted services (training/grooming/photography)
    override_capacity: Optional[bool] = False  # admin only
    override_vaccines: Optional[bool] = False  # admin only
    # Sprint 110an — every booking in the batch gets the same add-ons attached
    # (e.g. "Mon/Wed/Fri daycare with a nail trim each day").
    addon_service_ids: List[str] = []


@api.post("/bookings/multi-dates")
async def create_multi_date_bookings(body: MultiDateBookingIn, user: dict = Depends(get_current_user)):
    """Creates one booking per date in `dates`. Returns
    {created: [...], skipped: [{date, reason}]} so the UI can show exactly
    which days made it and which were rejected (capacity, vaccine, etc).
    Each booking goes through the standard create_booking validations, so
    capacity + vaccines + waiver still apply.

    Per-booking admin notifications are suppressed; a single summary email
    fires after the loop so the operator gets ONE alert per multi-date action.
    """
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog["owner_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")

    created: List[Dict] = []
    skipped: List[Dict] = []
    token = _suppress_admin_booking_email.set(True)
    try:
        for d in sorted(set(body.dates)):
            try:
                inn = BookingIn(
                    dog_id=body.dog_id,
                    date=d,
                    service_type=body.service_type,
                    notes=body.notes or "",
                    grooming_type=body.grooming_type if body.service_type == "grooming" else None,
                    time=body.time or "" if body.service_type in ("training", "grooming", "photography") else "",
                    override_capacity=bool(body.override_capacity) if user.get("role") == "admin" else False,
                    override_vaccines=bool(body.override_vaccines) if user.get("role") == "admin" else False,
                    addon_service_ids=body.addon_service_ids or [],
                )
                booking = await create_booking(inn, user)
                created.append(booking)
            except HTTPException as e:
                skipped.append({"date": d, "reason": e.detail})
            except Exception as e:
                skipped.append({"date": d, "reason": str(e)[:200]})
    finally:
        _suppress_admin_booking_email.reset(token)
    # ONE summary email — only for non-admin (client portal) actions.
    if user.get("role") != "admin" and created:
        try:
            client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0}) or {}
            await notify_admin_bulk_booking(
                created, client, service_type=body.service_type, skipped=skipped, kind="multi-dates"
            )
        except Exception:
            pass
    return {"created": created, "skipped": skipped, "summary": f"{len(created)} booked, {len(skipped)} skipped"}


# ============================================================
# Email Customization (admin) + Homework Streak (portal)
# ============================================================
from email_templates_registry import EMAIL_TEMPLATES as _EMAIL_REGISTRY, get_template as _email_get_template  # noqa: E402


def _email_settings_defaults() -> dict:
    """Branding defaults — kept in sync with the constants in email_service."""
    return {
        "brand_name": "Sit Happens",
        "brand_green": "#8cc63f",
        "brand_blue": "#00a9e0",
        "brand_dark": "#0f172a",
        "logo_url": "",
        "signature_html": "",
        "footer_html": "Sit Happens Dog Training · Daycare · Boarding<br/>You're receiving this because of activity on your Sit Happens account.",
    }


class EmailTemplateUpdate(BaseModel):
    subject: Optional[str] = None
    title: Optional[str] = None
    intro_html: Optional[str] = None
    cta_text: Optional[str] = None
    signoff_html: Optional[str] = None


class EmailSettingsUpdate(BaseModel):
    brand_name: Optional[str] = None
    brand_green: Optional[str] = None
    brand_blue: Optional[str] = None
    brand_dark: Optional[str] = None
    logo_url: Optional[str] = None
    signature_html: Optional[str] = None
    footer_html: Optional[str] = None


@api.get("/admin/email-templates")
async def list_email_templates(_: dict = Depends(require_admin)):
    """List every email Sit Happens sends along with the operator's custom
    overrides (if any). The Settings UI uses this to drive the template editor."""
    overrides = {}
    async for row in db.email_templates.find({}, {"_id": 0}):
        overrides[row.get("slug")] = row
    out = []
    for tpl in _EMAIL_REGISTRY:
        slug = tpl["slug"]
        ov = overrides.get(slug, {}) or {}
        out.append({
            "slug": slug,
            "name": tpl["name"],
            "description": tpl["description"],
            "category": tpl["category"],
            "audience": tpl["audience"],
            "variables": tpl.get("variables", []),
            "defaults": {
                "subject": tpl.get("default_subject", ""),
                "title": tpl.get("default_title", ""),
                "intro_html": tpl.get("default_intro_html", ""),
                "cta_text": tpl.get("default_cta_text", ""),
            },
            "override": {
                "subject": ov.get("subject", ""),
                "title": ov.get("title", ""),
                "intro_html": ov.get("intro_html", ""),
                "cta_text": ov.get("cta_text", ""),
                "signoff_html": ov.get("signoff_html", ""),
                "updated_at": ov.get("updated_at", ""),
            },
            "is_customized": bool(ov),
        })
    return out


@api.get("/admin/email-templates/{slug}")
async def get_email_template(slug: str, _: dict = Depends(require_admin)):
    tpl = _email_get_template(slug)
    if not tpl:
        raise HTTPException(status_code=404, detail="Unknown template")
    ov = await db.email_templates.find_one({"slug": slug}, {"_id": 0}) or {}
    return {
        "slug": slug,
        "name": tpl["name"],
        "description": tpl["description"],
        "category": tpl["category"],
        "audience": tpl["audience"],
        "variables": tpl.get("variables", []),
        "defaults": {
            "subject": tpl.get("default_subject", ""),
            "title": tpl.get("default_title", ""),
            "intro_html": tpl.get("default_intro_html", ""),
            "cta_text": tpl.get("default_cta_text", ""),
        },
        "override": ov,
        "is_customized": bool(ov),
    }


@api.put("/admin/email-templates/{slug}")
async def update_email_template(slug: str, body: EmailTemplateUpdate, _: dict = Depends(require_admin)):
    if not _email_get_template(slug):
        raise HTTPException(status_code=404, detail="Unknown template")
    update_doc = {k: v for k, v in body.model_dump().items() if v is not None}
    update_doc["slug"] = slug
    update_doc["updated_at"] = now_iso()
    await db.email_templates.update_one({"slug": slug}, {"$set": update_doc}, upsert=True)
    email_service.invalidate_template_cache()
    return {"ok": True, "slug": slug, "override": update_doc}


@api.post("/admin/email-templates/{slug}/reset")
async def reset_email_template(slug: str, _: dict = Depends(require_admin)):
    if not _email_get_template(slug):
        raise HTTPException(status_code=404, detail="Unknown template")
    await db.email_templates.delete_one({"slug": slug})
    email_service.invalidate_template_cache()
    return {"ok": True, "slug": slug}


class EmailTestRequest(BaseModel):
    to_email: Optional[str] = None


@api.post("/admin/email-templates/{slug}/test")
async def test_email_template(slug: str, body: EmailTestRequest, current: dict = Depends(require_admin)):
    """Send a test email using sample data so the operator can preview their
    customizations. Falls back to the current admin's email if no target is given."""
    tpl = _email_get_template(slug)
    if not tpl:
        raise HTTPException(status_code=404, detail="Unknown template")
    to = (body.to_email or "").strip() or current.get("email") or os.environ.get("ADMIN_NOTIFICATION_EMAIL", "")
    if not to:
        raise HTTPException(status_code=400, detail="No recipient email available")
    # Build a sample ctx covering every declared variable.
    sample_ctx = {
        "first_name": "Alex",
        "client_name": "Alex Rivera",
        "dog_name": "Buddy",
        "dog_name_or_dogs": "Buddy",
        "homework_title": "Loose Leash Walking · Week 1",
        "due_date": "2026-02-20",
        "assigned_by": "Trainer Jamie",
        "service_label": "Daycare",
        "date_range": "2026-02-20 → 2026-02-22",
        "kennel": "Kennel 4",
        "remaining": 2,
        "unit": "days",
        "total_label": "$120.00",
        "payment_method": "Card",
        "sold_by": "Jamie",
        "sold_at": "2026-02-15",
        "item_name": "Puppy Preschool",
        "message": "When can we start?",
        "day_number": 3,
        "action_label": "approved",
        "action_emoji": "✅",
        "review_note": "Nice work — keep it up!",
        "phone": "(555) 123-4567",
        "email": "alex@example.com",
        "date": "2026-02-20",
        "count": 3,
        "kind": "recurring schedule",
        "dates_preview": "Feb 20, Feb 27, Mar 5",
        "week_label": "Feb 10 → Feb 16",
        "sessions_count": 12,
        "completions_count": 2,
        "period_label": "Jan 2026",
        "revenue": "$4,250.00",
        "expenses": "$1,180.00",
        "net": "$3,070.00",
        "age": 5,
    }
    sample_rows = [
        ("Dog", "Buddy"),
        ("Client", "Alex Rivera"),
        ("Note", "This is a preview — real emails will have live data."),
    ]
    ok = await email_service._dispatch(
        slug=slug,
        to_email=to,
        ctx=sample_ctx,
        rows=sample_rows,
        cta_url=os.environ.get("APP_PUBLIC_URL", "") or None,
        show_install=False,
    )
    return {"ok": bool(ok), "sent_to": to, "slug": slug}


@api.get("/admin/email-settings")
async def get_email_settings(_: dict = Depends(require_admin)):
    """Singleton branding doc with sensible defaults filled in."""
    doc = await db.email_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    merged = {**_email_settings_defaults(), **doc}
    return merged


@api.put("/admin/email-settings")
async def update_email_settings(body: EmailSettingsUpdate, _: dict = Depends(require_admin)):
    update_doc = {k: v for k, v in body.model_dump().items() if v is not None}
    update_doc["updated_at"] = now_iso()
    await db.email_settings.update_one(
        {"_id": "singleton"}, {"$set": update_doc}, upsert=True,
    )
    email_service.invalidate_settings_cache()
    doc = await db.email_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {**_email_settings_defaults(), **doc}


# ------------- Homework Streak (client portal) -------------

@api.get("/portal/homework-streak")
async def portal_homework_streak(current: dict = Depends(get_current_user)):
    """Current + longest consecutive-day homework completion streak for the
    logged-in client. Drives the 🔥 streak tile on the portal home."""
    client_id = current.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="No client linked to this account")

    docs = await db.homework.find(
        {"client_id": client_id, "status": "completed"},
        {"_id": 0, "completed_at": 1},
    ).to_list(5000)

    from datetime import date as _date, timedelta as _td  # local import to avoid name clashes
    days = set()
    for d in docs:
        ts = d.get("completed_at") or ""
        try:
            days.add(datetime.fromisoformat(ts).date())
        except Exception:
            continue

    today = _date.today()
    # Current streak: count back from today (or yesterday if no completion today)
    current_streak = 0
    if days:
        anchor = today if today in days else today - _td(days=1)
        cur = anchor
        while cur in days:
            current_streak += 1
            cur -= _td(days=1)

    # Longest streak: scan sorted days, count contiguous runs
    longest_streak = 0
    if days:
        sorted_days = sorted(days)
        run = 1
        longest_streak = 1
        for i in range(1, len(sorted_days)):
            if (sorted_days[i] - sorted_days[i - 1]).days == 1:
                run += 1
                longest_streak = max(longest_streak, run)
            else:
                run = 1

    last_completed = max(days).isoformat() if days else None
    # Milestone hints: 3 → 7 → 14 → 30 → 60 → 100
    milestones = [3, 7, 14, 30, 60, 100, 200, 365]
    next_milestone = next((m for m in milestones if m > current_streak), None)

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "last_completed_date": last_completed,
        "next_milestone": next_milestone,
        "days_to_next_milestone": (next_milestone - current_streak) if next_milestone else None,
        "completed_today": today in days,
    }



@api.get("/")
async def root():
    return {"service": "sit-happens", "status": "ok"}




# ============================================================
# Sprint 110ch · Payment Plans (big-ticket items)
# ============================================================
DEFAULT_PAYMENT_AGREEMENT_HTML = """
<p><strong>Payment Agreement</strong></p>
<p>This agreement is between {{business_name}} ("Provider") and {{client_name}} ("Client"). The Client is purchasing <strong>{{program_name}}</strong> for a total of <strong>{{total_amount}}</strong>, to be paid in <strong>{{installment_count}} installments</strong> as scheduled below.</p>
<p><strong>Payment Schedule</strong></p>
<p>{{schedule_list}}</p>
<p><strong>Terms</strong></p>
<ul>
<li>Payments are due on the scheduled dates. Missed payments may suspend services.</li>
<li>Credits / sessions purchased under this plan do not expire and roll over month to month.</li>
<li>If a payment is missed, the Client agrees to contact {{business_name}} within 7 days to make alternate arrangements.</li>
<li>This plan may be cancelled by either party with written notice; any unused, unpaid balance is forgiven, and any paid amount applies as credit toward future services.</li>
<li>By signing below, the Client agrees to the schedule and terms above.</li>
</ul>
<p><em>Electronic signature has the same legal effect as a handwritten one under the U.S. E-SIGN Act.</em></p>
"""

DEFAULT_PAYMENT_PLAN_SETTINGS = {
    "agreement_html": DEFAULT_PAYMENT_AGREEMENT_HTML.strip(),
    "business_name": "Sit Happens",
    "reminder_days_before": 3,
    "default_cadence": "biweekly",  # weekly | biweekly | monthly | custom
}


class PaymentPlanSettingsUpdate(BaseModel):
    agreement_html: Optional[str] = None
    business_name: Optional[str] = None
    reminder_days_before: Optional[int] = Field(default=None, ge=0, le=30)
    default_cadence: Optional[Literal["weekly", "biweekly", "monthly", "custom"]] = None


@api.get("/admin/payment-plans/settings")
async def get_payment_plan_settings(_: dict = Depends(require_admin)):
    doc = await db.payment_plan_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {**DEFAULT_PAYMENT_PLAN_SETTINGS, **doc}


@api.put("/admin/payment-plans/settings")
async def update_payment_plan_settings(
    body: PaymentPlanSettingsUpdate,
    _: dict = Depends(require_admin),
):
    update_doc = {k: v for k, v in body.model_dump().items() if v is not None}
    update_doc["updated_at"] = now_iso()
    await db.payment_plan_settings.update_one(
        {"_id": "singleton"}, {"$set": update_doc}, upsert=True,
    )
    doc = await db.payment_plan_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {**DEFAULT_PAYMENT_PLAN_SETTINGS, **doc}


class PaymentInstallmentIn(BaseModel):
    due_date: str  # YYYY-MM-DD
    amount: float = Field(..., ge=0)


class PaymentPlanCreate(BaseModel):
    client_id: str
    program_id: Optional[str] = None
    source_kind: Literal["training_program", "manual"] = "training_program"
    source_id: Optional[str] = None  # credit_lot id, if applicable
    program_name: str
    total_amount: float = Field(..., ge=0)
    cadence: Literal["weekly", "biweekly", "monthly", "custom"] = "biweekly"
    installments: List[PaymentInstallmentIn] = Field(..., min_length=1, max_length=24)
    note: Optional[str] = ""


def _fmt_money(n: float) -> str:
    return f"${n:,.2f}"


def _render_agreement(plan: dict, settings: dict) -> str:
    """Render the agreement HTML for `plan` using current settings + variables."""
    sched_lines = "<br/>".join(
        f"• <strong>{i['due_date']}</strong> — {_fmt_money(i['amount'])}"
        for i in plan["installments"]
    )
    ctx = {
        "business_name": settings.get("business_name", "Sit Happens"),
        "client_name": plan.get("client_name", ""),
        "program_name": plan.get("program_name", ""),
        "total_amount": _fmt_money(plan.get("total_amount", 0)),
        "installment_count": len(plan["installments"]),
        "installment_amount": _fmt_money(plan["installments"][0]["amount"]) if plan["installments"] else "$0.00",
        "schedule_list": sched_lines,
    }
    template = settings.get("agreement_html") or DEFAULT_PAYMENT_AGREEMENT_HTML
    return email_service._substitute(template, ctx)


@api.post("/admin/payment-plans")
async def create_payment_plan(body: PaymentPlanCreate, current: dict = Depends(require_admin)):
    client = await db.clients.find_one({"id": body.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    sum_installments = round(sum(i.amount for i in body.installments), 2)
    if abs(sum_installments - body.total_amount) > 0.01:
        raise HTTPException(400, f"Installments sum to {sum_installments} but total is {body.total_amount}")

    settings_doc = await db.payment_plan_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    settings = {**DEFAULT_PAYMENT_PLAN_SETTINGS, **settings_doc}

    plan = {
        "id": _gid(),
        "client_id": body.client_id,
        "client_name": client.get("name") or "",
        "program_id": body.program_id,
        "program_name": body.program_name,
        "source_kind": body.source_kind,
        "source_id": body.source_id,
        "total_amount": round(body.total_amount, 2),
        "cadence": body.cadence,
        "status": "pending_signature",
        "installments": [
            {
                "id": _gid(),
                "due_date": i.due_date,
                "amount": round(i.amount, 2),
                "status": "due",
                "paid_at": None,
                "paid_method": None,
                "paid_by_admin_id": None,
                "notes": "",
            }
            for i in body.installments
        ],
        "note": body.note or "",
        "agreement_snapshot": "",  # filled at signature time
        "signature": None,
        "created_at": now_iso(),
        "created_by": current.get("id"),
        "reminder_days_before": settings.get("reminder_days_before", 3),
    }
    # Pre-render the agreement so the client sees what's been proposed
    plan["agreement_snapshot"] = _render_agreement(plan, settings)
    await db.payment_plans.insert_one(plan)
    plan.pop("_id", None)

    # Email the client with a link to review + sign
    if client.get("email"):
        try:
            first_amount = body.installments[0].amount if body.installments else 0
            await email_service._dispatch(
                slug="client_payment_plan_created",
                to_email=client["email"],
                ctx={
                    "first_name": (client.get("name") or "there").split(" ")[0],
                    "client_name": client.get("name", ""),
                    "program_name": body.program_name,
                    "total_amount": _fmt_money(body.total_amount),
                    "installment_count": len(body.installments),
                    "installment_amount": _fmt_money(first_amount),
                    "first_due_date": body.installments[0].due_date if body.installments else "",
                },
                rows=[
                    ("Program", body.program_name),
                    ("Total", _fmt_money(body.total_amount)),
                    ("Installments", str(len(body.installments))),
                    ("First due", body.installments[0].due_date if body.installments else ""),
                ],
                cta_url=f"{os.environ.get('APP_PUBLIC_URL', '')}/" if os.environ.get("APP_PUBLIC_URL") else None,
            )
        except Exception as e:
            logger.warning("Plan-created email failed: %s", e)
    return plan


@api.get("/admin/payment-plans")
async def list_payment_plans(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    q: dict = {}
    if status:
        q["status"] = status
    if client_id:
        q["client_id"] = client_id
    rows = await db.payment_plans.find(q, {"_id": 0}).sort([("created_at", -1)]).to_list(500)
    # Decorate each row with computed totals
    for p in rows:
        paid = sum(i["amount"] for i in p["installments"] if i["status"] == "paid")
        due = sum(i["amount"] for i in p["installments"] if i["status"] == "due")
        p["paid_total"] = round(paid, 2)
        p["remaining_total"] = round(due, 2)
        today_iso = business_today().isoformat()
        p["overdue_count"] = sum(
            1 for i in p["installments"]
            if i["status"] == "due" and i["due_date"] < today_iso
        )
    return rows


@api.get("/admin/payment-plans/{plan_id}")
async def get_payment_plan(plan_id: str, _: dict = Depends(require_admin)):
    p = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Plan not found")
    return p


class MarkPaidIn(BaseModel):
    method: Literal["cash", "card", "venmo", "check", "other"] = "card"
    notes: Optional[str] = ""


@api.post("/admin/payment-plans/{plan_id}/installments/{inst_id}/mark-paid")
async def mark_installment_paid(
    plan_id: str, inst_id: str, body: MarkPaidIn, current: dict = Depends(require_admin),
):
    p = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Plan not found")
    installments = p["installments"]
    target = next((i for i in installments if i["id"] == inst_id), None)
    if not target:
        raise HTTPException(404, "Installment not found")
    if target["status"] == "paid":
        raise HTTPException(400, "Installment already paid")
    target["status"] = "paid"
    target["paid_at"] = now_iso()
    target["paid_method"] = body.method
    target["paid_by_admin_id"] = current.get("id")
    if body.notes:
        target["notes"] = body.notes

    # Plan auto-completes when every installment is paid
    new_status = p["status"]
    if all(i["status"] in ("paid", "waived") for i in installments):
        new_status = "completed"

    await db.payment_plans.update_one(
        {"id": plan_id},
        {"$set": {"installments": installments, "status": new_status}},
    )

    # Confirm with the client
    client = await db.clients.find_one({"id": p["client_id"]}, {"_id": 0}) or {}
    if client.get("email"):
        remaining = [i for i in installments if i["status"] == "due"]
        rem_text = (
            "🎉 That was your final payment — plan complete!"
            if not remaining
            else f"{len(remaining)} payment{'s' if len(remaining) != 1 else ''} remaining."
        )
        try:
            await email_service._dispatch(
                slug="client_payment_received",
                to_email=client["email"],
                ctx={
                    "first_name": (client.get("name") or "there").split(" ")[0],
                    "client_name": client.get("name", ""),
                    "program_name": p.get("program_name", ""),
                    "amount": _fmt_money(target["amount"]),
                    "paid_method": body.method,
                    "remaining_count": len(remaining),
                    "remaining_text": rem_text,
                },
                rows=[
                    ("Paid", _fmt_money(target["amount"])),
                    ("Method", body.method.capitalize()),
                    ("Plan", p.get("program_name", "")),
                ],
                cta_url=f"{os.environ.get('APP_PUBLIC_URL', '')}/" if os.environ.get("APP_PUBLIC_URL") else None,
            )
        except Exception as e:
            logger.warning("Payment-received email failed: %s", e)
    updated = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    return updated


@api.post("/admin/payment-plans/{plan_id}/cancel")
async def cancel_payment_plan(plan_id: str, _: dict = Depends(require_admin)):
    p = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Plan not found")
    await db.payment_plans.update_one(
        {"id": plan_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso()}},
    )
    return await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})


# ──────── Client portal endpoints ────────

@api.get("/portal/payment-plans")
async def portal_list_payment_plans(current: dict = Depends(get_current_user)):
    if not current.get("client_id"):
        raise HTTPException(400, "No client linked to this account")
    rows = await db.payment_plans.find(
        {"client_id": current["client_id"]},
        {"_id": 0},
    ).sort([("created_at", -1)]).to_list(50)
    today_iso = business_today().isoformat()
    for p in rows:
        paid = sum(i["amount"] for i in p["installments"] if i["status"] == "paid")
        due = sum(i["amount"] for i in p["installments"] if i["status"] == "due")
        p["paid_total"] = round(paid, 2)
        p["remaining_total"] = round(due, 2)
        p["overdue_count"] = sum(
            1 for i in p["installments"]
            if i["status"] == "due" and i["due_date"] < today_iso
        )
    return rows


class PaymentPlanSignIn(BaseModel):
    typed_name: str = Field(..., min_length=2, max_length=120)


@api.post("/portal/payment-plans/{plan_id}/sign")
async def portal_sign_payment_plan(
    plan_id: str, body: PaymentPlanSignIn, request: Request,
    current: dict = Depends(get_current_user),
):
    """Typed-name e-signature flow. Stamps name + timestamp + IP for audit."""
    p = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Plan not found")
    if current.get("role") == "client" and p.get("client_id") != current.get("client_id"):
        raise HTTPException(403, "Not your plan")
    if p.get("status") != "pending_signature":
        raise HTTPException(400, f"Plan is already {p.get('status')}")

    client_ip = (request.headers.get("x-forwarded-for") or request.client.host or "").split(",")[0].strip()
    ua = request.headers.get("user-agent", "")
    sig = {
        "typed_name": body.typed_name.strip(),
        "signed_at": now_iso(),
        "ip_address": client_ip,
        "user_agent": ua[:300],
    }
    await db.payment_plans.update_one(
        {"id": plan_id},
        {"$set": {
            "signature": sig,
            "status": "active",
            "signed_at": sig["signed_at"],
        }},
    )
    return await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
