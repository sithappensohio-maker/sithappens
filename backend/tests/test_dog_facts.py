"""Sprint 110ax — Dog Fact of the Day."""
import os
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_today_returns_a_seeded_fact():
    h = _admin()
    r = requests.get(f"{BASE}/api/dog-facts/today", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "date" in body
    assert body["fact"] is not None
    f = body["fact"]
    for key in ("id", "text", "tag", "emoji", "active"):
        assert key in f
    assert f["active"] is True


def test_today_is_stable_within_same_day():
    h = _admin()
    a = requests.get(f"{BASE}/api/dog-facts/today", headers=h, timeout=15).json()
    b = requests.get(f"{BASE}/api/dog-facts/today", headers=h, timeout=15).json()
    assert a["fact"]["id"] == b["fact"]["id"]


def test_admin_crud_round_trip():
    h = _admin()
    # Create
    r = requests.post(
        f"{BASE}/api/dog-facts",
        json={"text": "Test fact — please ignore.", "tag": "fun", "emoji": "🧪"},
        headers=h, timeout=15,
    )
    assert r.status_code == 200, r.text
    fact = r.json()
    fid = fact["id"]
    assert fact["text"].startswith("Test fact")
    # Patch (toggle off)
    r = requests.patch(f"{BASE}/api/dog-facts/{fid}", json={"active": False}, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["active"] is False
    # Inactive must not appear in active_only listing
    rows = requests.get(f"{BASE}/api/dog-facts?active_only=true", headers=h, timeout=15).json()
    assert not any(x["id"] == fid for x in rows)
    # Delete
    r = requests.delete(f"{BASE}/api/dog-facts/{fid}", headers=h, timeout=15)
    assert r.status_code == 200, r.text


def test_client_can_see_today_but_cannot_admin():
    """Clients shouldn't be able to manage facts but should see today's pick."""
    login = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "testclient@sithappens.com", "password": "test1234"},
        timeout=15,
    )
    if login.status_code != 200:
        import pytest
        pytest.skip("test client not seeded")
    ch = {"Authorization": f"Bearer {login.json()['token']}"}
    r = requests.get(f"{BASE}/api/dog-facts/today", headers=ch, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["fact"] is not None
    # Client trying to list / create should 403
    r = requests.get(f"{BASE}/api/dog-facts", headers=ch, timeout=15)
    assert r.status_code == 403, f"clients must not be able to list/manage facts: {r.text}"


def test_seed_has_substantial_library():
    h = _admin()
    rows = requests.get(f"{BASE}/api/dog-facts", headers=h, timeout=15).json()
    # At least 100 entries — keeps rotation fresh for months
    assert len(rows) >= 100, f"expected substantial seed library, got {len(rows)}"
    # Each row has required fields
    for r in rows[:10]:
        for key in ("id", "text", "tag", "emoji", "active"):
            assert key in r
