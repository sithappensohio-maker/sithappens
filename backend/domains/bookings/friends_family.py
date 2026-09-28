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
import uuid
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


def payer_id(booking: dict) -> Optional[str]:
    """The family whose money this row moves — its rates, its tab, its bill,
    its receipts: the payer on a friends & family group, else the dog's own
    family. Every money path reads it through here."""
    return booking.get("bill_to_client_id") or booking.get("client_id")


pricing_client_id = payer_id   # whose rates price the row — the same family


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


async def stamp(created: List[dict], group: Dict[str, Any], service_type: str,
                note: str = "Nothing was booked for any dog yet.") -> None:
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
            exc.detail = f"{exc.detail} {note}"
            raise
        raise HTTPException(status_code=500, detail="These dogs couldn't be booked together, so nothing was booked. Please try again.")


# ───────────────────────── one bill, whenever each dog is picked up ─────────────────────────
#
# The owner's rules: the payer pays ONE bill for every dog, and the dogs may be
# picked up at different times. So a friends & family dog's checkout never
# takes money itself: its charge goes on the payer's account (the tab), and
# when the last dog of the group has left, ONE bill is made on the payer
# covering every dog. The payer pays that bill at the desk or online. If all
# the dogs leave together, the combined checkout does the same in one go. A
# dog that never comes stops holding the bill up once its day has passed (the
# sweep), and staff can close the bill at any time.

MSG_PAY_ON_BILL = ("This dog is on a friends & family booking: its visit goes on the paying family's account, and one "
                   "bill for every dog is made when the last dog leaves. Take the payment on that bill.")
MSG_REGISTER = ("Products can't be sold at a friends & family dog's checkout. Ring them up at the Register for the "
                "family paying.")
MSG_WAITING = ("This family has dogs on a friends & family booking waiting for their one bill. Close that bill (or "
               "wait for the last dog to leave), then take the payment on it.")
MSG_CORRECT_LATER = ("This dog's visit is waiting for its friends & family group's one bill. To change its price now, "
                     "reopen its checkout; or correct it once the bill is made.")
_ENDED = ("completed", "cancelled", "canceled", "rejected")
_STALE_MINUTES = 15   # a checkout (or a bill being made) this old has died part-way


MSG_CHANGED = "This booking was just changed. Refresh and try again."


def expected(body: Any, ff_row: bool) -> None:
    """A checkout screen says whether it saw a friends & family booking; if the
    booking changed since (a dog taken out, one added), the checkout it built
    is for the other kind — refused, never run the wrong way."""
    want = getattr(body, "expect_friends_family", None)
    if want is not None and bool(want) != ff_row:
        raise HTTPException(status_code=409, detail=MSG_CHANGED)


def on_the_payers_tab(body: Any) -> Any:
    """The checkout of a friends & family dog: nothing is paid here — the
    whole visit goes on the payer's account (and never on prepaid credits).
    Money offered at this checkout is refused rather than silently ignored."""
    if body.retail_lines:
        raise HTTPException(status_code=400, detail=MSG_REGISTER)
    offered = ((body.amount_paid or 0) > 0.005 or bool(body.gift_card_code) or bool(body.tendered_amount)
               or (body.payment_status == "paid" and body.payment_method not in (None, "credits")))
    if offered:
        raise HTTPException(status_code=400, detail=MSG_PAY_ON_BILL)
    return body.model_copy(update={"payment_status": "paid_partial", "amount_paid": 0.0,
                                   "use_credits": False, "extra_nights_use_credits": False})


def _stale_before() -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(minutes=_STALE_MINUTES)).isoformat()


def _still_to_come(row: dict, today: str, stale: str, leaving: Optional[str]) -> bool:
    """On site, still expected, or being checked out right now by another
    checkout: holds the group's bill until it leaves."""
    if (row.get("checkout_in_progress") and row.get("id") != leaving
            and (row.get("checkout_started_at") or "") > stale):
        return True
    if row.get("status") in _ENDED or row.get("checked_out_at"):
        return False
    return bool(row.get("checked_in_at")) or (row.get("date") or "") >= today


_HOLD = ("checkout_in_progress", "checkout_operation_id", "checkout_started_at")


async def hold(rows: List[dict]) -> tuple:
    """Hold these dogs' bookings the way a checkout does, so no checkout of
    one can start (or roll back over them) while the booking is changed.
    Returns (operation id, the rows as they are now) — or (None, []) with
    nothing held, if one is being checked out or has changed since read."""
    db, stale, op = _g("db"), _stale_before(), str(uuid.uuid4())
    held: List[dict] = []
    for r in rows:
        got = await db.bookings.find_one_and_update(
            {"$and": [{"id": r["id"], "status": r.get("status")}, {"checked_out_at": {"$in": [None, ""]}},
                      {"$or": [{"checkout_in_progress": {"$exists": False}}, {"checkout_in_progress": False},
                               {"checkout_started_at": {"$lt": stale}}]}]},
            {"$set": {"checkout_in_progress": True, "checkout_operation_id": op, "checkout_started_at": _g("now_iso")()}},
            projection={"_id": 0}, return_document=True)
        if not got:
            await let_go(op, [h["id"] for h in held])
            return None, []
        held.append(got)
    return op, held


async def let_go(op: Optional[str], ids: List[str]) -> None:
    if op and ids:
        await _g("db").bookings.update_many({"id": {"$in": ids}, "checkout_operation_id": op},
                                            {"$unset": {k: "" for k in _HOLD}})


async def waiting_for_group_bill(client_id: Optional[str]) -> bool:
    """Does this family pay for dogs whose visits are waiting for their group's bill?"""
    if not client_id:
        return False
    return bool(await _g("db").bookings.find_one(
        {"bill_to_client_id": client_id, "status": "completed",   # (a reopened or cancelled visit waits for nothing)
         "$or": [{"group_bill_pending": True}, {"group_bill_claim": {"$nin": [None, ""]}}]},
        {"_id": 1}))


async def close_group_bill(group_id: Optional[str], user: dict, *, force: bool = False,
                           leaving: Optional[str] = None) -> Optional[dict]:
    """Once no dog of the group is still to come (or when staff close it now),
    make ONE bill on the payer for every dog checked out onto its account.
    Each visit is claimed first, so it can never land on two bills.
    `leaving` is the dog whose own checkout is calling this."""
    if not group_id:
        return None
    db = _g("db")
    rows = await db.bookings.find({"group_id": group_id}, {"_id": 0}).to_list(100)
    today, stale = _g("business_today")().isoformat(), _stale_before()
    if not force and any(_still_to_come(r, today, stale, leaving) for r in rows):
        return None
    waiting = [r for r in rows if r.get("status") == "completed" and (
        r.get("group_bill_pending") or (r.get("group_bill_claim") and (r.get("group_bill_claimed_at") or "") < stale))]
    # (A claim that died after its bill was made is safe to take again: the
    # bill builder never bills a visit twice — it hands back that bill.)
    ready = [r["id"] for r in waiting]
    if not ready:
        return None
    claim = str(uuid.uuid4())
    await db.bookings.update_many(
        {"id": {"$in": ready}, "$or": [{"group_bill_pending": True}, {"group_bill_claimed_at": {"$lt": stale}}]},
        {"$set": {"group_bill_pending": False, "group_bill_claim": claim, "group_bill_claimed_at": _g("now_iso")()}})
    mine = [r["id"] for r in await db.bookings.find({"id": {"$in": ready}, "group_bill_claim": claim},
                                                    {"_id": 0, "id": 1}).to_list(100)]
    if not mine:
        return None
    try:
        bill = await _g("_create_invoice_for_bookings")(mine, user=user, ts=_g("now_iso")())
    except Exception:
        await db.bookings.update_many({"id": {"$in": mine}, "group_bill_claim": claim},
                                      {"$set": {"group_bill_pending": True},
                                       "$unset": {"group_bill_claim": "", "group_bill_claimed_at": ""}})
        raise
    await db.bookings.update_many({"id": {"$in": mine}}, {"$unset": {"group_bill_claim": "", "group_bill_claimed_at": ""}})
    return bill


async def _with_payer_lock(group_id: str, user: dict, *, force: bool = False) -> Optional[dict]:
    """Close a group's bill holding the payer's money lock, as a checkout does,
    so it can never race the last dog's checkout into two bills."""
    from domains.billing import tab_sync   # (tab_sync imports this module)
    db = _g("db")
    row = await db.bookings.find_one({"group_id": group_id, "bill_to_client_id": {"$nin": [None, ""]}}, {"_id": 0})
    if not row:
        return None
    guard = await tab_sync.acquire_client_guard(payer_id(row))
    try:
        return await close_group_bill(group_id, user, force=force)
    finally:
        await tab_sync.release_client_guard(guard)


async def after_cancel(booking: dict, user: dict) -> Optional[dict]:
    """A dog of a friends & family group was cancelled (taken out of the
    booking); the cancel holds the payer's money lock. Once only the paying
    family's own dogs are left, and none of the group has gone home yet, it
    is the family's own booking again: they pay for their dogs the usual way
    (at the desk, with credits). Then the group's bill stops waiting for the
    cancelled dog."""
    group_id = booking.get("group_id")
    if not group_id:
        return None
    db = _g("db")
    rows = await db.bookings.find({"group_id": group_id}, {"_id": 0}).to_list(100)
    active = [r for r in rows if r.get("status") not in ("cancelled", "canceled", "rejected")]
    payer, stale = payer_id(booking), _stale_before()
    underway = any(r.get("checked_out_at") or r.get("status") == "completed" or r.get("group_bill_pending")
                   or r.get("group_bill_claim") or (r.get("checkout_in_progress") and (r.get("checkout_started_at") or "") > stale)
                   for r in rows)
    if active and not underway and all(r.get("client_id") == payer for r in active):
        # All or nothing: held first, so a checkout starting now can't roll back over one of them.
        op, held = await hold(active)
        try:
            for r in held:
                ps = r.get("pricing_snapshot")
                count = ({"pricing_snapshot.group_dog_count": len(held)} if isinstance(ps, dict)
                         else {"pricing_snapshot": {"group_dog_count": len(held), "group_dog_index": 0}})
                await db.bookings.update_one(
                    {"id": r["id"], "checkout_operation_id": op, "status": r.get("status")},
                    {"$set": count, "$unset": {"bill_to_client_id": "", "bill_to_client_name": "", "group_kind": ""}})
        finally:
            await let_go(op, [r["id"] for r in held])
    return await close_after_cancel(group_id, user)


async def close_after_cancel(group_id: Optional[str], user: dict) -> Optional[dict]:
    """After a cancel (which already holds the payer's money lock): make the
    bill if nothing holds it up. A bill that can't be made just now is left
    to the sweep — the cancel itself has happened."""
    try:
        return await close_group_bill(group_id, user)
    except HTTPException:
        return None


async def check_out_together(anchor: dict, body: Any, user: dict) -> dict:
    """The combined checkout of a friends & family group: every dog of the
    group on site goes on the payer's account, and the one bill is made."""
    rows = await group_pricing.household_checkout_rows(anchor)
    if len(rows) < 2:
        raise HTTPException(status_code=409, detail="There are no other active dogs left in this checkout group.")
    if body.base_price is not None and not _g("_perms_for")(user).get("pricing"):   # (before any dog leaves)
        raise HTTPException(status_code=403, detail="You don't have permission to override the checkout price.")
    # Extras, a manual price and an extra charge belong to the dog whose button
    # was clicked — as in every combined checkout — never to each dog.
    others = body.model_copy(update={"add_ons": [], "base_price": None, "base_price_reason": None,
                                     "additional_cash_charge": 0, "retail_lines": []})
    done = [await _g("check_out")(r["id"], body if r["id"] == anchor["id"] else others, user) for r in rows]
    bill = next((d.get("group_bill") for d in reversed(done) if d.get("group_bill")), None)
    return {"friends_family": True, "bookings": done, "invoice": bill}


async def sweep_group_bills() -> int:
    """Scheduler: close the bill of any group whose last dog has gone (a dog
    that never came stops holding it once its day has passed)."""
    db = _g("db")
    closed = 0
    for gid in await db.bookings.distinct("group_id", {"status": "completed", "$or": [
            {"group_bill_pending": True}, {"group_bill_claimed_at": {"$lt": _stale_before()}}]}):
        try:
            if await _with_payer_lock(gid, {"id": "system", "name": "Friends & family bill"}):
                closed += 1
        except HTTPException:
            continue   # a checkout or correction for the payer is under way: next tick
    return closed


def register_routes(*, api, server_globals: dict) -> None:
    """POST /bookings/group/{group_id}/close-bill — staff close a friends &
    family group's bill now (e.g. one dog is staying on)."""
    from fastapi import Depends

    perm = server_globals["require_admin_and_permission"]

    async def close_bill_now(group_id: str, user: dict = Depends(perm("take_payments"))):
        bill = await _with_payer_lock(group_id, user, force=True)
        if not bill:
            raise HTTPException(status_code=409, detail="No dog of this group is waiting to be billed.")
        return bill

    api.add_api_route("/bookings/group/{group_id}/close-bill", close_bill_now, methods=["POST"])

    async def paying_for(client_id: str, user: dict = Depends(perm("clients_view"))):
        """A family's friends & family bookings (the client page): every dog it
        pays for — its own and its friends' — by booking, and whether any have
        gone home and are waiting for their one bill (the same rule that holds
        payments on the family's account)."""
        db = _g("db")
        live = {"bill_to_client_id": client_id, "status": {"$nin": ["cancelled", "canceled", "rejected"]}}
        # The latest bookings, each whole — and always any still waiting for its bill.
        recent = await db.bookings.find(live, {"_id": 0, "group_id": 1}).sort("date", -1).to_list(200)
        waiting = await db.bookings.distinct("group_id", {"bill_to_client_id": client_id, "status": "completed",
                                                          "$or": [{"group_bill_pending": True}, {"group_bill_claim": {"$nin": [None, ""]}}]})
        gids = list({r["group_id"] for r in recent if r.get("group_id")} | {g for g in waiting if g})
        rows = await db.bookings.find(
            {**live, "group_id": {"$in": gids}},
            {"_id": 0, "id": 1, "group_id": 1, "dog_id": 1, "dog_name": 1, "client_id": 1, "client_name": 1, "date": 1,
             "end_date": 1, "service_type": 1, "status": 1, "checked_in_at": 1, "checked_out_at": 1,
             "group_bill_pending": 1, "group_bill_claim": 1},
        ).sort("date", -1).to_list(2000)
        groups: Dict[str, List[dict]] = {}
        for r in rows:
            groups.setdefault(r.get("group_id") or r["id"], []).append(r)
        return {
            "waiting_for_bill": await waiting_for_group_bill(client_id),
            "groups": [{"group_id": gid, "dogs": dogs,
                        "waiting": any(d.get("status") == "completed" and (d.get("group_bill_pending") or d.get("group_bill_claim"))
                                       for d in dogs)}
                       for gid, dogs in groups.items()],
        }

    api.add_api_route("/clients/{client_id}/friends-family", paying_for, methods=["GET"])
