"""Security checkpoint — backend permission enforcement.

Follows the frontend can() fix: `require_admin` alone only proves an
account's broad `role` is "admin" — it says nothing about `staff_role`, so a
restricted front_desk/trainer/etc. account passed exactly like the owner.
This suite pins down that the permission matrix (/api/me/permissions) is now
authoritative on the *backend* for the sensitive areas named in the audit:
staff/role management, the Stripe payment ledger, finance/income, register
and POS actions (including discounts/custom items/voids), pricing, Shop
organization, receipt settings, the audit log, and Settings.

Test users are seeded directly in Mongo (role="admin" + a restricted
staff_role) and JWTs minted locally — matches the pattern used throughout
this test suite (test_client_shop_catalog.py, test_shop_categories.py, etc)
for accounts the app has no self-serve signup path for.
"""
import os
import uuid
import jwt
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]

ROLES = ("manager", "trainer", "daycare_staff", "front_desk")


def _mongo_run(fn):
    return asyncio.run(fn())


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def staff_tokens():
    """One role="admin" test account per restricted staff_role, seeded
    directly in Mongo (no staff signup path exists for role=admin +
    restricted staff_role — matches how this exact scenario was reproduced
    and fixed on the frontend earlier in this same checkpoint)."""
    uids = {}

    async def seed():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        for role in ROLES:
            uid = str(uuid.uuid4())
            email = f"backend-permtest-{role}@example.invalid"
            await db.users.delete_many({"email": email})
            await db.users.insert_one({
                "id": uid, "email": email, "name": f"Backend Perm Test {role}",
                "role": "admin", "staff_role": role,
                "password_hash": "x", "must_change_password": False,
                "needs_password": False,
            })
            uids[role] = uid

    async def cleanup():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        await db.users.delete_many({"email": {"$regex": "^backend-permtest-"}})

    _mongo_run(seed)
    tokens = {
        role: jwt.encode({"sub": uid, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
        for role, uid in uids.items()
    }
    try:
        yield {role: {"Authorization": f"Bearer {tok}"} for role, tok in tokens.items()}
    finally:
        _mongo_run(cleanup)


@pytest.fixture(scope="module")
def client_headers():
    """A real client-portal account — must never be treated as staff."""
    r = requests.post(f"{API}/auth/register", json={
        "email": f"permcheckpoint-client-{uuid.uuid4().hex[:8]}@example.com",
        "password": "ClientPass1234", "name": "Perm Checkpoint Client",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ── 1. Owner retains intended access ────────────────────────────────────────

def test_owner_retains_full_access(admin_headers):
    for path in ("/staff/roles", "/admin/stripe-online-payments", "/settings",
                 "/audit-log", "/admin/receipt-settings", "/admin/employees"):
        r = requests.get(f"{API}{path}", headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"owner blocked from {path}: {r.status_code} {r.text[:200]}"


# ── 2. Front desk cannot read staff-role matrices unless explicitly permitted ──

def test_front_desk_cannot_read_staff_roles_matrix(staff_tokens):
    r = requests.get(f"{API}/staff/roles", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text


def test_manager_also_cannot_read_staff_roles_matrix(staff_tokens):
    """The matrix is owner-only, un-delegatable — even a manager (who has
    finance_reports/payroll/etc) must not reach it."""
    r = requests.get(f"{API}/staff/roles", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_reassign_staff_role(staff_tokens):
    r = requests.put(f"{API}/staff/some-user-id/role", headers=staff_tokens["front_desk"],
                      json={"staff_role": "manager"}, timeout=15)
    assert r.status_code == 403, r.text


# ── 3. Front desk cannot read Stripe payment ledgers without finance permission ──

def test_front_desk_cannot_read_stripe_ledger(staff_tokens):
    r = requests.get(f"{API}/admin/stripe-online-payments", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text


def test_manager_can_read_stripe_ledger(staff_tokens):
    """Manager has finance_reports by default — must be allowed through."""
    r = requests.get(f"{API}/admin/stripe-online-payments", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200, r.text


# ── 4. Restricted roles cannot alter Settings ───────────────────────────────

def test_front_desk_cannot_read_or_write_settings(staff_tokens):
    r = requests.get(f"{API}/settings", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.put(f"{API}/settings", headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r2.status_code == 403, r2.text


def test_trainer_cannot_read_or_write_settings(staff_tokens):
    r = requests.get(f"{API}/settings", headers=staff_tokens["trainer"], timeout=15)
    assert r.status_code == 403, r.text


# ── 5. Restricted roles cannot alter pricing ────────────────────────────────

def test_front_desk_cannot_create_price_override(staff_tokens):
    r = requests.post(f"{API}/clients/fake-client-id/price-overrides",
                       headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_create_credit_pack(staff_tokens):
    r = requests.post(f"{API}/credit-packs", headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_create_pos_product(staff_tokens):
    r = requests.post(f"{API}/pos/products", headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_pos_sale_with_discount_rejected(staff_tokens, admin_headers):
    """The discount check lives inside the create_pos_sale/preview handler
    body (_price_pos_cart), not just a route-level Depends — front_desk has
    take_payments (so passes the outer gate) but not pricing, so a cart with
    a discount attached must still 403 from inside the handler."""
    products = requests.get(f"{API}/pos/products", headers=admin_headers, timeout=15).json()
    if not products:
        pytest.skip("No POS products seeded in this test DB")
    line = {"kind": "retail", "product_id": products[0]["id"], "qty": 1}
    r = requests.post(f"{API}/pos/sales/preview", headers=staff_tokens["front_desk"], json={
        "lines": [line], "discount": {"kind": "fixed", "value": 5, "reason": "test"},
    }, timeout=15)
    assert r.status_code == 403, r.text
    assert "discount" in r.text.lower()


def test_front_desk_pos_sale_with_custom_item_rejected(staff_tokens):
    r = requests.post(f"{API}/pos/sales/preview", headers=staff_tokens["front_desk"], json={
        "lines": [{"kind": "custom", "custom_amount": 10, "custom_reason": "test", "description": "x"}],
    }, timeout=15)
    assert r.status_code == 403, r.text
    assert "custom" in r.text.lower()


def test_manager_pos_sale_with_discount_allowed_through_pricing_check(staff_tokens):
    """Manager has pricing=True — the cart preview should get PAST the
    discount/custom-item check (it may still fail later for unrelated
    reasons like an empty cart, but never on a pricing 403)."""
    r = requests.post(f"{API}/pos/sales/preview", headers=staff_tokens["manager"], json={
        "lines": [], "discount": {"kind": "fixed", "value": 5, "reason": "test"},
    }, timeout=15)
    assert r.status_code != 403, r.text


# ── 6. Restricted roles cannot void payments or POS sales ───────────────────

def test_front_desk_cannot_void_pos_sale(staff_tokens):
    r = requests.post(f"{API}/pos/sales/fake-sale-id/void", headers=staff_tokens["front_desk"],
                       json={"reason": "test"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_void_manual_payment(staff_tokens):
    r = requests.post(f"{API}/payments/fake-payment-id/void", headers=staff_tokens["front_desk"],
                       json={"reason": "test"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_stripe_refund(staff_tokens):
    r = requests.post(f"{API}/payments/fake-payment-id/stripe-refund",
                       headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r.status_code == 403, r.text


def test_manager_can_attempt_void_past_permission_gate(staff_tokens):
    """Manager has delete_records — a fake sale id should 404 (not found),
    never 403 (permission gate must not be what blocks it)."""
    r = requests.post(f"{API}/pos/sales/fake-sale-id/void", headers=staff_tokens["manager"],
                       json={"reason": "test"}, timeout=15)
    assert r.status_code != 403, r.text


# ── 7. Restricted roles cannot manage Shop organization without Shop permissions ──

def test_front_desk_cannot_view_shop_categories(staff_tokens):
    r = requests.get(f"{API}/shop/categories", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_create_shop_category(staff_tokens):
    r = requests.post(f"{API}/shop/categories", headers=staff_tokens["front_desk"],
                       json={"name": "should not be created"}, timeout=15)
    assert r.status_code == 403, r.text


def test_manager_can_view_shop_categories(staff_tokens):
    r = requests.get(f"{API}/shop/categories", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200, r.text


# ── 8. Restricted roles cannot manage receipt settings without receipt permissions ──

def test_front_desk_cannot_read_receipt_settings(staff_tokens):
    r = requests.get(f"{API}/admin/receipt-settings", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_write_receipt_settings(staff_tokens):
    r = requests.put(f"{API}/admin/receipt-settings", headers=staff_tokens["front_desk"], json={}, timeout=15)
    assert r.status_code == 403, r.text


def test_manager_can_read_receipt_settings(staff_tokens):
    r = requests.get(f"{API}/admin/receipt-settings", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200, r.text


def test_front_desk_cannot_read_audit_log(staff_tokens):
    r = requests.get(f"{API}/audit-log", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 403, r.text


# ── 9. Trainer and care roles retain the operational access they genuinely need ──

def test_trainer_retains_operational_access(staff_tokens):
    for path in ("/bookings", "/dogs", "/care/today", "/kennel-board"):
        r = requests.get(f"{API}{path}", headers=staff_tokens["trainer"], timeout=15)
        assert r.status_code != 403, f"trainer wrongly blocked from {path}: {r.status_code} {r.text[:200]}"


def test_daycare_staff_retains_operational_access(staff_tokens):
    for path in ("/care/today", "/kennel-board", "/bookings"):
        r = requests.get(f"{API}{path}", headers=staff_tokens["daycare_staff"], timeout=15)
        assert r.status_code != 403, f"daycare_staff wrongly blocked from {path}: {r.status_code} {r.text[:200]}"


def test_front_desk_retains_pos_and_client_access(staff_tokens):
    for path in ("/pos/products", "/clients", "/dogs"):
        r = requests.get(f"{API}{path}", headers=staff_tokens["front_desk"], timeout=15)
        assert r.status_code != 403, f"front_desk wrongly blocked from {path}: {r.status_code} {r.text[:200]}"


# ── 10. Denied write requests leave data unchanged ──────────────────────────

def test_denied_settings_write_does_not_mutate(admin_headers, staff_tokens):
    before = requests.get(f"{API}/settings", headers=admin_headers, timeout=15).json()
    r = requests.put(f"{API}/settings", headers=staff_tokens["front_desk"],
                      json={"business_name": "HACKED BY PYTEST"}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/settings", headers=admin_headers, timeout=15).json()
    assert after.get("business_name") == before.get("business_name"), \
        "settings mutated despite a 403 response"


def test_denied_role_matrix_write_does_not_mutate(admin_headers, staff_tokens):
    before = requests.get(f"{API}/staff/roles", headers=admin_headers, timeout=15).json()
    r = requests.put(f"{API}/staff/roles/front_desk/permissions", headers=staff_tokens["manager"],
                      json={"permissions": {"settings": True}}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/staff/roles", headers=admin_headers, timeout=15).json()
    assert after["matrix"]["front_desk"] == before["matrix"]["front_desk"], \
        "role matrix mutated despite a 403 response"


# ── 11. Permission changes take effect on the next backend request ─────────

def test_permission_change_takes_effect_next_request(admin_headers, staff_tokens):
    """No caching layer should let a revoked permission keep working."""
    r1 = requests.get(f"{API}/admin/stripe-online-payments", headers=staff_tokens["manager"], timeout=15)
    assert r1.status_code == 200

    flip = requests.put(f"{API}/staff/roles/manager/permissions", headers=admin_headers,
                         json={"permissions": {"finance_reports": False}}, timeout=15)
    assert flip.status_code == 200, flip.text
    try:
        r2 = requests.get(f"{API}/admin/stripe-online-payments", headers=staff_tokens["manager"], timeout=15)
        assert r2.status_code == 403, "revoked permission still worked on the very next request"
    finally:
        restore = requests.put(f"{API}/staff/roles/manager/permissions", headers=admin_headers,
                                json={"permissions": {"finance_reports": True}}, timeout=15)
        assert restore.status_code == 200, restore.text


# ── 12. Frontend and backend use matching permission keys ──────────────────

def test_me_permissions_exposes_the_keys_backend_enforces_on(staff_tokens):
    """The frontend can() consumer reads these exact keys from
    /me/permissions — spot-check the new ones this checkpoint added are
    present and correctly resolved for a restricted role."""
    r = requests.get(f"{API}/me/permissions", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 200
    perms = r.json()["permissions"]
    for key in ("manage_receipt_settings", "audit_log", "finance_reports", "settings",
                "pricing", "delete_records"):
        assert key in perms, f"{key} missing from /me/permissions"
        assert perms[key] is False, f"front_desk should not have {key}"


# ── 13. Existing owner workflows still pass (covered by test 1 + full regression) ──

def test_owner_can_write_settings_and_manage_matrix(admin_headers):
    r = requests.get(f"{API}/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    r2 = requests.put(f"{API}/staff/roles/manager/permissions", headers=admin_headers,
                       json={"permissions": {"finance_reports": True}}, timeout=15)
    assert r2.status_code == 200, r2.text


# ── 14. Existing client portal workflows still pass ─────────────────────────

def test_client_portal_untouched_by_staff_gates(client_headers):
    """A real client account must never be treated as staff, and must never
    be blocked by any of the new require_admin_and_permission/require_owner
    gates on endpoints it's not supposed to reach anyway — but its own
    portal endpoints must keep working exactly as before."""
    r = requests.get(f"{API}/auth/me", headers=client_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["role"] == "client"
    r2 = requests.get(f"{API}/me/permissions", headers=client_headers, timeout=15)
    assert r2.status_code == 200
    r3 = requests.get(f"{API}/portal/invoices", headers=client_headers, timeout=15)
    assert r3.status_code == 200, r3.text


def test_client_cannot_reach_staff_only_endpoints(client_headers):
    for path in ("/staff/roles", "/settings", "/admin/employees", "/admin/stripe-online-payments"):
        r = requests.get(f"{API}{path}", headers=client_headers, timeout=15)
        assert r.status_code == 403, f"client got past {path}: {r.status_code}"


# ── unauthenticated ──────────────────────────────────────────────────────

def test_unauthenticated_request_rejected():
    for path in ("/staff/roles", "/settings", "/admin/stripe-online-payments", "/audit-log"):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code in (401, 403), f"{path} allowed an unauthenticated request: {r.status_code}"
