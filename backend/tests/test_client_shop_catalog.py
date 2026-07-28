"""Client Shop Phase 1 — catalog + admin curation + client browsing.

Black-box HTTP against a live server, same convention as
test_stripe_online_payments.py. This phase is READ-ONLY for clients — no
checkout, no Stripe, no inventory reservation. Scope: GET /shop/catalog,
GET/POST /shop/media, and the additive online-visibility fields on
pos_products / credit_packs / programs.
"""
import os
import sys
import uuid
import base64
import asyncio
from datetime import datetime, timezone

import jwt
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"

JWT_SECRET = os.environ["JWT_SECRET"]

# A genuine, tiny 1x1 red PNG, base64-encoded, wrapped as a data URL — real
# bytes decoded by Pillow-less validation (this endpoint only inspects the
# MIME prefix + byte length, never decodes the image), so this is a
# realistic upload payload, not a placeholder string.
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUB"
    "AScY42YAAAAASUVORK5CYII="
)
TINY_PNG_DATA_URL = f"data:image/png;base64,{_TINY_PNG_B64}"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _make_client(admin_headers, tag):
    return requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Shop Test {tag}", "email": f"shop-{tag}@example.com",
    }, timeout=15).json()


@pytest.fixture
def fresh_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
    """Mints a valid client-role JWT directly, bypassing the password/login
    flow — same convention as test_stripe_online_payments.py."""
    user_id = str(uuid.uuid4())

    async def _insert(db):
        await db.users.insert_one({
            "id": user_id, "email": email, "name": "Test Client", "role": "client",
            "client_id": client_id, "active": True, "must_change_password": False,
            "password_hash": "unused-jwt-minted-directly", "token_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_insert)
    token = jwt.encode({"sub": user_id, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _create_product(admin_headers, **overrides):
    body = {
        "name": f"Test Leash {uuid.uuid4().hex[:6]}", "category": "Gear", "description": "A leash.",
        "price": 24.99, "cost": 8.0, "track_inventory": False, "active": True,
        "starting_stock": 0,
    }
    body.update(overrides)
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_product(admin_headers, product_id):
    requests.delete(f"{API}/pos/products/{product_id}", headers=admin_headers, timeout=15)


def _create_credit_pack(admin_headers, **overrides):
    body = {
        "name": f"Test Pack {uuid.uuid4().hex[:6]}", "qty": 10, "price": 300.0,
        "service_type": "daycare", "icon": "fa-tag", "color": "", "active": True,
    }
    body.update(overrides)
    r = requests.post(f"{API}/credit-packs", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_credit_pack(admin_headers, pack_id):
    requests.delete(f"{API}/credit-packs/{pack_id}", headers=admin_headers, timeout=15)


def _create_program(admin_headers, **overrides):
    body = {
        "name": f"Test Program {uuid.uuid4().hex[:6]}", "type": "custom", "description": "A program.",
        "focus": "", "format": {"count": 4, "unit": "sessions"}, "min_age_months": 0,
        "prereq_slugs": [], "modules": [], "price": 450.0, "active": True,
    }
    body.update(overrides)
    r = requests.post(f"{API}/programs", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_program(admin_headers, program_id):
    requests.delete(f"{API}/programs/{program_id}", headers=admin_headers, timeout=15)


def _catalog(headers):
    r = requests.get(f"{API}/shop/catalog", headers=headers, timeout=15)
    return r


# ---------------------------------------------------------------------------
# Visibility — hidden/inactive items must never appear
# ---------------------------------------------------------------------------

def test_hidden_product_excluded_from_catalog(admin_headers, fresh_client):
    product = _create_product(admin_headers, show_online=False)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        assert r.status_code == 200, r.text
        ids = {i["id"] for i in r.json()["items"] if i["kind"] == "product"}
        assert product["id"] not in ids
    finally:
        _delete_product(admin_headers, product["id"])


def test_inactive_product_excluded_even_if_shown_online(admin_headers, fresh_client):
    product = _create_product(admin_headers, show_online=True, active=False)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        ids = {i["id"] for i in r.json()["items"] if i["kind"] == "product"}
        assert product["id"] not in ids
    finally:
        _delete_product(admin_headers, product["id"])


def test_hidden_credit_pack_excluded_from_catalog(admin_headers, fresh_client):
    pack = _create_credit_pack(admin_headers, available_online=False)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        ids = {i["id"] for i in r.json()["items"] if i["kind"] == "credit_pack"}
        assert pack["id"] not in ids
    finally:
        _delete_credit_pack(admin_headers, pack["id"])


def test_hidden_training_program_excluded_from_catalog(admin_headers, fresh_client):
    program = _create_program(admin_headers, available_online=False)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        ids = {i["id"] for i in r.json()["items"] if i["kind"] == "training_program"}
        assert program["id"] not in ids
    finally:
        _delete_program(admin_headers, program["id"])


# ---------------------------------------------------------------------------
# Visible-item shape — correct fields, no leaked internals
# ---------------------------------------------------------------------------

def test_visible_product_shape_and_no_internal_leak(admin_headers, fresh_client):
    product = _create_product(
        admin_headers, show_online=True, online_description="Great leash!",
        online_sort_order=3, cost=5.55,
    )
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        item = next(i for i in r.json()["items"] if i["kind"] == "product" and i["id"] == product["id"])
        assert item["name"] == product["name"]
        assert item["description"] == "Great leash!"  # online_description preferred over description
        assert abs(item["price"] - 24.99) < 0.01
        assert item["in_stock"] is True  # untracked → always available
        # Safe-fields contract — cost and internal fields must never leak.
        assert "cost" not in item
        assert "sku" not in item
        assert "stock_reserved" not in item
        assert "created_at" not in item
    finally:
        _delete_product(admin_headers, product["id"])


def test_visible_product_out_of_stock_when_tracked_and_zero(admin_headers, fresh_client):
    product = _create_product(admin_headers, show_online=True, track_inventory=True, starting_stock=0)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        item = next(i for i in r.json()["items"] if i["kind"] == "product" and i["id"] == product["id"])
        assert item["track_inventory"] is True
        assert item["in_stock"] is False
        assert item["stock_on_hand"] == 0
    finally:
        _delete_product(admin_headers, product["id"])


def test_visible_credit_pack_shape(admin_headers, fresh_client):
    pack = _create_credit_pack(admin_headers, available_online=True, online_description="Bulk daycare!", qty=10, price=300.0)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        item = next(i for i in r.json()["items"] if i["kind"] == "credit_pack" and i["id"] == pack["id"])
        assert item["qty"] == 10
        assert abs(item["price"] - 300.0) < 0.01
        assert item["service_type"] == "daycare"
        assert item["description"] == "Bulk daycare!"
        assert "welcome_email_template_slug" not in item
    finally:
        _delete_credit_pack(admin_headers, pack["id"])


def test_visible_training_program_shape(admin_headers, fresh_client):
    program = _create_program(admin_headers, available_online=True, online_description="Learn to sit!",
                               format={"count": 6, "unit": "sessions"}, price=500.0)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        item = next(i for i in r.json()["items"] if i["kind"] == "training_program" and i["id"] == program["id"])
        assert item["format_count"] == 6
        assert item["format_unit"] == "sessions"
        assert abs(item["price"] - 500.0) < 0.01
        assert item["description"] == "Learn to sit!"
        assert "modules" not in item
        assert "prereq_slugs" not in item
    finally:
        _delete_program(admin_headers, program["id"])


# ---------------------------------------------------------------------------
# Security — auth required, client-only, admin-only media upload
# ---------------------------------------------------------------------------

def test_catalog_requires_authentication():
    r = requests.get(f"{API}/shop/catalog", timeout=15)
    assert r.status_code in (401, 403)


def test_catalog_requires_client_role(admin_headers):
    r = requests.get(f"{API}/shop/catalog", headers=admin_headers, timeout=15)
    assert r.status_code == 403


def test_shop_media_upload_requires_admin(fresh_client):
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/media", headers=client_hdrs,
                       json={"data": TINY_PNG_DATA_URL, "filename": "x.png"}, timeout=15)
    assert r.status_code == 403


def test_shop_media_upload_rejects_unsupported_mime(admin_headers):
    bad = "data:application/pdf;base64," + _TINY_PNG_B64
    r = requests.post(f"{API}/shop/media", headers=admin_headers,
                       json={"data": bad, "filename": "x.pdf"}, timeout=15)
    assert r.status_code == 400


def test_shop_media_upload_rejects_oversized_image(admin_headers):
    # ~7MB of base64 payload — over the 5MB ceiling.
    huge_b64 = base64.b64encode(b"0" * (7 * 1024 * 1024)).decode()
    r = requests.post(f"{API}/shop/media", headers=admin_headers,
                       json={"data": f"data:image/png;base64,{huge_b64}", "filename": "huge.png"}, timeout=15)
    assert r.status_code == 400


def test_shop_media_upload_and_fetch_roundtrip(admin_headers, fresh_client):
    r = requests.post(f"{API}/shop/media", headers=admin_headers,
                       json={"data": TINY_PNG_DATA_URL, "filename": "tiny.png"}, timeout=15)
    assert r.status_code == 200, r.text
    media_id = r.json()["media_id"]

    # Any authenticated user (staff or client) can read it back.
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    r2 = requests.get(f"{API}/shop/media/{media_id}", headers=client_hdrs, timeout=15)
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"] == TINY_PNG_DATA_URL


def test_catalog_never_embeds_image_bytes(admin_headers, fresh_client):
    up = requests.post(f"{API}/shop/media", headers=admin_headers,
                        json={"data": TINY_PNG_DATA_URL, "filename": "tiny.png"}, timeout=15)
    media_id = up.json()["media_id"]
    product = _create_product(admin_headers, show_online=True, image_id=media_id)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = _catalog(client_hdrs)
        item = next(i for i in r.json()["items"] if i["kind"] == "product" and i["id"] == product["id"])
        assert item["image_id"] == media_id
        assert "data" not in item  # never embed base64 bytes in the catalog list
    finally:
        _delete_product(admin_headers, product["id"])


# ---------------------------------------------------------------------------
# Admin online-visibility toggles persist correctly
# ---------------------------------------------------------------------------

def test_admin_product_online_toggle_persists(admin_headers):
    product = _create_product(admin_headers, show_online=False)
    try:
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            "name": product["name"], "category": "Gear", "description": "A leash.",
            "price": 24.99, "cost": None, "low_stock_threshold": None, "track_inventory": False, "active": True,
            "show_online": True, "online_description": "Now online!", "image_id": None, "online_sort_order": 5,
        }, timeout=15)
        assert r.status_code == 200, r.text
        fetched = requests.get(f"{API}/pos/products", headers=admin_headers, timeout=15).json()
        updated = next(p for p in fetched if p["id"] == product["id"])
        assert updated["show_online"] is True
        assert updated["online_description"] == "Now online!"
        assert updated["online_sort_order"] == 5
    finally:
        _delete_product(admin_headers, product["id"])


def test_admin_credit_pack_online_toggle_persists(admin_headers):
    pack = _create_credit_pack(admin_headers, available_online=False)
    try:
        r = requests.put(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, json={
            "name": pack["name"], "qty": 10, "price": 300.0, "service_type": "daycare",
            "icon": "fa-tag", "color": "", "active": True,
            "available_online": True, "online_description": "Buy now", "image_id": None,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["available_online"] is True
        assert r.json()["online_description"] == "Buy now"
    finally:
        _delete_credit_pack(admin_headers, pack["id"])


# ---------------------------------------------------------------------------
# Shop media lifecycle — DELETE /shop/media/{id} + reference protection.
# Fixes a real orphan-growth gap found during Phase 1 browser verification:
# an uploaded-then-never-saved image previously had no cleanup path at all.
# ---------------------------------------------------------------------------

def _upload_media(admin_headers):
    r = requests.post(f"{API}/shop/media", headers=admin_headers,
                       json={"data": TINY_PNG_DATA_URL, "filename": "tiny.png"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["media_id"]


def test_admin_can_delete_unreferenced_shop_media(admin_headers):
    media_id = _upload_media(admin_headers)
    r = requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 1
    # Confirm it's actually gone.
    r2 = requests.get(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)
    assert r2.status_code == 404


def test_referenced_shop_media_cannot_be_deleted(admin_headers):
    media_id = _upload_media(admin_headers)
    product = _create_product(admin_headers, show_online=True, image_id=media_id)
    try:
        r = requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)
        assert r.status_code == 409, r.text
        # Still fetchable — nothing was deleted.
        r2 = requests.get(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)
        assert r2.status_code == 200
    finally:
        _delete_product(admin_headers, product["id"])
        requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)  # cleanup


def test_shop_media_deletable_after_reference_removed(admin_headers):
    media_id = _upload_media(admin_headers)
    product = _create_product(admin_headers, show_online=True, image_id=media_id)
    try:
        # Reject while still referenced.
        assert requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15).status_code == 409
        # Parent update removes the reference (image_id -> null) — mirrors
        # the "save parent image_id=null, then delete" sequencing rule.
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            "name": product["name"], "category": "Gear", "description": "A leash.",
            "price": 24.99, "cost": None, "low_stock_threshold": None, "track_inventory": False, "active": True,
            "show_online": True, "online_description": None, "image_id": None, "online_sort_order": None,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["image_id"] is None
        # Now deletable.
        r2 = requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["deleted"] == 1
    finally:
        _delete_product(admin_headers, product["id"])


def test_shop_media_delete_requires_admin(admin_headers, fresh_client):
    media_id = _upload_media(admin_headers)
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.delete(f"{API}/shop/media/{media_id}", headers=client_hdrs, timeout=15)
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/shop/media/{media_id}", headers=admin_headers, timeout=15)  # cleanup
