"""Sprint 110di-27 — Defensive coercion on GET /dogs.

User bug report: "adding a dog is broken — shows on admin the client has
a dog but not on the client's portal so they can't book."

Root cause: a SINGLE dog row with legacy/malformed `sex='male'` (lowercase
instead of canonical 'Male') broke the entire /api/dogs endpoint with a
strict response_model validation error. Both admin and client got 500s.
The client thought their newly-added dogs weren't saving — they were,
but they couldn't see them because the list endpoint was dead.

This file pins the coercion fix so the regression can't reappear if a
future import / CSV upload / hand-edit ever sneaks bad enum values back
into the dogs collection.
"""
import os
import asyncio
import uuid
import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone

load_dotenv("/app/backend/.env")
BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")
_MONGO_URL = os.environ["MONGO_URL"]
_DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def malformed_dog():
    """Seed a dog with deliberately bad enum values straight into Mongo —
    bypasses the API's input validation so we can pin the LIST endpoint's
    coercion. Cleans up at end of test."""
    cid = "4b3658d3-9172-4a7a-b3dc-3a49a56ed6d2"  # garrett — test client
    did = str(uuid.uuid4())
    async def seed():
        db = AsyncIOMotorClient(_MONGO_URL)[_DB_NAME]
        await db.dogs.insert_one({
            "id": did, "name": f"MalformedTestDog-{did[:6]}", "owner_id": cid,
            "breed": "mixed", "age_y": 3, "age_m": 0, "birthday": "2022-01-01",
            "sex": "male",          # <-- lowercase, INVALID per DogOut enum
            "fixed": True,           # <-- bool, INVALID per DogOut enum (should be 'Yes'/'No')
            "vaccines": {"rabies":"2030-01-01","bordetella":"2030-01-01","dhpp":"2030-01-01"},
            "photo": "", "training_logs": [], "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    async def cleanup():
        db = AsyncIOMotorClient(_MONGO_URL)[_DB_NAME]
        await db.dogs.delete_many({"id": did})

    asyncio.run(seed())
    try:
        yield did
    finally:
        asyncio.run(cleanup())


def test_list_dogs_survives_malformed_sex(admin_headers, malformed_dog):
    """A single dog with sex='male' lowercase used to 500 the entire
    /api/dogs endpoint. With the boundary coercion, the endpoint succeeds
    and that row appears with sex='Male' in the response."""
    r = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"expected 200 with coerced sex, got {r.status_code}: {r.text[:200]}"
    items = r.json()
    found = next((d for d in items if d["id"] == malformed_dog), None)
    assert found is not None, "malformed dog not returned"
    assert found["sex"] == "Male", f"sex should be coerced to 'Male', got {found['sex']!r}"
    assert found["fixed"] == "Yes", f"fixed bool True should be coerced to 'Yes', got {found['fixed']!r}"


def test_list_dogs_for_client_survives_malformed(malformed_dog):
    """Same coercion must work when the client (not admin) hits the
    endpoint — this is the real-world path the user was blocked on."""
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "freightshaker06@gmail.com", "password": "TestPass123"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"test client login failed: {r.text[:200]}")
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r2 = requests.get(f"{BASE}/api/dogs", headers=headers, timeout=15)
    assert r2.status_code == 200, f"client got {r2.status_code}: {r2.text[:200]}"
    items = r2.json()
    # Client should see ONLY their own dogs — owner scope must still apply.
    found = next((d for d in items if d["id"] == malformed_dog), None)
    assert found is not None, "client should see their own malformed dog"
    assert found["sex"] in ("Male", "Female")
    assert found["fixed"] in ("Yes", "No")


def test_get_single_dog_also_coerced(admin_headers, malformed_dog):
    """The detail endpoint /api/dogs/{id} shares the same coercion path
    so the edit modal can open without crashing."""
    r = requests.get(f"{BASE}/api/dogs/{malformed_dog}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sex"] in ("Male", "Female")
    assert body["fixed"] in ("Yes", "No")
