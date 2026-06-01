"""Sprint 110ay — Today's P&L must honor each client's grandfathered
(legacy) pricing before checkout, so the forecast revenue reflects what
the client will actually be charged — not the catalog list price.
"""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_today_pnl_uses_legacy_price_before_checkout(admin_headers):
    """Set a client-specific override well above the catalog price, book that
    client today, and confirm the forecast revenue tile reflects the override
    (not the catalog default)."""
    today = date.today().isoformat()
    # Find an active daycare service
    services = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
    services = services if isinstance(services, list) else services.get("items", [])
    daycare = next((s for s in services if s.get("service_type") == "daycare" and s.get("active", True) and not s.get("is_addon")), None)
    assert daycare, "need an active daycare service"
    list_price = float(daycare.get("base_price") or 0)
    override_price = list_price + 99.0  # something obviously different so the test is unambiguous

    # Find a vaccinated dog whose owner is an active client
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    by_client = {c["id"]: c for c in clients}
    dog = next(
        (d for d in dogs
         if d.get("owner_id") in by_client
         and by_client[d["owner_id"]].get("client_status") in (None, "active")
         and (d.get("vaccines") or {}).get("rabies")),
        None,
    )
    assert dog, "need a vaccinated dog of an active client"
    client_id = dog["owner_id"]

    # PnL BEFORE we add the override + booking
    pnl_baseline = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    rev_before = float(pnl_baseline.get("revenue") or 0)

    # Add a price override for this client
    ovr = requests.post(
        f"{BASE}/api/clients/{client_id}/price-overrides",
        json={"target_kind": "service", "target_code": daycare["id"],
              "override_price": override_price, "note": "test legacy"},
        headers=admin_headers, timeout=15,
    )
    assert ovr.status_code == 200, ovr.text
    ovr_id = ovr.json()["id"]
    bid = None
    try:
        # Book today using THIS specific service so the booking is wired to it
        b = requests.post(
            f"{BASE}/api/bookings",
            json={"dog_id": dog["id"], "date": today, "service_type": "daycare",
                  "service_id": daycare["id"],
                  "override_capacity": True, "override_vaccines": True},
            headers=admin_headers, timeout=15,
        )
        assert b.status_code == 200, b.text
        booking = b.json()
        bid = booking["id"]
        requests.post(f"{BASE}/api/bookings/{bid}/approve", headers=admin_headers, timeout=15)
        # P&L AFTER — must rise by approximately the override price, not the list
        pnl_after = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
        rev_after = float(pnl_after.get("revenue") or 0)
        delta = rev_after - rev_before
        # Allow small fuzz for concurrent activity in test DB
        assert abs(delta - override_price) < 1.0, (
            f"P&L delta should be ~{override_price} (legacy price), got {delta:.2f}"
            f"\n— catalog list_price was {list_price}, override was {override_price}"
        )
    finally:
        if bid:
            requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
        requests.delete(
            f"{BASE}/api/clients/{client_id}/price-overrides/{ovr_id}",
            headers=admin_headers, timeout=15,
        )


def test_today_pnl_falls_back_to_catalog_when_no_override(admin_headers):
    """Sanity check: clients without an override should still use the catalog
    price (i.e., we didn't accidentally null out the fallback path)."""
    today = date.today().isoformat()
    services = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
    services = services if isinstance(services, list) else services.get("items", [])
    daycare = next((s for s in services if s.get("service_type") == "daycare" and s.get("active", True) and not s.get("is_addon")), None)
    assert daycare, "need an active daycare service"
    list_price = float(daycare.get("base_price") or 0)
    assert list_price > 0, "test requires a catalog daycare price > 0"

    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    by_client = {c["id"]: c for c in clients}

    # Pick a client with NO price overrides at all
    candidate = None
    for d in dogs:
        cid = d.get("owner_id")
        if not cid or cid not in by_client: continue
        if by_client[cid].get("client_status") not in (None, "active"): continue
        if not (d.get("vaccines") or {}).get("rabies"): continue
        rows = requests.get(f"{BASE}/api/clients/{cid}/price-overrides",
                            headers=admin_headers, timeout=15).json()
        if not rows:
            candidate = d; break
    if not candidate:
        pytest.skip("no client without overrides available")

    pnl_before = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    rev_before = float(pnl_before.get("revenue") or 0)
    bid = None
    try:
        b = requests.post(
            f"{BASE}/api/bookings",
            json={"dog_id": candidate["id"], "date": today, "service_type": "daycare",
                  "service_id": daycare["id"],
                  "override_capacity": True, "override_vaccines": True},
            headers=admin_headers, timeout=15,
        )
        assert b.status_code == 200, b.text
        bid = b.json()["id"]
        requests.post(f"{BASE}/api/bookings/{bid}/approve", headers=admin_headers, timeout=15)
        pnl_after = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
        delta = float(pnl_after.get("revenue") or 0) - rev_before
        assert abs(delta - list_price) < 1.0, (
            f"P&L delta should match catalog list price {list_price}, got {delta:.2f}"
        )
    finally:
        if bid:
            requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
