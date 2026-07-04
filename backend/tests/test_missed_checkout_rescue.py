"""Sprint 110di-85 — Regression tests for the missed-checkout rescue.

When staff forget to check a daycare dog out, the booking used to drop off
the next day's dashboard because the roster filter required `today ∈ [date,
end_date]`. That silently left dogs with no checkout time and no credit
deduction. This test locks the fix in: any booking that is still checked in
(has `checked_in_at`, no `checked_out_at`) and whose scheduled date is in
the past MUST reappear on today's `/api/dashboard/stats` roster with an
`is_missed_checkout: True` marker so the front desk can complete the
checkout and settle the credit.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")


def _admin_h():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _yday_iso():
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def _seed_client_dog(h):
    """Create a fresh client + dog with a vaccine record that is current."""
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(f"{BASE_URL}/api/clients",
                      json={"name": f"Missed CO {suffix}", "email": f"missed_{suffix}@example.com", "phone": "555-0201"},
                      headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    client_id = r.json()["id"]
    future = (datetime.now(timezone.utc).date() + timedelta(days=365)).isoformat()
    r2 = requests.post(f"{BASE_URL}/api/dogs",
                       json={"owner_id": client_id, "name": f"Rex-{suffix}", "breed": "mixed",
                             "vaccines": {"rabies": future, "dhpp": future, "bordetella": future}},
                       headers=h, timeout=15)
    assert r2.status_code in (200, 201), r2.text
    dog_id = r2.json()["id"]
    return client_id, dog_id


def test_missed_daycare_checkout_stays_on_todays_roster():
    h = _admin_h()
    client_id, dog_id = _seed_client_dog(h)
    # Create a daycare booking for yesterday, check in immediately, never check out.
    yday = _yday_iso()
    r = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": yday, "service_type": "daycare",
              "check_in_now": True, "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    bid = r.json()["id"]

    # Also seed a NORMAL yesterday-daycare booking that WAS checked out to prove
    # the roster still hides those (i.e. we didn't accidentally widen too far).
    r2 = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": yday, "service_type": "daycare",
              "check_in_now": True, "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r2.status_code in (200, 201), r2.text
    bid_ok = r2.json()["id"]
    r3 = requests.post(f"{BASE_URL}/api/bookings/{bid_ok}/check-out",
                       json={"paid_amount": 0}, headers=h, timeout=15)
    assert r3.status_code == 200, r3.text

    try:
        stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
        roster = stats.get("today_roster") or []
        row = next((r for r in roster if r.get("id") == bid), None)
        assert row is not None, "Stuck-checked-in booking must appear on today's roster"
        assert row.get("is_missed_checkout") is True, row
        assert row.get("checked_in_at"), "checked_in_at must be preserved"
        assert not row.get("checked_out_at"), "checked_out_at must still be empty until staff acts"

        # The properly-completed one should NOT be on today's roster (it's yesterday's date
        # and has been checked out — nothing more for staff to do here).
        row_ok = next((r for r in roster if r.get("id") == bid_ok), None)
        assert row_ok is None, "Yesterday's completed daycare must not linger on today's roster"

        # Occupancy count should still tick up by 1 for the stuck row (dog is still occupying a slot).
        # Compare live vs a snapshot without the stuck booking would need extra plumbing —
        # so just assert daycare_occupancy is >= 1 and the roster contains it.
        assert stats.get("daycare_occupancy", 0) >= 1
    finally:
        # Cleanup — check out the stuck booking so we don't pollute other tests
        requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out",
                      json={"paid_amount": 0}, headers=h, timeout=15)


def test_missed_daycare_checkout_can_be_settled_and_credit_deducts():
    """Second half of the story: after the row is rescued, checking out
    must still process a credit-usage row like a normal same-day checkout."""
    h = _admin_h()
    client_id, dog_id = _seed_client_dog(h)
    yday = _yday_iso()

    # Give the client a daycare credit so we can watch it get deducted.
    r0 = requests.post(f"{BASE_URL}/api/clients/{client_id}/adjust-credits",
                       json={"daycare": 5, "reason": "test seed"},
                       headers=h, timeout=15)
    assert r0.status_code == 200, r0.text
    starting = requests.get(f"{BASE_URL}/api/clients/{client_id}", headers=h, timeout=15).json().get("credits", 0)

    r = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": yday, "service_type": "daycare",
              "check_in_now": True, "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    bid = r.json()["id"]

    # Ensure the row shows up on today's roster
    stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
    assert any(row.get("id") == bid for row in (stats.get("today_roster") or []))

    # Now settle from credits — this is the exact flow staff would use.
    r_co = requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out",
                         json={"paid_amount": 0, "credits_used": 1},
                         headers=h, timeout=15)
    assert r_co.status_code == 200, r_co.text

    after = requests.get(f"{BASE_URL}/api/clients/{client_id}", headers=h, timeout=15).json().get("credits", 0)
    assert after == starting - 1, f"expected {starting-1}, got {after}"

    # After checkout, the row must fall off today's roster.
    stats2 = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
    assert not any(row.get("id") == bid for row in (stats2.get("today_roster") or []))


def test_boarding_still_uses_date_range_not_missed_flag():
    """Regression guard: boarding rows continue to appear because today ∈ [date, end_date],
    NOT because of the missed-checkout rescue. is_missed_checkout must be False for a
    normal in-progress boarding stay."""
    h = _admin_h()
    client_id, dog_id = _seed_client_dog(h)
    today = datetime.now(timezone.utc).date().isoformat()
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": today, "end_date": tomorrow,
              "service_type": "boarding", "check_in_now": True,
              "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    bid = r.json()["id"]

    try:
        stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
        row = next((r for r in (stats.get("today_roster") or []) if r.get("id") == bid), None)
        assert row is not None, "Active boarding must be on today's roster"
        assert row.get("is_missed_checkout") is False, "Active boarding is NOT a missed checkout"
    finally:
        requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out",
                      json={"paid_amount": 0}, headers=h, timeout=15)


def test_mid_boarding_stay_from_yesterday_does_not_flag():
    """Sprint 110di-86 regression: a boarding stay that STARTED yesterday and
    continues through tomorrow (date < today <= end_date) must appear on the
    roster (via today ∈ days) but must NOT be flagged as missed_checkout,
    because the stay is still in progress. Only when today > end_date and the
    dog is still checked in should the flag fire."""
    h = _admin_h()
    client_id, dog_id = _seed_client_dog(h)
    yday = _yday_iso()
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()

    # Start the stay yesterday, ending tomorrow — dog is mid-stay today.
    r = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": yday, "end_date": tomorrow,
              "service_type": "boarding", "check_in_now": True,
              "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    bid = r.json()["id"]

    try:
        stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
        row = next((r for r in (stats.get("today_roster") or []) if r.get("id") == bid), None)
        assert row is not None, "Mid-stay boarding must be on today's roster"
        assert row.get("is_missed_checkout") is False, \
            "Mid-stay boarding must NOT be flagged as missed checkout"
    finally:
        requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out",
                      json={"paid_amount": 0}, headers=h, timeout=15)


def test_boarding_end_date_passed_but_no_checkout_flags():
    """Complementary test: a boarding stay whose end_date is truly in the
    past AND still checked in SHOULD be flagged and rescued onto the roster."""
    h = _admin_h()
    client_id, dog_id = _seed_client_dog(h)
    two_days_ago = (datetime.now(timezone.utc).date() - timedelta(days=2)).isoformat()
    yday = _yday_iso()

    # Stay ran two_days_ago -> yesterday, dog was never checked out.
    r = requests.post(
        f"{BASE_URL}/api/bookings",
        json={"dog_id": dog_id, "date": two_days_ago, "end_date": yday,
              "service_type": "boarding", "check_in_now": True,
              "override_capacity": True},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    bid = r.json()["id"]

    try:
        stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=h, timeout=15).json()
        row = next((r for r in (stats.get("today_roster") or []) if r.get("id") == bid), None)
        assert row is not None, "Boarding past its end_date but still checked in must be rescued"
        assert row.get("is_missed_checkout") is True, row
    finally:
        requests.post(f"{BASE_URL}/api/bookings/{bid}/check-out",
                      json={"paid_amount": 0}, headers=h, timeout=15)
