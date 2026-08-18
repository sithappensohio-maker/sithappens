"""Step 4B-10 — externally initiated Stripe refund tests.

Locks in the invariant:

    A Stripe refund produces the same financial result in Sit Happens
    whether initiated from the app or directly from Stripe — exactly once.

Mechanics under test: _handle_refund_event's external branch synthesizes
the attempt row the app flow would have created (linked via the refund's
payment_intent → payments.processor_payment_id, amount from Stripe's own
refund object, idempotency keyed on the refund id) and routes it through
the SAME _finalize_stripe_refund — one revenue algorithm, one 4B-9 tax
algorithm. App-initiated refunds are recognized even when the webhook
races ahead of the local stripe_refund_id write, via the
sithappens_refund_attempt_id metadata Stripe carries back. Only
status=="succeeded" creates financial records. Tag TEST_EXTREF.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_EXTREF"
ADMIN = {"id": "extref", "name": "ExtRef QA", "email": "extref@test", "role": "admin"}


def _sale(pay_id, intent_id, total, tax, source_kind="shop_order", payment_source="shop_order_payment"):
    d = server.business_today().isoformat()
    run(server.db.payments.insert_one({
        "id": pay_id, "client_id": f"{TAG}-c", "amount": total, "method": "stripe_online",
        "status": "completed", "refunded_amount": 0.0, "processor": "stripe",
        "processor_payment_id": intent_id, "source": {"kind": payment_source},
        "created_at": server.now_iso()}))
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": d, "amount": total, "payment_method": "stripe_online",
        "payment_id": pay_id, "source_kind": source_kind,
        **({"tax_amount": tax, "pre_tax_amount": round(total - tax, 2)} if tax else {}),
        "description": f"{TAG} stripe sale", "created_at": server.now_iso()}))
    return d


def _event(refund_id, intent_id, amount, status="succeeded", metadata=None):
    return {"id": refund_id, "object": "refund", "status": status,
            "amount": int(round(amount * 100)), "payment_intent": intent_id,
            "metadata": metadata or {}}


def _handle(ev):
    run(server._handle_refund_event(ev))


def _reversals(pay_id):
    return run(server.db.retail_sales.find(
        {"source_kind": "stripe_refund", "reversed_payment_id": pay_id},
        {"_id": 0, "amount": 1, "tax_amount": 1}).to_list(20))


def _tax(d):
    return float(run(server.sales_tax_summary(d, d, ADMIN))["retail_tax_total"])


def _app_refund(pay_id, amount):
    """The app flow's attempt shape (pre-Stripe-call), then finalize —
    equivalent to admin_refund_stripe_payment without the network call."""
    aid = f"{TAG}-app-{uuid.uuid4().hex[:6]}"
    run(server.db.stripe_refund_attempts.insert_one({
        "id": aid, "idempotency_key": aid, "request_fingerprint": aid,
        "payment_id": pay_id, "invoice_id": None, "amount_cents": int(round(amount * 100)),
        "reason": f"{TAG} app refund", "status": "succeeded",
        "stripe_refund_id": f"re_{aid}", "applied_refund_payment_id": None,
        "created_at": server.now_iso(), "updated_at": server.now_iso()}))
    run(server._finalize_stripe_refund(aid))
    return aid


def _cleanup():
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"reversed_payment_id": {"$regex": TAG}}))
    run(server.db.payments.delete_many({"id": {"$regex": TAG}}))
    run(server.db.stripe_refund_attempts.delete_many({"payment_id": {"$regex": TAG}}))


class _TaxBase:
    def __init__(self, d):
        self.v = _tax(d)

    def at(self, delta):
        return round(self.v + delta, 2)


# ── A — app-issued refund unchanged; its webhook replay adds nothing ────────
def test_a_app_refund_then_webhook_replay():
    pay, pi = f"{TAG}-a", f"pi_{TAG}_a"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        aid = _app_refund(pay, 110.0)
        assert len(_reversals(pay)) == 1
        assert _tax(d) == base.at(-10.0)
        # The webhook for the app refund arrives later — no additional effect.
        att = run(server.db.stripe_refund_attempts.find_one({"id": aid}, {"_id": 0}))
        _handle(_event(att["stripe_refund_id"], pi, 110.0,
                       metadata={"sithappens_refund_attempt_id": aid}))
        assert len(_reversals(pay)) == 1
        assert _tax(d) == base.at(-10.0)
    finally:
        _cleanup()


# ── B — external full refund: one reversal, revenue and tax net to zero ─────
def test_b_external_full_refund():
    pay, pi = f"{TAG}-b", f"pi_{TAG}_b"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _handle(_event("re_ext_b", pi, 110.0))
        rows = _reversals(pay)
        assert len(rows) == 1 and rows[0]["amount"] == -110.0 and rows[0]["tax_amount"] == -10.0
        assert _tax(d) == base.at(-10.0)
    finally:
        _cleanup()


# ── C + N — external partial: exact revenue reversal, tax never guessed ─────
def test_cn_external_partial():
    pay, pi = f"{TAG}-c1", f"pi_{TAG}_c1"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _handle(_event("re_ext_c", pi, 20.0))
        rows = _reversals(pay)
        assert len(rows) == 1 and rows[0]["amount"] == -20.0 and rows[0]["tax_amount"] == 0.0
        assert _tax(d) == base.at(0.0)
        w = run(server.weekly_summary(ADMIN, ref_date=d))
        # 4B-4 trio for this pair: gross keeps 110, reversal magnitude 20.
        assert w["gross_total"] >= 110.0 and w["refunds_reversals_total"] >= 20.0
    finally:
        _cleanup()


# ── D — multiple external partials: each once; tax on cumulative completion ─
def test_d_multiple_external_partials():
    pay, pi = f"{TAG}-d", f"pi_{TAG}_d"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _handle(_event("re_ext_d1", pi, 30.0))
        _handle(_event("re_ext_d2", pi, 20.0))
        assert _tax(d) == base.at(0.0)
        _handle(_event("re_ext_d3", pi, 60.0))
        rows = _reversals(pay)
        assert sorted(r["amount"] for r in rows) == [-60.0, -30.0, -20.0]
        assert sorted(float(r["tax_amount"]) for r in rows) == [-10.0, 0.0, 0.0]
        assert _tax(d) == base.at(-10.0)
    finally:
        _cleanup()


# ── E — mixed app + external refunds reconcile without duplicates ───────────
def test_e_mixed_app_and_external():
    pay, pi = f"{TAG}-e", f"pi_{TAG}_e"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        aid = _app_refund(pay, 30.0)
        _handle(_event("re_ext_e", pi, 80.0))     # dashboard completes the refund
        att = run(server.db.stripe_refund_attempts.find_one({"id": aid}, {"_id": 0}))
        _handle(_event(att["stripe_refund_id"], pi, 30.0,
                       metadata={"sithappens_refund_attempt_id": aid}))  # app's own webhook
        rows = _reversals(pay)
        assert sorted(r["amount"] for r in rows) == [-80.0, -30.0]
        assert round(sum(r["amount"] for r in rows), 2) == -110.0
        assert _tax(d) == base.at(-10.0)  # cumulative full → exact original tax once
    finally:
        _cleanup()


# ── F — duplicate external webhook: exactly one financial effect ────────────
def test_f_duplicate_webhook():
    pay, pi = f"{TAG}-f", f"pi_{TAG}_f"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        for _ in range(3):
            _handle(_event("re_ext_f", pi, 110.0))
        assert len(_reversals(pay)) == 1
        assert _tax(d) == base.at(-10.0)
        pay_doc = run(server.db.payments.find_one({"id": pay}, {"_id": 0, "refunded_amount": 1}))
        assert pay_doc["refunded_amount"] == 110.0  # not tripled
    finally:
        _cleanup()


# ── G — out-of-order delivery still reconciles ──────────────────────────────
def test_g_out_of_order():
    pay, pi = f"{TAG}-g", f"pi_{TAG}_g"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        # The later (completing) refund's event arrives first, then earlier
        # ones, then a replay of the first.
        _handle(_event("re_ext_g3", pi, 60.0))
        _handle(_event("re_ext_g1", pi, 30.0))
        _handle(_event("re_ext_g2", pi, 20.0))
        _handle(_event("re_ext_g3", pi, 60.0))
        rows = _reversals(pay)
        assert round(sum(r["amount"] for r in rows), 2) == -110.0 and len(rows) == 3
        assert round(sum(float(r["tax_amount"]) for r in rows), 2) == -10.0  # once, total
        assert _tax(d) == base.at(-10.0)
    finally:
        _cleanup()


# ── H — pending/failed external events create nothing ───────────────────────
def test_h_pending_failed_ignored():
    pay, pi = f"{TAG}-h", f"pi_{TAG}_h"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        _handle(_event("re_ext_h", pi, 110.0, status="pending"))
        _handle(_event("re_ext_h2", pi, 110.0, status="failed"))
        assert _reversals(pay) == []
        assert _tax(d) == base.at(0.0)
        # A later succeeded event for the same refund then processes normally.
        _handle(_event("re_ext_h", pi, 110.0, status="succeeded"))
        assert len(_reversals(pay)) == 1
    finally:
        _cleanup()


# ── I — missing local payment: no crash, no fabricated reversal ─────────────
def test_i_missing_local_payment():
    d = server.business_today().isoformat()
    base = _TaxBase(d)
    _handle(_event("re_ext_i", "pi_nonexistent_xyz", 110.0))
    assert _tax(d) == base.at(0.0)
    assert run(server.db.stripe_refund_attempts.find_one({"stripe_refund_id": "re_ext_i"})) is None
    assert run(server.db.retail_sales.find_one({"description": "Stripe refund · pi_nonexistent_xyz"})) is None


# ── J + K — categories: shop refund vs invoice-payment refund ───────────────
def test_jk_categories():
    d = server.business_today().isoformat()
    pay1, pi1 = f"{TAG}-j", f"pi_{TAG}_j"
    _sale(pay1, pi1, 110.0, 10.0)  # shop order → Retail
    pay2, pi2 = f"{TAG}-k", f"pi_{TAG}_k"
    _sale(pay2, pi2, 30.0, 0, source_kind="stripe_online_payment",
          payment_source="stripe_online_payment")  # invoice payment → account
    try:
        w0 = run(server.weekly_summary(ADMIN, ref_date=d))
        # RH1 — category totals are BUSINESS REVENUE: the $110 shop order is
        # $100 of revenue + $10 of Ohio sales tax; the $30 invoice payment
        # carried no tax. Reversal magnitudes follow the same basis, so the
        # pair contributes $100 + $30 = $130, not $140.
        assert w0["retail_total"] >= 100.0 and w0["account_payments_total"] >= 30.0
        _handle(_event("re_ext_j", pi1, 110.0))
        _handle(_event("re_ext_k", pi2, 30.0))
        w = run(server.weekly_summary(ADMIN, ref_date=d))
        # Originals keep their categories; both reversals land in the
        # signed Refunds & reversals bucket (4B-5 classifier on stripe_refund).
        assert w["retail_total"] == w0["retail_total"]
        assert w["account_payments_total"] == w0["account_payments_total"]
        assert w["refunds_reversals_total"] >= w0["refunds_reversals_total"] + 130.0
    finally:
        _cleanup()


# ── L — expected cash never moves ───────────────────────────────────────────
def test_l_expected_cash():
    d = server.business_today().isoformat()
    before = float(run(server._register_day_summary(d))["totals"]["expected_cash"])
    pay, pi = f"{TAG}-l", f"pi_{TAG}_l"
    _sale(pay, pi, 110.0, 10.0)
    try:
        _handle(_event("re_ext_l", pi, 110.0))
        after = float(run(server._register_day_summary(d))["totals"]["expected_cash"])
        assert abs(after - before) < 0.005
    finally:
        _cleanup()


# ── O — app/webhook race: metadata recovers the attempt, never duplicates ───
def test_o_app_webhook_race():
    pay, pi = f"{TAG}-o", f"pi_{TAG}_o"
    d = _sale(pay, pi, 110.0, 10.0)
    base = _TaxBase(d)
    try:
        # App created its attempt and called Stripe, but the local
        # stripe_refund_id write hasn't landed yet when the webhook arrives.
        aid = f"{TAG}-o-att"
        run(server.db.stripe_refund_attempts.insert_one({
            "id": aid, "idempotency_key": aid, "request_fingerprint": aid,
            "payment_id": pay, "invoice_id": None, "amount_cents": 11000,
            "reason": f"{TAG} racing refund", "status": "pending",
            "stripe_refund_id": None, "applied_refund_payment_id": None,
            "created_at": server.now_iso(), "updated_at": server.now_iso()}))
        _handle(_event("re_ext_o", pi, 110.0,
                       metadata={"sithappens_refund_attempt_id": aid}))
        # Webhook recovered the app attempt (no synthesized duplicate) and
        # finalized it via the normal succeeded path.
        atts = run(server.db.stripe_refund_attempts.find(
            {"payment_id": pay}, {"_id": 0, "id": 1, "stripe_refund_id": 1}).to_list(10))
        assert len(atts) == 1 and atts[0]["stripe_refund_id"] == "re_ext_o"
        assert len(_reversals(pay)) == 1
        assert _tax(d) == base.at(-10.0)
        # And the app's own later finalization is a no-op.
        run(server._finalize_stripe_refund(aid))
        assert len(_reversals(pay)) == 1
    finally:
        _cleanup()
