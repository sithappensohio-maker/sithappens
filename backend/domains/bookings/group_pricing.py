"""Multi-dog groups: pricing a new group, and finding the dogs that close
on one checkout ticket.

Moved out of server.py unchanged (it was at its size ceiling) to make room
for friends & family groups — dogs from different families on one booking,
one family paying (owner request 2026-09-28).

  * `apply_group_pricing` — after every dog of a new daycare/boarding group
    is booked, price them together: the first dog full price, each extra dog
    the configurable multi-dog discount and half a credit per unit.
  * `household_checkout_rows` — the dogs that should close on one household
    ticket with the one being checked out.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


async def undo_rows(created: List[dict]) -> None:
    """Take back what a group booking made — and nothing else: its booking
    rows, and a Board & Train School enrollment made for one of them (which
    would otherwise stay active, pointing at a booking that no longer exists)."""
    ids = [b["id"] for b in created if b.get("id")]
    if not ids:
        return
    db = _g("db")
    made_here = {"source_booking_id": {"$in": ids}, "enrollment_source": "board_train_package"}
    await db.dog_programs.delete_many(made_here)
    await db.school_enrollments.delete_many(made_here)
    await db.bookings.delete_many({"id": {"$in": ids}})


async def apply_group_pricing(created: List[dict], body: Any, group_id: str) -> None:
    """Apply the final per-row pricing/credit snapshot for daycare/boarding
    group bookings. Each dog gets its own booking row, but the household price
    rule is first dog full-rate and each additional dog 50% off. Storing the
    reduced price on the extra-dog rows prevents checkout from discounting the
    same dog twice later. Existing rows/data are not rewritten.

    If pricing fails, nothing is booked: the rows made are removed and the
    booking is refused. (It used to be logged only, so the dogs were booked
    at separate full prices and the multi-dog discount was silently lost.)"""
    if not (created and body.service_type in ("daycare", "boarding") and len(created) > 1):
        return
    db, now_iso = _g("db"), _g("now_iso")
    try:
        client_id_for_quote = created[0].get("client_id")
        group_cutoff_time = ((created[0].get("pricing_snapshot") or {}).get("pickup_cutoff_time")
                             or _g("DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF"))
        group_pickup_time = (body.pickup_time or group_cutoff_time) if body.service_type == "boarding" else body.pickup_time
        q = await _g("_quote_base_service_price")(
            client_id=client_id_for_quote,
            service_type=body.service_type,
            start_date=body.date,
            end_date=body.end_date,
            pickup_time=group_pickup_time,
            pickup_cutoff_time=group_cutoff_time,
            service_id=body.service_id,
        )
        units = float(q.get("units") or 1)
        unit_price = float(q.get("unit_price") or 0)
        # estimated_price = nights × rate + any late-pickup daycare fee, so
        # the sibling row price discounts the fee too.
        full_base = round(float(q.get("estimated_price") or 0) or (unit_price * units), 2)
        # Configurable sibling discount (multi_dog_discount_core; default
        # 50%). Credits keep the fixed 0.5-per-extra-dog rule regardless —
        # credit weights and dollar discounts are deliberately separate.
        group_md_cfg = _g("_multi_dog_discount_config_for")(await _g("get_settings")(), body.service_type)
        per_dog_discount = round(_g("_discount_amount_for_extra_dogs")(full_base, group_md_cfg, 1), 2) if group_md_cfg else 0.0
        extra_base = round(max(0.0, full_base - per_dog_discount), 2)
        for idx, bk in enumerate(created):
            addon_total = 0.0
            for ao in (bk.get("add_ons") or []):
                addon_total += float(ao.get("price") or 0) * int(ao.get("qty") or 1)
            is_extra = idx > 0
            row_base = extra_base if is_extra else full_base
            row_credits = round(units * (0.5 if is_extra else 1.0), 2)
            patch = {
                "estimated_price": round(row_base + addon_total, 2),
                "credit_units_required": row_credits,
                "unit_price": q.get("unit_price"),
                "list_unit_price": q.get("list_unit_price"),
                "preferred_rate_applied": q.get("preferred_rate_applied", False),
                "price_override_id": q.get("price_override_id"),
                "price_source": q.get("price_source"),
                "price_label": q.get("price_label"),
                "pricing_snapshot": {
                    "service_id": q.get("service_id"),
                    "service_name": q.get("service_name"),
                    "unit_price": q.get("unit_price"),
                    "list_unit_price": q.get("list_unit_price"),
                    "preferred_rate_applied": q.get("preferred_rate_applied", False),
                    "price_override_id": q.get("price_override_id"),
                    "price_source": q.get("price_source"),
                    "price_label": q.get("price_label"),
                    "billable_units": q.get("units"),
                    "unit_label": q.get("unit_label"),
                    "pickup_cutoff_time": group_cutoff_time if body.service_type == "boarding" else None,
                    "group_dog_index": idx,
                    "group_dog_count": len(created),
                    "pricing_client_id": client_id_for_quote,  # whose rates priced the group (the payer's, for friends & family)
                    "credit_units_required": row_credits,
                    "created_at": now_iso(),
                },
            }
            if is_extra:
                patch["multi_dog_discount"] = {
                    "pre_applied": True,
                    "amount": per_dog_discount,
                    "mode": (group_md_cfg or {}).get("mode") or "percent",
                    "value": float((group_md_cfg or {}).get("value") or 0),
                    "label": (group_md_cfg or {}).get("label") or "Additional dog discount",
                    "service_type": body.service_type,
                    "based_on_price": full_base,
                    "applied_at": now_iso(),
                }
            await db.bookings.update_one({"id": bk["id"]}, {"$set": patch})
            bk.update(patch)
    except Exception as exc:
        _g("logger").error("group price snapshot failed for %s: %s", group_id, exc)
        await undo_rows(created)
        raise HTTPException(status_code=500, detail="These dogs couldn't be priced together, so nothing was booked. Please try again.")


async def household_checkout_rows(anchor: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Find the dogs that should close on one household ticket.

    New reservations use group_id. Legacy/separately-entered daycare and
    boarding rows are also grouped when owner, service, and stay dates match.
    """
    service_type = anchor.get("service_type")
    if service_type not in ("daycare", "boarding") and not anchor.get("group_id"):
        return [anchor]
    q: Dict[str, Any] = {
        "client_id": anchor.get("client_id"),
        "service_type": service_type,
        "date": anchor.get("date"),
        "status": {"$nin": ["completed", "cancelled", "rejected"]},
        "$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}],
        # Front Desk household-checkout fix — a booked-but-never-arrived
        # dog in the same household (e.g. Bolt never showed up while Lexi
        # did) must never be swept into Lexi's checkout: completed, charged,
        # credit-deducted, or financially locked purely for being in the
        # same reservation group. Only dogs that actually checked in belong
        # on one combined household ticket.
        "checked_in_at": {"$exists": True, "$nin": [None, ""]},
    }
    if service_type == "boarding":
        q["end_date"] = anchor.get("end_date")
    elif anchor.get("group_id") and service_type not in ("daycare", "boarding"):
        q["group_id"] = anchor.get("group_id")
    if anchor.get("bill_to_client_id") and anchor.get("group_id"):
        # A friends & family group: its own dogs, whichever family each belongs to
        # (a boarding dog whose stay was changed still leaves on its own day).
        q.pop("client_id", None)
        q["group_id"] = anchor.get("group_id")
    else:
        # A family's own checkout never sweeps in a dog another family pays for.
        q["bill_to_client_id"] = {"$in": [None, ""]}
    rows = await _g("db").bookings.find(q, {"_id": 0}).to_list(50)
    # One ticket should never include duplicate rows for the same dog.
    unique: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = row.get("dog_id") or row.get("id")
        unique.setdefault(key, row)
    items = list(unique.values())
    items.sort(key=lambda row: (
        int((row.get("pricing_snapshot") or {}).get("group_dog_index") or 0),
        row.get("created_at") or "",
        row.get("id") or "",
    ))
    return items
