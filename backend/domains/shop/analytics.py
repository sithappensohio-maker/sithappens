"""What the shop can honestly say about itself.

This is first-party and deliberately small. No third-party tracker, no
advertising identifiers, no fingerprinting, and nothing that follows anyone
off this site. Every event here exists to answer a question an owner
actually asks — what are people looking for, what can't they find, what gets
looked at and never bought — and an event that answers no such question is
not worth the row it costs.

Two rules shape the whole file.

**The browser does not decide revenue.** A browser may say "somebody started
a checkout". It may not say an order completed, and it certainly may not say
what it was worth. Money, units and orders are read from `shop_orders` where
`status == "paid"` — the same rows the accounting reads — so a forged POST
cannot move a single number on the dashboard. `order_completed` exists as an
event, but only the payment path may write one, and even then reporting does
not read it for money; it is there to join a browsing session to an order.

**Analytics stores ids, not content.** Never a gift recipient, never a dog's
name, never a client's name, never a note or a message, never payment data,
never a guest token, never an IP address as an identifier, never a full user
agent. A product is a ref_id. A person is a random session id, plus their
client_id when they are signed in and it is theirs.

Retention: raw events expire after 180 days (a TTL index). That is bounded
by construction, and it is safe because the numbers that must live forever —
revenue, orders, units — are derived from orders, which are never deleted.
Only the behavioural funnel is capped, and no report offers a window that
long anyway.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

# ── the event vocabulary ────────────────────────────────────────────────

# What a browser is allowed to report. Adding to this list should mean
# somebody asked a question it answers.
BROWSER_EVENTS = frozenset({
    "shop_view",              # somebody opened the shop
    "department_view",        # ...and went into a department
    "product_impression",     # a product was actually on screen
    "product_view",           # a product page was opened
    "search",                 # a search was run
    "search_zero_results",    # ...and found nothing
    "filter_used",
    "sort_used",
    "favorite_add",
    "favorite_remove",
    "add_to_cart",
    "remove_from_cart",
    "cart_view",
    "checkout_started",       # an attempt began — NOT that it succeeded
    "recommendation_impression",
    "recommendation_click",
    "buy_again",
    "shopify_outbound",       # they left for the Shopify listing
})

# What only the server may write. A browser posting one of these is refused,
# because these are the events that would otherwise let a stranger invent
# sales.
SERVER_EVENTS = frozenset({"order_completed", "checkout_completed"})

EVENTS = BROWSER_EVENTS | SERVER_EVENTS

ITEM_KINDS = frozenset({"product", "credit_pack", "training_program", "gift_card"})
DEPARTMENTS = frozenset({"gear", "training", "online_school", "prepaid", "gift_cards"})
DEVICES = frozenset({"mobile", "tablet", "desktop"})

# Caps. A batch is what one page can accumulate between flushes, not a
# firehose, and a query longer than this is not a search anybody typed.
MAX_BATCH = 40
MAX_QUERY = 120
MAX_ID = 128
RETENTION_DAYS = 180


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_query(raw: Any) -> str:
    """The form a search is REPORTED in.

    Trimmed, whitespace collapsed, lower-cased — so "  Rope   Leash " and
    "rope leash" are one row in the report instead of two. Deliberately
    nothing more: no stemming, no de-pluralising, no spelling correction.
    "leashes" and "leash" stay different, because the interesting report is
    what people actually typed, and a normaliser that guesses at meaning
    destroys the signal the zero-results report exists to find.
    """
    if not isinstance(raw, str):
        return ""
    return re.sub(r"\s+", " ", raw).strip().lower()[:MAX_QUERY]


def device_class(width: Any) -> Optional[str]:
    """Phone, tablet or desktop, from the viewport width the page reports.

    The width, not the user agent: it is the thing that actually decides
    what the layout did, it is one number rather than a fingerprintable
    string, and it cannot identify anybody.
    """
    try:
        w = int(width)
    except (TypeError, ValueError):
        return None
    if w <= 0:
        return None
    if w < 768:
        return "mobile"
    if w < 1024:
        return "tablet"
    return "desktop"


def _clean_id(value: Any, limit: int = MAX_ID) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] or None


def session_id_from(raw: Any) -> str:
    """A shopping session, as an opaque first-party id.

    Whatever the browser sends is HASHED rather than stored, so even a
    browser that tried to put something meaningful in this field — an email,
    a name — stores an unusable digest instead. The id correlates one visit's
    events and nothing else: it is not an account, it is not shared between
    devices, and it is never used to build a profile.
    """
    raw = _clean_id(raw) or uuid.uuid4().hex
    return hashlib.sha256(("shopsess:" + raw).encode()).hexdigest()[:32]


def build_event(
    payload: Dict[str, Any], *, client_id: Optional[str], session: str,
    device: Optional[str], now: Optional[datetime] = None,
    business_date, allow_server_events: bool = False,
) -> Dict[str, Any]:
    """One validated event row, built from an allowlist.

    Nothing is copied through from the payload. Every field below is named,
    and a field that is not named here does not reach the database — which
    is what makes "analytics never stores a recipient's name" a property of
    the code rather than of everybody remembering.
    """
    name = payload.get("event")
    if name not in EVENTS:
        raise HTTPException(status_code=422, detail="Unknown shop event.")
    if name in SERVER_EVENTS and not allow_server_events:
        # The whole revenue-integrity rule, in one line: a browser cannot
        # declare that an order completed.
        raise HTTPException(status_code=403, detail="That event is recorded by the server.")

    at = now or _now()
    row: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "event": name,
        "at": at.isoformat(),
        # The business date, from the app's own helper — so a 9pm Eastern
        # event lands on the day it happened rather than tomorrow in UTC.
        "day": business_date,
        "session_id": session,
        "client_id": client_id,
        "is_guest": client_id is None,
        "device": device,
        # Raw events are bounded by construction. See the module docstring
        # for why this is safe: money lives on orders, not here.
        "expires_at": at + timedelta(days=RETENTION_DAYS),
    }

    kind = _clean_id(payload.get("kind"), 40)
    if kind in ITEM_KINDS:
        row["kind"] = kind
    ref_id = _clean_id(payload.get("ref_id"))
    if ref_id:
        row["ref_id"] = ref_id
    department = _clean_id(payload.get("department"), 40)
    if department in DEPARTMENTS:
        row["department"] = department

    if name in ("search", "search_zero_results"):
        query = normalize_query(payload.get("query"))
        if not query:
            raise HTTPException(status_code=422, detail="A search event needs a query.")
        row["query"] = query

    count = payload.get("result_count")
    if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 100000:
        row["result_count"] = count

    quantity = payload.get("quantity")
    if isinstance(quantity, int) and not isinstance(quantity, bool) and 1 <= quantity <= 999:
        row["quantity"] = quantity

    rec_source = _clean_id(payload.get("rec_source"), 40)
    if rec_source in ("complements", "related", "alternate", "same_department", "recently_viewed"):
        row["rec_source"] = rec_source

    # Campaign attribution, only from the safe, already-public bits of a URL
    # and only as short opaque labels. Never the full referring URL, which
    # can carry somebody else's query string.
    source = _clean_id(payload.get("source"), 60)
    if source:
        row["source"] = re.sub(r"[^a-zA-Z0-9_\-. ]", "", source)[:60] or None

    order_id = _clean_id(payload.get("order_id"))
    if order_id:
        row["order_id"] = order_id

    # The idempotency handle. Present, it makes the write a no-op the second
    # time — which is how "one checkout_started per attempt" and "one
    # order_completed per order" survive retries and replays.
    dedupe = _clean_id(payload.get("dedupe_key"), 160)
    if dedupe:
        row["dedupe_key"] = f"{name}:{session}:{dedupe}" if name in BROWSER_EVENTS else f"{name}:{dedupe}"
    return row


async def record_many(db, rows: List[Dict[str, Any]]) -> int:
    """Write validated events, tolerating duplicates.

    A duplicate is the normal case, not an error: it is a retry, a replayed
    webhook, or a page that flushed the same batch twice. Inserting
    unordered means one duplicate never stops the other events in the batch
    from landing.
    """
    if not rows:
        return 0
    try:
        result = await db.shop_events.insert_many(rows, ordered=False)
        return len(result.inserted_ids)
    except Exception as exc:
        written = getattr(getattr(exc, "details", None), "get", lambda _k, _d=None: None)("nInserted", None)
        if written is None:
            written = (getattr(exc, "details", {}) or {}).get("nInserted", 0)
        # Anything that is not a duplicate-key pile-up is a real problem, but
        # it is still not worth failing a customer's page over.
        return int(written or 0)


async def record_order_completed(db, order: dict, *, business_date: str) -> None:
    """The one server-written event, from the one place an order becomes paid.

    Idempotent on the order id, so a replayed webhook, a manual
    reconciliation and a retried fulfilment all leave exactly one row.

    Note what this is NOT for: revenue. The dashboard reads `shop_orders`
    for money, so if this write fails the reports are still correct. It
    exists only so a completed order can be joined back to the session that
    browsed for it.
    """
    session = _clean_id((order or {}).get("analytics_session_id")) or "unknown"
    row = build_event(
        {"event": "order_completed", "order_id": order.get("id"),
         "dedupe_key": order.get("id")},
        client_id=order.get("client_id"), session=session_id_from(session),
        device=None, business_date=business_date, allow_server_events=True,
    )
    row["is_guest"] = bool(order.get("is_guest_order"))
    await record_many(db, [row])
