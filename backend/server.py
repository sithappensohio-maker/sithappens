from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal, Dict

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from email_service import (
    notify_admin_new_booking,
    notify_admin_new_client,
    notify_admin_homework_section_log,
    notify_admin_homework_completed,
    notify_client_booking_approved,
    notify_client_homework_assigned,
    notify_client_low_credits,
)

# -------- Config --------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
DAYCARE_CAPACITY = int(os.environ.get("DAYCARE_CAPACITY", "30"))

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI(title="Sit Happens API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("sithappens")


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


# -------- Models --------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str

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

class ClientOut(ClientIn):
    id: str
    waiver: bool = False
    portal_email: Optional[str] = None  # the login email of linked user
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
    service_type: Literal["daycare", "boarding", "training", "grooming"] = "daycare"
    grooming_type: Optional[Literal["bath", "nail_trim"]] = None  # only relevant when service_type=grooming
    end_date: Optional[str] = None  # for boarding
    notes: Optional[str] = ""
    kennel: Optional[str] = ""
    dropoff_time: Optional[str] = ""
    pickup_time: Optional[str] = ""
    # Admin-only overrides
    override_vaccines: bool = False
    override_capacity: bool = False
    check_in_now: bool = False

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
    cost: Optional[int] = 0
    grooming_type: Optional[str] = None
    # Income tracking (Sprint 16) — populated when the booking is logged as
    # a paid service. Backward-compatible; existing rows return None / "".
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    actual_price: Optional[float] = None
    payment_status: Optional[Literal["unpaid", "paid", "refunded", "comped"]] = None
    payment_method: Optional[Literal["cash", "card", "transfer", "credits", "other"]] = None
    paid_at: Optional[str] = None
    # Sprint 17 — credit lot tracking. credit_value is accrued at approval,
    # promoted to actual_price at check-out.
    credit_value: Optional[float] = None
    credit_lot_ids: Optional[List[str]] = None
    credit_service_type: Optional[str] = None  # 'daycare' or 'training' — which pool was charged

class ReportCardIn(BaseModel):
    photos: List[str] = []
    mood_tags: List[str] = []
    note: Optional[str] = ""


# -------- Auth --------
@api.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    # Auto-create a linked client record so they can self-manage profile + dogs
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
        "created_at": now_iso(),
    }
    await db.clients.insert_one(client_doc)
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
    # Best-effort: alert the operator that a new client just signed up.
    try:
        await notify_admin_new_client(user, client_doc)
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
    # attach portal email
    for c in items:
        u = await db.users.find_one({"client_id": c["id"]}, {"_id": 0, "email": 1})
        c["portal_email"] = u["email"] if u else None
    return items

@api.post("/clients", response_model=ClientOut)
async def create_client(body: ClientIn, _: dict = Depends(require_admin)):
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "waiver": False, "created_at": now_iso()})
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    doc["portal_email"] = None
    return doc

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
    items = await db.dogs.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    return items

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
async def list_bookings(user: dict = Depends(get_current_user), status_filter: Optional[str] = None):
    q = {}
    if status_filter:
        q["status"] = status_filter
    if user.get("role") != "admin":
        q["client_id"] = user.get("client_id")
    items = await db.bookings.find(q, {"_id": 0}).sort("date", 1).to_list(2000)
    return items

def _service_cost(rules: dict, service_type: str, days: int) -> int:
    # Credits only apply to daycare. Boarding and training are pay-on-the-day.
    if service_type == "daycare":
        return int(rules.get("daycare_cost", 1)) * max(days, 1)
    return 0


async def _validate_dog_vaccines(dog: dict, required: List[str]) -> None:
    today = date.today().isoformat()
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

    # Advance-booking limit (clients only)
    if user.get("role") != "admin":
        max_adv = int(rules.get("max_advance_days", 60))
        if max_adv > 0:
            limit_date = (date.today() + timedelta(days=max_adv)).isoformat()
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
        "dropoff_time": body.dropoff_time or "",
        "pickup_time": body.pickup_time or "",
        "created_at": now_iso(),
        "cost": cost,
    }
    if is_admin and body.check_in_now:
        doc["checked_in_at"] = now_iso()
    # Deduct credits by service-type pool. Both daycare + training are supported.
    deducted = 0
    credit_value = 0.0
    lot_ids: List[str] = []
    low_credit_remaining: Optional[int] = None  # set when balance crosses the low-credit threshold
    if status_val == "approved" and body.service_type in ("daycare", "training"):
        balance_field = "training_credits" if body.service_type == "training" else "credits"
        needed = 1 if body.service_type == "training" else cost
        available = int(client.get(balance_field) or 0)
        deducted = min(needed, available) if needed > 0 else 0
        if deducted > 0:
            await db.clients.update_one({"id": client["id"]}, {"$inc": {balance_field: -deducted}})
            credit_value, lot_ids = await _consume_credit_lots(client["id"], deducted, body.service_type)
            # Low-credit heads-up: previously >2, now ≤2 → notify (fires once per crossing).
            after = available - deducted
            if available > 2 and after <= 2:
                low_credit_remaining = after
    doc["credits_deducted"] = deducted
    if deducted > 0:
        doc["credit_value"] = credit_value
        doc["credit_lot_ids"] = lot_ids
        doc["credit_service_type"] = body.service_type
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    # Best-effort notification: tell admin when a client books from the portal.
    # Admin-created bookings (via Quick Check-in etc.) don't trigger an alert to themselves.
    if not is_admin:
        try:
            await notify_admin_new_booking(doc, client)
        except Exception:
            pass
    # Low-credit heads-up to client (fires once per threshold crossing).
    if low_credit_remaining is not None:
        try:
            await notify_client_low_credits(client, body.service_type, low_credit_remaining)
        except Exception:
            pass
    return doc


async def _booking_days_count_filtered(target_date: str, service_type: str) -> int:
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending", "completed"]}, "service_type": service_type}, {"_id": 0}
    ).to_list(2000)
    count = 0
    for b in bookings:
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




@api.post("/bookings/{booking_id}/approve", response_model=BookingOut)
async def approve_booking(booking_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Booking is {booking['status']}")
    # Credit pools by service:
    #   daycare → client.credits (1 day = 1 credit)
    #   training → client.training_credits (1 session = 1 credit)
    cost = booking.get("cost") or 0
    deducted = 0
    credit_value = 0.0
    lot_ids: List[str] = []
    svc_type = booking.get("service_type")
    low_credit_remaining: Optional[int] = None  # set when balance crosses the low-credit threshold
    if svc_type in ("daycare", "training"):
        # Training uses 1 credit per session regardless of `cost` (which is a
        # daycare-day count). Daycare uses the existing `cost` field.
        needed = 1 if svc_type == "training" else cost
        if needed > 0:
            client = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
            balance_field = "training_credits" if svc_type == "training" else "credits"
            available = int((client or {}).get(balance_field) or 0)
            deducted = min(needed, available)
            if deducted > 0:
                await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {balance_field: -deducted}})
                credit_value, lot_ids = await _consume_credit_lots(booking["client_id"], deducted, svc_type)
                # Low-credit heads-up: previously >2, now ≤2 → notify (fires once per crossing).
                before = available
                after = available - deducted
                if before > 2 and after <= 2:
                    low_credit_remaining = after
    update = {"status": "approved", "credits_deducted": deducted}
    if deducted > 0:
        update["credit_value"] = credit_value
        update["credit_lot_ids"] = lot_ids
        update["credit_service_type"] = svc_type
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)
    # Best-effort confirmation email to the client
    try:
        client_doc = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
        if client_doc:
            await notify_client_booking_approved(booking, client_doc)
            if low_credit_remaining is not None:
                await notify_client_low_credits(client_doc, svc_type, low_credit_remaining)
    except Exception:
        pass
    return booking


async def _consume_credit_lots(client_id: str, qty: int, service_type: str = "daycare") -> tuple:
    """FIFO consumption: oldest lot first, filtered by `service_type` so daycare
    credits and training credits stay in their own pools. Returns
    (total_value, [lot_ids_touched]). If lots don't cover qty, the remainder
    is valued at $0 — preserves balance integrity without inventing revenue."""
    remaining = qty
    total_value = 0.0
    touched: List[str] = []
    cursor = db.credit_lots.find(
        {"client_id": client_id, "qty_remaining": {"$gt": 0}, "service_type": service_type},
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
async def cancel_booking(booking_id: str, user: dict = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if user.get("role") != "admin" and booking["client_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not allowed")
    # Cancellation cutoff for clients
    if user.get("role") != "admin":
        settings = await get_settings()
        cutoff_hours = int(settings.get("booking_rules", {}).get("cancellation_cutoff_hours", 24))
        try:
            start_dt = datetime.fromisoformat(booking["date"]).replace(tzinfo=timezone.utc)
            if start_dt - datetime.now(timezone.utc) < timedelta(hours=cutoff_hours):
                raise HTTPException(status_code=400, detail=f"Cancellations must be at least {cutoff_hours}h in advance")
        except ValueError:
            pass
    # Refund credits (daycare or training) if previously approved
    if booking["status"] == "approved":
        refund = int(booking.get("credits_deducted") or 0)
        if refund > 0:
            credit_pool = booking.get("credit_service_type") or booking.get("service_type") or "daycare"
            balance_field = "training_credits" if credit_pool == "training" else "credits"
            await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {balance_field: refund}})
            await _restore_credit_lots(booking.get("credit_lot_ids") or [], refund)
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}

@api.get("/bookings/availability")
async def availability(date_str: str, dog_id: str, user: dict = Depends(get_current_user)):
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    today = date.today().isoformat()
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


@api.get("/portal/me")
async def portal_me(user: dict = Depends(get_current_user)):
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client account required")
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0}) if cid else None
    if not client:
        # client without linked record - return zero
        return {"client": {"id": "", "name": user.get("name"), "credits": 0}}
    return {"client": client}


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
async def check_in(booking_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    ts = now_iso()
    await db.bookings.update_one({"id": booking_id}, {"$set": {"checked_in_at": ts}})
    booking["checked_in_at"] = ts
    return booking

@api.post("/bookings/{booking_id}/check-out", response_model=BookingOut)
async def check_out(booking_id: str, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    ts = now_iso()
    update = {"checked_out_at": ts, "status": "completed"}
    # Credit-redemption income recognition — promote accrued credit_value to
    # actual_price + mark paid via credits. This is the moment income shows
    # up in the weekly tally.
    if booking.get("credit_value") and not booking.get("actual_price"):
        update["actual_price"] = float(booking["credit_value"])
        update["payment_status"] = "paid"
        update["payment_method"] = "credits"
        update["paid_at"] = ts
    # Auto-tally for cash bookings: if no price has been set yet AND no
    # credits were redeemed, attach the matching default service's base price
    # so it shows up in the weekly income view as unpaid.
    elif not booking.get("actual_price") and not booking.get("service_id"):
        default_svc = await db.services.find_one(
            {"service_type": booking.get("service_type"), "is_default": True, "active": True},
            {"_id": 0},
        )
        if default_svc:
            update["service_id"] = default_svc["id"]
            update["service_name"] = default_svc["name"]
            update["actual_price"] = float(default_svc.get("base_price") or 0)
            update["payment_status"] = "unpaid"
    await db.bookings.update_one({"id": booking_id}, {"$set": update})
    booking.update(update)
    return booking

@api.post("/bookings/{booking_id}/report-card", response_model=BookingOut)
async def save_report_card(booking_id: str, body: ReportCardIn, _: dict = Depends(require_admin)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    rc = {"photos": body.photos, "mood_tags": body.mood_tags, "note": body.note or "", "created_at": now_iso()}
    await db.bookings.update_one({"id": booking_id}, {"$set": {"report_card": rc}})
    booking["report_card"] = rc
    return booking

# -------- Vaccine Alerts --------
@api.get("/vaccine-alerts")
async def vaccine_alerts(_: dict = Depends(require_admin)):
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    warn_days = int(settings.get("vaccine_warning_days", 30))
    today = date.today().isoformat()
    in_warn = (date.today() + timedelta(days=warn_days)).isoformat()
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
    mood_tags: Optional[List[str]] = None
    waiver_text: Optional[str] = None
    waiver_required_for_booking: Optional[bool] = None
    waiver_version: Optional[int] = None

@api.get("/settings")
async def fetch_settings(_: dict = Depends(require_admin)):
    return await get_settings()

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
    today = date.today().isoformat()
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
        due = (date.today() + timedelta(days=int(tpl["default_duration_days"]))).isoformat()

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
        "date": body.date or date.today().isoformat(),
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
    active: bool = True


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
    if user.get("role") != "admin":
        # Clients don't browse programs directly
        raise HTTPException(status_code=403, detail="Admin only")
    progs = await db.programs.find(query, {"_id": 0}).to_list(500)
    if not include_custom:
        progs = [p for p in progs if p.get("type") != "custom"]
    progs.sort(key=lambda p: (p.get("type", ""), p.get("name", "")))
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


@api.put("/programs/{program_id}")
async def update_program(program_id: str, body: ProgramIn, _: dict = Depends(require_admin)):
    existing = await db.programs.find_one({"id": program_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Program not found")
    update = body.model_dump()
    update["modules"] = _stamp_ids(update.get("modules") or [])
    await db.programs.update_one({"id": program_id}, {"$set": update})
    existing.update(update)
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
    started = body.started_at or date.today().isoformat()
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


@api.put("/dogs/{dog_id}/programs/{enrollment_id}/goals/{goal_id}")
async def update_goal(dog_id: str, enrollment_id: str, goal_id: str, body: GoalUpdate, _: dict = Depends(require_admin)):
    enrollment = await db.dog_programs.find_one({"id": enrollment_id, "dog_id": dog_id}, {"_id": 0})
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    progress = enrollment.get("goal_progress") or {}
    cur = progress.get(goal_id) or {"status": "not_started", "score": 0, "notes": "", "last_session_at": None}
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

    out = []
    today = date.today()
    for r in rows:
        dog = await db.dogs.find_one({"id": r["dog_id"]}, {"_id": 0})
        if not dog:
            continue
        client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0}) if dog.get("owner_id") else None
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
    target = date_str or date.today().isoformat()
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
@api.get("/dashboard/stats")
async def dashboard_stats(_: dict = Depends(require_admin)):
    settings = await get_settings()
    required = settings.get("required_vaccines", ["rabies"])
    warn_days = int(settings.get("vaccine_warning_days", 30))
    daycare_cap = int(settings.get("daycare_capacity", DAYCARE_CAPACITY))
    today = date.today().isoformat()
    in_warn = (date.today() + timedelta(days=warn_days)).isoformat()
    dogs = await db.dogs.find({}, {"_id": 0}).to_list(2000)
    health_flags = 0
    for d in dogs:
        vac = d.get("vaccines") or {}
        flagged = False
        for v in required:
            r = vac.get(v, "")
            if not r or r < today or r <= in_warn:
                flagged = True
                break
        if flagged:
            health_flags += 1

    today_bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending", "completed"]}}, {"_id": 0}
    ).to_list(2000)
    # Build dog map for enrichment
    dog_map = {d["id"]: d for d in dogs}
    daycare_today = 0
    boarding_today = 0
    training_today = 0
    roster = []
    for b in today_bookings:
        days = _dates_in_range(b["date"], b.get("end_date"))
        if today in days:
            if b["service_type"] == "daycare":
                daycare_today += 1
            elif b["service_type"] == "boarding":
                boarding_today += 1
            elif b["service_type"] == "training":
                training_today += 1
            enriched = dict(b)
            enriched["dog"] = dog_map.get(b["dog_id"], {})
            roster.append(enriched)
    return {
        "daycare_occupancy": daycare_today,
        "daycare_capacity": daycare_cap,
        "boarding_today": boarding_today,
        "training_today": training_today,
        "health_flags": health_flags,
        "total_dogs": len(dogs),
        "today_roster": roster,
        "upcoming_birthdays": _upcoming_birthdays(dogs, days_ahead=14),
    }


def _upcoming_birthdays(dogs: list, days_ahead: int = 14) -> list:
    today = date.today()
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


# -------- Calendar Events --------
@api.get("/events")
async def calendar_events(_: dict = Depends(require_admin)):
    bookings = await db.bookings.find(
        {"status": {"$in": ["approved", "pending"]}}, {"_id": 0}
    ).to_list(2000)
    events = []
    for b in bookings:
        end = b.get("end_date") or b["date"]
        # FullCalendar treats end as exclusive
        try:
            end_excl = (datetime.fromisoformat(end).date() + timedelta(days=1)).isoformat()
        except Exception:
            end_excl = end
        # daycare green, boarding blue, training purple, grooming pink
        _svc_colors = {"daycare": "#8cc63f", "boarding": "#00a9e0", "training": "#a855f7", "grooming": "#ec4899"}
        color = _svc_colors.get(b["service_type"], "#64748b")
        if b["status"] == "pending":
            color = "#f26522"
        # Add grooming sub-type to title so it shows on the calendar at a glance
        svc_label = b["service_type"]
        if b["service_type"] == "grooming" and b.get("grooming_type"):
            gt = "bath" if b["grooming_type"] == "bath" else "nail trim"
            svc_label = f"grooming · {gt}"
        events.append({
            "id": b["id"],
            "title": f"{b['dog_name']} ({svc_label})",
            "start": b["date"],
            "end": end_excl,
            "backgroundColor": color,
            "borderColor": color,
            "extendedProps": {
                "status": b["status"],
                "client_name": b["client_name"],
                "service_type": b["service_type"],
                "grooming_type": b.get("grooming_type"),
            },
        })
    return events


# -------- Backup & Restore --------
BACKUP_COLLECTIONS = [
    "clients", "dogs", "bookings", "incidents", "homework",
    "waiver_signatures", "vaccine_dismissals", "settings",
]
BACKUP_VERSION = 1

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
        docs = await db[c].find({}, {"_id": 0}).to_list(50000)
        payload["collections"][c] = docs
    return payload


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
    if body.version != BACKUP_VERSION:
        raise HTTPException(status_code=400, detail=f"Unsupported backup version {body.version}; expected {BACKUP_VERSION}")
    summary = {}
    for c, docs in (body.collections or {}).items():
        if c not in BACKUP_COLLECTIONS:
            continue
        docs = [d for d in (docs or []) if isinstance(d, dict)]
        if body.mode == "replace":
            await db[c].delete_many({})
            if docs:
                await db[c].insert_many(docs)
            summary[c] = {"mode": "replace", "inserted": len(docs)}
        else:  # merge
            upserts = 0
            for doc in docs:
                key = doc.get("id")
                if not key:
                    await db[c].insert_one(doc)
                    upserts += 1
                    continue
                await db[c].update_one({"id": key}, {"$set": doc}, upsert=True)
                upserts += 1
            summary[c] = {"mode": "merge", "upserted": upserts}
    return {"ok": True, "summary": summary, "restored_at": now_iso()}


# -------- Startup --------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.clients.create_index("id", unique=True)
    await db.dogs.create_index("id", unique=True)
    await db.bookings.create_index("id", unique=True)
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


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()


# ────────────────────────── Services Catalog + Income Tracking ──────────────────────────
from services_data import SEED_SERVICES


class ServiceIn(BaseModel):
    slug: Optional[str] = ""
    name: str = Field(min_length=1)
    base_price: float = 0.0
    service_type: Optional[Literal["daycare", "boarding", "training", "grooming", "other"]] = "other"
    color: Optional[str] = "#64748b"
    icon: Optional[str] = "fa-tag"
    active: bool = True


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
    payment_method: Optional[Literal["cash", "card", "transfer", "credits", "other"]] = None
    status: Optional[Literal["pending", "approved", "rejected", "completed", "cancelled"]] = None
    service_id: Optional[str] = None


@api.get("/services")
async def list_services(user: dict = Depends(get_current_user), include_inactive: bool = False):
    q: Dict = {} if include_inactive else {"active": True}
    items = await db.services.find(q, {"_id": 0}).sort("name", 1).to_list(500)
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
        "date": body.date or date.today().isoformat(),
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
    ref = ref or date.today()
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
        if r.get("status") in ("cancelled", "rejected"):
            continue
        is_revenue = bool(r.get("service_id")) or bool(r.get("actual_price"))
        if revenue_only:
            if is_revenue:
                enriched.append(r)
        else:
            if is_revenue or r.get("status") in ("approved", "completed", "pending"):
                enriched.append(r)
    return enriched


@api.get("/transactions/weekly-summary")
async def weekly_summary(_: dict = Depends(require_admin), ref_date: Optional[str] = None):
    """Mon-Sun income tally. Default = current week. Pass ?ref_date=YYYY-MM-DD
    to inspect any other week. Returns cash + credits split so you can read
    real-money revenue separately from credit redemptions."""
    try:
        ref = date.fromisoformat(ref_date) if ref_date else date.today()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ref_date")
    monday_iso, sunday_iso = _week_bounds(ref)

    rows = await db.bookings.find(
        {"date": {"$gte": monday_iso, "$lte": sunday_iso}},
        {"_id": 0},
    ).to_list(2000)

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
        price = float(r.get("actual_price") or 0)
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

        svc_key = r.get("service_name") or r.get("service_type") or "Other"
        b = by_service.setdefault(svc_key, {"name": svc_key, "count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] += price

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
    completed_total = 0.0
    paid_total = 0.0
    by_day: Dict[str, float] = {}
    for r in rows:
        if r.get("status") in ("cancelled", "rejected"):
            continue
        price = float(r.get("actual_price") or 0)
        if r.get("status") == "completed":
            completed_total += price
            by_day[r["date"]] = round(by_day.get(r["date"], 0) + price, 2)
        if r.get("payment_status") == "paid":
            paid_total += price
    return {
        "start_date": start_date,
        "end_date": end_date,
        "completed_total": round(completed_total, 2),
        "paid_total": round(paid_total, 2),
        "by_day": [{"date": d, "total": v} for d, v in sorted(by_day.items())],
    }


# ────────────────────────── Credit Packs + FIFO Lots ──────────────────────────
from credit_packs_data import SEED_CREDIT_PACKS


class CreditPackIn(BaseModel):
    slug: Optional[str] = ""
    name: str = Field(min_length=1)
    qty: int = Field(ge=1)
    price: float = Field(ge=0)
    service_type: Optional[str] = "daycare"
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
async def list_credit_packs(_: dict = Depends(get_current_user), include_inactive: bool = False):
    q: Dict = {} if include_inactive else {"active": True}
    packs = await db.credit_packs.find(q, {"_id": 0}).sort("qty", 1).to_list(200)
    # Compute value_each on the fly so admins always see correct per-credit cost
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


@api.post("/credit-packs/seed-standard")
async def seed_credit_packs(_: dict = Depends(require_admin)):
    seeded = 0
    for pack in SEED_CREDIT_PACKS:
        if await db.credit_packs.find_one({"slug": pack["slug"]}, {"_id": 0}):
            continue
        doc = {**pack, "id": str(uuid.uuid4()), "is_default": True, "active": True, "created_at": now_iso()}
        await db.credit_packs.insert_one(doc)
        seeded += 1
    total = await db.credit_packs.count_documents({"active": True})
    return {"seeded": seeded, "total_active": total}


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
    value_each = round(float(pack["price"]) / max(qty, 1), 2)
    svc_type = pack.get("service_type") or "daycare"
    lot = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "pack_id": pack["id"],
        "pack_name": pack["name"],
        "service_type": svc_type,
        "qty_total": qty,
        "qty_remaining": qty,
        "price_paid": float(pack["price"]),
        "value_each": value_each,
        "payment_method": body.payment_method,
        "note": body.note or "",
        "sold_by": user.get("name", "Admin"),
        "purchased_at": now_iso(),
    }
    await db.credit_lots.insert_one(lot)
    balance_field = "training_credits" if svc_type == "training" else "credits"
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
    daycare_inc = 0
    training_inc = 0
    totals_by_pool = {"daycare": {"qty": 0, "price": 0.0}, "training": {"qty": 0, "price": 0.0}}

    now = now_iso()
    for item in body.items:
        pack = packs[item.pack_id]
        qty = int(pack["qty"])
        value_each = round(float(pack["price"]) / max(qty, 1), 2)
        svc_type = pack.get("service_type") or "daycare"
        for _ in range(item.quantity):
            lot = {
                "id": str(uuid.uuid4()),
                "client_id": client_id,
                "pack_id": pack["id"],
                "pack_name": pack["name"],
                "service_type": svc_type,
                "qty_total": qty,
                "qty_remaining": qty,
                "price_paid": float(pack["price"]),
                "value_each": value_each,
                "payment_method": body.payment_method,
                "note": body.note or "",
                "sold_by": user.get("name", "Admin"),
                "purchased_at": now,
            }
            new_lots.append(lot)
            if svc_type == "training":
                training_inc += qty
            else:
                daycare_inc += qty
            totals_by_pool[svc_type if svc_type in totals_by_pool else "daycare"]["qty"] += qty
            totals_by_pool[svc_type if svc_type in totals_by_pool else "daycare"]["price"] += float(pack["price"])

    await db.credit_lots.insert_many(new_lots)
    inc_doc: Dict[str, int] = {}
    if daycare_inc:
        inc_doc["credits"] = daycare_inc
    if training_inc:
        inc_doc["training_credits"] = training_inc
    if inc_doc:
        await db.clients.update_one({"id": client_id}, {"$inc": inc_doc})

    # Strip mongo _id from response payload defensively (insert_many mutates).
    for lot in new_lots:
        lot.pop("_id", None)
    totals_by_pool["daycare"]["price"] = round(totals_by_pool["daycare"]["price"], 2)
    totals_by_pool["training"]["price"] = round(totals_by_pool["training"]["price"], 2)
    return {
        "lots": new_lots,
        "totals": totals_by_pool,
        "total_price": round(totals_by_pool["daycare"]["price"] + totals_by_pool["training"]["price"], 2),
        "lots_created": len(new_lots),
    }


@api.get("/clients/{client_id}/credit-lots")
async def list_client_lots(client_id: str, _: dict = Depends(require_admin)):
    lots = await db.credit_lots.find({"client_id": client_id}, {"_id": 0}).sort("purchased_at", -1).to_list(200)
    return lots


# ────────────────────────── Multi-Date Bookings ──────────────────────────
class MultiDateBookingIn(BaseModel):
    dog_id: str
    dates: List[str] = Field(min_length=1, max_length=60)  # YYYY-MM-DD strings
    service_type: Literal["daycare", "training", "grooming"] = "daycare"
    notes: Optional[str] = ""
    override_capacity: Optional[bool] = False  # admin only
    override_vaccines: Optional[bool] = False  # admin only


@api.post("/bookings/multi-dates")
async def create_multi_date_bookings(body: MultiDateBookingIn, user: dict = Depends(get_current_user)):
    """Creates one booking per date in `dates`. Returns
    {created: [...], skipped: [{date, reason}]} so the UI can show exactly
    which days made it and which were rejected (capacity, vaccine, etc).
    Each booking goes through the standard create_booking validations, so
    capacity + vaccines + waiver still apply."""
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if user.get("role") != "admin" and dog["owner_id"] != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Not your dog")

    created: List[Dict] = []
    skipped: List[Dict] = []
    for d in sorted(set(body.dates)):
        try:
            inn = BookingIn(
                dog_id=body.dog_id,
                date=d,
                service_type=body.service_type,
                notes=body.notes or "",
                override_capacity=bool(body.override_capacity) if user.get("role") == "admin" else False,
                override_vaccines=bool(body.override_vaccines) if user.get("role") == "admin" else False,
            )
            booking = await create_booking(inn, user)
            created.append(booking)
        except HTTPException as e:
            skipped.append({"date": d, "reason": e.detail})
        except Exception as e:
            skipped.append({"date": d, "reason": str(e)[:200]})
    return {"created": created, "skipped": skipped, "summary": f"{len(created)} booked, {len(skipped)} skipped"}


@api.get("/")
async def root():
    return {"service": "sit-happens", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
