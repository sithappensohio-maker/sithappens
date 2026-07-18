"""Passwordless-first client claim flow (POST /claim/{token}/login) and the
companion PATCH /auth/set-password endpoint.

Covers:
  1. Passwordless login creates the portal user (needs_password=True) when
     none exists yet for the client.
  2. Passwordless login logs in an existing client user as-is (no duplicate,
     needs_password stays False).
  3. Staff/admin reset tokens (user_id-only, no client_id) are rejected —
     they must keep using the password path.
  4. Expired and already-used tokens are rejected.
  5. Rate limiting mirrors the claim_consume_ip / claim_consume_token style.
  6. PATCH /auth/set-password lets a needs_password user set a real password
     exactly once, then rejects a second call.

Built against the live preview backend exposed via TEST_BACKEND_URL /
REACT_APP_BACKEND_URL, same as the rest of this suite (see conftest.py).
Direct Mongo access (motor) is used to seed claim_tokens rows with specific
shapes (expired, used, staff-only) that aren't reachable through the API.
"""
import os
import uuid
import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import requests
import pytest
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = (
    os.environ.get("TEST_BACKEND_URL")
    or os.environ.get("API_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _run(coro):
    return asyncio.run(coro)


async def _with_db(fn):
    mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        db = mc[os.environ["DB_NAME"]]
        return await fn(db)
    finally:
        mc.close()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module", autouse=True)
def _clean_rate_limit_scopes():
    """Clear this module's rate-limit buckets before running so unrelated
    earlier activity from the same test-runner IP can't make
    test_rate_limiting flaky (fixed hour-long window keyed in Mongo)."""
    async def _clear(db):
        await db.auth_rate_limits.delete_many(
            {"scope": {"$in": ["claim_login_ip", "claim_login_token"]}}
        )
    _run(_with_db(_clear))
    yield


def _insert_claim_token(*, client_id=None, user_id=None, email="", is_reset=False,
                         used=False, expires_delta=timedelta(days=7)):
    token = secrets.token_urlsafe(24)
    doc = {
        "token": token,
        "email": email,
        "is_reset": is_reset,
        "used": used,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + expires_delta).isoformat(),
    }
    if client_id is not None:
        doc["client_id"] = client_id
    if user_id is not None:
        doc["user_id"] = user_id

    async def _ins(db):
        await db.claim_tokens.insert_one(doc)
    _run(_with_db(_ins))
    return token


def _create_admin_client(admin_token, name="Passwordless Test", email=None, phone="555-100-0001"):
    email = email or f"pwless_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/clients", headers=_hdr(admin_token), json={
        "name": name, "email": email, "phone": phone,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestClaimPasswordlessLogin:
    def test_creates_user_when_none_exists(self, admin_token):
        client = _create_admin_client(admin_token)
        token = _insert_claim_token(client_id=client["id"], email=client["email"])

        r = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["client_id"] == client["id"]
        assert body["user"]["role"] == "client"
        assert body["user"]["needs_password"] is True

        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(body["token"]), timeout=15)
        assert me.status_code == 200, me.text
        assert me.json()["needs_password"] is True

        # Token is now used — a second attempt must fail.
        again = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert again.status_code == 400, again.text

    def test_logs_in_existing_client_user(self, admin_token):
        client = _create_admin_client(admin_token)
        # Seed a portal user that already exists for this client (as if
        # created earlier through the classic password-claim path).
        user_id = str(uuid.uuid4())

        async def _seed(db):
            await db.users.insert_one({
                "id": user_id, "email": client["email"], "password_hash": "not-a-real-hash",
                "name": client["name"], "role": "client", "client_id": client["id"],
                "created_at": datetime.now(timezone.utc).isoformat(), "token_version": 0,
                "must_change_password": False,
            })
        _run(_with_db(_seed))

        token = _insert_claim_token(client_id=client["id"], email=client["email"])
        r = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["id"] == user_id  # reused the existing user, no duplicate
        assert body["user"]["needs_password"] is False

    def test_rejects_staff_reset_token(self, admin_token):
        # Staff/admin forgot-password tokens carry user_id but no client_id
        # (see forgot_password / consume_claim_token case 3).
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(admin_token), timeout=15).json()
        token = _insert_claim_token(user_id=me["id"], email=ADMIN_EMAIL, is_reset=True)
        r = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert r.status_code == 400, r.text

    def test_rejects_expired_token(self, admin_token):
        client = _create_admin_client(admin_token)
        token = _insert_claim_token(client_id=client["id"], email=client["email"],
                                     expires_delta=timedelta(days=-1))
        r = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert r.status_code == 400, r.text

    def test_rejects_used_token(self, admin_token):
        client = _create_admin_client(admin_token)
        token = _insert_claim_token(client_id=client["id"], email=client["email"], used=True)
        r = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert r.status_code == 400, r.text

    def test_rate_limiting(self, admin_token):
        client = _create_admin_client(admin_token)
        token = _insert_claim_token(client_id=client["id"], email=client["email"])
        statuses = [requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15).status_code
                    for _ in range(11)]
        assert statuses[0] == 200, statuses               # first call actually logs in
        assert all(s == 400 for s in statuses[1:10]), statuses  # token already used, still under limit
        assert statuses[10] == 429, statuses               # 11th call for this token is rate-limited


class TestSetPassword:
    def test_set_password_once_then_rejects_reuse(self, admin_token):
        client = _create_admin_client(admin_token)
        token = _insert_claim_token(client_id=client["id"], email=client["email"])
        login = requests.post(f"{BASE_URL}/api/claim/{token}/login", timeout=15)
        assert login.status_code == 200, login.text
        access = login.json()["token"]
        assert login.json()["user"]["needs_password"] is True

        new_password = "FirstRealPassw0rd!"
        r1 = requests.patch(f"{BASE_URL}/api/auth/set-password", headers=_hdr(access),
                             json={"password": new_password}, timeout=15)
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["needs_password"] is False
        fresh_token = body1["token"]

        # Setting the password bumped token_version — the pre-set-password
        # access token is now stale.
        stale = requests.patch(f"{BASE_URL}/api/auth/set-password", headers=_hdr(access),
                                json={"password": "AnotherPassw0rd!"}, timeout=15)
        assert stale.status_code == 401, stale.text

        # A second call with a valid (fresh) token must be rejected — a
        # password is already set.
        r2 = requests.patch(f"{BASE_URL}/api/auth/set-password", headers=_hdr(fresh_token),
                             json={"password": "SecondPassw0rd!"}, timeout=15)
        assert r2.status_code == 400, r2.text

        # The real password actually works via normal login.
        login_check = requests.post(f"{BASE_URL}/api/auth/login",
                                     json={"email": client["email"], "password": new_password}, timeout=15)
        assert login_check.status_code == 200, login_check.text
        assert login_check.json()["user"]["client_id"] == client["id"]
