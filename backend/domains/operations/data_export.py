"""Settings → Data Export: one CSV per dataset (audit "Data Export CSVs have
empty money columns and stop at 90 days").

Each file reads the fields the app really stores. The income ledger keeps
date / amount / payment_method (never ts / total / method), and its file
also carries each row's sales tax, the pre-tax part a gift card paid for
(already income when the card was sold) and the business revenue, so
amount - sales_tax - gift_card_paid_pre_tax = business_revenue, the P&L's
own figure. A visit keeps
estimated_price and actual_price (never "price"), and the bookings file
includes the visits moved to bookings_archive after 90 days. No file stops at
a row limit: X-Row-Count is every row written, and a read that fails fails
the download rather than shortening it.
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Callable, Dict, List, Tuple

from fastapi import Depends, HTTPException
from fastapi.responses import Response

_server_globals: Dict[str, Any] = {}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


Column = Tuple[str, Callable[[dict], Any], Tuple[str, ...]]   # header, getter, stored fields it reads


def _col(name: str) -> Column:
    return (name, lambda row: row.get(name, ""), (name,))


def _first(header: str, *names: str) -> Column:
    """The first of `names` the row really has — rows of some kinds keep the
    same thing under another name (a credit pack's pack_name, a payment
    plan's item_name, a register pack's note)."""
    def get(row: dict):
        for n in names:
            if row.get(n) not in (None, ""):
                return row[n]
        return ""
    return (header, get, names)


def _cols(*names: str) -> List[Column]:
    return [_col(n) for n in names]


def _fixed(row: dict) -> str:
    # The Dog screen's own rule for old values (True, "spayed", missing …).
    return _g("_normalize_dog_doc")({"fixed": row.get("fixed")})["fixed"]


ENTITIES: Dict[str, Tuple[str, List[Column]]] = {
    "clients": ("clients", [*_cols("id", "name", "email", "phone", "address"),
                            _first("notes", "evaluation_notes"), _col("created_at")]),
    "dogs": ("dogs", [*_cols("id", "name", "breed", "age_y", "owner_id"),
                      ("spayed_neutered", _fixed, ("fixed",)),
                      *_cols("safety_flags", "notes", "created_at")]),
    "bookings": ("bookings", _cols("id", "dog_id", "dog_name", "client_id", "client_name", "service_type", "date",
                                   "end_date", "status", "kennel", "room", "crate", "yard_group", "training_group",
                                   "estimated_price", "actual_price", "created_at")),
    "waitlist": ("waitlist", _cols("id", "client_name", "dog_name", "service_type", "requested_date",
                                   "requested_end_date", "priority", "status", "notes", "created_at", "booking_id")),
    "intake_templates": ("intake_form_templates", _cols("id", "name", "form_type", "active", "is_starter",
                                                        "description", "created_at")),
    "intake_submissions": ("intake_submissions", _cols("id", "template_name", "form_type", "client_id", "dog_id",
                                                       "status", "review_notes", "sent_at", "submitted_at",
                                                       "reviewed_at", "reviewed_by")),
    "incidents": ("incidents", _cols("id", "dog_id", "dog_name", "client_id", "client_name", "date", "time", "type",
                                     "severity", "description", "action_taken", "follow_up_required",
                                     "manager_reviewed", "client_notified", "internal_notes", "reported_by",
                                     "created_at")),
    "safety_flags": ("dogs", _cols("id", "name", "safety_flags")),
    "vaccines": ("dogs", _cols("id", "name", "vaccines")),
    "income": ("retail_sales", [
        *_cols("id", "date", "source_kind", "category"),
        _first("description", "description", "item_name", "pack_name", "category"),
        *_cols("client_id", "client_name", "booking_id", "amount"),
        # Sales tax is owed to Ohio and a gift card's part was income when the
        # card was sold: the P&L's own per-row rule says what is revenue.
        ("sales_tax", lambda row: _g("_sales_tax_collected_on_row")(row), ("tax_amount",)),
        # gift_card_funded is the PRE-TAX part the card covered (a $53.50 sale with
        # $3.50 tax paid by card stores 50.00), never the amount the card paid.
        ("gift_card_paid_pre_tax", lambda row: round(float(row.get("gift_card_funded") or 0), 2), ("gift_card_funded",)),
        ("business_revenue", lambda row: _g("_business_revenue_net_of_sales_tax")(row),
         ("amount", "tax_amount", "gift_card_funded", "source_kind")),
        _col("payment_method"),
        _first("notes", "notes", "note"),
        _col("created_at"),
    ]),
    "communications": ("client_communications", _cols("id", "client_name", "type", "summary", "occurred_at",
                                                      "follow_up_required", "follow_up_date", "created_by_name")),
    "timeclock": ("time_clock_entries", _cols("id", "user_id", "user_name", "clock_in_at", "clock_out_at", "hours",
                                             "break_minutes", "clock_in_note", "clock_out_note")),
}


def _projection(columns: List[Column]) -> Dict[str, int]:
    # Only the fields the file needs: a dog's photos never load into memory.
    proj: Dict[str, int] = {"_id": 0}
    for _header, _get, fields in columns:
        for f in fields:
            proj[f] = 1
    return proj


def _cell(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, default=str)
    return v


async def _booking_rows(proj: Dict[str, int]) -> List[dict]:
    """Every visit, live and archived. The live copy wins when a visit is in
    both (an archive move whose delete failed). No error is swallowed: an
    archive that can't be read fails the download, never shortens it."""
    db = _g("db")
    rows: List[dict] = []
    live = set()
    async for r in db.bookings.find({}, {**proj, "id": 1}):
        rows.append(r)
        if r.get("id"):
            live.add(r["id"])
    async for r in db.bookings_archive.find({}, {**proj, "id": 1}):
        if r.get("id") in live:
            continue
        rows.append(r)
    rows.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("created_at") or ""), str(r.get("id") or "")))
    return rows


async def _bookings_count() -> int:
    db = _g("db")
    live_ids = await db.bookings.distinct("id")
    return int(await db.bookings.count_documents({})
               + await db.bookings_archive.count_documents({"id": {"$nin": live_ids}}))


def register_routes(*, api, server_globals: dict) -> None:
    perm = server_globals["require_admin_and_permission"]

    async def export_csv(entity: str, _: dict = Depends(perm("data_export"))):
        if entity not in ENTITIES:
            raise HTTPException(status_code=400, detail=f"Unknown entity '{entity}'. Allowed: {list(ENTITIES.keys())}")
        coll, columns = ENTITIES[entity]
        proj = _projection(columns)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([h for h, _get, _f in columns])
        if entity == "bookings":
            rows = await _booking_rows(proj)
        elif entity == "income":
            rows = _g("db")[coll].find({}, proj).sort([("date", 1), ("created_at", 1)])   # same day: in the order recorded
        else:
            rows = _g("db")[coll].find({}, proj)
        written = 0
        if isinstance(rows, list):
            for r in rows:
                w.writerow([_cell(get(r)) for _h, get, _f in columns])
                written += 1
        else:
            async for r in rows:     # every row — no limit
                w.writerow([_cell(get(r)) for _h, get, _f in columns])
                written += 1
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="sithappens-{entity}-{_g("business_today")().isoformat()}.csv"',
                     "X-Row-Count": str(written)},
        )

    async def export_index(_: dict = Depends(perm("data_export"))):
        """Counts per entity, the same rows each file writes."""
        db = _g("db")
        out = {}
        for k, (coll, _cols_) in ENTITIES.items():
            out[k] = await _bookings_count() if k == "bookings" else await db[coll].count_documents({})
        return out

    api.add_api_route("/export/{entity}", export_csv, methods=["GET"])
    api.add_api_route("/export-index", export_index, methods=["GET"])
