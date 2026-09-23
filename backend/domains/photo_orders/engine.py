"""Photo orders — one photo-package sales engine for anything that sells photos.

An "owner" is whatever the photos were taken at: a public event (Trunk or
Treat) or a Photo Special (Howl-O-Ween, Christmas, ...). Every owner carries
its own editable price list (`photo_packages`) and gets the same routes under
its own admin path:

    GET    <base>/{owner_id}/photo-orders/summary
    GET    <base>/{owner_id}/photo-orders
    POST   <base>/{owner_id}/photo-orders
    GET    <base>/{owner_id}/photo-orders/{oid}
    PATCH  <base>/{owner_id}/photo-orders/{oid}
    DELETE <base>/{owner_id}/photo-orders/{oid}
    POST   <base>/{owner_id}/photo-orders/{oid}/preview
    POST   <base>/{owner_id}/photo-orders/{oid}/checkout
    POST   <base>/{owner_id}/photo-orders/{oid}/send
    GET    <base>/{owner_id}/photo-orders.csv

Money never goes around the register: each package sells through one hidden
`pos_products` row, and checkout calls the canonical POS sale, so receipts,
drawer, sales tax and the P&L treat a photo package exactly like merchandise.
Nothing is handed over on the spot; an order is a delivery promise that ends
with a download link emailed to the customer (and a framed print, if bought).

The next photo event is new configuration, never a new build.
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

import email_service

PHOTO_ORDER_STATUSES = ("ordered", "paid", "ready", "sent")
PRINT_STATUSES = ("none", "pending", "ready", "picked_up", "mailed")
PREFIX_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,11}$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def _clean(value: Optional[str], limit: int) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()[:limit]


def _search_re(term: str) -> Dict[str, str]:
    return {"$regex": re.escape(term), "$options": "i"}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40] or "package"


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------
class PhotoPackageIn(BaseModel):
    key: Optional[str] = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(ge=0, le=10000)
    digitals: int = Field(default=0, ge=0, le=50)
    print: str = Field(default="", max_length=20)
    popular: bool = False


class PhotoOrderIn(BaseModel):
    # What the order is linked to, if anything: an event registration or a
    # Photo Special reservation (booking). A walk-up has neither.
    registration_id: Optional[str] = Field(default=None, max_length=80)
    booking_id: Optional[str] = Field(default=None, max_length=80)
    client_id: Optional[str] = Field(default=None, max_length=80)
    primary_contact: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(default="", max_length=40)
    dogs: List[str] = Field(default_factory=list, max_length=10)
    contestant_numbers: List[int] = Field(default_factory=list, max_length=10)
    shot_ref: str = Field(default="", max_length=120)
    package_key: str = Field(min_length=1, max_length=40)
    qty: int = Field(default=1, ge=1, le=10)
    notes: str = Field(default="", max_length=500)


class PhotoOrderPatchIn(BaseModel):
    primary_contact: Optional[str] = Field(default=None, min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    dogs: Optional[List[str]] = Field(default=None, max_length=10)
    shot_ref: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)
    status: Optional[Literal["paid", "ready"]] = None  # ready ⇄ paid only; "sent" comes from /send, "paid" from /checkout
    print_status: Optional[Literal["none", "pending", "ready", "picked_up", "mailed"]] = None
    delivery_link: Optional[str] = Field(default=None, max_length=2000)


class PhotoTenderIn(BaseModel):
    method: Literal["cash", "card", "check", "venmo", "paypal", "other"]
    amount: float = Field(gt=0)
    tendered_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class PhotoCheckoutIn(BaseModel):
    tenders: List[PhotoTenderIn] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    workstation_id: Optional[str] = Field(default=None, max_length=100)


class PhotoSendIn(BaseModel):
    delivery_link: str = Field(min_length=8, max_length=2000)
    message: str = Field(default="", max_length=500)


# ---------------------------------------------------------------------------
# Package list
# ---------------------------------------------------------------------------
def normalize_packages(packages: List[PhotoPackageIn], existing: Optional[List[dict]]) -> List[dict]:
    """The owner's price list as saved from an editor. The hidden register
    product each package already sells through survives an edit (matched by
    key), so renaming or repricing a package never orphans its sales."""
    old = {pk.get("key"): pk for pk in (existing or [])}
    seen: set = set()
    out = []
    for pk in packages:
        key = (pk.key or _slugify(pk.name)).strip().lower()[:40] or _slugify(pk.name)
        if key in seen:
            raise HTTPException(status_code=422, detail=f"Two photo packages share the key '{key}'.")
        seen.add(key)
        out.append({"key": key, "name": _clean(pk.name, 80), "price": round(float(pk.price), 2), "digitals": int(pk.digitals),
                    "print": _clean(pk.print, 20), "popular": bool(pk.popular), "product_id": (old.get(key) or {}).get("product_id")})
    return out


def clean_order_prefix(value: Optional[str], default: str) -> str:
    prefix = (value or "").strip().upper() or default
    if not PREFIX_RE.match(prefix):
        raise HTTPException(status_code=422, detail="Order number prefix: 2 to 12 capital letters, numbers or dashes.")
    return prefix


def public_packages(owner: dict) -> List[dict]:
    """The price list as a customer may see it — no internal ids."""
    return [{"name": pk.get("name"), "price": pk.get("price"), "digitals": int(pk.get("digitals") or 0),
             "print": pk.get("print") or "", "popular": bool(pk.get("popular"))}
            for pk in owner.get("photo_packages") or []]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
LinkResolver = Callable[[dict, PhotoOrderIn], Awaitable[Dict[str, Any]]]


def register_photo_order_routes(
    *, api, db, logger, manage, base: str,
    load_owner: Callable[[str], Awaitable[dict]],
    owners_collection: str, orders_collection: str, owner_field: str, product_tag: str,
    order_prefix: Callable[[dict], str], resolve_link: LinkResolver, csv_link_columns: List[tuple],
    create_pos_sale=None, price_pos_cart=None, require_take_payments=None,
    pos_sale_model=None, pos_line_model=None, pos_tender_model=None,
) -> Dict[str, Any]:
    """Register the photo-order routes for one kind of owner.

    `resolve_link(owner, body)` validates whatever the order is linked to and
    returns the extra fields to store on the order (always including
    `client_id`). `csv_link_columns` is `[(header, order_field), ...]` for
    those fields in the export."""
    owners = db[owners_collection]
    orders = db[orders_collection]
    path = f"{base}/{{owner_id}}/photo-orders"

    async def _next_seq(owner_id: str) -> int:
        row = await db.event_counters.find_one_and_update(
            {"_id": f"{owner_id}:photo"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        return int(row["seq"])

    async def _product_for(owner: dict, pkg: dict) -> str:
        """The hidden register product a package sells through. Created on
        first use and kept in step with the package's name and price."""
        title = owner.get("photos_title") or owner.get("name") or "Event photos"
        name = f"{title} — {pkg['name']}"
        pid = pkg.get("product_id")
        prod = await db.pos_products.find_one({"id": pid}, {"_id": 0, "id": 1}) if pid else None
        fields = {"name": name, "price": float(pkg["price"]), "category": "Event photos", "taxable": True,
                  "description": f"{owner.get('name') or 'Event'} photo package", "active": True, "track_inventory": False,
                  "show_online": False, "show_at_register": False, "sales_destination": "internal",
                  product_tag: {owner_field: owner["id"], "key": pkg["key"]}, "updated_at": _now_iso()}
        if prod:
            await db.pos_products.update_one({"id": pid}, {"$set": fields})
            return pid
        pid = str(uuid.uuid4())
        await db.pos_products.insert_one({"id": pid, "sku": None, "cost": None, "low_stock_threshold": None, "stock_on_hand": 0,
                                          "created_at": _now_iso(), **fields})
        await owners.update_one({"id": owner["id"], "photo_packages.key": pkg["key"]}, {"$set": {"photo_packages.$.product_id": pid}})
        return pid

    def _order_row(o: dict) -> dict:
        o = {k: v for k, v in o.items() if k != "_id"}
        o["list_total"] = round(float(o.get("package_price") or 0) * int(o.get("qty") or 1), 2)
        o["print"] = (o.get("package") or {}).get("print") or ""
        o["digitals"] = int((o.get("package") or {}).get("digitals") or 0)
        return o

    async def _summary(owner_id: str) -> dict:
        rows = await orders.find({owner_field: owner_id}, {"_id": 0, "status": 1, "total": 1, "package": 1, "print_status": 1}).to_list(5000)
        paid = [r for r in rows if r.get("status") in ("paid", "ready", "sent")]
        return {
            "orders": len(rows),
            "revenue": round(sum(float(r.get("total") or 0) for r in paid), 2),
            "unpaid": sum(1 for r in rows if r.get("status") == "ordered"),
            "to_send": sum(1 for r in rows if r.get("status") in ("paid", "ready") and int((r.get("package") or {}).get("digitals") or 0) > 0),
            "sent": sum(1 for r in rows if r.get("status") == "sent"),
            "prints_pending": sum(1 for r in rows if (r.get("package") or {}).get("print") and r.get("status") != "ordered" and (r.get("print_status") or "pending") in ("pending", "ready")),
        }

    async def _order(owner_id: str, oid: str) -> dict:
        o = await orders.find_one({owner_field: owner_id, "id": oid}, {"_id": 0})
        if not o:
            raise HTTPException(status_code=404, detail="Photo order not found")
        return o

    async def _view(owner_id: str, oid: str) -> dict:
        return {"order": _order_row(await _order(owner_id, oid)), "summary": await _summary(owner_id)}

    @api.get(f"{path}/summary")
    async def photo_orders_summary(owner_id: str, user: dict = Depends(manage)):
        await load_owner(owner_id)
        return await _summary(owner_id)

    @api.get(path)
    async def photo_orders_list(owner_id: str, q: str = Query(default=""), status: str = Query(default="all"),
                                user: dict = Depends(manage)):
        await load_owner(owner_id)
        query: Dict[str, Any] = {owner_field: owner_id}
        if status in PHOTO_ORDER_STATUSES:
            query["status"] = status
        term = (q or "").strip()[:80]
        if term:
            rx = _search_re(term)
            query["$or"] = [{"primary_contact": rx}, {"email": rx}, {"order_number": rx}, {"dogs": rx}, {"shot_ref": rx}, {"phone_digits": _search_re(_digits(term))} if len(_digits(term)) >= 3 else {"order_number": rx}]
        rows = await orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return {"orders": [_order_row(r) for r in rows], "count": len(rows)}

    @api.post(path)
    async def photo_orders_create(owner_id: str, body: PhotoOrderIn, user: dict = Depends(manage)):
        owner = await load_owner(owner_id)
        if not owner.get("photos_enabled", True):
            raise HTTPException(status_code=409, detail="Photos are switched off for this event.")
        pkg = next((pk for pk in owner.get("photo_packages") or [] if pk.get("key") == body.package_key), None)
        if not pkg:
            raise HTTPException(status_code=422, detail="Pick a photo package.")
        link = await resolve_link(owner, body)
        client_id = link.pop("client_id", None) or body.client_id
        if client_id and not await db.clients.find_one({"id": client_id}, {"_id": 1}):
            client_id = None
        product_id = await _product_for(owner, pkg)
        seq = await _next_seq(owner["id"])
        now = _now_iso()
        by = {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}
        order = {
            "id": str(uuid.uuid4()), owner_field: owner["id"],
            "order_number": f"{order_prefix(owner)}-P{seq:04d}",
            **link,
            "client_id": client_id,
            "primary_contact": _clean(body.primary_contact, 120), "email": str(body.email).strip().lower(),
            "phone": _clean(body.phone, 40), "phone_digits": _digits(body.phone),
            "dogs": [_clean(d, 60) for d in body.dogs if _clean(d, 60)],
            "contestant_numbers": [int(n) for n in body.contestant_numbers if n],
            "shot_ref": _clean(body.shot_ref, 120), "notes": _clean(body.notes, 500),
            "package_key": pkg["key"], "package_name": pkg["name"], "package_price": float(pkg["price"]),
            "package": {"digitals": int(pkg.get("digitals") or 0), "print": pkg.get("print") or "", "product_id": product_id},
            "qty": int(body.qty),
            "status": "ordered", "print_status": "pending" if pkg.get("print") else "none",
            "pos_sale_id": None, "receipt_number": None, "subtotal": None, "tax_amount": None, "total": None, "paid_at": None, "paid_by": None,
            "delivery_link": "", "sent_at": None, "sent_by": None,
            "created_at": now, "created_by": by, "updated_at": now,
        }
        await orders.insert_one(dict(order))
        return {"order": _order_row(order), "summary": await _summary(owner_id)}

    @api.get(f"{path}/{{oid}}")
    async def photo_orders_get(owner_id: str, oid: str, user: dict = Depends(manage)):
        return await _view(owner_id, oid)

    @api.patch(f"{path}/{{oid}}")
    async def photo_orders_patch(owner_id: str, oid: str, body: PhotoOrderPatchIn, user: dict = Depends(manage)):
        o = await _order(owner_id, oid)
        patch: Dict[str, Any] = {}
        if body.primary_contact is not None:
            patch["primary_contact"] = _clean(body.primary_contact, 120)
        if body.email is not None:
            patch["email"] = str(body.email).strip().lower()
        if body.phone is not None:
            patch["phone"] = _clean(body.phone, 40); patch["phone_digits"] = _digits(body.phone)
        if body.dogs is not None:
            patch["dogs"] = [_clean(d, 60) for d in body.dogs if _clean(d, 60)]
        if body.shot_ref is not None:
            patch["shot_ref"] = _clean(body.shot_ref, 120)
        if body.notes is not None:
            patch["notes"] = _clean(body.notes, 500)
        if body.delivery_link is not None:
            patch["delivery_link"] = body.delivery_link.strip()[:2000]
        if body.print_status is not None:
            patch["print_status"] = body.print_status
        if body.status is not None:
            if o.get("status") == "ordered":
                raise HTTPException(status_code=409, detail="Take payment first.")
            if o.get("status") == "sent" and body.status != "ready":
                raise HTTPException(status_code=409, detail="This order was already sent.")
            patch["status"] = body.status
        patch["updated_at"] = _now_iso()
        await orders.update_one({owner_field: owner_id, "id": oid}, {"$set": patch})
        return await _view(owner_id, oid)

    @api.delete(f"{path}/{{oid}}")
    async def photo_orders_delete(owner_id: str, oid: str, user: dict = Depends(manage)):
        o = await _order(owner_id, oid)
        if o.get("status") != "ordered":
            raise HTTPException(status_code=409, detail="A paid order can't be deleted. Refund it through the register instead.")
        await orders.delete_one({owner_field: owner_id, "id": oid})
        return {"ok": True, "summary": await _summary(owner_id)}

    def _pos_lines(o: dict):
        return [pos_line_model(kind="retail", product_id=(o.get("package") or {}).get("product_id"), qty=int(o.get("qty") or 1))]

    @api.post(f"{path}/{{oid}}/preview")
    async def photo_orders_preview(owner_id: str, oid: str, user: dict = Depends(manage)):
        """What the register will charge (subtotal, tax, total) — priced by
        the same code as every Front Desk cart."""
        if price_pos_cart is None:
            raise HTTPException(status_code=503, detail="The register is not available.")
        o = await _order(owner_id, oid)
        priced, _caches = await price_pos_cart(_pos_lines(o), None, can_price=False, client_id=o.get("client_id"))
        return {"subtotal": priced.get("subtotal"), "tax_amount": priced.get("tax_amount"), "total": priced.get("total"), "tax_rate_pct": priced.get("tax_rate_pct")}

    @api.post(f"{path}/{{oid}}/checkout")
    async def photo_orders_checkout(owner_id: str, oid: str, body: PhotoCheckoutIn, user: dict = Depends(manage)):
        """Rings the order through the real register: one sale of the
        package's hidden product, the given tenders, the same receipt, drawer,
        tax and P&L behaviour as any Front Desk sale. Idempotent per order."""
        if create_pos_sale is None or pos_sale_model is None:
            raise HTTPException(status_code=503, detail="The register is not available.")
        o = await _order(owner_id, oid)
        if o.get("status") != "ordered":
            return await _view(owner_id, oid)
        if require_take_payments is not None:
            require_take_payments(user)
        sale_body = pos_sale_model(
            lines=_pos_lines(o), discount=None, client_id=o.get("client_id"),
            tenders=[pos_tender_model(method=t.method, amount=t.amount, tendered_amount=t.tendered_amount, notes=t.notes) for t in body.tenders],
            workstation_id=body.workstation_id, idempotency_key=f"event-photo:{o['id']}:{body.idempotency_key}"[:128],
        )
        result = await create_pos_sale(sale_body, user)
        sale = result.get("sale") or {}
        now = _now_iso()
        await orders.update_one({owner_field: owner_id, "id": oid}, {"$set": {
            "status": "paid", "pos_sale_id": result.get("pos_sale_id") or sale.get("id"),
            "receipt_number": sale.get("receipt_number"), "subtotal": sale.get("subtotal"), "tax_amount": sale.get("tax_amount"),
            "total": sale.get("total"), "paid_at": now, "paid_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""},
            "updated_at": now}})
        view = await _view(owner_id, oid)
        view["pos"] = {k: result.get(k) for k in ("pos_sale_id", "pos_print_receipt_token", "pos_open_drawer_token")}
        return view

    @api.post(f"{path}/{{oid}}/send")
    async def photo_orders_send(owner_id: str, oid: str, body: PhotoSendIn, user: dict = Depends(manage)):
        """Email the customer their download link and mark the order sent."""
        owner = await load_owner(owner_id)
        o = await _order(owner_id, oid)
        if o.get("status") == "ordered":
            raise HTTPException(status_code=409, detail="Take payment before sending the photos.")
        link = body.delivery_link.strip()
        if not re.match(r"^https?://", link, re.I):
            raise HTTPException(status_code=422, detail="The download link must start with http:// or https://.")
        if not o.get("email"):
            raise HTTPException(status_code=422, detail="This order has no email address.")
        sent_now = False
        try:
            sent_now = await email_service.send_event_photos_ready(to_email=o["email"], event=owner, order=o, link=link, message=body.message.strip())
        except Exception as exc:
            logger.warning("photo orders: photos-ready email failed for %s: %s", o.get("order_number"), exc)
        now = _now_iso()
        await orders.update_one({owner_field: owner_id, "id": oid}, {"$set": {
            "status": "sent", "delivery_link": link, "sent_at": now, "email_sent_now": bool(sent_now),
            "sent_by": {"id": user.get("id"), "name": user.get("name") or user.get("email") or ""}, "updated_at": now}})
        return await _view(owner_id, oid)

    @api.get(f"{path}.csv")
    async def photo_orders_csv(owner_id: str, user: dict = Depends(manage)):
        owner = await load_owner(owner_id)
        rows = await orders.find({owner_field: owner_id}, {"_id": 0}).sort("created_at", 1).to_list(5000)
        header = ["Order #", "Name", "Email", "Phone", "Dogs", "Contestant #s", "Shot reference", "Package", "Qty", "Digitals", "Print",
                  "Subtotal", "Tax", "Total", "Status", "Receipt #", "Paid at", "Print status", "Download link", "Sent at", "Notes",
                  *[h for h, _ in csv_link_columns], "Created at"]
        data = [[r.get("order_number"), r.get("primary_contact"), r.get("email"), r.get("phone"), "; ".join(r.get("dogs") or []),
                 "; ".join(f"#{int(n):03d}" for n in (r.get("contestant_numbers") or [])), r.get("shot_ref"), r.get("package_name"), r.get("qty"),
                 (r.get("package") or {}).get("digitals"), (r.get("package") or {}).get("print"), r.get("subtotal"), r.get("tax_amount"), r.get("total"),
                 r.get("status"), r.get("receipt_number"), r.get("paid_at"), r.get("print_status"), r.get("delivery_link"), r.get("sent_at"),
                 r.get("notes"), *[r.get(f) for _, f in csv_link_columns], r.get("created_at")] for r in rows]
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(header)
        for row in data:
            w.writerow(["" if v is None else v for v in row])
        return Response(content=out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{owner.get("slug") or "photo"}-photo-orders.csv"'})

    return {"photo_orders_summary": _summary, "photo_order_row": _order_row}
