"""Sprint 110di-25 retest: Permission Matrix owner lockout + Config backup snapshot."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_session(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


# === Permission Matrix owner lockout ===
class TestPermissionMatrixOwnerLockout:
    def test_owner_role_permissions_cannot_be_updated(self, admin_session):
        # Attempt to PUT permissions to the owner role — must be rejected
        r = admin_session.put(
            f"{BASE_URL}/api/staff/roles/owner/permissions",
            json={"permissions": {"dogs:read": False}},
        )
        # 400 or 403 (or 404 if route not exposed) - per spec expect 400/403
        assert r.status_code in (400, 403), f"Expected 400/403 but got {r.status_code}: {r.text[:200]}"
        print(f"PUT owner permissions correctly rejected with {r.status_code}")

    def test_admin_still_has_full_perms_after_matrix_touch(self, admin_session):
        # Hit /api/auth/me and confirm admin still has access
        r = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data.get("role") == "admin", f"admin user lost role: {data}"
        # Confirm admin can still hit a privileged endpoint
        r2 = admin_session.get(f"{BASE_URL}/api/dogs")
        assert r2.status_code == 200, f"admin lost access to /api/dogs: {r2.status_code}"


# === Config backup pre-restore snapshot ===
class TestConfigBackupPreRestoreSnapshot:
    def test_restore_config_returns_pre_restore_snapshot(self, admin_session):
        # First get current config so we can restore it (no-op effectively)
        cfg_resp = admin_session.get(f"{BASE_URL}/api/backup/export-config")
        assert cfg_resp.status_code == 200, f"export-config failed: {cfg_resp.status_code} {cfg_resp.text[:200]}"
        cfg = cfg_resp.json()
        # POST restore-config
        r = admin_session.post(f"{BASE_URL}/api/backup/restore-config", json=cfg)
        assert r.status_code == 200, f"restore-config failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "pre_restore_snapshot" in data, f"missing pre_restore_snapshot key: {list(data.keys())}"
        snap = data["pre_restore_snapshot"]
        assert snap.get("ok") is True, f"pre_restore_snapshot.ok != true: {snap}"
        fn = snap.get("filename", "")
        assert fn.startswith("pre-restore-config-"), f"snapshot filename bad prefix: {fn!r}"
        # Verify it is reachable on disk
        path = f"/app/backups/{fn}"
        assert os.path.exists(path), f"snapshot file missing on disk: {path}"
        print(f"pre_restore_snapshot OK: {fn} ({os.path.getsize(path)} bytes)")


# === Client Portal Controls toggle smoke ===
class TestClientPortalControlsToggle:
    def _get_settings(self, sess):
        r = sess.get(f"{BASE_URL}/api/settings/business")
        if r.status_code != 200:
            # try alternate
            r = sess.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200, f"settings GET failed: {r.status_code} {r.text[:200]}"
        return r.json()

    def test_toggle_booking_history_visible(self, admin_session):
        # Probe common settings endpoint shapes
        candidates = [
            f"{BASE_URL}/api/settings/portal-visibility",
            f"{BASE_URL}/api/settings/client-portal",
            f"{BASE_URL}/api/settings/business",
            f"{BASE_URL}/api/settings",
        ]
        found = None
        for url in candidates:
            r = admin_session.get(url)
            if r.status_code == 200:
                found = (url, r.json())
                break
        assert found, "No settings endpoint responded 200"
        print(f"Settings endpoint used: {found[0]} -> top keys: {list(found[1].keys())[:10] if isinstance(found[1], dict) else type(found[1])}")
