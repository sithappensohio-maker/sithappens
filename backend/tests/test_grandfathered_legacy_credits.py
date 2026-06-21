"""Sprint 110eg — Universal cash-basis rule: ANY credit redemption (new or
grandfathered) must contribute $0 to revenue. The original pack sale is
the only money-event; redeeming credits is operational, not financial.

(This test originally asserted the OPPOSITE — Sprint 110cz kept legacy
lots on the redeem-then-recognize path. Sprint 110eg unified everything
to point-of-sale recognition, including grandfathered lots. The user's
explicit rule: "no money changes hands when a credit is used anymore".)
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


def test_grandfathered_lot_redemption_no_longer_adds_to_revenue(admin_headers):
    """Legacy (pre-110cs) credit lot redemption MUST NOT add to revenue
    under the Sprint 110eg universal cash-basis rule. The "Credits
    Redeemed" counter still increments (operational visibility), but
    `completed_total` stays flat."""
    today = date.today().isoformat()
    suffix = uuid.uuid4().hex[:6]

    # Create client + dog through public API
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Legacy {suffix}",
                                 "email": f"legacy-{suffix}@e.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"LegacyDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()

    legacy_qty = 5
    legacy_price = 100.0  # $20/credit nominal
    lot_id = str(uuid.uuid4())

    async def _seed():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.credit_lots.insert_one({
            "id": lot_id,
            "client_id": client["id"],
            "pack_id": "legacy-pack",
            "pack_name": "Legacy Daycare 5-Pack",
            "service_type": "daycare",
            "qty_total": legacy_qty,
            "qty_remaining": legacy_qty,
            "price_paid": legacy_price,
            "list_price": legacy_price,
            "value_each": round(legacy_price / legacy_qty, 2),
            "payment_method": "card",
            "note": "Pre-110cs legacy lot",
            "sold_by": "test-seed",
            "purchased_at": "2025-12-01T10:00:00+00:00",
            # NOTE: deliberately NO recognize_at_sale flag — grandfathered.
        })
        await db.clients.update_one(
            {"id": client["id"]},
            {"$inc": {"credits": legacy_qty}},
        )

    asyncio.run(_seed())

    # Snapshot BEFORE redemption
    before = requests.get(f"{API}/transactions/weekly-summary",
                          headers=admin_headers,
                          params={"ref_date": today}, timeout=15).json()
    completed_before = float(before.get("completed_total") or 0)
    pack_redeem_count_before = int(before.get("credit_pack_redeemed_count") or 0)

    bk = requests.post(f"{API}/bookings", headers=admin_headers,
                       json={"dog_id": dog["id"], "service_type": "daycare",
                             "date": today, "status": "approved"},
                       timeout=15)
    if bk.status_code != 200:
        pytest.skip(f"Couldn't create booking: {bk.text}")
    bk = bk.json()
    requests.post(f"{API}/bookings/{bk['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{bk['id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()

    after = requests.get(f"{API}/transactions/weekly-summary",
                         headers=admin_headers,
                         params={"ref_date": today}, timeout=15).json()
    completed_after = float(after.get("completed_total") or 0)
    pack_redeem_count_after = int(after.get("credit_pack_redeemed_count") or 0)

    delta = round(completed_after - completed_before, 2)
    assert delta == 0.0, (
        f"UNIVERSAL CASH-BASIS BROKEN: legacy lot redemption added "
        f"${delta} to completed_total — expected $0. Money should only "
        f"be recognized at point-of-sale, never at credit redemption."
    )

    # Universal "Credits Redeemed" counter MUST still tick — solo operator
    # wants visibility on how much pre-paid usage hit today even though no
    # cash moved.
    assert pack_redeem_count_after == pack_redeem_count_before + 1, (
        f"credit_pack_redeemed_count should track ANY credit redemption "
        f"under Sprint 110eg. Got before={pack_redeem_count_before}, "
        f"after={pack_redeem_count_after}."
    )
