"""Sprint 110dc — One-shot transitional migration: mark every CURRENT
non-program credit lot as Legacy. The user's mental model is "all the
credits clients have right now use the old system; everything sold from
this point on uses the new system."
"""
import os
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient


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


def _seed_lots():
    """Insert a fresh batch of lots (one paid-at-sale, one legacy, one
    training-program) so the migration has known data to act on."""
    paid_lot = str(uuid.uuid4())
    legacy_lot = str(uuid.uuid4())
    program_lot = str(uuid.uuid4())
    client_id = str(uuid.uuid4())

    async def _do():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.clients.insert_one({
            "id": client_id, "name": "Migration Test Client", "email": "m@e.com",
            "credits": 0, "created_at": "2026-06-10T00:00:00+00:00",
        })
        await db.credit_lots.insert_many([
            {"id": paid_lot, "client_id": client_id, "pack_id": "p1",
             "pack_name": "Daycare-Paid", "service_type": "daycare",
             "qty_total": 5, "qty_remaining": 5, "price_paid": 100.0,
             "value_each": 20.0, "payment_method": "card", "sold_by": "x",
             "purchased_at": "2026-06-10T10:00:00+00:00",
             "recognize_at_sale": True},
            {"id": legacy_lot, "client_id": client_id, "pack_id": "p2",
             "pack_name": "Daycare-Legacy", "service_type": "daycare",
             "qty_total": 5, "qty_remaining": 5, "price_paid": 100.0,
             "value_each": 20.0, "payment_method": "cash", "sold_by": "x",
             "purchased_at": "2025-12-01T10:00:00+00:00"},
            {"id": program_lot, "client_id": client_id, "pack_id": "p3",
             "pack_name": "Board+Train", "service_type": "training",
             "pack_kind": "training_program",
             "qty_total": 14, "qty_remaining": 14, "price_paid": 1400.0,
             "value_each": 100.0, "payment_method": "card", "sold_by": "x",
             "purchased_at": "2026-06-08T10:00:00+00:00"},
        ])

    asyncio.run(_do())
    return paid_lot, legacy_lot, program_lot, client_id


def _cleanup(client_id):
    async def _do():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.credit_lots.delete_many({"client_id": client_id})
        await db.clients.delete_one({"id": client_id})
    asyncio.run(_do())


def test_preview_shape(admin_headers):
    r = requests.get(f"{API}/admin/credit-lots/legacy-migration-preview",
                     headers=admin_headers, timeout=15)
    r.raise_for_status()
    body = r.json()
    assert set(body.keys()) >= {"to_migrate", "already_legacy", "training_programs_skipped"}
    for k in body:
        assert isinstance(body[k], int)


def test_one_shot_migration_flips_only_paid_at_sale_non_program(admin_headers):
    paid_lot, legacy_lot, program_lot, client_id = _seed_lots()
    try:
        # Run migration
        r = requests.post(f"{API}/admin/credit-lots/migrate-existing-to-legacy",
                          headers=admin_headers, timeout=15)
        r.raise_for_status()
        body = r.json()
        assert body.get("ok") is True
        assert body.get("modified_count", 0) >= 1
        assert body.get("migrated_at")

        # Fetch state per lot
        lots = requests.get(f"{API}/clients/{client_id}/credit-lots",
                            headers=admin_headers, timeout=15).json()
        by_id = {l["id"]: l for l in lots}

        # paid_at_sale lot must have been flipped to Legacy
        assert by_id[paid_lot].get("recognize_at_sale") is False, (
            f"Paid-at-sale lot should now be Legacy, got {by_id[paid_lot]}"
        )
        # legacy lot stays legacy (gets the same stamp but still False)
        assert by_id[legacy_lot].get("recognize_at_sale") is False
        # Training-program lot MUST NOT be touched
        assert by_id[program_lot].get("pack_kind") == "training_program"
        assert by_id[program_lot].get("recognize_at_sale") is not True or \
               by_id[program_lot].get("recognition_migrated_by_bulk") is not True, (
            "Training-program lots must NOT be flipped by the bulk migration"
        )

        # All non-program lots carry the audit field
        assert by_id[paid_lot].get("recognition_migrated_by_bulk") is True
        assert by_id[legacy_lot].get("recognition_migrated_by_bulk") is True
    finally:
        _cleanup(client_id)


def test_migration_is_idempotent(admin_headers):
    paid_lot, legacy_lot, _, client_id = _seed_lots()
    try:
        for _ in range(2):
            r = requests.post(f"{API}/admin/credit-lots/migrate-existing-to-legacy",
                              headers=admin_headers, timeout=15)
            r.raise_for_status()
        lots = requests.get(f"{API}/clients/{client_id}/credit-lots",
                            headers=admin_headers, timeout=15).json()
        for lot in lots:
            if lot.get("pack_kind") != "training_program":
                assert lot.get("recognize_at_sale") is False
    finally:
        _cleanup(client_id)


def test_new_packs_sold_after_migration_still_recognize_at_sale(admin_headers):
    """The whole point: migration only touches CURRENT lots. Any pack sold
    AFTER must still land with recognize_at_sale=True."""
    paid_lot, legacy_lot, _, mig_client_id = _seed_lots()
    try:
        # Run migration first
        requests.post(f"{API}/admin/credit-lots/migrate-existing-to-legacy",
                      headers=admin_headers, timeout=15).raise_for_status()

        # Now sell a new pack to a brand-new client
        packs = requests.get(f"{API}/credit-packs", headers=admin_headers, timeout=15).json()
        pack = next((p for p in packs if (p.get("service_type") or "").lower() == "daycare"
                     and float(p.get("price") or 0) > 0), None)
        if not pack:
            pytest.skip("No daycare credit pack in catalog")

        suffix = uuid.uuid4().hex[:6]
        new_client = requests.post(f"{API}/clients", headers=admin_headers,
                                   json={"name": f"PostMig {suffix}",
                                         "email": f"pm-{suffix}@e.com"},
                                   timeout=15).json()
        requests.post(f"{API}/clients/{new_client['id']}/sell-packs",
                      headers=admin_headers,
                      json={"items": [{"pack_id": pack["id"], "quantity": 1}],
                            "payment_method": "card"},
                      timeout=15).raise_for_status()

        # The new client's lot MUST be recognize_at_sale=True
        new_lots = requests.get(f"{API}/clients/{new_client['id']}/credit-lots",
                                headers=admin_headers, timeout=15).json()
        flagged = [l for l in new_lots if l.get("recognize_at_sale") is True]
        assert len(flagged) >= 1, (
            f"New pack sold AFTER migration must still flag recognize_at_sale=True. "
            f"Lots: {new_lots}"
        )
    finally:
        _cleanup(mig_client_id)
