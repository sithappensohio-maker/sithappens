"""Reopening the cash drawer from a reprint or Retry Open is a till action (audit #48): it needs take_payments,
and it leaves a drawer-audit row, like a manual open. It creates no money. Disposable tag TEST_RETRY_OPEN."""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RETRY_OPEN"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _staff(staff_role):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} staff",
         "role": "employee", "staff_role": staff_role, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _audits(source_key, value):
    return run(server.db.pos_drawer_audit.find({"source": "retry_open", source_key: value}, {"_id": 0}).to_list(10))


def teardown_module():
    for coll in ("users", "invoices", "pos_sales", "payment_ledger", "pos_drawer_audit"):
        run(getattr(server.db, coll).delete_many({"tag": TAG} if coll in ("users", "pos_drawer_audit") else {"id": {"$regex": f"^{TAG}"}}))


def _invoice():
    iid = f"{TAG}-inv-{uuid.uuid4().hex[:6]}"
    run(server.db.invoices.insert_one({"id": iid, "client_id": f"{TAG}-c", "total": 10.0, "tag": TAG}))
    return iid


def test_a_reprint_that_opens_the_drawer_needs_take_payments_and_is_audited():
    iid = _invoice()
    reader = _staff("read_only")
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(reader),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-1"}))
    assert res.status_code == 403
    assert _audits("invoice_id", iid) == []

    desk = _staff("front_desk")
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-1"}))
    assert res.status_code == 200 and res.json().get("open_drawer_token")
    rows = _audits("invoice_id", iid)
    assert len(rows) == 1 and rows[0]["workstation_id"] == "ws-1" and rows[0]["user_id"] == desk["id"]


def test_a_sale_reopen_is_audited():
    sid = f"{TAG}-sale-{uuid.uuid4().hex[:6]}"
    run(server.db.pos_sales.insert_one({"id": sid, "cash_component": 0.0, "tag": TAG}))
    desk = _staff("front_desk")
    res = run(_http.post(f"/api/pos/sales/{sid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-2"}))
    assert res.status_code == 200
    assert len(_audits("pos_sale_id", sid)) == 1


def test_a_tab_row_reopen_is_audited():
    cid, lid = f"{TAG}-c2", f"{TAG}-led-{uuid.uuid4().hex[:6]}"
    run(server.db.payment_ledger.insert_one({"id": lid, "client_id": cid, "amount": 5.0, "tag": TAG}))
    desk = _staff("front_desk")
    res = run(_http.post(f"/api/clients/{cid}/ledger/{lid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-3"}))
    assert res.status_code == 200
    assert len(_audits("ledger_id", lid)) == 1
