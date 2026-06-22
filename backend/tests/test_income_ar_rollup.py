"""Sprint 110di-68 — Accounts Receivable rollup into Income weekly summary.

The user asked: "shouldn't open balances in the accounts receivable show in
unpaid in our income". Before this sprint, partial-pay sales sitting in AR
were invisible in the Income screen's Unpaid tile, which made the operator
think the week had zero outstanding when in fact clients were carrying tabs.
"""

import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")


def _admin():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


def _pick_client(headers):
    raw = requests.get(f"{BASE}/api/clients", headers=headers, timeout=15).json()
    return (raw if isinstance(raw, list) else raw.get("clients", []))[0]


def test_income_summary_exposes_ar_fields():
    """The weekly summary endpoint must expose ar_outstanding_total +
    ar_outstanding_count fields the UI relies on for the sub-label."""
    H = _admin()
    body = requests.get(f"{BASE}/api/transactions/weekly-summary", headers=H, timeout=15).json()
    for k in ("ar_outstanding_total", "ar_outstanding_count", "unpaid_total"):
        assert k in body, f"missing {k} in summary"


def test_ar_rollup_matches_dedicated_endpoint():
    """ar_outstanding_total in income summary must equal AR endpoint's
    total_receivable, and unpaid_total must INCLUDE that AR balance."""
    H = _admin()
    client = _pick_client(H)
    cid = client["id"]
    # Establish a $50 deficit on this client
    r = requests.post(
        f"{BASE}/api/clients/{cid}/adjustment",
        headers=H,
        json={"amount": 50, "notes": "pytest AR rollup test"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    try:
        # Compare numbers across the two endpoints
        ar = requests.get(f"{BASE}/api/admin/accounts-receivable", headers=H, timeout=15).json()
        summary = requests.get(f"{BASE}/api/transactions/weekly-summary", headers=H, timeout=15).json()

        assert abs(summary["ar_outstanding_total"] - ar["total_receivable"]) < 0.01, (
            f"AR mismatch: income={summary['ar_outstanding_total']} vs AR endpoint={ar['total_receivable']}"
        )
        assert summary["ar_outstanding_count"] == ar["count"], (
            f"count mismatch: income={summary['ar_outstanding_count']} vs AR={ar['count']}"
        )
        # And the headline unpaid_total must include the $50 we just added
        assert summary["unpaid_total"] >= 50, (
            f"unpaid_total ({summary['unpaid_total']}) should include AR balance"
        )
    finally:
        # Restore client balance to zero
        requests.post(
            f"{BASE}/api/clients/{cid}/adjustment",
            headers=H,
            json={"amount": -50, "notes": "pytest cleanup"},
            timeout=15,
        )


def test_zero_ar_returns_zero_outstanding():
    """When no clients have a positive account_balance, ar_outstanding_total
    is 0 (not None / not missing)."""
    H = _admin()
    body = requests.get(f"{BASE}/api/transactions/weekly-summary", headers=H, timeout=15).json()
    # Anyone with a balance might exist from another test — but the field
    # must always be a number.
    assert isinstance(body["ar_outstanding_total"], (int, float))
    assert isinstance(body["ar_outstanding_count"], int)
    assert body["ar_outstanding_total"] >= 0
