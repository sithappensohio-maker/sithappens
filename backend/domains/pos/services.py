"""POS pricing/catalog services extracted from server.py in Phase 5.

The checkout commit remains the proven transaction implementation, while the
shared catalog and cart-pricing kernels now live behind this explicit domain
boundary so register preview and checkout cannot drift apart.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import HTTPException

_db = None
_resolve_client_price_fn = None
_get_settings_fn = None
_credit_pack_display_fields_fn = None
_free_claim_program_blockers_fn = None
_logger = None
_create_sale_impl_fn = None


def configure(*, db, resolve_client_price, get_settings, credit_pack_display_fields, free_claim_program_blockers, logger, create_sale_impl) -> None:
    global _db, _resolve_client_price_fn, _get_settings_fn, _credit_pack_display_fields_fn
    global _free_claim_program_blockers_fn, _logger, _create_sale_impl_fn
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
        if tx_cfg.get("enabled") and float(tx_cfg.get("rate_pct") or 0) > 0 and taxable_base > 0:
            applies = (tx_cfg.get("applies_to") or {})
            if applies.get("retail", True):
                tax_rate_pct = float(tx_cfg["rate_pct"])
                tax_amount = round(taxable_base * (tax_rate_pct / 100.0), 2)
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
    }
    catalog_caches = {"products": product_cache, "packs": pack_cache, "programs": program_cache}
    return priced, catalog_caches

