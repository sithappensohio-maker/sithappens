"""Sprint 110av — Disk usage + Auto-backup endpoints."""
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


def test_disk_usage_returns_mountpoints():
    h = _admin()
    r = requests.get(f"{BASE}/api/admin/disk-usage", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "checked_at" in body
    rows = body["mountpoints"]
    assert isinstance(rows, list) and len(rows) > 0
    # Every row has the required usage fields
    for m in rows:
        assert {"path", "label", "fs_type", "total_bytes", "used_bytes",
                "free_bytes", "pct_used", "verdict", "likely_ephemeral"}.issubset(m.keys())
        assert 0 <= m["pct_used"] <= 100
        assert m["verdict"] in ("ok", "warn", "danger")


def test_auto_backup_config_round_trip():
    h = _admin()
    # GET seeds defaults
    cfg = requests.get(f"{BASE}/api/admin/auto-backup/config", headers=h, timeout=15).json()
    assert "enabled" in cfg and "hour" in cfg and "path" in cfg and "retain_days" in cfg
    # PUT a new config
    new = {"enabled": True, "hour": 4, "minute": 15, "retain_days": 14}
    r = requests.put(f"{BASE}/api/admin/auto-backup/config", json=new, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["enabled"] is True
    assert updated["hour"] == 4
    assert updated["minute"] == 15
    assert updated["retain_days"] == 14
    # Restore prior settings (disable so we don't run nightly in tests)
    requests.put(f"{BASE}/api/admin/auto-backup/config",
                 json={"enabled": False}, headers=h, timeout=15)


def test_auto_backup_run_now_writes_file():
    h = _admin()
    r = requests.post(f"{BASE}/api/admin/auto-backup/run-now", headers=h, timeout=60)
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["ok"] is True
    assert run["size_bytes"] > 0
    assert run["collections"] > 0
    assert run["total_docs"] > 0
    assert run["trigger"] == "manual"
    assert run["path"] and run["path"].endswith(".json.gz")
    # Check history endpoint surfaces this run
    runs = requests.get(f"{BASE}/api/admin/auto-backup/runs?limit=5",
                        headers=h, timeout=15).json()
    assert any(r2["id"] == run["id"] for r2 in runs)
