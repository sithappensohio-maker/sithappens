"""Removing training history for good.

Two owner actions share one remover:

* Remove Online School (Settings, while Online School is off): every Online
  School and hybrid enrollment with all of its history, the online-only
  courses, and the online settings on programs that are also taught in person.
* Delete a program with its history (Shop Manager): the program and every
  enrollment in it, whatever the channel.

What an enrollment leaves behind is removed with it: the School copy
(school_enrollments), session plans and logs, lessons, quizzes, checkpoints,
Trainer Assist cases, practice and its uploads, notifications, notes and plans.
Money is never touched: sales, orders, payments, refunds, credit lots, the
family's training credits, payment plans, bills and bookings keep their own
copies of names and amounts, and unused prepaid sessions stay on the family's
training credits. Client message threads are kept and only unlinked.

Both refuse while something still in progress depends on the history: a
program session booked or not checked out (its session log is the proof it was
taught, and its credit is only used at checkout), an open Board & Train stay,
a Board & Train service linked to the program, or an online order not yet
fulfilled (fulfillment reads the program).

Mongo here has no transactions, so the remover goes children first and the
enrollment last, and every step is safe to run again: a run that stops part
way is finished by running it again. Every hard delete goes through the
deletion log so a later merge restore does not bring the rows back.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from domains.backup import deletion_log

# The channels that carry Online School lessons. Hybrid goes with them (owner decision).
ONLINE_CHANNELS = ("online_school", "hybrid_school")
ONLINE_SE_MODES = ("self_guided", "hybrid")
STAFF_CHANNELS = ("in_person_school", "hybrid_school")
OPEN_VISIT = ("pending", "approved")   # a dog on site is approved and checked in, not yet checked out

# Rows that belong to one enrollment, linked by the School copy's id
# (school_enrollment_id) or the enrollment's own id (enrollment_id).
ENROLLMENT_CHILDREN = (
    "checkpoint_submissions", "school_quiz_attempts", "school_events", "school_notifications",
    "school_training_plans", "school_student_notes", "school_requests",
)
# Trainer-led history, linked by the enrollment's own id. Drafts go first: a
# session being finished right now stops at its draft check instead of writing
# a log or practice after they are gone.
SESSION_CHILDREN = ("training_session_drafts", "training_session_log")

THREAD_SCHOOL_FIELDS = (
    "school_enrollment_id", "school_enrollment_record_id", "school_program_id", "school_program_name",
    "school_module_id", "school_module_name", "school_lesson_id", "school_lesson_name",
    "school_homework_id", "school_checkpoint_id", "school_dog_id",
)
# Links a kept enrollment may hold to a removed one (retakes, migrated legacy rows).
LINEAGE_FIELDS = ("legacy_source_enrollment_id", "replaces_legacy_enrollment_id", "retake_of_enrollment_id",
                  "legacy_migrated_to_enrollment_id")


async def online_school_off(db) -> bool:
    """Is Online School turned off? Read the way server._feature_enabled reads it:
    no setting means on. For modules that have the database but not server.py."""
    s = await db.settings.find_one({"id": "global"}, {"feature_visibility": 1}) or {}
    fv = s.get("feature_visibility") or {}
    return "online_school" in fv and not fv.get("online_school")


async def open_course_practice(db) -> Dict[str, Any]:
    """A homework filter that leaves out Practice of Online School and hybrid
    courses while Online School is off (no reminder or recap email), or {}
    while it is on."""
    if not await online_school_off(db):
        return {}
    dp_ids = [r["id"] for r in await db.dog_programs.find(
        {"delivery_channel": {"$in": list(ONLINE_CHANNELS)}}, {"_id": 0, "id": 1}).to_list(None)]
    se_ids = [r["id"] for r in await db.school_enrollments.find(
        {"$or": [{"enrollment_id": {"$in": dp_ids}}, {"delivery_mode": {"$in": list(ONLINE_SE_MODES)}}]},
        {"_id": 0, "id": 1}).to_list(None)]
    return {"school_enrollment_record_id": {"$nin": dp_ids}, "school_enrollment_id": {"$nin": se_ids}}


async def refuse_closed_course(db, dp: dict) -> None:
    """A client page of an Online School or hybrid course while Online School is off."""
    if dp.get("delivery_channel") in ONLINE_CHANNELS and await online_school_off(db):
        raise HTTPException(status_code=404, detail="This course is no longer available.")


def _either(field_a: str, ids_a: List[str], field_b: str, ids_b: List[str]) -> Optional[dict]:
    """{"$or": [...]} over the non-empty id lists, or None when both are empty."""
    parts = [{f: {"$in": ids}} for f, ids in ((field_a, ids_a), (field_b, ids_b)) if ids]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else {"$or": parts}


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


class _Run:
    """Counts what a removal touches; deletes only when `apply` is on, so the
    preview and the removal read the same rows the same way."""

    def __init__(self, db, apply: bool):
        self.db, self.apply = db, apply
        self.counts: Dict[str, int] = {}

    def _add(self, key: str, n: int) -> None:
        if n:
            self.counts[key] = self.counts.get(key, 0) + n

    async def delete(self, collection: str, flt: Optional[dict]) -> int:
        if flt is None:
            return 0
        if self.apply:
            n = await deletion_log.delete_many(self.db, collection, flt)
        else:
            n = await self.db[collection].count_documents(flt)
        self._add(collection, n)
        return n

    async def ids(self, collection: str, flt: Optional[dict], field: str = "id") -> List[Any]:
        if flt is None:
            return []
        rows = await self.db[collection].find(flt, {"_id": 0 if field != "_id" else 1, field: 1}).to_list(None)
        return [r[field] for r in rows if r.get(field) not in (None, "")]

    def summary(self) -> Dict[str, int]:
        return {"records": sum(n for k, n in self.counts.items() if k not in ("files", "programs")),
                "files": self.counts.get("files", 0)}


async def _repoint_dogs(db, dp_ids: List[str]) -> None:
    """A dog whose front-desk pointer names a removed enrollment moves to its
    oldest other active staff-led course, or none (same rule as a finished course)."""
    for dog in await db.dogs.find({"active_program_id": {"$in": dp_ids}}, {"_id": 0, "id": 1, "active_program_id": 1}).to_list(None):
        other = await db.dog_programs.find_one(
            {"dog_id": dog["id"], "status": "active", "id": {"$nin": dp_ids}, "delivery_channel": {"$in": list(STAFF_CHANNELS)}},
            {"_id": 0, "id": 1}, sort=[("created_at", 1), ("id", 1)])
        await db.dogs.update_one({"id": dog["id"], "active_program_id": dog["active_program_id"]},
                                 {"$set": {"active_program_id": (other or {}).get("id")}})


async def remove_enrollments(run: _Run, dp_ids: Iterable[str], se_ids: Iterable[str], *, media_path) -> None:
    """Remove these enrollments (dog_programs ids) and School copies
    (school_enrollments ids) with everything under them."""
    db = run.db
    dp_ids, se_ids = sorted(set(dp_ids)), sorted(set(se_ids))
    if not dp_ids and not se_ids:
        return
    child = _either("school_enrollment_id", se_ids, "enrollment_id", dp_ids)
    by_enrollment = {"enrollment_id": {"$in": dp_ids}} if dp_ids else None

    await run.delete(SESSION_CHILDREN[0], by_enrollment)
    log_ids = await run.ids("training_session_log", by_enrollment)

    # Checkpoints: their videos, and the bookings that point at a Trainer Assist case.
    checkpoints = await db.checkpoint_submissions.find(child, {"_id": 0, "id": 1, "video_media_id": 1}).to_list(None)
    checkpoint_ids = [c["id"] for c in checkpoints]
    video_ids = [c["video_media_id"] for c in checkpoints if c.get("video_media_id")]

    # Practice the enrollment assigned: School-linked rows, the auto-assigned rows it logged,
    # and rows its sessions created (a crashed finish can leave one reachable only that way).
    auto_hw: List[str] = []
    for dp in await db.dog_programs.find({"id": {"$in": dp_ids}}, {"_id": 0, "auto_homework_log": 1}).to_list(None):
        auto_hw += [a.get("homework_id") for a in dp.get("auto_homework_log") or [] if a.get("homework_id")]
    hw_ids = set(await run.ids("homework", _either("school_enrollment_id", se_ids, "school_enrollment_record_id", dp_ids)))
    hw_ids |= set(await run.ids("homework", {"source_session_log_id": {"$in": log_ids}} if log_ids else None))
    hw_ids = sorted(hw_ids | set(auto_hw))

    media_parts = [p for p in (
        {"homework_id": {"$in": hw_ids}} if hw_ids else None,
        {"school_enrollment_id": {"$in": se_ids}} if se_ids else None,
        {"id": {"$in": video_ids}} if video_ids else None,
    ) if p]
    media_flt = {"$or": media_parts} if media_parts else None
    if media_flt is not None:
        files = await db.homework_media.find(media_flt, {"_id": 0, "storage_path": 1}).to_list(None)
        on_disk = [p for p in (media_path(f) for f in files) if p]   # only files inside the School media folder
        run._add("files", len(on_disk))
        await run.delete("homework_media", media_flt)
        if run.apply:
            for p in on_disk:   # after the rows: a row never points at a missing file
                try:
                    Path(p).unlink(missing_ok=True)
                except OSError:
                    pass

    if hw_ids:
        await run.delete("step_events", {"homework_id": {"$in": hw_ids}})
        await run.delete("homework", {"id": {"$in": hw_ids}})

    # School emails not yet sent are dropped from the outbox (not a backed-up record).
    if run.apply:
        notif_keys = [f"school_notif:{k}" for k in await run.ids("school_notifications", child, "dedupe_key")]
        if notif_keys:
            await db.email_outbox.delete_many({"key": {"$in": notif_keys}, "status": "pending"})

    for coll in ENROLLMENT_CHILDREN:
        await run.delete(coll, child)
    feedback_ids = await run.ids("school_experience_feedback", child, "_id")
    if feedback_ids:
        await run.delete("school_experience_feedback_history", {"feedback_id": {"$in": feedback_ids}})
        await run.delete("school_experience_feedback", {"_id": {"$in": feedback_ids}})
    await run.delete(SESSION_CHILDREN[1], by_enrollment)

    if run.apply:
        # Kept, unlinked: conversations, bookings, and other enrollments that pointed here.
        if se_ids:
            await db.client_message_threads.update_many(
                {"school_enrollment_id": {"$in": se_ids}}, {"$unset": {f: "" for f in THREAD_SCHOOL_FIELDS}})
            await db.school_enrollments.update_many(
                {"retake_of_school_enrollment_id": {"$in": se_ids}}, {"$unset": {"retake_of_school_enrollment_id": ""}})
        for coll in ("bookings", "bookings_archive"):
            if checkpoint_ids:
                await db[coll].update_many({"trainer_assist_case_id": {"$in": checkpoint_ids}},
                                           {"$unset": {"trainer_assist_case_id": ""}})
            if dp_ids:
                await db[coll].update_many({"package_enrolled_program_id": {"$in": dp_ids}},
                                           {"$unset": {"package_enrolled_program_id": ""}})
        if dp_ids:
            for coll in ("dog_programs", "school_enrollments"):
                for field in LINEAGE_FIELDS:
                    await db[coll].update_many({field: {"$in": dp_ids}}, {"$unset": {field: ""}})
                await db[coll].update_many({"legacy_history_enrollment_ids": {"$in": dp_ids}},
                                           {"$pull": {"legacy_history_enrollment_ids": {"$in": dp_ids}}})
            await _repoint_dogs(db, dp_ids)

    # The enrollment last: while it exists, running this again finds everything above.
    await run.delete("school_enrollments", _either("id", se_ids, "enrollment_id", dp_ids))
    await run.delete("dog_programs", {"id": {"$in": dp_ids}} if dp_ids else None)


def _unfinished_line(line: dict, program_ids: List[str], course_orders: bool) -> bool:
    """A program line the shop still has to fulfil: not fulfilled, not refunded."""
    if line.get("kind") != "training_program" or line.get("fulfillment_status") in ("fulfilled", "refunded"):
        return False
    if int(line.get("quantity_refunded") or 0) >= int(line.get("quantity") or 1):
        return False   # a refund leaves the line's own status as it was
    return line.get("ref_id") in program_ids or (course_orders and line.get("fulfillment_kind") == "online_school")


async def removal_blockers(db, dp_ids: List[str], program_ids: List[str], *, course_orders: bool = False) -> List[str]:
    """What must be finished first. Each of these still depends on the history
    or on the program row, and is money or a dog on site. `course_orders` also
    counts unfinished Online School course orders for any program (their
    fulfillment would now be refused)."""
    out: List[str] = []
    # Open visits of the program, of a removed staff-led enrollment (its sessions carry only the dog
    # and the program, so they belong to a kept active enrollment of the same pair when there is one;
    # online-only enrollments have no sessions), and visits the removed lessons were recorded against.
    either: List[dict] = [{"program_id": {"$in": program_ids}}] if program_ids else []
    for d in await db.dog_programs.find({"id": {"$in": dp_ids}, "delivery_channel": {"$in": list(STAFF_CHANNELS)}},
                                        {"_id": 0, "dog_id": 1, "program_id": 1}).to_list(None):
        dog, prog = d.get("dog_id"), d.get("program_id")
        if not dog or not prog or prog in program_ids:
            continue
        if await db.dog_programs.count_documents({"dog_id": dog, "program_id": prog, "status": "active", "id": {"$nin": dp_ids}}):
            continue
        either.append({"dog_id": dog, "program_id": prog})
    taught: set = set()
    if dp_ids:
        for coll, fields in (("training_session_drafts", ("booking_id",)), ("training_session_log", ("booking_id", "prepaid_session_id"))):
            for r in await db[coll].find({"enrollment_id": {"$in": dp_ids}}, {"_id": 0, **{f: 1 for f in fields}}).to_list(None):
                taught.update(r[f] for f in fields if r.get(f))
    if taught:
        either.append({"id": {"$in": sorted(taught)}})
    if either:
        n = await db.bookings.count_documents({"status": {"$in": list(OPEN_VISIT)}, "$or": either})
        if n:
            out.append(f"{_plural(n, 'training visit')} for it {'is' if n == 1 else 'are'} still booked or not checked out. "
                       f"Check out or cancel {'it' if n == 1 else 'them'} on the Schedule first.")
    if dp_ids:
        n = await db.bookings.count_documents({"package_enrolled_program_id": {"$in": dp_ids}, "status": {"$in": list(OPEN_VISIT)}})
        if n:
            out.append(f"{_plural(n, 'Board & Train stay')} still open. Check {'it' if n == 1 else 'them'} out first.")
    if program_ids:
        services = await db.services.find({"package_program_id": {"$in": program_ids}}, {"_id": 0, "name": 1}).to_list(None)
        if services:
            names = ", ".join(s.get("name") or "A service" for s in services)
            out.append(f"{names} uses it as its Board & Train program. Link that service to another program first (Settings → Services).")
    which = ([{"ref_id": {"$in": program_ids}}] if program_ids else []) + \
            ([{"fulfillment_kind": "online_school"}] if course_orders else [])
    if which:
        orders = await db.shop_orders.find({"status": {"$in": ["pending_payment", "paid"]}, "lines": {"$elemMatch": {
            "kind": "training_program", "fulfillment_status": {"$nin": ["fulfilled", "refunded"]}, "$or": which}}},
            {"_id": 0, "lines": 1}).to_list(None)
        n = sum(1 for o in orders if any(_unfinished_line(l, program_ids, course_orders) for l in o.get("lines") or []))
        if n:
            out.append(f"{_plural(n, 'online order')} for it {'is' if n == 1 else 'are'} not finished. "
                       "Finish or refund them first (Front Desk → Online Orders).")
    return out


async def money_notes(db, program_ids: List[str]) -> List[str]:
    """Money that stays, said up front."""
    out: List[str] = []
    if not program_ids:
        return out
    lots = await db.credit_lots.find({"program_id": {"$in": program_ids}, "qty_remaining": {"$gt": 0},
                                      "voided_at": None, "refund_status": {"$ne": "refunded"}},
                                     {"_id": 0, "client_id": 1, "qty_remaining": 1}).to_list(None)
    if lots:
        qty = sum(int(l.get("qty_remaining") or 0) for l in lots)
        families = len({l.get("client_id") for l in lots})
        out.append(f"{_plural(qty, 'prepaid session')} bought for it {'is' if qty == 1 else 'are'} unused "
                   f"({_plural(families, 'family', 'families')}). They stay on those families' training credits.")
    plans = await db.payment_plans.count_documents({"program_id": {"$in": program_ids}, "installments.status": "due"})
    if plans:
        out.append(f"{_plural(plans, 'payment plan')} for it still {'has' if plans == 1 else 'have'} payments due. "
                   f"{'It stays' if plans == 1 else 'They stay'} as {'it is' if plans == 1 else 'they are'}.")
    agreements = await db.agreement_templates.count_documents({"scope_type": "program_id", "scope_value": {"$in": program_ids}})
    if agreements:
        out.append(f"{_plural(agreements, 'agreement')} only applied to it and will no longer be asked for. Signed copies stay.")
    return out


def is_online_course(program: dict) -> bool:
    """A program set up to give Online School access in any way."""
    return (program.get("delivery_mode") in ("self_guided", "both")
            or program.get("purchase_fulfillment") == "online_school"
            or bool(program.get("free_enrollment_enabled")))


def sold_as_course(program: dict) -> bool:
    return program.get("purchase_fulfillment") == "online_school" or program.get("delivery_mode") == "self_guided"


def online_settings_off(program: dict) -> dict:
    """The patch that leaves a program as in-person training only. A program
    that was sold as a course comes off the online Shop and the register:
    its price and count were for course access, and would now sell training
    credits usable at any lesson."""
    patch: Dict[str, Any] = {"purchase_fulfillment": "credits_only", "free_enrollment_enabled": False}
    if program.get("delivery_mode") in ("self_guided", "both"):
        patch["delivery_mode"] = "trainer_led"
    if sold_as_course(program):
        patch["available_online"] = False
        patch["show_at_register"] = False
    return patch


async def remove_program_row(run: _Run, program: dict) -> None:
    """Delete one program and the links other records keep to it. Its
    enrollments must already be gone. Through the deletion log, which also
    keeps the standard programs from being re-seeded."""
    db, pid, slug = run.db, program["id"], program.get("slug")
    if run.apply:
        if slug:
            # A missing prerequisite blocks saving the program that lists it; drop the slug instead.
            # An unpublished Program Studio draft too: publishing it would put the slug back.
            for base in ("", "draft."):
                await db.programs.update_many(
                    {"id": {"$ne": pid}, "$or": [{f"{base}prereq_slugs": slug}, {f"{base}recommended_next_program_slugs": slug}]},
                    {"$pull": {f"{base}prereq_slugs": slug, f"{base}recommended_next_program_slugs": slug}})
        ref = {"kind": "training_program", "ref_id": pid}
        for coll in ("pos_products", "credit_packs", "programs"):
            await db[coll].update_many({"shop_relationships": {"$elemMatch": ref}}, {"$pull": {"shop_relationships": ref}})
        await db.programs.update_many({"draft.shop_relationships": {"$elemMatch": ref}}, {"$pull": {"draft.shop_relationships": ref}})
        # Only where another program remains: a resource with no programs and no lessons is shown
        # to every School student. A resource left naming only this program reaches no one.
        await db.school_resources.update_many({"program_ids": pid, "program_ids.1": {"$exists": True}},
                                              {"$pull": {"program_ids": pid}})
    await run.delete("shop_favorites", {"kind": "training_program", "ref_id": pid})
    # Ratings are kept per client, dog and program; the storefront would still average them.
    feedback_ids = await run.ids("school_experience_feedback", {"program_id": pid}, "_id")
    if feedback_ids:
        await run.delete("school_experience_feedback_history", {"feedback_id": {"$in": feedback_ids}})
        await run.delete("school_experience_feedback", {"_id": {"$in": feedback_ids}})
    await run.delete("programs", {"id": pid})


async def _people(db, dp_ids: List[str]) -> Dict[str, int]:
    rows = await db.dog_programs.find({"id": {"$in": dp_ids}}, {"_id": 0, "dog_id": 1, "status": 1}).to_list(None)
    dog_ids = {r.get("dog_id") for r in rows if r.get("dog_id")}
    owners = await db.dogs.find({"id": {"$in": list(dog_ids)}}, {"_id": 0, "owner_id": 1}).to_list(None)
    return {
        "enrollments": len(rows), "dogs": len(dog_ids),
        "clients": len({o.get("owner_id") for o in owners if o.get("owner_id")}),
        "active": sum(1 for r in rows if r.get("status") == "active"),
    }


async def online_school_targets(db) -> Dict[str, Any]:
    """Every Online School and hybrid enrollment, its School copy, and what
    happens to each program set up for Online School."""
    dp_ids = [r["id"] for r in await db.dog_programs.find(
        {"delivery_channel": {"$in": list(ONLINE_CHANNELS)}}, {"_id": 0, "id": 1}).to_list(None)]
    se_rows = await db.school_enrollments.find(
        {"$or": [{"enrollment_id": {"$in": dp_ids}}, {"delivery_mode": {"$in": list(ONLINE_SE_MODES)}}]},
        {"_id": 0, "id": 1, "enrollment_id": 1}).to_list(None)
    # An online School copy whose enrollment is in another channel is not ours; one whose
    # enrollment is gone is a leftover and goes too.
    others = {r["id"] for r in await db.dog_programs.find(
        {"id": {"$in": [s.get("enrollment_id") for s in se_rows if s.get("enrollment_id") not in dp_ids]}},
        {"_id": 0, "id": 1}).to_list(None)}
    se_ids = [s["id"] for s in se_rows if s.get("enrollment_id") not in others]

    delete, convert = [], []
    for p in await db.programs.find({}, {"_id": 0}).to_list(None):
        if not (is_online_course(p) or is_online_course(p.get("draft") or {})):
            continue
        kept = await db.dog_programs.count_documents({"program_id": p["id"], "id": {"$nin": dp_ids}})
        if p.get("delivery_mode") == "self_guided" and not kept and not p.get("is_default"):
            delete.append(p)
        else:
            convert.append(p)
    return {"dp_ids": dp_ids, "se_ids": se_ids, "delete": delete, "convert": convert}


async def prerequisite_warnings(db, dp_ids: List[str], kept_slugs: Iterable[str]) -> List[str]:
    """Dogs whose only finished copy of a kept program is being removed, while
    another program lists it as a prerequisite."""
    kept_slugs = {s for s in kept_slugs if s}
    if not kept_slugs or not dp_ids:
        return []
    needed = {s for p in await db.programs.find({"prereq_slugs": {"$in": list(kept_slugs)}}, {"_id": 0, "prereq_slugs": 1}).to_list(None)
              for s in p.get("prereq_slugs") or [] if s in kept_slugs}
    out = []
    for dp in await db.dog_programs.find(
            {"id": {"$in": dp_ids}, "status": "completed", "program_snapshot.slug": {"$in": list(needed)}},
            {"_id": 0, "dog_id": 1, "program_snapshot": 1}).to_list(None):
        slug = (dp.get("program_snapshot") or {}).get("slug")
        if await db.dog_programs.count_documents({"dog_id": dp["dog_id"], "status": "completed",
                                                 "program_snapshot.slug": slug, "id": {"$nin": dp_ids}}):
            continue
        dog = await db.dogs.find_one({"id": dp["dog_id"]}, {"_id": 0, "name": 1}) or {}
        out.append(f"{dog.get('name') or 'A dog'} finished {(dp.get('program_snapshot') or {}).get('name') or slug} online, "
                   "which another program needs first. After this, that dog will need the program again before enrolling.")
    return out


async def remove_online_school(db, *, apply: bool, media_path, now_iso) -> Dict[str, Any]:
    t = await online_school_targets(db)
    out = {**await _people(db, t["dp_ids"]),
           "courses_to_delete": [{"id": p["id"], "name": p.get("name")} for p in t["delete"]],
           "courses_to_convert": [{"id": p["id"], "name": p.get("name")} for p in t["convert"]],
           # Programs kept for in-person training keep their sessions, stays and orders; only the
           # removed enrollments' own sessions, and the deleted courses, have to be settled first.
           "blockers": await removal_blockers(db, t["dp_ids"], [p["id"] for p in t["delete"]], course_orders=True),
           "warnings": await prerequisite_warnings(db, t["dp_ids"], [p.get("slug") for p in t["convert"]])
           + await money_notes(db, [p["id"] for p in t["delete"]])
           + [f"{p.get('name')} was sold as an online course. It comes off the online Shop and the register "
              "until you set its price and sessions for in-person training." for p in t["convert"] if sold_as_course(p)]}
    if apply and out["blockers"]:
        raise HTTPException(status_code=409, detail=" ".join(out["blockers"]))
    run = _Run(db, apply)
    await remove_enrollments(run, t["dp_ids"], t["se_ids"], media_path=media_path)
    for p in t["delete"]:
        await remove_program_row(run, p)
    if apply:
        for p in t["convert"]:
            patch = {**online_settings_off(p), "updated_at": now_iso()}
            if isinstance(p.get("draft"), dict):
                # An unpublished Program Studio draft too: publishing it would put the online settings back.
                patch.update({f"draft.{k}": v for k, v in online_settings_off(p["draft"]).items()})
            await db.programs.update_one({"id": p["id"]}, {"$set": patch})
    out.update(run.summary())
    return out


async def delete_program_with_history(db, program_id: str, *, apply: bool, media_path) -> Dict[str, Any]:
    program = await db.programs.find_one({"id": program_id}, {"_id": 0})
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    dp_ids = [r["id"] for r in await db.dog_programs.find({"program_id": program_id}, {"_id": 0, "id": 1}).to_list(None)]
    se_ids = [r["id"] for r in await db.school_enrollments.find(
        {"$or": [{"program_id": program_id}, {"enrollment_id": {"$in": dp_ids}}]}, {"_id": 0, "id": 1}).to_list(None)]
    out = {"program": {"id": program_id, "name": program.get("name")}, **await _people(db, dp_ids),
           "blockers": await removal_blockers(db, dp_ids, [program_id]),
           "warnings": await money_notes(db, [program_id])}
    if apply and out["blockers"]:
        raise HTTPException(status_code=409, detail=" ".join(out["blockers"]))
    run = _Run(db, apply)
    await remove_enrollments(run, dp_ids, se_ids, media_path=media_path)
    await remove_program_row(run, program)
    out.update(run.summary())
    return out


class RemovalIn(BaseModel):
    confirm: bool = False


def make_training_removal_domain(*, api, db, require_admin_and_permission, perms_for, feature_enabled,
                                 school_media_file_path, now_iso):
    """Register the removal routes. New routes live here, not in server.py."""
    manage = require_admin_and_permission("manage_training_content")

    def _may_delete(user: dict, confirm: bool) -> None:
        if not perms_for(user).get("delete_records"):
            raise HTTPException(status_code=403, detail="Removing training history needs the Delete records permission.")
        if not confirm:
            raise HTTPException(status_code=422, detail="Confirm the removal first.")

    @api.get("/admin/online-school/removal")
    async def online_school_removal_preview(_: dict = Depends(manage)):
        """What Remove Online School would remove. Changes nothing."""
        return await remove_online_school(db, apply=False, media_path=school_media_file_path, now_iso=now_iso)

    @api.post("/admin/online-school/removal")
    async def online_school_removal(body: RemovalIn, user: dict = Depends(manage)):
        _may_delete(user, body.confirm)
        if await feature_enabled("online_school"):
            raise HTTPException(status_code=409, detail="Turn Online School off first (Settings → Feature Visibility).")
        return await remove_online_school(db, apply=True, media_path=school_media_file_path, now_iso=now_iso)

    @api.get("/admin/programs/{program_id}/delete-preview")
    async def program_delete_preview(program_id: str, _: dict = Depends(manage)):
        """What deleting this program with its history would remove. Changes nothing."""
        return await delete_program_with_history(db, program_id, apply=False, media_path=school_media_file_path)

    @api.post("/admin/programs/{program_id}/delete-with-history")
    async def program_delete_with_history(program_id: str, body: RemovalIn, user: dict = Depends(manage)):
        _may_delete(user, body.confirm)
        return await delete_program_with_history(db, program_id, apply=True, media_path=school_media_file_path)

    return {}
