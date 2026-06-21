"""Sprint 110cs/cy — Bulk-sell credit packs MUST also log a retail_sales row
on the day of sale so the operator sees the money in today's P&L + on the
Income screen's Retail tile immediately (instead of dripping in as credits
are redeemed). The singular `/sell-pack` endpoint already does this; the
bulk `/sell-packs` endpoint was missing the logic. This test guards the
bulk path so it stays in sync.
"""
import os
import uuid
import pytest
import requests
from datetime import date


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


def _pick_pack(headers):
    packs = requests.get(f"{API}/credit-packs", headers=headers, timeout=15).json()
    for p in packs:
        if (p.get("service_type") or "daycare").lower() == "daycare" and float(p.get("price") or 0) > 0:
            return p
    return packs[0] if packs else None


def test_bulk_sell_packs_logs_retail_sale_and_lot_flag(admin_headers):
    pack = _pick_pack(admin_headers)
    if not pack:
        pytest.skip("No credit pack in catalog")
    today = date.today().isoformat()

    # Snapshot weekly totals BEFORE
    before = requests.get(f"{API}/transactions/weekly-summary",
                          headers=admin_headers,
                          params={"ref_date": today}, timeout=15).json()
    pack_sales_before = float(before.get("credit_pack_sales_total") or 0)
    completed_before = float(before.get("completed_total") or 0)

    # Create client
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"BulkSell {suffix}",
                                 "email": f"bs-{suffix}@e.com"},
                           timeout=15).json()

    # Bulk-sell 1 pack
    r = requests.post(f"{API}/clients/{client['id']}/sell-packs",
                      headers=admin_headers,
                      json={"items": [{"pack_id": pack["id"], "quantity": 1}],
                            "payment_method": "card"},
                      timeout=15)
    r.raise_for_status()
    receipt = r.json()
    pack_price = float(pack["price"])
    assert receipt.get("total_price") == pack_price, (
        f"Receipt total should match pack price, got {receipt}"
    )

    # Lot should carry recognize_at_sale: True (same as singular endpoint)
    lots = requests.get(f"{API}/clients/{client['id']}/credit-lots",
                        headers=admin_headers, timeout=15).json()
    flagged = [l for l in lots if l.get("recognize_at_sale") is True]
    assert len(flagged) >= 1, (
        f"Bulk-sold lot must have recognize_at_sale=True, got lots={lots}"
    )

    # The pack sale must land in credit_pack_sales_total AND completed_total
    after = requests.get(f"{API}/transactions/weekly-summary",
                         headers=admin_headers,
                         params={"ref_date": today}, timeout=15).json()
    pack_sales_after = float(after.get("credit_pack_sales_total") or 0)
    completed_after = float(after.get("completed_total") or 0)

    assert round(pack_sales_after - pack_sales_before, 2) == round(pack_price, 2), (
        f"credit_pack_sales_total should jump by pack price ${pack_price}; "
        f"before=${pack_sales_before} after=${pack_sales_after}"
    )
    assert round(completed_after - completed_before, 2) >= round(pack_price, 2), (
        f"completed_total should grow by at least the pack price ${pack_price}; "
        f"before=${completed_before} after=${completed_after}"
    )


def test_bulk_sell_packs_redemption_does_not_double_count(admin_headers):
    pack = _pick_pack(admin_headers)
    if not pack:
        pytest.skip("No credit pack in catalog")
    today = date.today().isoformat()

    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"BulkRedeem {suffix}",
                                 "email": f"br-{suffix}@e.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"BulkDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 3,
                              "vaccines": {"rabies": "2028-01-01",
                                           "dhpp": "2028-01-01",
                                           "bordetella": "2028-01-01"}},
                        timeout=15).json()

    # Bulk-sell a pack
    requests.post(f"{API}/clients/{client['id']}/sell-packs",
                  headers=admin_headers,
                  json={"items": [{"pack_id": pack["id"], "quantity": 1}],
                        "payment_method": "card"},
                  timeout=15).raise_for_status()

    after_sale = requests.get(f"{API}/transactions/weekly-summary",
                              headers=admin_headers,
                              params={"ref_date": today}, timeout=15).json()
    completed_after_sale = float(after_sale.get("completed_total") or 0)
    retail_after_sale = float(after_sale.get("retail_total") or 0)

    # Redeem a daycare session
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

    after_redeem = requests.get(f"{API}/transactions/weekly-summary",
                                headers=admin_headers,
                                params={"ref_date": today}, timeout=15).json()
    completed_after_redeem = float(after_redeem.get("completed_total") or 0)
    retail_after_redeem = float(after_redeem.get("retail_total") or 0)

    assert completed_after_redeem == completed_after_sale, (
        "Redeeming a bulk-sold pack must NOT grow completed_total — "
        "revenue was already counted in retail at sale-time."
    )
    assert retail_after_redeem == retail_after_sale, (
        "Retail total must stay flat through the redemption (no double-count)."
    )
    # The credit-pack-redeemed tile should reflect the burn
    assert after_redeem.get("credit_pack_redeemed_count", 0) > after_sale.get("credit_pack_redeemed_count", 0)
