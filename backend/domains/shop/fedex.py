"""FedEx rate quotes for self-fulfilled Shop shipping (owner request
2026-10-15, Shop gap-list item 5: "shipping for regular Shop products").
Printify's own fulfillment already ships its print-on-demand items; this
is for everything else in the catalog an admin has explicitly marked
Shippable — the business packs and ships it themselves, FedEx only
prices it. Creating an actual label/shipment is not part of this: that
stays a real-world task staff do through FedEx directly, same as today.

Same plain-env-var "optional integration" convention as
domains.printify.client and email_service.RESEND_API_KEY — nothing here
is ever asked of the owner through chat, since these are real account
credentials:

  FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET   OAuth client-credentials grant
  FEDEX_ACCOUNT_NUMBER                    the shipping account to rate against
  FEDEX_SHIP_FROM_STREET/_CITY/_STATE/_ZIP   the one origin address
  FEDEX_API_BASE                          https://apis.fedex.com (default) or
                                           https://apis-sandbox.fedex.com

FEDEX_ENABLED is False until every value above is set; see
domains.shop.shipping for what a cart does while it's off (pickup only,
never a fake/placeholder rate).

Field shapes below follow FedEx's published REST APIs (OAuth token at
POST /oauth/token, a rate quote at POST /rate/v1/rates/quotes) as
closely as this was written without a live FedEx account to verify
against — the owner has a shipping account but not yet API credentials.
Same caveat domains.printify.client already carries for the identical
reason: exercise this against FedEx's sandbox once real credentials
exist, before trusting it for a real charge.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

FEDEX_CLIENT_ID = os.environ.get("FEDEX_CLIENT_ID", "")
FEDEX_CLIENT_SECRET = os.environ.get("FEDEX_CLIENT_SECRET", "")
FEDEX_ACCOUNT_NUMBER = os.environ.get("FEDEX_ACCOUNT_NUMBER", "")
API_BASE = os.environ.get("FEDEX_API_BASE", "https://apis.fedex.com")
REQUEST_TIMEOUT_SECONDS = 15.0

# The business's own ship-from address — every rate quote needs an origin.
# Deliberately NOT a guessed default (see domains.printify.client's
# PRINTIFY_PICKUP_ADDRESS_ENV for the same reasoning): a wrong origin is a
# wrong rate quoted to a real customer.
FEDEX_SHIP_FROM_ENV = {
    "street": "FEDEX_SHIP_FROM_STREET",
    "city": "FEDEX_SHIP_FROM_CITY",
    "state": "FEDEX_SHIP_FROM_STATE",
    "zip": "FEDEX_SHIP_FROM_ZIP",
}


def ship_from() -> Optional[Dict[str, str]]:
    values = {field: os.environ.get(env_name, "").strip() for field, env_name in FEDEX_SHIP_FROM_ENV.items()}
    if not all(values.values()):
        return None
    return values


FEDEX_ENABLED = bool(FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET and FEDEX_ACCOUNT_NUMBER and ship_from())


class FedexNotConfigured(RuntimeError):
    """Raised when a rate quote is attempted before an admin has set every
    FEDEX_* environment variable this module needs."""


class FedexApiError(RuntimeError):
    """FedEx responded, but not with something this module can use — carries
    the status code and body so a caller can log or surface a reason."""

    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"FedEx API error {status_code}: {body[:500]}")


@dataclass
class ShipToAddress:
    street: str
    city: str
    state: str
    zip: str
    country: str = "US"


# In-process OAuth token cache — a burst of cart-pricing calls costs one
# token request, not one per quote. Not persisted anywhere: a restart just
# fetches a fresh one, same as any other in-memory cache in this app.
_token_cache: Dict[str, Any] = {"value": None, "expires_at": 0.0}


async def _access_token() -> str:
    now = time.monotonic()
    if _token_cache["value"] and now < _token_cache["expires_at"]:
        return _token_cache["value"]
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(
            "/oauth/token",
            data={"grant_type": "client_credentials", "client_id": FEDEX_CLIENT_ID, "client_secret": FEDEX_CLIENT_SECRET},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 300:
        raise FedexApiError(resp.status_code, resp.text)
    body = resp.json()
    token = body.get("access_token")
    if not token:
        raise FedexApiError(resp.status_code, "FedEx's token response did not include an access_token.")
    # A minute of slack so a token already in flight is never used right at
    # the edge of its own expiry.
    _token_cache["value"] = token
    _token_cache["expires_at"] = now + max(int(body.get("expires_in") or 0) - 60, 0)
    return token


@dataclass
class ShipmentLabel:
    tracking_number: str
    label_base64: str
    label_content_type: str


async def create_ground_label(*, ship_to: ShipToAddress, weight_lbs: float, reference: str = "") -> ShipmentLabel:
    """Creates a REAL FedEx Ground shipment (owner, 2026-10-18: "do the
    labels... in the app so i dont have to jump around sites") and returns
    its tracking number plus a printable label — the Ship API's
    counterpart to quote_ground_rate's rate-ONLY call above.

    Unlike a rate quote, this commits an actual shipment against the
    account on every call — there is no dry-run. Callers must persist the
    result and never call this twice for the same package; see
    domains.shop.shipping.create_label_for_order for the one caller and
    its idempotency check.

    Same sandbox caveat as quote_ground_rate: written against FedEx's
    documented Ship API (POST /ship/v1/shipments) shape without a live
    account to verify against — exercise this in FedEx's sandbox before
    ever trusting it to commit a real shipment.
    """
    if not FEDEX_ENABLED:
        raise FedexNotConfigured("FedEx shipping is not configured.")
    from_addr = ship_from()
    token = await _access_token()
    body = {
        "labelResponseOptions": "LABEL",
        "accountNumber": {"value": FEDEX_ACCOUNT_NUMBER},
        "requestedShipment": {
            "shipper": {"address": {
                "streetLines": [from_addr["street"]], "city": from_addr["city"],
                "stateOrProvinceCode": from_addr["state"], "postalCode": from_addr["zip"], "countryCode": "US",
            }},
            "recipients": [{"address": {
                "streetLines": [ship_to.street], "city": ship_to.city,
                "stateOrProvinceCode": ship_to.state, "postalCode": ship_to.zip, "countryCode": ship_to.country,
            }}],
            "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
            "serviceType": "FEDEX_GROUND",
            "packagingType": "YOUR_PACKAGING",
            "shippingChargesPayment": {"paymentType": "SENDER"},
            "labelSpecification": {"labelFormatType": "COMMON2D", "imageType": "PDF"},
            "requestedPackageLineItems": [{
                "weight": {"units": "LB", "value": round(float(weight_lbs), 2)},
                **({"customerReferences": [{"customerReferenceType": "CUSTOMER_REFERENCE", "value": reference}]} if reference else {}),
            }],
        },
    }
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(
            "/ship/v1/shipments", json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-locale": "en_US"},
        )
    if resp.status_code >= 300:
        raise FedexApiError(resp.status_code, resp.text)
    data = resp.json()
    shipments = (data.get("output") or {}).get("transactionShipments") or []
    pieces = shipments[0].get("pieceResponses") or [] if shipments else []
    tracking = ((pieces[0] or {}).get("trackingNumberInfo") or {}).get("trackingNumber") if pieces else None
    docs = (pieces[0] or {}).get("packageDocuments") or [] if pieces else []
    label_doc = docs[0] if docs else None
    label_b64 = (label_doc or {}).get("encodedLabel")
    if not tracking or not label_b64:
        raise FedexApiError(resp.status_code, "FedEx's ship response did not include a usable tracking number or label.")
    doc_type = (label_doc or {}).get("docType", "PDF")
    content_type = "application/pdf" if str(doc_type).upper() == "PDF" else "image/png"
    return ShipmentLabel(tracking_number=tracking, label_base64=label_b64, label_content_type=content_type)


async def quote_ground_rate(*, ship_to: ShipToAddress, weight_lbs: float) -> float:
    """Dollar cost to ship one package of `weight_lbs` to `ship_to` via
    FedEx Ground — the one service level this offers; a self-fulfilled
    Shop order isn't urgent enough to need a faster/costlier tier chosen
    per order. Raises FedexNotConfigured until every env var is set,
    FedexApiError on anything FedEx itself refuses or returns unusably."""
    if not FEDEX_ENABLED:
        raise FedexNotConfigured("FedEx shipping is not configured.")
    from_addr = ship_from()
    token = await _access_token()
    body = {
        "accountNumber": {"value": FEDEX_ACCOUNT_NUMBER},
        "requestedShipment": {
            "shipper": {"address": {
                "streetLines": [from_addr["street"]], "city": from_addr["city"],
                "stateOrProvinceCode": from_addr["state"], "postalCode": from_addr["zip"], "countryCode": "US",
            }},
            "recipient": {"address": {
                "streetLines": [ship_to.street], "city": ship_to.city,
                "stateOrProvinceCode": ship_to.state, "postalCode": ship_to.zip, "countryCode": ship_to.country,
            }},
            "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
            "serviceType": "FEDEX_GROUND",
            "rateRequestType": ["LIST"],
            "requestedPackageLineItems": [{"weight": {"units": "LB", "value": round(float(weight_lbs), 2)}}],
        },
    }
    async with httpx.AsyncClient(base_url=API_BASE, timeout=REQUEST_TIMEOUT_SECONDS) as http:
        resp = await http.post(
            "/rate/v1/rates/quotes", json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-locale": "en_US"},
        )
    if resp.status_code >= 300:
        raise FedexApiError(resp.status_code, resp.text)
    data = resp.json()
    details = (data.get("output") or {}).get("rateReplyDetails") or []
    rated = (details[0].get("ratedShipmentDetails") or [None])[0] if details else None
    amount = (rated or {}).get("totalNetCharge")
    if amount is None:
        raise FedexApiError(resp.status_code, "FedEx's rate response did not include a usable charge amount.")
    return round(float(amount), 2)
