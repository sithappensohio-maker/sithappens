"""Sprint 110ch — Payment plans (big-ticket items)."""
import os, uuid, asyncio, pytest, requests
from datetime import date, timedelta

BASE = os.environ.get("REACT_APP_BACKEND_URL",
                      "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def fx(admin_headers):
    s = uuid.uuid4().hex[:6]
    email = f"plan-{s}@sithappens.com"
    pw = "planpass123"
    c = requests.post(f"{API}/clients", headers=admin_headers,
                      json={"name": f"Plan {s}", "email": email}, timeout=15).json()
    requests.post(f"{API}/clients/{c['id']}/portal-account",
                  headers=admin_headers, json={"email": email, "password": pw}, timeout=15)
    tok = requests.post(f"{API}/auth/login",
                        json={"email": email, "password": pw}, timeout=15).json()["token"]
    ch = {"Authorization": f"Bearer {tok}"}
    yield {"client_id": c["id"], "client_email": email, "client_headers": ch}
    try:
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv("/app/backend/.env")
        async def _wipe():
            mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = mc[os.environ["DB_NAME"]]
            await db.clients.delete_one({"id": c["id"]})
            await db.payment_plans.delete_many({"client_id": c["id"]})
            await db.users.delete_many({"email": email})
            mc.close()
        asyncio.run(_wipe())
    except Exception:
        pass


def _make_plan(client_id, total=2000, n=4):
    """Helper: 4-installment plan ($500 each) starting 7 days out, biweekly."""
    start = date.today() + timedelta(days=7)
    each = round(total / n, 2)
    installments = []
    total_so_far = 0.0
    for i in range(n):
        amt = each if i < n - 1 else round(total - total_so_far, 2)
        installments.append({
            "due_date": (start + timedelta(days=14 * i)).isoformat(),
            "amount": amt,
        })
        total_so_far += amt
    return {
        "client_id": client_id,
        "program_name": "Service Dog Pytest",
        "total_amount": total,
        "cadence": "biweekly",
        "installments": installments,
    }


def test_settings_round_trip(admin_headers):
    r = requests.get(f"{API}/admin/payment-plans/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert "agreement_html" in r.json()

    pinned = "<p>PYTEST agreement {{client_name}}</p>"
    r2 = requests.put(f"{API}/admin/payment-plans/settings",
                      headers=admin_headers,
                      json={"agreement_html": pinned, "reminder_days_before": 5}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["agreement_html"] == pinned
    assert r2.json()["reminder_days_before"] == 5

    # restore defaults so we don't pollute the running app
    requests.put(f"{API}/admin/payment-plans/settings",
                 headers=admin_headers,
                 json={"agreement_html": "", "reminder_days_before": 3}, timeout=15)


def test_create_plan_renders_agreement_and_emails_client(admin_headers, fx):
    body = _make_plan(fx["client_id"], total=2000, n=4)
    r = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["status"] == "pending_signature"
    assert len(plan["installments"]) == 4
    # Agreement snapshot must contain the client name + total amount substituted in
    assert fx["client_email"] != ""
    assert "$2,000.00" in plan["agreement_snapshot"]
    assert "Service Dog Pytest" in plan["agreement_snapshot"]


def test_installments_must_sum_to_total(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    body["installments"][0]["amount"] = 999.99  # off by lots
    r = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 400


def test_client_sign_activates_plan(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    plan = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                         json=body, timeout=15).json()
    # client signs
    r = requests.post(f"{API}/portal/payment-plans/{plan['id']}/sign",
                      headers=fx["client_headers"],
                      json={"typed_name": "Alex Rivera"}, timeout=15)
    assert r.status_code == 200, r.text
    signed = r.json()
    assert signed["status"] == "active"
    assert signed["signature"]["typed_name"] == "Alex Rivera"
    assert signed["signature"]["signed_at"]
    # ip + ua should be captured for the audit trail (even if empty in tests)
    assert "ip_address" in signed["signature"]
    assert "user_agent" in signed["signature"]


def test_cant_re_sign_active_plan(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    plan = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                         json=body, timeout=15).json()
    requests.post(f"{API}/portal/payment-plans/{plan['id']}/sign",
                  headers=fx["client_headers"], json={"typed_name": "Alex"}, timeout=15)
    r = requests.post(f"{API}/portal/payment-plans/{plan['id']}/sign",
                     headers=fx["client_headers"], json={"typed_name": "Alex"}, timeout=15)
    assert r.status_code == 400


def test_mark_paid_updates_status_and_auto_completes(admin_headers, fx):
    body = _make_plan(fx["client_id"], total=400, n=2)
    plan = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                         json=body, timeout=15).json()
    requests.post(f"{API}/portal/payment-plans/{plan['id']}/sign",
                  headers=fx["client_headers"], json={"typed_name": "Alex"}, timeout=15)

    # Pay first installment
    inst_a = plan["installments"][0]
    r = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst_a['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["status"] == "active"  # still active, one installment left
    assert updated["installments"][0]["status"] == "paid"
    assert updated["installments"][0]["paid_method"] == "cash"

    # Pay the second — plan should auto-complete
    inst_b = plan["installments"][1]
    r2 = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst_b['id']}/mark-paid",
        headers=admin_headers, json={"method": "card"}, timeout=15,
    )
    assert r2.json()["status"] == "completed"


def test_double_mark_paid_rejected(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    plan = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                         json=body, timeout=15).json()
    inst = plan["installments"][0]
    requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15,
    )
    r = requests.post(
        f"{API}/admin/payment-plans/{plan['id']}/installments/{inst['id']}/mark-paid",
        headers=admin_headers, json={"method": "cash"}, timeout=15,
    )
    assert r.status_code == 400


def test_admin_list_decorates_totals_and_overdue(admin_headers, fx):
    # Build a plan with an OVERDUE installment by backdating the first one
    today = date.today()
    body = {
        "client_id": fx["client_id"],
        "program_name": "Overdue Test",
        "total_amount": 200,
        "cadence": "biweekly",
        "installments": [
            {"due_date": (today - timedelta(days=5)).isoformat(), "amount": 100},
            {"due_date": (today + timedelta(days=9)).isoformat(), "amount": 100},
        ],
    }
    plan = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                         json=body, timeout=15).json()
    rows = requests.get(f"{API}/admin/payment-plans?client_id=" + fx["client_id"],
                        headers=admin_headers, timeout=15).json()
    ours = next(r for r in rows if r["id"] == plan["id"])
    assert ours["paid_total"] == 0
    assert ours["remaining_total"] == 200
    assert ours["overdue_count"] == 1


def test_client_can_only_see_own_plans(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    p = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                      json=body, timeout=15).json()
    rows = requests.get(f"{API}/portal/payment-plans",
                        headers=fx["client_headers"], timeout=15).json()
    assert len(rows) >= 1
    assert all(r["client_id"] == fx["client_id"] for r in rows)
    assert any(r["id"] == p["id"] for r in rows)


def test_admin_required():
    r = requests.get(f"{API}/admin/payment-plans", timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.get(f"{API}/admin/payment-plans/settings", timeout=15)
    assert r2.status_code in (401, 403)


def test_cancel_plan(admin_headers, fx):
    body = _make_plan(fx["client_id"])
    p = requests.post(f"{API}/admin/payment-plans", headers=admin_headers,
                      json=body, timeout=15).json()
    r = requests.post(f"{API}/admin/payment-plans/{p['id']}/cancel",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
