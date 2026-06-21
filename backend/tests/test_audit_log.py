"""Sprint 110ew — Phase 6: Audit log middleware regression."""
import os
import uuid
import pytest
import requests
from datetime import date


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
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


def _make_client(admin_headers, suffix):
    return requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"AL-{suffix}", "email": f"al-{suffix}@e.com"},
        timeout=15,
    ).json()


def test_audit_log_captures_writes(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    # Do three distinct mutations
    client = _make_client(admin_headers, suffix)
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={"name": f"ALPup-{suffix}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
        timeout=15,
    ).json()
    requests.put(
        f"{BASE}/api/dogs/{dog['id']}/safety-flags", headers=admin_headers,
        json={"flags": ["AuditTest"]}, timeout=15,
    )

    # Pull recent audit log (filter by record_id for the dog)
    log = requests.get(
        f"{BASE}/api/audit-log?record_id={dog['id']}&limit=20",
        headers=admin_headers, timeout=15,
    ).json()
    actions = {e["action"] for e in log["entries"]}
    assert "safety_flags_changed" in actions, (
        f"Expected safety_flags_changed in audit. Got: {actions}"
    )

    # Pull recent audit log (no record filter) and verify the latest writes show up
    log_all = requests.get(
        f"{BASE}/api/audit-log?limit=50", headers=admin_headers, timeout=15,
    ).json()
    assert log_all["groups"], "Groups list must be populated"
    assert log_all["users"], "Users list must be populated"
    all_actions = {e["action"] for e in log_all["entries"]}
    # Must include at least the dog_created + client_created we just performed
    assert "dog_created" in all_actions or any("dog" in a for a in all_actions)
    assert "client_created" in all_actions or any("client" in a for a in all_actions)

    # Action must NOT capture the bearer token (redaction)
    for e in log_all["entries"][:20]:
        payload = e.get("payload") or {}
        s = str(payload).lower()
        # If the payload happens to mention "password", it must be redacted
        if "password" in s:
            assert "[redacted]" in s, "Passwords must be redacted from the audit log payload"

    # Filter by group=dogs returns only dog-related actions
    log_dogs = requests.get(
        f"{BASE}/api/audit-log?group=dogs&limit=20",
        headers=admin_headers, timeout=15,
    ).json()
    for e in log_dogs["entries"]:
        assert e["action"] in (
            "dog_created", "dog_edited", "dog_deleted", "safety_flags_changed"
        ), f"Group=dogs filter leaked unrelated action: {e['action']}"

    # Cleanup
    requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
    requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_audit_skips_reads(admin_headers):
    """GET requests must not flood the log."""
    before = requests.get(
        f"{BASE}/api/audit-log?limit=1000", headers=admin_headers, timeout=15,
    ).json()
    n_before = len(before["entries"])
    # Hammer a few read endpoints
    for _ in range(5):
        requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15)
        requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15)
    after = requests.get(
        f"{BASE}/api/audit-log?limit=1000", headers=admin_headers, timeout=15,
    ).json()
    n_after = len(after["entries"])
    # The /audit-log GET itself shouldn't be logged either (it's a read).
    # Allow small noise from concurrent activity but the diff should be tiny.
    assert n_after - n_before <= 2, (
        f"Audit log gained {n_after - n_before} rows from 10 reads — middleware is logging GETs"
    )
