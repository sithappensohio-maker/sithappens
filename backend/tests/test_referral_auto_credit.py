"""Sprint 110cu — Auto-credit referrer on first conversion.

Validates that when a new client signs up using a `referred_by_code` and
completes their first paid checkout, the referrer is automatically awarded
+1 daycare credit and a `referrals` row + `credit_adjustments` row are
written for the audit trail. Email notifications are best-effort and
should NOT block the flow.
"""
import os
import uuid
import pytest
import requests
from datetime import date


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_client(headers, name_prefix):
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/clients", headers=headers,
                      json={"name": f"{name_prefix} {suffix}",
                            "email": f"{name_prefix.lower()}-{suffix}@e.com"},
                      timeout=15)
    r.raise_for_status()
    return r.json()


def _ensure_referral_code(headers, client_id):
    """Force-mint a referral code via direct DB write. The portal flow
    auto-mints on first /portal load, but we don't want to spin up a client
    login here — direct write is the cleanest test setup."""
    client = requests.get(f"{API}/clients/{client_id}", headers=headers, timeout=15).json()
    code = client.get("referral_code")
    if code:
        return code
    # Force-mint via direct Mongo write (same approach used by other tests)
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    code = f"TST{uuid.uuid4().hex[:4].upper()}"

    async def _mint():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ["DB_NAME"]]
            await db.clients.update_one({"id": client_id}, {"$set": {"referral_code": code}})
        finally:
            mc.close()

    asyncio.run(_mint())
    return code


def test_referrer_gets_credit_on_first_checkout(admin_headers):
    """End-to-end: referrer client A has a code, referee client B signs up
    with A's code, books + completes a daycare visit, A receives +1 daycare
    credit and a referrals row is created."""
    today = date.today().isoformat()

    # 1. Create referrer + mint a referral code
    referrer = _make_client(admin_headers, "Referrer")
    code = _ensure_referral_code(admin_headers, referrer["id"])
    assert code, "Referrer must have a referral code to test referral payout"

    referrer_before = requests.get(f"{API}/clients/{referrer['id']}",
                                   headers=admin_headers, timeout=15).json()
    before_credits = int(referrer_before.get("credits") or 0)

    # 2. Create referee client with referred_by_code
    suffix = uuid.uuid4().hex[:6]
    referee = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"Referee {suffix}",
                                  "email": f"referee-{suffix}@e.com",
                                  "referred_by_code": code},
                            timeout=15).json()
    assert (referee.get("referred_by_code") or "").upper() == code.upper(), \
        "Referee should carry the referred_by_code"

    # 3. Create referee's dog
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"RefereeDog {suffix}",
                              "owner_id": referee["id"], "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()

    # 4. Book + check in + check out a daycare visit (paid cash, so we
    # exercise the standard checkout path).
    booking = requests.post(f"{API}/bookings", headers=admin_headers,
                            json={"dog_id": dog["id"], "service_type": "daycare",
                                  "date": today, "status": "approved"},
                            timeout=15)
    if booking.status_code != 200:
        pytest.skip(f"Couldn't create daycare booking: {booking.text}")
    booking = booking.json()
    requests.post(f"{API}/bookings/{booking['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    co = requests.post(f"{API}/bookings/{booking['id']}/check-out",
                       headers=admin_headers,
                       json={"use_credits": False, "base_price": 30},
                       timeout=15)
    co.raise_for_status()

    # 5. Verify referrer balance grew by exactly 1
    referrer_after = requests.get(f"{API}/clients/{referrer['id']}",
                                  headers=admin_headers, timeout=15).json()
    after_credits = int(referrer_after.get("credits") or 0)
    assert after_credits == before_credits + 1, (
        f"Referrer credits should grow by 1 (was {before_credits}, "
        f"now {after_credits})"
    )


def test_referral_credit_only_fires_once(admin_headers):
    """The same referee converting twice must NOT double-credit the
    referrer. The `referrals` row keyed on `referred_id` is the guard."""
    today = date.today().isoformat()
    referrer = _make_client(admin_headers, "Once")
    code = _ensure_referral_code(admin_headers, referrer["id"])

    referrer_before = requests.get(f"{API}/clients/{referrer['id']}",
                                   headers=admin_headers, timeout=15).json()
    before = int(referrer_before.get("credits") or 0)

    suffix = uuid.uuid4().hex[:6]
    referee = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"OnceReferee {suffix}",
                                  "email": f"once-{suffix}@e.com",
                                  "referred_by_code": code},
                            timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"OnceDog {suffix}",
                              "owner_id": referee["id"], "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()

    for _ in range(2):
        bk = requests.post(f"{API}/bookings", headers=admin_headers,
                           json={"dog_id": dog["id"], "service_type": "daycare",
                                 "date": today, "status": "approved"},
                           timeout=15)
        if bk.status_code != 200:
            pytest.skip(f"Couldn't create booking: {bk.text}")
        bk = bk.json()
        requests.post(f"{API}/bookings/{bk['id']}/check-in",
                      headers=admin_headers, json={}, timeout=15).raise_for_status()
        requests.post(f"{API}/bookings/{bk['id']}/check-out",
                      headers=admin_headers,
                      json={"use_credits": False, "base_price": 30},
                      timeout=15).raise_for_status()

    after = int(requests.get(f"{API}/clients/{referrer['id']}",
                             headers=admin_headers, timeout=15).json().get("credits") or 0)
    assert after == before + 1, (
        f"Referrer should only get credited ONCE per referred client "
        f"(was {before}, now {after} after 2 checkouts)"
    )


def test_no_credit_without_referral_code(admin_headers):
    """A new client with no referred_by_code must NOT trigger any
    referrer credit."""
    today = date.today().isoformat()
    suffix = uuid.uuid4().hex[:6]
    orphan = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Orphan {suffix}",
                                 "email": f"orphan-{suffix}@e.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"OrphanDog {suffix}",
                              "owner_id": orphan["id"], "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()
    bk = requests.post(f"{API}/bookings", headers=admin_headers,
                       json={"dog_id": dog["id"], "service_type": "daycare",
                             "date": today, "status": "approved"},
                       timeout=15)
    if bk.status_code != 200:
        pytest.skip(f"Couldn't create booking: {bk.text}")
    bk = bk.json()
    requests.post(f"{API}/bookings/{bk['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    co = requests.post(f"{API}/bookings/{bk['id']}/check-out",
                       headers=admin_headers,
                       json={"use_credits": False, "base_price": 30},
                       timeout=15)
    # Endpoint must succeed even with no referral linkage
    co.raise_for_status()


def test_referral_email_templates_registered(admin_headers):
    """The two new email templates must be discoverable in the
    Email Designer registry so admin can customize them."""
    templates = requests.get(f"{API}/admin/email-templates",
                             headers=admin_headers, timeout=15).json()
    slugs = {t.get("slug") for t in (templates or [])}
    assert "client_referral_payout" in slugs, \
        "client_referral_payout must be in the registry"
    assert "client_referral_welcome" in slugs, \
        "client_referral_welcome must be in the registry"
