"""Friends & family multi-dog groups (owner request 2026-09-28).

The multi-dog discount used to be for one household: every dog in a group
belonged to the same family. The owner, as admin, can now put dogs from
DIFFERENT families on one booking — friends and family — so they get the
multi-dog price together. The owner's rules:

  * ONE family pays a single bill for every dog (the "payer");
  * each dog stays under its OWN family: its booking row's client_id is the
    dog's owner, so that family sees its dog's visit, report cards, photos
    and awards, and staff see that family's phone and emergency contact. The
    payer is recorded on every row as `bill_to_client_id` — staff-only, and
    read through `domains.billing.payer` by every money path;
  * the friend's family sees its dog's visit but never a price, a bill or
    the other family's dog ("Covered, nothing to pay");
  * the payer's own dog pays full price, the friend's dogs get the multi-dog
    discount, all at the PAYER's rates; the payer must have a dog in the group;
  * trusted dogs: a friend's family needs no Meet & Greet or signed waiver
    (a family marked "rejected" stays refused; vaccines are still checked,
    with the usual admin override);
  * admin only — the "friends_family_bookings" permission (the owner has it;
    it can be granted to staff). Never from the client portal;
  * daycare and boarding, one visit at a time.

The whole thing stays off (ENABLED) until every money path pays the payer.
"""
from __future__ import annotations

import contextvars
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from domains.bookings import group_pricing

ENABLED = False   # switched on once every money path honours the payer (build step 10)
PERMISSION = "friends_family_bookings"
KIND = "friends_family"
SERVICES = ("daycare", "boarding")

# The group being booked right now, when it mixes families: {"payer": client doc, "friends": {dog ids}}.
CTX: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar("friends_family_group", default=None)

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


MSG_MIXED = "These dogs belong to different families. Book each family's dogs on their own booking."


async def plan(body: Any, user: dict, owner_of: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """Allow a group that mixes families only as a friends & family group,
    and put the payer's dogs first (the first dog pays full price). Raises
    the plain refusal otherwise. `owner_of` maps each dog id to its owner."""
    if not ENABLED:
        raise HTTPException(status_code=400, detail=MSG_MIXED)
    if not _g("_perms_for")(user).get(PERMISSION):
        raise HTTPException(status_code=403, detail="You don't have permission to book dogs from different families together.")
    if body.service_type not in SERVICES:
        raise HTTPException(status_code=400, detail="Friends & family groups are for daycare and boarding.")
    payer_id = getattr(body, "payer_client_id", None)
    if not payer_id:
        raise HTTPException(status_code=400, detail="Choose who pays for these dogs.")
    if payer_id not in owner_of.values():
        raise HTTPException(status_code=400, detail="The family paying must have one of its own dogs on this booking.")
    payer = await _g("db").clients.find_one({"id": payer_id}, {"_id": 0, "id": 1, "name": 1})
    if not payer:
        raise HTTPException(status_code=404, detail="The family paying wasn't found.")
    body.dogs = sorted(body.dogs, key=lambda d: owner_of.get(d.dog_id) != payer_id)   # payer's dogs first, order kept
    return {"payer": payer, "friends": {d.dog_id for d in body.dogs if owner_of.get(d.dog_id) != payer_id}}


def pricing_client_id(booking: dict) -> Optional[str]:
    """Whose rates price this row: the payer's on a friends & family group."""
    return booking.get("bill_to_client_id") or booking.get("client_id")


# What the friend's family never sees of its dog's visit: anything about the
# money (the payer pays), the group, or who is paying. Matched against the
# WORDS of a field's name ("unit_price" -> unit, price), so a money field added
# later is hidden by default — but a care field that merely contains one
# ("feeding_log" is not a fee, "crate" is not a rate) is not.
_HIDDEN_WORDS = frozenset((
    "price", "pricing", "rate", "override", "paid", "prepaid", "pay", "payment", "balance", "credit", "credits",
    "discount", "revenue", "tax", "taxable", "invoice", "fee", "charge", "charged", "refund", "cost", "amount",
    "total", "financial", "sale", "money", "modifier", "group", "receipt", "cash", "tendered", "lot", "redemptions"))
_HIDDEN_PREFIXES = ("bill_to", "pos_", "gift_card", "extra_nights", "late_day", "multi_dog", "checkout_group")
# Care and visit details the dog's own family always sees.
_ALWAYS_SHOWN = frozenset(("feeding_log", "medication_log", "bathroom_log", "report_card", "photos", "mood_tags",
                           "crate", "room", "kennel", "yard_group", "training_group", "notes", "note", "status"))
_ADDON_SHOWN = ("service_id", "name", "icon", "qty", "added_at", "added_stage")
COVERED = "covered_by_other"


def _hidden(key: str) -> bool:
    if key in _ALWAYS_SHOWN:
        return False
    return key.startswith(_HIDDEN_PREFIXES) or not _HIDDEN_WORDS.isdisjoint(key.split("_"))


def for_client(booking: dict, user: Optional[dict]) -> dict:
    """What a signed-in CLIENT may see of a booking row. Staff see it all.

    On a friends & family row the payer sees its own dog as usual (minus the
    payer fields — it knows); the friend's family sees its dog's visit — dates,
    times, status, care — but never a price, a discount, the group or who is
    paying: the row says it is covered, nothing to pay."""
    if (user or {}).get("role") != "client" or not booking.get("bill_to_client_id"):
        return booking
    if booking["bill_to_client_id"] == (user or {}).get("client_id"):
        return {k: v for k, v in booking.items() if not k.startswith("bill_to_")}
    out = {k: v for k, v in booking.items() if not _hidden(k)}
    if booking.get("add_ons"):
        out["add_ons"] = [{k: a.get(k) for k in _ADDON_SHOWN if k in a} for a in booking["add_ons"]]
    out[COVERED] = True
    return out


def refuse_client_change(booking: dict, user: Optional[dict]) -> None:
    """The friend's family can't add or remove extras online on a visit
    someone else is paying for."""
    if (user or {}).get("role") == "client" and booking.get("bill_to_client_id") \
            and booking["bill_to_client_id"] != (user or {}).get("client_id"):
        raise HTTPException(status_code=403, detail="Someone else is paying for this visit, so extras can't be changed online. "
                                                    "Please ask us and we'll sort it out.")


def trusted(dog_id: Optional[str], client_status: Optional[str]) -> bool:
    """A friend's dog on a friends & family group skips the new-client gate
    (Meet & Greet) — the owner vouches for it. A family marked rejected is
    never let through."""
    group = CTX.get()
    return bool(group and dog_id in group["friends"] and client_status != "rejected")


async def stamp(created: List[dict], group: Dict[str, Any], service_type: str) -> None:
    """Record the payer on every dog's row, and price a friend's add-ons at
    the payer's rates (the booking itself is priced at the payer's rates by
    the group pricing, which quotes the first — the payer's — dog).

    All or nothing, like the rest of the group: if this fails part-way (an
    add-on switched off that very moment), every row the group made is taken
    back — never a half-stamped group left booked at separate prices."""
    try:
        db = _g("db")
        payer = group["payer"]
        fields = {"bill_to_client_id": payer["id"], "bill_to_client_name": payer.get("name") or "", "group_kind": KIND}
        for bk in created:
            patch = dict(fields)
            if bk.get("dog_id") in group["friends"] and bk.get("add_ons"):
                ids = [a.get("service_id") for a in bk["add_ons"] if a.get("service_id")]
                patch["add_ons"] = await _g("resolve_addon_snapshots")(payer["id"], ids, service_type)
            await db.bookings.update_one({"id": bk["id"]}, {"$set": patch})
            bk.update(patch)
    except Exception as exc:
        await group_pricing.undo_rows(created)
        if isinstance(exc, HTTPException) and isinstance(exc.detail, str):
            exc.detail = f"{exc.detail} Nothing was booked for any dog yet."
            raise
        raise HTTPException(status_code=500, detail="These dogs couldn't be booked together, so nothing was booked. Please try again.")
