"""Sprint 110di-64 — Weekly lesson-plan pointer per dog enrollment.

The user's request was a trainer-side "what week am I on" tracker for each
dog's program. We reuse the existing `modules` array on a program as the
ordered list of weekly lessons (module #1 = week 1, etc.) and store
`current_module_id` on the enrollment document so the trainer can bump the
pointer forward without touching the rest of the goal-tracking system.
"""

import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")


def _login(email="admin@sithappens.com", password="admin123"):
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


def _admin():
    return _login()


def _make_program_with_modules(headers, *, name="Pytest Weekly Plan"):
    body = {
        "name": name, "type": "private_lessons", "description": "test",
        "format": {"count": 4, "unit": "sessions"}, "price": 100,
        "modules": [
            {"name": "Week 1 — Foundations", "description": "Calm intro", "order": 0,
             "goals": [{"name": "Sit"}, {"name": "Down"}]},
            {"name": "Week 2 — Loose Leash", "description": "Short loops", "order": 1,
             "goals": [{"name": "Heel 5 steps"}, {"name": "Turn left"}]},
            {"name": "Week 3 — Stay Duration", "description": "Build to 60s", "order": 2,
             "goals": [{"name": "Sit-stay 30s"}, {"name": "Down-stay 60s"}]},
        ],
    }
    r = requests.post(f"{BASE}/api/programs", headers=headers, json=body, timeout=15)
    r.raise_for_status()
    return r.json()


def _pick_dog(headers):
    dogs = requests.get(f"{BASE}/api/dogs?include_inactive=true", headers=headers, timeout=15).json()
    # Prefer a dog that already has a client so we don't trip any orphan-dog guards
    return next((d for d in dogs if d.get("client_id")), dogs[0])


def test_enrollment_seeds_first_module_and_week():
    H = _admin()
    prog = _make_program_with_modules(H, name="Pytest Seed Week")
    dog = _pick_dog(H)
    try:
        enr = requests.post(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H,
                            json={"program_id": prog["id"]}, timeout=15).json()
        assert enr["total_weeks"] == 3, enr
        assert enr["current_week"] == 1, enr
        assert enr["current_module"]["id"] == prog["modules"][0]["id"], enr
    finally:
        # Cleanup
        try:
            requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}",
                         headers=H, json={"status": "withdrawn"}, timeout=15)
        except Exception:
            pass
        requests.delete(f"{BASE}/api/programs/{prog['id']}", headers=H, timeout=15)


def test_set_current_module_bumps_week_pointer():
    H = _admin()
    prog = _make_program_with_modules(H, name="Pytest Bump Week")
    dog = _pick_dog(H)
    try:
        enr = requests.post(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H,
                            json={"program_id": prog["id"]}, timeout=15).json()
        mid2 = prog["modules"][1]["id"]
        r = requests.put(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/current-module",
            headers=H, json={"module_id": mid2}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["current_week"] == 2
        assert body["current_module"]["id"] == mid2
        # Pointer must persist across reload
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        found = next(e for e in listing if e["id"] == enr["id"])
        assert found["current_week"] == 2
    finally:
        try:
            requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}",
                         headers=H, json={"status": "withdrawn"}, timeout=15)
        except Exception:
            pass
        requests.delete(f"{BASE}/api/programs/{prog['id']}", headers=H, timeout=15)


def test_set_current_module_rejects_alien_module_id():
    """Cannot point at a module that doesn't belong to this enrollment's snapshot."""
    H = _admin()
    prog = _make_program_with_modules(H, name="Pytest Alien Module")
    dog = _pick_dog(H)
    try:
        enr = requests.post(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H,
                            json={"program_id": prog["id"]}, timeout=15).json()
        r = requests.put(
            f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}/current-module",
            headers=H, json={"module_id": "definitely-not-a-real-id"}, timeout=15,
        )
        assert r.status_code == 404, r.text
    finally:
        try:
            requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}",
                         headers=H, json={"status": "withdrawn"}, timeout=15)
        except Exception:
            pass
        requests.delete(f"{BASE}/api/programs/{prog['id']}", headers=H, timeout=15)


def test_summary_includes_week_pointer_fields():
    """The /dogs/{id}/programs listing must expose the new fields the UI needs:
    total_weeks, current_week, current_module."""
    H = _admin()
    prog = _make_program_with_modules(H, name="Pytest Summary Fields")
    dog = _pick_dog(H)
    try:
        enr = requests.post(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H,
                            json={"program_id": prog["id"]}, timeout=15).json()
        listing = requests.get(f"{BASE}/api/dogs/{dog['id']}/programs", headers=H, timeout=15).json()
        found = next(e for e in listing if e["id"] == enr["id"])
        for key in ("total_weeks", "current_week", "current_module"):
            assert key in found, f"missing {key} in enrollment summary"
    finally:
        try:
            requests.put(f"{BASE}/api/dogs/{dog['id']}/programs/{enr['id']}",
                         headers=H, json={"status": "withdrawn"}, timeout=15)
        except Exception:
            pass
        requests.delete(f"{BASE}/api/programs/{prog['id']}", headers=H, timeout=15)
