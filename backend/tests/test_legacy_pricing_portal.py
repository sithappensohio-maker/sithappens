"""Sprint 110bv — Client portal must show the locked-in legacy price, not the
new catalog price, when a `price_overrides` row is active for that client.

Bug report: 'clients with legacy pricing are seeing the new prices'.
Root cause: GET /services and GET /credit-packs returned raw catalog rows
without consulting price_overrides. resolve_client_price() was honoured only
at booking-create time, so the portal showed wrong numbers up-front.
"""
import os
import uuid
import asyncio
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def fixtures(admin_headers):
    """Spin up a test client with a portal login + grant a $15 daycare override.

    Yields the fixture dict; cleans up everything (client, user, override) on tear-down.
    """
    suffix = uuid.uuid4().hex[:6]
    email = f"pytest-legacy-{suffix}@sithappens.com"

    # 1. Create client + portal account
    c = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Legacy Pricing Pytest {suffix}",
        "email": email,
        "phone": "555-0100",
    }, timeout=15).json()
    cid = c["id"]

    pa = requests.post(f"{API}/clients/{cid}/portal-account", headers=admin_headers,
                       json={"email": email, "password": "pytest-pw-12"}, timeout=15).json()
    user_id = pa.get("id")

    # 2. Find an active daycare service
    svcs = requests.get(f"{API}/services", headers=admin_headers, timeout=15).json()
    daycare = next((s for s in svcs if s.get("service_type") == "daycare"
                    and not s.get("is_addon") and s.get("active")), None)
    if not daycare:
        pytest.skip("No active daycare service in catalog")

    # Find an active credit pack
    packs = requests.get(f"{API}/credit-packs", headers=admin_headers, timeout=15).json()
    pack = next((p for p in packs if p.get("active")), None)
    if not pack:
        pytest.skip("No active credit pack in catalog")

    # 3. Grant a generous $15 legacy override on the daycare service
    LEGACY_DAYCARE = 15.0
    LEGACY_PACK = 99.99
    ovr_svc = requests.post(f"{API}/clients/{cid}/price-overrides",
                            headers=admin_headers, json={
                                "target_kind": "service",
                                "target_code": daycare["id"],
                                "override_price": LEGACY_DAYCARE,
                                "reason": "pytest grandfathered rate",
                            }, timeout=15).json()
    ovr_pack = requests.post(f"{API}/clients/{cid}/price-overrides",
                             headers=admin_headers, json={
                                 "target_kind": "credit_pack",
                                 "target_code": pack["id"],
                                 "override_price": LEGACY_PACK,
                                 "reason": "pytest grandfathered pack",
                             }, timeout=15).json()

    # 4. Log in as the client
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": "pytest-pw-12"}, timeout=15)
    client_headers = {"Authorization": f"Bearer {r.json()['token']}"}

    yield {
        "client_id": cid,
        "user_id": user_id,
        "email": email,
        "daycare_id": daycare["id"],
        "daycare_catalog_price": float(daycare.get("base_price") or 0),
        "legacy_daycare_price": LEGACY_DAYCARE,
        "pack_id": pack["id"],
        "pack_catalog_price": float(pack.get("price") or 0),
        "legacy_pack_price": LEGACY_PACK,
        "client_headers": client_headers,
    }

    # Cleanup
    try:
        requests.delete(f"{API}/clients/{cid}/price-overrides/{ovr_svc['id']}",
                        headers=admin_headers, timeout=15)
        requests.delete(f"{API}/clients/{cid}/price-overrides/{ovr_pack['id']}",
                        headers=admin_headers, timeout=15)
    except Exception:
        pass
    try:
        # Hard-delete via Mongo since /clients/:id doesn't hard-delete
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv('/app/backend/.env')

        async def _wipe():
            mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
            db = mc[os.environ['DB_NAME']]
            await db.clients.delete_one({"id": cid})
            await db.users.delete_many({"email": email})
            await db.price_overrides.delete_many({"client_id": cid})
            mc.close()
        asyncio.run(_wipe())
    except Exception:
        pass


def test_services_show_legacy_price_to_grandfathered_client(fixtures):
    r = requests.get(f"{API}/services", headers=fixtures["client_headers"], timeout=15)
    assert r.status_code == 200
    rows = r.json()
    daycare = next((s for s in rows if s["id"] == fixtures["daycare_id"]), None)
    assert daycare is not None, "Daycare service should appear in client's catalog"
    # base_price MUST be rewritten to the legacy locked-in rate
    assert daycare["base_price"] == fixtures["legacy_daycare_price"]
    assert daycare.get("has_legacy_override") is True
    assert daycare.get("legacy_price") == fixtures["daycare_catalog_price"]


def test_credit_packs_show_legacy_price_to_grandfathered_client(fixtures):
    r = requests.get(f"{API}/credit-packs", headers=fixtures["client_headers"], timeout=15)
    assert r.status_code == 200
    rows = r.json()
    pack = next((p for p in rows if p["id"] == fixtures["pack_id"]), None)
    assert pack is not None, "Credit pack should appear in client's catalog"
    assert pack["price"] == fixtures["legacy_pack_price"]
    assert pack.get("has_legacy_override") is True
    assert pack.get("legacy_price") == fixtures["pack_catalog_price"]
    # value_each must reflect the legacy price, not catalog
    expected_each = round(fixtures["legacy_pack_price"] / max(1, pack.get("qty") or 1), 2)
    assert pack["value_each"] == expected_each


def test_admin_still_sees_catalog_price(fixtures, admin_headers):
    """Admin browsing the catalog must NOT see the override applied — they
    need the real list price for things like the service editor / payroll math."""
    r = requests.get(f"{API}/services", headers=admin_headers, timeout=15)
    rows = r.json()
    daycare = next((s for s in rows if s["id"] == fixtures["daycare_id"]), None)
    assert daycare is not None
    assert daycare["base_price"] == fixtures["daycare_catalog_price"]
    assert daycare.get("has_legacy_override") is None


def test_addons_show_legacy_price(fixtures, admin_headers):
    """Add-on listing endpoint should also honour the override for clients."""
    # Find any addon eligible for daycare
    svcs = requests.get(f"{API}/services?include_inactive=false", headers=admin_headers, timeout=15).json()
    addon = next((s for s in svcs if s.get("is_addon") and "daycare" in (s.get("addon_for") or [])), None)
    if not addon:
        pytest.skip("No daycare add-ons in catalog")
    # Grant an override on it
    LEGACY_ADDON = 1.99
    ovr = requests.post(f"{API}/clients/{fixtures['client_id']}/price-overrides",
                        headers=admin_headers, json={
                            "target_kind": "service",
                            "target_code": addon["id"],
                            "override_price": LEGACY_ADDON,
                        }, timeout=15).json()
    try:
        r = requests.get(f"{API}/services/addons?for=daycare",
                         headers=fixtures["client_headers"], timeout=15)
        assert r.status_code == 200
        rows = r.json()
        target = next((a for a in rows if a["id"] == addon["id"]), None)
        assert target is not None
        assert target["base_price"] == LEGACY_ADDON
        assert target.get("has_legacy_override") is True
    finally:
        requests.delete(f"{API}/clients/{fixtures['client_id']}/price-overrides/{ovr['id']}",
                        headers=admin_headers, timeout=15)


def test_no_override_means_no_change(fixtures, admin_headers):
    """A client with NO override row should see the catalog price as-is."""
    # Find a service that the client has NO override on
    svcs = requests.get(f"{API}/services", headers=fixtures["client_headers"], timeout=15).json()
    no_ovr = next((s for s in svcs if s["id"] != fixtures["daycare_id"]
                   and not s.get("has_legacy_override")), None)
    if no_ovr:
        # The price should be the raw catalog price, no legacy_price field
        assert "legacy_price" not in no_ovr
