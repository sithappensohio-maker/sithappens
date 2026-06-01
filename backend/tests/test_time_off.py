"""Employee time-off requests + admin approval flow."""
import os
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _clean_all(h):
    """Cancel any stray pending requests so each test starts clean."""
    rows = requests.get(f"{BASE}/api/admin/time-off", headers=h, timeout=15).json()["requests"]
    for r in rows:
        if r["status"] == "pending":
            requests.delete(f"{BASE}/api/employee/time-off/{r['id']}", headers=h, timeout=15)


def test_submit_and_list_my_time_off():
    h = _admin()
    _clean_all(h)
    r = requests.post(f"{BASE}/api/employee/time-off", headers=h,
                      json={"start_date": "2026-08-01", "end_date": "2026-08-05",
                            "request_type": "vacation", "reason": "Family wedding"}, timeout=15)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert r.json()["status"] == "pending"

    rows = requests.get(f"{BASE}/api/employee/time-off", headers=h, timeout=15).json()
    assert any(x["id"] == rid for x in rows["requests"])

    # Cleanup
    requests.delete(f"{BASE}/api/employee/time-off/{rid}", headers=h, timeout=15)


def test_submit_validations():
    h = _admin()
    # bad date order
    r = requests.post(f"{BASE}/api/employee/time-off", headers=h,
                      json={"start_date": "2026-08-10", "end_date": "2026-08-01"}, timeout=15)
    assert r.status_code == 400
    # bad request_type
    r = requests.post(f"{BASE}/api/employee/time-off", headers=h,
                      json={"start_date": "2026-08-01", "end_date": "2026-08-02",
                            "request_type": "junk"}, timeout=15)
    assert r.status_code == 400


def test_admin_approve_flow():
    h = _admin()
    _clean_all(h)
    r = requests.post(f"{BASE}/api/employee/time-off", headers=h,
                      json={"start_date": "2026-09-01", "end_date": "2026-09-02",
                            "request_type": "sick"}, timeout=15)
    rid = r.json()["id"]
    # Approve
    r = requests.put(f"{BASE}/api/admin/time-off/{rid}", headers=h,
                     json={"status": "approved", "admin_notes": "ok"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    assert r.json()["admin_notes"] == "ok"

    # Can't cancel an approved request from employee side
    r = requests.delete(f"{BASE}/api/employee/time-off/{rid}", headers=h, timeout=15)
    assert r.status_code == 400


def test_admin_reject_flow():
    h = _admin()
    _clean_all(h)
    r = requests.post(f"{BASE}/api/employee/time-off", headers=h,
                      json={"start_date": "2026-10-01", "end_date": "2026-10-02"}, timeout=15)
    rid = r.json()["id"]
    r = requests.put(f"{BASE}/api/admin/time-off/{rid}", headers=h,
                     json={"status": "rejected", "admin_notes": "Peak season"}, timeout=15)
    assert r.json()["status"] == "rejected"


def test_admin_filter_by_status():
    h = _admin()
    _clean_all(h)
    requests.post(f"{BASE}/api/employee/time-off", headers=h,
                  json={"start_date": "2026-11-01", "end_date": "2026-11-02"}, timeout=15)
    pending = requests.get(f"{BASE}/api/admin/time-off?status=pending", headers=h, timeout=15).json()
    assert pending["pending_count"] >= 1
    bad = requests.get(f"{BASE}/api/admin/time-off?status=banana", headers=h, timeout=15)
    assert bad.status_code == 400
    _clean_all(h)


def test_time_off_requires_auth():
    r = requests.get(f"{BASE}/api/employee/time-off", timeout=15)
    assert r.status_code in (401, 403)
    r = requests.put(f"{BASE}/api/admin/time-off/anyid",
                     json={"status": "approved"}, timeout=15)
    assert r.status_code in (401, 403)
