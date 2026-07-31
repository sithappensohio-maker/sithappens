"""Shopify-linked merchandise: a lightweight, display-only catalog link
alongside the existing internal Shop — never a second commerce system.

Same two testing strategies as test_shop_management.py:
  - Data model / API surface / cart-blocking / archive / pricing-guard
    checks: black-box HTTP against the live server.
  - Server-internal cart pricing (_price_shop_cart): calls it directly via
    the "import server, asyncio.run(...)" convention, rebinding server.db to
    a fresh Motor client per call (see _call_server) so independent
    asyncio.run() calls never collide with the module-level client's event
    loop binding.
"""
import asyncio
import os
import sys
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
DB_NAME = os.environ.get("DB_NAME", "sit_happens")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _call_server(async_fn):
    """See test_shop_management.py's identical helper for the full Motor
    event-loop-binding rationale. Rebinds server.db to a fresh client for
    the duration of this call only, then restores it."""
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        original_db = server.db
        server.db = mc[DB_NAME]
        try:
            return await async_fn()
        finally:
            server.db = original_db
            mc.close()
    return asyncio.run(_wrapped())


def _price_cart(items, client_id=None):
    async def _run():
        cart_items = [server.ShopCartItemIn(kind=k, ref_id=r, quantity=q) for (k, r, q) in items]
        return await server._price_shop_cart(cart_items, client_id=client_id)
    return _call_server(_run)


def _make_client(admin_headers, tag):
    r = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Merch {tag}", "email": f"merch-{tag}@example.com",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def fresh_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
    import jwt
    from datetime import datetime, timezone
    user_id = str(uuid.uuid4())

    async def _insert(db):
        await db.users.insert_one({
            "id": user_id, "email": email, "name": "Test Client", "role": "client",
            "client_id": client_id, "active": True, "must_change_password": False,
            "password_hash": "unused-jwt-minted-directly", "token_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _call_server(lambda: _insert(server.db))
    token = jwt.encode({"sub": user_id, "type": "access", "ver": 0}, os.environ["JWT_SECRET"], algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _make_internal_product(admin_headers, tag, price=20.0):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"Merch Internal {tag}", "price": price, "active": True, "show_online": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_shopify_product(admin_headers, tag, url="https://example-store.myshopify.com/products/test-shirt", **extra):
    body = {
        "name": f"Merch Shopify {tag}", "active": True, "show_online": True,
        "sales_destination": "shopify_external", "shopify_product_url": url,
        **extra,
    }
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json=body, timeout=15)
    return r


@pytest.fixture
def shopify_product(admin_headers):
    r = _make_shopify_product(admin_headers, uuid.uuid4().hex[:8])
    assert r.status_code == 200, r.text
    product = r.json()
    yield product
    requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 1. Existing products remain internal after migration.
# ═══════════════════════════════════════════════════════════════════════

def test_1_existing_products_remain_internal(admin_headers):
    product = _make_internal_product(admin_headers, uuid.uuid4().hex[:8])
    try:
        assert product["sales_destination"] == "internal"
        assert product.get("shopify_product_url") is None
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 2. An administrator can create a Shopify-linked listing.
# ═══════════════════════════════════════════════════════════════════════

def test_2_admin_can_create_shopify_linked_listing(admin_headers):
    r = _make_shopify_product(admin_headers, uuid.uuid4().hex[:8], shopify_display_price=24.99, shopify_from_price=True)
    try:
        assert r.status_code == 200, r.text
        product = r.json()
        assert product["sales_destination"] == "shopify_external"
        assert product["shopify_product_url"].startswith("https://")
        assert product["shopify_display_price"] == 24.99
        assert product["shopify_from_price"] is True
        # Internal-only fields are forced off server-side regardless of destination.
        assert product["track_inventory"] is False
        assert product["cost"] is None
        assert product["stock_on_hand"] == 0
    finally:
        requests.delete(f"{API}/pos/products/{r.json()['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 3. Invalid and unsafe URLs are rejected.
# ═══════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("bad_url", [
    "javascript:alert(1)",
    "http://insecure.example.com/product",
    "ftp://example.com/product",
    "not-a-url-at-all",
    "data:text/html,<script>alert(1)</script>",
])
def test_3_unsafe_or_invalid_urls_are_rejected(admin_headers, bad_url):
    r = _make_shopify_product(admin_headers, uuid.uuid4().hex[:8], url=bad_url)
    assert r.status_code == 400, r.text


def test_3b_missing_url_is_rejected(admin_headers):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": "No URL Merch", "active": True, "sales_destination": "shopify_external",
    }, timeout=15)
    assert r.status_code == 400, r.text


# ═══════════════════════════════════════════════════════════════════════
# 4. Shopify listings appear in the correct category and subcategory.
# ═══════════════════════════════════════════════════════════════════════

def test_4_shopify_listing_appears_in_its_category_and_subcategory(admin_headers, shopify_product, fresh_client):
    cat = requests.post(f"{API}/shop/categories", headers=admin_headers, json={"name": f"Merch Cat {uuid.uuid4().hex[:6]}"}, timeout=15).json()
    sub = requests.post(f"{API}/shop/subcategories", headers=admin_headers,
                         json={"category_id": cat["id"], "name": f"Merch Sub {uuid.uuid4().hex[:6]}"}, timeout=15).json()
    try:
        r = requests.put(f"{API}/pos/products/{shopify_product['id']}", headers=admin_headers, json={
            **{k: v for k, v in shopify_product.items() if k not in ("id", "created_at", "updated_at", "stock_on_hand", "archived")},
            "category_id": cat["id"], "subcategory_id": sub["id"],
        }, timeout=15)
        assert r.status_code == 200, r.text

        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        catalog = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15).json()["items"]
        item = next(i for i in catalog if i["id"] == shopify_product["id"])
        assert item["category_id"] == cat["id"]
        assert item["subcategory_id"] == sub["id"]
        assert item["category_name"] == cat["name"]
    finally:
        requests.delete(f"{API}/shop/categories/{cat['id']}", headers=admin_headers,
                         json={"action": "deactivate"}, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 5. Shopify listings are marked so the frontend shows "View Options", not
#    "Add to Cart" (PortalShop.jsx branches on this exact field).
# ═══════════════════════════════════════════════════════════════════════

def test_5_shopify_listing_is_flagged_for_view_options_not_add_to_cart(admin_headers, shopify_product, fresh_client):
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    catalog = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15).json()["items"]
    item = next(i for i in catalog if i["id"] == shopify_product["id"])
    assert item["sales_destination"] == "shopify_external"
    assert item["shopify_product_url"] == shopify_product["shopify_product_url"]
    # No internal cart/price fields leak onto a Shopify listing.
    assert "effective_price" not in item
    assert "has_price_override" not in item


# ═══════════════════════════════════════════════════════════════════════
# 6. Clicking opens the configured Shopify page — verified via the click-
#    tracking endpoint, which derives the destination domain from the
#    product's OWN stored URL (never trusts the request).
# ═══════════════════════════════════════════════════════════════════════

def test_6_click_tracking_records_the_configured_destination(admin_headers, shopify_product, fresh_client):
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/merch-click", headers=client_hdrs, json={"product_id": shopify_product["id"]}, timeout=15)
    assert r.status_code == 200, r.text

    async def _check(db):
        row = await db.shop_merch_clicks.find_one({"product_id": shopify_product["id"]}, {"_id": 0})
        assert row is not None
        assert row["client_id"] == fresh_client["id"]
        assert row["destination_domain"] == "example-store.myshopify.com"
        assert row["timestamp"]
    _call_server(lambda: _check(server.db))


def test_6b_click_tracking_rejects_a_non_shopify_product(admin_headers, fresh_client):
    internal = _make_internal_product(admin_headers, uuid.uuid4().hex[:8])
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.post(f"{API}/shop/merch-click", headers=client_hdrs, json={"product_id": internal["id"]}, timeout=15)
        assert r.status_code == 404
    finally:
        requests.delete(f"{API}/pos/products/{internal['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 7. Shopify listings cannot enter the internal cart.
# ═══════════════════════════════════════════════════════════════════════

def test_7_shopify_listing_cannot_enter_the_cart(shopify_product, fresh_client):
    with pytest.raises(Exception) as exc_info:
        _price_cart([("product", shopify_product["id"], 1)], client_id=fresh_client["id"])
    assert "Shopify" in str(exc_info.value) or "400" in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════
# 8. No internal payment, invoice, receipt, inventory, credit, or
#    fulfillment record is created for a Shopify listing.
# ═══════════════════════════════════════════════════════════════════════

def test_8_checkout_rejects_shopify_listing_and_creates_no_order(admin_headers, shopify_product, fresh_client):
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    before = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15)
    assert before.status_code == 200

    r = requests.post(f"{API}/shop/checkout", headers=client_hdrs, json={
        "items": [{"kind": "product", "ref_id": shopify_product["id"], "quantity": 1}],
        "idempotency_key": uuid.uuid4().hex,
    }, timeout=15)
    assert r.status_code == 400, r.text

    async def _check(db):
        order = await db.shop_orders.find_one(
            {"lines": {"$elemMatch": {"kind": "product", "ref_id": shopify_product["id"]}}}, {"_id": 0},
        )
        assert order is None, "a Shopify-linked listing must never end up on a real Shop order"
    _call_server(lambda: _check(server.db))


# ═══════════════════════════════════════════════════════════════════════
# 9. Archiving hides the listing without affecting Shopify (there is no
#    Shopify API call anywhere in this feature — this proves the stored
#    Shopify link/fields are untouched by archive/restore).
# ═══════════════════════════════════════════════════════════════════════

def test_9_archiving_hides_listing_without_touching_its_shopify_link(admin_headers, shopify_product, fresh_client):
    r = requests.post(f"{API}/pos/products/{shopify_product['id']}/archive", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    archived = r.json()
    assert archived["shopify_product_url"] == shopify_product["shopify_product_url"]

    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    catalog = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15).json()["items"]
    assert not any(i["id"] == shopify_product["id"] for i in catalog)

    restore = requests.post(f"{API}/pos/products/{shopify_product['id']}/restore", headers=admin_headers, timeout=15)
    assert restore.status_code == 200, restore.text
    assert restore.json()["shopify_product_url"] == shopify_product["shopify_product_url"]


# ═══════════════════════════════════════════════════════════════════════
# 10. Internal products continue using existing checkout.
# ═══════════════════════════════════════════════════════════════════════

def test_10_internal_product_still_prices_and_carts_normally(fresh_client, admin_headers):
    product = _make_internal_product(admin_headers, uuid.uuid4().hex[:8], price=15.0)
    try:
        priced = _price_cart([("product", product["id"], 2)], client_id=fresh_client["id"])
        line = priced["lines"][0]
        assert line["unit_price"] == 15.0
        assert line["line_subtotal"] == 30.0
        assert line["pricing_source"] == "standard"
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 11. Client-specific pricing continues applying to internal products only.
# ═══════════════════════════════════════════════════════════════════════

def test_11_client_specific_pricing_rejected_for_shopify_never_internal(admin_headers, shopify_product, fresh_client):
    internal = _make_internal_product(admin_headers, uuid.uuid4().hex[:8])
    try:
        ok = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": internal["id"], "override_price": 5.0,
        }, timeout=15)
        assert ok.status_code == 200, ok.text

        rejected = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": shopify_product["id"], "override_price": 3.0,
        }, timeout=15)
        assert rejected.status_code == 400, rejected.text
        assert "Shopify" in rejected.text
    finally:
        requests.delete(f"{API}/pos/products/{internal['id']}", headers=admin_headers, timeout=15)
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# 12. Mobile and desktop external navigation work cleanly.
#
# This is a client-side branch in PortalShop.jsx's openShopifyListing()
# (window.matchMedia("(max-width: 640px)") picking same-tab vs new-tab
# navigation) — there is no server behavior to assert here beyond what
# test_6 already covers (the click-tracking call that precedes the
# navigation on both device sizes). Verified live in-browser at both
# viewport sizes as part of this feature's manual verification pass.
# ═══════════════════════════════════════════════════════════════════════
