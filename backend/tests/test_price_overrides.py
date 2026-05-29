"""Sprint 110am — Per-client legacy pricing overrides.

Admins can lock individual clients to OLD prices (with an optional expiry)
when raising the public rate. The override applies to both services
(booking checkouts) and credit packs (sell-pack endpoint)."""
import os
import uuid
from datetime import date, timedelta

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


@pytest.fixture
def temp_client(admin_headers):
    """A throwaway client we can attach overrides to."""
    name = f"OverrideTest {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE}/api/clients",
        json={"name": name, "email": f"{uuid.uuid4().hex[:8]}@test.local", "phone": "555-0100"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    client = r.json()
    yield client
    requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


@pytest.fixture
def temp_service(admin_headers):
    code = f"test_svc_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE}/api/services",
        json={"name": "Test Daycare", "service_type": "daycare",
              "base_price": 35.0, "active": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    svc = r.json()
    yield svc
    requests.delete(f"{BASE}/api/services/{svc['id']}", headers=admin_headers, timeout=15)


@pytest.fixture
def temp_credit_pack(admin_headers):
    r = requests.post(
        f"{BASE}/api/credit-packs",
        json={"name": f"Test Pack {uuid.uuid4().hex[:6]}",
              "qty": 10, "price": 300.0, "service_type": "daycare", "active": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    pack = r.json()
    yield pack
    requests.delete(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, timeout=15)


def test_override_crud_round_trip(admin_headers, temp_client, temp_service):
    cid = temp_client["id"]
    code = temp_service["id"]
    future = (date.today() + timedelta(days=180)).isoformat()

    # Create
    r = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "service", "target_code": code,
              "override_price": 30.0, "expires_on": future, "note": "Loyal since 2024"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["override_price"] == 30.0
    assert created["expires_on"] == future
    override_id = created["id"]

    # List shows it as active with enriched fields
    listing = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()
    assert listing["overrides"]
    ours = listing["overrides"][0]
    assert ours["active"] is True
    assert ours["target_name"] == "Test Daycare"
    assert ours["list_price"] == 35.0
    assert ours["savings"] == 5.0

    # PATCH the price + extend the expiry
    new_expiry = (date.today() + timedelta(days=365)).isoformat()
    r2 = requests.put(
        f"{BASE}/api/price-overrides/{override_id}",
        json={"override_price": 28.0, "expires_on": new_expiry},
        headers=admin_headers, timeout=15,
    )
    assert r2.status_code == 200
    assert r2.json()["override_price"] == 28.0
    assert r2.json()["expires_on"] == new_expiry

    # Clear the expiry (forever)
    r3 = requests.put(
        f"{BASE}/api/price-overrides/{override_id}",
        json={"expires_on": ""},
        headers=admin_headers, timeout=15,
    )
    assert r3.status_code == 200
    # API may report null or omit; either way the override stays active forever
    assert r3.json().get("expires_on") in (None, "")

    # Delete
    r4 = requests.delete(f"{BASE}/api/price-overrides/{override_id}", headers=admin_headers, timeout=15)
    assert r4.status_code == 200
    assert r4.json()["ok"]


def test_override_upserts_one_per_client_target(admin_headers, temp_client, temp_service):
    """POSTing twice for the same (client, kind, code) should upsert,
    not create duplicate rows."""
    cid = temp_client["id"]
    code = temp_service["id"]
    payload = {"target_kind": "service", "target_code": code, "override_price": 30.0}
    requests.post(f"{BASE}/api/clients/{cid}/price-overrides", json=payload, headers=admin_headers, timeout=15)
    requests.post(f"{BASE}/api/clients/{cid}/price-overrides",
                  json={**payload, "override_price": 25.0}, headers=admin_headers, timeout=15)
    listing = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()
    assert len(listing["overrides"]) == 1
    assert listing["overrides"][0]["override_price"] == 25.0


def test_expired_override_is_hidden_by_default(admin_headers, temp_client, temp_service):
    cid = temp_client["id"]
    code = temp_service["id"]
    past = (date.today() - timedelta(days=2)).isoformat()
    requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "service", "target_code": code,
              "override_price": 30.0, "expires_on": past},
        headers=admin_headers, timeout=15,
    )
    # Default list filters out expired
    active = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()
    assert active["overrides"] == []
    # include_expired=true surfaces it for the UI's "history" view
    all_rows = requests.get(
        f"{BASE}/api/clients/{cid}/price-overrides?include_expired=true",
        headers=admin_headers, timeout=15,
    ).json()
    assert len(all_rows["overrides"]) == 1
    assert all_rows["overrides"][0]["active"] is False


def test_override_validates_target_exists(admin_headers, temp_client):
    r = requests.post(
        f"{BASE}/api/clients/{temp_client['id']}/price-overrides",
        json={"target_kind": "service", "target_code": "does-not-exist", "override_price": 99.0},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 404


def test_override_rejects_bad_date(admin_headers, temp_client, temp_service):
    r = requests.post(
        f"{BASE}/api/clients/{temp_client['id']}/price-overrides",
        json={"target_kind": "service", "target_code": temp_service["id"],
              "override_price": 30.0, "expires_on": "next monday"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 422


def test_credit_pack_sale_uses_override_price(admin_headers, temp_client, temp_credit_pack):
    """Selling a grandfathered client a credit pack must use their locked rate,
    not the current catalog price."""
    cid = temp_client["id"]
    pack_id = temp_credit_pack["id"]
    # Pack public price = $300, override to $250
    requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": pack_id,
              "override_price": 250.0, "note": "grandfathered"},
        headers=admin_headers, timeout=15,
    )
    r = requests.post(
        f"{BASE}/api/clients/{cid}/sell-pack",
        json={"pack_id": pack_id, "payment_method": "cash"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    lot = r.json()
    assert lot["price_paid"] == 250.0, f"override didn't apply · paid {lot['price_paid']}"
    assert lot["list_price"] == 300.0
    assert lot["price_override_id"]
    # Per-credit value reflects the locked price (10 credits @ $25)
    assert lot["value_each"] == 25.0


def test_credit_pack_sale_no_override_uses_list_price(admin_headers, temp_client, temp_credit_pack):
    """Sanity check — clients without an override pay catalog price."""
    r = requests.post(
        f"{BASE}/api/clients/{temp_client['id']}/sell-pack",
        json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    lot = r.json()
    assert lot["price_paid"] == 300.0
    assert lot["list_price"] == 300.0
    assert lot.get("price_override_id") in (None, "")


def test_expired_credit_pack_override_ignored(admin_headers, temp_client, temp_credit_pack):
    """Once expires_on passes, the override stops applying."""
    cid = temp_client["id"]
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"],
              "override_price": 250.0, "expires_on": yesterday},
        headers=admin_headers, timeout=15,
    )
    r = requests.post(
        f"{BASE}/api/clients/{cid}/sell-pack",
        json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["price_paid"] == 300.0  # catalog price, override ignored
