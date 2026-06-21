"""Sprint 110an — Add-on services attachable at booking, check-in, and
check-out. Each add-on is a service flagged `is_addon=True` with a
service-type allowlist (`addon_for`)."""
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
def test_dog(admin_headers):
    """Re-uses an existing dog from the live DB whose owner is a real client."""
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    valid_owner_ids = {c["id"] for c in clients}
    candidate = next(
        (d for d in dogs
         if d.get("owner_id") in valid_owner_ids
         and (d.get("vaccines") or {}).get("rabies")),
        None,
    )
    assert candidate is not None, "no dog with valid owner + rabies vaccine"
    return candidate


@pytest.fixture
def addon_service(admin_headers):
    """Throwaway add-on service eligible for daycare + training."""
    r = requests.post(
        f"{BASE}/api/services",
        json={
            "name": f"Nail Trim {uuid.uuid4().hex[:6]}",
            "service_type": "grooming",
            "base_price": 15.0,
            "active": True,
            "is_addon": True,
            "addon_for": ["daycare", "training"],
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    svc = r.json()
    yield svc
    requests.delete(f"{BASE}/api/services/{svc['id']}", headers=admin_headers, timeout=15)


def test_service_supports_is_addon_and_addon_for(admin_headers, addon_service):
    """Service catalog round-trips the new flags."""
    listing = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
    ours = next((s for s in listing if s["id"] == addon_service["id"]), None)
    assert ours is not None
    assert ours["is_addon"] is True
    assert set(ours["addon_for"]) == {"daycare", "training"}


def test_eligible_addons_endpoint_filters_by_service_type(admin_headers, addon_service):
    # Daycare: should include our add-on
    r = requests.get(
        f"{BASE}/api/services/addons",
        params={"for": "daycare"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert addon_service["id"] in ids

    # Boarding: should NOT include it
    r2 = requests.get(
        f"{BASE}/api/services/addons",
        params={"for": "boarding"},
        headers=admin_headers, timeout=15,
    )
    assert addon_service["id"] not in [a["id"] for a in r2.json()]


def test_addons_excluded_from_main_services_when_listing_for_booking(admin_headers, addon_service):
    """Public catalog must exclude add-ons so the client portal doesn't
    show "Nail Trim" as a top-level bookable service."""
    r = requests.get(f"{BASE}/api/public/services", timeout=15)
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert addon_service["id"] not in ids


def test_booking_create_snapshots_addons(admin_headers, test_dog, addon_service):
    """A booking with addon_service_ids stores priced snapshots."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={
            "dog_id": test_dog["id"],
            "date": tomorrow,
            "service_type": "daycare",
            "addon_service_ids": [addon_service["id"]],
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    booking = r.json()
    try:
        assert booking.get("add_ons"), "add_ons not snapshotted on booking"
        first = booking["add_ons"][0]
        assert first["service_id"] == addon_service["id"]
        assert first["price"] == 15.0
        assert first["list_price"] == 15.0
        assert first.get("added_at"), "added_at timestamp missing"
    finally:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)


def test_booking_create_rejects_ineligible_addon(admin_headers, test_dog, addon_service):
    """An add-on flagged for daycare/training can't attach to a boarding booking."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={
            "dog_id": test_dog["id"],
            "date": tomorrow,
            "end_date": (date.today() + timedelta(days=2)).isoformat(),
            "service_type": "boarding",
            "addon_service_ids": [addon_service["id"]],
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 400
    assert "isn't eligible" in r.json()["detail"].lower() or "not eligible" in r.json()["detail"].lower()


def test_booking_create_rejects_non_addon_service(admin_headers, test_dog):
    """A regular service (is_addon=False) can't be attached as an add-on."""
    listing = requests.get(f"{BASE}/api/services", headers=admin_headers, timeout=15).json()
    plain = next((s for s in listing if not s.get("is_addon") and s.get("active")), None)
    assert plain is not None, "need at least one normal active service to test"
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={
            "dog_id": test_dog["id"],
            "date": tomorrow,
            "service_type": "daycare",
            "addon_service_ids": [plain["id"]],
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 400
    assert "not flagged as an add-on" in r.json()["detail"].lower()


def test_attach_addon_endpoint_appends(admin_headers, test_dog, addon_service):
    """POST /bookings/{id}/add-ons appends without overwriting prior add-ons."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={
            "dog_id": test_dog["id"],
            "date": tomorrow,
            "service_type": "daycare",
            "addon_service_ids": [addon_service["id"]],
        },
        headers=admin_headers, timeout=15,
    )
    booking = r.json()
    try:
        # Attach the same add-on again — should now have 2 entries
        r2 = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/add-ons",
            json={"addon_service_ids": [addon_service["id"]]},
            headers=admin_headers, timeout=15,
        )
        assert r2.status_code == 200
        assert len(r2.json()["add_ons"]) == 2
        # Then remove one
        r3 = requests.delete(
            f"{BASE}/api/bookings/{booking['id']}/add-ons/0",
            headers=admin_headers, timeout=15,
        )
        assert r3.status_code == 200
        assert len(r3.json()["add_ons"]) == 1
    finally:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)


def test_addon_honors_legacy_pricing_override(admin_headers, test_dog, addon_service):
    """A grandfathered client should get their locked add-on rate at booking
    time, not the catalog price."""
    # Drop an override for THIS dog's owner on THIS add-on
    cid = test_dog["owner_id"]
    requests.post(
        f"{BASE}/api/clients/{cid}/price-overrides",
        json={"target_kind": "service", "target_code": addon_service["id"],
              "override_price": 10.0, "note": "grandfathered add-on"},
        headers=admin_headers, timeout=15,
    )
    try:
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        r = requests.post(
            f"{BASE}/api/bookings",
            json={
                "dog_id": test_dog["id"],
                "date": tomorrow,
                "service_type": "daycare",
                "addon_service_ids": [addon_service["id"]],
            },
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        booking = r.json()
        try:
            ao = booking["add_ons"][0]
            assert ao["price"] == 10.0, f"override not applied · got ${ao['price']}"
            assert ao["list_price"] == 15.0
            assert ao["price_override_id"]
        finally:
            requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
    finally:
        # Clean up override
        listing = requests.get(f"{BASE}/api/clients/{cid}/price-overrides", headers=admin_headers, timeout=15).json()
        for row in listing.get("overrides", []):
            if row["target_code"] == addon_service["id"]:
                requests.delete(f"{BASE}/api/price-overrides/{row['id']}", headers=admin_headers, timeout=15)


def test_check_in_can_attach_addons(admin_headers, test_dog, addon_service):
    """Admin Quick Check-in can attach an add-on as part of the same call."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE}/api/bookings",
        json={
            "dog_id": test_dog["id"],
            "date": tomorrow,
            "service_type": "daycare",
        },
        headers=admin_headers, timeout=15,
    )
    booking = r.json()
    try:
        # Approve so it can be checked in
        requests.post(
            f"{BASE}/api/bookings/{booking['id']}/approve",
            headers=admin_headers, timeout=15,
        )
        r2 = requests.post(
            f"{BASE}/api/bookings/{booking['id']}/check-in",
            json={"addon_service_ids": [addon_service["id"]]},
            headers=admin_headers, timeout=15,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["add_ons"]
        assert r2.json()["add_ons"][0]["service_id"] == addon_service["id"]
    finally:
        requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
