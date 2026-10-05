"""Serious incidents leave the Action Center only when the owner acknowledges them
(audit #35). The acknowledgement records who read it and when."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import Depends, HTTPException


def register_incident_routes(*, api, db, now_iso, require_admin_and_permission) -> Dict[str, Any]:
    """Register the incident routes. Returns the callables the in-process suites call."""

    @api.post("/admin/incidents/{incident_id}/acknowledge")
    async def acknowledge_incident(incident_id: str, user: dict = Depends(require_admin_and_permission("incidents"))):
        """The owner has read a serious incident; it leaves the Action Center (audit #35)."""
        r = await db.incidents.update_one({"id": incident_id}, {"$set": {
            "owner_acknowledged_at": now_iso(), "owner_acknowledged_by": user.get("name") or user.get("email") or "owner"}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Incident not found")
        return {"ok": True}

    return {"acknowledge_incident": acknowledge_incident}
