"""
Iteration 13 — Sprint 17 regression checks:
- register flow still emails (smoke; logs Resend ID)
- enrollment auto-complete on last goal score=5
- bulk sell-packs returns receipt
- GET /api/clients/{id}/receipts grouped shape
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"

BUDDY_ID = "a1e63d21-2d4b-444f-8286-56f3324c4401"
ALEX_CLIENT_ID = "b3488337-bb4a-4bdd-9aa9-e55cba57b478"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --- 1. Email service smoke via register ---
def test_register_sends_email_no_crash():
    """Register a fresh client and ensure response is 200 (email_service must not crash on the new QR footer)."""
    email = f"TEST_iter13_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "test1234", "name": "Iter13 Tester"},
                      timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    assert data["user"]["email"].lower() == email.lower()


# --- 2. Auto-complete enrollment when all goals score=5 ---
def test_enroll_buddy_auto_completes(hdr):
    # Find a program with goals
    progs = requests.get(f"{API}/programs", headers=hdr, timeout=15).json()
    assert isinstance(progs, list) and progs, "No programs seeded"
    program = None
    for p in progs:
        # need at least 1 module with at least 1 goal
        total_goals = sum(len(m.get("goals") or []) for m in (p.get("modules") or []))
        if total_goals >= 1:
            program = p
            break
    assert program is not None, "No program with goals"

    # Ensure Buddy has no active enrollment for this program — clean prior test runs first
    existing = requests.get(f"{API}/dogs/{BUDDY_ID}/programs", headers=hdr, timeout=15).json()
    for e in existing:
        if e.get("status") == "active":
            # Cancel any active enrollment first
            requests.delete(f"{API}/dogs/{BUDDY_ID}/programs/{e['id']}", headers=hdr, timeout=15)

    # Enroll Buddy
    body = {"program_id": program["id"],
            "completion_rule": {"type": "all_mastered"}}
    r = requests.post(f"{API}/dogs/{BUDDY_ID}/programs", headers=hdr, json=body, timeout=15)
    assert r.status_code == 200, r.text
    enrollment = r.json()
    enr_id = enrollment["id"]
    assert enrollment["status"] == "active"

    # Iterate every goal and PUT score=5
    modules = enrollment.get("program_snapshot", {}).get("modules") or []
    goal_ids = [g["id"] for m in modules for g in (m.get("goals") or [])]
    assert len(goal_ids) >= 1

    for gid in goal_ids:
        r2 = requests.put(
            f"{API}/dogs/{BUDDY_ID}/programs/{enr_id}/goals/{gid}",
            headers=hdr, json={"score": 5}, timeout=15)
        assert r2.status_code == 200, r2.text

    # After the LAST goal is set to 5, status should be completed
    listing = requests.get(f"{API}/dogs/{BUDDY_ID}/programs", headers=hdr, timeout=15).json()
    target = next((e for e in listing if e["id"] == enr_id), None)
    assert target is not None
    assert target["status"] == "completed", f"Expected completed, got {target['status']} — full: {target}"
    assert target.get("auto_completed") is True
    assert target.get("completed_at")

    # Cleanup — delete this enrollment and restore active_program_id to None
    try:
        # Backend may or may not expose a hard delete; use direct mongo via debug if available, else soft
        requests.delete(f"{API}/dogs/{BUDDY_ID}/programs/{enr_id}",
                        headers=hdr, timeout=10)
    except Exception:
        pass


# --- 3. Bulk sell-packs ---
def test_bulk_sell_packs_returns_receipt(hdr):
    packs = requests.get(f"{API}/credit-packs", headers=hdr, timeout=15).json()
    assert isinstance(packs, list) and len(packs) >= 1, "No active credit packs seeded"
    # Take up to 2 distinct packs
    pack_ids = [p["id"] for p in packs[:2]]
    items = [{"pack_id": pid, "quantity": 1} for pid in pack_ids]
    body = {"items": items, "payment_method": "cash", "note": "TEST_iter13_bulk"}
    r = requests.post(f"{API}/clients/{ALEX_CLIENT_ID}/sell-packs",
                      headers=hdr, json=body, timeout=15)
    assert r.status_code == 200, r.text
    payload = r.json()
    # bulk endpoint returns {lots, lots_created, receipt:{...}, total_price}
    assert "lots" in payload and isinstance(payload["lots"], list)
    assert payload.get("lots_created") == len(items)
    receipt = payload.get("receipt") or {}
    assert "lines" in receipt and isinstance(receipt["lines"], list)
    assert "totals" in receipt
    assert receipt.get("payment_method") == "cash"
    assert "total_price" in payload or "total_price" in receipt


# --- 4. Receipts list endpoint shape ---
def test_list_client_receipts_shape(hdr):
    r = requests.get(f"{API}/clients/{ALEX_CLIENT_ID}/receipts",
                     headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    receipts = r.json()
    assert isinstance(receipts, list), f"Expected list, got {type(receipts)}"
    if not receipts:
        pytest.skip("Alex has no receipts yet")
    sample = receipts[0]
    # Match actual server shape — total_price/lot_count/line_count are TOP level (not inside totals)
    assert "sold_at" in sample
    assert "payment_method" in sample
    assert "lines" in sample and isinstance(sample["lines"], list)
    assert "totals" in sample and isinstance(sample["totals"], dict)
    assert "daycare" in sample["totals"] and "training" in sample["totals"]
    assert "qty" in sample["totals"]["daycare"] and "price" in sample["totals"]["daycare"]
    # Top-level aggregates
    assert "total_price" in sample
    assert "line_count" in sample
    assert "lot_count" in sample


# --- 5. Cleanup: best-effort reset for Alex client credits & test lots ---
def test_zz_cleanup_alex(hdr):
    # Reset credits to 10 if endpoint exists
    try:
        requests.put(f"{API}/clients/{ALEX_CLIENT_ID}",
                     headers=hdr,
                     json={"credits": 10},
                     timeout=10)
    except Exception:
        pass
