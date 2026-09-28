"""Add a dog to a booking that already exists (friends & family build step 8;
owner request 2026-09-28).

The owner books a family's dog, then a friend's dog (or another of the
family's own) joins it for the multi-dog discount. The added dog:

  * gets the SAME dates, service and times, and is booked through the normal
    booking code, so capacity, vaccine and double-booking checks all run; a
    friend's dog is trusted like one booked with the group (no Meet & Greet).
    A dog joining a stay already under way starts today: it is booked and
    charged only for the nights it is there;
  * is priced as one more dog of the group at the paying family's rates
    (group_pricing.group_quote / row_patch — the rule a new group uses);
  * never changes who pays: the booking's paying family pays for it too. A
    lone booking becomes a group, its dog first (full price).

Only before any dog of the booking has gone home (the group's one bill may
be under way after that). While a dog is being added, every dog already on
the booking is held the way a checkout holds it, so no checkout (and no
bill) can run under the add; the add changes only its own fields on them,
and only while each is still as it was read. If anything fails, the new
dog's booking is taken back and the dogs already booked are left exactly as
they were — never touched by a rollback that goes by group id.

Taking a dog out of the booking is cancelling that dog's visit (the normal
cancel; friends_family.after_cancel then puts the booking back to the
family's own once no friend's dog is left, and the group's bill stops
waiting for the cancelled dog).
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from domains.bookings import friends_family, group_pricing

MAX_DOGS = 12
_GONE = ("cancelled", "canceled", "rejected")

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


class GroupDogIn(BaseModel):
    dog_id: str = Field(min_length=1, max_length=100)
    addon_service_ids: List[str] = []
    notes: Optional[str] = Field(default="", max_length=2000)
    kennel: Optional[str] = Field(default="", max_length=100)
    override_vaccines: bool = False
    override_capacity: bool = False


def _refuse(detail: str, status: int = 409):
    raise HTTPException(status_code=status, detail=detail)


def _rank(row: dict) -> int:
    try:
        return int((row.get("pricing_snapshot") or {}).get("group_dog_index") or 0)
    except (TypeError, ValueError):
        return 0


async def _booking_and_group(booking_id: str) -> tuple:
    db = _g("db")
    anchor = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not anchor:
        _refuse("Booking not found", 404)
    rows = [anchor]
    if anchor.get("group_id"):
        rows = await db.bookings.find({"group_id": anchor["group_id"]}, {"_id": 0}).to_list(100)
    return anchor, rows


def _start_day(anchor: dict) -> str:
    """The day the added dog starts: the booking's first day, or today for a
    stay already under way (refused when nothing of the visit is left)."""
    first = str(anchor.get("date") or "")[:10]
    today = _g("business_today")().isoformat()
    if first >= today:
        return first
    if anchor.get("service_type") != "boarding":
        _refuse("This visit was on an earlier day, so no dog can be added to it. Book this dog on its own.")
    if today >= str(anchor.get("end_date") or "")[:10]:
        _refuse("No nights are left on this stay, so no dog can join it. Book this dog for daycare instead.")
    return today


def _check_can_add(anchor: dict, rows: List[dict]) -> List[dict]:
    """The dogs still booked, once adding one is allowed at all."""
    if anchor.get("service_type") not in friends_family.SERVICES:
        _refuse("Dogs can be added to daycare and boarding bookings.", 400)
    if anchor.get("status") in _GONE:
        _refuse("This booking was cancelled, so no dog can be added to it.")
    if anchor.get("status") != "approved":
        _refuse("Only a confirmed booking can have a dog added. Approve it first.")
    if any(r.get("checked_out_at") or r.get("status") == "completed" for r in rows):
        _refuse("A dog on this booking has already gone home, so no dog can be added now. Book this dog on its own.")
    stale = friends_family._stale_before()
    if any(r.get("checkout_in_progress") and (r.get("checkout_started_at") or "") > stale for r in rows):
        _refuse("A dog on this booking is being checked out right now. Try again in a moment.")
    _start_day(anchor)
    active = [r for r in rows if r.get("status") not in _GONE]
    if len(active) >= MAX_DOGS:
        _refuse(f"A booking can have at most {MAX_DOGS} dogs.", 400)
    return active


async def add_dog(booking_id: str, body: GroupDogIn, user: dict) -> Dict[str, Any]:
    db = _g("db")
    _g("_require_booking_edit")(user)
    if not friends_family.ENABLED:
        _refuse("Adding a dog to a booking isn't switched on yet.", 400)
    if not _g("_perms_for")(user).get(friends_family.PERMISSION):
        _refuse("You don't have permission to add dogs to a booking.", 403)
    anchor, rows = await _booking_and_group(booking_id)
    _check_can_add(anchor, rows)
    dog = await db.dogs.find_one({"id": body.dog_id}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1})
    if not dog:
        _refuse("Dog not found", 404)

    # One change to a booking's dogs at a time: every dog already on it is
    # locked, and so is the paying family's money (a cancel of one of the
    # dogs, or a checkout, waits — the one never lands half-way through the other).
    from domains.billing import tab_sync   # (tab_sync imports friends_family)
    keys = sorted({f"booking-group-add:{r['id']}" for r in rows})
    try:
        lock = await _g("_acquire_capacity_locks")(keys)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail="Another change to this booking is being saved. Try again in a moment.") from exc
    try:
        guard = await tab_sync.acquire_client_guard(friends_family.payer_id(anchor))
        try:
            anchor, rows = await _booking_and_group(booking_id)   # as it is now, under the locks
            active = _check_can_add(anchor, rows)
            if body.dog_id in {r.get("dog_id") for r in active}:
                _refuse("This dog is already on this booking.")
            op, active = await friends_family.hold(active)
            if not op:
                _refuse("A dog on this booking is being checked out or was just changed. Try again in a moment.")
            try:
                anchor = next((r for r in active if r["id"] == anchor["id"]), anchor)
                return await _add_locked(anchor, rows, active, dog, body, user, op)
            finally:
                await friends_family.let_go(op, [r["id"] for r in active])
        finally:
            await tab_sync.release_client_guard(guard)
    finally:
        await _g("_release_capacity_locks")(lock, keys)


def _join_update(row: dict, count: int, group_id: str, group: Optional[dict]) -> Dict[str, Any]:
    """Only the add's own fields on a dog already booked — its group, the
    dog count (and first-dog place of a lone booking), who pays."""
    ps = row.get("pricing_snapshot")
    update: Dict[str, Any] = {"group_id": group_id}
    if isinstance(ps, dict):
        update["pricing_snapshot.group_dog_count"] = count
        if "group_dog_index" not in ps:
            update["pricing_snapshot.group_dog_index"] = 0
    else:
        update["pricing_snapshot"] = {"group_dog_count": count, "group_dog_index": 0}
    if group and not row.get("bill_to_client_id"):
        update.update(bill_to_client_id=group["payer"]["id"], bill_to_client_name=group["payer"].get("name") or "",
                      group_kind=friends_family.KIND)
    return update


def _put_back(row: dict, update: Dict[str, Any]) -> Dict[str, Any]:
    """The write that undoes `update` on `row`: each field back to what it was, or gone again."""
    sets, unsets = {}, {}
    for key in update:
        where, name = (row.get("pricing_snapshot") or {}, key.split(".", 1)[1]) if "." in key else (row, key)
        if name in where:
            sets[key] = where[name]
        else:
            unsets[key] = ""
    return {**({"$set": sets} if sets else {}), **({"$unset": unsets} if unsets else {})}


async def _add_locked(anchor: dict, rows: List[dict], active: List[dict], dog: dict, body: GroupDogIn,
                      user: dict, op: str) -> Dict[str, Any]:
    db = _g("db")
    payer_id = friends_family.payer_id(anchor)   # adding a dog never changes who pays
    mixed = bool(anchor.get("bill_to_client_id")) or any(
        (o or payer_id) != payer_id for o in [dog.get("owner_id")] + [r.get("client_id") for r in active])
    group = None
    if mixed:
        payer = await db.clients.find_one({"id": payer_id}, {"_id": 0, "id": 1, "name": 1})
        if not payer:
            _refuse("The family paying for this booking wasn't found.", 404)
        group = {"payer": payer, "friends": {dog["id"]} if dog.get("owner_id") != payer_id else set()}
    start = _start_day(anchor)
    lead = min(active, key=_rank) if active else anchor   # the dog paying the first-dog price
    # Priced first: a quote that fails leaves nothing to take back.
    quote = await group_pricing.group_quote(
        client_id=payer_id, service_type=anchor["service_type"], date=start,
        end_date=anchor.get("end_date"), pickup_time=anchor.get("pickup_time"), service_id=anchor.get("service_id"),
        cutoff=(lead.get("pricing_snapshot") or {}).get("pickup_cutoff_time"))
    group_id = anchor.get("group_id") or str(uuid.uuid4())

    sub = _g("BookingIn")(
        dog_id=dog["id"], date=start, end_date=anchor.get("end_date"),
        service_type=anchor["service_type"], service_id=anchor.get("service_id"),
        time=anchor.get("time") or "", dropoff_time=anchor.get("dropoff_time") or "",
        pickup_time=anchor.get("pickup_time") or "", notes=body.notes or "", kennel=body.kennel or "",
        addon_service_ids=list(body.addon_service_ids or []), override_vaccines=body.override_vaccines,
        override_capacity=body.override_capacity, group_id=group_id)
    tokens = (_g("_suppress_admin_booking_email").set(True), _g("_booking_group_ctx").set(group_id),
              friends_family.CTX.set(group))
    try:
        new = await _g("create_booking")(sub, user)
    finally:
        friends_family.CTX.reset(tokens[2])
        _g("_booking_group_ctx").reset(tokens[1])
        _g("_suppress_admin_booking_email").reset(tokens[0])

    made, done = [new], []
    try:
        if group:   # (takes the new dog's booking back itself if it fails)
            await friends_family.stamp(made, group, anchor["service_type"],
                                       note="The dogs already on the booking are unchanged.")
        count = len(active) + 1
        patch = group_pricing.row_patch(quote, new, max([_rank(r) for r in rows] + [0]) + 1, count)
        await db.bookings.update_one({"id": new["id"]}, {"$set": {**patch, "group_id": group_id}})
        new.update(patch, group_id=group_id)
        for r in active:
            update = _join_update(r, count, group_id, group)
            res = await db.bookings.update_one(
                {"id": r["id"], "checkout_operation_id": op, "status": r.get("status")}, {"$set": update})
            if not res.matched_count:
                _refuse("A dog on this booking was just changed, so the dog wasn't added. Try again.")
            done.append((r, update))
    except Exception:
        await group_pricing.undo_rows(made)
        for r, update in done:   # the dogs already booked, exactly as they were
            await db.bookings.update_one({"id": r["id"]}, _put_back(r, update))
        raise
    return {"booking": new, "group_id": group_id, "dog_count": count}


def register_routes(*, api, server_globals: dict) -> None:
    """POST /bookings/{booking_id}/group-dogs — add a dog to this booking."""
    from fastapi import Depends

    get_current_user = server_globals["get_current_user"]

    async def add_group_dog(booking_id: str, body: GroupDogIn, user: dict = Depends(get_current_user)):
        return await add_dog(booking_id, body, user)

    api.add_api_route("/bookings/{booking_id}/group-dogs", add_group_dog, methods=["POST"])
