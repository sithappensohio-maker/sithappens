"""Front-desk bulk operations tools.

Owner-requested (2026-08-31 smoke-test follow-ups): the vaccine-upload review
queue and the stuck-checkout list were one-at-a-time flows that don't survive
a real backlog (85 pending uploads / 16 stuck stays at the time). Both bulk
endpoints reuse the SAME single-item rules — nothing here invents a second
approval or checkout path.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

VACCINE_TYPES = ("rabies", "bordetella", "dhpp")


class BulkVaccineReviewIn(BaseModel):
    # Explicit selection; the UI sends exactly the rows the admin can see.
    items: List[Dict[str, str]] = Field(default_factory=list, max_length=500)


class StuckCheckoutResolveIn(BaseModel):
    booking_ids: List[str] = Field(default_factory=list, max_length=500)
    reason: str = Field(min_length=3, max_length=300)


async def approve_vaccine_cert(db, dog_id: str, vaccine: str, reviewer_name: str, now_iso) -> Dict[str, Any]:
    """The one canonical approval rule — used by the single-review endpoint
    (server.py facade) and the bulk endpoint below. Applies the pending
    expiry to the dog so booking unlocks; raises HTTPException on bad input."""
    if vaccine not in VACCINE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid vaccine type")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "vaccine_certs": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    certs = dict(dog.get("vaccine_certs") or {})
    if vaccine not in certs:
        raise HTTPException(status_code=404, detail="No cert uploaded for this vaccine")
    certs[vaccine] = dict(certs[vaccine])
    approved_exp = certs[vaccine].get("pending_expires_on") or certs[vaccine].get("expires_on")
    if not approved_exp:
        raise HTTPException(status_code=400, detail="Uploaded cert is missing an expiry date")
    try:
        date.fromisoformat(str(approved_exp)[:10])
    except Exception:
        raise HTTPException(status_code=400, detail="Uploaded cert has an invalid expiry date")
    certs[vaccine]["reviewed_at"] = now_iso()
    certs[vaccine]["reviewed_by"] = reviewer_name
    certs[vaccine]["status"] = "approved"
    certs[vaccine]["expires_on"] = str(approved_exp)[:10]
    certs[vaccine].pop("pending_expires_on", None)
    vaccines = dict((await db.dogs.find_one({"id": dog_id}, {"_id": 0, "vaccines": 1}) or {}).get("vaccines") or {})
    vaccines[vaccine] = str(approved_exp)[:10]
    await db.dogs.update_one({"id": dog_id}, {"$set": {"vaccine_certs": certs, "vaccines": vaccines}})
    return {"ok": True, "dog_id": dog_id, "vaccine": vaccine, "expires_on": str(approved_exp)[:10]}


def register_operations_routes(*, api, db, require_admin, require_admin_and_permission, now_iso, business_today) -> None:

    @api.post("/admin/vaccine-uploads/bulk-review")
    async def bulk_review_vaccine_uploads(body: BulkVaccineReviewIn, user: dict = Depends(require_admin)):
        """Approve many pending vaccine uploads in one action.

        Each item runs the exact single-approval rule; items that fail it
        (missing/invalid expiry, already removed, unknown dog) are skipped
        and reported — a bad row never blocks the rest of the queue.
        """
        if not body.items:
            raise HTTPException(status_code=400, detail="Select at least one upload to approve.")
        reviewer = user.get("name", "Admin")
        approved: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []
        for item in body.items:
            dog_id = str(item.get("dog_id") or "")
            vaccine = str(item.get("vaccine") or "")
            try:
                result = await approve_vaccine_cert(db, dog_id, vaccine, reviewer, now_iso)
                approved.append(result)
            except HTTPException as exc:
                skipped.append({"dog_id": dog_id, "vaccine": vaccine, "reason": str(exc.detail)})
            except Exception:
                skipped.append({"dog_id": dog_id, "vaccine": vaccine, "reason": "Unexpected error"})
        return {"ok": True, "approved_count": len(approved), "approved": approved, "skipped": skipped}

    @api.get("/admin/bookings/stuck-checkouts")
    async def list_stuck_checkouts(_: dict = Depends(require_admin_and_permission("booking_edit"))):
        """The rows behind the Action Center's 'may be stuck' counter — same
        query, full rows, so the resolver modal shows exactly what the
        counter counted."""
        today_iso = business_today().isoformat()
        rows = await db.bookings.find(
            {
                "status": {"$in": ["approved", "completed"]},
                "checked_in_at": {"$exists": True, "$nin": [None, ""]},
                "checked_out_at": {"$in": [None, ""]},
                "$or": [
                    {"end_date": {"$lt": today_iso}},
                    {"end_date": {"$exists": False}, "date": {"$lt": today_iso}},
                    {"end_date": "", "date": {"$lt": today_iso}},
                ],
            },
            {"_id": 0, "id": 1, "dog_name": 1, "client_name": 1, "service_type": 1,
             "date": 1, "end_date": 1, "checked_in_at": 1, "payment_status": 1, "actual_price": 1},
        ).sort("date", 1).to_list(500)
        return rows

    @api.post("/admin/bookings/resolve-stuck-checkouts")
    async def resolve_stuck_checkouts(body: StuckCheckoutResolveIn, user: dict = Depends(require_admin_and_permission("booking_edit"))):
        """Administratively close out stuck stays — checked in, never checked
        out, scheduled end already passed.

        DELIBERATELY NON-FINANCIAL: this stamps checked_out_at/status only and
        never bills, deducts credits, or touches actual_price — money stays
        exactly as it was, and every row gets an admin_checkout_resolution
        audit stamp {by, reason, at}. A stay that still needs to be CHARGED
        must go through the normal checkout modal instead.
        """
        if not body.booking_ids:
            raise HTTPException(status_code=400, detail="Select at least one booking to resolve.")
        today_iso = business_today().isoformat()
        ts = now_iso()
        resolved: List[str] = []
        skipped: List[Dict[str, Any]] = []
        for bid in body.booking_ids:
            b = await db.bookings.find_one({"id": bid}, {"_id": 0, "id": 1, "checked_in_at": 1, "checked_out_at": 1, "date": 1, "end_date": 1, "status": 1})
            if not b:
                skipped.append({"booking_id": bid, "reason": "Booking not found"})
                continue
            end = b.get("end_date") or b.get("date") or ""
            if not b.get("checked_in_at") or b.get("checked_out_at") or not end or end >= today_iso:
                skipped.append({"booking_id": bid, "reason": "Not a stuck checkout (must be checked in, not checked out, past its end date)"})
                continue
            await db.bookings.update_one(
                {"id": bid, "checked_out_at": {"$in": [None, ""]}},
                {"$set": {
                    "checked_out_at": ts,
                    "status": "completed",
                    "checked_out_by": user.get("id"),
                    "checked_out_by_name": user.get("name") or user.get("email") or "admin",
                    "admin_checkout_resolution": {
                        "id": str(uuid.uuid4()), "by": user.get("id"),
                        "by_name": user.get("name") or user.get("email") or "",
                        "reason": body.reason.strip(), "at": ts,
                        "scheduled_end": end,
                    },
                }},
            )
            resolved.append(bid)
        return {"ok": True, "resolved_count": len(resolved), "resolved": resolved, "skipped": skipped}
