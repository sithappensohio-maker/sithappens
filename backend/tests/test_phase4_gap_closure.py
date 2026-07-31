"""Phase 4 gap closure — the four blockers flagged in the "+ New" launcher
checkpoint before Phase 5 (expanded global search):

1. Booking creation now enforces `booking_edit` for staff (read_only can no
   longer create a booking), while the client self-booking path is
   untouched.
2. `clients_edit` / `dogs_edit` / `incidents` are now enforced on the real
   POST/PUT write endpoints, not just the frontend menu.
3. Selling a prepaid pack/program now requires the new, narrower
   `sell_credits` permission instead of `finance_reports`, so front_desk can
   sell without gaining P&L access.

Same black-box HTTP convention as test_shop_categories.py /
test_backend_permission_checkpoint2.py.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone

import jwt
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]

ROLES = ("front_desk", "trainer", "daycare_staff", "read_only", "manager")


def _mongo_run(fn):
    return asyncio.run(fn())


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def staff_tokens():
    uids = {}

    async def seed():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        for role in ROLES:
            uid = str(uuid.uuid4())
            email = f"phase4gap-{role}@example.invalid"
            await db.users.delete_many({"email": email})
            await db.users.insert_one({
                "id": uid, "email": email, "name": f"Phase4 Gap {role}",
                "role": "admin", "staff_role": role,
                "password_hash": "x", "must_change_password": False,
                "needs_password": False,
            })
            uids[role] = uid

    async def cleanup():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        await db.users.delete_many({"email": {"$regex": "^phase4gap-"}})

    _mongo_run(seed)
    tokens = {
        role: jwt.encode({"sub": uid, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
        for role, uid in uids.items()
    }
    try:
        yield {role: {"Authorization": f"Bearer {tok}"} for role, tok in tokens.items()}
    finally:
        _mongo_run(cleanup)


def _client_headers(client_id, email):
    user_id = str(uuid.uuid4())

    async def _insert():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        await db.users.insert_one({
            "id": user_id, "email": email, "name": "Test Client", "role": "client",
            "client_id": client_id, "active": True, "must_change_password": False,
            "password_hash": "unused-jwt-minted-directly", "token_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_insert)
    token = jwt.encode({"sub": user_id, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def fresh_client_dog(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"Phase4Gap Client {tag}", "email": f"phase4gap-client-{tag}@example.com"},
                            timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                         json={"owner_id": client["id"], "name": f"Phase4Gap Dog {tag}",
                               "vaccines": {"rabies": "2030-01-01"}}, timeout=15).json()
    yield client, dog
    requests.delete(f"{API}/dogs/{dog['id']}", headers=admin_headers, timeout=15)
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _booking_payload(dog_id, day_offset=1):
    from datetime import date, timedelta
    d = (date.today() + timedelta(days=day_offset)).isoformat()
    return {"dog_id": dog_id, "service_type": "daycare", "date": d, "end_date": d,
            "override_capacity": True, "override_vaccines": True}


# ── 1. Booking creation enforces booking_edit ───────────────────────────────

def test_read_only_cannot_create_booking(staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    r = requests.post(f"{API}/bookings", headers=staff_tokens["read_only"],
                       json=_booking_payload(dog["id"]), timeout=15)
    assert r.status_code == 403, r.text
    assert "booking_edit" in r.text


def test_front_desk_can_still_create_booking(admin_headers, staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    r = requests.post(f"{API}/bookings", headers=staff_tokens["front_desk"],
                       json=_booking_payload(dog["id"]), timeout=15)
    assert r.status_code == 200, r.text
    requests.delete(f"{API}/bookings/{r.json()['id']}", headers=admin_headers, timeout=15)


def test_denied_booking_creates_no_row(admin_headers, staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    before = requests.get(f"{API}/bookings", headers=admin_headers,
                           params={"dog_id": dog["id"]}, timeout=15)
    before_count = len(before.json()) if before.status_code == 200 else 0
    r = requests.post(f"{API}/bookings", headers=staff_tokens["read_only"],
                       json=_booking_payload(dog["id"]), timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/bookings", headers=admin_headers,
                          params={"dog_id": dog["id"]}, timeout=15)
    after_count = len(after.json()) if after.status_code == 200 else 0
    assert after_count == before_count


def test_client_can_still_self_book_own_dog(fresh_client_dog):
    """The permission gate only applies to staff (role == 'admin') — a client
    booking their own dog must be completely unaffected."""
    client, dog = fresh_client_dog
    hdrs = _client_headers(client["id"], f"phase4gap-selfbook-{uuid.uuid4().hex[:6]}@example.com")
    r = requests.post(f"{API}/bookings", headers=hdrs, json=_booking_payload(dog["id"]), timeout=15)
    assert r.status_code == 200, r.text


# ── 2. clients_edit / dogs_edit / incidents on real write endpoints ─────────

def test_read_only_cannot_create_client(staff_tokens):
    r = requests.post(f"{API}/clients", headers=staff_tokens["read_only"],
                       json={"name": "Should Not Be Created"}, timeout=15)
    assert r.status_code == 403, r.text
    assert "clients_edit" in r.text


def test_front_desk_can_create_and_edit_client(admin_headers, staff_tokens):
    r = requests.post(f"{API}/clients", headers=staff_tokens["front_desk"],
                       json={"name": "Front Desk Created Client"}, timeout=15)
    assert r.status_code == 200, r.text
    client = r.json()
    try:
        r2 = requests.put(f"{API}/clients/{client['id']}", headers=staff_tokens["front_desk"],
                           json={"name": "Front Desk Edited Client"}, timeout=15)
        assert r2.status_code == 200, r2.text
    finally:
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_read_only_cannot_edit_client(staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    r = requests.put(f"{API}/clients/{client['id']}", headers=staff_tokens["read_only"],
                      json={"name": "Hacked Name"}, timeout=15)
    assert r.status_code == 403, r.text


def test_read_only_cannot_create_dog(staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    r = requests.post(f"{API}/dogs", headers=staff_tokens["read_only"],
                       json={"owner_id": client["id"], "name": "Should Not Exist"}, timeout=15)
    assert r.status_code == 403, r.text
    assert "dogs_edit" in r.text


def test_front_desk_can_create_and_edit_dog(admin_headers, staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    r = requests.post(f"{API}/dogs", headers=staff_tokens["front_desk"],
                       json={"owner_id": client["id"], "name": "Front Desk Dog"}, timeout=15)
    assert r.status_code == 200, r.text
    dog = r.json()
    try:
        r2 = requests.put(f"{API}/dogs/{dog['id']}", headers=staff_tokens["front_desk"],
                           json={"owner_id": client["id"], "name": "Front Desk Dog Edited"}, timeout=15)
        assert r2.status_code == 200, r2.text
    finally:
        requests.delete(f"{API}/dogs/{dog['id']}", headers=admin_headers, timeout=15)


def test_read_only_cannot_edit_dog(staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    r = requests.put(f"{API}/dogs/{dog['id']}", headers=staff_tokens["read_only"],
                      json={"owner_id": dog["owner_id"], "name": "Hacked Dog Name"}, timeout=15)
    assert r.status_code == 403, r.text


def test_read_only_cannot_create_incident(staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    r = requests.post(f"{API}/incidents", headers=staff_tokens["read_only"],
                       json={"dog_id": dog["id"], "date": "2026-01-01", "description": "should be blocked"}, timeout=15)
    assert r.status_code == 403, r.text
    assert "incidents" in r.text


def test_trainer_can_create_and_edit_incident(admin_headers, staff_tokens, fresh_client_dog):
    _, dog = fresh_client_dog
    r = requests.post(f"{API}/incidents", headers=staff_tokens["trainer"],
                       json={"dog_id": dog["id"], "date": "2026-01-01", "description": "trainer-reported incident"}, timeout=15)
    assert r.status_code == 200, r.text
    incident = r.json()
    r2 = requests.put(f"{API}/incidents/{incident['id']}", headers=staff_tokens["trainer"],
                       json={"dog_id": dog["id"], "date": "2026-01-01", "description": "trainer-edited incident",
                             "edit_reason": "typo fix"}, timeout=15)
    assert r2.status_code == 200, r2.text


# ── 3. sell_credits replaces finance_reports for selling prepaid visits ────

def _make_pack(admin_headers):
    r = requests.post(f"{API}/credit-packs", headers=admin_headers, json={
        "name": f"Phase4Gap Pack {uuid.uuid4().hex[:6]}", "qty": 5, "price": 50.0,
        "service_type": "daycare", "active": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_front_desk_can_sell_pack_without_finance_reports(admin_headers, staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    pack = _make_pack(admin_headers)
    try:
        perms = requests.get(f"{API}/me/permissions", headers=staff_tokens["front_desk"], timeout=15).json()["permissions"]
        assert perms.get("finance_reports") is False
        assert perms.get("sell_credits") is True

        r = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=staff_tokens["front_desk"],
                           json={"pack_id": pack["id"], "payment_method": "cash"}, timeout=15)
        assert r.status_code == 200, r.text
    finally:
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)


def test_trainer_cannot_sell_pack(admin_headers, staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    pack = _make_pack(admin_headers)
    try:
        r = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=staff_tokens["trainer"],
                           json={"pack_id": pack["id"], "payment_method": "cash"}, timeout=15)
        assert r.status_code == 403, r.text
        assert "sell_credits" in r.text
    finally:
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)


def test_sell_credits_permission_change_takes_effect_next_request(admin_headers, staff_tokens, fresh_client_dog):
    client, _ = fresh_client_dog
    pack = _make_pack(admin_headers)
    try:
        r = requests.put(f"{API}/staff/roles/front_desk/permissions", headers=admin_headers,
                          json={"permissions": {"sell_credits": False}}, timeout=15)
        assert r.status_code == 200, r.text

        r2 = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=staff_tokens["front_desk"],
                            json={"pack_id": pack["id"], "payment_method": "cash"}, timeout=15)
        assert r2.status_code == 403, r2.text
    finally:
        requests.put(f"{API}/staff/roles/front_desk/permissions", headers=admin_headers,
                     json={"permissions": {"sell_credits": True}}, timeout=15)
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)


def test_owner_retains_full_access(admin_headers, fresh_client_dog):
    client, dog = fresh_client_dog
    r = requests.post(f"{API}/bookings", headers=admin_headers, json=_booking_payload(dog["id"], day_offset=2), timeout=15)
    assert r.status_code == 200, r.text
    requests.delete(f"{API}/bookings/{r.json()['id']}", headers=admin_headers, timeout=15)

    pack = _make_pack(admin_headers)
    try:
        r2 = requests.post(f"{API}/clients/{client['id']}/sell-pack", headers=admin_headers,
                            json={"pack_id": pack["id"], "payment_method": "cash"}, timeout=15)
        assert r2.status_code == 200, r2.text
    finally:
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)
