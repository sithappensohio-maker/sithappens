"""Telling a Shop customer their order is ready for pickup (audit: "Pickup
customers aren't told their order is ready").

Staff move a paid order with physical items through preparing →
ready_for_pickup → picked_up (server.py update_shop_order_fulfillment). The
customer's page promised "we'll let you know" and nothing ever did. Now the
one request that wins the move to ready_for_pickup emails the customer
once — through the normal email system, so Quiet Hours hold it rather than
drop it — and tells staff what happened to the email.

Never sent for an order fully refunded, or whose physical items were all
refunded (nothing left to collect). A guest is emailed at the address they
checked out with; a client at their current address on file.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

import email_service

logger = logging.getLogger(__name__)


def ready_key(order_id: str) -> str:
    return f"shop_order_ready:{order_id}"


def collectable_lines(order: dict) -> List[dict]:
    """The physical items still to hand over: product lines with something
    left after refunds (gift cards, packs and programs are never collected)."""
    out = []
    for line in order.get("lines") or []:
        if (line or {}).get("kind") != "product":
            continue
        left = int(line.get("quantity") or 0) - int(line.get("quantity_refunded") or 0)
        if left > 0:
            out.append({"name": line.get("name") or "Item", "quantity": left})
    return out


async def recipient(db, order: dict) -> Tuple[str, str]:
    """(email, name). A client's current address on file wins over the one
    copied onto the order; a guest only ever has the order's own."""
    email = (order.get("client_email") or "").strip()
    name = order.get("client_name") or ""
    if order.get("client_id"):
        client = await db.clients.find_one({"id": order["client_id"]}, {"_id": 0, "email": 1, "name": 1})
        if client:
            email = (client.get("email") or "").strip() or email
            name = client.get("name") or name
    return email, name


async def email_ready(db, order: dict, *, settings: dict, default_settings) -> Dict[str, Any]:
    """Email the customer that `order` is ready; never raises. Returns what
    happened, for the staff toast: {"state": sent|queued|failed|no_email|skipped, ...}."""
    try:
        if order.get("refund_status") == "full":
            return {"state": "skipped", "reason": "refunded"}
        lines = collectable_lines(order)
        if not lines:
            return {"state": "skipped", "reason": "nothing_to_collect"}
        to, name = await recipient(db, order)
        if not to:
            return {"state": "no_email"}
        from domains.public_site.routes import _public_site_info
        site = _public_site_info(settings or {}, default_settings)
        sent = await email_service.send_shop_order_ready(
            to, order, client_name=name, lines=lines, site=site, is_guest=not order.get("client_id"))
        if sent:
            return {"state": "sent", "to": to}
        held = await db.email_outbox.find_one({"key": ready_key(order.get("id")), "status": "pending"},
                                              {"_id": 0, "last_error": 1})
        if held:
            quiet = "quiet hours" in (held.get("last_error") or "").lower()
            return {"state": "queued", "to": to, "reason": "quiet_hours" if quiet else "retrying"}
        return {"state": "failed", "to": to}
    except Exception as exc:   # the order is ready either way
        logger.warning("Pickup-ready email for order %s not sent: %s", order.get("id"), exc)
        return {"state": "failed"}


async def still_wanted(db, order_id: str) -> bool:
    """A held ready email is sent only while the order is still waiting to be
    collected: still there, not picked up, not fully refunded, and with
    something left to collect (a refund of just the physical items leaves an
    order "partly refunded" but with nothing to pick up)."""
    order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0, "pickup_status": 1, "refund_status": 1, "lines": 1})
    return (bool(order) and order.get("pickup_status") == "ready_for_pickup"
            and order.get("refund_status") != "full" and bool(collectable_lines(order)))
