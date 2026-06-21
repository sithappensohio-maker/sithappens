"""Sprint 110di-23 — Config-only export/import.

A trimmed slice of the full backup that captures ONLY the configurability
collections (settings, app_settings, email_settings, email_templates,
payment_plan_settings). Lets the operator carry their branding/themes/
feature-flags between hosts without bundling client/dog/booking data.
"""
import os
import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))

CONFIG_COLLECTIONS = {
    "settings", "app_settings", "email_settings",
    "email_templates", "payment_plan_settings",
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


def test_export_config_shape(admin_headers):
    """The config export advertises kind='config' and version=1, and
    contains exactly the configurability collections — never any
    client/dog/booking data."""
    r = requests.get(f"{BASE}/api/backup/export-config", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["kind"] == "config"
    assert data["version"] == 1
    assert "exported_at" in data
    assert set(data["collections"].keys()) == CONFIG_COLLECTIONS
    # Make sure no client/dog/booking data leaked through.
    for forbidden in ("clients", "dogs", "bookings", "users", "incidents"):
        assert forbidden not in data["collections"]


def test_config_roundtrip(admin_headers):
    """Exporting then restoring the same config is a no-op (idempotent)."""
    r = requests.get(f"{BASE}/api/backup/export-config", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    snap = r.json()
    counts_before = {k: len(v) for k, v in snap["collections"].items()}

    r2 = requests.post(
        f"{BASE}/api/backup/restore-config",
        headers={**admin_headers, "Content-Type": "application/json"},
        json=snap,
        timeout=30,
    )
    assert r2.status_code == 200, r2.text
    out = r2.json()
    assert out["ok"] is True
    for c, expected in counts_before.items():
        assert out["summary"][c]["inserted"] == expected
        assert out["summary"][c]["mode"] == "replace"

    # Re-exporting should still produce the same row counts.
    r3 = requests.get(f"{BASE}/api/backup/export-config", headers=admin_headers, timeout=30)
    after = {k: len(v) for k, v in r3.json()["collections"].items()}
    assert after == counts_before


def test_restore_auto_writes_pre_restore_snapshot(admin_headers, tmp_path):
    """Restoring must auto-write a pre-restore safety snapshot BEFORE touching
    anything. The response surfaces the snapshot path so the UI can show it
    to the operator — they should never have to download a backup manually
    just to be safe."""
    import os
    cur = requests.get(f"{BASE}/api/backup/export-config", headers=admin_headers, timeout=30).json()
    r = requests.post(
        f"{BASE}/api/backup/restore-config",
        headers={**admin_headers, "Content-Type": "application/json"},
        json=cur,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    snap = out.get("pre_restore_snapshot")
    assert snap is not None, "restore must return pre_restore_snapshot metadata"
    assert snap.get("ok") is True, f"snapshot creation failed: {snap}"
    assert snap.get("filename", "").startswith("pre-restore-config-")
    assert snap.get("size_bytes", 0) > 0
    # On the same host, the file should physically exist.
    assert os.path.exists(snap["path"]), f"snapshot file missing: {snap['path']}"


def test_restore_rejects_full_backup(admin_headers):
    """A full backup file (kind absent, version=4) must be rejected with
    a clear 400 — protects the operator from accidentally wiping their
    configuration by uploading the wrong file."""
    full = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60).json()
    r = requests.post(
        f"{BASE}/api/backup/restore-config",
        headers={**admin_headers, "Content-Type": "application/json"},
        json=full,
        timeout=30,
    )
    assert r.status_code == 400, r.text
    assert "config export" in r.json()["detail"].lower()


def test_restore_rejects_future_version(admin_headers):
    """A config file from a newer server must be rejected so we don't
    silently drop new keys."""
    r = requests.post(
        f"{BASE}/api/backup/restore-config",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"kind": "config", "version": 99, "collections": {}},
        timeout=15,
    )
    assert r.status_code == 400, r.text
    assert "newer than this server" in r.json()["detail"]


def test_restore_ignores_unknown_collections(admin_headers):
    """Restoring a file with extra collections (e.g. someone hand-edited)
    silently ignores anything outside the config allow-list."""
    r = requests.post(
        f"{BASE}/api/backup/restore-config",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={
            "kind": "config",
            "version": 1,
            "collections": {
                "settings": [{"key": "branding", "value": {"business_name": "Roundtrip Test"}}],
                "clients": [{"id": "should-not-be-inserted"}],
                "dogs": [{"id": "ditto"}],
            },
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    # settings present in summary; clients/dogs silently skipped.
    assert "settings" in summary
    assert "clients" not in summary
    assert "dogs" not in summary
