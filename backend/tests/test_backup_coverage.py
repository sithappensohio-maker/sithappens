"""Sprint 110aj — backup/restore must capture every catalog + every piece
of per-dog progress so a `git pull` (or full re-deploy) never loses
homework templates, trophies, programs, credits, training sessions, etc."""
import os

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


# Every collection that MUST appear in the backup so the user's manual
# customisation + every dog's progress survives a redeploy.
REQUIRED_COLLECTIONS = {
    # Core directory
    "clients", "dogs", "bookings", "incidents",
    "waiver_signatures", "client_files", "claim_tokens",
    # Catalog the admin curates by hand
    "settings", "services", "credit_packs",
    "homework_templates", "recurring_templates", "shift_templates",
    "programs", "trophies",
    # Per-dog progress / history
    "homework", "homework_media", "step_events",
    "dog_programs", "training_sessions",
    "awarded_trophies", "referrals",
    # Financial state
    "expenses", "retail_sales", "credit_lots", "credit_adjustments",
    # Front-desk inbox & admin task state
    "quote_requests", "tasks", "task_dismissals",
    # Staff scheduling & clocked hours (drives payroll)
    "shifts", "time_clock_entries",
}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_backup_export_contains_all_required_collections(admin_headers):
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["version"] >= 2, f"backup version should be ≥2 · got {data['version']}"
    assert "collections" in data
    got = set(data["collections"].keys())
    missing = REQUIRED_COLLECTIONS - got
    assert not missing, f"backup missing required collections: {sorted(missing)}"


def test_backup_excludes_users_and_audit_logs(admin_headers):
    """Users go through a separate hash-aware migration, and audit-trail
    collections aren't needed for disaster-recovery."""
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    assert r.status_code == 200
    cols = r.json()["collections"]
    for forbidden in (
        "users", "vaccine_dismissals",
        "notification_log", "commands", "system_runs",
    ):
        assert forbidden not in cols, f"{forbidden} must not be in standard backup"


def test_restore_accepts_legacy_v1_backup(admin_headers):
    """A v1 snapshot (only 9 collections) must still restore without an
    'Unsupported backup version' 400 — older user backups must keep working."""
    legacy_payload = {
        "version": 1,
        "exported_at": "2026-01-01T00:00:00Z",
        "collections": {
            # Send empty arrays so we don't mutate real data
            "clients": [], "dogs": [], "bookings": [], "incidents": [],
            "homework": [], "waiver_signatures": [], "settings": [],
            "expenses": [], "retail_sales": [],
        },
        "mode": "merge",
    }
    r = requests.post(f"{BASE}/api/backup/restore", json=legacy_payload, headers=admin_headers, timeout=30)
    assert r.status_code == 200, f"legacy v1 backup rejected: {r.text}"
    assert r.json()["ok"] is True


def test_restore_rejects_future_version(admin_headers):
    """A backup from a NEWER server version should be politely rejected."""
    r = requests.post(
        f"{BASE}/api/backup/restore",
        json={"version": 99, "collections": {}, "mode": "merge"},
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 400
    assert "newer than this server" in r.json()["detail"].lower()
