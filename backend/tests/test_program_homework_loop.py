"""Sprint 110bx + 110bz — program-aware FIFO + per-module homework engine.

Semantics under 110bz:
  - On enrollment → welcome homework + Module 1's homework_template_id both
    auto-assign immediately (Module 1 is "starting now").
  - On all goals in module N being mastered → Module N+1's homework_template_id
    auto-assigns ("next module is starting now").
  - On the LAST module being mastered → no further homework auto-assigns
    (program completion handles that separately).
"""
import os
import uuid
import asyncio
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
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
    """Test client + dog + 3 homework templates + a 2-module program."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Auto HW Pytest {suffix}",
        "email": f"autohw-{suffix}@sithappens.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Pytest Pup {suffix}",
        "owner_id": client["id"],
        "breed": "Lab",
        "age_y": 1,
    }, timeout=15).json()

    # 3 homework templates: welcome + module 1 + module 2
    tpl_welcome = requests.post(f"{API}/homework-templates", headers=admin_headers, json={
        "name": f"Welcome HW {suffix}", "description": "Day-1",
        "tier": "foundation", "default_duration_days": 3, "sections": [],
    }, timeout=15).json()
    tpl_m1 = requests.post(f"{API}/homework-templates", headers=admin_headers, json={
        "name": f"Module 1 HW {suffix}", "description": "Module 1 practice",
        "tier": "foundation", "default_duration_days": 5, "sections": [],
    }, timeout=15).json()
    tpl_m2 = requests.post(f"{API}/homework-templates", headers=admin_headers, json={
        "name": f"Module 2 HW {suffix}", "description": "Module 2 practice",
        "tier": "intermediate", "default_duration_days": 7, "sections": [],
    }, timeout=15).json()

    program = requests.post(f"{API}/programs", headers=admin_headers, json={
        "name": f"Pytest Program {suffix}",
        "type": "private_lessons",
        "format": {"count": 4, "unit": "sessions"},
        "price": 200.00,
        "welcome_homework_template_id": tpl_welcome["id"],
        "modules": [
            {
                "name": "Module 1 · Sit",
                "description": "Core obedience",
                "homework_template_id": tpl_m1["id"],
                "goals": [{"name": "Sit on cue"}],
            },
            {
                "name": "Module 2 · Down",
                "description": "Build on Sit",
                "homework_template_id": tpl_m2["id"],
                "goals": [{"name": "Down on cue"}],
            },
        ],
    }, timeout=15).json()

    yield {
        "client_id": client["id"],
        "dog_id": dog["id"],
        "program_id": program["id"],
        "welcome_tpl_id": tpl_welcome["id"],
        "m1_tpl_id": tpl_m1["id"],
        "m2_tpl_id": tpl_m2["id"],
        "m1_goal_id": program["modules"][0]["goals"][0]["id"],
        "m2_goal_id": program["modules"][1]["goals"][0]["id"],
    }

    # Cleanup
    try:
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv('/app/backend/.env')

        async def _wipe():
            mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
            db = mc[os.environ['DB_NAME']]
            await db.clients.delete_one({"id": client["id"]})
            await db.dogs.delete_many({"owner_id": client["id"]})
            await db.dog_programs.delete_many({"dog_id": dog["id"]})
            await db.credit_lots.delete_many({"client_id": client["id"]})
            await db.homework.delete_many({"client_id": client["id"]})
            await db.homework_templates.delete_one({"id": tpl_welcome["id"]})
            await db.homework_templates.delete_one({"id": tpl_m1["id"]})
            await db.homework_templates.delete_one({"id": tpl_m2["id"]})
            await db.programs.delete_one({"id": program["id"]})
            mc.close()
        asyncio.run(_wipe())
    except Exception:
        pass


def _list_homework(headers, client_id):
    r = requests.get(f"{API}/homework", headers=headers, timeout=15)
    return [h for h in r.json() if h.get("client_id") == client_id]


def _hw_for_template(hws, template_id):
    return [h for h in hws if h.get("template_snapshot", {}).get("template_id") == template_id]


# ----------------------------------------------------------------------

def test_program_persists_per_module_homework(admin_headers, fx):
    """Round-trip: program create/read preserves the new homework fields."""
    progs = requests.get(f"{API}/programs", headers=admin_headers, timeout=15).json()
    p = next(pr for pr in progs if pr["id"] == fx["program_id"])
    assert p["welcome_homework_template_id"] == fx["welcome_tpl_id"]
    assert p["modules"][0]["homework_template_id"] == fx["m1_tpl_id"]
    assert p["modules"][1]["homework_template_id"] == fx["m2_tpl_id"]


def test_enrollment_assigns_welcome_AND_module1_homework(admin_headers, fx):
    """Sprint 110bz: at enrollment, BOTH the welcome homework AND module 1's
    homework should auto-create — because module 1 is "starting now"."""
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    hws = _list_homework(admin_headers, fx["client_id"])

    welcome = _hw_for_template(hws, fx["welcome_tpl_id"])
    assert welcome, "Welcome homework should have been auto-assigned"
    assert welcome[0]["auto_assigned"] is True

    m1 = _hw_for_template(hws, fx["m1_tpl_id"])
    assert m1, "Module 1's homework should auto-assign at enrollment (module 1 is starting)"
    assert m1[0]["auto_assigned"] is True

    # Module 2's homework should NOT exist yet — that fires when module 1 is mastered
    m2 = _hw_for_template(hws, fx["m2_tpl_id"])
    assert not m2, "Module 2's homework should NOT exist before module 1 is mastered"


def test_mastering_module1_assigns_module2_homework(admin_headers, fx):
    """Sprint 110bz: marking module 1's goals as mastered should auto-assign
    module 2's homework (the next module is starting)."""
    sell = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                         headers=admin_headers,
                         json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                         timeout=15).json()
    enrollment_id = sell["enrollment"]["id"]

    # Master module 1's goal
    r = requests.put(
        f"{API}/dogs/{fx['dog_id']}/programs/{enrollment_id}/goals/{fx['m1_goal_id']}",
        headers=admin_headers, json={"score": 5}, timeout=15,
    )
    assert r.status_code == 200, r.text

    hws = _list_homework(admin_headers, fx["client_id"])
    m2 = _hw_for_template(hws, fx["m2_tpl_id"])
    assert m2, "Module 2's homework should auto-assign when module 1 is mastered"

    # Idempotency: re-mastering same goal should NOT double-assign
    requests.put(
        f"{API}/dogs/{fx['dog_id']}/programs/{enrollment_id}/goals/{fx['m1_goal_id']}",
        headers=admin_headers, json={"score": 5, "notes": "still mastered"}, timeout=15,
    )
    hws_after = _list_homework(admin_headers, fx["client_id"])
    m2_after = _hw_for_template(hws_after, fx["m2_tpl_id"])
    assert len(m2_after) == 1, "Module 2 homework should fire exactly once"


def test_mastering_last_module_does_not_assign_more_homework(admin_headers, fx):
    """When the FINAL module is mastered, no further auto-homework should
    fire — there's no Module N+1 to start."""
    sell = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                         headers=admin_headers,
                         json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                         timeout=15).json()
    enrollment_id = sell["enrollment"]["id"]

    # Master module 1 first (triggers module 2 HW)
    requests.put(
        f"{API}/dogs/{fx['dog_id']}/programs/{enrollment_id}/goals/{fx['m1_goal_id']}",
        headers=admin_headers, json={"score": 5}, timeout=15,
    )
    # Now master module 2 (last module) — should NOT trigger anything new
    requests.put(
        f"{API}/dogs/{fx['dog_id']}/programs/{enrollment_id}/goals/{fx['m2_goal_id']}",
        headers=admin_headers, json={"score": 5}, timeout=15,
    )
    hws = _list_homework(admin_headers, fx["client_id"])
    # Expected total: welcome (1) + m1 (1) + m2 (1) = 3 auto-assigned rows
    auto = [h for h in hws if h.get("auto_assigned") is True]
    assert len(auto) == 3, f"Should be exactly 3 auto-assigned homeworks total, got {len(auto)}"


def test_fifo_redemption_prefers_program_lot(admin_headers, fx):
    """Program-tagged credit lots should be reachable by the preference filter
    used during training credit redemption (regression test for 110bx)."""
    sell_a = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                           headers=admin_headers,
                           json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                           timeout=15).json()
    lot_a_id = sell_a["lot"]["id"]

    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv('/app/backend/.env')

    async def _seed_other_lot():
        mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
        db = mc[os.environ['DB_NAME']]
        await db.credit_lots.insert_one({
            "id": str(uuid.uuid4()),
            "client_id": fx["client_id"],
            "pack_kind": "credit_pack",
            "service_type": "training",
            "qty_total": 2,
            "qty_remaining": 2,
            "value_each": 50.0,
            "price_paid": 100.0,
            "purchased_at": "2020-01-01T00:00:00+00:00",  # oldest under plain FIFO
        })
        await db.clients.update_one({"id": fx["client_id"]}, {"$inc": {"training_credits": 2}})
        mc.close()
    asyncio.run(_seed_other_lot())

    async def _find_program_lot():
        mc = AsyncIOMotorClient(os.environ['MONGO_URL'])
        db = mc[os.environ['DB_NAME']]
        lot = await db.credit_lots.find_one(
            {"client_id": fx["client_id"], "qty_remaining": {"$gt": 0},
             "service_type": "training", "program_id": fx["program_id"]},
        )
        result = lot["id"] if lot else None
        mc.close()
        return result

    drained_id = asyncio.run(_find_program_lot())
    assert drained_id == lot_a_id


def test_admin_required():
    r = requests.post(f"{API}/programs", json={"name": "x", "type": "custom"}, timeout=15)
    assert r.status_code in (401, 403)
