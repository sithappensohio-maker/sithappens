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
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

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
    credits: int = 0

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
    photo: Optional[str] = ""  # base64 data URI

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
    service_type: Literal["daycare", "boarding", "training"] = "daycare"
    end_date: Optional[str] = None  # for boarding
    notes: Optional[str] = ""
    kennel: Optional[str] = ""

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
    cost: Optional[int] = 0

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
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": "client",
        "client_id": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
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
    if service_type == "boarding":
        return int(rules.get("boarding_cost_per_night", 1)) * max(days, 1)
    if service_type == "training":
        return int(rules.get("training_cost", 1)) * max(days, 1)
    return int(rules.get("daycare_cost", 1)) * max(days, 1)


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

    # Vaccine check (multi-vaccine via settings)
    await _validate_dog_vaccines(dog, required)

    # Advance-booking limit (clients only)
    if user.get("role") != "admin":
        max_adv = int(rules.get("max_advance_days", 60))
        if max_adv > 0:
            limit_date = (date.today() + timedelta(days=max_adv)).isoformat()
            if body.date > limit_date:
                raise HTTPException(status_code=400, detail=f"Bookings allowed up to {max_adv} days in advance")

    # Capacity check
    if body.service_type == "daycare":
        if await _booking_days_count_filtered(body.date, "daycare") >= daycare_cap:
            raise HTTPException(status_code=400, detail="Daycare is fully booked for that date")
    elif body.service_type == "boarding":
        if await _booking_days_count_filtered(body.date, "boarding") >= boarding_cap:
            raise HTTPException(status_code=400, detail="Boarding is fully booked for that date")

    # Credit cost
    days = _dates_in_range(body.date, body.end_date)
    cost = _service_cost(rules, body.service_type, len(days))
    if user.get("role") != "admin":
        if (client.get("credits") or 0) < cost:
            raise HTTPException(status_code=400, detail=f"Insufficient credits ({client.get('credits',0)}/{cost})")

    auto_approve = bool(rules.get("auto_approve", False))
    is_admin = user.get("role") == "admin"
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
        "status": status_val,
        "notes": body.notes or "",
        "kennel": body.kennel or "",
        "created_at": now_iso(),
        "cost": cost,
    }
    await db.bookings.insert_one(doc)
    if status_val == "approved":
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": -cost}})
    doc.pop("_id", None)
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
    cost = booking.get("cost") or len(_dates_in_range(booking["date"], booking.get("end_date")))
    client = await db.clients.find_one({"id": booking["client_id"]}, {"_id": 0})
    if (client.get("credits") or 0) < cost:
        raise HTTPException(status_code=400, detail="Client has insufficient credits")
    await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {"credits": -cost}})
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "approved"}})
    booking["status"] = "approved"
    return booking

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
    # refund credits if previously approved
    if booking["status"] == "approved":
        cost = booking.get("cost") or len(_dates_in_range(booking["date"], booking.get("end_date")))
        await db.clients.update_one({"id": booking["client_id"]}, {"$inc": {"credits": cost}})
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
    await db.bookings.update_one({"id": booking_id}, {"$set": {"checked_out_at": ts, "status": "completed"}})
    booking["checked_out_at"] = ts
    booking["status"] = "completed"
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
            roster.append(b)
    return {
        "daycare_occupancy": daycare_today,
        "daycare_capacity": daycare_cap,
        "boarding_today": boarding_today,
        "training_today": training_today,
        "health_flags": health_flags,
        "total_dogs": len(dogs),
        "today_roster": roster,
    }


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
        color = "#8cc63f" if b["service_type"] == "daycare" else ("#00a9e0" if b["service_type"] == "boarding" else "#a855f7")
        if b["status"] == "pending":
            color = "#f26522"
        events.append({
            "id": b["id"],
            "title": f"{b['dog_name']} ({b['service_type']})",
            "start": b["date"],
            "end": end_excl,
            "backgroundColor": color,
            "borderColor": color,
            "extendedProps": {
                "status": b["status"],
                "client_name": b["client_name"],
                "service_type": b["service_type"],
            },
        })
    return events


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
