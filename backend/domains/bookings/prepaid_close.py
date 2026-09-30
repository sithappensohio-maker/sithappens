"""A program session a trainer finishes closes like a desk checkout (audit #38).

A prepaid program session uses one of its program's credits when it is checked
out. Trainers often run the lesson from Trainer Day ("Start session") without
the front desk checking the dog in and out, so the credit was never used.

Going forward: when a trainer finishes a program session, the visit closes the
way a desk checkout would — one credit from this session's own program, $0,
the bill — so the desk doesn't have to. A session with something added at the
desk (an add-on) is left for the desk checkout, which charges it. An hourly
sweep catches any close that couldn't run at that moment (the family's money
was busy, the process restarted).

Once: past program sessions a trainer recorded but nobody checked out are
closed the same way (program credits only, dated the lesson, no bill or
email), and the owner gets a per-family summary on Today. Anything that
needs a person's eye (moved after the lesson, the dog already paid for
another visit that day, credits adjusted by hand since) is left open and
listed instead.

Credits: a session only ever uses ITS OWN program's credits — never another
pack's. With none left it closes at $0.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

from domains.billing import tab_sync
from domains.bookings import credit_cover, prepaid_sessions

_logger = logging.getLogger(__name__)
_server_globals: Dict[str, Any] = {}

JOB = "prepaid_session_close"          # system_runs marker + scheduler job
SWEEP_EVERY = timedelta(hours=1)
SUMMARY_DAYS = 30                      # how long the owner's Today rows stay up
_STALE_CLAIM = timedelta(minutes=15)   # the desk checkout's own stale-claim window
_NO_ADD_ONS = {"$or": [{"add_ons": {"$exists": False}}, {"add_ons": None}, {"add_ons": []}]}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ───────────────────────────────────────────────── one program credit

async def take_program_credit(booking: dict):
    """One credit from this session's own program lot — never another pack.
    Returns (value, redemptions, qty) like _consume_credit_lots."""
    if not booking.get("program_id"):
        return 0.0, [], 0.0
    lot = await _g("db").credit_lots.find_one_and_update(
        {"client_id": booking["client_id"], "service_type": "training", "program_id": booking["program_id"],
         "qty_remaining": {"$gte": 1}},
        {"$inc": {"qty_remaining": -1}, "$set": {"last_redeemed_at": _g("now_iso")()}},
        sort=[("purchased_at", 1), ("id", 1)], projection={"_id": 0}, return_document=False)
    if not lot:
        return 0.0, [], 0.0
    value = round(float(lot.get("value_each") or 0), 2)
    return value, [{"lot_id": lot["id"], "qty": 1.0, "value_each": value}], 1.0


# ───────────────────────────────────────────────── closing one session

def _skip_reason(b: Optional[dict]) -> Optional[str]:
    if not b:
        return "gone"
    if not prepaid_sessions.is_open(b):
        return "not_open"
    if b.get("status") != "approved":
        return "not_approved"
    if b.get("bill_to_client_id"):
        return "friends_family"
    if b.get("add_ons"):
        return "add_ons"   # the desk checkout charges them
    if b.get("financial_reopened_at"):
        return "reopened"
    return None


async def _guard(client_id: str):
    for attempt in range(3):
        try:
            return await tab_sync.acquire_client_guard(client_id)
        except HTTPException:
            if attempt < 2:
                await asyncio.sleep(0.2)
    return None


async def close_session(booking_id: str, *, actor: dict, log_ids: List[str], source: str,
                        at: Optional[str] = None, quiet: bool = False) -> Dict[str, Any]:
    """Close one open program session as a checkout would. Never raises:
    returns {"closed": bool, "reason"?, "credit_used"?, "credits_left"?}."""
    db = _g("db")
    try:
        b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    except Exception:
        _logger.exception("prepaid close: could not read booking %s", booking_id)
        return {"closed": False, "reason": "error"}
    reason = _skip_reason(b)
    if reason:
        return {"closed": False, "reason": reason}
    cid = b["client_id"]
    guard = await _guard(cid)
    if not guard:
        return {"closed": False, "reason": "busy"}
    op = f"prepaid-close-{uuid.uuid4()}"
    taken = (0.0, [], 0.0)
    closed = False
    try:
        stale = (_now() - _STALE_CLAIM).isoformat()
        claim = await db.bookings.find_one_and_update(
            {"id": booking_id, "status": "approved", "checked_out_at": {"$in": [None, ""]},
             "financial_locked": {"$ne": True}, "is_prepaid_program_session": True,
             "$and": [_NO_ADD_ONS, {"$or": [{"checkout_in_progress": {"$ne": True}}, {"checkout_started_at": {"$lt": stale}}]}]},
            {"$set": {"checkout_in_progress": True, "checkout_operation_id": op, "checkout_started_at": _g("now_iso")()}},
            projection={"_id": 0}, return_document=True)
        if not claim or _skip_reason(claim):
            return {"closed": False, "reason": "changed"}
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "training_credits": 1}) or {}
        if float(client.get("training_credits") or 0) >= 1:
            taken = await take_program_credit(claim)
            if taken[2] > 0:
                await db.clients.update_one({"id": cid}, {"$inc": {"training_credits": -1}})
        now = _g("now_iso")()
        ts = at or now
        update: Dict[str, Any] = {
            "status": "completed", "checked_out_at": ts,
            "checked_out_by": actor.get("id"), "checked_out_by_name": actor.get("name"),
            "financial_locked": True, "financial_locked_at": now, "financial_locked_by": actor.get("id"),
            "financial_revision": int(claim.get("financial_revision") or 0) + 1,
            "amount_paid": 0.0, "balance_due": 0.0,
            "prepaid_close": {"source": source, "log_ids": list(log_ids or []), "at": now,
                              "by": {"id": actor.get("id"), "name": actor.get("name")}},
        }
        if taken[2] > 0:
            value, redemptions, qty = taken
            update.update({"credit_value": value, "credit_lot_ids": [r["lot_id"] for r in redemptions],
                           "credit_lot_redemptions": redemptions, "credit_service_type": "training",
                           "credits_deducted": qty, "payment_status": "paid", "payment_method": "credits", "paid_at": ts})
            update.update(credit_cover.priced(value, value, False, 0.0))
        else:
            update.update(prepaid_sessions.checkout_without_credit())
        update["cash_revenue"] = _g("_cash_revenue")({**claim, **update})
        res = await db.bookings.update_one(
            {"id": booking_id, "checkout_operation_id": op, "checked_out_at": {"$in": [None, ""]}, **_NO_ADD_ONS},
            {"$set": update, "$unset": {"checkout_in_progress": "", "checkout_operation_id": "", "checkout_started_at": ""}})
        if not res.modified_count:
            raise RuntimeError("the session changed while it was being closed")
        closed = True
    except Exception as exc:
        if taken[2] > 0:   # hand back exactly what was taken
            try:
                await _g("_restore_credit_lots")(taken[1], taken[2])
                await db.clients.update_one({"id": cid}, {"$inc": {"training_credits": taken[2]}})
            except Exception:
                _logger.critical("prepaid close: could not hand back a credit for booking %s", booking_id)
        _logger.warning("prepaid close skipped for %s: %s", booking_id, exc)
        return {"closed": False, "reason": "changed" if isinstance(exc, RuntimeError) else "error"}
    finally:
        if not closed:
            try:
                await db.bookings.update_one({"id": booking_id, "checkout_operation_id": op},
                                             {"$unset": {"checkout_in_progress": "", "checkout_operation_id": "", "checkout_started_at": ""}})
            except Exception:
                pass
        try:
            await tab_sync.release_client_guard(guard)
        except Exception:
            _logger.warning("prepaid close: could not release the family's money lock for %s", cid)
    left = float((await db.clients.find_one({"id": cid}, {"_id": 0, "training_credits": 1}) or {}).get("training_credits") or 0)
    if not quiet:
        await _after_close(booking_id, cid, actor, ts, taken[2] > 0, left)
    return {"closed": True, "credit_used": taken[2] > 0, "credits_left": left}


async def _after_close(booking_id: str, cid: str, actor: dict, ts: str, used: bool, left: float) -> None:
    """What a desk checkout does afterwards that still applies — best effort."""
    token = _g("_checkout_operation_id_ctx").set(f"prepaid-close-bill-{booking_id}")
    try:
        await _g("_create_invoice_for_bookings")([booking_id], user=actor, ts=ts)
    except Exception:
        _logger.warning("prepaid close: bill for %s not created", booking_id)
    finally:
        _g("_checkout_operation_id_ctx").reset(token)
    if used:
        try:
            await _g("_maybe_send_low_credit_email")(cid, "training", left)
        except Exception:
            pass
    try:
        await _g("check_client_trophies")(_g("db"), cid)
    except Exception:
        pass


# ───────────────────────────────── going forward: Trainer Day finishes it

async def _cutoff() -> str:
    """When closing-on-finish began. Lessons logged before it belong to the
    one-time pass; lessons from it on are closed as they happen."""
    db = _g("db")
    doc = await db.system_runs.find_one_and_update(
        {"_id": JOB}, {"$setOnInsert": {"cutoff": _g("now_iso")()}}, upsert=True, return_document=True)
    return doc["cutoff"]


async def after_session_completed(*, booking: Optional[dict], draft: dict, plan: dict) -> Dict[str, Any]:
    """Called once the lesson is saved. Never raises."""
    try:
        await _cutoff()
        log = plan.get("log_doc") or {}
        actor = {"id": plan.get("completed_by"), "name": plan.get("completed_by_name")}
        if booking is None:
            booking = await _link_unlinked(log.get("id"), draft)
            if booking is None:
                return {"closed": False, "reason": "no_session"}
        return await close_session(booking["id"], actor=actor, log_ids=[log.get("id")] if log.get("id") else [],
                                   source="trainer_session")
    except Exception:
        _logger.exception("prepaid close after session %s failed", draft.get("id"))
        return {"closed": False, "reason": "error"}


async def _link_unlinked(log_id: Optional[str], draft: dict) -> Optional[dict]:
    """Match a lesson logged without its booking, and write the answer on the
    lesson (`prepaid_session_id`: the session, or "" for none) so the sweep
    retries a close that couldn't run and never re-matches it to a session
    booked later. `booking_id` itself is left alone — other readers use it."""
    booking = await _match_unlinked(draft)
    if log_id:
        await _g("db").training_session_log.update_one(
            {"id": log_id, "prepaid_session_id": {"$exists": False}},
            {"$set": {"prepaid_session_id": booking["id"] if booking else ""}})
    return booking


async def _match_unlinked(draft: dict) -> Optional[dict]:
    """A lesson logged without its booking: the one open program session of
    the same dog, program and day — only when exactly one fits."""
    db = _g("db")
    enrollment = await db.dog_programs.find_one({"id": draft.get("enrollment_id")}, {"_id": 0, "dog_id": 1, "program_id": 1})
    day = draft.get("occurrence_date")
    if not enrollment or not day or not enrollment.get("program_id"):
        return None
    rows = await db.bookings.find(
        {"dog_id": enrollment["dog_id"], "date": day, "program_id": enrollment["program_id"],
         "is_prepaid_program_session": True, "status": "approved"}, {"_id": 0}).to_list(3)
    rows = [r for r in rows if prepaid_sessions.is_open(r)]
    return rows[0] if len(rows) == 1 else None


async def sweep() -> Dict[str, int]:
    """Hourly: sessions a trainer finished since the cutoff that are still
    open (the family was busy, the process restarted) get closed now."""
    db = _g("db")
    cutoff = await _cutoff()
    marker = await db.system_runs.find_one({"_id": JOB}, {"_id": 0, "last_sweep_at": 1}) or {}
    if marker.get("last_sweep_at") and marker["last_sweep_at"] > (_now() - SWEEP_EVERY).isoformat():
        return {"skipped": 1}
    await db.system_runs.update_one({"_id": JOB}, {"$set": {"last_sweep_at": _g("now_iso")()}})
    out = {"closed": 0, "left": 0}
    logs = await db.training_session_log.find(
        {"at": {"$gte": cutoff}, "$or": [{"booking_id": {"$nin": [None, ""]}}, {"prepaid_session_id": {"$nin": [None, ""]}},
                                         {"prepaid_session_id": {"$exists": False}}]},
        {"_id": 0, "id": 1, "booking_id": 1, "prepaid_session_id": 1, "draft_id": 1, "by_user": 1}).to_list(None)
    by_booking: Dict[str, List[dict]] = {}
    for lg in logs:
        bid = lg.get("booking_id") or lg.get("prepaid_session_id")
        if not bid:   # logged without its booking and never matched (the process stopped first)
            draft = await db.training_session_drafts.find_one({"id": lg.get("draft_id")}, {"_id": 0}) if lg.get("draft_id") else None
            match = await _link_unlinked(lg["id"], draft or {})
            bid = match["id"] if match else None
        if bid:
            by_booking.setdefault(bid, []).append(lg)
    still_open = await db.bookings.find(
        {"id": {"$in": list(by_booking)}, "is_prepaid_program_session": True, "status": "approved",
         "checked_out_at": {"$in": [None, ""]}, **_NO_ADD_ONS}, {"_id": 0, "id": 1}).to_list(None)
    for row in still_open:
        lgs = by_booking[row["id"]]
        res = await close_session(row["id"], actor={"id": "trainer_session", "name": lgs[0].get("by_user") or "Trainer"},
                                  log_ids=[x["id"] for x in lgs], source="trainer_session")
        out["closed" if res.get("closed") else "left"] += 1
    return out


# ─────────────────────────────── once: lessons already taught, never closed

def _ohio_day(ts: str) -> str:
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(_g("BUSINESS_TZ")).date().isoformat()
    except Exception:
        return str(ts)[:10]


async def past_pass() -> Dict[str, Any]:
    """Runs until done, once. Program credits only, dated the lesson, no bills
    or emails. Returns the stored summary."""
    db = _g("db")
    cutoff = await _cutoff()
    now = _g("now_iso")()
    stale = (_now() - timedelta(minutes=30)).isoformat()
    marker = await db.system_runs.find_one_and_update(
        {"_id": JOB, "pass_done_at": {"$exists": False},
         "$or": [{"pass_running_since": {"$exists": False}}, {"pass_running_since": {"$lt": stale}}]},
        {"$set": {"pass_running_since": now}}, return_document=True)
    if not marker:
        return {"skipped": True}
    run_id = marker.get("pass_run_id") or str(uuid.uuid4())
    families: Dict[str, Dict[str, Any]] = {f["client_id"]: f for f in (marker.get("pass_families") or [])}
    busy = False
    try:
        logs = await db.training_session_log.find(
            {"booking_id": {"$nin": [None, ""]}, "at": {"$lt": cutoff}}, {"_id": 0, "id": 1, "booking_id": 1, "at": 1, "by_user": 1}
        ).to_list(None)
        by_booking: Dict[str, List[dict]] = {}
        for lg in logs:
            by_booking.setdefault(lg["booking_id"], []).append(lg)
        rows = await db.bookings.find(
            {"id": {"$in": list(by_booking)}, "is_prepaid_program_session": True, "status": {"$in": ["pending", "approved"]},
             "checked_out_at": {"$in": [None, ""]}}, {"_id": 0}).to_list(None)
        rows.sort(key=lambda r: (r.get("client_id") or "", r.get("date") or ""))
        hand_adjusted = await _hand_adjusted_families(rows, by_booking)
        for b in rows:
            fam = _family(families, b)
            done_ids = {x["booking_id"] for x in fam["closed"]} | {x["booking_id"] for x in fam["needs_a_look"]}
            if b["id"] in done_ids:
                continue
            lgs = sorted(by_booking[b["id"]], key=lambda x: x.get("at") or "")
            first_at = lgs[0].get("at") or b.get("date")
            why = await _needs_a_look(b, first_at, hand_adjusted)
            row = {"booking_id": b["id"], "date": b.get("date"), "dog_name": b.get("dog_name") or "", "taught_at": first_at}
            if why:
                fam["needs_a_look"].append({**row, "why": why})
                continue
            res = await close_session(b["id"], actor={"id": "past_lessons_pass", "name": lgs[0].get("by_user") or "Trainer"},
                                      log_ids=[x["id"] for x in lgs], source="past_lessons_pass", at=first_at, quiet=True)
            if res.get("reason") == "busy":
                busy = True
                continue
            if not res.get("closed"):
                fam["needs_a_look"].append({**row, "why": "changed while closing"})
                continue
            fam["closed"].append({**row, "credit_used": bool(res.get("credit_used"))})
        await _list_unlinked_past(cutoff, set(by_booking), families)
        await _rebuild_closed(families)   # a run that was cut off still reports what it closed
        for f in families.values():
            c = await db.clients.find_one({"id": f["client_id"]}, {"_id": 0, "training_credits": 1}) or {}
            f["credits_left"] = float(c.get("training_credits") or 0)
        fam_list = [f for f in families.values() if f["closed"] or f["needs_a_look"]]
        upd: Dict[str, Any] = {"pass_run_id": run_id, "pass_families": fam_list}
        if not busy:
            upd["pass_done_at"] = _g("now_iso")()
            for f in fam_list:
                try:
                    await _g("check_client_trophies")(db, f["client_id"])
                except Exception:
                    pass
        await db.system_runs.update_one({"_id": JOB}, {"$set": upd, "$unset": {"pass_running_since": ""}})
        return upd
    except Exception:
        _logger.exception("prepaid past-lessons pass failed")
        await db.system_runs.update_one({"_id": JOB}, {"$unset": {"pass_running_since": ""},
                                                       "$set": {"pass_families": list(families.values()), "pass_run_id": run_id}})
        return {"error": True}


def _family(families: Dict[str, Dict[str, Any]], b: dict) -> Dict[str, Any]:
    return families.setdefault(b["client_id"], {"client_id": b["client_id"], "client_name": b.get("client_name") or "",
                                                "closed": [], "needs_a_look": []})


async def _list_unlinked_past(cutoff: str, linked: set, families: Dict[str, Dict[str, Any]]) -> None:
    """Past lessons logged from the dog's page (no booking on the lesson) are
    never closed by the pass — the open program sessions of that dog,
    program and day are listed for a person to check."""
    db = _g("db")
    logs = await db.training_session_log.find(
        {"booking_id": {"$in": [None, ""]}, "at": {"$lt": cutoff}},
        {"_id": 0, "dog_id": 1, "enrollment_id": 1, "program_id": 1, "draft_id": 1, "at": 1}).to_list(None)
    seen = set()
    for lg in logs:
        enr = await db.dog_programs.find_one({"id": lg.get("enrollment_id")}, {"_id": 0, "program_id": 1}) or {}
        draft = await db.training_session_drafts.find_one({"id": lg.get("draft_id")}, {"_id": 0, "occurrence_date": 1}) \
            if lg.get("draft_id") else None
        pid = enr.get("program_id") or lg.get("program_id")
        day = (draft or {}).get("occurrence_date") or _ohio_day(lg.get("at"))
        if not pid or not lg.get("dog_id"):
            continue
        for b in await db.bookings.find(
                {"dog_id": lg["dog_id"], "date": day, "program_id": pid, "is_prepaid_program_session": True,
                 "status": {"$in": ["pending", "approved"]}, "checked_out_at": {"$in": [None, ""]}}, {"_id": 0}).to_list(10):
            if b["id"] in linked or b["id"] in seen or not prepaid_sessions.is_open(b):
                continue
            seen.add(b["id"])
            fam = _family(families, b)
            if any(x["booking_id"] == b["id"] for x in fam["needs_a_look"] + fam["closed"]):
                continue
            fam["needs_a_look"].append({"booking_id": b["id"], "date": b.get("date"), "dog_name": b.get("dog_name") or "",
                                        "taught_at": lg.get("at"),
                                        "why": "a lesson was recorded from the dog's page that day, not from this session"})


async def _rebuild_closed(families: Dict[str, Dict[str, Any]]) -> None:
    """Every session the pass ever closed, read back from the visits (and the
    archive, where old visits move) — so an interrupted run loses nothing."""
    q = {"prepaid_close.source": "past_lessons_pass"}
    proj = {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "date": 1, "dog_name": 1, "checked_out_at": 1, "credits_deducted": 1}
    rows = await _g("_booking_rows_anywhere")(q, proj)
    for b in sorted(rows, key=lambda r: r.get("date") or ""):
        fam = _family(families, b)
        if any(x["booking_id"] == b["id"] for x in fam["closed"]):
            continue
        fam["needs_a_look"] = [x for x in fam["needs_a_look"] if x["booking_id"] != b["id"]]
        fam["closed"].append({"booking_id": b["id"], "date": b.get("date"), "dog_name": b.get("dog_name") or "",
                              "taught_at": b.get("checked_out_at"), "credit_used": float(b.get("credits_deducted") or 0) > 0})


async def _hand_adjusted_families(rows: List[dict], by_booking: Dict[str, List[dict]]) -> set:
    """Families whose training credits were lowered by hand on or after their
    first open taught session — someone may already have settled these
    lessons, so the whole family waits for a person."""
    db = _g("db")
    first: Dict[str, str] = {}
    for b in rows:
        at = min((x.get("at") or "") for x in by_booking[b["id"]])
        if at and (b["client_id"] not in first or at < first[b["client_id"]]):
            first[b["client_id"]] = at
    out = set()
    for cid, since in first.items():
        if await db.credit_adjustments.find_one({"client_id": cid, "adjusted_at": {"$gte": since},
                                                 "changes.training.delta": {"$lt": 0}}, {"_id": 1}):
            out.add(cid)
    return out


async def _needs_a_look(b: dict, first_at: str, hand_adjusted: set) -> Optional[str]:
    db = _g("db")
    if b["client_id"] in hand_adjusted:
        return "training credits were changed by hand since this lesson"
    reason = _skip_reason(b)
    if reason == "not_approved":
        return "still a request (pending)"
    if reason == "add_ons":
        return "has add-ons to charge at the desk"
    if reason == "friends_family":
        return "billed to another family"
    if reason:
        return f"can't be closed automatically ({reason})"
    if (b.get("date") or "") > _ohio_day(first_at):
        return "moved to a later date after the lesson was recorded"
    charged = {"$or": [{"credits_deducted": {"$gt": 0}}, {"credit_value": {"$gt": 0}}, {"amount_paid": {"$gt": 0}},
                       {"balance_due": {"$gt": 0}}, {"cash_revenue": {"$gt": 0}}, {"gift_card_funded": {"$gt": 0}},
                       {"payment_status": {"$in": ["paid", "paid_partial", "unpaid"]}, "actual_price": {"$gt": 0}}]}
    other = await _g("_booking_rows_anywhere")(
        {"dog_id": b.get("dog_id"), "date": b.get("date"), "id": {"$ne": b["id"]}, "service_type": "training",
         "status": "completed", **charged}, {"_id": 0, "id": 1}, limit=1)
    if other:
        return "the dog had another paid training visit that day"
    return None


_SNAPSHOT = ("bookings", "clients", "credit_lots")


async def rearm_after_restore(db, collections, mode: str) -> None:
    """A full restore of visits, families and credit lots can bring back
    sessions the one-time pass had closed, open again with their credits —
    so the pass runs again (it only closes what is open, so a snapshot taken
    after it changes nothing). A partial or merge restore leaves it alone:
    it could reopen a session whose credit is already gone."""
    if mode != "replace" or not all(c in (collections or {}) for c in _SNAPSHOT):
        return
    await db.system_runs.update_one(
        {"_id": JOB}, {"$unset": {"pass_done_at": "", "pass_families": "", "pass_running_since": ""}})


async def run_job() -> Dict[str, Any]:
    """The scheduler's job: the one-time pass until it is done, then the sweep."""
    marker = await _g("db").system_runs.find_one({"_id": JOB}, {"_id": 0, "pass_done_at": 1}) or {}
    out: Dict[str, Any] = {}
    if not marker.get("pass_done_at"):
        out["past_pass"] = await past_pass()
    out["sweep"] = await sweep()
    return out


# ─────────────────────────────────────────── the owner's summary on Today

def _family_line(f: dict) -> Dict[str, str]:
    closed = f.get("closed") or []
    used = sum(1 for x in closed if x.get("credit_used"))
    zero = len(closed) - used
    title = f"{f.get('client_name') or 'A family'} · {len(closed)} past lesson{'s' if len(closed) != 1 else ''} closed · " \
            f"{used} training credit{'s' if used != 1 else ''} used"
    bits = []
    if closed:
        bits.append("Lessons: " + ", ".join(sorted({x.get('date') or '' for x in closed})))
    if zero:
        bits.append(f"{zero} closed at $0 (no program credit left)")
    if f.get("needs_a_look"):
        bits.append("Needs a look: " + "; ".join(f"{x.get('date')} — {x.get('why')}" for x in f["needs_a_look"]))
    if f.get("credits_left") is not None:
        bits.append(f"{f['credits_left']:g} training credits left")
    return {"title": title, "subtitle": " · ".join(bits)}


async def today_brain_items(user: dict) -> List[dict]:
    """One row per family for SUMMARY_DAYS after the one-time pass — owners
    and anyone with finance reports. Hide works like any Today row."""
    try:
        if not (_g("_perms_for")(user) or {}).get("finance_reports"):
            return []
        m = await _g("db").system_runs.find_one({"_id": JOB}, {"_id": 0, "pass_done_at": 1, "pass_run_id": 1, "pass_families": 1}) or {}
        done = m.get("pass_done_at")
        if not done or done < (_now() - timedelta(days=SUMMARY_DAYS)).isoformat():
            return []
        out = []
        for f in m.get("pass_families") or []:
            line = _family_line(f)
            needs = bool(f.get("needs_a_look")) or any(not x.get("credit_used") for x in f.get("closed") or [])
            out.append({"id": f"prepaid-closed:{m.get('pass_run_id')}:{f['client_id']}", "kind": "prepaid_sessions_closed",
                        "priority": "warn" if needs else "info", "title": line["title"], "subtitle": line["subtitle"],
                        "ts": done, "cta": {"type": "open_client", "id": f["client_id"]}, "icon": "fa-graduation-cap"})
        return out
    except Exception:
        _logger.warning("prepaid close: Today summary failed", exc_info=True)
        return []


def register_routes(*, api, server_globals: dict) -> None:
    need = server_globals["require_admin_and_permission"]

    async def past_close_summary(_: dict = Depends(need("finance_reports"))):
        m = await _g("db").system_runs.find_one({"_id": JOB}, {"_id": 0}) or {}
        return {"cutoff": m.get("cutoff"), "done_at": m.get("pass_done_at"), "families": m.get("pass_families") or []}

    api.add_api_route("/admin/prepaid-sessions/past-close", past_close_summary, methods=["GET"])
