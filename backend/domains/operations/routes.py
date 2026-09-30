"""Front-desk bulk operations tools.

Owner-requested (2026-08-31 smoke-test follow-ups): the vaccine-upload review
queue and the stuck-checkout list were one-at-a-time flows that don't survive
a real backlog (85 pending uploads / 16 stuck stays at the time). Both bulk
endpoints reuse the SAME single-item rules — nothing here invents a second
approval or checkout path.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains import vaccines as vaccines_domain

VACCINE_TYPES = ("rabies", "bordetella", "dhpp")


class BulkVaccineReviewIn(BaseModel):
    # Explicit selection; the UI sends exactly the rows the admin can see.
    items: List[Dict[str, str]] = Field(default_factory=list, max_length=500)


class StuckCheckoutResolveIn(BaseModel):
    booking_ids: List[str] = Field(default_factory=list, max_length=500)
    reason: str = Field(min_length=3, max_length=300)


async def _waiting_upload(db, dog_id: str, vaccine: str, uploaded_at: Optional[str]) -> tuple:
    """The upload a reviewer is deciding on — refused if it was already decided
    or replaced since they looked (they never act on a file they didn't see)."""
    if vaccine not in VACCINE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid vaccine type")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "vaccine_certs": 1, "vaccines": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    cert = (dog.get("vaccine_certs") or {}).get(vaccine)
    if not isinstance(cert, dict):
        raise HTTPException(status_code=404, detail="No cert uploaded for this vaccine")
    if vaccines_domain.was_reviewed(cert):
        raise HTTPException(status_code=409, detail="This certificate was already reviewed. Refresh to see the latest.")
    if uploaded_at and cert.get("uploaded_at") != uploaded_at:
        raise HTTPException(status_code=409, detail="The client uploaded a newer certificate. Refresh and check that one.")
    if dog.get("vaccines") is None:
        await db.dogs.update_one({"id": dog_id, "vaccines": None}, {"$set": {"vaccines": {}}})
    return dog, cert


async def approve_vaccine_cert(db, dog_id: str, vaccine: str, reviewer_name: str, now_iso,
                               uploaded_at: Optional[str] = None) -> Dict[str, Any]:
    """The one canonical approval rule — used by the single-review endpoint
    (server.py facade) and the bulk endpoint below. Applies the pending
    expiry to the dog so booking unlocks; the certificate it renews (the
    stash, audit #40) goes. Raises HTTPException on bad input."""
    _dog, cert = await _waiting_upload(db, dog_id, vaccine, uploaded_at)
    approved_exp = cert.get("pending_expires_on") or cert.get("expires_on")
    if not approved_exp:
        raise HTTPException(status_code=400, detail="Uploaded cert is missing an expiry date")
    try:
        date.fromisoformat(str(approved_exp)[:10])
    except Exception:
        raise HTTPException(status_code=400, detail="Uploaded cert has an invalid expiry date")
    path = f"vaccine_certs.{vaccine}"
    res = await db.dogs.update_one(
        {"id": dog_id, **vaccines_domain.cert_filter(vaccine, cert)},
        {"$set": {f"{path}.reviewed_at": now_iso(), f"{path}.reviewed_by": reviewer_name, f"{path}.status": "approved",
                  f"{path}.expires_on": str(approved_exp)[:10], f"vaccines.{vaccine}": str(approved_exp)[:10]},
         "$unset": {f"{path}.pending_expires_on": "", f"{path}.approved_before": ""}})
    if not res.matched_count:
        raise HTTPException(status_code=409, detail="This upload changed while you were approving it. Refresh and look again.")
    return {"ok": True, "dog_id": dog_id, "vaccine": vaccine, "expires_on": str(approved_exp)[:10]}


async def reject_vaccine_cert(db, dog_id: str, vaccine: str, uploaded_at: Optional[str] = None) -> Dict[str, Any]:
    """Throw away only the waiting upload (audit #40). The certificate it
    would have replaced goes back exactly as it was, date and all. Only an
    upload from before July 2026 — which wrote its own date onto the dog —
    also takes that date back off."""
    dog, cert = await _waiting_upload(db, dog_id, vaccine, uploaded_at)
    path = f"vaccine_certs.{vaccine}"
    filt = {"id": dog_id, **vaccines_domain.cert_filter(vaccine, cert)}
    before = cert.get("approved_before")
    if isinstance(before, dict) and before:
        update: Dict[str, Any] = {"$set": {path: before}}
    else:
        update = {"$unset": {path: ""}}
        vaccines = dog.get("vaccines") if isinstance(dog.get("vaccines"), dict) else {}
        own_date = str(cert.get("expires_on") or "")[:10]
        if vaccines_domain.is_legacy_unreviewed(cert) and own_date and str(vaccines.get(vaccine) or "")[:10] == own_date:
            update["$set"] = {f"vaccines.{vaccine}": ""}
            filt[f"vaccines.{vaccine}"] = vaccines.get(vaccine)
    res = await db.dogs.update_one(filt, update)
    if not res.matched_count:
        raise HTTPException(status_code=409, detail="This upload changed while you were rejecting it. Refresh and look again.")
    return {"ok": True, "dog_id": dog_id, "vaccine": vaccine, "rejected": True, "kept_approved": bool(isinstance(before, dict) and before)}


def register_operations_routes(
    *, api, db, require_admin, require_admin_and_permission, now_iso, business_today,
    get_current_user, visit_filter, client_visit_count, dog_visit_counts,
    job_scheduler, scheduler_marker_ids, scheduler_jobs, scheduler_task_ref,
    recheck_all_trophies, eligible_trophies, logger, business_day_utc_bounds=None,
) -> dict:
    # The moved admin-operations routes kept the private helper names they already
    # used; bind them to the injected dependencies so the bodies did not change.
    _visit_filter = visit_filter
    _client_visit_count = client_visit_count
    _dog_visit_counts = dog_visit_counts
    _scheduler_jobs = scheduler_jobs
    _eligible_trophies = eligible_trophies
    SCHEDULER_MARKER_IDS = scheduler_marker_ids


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
                result = await approve_vaccine_cert(db, dog_id, vaccine, reviewer, now_iso, str(item.get("uploaded_at") or "") or None)
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
                    # Day visits store end_date null ($exists:False never matched it);
                    # a back-dated one checked in today isn't stuck.
                    {"end_date": {"$in": [None, ""]}, "date": {"$lt": today_iso},
                     **({"checked_in_at": {"$lt": business_day_utc_bounds(today_iso)[0]}} if business_day_utc_bounds else {})},
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

    @api.get("/admin/scheduler/status")
    async def admin_scheduler_status(_: dict = Depends(require_admin)):
        st = await job_scheduler.status(db, SCHEDULER_MARKER_IDS)
        st["enabled"] = os.environ.get("SCHEDULER_ENABLED", "1") == "1"
        task = scheduler_task_ref()
        st["running_in_this_worker"] = bool(task and not task.done())
        st["jobs"] = [n for n, _ in _scheduler_jobs()]
        return st

    @api.post("/admin/scheduler/run-now")
    async def admin_scheduler_run_now(user: dict = Depends(require_admin)):
        """Run one scheduler tick immediately (same idempotent jobs the loop runs)."""
        return await job_scheduler.run_jobs_once(db, _scheduler_jobs(), holder=f"manual:{user.get('id', 'admin')}")

    @api.post("/admin/trophies/recheck")
    async def admin_recheck_trophies(_: dict = Depends(require_admin)):
        """Re-run every client AND dog auto-award evaluator now (visits, practice
        streaks, practice completions, referrals; skills mastered, graduations,
        checkpoints). Idempotent; returns what was awarded.
        Use after fixing an evaluator or editing thresholds so earned-but-never-
        fired awards land immediately instead of waiting for the next checkout."""
        summary = await recheck_all_trophies(db)
        await db.system_runs.update_one(
            {"_id": "trophy_recheck"},
            {"$set": {"date": business_today().isoformat(), "ran_at": now_iso(), "awarded": summary["awarded"]}},
            upsert=True,
        )
        return summary

    @api.get("/clients/{client_id}/visits")
    async def client_visits_summary(client_id: str, user: dict = Depends(get_current_user)):
        """Lifetime visits for a client, the way the award engine counts them
        (checked-out or completed bookings, live + archived, across all their
        dogs), with the visit-award tier they hold and the next one. One source
        for the Client hub's visit count so it can never disagree with the
        trophy that gets awarded."""
        if user.get("role") != "admin" and user.get("client_id") != client_id:
            raise HTTPException(status_code=403, detail="Not allowed")
        total = await _client_visit_count(db, client_id)
        dogs = await db.dogs.find({"owner_id": client_id, "deleted_at": {"$exists": False}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
        per_dog_counts = await _dog_visit_counts([d["id"] for d in dogs])
        per_dog = sorted(
            [{"dog_id": d["id"], "dog_name": d.get("name") or "Dog", "visits": int(per_dog_counts.get(d["id"], 0))} for d in dogs],
            key=lambda r: (-r["visits"], r["dog_name"]),
        )
        # Most recent visit: newest check-out (or completed booking date) in either collection.
        filt = _visit_filter(client_id)
        last_visit = None
        for coll in (db.bookings, db.bookings_archive):
            try:
                row = await coll.find(filt, {"_id": 0, "checked_out_at": 1, "date": 1, "end_date": 1}).sort("date", -1).limit(1).to_list(1)
            except Exception:
                row = []
            if row:
                stamp = row[0].get("end_date") or row[0].get("date") or (row[0].get("checked_out_at") or "")[:10]
                if stamp and (last_visit is None or stamp > last_visit):
                    last_visit = stamp
        tiers = await _eligible_trophies(db, category="client", kind="visit_count")
        held = None
        nxt = None
        for t in tiers:  # sorted by threshold ascending
            th = int(t.get("threshold") or 0)
            entry = {"code": t.get("code"), "name": t.get("name"), "threshold": th, "icon": t.get("icon"), "tier": t.get("tier")}
            if total >= th:
                held = entry
            elif nxt is None:
                nxt = {**entry, "remaining": th - total}
        return {"client_id": client_id, "visits": int(total), "per_dog": per_dog, "last_visit": last_visit, "held": held, "next": nxt,
                "tiers": [{"code": t.get("code"), "name": t.get("name"), "threshold": int(t.get("threshold") or 0)} for t in tiers]}

    @api.get("/admin/client-visit-counts")
    async def client_visit_counts(client_ids: Optional[str] = None, _: dict = Depends(require_admin)):
        """Lifetime visits for a page of clients in ONE round trip (the Clients
        directory renders 48 cards; one call per card would 429). Same visit rule
        as the award engine, live + archived bookings, grouped server-side with no
        result ceiling — a client with 400 visits reads 400. Returns
        {client_id: {visits, held, next}} for every requested id (zeros included)."""
        ids = [v.strip() for v in (client_ids or "").split(",") if v.strip()][:500]
        if not ids:
            return {}
        counts: Dict[str, int] = {cid: 0 for cid in ids}
        match = {"client_id": {"$in": ids}, "$or": [
            {"checked_out_at": {"$nin": [None, ""]}},
            {"status": {"$in": ["completed", "checked_out"]}},
        ]}
        pipeline = [{"$match": match}, {"$group": {"_id": "$client_id", "n": {"$sum": 1}}}]
        for coll in (db.bookings, db.bookings_archive):
            try:
                async for row in coll.aggregate(pipeline):
                    counts[row["_id"]] = counts.get(row["_id"], 0) + int(row.get("n") or 0)
            except Exception as exc:
                logger.warning("client visit counts: %s unavailable: %s", getattr(coll, "name", "?"), exc)
        tiers = await _eligible_trophies(db, category="client", kind="visit_count")
        out: Dict[str, Any] = {}
        for cid in ids:
            total = int(counts.get(cid, 0))
            held = None
            nxt = None
            for t in tiers:
                th = int(t.get("threshold") or 0)
                entry = {"code": t.get("code"), "name": t.get("name"), "threshold": th}
                if total >= th:
                    held = entry
                elif nxt is None:
                    nxt = {**entry, "remaining": th - total}
            out[cid] = {"visits": total, "held": held, "next": nxt}
        return out


    # Sprint 110ef — Sibling batch endpoint to `/admin/dog-trophies-summary`.

    # The existing suite drives several of these in-process (server.<name>(...)),
    # so hand the callables back for bootstrap to re-export under their original
    # names instead of leaving a second copy of the logic in server.py.
    return {
        "client_visit_counts": client_visit_counts,
        "client_visits_summary": client_visits_summary,
        "admin_scheduler_status": admin_scheduler_status,
        "admin_scheduler_run_now": admin_scheduler_run_now,
        "admin_recheck_trophies": admin_recheck_trophies,
    }
