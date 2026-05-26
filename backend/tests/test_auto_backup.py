"""Sprint 108 — Automated backups to an external disk."""
import os
import shutil
import gzip
import json
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def backup_dir(tmp_path_factory):
    # NOTE: tests run on the SAME server as the backend, so this local path
    # is writable by both. (If running tests from outside, set TEST_BACKUP_DIR.)
    p = os.environ.get("TEST_BACKUP_DIR") or str(tmp_path_factory.mktemp("backups"))
    # Make sure backend can see it — the kubernetes/docker pod backend writes to
    # whatever path we give it. /tmp works in both cases.
    if not p.startswith("/tmp"):
        p = "/tmp/sprint108-backups"
    os.makedirs(p, exist_ok=True)
    yield p
    shutil.rmtree(p, ignore_errors=True)


@pytest.fixture
def configure_backup(admin_headers, backup_dir):
    """Set the backup config to point at `backup_dir`, restore original on exit."""
    orig = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "auto_backup_enabled": True,
        "auto_backup_path": backup_dir,
        "auto_backup_hour": 3,
        "auto_backup_retention_days": 14,
    }, timeout=15)
    yield backup_dir
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "auto_backup_enabled": bool(orig.get("auto_backup_enabled")),
        "auto_backup_path": orig.get("auto_backup_path") or "",
        "auto_backup_hour": orig.get("auto_backup_hour") if isinstance(orig.get("auto_backup_hour"), int) else 3,
        "auto_backup_retention_days": orig.get("auto_backup_retention_days") or 14,
    }, timeout=15)


def test_settings_persist_backup_config(admin_headers, configure_backup):
    s = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
    assert s["auto_backup_enabled"] is True
    assert s["auto_backup_path"] == configure_backup
    assert s["auto_backup_hour"] == 3
    assert s["auto_backup_retention_days"] == 14


def test_run_now_writes_file(admin_headers, configure_backup):
    r = requests.post(f"{BASE}/api/admin/backup/run-now", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("sent") == 1, f"backup not written: {data}"
    assert data["path"].startswith(configure_backup)
    assert data["bytes"] > 0
    assert data["doc_count"] > 0
    # File actually exists and is a valid gzipped JSON
    files = [f for f in os.listdir(configure_backup) if f.endswith(".json.gz")]
    assert files, f"no .json.gz in {configure_backup}"
    target = os.path.join(configure_backup, files[-1])
    with gzip.open(target, "rb") as f:
        parsed = json.loads(f.read())
    assert parsed["version"] == 1
    assert "collections" in parsed
    assert "settings" in parsed["collections"]
    # The backup is "everything" — settings + users + clients all present
    assert "users" in parsed["collections"]
    assert "clients" in parsed["collections"]


def test_run_now_admin_only():
    r = requests.post(f"{BASE}/api/admin/backup/run-now", timeout=15)
    assert r.status_code in (401, 403)


def test_status_returns_last_run(admin_headers, configure_backup):
    # Fire one
    requests.post(f"{BASE}/api/admin/backup/run-now", headers=admin_headers, timeout=60)
    r = requests.get(f"{BASE}/api/admin/backup/status", headers=admin_headers, timeout=15).json()
    assert r["last"] is not None
    assert r["last"]["sent"] == 1
    assert r["last"]["path"].startswith(configure_backup)
    assert isinstance(r["history"], list)


def test_run_now_with_bad_path_returns_error(admin_headers):
    """Pointing at a path that can't be created should return a clean error."""
    orig = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
    requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
        "auto_backup_enabled": True,
        "auto_backup_path": "/dev/null/sub/dir",  # invalid
        "auto_backup_hour": 3,
        "auto_backup_retention_days": 14,
    }, timeout=15)
    try:
        r = requests.post(f"{BASE}/api/admin/backup/run-now", headers=admin_headers, timeout=30)
        data = r.json()
        assert data.get("sent") == 0
        assert "error" in data
        assert "unusable" in data["error"].lower() or "permission" in data["error"].lower() or "not" in data["error"].lower()
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={
            "auto_backup_enabled": bool(orig.get("auto_backup_enabled")),
            "auto_backup_path": orig.get("auto_backup_path") or "",
        }, timeout=15)


def test_status_admin_only():
    r = requests.get(f"{BASE}/api/admin/backup/status", timeout=15)
    assert r.status_code in (401, 403)



def test_inspect_returns_diagnostics_for_writable_path(admin_headers, backup_dir):
    """Sprint 108b — POST /admin/backup/inspect must surface mountpoint,
    fs type, free space, and a write-test result so the admin can spot
    container-vs-host filesystem mismatches before scheduling backups."""
    r = requests.post(
        f"{BASE}/api/admin/backup/inspect",
        headers=admin_headers,
        json={"path": backup_dir},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["resolved"]
    assert data["mountpoint"]
    assert data["write_test"]["ok"] is True
    assert "fs_type" in data
    assert data["disk_free_bytes"] > 0
    assert data["verdict"] in ("ok", "warn", "fail")
    assert data["verdict_message"]


def test_inspect_flags_ephemeral_overlay_storage(admin_headers):
    """Pointing inspect at a path that resolves into the container's
    overlay/root filesystem must come back with verdict='warn' and the
    likely_ephemeral flag set, since files written there will NOT appear
    on the host's external drive."""
    r = requests.post(
        f"{BASE}/api/admin/backup/inspect",
        headers=admin_headers,
        json={"path": "/tmp/sprint108-inspect-ephemeral"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # We can't assert ephemeral=True in every env (developer laptops have a
    # real / on ext4), but if fs_type is overlay/tmpfs the verdict must warn.
    if data.get("fs_type") in ("overlay", "overlayfs", "tmpfs", "aufs"):
        assert data["likely_ephemeral"] is True
        assert data["verdict"] == "warn"
        assert "container" in data["verdict_message"].lower() or "ephemeral" in data["verdict_message"].lower()


def test_inspect_bad_path_reports_failure(admin_headers):
    """A path that can't be created (e.g. under /dev/null/...) must still
    return 200 with a failed write-test rather than 500-ing."""
    r = requests.post(
        f"{BASE}/api/admin/backup/inspect",
        headers=admin_headers,
        json={"path": "/dev/null/cannot/make/this"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["write_test"]["ok"] is False
    assert data["verdict"] == "fail"


def test_inspect_admin_only():
    r = requests.post(f"{BASE}/api/admin/backup/inspect", json={"path": "/tmp"}, timeout=15)
    assert r.status_code in (401, 403)


def test_run_now_response_includes_mount_diagnostics(admin_headers, configure_backup):
    """The run-now response must carry mount/fs info so the UI can render
    'this file landed on overlay (ephemeral)' or 'this file landed on
    /dev/sda1 (real disk)' next to the path."""
    r = requests.post(f"{BASE}/api/admin/backup/run-now", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("sent") == 1
    assert "mountpoint" in data
    assert "fs_type" in data
    assert "likely_ephemeral" in data
    # And the persisted "last" run carries the same fields for the Settings UI.
    s = requests.get(f"{BASE}/api/admin/backup/status", headers=admin_headers, timeout=15).json()
    assert "mountpoint" in s["last"]
    assert "fs_type" in s["last"]
