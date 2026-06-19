"""Sprint 110di-26 — Booking Price Estimate setting.

The estimate itself is computed client-side from the existing services
catalog + the client's existing credit balance — there is intentionally
NO backend pricing endpoint to test (per "do not create a second pricing
system"). What we DO need to lock down is the new admin toggle:

  • `booking_flow_controls.show_price_estimate` is the only new setting
    added in this sprint.
  • Default = True (per spec).
  • Persists round-trip via PUT /settings + GET /settings.
  • Exposed via /api/branding so the unauthenticated/portal surface can
    read it without an extra round-trip.
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")
_MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_show_price_estimate_default_true(admin_headers):
    """Setting defaults to True so new installs show the estimate without
    the operator having to opt in."""
    r = requests.get(f"{BASE}/api/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    bfc = r.json().get("booking_flow_controls", {})
    assert bfc.get("show_price_estimate") is True


def test_show_price_estimate_exposed_via_branding(admin_headers):
    """The portal/login surface reads /api/branding (no auth on first paint)
    so the wizard can gate the estimate render without an extra fetch."""
    # Set to a non-default value, then verify branding mirrors it.
    requests.put(
        f"{BASE}/api/settings",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"booking_flow_controls": {"show_price_estimate": False}},
        timeout=15,
    )
    try:
        r = requests.get(f"{BASE}/api/branding", timeout=15)
        assert r.status_code == 200
        bfc = r.json().get("booking_flow_controls", {})
        assert bfc.get("show_price_estimate") is False
    finally:
        # Always restore the default so other tests aren't poisoned.
        requests.put(
            f"{BASE}/api/settings",
            headers={**admin_headers, "Content-Type": "application/json"},
            json={"booking_flow_controls": {"show_price_estimate": True}},
            timeout=15,
        )


def test_no_new_pricing_endpoint_introduced():
    """Defensive — the spec says 'do not create a second pricing system'.
    There should NOT be any /api/booking/estimate or /api/pricing/* surface.
    The estimate is computed entirely in the React component using the
    existing /api/services + /api/portal/me data."""
    r = requests.get(f"{BASE}/api/booking/estimate", timeout=10)
    # 404 (route doesn't exist) or 405 (method not allowed) both acceptable.
    assert r.status_code in (404, 405), (
        f"Unexpected route /api/booking/estimate exists (status {r.status_code}). "
        "Spec forbids a second pricing system on the backend."
    )
    r2 = requests.get(f"{BASE}/api/pricing/estimate", timeout=10)
    assert r2.status_code in (404, 405)


def test_existing_services_carry_base_price(admin_headers):
    """The estimate component relies on existing `base_price` field on the
    services catalog. Lock that down so a future refactor doesn't quietly
    rename it and turn every estimate into $0."""
    r = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    items = r.json()
    # At least one non-addon service should have a non-zero base_price.
    non_addons = [s for s in items if not s.get("is_addon")]
    assert non_addons, "no base services configured — estimate would be 'unavailable'"
    priced = [s for s in non_addons if (s.get("base_price") or 0) > 0]
    assert priced, "no base service has a non-zero base_price; estimate would always be $0"


def test_additional_dog_rate_field_accepted_when_set(admin_headers):
    """If the admin sets `additional_dog_rate` on a service doc (e.g. via
    direct DB tweak or a future field in the catalog editor), the field
    should round-trip through the API so the estimate component can read
    it. We allow it on the existing model via the catch-all-extras path
    or as a Pydantic-permitted extra — either way, GET should preserve
    the value the operator put in."""
    # Find a service to patch via the existing /services/{id} PUT.
    services = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
    target = next((s for s in services if not s.get("is_addon")), None)
    if not target:
        pytest.skip("no base service to test additional_dog_rate on")
    sid = target["id"]
    original_rate = target.get("additional_dog_rate")
    try:
        # Patch via direct mongo (the field is not in ServiceIn schema today;
        # it's read OPPORTUNISTICALLY by the estimate). This test pins the
        # opportunistic-read contract: the field survives in the DB.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        async def patch():
            db = AsyncIOMotorClient(_MONGO_URL)[_DB_NAME]
            await db.services.update_one({"id": sid}, {"$set": {"additional_dog_rate": 12.34}})
        asyncio.run(patch())
        # Re-fetch via API; the value should come through.
        services2 = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
        again = next(s for s in services2 if s["id"] == sid)
        assert again.get("additional_dog_rate") == 12.34, (
            f"additional_dog_rate not preserved on GET: {again.get('additional_dog_rate')}"
        )
    finally:
        # Roll back to keep the catalog clean for other tests.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        async def restore():
            db = AsyncIOMotorClient(_MONGO_URL)[_DB_NAME]
            if original_rate is None:
                await db.services.update_one({"id": sid}, {"$unset": {"additional_dog_rate": ""}})
            else:
                await db.services.update_one({"id": sid}, {"$set": {"additional_dog_rate": original_rate}})
        asyncio.run(restore())
