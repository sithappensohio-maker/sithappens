"""Staff time clock, shift scheduling, time off and punch corrections.

Moved out of server.py verbatim; only the owning module changed. Everything the
moved code still needs is injected, and every moved name is handed back so the
host module can re-export it under its original name.
"""
import csv
import io
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


logger = logging.getLogger("sithappens")


def make_staff_domain(*, ClockInIn, ClockOutIn, TIME_OFF_STATUSES, TIME_OFF_TYPES, TimeClockEditIn, VARIANCE_FLAG_MINUTES, api, business_today, db, now_iso, require_admin, require_admin_and_permission, require_employee_or_admin):
    @api.get("/time-clock/current")
    async def time_clock_current(user: dict = Depends(require_employee_or_admin)):
        """Returns the currently-open clock entry for the calling user (or None)."""
        open_entry = await db.time_clock_entries.find_one(
            {"user_id": user["id"], "clock_out_at": None}, {"_id": 0}
        )
        return {"open": open_entry}

    @api.post("/time-clock/clock-in")
    async def time_clock_in(body: ClockInIn, user: dict = Depends(require_employee_or_admin)):
        # Prevent double clock-in
        existing = await db.time_clock_entries.find_one(
            {"user_id": user["id"], "clock_out_at": None}, {"_id": 0, "id": 1}
        )
        if existing:
            raise HTTPException(status_code=400, detail="You're already clocked in. Clock out first.")
        entry = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_name": user.get("display_name") or user.get("name", ""),
            "clock_in_at": now_iso(),
            "clock_in_lat": body.lat,
            "clock_in_lng": body.lng,
            "clock_in_accuracy_m": body.accuracy_m,
            "clock_in_note": (body.note or "").strip(),
            "clock_out_at": None,
            "break_minutes": 0,
            "hours": None,
            "created_at": now_iso(),
        }
        await db.time_clock_entries.insert_one(entry)
        entry.pop("_id", None)
        return entry

    @api.post("/time-clock/clock-out")
    async def time_clock_out(body: ClockOutIn, user: dict = Depends(require_employee_or_admin)):
        open_entry = await db.time_clock_entries.find_one(
            {"user_id": user["id"], "clock_out_at": None}, {"_id": 0}
        )
        if not open_entry:
            raise HTTPException(status_code=400, detail="No open clock-in to close.")
        out_iso = now_iso()
        ci = datetime.fromisoformat(open_entry["clock_in_at"].replace("Z", "+00:00"))
        co = datetime.fromisoformat(out_iso.replace("Z", "+00:00"))
        break_min = float(body.break_minutes or 0)
        hours = max((co - ci).total_seconds() / 3600.0 - (break_min / 60.0), 0.0)
        update = {
            "clock_out_at": out_iso,
            "clock_out_lat": body.lat,
            "clock_out_lng": body.lng,
            "clock_out_accuracy_m": body.accuracy_m,
            "clock_out_note": (body.note or "").strip(),
            "break_minutes": break_min,
            "hours": round(hours, 3),
        }
        await db.time_clock_entries.update_one({"id": open_entry["id"]}, {"$set": update})
        open_entry.update(update)
        return open_entry

    @api.get("/time-clock/me")
    async def time_clock_me(
        days: int = 30,
        user: dict = Depends(require_employee_or_admin),
    ):
        """Return the calling user's clock entries from the last N days plus totals.

        Sprint 110ba — adds pay calculations using the user's `hourly_rate`:
          • per-entry `gross` (hours × rate)
          • `total_gross` for the window
          • `this_week` / `last_week` totals (weekly period Sun → Sat)
          • `ytd_hours` / `ytd_gross` (calendar-year totals)
          • `live` block: if a shift is currently open, running hours + pay so far
        No-op friendly: when `hourly_rate` is unset, gross values come back as 0
        so the UI can fall back to hours-only.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
        entries = await db.time_clock_entries.find(
            {"user_id": user["id"], "clock_in_at": {"$gte": cutoff}},
            {"_id": 0},
        ).sort("clock_in_at", -1).to_list(2000)
        me = await db.users.find_one(
            {"id": user["id"]}, {"_id": 0, "hourly_rate": 1, "name": 1, "display_name": 1, "email": 1}
        ) or {}
        rate = float(me.get("hourly_rate") or 0)

        def _gross(hrs: float) -> float:
            return round(float(hrs or 0) * rate, 2)

        # Annotate per-entry gross
        for e in entries:
            e["gross"] = _gross(e.get("hours"))
            e["hourly_rate"] = rate

        closed = [e for e in entries if e.get("clock_out_at") and e.get("hours") is not None]
        total_hours = round(sum(float(e["hours"]) for e in closed), 2)
        total_gross = round(total_hours * rate, 2)

        # Week boundary helper (Sunday start, Saturday end — U.S. payroll standard)
        today = business_today()
        sunday = today - timedelta(days=(today.weekday() + 1) % 7)
        last_sunday = sunday - timedelta(days=7)
        last_saturday = sunday - timedelta(days=1)

        def _in_range(e, start_d: date, end_d: date) -> bool:
            try:
                d = datetime.fromisoformat((e.get("clock_in_at") or "").replace("Z", "+00:00")).date()
            except Exception:
                return False
            return start_d <= d <= end_d

        this_week_entries = [e for e in closed if _in_range(e, sunday, today)]
        last_week_entries = [e for e in closed if _in_range(e, last_sunday, last_saturday)]
        this_week_hours = round(sum(float(e["hours"]) for e in this_week_entries), 2)
        last_week_hours = round(sum(float(e["hours"]) for e in last_week_entries), 2)

        # YTD — query independently of the `days` window so it's accurate even
        # for short windows
        ytd_start = f"{today.year}-01-01T00:00:00"
        ytd = await db.time_clock_entries.find(
            {"user_id": user["id"], "clock_in_at": {"$gte": ytd_start},
             "clock_out_at": {"$ne": None, "$exists": True}, "hours": {"$ne": None}},
            {"_id": 0, "hours": 1},
        ).to_list(5000)
        ytd_hours = round(sum(float(r.get("hours") or 0) for r in ytd), 2)
        ytd_gross = round(ytd_hours * rate, 2)

        # Live running shift (if any)
        live = None
        open_entry = next((e for e in entries if not e.get("clock_out_at")), None)
        if open_entry:
            try:
                t_in = datetime.fromisoformat((open_entry["clock_in_at"] or "").replace("Z", "+00:00"))
                elapsed_hrs = max(0.0, (datetime.now(timezone.utc) - t_in).total_seconds() / 3600.0)
                br = float(open_entry.get("break_minutes") or 0) / 60.0
                elapsed_hrs = max(0.0, elapsed_hrs - br)
                hours_rounded = round(elapsed_hrs, 2)
                live = {
                    "entry_id": open_entry["id"],
                    "clock_in_at": open_entry["clock_in_at"],
                    "hours_so_far": hours_rounded,
                    "gross_so_far": round(hours_rounded * rate, 2),
                }
            except Exception:
                pass

        return {
            "entries": entries,
            "total_hours": total_hours,
            "total_gross": total_gross,
            "hourly_rate": rate,
            "days": days,
            "this_week": {
                "start": sunday.isoformat(),
                "end": today.isoformat(),
                "hours": this_week_hours,
                "gross": _gross(this_week_hours),
            },
            "last_week": {
                "start": last_sunday.isoformat(),
                "end": last_saturday.isoformat(),
                "hours": last_week_hours,
                "gross": _gross(last_week_hours),
            },
            "ytd": {"year": today.year, "hours": ytd_hours, "gross": ytd_gross},
            "live": live,
        }


    # Sprint 110fz — Staff Ops readiness. Read-only daily summary used by the
    # Staff Hub and the dashboard Start Day checklist. This does not change
    # schedules, clock entries, bookings, or payroll rows; it only points out
    # staffing risks before the day gets away from the operator.

    class TimeOffIn(BaseModel):
        start_date: str
        end_date: str
        request_type: str = "vacation"
        reason: Optional[str] = ""

    class TimeOffReview(BaseModel):
        status: str           # "approved" | "rejected"
        admin_notes: Optional[str] = ""

    @api.get("/employee/time-off")
    async def employee_list_time_off(user: dict = Depends(require_employee_or_admin)):
        rows = await db.time_off_requests.find(
            {"user_id": user["id"]}, {"_id": 0},
        ).sort("created_at", -1).to_list(500)
        return {"requests": rows}

    @api.post("/employee/time-off")
    async def employee_submit_time_off(
        body: TimeOffIn,
        user: dict = Depends(require_employee_or_admin),
    ):
        if body.start_date > body.end_date:
            raise HTTPException(400, "start_date must be on or before end_date")
        if body.request_type not in TIME_OFF_TYPES:
            raise HTTPException(400, f"request_type must be one of {sorted(TIME_OFF_TYPES)}")
        # Try to look up the requester's display name for admin lists
        me = await db.users.find_one(
            {"id": user["id"]}, {"_id": 0, "name": 1, "display_name": 1, "email": 1}
        ) or {}
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_name": me.get("display_name") or me.get("name") or me.get("email") or "Employee",
            "start_date": body.start_date,
            "end_date": body.end_date,
            "request_type": body.request_type,
            "reason": (body.reason or "").strip(),
            "status": "pending",
            "created_at": now_iso(),
            "reviewed_at": None,
            "reviewed_by": None,
            "admin_notes": "",
        }
        await db.time_off_requests.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.delete("/employee/time-off/{rid}")
    async def employee_cancel_time_off(
        rid: str,
        user: dict = Depends(require_employee_or_admin),
    ):
        row = await db.time_off_requests.find_one({"id": rid}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Request not found")
        if row.get("user_id") != user["id"] and user.get("role") != "admin":
            raise HTTPException(403, "Not your request")
        if row.get("status") not in ("pending",):
            raise HTTPException(400, "Only pending requests can be cancelled")
        await db.time_off_requests.update_one(
            {"id": rid}, {"$set": {"status": "cancelled", "reviewed_at": now_iso()}}
        )
        return {"ok": True}

    @api.get("/admin/time-off")
    async def admin_list_time_off(
        _: dict = Depends(require_admin_and_permission("manage_staff_scheduling")),
        status: Optional[str] = None,
    ):
        q: Dict[str, Any] = {}
        if status:
            if status not in TIME_OFF_STATUSES:
                raise HTTPException(400, f"status must be one of {sorted(TIME_OFF_STATUSES)}")
            q["status"] = status
        rows = await db.time_off_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return {
            "requests": rows,
            "pending_count": sum(1 for r in rows if r.get("status") == "pending"),
        }

    @api.put("/admin/time-off/{rid}")
    async def admin_review_time_off(
        rid: str,
        body: TimeOffReview,
        admin: dict = Depends(require_admin_and_permission("manage_staff_scheduling")),
    ):
        if body.status not in ("approved", "rejected"):
            raise HTTPException(400, "status must be 'approved' or 'rejected'")
        res = await db.time_off_requests.update_one(
            {"id": rid},
            {"$set": {
                "status": body.status,
                "reviewed_at": now_iso(),
                "reviewed_by": admin["id"],
                "admin_notes": (body.admin_notes or "").strip(),
            }},
        )
        if not res.matched_count:
            raise HTTPException(404, "Request not found")
        return await db.time_off_requests.find_one({"id": rid}, {"_id": 0})


    # ─── Weekly pay history (last N weeks) ────────────────────────────────────────

    @api.get("/time-clock/me.csv")
    async def time_clock_me_csv(
        days: int = 90,
        user: dict = Depends(require_employee_or_admin),
    ):
        """Download a CSV of the caller's own timecard for the last `days` days.
        Includes per-entry gross pay. Handy for staff to keep their own records."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
        entries = await db.time_clock_entries.find(
            {"user_id": user["id"], "clock_in_at": {"$gte": cutoff}},
            {"_id": 0},
        ).sort("clock_in_at", 1).to_list(5000)
        me = await db.users.find_one(
            {"id": user["id"]}, {"_id": 0, "hourly_rate": 1, "name": 1, "display_name": 1, "email": 1}
        ) or {}
        rate = float(me.get("hourly_rate") or 0)
        buf = io.StringIO()
        w = csv.writer(buf)
        name = me.get("display_name") or me.get("name") or me.get("email") or "Me"
        w.writerow([f"Timecard — {name} — last {days} days"])
        w.writerow([f"Hourly rate: ${rate:.2f}"])
        w.writerow([])
        w.writerow(["Date", "Clock-in", "Clock-out", "Break (min)", "Hours", "Gross ($)"])
        grand_h = 0.0
        for e in entries:
            date_str = (e.get("clock_in_at") or "")[:10]
            hrs = float(e.get("hours") or 0)
            grand_h += hrs
            w.writerow([
                date_str,
                e.get("clock_in_at", ""),
                e.get("clock_out_at", "") or "",
                int(e.get("break_minutes") or 0),
                f"{hrs:.2f}",
                f"{hrs * rate:.2f}",
            ])
        w.writerow([])
        w.writerow(["TOTAL", "", "", "", f"{grand_h:.2f}", f"{grand_h * rate:.2f}"])
        buf.seek(0)
        fname = f"timecard-{name.replace(' ', '_')}-{business_today().isoformat()}.csv"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )

    @api.get("/admin/time-clock")
    async def admin_time_clock_list(
        start_date: str,
        end_date: str,
        user_id: Optional[str] = None,
        _: dict = Depends(require_admin),
    ):
        """Admin view: all clock entries in a date window, optionally filtered to one employee.
        Returns entries + per-employee subtotals + grand total + estimated payroll cost."""
        q: Dict[str, Any] = {
            "clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"}
        }
        if user_id:
            q["user_id"] = user_id
        entries = await db.time_clock_entries.find(q, {"_id": 0}).sort("clock_in_at", -1).to_list(5000)
        # Pull rate per user for payroll cost
        user_ids = list({e["user_id"] for e in entries})
        users = await db.users.find(
            {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "display_name": 1, "hourly_rate": 1}
        ).to_list(1000) if user_ids else []
        user_map = {u["id"]: u for u in users}

        per_user: Dict[str, Dict[str, Any]] = {}
        grand_hours = 0.0
        grand_cost = 0.0
        for e in entries:
            u = user_map.get(e["user_id"], {})
            name = u.get("display_name") or u.get("name") or "Unknown"
            rate = float(u.get("hourly_rate") or 0)
            slot = per_user.setdefault(e["user_id"], {
                "user_id": e["user_id"], "name": name, "hourly_rate": rate,
                "hours": 0.0, "cost": 0.0, "entry_count": 0,
            })
            hrs = float(e.get("hours") or 0)
            slot["hours"] = round(slot["hours"] + hrs, 2)
            slot["cost"] = round(slot["cost"] + hrs * rate, 2)
            slot["entry_count"] += 1
            grand_hours += hrs
            grand_cost += hrs * rate
        return {
            "start_date": start_date,
            "end_date": end_date,
            "entries": entries,
            "per_user": sorted(per_user.values(), key=lambda x: -x["hours"]),
            "grand_hours": round(grand_hours, 2),
            "grand_cost": round(grand_cost, 2),
        }

    @api.put("/admin/time-clock/{entry_id}")
    async def admin_edit_time_clock(
        entry_id: str, body: TimeClockEditIn, admin: dict = Depends(require_admin),
    ):
        """Admin override — fix a missed clock-out, adjust times, etc. Stamps edit metadata."""
        entry = await db.time_clock_entries.find_one({"id": entry_id}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        update: Dict[str, Any] = {
            "edited_by_admin_at": now_iso(),
            "edited_by_admin_id": admin["id"],
        }
        if body.clock_in_at is not None:
            update["clock_in_at"] = body.clock_in_at
        if body.clock_out_at is not None:
            update["clock_out_at"] = body.clock_out_at
        if body.break_minutes is not None:
            update["break_minutes"] = float(body.break_minutes)
        if body.note is not None:
            update["admin_note"] = body.note
        # Recompute hours
        ci_raw = update.get("clock_in_at", entry.get("clock_in_at"))
        co_raw = update.get("clock_out_at", entry.get("clock_out_at"))
        brk = update.get("break_minutes", entry.get("break_minutes") or 0)
        if ci_raw and co_raw:
            try:
                ci = datetime.fromisoformat(ci_raw.replace("Z", "+00:00"))
                co = datetime.fromisoformat(co_raw.replace("Z", "+00:00"))
                update["hours"] = round(max((co - ci).total_seconds() / 3600.0 - (float(brk) / 60.0), 0.0), 3)
            except Exception:
                pass
        await db.time_clock_entries.update_one({"id": entry_id}, {"$set": update})
        entry.update(update)
        return entry

    @api.delete("/admin/time-clock/{entry_id}")
    async def admin_delete_time_clock(entry_id: str, _: dict = Depends(require_admin)):
        res = await db.time_clock_entries.delete_one({"id": entry_id})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"ok": True}


    # ── Employee-portal helpers (read-only data the staff need to do their job) ──

    class ShiftTemplateIn(BaseModel):
        user_id: str
        day_of_week: int = Field(ge=0, le=6)  # 0=Mon..6=Sun
        start_time: str  # HH:MM
        end_time: str
        role: Optional[str] = ""
        active: bool = True

    class ShiftIn(BaseModel):
        user_id: str
        date: str  # YYYY-MM-DD
        start_time: str
        end_time: str
        role: Optional[str] = ""
        notes: Optional[str] = ""

    @api.get("/admin/shift-templates")
    async def list_shift_templates(_: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        rows = await db.shift_templates.find({}, {"_id": 0}).sort([("user_id", 1), ("day_of_week", 1)]).to_list(500)
        return rows

    @api.post("/admin/shift-templates")
    async def create_shift_template(body: ShiftTemplateIn, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        doc = body.model_dump()
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now_iso()
        await db.shift_templates.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put("/admin/shift-templates/{tid}")
    async def update_shift_template(tid: str, body: ShiftTemplateIn, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        res = await db.shift_templates.update_one({"id": tid}, {"$set": body.model_dump()})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"ok": True}

    @api.delete("/admin/shift-templates/{tid}")
    async def delete_shift_template(tid: str, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        await db.shift_templates.delete_one({"id": tid})
        return {"ok": True}

    @api.get("/admin/shifts")
    async def list_shifts(
        start_date: str,
        end_date: str,
        user_id: Optional[str] = None,
        _: dict = Depends(require_admin_and_permission("manage_staff_scheduling")),
    ):
        q: Dict[str, Any] = {"date": {"$gte": start_date, "$lte": end_date}}
        if user_id:
            q["user_id"] = user_id
        rows = await db.shifts.find(q, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).to_list(2000)
        return rows

    @api.post("/admin/shifts")
    async def create_shift(body: ShiftIn, admin: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        doc = body.model_dump()
        doc["id"] = str(uuid.uuid4())
        doc["source"] = "manual"
        doc["template_id"] = None
        doc["status"] = "scheduled"
        doc["created_by"] = admin["id"]
        doc["created_at"] = now_iso()
        await db.shifts.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put("/admin/shifts/{sid}")
    async def update_shift(sid: str, body: ShiftIn, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        res = await db.shifts.update_one({"id": sid}, {"$set": body.model_dump()})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Shift not found")
        return {"ok": True}

    @api.delete("/admin/shifts/{sid}")
    async def delete_shift(sid: str, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        await db.shifts.delete_one({"id": sid})
        return {"ok": True}

    @api.post("/admin/shifts/generate")
    async def generate_shifts_from_templates(body: dict, _: dict = Depends(require_admin_and_permission("manage_staff_scheduling"))):
        """Apply all active shift_templates to every weekday in [start_date, end_date].
        Idempotent: skips dates where the same user already has a shift covering the same
        start_time (so re-running won't duplicate)."""
        start_date = body.get("start_date")
        end_date = body.get("end_date")
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required")
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        if end < start:
            raise HTTPException(status_code=400, detail="end_date must be after start_date")
        templates = await db.shift_templates.find({"active": True}, {"_id": 0}).to_list(500)
        created = 0
        skipped = 0
        d = start
        while d <= end:
            dow = d.weekday()  # 0=Mon..6=Sun
            for t in templates:
                if t["day_of_week"] != dow:
                    continue
                iso = d.isoformat()
                existing = await db.shifts.find_one(
                    {"user_id": t["user_id"], "date": iso, "start_time": t["start_time"]},
                    {"_id": 0, "id": 1},
                )
                if existing:
                    skipped += 1
                    continue
                doc = {
                    "id": str(uuid.uuid4()),
                    "user_id": t["user_id"],
                    "date": iso,
                    "start_time": t["start_time"],
                    "end_time": t["end_time"],
                    "role": t.get("role", ""),
                    "notes": "",
                    "source": "template",
                    "template_id": t["id"],
                    "status": "scheduled",
                    "created_at": now_iso(),
                }
                await db.shifts.insert_one(doc)
                created += 1
            d = d + timedelta(days=1)
        return {"created": created, "skipped": skipped, "start_date": start_date, "end_date": end_date}

    @api.get("/admin/shifts/scheduled-vs-actual")
    async def shifts_scheduled_vs_actual(
        start_date: str, end_date: str,
        user_id: Optional[str] = None,
        _: dict = Depends(require_admin_and_permission("manage_staff_scheduling")),
    ):
        """For each scheduled shift in the range, find the matching clock entry (same
        user, same date) and compute variance. Flags shifts where |sched - actual|
        > VARIANCE_FLAG_MINUTES."""
        qs: Dict[str, Any] = {"date": {"$gte": start_date, "$lte": end_date}}
        if user_id:
            qs["user_id"] = user_id
        shifts = await db.shifts.find(qs, {"_id": 0}).sort("date", 1).to_list(2000)
        # Pull all entries in window
        entries = await db.time_clock_entries.find(
            {"clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"}},
            {"_id": 0},
        ).to_list(5000)
        # Group entries by (user_id, date)
        entries_by_key: Dict[tuple, List[dict]] = {}
        for e in entries:
            ci = e.get("clock_in_at", "")
            dt = ci[:10] if len(ci) >= 10 else ""
            entries_by_key.setdefault((e["user_id"], dt), []).append(e)

        def parse_hhmm(s):
            try:
                h, m = s.split(":")
                return int(h) * 60 + int(m)
            except Exception:
                return None

        rows = []
        for s in shifts:
            sched_start_min = parse_hhmm(s["start_time"])
            sched_end_min = parse_hhmm(s["end_time"])
            sched_minutes = (sched_end_min - sched_start_min) if (sched_start_min is not None and sched_end_min is not None) else 0
            matches = entries_by_key.get((s["user_id"], s["date"]), [])
            actual_minutes = 0
            first_in = None
            last_out = None
            for e in matches:
                if e.get("clock_out_at"):
                    actual_minutes += round(float(e.get("hours") or 0) * 60)
                    if not first_in or e["clock_in_at"] < first_in:
                        first_in = e["clock_in_at"]
                    if not last_out or e["clock_out_at"] > last_out:
                        last_out = e["clock_out_at"]
            variance_min = actual_minutes - sched_minutes
            flagged = abs(variance_min) > VARIANCE_FLAG_MINUTES
            status = "missed" if actual_minutes == 0 else ("matched" if not flagged else ("over" if variance_min > 0 else "under"))
            rows.append({
                **s,
                "scheduled_minutes": sched_minutes,
                "actual_minutes": actual_minutes,
                "variance_minutes": variance_min,
                "flagged": flagged,
                "match_status": status,
                "first_in": first_in,
                "last_out": last_out,
            })
        return {"shifts": rows, "variance_threshold_minutes": VARIANCE_FLAG_MINUTES}


    # ────────────────────────── Payroll Tax Estimator (Sprint 96) ──────────────────────────
    # Sensible defaults for Warren, Ohio (2026 rates). Every rate is editable via
    # /api/admin/payroll-tax-settings so the owner can adjust as they get rated
    # (e.g. Ohio SUTA changes yearly, BWC rate depends on policy/class code).
    #
    # IMPORTANT: This is an ESTIMATOR for budgeting only — not a substitute for
    # payroll software or a CPA. Withholding amounts vary by W-4 selections,
    # YTD totals, exemptions, etc. The take-home estimate uses simple flat brackets.

    @api.get("/employee/my-shifts")
    async def employee_my_shifts(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        user: dict = Depends(require_employee_or_admin),
    ):
        """Upcoming + recent shifts for the calling user. Defaults to next 14 days."""
        s = start_date or business_today().isoformat()
        e = end_date or (business_today() + timedelta(days=14)).isoformat()
        rows = await db.shifts.find(
            {"user_id": user["id"], "date": {"$gte": s, "$lte": e}},
            {"_id": 0},
        ).sort([("date", 1), ("start_time", 1)]).to_list(500)
        return {"start_date": s, "end_date": e, "shifts": rows}

    class PunchCorrectionIn(BaseModel):
        target_entry_id: Optional[str] = ""          # which time_clock_entries row, optional
        target_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
        requested_clock_in: Optional[str] = ""       # ISO datetime
        requested_clock_out: Optional[str] = ""      # ISO datetime
        reason: str = Field(min_length=3, max_length=500)

    @api.get("/employee/punch-corrections")
    async def employee_list_punch_corrections(user: dict = Depends(require_employee_or_admin)):
        """Staff sees their own correction requests. Admin sees all."""
        q: Dict[str, Any] = {} if user.get("role") == "admin" else {"user_id": user.get("id")}
        items = await db.punch_corrections.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return items

    @api.post("/employee/punch-corrections")
    async def employee_create_punch_correction(body: PunchCorrectionIn, user: dict = Depends(require_employee_or_admin)):
        """Submit a correction request — admin will approve/deny + apply."""
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email"),
            "target_entry_id": body.target_entry_id or "",
            "target_date": body.target_date,
            "requested_clock_in": body.requested_clock_in or "",
            "requested_clock_out": body.requested_clock_out or "",
            "reason": body.reason.strip(),
            "status": "pending",                     # pending | approved | denied
            "decided_by_id": "",
            "decided_by_name": "",
            "decided_at": "",
            "admin_note": "",
            "created_at": now_iso(),
        }
        await db.punch_corrections.insert_one(doc)
        doc.pop("_id", None)
        return doc

    class PunchCorrectionDecisionIn(BaseModel):
        decision: Literal["approved", "denied"]
        admin_note: Optional[str] = Field(default="", max_length=500)

    @api.post("/employee/punch-corrections/{cid}/decision")
    async def employee_decide_punch_correction(
        cid: str, body: PunchCorrectionDecisionIn, user: dict = Depends(require_admin_and_permission("manage_staff_scheduling")),
    ):
        """Admin approves/denies a correction. On approve, the requested
        clock_in/clock_out get applied to the time_clock_entries row (or a new
        row is created if target_entry_id is empty)."""
        req = await db.punch_corrections.find_one({"id": cid}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=409, detail="Already decided")
        update = {
            "status": body.decision,
            "decided_by_id": user.get("id"),
            "decided_by_name": user.get("name") or user.get("email"),
            "decided_at": now_iso(),
            "admin_note": (body.admin_note or "").strip(),
        }
        await db.punch_corrections.update_one({"id": cid}, {"$set": update})

        if body.decision == "approved":
            # Apply to a time_clock_entries row.
            target_id = req.get("target_entry_id")
            patch = {}
            if req.get("requested_clock_in"):
                patch["clock_in_at"] = req["requested_clock_in"]
            if req.get("requested_clock_out"):
                patch["clock_out_at"] = req["requested_clock_out"]
            if target_id:
                await db.time_clock_entries.update_one({"id": target_id}, {"$set": patch})
            elif patch:
                # Create a fresh entry — staff forgot to clock in/out entirely.
                row = {
                    "id": str(uuid.uuid4()),
                    "user_id": req["user_id"],
                    "user_name": req["user_name"],
                    "clock_in_at": patch.get("clock_in_at", ""),
                    "clock_out_at": patch.get("clock_out_at", ""),
                    "created_at": now_iso(),
                    "corrected_via_request_id": cid,
                }
                await db.time_clock_entries.insert_one(row)

        req.update(update)
        return req


    # ──────────── Staff trivia (no scoring, just learning) ────────────

    return {"TimeOffIn": TimeOffIn, "TimeOffReview": TimeOffReview, "employee_list_time_off": employee_list_time_off, "employee_submit_time_off": employee_submit_time_off, "employee_cancel_time_off": employee_cancel_time_off, "admin_list_time_off": admin_list_time_off, "admin_review_time_off": admin_review_time_off, "ShiftTemplateIn": ShiftTemplateIn, "ShiftIn": ShiftIn, "list_shift_templates": list_shift_templates, "create_shift_template": create_shift_template, "update_shift_template": update_shift_template, "delete_shift_template": delete_shift_template, "list_shifts": list_shifts, "create_shift": create_shift, "update_shift": update_shift, "delete_shift": delete_shift, "generate_shifts_from_templates": generate_shifts_from_templates, "shifts_scheduled_vs_actual": shifts_scheduled_vs_actual, "employee_my_shifts": employee_my_shifts, "PunchCorrectionIn": PunchCorrectionIn, "employee_list_punch_corrections": employee_list_punch_corrections, "employee_create_punch_correction": employee_create_punch_correction, "PunchCorrectionDecisionIn": PunchCorrectionDecisionIn, "employee_decide_punch_correction": employee_decide_punch_correction, "time_clock_current": time_clock_current, "time_clock_in": time_clock_in, "time_clock_out": time_clock_out, "time_clock_me": time_clock_me, "time_clock_me_csv": time_clock_me_csv, "admin_time_clock_list": admin_time_clock_list, "admin_edit_time_clock": admin_edit_time_clock, "admin_delete_time_clock": admin_delete_time_clock}
