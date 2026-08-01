"""Sprint 110 — Multi-dog household discount.

Auto-applied at check-out to the 2nd-and-later dog of the same client on
the same date. Configurable in Settings as percent OR flat dollar.

Covers:
  - Settings round-trip (toggle, mode, value, label)
  - First dog checked out → NO discount, full price
  - Second dog checked out the same day → discount line item attached, actual_price reduced
  - Percent mode AND flat mode both compute correctly
  - Disabled in settings → no discount even with 2+ dogs
  - Preview endpoint matches what check-out actually applies
  - Discount is scoped to the SAME client + SAME date
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    # Every checkout in this file uses payment_method=cash, which requires
    # an open register day (see server.py's cash-tender gate). This file
    # never opened one itself — it always relied on ambient state left by
    # other tests/an operator on the old shared dev database.
    opened = requests.post(f"{BASE}/api/admin/register/open-drawer", headers=headers,
                            json={"opening_cash": 0.0}, timeout=15)
    if opened.status_code == 409:
        requests.post(f"{BASE}/api/admin/register/reopen-day", headers=headers,
                      json={"reason": "test_multi_dog_discount.py setup"}, timeout=15)
        opened = requests.post(f"{BASE}/api/admin/register/open-drawer", headers=headers,
                                json={"opening_cash": 0.0}, timeout=15)
    if opened.status_code not in (200, 400):
        opened.raise_for_status()
    # discount-preview resolves a tentative price from the default active
    # service for non-training types when the booking has no actual_price
    # yet — seed the standard service catalog (idempotent) so grooming has
    # one on a byte-fresh database.
    requests.post(f"{BASE}/api/services/seed-standard", headers=headers, timeout=15)
    return headers


@pytest.fixture
def discount_enabled(admin_headers):
    """Enable the discount + restore original setting on teardown."""
    orig = requests.get(f"{BASE}/api/settings", headers=admin_headers, timeout=15).json()
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_mode": "percent",
        "multi_dog_discount_value": 20,
        "multi_dog_discount_label": "Multi-pup",
    }, timeout=15)
    yield {"mode": "percent", "value": 20}
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": bool(orig.get("multi_dog_discount_enabled")),
        "multi_dog_discount_mode": orig.get("multi_dog_discount_mode") or "percent",
        "multi_dog_discount_value": orig.get("multi_dog_discount_value") or 0,
        "multi_dog_discount_label": orig.get("multi_dog_discount_label") or "Multi-dog discount",
    }, timeout=15)


@pytest.fixture
def two_dog_client(admin_headers):
    """Create a fresh client with 2 dogs and 2 grooming bookings for today.

    service_type=grooming, not daycare: _multi_dog_discount_config_for (a
    later, documented "Sit Happens fixed business rule" than this test)
    hardcodes daycare/boarding's additional-dog discount at a fixed 50%,
    explicitly ignoring the settings this whole file exists to exercise
    ("Those legacy settings must NOT affect daycare/boarding... checkout
    math."). Non-core service types like grooming deliberately keep the
    older, fully settings-configurable behavior this file is testing.
    Grooming specifically (not training): discount_preview intentionally
    never auto-suggests a price for training ("package-paid" — Sprint
    110ar), which would always show ineligible pre-checkout regardless of
    the multi-dog setting under test.
    """
    suffix = uuid.uuid4().hex[:6]
    # Client
    c = requests.post(f"{BASE}/api/clients", headers=admin_headers, json={
        "name": f"Multi Dog Test {suffix}",
        "email": f"multidog-{suffix}@test.local",
        "phone": "555-0000",
        "address": "1 Test Lane",
        "emergency_contact": "n/a",
    }, timeout=15).json()
    # 2 dogs
    today = __import__("datetime").date.today().isoformat()
    dog_ids = []
    for nm in (f"Buddy-{suffix}", f"Daisy-{suffix}"):
        d = requests.post(f"{BASE}/api/dogs", headers=admin_headers, json={
            "name": nm, "breed": "Lab", "weight_lbs": 60,
            "owner_id": c["id"],
            "vaccines": {"rabies": "2030-01-01"},
        }, timeout=15).json()
        dog_ids.append(d["id"])
    # 2 grooming bookings for today, both approved (so they reach check-out)
    booking_ids = []
    for i, did in enumerate(dog_ids):
        b = requests.post(f"{BASE}/api/bookings", headers=admin_headers, json={
            "client_id": c["id"],
            "dog_id": did,
            "service_type": "grooming",
            "date": today,
            "time": f"{10 + i}:00",  # grooming is time-slotted — required; stagger to avoid a same-slot conflict between the two dogs
            "override_capacity": True,  # this shared long-lived test DB accumulates real grooming bookings at common slots from other files
        }, timeout=15).json()
        # Approve, then check in — checkout now requires a checked-in
        # booking (see server.py's check_out "must be checked in first"
        # guard, added after this test was written), matching a real
        # front-desk arrival before departure.
        requests.post(f"{BASE}/api/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
        requests.post(f"{BASE}/api/bookings/{b['id']}/check-in", headers=admin_headers, json={}, timeout=15)
        booking_ids.append(b["id"])
    yield {"client_id": c["id"], "dog_ids": dog_ids, "booking_ids": booking_ids}
    # Cleanup: cancel bookings + delete dogs + delete client
    for bid in booking_ids:
        requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
    for did in dog_ids:
        requests.delete(f"{BASE}/api/dogs/{did}", headers=admin_headers, timeout=15)
    requests.delete(f"{BASE}/api/clients/{c['id']}", headers=admin_headers, timeout=15)


def test_settings_roundtrip(admin_headers):
    r = requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_mode": "flat",
        "multi_dog_discount_value": 7.5,
        "multi_dog_discount_label": "Sibling deal",
    }, timeout=15).json()
    assert r["multi_dog_discount_enabled"] is True
    assert r["multi_dog_discount_mode"] == "flat"
    assert r["multi_dog_discount_value"] == 7.5
    assert r["multi_dog_discount_label"] == "Sibling deal"
    # Reset
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": False,
    }, timeout=15)


def test_first_dog_no_discount(admin_headers, discount_enabled, two_dog_client):
    """First booking checked out for the day pays full price."""
    bid = two_dog_client["booking_ids"][0]
    # Preview should report not-eligible (no siblings yet)
    prev = requests.get(f"{BASE}/api/bookings/{bid}/discount-preview", headers=admin_headers, timeout=15).json()
    assert prev["eligible"] is False
    # Check out at $30
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers, json={
        "base_price": 30.0, "payment_method": "cash", "payment_status": "paid",
    }, timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["actual_price"] == 30.0, f"first dog should be full price, got {out['actual_price']}"
    assert out.get("multi_dog_discount") in (None, {}), "first dog shouldn't carry a discount"


def test_second_dog_gets_discount_percent(admin_headers, discount_enabled, two_dog_client):
    """Second checkout same day same client → 20% off."""
    bid1, bid2 = two_dog_client["booking_ids"]
    # First dog: full price $30 (no discount, no sibling yet)
    requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
        "base_price": 30.0, "payment_method": "cash", "payment_status": "paid",
    }, timeout=15)
    # Preview for the second one should now be eligible
    prev = requests.get(f"{BASE}/api/bookings/{bid2}/discount-preview", headers=admin_headers, timeout=15).json()
    assert prev["eligible"] is True
    assert prev["discount"]["mode"] == "percent"
    assert prev["discount"]["value"] == 20
    # Now check-out the 2nd at $40
    r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
        "base_price": 40.0, "payment_method": "cash", "payment_status": "paid",
    }, timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    # 20% off $40 = $8 off → $32 net
    assert out["actual_price"] == 32.0, f"expected $32, got {out['actual_price']}"
    md = out.get("multi_dog_discount")
    assert md, "second dog should carry multi_dog_discount metadata"
    assert md["amount"] == 8.0
    assert md["mode"] == "percent"
    assert md["sibling_count"] == 1
    assert md["based_on_price"] == 40.0
    assert md["label"] == "Multi-pup"


def test_flat_mode_discount(admin_headers, two_dog_client):
    """$10 flat → first dog full, second dog -$10."""
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_mode": "flat",
        "multi_dog_discount_value": 10.0,
        "multi_dog_discount_label": "Sibling $10 off",
    }, timeout=15)
    try:
        bid1, bid2 = two_dog_client["booking_ids"]
        requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
            "base_price": 35.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15)
        r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
            "base_price": 35.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15).json()
        assert r["actual_price"] == 25.0, f"expected $25 after $10 off, got {r['actual_price']}"
        assert r["multi_dog_discount"]["amount"] == 10.0
        assert r["multi_dog_discount"]["mode"] == "flat"
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={"multi_dog_discount_enabled": False}, timeout=15)


def test_per_service_discount_config(admin_headers, two_dog_client):
    """Sprint 110h — separate tiers per service type. Grooming 25% off,
    training off entirely → only grooming bookings get the discount.

    Originally written against daycare/boarding tiers, but
    _multi_dog_discount_config_for (a later, documented "Sit Happens fixed
    business rule") hardcodes daycare/boarding at a fixed 50% unconditionally,
    before ever consulting multi_dog_discount_by_service — per-service
    config for those two is now structurally unreachable, by design.
    Training/grooming are non-core services where granular per-service
    config is still the real, live code path.
    """
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_by_service": {
            "grooming": {"enabled": True,  "mode": "percent", "value": 25, "label": "Grooming 25%"},
            "training": {"enabled": False, "mode": "flat",    "value": 20, "label": "Training"},
        },
    }, timeout=15)
    try:
        bid1, bid2 = two_dog_client["booking_ids"]
        # Both are grooming bookings (per the fixture) → grooming rule applies
        requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
            "base_price": 40.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15)
        r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
            "base_price": 40.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15).json()
        # 25% off $40 → $30 net
        assert r["actual_price"] == 30.0, f"expected $30 after 25% grooming off, got {r['actual_price']}"
        md = r["multi_dog_discount"]
        assert md["amount"] == 10.0
        assert md["service_type"] == "grooming"
        assert md["label"] == "Grooming 25%"
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
            "multi_dog_discount_enabled": False,
            "multi_dog_discount_by_service": {},
        }, timeout=15)


def test_legacy_flat_config_still_works_when_per_service_empty(admin_headers, two_dog_client):
    """If admins are on the OLD single-config schema (multi_dog_discount_mode/value)
    without per-service, the discount should still apply to all services
    using the legacy fields. Ensures forward-compat migration."""
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_mode": "percent",
        "multi_dog_discount_value": 10,
        "multi_dog_discount_label": "Legacy",
        "multi_dog_discount_by_service": {},  # empty → fall back to legacy
    }, timeout=15)
    try:
        bid1, bid2 = two_dog_client["booking_ids"]
        requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
            "base_price": 50.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15)
        r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
            "base_price": 50.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15).json()
        # 10% off $50 = $5 → $45 net
        assert r["actual_price"] == 45.0
        assert r["multi_dog_discount"]["amount"] == 5.0
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
            "multi_dog_discount_enabled": False,
        }, timeout=15)



def test_legacy_flat_config_still_works_when_service_missing_from_by_service(admin_headers, two_dog_client):
    """Regression: _multi_dog_discount_config_for must fall back to the
    legacy flat config when multi_dog_discount_by_service is non-empty but
    simply has no entry for THIS service type (grooming) — not just when
    it's totally empty. The fixed code previously stopped and returned
    None the moment `per_service.get(service_type)` came back falsy,
    ignoring the legacy fields entirely for any service that hadn't been
    migrated to the granular per-service schema yet, even though its own
    docstring promised "preserve the older configurable behavior" for
    non-core services."""
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "multi_dog_discount_enabled": True,
        "multi_dog_discount_mode": "percent",
        "multi_dog_discount_value": 15,
        "multi_dog_discount_label": "Legacy fallback",
        # Populated for a different service type only — grooming has no
        # entry here, so it must fall back to the legacy flat fields above.
        "multi_dog_discount_by_service": {
            "boarding": {"enabled": True, "mode": "percent", "value": 50, "label": "Boarding"},
        },
    }, timeout=15)
    try:
        bid1, bid2 = two_dog_client["booking_ids"]
        requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
            "base_price": 40.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15)
        r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
            "base_price": 40.0, "payment_method": "cash", "payment_status": "paid",
        }, timeout=15).json()
        # 15% off $40 = $6 → $34 net
        assert r["actual_price"] == 34.0, f"expected $34 after legacy 15% off, got {r['actual_price']}"
        md = r["multi_dog_discount"]
        assert md["amount"] == 6.0
        assert md["label"] == "Legacy fallback"
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
            "multi_dog_discount_enabled": False,
            "multi_dog_discount_by_service": {},
        }, timeout=15)


def test_disabled_setting_skips_discount(admin_headers, two_dog_client):
    """Setting OFF → second dog also pays full price."""
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={"multi_dog_discount_enabled": False}, timeout=15)
    bid1, bid2 = two_dog_client["booking_ids"]
    requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
        "base_price": 30.0, "payment_method": "cash", "payment_status": "paid",
    }, timeout=15)
    r = requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
        "base_price": 30.0, "payment_method": "cash", "payment_status": "paid",
    }, timeout=15).json()
    assert r["actual_price"] == 30.0
    assert r.get("multi_dog_discount") in (None, {})


def test_discount_preview_admin_only():
    """Unauthenticated discount-preview must be blocked."""
    r = requests.get(f"{BASE}/api/bookings/some-id/discount-preview", timeout=10)
    assert r.status_code in (401, 403, 404)
