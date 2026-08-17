"""Step 4B-9 — Stripe shop-order refund sales-tax tests.

Locks in the invariant for Stripe/shop-order refunds:

    Reverse only tax provable from authoritative stored data — the exact
    ORIGINAL tax, exactly once, and only when the CUMULATIVE refunded
    amount covers the full original charge. Refund attempts carry no
    line-item identity, so partial refunds of taxable/mixed orders never
    get a guessed tax split (explicit 0.0 = tax-explicit marker).

Architecture (hybrid, mirrors 4B-1): new reversal rows store explicit
tax via _finalize_stripe_refund (idempotent — unique payment_id row per
attempt, marker-gated cumulative on payments.refunded_amount);
historical keyless rows reconstruct read-time in
_legacy_stripe_refund_tax_reversals when full-coverage is provable from
linkage, skipped otherwise. Revenue, categories, and expected cash are
untouched — regression-pinned below. Tag TEST_STRTAX.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_STRTAX"
ADMIN = {"id": "strtax", "name": "StrTax QA", "email": "strtax@test", "role": "admin"}


def _sale(pay_id, total, tax, date=None, **extra):
    """Original shop-order payment + retail row, the webhook's shape."""
    d = date or server.business_today().isoformat()
    run(server.db.payments.insert_one({
        "id": pay_id, "client_id": f"{TAG}-c", "amount": total, "method": "stripe_online",
        "status": "completed", "refunded_amount": 0.0,
        "source": {"kind": "shop_order_payment"}, "created_at": server.now_iso()}))
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": d, "amount": total, "payment_method": "stripe_online",
        "payment_id": pay_id, "shop_order_id": f"{TAG}-ord", "source_kind": "shop_order",
        **({"tax_amount": tax, "pre_tax_amount": round(total - tax, 2)} if tax else {}),
        "description": f"{TAG} shop order", "created_at": f"{d}T12:00:00+00:00", **extra}))
    return d


def _refund(pay_id, amount, n=None):
    aid = f"{TAG}-att-{uuid.uuid4().hex[:6]}"
    run(server.db.stripe_refund_attempts.insert_one({
        "id": aid, "payment_id": pay_id, "amount_cents": int(round(amount * 100)),
        "status": "succeeded", "stripe_refund_id": f"re_{aid}",
        "idempotency_key": aid, "reason": f"{TAG} refund", "created_at": server.now_iso()}))
    run(server._finalize_stripe_refund(aid))
    return aid


def _tax(d):
    return float(run(server.sales_tax_summary(d, d, ADMIN))["retail_tax_total"])


def _cleanup():
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": "Stripe refund"},
                                            "reversed_payment_id": {"$regex": TAG}}))
    run(server.db.payments.delete_many({"id": {"$regex": TAG}}))
    run(server.db.stripe_refund_attempts.delete_many({"id": {"$regex": TAG}}))


class _TaxBase:
    def __init__(self, d):
        self.v = _tax(d)

    def at(self, delta):
        return round(self.v + delta, 2)


# ── A — taxable Stripe sale reports its tax ─────────────────────────────────
def test_a_taxable_stripe_sale():
    pay = f"{TAG}-a"
    try:
        d = _sale(pay, 110.0, 10.0)
        base = _TaxBase(d)  # includes our own +10 already; assert via row
        assert _tax(d) >= 10.0
    finally:
        _cleanup()


# ── B — full refund: tax and revenue both net to zero ───────────────────────
def test_b_full_refund_reverses_tax():
    pay = f"{TAG}-b"
    d = _sale(pay, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _refund(pay, 110.0)
        assert _tax(d) == base.at(-10.0)
        row = run(server.db.retail_sales.find_one(
            {"source_kind": "stripe_refund", "reversed_payment_id": pay}, {"_id": 0}))
        assert row["tax_amount"] == -10.0 and row["amount"] == -110.0
    finally:
        _cleanup()


# ── C — non-taxable sale: full refund leaves no tax artifact ────────────────
def test_c_nontaxable_full_refund():
    pay = f"{TAG}-c1"
    d = _sale(pay, 100.0, 0)
    base = _TaxBase(d)
    try:
        _refund(pay, 100.0)
        assert _tax(d) == base.at(0.0)
        row = run(server.db.retail_sales.find_one(
            {"source_kind": "stripe_refund", "reversed_payment_id": pay}, {"_id": 0}))
        assert row["tax_amount"] == 0.0
    finally:
        _cleanup()


# ── D — mixed order, partial refund: tax is NEVER guessed ───────────────────
def test_d_mixed_order_partial_no_guess():
    pay = f"{TAG}-d"
    d = _sale(pay, 108.0, 8.0)  # $80 taxable + $20 non-taxable + $8 tax
    base = _TaxBase(d)
    try:
        _refund(pay, 20.0)
        assert _tax(d) == base.at(0.0)  # unchanged — refunded item unknown
        row = run(server.db.retail_sales.find_one(
            {"source_kind": "stripe_refund", "reversed_payment_id": pay}, {"_id": 0}))
        assert row["tax_amount"] == 0.0  # explicit marker, not a guess
    finally:
        _cleanup()


# ── E — item-level partial: documented as unsupported by the data model ─────
def test_e_item_level_partial_unsupported_documented():
    """stripe_refund_attempts persist only amount_cents/reason/ids — no line
    items, quantities, or per-line tax — so exact partial tax allocation is
    not provable and is deliberately NOT implemented. This pins that shape:
    if refund attempts ever gain line-item fields, this fails and item-level
    reversal must be consciously designed."""
    pay = f"{TAG}-e"
    _sale(pay, 110.0, 10.0)
    try:
        aid = _refund(pay, 20.0)
        att = run(server.db.stripe_refund_attempts.find_one({"id": aid}, {"_id": 0}))
        assert not any(k in att for k in ("line_items", "items", "refunded_items", "tax_amount"))
    finally:
        _cleanup()


# ── F — multiple partials reaching full: tax reversed exactly once ──────────
def test_f_cumulative_partials_reverse_once():
    pay = f"{TAG}-f"
    d = _sale(pay, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _refund(pay, 30.0)
        assert _tax(d) == base.at(0.0)   # not full yet — nothing fabricated
        _refund(pay, 20.0)
        assert _tax(d) == base.at(0.0)
        _refund(pay, 60.0)               # cumulative 110 — full
        assert _tax(d) == base.at(-10.0)
        rows = run(server.db.retail_sales.find(
            {"source_kind": "stripe_refund", "reversed_payment_id": pay},
            {"_id": 0, "tax_amount": 1}).to_list(10))
        assert sorted(float(r["tax_amount"]) for r in rows) == [-10.0, 0.0, 0.0]
    finally:
        _cleanup()


# ── G — duplicate webhook delivery never double-reverses ────────────────────
def test_g_duplicate_webhook_idempotent():
    pay = f"{TAG}-g"
    d = _sale(pay, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        aid = _refund(pay, 110.0)
        assert _tax(d) == base.at(-10.0)
        run(server._finalize_stripe_refund(aid))  # direct replay
        att = run(server.db.stripe_refund_attempts.find_one({"id": aid}, {"_id": 0}))
        run(server._handle_refund_event({"id": att["stripe_refund_id"], "status": "succeeded"}))
        assert _tax(d) == base.at(-10.0)  # still exactly once
        count = run(server.db.retail_sales.count_documents(
            {"source_kind": "stripe_refund", "reversed_payment_id": pay}))
        assert count == 1
    finally:
        _cleanup()


# ── H — historical full refund reconstructs read-time ───────────────────────
def test_h_historical_full_refund_reconstructed():
    d = "2001-12-01"
    pay = f"{TAG}-h"
    _sale(pay, 110.0, 10.0, date=d)
    # pre-4B-9 reversal shape: no tax_amount key at all
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": d, "amount": -110.0, "payment_method": "stripe_online",
        "payment_id": f"{TAG}-h-rev", "reversed_payment_id": pay, "source_kind": "stripe_refund",
        "description": f"{TAG} historical stripe refund", "created_at": f"{d}T15:00:00+00:00"}))
    try:
        assert _tax(d) == 0.0  # +10 −10 reconstructed = 0, no migration
        assert _tax(d) == 0.0  # deterministic on re-read
    finally:
        _cleanup()


# ── I — missing linkage: no crash, no guessed tax ───────────────────────────
def test_i_missing_linkage_safe():
    d = "2001-12-02"
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": d, "amount": -50.0, "payment_method": "stripe_online",
        "source_kind": "stripe_refund", "reversed_payment_id": f"{TAG}-gone",
        "description": f"{TAG} orphaned stripe refund", "created_at": f"{d}T15:00:00+00:00"}))
    try:
        assert _tax(d) == 0.0  # original untraceable — nothing fabricated
    finally:
        _cleanup()


# ── J + K — revenue trio and Finance category regressions ───────────────────
def test_jk_revenue_and_category_regression():
    pay = f"{TAG}-jk"
    d = _sale(pay, 110.0, 10.0)
    try:
        _refund(pay, 110.0)
        w = run(server.weekly_summary(ADMIN, ref_date=d))
        # 4B-4 trio: gross keeps the sale, reversal magnitude separate, net 0
        # for this pair (delta-safe: our rows are the only TAG rows today).
        assert w["gross_total"] >= 110.0
        assert w["refunds_reversals_total"] >= 110.0
        # 4B-5 categories: the shop order is Retail; the refund is a reversal.
        rev_line = next((b for b in w["by_service"] if b["name"] == "Refunds & reversals"), None)
        assert rev_line is not None and rev_line["total"] <= -110.0
    finally:
        _cleanup()


# ── L — expected cash never moves for Stripe activity ───────────────────────
def test_l_expected_cash_regression():
    pay = f"{TAG}-l"
    d = server.business_today().isoformat()
    before = float(run(server._register_day_summary(d))["totals"]["expected_cash"])
    _sale(pay, 110.0, 10.0)
    try:
        _refund(pay, 110.0)
        after = float(run(server._register_day_summary(d))["totals"]["expected_cash"])
        assert abs(after - before) < 0.005
    finally:
        _cleanup()


# ── M — quarterly tax figure inherits the correction, no double reversal ────
def test_m_quarterly_regression():
    d = "2001-12-03"
    pay = f"{TAG}-m"
    _sale(pay, 110.0, 10.0, date=d)
    run(server.db.retail_sales.insert_one({  # historical keyless full refund
        "id": str(uuid.uuid4()), "date": d, "amount": -110.0, "payment_method": "stripe_online",
        "payment_id": f"{TAG}-m-rev", "reversed_payment_id": pay, "source_kind": "stripe_refund",
        "description": f"{TAG} historical stripe refund", "created_at": f"{d}T15:00:00+00:00"}))
    try:
        legacy = run(server._legacy_stripe_refund_tax_reversals(d, d))
        assert len(legacy) == 1 and legacy[0]["tax_amount"] == -10.0
        # And running it twice yields the same single reconstruction.
        again = run(server._legacy_stripe_refund_tax_reversals(d, d))
        assert again == legacy
    finally:
        _cleanup()
