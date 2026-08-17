"""Step 4C-1 — Ohio service vs merchandise sales-tax taxability (A–T).

Approved policy under test: Sit Happens SERVICES (daycare, boarding,
training, training programs, service credit packs, service custom lines,
invoice/account payments for services) NEVER generate sales tax — even
when the legacy sales_tax.applies_to toggles are adversarially enabled —
while PHYSICAL MERCHANDISE keeps the existing configured tax engine
(rate/allocation untouched). Service dollars remain business income
everywhere (register, Finance, quarterly); only the sales-tax slice is
zero. Historical rows with stored tax are NEVER silently erased.

The fixture enables tax at 7% with every applies_to toggle ON — the most
adversarial configuration — so each exemption is proven against the very
switch that used to tax it. Harness conventions match
test_sales_tax_reversal.py (direct async calls, disposable DB, delta
baselines, cleanup in finally). Disposable tag TEST_SVCTAX.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_SVCTAX"
ADMIN = {"id": "svctax-admin", "name": "SvcTax QA", "email": "svctax@test", "role": "admin"}
RATE = 7.0

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _adversarial_tax_settings():
    """Enable tax with EVERY toggle on (incl. the service ones the old code
    honored), restore the prior config after — never leak into other files."""
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": {
            "enabled": True, "rate_pct": RATE, "label": "Sales Tax",
            "applies_to": {"daycare": True, "boarding": True, "training": True,
                           "grooming": True, "photography": True,
                           "retail": True, "credit_packs": True}}}}, upsert=True))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


class _OpenRegisterDay:
    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-{uuid.uuid4()}"
        self.created = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {"date": self.date, "opening_cash": 100.0, "opened_at": server.now_iso(),
                              "opened_by": self.marker, "opened_by_name": TAG, "notes": TAG}},
            upsert=True, projection={"_id": 0},
        )) is None
        return self

    def __exit__(self, *exc):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _summary(d):
    return run(server._sales_tax_window_summary(d, d))


class _TaxBase:
    def __init__(self, d):
        s = _summary(d)
        self.total = float(s["total_tax_collected"])
        self.bookings = float(s["bookings_tax_total"])
        self.retail = float(s["retail_tax_total"])

    def check(self, d, total=0.0, bookings=0.0, retail=0.0):
        s = _summary(d)
        assert abs(float(s["total_tax_collected"]) - (self.total + total)) < 0.005, s
        assert abs(float(s["bookings_tax_total"]) - (self.bookings + bookings)) < 0.005, s
        assert abs(float(s["retail_tax_total"]) - (self.retail + retail)) < 0.005, s


def _expected_cash(d):
    return float(run(server._register_day_summary(d))["totals"]["expected_cash"])


# ── fixtures: client/dog/booking + checkout through the REAL tax writer ─────

def _mk_client_dog():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} client", "email": f"{uuid.uuid4().hex}@example.com"}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog",
                                   "vaccines": {"rabies": "2099-01-01"}}))
    return cid, did


def _mk_booking(cid, did, service_type, **over):
    bid = str(uuid.uuid4())
    today = server.business_today().isoformat()
    doc = {"id": bid, "client_id": cid, "client_name": f"{TAG} client", "dog_id": did,
           "dog_name": f"{TAG} dog", "service_type": service_type, "date": today,
           "end_date": today, "status": "approved", "dropoff_time": "08:00",
           "pickup_time": "17:00", "time": "", "checked_in_at": server.now_iso(),
           "checked_out_at": None, "created_at": server.now_iso()}
    doc.update(over)
    run(server.db.bookings.insert_one(doc))
    return bid


def _checkout(bid, price, method="cash"):
    return run(server.check_out(
        bid, server.CheckoutIn(base_price=price, payment_method=method, payment_status="paid"),
        user=ADMIN))


def _cleanup_booking(cid, did, bids=()):
    async def go():
        await server.db.bookings.delete_many({"id": {"$in": list(bids)}})
        await server.db.invoices.delete_many({"client_id": cid})
        await server.db.payments.delete_many({"client_id": cid})
        await server.db.payment_ledger.delete_many({"client_id": cid})
        await server.db.retail_sales.delete_many({"client_id": cid})
        await server.db.dogs.delete_many({"id": did})
        await server.db.clients.delete_many({"id": cid})
    run(go())


def _service_checkout_case(service_type):
    """$100 service checkout under adversarial toggles: no tax, full revenue."""
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, service_type)
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            cash0 = _expected_cash(day.date)
            _checkout(bid, 100.0)
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert float(b["actual_price"]) == 100.0          # tax never folded in
            assert not b.get("tax_amount")                     # no sales tax stored
            assert server._sales_tax_collected_on_booking(b) == 0.0
            assert server._cash_revenue(b) == 100.0            # STILL business income
            base.check(day.date)                               # summary unmoved
            assert abs(_expected_cash(day.date) - (cash0 + 100.0)) < 0.005  # register keeps the $100
        finally:
            _cleanup_booking(cid, did, [bid])


# ── A/B/C — daycare / boarding / training: $0 tax, $100 revenue ─────────────
def test_a_daycare_untaxed_full_revenue():
    _service_checkout_case("daycare")


def test_b_boarding_untaxed_full_revenue():
    _service_checkout_case("boarding")


def test_c_training_untaxed_full_revenue():
    _service_checkout_case("training")


# ── grooming stays configurable (existing engine untouched where intended) ──
def test_grooming_toggle_still_works():
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, "grooming")
    with _OpenRegisterDay() as day:
        try:
            _checkout(bid, 100.0)
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert abs(float(b["tax_amount"]) - 7.0) < 0.005
            assert float(b["actual_price"]) == 107.0
        finally:
            _cleanup_booking(cid, did, [bid])


# ── POS/pricing helpers ─────────────────────────────────────────────────────

def _product(price, taxable=True, online=False):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
           "category": "", "price": price, "active": True, "archived": False,
           "show_at_register": True, "show_online": online, "track_inventory": False,
           "stock_on_hand": 0, "category_id": None, "subcategory_id": None,
           "featured": False, "image_id": None, "taxable": taxable}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _pack(price, taxable_flag=False, online=False):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} pack", "price": price, "active": True,
           "available_online": online, "show_at_register": True, "service_type": "daycare",
           "credits": 10, "taxable": taxable_flag, "category_id": None, "subcategory_id": None}
    run(server.db.credit_packs.insert_one(dict(doc)))
    return doc


def _program(price, taxable_flag=False, online=False):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} program", "price": price, "active": True,
           "available_online": online, "show_at_register": True,
           "format": {"count": 6, "unit": "sessions"}, "taxable": taxable_flag,
           "category_id": None, "subcategory_id": None}
    run(server.db.programs.insert_one(dict(doc)))
    return doc


def _price_pos(lines, client_id=None):
    priced, _ = run(server._price_pos_cart(
        [server.PosSaleLineIn(**l) for l in lines], None, can_price=True, client_id=client_id))
    return priced


def _cleanup_catalog(products=(), packs=(), programs=(), sale_ids=()):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if packs:
            await server.db.credit_packs.delete_many({"id": {"$in": list(packs)}})
        if programs:
            await server.db.programs.delete_many({"id": {"$in": list(programs)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
    run(go())


# ── D — training program: $300, tax $0 (even with a stray taxable=true) ─────
def test_d_training_program_untaxed():
    prog = _program(300.0, taxable_flag=True)  # adversarial stray flag
    cid, did = _mk_client_dog()
    try:
        priced = _price_pos([{"kind": "training_program", "program_id": prog["id"], "qty": 1}], client_id=cid)
        assert priced["subtotal"] == 300.0
        assert priced["tax_amount"] == 0.0
        assert priced["total"] == 300.0
        li = priced["line_items"][0]
        assert li["taxable"] is False and li["allocated_tax"] == 0.0
    finally:
        _cleanup_catalog(programs=[prog["id"]])
        _cleanup_booking(cid, did)


# ── E — service credit pack: $400, tax $0; redemption never re-taxes ────────
def test_e_credit_pack_untaxed_and_redemption_untaxed():
    pack = _pack(400.0, taxable_flag=True)  # adversarial stray flag
    cid, did = _mk_client_dog()
    try:
        priced = _price_pos([{"kind": "credit_pack", "pack_id": pack["id"], "qty": 1}], client_id=cid)
        assert priced["tax_amount"] == 0.0 and priced["total"] == 400.0
        assert priced["line_items"][0]["taxable"] is False
    finally:
        _cleanup_catalog(packs=[pack["id"]])
        _cleanup_booking(cid, did)
    # Redemption: checking out a daycare visit paid by credits stays untaxed
    cid, did = _mk_client_dog()
    run(server.db.clients.update_one({"id": cid}, {"$set": {"daycare_credits": 10.0}}))
    bid = _mk_booking(cid, did, "daycare", credits_deducted=1.0, credit_value=40.0,
                      payment_method="credits")
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            run(server.check_out(bid, server.CheckoutIn(use_credits=True), user=ADMIN))
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert not b.get("tax_amount")  # no tax at purchase OR redemption
            base.check(day.date)
        finally:
            _cleanup_booking(cid, did, [bid])


# ── F — physical merchandise keeps the configured tax engine ────────────────
def test_f_merchandise_taxed_at_configured_rate():
    p = _product(20.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            r = run(server.create_pos_sale(server.PosSaleIn(
                lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "card", "amount": 21.40}],
                idempotency_key=uuid.uuid4().hex), ADMIN))
            sale_id = r["sale"]["id"]
            assert abs(float(r["sale"]["tax_amount"]) - 1.40) < 0.005  # 7% of $20
            base.check(day.date, total=1.40, retail=1.40)
        finally:
            _cleanup_catalog(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── G — mixed cart: service $50 + toy $20 → taxable base $20 only ───────────
def test_g_mixed_cart_taxes_merchandise_only():
    p = _product(20.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            priced = _price_pos([
                {"kind": "custom", "custom_amount": 50.0, "custom_reason": f"{TAG} daycare service",
                 "description": "Daycare service", "custom_kind": "service"},
                {"kind": "retail", "product_id": p["id"], "qty": 1},
            ])
            assert priced["subtotal"] == 70.0
            assert abs(priced["tax_amount"] - 1.40) < 0.005      # 7% of $20, not $70
            assert abs(priced["total"] - 71.40) < 0.005
            svc_line = next(li for li in priced["line_items"] if li["kind"] == "custom")
            assert svc_line["taxable"] is False and svc_line["allocated_tax"] == 0.0
            r = run(server.create_pos_sale(server.PosSaleIn(
                lines=[{"kind": "custom", "custom_amount": 50.0, "custom_reason": f"{TAG} daycare service",
                        "description": "Daycare service", "custom_kind": "service"},
                       {"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "card", "amount": 71.40}],
                idempotency_key=uuid.uuid4().hex), ADMIN))
            sale_id = r["sale"]["id"]
            assert abs(float(r["sale"]["tax_amount"]) - 1.40) < 0.005
            base.check(day.date, total=1.40, retail=1.40)
        finally:
            _cleanup_catalog(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── H — mixed split tender: tax identical; expected cash = cash tender only ─
def test_h_mixed_split_tender():
    p = _product(20.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            cash0 = _expected_cash(day.date)
            r = run(server.create_pos_sale(server.PosSaleIn(
                lines=[{"kind": "custom", "custom_amount": 50.0, "custom_reason": f"{TAG} svc",
                        "description": "Service", "custom_kind": "service"},
                       {"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "cash", "amount": 30.0, "tendered_amount": 30.0},
                         {"method": "card", "amount": 41.40}],
                idempotency_key=uuid.uuid4().hex), ADMIN))
            sale_id = r["sale"]["id"]
            assert abs(float(r["sale"]["tax_amount"]) - 1.40) < 0.005  # tender-independent
            assert abs(_expected_cash(day.date) - (cash0 + 30.0)) < 0.005
        finally:
            _cleanup_catalog(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── I — service refund: revenue reverses, tax stays $0 ──────────────────────
def test_i_service_refund_no_tax_reversal():
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, "daycare")
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            _checkout(bid, 100.0)
            run(server.booking_refund(bid, server.BookingRefundIn(
                amount=100.0, payment_method="cash", reason=f"{TAG} refund"), ADMIN))
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert b["financial_refund_total"] == 100.0
            rows = run(server.db.retail_sales.find(
                {"description": {"$regex": TAG}, "category": "Refund"}, {"_id": 0}).to_list(10))
            assert len(rows) == 1 and rows[0]["amount"] == -100.0
            assert abs(float(rows[0].get("tax_amount") or 0)) < 0.005  # −0 tax, never invented
            base.check(day.date)  # net tax over the day: still zero delta
        finally:
            _cleanup_booking(cid, did, [bid])


# ── J — merchandise void keeps the 4B-1 exact tax reversal ──────────────────
def test_j_merchandise_void_reverses_tax_once():
    p = _product(20.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            r = run(server.create_pos_sale(server.PosSaleIn(
                lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "card", "amount": 21.40}],
                idempotency_key=uuid.uuid4().hex), ADMIN))
            sale_id = r["sale"]["id"]
            run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex), ADMIN))
            base.check(day.date)  # +1.40 then −1.40 — reversed exactly once
        finally:
            _cleanup_catalog(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── K — online physical product: taxed (and taxable=false override honored) ─
def test_k_online_merchandise_taxed():
    p = _product(20.0, taxable=True, online=True)
    p2 = _product(30.0, taxable=False, online=True)  # exempt product override
    try:
        priced = run(server._price_shop_cart(
            [server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1)], None))
        assert abs(priced["tax_amount"] - 1.40) < 0.005
        both = run(server._price_shop_cart(
            [server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1),
             server.ShopCartItemIn(kind="product", ref_id=p2["id"], quantity=1)], None))
        assert abs(both["tax_amount"] - 1.40) < 0.005  # only the taxable one
        assert both["total"] == 51.40
    finally:
        _cleanup_catalog(products=[p["id"], p2["id"]])


# ── L — online program / credit pack: tax $0 (Stripe ≠ taxable) ─────────────
def test_l_online_program_and_pack_untaxed():
    prog = _program(300.0, taxable_flag=True, online=True)
    pack = _pack(400.0, taxable_flag=True, online=True)
    try:
        priced = run(server._price_shop_cart(
            [server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1),
             server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=1)], None))
        assert priced["tax_amount"] == 0.0
        assert priced["total"] == 700.0
        assert all(l["allocated_tax"] == 0.0 for l in priced["lines"])
    finally:
        _cleanup_catalog(packs=[pack["id"]], programs=[prog["id"]])


# ── M — paying a $500 service invoice creates NO sales tax ──────────────────
def test_m_service_invoice_payment_untaxed():
    cid, _did = str(uuid.uuid4()), None
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} client", "email": f"{uuid.uuid4().hex}@example.com"}))
    inv_id = str(uuid.uuid4())
    run(server.db.invoices.insert_one({
        "id": inv_id, "client_id": cid, "status": "OPEN", "total": 500.0,
        "amount_paid": 0.0, "balance": 500.0, "refunded_total": 0.0,
        "created_at": server.now_iso(), "due_date": None, "notes": TAG,
        "service_type": "training"}))
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "admin",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    token = server.create_access_token(uid, email, "admin", 0)
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            r = run(_http.post(f"/api/invoices/{inv_id}/payments",
                               json={"amount": 500.0, "method": "venmo", "notes": TAG,
                                     "idempotency_key": uuid.uuid4().hex},
                               headers={"Authorization": f"Bearer {token}"}))
            assert r.status_code == 200, r.text
            inv = run(server.db.invoices.find_one({"id": inv_id}, {"_id": 0}))
            assert inv["amount_paid"] == 500.0
            base.check(day.date)  # $500 collected, $0.00 sales tax
        finally:
            run(server.db.users.delete_many({"id": uid}))
            run(server.db.invoices.delete_many({"id": inv_id}))
            run(server.db.payments.delete_many({"invoice_id": inv_id}))
            run(server.db.payment_ledger.delete_many({"client_id": cid}))
            run(server.db.retail_sales.delete_many({"client_id": cid}))
            run(server.db.clients.delete_many({"id": cid}))


# ── N — tracker liability = merchandise tax only, never the $120 base ───────
def test_n_tracker_uses_merchandise_tax_only():
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, "daycare")
    p = _product(20.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            _checkout(bid, 100.0)
            r = run(server.create_pos_sale(server.PosSaleIn(
                lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "card", "amount": 21.40}],
                idempotency_key=uuid.uuid4().hex), ADMIN))
            sale_id = r["sale"]["id"]
            # $120 of revenue in the period → liability delta is ONLY $1.40
            base.check(day.date, total=1.40, retail=1.40, bookings=0.0)
        finally:
            _cleanup_catalog(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())
            _cleanup_booking(cid, did, [bid])


# ── O — Finance/P&L regression: $100 daycare stays $100 income ──────────────
def test_o_service_revenue_intact_in_finance():
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, "daycare")
    with _OpenRegisterDay() as day:
        try:
            cash0 = _expected_cash(day.date)
            _checkout(bid, 100.0)
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert server._cash_revenue(b) == 100.0
            assert server._effective_cash_paid(b) if hasattr(server, "_effective_cash_paid") else True
            assert abs(_expected_cash(day.date) - (cash0 + 100.0)) < 0.005
            assert b["status"] == "completed" and b["payment_status"] == "paid"
        finally:
            _cleanup_booking(cid, did, [bid])


# ── P — quarterly/Schedule-C: service income still fully counted ────────────
def test_p_quarterly_income_keeps_service_revenue():
    cid, did = _mk_client_dog()
    year = server.business_today().year
    bid = _mk_booking(cid, did, "daycare")
    with _OpenRegisterDay():
        try:
            before = run(server.admin_quarterly_tax(_=ADMIN, year=year))["income"]
            _checkout(bid, 100.0)
            after = run(server.admin_quarterly_tax(_=ADMIN, year=year))["income"]
            assert abs(float(after["gross"]) - float(before["gross"]) - 100.0) < 0.005
            # and the sales-tax slice of that income is zero
            b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
            assert server._sales_tax_collected_on_booking(b) == 0.0
        finally:
            _cleanup_booking(cid, did, [bid])


# ── Q — historical service tax rows are NOT silently erased ─────────────────
def test_q_historical_service_tax_still_reported():
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": f"{TAG}-hist", "client_name": TAG, "dog_id": "x",
        "dog_name": TAG, "service_type": "daycare", "date": "2001-06-15",
        "end_date": "2001-06-15", "status": "completed", "payment_status": "paid",
        "actual_price": 107.50, "amount_paid": 107.50, "tax_amount": 7.50,
        "tax_rate_pct": 7.5, "taxable_cash_amount": 100.0,
        "created_at": "2001-06-15T12:00:00"}))
    try:
        s = run(server._sales_tax_window_summary("2001-06-15", "2001-06-15"))
        assert abs(float(s["bookings_tax_total"]) - 7.50) < 0.005  # visible, not zeroed
        assert abs(float(s["total_tax_collected"]) - 7.50) < 0.005
    finally:
        run(server.db.bookings.delete_many({"id": bid}))


# ── R — refunding a historically TAXED service stays deterministic ──────────
def test_r_historical_taxed_service_refund_reverses_stored_tax_once():
    cid, did = _mk_client_dog()
    bid = _mk_booking(cid, did, "daycare", status="completed", payment_status="paid",
                      actual_price=107.50, amount_paid=107.50, tax_amount=7.50,
                      tax_rate_pct=7.5, taxable_cash_amount=100.0,
                      checked_out_at=server.now_iso())
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBase(day.date)
            run(server.booking_refund(bid, server.BookingRefundIn(
                amount=107.50, payment_method="cash", reason=f"{TAG} hist refund"), ADMIN))
            rows = run(server.db.retail_sales.find(
                {"description": {"$regex": TAG}, "category": "Refund"}, {"_id": 0}).to_list(10))
            assert len(rows) == 1
            assert abs(float(rows[0]["tax_amount"]) + 7.50) < 0.005  # stored tax, reversed once
            base.check(day.date, total=-7.50, retail=-7.50)
        finally:
            _cleanup_booking(cid, did, [bid])


# ── S — custom MERCHANDISE line is taxed ────────────────────────────────────
def test_s_custom_merchandise_taxed():
    priced = _price_pos([{"kind": "custom", "custom_amount": 40.0,
                          "custom_reason": f"{TAG} replacement leash",
                          "description": "Replacement leash", "custom_kind": "merchandise"}])
    assert abs(priced["tax_amount"] - 2.80) < 0.005  # 7% of $40
    li = priced["line_items"][0]
    assert li["taxable"] is True and abs(li["allocated_tax"] - 2.80) < 0.005
    # default (omitted custom_kind) stays merchandise/taxed — API back-compat
    priced2 = _price_pos([{"kind": "custom", "custom_amount": 40.0,
                           "custom_reason": f"{TAG} legacy caller", "description": "Legacy"}])
    assert abs(priced2["tax_amount"] - 2.80) < 0.005


# ── T — custom SERVICE line is never taxed ──────────────────────────────────
def test_t_custom_service_untaxed():
    priced = _price_pos([{"kind": "custom", "custom_amount": 40.0,
                          "custom_reason": f"{TAG} extra walk", "description": "Extra walk",
                          "custom_kind": "service"}])
    assert priced["tax_amount"] == 0.0 and priced["total"] == 40.0
    li = priced["line_items"][0]
    assert li["taxable"] is False and li["allocated_tax"] == 0.0
    assert li["tax_exempt_reason"] == "Service — not sales-taxable"
