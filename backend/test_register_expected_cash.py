"""Register accounting invariant tests — expected drawer cash.

Locks in the Step-1 cash-register accounting fixes:

  Any cash physically entering or leaving the drawer must change the
  expected cash balance by exactly the same amount.

Specifically:
  * a split-tender Front Desk sale contributes its ACTUAL cash component
    (from pos_sales.tenders) to expected cash — never lumped into "Other";
  * daily tender totals decompose a split into its real buckets;
  * voiding a POS sale reverses the ORIGINAL tender composition, so the
    cash portion (and only the cash portion) leaves expected cash;
  * register refunds hit the tender bucket they were issued in — a cash
    refund lowers expected cash, a card refund does not.

Note on tenders: the Front Desk POS tender literals are currently
cash/check/venmo/paypal/other (card arrives with the Stripe Terminal
step), so the split tests pair cash with venmo — the bucketing logic is
method-agnostic. The register REFUND endpoint does support "card", so the
card-refund case uses it directly.

Same harness conventions as test_pos_checkout_integrity.py: direct async
server calls on the disposable test DB, disposable rows tagged
TEST_REG_CASH, cleanup in finally.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_REG_CASH"
FAKE_USER = {"id": "test-user", "name": "Register QA", "email": "qa@test", "role": "admin"}
OPENING_CASH = 100.0


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


class _OpenRegisterDay:
    """Same discipline as test_pos_checkout_integrity's fixture (see its
    docstring), but opens the disposable drawer session with a REAL
    opening cash of $100 so expected-cash assertions are absolute."""

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


def _sell(product, tenders, client_id=None):
    body = server.PosSaleIn(
        lines=[{"kind": "retail", "product_id": product["id"], "qty": 1}],
        tenders=tenders,
        client_id=client_id,
        idempotency_key=uuid.uuid4().hex,
    )
    return run(server.create_pos_sale(body, FAKE_USER))


def _void(sale_id, reason="register accounting test"):
    return run(server.void_pos_sale(
        sale_id,
        server.PosSaleVoidIn(reason=reason, idempotency_key=uuid.uuid4().hex),
        FAKE_USER,
    ))


def _refund(amount, method, date):
    return run(server.admin_register_refund(
        server.RegisterRefundIn(reason=f"{TAG} refund", amount=amount, payment_method=method, date=date),
        FAKE_USER,
    ))


def _cleanup(*, products=(), sale_ids=(), date=None):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
        # register-refund rows created by this file
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
    run(go())


class _Baseline:
    """Snapshot of expected cash + method buckets before this test acts.

    The disposable suite DB is shared by every test file, and the register
    summary legitimately counts other files' same-day booking/payment rows,
    so absolute drawer totals are not stable across the whole suite run.
    Each test therefore asserts EXACT deltas against this snapshot — the
    accounting invariant is precisely about deltas ("cash in/out changes
    expected cash by exactly that amount"). The literal $100→$125/$140/$165
    arithmetic from the spec is additionally locked absolutely in
    test_i_absolute_summary_math_on_isolated_date, which runs on a
    synthetic past date no other test writes to.
    """

    def __init__(self, date):
        summ = _summary(date)
        self.expected_cash = float(summ["totals"]["expected_cash"])
        self.methods = {k: round(float(v or 0), 2) for k, v in (summ["incoming_by_method"] or {}).items()}

    def expected(self, delta):
        return round(self.expected_cash + delta, 2)

    def method(self, key, delta):
        return round(self.methods.get(key, 0.0) + delta, 2)


# ── Test A — normal cash sale ────────────────────────────────────────────────
def test_a_cash_sale_raises_expected_cash_by_sale_amount():
    p = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [{"method": "cash", "amount": 25.0, "tendered_amount": 25.0}])
            sale_id = r["sale"]["id"]
            # opening $100 + $25 cash sale → +$25 exactly ($125 on a quiet day)
            assert abs(_expected_cash(day.date) - base.expected(25.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test B — non-cash sale leaves expected cash alone ────────────────────────
def test_b_noncash_sale_does_not_change_expected_cash():
    p = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [{"method": "venmo", "amount": 25.0}])
            sale_id = r["sale"]["id"]
            # non-cash tender: expected cash unchanged
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "venmo") - base.method("venmo", 25.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test C — split sale decomposes into real tender buckets ──────────────────
def test_c_split_sale_counts_cash_component_and_decomposes_buckets():
    p = _product(price=100.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [
                {"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                {"method": "venmo", "amount": 60.0},
            ])
            sale_id = r["sale"]["id"]
            # The stored sale keeps the authoritative tender composition.
            assert abs(float(r["sale"]["cash_component"]) - 40.0) < 0.005
            # Expected cash rises by exactly the cash portion ($140 on a quiet day).
            assert abs(_expected_cash(day.date) - base.expected(40.0)) < 0.005
            # Daily tender totals decompose the split — never $100 of "Other".
            assert abs(_method_total(day.date, "cash") - base.method("cash", 40.0)) < 0.005
            assert abs(_method_total(day.date, "venmo") - base.method("venmo", 60.0)) < 0.005
            assert abs(_method_total(day.date, "other") - base.method("other", 0.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test D — cash sale then full void returns to baseline ────────────────────
def test_d_cash_sale_void_reverses_expected_cash():
    p = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [{"method": "cash", "amount": 25.0, "tendered_amount": 25.0}])
            sale_id = r["sale"]["id"]
            # opening $100 + $25 cash sale → +$25 exactly ($125 on a quiet day)
            assert abs(_expected_cash(day.date) - base.expected(25.0)) < 0.005
            _void(sale_id)
            # cash returned to the customer → back to the pre-sale drawer ($100)
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", 0.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test E — split sale then full void reconciles every bucket ───────────────
def test_e_split_sale_void_reverses_original_tender_composition():
    p = _product(price=100.0)
    run(server.db.pos_products.insert_one(dict(p)))
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r = _sell(p, [
                {"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                {"method": "venmo", "amount": 60.0},
            ])
            sale_id = r["sale"]["id"]
            assert abs(_expected_cash(day.date) - base.expected(40.0)) < 0.005
            _void(sale_id)
            # Only the original $40 cash portion leaves the drawer.
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", 0.0)) < 0.005
            assert abs(_method_total(day.date, "venmo") - base.method("venmo", 0.0)) < 0.005
            assert abs(_method_total(day.date, "other") - base.method("other", 0.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test F — cash refund lowers expected cash ────────────────────────────────
def test_f_cash_refund_lowers_expected_cash():
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            _refund(15.0, "cash", day.date)
            # $15 physically left the drawer ($85 on a quiet day)
            assert abs(_expected_cash(day.date) - base.expected(-15.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", -15.0)) < 0.005
        finally:
            _cleanup(date=day.date)


# ── Test G — card refund does not touch the drawer ───────────────────────────
def test_g_card_refund_does_not_change_expected_cash():
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            _refund(15.0, "card", day.date)
            # card money never lived in the drawer → expected cash unchanged
            assert abs(_expected_cash(day.date) - base.expected(0.0)) < 0.005
            assert abs(_method_total(day.date, "card") - base.method("card", -15.0)) < 0.005
        finally:
            _cleanup(date=day.date)


# ── Test H — mixed activity nets out exactly ─────────────────────────────────
def test_h_mixed_activity_expected_cash_is_exact():
    p1 = _product(price=50.0)
    p2 = _product(price=100.0)
    run(server.db.pos_products.insert_many([dict(p1), dict(p2)]))
    sale_ids = []
    with _OpenRegisterDay() as day:
        try:
            base = _Baseline(day.date)
            r1 = _sell(p1, [{"method": "cash", "amount": 50.0, "tendered_amount": 50.0}])
            sale_ids.append(r1["sale"]["id"])
            r2 = _sell(p2, [
                {"method": "cash", "amount": 25.0, "tendered_amount": 25.0},
                {"method": "venmo", "amount": 75.0},
            ])
            sale_ids.append(r2["sale"]["id"])
            _refund(10.0, "cash", day.date)
            # +$50 cash +$25 cash −$10 cash = +$65 exactly (100 → 165 on a quiet day)
            assert abs(_expected_cash(day.date) - base.expected(65.0)) < 0.005
            assert abs(_method_total(day.date, "cash") - base.method("cash", 65.0)) < 0.005
            assert abs(_method_total(day.date, "venmo") - base.method("venmo", 75.0)) < 0.005
        finally:
            _cleanup(products=[p1["id"], p2["id"]], sale_ids=sale_ids, date=day.date)


# \u2500\u2500 Test I \u2014 the spec's literal arithmetic, on a date nothing else touches \u2500\u2500
def test_i_absolute_summary_math_on_isolated_date():
    """Absolute version of the invariant: opening $100; $50 cash sale;
    $100 split sale ($25 cash / $75 venmo); $10 cash refund; then a full
    void of the split sale. Rows are written exactly the way
    create_pos_sale / void_pos_sale / admin_register_refund write them,
    but pinned to a synthetic past date so the totals are absolute:

        after sales+refund:  expected = 100 + 50 + 25 - 10 = 165
        after voiding split: expected = 165 - 25 = 140
    """
    d = "2001-01-01"
    sale_id = str(uuid.uuid4())
    ids = [str(uuid.uuid4()) for _ in range(5)]
    try:
        run(server.db.cash_drawer_sessions.insert_one({
            "date": d, "opening_cash": 100.0, "opened_at": server.now_iso(),
            "opened_by": TAG, "opened_by_name": TAG, "notes": TAG,
        }))
        run(server.db.retail_sales.insert_one({
            "id": ids[0], "date": d, "amount": 50.0, "payment_method": "cash",
            "description": f"{TAG} cash sale", "created_at": f"{d}T10:00:00",
        }))
        run(server.db.pos_sales.insert_one({
            "id": sale_id, "business_date": d, "total": 100.0, "status": "completed",
            "tenders": [
                {"method": "cash", "amount": 25.0, "tendered_amount": 25.0, "change_given": 0.0},
                {"method": "venmo", "amount": 75.0},
            ],
            "cash_component": 25.0, "created_at": f"{d}T11:00:00",
        }))
        run(server.db.retail_sales.insert_one({
            "id": ids[1], "date": d, "amount": 100.0, "payment_method": "split",
            "pos_sale_id": sale_id, "description": f"{TAG} split sale",
            "created_at": f"{d}T11:00:00",
        }))
        run(server.db.retail_sales.insert_one({
            "id": ids[2], "date": d, "amount": -10.0, "payment_method": "cash",
            "source_kind": "refund", "description": f"{TAG} refund",
            "created_at": f"{d}T12:00:00",
        }))
        summ = _summary(d)
        assert abs(float(summ["totals"]["expected_cash"]) - 165.0) < 0.005
        assert abs(float(summ["incoming_by_method"].get("cash") or 0) - 65.0) < 0.005
        assert abs(float(summ["incoming_by_method"].get("venmo") or 0) - 75.0) < 0.005
        assert abs(float(summ["incoming_by_method"].get("other") or 0)) < 0.005

        run(server.db.retail_sales.insert_one({
            "id": ids[3], "date": d, "amount": -100.0, "payment_method": "void",
            "source_kind": "pos_sale_void", "pos_sale_id": sale_id,
            "reversed_retail_sales_id": ids[1],
            "description": f"{TAG} void", "created_at": f"{d}T13:00:00",
        }))
        summ = _summary(d)
        assert abs(float(summ["totals"]["expected_cash"]) - 140.0) < 0.005
        assert abs(float(summ["incoming_by_method"].get("cash") or 0) - 40.0) < 0.005
        assert abs(float(summ["incoming_by_method"].get("venmo") or 0)) < 0.005
        assert abs(float(summ["incoming_by_method"].get("other") or 0)) < 0.005
    finally:
        run(server.db.cash_drawer_sessions.delete_many({"date": d, "opened_by": TAG}))
        run(server.db.retail_sales.delete_many({"id": {"$in": ids}}))
        run(server.db.pos_sales.delete_many({"id": sale_id}))
