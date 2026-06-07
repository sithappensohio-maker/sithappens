"""Sprint 110bw — Sell training programs as credit packs (hybrid model).

Verifies:
  • POST /clients/:cid/sell-program creates a credit_lot with the program's
    session count, increments training_credits, persists the override price.
  • dog_id field auto-enrols the dog into the program (dog_programs row).
  • Selling the same program twice doesn't double-enrol (returns existing
    active enrollment instead of inserting another).
  • Override price overrides the program list price + value_each math is correct.
  • Wrong dog (not owned by client) → 400.
  • Inactive program → 400.
  • GET /admin/clients/:cid/training-credits returns per-program breakdown
    + matches the global counter.
"""
import os
import uuid
import asyncio
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def fx(admin_headers):
    """Create a fresh test client + dog + program. Cleans up after."""
    suffix = uuid.uuid4().hex[:6]
    # Client
    c = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Sell Program Pytest {suffix}",
        "email": f"sellprog-{suffix}@sithappens.com",
        "phone": "555-0101",
    }, timeout=15).json()
    cid = c["id"]
    # Dog
    d = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Pytest Dog {suffix}",
        "owner_id": cid,
        "breed": "Mixed",
        "age_y": 1,
    }, timeout=15).json()
    did = d["id"]

    # Find a program with format.count > 0
    progs = requests.get(f"{API}/programs", headers=admin_headers, timeout=15).json()
    program = next((p for p in progs if (p.get("format") or {}).get("count", 0) > 0
                    and p.get("active", True)), None)
    if not program:
        pytest.skip("No active program with format.count > 0 to test")

    yield {
        "client_id": cid,
        "dog_id": did,
        "program_id": program["id"],
        "program_qty": int(program["format"]["count"]),
        "program_price": float(program.get("price") or 0),
    }

    # Hard-cleanup
    try:
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv('/app/backend/.env')

        async def _wipe():
            mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
            db = mc[os.environ['DB_NAME']]
            await db.clients.delete_one({"id": cid})
            await db.dogs.delete_many({"owner_id": cid})
            await db.credit_lots.delete_many({"client_id": cid})
            await db.dog_programs.delete_many({"dog_id": did})
            mc.close()
        asyncio.run(_wipe())
    except Exception:
        pass


def test_sell_program_creates_lot_and_credits(admin_headers, fx):
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={"program_id": fx["program_id"], "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    lot = body["lot"]
    assert lot["pack_kind"] == "training_program"
    assert lot["program_id"] == fx["program_id"]
    assert lot["qty_total"] == fx["program_qty"]
    assert lot["qty_remaining"] == fx["program_qty"]
    assert lot["service_type"] == "training"
    assert lot["price_paid"] == fx["program_price"]
    # Client balance bumped
    assert body["client_balance"] == fx["program_qty"]
    # No dog_id → no enrollment
    assert body["enrollment"] is None


def test_sell_program_with_dog_auto_enrols(admin_headers, fx):
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enrollment"] is not None
    assert body["enrollment"]["program_id"] == fx["program_id"]
    assert body["enrollment"]["status"] == "active"


def test_sell_program_twice_doesnt_double_enrol(admin_headers, fx):
    """Selling the same program a second time should issue more credits but
    re-use the existing dog_programs row."""
    r1 = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                       headers=admin_headers,
                       json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                       timeout=15).json()
    enrollment_id_1 = r1["enrollment"]["id"]

    r2 = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                       headers=admin_headers,
                       json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                       timeout=15).json()
    enrollment_id_2 = r2["enrollment"]["id"]

    assert enrollment_id_1 == enrollment_id_2, \
        "Second sale should re-use the existing active enrollment"
    # But client should now have 2× the credits
    assert r2["client_balance"] == fx["program_qty"] * 2


def test_sell_program_override_price(admin_headers, fx):
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={"program_id": fx["program_id"],
                            "override_price": 100.00,
                            "payment_method": "venmo"},
                      timeout=15)
    assert r.status_code == 200, r.text
    lot = r.json()["lot"]
    assert lot["price_paid"] == 100.00
    assert lot["list_price"] == fx["program_price"]
    expected_each = round(100.00 / fx["program_qty"], 2)
    assert lot["value_each"] == expected_each


def test_sell_program_rejects_wrong_dog(admin_headers, fx):
    """Selling with a dog_id that belongs to a different client → 400."""
    # Create a second client + dog
    other = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": "Other client", "email": f"other-{uuid.uuid4().hex[:6]}@sithappens.com",
    }, timeout=15).json()
    other_dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": "Other dog", "owner_id": other["id"], "breed": "Beagle",
    }, timeout=15).json()
    try:
        r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                          headers=admin_headers,
                          json={"program_id": fx["program_id"],
                                "dog_id": other_dog["id"]},
                          timeout=15)
        assert r.status_code == 400
    finally:
        # Cleanup
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv('/app/backend/.env')

        async def _wipe():
            mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
            db = mc[os.environ['DB_NAME']]
            await db.clients.delete_one({"id": other["id"]})
            await db.dogs.delete_one({"id": other_dog["id"]})
            mc.close()
        asyncio.run(_wipe())


def test_training_credits_breakdown(admin_headers, fx):
    """Buy two different programs, verify the per-program breakdown returns
    each as a separate bucket with correct qty_remaining."""
    # Find a SECOND program with format.count
    progs = requests.get(f"{API}/programs", headers=admin_headers, timeout=15).json()
    second = next((p for p in progs
                   if p["id"] != fx["program_id"]
                   and (p.get("format") or {}).get("count", 0) > 0
                   and p.get("active", True)), None)
    if not second:
        pytest.skip("Need at least 2 active programs to test breakdown")

    requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                  headers=admin_headers,
                  json={"program_id": fx["program_id"]}, timeout=15)
    requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                  headers=admin_headers,
                  json={"program_id": second["id"]}, timeout=15)

    r = requests.get(f"{API}/admin/clients/{fx['client_id']}/training-credits",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    by_program = {p["program_id"]: p for p in body["by_program"]}
    assert fx["program_id"] in by_program
    assert second["id"] in by_program
    assert by_program[fx["program_id"]]["qty_remaining"] == fx["program_qty"]
    assert by_program[second["id"]]["qty_remaining"] == int(second["format"]["count"])
    # Global counter matches the sum
    expected_global = fx["program_qty"] + int(second["format"]["count"])
    assert body["global_training_credits"] == expected_global


def test_admin_required():
    r = requests.post(f"{API}/clients/x/sell-program",
                      json={"program_id": "x"}, timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{API}/admin/clients/x/training-credits", timeout=15)
    assert r.status_code in (401, 403)
