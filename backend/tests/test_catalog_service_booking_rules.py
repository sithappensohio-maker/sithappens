"""Exact catalog-service booking rules.

These integration tests pin the service-id rule layer added on top of the
historical category defaults. They require the normal local API test server.
"""
import os
import requests

BASE_URL = (
    os.environ.get("TEST_BACKEND_URL")
    or os.environ.get("API_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")


def _admin_h():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_branding_exposes_exact_service_rule_map():
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    bfc = body["booking_flow_controls"]
    assert isinstance(bfc.get("per_catalog_service"), dict)
    assert "other" in bfc.get("per_service", {})


def test_exact_service_rules_round_trip_and_partial_category_put_preserves_them():
    h = _admin_h()
    settings = requests.get(f"{BASE_URL}/api/settings", headers=h, timeout=15).json()
    original = settings.get("booking_flow_controls") or {}

    services = requests.get(
        f"{BASE_URL}/api/services",
        headers=h,
        params={"include_inactive": True},
        timeout=15,
    ).json()
    base = next(s for s in services if s.get("active") is not False and not s.get("is_addon"))
    service_id = base["id"]

    try:
        updated = {
            **original,
            "per_catalog_service": {
                **(original.get("per_catalog_service") or {}),
                service_id: {
                    "client_booking_enabled": True,
                    "require_approval": False,
                    "instant_book": True,
                    "same_day": True,
                    "min_lead_hours": 2,
                    "max_advance_days": 45,
                },
            },
        }
        r = requests.put(
            f"{BASE_URL}/api/settings",
            headers=h,
            json={"booking_flow_controls": updated},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        exact = r.json()["booking_flow_controls"]["per_catalog_service"][service_id]
        assert exact["min_lead_hours"] == 2
        assert exact["max_advance_days"] == 45
        assert exact["instant_book"] is True

        # Simulate an older UI that only updates a category row. The exact
        # service map must survive instead of being replaced with {}.
        r = requests.put(
            f"{BASE_URL}/api/settings",
            headers=h,
            json={"booking_flow_controls": {"per_service": {base["service_type"]: {"same_day": False}}}},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        after = r.json()["booking_flow_controls"]
        assert service_id in after["per_catalog_service"]
        assert after["per_catalog_service"][service_id]["max_advance_days"] == 45
    finally:
        requests.put(
            f"{BASE_URL}/api/settings",
            headers=h,
            json={"booking_flow_controls": original},
            timeout=15,
        )
