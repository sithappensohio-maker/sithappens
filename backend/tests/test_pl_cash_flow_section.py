"""Sprint 110eg — P&L "Cash Flow Ledger" section.

Verifies the universal cash-basis rule is consistently applied in the P&L
PDF generator: pre-paid sales (credit packs, training programs, payment
plans) appear as cash IN at sale-time, while credit redemptions show up
in an operational/info-only line that does NOT contribute to revenue.
"""
import os
import uuid
import pytest
import requests
from datetime import date, timedelta


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


def test_pl_cash_flow_block_present_and_balanced(admin_headers):
    """The /reports/pl JSON must expose a `cash_flow` block with the right
    keys, and the totals must add up internally."""
    today = date.today()
    start = (today - timedelta(days=365)).isoformat()
    end = today.isoformat()
    r = requests.get(
        f"{API}/reports/pl",
        headers=admin_headers,
        params={"start_date": start, "end_date": end},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    cf = data.get("cash_flow")
    assert cf is not None, "P&L payload is missing the `cash_flow` block"

    # Required keys
    for k in ("prepaid_in", "register_cash_in", "total_cash_in", "credits_redeemed"):
        assert k in cf, f"cash_flow missing `{k}`"

    prepaid = cf["prepaid_in"]
    reg = cf["register_cash_in"]
    burn = cf["credits_redeemed"]

    for k in ("credit_pack_sales", "training_program_sales",
              "payment_plan_installments", "total"):
        assert k in prepaid, f"prepaid_in missing `{k}`"
    for k in ("service_checkouts", "retail_items", "total"):
        assert k in reg, f"register_cash_in missing `{k}`"
    for k in ("nominal_value", "redemption_count"):
        assert k in burn, f"credits_redeemed missing `{k}`"

    # Internal arithmetic must balance
    p_sum = round(
        (prepaid["credit_pack_sales"] or 0)
        + (prepaid["training_program_sales"] or 0)
        + (prepaid["payment_plan_installments"] or 0),
        2,
    )
    assert p_sum == round(prepaid["total"], 2), (
        f"prepaid_in.total ({prepaid['total']}) ≠ sum of children ({p_sum})"
    )
    r_sum = round((reg["service_checkouts"] or 0) + (reg["retail_items"] or 0), 2)
    assert r_sum == round(reg["total"], 2), (
        f"register_cash_in.total ({reg['total']}) ≠ sum of children ({r_sum})"
    )
    total = round(prepaid["total"] + reg["total"], 2)
    assert total == round(cf["total_cash_in"], 2), (
        f"total_cash_in ({cf['total_cash_in']}) ≠ prepaid + register ({total})"
    )


def test_pl_pdf_renders_with_cash_flow_section(admin_headers):
    """The PDF endpoint must successfully render with the new Cash Flow
    section (smoke test — no broken templates / missing keys)."""
    today = date.today()
    start = (today - timedelta(days=30)).isoformat()
    end = today.isoformat()
    r = requests.get(
        f"{API}/reports/pl/pdf",
        headers=admin_headers,
        params={"start_date": start, "end_date": end},
        timeout=30,
    )
    assert r.status_code == 200, f"PDF render failed: {r.status_code} {r.text[:200]}"
    assert r.content.startswith(b"%PDF"), "Response is not a PDF (missing %PDF header)"
    assert len(r.content) > 2000, f"PDF suspiciously small: {len(r.content)} bytes"


def test_credit_pack_sale_lands_in_prepaid_in(admin_headers):
    """Selling a credit pack must bump `cash_flow.prepaid_in.credit_pack_sales`
    by the sale price — verifies the bucket wiring."""
    today = date.today().isoformat()
    suffix = uuid.uuid4().hex[:6]

    client = requests.post(
        f"{API}/clients", headers=admin_headers,
        json={"name": f"CF-{suffix}", "email": f"cf-{suffix}@e.com"},
        timeout=15,
    ).json()

    pack = requests.post(
        f"{API}/credit-packs", headers=admin_headers,
        json={"name": f"Pack-{suffix}", "service_type": "daycare",
              "qty": 5, "price": 100.0},
        timeout=15,
    ).json()

    before = requests.get(
        f"{API}/reports/pl", headers=admin_headers,
        params={"start_date": today, "end_date": today}, timeout=15,
    ).json()["cash_flow"]["prepaid_in"]["credit_pack_sales"]

    requests.post(
        f"{API}/clients/{client['id']}/sell-pack",
        headers=admin_headers,
        json={"pack_id": pack["id"], "payment_method": "card"},
        timeout=15,
    ).raise_for_status()

    after = requests.get(
        f"{API}/reports/pl", headers=admin_headers,
        params={"start_date": today, "end_date": today}, timeout=15,
    ).json()["cash_flow"]["prepaid_in"]["credit_pack_sales"]

    delta = round(after - before, 2)
    assert delta == 100.0, (
        f"Selling a $100 pack should bump prepaid_in.credit_pack_sales by "
        f"$100. Got delta=${delta}. before=${before}, after=${after}."
    )
