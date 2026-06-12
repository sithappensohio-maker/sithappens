"""Sprint 110cz regression — Grandfathered (pre-110cs) credit lots that
DON'T carry the `recognize_at_sale` flag must continue to drive revenue at
redemption-time, NOT sale-time. This guards the operator's mental model:
"old packs keep working the old way until they're exhausted."

We seed an unflagged lot directly in Mongo (simulating a pre-110cs lot),
create a booking, check it in and out paying with that legacy credit at
the operator's manually-entered price, and verify the booking lands in
`completed_total` as expected — i.e., grandfathering still works.
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


def test_grandfathered_lot_redemption_still_lands_in_completed(admin_headers):
    """Legacy (pre-110cs) credit lots — no recognize_at_sale flag — must
    still drive revenue when each credit is redeemed. We seed an unflagged
    lot, redeem a daycare visit, and verify completed_total grows by the
    booking price."""
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

    # Seed a pre-110cs legacy daycare credit lot directly in Mongo (no
    # `recognize_at_sale`, no `pack_kind`). This mimics the user's
    # production state where existing packs predate the new flag.
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
            # NOTE: deliberately NO recognize_at_sale flag — that's the
            # whole point of the grandfathering path.
        })
        await db.clients.update_one(
            {"id": client["id"]},
            {"$inc": {"credits": legacy_qty}},
        )

    asyncio.run(_seed())

    # Snapshot completed_total BEFORE redemption
    before = requests.get(f"{API}/transactions/weekly-summary",
                          headers=admin_headers,
                          params={"ref_date": today}, timeout=15).json()
    completed_before = float(before.get("completed_total") or 0)
    pack_redeem_count_before = int(before.get("credit_pack_redeemed_count") or 0)

    # Create + check in + check out a daycare booking (redeems 1 legacy credit
    # — the operator entered a per-credit price at sale-time so the system
    # already knows the dollar value of this credit).
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

    # Snapshot AFTER — completed_total MUST grow by the per-credit value
    # (legacy lots stay on the redemption-recognition path).
    after = requests.get(f"{API}/transactions/weekly-summary",
                         headers=admin_headers,
                         params={"ref_date": today}, timeout=15).json()
    completed_after = float(after.get("completed_total") or 0)
    pack_redeem_count_after = int(after.get("credit_pack_redeemed_count") or 0)

    delta = round(completed_after - completed_before, 2)
    expected = round(legacy_price / legacy_qty, 2)

    # The redemption of a LEGACY lot should still land its per-credit value
    # in completed_total — exactly the same as before Sprint 110cs.
    assert delta == expected, (
        f"GRANDFATHERING BROKEN: legacy lot redemption should add "
        f"${expected} to completed_total (got delta=${delta}). "
        f"before=${completed_before} after=${completed_after}. "
        f"This means a pre-110cs client's pack credits stopped generating "
        f"income — user's existing data would be invisible to P&L."
    )

    # And the "Credits Redeemed" prepaid-burn counter MUST NOT move —
    # that counter is reserved for Sprint 110cs (recognize_at_sale) lots
    # only. Legacy lots are normal recognize-at-redemption credits.
    assert pack_redeem_count_after == pack_redeem_count_before, (
        f"credit_pack_redeemed_count should ONLY track Sprint 110cs "
        f"(recognize_at_sale: True) lots. Legacy lot redemption bumped "
        f"it from {pack_redeem_count_before} to {pack_redeem_count_after}."
    )
