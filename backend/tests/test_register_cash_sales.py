"""Regression coverage for cash reaching the physical register drawer.

The register is cash-basis: a payment belongs to the local business date when
money was received, even when the related service happens on another date.
"""
import os
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

BASE = os.environ.get("TEST_BACKEND_URL", os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _register(day, headers):
    r = requests.get(f"{API}/admin/register/day", params={"date": day}, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_manual_cash_sale_increases_expected_drawer(admin_headers):
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    before = _register(today, admin_headers)
    amount = 12.34
    tag = uuid.uuid4().hex[:8]

    sale = requests.post(
        f"{API}/retail-sales",
        headers=admin_headers,
        json={
            "date": today,
            "description": f"Cash drawer regression {tag}",
            "amount": amount,
            "quantity": 1,
            "unit_price": amount,
            "category": "Test",
            "payment_method": "cash",
        },
        timeout=15,
    )
    assert sale.status_code == 200, sale.text
    sale_id = sale.json()["id"]
    try:
        after = _register(today, admin_headers)
        assert round(float(after["totals"]["cash_in"]) - float(before["totals"]["cash_in"]), 2) == amount
        assert round(float(after["totals"]["expected_cash"]) - float(before["totals"]["expected_cash"]), 2) == amount
    finally:
        requests.delete(f"{API}/retail-sales/{sale_id}", headers=admin_headers, timeout=15)


def test_future_service_paid_cash_hits_today_not_service_date(admin_headers):
    local_today = datetime.now(ZoneInfo("America/New_York")).date()
    today = local_today.isoformat()
    service_day = (local_today + timedelta(days=10)).isoformat()
    amount = 31.25
    tag = uuid.uuid4().hex[:8]

    services_r = requests.get(f"{API}/services", headers=admin_headers, timeout=15)
    assert services_r.status_code == 200, services_r.text
    service = next((s for s in services_r.json() if s.get("active", True) and not s.get("is_addon")), None)
    if not service:
        pytest.skip("No active base service is available")

    client_r = requests.post(
        f"{API}/clients",
        headers=admin_headers,
        json={"name": f"Drawer Test {tag}", "email": f"drawer-{tag}@example.com"},
        timeout=15,
    )
    assert client_r.status_code == 200, client_r.text
    client = client_r.json()
    dog_r = requests.post(
        f"{API}/dogs",
        headers=admin_headers,
        json={
            "name": f"CashDog {tag}",
            "owner_id": client["id"],
            "breed": "Mix",
            "age_y": 3,
            "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
        },
        timeout=15,
    )
    assert dog_r.status_code == 200, dog_r.text
    dog = dog_r.json()

    today_before = _register(today, admin_headers)
    future_before = _register(service_day, admin_headers)
    txn_id = None
    try:
        txn_r = requests.post(
            f"{API}/transactions",
            headers=admin_headers,
            json={
                "dog_id": dog["id"],
                "service_id": service["id"],
                "date": service_day,
                "actual_price": amount,
                "status": "completed",
                "payment_status": "paid",
                "payment_method": "cash",
            },
            timeout=15,
        )
        assert txn_r.status_code == 200, txn_r.text
        txn_id = txn_r.json()["id"]

        today_after = _register(today, admin_headers)
        future_after = _register(service_day, admin_headers)
        assert round(float(today_after["totals"]["cash_in"]) - float(today_before["totals"]["cash_in"]), 2) == amount
        assert round(float(today_after["totals"]["expected_cash"]) - float(today_before["totals"]["expected_cash"]), 2) == amount
        assert round(float(future_after["totals"]["cash_in"]) - float(future_before["totals"]["cash_in"]), 2) == 0
    finally:
        if txn_id:
            requests.delete(f"{API}/transactions/{txn_id}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_credit_checkout_cash_addon_hits_cash_drawer(admin_headers):
    """A credit redemption is not new revenue, but any cash add-on paid at the
    same checkout must still increase the physical drawer under Cash."""
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    packs_r = requests.get(f"{API}/credit-packs", headers=admin_headers, timeout=15)
    assert packs_r.status_code == 200, packs_r.text
    pack = next((p for p in packs_r.json() if p.get("active", True) and p.get("service_type") == "daycare"), None)
    if not pack:
        pytest.skip("No active daycare credit pack is available")

    tag = uuid.uuid4().hex[:8]
    client_r = requests.post(
        f"{API}/clients",
        headers=admin_headers,
        json={"name": f"Mixed Tender {tag}", "email": f"mixed-{tag}@example.com"},
        timeout=15,
    )
    assert client_r.status_code == 200, client_r.text
    client = client_r.json()
    dog_r = requests.post(
        f"{API}/dogs",
        headers=admin_headers,
        json={
            "name": f"MixedDog {tag}",
            "owner_id": client["id"],
            "breed": "Mix",
            "age_y": 2,
            "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"},
        },
        timeout=15,
    )
    assert dog_r.status_code == 200, dog_r.text
    dog = dog_r.json()
    booking_id = None
    try:
        sell_r = requests.post(
            f"{API}/clients/{client['id']}/sell-pack",
            headers=admin_headers,
            json={"pack_id": pack["id"], "payment_method": "clover"},
            timeout=15,
        )
        assert sell_r.status_code == 200, sell_r.text

        booking_r = requests.post(
            f"{API}/bookings",
            headers=admin_headers,
            json={
                "dog_id": dog["id"],
                "date": today,
                "service_type": "daycare",
                "override_capacity": True,
                "override_vaccines": True,
            },
            timeout=15,
        )
        assert booking_r.status_code == 200, booking_r.text
        booking_id = booking_r.json()["id"]
        assert requests.post(f"{API}/bookings/{booking_id}/approve", headers=admin_headers, timeout=15).status_code == 200
        assert requests.post(f"{API}/bookings/{booking_id}/check-in", headers=admin_headers, timeout=15).status_code == 200

        before = _register(today, admin_headers)
        addon_cash = 7.50
        checkout_r = requests.post(
            f"{API}/bookings/{booking_id}/check-out",
            headers=admin_headers,
            json={
                "use_credits": True,
                "payment_method": "cash",
                "payment_status": "paid",
                "amount_paid": addon_cash,
                "add_ons": [{"service_id": f"test-addon-{tag}", "name": "Cash add-on", "price": addon_cash, "qty": 1}],
            },
            timeout=15,
        )
        assert checkout_r.status_code == 200, checkout_r.text
        checked_out = checkout_r.json()
        assert checked_out.get("payment_method") == "credits"
        assert checked_out.get("cash_payment_method") == "cash"
        assert round(float(checked_out.get("cash_revenue") or 0), 2) == addon_cash

        after = _register(today, admin_headers)
        assert round(float(after["totals"]["cash_in"]) - float(before["totals"]["cash_in"]), 2) == addon_cash
        assert round(float(after["totals"]["expected_cash"]) - float(before["totals"]["expected_cash"]), 2) == addon_cash
    finally:
        if booking_id:
            requests.delete(f"{API}/bookings/{booking_id}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/clients/{client['id']}", headers=admin_headers, timeout=15)
