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
ids were copied into this app's product config. Verified end-to-end
against the real connected account (shop/orders/shipping/products/uploads
endpoints all exercised for real).

Personalization (see create_personalized_product) is the one case that
submits the OTHER form: a brand-new one-off product, built from an
existing listing's own print_areas as a template. Printify's own
"variable text" layers (layerType="text" in a product's print_areas)
turned out NOT to be writable through the public product-creation API —
POST /products.json refuses a text layer's id with "Provided images do
not exist" regardless of what's sent, confirmed against the real account.
So personalized text is rendered to a flat PNG ourselves (Pillow) and
submitted as an ordinary uploaded image instead, which IS a documented,
working path (also confirmed live) — the one Printify mechanism that
could have avoided that rendering step turned out not to be usable from
outside Printify's own product editor.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

PRINTIFY_API_KEY = os.environ.get("PRINTIFY_API_KEY", "").strip()
PRINTIFY_SHOP_ID = os.environ.get("PRINTIFY_SHOP_ID", "").strip()
PRINTIFY_ENABLED = bool(PRINTIFY_API_KEY and PRINTIFY_SHOP_ID)
# A key with a stray non-ASCII character — a smart quote, a non-breaking
# space, or some other invisible character picked up from copy-pasting —
# passes the check above, but HTTP headers must be plain ASCII, so it then
# fails deep inside httpx's own header encoding with a bare
# UnicodeEncodeError on every single Printify call, with nothing in the
# message to say WHY. _headers() below checks this once, with an
# actionable message, instead.
PRINTIFY_API_KEY_ASCII_SAFE = PRINTIFY_API_KEY.isascii()
# Shared secret from the webhook's own subscription (see
# ensure_webhooks_registered) — every delivery is signed with it. Separate
# from PRINTIFY_API_KEY: this one never leaves the server, it only verifies
# what comes IN.
PRINTIFY_WEBHOOK_SECRET = os.environ.get("PRINTIFY_WEBHOOK_SECRET", "")
API_BASE = "https://api.printify.com/v1"
REQUEST_TIMEOUT_SECONDS = 20.0
# Order topics this app understands (https://developers.printify.com/#events).
# "order:created" and "order:sent-to-production" carry no data beyond the
# order id — still worth subscribing to so the admin screen shows SOME
# status before the first shipment, rather than nothing until it ships.
WEBHOOK_TOPICS = (
    "order:created", "order:updated", "order:sent-to-production",
    "order:shipment:created", "order:shipment:delivered",
)

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
    if not PRINTIFY_API_KEY_ASCII_SAFE:
        raise PrintifyNotConfigured(
            "PRINTIFY_API_KEY has a non-ASCII character in it (often a stray "
            "smart quote or invisible character from copy-pasting) — re-copy "
            "it fresh from the Printify dashboard, reset the env var, and "
            "restart the backend.")
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


async def get_product(printify_product_id: str) -> Dict[str, Any]:
    """Fetches one product's full definition (title, images, every variant
    with its own id/title/price/enabled flag) by Printify's own product id.
    Used by the admin "fetch sizes from Printify" picker (see server.py's
    /admin/printify/products/{id}) so a listing's real sizes/colors and
    their ids never have to be hand-copied one at a time out of the
    Printify dashboard — a real product can carry dozens of color/size
    combinations, and every one of them is a typo-prone id to transcribe
    by hand."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.get(f"/shops/{PRINTIFY_SHOP_ID}/products/{printify_product_id}.json", headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()


# Catalog shipping tables, keyed by (blueprint_id, print_provider_id) — see
# get_shipping_rates. This data is static per blueprint/provider combo (it
# describes a print method's shipping cost, not any particular order) and
# the catalog endpoints share a tighter 100-requests/minute limit than the
# rest of the API, so it's cached for the life of the process rather than
# refetched on every cart price or checkout.
_SHIPPING_RATES_CACHE: Dict[Tuple[int, int], Dict[str, Any]] = {}


async def get_shipping_rates(blueprint_id: int, print_provider_id: int) -> Dict[str, Any]:
    """Fetches one blueprint+print-provider's real shipping cost table:
    a handling_time plus a list of country-keyed "profiles", each a flat
    first-item cost and a separate per-additional-item cost, in cents.

    Printify has no live per-cart/per-order shipping-quote endpoint — this
    catalog table is the closest real number available, and it's the one
    estimate_shipping_cents() reads from. Verified against the real
    connected account: the same blueprint+provider can carry more than one
    profile for the very same country (e.g. $3.99 and $4.95 first-item
    costs both listed for US, covering the identical variant set) — these
    are alternate shipping tiers (standard vs. a faster one), not a
    variant partition, which is why estimate_shipping_cents() picks the
    CHEAPEST matching one: that's the "standard" tier create_order's own
    hardcoded shipping_method=1 actually submits against."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    key = (int(blueprint_id), int(print_provider_id))
    cached = _SHIPPING_RATES_CACHE.get(key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.get(f"/catalog/blueprints/{key[0]}/print_providers/{key[1]}/shipping.json", headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    data = resp.json()
    _SHIPPING_RATES_CACHE[key] = data
    return data


def estimate_shipping_cents(rates: Dict[str, Any], *, variant_id: Any, quantity: int, country: str) -> Optional[Dict[str, Any]]:
    """Given a get_shipping_rates() payload, the cost (in cents) to ship
    `quantity` of one variant to `country` — the cheapest profile that
    actually covers this variant, for this country, falling back to the
    REST_OF_THE_WORLD profile when the country has none of its own. A pure
    function (no network) so cart pricing can call it per line without
    awaiting anything beyond the one cached get_shipping_rates() call.
    Returns None when nothing covers this variant+country at all — the
    caller must treat that as "can't price this," never as free shipping."""
    vid = str(variant_id)
    profiles = rates.get("profiles") or []

    def _covers(p: Dict[str, Any], countries: List[str]) -> bool:
        return vid in {str(v) for v in (p.get("variant_ids") or [])} and bool(set(countries) & set(p.get("countries") or []))

    candidates = [p for p in profiles if _covers(p, [country])]
    if not candidates:
        candidates = [p for p in profiles if _covers(p, ["REST_OF_THE_WORLD"])]
    if not candidates:
        return None
    cheapest = min(candidates, key=lambda p: p["first_item"]["cost"])
    first_cost = cheapest["first_item"]["cost"]
    additional_cost = cheapest["additional_items"]["cost"]
    total_cents = first_cost + max(0, int(quantity) - 1) * additional_cost
    return {"cost_cents": total_cents, "currency": cheapest["first_item"].get("currency", "USD")}


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


async def _resolve_outbox_line(li: Dict[str, Any]) -> PrintifyLineItem:
    """One priced outbox line → the product_id/variant_id it actually
    submits against. A personalized line (li["personalization"] set)
    builds a fresh one-off product first (create_personalized_product) and
    submits against THAT instead of the template listing — every other
    line submits against its own stored printify_product_id/variant_id
    unchanged, exactly as before personalization existed."""
    if li.get("personalization"):
        product = await create_personalized_product(
            title=f"Personalized — {li['name']}"[:255],
            blueprint_id=li["printify_blueprint_id"], print_provider_id=li["printify_print_provider_id"],
            variant_id=li["printify_variant_id"],
            variant_price_cents=int(li.get("unit_price_cents") or 0),
            print_areas_template=li.get("printify_print_areas") or [],
            personalization=li["personalization"],
        )
        return PrintifyLineItem(str(product["id"]), str(product["variants"][0]["id"]), li["quantity"])
    return PrintifyLineItem(li["printify_product_id"], li["printify_variant_id"], li["quantity"])


async def process_outbox(db) -> Dict[str, int]:
    """Submits every due printify_order_outbox row to Printify. Runs every
    scheduler tick (see server.py's _scheduler_jobs) — a plain no-op return
    when Printify isn't configured yet, so it's always safe to register
    regardless of whether an admin has set it up. Each row's own
    (source, source_id) is where the order actually came from — a register
    sale or a paid Shop order — this function only reads the outbox queue,
    never those source collections directly."""
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

        missing = [li["name"] for li in row["line_items"] if not li.get("personalization") and (not li.get("printify_product_id") or not li.get("printify_variant_id"))]
        if missing:
            await _hold_outbox_row(db, row, f"Missing Printify product/variant mapping for: {', '.join(missing)}.")
            held += 1
            continue

        try:
            # Built INSIDE the try — a personalized line's one-off-product
            # creation is a real network call that can fail (a bad upload,
            # a Printify outage) exactly like create_order itself can, and
            # must back off/retry the same way rather than crashing the tick.
            line_items = [await _resolve_outbox_line(li) for li in row["line_items"]]
        except Exception as exc:
            await _hold_outbox_row(db, row, str(exc))
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


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """Printify signs every webhook delivery with `X-Pfy-Signature:
    sha256={hexdigest}`, an HMAC-SHA256 of the exact raw body using the
    secret given at subscription time (see ensure_webhooks_registered).
    Verified over the raw bytes as received — never a re-serialized/parsed
    body, same discipline as server.py's Stripe webhook — and fails closed:
    no secret configured, no header, or a bad prefix is never "verified"."""
    if not PRINTIFY_WEBHOOK_SECRET or not signature_header:
        return False
    prefix = "sha256="
    if not signature_header.startswith(prefix):
        return False
    expected = hmac.new(PRINTIFY_WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header[len(prefix):])


async def apply_webhook_event(db, event: dict) -> Optional[str]:
    """Applies one already-verified webhook event to the outbox row it's
    about, matched by Printify's own order id (`resource.id`) against the
    `printify_order_id` process_outbox stamped on submission. Returns the
    updated row's `id`, or None when nothing matches — an event about an
    order this app never queued (a different Printify sales channel, a
    replay after the row was deleted) is logged by the caller, not an
    error. Deliberately never touches `status`/`attempts`/
    `next_attempt_at` — those are process_outbox's own retry state machine;
    this only records the production/shipment facts the admin screen and a
    human want to see once an order has already been submitted."""
    topic = event.get("type") or ""
    if topic not in WEBHOOK_TOPICS:
        return None
    resource = event.get("resource") or {}
    printify_order_id = resource.get("id")
    if not printify_order_id:
        return None
    row = await db.printify_order_outbox.find_one({"printify_order_id": printify_order_id}, {"_id": 0, "id": 1})
    if not row:
        return None
    data = resource.get("data") or {}
    updates: Dict[str, Any] = {"updated_at": _now_iso()}
    if topic == "order:created":
        updates["printify_status"] = "created"
    elif topic == "order:updated":
        updates["printify_status"] = data.get("status")
    elif topic == "order:sent-to-production":
        updates["printify_status"] = "in-production"
    elif topic == "order:shipment:created":
        updates["printify_status"] = "shipped"
        updates["shipped_at"] = data.get("shipped_at")
        updates["tracking"] = data.get("carrier")
    elif topic == "order:shipment:delivered":
        updates["printify_status"] = "delivered"
        updates["delivered_at"] = data.get("delivered_at")
    await db.printify_order_outbox.update_one({"id": row["id"]}, {"$set": updates})
    return row["id"]


async def list_webhooks() -> List[Dict[str, Any]]:
    """Every webhook currently subscribed for this shop."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.get(f"/shops/{PRINTIFY_SHOP_ID}/webhooks.json", headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()


async def ensure_webhooks_registered(callback_url: str) -> Dict[str, Any]:
    """Idempotently subscribes `callback_url` to every topic in
    WEBHOOK_TOPICS — safe to call repeatedly (an admin-triggered action,
    never a scheduler job): skips a topic already pointed at this exact
    URL, only creates what's missing. Requires PRINTIFY_WEBHOOK_SECRET to
    already be set, so Printify is handed a real secret at subscription
    time rather than an unsigned (unverifiable) webhook."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    if not PRINTIFY_WEBHOOK_SECRET:
        raise PrintifyNotConfigured("PRINTIFY_WEBHOOK_SECRET is not set.")
    existing = await list_webhooks()
    have = {(w.get("topic"), w.get("url")) for w in existing}
    created, already = [], []
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        for topic in WEBHOOK_TOPICS:
            if (topic, callback_url) in have:
                already.append(topic)
                continue
            resp = await http.post(
                f"/shops/{PRINTIFY_SHOP_ID}/webhooks.json",
                json={"topic": topic, "url": callback_url, "secret": PRINTIFY_WEBHOOK_SECRET},
                headers=_headers(),
            )
            if resp.status_code >= 300:
                raise PrintifyApiError(resp.status_code, resp.text)
            created.append(topic)
    return {"created": created, "already_registered": already}


# ── Personalization — a flattened one-off product per order ────────────────
#
# See the module docstring for why this renders text itself rather than
# using Printify's own "variable text" layers: that API path was tried
# first against the real account and refused ("Provided images do not
# exist" for the text layer's own id, every time), while re-submitting a
# flattened PNG through the ordinary upload+image-placeholder path worked
# on the first attempt. This trades pixel-perfect font matching (Printify's
# own "Open Sans" vs. Pillow's bundled default font) for something that
# reliably ships.

def personalization_field_names(print_areas: List[Dict[str, Any]]) -> List[str]:
    """Every distinct variable-text layer name across a product's
    print_areas (e.g. ["Name", "Phone", "Address"]), in first-seen order —
    what the admin product editor offers to fetch, and what the register/
    Shop then ask a customer to fill in."""
    seen: List[str] = []
    for pa in print_areas or []:
        for ph in pa.get("placeholders") or []:
            for img in ph.get("images") or []:
                name = img.get("name")
                if img.get("layerType") == "text" and name and name not in seen:
                    seen.append(name)
    return seen


def render_personalization_image(text_layers: List[Dict[str, Any]], values: Dict[str, str]) -> bytes:
    """Flattens a placeholder's text layers (Printify's own position/size
    hints, Pillow's bundled scalable font — see module docstring) onto one
    PNG, each layer's own `input_text` placeholder replaced by the
    matching value from `values` (by layer `name`). Pure/no network —
    testable without Printify, and reused by both the register and the
    Shop checkout paths, which both only ever hand this real customer
    text, already validated non-blank upstream.

    Canvas size follows the layers' own declared width (every text layer
    on a real Printify personalizable product shares one — confirmed
    against the account this was built against), square, falling back to
    1000px for a product whose layers happen not to declare one."""
    from PIL import Image, ImageDraw, ImageFont
    import io as _io

    size = int(max((lyr.get("width") or 0) for lyr in text_layers) or 1000)
    im = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(im)
    for lyr in text_layers:
        name = lyr.get("name") or ""
        text = (values.get(name) or lyr.get("input_text") or "").strip()
        if not text:
            continue
        x = float(lyr.get("x", 0.5)) * size
        y = float(lyr.get("y", 0.5)) * size
        # Printify's own font_size is in the SAME pixel space as its width/
        # height hints, but the print area Printify actually maps this
        # flattened image onto (see _personalized_print_areas) turned out
        # to be LARGER than the canvas inferred from those hints — text
        # sized to merely fit the canvas still printed oversized and
        # clipped, confirmed against a real rendered mockup. 55% of the
        # canvas width, not ~92%, is the margin that actually held up.
        base_font_size = int(lyr.get("font_size") or 60)
        max_width = size * 0.55
        font_size = base_font_size
        font = ImageFont.load_default(size=max(10, font_size))
        while font_size > 10:
            bbox = draw.textbbox((0, 0), text, font=font)
            if (bbox[2] - bbox[0]) <= max_width:
                break
            font_size = int(font_size * 0.9)
            font = ImageFont.load_default(size=max(10, font_size))
        draw.text((x, y), text, fill=lyr.get("font_color") or "black", anchor="mm", font=font)
    buf = _io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


async def upload_image(file_name: str, contents_b64: str) -> Dict[str, Any]:
    """Uploads one image (base64-encoded contents) to this shop's Printify
    media library, returning its id/src — the id is what a print_areas
    placeholder references. Printify deduplicates by content, so uploading
    the same bytes twice is safe and cheap (confirmed against the real
    account: a second upload of identical bytes returns the SAME id)."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(
            "/uploads/images.json",
            json={"file_name": file_name, "contents": contents_b64},
            headers=_headers(),
        )
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()


async def _personalized_print_areas(print_areas: List[Dict[str, Any]], personalization: Dict[str, str]) -> List[Dict[str, Any]]:
    """Returns a deep copy of `print_areas` with every placeholder's text
    layers replaced by one flattened, freshly-uploaded image — everything
    else (a placeholder with no text layers, e.g. a fixed front logo) is
    carried through byte-for-byte."""
    import base64 as _b64
    import copy

    out = copy.deepcopy(print_areas or [])
    for pa in out:
        for ph in pa.get("placeholders") or []:
            images = ph.get("images") or []
            text_layers = [img for img in images if img.get("layerType") == "text"]
            if not text_layers:
                continue
            other_layers = [img for img in images if img.get("layerType") != "text"]
            png_bytes = render_personalization_image(text_layers, personalization)
            uploaded = await upload_image(
                f"personalized-{ph.get('position') or 'area'}.png", _b64.b64encode(png_bytes).decode(),
            )
            ph["images"] = other_layers + [{"id": uploaded["id"], "x": 0.5, "y": 0.5, "scale": 1, "angle": 0}]
    return out


async def create_personalized_product(
    *, title: str, blueprint_id: int, print_provider_id: int,
    variant_id: Any, variant_price_cents: int,
    print_areas_template: List[Dict[str, Any]], personalization: Dict[str, str],
) -> Dict[str, Any]:
    """Creates a brand-new, one-off Printify product for a single
    personalized order: the same blueprint/print-provider/variant as the
    listing a customer actually bought, but with its text layers flattened
    into a real image carrying THEIR text (see render_personalization_image
    and the module docstring for why). Returns the created product — its
    `id` and this one variant's `id` are what the order is actually
    submitted against, in place of the template listing's own ids.

    Left live in the account rather than deleted after ordering — a cheap,
    accurate record of exactly what was printed for this order, the same
    role a kept invoice/receipt plays everywhere else in this app."""
    if not PRINTIFY_ENABLED:
        raise PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    print_areas = await _personalized_print_areas(print_areas_template, personalization)
    body = {
        "title": title[:255],
        "description": "Personalized order — created automatically, one per sale.",
        "blueprint_id": blueprint_id,
        "print_provider_id": print_provider_id,
        "variants": [{"id": variant_id, "price": variant_price_cents, "is_enabled": True}],
        "print_areas": print_areas,
    }
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(f"/shops/{PRINTIFY_SHOP_ID}/products.json", json=body, headers=_headers())
    if resp.status_code >= 300:
        raise PrintifyApiError(resp.status_code, resp.text)
    return resp.json()
