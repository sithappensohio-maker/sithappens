"""Step 2 — Front Desk register permissions + payment-path parity tests.

Locks in the least-privilege fixes:

  A staff member with permission to PERFORM a register/payment action also
  has exactly enough READ access to complete it — and no more. Finance
  reporting stays finance_reports-gated.

Covers:
  1. front_desk can read a client's OPEN invoices (new operational
     endpoint) while the full finance invoice list stays 403;
  2. front_desk can collect a top-up payment on that open invoice;
  3. front_desk can read bare register status (OPEN/CLOSED/NOT_OPEN),
     while read_only staff cannot;
  4. the full register day summary (expected cash etc.) remains 403 for
     front_desk — no broad finance grant;
  5. a manually-recorded CARD tender at the POS buckets to "card", never
     touches expected cash, and voids reverse it exactly;
  6. cash-sale regression: expected cash still moves by exactly the cash
     amount (guards Step 1 while Step 2 touched adjacent code);
  7. tab payments follow the cash rules — cash without tendered_amount is
     rejected, with it it commits;
  8. credit-pack sales follow the SAME drawer rule as every other cash
     path: cash pack sale with no drawer session → 400; with a drawer the
     accounting lands once (one retail_sales row, one credit grant);
  9. open-drawer rollover discipline: opening cash that differs from the
     previous closeout's rollover requires a written override reason.

Same harness conventions as test_register_expected_cash.py (direct async
calls + delta assertions on the shared disposable DB) plus the ASGI
transport pattern from test_online_school_phase4.py for permission-gate
(Depends) coverage. Disposable rows tagged TEST_REG_STEP2.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_REG_STEP2"
FAKE_ADMIN = {"id": "step2-admin", "name": "Step2 Owner", "email": "step2@test", "role": "admin"}
OPENING_CASH = 100.0

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _get(path, headers):
    return run(_http.get(f"/api{path}", headers=headers))


def _post(path, body, headers):
    return run(_http.post(f"/api{path}", json=body, headers=headers))


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _make_client():
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@example.invalid",
    ), FAKE_ADMIN))
    return c["id"] if isinstance(c, dict) else c.id


def _insert_open_invoice(client_id, total=40.0):
    inv_id = str(uuid.uuid4())
    run(server.db.invoices.insert_one({
        "id": inv_id, "client_id": client_id, "status": "OPEN",
        "total": total, "amount_paid": 0.0, "balance": total,
        "refunded_total": 0.0, "created_at": server.now_iso(),
        "due_date": None, "notes": TAG,
    }))
    return inv_id


class _OpenRegisterDay:
    """Same fixture discipline as test_register_expected_cash.py: create
    today's drawer session only if absent, and remove it only if this
    fixture created it."""

    def __init__(self):
        self.date = None
        self.marker = None
        self.created = False

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-register-{uuid.uuid4()}"
        before = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {
                "date": self.date,
                "opening_cash": OPENING_CASH,
                "notes": f"{TAG} disposable test register day",
                "suggested_opening_cash": None,
                "suggested_opening_from_date": None,
                "suggested_opening_from_closeout_id": None,
                "opening_override_reason": "",
                "opening_was_overridden": False,
                "opened_at": server.now_iso(),
                "opened_by": self.marker,
                "opened_by_name": f"{TAG} fixture",
            }},
            upsert=True,
            projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _summary(date):
    return run(server._register_day_summary(date))


def _expected_cash(date):
    return float(_summary(date)["totals"]["expected_cash"])


def _method_total(date, method):
    return round(float((_summary(date)["incoming_by_method"] or {}).get(method) or 0), 2)


class _Baseline:
    """Delta snapshot — see test_register_expected_cash._Baseline for why
    absolute totals aren't stable on the shared disposable DB."""

    def __init__(self, date):
        summ = _summary(date)
        self.expected_cash = float(summ["totals"]["expected_cash"])
        self.methods = {k: round(float(v or 0), 2) for k, v in (summ["incoming_by_method"] or {}).items()}

    def expected(self, delta):
        return round(self.expected_cash + delta, 2)

    def method(self, key, delta):
        return round(self.methods.get(key, 0.0) + delta, 2)


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": 25.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": False,
    }
    doc.update(overrides)
    return doc


def _sell(product, tenders):
    body = server.PosSaleIn(
        lines=[{"kind": "retail", "product_id": product["id"], "qty": 1}],
        tenders=tenders,
        idempotency_key=uuid.uuid4().hex,
    )
    return run(server.create_pos_sale(body, FAKE_ADMIN))


def _void(sale_id):
    return run(server.void_pos_sale(
        sale_id,
        server.PosSaleVoidIn(reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex),
        FAKE_ADMIN,
    ))


def _cleanup(*, users=(), clients=(), invoices=(), products=(), sale_ids=(), packs=()):
    async def go():
        if users:
            await server.db.users.delete_many({"id": {"$in": list(users)}})
        if clients:
            ids = list(clients)
            await server.db.clients.delete_many({"id": {"$in": ids}})
            await server.db.payment_ledger.delete_many({"client_id": {"$in": ids}})
            await server.db.credit_lots.delete_many({"client_id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"client_id": {"$in": ids}})
        if invoices:
            await server.db.invoices.delete_many({"id": {"$in": list(invoices)}})
            await server.db.payments.delete_many({"invoice_id": {"$in": list(invoices)}})
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if packs:
            await server.db.credit_packs.delete_many({"id": {"$in": list(packs)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
        await server.db.retail_sales.delete_many({"notes": {"$regex": TAG}})
    run(go())


# ── Test 1 — open-invoices readable by front_desk; full list still 403 ──────
def test_1_front_desk_reads_open_invoices_not_full_invoice_list():
    uid = cid = inv_id = None
    try:
        uid, headers = _insert_staff("front_desk")
        cid = _make_client()
        inv_id = _insert_open_invoice(cid, total=40.0)

        r = _get(f"/clients/{cid}/open-invoices", headers)
        assert r.status_code == 200, r.text
        rows = r.json()["invoices"]
        assert [row["id"] for row in rows] == [inv_id]
        assert abs(rows[0]["balance"] - 40.0) < 0.005
        # Least privilege: the operational rows carry no finance detail
        # beyond what's needed to collect (id/status/amounts/dates).
        assert "notes" not in rows[0]

        # The finance-grade full history stays locked.
        r = _get(f"/clients/{cid}/invoices", headers)
        assert r.status_code == 403, r.text
    finally:
        _cleanup(users=[uid] if uid else (), clients=[cid] if cid else (), invoices=[inv_id] if inv_id else ())


# ── Test 2 — front_desk collects a top-up payment on that invoice ───────────
def test_2_front_desk_collects_invoice_payment():
    uid = cid = inv_id = None
    with _OpenRegisterDay():
        try:
            uid, headers = _insert_staff("front_desk")
            cid = _make_client()
            inv_id = _insert_open_invoice(cid, total=40.0)

            r = _post(f"/invoices/{inv_id}/payments", {
                "amount": 40.0, "method": "venmo", "notes": TAG,
                "idempotency_key": uuid.uuid4().hex,
            }, headers)
            assert r.status_code == 200, r.text
            inv = run(server.db.invoices.find_one({"id": inv_id}, {"_id": 0}))
            assert abs(float(inv["balance"])) < 0.005
            assert abs(float(inv["amount_paid"]) - 40.0) < 0.005

            # And the settled invoice no longer shows as open.
            r = _get(f"/clients/{cid}/open-invoices", headers)
            assert r.status_code == 200
            assert r.json()["invoices"] == []
        finally:
            _cleanup(users=[uid] if uid else (), clients=[cid] if cid else (), invoices=[inv_id] if inv_id else ())


# ── Test 3 — bare register status for cashiers; read_only stays out ─────────
def test_3_register_status_readable_by_front_desk_not_read_only():
    fd_uid = ro_uid = None
    with _OpenRegisterDay():
        try:
            fd_uid, fd_headers = _insert_staff("front_desk")
            ro_uid, ro_headers = _insert_staff("read_only")

            r = _get("/admin/register/status", fd_headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "OPEN"
            assert body["date"] == server.business_today().isoformat()
            # Bare status only — no drawer math leaks through this endpoint.
            assert "expected_cash" not in body and "totals" not in body

            r = _get("/admin/register/status", ro_headers)
            assert r.status_code == 403, r.text
        finally:
            _cleanup(users=[u for u in (fd_uid, ro_uid) if u])


# ── Test 4 — the finance day summary stays 403 for front_desk ───────────────
def test_4_register_day_summary_still_forbidden_for_front_desk():
    uid = None
    try:
        uid, headers = _insert_staff("front_desk")
        r = _get("/admin/register/day", headers)
        assert r.status_code == 403, r.text
    finally:
        _cleanup(users=[uid] if uid else ())


# ── Test 5 — manual card tender buckets to card; void reverses it ───────────
def test_5_card_pos_sale_buckets_to_card_and_void_reverses():
    p = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [{"method": "card", "amount": 25.0}])
            sale_id = r["sale"]["id"]
            # Card money never lives in the drawer.
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "card") - base.method("card", 25.0)) < 0.005
            assert abs(_method_total(day.date, "other") - base.method("other", 0.0)) < 0.005

            _void(sale_id)
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "card") - base.method("card", 0.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test 6 — cash regression: Step 1 invariant survives Step 2 ──────────────
def test_6_cash_sale_regression_expected_cash_moves_exactly():
    p = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [{"method": "cash", "amount": 25.0, "tendered_amount": 30.0}])
            sale_id = r["sale"]["id"]
            assert abs(_expected_cash(day.date) - base.expected(25.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", 25.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test 7 — tab payment obeys the cash rules ────────────────────────────────
def test_7_tab_payment_cash_requires_tendered_amount():
    uid = cid = None
    with _OpenRegisterDay():
        try:
            uid, headers = _insert_staff("front_desk")
            cid = _make_client()

            r = _post(f"/clients/{cid}/payment", {"amount": 10.0, "method": "cash", "notes": TAG}, headers)
            assert r.status_code == 400, r.text
            assert "tendered_amount" in r.text

            r = _post(f"/clients/{cid}/payment", {
                "amount": 10.0, "method": "cash", "tendered_amount": 20.0, "notes": TAG,
            }, headers)
            assert r.status_code == 200, r.text
        finally:
            _cleanup(users=[uid] if uid else (), clients=[cid] if cid else ())


# ── Test 8 — pack sale drawer parity: same cash rules as the POS cart ───────
def test_8_pack_sale_cash_follows_drawer_rule_and_books_once():
    uid = cid = pack_id = None
    today = server.business_today().isoformat()
    # Temporarily stash any existing drawer session so the "no drawer"
    # branch is deterministic, then restore it exactly.
    stashed = run(server.db.cash_drawer_sessions.find_one({"date": today}))
    if stashed is not None:
        run(server.db.cash_drawer_sessions.delete_one({"_id": stashed["_id"]}))
    try:
        uid, headers = _insert_staff("front_desk")
        cid = _make_client()
        pack_id = str(uuid.uuid4())
        run(server.db.credit_packs.insert_one({
            "id": pack_id, "slug": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}",
            "name": f"{TAG} 5-pack", "qty": 5, "price": 50.0,
            "service_type": "daycare", "active": True, "show_at_register": True,
            "taxable": False,
        }))
        body = {"items": [{"pack_id": pack_id, "quantity": 1}], "payment_method": "cash", "note": TAG}

        # No drawer session today → the cash sale is refused up front.
        r = _post(f"/clients/{cid}/sell-packs", body, headers)
        assert r.status_code == 400, r.text
        assert "register" in r.text.lower()
        # Refusal must be clean: no credits granted, no revenue booked.
        assert run(server.db.credit_lots.find_one({"client_id": cid})) is None
        assert run(server.db.retail_sales.find_one({"client_id": cid})) is None

        with _OpenRegisterDay() as day:
            base = _Baseline(day.date)
            r = _post(f"/clients/{cid}/sell-packs", body, headers)
            assert r.status_code == 200, r.text
            # Exactly one lot, once.
            lots = run(server.db.credit_lots.find({"client_id": cid}, {"_id": 0}).to_list(10))
            assert len(lots) == 1
            assert lots[0]["qty_total"] == 5
            client_doc = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
            assert int(client_doc.get(server._credit_balance_field("daycare") or "credits") or 0) == 5
            # Exactly one revenue row, and the register sees the cash once —
            # identical accounting to any other $50 cash tender.
            rows = run(server.db.retail_sales.find({"client_id": cid}, {"_id": 0}).to_list(10))
            assert len(rows) == 1
            assert abs(_expected_cash(day.date) - base.expected(50.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", 50.0)) < 0.005
    finally:
        _cleanup(users=[uid] if uid else (), clients=[cid] if cid else (), packs=[pack_id] if pack_id else ())
        if stashed is not None:
            run(server.db.cash_drawer_sessions.update_one(
                {"_id": stashed["_id"]}, {"$setOnInsert": stashed}, upsert=True,
            ))


# ── Test 9 — opening cash that ignores the rollover needs a reason ──────────
def test_9_open_drawer_rollover_override_requires_reason():
    """Runs on an isolated synthetic date pair (2001-02-01 opening after a
    2001-01-31 closeout) so today's real drawer session is never touched."""
    d_close, d_open = "2001-01-31", "2001-02-01"
    closeout_id = str(uuid.uuid4())
    try:
        run(server.db.daily_closeouts.insert_one({
            "id": closeout_id, "date": d_close, "status": "closed",
            "rollover_cash": 200.0, "cash_counted": 200.0,
            "created_at": "2999-01-01T00:00:00",  # wins the created_at tiebreak
            "created_by_name": TAG, "notes": TAG,
        }))

        # Mismatched opening with no reason → refused, and no session saved.
        with pytest.raises(server.HTTPException) as exc:
            run(server.admin_open_cash_drawer(
                server.CashDrawerOpenIn(date=d_open, opening_cash=150.0), FAKE_ADMIN,
            ))
        assert exc.value.status_code == 400
        assert "rollover" in str(exc.value.detail).lower()
        assert run(server.db.cash_drawer_sessions.find_one({"date": d_open})) is None

        # Same mismatch WITH a written reason → accepted and recorded as an override.
        run(server.admin_open_cash_drawer(
            server.CashDrawerOpenIn(date=d_open, opening_cash=150.0,
                                    opening_override_reason="bank deposit"), FAKE_ADMIN,
        ))
        sess = run(server.db.cash_drawer_sessions.find_one({"date": d_open}, {"_id": 0}))
        assert sess["opening_was_overridden"] is True
        assert sess["opening_override_reason"] == "bank deposit"

        # Matching the rollover exactly needs no reason.
        run(server.db.cash_drawer_sessions.delete_many({"date": d_open}))
        run(server.admin_open_cash_drawer(
            server.CashDrawerOpenIn(date=d_open, opening_cash=200.0), FAKE_ADMIN,
        ))
        sess = run(server.db.cash_drawer_sessions.find_one({"date": d_open}, {"_id": 0}))
        assert sess["opening_was_overridden"] is False
    finally:
        run(server.db.daily_closeouts.delete_many({"id": closeout_id}))
        run(server.db.cash_drawer_sessions.delete_many({"date": d_open}))
