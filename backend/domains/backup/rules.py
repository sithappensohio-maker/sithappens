"""Per-collection rules for the in-app backup.

Most collections round-trip by `id` (or by a string `_id`, see
STRING_ID_COLLECTIONS in server.py). The few below need more, and each rule
is pinned by backend/test_backup_coverage_guard.py.
"""
from typing import Any, Dict, Tuple

from domains.operations import audit_redact

# Fields left out of the backup file. Shop photo derivatives (thumb / card /
# pdp / zoom) are raw bytes that JSON cannot carry: the download crashed on
# them and the auto-backup wrote them as "b'\\xff..'" text, which a restore
# then served as broken pictures. The original upload (`data`) is kept, and
# shop/media.ensure_derivatives rebuilds the sizes the first time a photo is
# viewed.
OMIT_FIELDS: Dict[str, Tuple[str, ...]] = {
    "shop_media": ("derivatives", "derivatives_built_at"),
}

# Rows stored without an `id`. A merge matches them on their natural key (the
# one the code itself writes them by). The old fallback inserted a second
# copy: a unique index refused it (favourites), or — found by a full-size
# restore drill — every merge doubled the drawer sessions, email templates,
# sign-in links and notification log.
MERGE_KEYS: Dict[str, Tuple[str, ...]] = {
    "shop_favorites": ("client_id", "kind", "ref_id"),
    "cash_drawer_sessions": ("date",),
    "claim_tokens": ("token",),
    "email_templates": ("slug",),
    "notification_log": ("key",),
    "settings": ("key",),            # the key/value rows; the main row has an id
    "task_dismissals": ("item_id",),
    "vaccine_dismissals": ("dog_id",),
}


def merge_filter(collection: str, doc: dict, is_string_id: bool):
    """How a merge finds the live copy of `doc`, or None when it can't."""
    if is_string_id:
        return None
    if doc.get("id"):
        return {"id": doc["id"]}
    natural = MERGE_KEYS.get(collection)
    if natural and all(doc.get(f) is not None for f in natural):
        return {f: doc[f] for f in natural}
    return None


# Sequences a merge may only raise. Records made after the backup stay in the
# database during a merge, so putting the counter back would hand their
# confirmation / contestant / photo-order numbers out a second time.
# A booking lives in one place: an open visit in bookings, a finished one in bookings_archive (audit #8).
MERGE_TWIN: Dict[str, str] = {"bookings": "bookings_archive", "bookings_archive": "bookings"}

MERGE_MAX_FIELDS: Dict[str, str] = {
    "event_counters": "seq",
}

# A backed-up row whose natural key a different live row already holds. On a
# fresh server, startup seeds Trunk or Treat under a new id, so the backup's
# real event collided on its slug. The backup's row takes the live one over,
# but only while nothing points at the live one yet (its registrations or
# photo orders would be orphaned); otherwise the live row is kept and
# reported.
MERGE_TAKEOVER: Dict[str, Tuple[str, Tuple[Tuple[str, str], ...]]] = {
    "events": ("slug", (("event_registrations", "event_id"), ("event_photo_orders", "event_id"))),
}

# Money and the state that goes with it (audit #8). A merge restore writes a backed-up row over the live
# one, so an older backup used to roll back a balance, a spent credit, a checkout, a void or a refund.
# For a row that already exists live, the fields below keep their live value: the backup's copy is written
# only when the row is missing. Every other field is still overwritten, so content (notes, names, phones)
# reverts as before. A row that is missing live is restored whole, as before.
#
# Lists name the fields the app itself writes after the backup was taken. A replace restore is the only
# way to put money back wholesale, and it is unchanged.
BOOKING_MONEY: Tuple[str, ...] = (
    "status", "checked_in_at", "checked_in_by", "checked_out_at", "checked_out_by", "checked_out_by_name",
    "checked_out_lat", "checked_out_lng", "cancelled_at", "financial_locked", "financial_locked_by",
    "financial_locked_at", "financial_revision", "financial_reopened_at", "financial_reopened_reason",
    "payment_status", "payment_method", "paid_at", "amount_paid", "balance_due", "actual_price",
    "credit_value", "credit_service_type", "credits_deducted", "credit_lot_ids", "credit_lot_redemptions",
    "cash_revenue", "gift_card_funded", "tax_amount", "tax_rate_pct", "taxable_cash_amount",
    "checkout_discount", "multi_dog_discount", "cancellation_fee", "cancellation_charged",
    "additional_cash_charge", "group_bill_claim", "group_bill_pending", "group_bill_claimed_at",
)

MERGE_KEEP_LIVE: Dict[str, Tuple[str, ...]] = {
    "clients": ("credits", "training_credits", "boarding_credits", "account_balance", "low_credit_emailed_at"),
    "credit_lots": ("qty_remaining", "refund_status", "voided_at", "void_reason", "voided_by", "last_redeemed_at"),
    "gift_cards": ("balance", "status", "money_keys", "last_used_at", "voided_at", "voided_by",
                   "topup_attempts_applied", "recipient_email", "email_delivered_to", "email_delivered_at",
                   "email_sending_at", "email_queued_at", "code_emailed_at"),
    "gift_card_topup_attempts": ("status",),
    "invoices": ("total", "subtotal", "amount_paid", "balance", "status"),
    "payments": ("status", "voided_at", "refunded_amount", "refund_attempts_applied", "stripe_dispute_id",
                 "stripe_dispute_key", "stripe_dispute_status", "stripe_dispute_event",
                 "stripe_dispute_payment", "stripe_dispute_loss", "stripe_dispute_notes"),
    "pos_sales": ("status", "voided_at", "void_reason", "line_items"),
    "retail_sales": ("amount", "status", "voided_at", "void_reason"),
    "bookings": BOOKING_MONEY,
    "bookings_archive": BOOKING_MONEY,
    "payment_plans": ("installments", "status", "paid_total", "remaining_total"),
    "shop_orders": ("status", "paid_at", "paid_after_cancel", "shop_last_applied_attempt_id",
                    "stripe_active_attempt_id", "refund_reconciliation_required", "lines"),
    "shop_payment_attempts": ("status", "stripe_payment_intent_id"),
    "stripe_refund_attempts": ("status", "stripe_refund_id"),
    "stripe_disputes": ("status",),
    "time_clock_entries": ("clock_in_at", "clock_out_at", "hours", "break_minutes"),
    "daily_closeouts": ("status",),
    "estimated_tax_payments": ("voided", "void_reason", "voided_by", "voided_at"),
    "sales_tax_filings": ("status", "filed_at", "payments"),
    "cash_drawer_sessions": ("status", "closed_at", "closed_by"),
}

# Append-only money records and one-per-thing guards. A row that exists live is never rewritten; a row
# that is missing is restored whole. (Claim rows are the replay guard for an idempotent money action: a
# stale "processing" copy would replay it.)
MERGE_INSERT_ONLY = frozenset({
    "payment_ledger", "credit_adjustments", "gift_card_transactions", "booking_financial_events",
    "till_adjustments", "pos_drawer_audit", "inventory_movements", "tax_payments",
    "stripe_payouts", "stripe_balance_transactions", "stripe_webhook_events", "stripe_unlinked_refunds",
    "pos_sale_claims", "pos_sale_void_claims", "pos_sale_return_claims", "payment_topup_claims",
    "payment_void_claims", "refund_idempotency_claims", "shop_checkout_claims", "auto_receipt_email_claims",
    "financial_adjustment_claims", "tab_adjustment_claims",
})


def merge_update(collection: str, doc: dict) -> dict:
    """The write a merge makes for one backed-up row (audit #8).

    An insert-only collection is written only when the row is missing. A collection with protected
    fields writes its other fields as before, and its protected fields only when the row is inserted. Any
    other row is overwritten whole, as before."""
    if collection in MERGE_INSERT_ONLY:
        return {"$setOnInsert": dict(doc)}
    keep = MERGE_KEEP_LIVE.get(collection)
    if not keep:
        return {"$set": dict(doc)}
    kept = {k: v for k, v in doc.items() if k in keep}
    rest = {k: v for k, v in doc.items() if k not in keep}
    update: Dict[str, Dict[str, Any]] = {}
    if rest:
        update["$set"] = rest
    if kept:
        update["$setOnInsert"] = kept
    return update or {"$set": dict(doc)}


def protected_fields(collection: str) -> Tuple[str, ...]:
    """The fields a merge keeps live for this collection (for the restore summary)."""
    if collection in MERGE_INSERT_ONLY:
        return ("*",)
    return MERGE_KEEP_LIVE.get(collection, ())



def strip_omitted(collection: str, doc: dict) -> dict:
    """The document without the fields this collection never carries."""
    omit = OMIT_FIELDS.get(collection)
    if not omit:
        return doc
    return {k: v for k, v in doc.items() if k not in omit}


def restore_row(collection: str, doc: dict) -> dict:
    """What a restore writes: strip_omitted, and an Audit Log entry never
    comes back holding a PIN, a sign-in code or a reset link (audit #7) —
    an older backup predates the scrub."""
    doc = strip_omitted(collection, doc)
    if collection == "audit_log":
        doc = audit_redact.clean_row(doc)
    return doc
