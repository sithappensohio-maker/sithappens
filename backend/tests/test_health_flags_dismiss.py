"""Regression test for the Dashboard 'Health Flags' counter / Vaccine Alerts list bug.

BUG: When the admin dismissed a vaccine alert from the Vaccine Center modal,
the count of dogs on the list shrank but the Dashboard's "Health Flags" stat
tile did NOT decrease (because the counter ignored vaccine_dismissals).
FIX: /api/dashboard/stats now applies the same active-dismissal filter as
/api/vaccine-alerts so they stay in lock-step.
"""
import os
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


def test_dismissing_alert_decrements_health_flags(admin_headers):
    """Dismissing a vaccine alert must drop health_flags by exactly 1 AND
    drop the dog out of /api/vaccine-alerts."""
    # Baseline
    stats = requests.get(f"{BASE}/api/dashboard/stats", headers=admin_headers, timeout=15).json()
    alerts = requests.get(f"{BASE}/api/vaccine-alerts", headers=admin_headers, timeout=15).json()
    if not alerts:
        pytest.skip("no vaccine alerts to test against in this environment")
    base_flags = stats["health_flags"]
    base_alerts = len(alerts)
    dog_id = alerts[0]["dog_id"]

    try:
        # Dismiss
        r = requests.post(f"{BASE}/api/vaccine-alerts/{dog_id}/dismiss", headers=admin_headers, timeout=10)
        assert r.status_code == 200

        # Re-check
        stats2 = requests.get(f"{BASE}/api/dashboard/stats", headers=admin_headers, timeout=15).json()
        alerts2 = requests.get(f"{BASE}/api/vaccine-alerts", headers=admin_headers, timeout=15).json()
        assert stats2["health_flags"] == base_flags - 1, (
            f"Expected health_flags to drop from {base_flags} to {base_flags-1}, got {stats2['health_flags']}"
        )
        assert len(alerts2) == base_alerts - 1
        assert all(a["dog_id"] != dog_id for a in alerts2)
    finally:
        # Best-effort cleanup: remove the dismissal so the dog reappears on the list
        # (we don't have a public endpoint for this, so we use a side-door query).
        # If pymongo is unavailable, we just leave the dismissal — it expires in 30 days.
        try:
            import sys
            sys.path.insert(0, "/app/backend")
            from dotenv import load_dotenv
            load_dotenv("/app/backend/.env")
            from motor.motor_asyncio import AsyncIOMotorClient
            import asyncio
            async def _restore():
                c = AsyncIOMotorClient(os.environ["MONGO_URL"])
                db = c[os.environ["DB_NAME"]]
                await db.vaccine_dismissals.delete_one({"dog_id": dog_id})
            asyncio.run(_restore())
        except Exception:
            pass
