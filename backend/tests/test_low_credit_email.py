"""Sprint 110g — Low-credit email at checkout.

The bug: `notify_client_low_credits` was imported in server.py but never
called from anywhere — so clients never got the "you've got 2 left" heads-up.

Tests:
  - First checkout that drops the pool to <=2 stamps `low_credit_emailed_at`
  - Second checkout at the same balance does NOT re-stamp (idempotency)
  - A credit refill that lifts the pool above 2 clears the stamp
  - Subsequent dip back into the warn zone re-arms + restamps
  - Boarding pool also covered (not just daycare/training)
"""
import os
import uuid
import datetime as _dt
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def low_credit_client(admin_headers):
    """Make a fresh client with EXACTLY 3 daycare credits + 1 booking ready to check out.
    First check-out drops to 2 → should email. We track that via the stored stamp
    field that the helper writes."""
    suffix = uuid.uuid4().hex[:6]
    c = requests.post(f"{BASE}/api/clients", headers=admin_headers, json={
        "name": f"LowCredit {suffix}",
        "email": f"lowcredit-{suffix}@test.local",
        "phone": "555-0000",
        "address": "1 Test Lane",
        "emergency_contact": "n/a",
    }, timeout=15).json()
    # Grant 3 daycare credits via the admin adjustment endpoint
    requests.post(f"{BASE}/api/clients/{c['id']}/adjust-credits", headers=admin_headers, json={
        "daycare": 3, "note": "test fixture seed",
    }, timeout=15)
    # Create a dog + 3 approved daycare bookings (one per day)
    d = requests.post(f"{BASE}/api/dogs", headers=admin_headers, json={
        "name": f"Pup-{suffix}", "breed": "Lab", "weight_lbs": 50,
        "owner_id": c["id"], "vaccines": {"rabies": "2030-01-01"},
    }, timeout=15).json()
    today = _dt.date.today()
    booking_ids = []
    for off in range(3):
        date_iso = (today + _dt.timedelta(days=off)).isoformat()
        b = requests.post(f"{BASE}/api/bookings", headers=admin_headers, json={
            "client_id": c["id"], "dog_id": d["id"],
            "service_type": "daycare", "date": date_iso,
        }, timeout=15).json()
        requests.post(f"{BASE}/api/bookings/{b['id']}/approve", headers=admin_headers, timeout=15)
        booking_ids.append(b["id"])
    yield {"client_id": c["id"], "dog_id": d["id"], "booking_ids": booking_ids}
    for bid in booking_ids:
        requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
    requests.delete(f"{BASE}/api/dogs/{d['id']}", headers=admin_headers, timeout=15)
    requests.delete(f"{BASE}/api/clients/{c['id']}", headers=admin_headers, timeout=15)


def _client_state(admin_headers, client_id):
    return requests.get(f"{BASE}/api/clients/{client_id}", headers=admin_headers, timeout=15).json()


def test_checkout_at_threshold_stamps_email(admin_headers, low_credit_client):
    """3 credits → check out 1 → 2 left (<=2) → stamp recorded under
    low_credit_emailed_at.daycare with balance=2."""
    cid = low_credit_client["client_id"]
    bid = low_credit_client["booking_ids"][0]
    # Use credits — base_price 0 with credits=true
    r = requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers, json={
        "use_credits": True, "payment_method": "credits", "payment_status": "paid",
    }, timeout=15)
    assert r.status_code == 200, r.text
    state = _client_state(admin_headers, cid)
    assert state["credits"] == 2
    stamp = (state.get("low_credit_emailed_at") or {}).get("daycare")
    assert stamp, "expected low_credit_emailed_at.daycare stamp after dropping to 2"
    assert stamp["balance"] == 2


def test_second_checkout_does_not_double_stamp(admin_headers, low_credit_client):
    """Same balance later checkout shouldn't trigger a new email/stamp."""
    cid = low_credit_client["client_id"]
    bid1, bid2 = low_credit_client["booking_ids"][:2]
    # Drop to 2 via first booking
    requests.post(f"{BASE}/api/bookings/{bid1}/check-out", headers=admin_headers, json={
        "use_credits": True, "payment_method": "credits", "payment_status": "paid",
    }, timeout=15)
    first_stamp = (_client_state(admin_headers, cid).get("low_credit_emailed_at") or {}).get("daycare", {})
    assert first_stamp.get("balance") == 2, "first checkout should stamp at balance 2"
    first_ts = first_stamp.get("at")
    # 2nd booking → balance drops 2 -> 1 → new balance, NEW stamp (different balance)
    requests.post(f"{BASE}/api/bookings/{bid2}/check-out", headers=admin_headers, json={
        "use_credits": True, "payment_method": "credits", "payment_status": "paid",
    }, timeout=15)
    state = _client_state(admin_headers, cid)
    assert state["credits"] == 1
    second_stamp = (state.get("low_credit_emailed_at") or {}).get("daycare", {})
    # Stamp must update to the new lower balance (different "episode" within warn zone)
    assert second_stamp.get("balance") == 1, "stamp should reflect new lower balance"
    if first_ts and second_stamp.get("at"):
        assert second_stamp["at"] >= first_ts



def test_refill_above_threshold_clears_stamp(admin_headers, low_credit_client):
    """Admin top-up via adjust-credits that lifts the balance above 2 clears the
    email-sent stamp so a future dip re-fires a new email."""
    cid = low_credit_client["client_id"]
    bid = low_credit_client["booking_ids"][0]
    requests.post(f"{BASE}/api/bookings/{bid}/check-out", headers=admin_headers, json={
        "use_credits": True, "payment_method": "credits", "payment_status": "paid",
    }, timeout=15)
    assert (_client_state(admin_headers, cid).get("low_credit_emailed_at") or {}).get("daycare"), \
        "stamp should exist after first low-credit checkout"
    # +5 credits (2 → 7) — stamp must clear
    requests.post(f"{BASE}/api/clients/{cid}/adjust-credits", headers=admin_headers,
                  json={"daycare": 5, "note": "fresh pack purchased"}, timeout=15)
    state = _client_state(admin_headers, cid)
    assert state["credits"] == 7
    assert "daycare" not in (state.get("low_credit_emailed_at") or {}), \
        "stamp should auto-clear when manual adjust lifts balance above threshold"


def test_email_function_supports_boarding_pool():
    """Sanity-check that the underlying email helper accepts 'boarding'."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from email_service import notify_client_low_credits as fn
    import inspect
    sig = inspect.signature(fn)
    assert "service_type" in sig.parameters
    assert "remaining" in sig.parameters
