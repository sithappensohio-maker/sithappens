"""What a customer is allowed to see about an order they placed.

One projection, two readers: the signed-in client looking at My Orders, and
the guest holding a token for one order. Writing it once is the point — two
hand-rolled dictionaries drift, and the way they drift is that one of them
starts returning a field nobody meant to publish.

Everything here is an ALLOWLIST. Nothing is copied wholesale from the order
document, nothing is passed through with `**`, and adding a field to the
order does not add it to this response. What is deliberately never returned:

  * `guest_token_hash` — the thing that proves ownership of a guest order
  * `stripe_*` — session ids, attempt ids, customer ids, reserved amounts
  * `client_id`, `admin_unseen`, `refund_attempts_applied`,
    `shop_last_applied_attempt_id` — internal bookkeeping
  * the per-line pricing_source / override id — how a price was arrived at
    is between us and the client's account, not part of a receipt
  * gift card CODES, which are not on the order at all (they live on the
    card) and must not be fetched onto it

What IS returned is a receipt: what they bought, for which dog, for whom,
what it cost, what happened next, and what they can usefully do now.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# The app already prints an order as the first eight characters of its id,
# upper-cased (see the gift-card note written at fulfilment). Deriving the
# same string here rather than inventing a second format means the number on
# a customer's screen matches the one in their email.
def reference(order_id: str) -> str:
    return str(order_id or "")[:8].upper()


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _line_summary(line: dict, item: Optional[dict] = None) -> Dict[str, Any]:
    """The compact form, for the list. Name and quantity, nothing priced."""
    return {
        "kind": line.get("kind"),
        "ref_id": line.get("ref_id"),
        # The name is HISTORY: what it was called when they bought it. A
        # renamed product must not rewrite an old receipt.
        "name": line.get("name"),
        "quantity": int(line.get("quantity") or 0),
        "fulfillment_status": line.get("fulfillment_status"),
        "dog_name": line.get("dog_name"),
        # The picture is the opposite: read live, so a row is recognisable
        # at a glance and an item that has gone simply loses its thumbnail.
        "image_id": (item or {}).get("image_id"),
    }


def _line_detail(line: dict, *, item: Optional[dict], actions: List[dict]) -> Dict[str, Any]:
    quantity = int(line.get("quantity") or 0)
    refunded = int(line.get("quantity_refunded") or 0)
    out: Dict[str, Any] = {
        "item_id": line.get("item_id"),
        "kind": line.get("kind"),
        "ref_id": line.get("ref_id"),
        "name": line.get("name"),
        "quantity": quantity,
        "unit_price": _money(line.get("unit_price")),
        "line_subtotal": _money(line.get("line_subtotal")),
        "allocated_tax": _money(line.get("allocated_tax")),
        "line_total": _money(line.get("line_total")),
        "fulfillment_status": line.get("fulfillment_status"),
        # The picture comes from the LIVE catalogue, not from history: a
        # receipt should show the product as it looks now, and an item that
        # has gone simply loses its thumbnail rather than breaking the row.
        "image_id": (item or {}).get("image_id"),
        "actions": actions,
    }
    if refunded:
        out["quantity_refunded"] = refunded
        out["amount_refunded"] = _money(line.get("amount_refunded"))
    if line.get("dog_name") or line.get("dog_id"):
        # The dog's NAME, never the id. The name is what the customer
        # recognises, and the id is an internal handle they have no use for.
        out["dog_name"] = line.get("dog_name")
    if line.get("kind") == "gift_card":
        # Their own words back to them. The card's redemption code is not
        # here and is never fetched onto an order — it belongs to whoever
        # received the card, through the email it was sent in.
        out["recipient_name"] = line.get("recipient_name") or None
        out["recipient_email"] = line.get("recipient_email") or None
        out["gift_message"] = line.get("gift_message") or None
    if line.get("fulfillment_kind"):
        out["fulfillment_kind"] = line.get("fulfillment_kind")
    return out


def summary(order: dict, items_by_ref: Optional[Dict[tuple, dict]] = None) -> Dict[str, Any]:
    """One row in My Orders.

    `items_by_ref` is the caller's whole catalogue, read ONCE for the whole
    list. Twenty orders is one catalogue read, not twenty, and not one per
    line — which is the difference between a list that opens instantly and
    one that visibly fills in.
    """
    lines = order.get("lines") or []
    by_ref = items_by_ref or {}
    return {
        "order_id": order.get("id"),
        "reference": reference(order.get("id")),
        "created_at": order.get("created_at"),
        "status": order.get("status"),
        "fulfillment_status": order.get("fulfillment_status"),
        "pickup_status": order.get("pickup_status"),
        "refund_status": order.get("refund_status"),
        "total": _money(order.get("total")),
        "item_count": sum(int(l.get("quantity") or 0) for l in lines),
        "lines": [_line_summary(l, by_ref.get((l.get("kind"), l.get("ref_id")))) for l in lines],
    }


def detail(order: dict, *, items_by_ref: Dict[tuple, dict],
           actions_by_item_id: Dict[str, List[dict]]) -> Dict[str, Any]:
    """The full receipt.

    `items_by_ref` and `actions_by_item_id` are computed by the caller in
    ONE pass each and handed in, so a ten-line order is still one catalogue
    read and one enrolment read — not ten of each.
    """
    lines = order.get("lines") or []
    out = {
        "order_id": order.get("id"),
        "reference": reference(order.get("id")),
        "created_at": order.get("created_at"),
        "status": order.get("status"),
        "fulfillment_status": order.get("fulfillment_status"),
        "pickup_status": order.get("pickup_status"),
        "refund_status": order.get("refund_status"),
        "subtotal": _money(order.get("subtotal")),
        "tax_amount": _money(order.get("tax_amount")),
        "total": _money(order.get("total")),
        "currency": order.get("currency") or "USD",
        "lines": [
            _line_detail(
                l,
                item=items_by_ref.get((l.get("kind"), l.get("ref_id"))),
                actions=actions_by_item_id.get(str(l.get("item_id")), []),
            )
            for l in lines
        ],
    }
    if order.get("refunded_amount"):
        out["refunded_amount"] = _money(order.get("refunded_amount"))
    return out


# ───────────────────────────────────────────────────────── what to offer next

async def line_actions(
    *, db, order: dict, line: dict, item: Optional[dict],
    viewer_client_id: Optional[str], enrollment_by_key: Dict[tuple, dict],
) -> List[Dict[str, Any]]:
    """What this customer can usefully do with this line, now.

    The rule that matters is what "Buy Again" means. It means *reconstruct
    the intent*: this thing, this many. It does NOT mean repeat the
    transaction. Nothing about the old money travels — no unit price, no
    tax, no total — because the action returns a reference and a quantity,
    and the cart prices a reference from the live catalogue like any other.
    A Buy Again that carried its old price would be a price a customer could
    edit, which is the whole reason the cart does not hold prices either.

    So the checks here are not about the old order. They are about right
    now: is it still sold, is there any left, and is this customer allowed
    to buy it again at all.
    """
    kind = line.get("kind")
    actions: List[Dict[str, Any]] = []
    paid = order.get("status") == "paid"

    def block(reason: str) -> None:
        actions.append({"action": "buy_again", "enabled": False, "reason": reason})

    # Anything still in the catalogue can be looked at again.
    if item is not None and kind in ("product", "credit_pack", "training_program"):
        actions.append({"action": "view_item", "enabled": True,
                        "kind": kind, "ref_id": line.get("ref_id")})

    if kind == "training_program" and line.get("fulfillment_kind") == "online_school":
        # The useful action for a course is opening it, not buying it.
        enrollment = enrollment_by_key.get((line.get("dog_id"), line.get("ref_id")))
        if enrollment and viewer_client_id:
            actions.append({"action": "open_course", "enabled": True,
                            "enrollment_id": enrollment.get("id"),
                            "dog_name": line.get("dog_name")})
        elif paid:
            actions.append({"action": "open_course", "enabled": False,
                            "reason": "This course is still being set up."})
        # Buying it again for the same dog is refused at checkout, so it is
        # not offered here either. Offering a button that 409s is worse than
        # offering no button.
        block("Already purchased for this dog")
        return actions

    if kind == "training_program" and item is not None and item.get("requires_dog"):
        # No dog-selection path exists for these through the cart, so the
        # checkout refuses them outright (see _validate_shop_item_eligibility).
        block("Contact us to arrange this again")
        return actions

    if item is None:
        block("No longer available")
        return actions
    if kind == "product" and item.get("sales_destination") == "shopify_external":
        block("Buy this one on our Shopify store")
        return actions
    if item.get("price") is None:
        block("No longer available")
        return actions
    if kind == "product" and item.get("track_inventory"):
        on_hand = int(item.get("stock_on_hand") or 0)
        if on_hand <= 0:
            block("Out of stock")
            return actions

    actions.append({
        "action": "buy_again", "enabled": True,
        "kind": kind, "ref_id": line.get("ref_id"),
        # Intent only. Deliberately no price, no tax, no total: the cart
        # resolves what this costs today, and the checkout prices it again.
        "quantity": max(1, int(line.get("quantity") or 1)),
    })
    if kind == "credit_pack":
        actions.append({"action": "view_credits", "enabled": True})
    return actions


async def enrollments_for(db, order: dict, client_id: Optional[str]) -> Dict[tuple, dict]:
    """Every Online School enrolment this order's lines could open, in one
    query rather than one per line."""
    if not client_id:
        return {}
    pairs = [(l.get("dog_id"), l.get("ref_id")) for l in (order.get("lines") or [])
             if l.get("kind") == "training_program"
             and l.get("fulfillment_kind") == "online_school" and l.get("dog_id")]
    if not pairs:
        return {}
    rows = await db.school_enrollments.find(
        {"client_id": client_id,
         "dog_id": {"$in": [p[0] for p in pairs]},
         "program_id": {"$in": [p[1] for p in pairs]}},
        {"_id": 0, "id": 1, "dog_id": 1, "program_id": 1},
    ).to_list(50)
    return {(r.get("dog_id"), r.get("program_id")): r for r in rows}
