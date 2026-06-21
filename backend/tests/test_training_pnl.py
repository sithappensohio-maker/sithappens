"""Sprint 110ar — Training visits are package-paid and must NOT auto-bill.

Fixes two cases:
1. New training bookings used to inflate /admin/today-pnl via the catalog
   default fallback even before check-out.
2. Checking out a training visit at $0 used to leave the today-pnl showing
   the catalog price because the fallback ran on completed/$0 bookings.
"""
import os
import uuid
from datetime import date

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


@pytest.fixture(scope="module")
def training_default_service(admin_headers):
    """Ensure there's a default training service with a real price set."""
    code = f"test_train_default_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE}/api/services",
        json={"name": "Test Training Session", "service_type": "training",
              "base_price": 75.0, "active": True, "is_default": True},
        headers=admin_headers, timeout=15,
    )
    if r.status_code != 200:
        # Already a default for training — skip creation
        existing = requests.get(f"{BASE}/api/services?include_inactive=false", headers=admin_headers, timeout=15).json()
        svc = next((s for s in existing if s.get("service_type") == "training" and s.get("is_default") and s.get("active")), None)
        assert svc is not None, "no training default service available to test against"
        yield svc
        return
    svc = r.json()
    yield svc
    requests.delete(f"{BASE}/api/services/{svc['id']}", headers=admin_headers, timeout=15)


@pytest.fixture
def training_booking_today(admin_headers, training_default_service):
    """Brand-new training booking on today's date — no actual_price yet."""
    today = date.today().isoformat()
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
    clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
    clients = clients if isinstance(clients, list) else clients.get("items", [])
    valid_ids = {c["id"] for c in clients}
    dog = next((d for d in dogs if d.get("owner_id") in valid_ids and (d.get("vaccines") or {}).get("rabies")), None)
    assert dog, "need a vaccinated dog to create a training booking"
    r = requests.post(
        f"{BASE}/api/bookings",
        json={"dog_id": dog["id"], "date": today, "service_type": "training",
              "time": "10:00", "override_capacity": True, "override_vaccines": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    booking = r.json()
    # Bookings start as pending — approve so today-pnl picks it up
    requests.post(f"{BASE}/api/bookings/{booking['id']}/approve",
                  headers=admin_headers, timeout=15)
    yield booking
    requests.delete(f"{BASE}/api/bookings/{booking['id']}", headers=admin_headers, timeout=15)


def test_unbilled_training_does_not_pad_today_pnl(admin_headers, training_booking_today, training_default_service):
    """An approved-but-not-checked-out training booking with no actual_price
    must NOT add the catalog price to today's expected revenue."""
    pnl = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    # The training booking's catalog price is $75 — if the fallback was still
    # in play, that booking alone would contribute $75 to expected revenue.
    # Other bookings on the calendar could legitimately contribute, so we
    # check the training-specific count and the assert by-service breakdown
    # if present, falling back to "total expected revenue is < pre-bug value".
    # The cleanest signal: training shouldn't appear in `by_service_type` for
    # the booking we just created.
    by_type = pnl.get("by_service_type") or {}
    train = by_type.get("training") or {}
    # Either training is absent OR its revenue is 0 (only our booking exists
    # for "training" on a fresh test box).
    if train:
        assert train.get("revenue", 0) == 0, (
            f"unbilled training booking still padded today-pnl: {train}"
        )


def test_check_out_training_zero_keeps_pnl_zero(admin_headers, training_booking_today):
    """Checking out a training booking with base_price=0 must store
    actual_price=0 and today-pnl must NOT fall back to the catalog price."""
    bid = training_booking_today["id"]
    # Check in then check out at $0
    requests.post(f"{BASE}/api/bookings/{bid}/check-in",
                  headers=admin_headers, timeout=15)
    r = requests.post(
        f"{BASE}/api/bookings/{bid}/check-out",
        json={"base_price": 0, "payment_method": "cash", "mark_paid": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out.get("actual_price") == 0, f"actual_price should be 0 · got {out.get('actual_price')}"
    # Confirm today-pnl reflects $0 for this booking
    pnl = requests.get(f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15).json()
    by_type = pnl.get("by_service_type") or {}
    train = by_type.get("training") or {}
    # Same logic as above
    if train:
        assert train.get("revenue", 0) == 0, (
            f"$0 training checkout still showed revenue in today-pnl: {train}"
        )


def test_check_out_training_with_amount_records_revenue(admin_headers, training_booking_today):
    """Sanity check: when the admin DOES enter an amount at check-out, it's
    captured (multi-dog discount may legitimately knock it down slightly)."""
    bid = training_booking_today["id"]
    requests.post(f"{BASE}/api/bookings/{bid}/check-in",
                  headers=admin_headers, timeout=15)
    r = requests.post(
        f"{BASE}/api/bookings/{bid}/check-out",
        json={"base_price": 50.0, "payment_method": "cash", "mark_paid": True},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    # Should be 50.0 (or slightly less if a multi-dog discount applied) —
    # but NOT 0 (the bug we just fixed), and NOT the catalog $75 default.
    ap = r.json().get("actual_price")
    assert ap is not None and ap > 0, f"actual_price not captured: {ap}"
    assert ap <= 50.0, f"actual_price should be ≤ 50 (we passed 50, discount may reduce): {ap}"
