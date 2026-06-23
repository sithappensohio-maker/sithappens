"""Sprint 110di-79 — Client-facing Training Tip of the Day endpoint.

Pins:
- /api/me/training-tip/today requires a client token (admin token rejected with 403).
- Returns a tip + date payload when there are active tips.
- Hides tips tagged audience='staff' (or 'trainer', 'internal') from clients.
- Falls back to all active tips if no client-facing tips exist (so a fresh
  install with only seeded staff tips still shows something on day one).
- Admin /api/training-tips/today is unchanged.
"""
import os
import time
import uuid
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


def _make_client(h):
    """Seed a unique client + portal account, return its bearer header."""
    suffix = uuid.uuid4().hex[:8]
    email = f"tip_client_{suffix}@example.com"
    # Create client
    r = requests.post(
        f"{BASE_URL}/api/clients",
        json={"name": f"Tip Test {suffix}", "email": email, "phone": "555-0100"},
        headers=h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    client_id = r.json()["id"]
    pwd = "TipTest!123"
    # Create portal account via the standard admin endpoint
    r2 = requests.post(
        f"{BASE_URL}/api/clients/{client_id}/portal-account",
        json={"email": email, "password": pwd},
        headers=h, timeout=15,
    )
    assert r2.status_code == 200, r2.text
    r3 = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": pwd},
        timeout=15,
    )
    assert r3.status_code == 200, r3.text
    return {"Authorization": f"Bearer {r3.json()['token']}"}, client_id


def test_client_tip_endpoint_returns_tip():
    admin_h = _admin_h()
    client_h, _ = _make_client(admin_h)

    r = requests.get(f"{BASE_URL}/api/me/training-tip/today",
                     headers=client_h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "date" in body
    # The seeded pool is all audience='staff', so the endpoint should
    # fall back to that pool and still hand back a tip on day one.
    assert body.get("tip") is not None
    assert body["tip"].get("tip")
    assert body["tip"].get("active") is True


def test_client_tip_rejects_admin_token():
    admin_h = _admin_h()
    r = requests.get(f"{BASE_URL}/api/me/training-tip/today",
                     headers=admin_h, timeout=15)
    assert r.status_code == 403, r.text


def test_client_tip_filters_internal_audience_when_curated_pool_exists():
    """When at least one tip is tagged with a client-friendly audience,
    the client endpoint must NOT pick a staff/internal-tagged tip."""
    admin_h = _admin_h()
    client_h, _ = _make_client(admin_h)

    # Add one client-tagged tip so the curated pool is non-empty.
    unique = f"client-only-{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE_URL}/api/training-tips",
        json={"tip": f"Praise the small wins — {unique}",
              "category": "general", "difficulty": "beginner",
              "audience": "client", "source": "", "active": True},
        headers=admin_h, timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    new_id = r.json()["id"]

    try:
        # Fetch via the client endpoint; tip MUST have non-internal audience.
        r2 = requests.get(f"{BASE_URL}/api/me/training-tip/today",
                          headers=client_h, timeout=15)
        assert r2.status_code == 200, r2.text
        tip = r2.json().get("tip") or {}
        assert tip, r2.text
        aud = (tip.get("audience") or "").strip().lower()
        assert aud not in ("staff", "trainer", "trainers", "internal"), \
            f"Internal-audience tip leaked into client view: {tip}"
    finally:
        # Cleanup
        requests.delete(f"{BASE_URL}/api/training-tips/{new_id}",
                        headers=admin_h, timeout=15)


def test_admin_tip_endpoint_still_works():
    admin_h = _admin_h()
    r = requests.get(f"{BASE_URL}/api/training-tips/today",
                     headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "date" in body
    # Admin always has the full pool.
    assert body.get("tip") is not None


def test_client_tip_section_default_on_in_branding():
    """The default Client Portal Controls payload must include the new
    `training_tip` section toggle so admins can hide it via Settings."""
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    sections = (body.get("client_portal_controls") or {}).get("sections") or {}
    assert "training_tip" in sections
    assert sections["training_tip"] is True
