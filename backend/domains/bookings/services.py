"""Booking-domain business services extracted in modernization Phase 5."""
from __future__ import annotations

from typing import Any, Optional
from fastapi import HTTPException

_db = None
_apply_booking_service_rules_fn = None
_create_booking_impl_fn = None
_check_out_impl_fn = None


def configure(*, db, apply_booking_service_rules, create_booking_impl, check_out_impl) -> None:
    global _db, _apply_booking_service_rules_fn, _create_booking_impl_fn, _check_out_impl_fn
    _db = db
    _apply_booking_service_rules_fn = apply_booking_service_rules
    _create_booking_impl_fn = create_booking_impl
    _check_out_impl_fn = check_out_impl


async def create_booking(body, user):
    """Stable Bookings-domain seam around the proven transaction body."""
    return await _create_booking_impl_fn(body, user)


async def check_out(booking_id, body, user):
    """Stable Bookings-domain seam around the proven checkout body."""
    return await _check_out_impl_fn(booking_id, body, user)

async def resolve_base_service_for_booking(body: BookingIn, user: dict) -> Optional[dict]:
    """Resolve a valid active base service and prevent category-rule bypasses.

    Clients must land on an exact catalog service. Legacy/category-only calls
    are safely mapped only when there is one unambiguous active default/base
    service. Admins may still create a broad historical/manual booking.
    """
    if body.service_id:
        selected = await _db.services.find_one({"id": body.service_id}, {"_id": 0})
        if not selected or selected.get("active") is False:
            raise HTTPException(status_code=400, detail="That service is no longer available.")
        if selected.get("is_addon") is True:
            raise HTTPException(status_code=400, detail="Add-ons must be attached to a base service booking.")
        if selected.get("service_type") != body.service_type:
            raise HTTPException(status_code=400, detail="Selected service does not match the booking category.")
        return await _apply_booking_service_rules_fn(_db, body, selected)

    candidates = await _db.services.find(
        {
            "active": True,
            "service_type": body.service_type,
            "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}],
        },
        {"_id": 0},
    ).sort([("is_default", -1), ("name", 1)]).to_list(50)

    # Admins retain a deliberate manual fallback for historical cleanup.
    if user.get("role") == "admin":
        if len(candidates) == 1:
            body.service_id = candidates[0].get("id")
            return await _apply_booking_service_rules_fn(_db, body, candidates[0])
        defaults = [svc for svc in candidates if svc.get("is_default")]
        if len(defaults) == 1:
            body.service_id = defaults[0].get("id")
            return await _apply_booking_service_rules_fn(_db, body, defaults[0])
        return None

    if not candidates:
        raise HTTPException(status_code=400, detail=f"No active {body.service_type} service is available for online booking.")
    defaults = [svc for svc in candidates if svc.get("is_default")]
    selected = candidates[0] if len(candidates) == 1 else (defaults[0] if len(defaults) == 1 else None)
    if selected is None:
        raise HTTPException(status_code=400, detail="Please choose the exact service you want to book.")
    body.service_id = selected.get("id")
    return await _apply_booking_service_rules_fn(_db, body, selected)
