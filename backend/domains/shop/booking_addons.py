"""A booking's add-ons, paid for online — as a Shop basket line.

Owner request (2026-11-25): a client booking a visit with add-ons should be
able to pay for the add-ons right there.

Add-ons cost dollars, and there is no bill to pay until staff check the dog
out. Rather than hold the money on the account and teach the staff checkout
a new way of being paid (every drawer, report, bill and refund path would
have to learn it), the payment is tied to the add-ons themselves:

    when the card payment lands, each paid add-on on the booking becomes
    "Bath (paid online)" at $0.00, remembering what was paid for it.

The staff checkout already adds up add-ons from the prices stored on the
booking, so it simply charges nothing more for them. Checkout itself is
unchanged.

It rides the Shop's one checkout as a line `kind`, the way a gift card does:
no second payment path, the same idempotency claim, the same Stripe page —
so a credit pack and the add-ons are ONE card payment.

Rules:

  * the price is never taken from the screen. The line names the bookings;
    the amount is what THOSE bookings' unpaid add-ons cost, read here;
  * the bookings must be the buyer's own and still open;
  * never discounted, never taxed (the Shop does both to `product` lines
    only; add-ons are services);
  * income is counted once, the day the card payment arrives (the order's
    own income row). The visit's checkout then has nothing to add for them;
  * a paid add-on cannot be quietly taken off the booking — the online
    payment is refunded first, which puts its price back;
  * an automatic refund is allowed until the visit is checked out. After
    that the add-on has been given and paid for;
  * if the payment lands on a booking that was cancelled or already checked
    out meanwhile, nothing is changed and the order goes to "needs
    attention" with the reason, for a person to refund.

Every write is safe to repeat: the Shop re-drives fulfilment on a replayed
webhook and from "Retry Fulfillment".
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException

KIND = "booking_addons"
PREFIX = "ba:"
MAX_BOOKINGS = 120   # several dogs on several days is one booking per dog per day
OPEN_STATUSES = ("pending", "approved")
PAID_SUFFIX = " (paid online)"

_g = None  # server module globals, resolved live (same pattern as domains.shop.checkout)


def configure(*, server_globals) -> None:
    global _g
    _g = server_globals


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def ref_id_for(booking_ids: List[str]) -> str:
    """The line's id: the bookings it pays add-ons for. Sorted, so the same
    bookings always make the same id (and the same idempotency fingerprint)."""
    return PREFIX + ",".join(sorted({str(b) for b in booking_ids if b}))


def booking_ids_for(ref_id: str) -> List[str]:
    if not str(ref_id or "").startswith(PREFIX):
        return []
    return [b for b in str(ref_id)[len(PREFIX):].split(",") if b]


def _is_open(booking: dict) -> bool:
    return (booking.get("status") in OPEN_STATUSES) and not booking.get("checked_out_at")


def _addon_amount(addon: dict) -> float:
    if addon.get("line_total") is not None:
        return _money(addon.get("line_total"))
    return _money(float(addon.get("price") or 0) * int(addon.get("qty") or 1))


def unpaid_addons(booking: dict) -> List[dict]:
    """The add-ons on a booking that still cost something and are not paid."""
    return [a for a in (booking.get("add_ons") or []) if not a.get("paid_online") and _addon_amount(a) > 0]


def _paid_ref(order_id: str, item_id: str) -> str:
    return f"shop_order:{order_id}:item:{item_id}"


async def price_line(client_id: Optional[str], ref_id: str, quantity: int) -> dict:
    """What the line costs: the unpaid add-ons of the bookings it names.
    Returns {unit_price, name, plan}; the plan is frozen onto the order line
    so the payment later marks exactly what was priced."""
    db = _g["db"]
    if not client_id:
        raise HTTPException(status_code=403, detail="Please sign in to pay for add-ons.")
    if int(quantity) != 1:
        raise HTTPException(status_code=422, detail="Add-ons for a booking are paid once.")
    ids = booking_ids_for(ref_id)
    if not ids or len(ids) > MAX_BOOKINGS or ref_id != ref_id_for(ids):
        raise HTTPException(status_code=400, detail="Those add-ons can't be paid for online.")
    plan, total, dogs, names = [], 0.0, [], []
    for bid in ids:
        booking = await db.bookings.find_one({"id": bid}, {"_id": 0})
        if not booking or booking.get("client_id") != client_id:
            raise HTTPException(status_code=404, detail="That booking wasn't found on your account.")
        if not _is_open(booking):
            raise HTTPException(status_code=409, detail="That booking is closed, so its add-ons can't be paid for online.")
        for a in unpaid_addons(booking):
            amount = _addon_amount(a)
            plan.append({"booking_id": bid, "service_id": a.get("service_id"), "name": a.get("name") or "Add-on",
                         "amount": amount})
            total = round(total + amount, 2)
            names.append(a.get("name") or "Add-on")
        if booking.get("dog_name") and booking["dog_name"] not in dogs:
            dogs.append(booking["dog_name"])
    if total <= 0.005:
        raise HTTPException(status_code=409, detail="There are no unpaid add-ons on that booking.")
    who = " & ".join(dogs[:3]) or "your booking"
    label = ", ".join(dict.fromkeys(names))
    return {"unit_price": total, "name": f"Add-ons for {who}: {label}"[:140], "plan": plan}


async def _write_addons(booking: dict, addons: List[dict], estimate_delta: float = 0.0) -> bool:
    """Save a booking's add-ons only if nobody changed them since they were
    read (and the visit is still open). False = read again and retry.

    `estimate_delta` moves the booking's `estimated_price` in the same write.
    The estimate INCLUDES the add-ons booked with the visit, and checkout
    works out the visit's own price as "estimate minus those add-ons"
    (server._booking_estimate_addon_total_from). So when a booked add-on
    drops to $0 the estimate must drop by the same amount, or the visit's
    price would quietly swallow the add-on that was just paid for. An add-on
    added after booking was never in the estimate and moves nothing."""
    update = {"$set": {"add_ons": addons}}
    if abs(estimate_delta) > 0.004:
        update["$inc"] = {"estimated_price": round(estimate_delta, 2)}
    res = await _g["db"].bookings.update_one(
        {"id": booking["id"], "add_ons": booking.get("add_ons") or [], "status": {"$in": list(OPEN_STATUSES)},
         "checked_out_at": {"$in": [None, ""]}},
        update)
    return res.matched_count == 1


async def fulfill_line(order: dict, line: dict) -> None:
    """Mark the paid add-ons on their bookings: $0.00, "(paid online)", with
    what was paid kept beside them. Raises (→ the order needs attention) when
    a booking can no longer take it — cancelled, checked out, or the add-on
    gone — because then the money needs a person."""
    db = _g["db"]
    ref = _paid_ref(order["id"], line["item_id"])
    by_booking: dict = {}
    for entry in line.get("addon_plan") or []:
        by_booking.setdefault(entry["booking_id"], []).append(entry)
    if not by_booking:
        raise HTTPException(status_code=500, detail="This add-on payment has no bookings recorded on it.")
    problems = []
    for bid, entries in by_booking.items():
        for _attempt in range(4):
            booking = await db.bookings.find_one({"id": bid}, {"_id": 0})
            if not booking:
                problems.append("a booking it paid for no longer exists")
                break
            addons = [dict(a) for a in (booking.get("add_ons") or [])]
            already = sum(1 for a in addons if a.get("prepaid_ref") == ref)
            todo = entries[already:] if already < len(entries) else []
            if not todo:
                break  # this booking is done (a replay)
            if not _is_open(booking):
                state = "cancelled" if booking.get("status") in ("cancelled", "rejected") else "already checked out"
                problems.append(f"{booking.get('dog_name') or 'the dog'}'s booking on {booking.get('date')} was {state}")
                break
            missing, in_estimate = False, 0.0
            for entry in todo:
                target = next((a for a in addons if not a.get("paid_online") and a.get("service_id") == entry.get("service_id")
                               and abs(_addon_amount(a) - _money(entry.get("amount"))) < 0.005), None)
                if target is None:
                    missing = True
                    break
                if not target.get("added_after_booking"):
                    in_estimate = round(in_estimate + _addon_amount(target), 2)
                target.update({
                    "paid_online": True, "prepaid_ref": ref, "prepaid_order_id": order["id"],
                    "prepaid_amount": _addon_amount(target), "prepaid_price": target.get("price"),
                    "prepaid_line_total": target.get("line_total"), "prepaid_name": target.get("name"),
                    "name": f"{target.get('name') or 'Add-on'}{PAID_SUFFIX}", "price": 0.0, "line_total": 0.0,
                })
            if missing:
                problems.append(f"an add-on on {booking.get('dog_name') or 'the dog'}'s booking on {booking.get('date')} was changed or removed")
                break
            if await _write_addons(booking, addons, -in_estimate):
                break
        else:
            problems.append("a booking kept changing while the payment was being recorded")
    if problems:
        raise HTTPException(
            status_code=409,
            detail="Add-ons were paid online but could not be marked paid: " + "; ".join(problems) + ". Refund this line, or retry.")


async def _bookings_with(ref: str, line: dict) -> List[dict]:
    db = _g["db"]
    ids = list({e["booking_id"] for e in (line.get("addon_plan") or [])})
    rows = await db.bookings.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids) or 1)
    return [b for b in rows if any(a.get("prepaid_ref") == ref for a in (b.get("add_ons") or []))]


async def assert_refundable(order: dict, line: dict) -> None:
    """Before an in-app Shop refund: none of the visits may be checked out.
    Once a visit is finished its add-ons were given, and paid for."""
    ref = _paid_ref(order["id"], line["item_id"])
    for booking in await _bookings_with(ref, line):
        if booking.get("checked_out_at") or booking.get("status") == "completed":
            raise HTTPException(
                status_code=409,
                detail=(f"{booking.get('dog_name') or 'This dog'}'s visit on {booking.get('date')} is already checked out, "
                        "so its paid add-ons have been used. Automatic refund is blocked — use a refund on the visit instead."))


async def revoke_line(order: dict, line: dict, attempt_id: str) -> None:
    """After Stripe confirms the refund: put the add-ons' prices back on any
    booking that is still open (a cancelled one needs nothing), and mark the
    line refunded so a Retry Fulfillment never marks them paid again."""
    db = _g["db"]
    ref = _paid_ref(order["id"], line["item_id"])
    for found in await _bookings_with(ref, line):
        for _attempt in range(4):
            booking = await db.bookings.find_one({"id": found["id"]}, {"_id": 0})
            if not booking or not _is_open(booking):
                break
            addons, changed, back_in_estimate = [], False, 0.0
            for a in booking.get("add_ons") or []:
                a = dict(a)
                if a.get("prepaid_ref") == ref:
                    if not a.get("added_after_booking"):
                        back_in_estimate = round(back_in_estimate + _money(a.get("prepaid_amount")), 2)
                    a["name"] = a.pop("prepaid_name", None) or str(a.get("name") or "").replace(PAID_SUFFIX, "")
                    a["price"] = a.pop("prepaid_price", 0.0)
                    restored_total = a.pop("prepaid_line_total", None)
                    if restored_total is None:
                        a.pop("line_total", None)
                    else:
                        a["line_total"] = restored_total
                    for key in ("paid_online", "prepaid_ref", "prepaid_order_id", "prepaid_amount"):
                        a.pop(key, None)
                    a["online_payment_refunded"] = attempt_id
                    changed = True
                addons.append(a)
            if not changed or await _write_addons(booking, addons, back_in_estimate):
                break
    await db.shop_orders.update_one(
        {"id": order["id"], "lines.item_id": line.get("item_id")},
        {"$set": {"lines.$.fulfillment_status": "refunded"}})


def refuse_removal(addon: dict) -> None:
    """Taking a paid add-on off a booking would leave the client's money
    with nothing to show for it. The online payment is refunded first."""
    if (addon or {}).get("paid_online"):
        raise HTTPException(
            status_code=409,
            detail=(f"{addon.get('prepaid_name') or 'This add-on'} was paid for online. Refund that online order first "
                    "(Online Orders), then it can be removed."))


async def on_booking_closed(booking_id: str) -> None:
    """A booking was cancelled or declined. If add-ons on it were paid online
    the client is owed that money: put the order in front of a person."""
    db = _g["db"]
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "add_ons": 1, "dog_name": 1, "date": 1})
    paid = [a for a in ((booking or {}).get("add_ons") or []) if a.get("paid_online") and a.get("prepaid_order_id")]
    for order_id in {a["prepaid_order_id"] for a in paid}:
        amount = round(sum(_money(a.get("prepaid_amount")) for a in paid if a["prepaid_order_id"] == order_id), 2)
        reason = (f"{booking.get('dog_name') or 'The dog'}'s booking on {booking.get('date')} was cancelled, and "
                  f"${amount:.2f} of add-ons on it were paid online. Refund the add-ons on this order.")
        res = await db.shop_orders.update_one(
            {"id": order_id, "lines.kind": KIND},
            {"$set": {"fulfillment_status": "needs_attention", "lines.$.fulfillment_error": reason,
                      "updated_at": _g["now_iso"]()}})
        if res.matched_count:
            order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
            try:
                await _g["email_service"].queue_admin_shop_order_needs_attention(order)
            except Exception as exc:  # the flag is what matters; the email is a courtesy
                _g["logger"].warning("needs-attention email failed for order %s: %s", order_id, exc)
