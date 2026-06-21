"""Sprint 110eg — Universal cash-basis P&L rule.

The operator's mental model (per Feb 16 2026 directive):
  "The only time money gets added is at the time of sale. No money changes
   hands when a credit is used anymore. If a day is all credits used, the
   P&L would have nothing added. But I should still have the ability to
   add an amount at check out if I need to."

Translated to invariants:

  (A) Credit pack purchase → revenue +$pack_price on the sale date.
  (B) Pure credit-redemption checkout → revenue +$0.
  (C) Credit-redemption + cash add-on / override at checkout → revenue
      grows by the EXTRA cash portion only (not the credit-burn portion).
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
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _snapshot_week(headers, today_iso: str) -> dict:
    r = requests.get(
        f"{API}/transactions/weekly-summary",
        headers=headers,
        params={"ref_date": today_iso},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _make_client_with_dog(headers, prefix: str):
    suffix = uuid.uuid4().hex[:6]
    c = requests.post(
        f"{API}/clients", headers=headers,
        json={"name": f"{prefix}-{suffix}", "email": f"{prefix}-{suffix}@e.com"},
        timeout=15,
    ).json()
    d = requests.post(
        f"{API}/dogs", headers=headers,
        json={
            "name": f"{prefix}Pup-{suffix}",
            "owner_id": c["id"], "breed": "Mix", "age_y": 3,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01",
                         "bordetella": "2028-01-01"},
        },
        timeout=15,
    ).json()
    return c, d


def _make_daycare_pack(headers) -> dict:
    """Create a $200 / 10-day daycare pack ($20/credit) and return it."""
    payload = {
        "name": f"TestPack {uuid.uuid4().hex[:5]}",
        "service_type": "daycare",
        "qty": 10,
        "price": 200.0,
    }
    r = requests.post(f"{API}/credit-packs", headers=headers, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()


def test_pack_sale_adds_revenue_redemption_does_not(admin_headers):
    """A → sale recognises the cash; B → redemption does NOT add a second
    revenue event for the same money."""
    today = date.today().isoformat()
    client, dog = _make_client_with_dog(admin_headers, "Cash")
    pack = _make_daycare_pack(admin_headers)

    before = _snapshot_week(admin_headers, today)
    completed_before = float(before.get("completed_total") or 0)
    redeemed_before = int(before.get("credit_pack_redeemed_count") or 0)

    # SELL the pack — should bump weekly completed_total by $200.
    r = requests.post(
        f"{API}/clients/{client['id']}/sell-pack",
        headers=admin_headers,
        json={"pack_id": pack["id"], "payment_method": "card"},
        timeout=15,
    )
    r.raise_for_status()

    after_sale = _snapshot_week(admin_headers, today)
    delta_sale = round(float(after_sale["completed_total"]) - completed_before, 2)
    assert delta_sale == 200.0, (
        f"Pack SALE should bump completed_total by $200, got ${delta_sale}"
    )

    # REDEEM 1 credit — completed_total MUST stay flat. "Credits Redeemed"
    # counter ticks +1 (operational visibility).
    bk = requests.post(
        f"{API}/bookings", headers=admin_headers,
        json={"dog_id": dog["id"], "service_type": "daycare",
              "date": today, "status": "approved"},
        timeout=15,
    ).json()
    requests.post(f"{API}/bookings/{bk['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(f"{API}/bookings/{bk['id']}/check-out",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()

    after_redeem = _snapshot_week(admin_headers, today)
    delta_redeem = round(
        float(after_redeem["completed_total"]) - float(after_sale["completed_total"]),
        2,
    )
    assert delta_redeem == 0.0, (
        f"Credit REDEMPTION must NOT add to completed_total. "
        f"Got delta=${delta_redeem}. The universal cash-basis rule "
        f"was violated."
    )
    redeemed_after = int(after_redeem.get("credit_pack_redeemed_count") or 0)
    assert redeemed_after == redeemed_before + 1, (
        f"Redemption counter should tick +1. Got "
        f"before={redeemed_before}, after={redeemed_after}."
    )


def test_credit_redemption_plus_cash_override_counts_only_the_extra(admin_headers):
    """C → admin checks out a credit-paid booking but types in a $30
    override (extra cash above credit value $20). P&L must grow by $10
    (the cash slice), not $30 and not $0."""
    today = date.today().isoformat()
    client, dog = _make_client_with_dog(admin_headers, "Extra")
    pack = _make_daycare_pack(admin_headers)

    # Sell the pack first (so the client has credits).
    requests.post(
        f"{API}/clients/{client['id']}/sell-pack",
        headers=admin_headers,
        json={"pack_id": pack["id"], "payment_method": "card"},
        timeout=15,
    ).raise_for_status()

    before = _snapshot_week(admin_headers, today)
    completed_before = float(before.get("completed_total") or 0)

    # Booking, check-in, then check-out with base_price=$30 (override).
    # value_each = 200/10 = $20 → cash slice should be $10.
    bk = requests.post(
        f"{API}/bookings", headers=admin_headers,
        json={"dog_id": dog["id"], "service_type": "daycare",
              "date": today, "status": "approved"},
        timeout=15,
    ).json()
    requests.post(f"{API}/bookings/{bk['id']}/check-in",
                  headers=admin_headers, json={}, timeout=15).raise_for_status()
    requests.post(
        f"{API}/bookings/{bk['id']}/check-out",
        headers=admin_headers,
        json={"base_price": 30.0},
        timeout=15,
    ).raise_for_status()

    after = _snapshot_week(admin_headers, today)
    delta = round(float(after["completed_total"]) - completed_before, 2)
    assert delta == 10.0, (
        f"Credit-redemption + $30 override against a $20 credit should "
        f"add exactly $10 (the cash slice) to completed_total. "
        f"Got delta=${delta}."
    )
