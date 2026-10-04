"""A customized payment-plan agreement is the one the client reads and signs
(audit: "A customized payment-plan agreement is thrown away").

The plan screen let staff edit the agreement for one family and showed that
edit in its preview, then sent it to the server, which dropped it and filled
the plan with the standard agreement from Settings. The client signed a
document nobody had previewed. Now the edited text is rendered for that one
plan (values escaped, as the standard one is) and stored as its snapshot.

Disposable tag TEST_PPCUSTOM.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_PPCUSTOM"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
SETTINGS_TEMPLATE = "<p>SETTINGS-TEMPLATE {{client_name}}</p>"


def _owner():
    u = {"id": f"{TAG}-o-{uuid.uuid4().hex[:6]}", "email": f"{TAG.lower()}-o-{uuid.uuid4().hex[:6]}@example.com",
         "name": f"{TAG} Owner", "role": "admin", "password_hash": "x", "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(u)))
    return u, {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], 'admin', 0)}"}


def _client_login(cid):
    email = f"{TAG.lower()}-c-{uuid.uuid4().hex[:6]}@example.com"
    u = {"id": f"{TAG}-cu-{uuid.uuid4().hex[:6]}", "email": email, "name": "Pat", "role": "client", "client_id": cid,
         "password_hash": "x", "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(u)))
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], email, 'client', 0)}"}


def _family():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    # No email on file, so the plan-created notice is skipped in the test.
    run(server.db.clients.insert_one({"id": cid, "name": "Pat & Lee <b>x</b>", "email": "", "client_status": "active",
                                      "created_at": server.now_iso()}))
    return cid


def _body(cid, custom=None):
    body = {"client_id": cid, "program_name": "Puppy Program", "total_amount": 300.0, "cadence": "monthly",
            "installments": [{"due_date": "2026-11-01", "amount": 150.0}, {"due_date": "2026-11-15", "amount": 150.0}]}
    if custom is not None:
        body["custom_agreement_template"] = custom
    return body


@pytest.fixture(autouse=True)
def _settings_and_cleanup():
    before = run(server.db.payment_plan_settings.find_one({"_id": "singleton"}))
    run(server.db.payment_plan_settings.replace_one({"_id": "singleton"},
                                                    {"_id": "singleton", **{k: v for k, v in (before or {}).items() if k != "_id"},
                                                     "agreement_html": SETTINGS_TEMPLATE}, upsert=True))
    yield
    run(server.db.payment_plans.delete_many({"client_id": {"$regex": f"^{TAG}"}}))
    run(server.db.clients.delete_many({"id": {"$regex": f"^{TAG}"}}))
    run(server.db.users.delete_many({"id": {"$regex": f"^{TAG}"}}))
    if before is None:
        run(server.db.payment_plan_settings.delete_one({"_id": "singleton"}))
    else:
        run(server.db.payment_plan_settings.replace_one({"_id": "singleton"}, before, upsert=True))


def test_the_customized_agreement_is_what_the_client_reads_and_signs():
    _, owner = _owner()
    cid = _family()
    custom = ("<p>CUSTOM-TERMS {{client_name}} owes {{total_amount}} in {{installment_count}}</p>"
              "<p>{{schedule_list}}</p>")
    res = run(_http.post("/api/admin/payment-plans", json=_body(cid, custom), headers=owner))
    assert res.status_code == 200, res.text
    plan = res.json()
    snap = plan["agreement_snapshot"]
    assert "CUSTOM-TERMS" in snap and "$300.00" in snap and "owes" in snap
    assert "<strong>2026-11-01</strong>" in snap
    assert "Pat &amp; Lee &lt;b&gt;x" in snap, "the family's name is escaped"
    assert "SETTINGS-TEMPLATE" not in snap and "<b>x</b>" not in snap

    portal = _client_login(cid)
    shown = run(_http.get("/api/portal/payment-plans", headers=portal)).json()
    shown_plan = next(p for p in (shown if isinstance(shown, list) else shown.get("plans", [])) if p["id"] == plan["id"])
    assert shown_plan["agreement_snapshot"] == snap, "the client reads the customized text"

    sign = run(_http.post(f"/api/portal/payment-plans/{plan['id']}/sign", json={"typed_name": "Pat Lee"}, headers=portal))
    assert sign.status_code == 200, sign.text
    stored = run(server.db.payment_plans.find_one({"id": plan["id"]}, {"_id": 0}))
    assert stored["agreement_snapshot"] == snap, "what was signed is what was previewed"


def test_the_plan_renders_its_own_template_with_the_same_escaping():
    plan = {"client_name": "Pat & Lee <b>x</b>", "program_name": "Puppy", "total_amount": 300.0,
            "installments": [{"due_date": "2026-11-01", "amount": 150.0}]}
    out = server._render_agreement(plan, {"business_name": "X", "agreement_html": "<p>GENERAL</p>"},
                                   template="<p>OWN {{client_name}}</p>")
    assert "OWN Pat &amp; Lee &lt;b&gt;x" in out and "GENERAL" not in out


def test_no_custom_text_or_blank_text_uses_the_saved_template():
    _, owner = _owner()
    cid = _family()
    for custom in (None, "   "):
        res = run(_http.post("/api/admin/payment-plans", json=_body(cid, custom), headers=owner))
        assert res.status_code == 200, res.text
        assert "SETTINGS-TEMPLATE" in res.json()["agreement_snapshot"]


def test_a_custom_agreement_does_not_change_the_saved_one():
    _, owner = _owner()
    cid = _family()
    run(_http.post("/api/admin/payment-plans", json=_body(cid, "<p>ONE-OFF</p>"), headers=owner))
    saved = run(server.db.payment_plan_settings.find_one({"_id": "singleton"}, {"_id": 0}))
    assert saved["agreement_html"] == SETTINGS_TEMPLATE


def test_creating_a_plan_still_needs_finance_reports():
    cid = _family()
    desk = {"id": f"{TAG}-desk-{uuid.uuid4().hex[:6]}", "email": f"{TAG.lower()}-desk-{uuid.uuid4().hex[:6]}@example.com",
            "name": f"{TAG} desk", "role": "employee", "staff_role": "front_desk", "active": True,
            "password_hash": "x", "token_version": 0}
    run(server.db.users.insert_one(dict(desk)))
    h = {"Authorization": f"Bearer {server.create_access_token(desk['id'], desk['email'], 'employee', 0)}"}
    res = run(_http.post("/api/admin/payment-plans", json=_body(cid, "<p>X</p>"), headers=h))
    assert res.status_code == 403
