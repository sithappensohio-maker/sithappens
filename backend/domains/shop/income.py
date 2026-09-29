"""Online Shop income, recorded by kind the way the Register does (audit #29).

A Shop order used to put ALL its money on one `shop_order` income row, and
Finance files `shop_order` under Retail — so a daycare pack or a training
program bought online showed up as merchandise next to dog food. The Register
has always written one row per pack unit (`credit_pack_sale`) and per program
unit (`training_program_sale`), and every Finance report already files those
correctly. The Shop now does the same:

  * one `credit_pack_sale` / `training_program_sale` row per unit bought
    (Online School courses are training programs), each carrying
    `shop_income_ref` = the unit's credit-lot `fulfillment_ref`;
  * one `shop_order` row for everything else — products and gift cards
    (gift cards stay Retail, as at the desk) — carrying ALL the order's tax,
    since packs and programs are never taxed.

Totals never change: the rows add up to the payment to the cent, one date,
one tender (`stripe_online`), and exactly ONE row carries `payment_id` (its
unique index is how a replayed webhook finds the order's income and how a
refund finds what it reverses). An order with no products or gift cards has
no `shop_order` row at all — its first unit row carries `payment_id` — so no
empty $0 Retail line appears.

Orders recorded before this change are split by `repair_split`, decided from
the rows themselves (never a "done" flag), so a backup restore that brings
the old single row back is put right again.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pymongo.errors import DuplicateKeyError

_logger = logging.getLogger(__name__)

REPAIR_JOB = "shop_income_split"   # scheduler job + its once-a-day marker; a restore clears it
ENTITLEMENT_KINDS = ("credit_pack", "training_program")
SETTLE_MINUTES = 10                # leave orders being paid right now to their own webhook
INCOME_REF_INDEX = ("shop_income_ref", {"unique": True, "partialFilterExpression": {"shop_income_ref": {"$type": "string"}}})


def _money(value) -> float:
    return round(float(value or 0), 2)


def unit_ref(order_id: str, item_id: str, n: int) -> str:
    """The income row of one pack/program unit — the same string as that
    unit's credit-lot `fulfillment_ref`, so each row ties to its lot."""
    return f"shop_order:{order_id}:item:{item_id}:unit:{n}"


def _unit_rows(order: dict, base: dict) -> List[dict]:
    tag = f"Online Shop order #{order['id'][:8].upper()}"
    rows = []
    for line in order.get("lines") or []:
        if line.get("kind") not in ENTITLEMENT_KINDS:
            continue
        qty = int(line.get("quantity") or 0)
        total, unit, taken = _money(line.get("line_total")), _money(line.get("unit_price")), 0.0
        for n in range(qty):
            amount = unit if n < qty - 1 else _money(total - taken)   # the last unit takes any penny
            taken = _money(taken + amount)
            row = {**base, "amount": amount, "pre_tax_amount": amount, "tax_amount": 0.0, "tax_rate_pct": 0.0,
                   "shop_income_ref": unit_ref(order["id"], line["item_id"], n)}
            if line["kind"] == "credit_pack":
                row.update(source_kind="credit_pack_sale", pack_id=line.get("ref_id"), pack_name=line.get("name"),
                           description=f"Credit Pack · {line.get('name')}", note=tag)
            else:
                row.update(source_kind="training_program_sale", program_id=line.get("ref_id"),
                           description=f"Training Program · {line.get('name')}", category="Training Program", notes=tag)
            rows.append(row)
    return rows


def plan_rows(order: dict, payment: dict, *, date: str, created_at: Optional[str]) -> List[dict]:
    """Every income row this paid order should have, the one carrying
    `payment_id` first. Falls back to today's single `shop_order` row when
    the order's own numbers don't add up (never splits a guess)."""
    base = {"date": date, "payment_method": "stripe_online", "client_id": order.get("client_id"),
            "client_name": order.get("client_name"), "shop_order_id": order["id"], "created_at": created_at,
            "created_by": "stripe_webhook", "logged_by": "Stripe"}
    amount, tax = _money(payment.get("amount")), _money(order.get("tax_amount"))
    whole = {**base, "amount": amount, "source_kind": "shop_order",
             "description": f"Online Shop order #{order['id'][:8].upper()}",
             "tax_amount": tax, "tax_rate_pct": float(order.get("tax_rate_pct") or 0),
             "pre_tax_amount": _money(order.get("subtotal"))}
    units = _unit_rows(order, base)
    lines_total = _money(sum(_money(l.get("line_total")) for l in order.get("lines") or []))
    if not units or abs(lines_total - amount) >= 0.005:
        rows = [whole]
    else:
        split = _money(sum(u["amount"] for u in units))
        has_goods = any(l.get("kind") not in ENTITLEMENT_KINDS for l in order.get("lines") or [])
        if has_goods:
            rest = {**whole, "amount": _money(amount - split),
                    "pre_tax_amount": _money(_money(order.get("subtotal")) - split)}
            rows = [rest, *units] if rest["amount"] >= tax - 0.005 else [whole]
        else:
            rows = units if tax < 0.005 else [whole]
    rows = [dict(r) for r in rows]
    rows[0]["payment_id"] = payment["id"]
    return rows


def _splits(rows: List[dict]) -> bool:
    """Whether the plan records anything by kind (one program alone is a
    single row, but not the old whole-order one)."""
    return len(rows) > 1 or rows[0].get("source_kind") != "shop_order"


def _is_whole(anchor: dict, payment: dict) -> bool:
    """The pre-#29 shape: one `shop_order` row holding the whole payment."""
    return anchor.get("source_kind") == "shop_order" and abs(_money(anchor.get("amount")) - _money(payment.get("amount"))) < 0.005


def _same(anchor: dict, planned: dict) -> bool:
    return (anchor.get("source_kind") == planned.get("source_kind")
            and abs(_money(anchor.get("amount")) - _money(planned.get("amount"))) < 0.005)


async def _insert(db, row: dict) -> None:
    try:
        await db.retail_sales.insert_one({"id": str(uuid.uuid4()), **row})
    except DuplicateKeyError:
        pass   # a replay or a concurrent apply wrote it first


async def _insert_missing_units(db, rows: List[dict]) -> int:
    added = 0
    for row in rows:
        ref = row.get("shop_income_ref")
        if ref and not await db.retail_sales.find_one({"shop_income_ref": ref}, {"_id": 1}):
            await _insert(db, row)
            added += 1
    return added


_ANCHOR_UNIT_FIELDS = ("source_kind", "description", "tax_amount", "tax_rate_pct", "shop_income_ref", "pack_id",
                       "pack_name", "note", "program_id", "category", "notes")


async def _split_whole(db, anchor: dict, rows: List[dict]) -> bool:
    """Turn the old whole-order row into the split rows: every unit row first
    (dated like the original), then the original row itself trimmed — its id,
    date, payment_id and created_at kept. Guarded on the old amount, so a
    concurrent split or a hand edit is never overwritten."""
    planned = rows[0]
    await _insert_missing_units(db, rows[1:])
    fields: Dict[str, Any] = {"amount": planned["amount"], "pre_tax_amount": planned["pre_tax_amount"]}
    if planned["source_kind"] != "shop_order":   # no products or gift cards: it becomes the first unit's row
        fields.update({k: planned[k] for k in _ANCHOR_UNIT_FIELDS if k in planned})
    try:
        res = await db.retail_sales.update_one(
            {"id": anchor["id"], "source_kind": "shop_order", "amount": anchor.get("amount")}, {"$set": fields})
    except DuplicateKeyError:
        _logger.warning("Shop income: order %s already has a row for %s; left as is", anchor.get("shop_order_id"), planned.get("shop_income_ref"))
        return False
    return res.modified_count == 1


async def record(db, order: dict, payment: dict) -> None:
    """Write (or complete) this paid order's income rows. Safe to run any
    number of times, concurrently, and on an order recorded before #29."""
    anchor = await db.retail_sales.find_one({"payment_id": payment["id"]}, {"_id": 0})
    date = (anchor or {}).get("date") or payment.get("date")
    created_at = (anchor or {}).get("created_at") or payment.get("created_at")
    rows = plan_rows(order, payment, date=date, created_at=created_at)
    if anchor is None:
        await _insert(db, rows[0])                     # the payment's row first: a refund can always find it
        await _insert_missing_units(db, rows[1:])
    elif _splits(rows) and _is_whole(anchor, payment):
        reason = await _why_not_split(db, anchor, order, payment, rows)
        if reason:                                     # paid before #29, retried after it
            _logger.info("Shop income: order %s left whole on retry (%s)", order.get("id"), reason)
        else:
            await _split_whole(db, anchor, rows)
    elif _same(anchor, rows[0]):
        await _insert_missing_units(db, rows[1:])      # a retry after a crash part-way
    else:
        _logger.warning("Shop income: order %s's income row was changed by hand; left as is", order.get("id"))


async def _why_not_split(db, anchor: dict, order: dict, payment: dict, rows: List[dict]) -> Optional[str]:
    """Why an old whole row must stay whole, if it must. Once any of its
    unit rows exist (a restore put the whole row back beside them) it has to
    be trimmed whatever else is true, or the pack money counts twice."""
    for row in rows[1:]:
        if await db.retail_sales.find_one({"shop_income_ref": row["shop_income_ref"]}, {"_id": 1}):
            return None
    if abs(_money(anchor.get("tax_amount")) - _money(order.get("tax_amount"))) >= 0.005 or anchor.get("gift_card_funded"):
        return "row_differs"
    if await db.retail_sales.find_one({"source_kind": "stripe_refund", "reversed_payment_id": payment["id"],
                                       "tax_amount": {"$exists": False}}, {"_id": 1}):
        return "old_refund_row"   # its tax is rebuilt at read time from this row's amount, which a split would change
    return None


async def repair_split(db) -> Dict[str, Any]:
    """Split the income of Shop orders recorded before #29 (and any that a
    restore brought back whole). Only a row in exactly the shape the old code
    wrote is touched; anything else is counted under a reason and left alone
    — including a missing unit row, which is staff's deletion to keep (a
    Retry of that order is how it is written again)."""
    out: Dict[str, Any] = {"split": 0, "skipped": {}}

    def skip(reason: str) -> None:
        out["skipped"][reason] = out["skipped"].get(reason, 0) + 1

    settled = (datetime.now(timezone.utc) - timedelta(minutes=SETTLE_MINUTES)).isoformat()
    async for order in db.shop_orders.find(   # every one — never a capped read
            {"lines.kind": {"$in": list(ENTITLEMENT_KINDS)}, "shop_last_applied_attempt_id": {"$type": "string"}},
            {"_id": 0}):
        payment = await db.payments.find_one({"idempotency_ref": f"shop_attempt:{order['shop_last_applied_attempt_id']}"}, {"_id": 0})
        if not payment:
            skip("no_payment")
            continue
        if (payment.get("created_at") or "") >= settled:
            skip("just_paid")
            continue
        anchor = await db.retail_sales.find_one({"payment_id": payment["id"]}, {"_id": 0})
        if not anchor:
            skip("no_income_row")
            continue
        rows = plan_rows(order, payment, date=anchor.get("date"), created_at=anchor.get("created_at"))
        if not _splits(rows):
            skip("totals_disagree")
            continue
        if _is_whole(anchor, payment):
            reason = await _why_not_split(db, anchor, order, payment, rows)
            if reason:
                skip(reason)
                continue
            out["split"] += int(await _split_whole(db, anchor, rows))
        elif _same(anchor, rows[0]):
            for row in rows[1:]:
                if not await db.retail_sales.find_one({"shop_income_ref": row["shop_income_ref"]}, {"_id": 1}):
                    skip("unit_row_missing")
                    break
        else:
            skip("changed_by_hand")
    if out["split"]:
        _logger.info("Shop income: split %d orders by kind", out["split"])
    return out
