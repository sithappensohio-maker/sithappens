"""Sprint 110am — Per-client legacy pricing overrides.

Admins can lock individual clients to OLD prices (with an optional expiry)
when raising the public rate. The override applies to both services
(booking checkouts) and credit packs (sell-pack endpoint)."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


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
    # force=true: several tests in this file deliberately leave an active
    # override attached to this throwaway service — the new deletion-
    # protection guard would otherwise 409 here and leak test data.
    requests.delete(f"{BASE}/api/services/{svc['id']}", params={"force": "true"}, headers=admin_headers, timeout=15)


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
    # force=true: same reasoning as temp_service's teardown above.
    requests.delete(f"{BASE}/api/credit-packs/{pack['id']}", params={"force": "true"}, headers=admin_headers, timeout=15)


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

    # "Return to standard price" — a soft revoke, never a hard delete. The
    # row stays in the collection with full audit history, only its status
    # flips.
    r4 = requests.delete(f"{BASE}/api/price-overrides/{override_id}",
                         json={"reason": "pytest cleanup"}, headers=admin_headers, timeout=15)
    assert r4.status_code == 200
    assert r4.json()["ok"]
    assert r4.json()["revoked"] is True

    all_rows = requests.get(f"{BASE}/api/clients/{cid}/price-overrides?include_expired=true",
                            headers=admin_headers, timeout=15).json()
    revoked_row = next(r for r in all_rows["overrides"] if r["id"] == override_id)
    assert revoked_row["status"] == "revoked"
    assert revoked_row["status_label"] == "Revoked"
    assert revoked_row["active"] is False
    assert revoked_row["revoked_by"]
    assert revoked_row["revocation_reason"] == "pytest cleanup"
    # Never gone from the default (active-only) list either — it's just
    # correctly excluded because it's inactive, same as expired rows are.
    active_only = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()
    assert override_id not in {r["id"] for r in active_only["overrides"]}


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


# ---------------------------------------------------------------------------
# Revocation ("Return to standard price") — soft, audit-preserving, and its
# effect on future vs. historical purchases.
# ---------------------------------------------------------------------------

def test_revoked_credit_pack_override_ignored(admin_headers, temp_client, temp_credit_pack):
    cid = temp_client["id"]
    created = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 250.0},
        headers=admin_headers, timeout=15,
    ).json()
    revoked = requests.delete(f"{BASE}/api/price-overrides/{created['id']}", headers=admin_headers, timeout=15)
    assert revoked.status_code == 200

    r = requests.post(
        f"{BASE}/api/clients/{cid}/sell-pack",
        json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["price_paid"] == 300.0  # standard price, revoked override ignored


def test_revoking_override_returns_future_purchases_to_standard_price(admin_headers, temp_client, temp_credit_pack):
    """The exact scenario the feature exists for: an admin returns a client
    to standard pricing, and their VERY NEXT purchase reflects it
    immediately — no lingering grandfathered rate."""
    cid = temp_client["id"]
    created = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 200.0},
        headers=admin_headers, timeout=15,
    ).json()
    # Confirm the override applies before revoking.
    before = requests.post(f"{BASE}/api/clients/{cid}/sell-pack",
                           json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
                           headers=admin_headers, timeout=15).json()
    assert before["price_paid"] == 200.0

    requests.delete(f"{BASE}/api/price-overrides/{created['id']}", headers=admin_headers, timeout=15)

    after = requests.post(f"{BASE}/api/clients/{cid}/sell-pack",
                          json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
                          headers=admin_headers, timeout=15).json()
    assert after["price_paid"] == 300.0  # immediately back to standard


def test_revoking_override_does_not_alter_historical_purchases(admin_headers, temp_client, temp_credit_pack):
    """Revoking a client's override must never rewrite a credit lot (or any
    other historical financial record) that already used the old price."""
    cid = temp_client["id"]
    created = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 200.0},
        headers=admin_headers, timeout=15,
    ).json()
    lot = requests.post(f"{BASE}/api/clients/{cid}/sell-pack",
                        json={"pack_id": temp_credit_pack["id"], "payment_method": "cash"},
                        headers=admin_headers, timeout=15).json()
    assert lot["price_paid"] == 200.0
    lot_id = lot["id"]

    requests.delete(f"{BASE}/api/price-overrides/{created['id']}", headers=admin_headers, timeout=15)

    fresh_lot = requests.get(f"{BASE}/api/clients/{cid}/credit-lots", headers=admin_headers, timeout=15).json()
    ours = next(l for l in fresh_lot if l["id"] == lot_id)
    assert ours["price_paid"] == 200.0  # unchanged by the later revocation
    assert ours["list_price"] == 300.0


def test_editing_revoked_override_is_rejected(admin_headers, temp_client, temp_credit_pack):
    """A revoked override is terminal — PUT must reject editing it rather
    than silently resurrecting it in place (which would erase why it was
    revoked)."""
    cid = temp_client["id"]
    created = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 200.0},
        headers=admin_headers, timeout=15,
    ).json()
    requests.delete(f"{BASE}/api/price-overrides/{created['id']}", headers=admin_headers, timeout=15)
    r = requests.put(f"{BASE}/api/price-overrides/{created['id']}", json={"override_price": 210.0},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 409


def test_recreating_after_revoke_preserves_revoked_row_as_history(admin_headers, temp_client, temp_credit_pack):
    """Setting a NEW price after revoking the old one must insert a fresh
    row (new id) rather than resurrecting the revoked one — the revoked
    row's audit trail stays intact as history."""
    cid = temp_client["id"]
    first = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 200.0},
        headers=admin_headers, timeout=15,
    ).json()
    requests.delete(f"{BASE}/api/price-overrides/{first['id']}", headers=admin_headers, timeout=15)

    second = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 220.0},
        headers=admin_headers, timeout=15,
    ).json()
    assert second["id"] != first["id"]

    all_rows = requests.get(f"{BASE}/api/clients/{cid}/price-overrides?include_expired=true",
                            headers=admin_headers, timeout=15).json()["overrides"]
    first_row = next(r for r in all_rows if r["id"] == first["id"])
    second_row = next(r for r in all_rows if r["id"] == second["id"])
    assert first_row["status"] == "revoked"
    assert second_row["status"] == "active"
    assert second_row["override_price"] == 220.0


def test_duplicate_active_override_cannot_be_created(admin_headers, temp_client, temp_credit_pack):
    """The database-level partial unique index must reject a second ACTIVE
    price_overrides row for the same (client, kind, code) even when the API
    layer is bypassed entirely — the real safety net, not just app logic."""
    import asyncio
    import uuid as _uuid
    from motor.motor_asyncio import AsyncIOMotorClient
    from pymongo.errors import DuplicateKeyError

    cid = temp_client["id"]
    created = requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 200.0},
        headers=admin_headers, timeout=15,
    ).json()
    assert created["id"]

    async def _run():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            try:
                await db.price_overrides.insert_one({
                    "id": str(_uuid.uuid4()), "client_id": cid, "target_kind": "credit_pack",
                    "target_code": temp_credit_pack["id"], "override_price": 999.0, "status": "active",
                    "expires_on": None, "note": "", "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                })
                return "inserted"
            except DuplicateKeyError:
                return "rejected"
        finally:
            mc.close()

    result = asyncio.run(_run())
    assert result == "rejected", "the active-unique partial index did not reject a duplicate active override"


def test_service_and_credit_pack_overrides_are_separately_identifiable(admin_headers, temp_client, temp_service, temp_credit_pack):
    """The admin UI splits overrides into a 'Service Prices' section and a
    'Credit-Pack Prices' section — verify the API response gives it exactly
    what it needs to do that split (a target_kind on every row, both kinds
    represented, never mixed into one undifferentiated shape)."""
    cid = temp_client["id"]
    requests.post(f"{BASE}/api/clients/{cid}/price-overrides",
                 json={"target_kind": "service", "target_code": temp_service["id"], "override_price": 20.0},
                 headers=admin_headers, timeout=15)
    requests.post(f"{BASE}/api/clients/{cid}/price-overrides",
                 json={"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 250.0},
                 headers=admin_headers, timeout=15)
    rows = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()["overrides"]
    kinds = {r["target_kind"] for r in rows}
    assert kinds == {"service", "credit_pack"}
    service_rows = [r for r in rows if r["target_kind"] == "service"]
    pack_rows = [r for r in rows if r["target_kind"] == "credit_pack"]
    assert len(service_rows) == 1 and len(pack_rows) == 1


def test_bulk_apply_pricing_set(admin_headers, temp_client, temp_service, temp_credit_pack):
    """'Apply pricing set' — one call sets exact final prices for multiple
    items at once, reusing the same per-item resolver-compatible structure
    (proven by both new rows being independently readable/editable
    afterward, exactly like single-item overrides)."""
    cid = temp_client["id"]
    r = requests.post(f"{BASE}/api/clients/{cid}/price-overrides/bulk-apply", json={
        "entries": [
            {"target_kind": "service", "target_code": temp_service["id"], "override_price": 18.0},
            {"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 275.0},
        ],
    }, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] == 2
    assert body["errors"] == []

    rows = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()["overrides"]
    svc_row = next(x for x in rows if x["target_kind"] == "service")
    pack_row = next(x for x in rows if x["target_kind"] == "credit_pack")
    assert svc_row["override_price"] == 18.0
    assert pack_row["override_price"] == 275.0


def test_bulk_apply_reports_per_entry_errors_without_discarding_the_rest(admin_headers, temp_client, temp_credit_pack):
    r = requests.post(f"{BASE}/api/clients/{temp_client['id']}/price-overrides/bulk-apply", json={
        "entries": [
            {"target_kind": "credit_pack", "target_code": temp_credit_pack["id"], "override_price": 260.0},
            {"target_kind": "credit_pack", "target_code": "does-not-exist", "override_price": 50.0},
        ],
    }, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["target_code"] == "does-not-exist"


def test_deleting_service_with_active_override_requires_force(admin_headers, temp_client):
    """Deleting/deactivating an item with a client-specific price attached
    must warn (409, no mutation) unless force=true is explicitly passed —
    never a silent transfer or a silent loss of override history."""
    code = f"test_svc_force_{uuid.uuid4().hex[:6]}"
    svc = requests.post(f"{BASE}/api/services", json={
        "name": "Force Delete Test Service", "service_type": "daycare", "base_price": 40.0, "active": True,
    }, headers=admin_headers, timeout=15).json()
    try:
        requests.post(f"{BASE}/api/clients/{temp_client['id']}/price-overrides",
                     json={"target_kind": "service", "target_code": svc["id"], "override_price": 30.0},
                     headers=admin_headers, timeout=15)
        blocked = requests.delete(f"{BASE}/api/services/{svc['id']}", headers=admin_headers, timeout=15)
        assert blocked.status_code == 409
        assert "1" in blocked.json()["detail"]
        # Service still exists — nothing was silently deleted.
        still_there = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
        assert any(s["id"] == svc["id"] for s in still_there)
    finally:
        requests.delete(f"{BASE}/api/services/{svc['id']}", params={"force": "true"}, headers=admin_headers, timeout=15)
