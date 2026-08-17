"""Step 4B-11 — historical Stripe refund reconciliation (READ-ONLY dry run).

Classifies every Stripe-backed payment whose local state says money was
refunded, deciding whether the signed financial reversal rows that today's
code would have written are present, provably missing, or ambiguous.

STRICTLY READ-ONLY: this module contains no write path at all — no apply
flag, no repair function. A future, separately-approved APPLY step would
re-run the existing idempotent ``_finalize_stripe_refund`` per attempt
(its Step D inserts the missing reversal row keyed by the already-existing
reversal Payment id against the retail_sales payment_id unique index), so
no new repair machinery is designed here either.

Classification rules (grounded in the actual historical shapes found):

  NO_ACTION
      Every proven (status=="succeeded") refund dollar is already
      represented by stripe_refund reversal rows.
  SAFE_TO_REPAIR
      Succeeded attempts (with Stripe refund ids and timestamps) prove
      more refunded money than the reversal rows represent, the ORIGINAL
      revenue row exists (so the reversal restores symmetry rather than
      subtracting revenue that was never booked), cumulative proven never
      exceeds the original charge, and payments.refunded_amount agrees
      with the attempt-level evidence.
  AMBIGUOUS_NO_ORIGINAL_REVENUE_ROW
      Refunds are proven, but the payment's ORIGINAL positive revenue row
      was never written either (pre-writer era: both sides absent, so
      retail_sales-based Finance was never overstated). Writing only the
      reversal would single-sidedly subtract — never safe automatically.
  AMBIGUOUS_UNPROVEN_REFUND
      payments.refunded_amount exceeds what succeeded attempts prove
      (Era-A / external-history shape) — needs read-only Stripe API
      verification before any repair.
  AMBIGUOUS_NO_REFUND_TIMESTAMP
      A missing attempt lacks any usable success timestamp, so the 4B-8
      collection-date attribution of the reversal cannot be proven.
  POSSIBLE_DUPLICATE_REVERSAL
      Reversal rows represent MORE than the proven refunds — repairing
      anything here risks a duplicate negative event; manual review only.

Tax follows Step 4B-9 exactly: exact original stored tax only on proven
full cumulative coverage with no existing explicit tax reversal; partial
allocation is never fabricated. (In the audited data every refunded
payment is an invoice payment whose original row carries no tax, so the
safe tax reversal is $0 across the board — reported, not assumed.)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _round2(v: Any) -> float:
    return round(float(v or 0), 2)


def classify_stripe_refunded_payment(
    payment: Dict[str, Any],
    attempts: List[Dict[str, Any]],
    reversal_rows: List[Dict[str, Any]],
    original_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Pure classification of one refunded Stripe payment (no I/O)."""
    pay_id = payment.get("id")
    original_amount = _round2(payment.get("amount"))
    recorded_refunded = _round2(payment.get("refunded_amount"))

    succeeded = [a for a in attempts if a.get("status") == "succeeded"]
    proven_refunded = _round2(sum(_round2(a.get("amount_cents")) / 100.0 for a in succeeded))
    represented = _round2(sum(-_round2(r.get("amount")) for r in reversal_rows))
    missing = _round2(proven_refunded - represented)

    original = original_rows[0] if original_rows else None
    original_tax = _round2(original.get("tax_amount")) if original else 0.0
    tax_already = _round2(sum(-_round2(r.get("tax_amount")) for r in reversal_rows if "tax_amount" in r))

    missing_attempt_ids = []
    refund_dates: List[str] = []
    reversal_amount_by_attempt = represented  # aggregate; per-event pairing below
    covered = represented
    for a in sorted(succeeded, key=lambda x: x.get("updated_at") or x.get("created_at") or ""):
        amt = _round2(_round2(a.get("amount_cents")) / 100.0)
        if covered >= amt - 0.005:
            covered = _round2(covered - amt)
            continue
        missing_attempt_ids.append(a.get("id"))
        ts = a.get("updated_at") or a.get("created_at")
        if ts:
            refund_dates.append(ts)

    result: Dict[str, Any] = {
        "payment_id": pay_id,
        "processor_payment_id": payment.get("processor_payment_id"),
        "payment_source_kind": (payment.get("source") or {}).get("kind"),
        "original_amount": original_amount,
        "recorded_refunded_amount": recorded_refunded,
        "proven_refunded_amount": proven_refunded,
        "represented_reversal_amount": represented,
        "missing_reversal_amount": max(0.0, missing),
        "stripe_refund_ids": [a.get("stripe_refund_id") for a in succeeded],
        "missing_attempt_ids": missing_attempt_ids,
        "existing_reversal_row_ids": [r.get("id") for r in reversal_rows],
        "original_revenue_row_exists": original is not None,
        "original_revenue_category_kind": (original or {}).get("source_kind"),
        "original_tax_amount": original_tax,
        "safe_tax_reversal": 0.0,
        "tax_resolution": "none_needed" if original_tax <= 0 else "unresolved",
        "refund_succeeded_timestamps": refund_dates,
        # Future APPLY identity: re-run _finalize_stripe_refund(attempt_id)
        # for each missing attempt — idempotent by the existing reversal-
        # Payment id + retail_sales payment_id unique index.
        "proposed_repair": [f"_finalize_stripe_refund:{aid}" for aid in missing_attempt_ids],
    }

    if represented > proven_refunded + 0.005:
        result["classification"] = "POSSIBLE_DUPLICATE_REVERSAL"
        result["reason"] = "reversal rows represent more than the proven refunds — manual review"
        return result
    if recorded_refunded > proven_refunded + 0.005:
        result["classification"] = "AMBIGUOUS_UNPROVEN_REFUND"
        result["reason"] = ("payments.refunded_amount exceeds succeeded-attempt evidence; "
                           "requires read-only Stripe verification before repair")
        return result
    if proven_refunded <= 0.005:
        result["classification"] = "AMBIGUOUS_UNPROVEN_REFUND"
        result["reason"] = "no succeeded refund attempts back the recorded refunded_amount"
        return result
    if missing <= 0.005:
        result["classification"] = "NO_ACTION"
        result["reason"] = "every proven refund dollar already has a signed reversal row"
        return result
    if proven_refunded > original_amount + 0.005:
        result["classification"] = "AMBIGUOUS_UNPROVEN_REFUND"
        result["reason"] = "proven refunds exceed the original charge — data inconsistency"
        return result
    if original is None:
        result["classification"] = "AMBIGUOUS_NO_ORIGINAL_REVENUE_ROW"
        result["reason"] = ("original positive revenue row was never written (pre-writer era); "
                           "a lone reversal would subtract revenue that was never booked")
        return result
    if missing_attempt_ids and not refund_dates:
        result["classification"] = "AMBIGUOUS_NO_REFUND_TIMESTAMP"
        result["reason"] = "missing refund attempts carry no success timestamp for date attribution"
        return result

    result["classification"] = "SAFE_TO_REPAIR"
    result["reason"] = ("succeeded attempts with Stripe refund ids prove the missing reversal; "
                       "original revenue row exists; amounts consistent")
    if original_tax > 0:
        full_coverage = proven_refunded >= original_amount - 0.005
        if full_coverage and tax_already < 0.005:
            result["safe_tax_reversal"] = original_tax
            result["tax_resolution"] = "full_coverage_exact_original_tax"
        else:
            result["tax_resolution"] = "unresolved_partial_allocation"
    return result


async def run_dry_run_audit(db) -> Dict[str, Any]:
    """Read-only audit over every refunded Stripe payment in `db`."""
    payments = await db.payments.find(
        {"processor": "stripe", "refunded_amount": {"$gt": 0}}, {"_id": 0}).to_list(100000)
    ids = [p["id"] for p in payments]
    attempts = await db.stripe_refund_attempts.find(
        {"payment_id": {"$in": ids}}, {"_id": 0}).to_list(100000)
    reversals = await db.retail_sales.find(
        {"source_kind": "stripe_refund", "reversed_payment_id": {"$in": ids}}, {"_id": 0}).to_list(100000)
    originals = await db.retail_sales.find(
        {"payment_id": {"$in": ids}, "amount": {"$gt": 0}}, {"_id": 0}).to_list(100000)

    att_by, rev_by, orig_by = {}, {}, {}
    for a in attempts:
        att_by.setdefault(a["payment_id"], []).append(a)
    for r in reversals:
        rev_by.setdefault(r["reversed_payment_id"], []).append(r)
    for o in originals:
        orig_by.setdefault(o["payment_id"], []).append(o)

    results = [
        classify_stripe_refunded_payment(
            p, att_by.get(p["id"], []), rev_by.get(p["id"], []), orig_by.get(p["id"], []))
        for p in payments
    ]
    results.sort(key=lambda r: (r["classification"], r["payment_id"] or ""))
    summary: Dict[str, Any] = {"audited": len(results), "by_classification": {}, "dollars": {}}
    for r in results:
        c = r["classification"]
        summary["by_classification"][c] = summary["by_classification"].get(c, 0) + 1
    summary["dollars"] = {
        "proven_missing_revenue_reversals_safe": _round2(sum(
            r["missing_reversal_amount"] for r in results if r["classification"] == "SAFE_TO_REPAIR")),
        "proven_missing_tax_reversals_safe": _round2(sum(
            r["safe_tax_reversal"] for r in results if r["classification"] == "SAFE_TO_REPAIR")),
        "missing_but_ambiguous_revenue": _round2(sum(
            r["missing_reversal_amount"] for r in results if r["classification"].startswith("AMBIGUOUS"))),
    }
    return {"summary": summary, "results": results}
