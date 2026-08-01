"""Shop Organization (Phase 1) — category/subcategory taxonomy for the
Client Shop. Purely organizational: never derives or alters pricing, never
replaces an item's underlying kind (physical_product/credit_pack/
training_program). Black-box HTTP against a live server, same convention as
test_shop_checkout.py / test_price_overrides.py.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone

import jwt
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
JWT_SECRET = os.environ["JWT_SECRET"]


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
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
        "name": f"ShopOrg Test {tag}", "email": f"shoporg-{tag}@example.com",
    }, timeout=15).json()


@pytest.fixture
def fresh_client(admin_headers):
    client = _make_client(admin_headers, uuid.uuid4().hex[:8])
    yield client
    requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def _client_headers(client_id, email):
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


def _make_category(admin_headers, **overrides):
    # Shop Manager unification (a later phase than this file) made `section`
    # a required, immutable field — the permanent top-level section
    # (merch/prepaid_visits/training) a category lives inside, derived from
    # whichever item kind it's meant to hold (see SHOP_SECTION_FOR_KIND).
    # Default to "merch" since most scenarios here only ever assign
    # physical products; tests exercising a different kind pass their own.
    body = {"name": f"Category {uuid.uuid4().hex[:8]}", "section": "merch"}
    body.update(overrides)
    r = requests.post(f"{API}/shop/categories", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_subcategory(admin_headers, category_id, **overrides):
    body = {"category_id": category_id, "name": f"Subcategory {uuid.uuid4().hex[:8]}"}
    body.update(overrides)
    r = requests.post(f"{API}/shop/subcategories", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_product(admin_headers, **overrides):
    body = {"name": f"ShopOrg Product {uuid.uuid4().hex[:8]}", "price": 20.0, "active": True, "show_online": True}
    body.update(overrides)
    r = requests.post(f"{API}/pos/products", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_pack(admin_headers, **overrides):
    body = {"name": f"ShopOrg Pack {uuid.uuid4().hex[:8]}", "qty": 5, "price": 100.0,
            "service_type": "daycare", "active": True, "available_online": True}
    body.update(overrides)
    r = requests.post(f"{API}/credit-packs", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_program(admin_headers, **overrides):
    body = {"name": f"ShopOrg Program {uuid.uuid4().hex[:8]}", "type": "custom",
            "format": {"count": 4, "unit": "sessions"}, "price": 200.0, "active": True, "available_online": True}
    body.update(overrides)
    r = requests.post(f"{API}/programs", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_category(admin_headers, category_id, action="deactivate"):
    requests.delete(f"{API}/shop/categories/{category_id}", headers=admin_headers, json={"action": action}, timeout=15)


def _delete_subcategory(admin_headers, subcategory_id, action="deactivate"):
    requests.delete(f"{API}/shop/subcategories/{subcategory_id}", headers=admin_headers, json={"action": action}, timeout=15)


# ---------------------------------------------------------------------------
# 1-2. Creation
# ---------------------------------------------------------------------------

def test_create_category(admin_headers):
    cat = _make_category(admin_headers, name="Dog Gear", description="Everyday gear")
    try:
        assert cat["name"] == "Dog Gear"
        assert cat["slug"]
        assert cat["active"] is True
    finally:
        _delete_category(admin_headers, cat["id"])


def test_create_subcategory(admin_headers):
    cat = _make_category(admin_headers, name="Dog Gear")
    try:
        sub = _make_subcategory(admin_headers, cat["id"], name="Leashes")
        assert sub["category_id"] == cat["id"]
        assert sub["name"] == "Leashes"
    finally:
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 3. Subcategory requires a valid parent
# ---------------------------------------------------------------------------

def test_subcategory_requires_valid_parent(admin_headers):
    r = requests.post(f"{API}/shop/subcategories", headers=admin_headers, json={
        "category_id": "does-not-exist", "name": "Orphan",
    }, timeout=15)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# 4. Renaming a category never disconnects its items
# ---------------------------------------------------------------------------

def test_rename_category_keeps_items_connected(admin_headers):
    cat = _make_category(admin_headers, name="Original Name")
    product = _make_product(admin_headers, category_id=cat["id"])
    try:
        r = requests.put(f"{API}/shop/categories/{cat['id']}", headers=admin_headers, json={"name": "Renamed Category"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed Category"
        impact = requests.get(f"{API}/shop/categories/{cat['id']}/impact", headers=admin_headers, timeout=15).json()
        assert impact["item_count"] == 1
        fresh_product = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        ours = next(p for p in fresh_product if p["id"] == product["id"])
        assert ours["category_id"] == cat["id"]  # same id, unaffected by the rename
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 5-7. Assigning each item kind
# ---------------------------------------------------------------------------

def test_assign_physical_product(admin_headers):
    cat = _make_category(admin_headers)
    sub = _make_subcategory(admin_headers, cat["id"])
    try:
        product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub["id"])
        assert product["category_id"] == cat["id"]
        assert product["subcategory_id"] == sub["id"]
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
    finally:
        _delete_category(admin_headers, cat["id"])


def test_assign_credit_pack(admin_headers):
    cat = _make_category(admin_headers, section="prepaid_visits")
    try:
        pack = _make_pack(admin_headers, category_id=cat["id"])
        assert pack["category_id"] == cat["id"]
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)
    finally:
        _delete_category(admin_headers, cat["id"])


def test_assign_training_program(admin_headers):
    cat = _make_category(admin_headers, section="training")
    try:
        program = _make_program(admin_headers, category_id=cat["id"])
        assert program["category_id"] == cat["id"]
    finally:
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 8. Incompatible category/subcategory combination rejected
# ---------------------------------------------------------------------------

def test_incompatible_category_subcategory_combination_rejected(admin_headers):
    cat_a = _make_category(admin_headers)
    cat_b = _make_category(admin_headers)
    try:
        sub_of_a = _make_subcategory(admin_headers, cat_a["id"])
        r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
            "name": f"Bad Combo {uuid.uuid4().hex[:6]}", "price": 10.0, "active": True,
            "category_id": cat_b["id"], "subcategory_id": sub_of_a["id"],
        }, timeout=15)
        assert r.status_code == 400
    finally:
        _delete_category(admin_headers, cat_a["id"])
        _delete_category(admin_headers, cat_b["id"])


def test_bulk_assign_rejects_incompatible_combination(admin_headers):
    cat_a = _make_category(admin_headers)
    cat_b = _make_category(admin_headers)
    try:
        sub_of_a = _make_subcategory(admin_headers, cat_a["id"])
        product = _make_product(admin_headers)
        try:
            r = requests.post(f"{API}/shop/items/bulk-assign", headers=admin_headers, json={
                "items": [{"kind": "physical_product", "id": product["id"]}],
                "category_id": cat_b["id"], "subcategory_id": sub_of_a["id"],
            }, timeout=15)
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
    finally:
        _delete_category(admin_headers, cat_a["id"])
        _delete_category(admin_headers, cat_b["id"])


# ---------------------------------------------------------------------------
# 9-10. Reordering
# ---------------------------------------------------------------------------

def test_reorder_categories(admin_headers):
    cat1 = _make_category(admin_headers, name="ZZZ First")
    cat2 = _make_category(admin_headers, name="AAA Second")
    try:
        r = requests.post(f"{API}/shop/categories/reorder", headers=admin_headers, json={
            "ordered_ids": [cat2["id"], cat1["id"]],
        }, timeout=15)
        assert r.status_code == 200
        listing = requests.get(f"{API}/shop/categories", headers=admin_headers, timeout=15).json()["categories"]
        c2 = next(c for c in listing if c["id"] == cat2["id"])
        c1 = next(c for c in listing if c["id"] == cat1["id"])
        assert c2["sort_order"] < c1["sort_order"]
    finally:
        _delete_category(admin_headers, cat1["id"])
        _delete_category(admin_headers, cat2["id"])


def test_reorder_subcategories(admin_headers):
    cat = _make_category(admin_headers)
    try:
        sub1 = _make_subcategory(admin_headers, cat["id"], name="Sub One")
        sub2 = _make_subcategory(admin_headers, cat["id"], name="Sub Two")
        r = requests.post(f"{API}/shop/subcategories/reorder", headers=admin_headers, json={
            "ordered_ids": [sub2["id"], sub1["id"]],
        }, timeout=15)
        assert r.status_code == 200
        listing = requests.get(f"{API}/shop/categories", headers=admin_headers, timeout=15).json()["categories"]
        found = next(c for c in listing if c["id"] == cat["id"])
        subs_by_id = {s["id"]: s for s in found["subcategories"]}
        assert subs_by_id[sub2["id"]]["sort_order"] < subs_by_id[sub1["id"]]["sort_order"]
    finally:
        _delete_category(admin_headers, cat["id"])


def test_reordering_items_preserves_online_sort_order(admin_headers):
    """Assigning a product to a category must not disturb its pre-existing
    online_sort_order — categories organize display, they don't replace the
    item-level ordering field products already have."""
    cat = _make_category(admin_headers)
    try:
        product = _make_product(admin_headers, online_sort_order=7)
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            **{k: v for k, v in product.items() if k not in ("id", "stock_on_hand", "created_at", "updated_at", "stock_reserved", "shop_reservations")},
            "category_id": cat["id"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["online_sort_order"] == 7
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
    finally:
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 12-14. Deactivation + visibility
# ---------------------------------------------------------------------------

def test_deactivate_category(admin_headers):
    cat = _make_category(admin_headers)
    r = requests.delete(f"{API}/shop/categories/{cat['id']}", headers=admin_headers, json={"action": "deactivate"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["action"] == "deactivated"
    listing = requests.get(f"{API}/shop/categories", headers=admin_headers, timeout=15).json()["categories"]
    found = next(c for c in listing if c["id"] == cat["id"])
    assert found["active"] is False


def test_inactive_category_hidden_from_client_catalog(admin_headers, fresh_client):
    cat = _make_category(admin_headers)
    product = _make_product(admin_headers, category_id=cat["id"])
    try:
        requests.delete(f"{API}/shop/categories/{cat['id']}", headers=admin_headers, json={"action": "deactivate"}, timeout=15)
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15)
        assert r.status_code == 200
        ids = {i["id"] for i in r.json()["items"]}
        assert product["id"] not in ids  # hidden due to inactive category
        # Still fully visible/editable from admin.
        admin_view = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        assert any(p["id"] == product["id"] and p["active"] for p in admin_view)
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


def test_uncategorized_items_shown_under_all(admin_headers, fresh_client):
    product = _make_product(admin_headers)  # no category assigned
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15)
        assert r.status_code == 200
        item = next(i for i in r.json()["items"] if i["id"] == product["id"])
        assert item["category_id"] is None

        admin_uncat = requests.get(f"{API}/shop/uncategorized-items", headers=admin_headers, timeout=15).json()
        assert any(i["id"] == product["id"] for i in admin_uncat["items"])
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 15-17. Safe removal + moving items
# ---------------------------------------------------------------------------

def test_remove_category_moves_items_to_destination(admin_headers):
    cat_a = _make_category(admin_headers)
    cat_b = _make_category(admin_headers)
    product = _make_product(admin_headers, category_id=cat_a["id"])
    try:
        r = requests.delete(f"{API}/shop/categories/{cat_a['id']}", headers=admin_headers, json={
            "action": "move_to_category", "target_category_id": cat_b["id"],
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["items_moved"] == 1
        listing = requests.get(f"{API}/shop/categories", headers=admin_headers, timeout=15).json()["categories"]
        assert not any(c["id"] == cat_a["id"] for c in listing)  # gone
        fresh = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        ours = next(p for p in fresh if p["id"] == product["id"])
        assert ours["category_id"] == cat_b["id"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat_b["id"])


def test_remove_category_moves_items_to_uncategorized(admin_headers):
    cat = _make_category(admin_headers)
    product = _make_product(admin_headers, category_id=cat["id"])
    try:
        r = requests.delete(f"{API}/shop/categories/{cat['id']}", headers=admin_headers, json={"action": "move_to_uncategorized"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["items_moved"] == 1
        fresh = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        ours = next(p for p in fresh if p["id"] == product["id"])
        assert ours["category_id"] is None
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)


def test_remove_subcategory_moves_items_to_parent_category(admin_headers):
    cat = _make_category(admin_headers)
    sub = _make_subcategory(admin_headers, cat["id"])
    product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub["id"])
    try:
        r = requests.delete(f"{API}/shop/subcategories/{sub['id']}", headers=admin_headers, json={"action": "move_to_category"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["items_moved"] == 1
        fresh = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        ours = next(p for p in fresh if p["id"] == product["id"])
        assert ours["category_id"] == cat["id"]
        assert ours["subcategory_id"] is None
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


def test_remove_subcategory_to_another_subcategory(admin_headers):
    cat = _make_category(admin_headers)
    sub_a = _make_subcategory(admin_headers, cat["id"])
    sub_b = _make_subcategory(admin_headers, cat["id"])
    product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub_a["id"])
    try:
        r = requests.delete(f"{API}/shop/subcategories/{sub_a['id']}", headers=admin_headers, json={
            "action": "move_to_subcategory", "target_subcategory_id": sub_b["id"],
        }, timeout=15)
        assert r.status_code == 200
        fresh = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": True}, timeout=15).json()
        ours = next(p for p in fresh if p["id"] == product["id"])
        assert ours["subcategory_id"] == sub_b["id"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 18. Historical order snapshots survive category rename/removal
# ---------------------------------------------------------------------------

def test_shop_order_freezes_category_snapshot(admin_headers, fresh_client):
    cat = _make_category(admin_headers, name="Freeze Test Category")
    sub = _make_subcategory(admin_headers, cat["id"], name="Freeze Test Sub")
    product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub["id"], price=15.0)
    try:
        # Drive the real checkout endpoint (forced Stripe failure is fine —
        # the order/line is created before Stripe is ever called).
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])

        async def _poison(db):
            await db.clients.update_one({"id": fresh_client["id"]}, {"$set": {"stripe_customer_id": f"cus_test_nonexistent_{uuid.uuid4().hex}"}})
        _mongo_run(_poison)

        r = requests.post(f"{API}/shop/checkout", headers=client_hdrs, json={
            "items": [{"kind": "product", "ref_id": product["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        }, timeout=20)
        assert r.status_code == 502, r.text  # forced Stripe failure — order already frozen first

        async def _find_order(db):
            return await db.shop_orders.find_one({"client_id": fresh_client["id"]}, {"_id": 0})
        order = _mongo_run(_find_order)
        line = order["lines"][0]
        assert line["category_id"] == cat["id"]
        assert line["category_name"] == "Freeze Test Category"
        assert line["subcategory_id"] == sub["id"]
        assert line["subcategory_name"] == "Freeze Test Sub"

        # Rename the category AFTER the order was placed — the frozen line
        # must keep showing the OLD name.
        requests.put(f"{API}/shop/categories/{cat['id']}", headers=admin_headers, json={"name": "Renamed After Order"}, timeout=15)
        order_after_rename = _mongo_run(_find_order)
        assert order_after_rename["lines"][0]["category_name"] == "Freeze Test Category"
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 19. Permission enforcement
# ---------------------------------------------------------------------------

def test_permission_enforcement_requires_staff_role(fresh_client):
    """A client (non-staff) must never reach the admin category endpoints."""
    client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
    r = requests.post(f"{API}/shop/categories", headers=client_hdrs, json={"name": "Should Fail"}, timeout=15)
    assert r.status_code == 403


def test_permission_enforcement_requires_manage_permission():
    """A staff (non-admin, role='employee') account with the read_only
    staff_role — which has no view_shop_categories/manage_shop_categories in
    the default ROLE_PERMISSIONS matrix — must be rejected."""
    tag = uuid.uuid4().hex[:8]
    user_id = str(uuid.uuid4())

    async def _insert(db):
        await db.users.insert_one({
            "id": user_id, "email": f"noperm-{tag}@example.com", "name": "No Perm Staff", "role": "employee",
            "staff_role": "read_only", "active": True, "must_change_password": False,
            "password_hash": "unused-jwt-minted-directly", "token_version": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    _mongo_run(_insert)
    token = jwt.encode({"sub": user_id, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.post(f"{API}/shop/categories", headers=headers, json={"name": "Should Fail Too", "section": "merch"}, timeout=15)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# 20. Audit-log creation (handled by the existing global audit middleware —
# confirm it actually fires for these new endpoints).
# ---------------------------------------------------------------------------

def test_category_creation_is_audited(admin_headers):
    cat = _make_category(admin_headers, name=f"Audit Test {uuid.uuid4().hex[:6]}")
    try:
        r = requests.get(f"{API}/audit-log", headers=admin_headers, params={"limit": 50}, timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json().get("entries") or []
        assert any(cat["id"] in (row.get("record_id") or "") or "/shop/categories" in (row.get("path") or "") for row in rows)
    finally:
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# 23. Search matches category/subcategory context (client catalog fields —
# the actual text search happens client-side in PortalShop.jsx, but it can
# only work if the catalog response carries these fields, which this proves).
# ---------------------------------------------------------------------------

def test_catalog_item_carries_category_context_for_search(admin_headers, fresh_client):
    cat = _make_category(admin_headers, name="Searchable Category")
    sub = _make_subcategory(admin_headers, cat["id"], name="Searchable Sub")
    product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub["id"])
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15)
        item = next(i for i in r.json()["items"] if i["id"] == product["id"])
        assert item["category_name"] == "Searchable Category"
        assert item["subcategory_name"] == "Searchable Sub"

        taxonomy = requests.get(f"{API}/shop/catalog/taxonomy", headers=client_hdrs, timeout=15)
        assert taxonomy.status_code == 200
        cats = taxonomy.json()["categories"]
        found = next(c for c in cats if c["id"] == cat["id"])
        assert any(s["name"] == "Searchable Sub" for s in found["subcategories"])
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# Duplicate-name safety (validated alongside creation/rename above)
# ---------------------------------------------------------------------------

def test_duplicate_active_category_name_rejected(admin_headers):
    cat = _make_category(admin_headers, name="Dupe Name Category")
    try:
        r = requests.post(f"{API}/shop/categories", headers=admin_headers, json={"name": "Dupe Name Category", "section": "merch"}, timeout=15)
        assert r.status_code == 409
    finally:
        _delete_category(admin_headers, cat["id"])


# ---------------------------------------------------------------------------
# Managed-category integration repair (ManageProductsPanel / CreditPacksSettings
# / Programs.jsx no longer gate the picker behind "available online", and
# products no longer treat free-text `category` as the authoritative Shop
# assignment). Covers: active-only NEW assignment, existing inactive
# assignment preserved until an intentional change, all three item kinds
# assignable (including via bulk), and catalog context for all three kinds.
# ---------------------------------------------------------------------------

def test_inactive_category_rejected_for_new_product_assignment(admin_headers):
    cat = _make_category(admin_headers)
    try:
        _delete_category(admin_headers, cat["id"])  # deactivate
        r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
            "name": f"Bad Inactive Cat {uuid.uuid4().hex[:6]}", "price": 10.0, "active": True,
            "category_id": cat["id"],
        }, timeout=15)
        assert r.status_code == 400, r.text
    finally:
        _delete_category(admin_headers, cat["id"], action="deactivate")


def test_inactive_subcategory_rejected_for_new_assignment(admin_headers):
    cat = _make_category(admin_headers)
    sub = _make_subcategory(admin_headers, cat["id"])
    try:
        _delete_subcategory(admin_headers, sub["id"])  # deactivate
        r = requests.post(f"{API}/pos/products", headers=admin_headers, json={
            "name": f"Bad Inactive Sub {uuid.uuid4().hex[:6]}", "price": 10.0, "active": True,
            "category_id": cat["id"], "subcategory_id": sub["id"],
        }, timeout=15)
        assert r.status_code == 400, r.text
    finally:
        _delete_category(admin_headers, cat["id"])


def test_existing_inactive_category_assignment_preserved_on_resave(admin_headers):
    """Deactivating a category must not force items off it, and re-saving an
    item without changing its category must never fail just because that
    category went inactive in the meantime."""
    cat = _make_category(admin_headers)
    sub = _make_subcategory(admin_headers, cat["id"])
    product = _make_product(admin_headers, category_id=cat["id"], subcategory_id=sub["id"])
    try:
        _delete_category(admin_headers, cat["id"])  # deactivate — items must stay assigned
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            "name": product["name"], "price": product["price"], "active": True,
            "category_id": cat["id"], "subcategory_id": sub["id"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["category_id"] == cat["id"]
        assert r.json()["subcategory_id"] == sub["id"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


def test_can_intentionally_replace_inactive_category_assignment(admin_headers):
    old_cat = _make_category(admin_headers)
    new_cat = _make_category(admin_headers)
    product = _make_product(admin_headers, category_id=old_cat["id"])
    try:
        _delete_category(admin_headers, old_cat["id"])  # deactivate the old one
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            "name": product["name"], "price": product["price"], "active": True,
            "category_id": new_cat["id"], "subcategory_id": None,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["category_id"] == new_cat["id"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, old_cat["id"])
        _delete_category(admin_headers, new_cat["id"])


def test_changing_category_clears_incompatible_subcategory_server_side(admin_headers):
    """The frontend always clears subcategory_id when category changes, but
    the server must independently reject a leftover subcategory from the
    PREVIOUS category if a client ever sent one anyway."""
    cat_a = _make_category(admin_headers)
    cat_b = _make_category(admin_headers)
    sub_of_a = _make_subcategory(admin_headers, cat_a["id"])
    product = _make_product(admin_headers, category_id=cat_a["id"], subcategory_id=sub_of_a["id"])
    try:
        r = requests.put(f"{API}/pos/products/{product['id']}", headers=admin_headers, json={
            "name": product["name"], "price": product["price"], "active": True,
            "category_id": cat_b["id"], "subcategory_id": sub_of_a["id"],
        }, timeout=15)
        assert r.status_code == 400, r.text
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat_a["id"])
        _delete_category(admin_headers, cat_b["id"])


def test_bulk_assign_rejects_inactive_category(admin_headers):
    cat = _make_category(admin_headers)
    product = _make_product(admin_headers)
    try:
        _delete_category(admin_headers, cat["id"])  # deactivate
        r = requests.post(f"{API}/shop/items/bulk-assign", headers=admin_headers, json={
            "items": [{"kind": "physical_product", "id": product["id"]}],
            "category_id": cat["id"], "subcategory_id": None,
        }, timeout=15)
        assert r.status_code == 400, r.text
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat["id"])


def test_bulk_assign_across_all_three_item_kinds(admin_headers):
    """Shop Manager unification (a later phase than this file) scopes every
    category to exactly one permanent section, derived from the item kind
    it holds (merch/prepaid_visits/training — see SHOP_SECTION_FOR_KIND).
    One shared category across all three kinds is no longer possible by
    design; bulk-assign each kind to its own section-matched category
    instead, in three separate calls (bulk-assign takes one category_id
    per request)."""
    cat_merch = _make_category(admin_headers, section="merch")
    cat_prepaid = _make_category(admin_headers, section="prepaid_visits")
    cat_training = _make_category(admin_headers, section="training")
    product = _make_product(admin_headers)
    pack = _make_pack(admin_headers)
    program = _make_program(admin_headers)
    try:
        for kind, item_id, cat in (
            ("physical_product", product["id"], cat_merch),
            ("credit_pack", pack["id"], cat_prepaid),
            ("training_program", program["id"], cat_training),
        ):
            r = requests.post(f"{API}/shop/items/bulk-assign", headers=admin_headers, json={
                "items": [{"kind": kind, "id": item_id}],
                "category_id": cat["id"], "subcategory_id": None,
            }, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["updated"] == 1
            assert r.json()["errors"] == []

        p = requests.get(f"{API}/pos/products", headers=admin_headers, params={"include_inactive": "true"}, timeout=15).json()
        assert next(x for x in p if x["id"] == product["id"])["category_id"] == cat_merch["id"]
        packs = requests.get(f"{API}/credit-packs", headers=admin_headers, params={"include_inactive": "true"}, timeout=15).json()
        assert next(x for x in packs if x["id"] == pack["id"])["category_id"] == cat_prepaid["id"]
        programs = requests.get(f"{API}/programs", headers=admin_headers, timeout=15).json()
        assert next(x for x in programs if x["id"] == program["id"])["category_id"] == cat_training["id"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)
        requests.delete(f"{API}/programs/{program['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat_merch["id"])
        _delete_category(admin_headers, cat_prepaid["id"])
        _delete_category(admin_headers, cat_training["id"])


def test_catalog_carries_category_context_for_all_three_kinds(admin_headers, fresh_client):
    """Client Shop filtering runs client-side over GET /shop/catalog's unified
    item list — this proves that list carries category/subcategory context
    identically for products, credit packs, AND training programs, not just
    products. Each kind gets its own section-matched category (Shop Manager
    unification, a later phase than this file, makes one shared category
    across kinds structurally impossible — see SHOP_SECTION_FOR_KIND)."""
    cat_merch = _make_category(admin_headers, name=f"Tri-Kind Merch {uuid.uuid4().hex[:6]}", section="merch")
    cat_prepaid = _make_category(admin_headers, name=f"Tri-Kind Prepaid {uuid.uuid4().hex[:6]}", section="prepaid_visits")
    cat_training = _make_category(admin_headers, name=f"Tri-Kind Training {uuid.uuid4().hex[:6]}", section="training")
    product = _make_product(admin_headers, category_id=cat_merch["id"])
    pack = _make_pack(admin_headers, category_id=cat_prepaid["id"])
    program = _make_program(admin_headers, category_id=cat_training["id"])
    try:
        client_hdrs = _client_headers(fresh_client["id"], fresh_client["email"])
        r = requests.get(f"{API}/shop/catalog", headers=client_hdrs, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        by_id = {i["id"]: i for i in items}
        for expected_kind, item_id, cat in (
            ("product", product["id"], cat_merch),
            ("credit_pack", pack["id"], cat_prepaid),
            ("training_program", program["id"], cat_training),
        ):
            item = by_id.get(item_id)
            assert item is not None, f"{expected_kind} missing from catalog"
            assert item["kind"] == expected_kind
            assert item["category_id"] == cat["id"]
            assert item["category_name"] == cat["name"]
    finally:
        requests.delete(f"{API}/pos/products/{product['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/credit-packs/{pack['id']}", headers=admin_headers, params={"force": "true"}, timeout=15)
        requests.delete(f"{API}/programs/{program['id']}", headers=admin_headers, timeout=15)
        _delete_category(admin_headers, cat_merch["id"])
        _delete_category(admin_headers, cat_prepaid["id"])
        _delete_category(admin_headers, cat_training["id"])
