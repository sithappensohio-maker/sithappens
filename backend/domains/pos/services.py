"""POS pricing/catalog services extracted from server.py in Phase 5.

The checkout commit remains the proven transaction implementation, while the
shared catalog and cart-pricing kernels now live behind this explicit domain
boundary so register preview and checkout cannot drift apart.
"""
from __future__ import annotations

import uuid
from datetime import date as _date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

import sales_tax_policy

_db = None
_resolve_client_price_fn = None
_get_settings_fn = None
_credit_pack_display_fields_fn = None
_free_claim_program_blockers_fn = None
_logger = None
_create_sale_impl_fn = None
_sale_model = None
_tender_model = None
_normalize_payment_method_fn = None
_perms_for_fn = None
_mutate_product_stock_fn = None
_require_register_day_open_fn = None


def configure(*, db, resolve_client_price, get_settings, credit_pack_display_fields, free_claim_program_blockers, logger, create_sale_impl, sale_model=None, tender_model=None, normalize_payment_method=None, perms_for=None, mutate_product_stock=None, require_register_day_open=None) -> None:
    global _db, _resolve_client_price_fn, _get_settings_fn, _credit_pack_display_fields_fn
    global _free_claim_program_blockers_fn, _logger, _create_sale_impl_fn
    global _sale_model, _tender_model, _normalize_payment_method_fn, _perms_for_fn
    global _mutate_product_stock_fn, _require_register_day_open_fn
    _mutate_product_stock_fn = mutate_product_stock
    _require_register_day_open_fn = require_register_day_open
    _sale_model = sale_model
    _tender_model = tender_model
    _normalize_payment_method_fn = normalize_payment_method
    _perms_for_fn = perms_for
    _db = db
    _resolve_client_price_fn = resolve_client_price
    _get_settings_fn = get_settings
    _credit_pack_display_fields_fn = credit_pack_display_fields
    _free_claim_program_blockers_fn = free_claim_program_blockers
    _logger = logger
    _create_sale_impl_fn = create_sale_impl


async def create_sale(body, user):
    """Stable POS-domain seam around the proven atomic sale transaction body."""
    return await _create_sale_impl_fn(body, user)


# Tenders the till understands. A stay can be settled by "transfer" or by
# prepaid credits; merchandise cannot be, so those two are handled explicitly
# below rather than being allowed to fail validation deep inside the sale.
_TILL_TENDERS = ("cash", "card", "check", "venmo", "paypal", "other")


async def ring_pickup_merchandise(booking: dict, body, user: dict) -> Optional[dict]:
    """Sell merchandise at a dog's pickup as an ordinary Register sale.

    Deliberately NOT a booking add-on. Add-ons are services priced onto the
    stay; a bag of food is retail, and retail already has a home that handles
    stock, sales tax, retail revenue, the receipt and idempotency. Rebuilding
    any of that on the booking would be a second till with its own bugs, so
    this calls the one that already works.
    """
    lines = list(getattr(body, "retail_lines", None) or [])
    if not lines:
        return None
    if not getattr(body, "payment_method", None):
        raise HTTPException(status_code=400, detail="Choose how the products are being paid for.")
    if not getattr(body, "retail_idempotency_key", None):
        raise HTTPException(status_code=400,
                            detail="This sale is missing its idempotency key. Reopen the checkout and try again.")

    method = _normalize_payment_method_fn(body.payment_method, store=True)
    if method == "credits":
        # Credits are prepaid VISITS. They buy daycare, not dog food.
        raise HTTPException(status_code=400,
                            detail="Credits can't pay for products. Choose cash, card or another method for the merchandise.")
    if method not in _TILL_TENDERS:
        method = "other"   # a bank transfer is a real tender the till calls "other"

    priced, _ = await price_pos_cart(
        lines, None, can_price=bool(_perms_for_fn(user).get("pricing")), client_id=booking.get("client_id"))
    total = round(float(priced["total"]), 2)
    if total <= 0:
        return None

    sale = await create_sale(
        _sale_model(
            lines=lines, client_id=booking.get("client_id"),
            # Cash is tendered at exactly the merchandise total: this record
            # owes no change of its own, because the desk settles the whole
            # pickup — stay and goods — in one go at the counter.
            tenders=[_tender_model(method=method, amount=total,
                                   **({"tendered_amount": total} if method == "cash" else {}))],
            workstation_id=getattr(body, "workstation_id", None),
            idempotency_key=body.retail_idempotency_key,
        ),
        user,
    )
    return {
        # The two return shapes differ: a fresh sale answers with `sale`, an
        # idempotent replay answers with `pos_sale_id`. Read both.
        "pos_sale_id": sale.get("pos_sale_id") or (sale.get("sale") or {}).get("id"),
        "subtotal": round(float(priced.get("subtotal") or 0), 2),
        "tax_amount": round(float(priced.get("tax_amount") or 0), 2),
        "total": total,
        "item_count": len(priced.get("line_items") or []),
    }


# ─────────────────────────────────────────────────────────── returns
#
# A VOID cancels a whole sale on the day it happened. A RETURN is the other
# thing a shop needs: someone brings one item back on Thursday for something
# they bought on Monday, and wants that item's money — not the whole sale's.
#
# Returns are merchandise only. Credit packs and training programs grant
# entitlements that may already be partly spent, and unpicking that is what
# the void path's clawback is for; letting a return touch them would be a
# second, worse version of it.

RETURN_WINDOW_DAYS = 30
RETURNABLE_KINDS = ("retail", "custom")


class PosSaleReturnLineIn(BaseModel):
    """One line of the original sale, and how much of it is coming back."""

    line_index: int = Field(ge=0)
    qty: float = Field(gt=0, le=999)
    # Whether this one goes back on the shelf. An unopened bag of food does;
    # a chewed toy does not, and pretending otherwise is how stock drifts.
    restock: bool = True


class PosSaleReturnIn(BaseModel):
    lines: List[PosSaleReturnLineIn] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=300)
    idempotency_key: str = Field(min_length=8, max_length=128)
    workstation_id: Optional[str] = Field(default=None, max_length=100)


def _money(value: Any) -> float:
    return round(float(value or 0), 2)


def return_preview(sale: dict) -> dict:
    """What is still returnable on this sale, and why it might not be.

    The screen needs this before it can ask anything sensible: which lines
    came back already, how many are left, and whether the window has passed.
    """
    reason = None
    if (sale.get("status") or "") != "completed":
        reason = "This sale was voided, so there is nothing to return."
    days_old = None
    try:
        sold = _date.fromisoformat(str(sale.get("business_date"))[:10])
        days_old = (_date.today() - sold).days
        if days_old > RETURN_WINDOW_DAYS:
            reason = (f"This sale is {days_old} days old. Returns are accepted for "
                      f"{RETURN_WINDOW_DAYS} days.")
    except ValueError:
        reason = "This sale has no usable date, so it cannot be returned against."

    lines = []
    for i, li in enumerate(sale.get("line_items") or []):
        sold_qty = float(li.get("qty") or 0)
        done = float(li.get("returned_qty") or 0)
        returnable = li.get("kind") in RETURNABLE_KINDS and li.get("custom_kind") != "service"
        lines.append({
            "line_index": i,
            "description": li.get("description"),
            "kind": li.get("kind"),
            "qty": sold_qty,
            "returned_qty": done,
            "remaining_qty": max(0.0, round(sold_qty - done, 3)),
            "unit_price": _money(li.get("unit_price")),
            "returnable": bool(returnable),
            "not_returnable_reason": None if returnable else "Services and prepaid packs are not returned here — void the sale instead.",
        })
    return {
        "sale_id": sale.get("id"),
        "receipt_number": sale.get("receipt_number"),
        "business_date": sale.get("business_date"),
        "days_old": days_old,
        "window_days": RETURN_WINDOW_DAYS,
        "can_return": reason is None and any(l["returnable"] and l["remaining_qty"] > 0 for l in lines),
        "blocked_reason": reason,
        "lines": lines,
        "tenders": [{"method": t.get("method"), "amount": _money(t.get("amount"))}
                    for t in (sale.get("tenders") or [])],
    }


def _refund_by_tender(sale: dict, refund_total: float) -> List[dict]:
    """Split a refund back across however the customer originally paid.

    Money goes back the way it came: a card sale refunds to card, a cash sale
    to cash, and a split sale in the same proportion it was taken. The last
    slice absorbs the rounding so the parts always sum to the whole.
    """
    tenders = [t for t in (sale.get("tenders") or []) if _money(t.get("amount")) > 0]
    paid = round(sum(_money(t.get("amount")) for t in tenders), 2)
    if not tenders or paid <= 0:
        return [{"method": "other", "amount": refund_total}]
    if len(tenders) == 1:
        return [{"method": tenders[0].get("method") or "other", "amount": refund_total}]
    out, allocated = [], 0.0
    for i, t in enumerate(tenders):
        if i == len(tenders) - 1:
            share = round(refund_total - allocated, 2)
        else:
            share = round(refund_total * (_money(t.get("amount")) / paid), 2)
            allocated = round(allocated + share, 2)
        if share > 0:
            out.append({"method": t.get("method") or "other", "amount": share})
    return out


def _returned_line_amounts(line: dict, qty: float) -> tuple:
    """This line's refund, pro-rata: its share of the money and of the tax.

    Taken from what was actually CHARGED (net of any discount) and the tax
    that was actually collected on it — never recomputed from today's price
    or today's tax rate, which may both have moved since.
    """
    sold_qty = float(line.get("qty") or 0)
    if sold_qty <= 0:
        return 0.0, 0.0
    ratio = qty / sold_qty
    net = round(_money(line.get("net_amount")) * ratio, 2)
    tax = round(_money(line.get("allocated_tax")) * ratio, 2)
    return net, tax


async def return_pos_sale(*, sale_id: str, body, user: dict) -> dict:
    """Take merchandise back and give that merchandise's money back.

    The money goes back the way it came, the tax that was collected on those
    items goes back with it, and each item is either restocked or written off
    according to what the desk said. Nothing here recomputes a price or a tax
    rate from today's settings: a refund returns what was actually charged.
    """
    sale = await _db.pos_sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    preview = return_preview(sale)
    if preview["blocked_reason"]:
        raise HTTPException(status_code=409, detail=preview["blocked_reason"])

    # Refunds are money leaving the till today, so today has to be open.
    today = _date.today().isoformat()
    await _require_register_day_open_fn(today)

    items = sale.get("line_items") or []
    wanted: Dict[int, dict] = {}
    for req in body.lines:
        idx = int(req.line_index)
        if idx < 0 or idx >= len(items):
            raise HTTPException(status_code=400, detail="That line is not on this sale.")
        line = items[idx]
        if line.get("kind") not in RETURNABLE_KINDS or line.get("custom_kind") == "service":
            raise HTTPException(
                status_code=400,
                detail=f"'{line.get('description')}' is a service, not merchandise. Void the sale instead.")
        remaining = round(float(line.get("qty") or 0) - float(line.get("returned_qty") or 0), 3)
        qty = round(float(req.qty), 3)
        prev = wanted.get(idx)
        total_wanted = round((prev["qty"] if prev else 0.0) + qty, 3)
        if total_wanted > remaining + 0.0005:
            raise HTTPException(
                status_code=400,
                detail=f"Only {remaining:g} of '{line.get('description')}' can still be returned.")
        wanted[idx] = {"qty": total_wanted, "restock": bool(req.restock)}

    # Claim the key before touching anything, so a retry replays instead of
    # refunding twice - the same discipline the sale and the void use.
    ts = datetime.now(timezone.utc).isoformat()
    claim_id = str(uuid.uuid4())
    try:
        await _db.pos_sale_return_claims.insert_one({
            "id": claim_id, "idempotency_key": body.idempotency_key, "pos_sale_id": sale_id,
            "status": "processing", "created_at": ts,
        })
    except Exception as exc:
        if "duplicate key" not in str(exc).lower():
            raise
        prior = await _db.pos_sale_return_claims.find_one({"idempotency_key": body.idempotency_key}, {"_id": 0})
        if prior and prior.get("status") == "completed" and prior.get("pos_sale_id") == sale_id:
            done = await _db.pos_sale_returns.find_one({"id": prior.get("return_id")}, {"_id": 0})
            if done:
                return {"ok": True, "returned": done, "replayed": True}
        raise HTTPException(status_code=409,
                            detail="That return is already being processed. Wait a moment and try again.")

    reserved = False
    try:
        # Reserve the quantities atomically. The filter refuses if anyone
        # else's return landed first, which is what stops the same last item
        # going back twice from two tills.
        query: Dict[str, Any] = {"id": sale_id, "status": "completed"}
        inc: Dict[str, Any] = {}
        for idx, req in wanted.items():
            allowed = round(float(items[idx].get("qty") or 0) - req["qty"], 3)
            query[f"line_items.{idx}.returned_qty"] = {"$not": {"$gt": allowed}}
            inc[f"line_items.{idx}.returned_qty"] = req["qty"]
        claimed = await _db.pos_sales.find_one_and_update(query, {"$inc": inc})
        if claimed is None:
            raise HTTPException(
                status_code=409,
                detail="Some of those items have already been returned. Reopen the sale and check what is left.")
        reserved = True

        refund_lines, refund_net, refund_tax = [], 0.0, 0.0
        for idx, req in sorted(wanted.items()):
            line = items[idx]
            net, tax = _returned_line_amounts(line, req["qty"])
            refund_net = round(refund_net + net, 2)
            refund_tax = round(refund_tax + tax, 2)
            refund_lines.append({
                "line_index": idx, "product_id": line.get("product_id"),
                "description": line.get("description"), "qty": req["qty"],
                "restock": req["restock"], "net_amount": net, "tax_amount": tax,
                "refund_amount": round(net + tax, 2),
            })
        refund_total = round(refund_net + refund_tax, 2)
        if refund_total <= 0:
            raise HTTPException(status_code=400, detail="That return comes to nothing. Check the quantities.")

        tenders = _refund_by_tender(sale, refund_total)
        cash_back = round(sum(t["amount"] for t in tenders if t["method"] == "cash"), 2)
        if cash_back > 0:
            drawer = await _db.cash_drawer_sessions.find_one({"date": today}, {"_id": 0, "date": 1})
            if not drawer:
                raise HTTPException(status_code=400, detail="Open the register before giving cash back.")

        record = {
            "id": str(uuid.uuid4()),
            "pos_sale_id": sale_id,
            "receipt_number": sale.get("receipt_number"),
            "original_business_date": sale.get("business_date"),
            "business_date": today,
            "client_id": sale.get("client_id"), "client_name": sale.get("client_name"),
            "lines": refund_lines,
            "subtotal": refund_net, "tax_amount": refund_tax, "total": refund_total,
            "tenders": tenders,
            "reason": body.reason.strip(),
            "workstation_id": body.workstation_id,
            "created_at": ts,
            "created_by": user.get("id"),
            "created_by_name": user.get("name") or user.get("email") or "",
        }
        await _db.pos_sale_returns.insert_one(dict(record))
        record.pop("_id", None)

        # One negative revenue row PER REFUND METHOD, so the register buckets
        # each slice against the tender it actually went back on and expected
        # drawer cash only moves by the cash part.
        allocated_tax = 0.0
        for i, t in enumerate(tenders):
            share = (t["amount"] / refund_total) if refund_total else 0
            tax_slice = (round(refund_tax - allocated_tax, 2) if i == len(tenders) - 1
                         else round(refund_tax * share, 2))
            allocated_tax = round(allocated_tax + tax_slice, 2)
            await _db.retail_sales.insert_one({
                "id": str(uuid.uuid4()), "date": today, "amount": -t["amount"],
                "payment_method": t["method"],
                "client_id": sale.get("client_id"), "client_name": sale.get("client_name"),
                "pos_sale_id": sale_id, "pos_sale_return_id": record["id"],
                "source_kind": "pos_sale_return",
                "tax_amount": -tax_slice,
                "tax_rate_pct": float(sale.get("tax_rate_pct") or 0),
                "pre_tax_amount": -round(t["amount"] - tax_slice, 2),
                "description": f"Return against POS Sale #{sale.get('receipt_number')} - {body.reason.strip()}",
                "created_at": ts, "created_by": user.get("id"),
                "logged_by": user.get("name") or user.get("email") or "admin",
            })

        # Put back only what the desk said was resellable.
        for row in refund_lines:
            if not row["restock"] or not row["product_id"]:
                continue
            try:
                await _mutate_product_stock_fn(
                    row["product_id"], row["qty"], "RETURN",
                    f"Return against #{sale.get('receipt_number')}: {body.reason.strip()}",
                    user=user, pos_sale_id=sale_id,
                )
            except Exception:
                _logger.exception("Return %s could not restock %s", record["id"], row["product_id"])

        await _db.pos_sale_return_claims.update_one(
            {"id": claim_id}, {"$set": {"status": "completed", "return_id": record["id"]}})
        _logger.info("POS return %s on sale %s by %s: %s refunded",
                     record["id"], sale_id, record["created_by_name"] or record["created_by"], refund_total)
        return {"ok": True, "returned": record}
    except Exception:
        if reserved:
            await _db.pos_sales.update_one(
                {"id": sale_id},
                {"$inc": {f"line_items.{i}.returned_qty": -r["qty"] for i, r in wanted.items()}})
        await _db.pos_sale_return_claims.delete_one({"id": claim_id})
        raise


async def build_register_catalog(client_id: Optional[str]) -> dict:
    """Front Desk / walk-up register catalog — the register-facing sibling
    of _build_shop_catalog(). Same three canonical collections, same `kind`
    discriminator, same _resolve_client_price_fn() so a grandfathered client is
    charged identically whether staff ring them up at the register or they
    self-checkout in the Shop — but gated on `show_at_register` instead of
    `show_online`/`available_online`, since those are deliberately
    independent visibility switches (Shop Manager ItemsTab shows both as
    separate toggles). This does NOT create a second product system: it is
    a second FILTER over the exact same pos_products/credit_packs/programs
    documents, reusing the same Shop Organization category visibility and
    the same pricing resolver as every other purchase surface.

    A Shopify-linked product is excluded entirely (not just shown
    read-only) — Shopify owns fulfillment for that listing, and a walk-up
    register sale has no way to honor that, unlike the Shop's catalog
    where it's a legitimate external-link tile."""
    active_cats = {c["id"]: c for c in await _db.shop_categories.find({"active": True}, {"_id": 0}).to_list(500)}
    active_subs = {s["id"]: s for s in await _db.shop_subcategories.find({"active": True}, {"_id": 0}).to_list(2000)}

    def _shop_org_visible(cat_id, sub_id):
        if not cat_id:
            return True
        if cat_id not in active_cats:
            return False
        if sub_id and sub_id not in active_subs:
            return False
        return True

    def _shop_org_fields(cat_id, sub_id):
        cat = active_cats.get(cat_id) if cat_id else None
        sub = active_subs.get(sub_id) if sub_id else None
        return {
            "category_id": cat["id"] if cat else None,
            "category_name": cat["name"] if cat else None,
            "subcategory_id": sub["id"] if sub else None,
            "subcategory_name": sub["name"] if sub else None,
        }

    items = []

    products = await _db.pos_products.find(
        {"active": True, "archived": {"$ne": True}, "show_at_register": {"$ne": False}}, {"_id": 0},
    ).sort([("category", 1), ("name", 1), ("id", 1)]).to_list(length=None)
    for p in products:
        if p.get("sales_destination") == "shopify_external":
            continue
        if not _shop_org_visible(p.get("category_id"), p.get("subcategory_id")):
            continue
        track = bool(p.get("track_inventory"))
        stock = float(p.get("stock_on_hand") or 0)
        list_price = round(float(p.get("price") or 0), 2)
        pricing = await _resolve_client_price_fn(client_id, "pos_product", p["id"], list_price)
        effective_price = round(float(pricing["effective_price"]), 2)
        has_override = pricing["pricing_source"] != "standard"
        items.append({
            "kind": "product",
            "id": p["id"],
            "name": p.get("name"),
            "description": p.get("description") or "",
            "sku": p.get("sku") or "",
            "category": p.get("category") or "",
            "featured": bool(p.get("featured")),
            "list_price": list_price,
            "effective_price": effective_price,
            "pricing_source": pricing["pricing_source"],
            "price_override_id": pricing["override_id"],
            "has_price_override": has_override,
            "image_id": p.get("image_id"),
            "track_inventory": track,
            "in_stock": (not track) or (stock > 0.0005),
            "stock_on_hand": round(stock, 2) if track else None,
            "low_stock_threshold": p.get("low_stock_threshold") if track else None,
            "taxable": bool(p.get("taxable", True)),
            "tax_exempt_reason": p.get("tax_exempt_reason"),
            **_shop_org_fields(p.get("category_id"), p.get("subcategory_id")),
        })

    packs = await _db.credit_packs.find(
        {"active": True, "show_at_register": {"$ne": False}}, {"_id": 0},
    ).sort([("name", 1), ("id", 1)]).to_list(length=None)
    for pk in packs:
        if not _shop_org_visible(pk.get("category_id"), pk.get("subcategory_id")):
            continue
        qty = int(pk.get("qty") or 0)
        list_price = round(float(pk.get("price") or 0), 2)
        pricing = await _resolve_client_price_fn(client_id, "credit_pack", pk["id"], list_price)
        effective_price = round(float(pricing["effective_price"]), 2)
        has_override = bool(pricing["override_id"])
        items.append({
            "kind": "credit_pack",
            "id": pk["id"],
            "name": pk.get("name"),
            "description": pk.get("description") or pk.get("online_description") or "",
            "sku": "",
            "category": "",
            "service_type": pk.get("service_type"),
            "qty": qty,
            "featured": bool(pk.get("featured")),
            "list_price": list_price,
            "effective_price": effective_price,
            "pricing_source": "client_override" if has_override else "standard",
            "price_override_id": pricing["override_id"],
            "has_price_override": has_override,
            "value_each": round(effective_price / max(qty, 1), 2),
            "image_id": pk.get("image_id"),
            # Step 4C-1 — deterministically non-taxable (service), matching
            # the pricing paths; a stray taxable=true on the doc is ignored.
            "taxable": False,
            "tax_exempt_reason": pk.get("tax_exempt_reason") or "Prepaid visit credits are a service, not a taxed retail good",
            **_credit_pack_display_fields_fn(pk, qty, effective_price),
            **_shop_org_fields(pk.get("category_id"), pk.get("subcategory_id")),
        })

    programs = await _db.programs.find(
        {"active": True, "show_at_register": {"$ne": False}}, {"_id": 0},
    ).sort([("name", 1), ("id", 1)]).to_list(length=None)
    for prog in programs:
        if not _shop_org_visible(prog.get("category_id"), prog.get("subcategory_id")):
            continue
        fmt = prog.get("format") or {}
        # Programs have no grandfathered-pricing resolver today (matches
        # sell-program's own behavior — see PosSaleLineIn/sell_training_program),
        # so effective_price always equals list_price here; the field is
        # still emitted so the Front Desk card can use one consistent
        # "effective_price" read across all three kinds.
        list_price = round(float(prog.get("price") or 0), 2)
        items.append({
            "kind": "training_program",
            "id": prog["id"],
            "name": prog.get("name"),
            "description": prog.get("description") or prog.get("online_description") or "",
            "sku": "",
            "category": "",
            "focus": prog.get("focus") or "",
            "program_type": prog.get("type"),
            "format_count": fmt.get("count"),
            "format_unit": fmt.get("unit"),
            "min_age_months": prog.get("min_age_months") or 0,
            "featured": bool(prog.get("featured")),
            "list_price": list_price,
            "effective_price": list_price,
            "pricing_source": "standard",
            "price_override_id": None,
            "has_price_override": False,
            "image_id": prog.get("image_id"),
            # Step 4C-1 — deterministically non-taxable (service).
            "taxable": False,
            "tax_exempt_reason": prog.get("tax_exempt_reason") or "Training is a service, not a taxed retail good",
            # Phase 5 — client-facing so the Shop item detail page knows
            # whether to show a dog selector / real ownership CTA states.
            "purchase_fulfillment": prog.get("purchase_fulfillment") or "credits_only",
            # Free Online School claim — COMPUTED from the stored program by
            # the same helper the claim endpoint enforces, never a passthrough
            # of the raw flag. A $0 program with no explicit opt-in resolves
            # False here, so the Shop can never offer to claim one.
            "free_claim_available": _free_claim_program_blockers_fn(prog) is None,
            "estimated_weeks": prog.get("estimated_weeks"),
            "school_support": prog.get("school_support") or {},
            "school_onboarding": prog.get("school_onboarding") or {},
            "recommended_next_program_slugs": prog.get("recommended_next_program_slugs") or [],
            **_shop_org_fields(prog.get("category_id"), prog.get("subcategory_id")),
        })

    return {"items": items}

async def price_pos_cart(lines: List[PosSaleLineIn], discount: Optional[PosSaleDiscountIn], *, can_price: bool, client_id: Optional[str] = None) -> tuple:
    """Prices a WHOLE Front Desk cart — retail products, admin-only custom
    lines, credit packs, and training programs — as ONE priced transaction.
    Retail/credit-pack prices are ALWAYS resolved server-side from the live
    catalog via _resolve_client_price_fn() (never trusted from the client);
    training-program prices are list-price only (matches sell-program's own
    behavior — no grandfathered-pricing resolver exists for programs
    anywhere in the app); only a custom line's amount is caller-supplied,
    and only staff holding the "pricing" permission may include one or
    apply a discount.

    Front Desk checkout integrity audit — this used to be retail/custom
    only, with credit packs and training programs sold through entirely
    separate sell-pack/sell-program calls. A mixed cart therefore produced
    several unrelated "sales" instead of one coherent transaction. Pricing
    every kind here, in one place, is what lets create_pos_sale commit the
    whole cart as a single atomic, idempotent, one-receipt transaction.

    Security checkpoint fix (kept from the retail-only version) — this used
    to gate on `is_admin` (a blanket `role == "admin"` check), so any
    restricted staff_role account (which still has `role: "admin"`) could
    add custom-priced lines or discounts regardless of the "pricing"
    permission the frontend already enforces. `can_price` is the caller's
    actual `_perms_for(user).get("pricing")`. Raises HTTPException on any
    invalid input; never partially prices.

    Tax handling — each catalog item (pos_products/credit_packs/programs)
    now carries its own `taxable`/`tax_exempt_reason` fields (see those
    models) instead of tax being hardcoded by line `kind`. Tax is allocated
    PER LINE, proportional to each taxable line's post-discount amount
    (mirrors _price_shop_cart's existing per-line allocation), so every
    line_item carries its own taxable/tax_rate_pct/allocated_tax/
    tax_exempt_reason — never a single cart-wide lump.

    Also enforces stock availability for track_inventory products, summed
    across every line referencing the same product (so two cart lines for
    the same item can't each individually pass a check that their combined
    quantity would fail). This is a pre-commit convenience check shared by
    preview and create — the actual sale commit still deducts atomically
    (see _mutate_product_stock), so a race against another register can
    never oversell even if this check briefly passed. Frontend stock
    numbers are for display only; this is the real enforcement point.

    Returns (priced_dict, catalog_caches) — catalog_caches is
    {"products": {...}, "packs": {...}, "programs": {...}}, each mapping id
    to the full catalog doc as read at pricing time, reused by the caller
    so a sale commit never has to re-query anything it already fetched
    here."""
    line_items = []
    product_cache: Dict[str, dict] = {}
    pack_cache: Dict[str, dict] = {}
    program_cache: Dict[str, dict] = {}
    qty_by_product: Dict[str, float] = {}
    has_entitlement_line = False

    for line in lines:
        if line.kind == "custom":
            if not can_price:
                raise HTTPException(status_code=403, detail="You don't have permission to add a custom item.")
            if line.custom_amount is None or line.custom_amount <= 0:
                raise HTTPException(status_code=400, detail="Custom items require a positive amount.")
            if not (line.custom_reason or "").strip():
                raise HTTPException(status_code=400, detail="Custom items require a reason.")
            amount = round(float(line.custom_amount), 2)
            # Step 4C-1 — custom lines carry a structured merchandise/service
            # selection; services are never sales-taxable.
            custom_is_service = line.custom_kind == "service"
            line_items.append({
                "kind": "custom", "product_id": None,
                "custom_kind": line.custom_kind,
                "description": (line.description or "Custom item").strip(),
                "qty": 1, "unit_price": amount, "amount": amount,
                "reason": line.custom_reason.strip(),
                "taxable": not custom_is_service,
                "tax_exempt_reason": "Service — not sales-taxable" if custom_is_service else None,
            })
        elif line.kind == "retail":
            if not line.product_id:
                raise HTTPException(status_code=400, detail="Retail line is missing a product.")
            product = product_cache.get(line.product_id)
            if product is None:
                product = await _db.pos_products.find_one({"id": line.product_id}, {"_id": 0})
                if not product or not product.get("active", True):
                    raise HTTPException(status_code=400, detail="One of the products in this cart is no longer available.")
                product_cache[line.product_id] = product
            qty = round(float(line.qty or 1), 3)
            list_price = round(float(product["price"]), 2)
            pricing = await _resolve_client_price_fn(client_id, "pos_product", product["id"], list_price)
            unit_price = round(float(pricing["effective_price"]), 2)
            has_override = pricing["pricing_source"] != "standard"
            amount = round(qty * unit_price, 2)
            taxable = bool(product.get("taxable", True))
            line_items.append({
                "kind": "retail", "product_id": product["id"],
                "description": (line.description or product["name"]).strip(),
                "qty": qty, "unit_price": unit_price, "amount": amount,
                "list_price": list_price,
                "has_price_override": has_override,
                "price_override_id": pricing["override_id"],
                "taxable": taxable, "tax_exempt_reason": None if taxable else product.get("tax_exempt_reason"),
            })
            qty_by_product[product["id"]] = qty_by_product.get(product["id"], 0) + qty
        elif line.kind == "credit_pack":
            has_entitlement_line = True
            if not line.pack_id:
                raise HTTPException(status_code=400, detail="Credit pack line is missing a pack.")
            pack = pack_cache.get(line.pack_id)
            if pack is None:
                pack = await _db.credit_packs.find_one({"id": line.pack_id}, {"_id": 0})
                if not pack or not pack.get("active", True):
                    raise HTTPException(status_code=400, detail="One of the credit packs in this cart is no longer available.")
                pack_cache[line.pack_id] = pack
            qty = int(line.qty or 1)  # whole packs purchased, not visit count
            list_price = round(float(pack["price"]), 2)
            pricing = await _resolve_client_price_fn(client_id, "credit_pack", pack["id"], list_price)
            unit_price = round(float(pricing["effective_price"]), 2)
            has_override = pricing["pricing_source"] != "standard"
            amount = round(qty * unit_price, 2)
            # Step 4C-1 — credit packs are prepaid SERVICE visits: never
            # sales-taxable, deterministically (a stray taxable=true on the
            # pack doc must not tax a service).
            taxable = False
            line_items.append({
                "kind": "credit_pack", "pack_id": pack["id"],
                "description": (line.description or pack["name"]).strip(),
                "qty": qty, "unit_price": unit_price, "amount": amount,
                "list_price": list_price,
                "has_price_override": has_override,
                "price_override_id": pricing["override_id"],
                "taxable": taxable,
                "tax_exempt_reason": None if taxable else (pack.get("tax_exempt_reason") or "Prepaid visit credits are a service, not a taxed retail good"),
            })
        elif line.kind == "training_program":
            has_entitlement_line = True
            if not line.program_id:
                raise HTTPException(status_code=400, detail="Training program line is missing a program.")
            program = program_cache.get(line.program_id)
            if program is None:
                program = await _db.programs.find_one({"id": line.program_id}, {"_id": 0})
                if not program or not program.get("active", True):
                    raise HTTPException(status_code=400, detail="One of the training programs in this cart is no longer available.")
                fmt = program.get("format") or {}
                if int(fmt.get("count") or 0) <= 0:
                    raise HTTPException(status_code=400, detail=f"{program.get('name', 'This program')} isn't set up for sale (format.count must be > 0).")
                if program.get("purchase_fulfillment") == "online_school":
                    # Phase 5 decision — the Front Desk register has no safe
                    # way to select which of the client's dogs an Online
                    # School enrollment is for (PosSaleLineIn carries no
                    # dog_id, and Pos.jsx's program-line UI is client-scoped
                    # only). Rather than guess a dog, this line kind is
                    # blocked here until a register dog-selector exists;
                    # staff can sell it through "Sell Program" (which
                    # already supports dog_id) or the client Shop instead.
                    raise HTTPException(
                        status_code=400,
                        detail=f"{program.get('name', 'This program')} is an Online School course and can't be sold at the register yet — use \"Sell Program\" on the client's profile or have the client buy it in their Shop.",
                    )
                program_cache[line.program_id] = program
            qty = int(line.qty or 1)  # whole program enrollments purchased
            list_price = round(float(program.get("price") or 0), 2)
            # No grandfathered-pricing resolver exists for programs anywhere
            # in the app (matches sell_training_program's own behavior) —
            # effective_price always equals list_price.
            unit_price = list_price
            amount = round(qty * unit_price, 2)
            # Step 4C-1 — training programs are services: never sales-taxable,
            # deterministically.
            taxable = False
            line_items.append({
                "kind": "training_program", "program_id": program["id"],
                "description": (line.description or program["name"]).strip(),
                "qty": qty, "unit_price": unit_price, "amount": amount,
                "list_price": list_price,
                "has_price_override": False,
                "price_override_id": None,
                "taxable": taxable,
                "tax_exempt_reason": None if taxable else (program.get("tax_exempt_reason") or "Training is a service, not a taxed retail good"),
            })
        else:
            raise HTTPException(status_code=400, detail=f"Unknown cart line kind: {line.kind}")

    if has_entitlement_line and not client_id:
        raise HTTPException(status_code=400, detail="Credit packs and training programs require a client — walk-in sales can't purchase them.")

    for product_id, total_qty in qty_by_product.items():
        product = product_cache[product_id]
        if not product.get("track_inventory"):
            continue
        stock = float(product.get("stock_on_hand") or 0)
        if total_qty > stock + 0.0005:
            if stock <= 0.0005:
                raise HTTPException(status_code=400, detail=f"{product['name']} is out of stock.")
            raise HTTPException(status_code=400, detail=f"Only {stock:g} in stock for {product['name']}.")

    subtotal = round(sum(li["amount"] for li in line_items), 2)

    discount_amount = 0.0
    discount_kind = None
    discount_reason = None
    if discount is not None:
        if not can_price:
            raise HTTPException(status_code=403, detail="You don't have permission to apply a discount.")
        if discount.kind == "percent":
            if discount.value > 100:
                raise HTTPException(status_code=400, detail="A percentage discount cannot exceed 100%.")
            discount_amount = round(subtotal * (discount.value / 100.0), 2)
        else:
            discount_amount = round(min(discount.value, subtotal), 2)
        discount_kind = discount.kind
        discount_reason = discount.reason.strip()

    # Tax is allocated PER LINE (not as one cart-wide lump) — only lines
    # whose catalog item is actually configured `taxable` contribute, and
    # each gets its own discount-proportional share of the total tax so the
    # receipt/invoice can show taxable status + rate + amount per line.
    discount_ratio = (discount_amount / subtotal) if subtotal > 0 else 0.0
    taxable_indices = [i for i, li in enumerate(line_items) if li["taxable"]]
    taxable_subtotal = round(sum(line_items[i]["amount"] for i in taxable_indices), 2)
    taxable_base = round(taxable_subtotal * (1 - discount_ratio), 2)
    tax_amount = 0.0
    tax_rate_pct = 0.0
    try:
        settings_tx = await _get_settings_fn()
        tx_cfg = (settings_tx or {}).get("sales_tax") or {}
        # Merchandise is taxed whenever tax is switched on, full stop. There
        # is no category toggle that can quietly exempt it — see
        # sales_tax_policy for why that switch was removed.
        rate = sales_tax_policy.merchandise_tax_rate(tx_cfg)
        if rate > 0 and taxable_base > 0:
            tax_rate_pct = rate
            tax_amount = sales_tax_policy.tax_on(taxable_base, rate)
    except Exception as exc:
        _logger.warning("POS cart tax calc failed: %s", exc)

    allocated_so_far = 0.0
    for pos, i in enumerate(taxable_indices):
        li = line_items[i]
        li["tax_rate_pct"] = tax_rate_pct
        if tax_amount <= 0:
            li["allocated_tax"] = 0.0
            continue
        if pos == len(taxable_indices) - 1:
            li["allocated_tax"] = round(tax_amount - allocated_so_far, 2)
        else:
            line_share = round(tax_amount * (li["amount"] / taxable_subtotal), 2) if taxable_subtotal > 0 else 0.0
            li["allocated_tax"] = line_share
            allocated_so_far = round(allocated_so_far + line_share, 2)
    for i, li in enumerate(line_items):
        if i not in taxable_indices:
            li["tax_rate_pct"] = 0.0
            li["allocated_tax"] = 0.0

    # Discount is a single cart-wide amount (fixed $ or %), but every line
    # still needs its own post-discount "net_amount" — this is what each
    # kind's own revenue-recognition row (retail_sales for retail/custom,
    # one row per credit-pack/program lot) actually records, so a mixed
    # cart's total revenue always adds up across every kind exactly once.
    # Allocated proportionally by each line's pre-discount amount, with a
    # running-remainder correction on the last line (same rounding-safe
    # pattern as the tax allocation above).
    discount_allocated_so_far = 0.0
    for idx, li in enumerate(line_items):
        if subtotal <= 0:
            line_discount = 0.0
        elif idx == len(line_items) - 1:
            line_discount = round(discount_amount - discount_allocated_so_far, 2)
        else:
            line_discount = round(discount_amount * (li["amount"] / subtotal), 2)
            discount_allocated_so_far = round(discount_allocated_so_far + line_discount, 2)
        li["allocated_discount"] = line_discount
        li["net_amount"] = round(li["amount"] - line_discount, 2)
        li["line_total"] = round(li["net_amount"] + li["allocated_tax"], 2)

    total = round((subtotal - discount_amount) + tax_amount, 2)

    priced = {
        "line_items": line_items, "subtotal": subtotal,
        "discount_amount": discount_amount, "discount_kind": discount_kind, "discount_reason": discount_reason,
        "tax_amount": tax_amount, "tax_rate_pct": tax_rate_pct, "total": total,
        # How much of this cart is merchandise. The register compares it with
        # tax_amount so that "there is tax to charge and none is being
        # charged" can be SAID out loud instead of just looking like a cart
        # with no tax line — which is how goods went out untaxed unnoticed.
        "taxable_subtotal": taxable_base,
    }
    catalog_caches = {"products": product_cache, "packs": pack_cache, "programs": program_cache}
    return priced, catalog_caches

