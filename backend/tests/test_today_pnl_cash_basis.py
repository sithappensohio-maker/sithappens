"""Sprint 110ek — Today's P&L must NOT count approved (not-yet-checked-out)
bookings as revenue.

User report (2026-02-16): "Today's P&L is still counting dogs on check-in.
It shouldn't be doing this till check out or I sell packs or services."

This pins the universal cash-basis rule to the live `today_pnl` gauge:
  - APPROVED booking → $0 revenue (forecast only)
  - COMPLETED booking → cash slice via `_cash_revenue`
  - retail_sales today (pack sale, training program sale, plan installment
    marked paid, retail item sale) → adds to revenue
"""
import os
import uuid
import pytest
import requests
from datetime import date


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_approved_booking_does_not_bump_today_revenue(admin_headers):
    today = date.today().isoformat()
    suffix = uuid.uuid4().hex[:6]

    # Snapshot today's revenue BEFORE we create anything.
    before = requests.get(
        f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15,
    ).json()
    rev_before = float(before.get("revenue") or 0)

    # Create a client + dog + booking → approve. NO checkout, NO pack sale.
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"NoCheckout-{suffix}", "email": f"nc-{suffix}@e.com"},
        timeout=15,
    ).json()
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={"name": f"Pup-{suffix}", "owner_id": client["id"],
              "breed": "Mix", "age_y": 3,
              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01",
                           "bordetella": "2028-01-01"}},
        timeout=15,
    ).json()
    b = requests.post(
        f"{BASE}/api/bookings", headers=admin_headers,
        json={"dog_id": dog["id"], "service_type": "daycare",
              "date": today, "status": "approved",
              "override_capacity": True, "override_vaccines": True},
        timeout=15,
    )
    if b.status_code != 200:
        pytest.skip(f"Couldn't create booking: {b.text}")

    after = requests.get(
        f"{BASE}/api/admin/today-pnl", headers=admin_headers, timeout=15,
    ).json()
    rev_after = float(after.get("revenue") or 0)
    delta = round(rev_after - rev_before, 2)

    assert abs(delta) < 0.5, (
        f"UNIVERSAL CASH-BASIS BROKEN: approving a booking bumped "
        f"today's REVENUE by ${delta}. The user explicitly said "
        f"\"it shouldn't be doing this till check out or I sell packs or services.\" "
        f"before=${rev_before}, after=${rev_after}."
    )
    # Booked count SHOULD have ticked +1 — it's the booked tile, separate
    # from revenue.
    assert int(after.get("booked_count") or 0) >= int(before.get("booked_count") or 0) + 1
