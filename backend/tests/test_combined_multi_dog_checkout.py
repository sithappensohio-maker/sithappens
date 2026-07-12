"""Regression coverage for one-click household checkout.

Two dogs belonging to the same owner and booked for the same daycare/boarding
visit must close together, preserve the additional-dog discount, and share one
combined checkout receipt id/total.
"""
import datetime
import os
import uuid

import pytest
import requests

BASE = os.environ.get("TEST_BACKEND_URL", os.environ.get("API_URL", "http://localhost:8001")).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_same_owner_same_service_checks_out_as_one_ticket(admin_headers):
    tag = uuid.uuid4().hex[:8]
    visit_day = datetime.date.today().isoformat()
    client = requests.post(
        f"{BASE}/api/clients",
        headers=admin_headers,
        json={"name": f"Household Checkout {tag}", "email": f"household-{tag}@example.com"},
        timeout=15,
    ).json()
    dogs = []
    bookings = []
    try:
        for name in (f"First-{tag}", f"Second-{tag}"):
            r = requests.post(
                f"{BASE}/api/dogs",
                headers=admin_headers,
                json={
                    "name": name,
                    "owner_id": client["id"],
                    "breed": "Mix",
                    "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
                },
                timeout=15,
            )
            assert r.status_code == 200, r.text
            dogs.append(r.json())

        r = requests.post(
            f"{BASE}/api/bookings/group",
            headers=admin_headers,
            json={
                "dogs": [{"dog_id": d["id"]} for d in dogs],
                "date": visit_day,
                "service_type": "daycare",
                "override_vaccines": True,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        bookings = r.json()["bookings"]
        for booking in bookings:
            requests.post(f"{BASE}/api/bookings/{booking['id']}/approve", headers=admin_headers, timeout=15)

        preview = requests.get(
            f"{BASE}/api/bookings/{bookings[1]['id']}/checkout-group-preview",
            headers=admin_headers,
            timeout=15,
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 2
        assert preview.json()["is_group_checkout"] is True

        # Empty body deliberately exercises the no-cash/unpaid fallback, so
        # the test does not depend on whether today's physical register is open.
        out = requests.post(
            f"{BASE}/api/bookings/{bookings[1]['id']}/check-out-group",
            headers=admin_headers,
            json={},
            timeout=30,
        )
        assert out.status_code == 200, out.text
        payload = out.json()
        assert payload["count"] == 2
        assert payload["checkout_group_id"]
        assert round(payload["total"], 2) == round(sum(float(b.get("actual_price") or 0) for b in payload["bookings"]), 2)
        assert all(b["status"] == "completed" for b in payload["bookings"])
        assert {b.get("checkout_group_id") for b in payload["bookings"]} == {payload["checkout_group_id"]}
        assert {b.get("checkout_group_total") for b in payload["bookings"]} == {payload["total"]}
        assert any((b.get("multi_dog_discount") or {}).get("pre_applied") for b in payload["bookings"])
    finally:
        for booking in bookings:
            requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)
        for dog in dogs:
            requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
