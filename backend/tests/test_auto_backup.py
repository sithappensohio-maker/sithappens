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
