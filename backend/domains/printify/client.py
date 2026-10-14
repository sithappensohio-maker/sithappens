"""Printify REST API client — submits paid orders for production.

Same plain-env-var convention as every other external integration in this
codebase (see email_service.RESEND_API_KEY, server.py's STRIPE_SECRET_KEY):
PRINTIFY_API_KEY / PRINTIFY_SHOP_ID are read once at import, and every call
checks PRINTIFY_ENABLED first and raises a clear, catchable error rather
than crashing when they're unset — Printify stays entirely optional until
an admin actually sets up an account.

The Printify "shop" here is a plain API sales channel created once in the
Printify dashboard for this app — never the business's Shopify store. Money
and order details are taken by Sit Happens itself (register or client
Shop); Printify only ever receives an already-paid order to produce and
ship. There is no Shopify involvement in this module at all.

Field shapes below follow Printify's documented Create an Order endpoint
(https://developers.printify.com/#create-a-new-order), the "existing
product" line-item form (product_id + variant_id) — the form used when the
product was already created in the Printify dashboard and its id/variant
ids were copied into this app's product config, not the print-area/
blueprint form used to create a brand-new Printify product from this call.
This has not been exercised against a live Printify account; verify field
names against the current API reference once PRINTIFY_API_KEY is set.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

PRINTIFY_API_KEY = os.environ.get("PRINTIFY_API_KEY", "")
PRINTIFY_SHOP_ID = os.environ.get("PRINTIFY_SHOP_ID", "")
PRINTIFY_ENABLED = bool(PRINTIFY_API_KEY and PRINTIFY_SHOP_ID)
API_BASE = "https://api.printify.com/v1"
REQUEST_TIMEOUT_SECONDS = 20.0

# The business's own ship-to address, for a "pickup" order — Printify always
# ships somewhere; pickup just means "to us," not "nowhere." Configured once
# via plain env vars alongside PRINTIFY_API_KEY, same convention as
# everything else here — deliberately NOT a guessed default (a wrong or
# blank address is a real package sent to a real wrong place), so a row
# needing this before it's set just holds for retry (see process_outbox).
PRINTIFY_PICKUP_ADDRESS_ENV = {
    "first_name": "PRINTIFY_PICKUP_FIRST_NAME",
    "last_name": "PRINTIFY_PICKUP_LAST_NAME",
    "email": "PRINTIFY_PICKUP_EMAIL",
    "phone": "PRINTIFY_PICKUP_PHONE",
    "address1": "PRINTIFY_PICKUP_ADDRESS1",
    "address2": "PRINTIFY_PICKUP_ADDRESS2",
    "city": "PRINTIFY_PICKUP_CITY",
    "region": "PRINTIFY_PICKUP_REGION",
    "zip": "PRINTIFY_PICKUP_ZIP",
}
OUTBOX_BATCH_LIMIT = 20
# ~ 14 hours of backoff (5 + 10 + 20 + 40 + 80 + 160 + 320 + 360 min) before a
# row is surfaced as needing a human rather than retried again automatically.
OUTBOX_MAX_ATTEMPTS = 8


class PrintifyNotConfigured(RuntimeError):
    """Raised when a Printify call is attempted before an admin has set
    PRINTIFY_API_KEY and PRINTIFY_SHOP_ID in the backend environment."""


class PrintifyApiError(RuntimeError):
    """Printify responded, but not with success — carries its status code
    and body so a caller can log, retry, or surface a useful message."""

    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"Printify API error {status_code}: {body[:500]}")


@dataclass
class PrintifyLineItem:
    product_id: str
    variant_id: str
    quantity: int


@dataclass
class PrintifyAddress:
    first_name: str
    last_name: str
    email: str
    phone: str
    country: str
    region: str
    address1: str
    city: str
    zip: str
    address2: str = ""


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {PRINTIFY_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "SitHappens/1.0",
    }


async def create_order(
    *,
    external_id: str,
    line_items: List[PrintifyLineItem],
    address_to: PrintifyAddress,
    send_shipping_notification: bool = True,
) -> Dict[str, Any]:
    """Submits one already-paid order to Printify for production/shipping.

    `external_id` is OUR order/sale id, round-tripped on Printify's side —
    use it to recognize this order again in a webhook event rather than
    relying only on Printify's own id. `send_shipping_notification` should
    be True when `address_to` is the real customer (Printify emails them
    its own tracking confirmation directly) and False when `address_to` is
    the business's own address for in-store pickup — the customer must
    never get an email about a shipment to the wrong place."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    body = {
        "external_id": external_id,
        "line_items": [
            {"product_id": li.product_id, "variant_id": li.variant_id, "quantity": li.quantity}
            for li in line_items
        ],
        "shipping_method": 1,  # standard — Printify's default/cheapest tier
        "send_shipping_notification": send_shipping_notification,
        "address_to": {
            "first_name": address_to.first_name,
            "last_name": address_to.last_name,
            "email": address_to.email,
            "phone": address_to.phone,
            "country": address_to.country,
            "region": address_to.region,
            "address1": address_to.address1,
            "address2": address_to.address2,
            "city": address_to.city,
            "zip": address_to.zip,
        },
    }
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(f"/shops/{PRINTIFY_SHOP_ID}/orders.json", json=body, headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()


async def get_order(printify_order_id: str) -> Dict[str, Any]:
    """Fetches one order's current status by Printify's own order id — for
    a reconciliation sweep that catches a missed webhook, the same shape as
    domains/shop/abandon.py's sweep() for stale Stripe payment attempts."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.get(f"/shops/{PRINTIFY_SHOP_ID}/orders/{printify_order_id}.json", headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def pickup_address() -> Optional[PrintifyAddress]:
    """The configured business address, or None when any required field is
    missing — see PRINTIFY_PICKUP_ADDRESS_ENV above for why this never
    guesses a default."""
    values = {field: os.environ.get(env_name, "").strip() for field, env_name in PRINTIFY_PICKUP_ADDRESS_ENV.items()}
    required = ("first_name", "last_name", "address1", "city", "region", "zip")
    if not all(values.get(f) for f in required):
        return None
    return PrintifyAddress(country="US", **values)


async def _hold_outbox_row(db, row: dict, error: str) -> None:
    """Records a failed submission attempt with exponential backoff — same
    shape as email_service.process_email_outbox's retry formula. A row that
    has exhausted OUTBOX_MAX_ATTEMPTS is marked "stuck" instead of
    "pending" so it stops being retried blindly and is visible as needing a
    human look (mirrors domains/shop/abandon.py's stuck-row surfacing)."""
    attempts = int(row.get("attempts") or 0) + 1
    delay_minutes = min(360, 5 * (2 ** min(attempts - 1, 6)))
    next_attempt_at = (datetime.now(timezone.utc) + timedelta(minutes=delay_minutes)).isoformat()
    await db.printify_order_outbox.update_one(
        {"id": row["id"]},
        {"$set": {
            "attempts": attempts, "last_error": error[:500], "next_attempt_at": next_attempt_at,
            "status": "stuck" if attempts >= OUTBOX_MAX_ATTEMPTS else "pending",
            "updated_at": _now_iso(),
        }},
    )


async def process_outbox(db) -> Dict[str, int]:
    """Submits every due printify_order_outbox row to Printify. Runs every
    scheduler tick (see server.py's _scheduler_jobs) — a plain no-op return
    when Printify isn't configured yet, so it's always safe to register
    regardless of whether an admin has set it up. Each row's own
    (source, source_id) is where the order actually came from — a register
    sale ("pos_sale"); Printify items are register-only, online ordering
    stays entirely on Shopify — this function only reads the outbox queue,
    never that source collection directly."""
    if not PRINTIFY_ENABLED:
        return {"skipped": 1, "submitted": 0, "held": 0, "checked": 0}
    now = _now_iso()
    rows = await db.printify_order_outbox.find(
        {"status": "pending", "next_attempt_at": {"$lte": now}}, {"_id": 0},
    ).sort("created_at", 1).limit(OUTBOX_BATCH_LIMIT).to_list(length=OUTBOX_BATCH_LIMIT)

    submitted = held = 0
    for row in rows:
        if row["fulfillment_method"] == "ship":
            address = PrintifyAddress(**row["shipping_address"])
        else:
            address = pickup_address()
            if address is None:
                await _hold_outbox_row(db, row, "Pickup address isn't configured — set PRINTIFY_PICKUP_* env vars to ship this to the business.")
                held += 1
                continue

        line_items = [
            PrintifyLineItem(li["printify_product_id"], li["printify_variant_id"], li["quantity"])
            for li in row["line_items"]
        ]
        missing = [li["name"] for li, pli in zip(row["line_items"], line_items) if not pli.product_id or not pli.variant_id]
        if missing:
            await _hold_outbox_row(db, row, f"Missing Printify product/variant mapping for: {', '.join(missing)}.")
            held += 1
            continue

        try:
            result = await create_order(
                external_id=row["source_id"], line_items=line_items, address_to=address,
                send_shipping_notification=(row["fulfillment_method"] == "ship"),
            )
        except Exception as exc:
            await _hold_outbox_row(db, row, str(exc))
            held += 1
            continue

        await db.printify_order_outbox.update_one(
            {"id": row["id"]},
            {"$set": {"status": "submitted", "printify_order_id": result.get("id"), "updated_at": _now_iso()}},
        )
        submitted += 1

    return {"skipped": 0, "submitted": submitted, "held": held, "checked": len(rows)}
