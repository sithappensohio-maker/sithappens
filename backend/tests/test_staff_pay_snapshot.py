"""Sprint 110bb — Admin Staff list pay snapshot."""
import os
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_pay_snapshot_payload_shape():
    r = requests.get(f"{BASE}/api/admin/staff/pay-snapshot", headers=_admin(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "snapshot" in body and "totals" in body
    for s in body["snapshot"]:
        for key in ("user_id", "name", "hourly_rate",
                    "this_week_hours", "this_week_gross",
                    "last_week_hours", "last_week_gross",
                    "ytd_hours", "ytd_gross", "live"):
            assert key in s, f"missing {key}"
    for key in ("this_week_hours", "this_week_gross", "ytd_gross",
                "currently_clocked_in", "week_start", "week_end"):
        assert key in body["totals"], f"totals missing {key}"


def test_pay_snapshot_only_includes_active_employees():
    rows = requests.get(f"{BASE}/api/admin/employees", headers=_admin(), timeout=15).json()
    active_ids = {e["id"] for e in rows if e.get("active", True)}
    snap = requests.get(f"{BASE}/api/admin/staff/pay-snapshot", headers=_admin(), timeout=15).json()
    snap_ids = {s["user_id"] for s in snap["snapshot"]}
    assert snap_ids.issubset(active_ids), "snapshot must not include inactive users"


def test_pay_snapshot_includes_live_block_when_clocked_in():
    """Sanity: structure of the live block when clocked in matches the docs."""
    snap = requests.get(f"{BASE}/api/admin/staff/pay-snapshot", headers=_admin(), timeout=15).json()
    for s in snap["snapshot"]:
        if s["live"]:
            assert "hours_so_far" in s["live"] and "gross_so_far" in s["live"]
            return
    # No one clocked in is fine — sanity test
