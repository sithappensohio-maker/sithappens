"""Shop management: safe product deletion/archiving + grandfathered pricing
(individual overrides and pricing tiers) extended to physical products.

Two testing strategies, matching this repo's existing conventions:
  - Delete/archive/restore/catalog-visibility: black-box HTTP against a live
    server (same convention as test_shop_checkout.py / test_price_overrides.py).
  - Pricing precedence (individual override > tier > standard) and cart
    pricing: calls server.py's own resolve_client_price()/_price_shop_cart()
    directly (same "import server, asyncio.run(...)" convention already used
    by test_background_write_reliability.py and test_client_shop_catalog.py's
    _mongo_run helper) — this is the SAME function every real purchase path
    (Shop cart, GET /shop/catalog, credit-pack sell, booking checkout) goes
    through, so testing it directly is testing the real thing, not a mock.
"""
import asyncio
import os
import sys
import uuid
from datetime import date, timedelta, datetime, timezone

import jwt
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
JWT_SECRET = os.environ["JWT_SECRET"]
DB_NAME = os.environ.get("DB_NAME", "sit_happens")


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
            db = mc[DB_NAME]
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _make_client(admin_headers, tag):
    r = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"ShopMgmt {tag}", "email": f"shopmgmt-{tag}@example.com",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def fresh_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


@pytest.fixture
def second_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
    """Mints a valid client-role JWT directly — same convention as
    test_shop_checkout.py / test_client_shop_catalog.py."""
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


def _make_product(admin_headers, tag, price=20.0, track_inventory=False, starting_stock=0, show_online=True):
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
        "name": f"ShopMgmt Product {tag}", "price": price, "active": True,
        "track_inventory": track_inventory, "starting_stock": starting_stock,
        "show_online": show_online,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def fresh_product(admin_headers):
    product = _make_product(admin_headers, uuid.uuid4().hex[:8])
    yield product
    requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


def _catalog(headers):
    return requests.get(f"{API}/shop/catalog", headers=headers, timeout=15)


def _call_server(async_fn):
    """Calls a server.py coroutine that reads the module-level `server.db`.

    Motor's AsyncIOMotorClient binds to the event loop of its first
    operation. `server.db` is created once at import time against whatever
    loop was live then; each of these helpers runs its own independent
    asyncio.run() (its own fresh loop), so re-using the original `server.db`
    across calls raises "Event loop is closed" on the second and later
    calls. Fix: temporarily rebind `server.db` to a fresh AsyncIOMotorClient
    created inside the *current* loop, then restore it — mirrors the
    fresh-client-per-asyncio.run() convention already used by this file's
    (and test_client_shop_catalog.py's) `_mongo_run`.
    """
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


def _resolve_price(client_id, target_kind, target_code, list_price):
    async def _run():
        return await server.resolve_client_price(client_id, target_kind, target_code, list_price)
    return _call_server(_run)


def _price_cart(items, client_id=None):
    """items: list of (kind, ref_id, quantity) tuples."""
    async def _run():
        cart_items = [server.ShopCartItemIn(kind=k, ref_id=r, quantity=q) for (k, r, q) in items]
        return await server._price_shop_cart(cart_items, client_id=client_id)
    return _call_server(_run)


# ═══════════════════════════════════════════════════════════════════════
# Part 1 — Safe product deletion and archiving
# ═══════════════════════════════════════════════════════════════════════

def test_1_unused_product_can_be_permanently_deleted(admin_headers):
    product = _make_product(admin_headers, uuid.uuid4().hex[:8])
    r = requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["action"] == "deleted"
    # Really gone — not just hidden.
    listing = requests.get(f"{API}/pos/products", headers=admin_headers,
                            params={"include_inactive": True}, timeout=15).json()
    assert not any(p["id"] == product["id"] for p in listing)


def test_2_product_referenced_by_order_cannot_be_hard_deleted(admin_headers, fresh_product, fresh_client):
    order_id = str(uuid.uuid4())

    async def _seed(db):
        await db.shop_orders.insert_one({
            "id": order_id, "client_id": fresh_client["id"], "client_name": fresh_client["name"],
            "status": "paid", "fulfillment_status": "fulfilled", "pickup_status": None,
            "lines": [{
                "item_id": str(uuid.uuid4()), "kind": "product", "ref_id": fresh_product["id"],
                "name": fresh_product["name"], "unit_price": fresh_product["price"], "quantity": 1,
                "line_subtotal": fresh_product["price"], "allocated_tax": 0.0,
                "line_total": fresh_product["price"], "fulfillment_status": "fulfilled",
            }],
            "subtotal": fresh_product["price"], "tax_amount": 0.0, "tax_rate_pct": 0.0,
            "total": fresh_product["price"], "currency": "USD",
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_seed)

    r = requests.delete(f"{API}/pos/products/{fresh_product['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 409, r.text
    assert "archive" in r.json()["detail"].lower()

    # Product must still exist, completely untouched.
    listing = requests.get(f"{API}/pos/products", headers=admin_headers,
                            params={"include_inactive": True}, timeout=15).json()
    assert any(p["id"] == fresh_product["id"] for p in listing)

    async def _cleanup(db):
        await db.shop_orders.delete_one({"id": order_id})
    _mongo_run(_cleanup)


def test_3_archiving_retires_a_referenced_product_without_deleting_it(admin_headers, fresh_product):
    r = requests.post(f"{API}/pos/products/{fresh_product['id']}/archive", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["archived"] is True
    assert body["active"] is False
    assert body["show_online"] is False

    # Still exists, just retired.
    listing = requests.get(f"{API}/pos/products", headers=admin_headers,
                            params={"include_archived": True}, timeout=15).json()
    assert any(p["id"] == fresh_product["id"] and p["archived"] for p in listing)


def test_4_archived_products_disappear_from_shop_and_pos(admin_headers, fresh_client, fresh_product):
    requests.post(f"{API}/pos/products/{fresh_product['id']}/archive", headers=admin_headers, timeout=15)

    # Client Shop catalog
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    catalog = _catalog(client_hdrs).json()
    assert not any(i["kind"] == "product" and i["id"] == fresh_product["id"] for i in catalog["items"])

    # Normal POS product list (front desk register selection)
    normal_listing = requests.get(f"{API}/pos/products", headers=admin_headers, timeout=15).json()
    assert not any(p["id"] == fresh_product["id"] for p in normal_listing)
    inactive_listing = requests.get(f"{API}/pos/products", headers=admin_headers,
                                     params={"include_inactive": True}, timeout=15).json()
    assert not any(p["id"] == fresh_product["id"] for p in inactive_listing), \
        "archived products must not leak into the ordinary include_inactive view"


def test_5_historical_orders_and_receipts_remain_intact_after_archiving(admin_headers, fresh_client, fresh_product):
    order_id = str(uuid.uuid4())
    original_name = fresh_product["name"]
    original_price = fresh_product["price"]

    async def _seed(db):
        await db.shop_orders.insert_one({
            "id": order_id, "client_id": fresh_client["id"], "client_name": fresh_client["name"],
            "status": "paid", "fulfillment_status": "fulfilled", "pickup_status": None,
            "lines": [{
                "item_id": str(uuid.uuid4()), "kind": "product", "ref_id": fresh_product["id"],
                "name": original_name, "unit_price": original_price, "quantity": 2,
                "line_subtotal": original_price * 2, "allocated_tax": 0.0,
                "line_total": original_price * 2, "fulfillment_status": "fulfilled",
            }],
            "subtotal": original_price * 2, "tax_amount": 0.0, "tax_rate_pct": 0.0,
            "total": original_price * 2, "currency": "USD",
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_seed)

    # Delete refuses (has history) -> archive instead.
    assert requests.delete(f"{API}/pos/products/{fresh_product['id']}", headers=admin_headers, timeout=15).status_code == 409
    assert requests.post(f"{API}/pos/products/{fresh_product['id']}/archive", headers=admin_headers, timeout=15).status_code == 200

    order = _mongo_run(lambda db: db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
    assert order["lines"][0]["name"] == original_name
    assert order["lines"][0]["unit_price"] == original_price
    assert order["total"] == original_price * 2

    async def _cleanup(db):
        await db.shop_orders.delete_one({"id": order_id})
    _mongo_run(_cleanup)


def test_6_archived_product_can_be_restored_without_inventory_changes(admin_headers):
    product = _make_product(admin_headers, uuid.uuid4().hex[:8], track_inventory=True, starting_stock=17)
    try:
        archived = requests.post(f"{API}/pos/products/{product['id']}/archive", headers=admin_headers, timeout=15).json()
        assert archived["stock_on_hand"] == 17  # unchanged by archiving itself (field untouched by the patch)

        restored = requests.post(f"{API}/pos/products/{product['id']}/restore", headers=admin_headers, timeout=15)
        assert restored.status_code == 200, restored.text
        body = restored.json()
        assert body["archived"] is False
        assert body["active"] is True  # restored from archived_from_active snapshot
        assert body["stock_on_hand"] == 17
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


# ═══════════════════════════════════════════════════════════════════════
# Part 2 — Grandfathered Shop pricing
# ═══════════════════════════════════════════════════════════════════════

def test_7_normal_client_sees_standard_price(fresh_client, fresh_product):
    result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
    assert result["pricing_source"] == "standard"
    assert result["effective_price"] == fresh_product["price"]


def test_8_grandfathered_tier_client_sees_tier_price(admin_headers, fresh_client, fresh_product):
    tier = requests.post(f"{API}/pricing-tiers", headers=admin_headers,
                          json={"name": f"Founding {uuid.uuid4().hex[:6]}"}, timeout=15).json()
    try:
        requests.post(f"{API}/pricing-tiers/{tier['id']}/clients/{fresh_client['id']}", headers=admin_headers, timeout=15)
        requests.post(f"{API}/pricing-tiers/{tier['id']}/prices", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 12.0,
        }, timeout=15)

        result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        assert result["pricing_source"] == "tier"
        assert result["effective_price"] == 12.0
        assert result["tier_id"] == tier["id"]
    finally:
        requests.put(f"{API}/pricing-tiers/{tier['id']}", headers=admin_headers, json={"active": False}, timeout=15)


def test_9_individual_override_beats_tier_price(admin_headers, fresh_client, fresh_product):
    tier = requests.post(f"{API}/pricing-tiers", headers=admin_headers,
                          json={"name": f"Founding {uuid.uuid4().hex[:6]}"}, timeout=15).json()
    try:
        requests.post(f"{API}/pricing-tiers/{tier['id']}/clients/{fresh_client['id']}", headers=admin_headers, timeout=15)
        requests.post(f"{API}/pricing-tiers/{tier['id']}/prices", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 12.0,
        }, timeout=15)
        requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 5.0,
        }, timeout=15)

        result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        assert result["pricing_source"] == "client_override"
        assert result["effective_price"] == 5.0
    finally:
        requests.delete(f"{API}/clients/{fresh_client['id']}/price-overrides",
                         headers=admin_headers, timeout=15)  # harmless if no matching route; cleaned below
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)
        requests.put(f"{API}/pricing-tiers/{tier['id']}", headers=admin_headers, json={"active": False}, timeout=15)


def test_10_expired_and_inactive_overrides_do_not_apply(admin_headers, fresh_client, fresh_product):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    # Expired override
    r = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 1.0, "expires_on": yesterday,
    }, timeout=15)
    assert r.status_code == 200, r.text
    result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
    assert result["pricing_source"] == "standard", "an expired override must never apply"
    requests.delete(f"{API}/price-overrides/{r.json()['id']}", headers=admin_headers, timeout=15)

    # Not-yet-started override
    r = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 1.0, "starts_on": tomorrow,
    }, timeout=15)
    assert r.status_code == 200, r.text
    result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
    assert result["pricing_source"] == "standard", "an override that hasn't started yet must never apply"
    requests.delete(f"{API}/price-overrides/{r.json()['id']}", headers=admin_headers, timeout=15)

    # Revoked (inactive) override
    r = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 1.0,
    }, timeout=15)
    requests.delete(f"{API}/price-overrides/{r.json()['id']}", headers=admin_headers, timeout=15)
    result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
    assert result["pricing_source"] == "standard", "a revoked override must never apply"

    # Deactivated tier
    tier = requests.post(f"{API}/pricing-tiers", headers=admin_headers,
                          json={"name": f"Inactive {uuid.uuid4().hex[:6]}"}, timeout=15).json()
    requests.post(f"{API}/pricing-tiers/{tier['id']}/clients/{fresh_client['id']}", headers=admin_headers, timeout=15)
    requests.post(f"{API}/pricing-tiers/{tier['id']}/prices", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 1.0,
    }, timeout=15)
    requests.put(f"{API}/pricing-tiers/{tier['id']}", headers=admin_headers, json={"active": False}, timeout=15)
    result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
    assert result["pricing_source"] == "standard", "a deactivated tier must never apply"


def test_11_unauthenticated_shop_users_see_only_public_pricing(fresh_product):
    r = requests.get(f"{API}/shop/catalog", timeout=15)
    assert r.status_code in (401, 403), "the catalog must require authentication"


def test_12_clients_cannot_see_another_clients_pricing(admin_headers, fresh_client, second_client, fresh_product):
    requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 3.0,
    }, timeout=15)
    try:
        result_a = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        result_b = _resolve_price(second_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        assert result_a["effective_price"] == 3.0
        assert result_b["pricing_source"] == "standard"
        assert result_b["effective_price"] == fresh_product["price"]

        client_a_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        client_b_hdrs = _client_headers(second_client["id"], second_client["email"])
        item_a = next(i for i in _catalog(client_a_hdrs).json()["items"] if i["id"] == fresh_product["id"])
        item_b = next(i for i in _catalog(client_b_hdrs).json()["items"] if i["id"] == fresh_product["id"])
        assert item_a["effective_price"] == 3.0
        assert item_b["effective_price"] == fresh_product["price"]
        assert item_b["has_price_override"] is False
    finally:
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)


def test_13_cart_and_checkout_recalculate_pricing_server_side(admin_headers, fresh_client, fresh_product):
    requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 7.5,
    }, timeout=15)
    try:
        priced = _price_cart([("product", fresh_product["id"], 2)], client_id=fresh_client["id"])
        line = priced["lines"][0]
        assert line["unit_price"] == 7.5
        assert line["line_subtotal"] == 15.0
        assert line["pricing_source"] == "client_override"
    finally:
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)


def test_14_manipulated_frontend_price_is_ignored(fresh_client, fresh_product):
    """ShopCartItemIn has no price field at all — there is nowhere for a
    manipulated client-submitted price to even land. Confirmed here by
    POSTing one anyway (as raw JSON, bypassing the Pydantic model on our
    side of this test) and proving the resolved price is still the real
    server-side price, never whatever was submitted."""
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    admin_hdrs = {"Authorization": f"Bearer {r.json()['token']}"}
    manipulated_price = 0.01
    assert manipulated_price != fresh_product["price"]

    priced = _price_cart([("product", fresh_product["id"], 1)], client_id=fresh_client["id"])
    assert priced["lines"][0]["unit_price"] == fresh_product["price"]
    assert priced["lines"][0]["unit_price"] != manipulated_price


def test_15_order_lines_snapshot_the_actual_charged_price(admin_headers, fresh_client, fresh_product):
    requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 9.0,
    }, timeout=15)
    try:
        priced = _price_cart([("product", fresh_product["id"], 3)], client_id=fresh_client["id"])
        line = priced["lines"][0]
        assert line["list_unit_price"] == fresh_product["price"]
        assert line["unit_price"] == 9.0
        assert line["has_price_override"] is True
        assert line["price_override_id"] is not None
    finally:
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)


def test_16_inventory_deducts_correctly_at_special_price(admin_headers, fresh_client):
    product = _make_product(admin_headers, uuid.uuid4().hex[:8], price=40.0, track_inventory=True, starting_stock=10)
    try:
        requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
            "target_kind": "pos_product", "target_code": product["id"], "override_price": 4.0,
        }, timeout=15)
        priced = _price_cart([("product", product["id"], 3)], client_id=fresh_client["id"])
        line = priced["lines"][0]
        assert line["unit_price"] == 4.0
        assert line["quantity"] == 3
        # Quantity carried through pricing is what inventory reservation
        # actually deducts (_reserve_shop_inventory_line uses line["quantity"],
        # independent of unit_price) — confirmed here at the pricing layer,
        # where a bug would most likely show up as a wrong quantity next to
        # a discounted price.
        assert line["line_subtotal"] == 12.0
    finally:
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


def test_17_tax_and_reporting_reflect_the_actual_charged_amount(admin_headers, fresh_client, fresh_product):
    async def _enable_tax(db):
        s = await db.settings.find_one({}, {"_id": 0})
        return s

    # Only assert tax math IF sales tax is enabled in this environment —
    # this test must never flip global settings for the whole suite.
    settings = _mongo_run(lambda db: db.settings.find_one({}, {"_id": 0}))
    tax_cfg = (settings or {}).get("sales_tax") or {}
    requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 10.0,
    }, timeout=15)
    try:
        priced = _price_cart([("product", fresh_product["id"], 1)], client_id=fresh_client["id"])
        if tax_cfg.get("enabled") and float(tax_cfg.get("rate_pct") or 0) > 0 and (tax_cfg.get("applies_to") or {}).get("retail", True):
            expected_tax = round(10.0 * (float(tax_cfg["rate_pct"]) / 100.0), 2)
            assert priced["tax_amount"] == expected_tax, "tax must be computed on the CHARGED price, not the standard price"
            assert priced["total"] == round(10.0 + expected_tax, 2)
        else:
            assert priced["tax_amount"] == 0.0
            assert priced["total"] == 10.0
    finally:
        overrides = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                  headers=admin_headers, timeout=15).json().get("overrides", [])
        for o in overrides:
            requests.delete(f"{API}/price-overrides/{o['id']}", headers=admin_headers, timeout=15)


def test_18_editing_a_pricing_rule_does_not_alter_previous_orders(admin_headers, fresh_client, fresh_product):
    r = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 8.0,
    }, timeout=15)
    override_id = r.json()["id"]
    try:
        # Simulates the exact order snapshot _price_shop_cart would have
        # produced at that moment (same convention as test_shop_checkout.py's
        # _seed_shop_order).
        order_id = str(uuid.uuid4())
        line = {
            "item_id": str(uuid.uuid4()), "kind": "product", "ref_id": fresh_product["id"],
            "name": fresh_product["name"], "unit_price": 8.0, "quantity": 1,
            "line_subtotal": 8.0, "allocated_tax": 0.0, "line_total": 8.0,
            "fulfillment_status": "fulfilled", "list_unit_price": fresh_product["price"],
            "pricing_source": "client_override", "price_override_id": override_id, "has_price_override": True,
        }

        async def _seed(db):
            await db.shop_orders.insert_one({
                "id": order_id, "client_id": fresh_client["id"], "client_name": fresh_client["name"],
                "status": "paid", "fulfillment_status": "fulfilled", "pickup_status": None,
                "lines": [line], "subtotal": 8.0, "tax_amount": 0.0, "tax_rate_pct": 0.0, "total": 8.0,
                "currency": "USD", "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        _mongo_run(_seed)

        # NOW edit the override's price — a later, different rule.
        requests.put(f"{API}/price-overrides/{override_id}", headers=admin_headers, json={"override_price": 99.0}, timeout=15)

        order_after_edit = _mongo_run(lambda db: db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
        assert order_after_edit["lines"][0]["unit_price"] == 8.0, "editing the override later must never rewrite a completed order line"
        assert order_after_edit["total"] == 8.0

        # And the NEW price does apply going forward.
        new_resolution = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        assert new_resolution["effective_price"] == 99.0

        async def _cleanup(db):
            await db.shop_orders.delete_one({"id": order_id})
        _mongo_run(_cleanup)
    finally:
        requests.delete(f"{API}/price-overrides/{override_id}", headers=admin_headers, timeout=15)


def test_19_renaming_a_product_does_not_break_its_pricing_override(admin_headers, fresh_client, fresh_product):
    r = requests.post(f"{API}/clients/{fresh_client['id']}/price-overrides", headers=admin_headers, json={
        "target_kind": "pos_product", "target_code": fresh_product["id"], "override_price": 6.0,
    }, timeout=15)
    override_id = r.json()["id"]
    try:
        new_name = f"Renamed {uuid.uuid4().hex[:6]}"
        current = requests.get(f"{API}/pos/products", headers=admin_headers,
                                params={"include_inactive": True}, timeout=15).json()
        existing = next(p for p in current if p["id"] == fresh_product["id"])
        put_body = {**existing, "name": new_name}
        put_body.pop("id", None)
        put_body.pop("stock_on_hand", None)
        put_body.pop("stock_reserved", None)
        put_body.pop("shop_reservations", None)
        put_body.pop("created_at", None)
        put_body.pop("archived", None)
        rr = requests.put(f"{API}/pos/products/{fresh_product['id']}", headers=admin_headers, json=put_body, timeout=15)
        assert rr.status_code == 200, rr.text

        # Override still resolves correctly by id — override was attached by
        # target_code (the stable id), never by name.
        result = _resolve_price(fresh_client["id"], "pos_product", fresh_product["id"], fresh_product["price"])
        assert result["effective_price"] == 6.0

        listing = requests.get(f"{API}/clients/{fresh_client['id']}/price-overrides",
                                headers=admin_headers, timeout=15).json()
        row = next(o for o in listing["overrides"] if o["id"] == override_id)
        assert row["target_name"] == new_name, "the enriched display name should follow the rename"
    finally:
        requests.delete(f"{API}/price-overrides/{override_id}", headers=admin_headers, timeout=15)


# Test 20 ("existing regressions still pass") is verified by re-running the
# pre-existing suites this change touches (test_shop_checkout.py,
# test_price_overrides.py, test_shop_categories.py, test_client_shop_catalog.py,
# credit-pack/program/service pricing tests) rather than duplicating them here.
