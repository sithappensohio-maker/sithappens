"""Walk-in intake — the person standing at the desk with a dog we do not have
on file, here for a nail trim or a bath.

Before this, the front desk had two bad options: ring an anonymous walk-in sale
(the money is right, but there is no dog, no name and no history), or leave
Front Desk entirely to create a full client and dog before anything could be
booked. This endpoint makes the fast path a real one: one call creates the
owner and the dog together, marked `walk_in` so they are a genuine record
without being counted as a family on file.

A walk-in is an ordinary client row, deliberately. Bookings, check-in, the
register, credits, receipts and history all keep working with no special cases
anywhere, and converting the person to a real client later is a status change
that keeps everything they already have.
"""
import uuid
from datetime import date
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field


class WalkInIn(BaseModel):
    """Only what someone can actually be asked for at a busy front desk."""

    owner_name: str = Field(min_length=1, max_length=120)
    dog_name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = ""
    email: Optional[str] = ""
    breed: Optional[str] = ""
    notes: Optional[str] = ""
    # A friend's dog joining a friends & family booking may come with its
    # vaccine dates (rabies / dhpp / bordetella, ISO dates); a walk-in has none.
    vaccines: Optional[Dict[str, str]] = None


def _vaccine_dates(given: Optional[Dict[str, str]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key in ("rabies", "dhpp", "bordetella"):
        value = str((given or {}).get(key) or "").strip()[:10]
        if not value:
            continue
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"The {key} date isn't a date.")
        out[key] = value
    return out


def register_clients_routes(*, api, db, now_iso, require_admin_and_permission, perms_for=None) -> Dict[str, Any]:
    """Register walk-in intake. Returns the callables the in-process suite calls."""

    @api.post("/clients/walk-in")
    async def create_walk_in(
        body: WalkInIn,
        user: dict = Depends(require_admin_and_permission("clients_edit")),
    ):
        """Create a walk-in owner and their dog in one step.

        Front Desk holds `clients_edit`, so the people who actually greet
        walk-ins can do this without an owner present.
        """
        owner_name = (body.owner_name or "").strip()
        dog_name = (body.dog_name or "").strip()
        if not owner_name or not dog_name:
            raise HTTPException(status_code=422, detail="Both the owner's name and the dog's name are required.")

        vaccines = _vaccine_dates(body.vaccines)
        # A dog's vaccine record is written only by staff who may edit dogs.
        if vaccines and not (perms_for(user) if perms_for else {}).get("dogs_edit"):
            raise HTTPException(status_code=403, detail="You don't have permission to record vaccine dates.")
        client_id = str(uuid.uuid4())
        client_doc = {
            "id": client_id,
            "name": owner_name,
            "phone": (body.phone or "").strip(),
            "email": (body.email or "").strip(),
            "address": "",
            "emerg": "",
            # Credit pools start empty and stay that way unless someone sells
            # the walk-in a pack through the register — the same rule every
            # other client follows.
            "credits": 0,
            "training_credits": 0,
            "boarding_credits": 0,
            "account_balance": 0.0,
            "waiver": False,
            "referred_by_code": None,
            "client_status": "walk_in",
            "evaluation_notes": (body.notes or "").strip(),
            "created_at": now_iso(),
            "walk_in_created_by": user.get("id"),
        }
        await db.clients.insert_one(client_doc)
        client_doc.pop("_id", None)

        dog_doc = {
            "id": str(uuid.uuid4()),
            "owner_id": client_id,
            "name": dog_name,
            "breed": (body.breed or "").strip(),
            "age_y": 0,
            "age_m": 0,
            "sex": "Male",
            "fixed": "No",
            # A walk-in has handed in no vaccine records (a friend's dog added to
            # a friends & family booking may come with its dates, from staff who
            # may edit dogs). Staff-created bookings already carry the admin
            # vaccine override, so none does not block a nail trim, and the dog
            # still shows as unvaccinated everywhere that matters.
            "vaccines": vaccines,
            "notes": (body.notes or "").strip(),
            "training_logs": [],
            "created_at": now_iso(),
        }
        await db.dogs.insert_one(dog_doc)
        dog_doc.pop("_id", None)

        return {"client": client_doc, "dog": dog_doc}

    return {"create_walk_in": create_walk_in}
