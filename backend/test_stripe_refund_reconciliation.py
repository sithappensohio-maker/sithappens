"""Step 4B-11 — reconciliation classifier tests (dry-run logic only).

Pure-function coverage of classify_stripe_refunded_payment plus a
repeatability/zero-write check of run_dry_run_audit on the disposable DB.
No apply path exists to test — the module is read-only by construction.
Tag TEST_RECON.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from stripe_refund_reconciliation import classify_stripe_refunded_payment, run_dry_run_audit

TAG = "TEST_RECON"


def _payment(amount, refunded):
    return {"id": f"{TAG}-pay", "amount": amount, "refunded_amount": refunded,
            "processor": "stripe", "processor_payment_id": f"pi_{TAG}",
            "source": {"kind": "shop_order_payment"}}


def _attempt(amount, status="succeeded", ts="2026-07-01T12:00:00+00:00", aid=None):
    return {"id": aid or f"{TAG}-att-{uuid.uuid4().hex[:6]}", "payment_id": f"{TAG}-pay",
            "amount_cents": int(round(amount * 100)), "status": status,
            "stripe_refund_id": f"re_{uuid.uuid4().hex[:6]}",
            "created_at": ts, "updated_at": ts}


def _reversal(amount, tax=None):
    row = {"id": f"rev-{uuid.uuid4().hex[:6]}", "amount": -abs(amount),
           "reversed_payment_id": f"{TAG}-pay", "source_kind": "stripe_refund"}
    if tax is not None:
        row["tax_amount"] = -abs(tax)
    return row


def _original(amount, tax=0.0):
    return {"id": f"orig-{uuid.uuid4().hex[:6]}", "payment_id": f"{TAG}-pay",
            "amount": amount, "tax_amount": tax, "source_kind": "shop_order"}


# ── A — already correct full refund → NO ACTION ─────────────────────────────
def test_a_already_correct():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), [_attempt(110.0)], [_reversal(110.0, 10.0)], [_original(110.0, 10.0)])
    assert r["classification"] == "NO_ACTION"
    assert r["missing_reversal_amount"] == 0.0


# ── B — full refund, no reversal → safe revenue + exact tax ─────────────────
def test_b_full_refund_missing():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), [_attempt(110.0)], [], [_original(110.0, 10.0)])
    assert r["classification"] == "SAFE_TO_REPAIR"
    assert r["missing_reversal_amount"] == 110.0
    assert r["safe_tax_reversal"] == 10.0
    assert r["tax_resolution"] == "full_coverage_exact_original_tax"
    assert r["proposed_repair"] and r["proposed_repair"][0].startswith("_finalize_stripe_refund:")


# ── C — partial refund, no reversal → revenue safe, tax unresolved ──────────
def test_c_partial_missing():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 20.0), [_attempt(20.0)], [], [_original(110.0, 10.0)])
    assert r["classification"] == "SAFE_TO_REPAIR"
    assert r["missing_reversal_amount"] == 20.0
    assert r["safe_tax_reversal"] == 0.0
    assert r["tax_resolution"] == "unresolved_partial_allocation"


# ── D — partly represented: only the difference is a candidate ──────────────
def test_d_partly_represented():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 80.0), [_attempt(30.0), _attempt(50.0)], [_reversal(30.0)], [_original(110.0)])
    assert r["classification"] == "SAFE_TO_REPAIR"
    assert r["missing_reversal_amount"] == 50.0


# ── E — multiple refunds, one missing: only that event flagged ──────────────
def test_e_one_of_many_missing():
    a1 = _attempt(30.0, ts="2026-07-01T10:00:00+00:00", aid="att-1")
    a2 = _attempt(20.0, ts="2026-07-02T10:00:00+00:00", aid="att-2")
    r = classify_stripe_refunded_payment(
        _payment(110.0, 50.0), [a1, a2], [_reversal(30.0)], [_original(110.0)])
    assert r["classification"] == "SAFE_TO_REPAIR"
    assert r["missing_reversal_amount"] == 20.0
    assert r["missing_attempt_ids"] == ["att-2"]


# ── F — reversal exceeds proof → possible duplicate, manual only ────────────
def test_f_possible_duplicate():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 30.0), [_attempt(30.0)], [_reversal(30.0), _reversal(30.0)], [_original(110.0)])
    assert r["classification"] == "POSSIBLE_DUPLICATE_REVERSAL"


# ── G — failed attempt is not a refund ──────────────────────────────────────
def test_g_failed_attempt_no_repair():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), [_attempt(110.0, status="failed")], [], [_original(110.0)])
    assert r["classification"] == "AMBIGUOUS_UNPROVEN_REFUND"
    assert r["proven_refunded_amount"] == 0.0


# ── H — original revenue row missing → never single-sided repair ────────────
def test_h_missing_original_revenue_row():
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), [_attempt(110.0)], [], [])
    assert r["classification"] == "AMBIGUOUS_NO_ORIGINAL_REVENUE_ROW"


# ── I — missing refund timestamp → no automatic repair ──────────────────────
def test_i_missing_timestamp():
    a = _attempt(110.0)
    a["created_at"] = None
    a["updated_at"] = None
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), [a], [], [_original(110.0)])
    assert r["classification"] == "AMBIGUOUS_NO_REFUND_TIMESTAMP"


# ── J — cumulative partials to full: total revenue + exact tax once ─────────
def test_j_cumulative_full():
    atts = [_attempt(30.0, aid="j1"), _attempt(20.0, aid="j2"), _attempt(60.0, aid="j3")]
    r = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), atts, [], [_original(110.0, 10.0)])
    assert r["classification"] == "SAFE_TO_REPAIR"
    assert r["missing_reversal_amount"] == 110.0
    assert r["safe_tax_reversal"] == 10.0
    assert sorted(r["missing_attempt_ids"]) == ["j1", "j2", "j3"]
    # unproven-excess variant stays ambiguous
    r2 = classify_stripe_refunded_payment(
        _payment(110.0, 110.0), atts[:2], [], [_original(110.0, 10.0)])
    assert r2["classification"] == "AMBIGUOUS_UNPROVEN_REFUND"


# ── K — dry run is repeatable and writes NOTHING ────────────────────────────
def test_k_dry_run_repeatable_zero_writes():
    pay_id = f"{TAG}-k-{uuid.uuid4().hex[:6]}"
    run(server.db.payments.insert_one({
        "id": pay_id, "amount": 110.0, "refunded_amount": 110.0, "processor": "stripe",
        "processor_payment_id": f"pi_{pay_id}", "source": {"kind": "shop_order_payment"}}))
    run(server.db.stripe_refund_attempts.insert_one({
        "id": f"{pay_id}-att", "payment_id": pay_id, "amount_cents": 11000,
        "status": "succeeded", "stripe_refund_id": f"re_{pay_id}",
        "idempotency_key": f"{pay_id}-idem",
        "created_at": "2026-07-01T12:00:00+00:00", "updated_at": "2026-07-01T12:00:00+00:00"}))
    try:
        async def counts():
            return (await server.db.payments.count_documents({}),
                    await server.db.retail_sales.count_documents({}),
                    await server.db.stripe_refund_attempts.count_documents({}))
        before = run(counts())
        first = run(run_dry_run_audit(server.db))
        second = run(run_dry_run_audit(server.db))
        after = run(counts())
        assert before == after                      # zero writes
        assert first == second                      # deterministic
        mine = next(r for r in first["results"] if r["payment_id"] == pay_id)
        assert mine["classification"] == "AMBIGUOUS_NO_ORIGINAL_REVENUE_ROW"
    finally:
        run(server.db.payments.delete_many({"id": pay_id}))
        run(server.db.stripe_refund_attempts.delete_many({"payment_id": pay_id}))
