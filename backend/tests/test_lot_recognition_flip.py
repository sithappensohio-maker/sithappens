"""Sprint 110db — `PATCH /credit-lots/{id}/recognition` lets the operator
manually flip a lot's `recognize_at_sale` flag during the transitional
period. This locks in the behavior:
  - Flipping a flag updates the lot + stamps audit fields.
  - Training-program lots are protected (can't be flipped).
  - Historical retail_sales rows are NOT touched (changing past income
    would corrupt year-end reports).
  - The flag only affects future redemptions.
"""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import date
from motor.motor_asyncio import AsyncIOMotorClient


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


def _seed_lot(client_id, **overrides):
    lot_id = str(uuid.uuid4())

    async def _do():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.credit_lots.insert_one({
            "id": lot_id, "client_id": client_id,
            "pack_id": "test", "pack_name": "Test Daycare 5-Pack",
            "service_type": "daycare",
            "qty_total": 5, "qty_remaining": 5,
            "price_paid": 100.0, "value_each": 20.0,
            "payment_method": "cash", "sold_by": "admin",
            "purchased_at": "2025-11-01T10:00:00+00:00",
            **overrides,
        })

    asyncio.run(_do())
    return lot_id


def _make_client(headers, name):
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/clients", headers=headers,
                      json={"name": f"{name} {suffix}",
                            "email": f"{name.lower()}-{suffix}@e.com"},
                      timeout=15)
    r.raise_for_status()
    return r.json()


def test_flip_legacy_to_paid_at_sale(admin_headers):
    client = _make_client(admin_headers, "FlipLeg")
    lot_id = _seed_lot(client["id"])

    # Initially unflagged
    lots = requests.get(f"{API}/clients/{client['id']}/credit-lots",
                        headers=admin_headers, timeout=15).json()
    target = next(l for l in lots if l["id"] == lot_id)
    assert target.get("recognize_at_sale") is not True

    # Flip to paid-at-sale
    r = requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                       headers=admin_headers,
                       json={"recognize_at_sale": True}, timeout=15)
    r.raise_for_status()
    body = r.json()
    assert body.get("recognize_at_sale") is True
    assert body.get("recognition_updated_at"), "Audit stamp must be set"

    # Flip back to legacy
    r = requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                       headers=admin_headers,
                       json={"recognize_at_sale": False}, timeout=15)
    r.raise_for_status()
    assert r.json().get("recognize_at_sale") is False


def test_flip_changes_future_redemption_recognition(admin_headers):
    """A flipped lot must obey its new flag the very next time a credit is
    redeemed. Seed a legacy lot, flip it to paid-at-sale, redeem — the
    redemption should NOT contribute to completed_total."""
    today = date.today().isoformat()
    client = _make_client(admin_headers, "FlipBehav")
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": "FlipDog", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()

    # Seed a legacy daycare lot with 5 credits
    lot_id = _seed_lot(client["id"])
    # Add credits to client too (the FIFO consumer reads from the lot directly
    # but client balance gate-keeps the booking flow)
    async def _bump():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.clients.update_one({"id": client["id"]}, {"$inc": {"credits": 5}})
    asyncio.run(_bump())

    # Flip it to paid-at-sale BEFORE redeeming
    requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                   headers=admin_headers,
                   json={"recognize_at_sale": True}, timeout=15).raise_for_status()

    before = requests.get(f"{API}/transactions/weekly-summary",
                          headers=admin_headers,
                          params={"ref_date": today}, timeout=15).json()
    completed_before = float(before.get("completed_total") or 0)

    # Redeem
    bk = requests.post(f"{API}/bookings", headers=admin_headers,
                       json={"dog_id": dog["id"], "service_type": "daycare",
                             "date": today, "status": "approved"},
                       timeout=15)
    if bk.status_code != 200:
        pytest.skip(f"Couldn't create daycare booking: {bk.text}")
    bk = bk.json()
    requests.post(f"{API}/bookings/{bk['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{bk['id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()

    after = requests.get(f"{API}/transactions/weekly-summary",
                         headers=admin_headers,
                         params={"ref_date": today}, timeout=15).json()
    completed_after = float(after.get("completed_total") or 0)

    assert completed_after == completed_before, (
        f"After flipping the lot to paid-at-sale, redemption MUST NOT grow "
        f"completed_total. before=${completed_before} after=${completed_after}"
    )


def test_training_program_lot_cannot_be_flipped(admin_headers):
    """Safety: training-program lots are always paid at sale. Trying to
    flip one to legacy should 400."""
    client = _make_client(admin_headers, "FlipProg")
    lot_id = _seed_lot(client["id"], pack_kind="training_program")
    r = requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                       headers=admin_headers,
                       json={"recognize_at_sale": False}, timeout=15)
    assert r.status_code == 400, (
        f"Should refuse to flip training-program lots, got {r.status_code} "
        f"with body {r.text}"
    )


def test_flip_does_not_create_or_remove_retail_sales(admin_headers):
    """Audit guarantee: flipping the flag must NEVER touch the
    retail_sales collection. Historical P&L must stay frozen."""
    today = date.today().isoformat()
    client = _make_client(admin_headers, "FlipAudit")
    lot_id = _seed_lot(client["id"])

    async def _count():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        return await db.retail_sales.count_documents({"client_id": client["id"]})

    before = asyncio.run(_count())
    requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                   headers=admin_headers,
                   json={"recognize_at_sale": True}, timeout=15).raise_for_status()
    after_flip_on = asyncio.run(_count())
    requests.patch(f"{API}/credit-lots/{lot_id}/recognition",
                   headers=admin_headers,
                   json={"recognize_at_sale": False}, timeout=15).raise_for_status()
    after_flip_off = asyncio.run(_count())

    assert before == after_flip_on == after_flip_off, (
        f"retail_sales count should be unchanged across flips. "
        f"before={before} after_on={after_flip_on} after_off={after_flip_off}"
    )
