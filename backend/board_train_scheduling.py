"""Residential scheduling rules for Board & Train packages.

Board & Train is intentionally kept as a ``training`` service for package
pricing, credits, and School enrollment. Operationally, however, the dog is
resident at the facility for the entire linked program. Older booking code
only gave date spans to ``service_type='boarding'``, which made a one-, two-,
or three-week Board & Train appear as a one-day training appointment.

This module installs one narrow runtime extension around the canonical exact
service resolver. Every path that creates a booking already calls that resolver,
so the span is derived server-side before conflict/closed-date checks, pricing,
and persistence. A startup repair fixes only still-open historical rows made by
the old bug; checked-out history is never rewritten.
"""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException

logger = logging.getLogger("sithappens")


def program_residential_duration_days(program: Optional[Dict[str, Any]]) -> Optional[int]:
    """Return a Board & Train program's residential duration in calendar days.

    Program Studio's ``format`` is authoritative. ``estimated_weeks`` is a
    conservative fallback for custom/newer curricula that do not use a weeks
    format. Non-Board-&-Train programs never become residential by accident.
    """
    row = program or {}
    if row.get("type") != "board_train":
        return None
    fmt = row.get("format") or {}
    try:
        count = int(fmt.get("count") or 0)
    except (TypeError, ValueError):
        count = 0
    unit = str(fmt.get("unit") or "").strip().lower()
    if count > 0:
        if unit in ("week", "weeks", "wk", "wks"):
            return count * 7
        if unit in ("day", "days"):
            return count
        if unit in ("month", "months"):
            return count * 30
    try:
        weeks = int(row.get("estimated_weeks") or 0)
    except (TypeError, ValueError):
        weeks = 0
    return weeks * 7 if weeks > 0 else None


def legacy_service_duration_days(service: Optional[Dict[str, Any]]) -> Optional[int]:
    """Duration fallback for pre-program-link Board & Train service rows.

    The shipped catalog historically included ``Board & Train (per week)`` as
    a plain training service, before ``package_program_id`` existed. We accept
    only an explicit Board-&-Train name/slug *and* an explicit duration token.
    This keeps the compatibility rule narrow and prevents ordinary training
    services from becoming multi-day stays.
    """
    row = service or {}
    hay = f"{row.get('slug') or ''} {row.get('name') or ''}".lower().replace("_", " ")
    if not re.search(r"board\s*(?:&|and)?\s*train", hay):
        return None
    match = re.search(r"\b(\d{1,2})\s*[- ]?\s*(?:week|weeks|wk|wks)\b", hay)
    if match:
        weeks = int(match.group(1))
        return weeks * 7 if weeks > 0 else None
    word_weeks = {"one": 1, "two": 2, "three": 3, "four": 4}
    word_match = re.search(r"\b(one|two|three|four)\s*[- ]?\s*(?:week|weeks|wk|wks)\b", hay)
    if word_match:
        return word_weeks[word_match.group(1)] * 7
    if re.search(r"\bper\s+(?:week|wk)\b", hay) or "board train week" in hay:
        return 7
    return None


async def board_train_stay_info(db, service: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Resolve residential scheduling metadata for one exact service row."""
    row = service or {}
    program_id = row.get("package_program_id")
    if program_id:
        program = await db.programs.find_one(
            {"id": program_id},
            {"_id": 0, "id": 1, "name": 1, "type": 1, "format": 1, "estimated_weeks": 1},
        )
        if not program or program.get("type") != "board_train":
            return None
        return {
            "program_id": program_id,
            "program_name": program.get("name") or "Board & Train",
            "duration_days": program_residential_duration_days(program),
            "source": "linked_program",
        }

    days = legacy_service_duration_days(row)
    if not days:
        return None
    return {
        "program_id": None,
        "program_name": row.get("name") or "Board & Train",
        "duration_days": days,
        "source": "legacy_service_duration",
    }


async def apply_board_train_span(db, body, service: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Mutate a BookingIn-like body to the package's full residential span.

    Training-type packages always use Program Studio duration, rather than a
    caller-supplied one-day/shorter span. Boarding-type packages already have
    normal stay semantics, so an explicit pickup date remains respected.
    """
    info = await board_train_stay_info(db, service)
    if not info:
        return None
    days = info.get("duration_days")
    if not days:
        raise HTTPException(
            status_code=400,
            detail=(
                f'{info.get("program_name") or "Board & Train"} needs a program duration '
                "(weeks or days) before it can be scheduled as a residential stay."
            ),
        )
    try:
        start = date.fromisoformat(str(body.date)[:10])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid Board & Train start date")

    service_type = (service or {}).get("service_type")
    if service_type != "boarding" or not getattr(body, "end_date", None):
        body.end_date = (start + timedelta(days=int(days))).isoformat()
    if service_type == "training":
        # A residential training package is an all-day multi-date booking, not
        # a one-hour training slot. Dropoff/pickup times remain separate fields.
        body.time = ""
        # Internal runtime marker only. The request model does not expose this
        # field, so an ordinary training caller cannot opt out of appointment
        # time validation. The downstream start-time wrapper uses it to apply
        # boarding-style drop-off semantics to verified Board & Train packages.
        object.__setattr__(body, "_board_train_residential", True)
    return info


async def repair_open_board_train_booking_spans(db, *, limit: int = 1000) -> int:
    """Repair open one-day Board & Train bookings made before this fix.

    Only training-type bookings with no end_date and no checked_out_at are
    touched. Historical financial/attendance rows remain unchanged. The repair
    is naturally idempotent because a repaired row now has an end_date.
    """
    services = await db.services.find(
        {"service_type": {"$in": ["training", "boarding"]}},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "service_type": 1, "package_program_id": 1},
    ).to_list(1000)
    if not services:
        return 0

    program_ids = sorted({str(s.get("package_program_id")) for s in services if s.get("package_program_id")})
    programs = []
    if program_ids:
        programs = await db.programs.find(
            {"id": {"$in": program_ids}, "type": "board_train"},
            {"_id": 0, "id": 1, "type": 1, "format": 1, "estimated_weeks": 1},
        ).to_list(len(program_ids))
    by_program = {p.get("id"): p for p in programs}

    days_by_service: Dict[str, int] = {}
    for service in services:
        days = None
        program_id = service.get("package_program_id")
        if program_id:
            days = program_residential_duration_days(by_program.get(program_id))
        else:
            days = legacy_service_duration_days(service)
        if service.get("id") and days:
            days_by_service[service["id"]] = int(days)
    if not days_by_service:
        return 0

    candidates = await db.bookings.find(
        {
            "service_type": "training",
            "status": {"$in": ["pending", "approved", "completed"]},
            "service_id": {"$in": list(days_by_service)},
            "$and": [
                {"$or": [{"end_date": {"$exists": False}}, {"end_date": None}, {"end_date": ""}]},
                {"$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}, {"checked_out_at": ""}]},
            ],
        },
        {"_id": 0, "id": 1, "date": 1, "service_id": 1},
    ).to_list(limit)

    repaired = 0
    for booking in candidates:
        days = days_by_service.get(booking.get("service_id"))
        if not days:
            continue
        try:
            start = date.fromisoformat(str(booking.get("date") or "")[:10])
        except ValueError:
            continue
        result = await db.bookings.update_one(
            {
                "id": booking.get("id"),
                "$and": [
                    {"$or": [{"end_date": {"$exists": False}}, {"end_date": None}, {"end_date": ""}]},
                    {"$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}, {"checked_out_at": ""}]},
                ],
            },
            {"$set": {
                "end_date": (start + timedelta(days=days)).isoformat(),
                "time": "",
            }},
        )
        repaired += int(getattr(result, "modified_count", 0) or 0)
    return repaired


def install_board_train_scheduling(*, server_module, db) -> None:
    """Install the canonical booking-span hook exactly once per process."""
    if getattr(server_module, "_board_train_scheduling_installed", False):
        return
    original_resolver = getattr(server_module, "_resolve_base_service_for_booking", None)
    original_booking_start = getattr(server_module, "_booking_start_local", None)
    if original_resolver is None:
        raise RuntimeError("Board & Train scheduling hook could not find exact service resolver")
    if original_booking_start is None:
        raise RuntimeError("Board & Train scheduling hook could not find booking start-time resolver")

    async def resolver_with_residential_span(body, user):
        service = await original_resolver(body, user)
        await apply_board_train_span(db, body, service)
        return service

    resolver_with_residential_span.__name__ = getattr(original_resolver, "__name__", "_resolve_base_service_for_booking")
    resolver_with_residential_span.__doc__ = getattr(original_resolver, "__doc__", None)
    resolver_with_residential_span._board_train_residential_wrapper = True
    server_module._resolve_base_service_for_booking = resolver_with_residential_span

    def booking_start_with_residential_training(body, settings):
        """Board & Train is residential, not a timed training appointment.

        The canonical resolver above sets the private marker only after it has
        verified the exact service is a linked/recognized Board & Train. For
        that one case, reuse the existing boarding start-time rules on a model
        copy so drop-off time works and the normal training-time requirement
        stays untouched for every other training service.
        """
        if not bool(getattr(body, "_board_train_residential", False)):
            return original_booking_start(body, settings)
        try:
            probe = body.model_copy(update={"service_type": "boarding", "time": ""})
        except AttributeError:  # Pydantic v1 compatibility for old test envs
            probe = body.copy(update={"service_type": "boarding", "time": ""})
        return original_booking_start(probe, settings)

    booking_start_with_residential_training.__name__ = getattr(original_booking_start, "__name__", "_booking_start_local")
    booking_start_with_residential_training.__doc__ = getattr(original_booking_start, "__doc__", None)
    booking_start_with_residential_training._board_train_residential_wrapper = True
    server_module._booking_start_local = booking_start_with_residential_training

    app = getattr(server_module, "app", None)
    if app is None:
        raise RuntimeError("Board & Train scheduling hook could not find FastAPI app")

    async def _startup_repair() -> None:
        try:
            repaired = await repair_open_board_train_booking_spans(db)
            if repaired:
                logger.info("Board & Train scheduling migration: repaired %d open booking span(s)", repaired)
        except Exception as exc:  # migration must never make the whole app unbootable
            logger.warning("Board & Train scheduling migration skipped (non-fatal): %s", exc)

    app.add_event_handler("startup", _startup_repair)
    server_module._board_train_scheduling_installed = True
    server_module._repair_open_board_train_booking_spans = lambda limit=1000: repair_open_board_train_booking_spans(db, limit=limit)
