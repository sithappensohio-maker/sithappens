"""Sprint 110ad — Regression for the "save daily tracker as template, then
assign from template, lose tracker UX" bug.

When the user saved a daily-tracker plan as a template and reassigned it
through the picker, the new homework instance came back with
`daily_tracker=False` (default) and `total_days=0`. That made the portal
render it as a session-log style template instead of the day-pip / Today's
plan tracker UX.
"""
import os
import uuid
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
def a_dog(admin_headers):
    r = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15)
    r.raise_for_status()
    for d in r.json():
        if d.get("owner_id"):
            return d
    pytest.skip("no dogs with owners on file")


def test_save_tracker_as_template_then_assign_keeps_daily_tracker(admin_headers, a_dog):
    template_name = f"PYTEST DT Template {uuid.uuid4().hex[:6]}"
    # 1) Build a daily tracker AND save it as a template in one call.
    body = {
        "dog_id": a_dog["id"],
        "title": "Original DT plan",
        "instructions": "Pytest tracker w/ save-as-template",
        "days": [
            {"day_number": i, "day_focus": f"Day {i} focus", "instructions": "",
             "fields": [{"id": f"sets-{i}", "label": "Sets", "kind": "sets"}]}
            for i in range(1, 4)
        ],
        "save_as_template": True,
        "template_name": template_name,
    }
    r = requests.post(f"{BASE}/api/homework/daily-tracker", headers=admin_headers, json=body, timeout=20)
    assert r.status_code == 200, r.text
    original_hw = r.json()
    try:
        assert original_hw.get("daily_tracker") is True
        # 2) Find the saved template by name.
        r = requests.get(f"{BASE}/api/homework-templates", headers=admin_headers, timeout=15)
        tpls = r.json()
        tpl = next((t for t in tpls if t.get("name") == template_name), None)
        assert tpl is not None, "Saved template should exist in catalog"
        assert tpl.get("daily_tracker") is True, "Template should carry daily_tracker flag"
        assert len(tpl.get("sections") or []) == 3
        try:
            # 3) Assign FROM the template — this was the broken path.
            r = requests.post(
                f"{BASE}/api/homework/from-template",
                headers=admin_headers,
                json={"dog_id": a_dog["id"], "template_id": tpl["id"]},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            assigned = r.json()
            assigned_id = assigned["id"]
            try:
                # 4) The new instance MUST be a daily tracker — that's the bug fix.
                assert assigned.get("daily_tracker") is True, (
                    "ASSIGNED HOMEWORK MUST BE A DAILY TRACKER (was the bug — see screenshots)"
                )
                assert int(assigned.get("total_days") or 0) == 3
                # 5) GET the homework and confirm `daily_progress` is computed
                # (only present on daily-tracker plans).
                r = requests.get(f"{BASE}/api/homework/{assigned_id}", headers=admin_headers, timeout=15)
                full = r.json()
                assert "daily_progress" in full, "daily_progress must be present (tracker UX)"
                assert len(full["daily_progress"]) == 3
                statuses = [p["status"] for p in full["daily_progress"]]
                assert statuses == ["available", "locked", "locked"], statuses
            finally:
                requests.delete(f"{BASE}/api/homework/{assigned_id}", headers=admin_headers)
        finally:
            requests.delete(f"{BASE}/api/homework-templates/{tpl['id']}", headers=admin_headers)
    finally:
        requests.delete(f"{BASE}/api/homework/{original_hw['id']}", headers=admin_headers)
