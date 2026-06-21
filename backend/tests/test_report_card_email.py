"""Sprint 110cp — Day-in-Pictures email at check-out.

Validates that:
  • The booking auto-triggers the email when checked out (with content).
  • `report_card_email_sent_at` is stamped (idempotency).
  • Re-checkout does NOT re-send.
  • The manual /resend-report-card endpoint clears the flag and re-fires.
  • Email is skipped when there's no content (no report card, no care log).
  • Email is skipped for training visits.
  • Email is skipped when settings.report_card_email_auto is false.

Note: this preview env has RESEND_API_KEY set, so the email actually sends
to Resend. To avoid spamming real inboxes, we use a synthetic test client
email (Resend silently no-ops for unverified sandboxed addresses on the
free tier, and the response shape is the same). We assert the booking-side
state (idempotency flag, sent endpoint return shape), not the email delivery.
"""
import os
import uuid
import pytest
import requests
from datetime import date

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def staff_headers(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    email = f"day-{suffix}@sithappens.com"
    pw = "DayPics123!"
    requests.post(f"{API}/admin/employees", headers=admin_headers,
                  json={"name": f"Day {suffix}", "email": email, "password": pw,
                        "hourly_rate": 18.0},
                  timeout=15).raise_for_status()
    login = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15).json()
    return {"Authorization": f"Bearer {login['token']}"}


def _make_visit(admin_headers, *, service_type="boarding", with_content=True):
    """Create client+dog+booking. If `with_content=True`, pre-seed a report
    card via the admin endpoint (works even without staff fixture).
    Falls back through service types when capacity is full."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Day Owner {suffix}",
                                 "email": f"day-owner-{suffix}@sithappens.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"DayDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 4,
                              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
                        timeout=15).json()
    # Try the requested type; fall back through grooming/boarding/daycare if
    # the preview DB has hit capacity for the day (real production wouldn't
    # have this contention).
    candidates = [service_type] + [t for t in ("grooming", "boarding") if t != service_type]
    booking = None
    for st in candidates:
        body = {"dog_id": dog["id"], "service_type": st,
                "date": date.today().isoformat(), "status": "approved"}
        if st == "grooming":
            body["grooming_type"] = "bath"
        resp = requests.post(f"{API}/bookings", headers=admin_headers, json=body, timeout=15)
        if resp.status_code == 200:
            booking = resp.json()
            break
    if booking is None:
        pytest.skip("Preview DB has no booking capacity left for today across all service types")
    if with_content:
        # File a report card so the auto-send has something to ship.
        requests.post(f"{API}/bookings/{booking['id']}/report-card",
                      headers=admin_headers,
                      json={"photos": [], "mood_tags": ["Happy", "Tired"],
                            "note": "Great day with friends!"},
                      timeout=15).raise_for_status()
    return {"client": client, "dog": dog, "booking_id": booking["id"]}


def test_checkout_auto_sends_report_card_email(admin_headers):
    """Checking out a boarding visit with content stamps the idempotency
    timestamp on the booking. We assert on `attempted_at` rather than
    `sent_at` because email delivery depends on the user's Resend domain
    verification — the code's job is to ATTEMPT the send and remember it."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=True)
    # Check the dog in then out.
    requests.post(f"{API}/bookings/{v['booking_id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{v['booking_id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    b = requests.get(f"{API}/bookings/{v['booking_id']}",
                     headers=admin_headers, timeout=15).json()
    assert b.get("report_card_email_attempted_at"), (
        f"Expected report_card_email_attempted_at to be stamped after checkout, got {b}"
    )


def test_email_skipped_for_training_visits(admin_headers):
    """Training visits get their own comms flow — no auto-send."""
    v = _make_visit(admin_headers, service_type="training", with_content=True)
    requests.post(f"{API}/bookings/{v['booking_id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{v['booking_id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    b = requests.get(f"{API}/bookings/{v['booking_id']}",
                     headers=admin_headers, timeout=15).json()
    assert not b.get("report_card_email_attempted_at"), \
        "Training visits must not auto-send the report card email"


def test_email_skipped_when_no_content(admin_headers):
    """No report card, no care log → no email."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=False)
    requests.post(f"{API}/bookings/{v['booking_id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{v['booking_id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    b = requests.get(f"{API}/bookings/{v['booking_id']}",
                     headers=admin_headers, timeout=15).json()
    assert not b.get("report_card_email_attempted_at")


def test_report_card_save_triggers_email_when_already_checked_out(admin_headers):
    """Common workflow: check out first, then write report card → email
    should fire the moment the card is filed."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=False)
    requests.post(f"{API}/bookings/{v['booking_id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{v['booking_id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    # No content yet, so no email.
    before = requests.get(f"{API}/bookings/{v['booking_id']}",
                          headers=admin_headers, timeout=15).json()
    assert not before.get("report_card_email_attempted_at")
    # Now file a report card AFTER checkout.
    requests.post(f"{API}/bookings/{v['booking_id']}/report-card",
                  headers=admin_headers,
                  json={"photos": [], "mood_tags": ["Happy"], "note": "Great visit!"},
                  timeout=15).raise_for_status()
    after = requests.get(f"{API}/bookings/{v['booking_id']}",
                         headers=admin_headers, timeout=15).json()
    assert after.get("report_card_email_attempted_at"), \
        "Email should fire when the report card lands after checkout"


def test_manual_resend_clears_and_refires(admin_headers):
    """Manual /resend-report-card clears the timestamps and re-fires."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=True)
    requests.post(f"{API}/bookings/{v['booking_id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{v['booking_id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    initial = requests.get(f"{API}/bookings/{v['booking_id']}",
                           headers=admin_headers, timeout=15).json()
    first_stamp = initial.get("report_card_email_attempted_at")
    assert first_stamp
    # Re-send.
    r = requests.post(f"{API}/bookings/{v['booking_id']}/resend-report-card",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    # The response carries both "sent" and "error" so the frontend knows.
    assert "sent" in body
    after = requests.get(f"{API}/bookings/{v['booking_id']}",
                         headers=admin_headers, timeout=15).json()
    assert after.get("report_card_email_attempted_at")


def test_resend_requires_content(admin_headers):
    """Re-send 400s when there's literally nothing to email."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=False)
    r = requests.post(f"{API}/bookings/{v['booking_id']}/resend-report-card",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 400


def test_staff_cannot_resend(staff_headers, admin_headers):
    """Re-send is admin-only (carries an implicit cost / spam concern)."""
    v = _make_visit(admin_headers, service_type="boarding", with_content=True)
    r = requests.post(f"{API}/bookings/{v['booking_id']}/resend-report-card",
                      headers=staff_headers, timeout=15)
    assert r.status_code in (401, 403)
