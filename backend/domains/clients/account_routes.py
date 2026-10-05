"""Client account routes that change who a family is reached by.

- The email-change link: a new address is used only once the link sent to it is
  opened (audit #27).
- Staff can see and clear a family's marketing opt-out, as the family's own
  choice, recorded with who made it (audit #38).

The handler bodies are the ones that lived in server.py; they register from here
so server.py does not grow new routes (route freeze).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field


class EmailChangeConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class MarketingEmailPreferenceIn(BaseModel):
    opted_out: bool


def register_client_account_routes(*, api, db, now_iso, require_admin_and_permission, security_key) -> Dict[str, Any]:
    """Register the account routes. Returns the callables the in-process suites call."""

    @api.post("/portal/email-change/confirm")
    async def portal_confirm_email_change(body: EmailChangeConfirmIn):
        """The new address is used only once the link sent to it is opened (audit #27)."""
        row = await db.email_changes.find_one({"token_hash": security_key(body.token)}, {"_id": 0})
        if not row or (row.get("expires_at") or "") < datetime.now(timezone.utc).isoformat():
            raise HTTPException(status_code=400, detail="This confirmation link has expired. Change your email again.")
        new_email = row["new_email"]
        await db.clients.update_one({"id": row["client_id"]}, {"$set": {"email": new_email}})
        await db.users.update_one({"id": row["user_id"]}, {"$set": {"email": new_email}, "$inc": {"token_version": 1}})
        await db.email_changes.delete_one({"client_id": row["client_id"]})
        return {"ok": True, "email": new_email}

    @api.put("/admin/clients/{client_id}/marketing-email-preference")
    async def admin_marketing_email_preference(client_id: str, body: MarketingEmailPreferenceIn,
                                               user: dict = Depends(require_admin_and_permission("manage_communications"))):
        """Staff can see and change a family's marketing opt-out. A family that clicked
        Unsubscribe is still blocked from bulk and marketing email; staff clear it here, as
        the family's own choice (audit #38). The change is recorded with who made it."""
        r = await db.clients.update_one({"id": client_id}, {"$set": {
            "marketing_email_opt_out": bool(body.opted_out),
            "marketing_email_opt_out_at": now_iso() if body.opted_out else None,
            "marketing_email_opt_out_source": "staff" if body.opted_out else None,
            "marketing_email_opt_out_by": (user.get("name") or user.get("email") or "staff") if body.opted_out else None,
        }})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Client not found")
        return {"opted_out": bool(body.opted_out)}

    return {
        "portal_confirm_email_change": portal_confirm_email_change,
        "admin_marketing_email_preference": admin_marketing_email_preference,
    }
