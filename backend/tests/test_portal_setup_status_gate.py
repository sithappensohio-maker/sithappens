"""Sprint 110di-14 — portal setup-status gate (sticky CTA contract).

The mobile sticky Book Service button reads `booking_locked` / `ready_to_book`
to decide whether to open PortalBookWizard or route the client to the setup
checklist. This test pins the API contract so future refactors can't
accidentally drop one of those keys (which would silently fall through to
"open the wizard" in the UI).
"""
import os
import uuid
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")


def _admin_h():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


REQUIRED_KEYS = {
    "steps",
    "booking_locked",
    "ready_to_book",
    "completed_count",
    "total_count",
}


def test_setup_status_403s_when_caller_is_not_a_client():
    """Admin (no client_id on the user) must get 403 — the sticky button
    never renders for admins, but this pins the contract anyway."""
    h = _admin_h()
    r = requests.get(f"{BASE_URL}/api/portal/setup-status",
                     headers=h, timeout=15)
    assert r.status_code == 403, r.text


def test_admin_setup_status_returns_locked_for_brand_new_client():
    """A brand-new client (no dogs, no waiver, no vaccines) MUST come back
    `booking_locked=True` with `ready_to_book=False` and all 5 keys present.
    The mobile sticky button reads exactly these fields to decide between
    "Complete Setup" and "Book Service" — losing either key would silently
    fall through to "open the wizard"."""
    h = _admin_h()
    suffix = uuid.uuid4().hex[:8]
    email = f"setupgate-{suffix}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/clients", headers=h,
        json={"name": "Setup Gate Tester", "email": email, "phone": "555-0001"},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]
    try:
        r2 = requests.get(f"{BASE_URL}/api/admin/clients/{cid}/setup-status",
                          headers=h, timeout=15)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        missing = REQUIRED_KEYS - set(body.keys())
        assert not missing, f"setup-status payload missing keys: {missing}"
        assert body["booking_locked"] is True, body
        assert body["ready_to_book"] is False, body
        assert isinstance(body["steps"], list) and len(body["steps"]) >= 1
        assert isinstance(body["completed_count"], int)
        assert isinstance(body["total_count"], int)
        assert body["total_count"] >= body["completed_count"]
        # Locked badge surfaced for the admin shell.
        assert body.get("badge") in {"Setup Incomplete", "Pending Vaccine Review"}
    finally:
        requests.delete(f"{BASE_URL}/api/clients/{cid}", headers=h, timeout=15)


def test_admin_setup_status_for_kept_test_client_has_all_required_keys():
    """The kept test client (freightshaker06@gmail.com) is a real fixture in
    the cleaned-up DB. Verify the admin-side summary endpoint still returns
    the same 5 keys plus a badge label so the admin dashboard onboarding
    summary card keeps working."""
    h = _admin_h()
    r = requests.get(f"{BASE_URL}/api/clients?search=freightshaker06",
                     headers=h, timeout=15)
    assert r.status_code == 200, r.text
    matches = [c for c in r.json() if c.get("email") == "freightshaker06@gmail.com"]
    if not matches:
        import pytest
        pytest.skip("kept test client not present in this environment")
    cid = matches[0]["id"]
    r2 = requests.get(f"{BASE_URL}/api/admin/clients/{cid}/setup-status",
                      headers=h, timeout=15)
    assert r2.status_code == 200, r2.text
    body = r2.json()
    for k in REQUIRED_KEYS:
        assert k in body, f"missing {k}"
    assert "badge" in body
