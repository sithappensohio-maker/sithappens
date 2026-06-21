"""Employee pay history — last N weeks."""
import os
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_pay_history_shape():
    r = requests.get(f"{BASE}/api/employee/pay-history?weeks=8", headers=_admin(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("weeks", "hourly_rate", "total_hours", "total_gross", "best_week"):
        assert k in body
    assert len(body["weeks"]) == 8
    for w in body["weeks"]:
        for key in ("week_start", "week_end", "hours", "gross", "days_worked"):
            assert key in w


def test_pay_history_weeks_clamped():
    # Below 1 → 1, above 52 → 52
    high = requests.get(f"{BASE}/api/employee/pay-history?weeks=999", headers=_admin(), timeout=15).json()
    assert len(high["weeks"]) == 52
    low = requests.get(f"{BASE}/api/employee/pay-history?weeks=0", headers=_admin(), timeout=15).json()
    assert len(low["weeks"]) == 1


def test_pay_history_chronological():
    body = requests.get(f"{BASE}/api/employee/pay-history?weeks=6", headers=_admin(), timeout=15).json()
    starts = [w["week_start"] for w in body["weeks"]]
    assert starts == sorted(starts), "weeks should be oldest → newest"


def test_pay_history_requires_auth():
    r = requests.get(f"{BASE}/api/employee/pay-history", timeout=15)
    assert r.status_code in (401, 403)
