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
from typing import Any, Dict, List

import httpx

PRINTIFY_API_KEY = os.environ.get("PRINTIFY_API_KEY", "")
PRINTIFY_SHOP_ID = os.environ.get("PRINTIFY_SHOP_ID", "")
PRINTIFY_ENABLED = bool(PRINTIFY_API_KEY and PRINTIFY_SHOP_ID)
API_BASE = "https://api.printify.com/v1"
REQUEST_TIMEOUT_SECONDS = 20.0


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
