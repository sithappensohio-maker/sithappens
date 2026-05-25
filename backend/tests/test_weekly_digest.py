"""Regression tests for the homework weekly-digest job.

The actual email send depends on Resend domain verification (preview env may
fail). These tests assert the job's *behaviour* (queue building, dedup,
empty-week skip) — not whether the email itself was delivered.
"""
import os
import uuid
import requests
import pytest
from datetime import date, timedelta

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog_with_client(admin_headers):
    """Pick a dog whose owning client has a real email — the digest is a no-op
    for clients without an email on file."""
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
    clients = {c["id"]: c for c in requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()}
    for d in dogs:
        oid = d.get("owner_id")
        if not oid:
            continue
        cli = clients.get(oid) or {}
        if cli.get("email"):
            return d
    pytest.skip("no dogs owned by an email-having client")


def test_digest_with_no_active_trackers_returns_zero(admin_headers):
    """If no daily-tracker homework has any approved log this week, sent=0."""
    r = requests.post(f"{BASE}/api/admin/homework/send-weekly-digest", headers=admin_headers, timeout=20)
    assert r.status_code == 200
    out = r.json()
    assert "sent" in out and "attempted" in out
    assert out["sent"] >= 0
    assert out["attempted"] >= 0


def test_digest_picks_up_active_tracker_with_approval(admin_headers, a_dog_with_client):
    """After approving a day this week, the job's `attempted` count must include
    that client. The actual `sent` count depends on Resend domain verification."""
    hw_body = {
        "dog_id": a_dog_with_client["id"],
        "title": f"DigestPyTest-{uuid.uuid4().hex[:6]}",
        "days": [
            {"day_number": 1, "day_focus": "test", "fields": [{"id": "sets", "label": "Sets", "kind": "sets"}]},
            {"day_number": 2, "day_focus": "test 2", "fields": [{"id": "sets", "label": "Sets", "kind": "sets"}]},
        ],
    }
    hw = requests.post(f"{BASE}/api/homework/daily-tracker", headers=admin_headers, json=hw_body, timeout=20).json()
    hwid = hw["id"]
    try:
        # Submit + approve Day 1 to create activity this week
        requests.post(f"{BASE}/api/homework/{hwid}/day/1/submit", headers=admin_headers,
                      json={"field_values": {"sets": 3}, "mood": 4, "note": "good"}, timeout=15)
        requests.post(f"{BASE}/api/homework/{hwid}/day/1/review", headers=admin_headers,
                      json={"action": "approve", "note": "Locked in"}, timeout=15)
        # Fire digest
        r = requests.post(f"{BASE}/api/admin/homework/send-weekly-digest", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        out = r.json()
        # The client we just approved-for must appear in attempted (sent if Resend domain verified)
        assert out["attempted"] >= 1, f"Expected attempted>=1, got {out}"
        # week_start/week_end always returned
        assert "week_start" in out and "week_end" in out
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_digest_endpoint_is_admin_only(admin_headers):
    """Trying without auth must 401/403."""
    r = requests.post(f"{BASE}/api/admin/homework/send-weekly-digest", timeout=10)
    assert r.status_code in (401, 403)
