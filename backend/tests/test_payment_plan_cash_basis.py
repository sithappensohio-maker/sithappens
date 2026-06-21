"""Sprint 110do — Cash-basis recognition for payment-plan installments.

Validates that marking a plan installment as paid:
  1. Inserts a `retail_sales` row with `source_kind="payment_plan_installment"`,
     date=today, amount = installment amount.
  2. Surfaces under a "Payment Plans" bucket in the income breakdown.
  3. Tracks the income_event_id back on the installment for the audit trail.
"""
import os, uuid, pytest, requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_client_and_plan(headers, total=900, count=3):
    sfx = uuid.uuid4().hex[:6]
    cr = requests.post(f"{API}/clients", headers=headers,
                       json={"name": f"PlanTest {sfx}", "email": f"plan-{sfx}@e.com"},
                       timeout=15)
    cr.raise_for_status()
    client = cr.json()
    today = datetime.now(timezone.utc).date().isoformat()
    each = round(total / count, 2)
    installments = [{"due_date": today, "amount": each} for _ in range(count)]
    pr = requests.post(f"{API}/admin/payment-plans", headers=headers,
                       json={
                           "client_id": client["id"],
                           "source_kind": "manual",
                           "program_name": "Bootcamp",
                           "total_amount": total,
                           "cadence": "monthly",
                           "installments": installments,
                       }, timeout=15)
    pr.raise_for_status()
    return client, pr.json()


def test_mark_paid_inserts_income_row(admin_headers):
    client, plan = _make_client_and_plan(admin_headers, total=900, count=3)
    inst = plan["installments"][0]
    r = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15)
    r.raise_for_status()
    updated = r.json()
    paid_inst = next(i for i in updated["installments"] if i["id"] == inst["id"])
    assert paid_inst["status"] == "paid"
    assert paid_inst.get("income_event_id"), "income_event_id should be set on the paid installment"

    # Now query retail_sales directly via pymongo (the admin list endpoint
    # surface is varied across pages; direct DB read is the source of truth).
    from pymongo import MongoClient
    mc = MongoClient(os.environ["MONGO_URL"])
    try:
        rows = list(mc[os.environ.get("DB_NAME", "sit_happens")].retail_sales.find(
            {"id": paid_inst["income_event_id"]}, {"_id": 0}
        ))
    finally:
        mc.close()
    assert len(rows) == 1, f"expected 1 matching income row, got {len(rows)}"
    row = rows[0]
    assert row["source_kind"] == "payment_plan_installment"
    assert row["source_id"] == plan["id"]
    assert row["installment_id"] == inst["id"]
    assert row["amount"] == inst["amount"]
    assert row["category"] == "Payment Plan"


def test_default_does_not_chime_for_unpaid_installments(admin_headers):
    """The remaining 2 installments must NOT have created any income rows yet."""
    client, plan = _make_client_and_plan(admin_headers, total=600, count=2)
    # Mark only the first installment paid
    inst1 = plan["installments"][0]
    requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst1['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15,
    ).raise_for_status()
    # The 2nd installment is still "due"
    plan_now = requests.get(f"{API}/admin/payment-plans/{plan['id']}",
                            headers=admin_headers, timeout=15).json()
    inst2 = plan_now["installments"][1]
    assert inst2["status"] == "due"
    assert not inst2.get("income_event_id")


def test_reverse_payment_removes_income_row(admin_headers):
    """Sprint 110do — reversing a paid installment must delete the income row
    AND flip the installment back to due. Cash-register principle."""
    from pymongo import MongoClient
    client, plan = _make_client_and_plan(admin_headers, total=600, count=2)
    inst = plan["installments"][0]
    # Mark paid → creates income row
    pr = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15)
    pr.raise_for_status()
    paid_inst = next(i for i in pr.json()["installments"] if i["id"] == inst["id"])
    income_id = paid_inst["income_event_id"]
    assert income_id

    # Verify the income row exists
    mc = MongoClient(os.environ["MONGO_URL"])
    dbn = os.environ.get("DB_NAME", "sit_happens")
    try:
        assert mc[dbn].retail_sales.count_documents({"id": income_id}) == 1
    finally:
        mc.close()

    # Reverse
    rr = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/reverse-payment",
        headers=admin_headers, json={"method": "cash", "notes": "test reversal"}, timeout=15)
    rr.raise_for_status()

    reversed_inst = next(i for i in rr.json()["installments"] if i["id"] == inst["id"])
    # Installment is back to due, income event id is cleared, history captured
    assert reversed_inst["status"] == "due"
    assert "income_event_id" not in reversed_inst or reversed_inst.get("income_event_id") in (None, "")
    assert len(reversed_inst.get("reversal_history") or []) == 1
    assert reversed_inst["reversal_history"][0]["reversed_amount"] == inst["amount"]

    # And the income row is gone from retail_sales
    mc = MongoClient(os.environ["MONGO_URL"])
    try:
        assert mc[dbn].retail_sales.count_documents({"id": income_id}) == 0
    finally:
        mc.close()


def test_reverse_payment_rejects_unpaid(admin_headers):
    """Reversing a still-due installment must 409 (no income row exists)."""
    client, plan = _make_client_and_plan(admin_headers, total=300, count=2)
    inst = plan["installments"][0]
    r = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/reverse-payment",
        headers=admin_headers, json={}, timeout=15)
    assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"
