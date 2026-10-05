"""Reopening the cash drawer from a reprint or Retry Open is a till action (audit #48): it needs take_payments
and the register PIN of the employee doing it (always, as a No-Sale open does), and it leaves a drawer-audit row
naming who authorized it. It creates no money. Disposable tag TEST_RETRY_OPEN."""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RETRY_OPEN"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _staff(staff_role, pin=None):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} staff",
         "role": "employee", "staff_role": staff_role, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG}
    if pin:
        u["register_pin_hash"] = server.hash_password(pin)
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _audits(source_key, value):
    return run(server.db.pos_drawer_audit.find({"source": "retry_open", source_key: value}, {"_id": 0}).to_list(10))


def teardown_module():
    run(server.db.users.delete_many({"tag": TAG}))
    run(server.db.pos_drawer_audit.delete_many({"tag": TAG}))
    run(server.db.invoices.delete_many({"tag": TAG}))
    run(server.db.pos_sales.delete_many({"tag": TAG}))
    run(server.db.payment_ledger.delete_many({"tag": TAG}))


def _invoice():
    iid = f"{TAG}-inv-{uuid.uuid4().hex[:6]}"
    run(server.db.invoices.insert_one({"id": iid, "client_id": f"{TAG}-c", "total": 10.0, "tag": TAG, "booking_ids": [iid]}))
    return iid


def _pin():
    return f"{uuid.uuid4().int % 9000 + 1000}"


def test_a_reprint_that_opens_the_drawer_needs_take_payments_and_is_audited_with_the_pin_holder():
    iid = _invoice()
    pin = _pin()
    desk = _staff("front_desk", pin=pin)
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-1", "pin": pin}))
    assert res.status_code == 200 and res.json().get("open_drawer_token")
    rows = _audits("invoice_id", iid)
    assert len(rows) == 1 and rows[0]["workstation_id"] == "ws-1"
    assert rows[0]["user_id"] == desk["id"] and rows[0]["authorized_by_id"] == desk["id"]


def test_the_read_only_staff_cannot_open_the_drawer_even_with_a_pin():
    iid = _invoice()
    pin = _pin()
    reader = _staff("read_only", pin=pin)
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(reader),
                         json={"actions": ["open_drawer"], "pin": pin}))
    assert res.status_code == 403
    assert _audits("invoice_id", iid) == []


def test_opening_the_drawer_without_a_pin_is_refused():
    iid = _invoice()
    desk = _staff("front_desk", pin=_pin())
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(desk), json={"actions": ["open_drawer"]}))
    assert res.status_code == 400
    assert _audits("invoice_id", iid) == []


def test_a_wrong_pin_is_refused():
    iid = _invoice()
    desk = _staff("front_desk", pin=_pin())
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "pin": "0000-wrong"}))
    assert res.status_code == 403
    assert _audits("invoice_id", iid) == []


def test_a_receipt_reprint_needs_no_pin():
    iid = _invoice()
    desk = _staff("front_desk", pin=_pin())
    res = run(_http.post(f"/api/invoices/{iid}/pos-tokens", headers=_auth(desk), json={"actions": ["print_receipt"]}))
    assert res.status_code not in (400, 403), "a receipt reprint is not a drawer open, so no PIN is asked for"


def test_a_sale_reopen_is_audited_with_the_pin_holder():
    sid = f"{TAG}-sale-{uuid.uuid4().hex[:6]}"
    run(server.db.pos_sales.insert_one({"id": sid, "cash_component": 0.0, "tag": TAG}))
    pin = _pin()
    desk = _staff("front_desk", pin=pin)
    res = run(_http.post(f"/api/pos/sales/{sid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-2", "pin": pin}))
    assert res.status_code == 200
    assert _audits("pos_sale_id", sid)[0]["authorized_by_id"] == desk["id"]


def test_a_tab_row_reopen_is_audited_with_the_pin_holder():
    cid, lid = f"{TAG}-c2", f"{TAG}-led-{uuid.uuid4().hex[:6]}"
    run(server.db.payment_ledger.insert_one({"id": lid, "client_id": cid, "amount": 5.0, "tag": TAG}))
    pin = _pin()
    desk = _staff("front_desk", pin=pin)
    res = run(_http.post(f"/api/clients/{cid}/ledger/{lid}/pos-tokens", headers=_auth(desk),
                         json={"actions": ["open_drawer"], "workstation_id": "ws-3", "pin": pin}))
    assert res.status_code == 200
    assert _audits("ledger_id", lid)[0]["authorized_by_id"] == desk["id"]
