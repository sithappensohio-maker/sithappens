"""Monthly Profit & Loss report generator for Sit Happens.

Builds a JSON snapshot first (`build_pl_data`) so the same data can power
both the JSON preview endpoint and the PDF render. PDF is rendered with
ReportLab — no external binaries needed.

Employee/staff hours calculation:
    For each day we look at every completed booking with real check-in
    and check-out timestamps. The "operating window" for that day is
    (earliest check-in → latest check-out) — that's the shift length one
    employee covered. Summing those daily windows across the period gives
    a true labor-hours estimate.

    Boarding gets a separate fixed estimate (overnight care) since it spans
    multiple days and would otherwise inflate the daycare/training window.
"""
from __future__ import annotations

import io
import logging
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Hours per night for boarding (overnight rounds, not a continuous shift)
BOARDING_HOURS_PER_NIGHT = 4


def _fmt_money(n: float) -> str:
    return f"${n:,.2f}" if n >= 0 else f"-${abs(n):,.2f}"


def _fmt_date(iso: str) -> str:
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%b %-d, %Y")
    except Exception:
        return iso



def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 timestamp tolerantly (with or without Z suffix)."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _booking_nights(b: dict) -> int:
    """Boarding span — count nights between date and end_date (inclusive of start)."""
    if b.get("service_type") != "boarding":
        return 1
    start = b.get("date")
    end = b.get("end_date") or start
    if not start:
        return 1
    try:
        d1 = datetime.strptime(start, "%Y-%m-%d").date()
        d2 = datetime.strptime(end, "%Y-%m-%d").date()
        return max((d2 - d1).days, 1)
    except Exception:
        return 1


async def _compute_payroll_for_range(db, start_date: str, end_date: str) -> Dict[str, Any]:
    """Compute real payroll cost (gross + employer burden) for clocked-in
    employees in the window. Mirrors `/api/admin/today-pnl` so the PDF and the
    in-app tile reconcile. Returns a payroll block ready to embed in the P&L
    JSON / PDF, plus per-employee breakdown for the PDF table.

    Pulls payroll tax settings from `db.settings` (id=`payroll_tax`) so the
    rates configured under Admin → Payroll-tax flow through to this report.
    """
    # Lazy import to avoid a circular dependency at module load time.
    from server import _get_payroll_tax_settings, _compute_payroll_tax  # type: ignore

    tax = await _get_payroll_tax_settings()

    period_entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{start_date}T00:00:00", "$lte": f"{end_date}T23:59:59.999Z"},
         "clock_out_at": {"$ne": None, "$exists": True}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(50000)

    uids = list({e["user_id"] for e in period_entries})
    if not uids:
        return {
            "total_hours": 0.0,
            "gross": 0.0,
            "employer_burden": 0.0,
            "total_cost": 0.0,
            "per_employee": [],
            "entry_count": 0,
        }

    rate_users = await db.users.find(
        {"id": {"$in": uids}},
        {"_id": 0, "id": 1, "hourly_rate": 1, "name": 1, "display_name": 1},
    ).to_list(500)
    rate_map = {u["id"]: u for u in rate_users}

    # YTD pre-period hours per user — required so wage caps (FICA / FUTA /
    # SUTA) are respected. Without this an employee who hit the SS cap in
    # February would still get billed for SS for the whole year.
    try:
        end_year = datetime.strptime(end_date, "%Y-%m-%d").year
    except Exception:
        end_year = date.today().year
    ytd_start = f"{end_year}-01-01"
    pre_entries = await db.time_clock_entries.find(
        {"clock_in_at": {"$gte": f"{ytd_start}T00:00:00", "$lt": f"{start_date}T00:00:00"},
         "clock_out_at": {"$ne": None, "$exists": True},
         "user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "hours": 1},
    ).to_list(100000)
    pre_hours: Dict[str, float] = defaultdict(float)
    for e in pre_entries:
        pre_hours[e["user_id"]] += float(e.get("hours") or 0)

    period_hours: Dict[str, float] = defaultdict(float)
    for e in period_entries:
        period_hours[e["user_id"]] += float(e.get("hours") or 0)

    per_employee: List[Dict[str, Any]] = []
    total_hours = 0.0
    total_gross = 0.0
    total_burden = 0.0
    for uid, hrs in period_hours.items():
        u = rate_map.get(uid, {})
        rate = float(u.get("hourly_rate") or 0)
        ytd_gross_for_user = pre_hours.get(uid, 0) * rate
        c = _compute_payroll_tax(hrs, rate, ytd_gross_for_user, tax)
        per_employee.append({
            "user_id": uid,
            "name": u.get("display_name") or u.get("name") or "Unknown",
            "hours": round(hrs, 2),
            "rate": round(rate, 2),
            "gross": c["gross"],
            "employer_burden": c["employer_burden"],
            "total_cost": c["total_cost"],
        })
        total_hours += hrs
        total_gross += c["gross"]
        total_burden += c["employer_burden"]

    per_employee.sort(key=lambda x: -x["total_cost"])
    return {
        "total_hours": round(total_hours, 1),
        "gross": round(total_gross, 2),
        "employer_burden": round(total_burden, 2),
        "total_cost": round(total_gross + total_burden, 2),
        "per_employee": per_employee,
        "entry_count": len(period_entries),
    }


async def build_pl_data(db, start_date: str, end_date: str) -> Dict[str, Any]:
    """Build the full Profit & Loss dataset for a date range."""
    bookings = await db.bookings.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(20000)
    expenses = await db.expenses.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(20000)
    retail_sales = await db.retail_sales.find(
        {"date": {"$gte": start_date, "$lte": end_date}},
        {"_id": 0},
    ).to_list(20000)

    # Sprint 110cj/110cs — bookings whose payment came from a lot whose
    # revenue was already recognized at sale-time must be excluded from
    # completed/paid totals. Two flavors qualify:
    #   - training programs (`pack_kind == "training_program"`)
    #   - all new credit packs (`recognize_at_sale == True`, Sprint 110cs)
    program_lots = await db.credit_lots.find(
        {"$or": [
            {"pack_kind": "training_program"},
            {"recognize_at_sale": True},
        ]},
        {"_id": 0, "id": 1},
    ).to_list(20000)
    program_lot_ids = {lot["id"] for lot in program_lots}

    def _is_program_redemption(b: dict) -> bool:
        if b.get("is_prepaid_program_session"):
            return True
        if b.get("payment_method") != "credits":
            return False
        for lid in (b.get("credit_lot_ids") or []):
            if lid in program_lot_ids:
                return True
        return False

    # Filter program redemptions out of the booking pool BEFORE aggregations
    # so every downstream tally (totals, by_service, by_client, by_day, top_dogs)
    # naturally excludes the double-count.
    bookings = [b for b in bookings if not _is_program_redemption(b)]

    # ── Income totals
    completed = [b for b in bookings if b.get("status") == "completed"]
    paid = [b for b in bookings if b.get("payment_status") == "paid"]
    unpaid = [b for b in bookings if b.get("payment_status") == "unpaid" and b.get("actual_price")]

    completed_total = round(sum(float(b.get("actual_price") or 0) for b in completed), 2)
    paid_total = round(sum(float(b.get("actual_price") or 0) for b in paid), 2)
    unpaid_total = round(sum(float(b.get("actual_price") or 0) for b in unpaid), 2)

    # ── Daily revenue (completed bookings + retail sales)
    by_day_map: Dict[str, float] = defaultdict(float)
    for b in completed:
        by_day_map[b["date"]] += float(b.get("actual_price") or 0)
    for r in retail_sales:
        if r.get("date"):
            by_day_map[r["date"]] += float(r.get("amount") or 0)
    by_day = [{"date": d, "total": round(v, 2)} for d, v in sorted(by_day_map.items())]

    # ── Income by service (completed)
    by_service_map: Dict[str, Dict[str, Any]] = {}
    for b in completed:
        key = b.get("service_name") or b.get("service_type") or "Other"
        s = by_service_map.setdefault(key, {"name": key, "count": 0, "total": 0.0})
        s["count"] += 1
        s["total"] = round(s["total"] + float(b.get("actual_price") or 0), 2)
    by_service = sorted(by_service_map.values(), key=lambda x: -x["total"])

    # ── Top 5 clients by completed revenue
    by_client_map: Dict[str, Dict[str, Any]] = {}
    for b in completed:
        cid = b.get("client_id")
        name = b.get("client_name") or "Unknown"
        if not cid:
            continue
        c = by_client_map.setdefault(cid, {"client_id": cid, "name": name, "visits": 0, "total": 0.0})
        c["visits"] += 1
        c["total"] = round(c["total"] + float(b.get("actual_price") or 0), 2)
    top_clients = sorted(by_client_map.values(), key=lambda x: -x["total"])[:5]

    # ── Per-dog visit counts (completed daycare/boarding/training)
    by_dog_map: Dict[str, Dict[str, Any]] = {}
    for b in completed:
        did = b.get("dog_id")
        if not did:
            continue
        dname = b.get("dog_name") or "Unknown"
        d = by_dog_map.setdefault(did, {"dog_id": did, "name": dname, "visits": 0, "total": 0.0})
        d["visits"] += 1
        d["total"] = round(d["total"] + float(b.get("actual_price") or 0), 2)
    top_dogs = sorted(by_dog_map.values(), key=lambda x: -x["visits"])[:10]

    # ── Staff hours estimate
    # New logic (Sprint 91 fix):
    #   1) Daycare/training/grooming/photography share the same "shift window".
    #      For each day, find earliest check-in and latest check-out across
    #      all bookings on that date. Shift hours = max(checkout) - min(checkin).
    #      One employee covering all dogs on Monday from 7am to 6pm = 11 hours,
    #      not (11h × number_of_dogs).
    #   2) Boarding gets a fixed 4 hr / night allowance (overnight rounds).
    daily_windows: Dict[str, Dict[str, Optional[datetime]]] = {}  # date -> {min_in, max_out}
    boarding_hours_total = 0.0
    untimed_bookings = 0  # completed bookings missing check-in/check-out times
    for b in completed:
        svc = b.get("service_type", "other")
        if svc == "boarding":
            boarding_hours_total += BOARDING_HOURS_PER_NIGHT * _booking_nights(b)
            continue
        ci = _parse_iso(b.get("checked_in_at"))
        co = _parse_iso(b.get("checked_out_at"))
        if not ci or not co:
            untimed_bookings += 1
            continue
        day = b.get("date") or ci.date().isoformat()
        slot = daily_windows.setdefault(day, {"min_in": None, "max_out": None})
        if slot["min_in"] is None or ci < slot["min_in"]:
            slot["min_in"] = ci
        if slot["max_out"] is None or co > slot["max_out"]:
            slot["max_out"] = co

    shift_hours_total = 0.0
    daily_shifts: List[Dict[str, Any]] = []
    for day, w in sorted(daily_windows.items()):
        if not (w["min_in"] and w["max_out"] and w["max_out"] > w["min_in"]):
            continue
        hours = (w["max_out"] - w["min_in"]).total_seconds() / 3600.0
        shift_hours_total += hours
        daily_shifts.append({
            "date": day,
            "first_in": w["min_in"].isoformat(),
            "last_out": w["max_out"].isoformat(),
            "hours": round(hours, 2),
        })
    shift_hours_total = round(shift_hours_total, 1)
    boarding_hours_total = round(boarding_hours_total, 1)
    staff_hours_total = round(shift_hours_total + boarding_hours_total, 1)

    # ── Actual payroll cost from clocked-in time_clock_entries.
    # Mirrors the math used by /api/admin/today-pnl so the P&L PDF and the
    # in-app Income tile agree on "true labor cost" (gross wages + employer
    # taxes/burden). Sprint 110ai.
    payroll = await _compute_payroll_for_range(db, start_date, end_date)

    # ── Expenses
    expenses_total = round(sum(float(e.get("amount") or 0) for e in expenses), 2)
    exp_by_cat_map: Dict[str, Dict[str, Any]] = {}
    for e in expenses:
        cat = (e.get("category") or "Uncategorized").strip() or "Uncategorized"
        c = exp_by_cat_map.setdefault(cat, {"name": cat, "count": 0, "total": 0.0})
        c["count"] += 1
        c["total"] = round(c["total"] + float(e.get("amount") or 0), 2)
    expenses_by_category = sorted(exp_by_cat_map.values(), key=lambda x: -x["total"])

    # ── Retail sales aggregations.
    # Sprint 110cb — split training-program sales out of "Retail" so the
    # operator can see Training Revenue as its own line on the P&L (it's
    # services revenue, not merchandise revenue).
    retail_only = [r for r in retail_sales if r.get("source_kind") != "training_program_sale"]
    training_rows = [r for r in retail_sales if r.get("source_kind") == "training_program_sale"]
    retail_total = round(sum(float(r.get("amount") or 0) for r in retail_only), 2)
    training_revenue_total = round(sum(float(r.get("amount") or 0) for r in training_rows), 2)
    retail_by_cat_map: Dict[str, Dict[str, Any]] = {}
    for r in retail_only:
        cat = (r.get("category") or "Retail").strip() or "Retail"
        c = retail_by_cat_map.setdefault(cat, {"name": cat, "count": 0, "total": 0.0})
        c["count"] += 1
        c["total"] = round(c["total"] + float(r.get("amount") or 0), 2)
    retail_by_category = sorted(retail_by_cat_map.values(), key=lambda x: -x["total"])
    training_by_program_map: Dict[str, Dict[str, Any]] = {}
    for r in training_rows:
        # Strip the "Training Program · " prefix from description for a clean program name
        desc = r.get("description") or ""
        prog_name = desc.replace("Training Program · ", "").strip() or "Training Program"
        b = training_by_program_map.setdefault(prog_name, {"name": prog_name, "count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] = round(b["total"] + float(r.get("amount") or 0), 2)
    training_by_program = sorted(training_by_program_map.values(), key=lambda x: -x["total"])

    # ── Year-to-date totals (Jan 1 of end_date's year through end_date)
    try:
        end_year = datetime.strptime(end_date, "%Y-%m-%d").year
        ytd_start = f"{end_year}-01-01"
        ytd_bookings = await db.bookings.find(
            {"date": {"$gte": ytd_start, "$lte": end_date}, "status": "completed"},
            {"_id": 0, "actual_price": 1, "date": 1, "payment_method": 1, "credit_lot_ids": 1, "is_prepaid_program_session": 1},
        ).to_list(50000)
        # Sprint 110cj — drop training-program redemptions here too.
        ytd_bookings = [b for b in ytd_bookings if not _is_program_redemption(b)]
        ytd_income = round(sum(float(b.get("actual_price") or 0) for b in ytd_bookings), 2)
        ytd_exp_rows = await db.expenses.find(
            {"date": {"$gte": ytd_start, "$lte": end_date}},
            {"_id": 0, "amount": 1},
        ).to_list(50000)
        ytd_expenses = round(sum(float(e.get("amount") or 0) for e in ytd_exp_rows), 2)
        ytd_retail_rows = await db.retail_sales.find(
            {"date": {"$gte": ytd_start, "$lte": end_date}},
            {"_id": 0, "amount": 1},
        ).to_list(50000)
        ytd_retail = round(sum(float(r.get("amount") or 0) for r in ytd_retail_rows), 2)
    except Exception:
        ytd_start, ytd_income, ytd_expenses, ytd_retail = end_date, 0.0, 0.0, 0.0

    gross_income = round(completed_total + retail_total + training_revenue_total, 2)
    ytd_gross = round(ytd_income + ytd_retail, 2)

    # YTD payroll cost — uses calendar-year start through end_date so the
    # P&L footer reconciles with the same payroll line on /api/admin/today-pnl.
    ytd_payroll = await _compute_payroll_for_range(db, ytd_start, end_date)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "income": {
            "completed_total": completed_total,
            "paid_total": paid_total,
            "unpaid_total": round(unpaid_total, 2),
            "completed_count": len(completed),
            "by_service": by_service,
            "by_day": by_day,
            "retail_total": retail_total,
            "training_revenue_total": training_revenue_total,
            "gross_total": gross_income,
        },
        "retail": {
            "total": retail_total,
            "count": len(retail_only),
            "by_category": retail_by_category,
        },
        "training_revenue": {
            "total": training_revenue_total,
            "count": len(training_rows),
            "by_program": training_by_program,
        },
        "expenses": {
            "total": expenses_total,
            "count": len(expenses),
            "by_category": expenses_by_category,
        },
        "payroll": payroll,
        "net": round(gross_income - expenses_total - payroll["total_cost"], 2),
        "net_before_payroll": round(gross_income - expenses_total, 2),
        "top_clients": top_clients,
        "top_dogs": top_dogs,
        "staff_hours": {
            "total": staff_hours_total,
            "shift_hours": shift_hours_total,
            "boarding_hours": boarding_hours_total,
            "untimed_bookings": untimed_bookings,
            "daily_shifts": daily_shifts,
            "assumptions": {
                "rule": "shift_window = max(checkout) - min(checkin) per day across all on-site bookings",
                "boarding_hours_per_night": BOARDING_HOURS_PER_NIGHT,
            },
        },
        "ytd": {
            "start_date": ytd_start,
            "income": ytd_gross,
            "service_income": ytd_income,
            "retail_income": ytd_retail,
            "expenses": ytd_expenses,
            "payroll": ytd_payroll["total_cost"],
            "payroll_gross": ytd_payroll["gross"],
            "payroll_burden": ytd_payroll["employer_burden"],
            "net": round(ytd_gross - ytd_expenses - ytd_payroll["total_cost"], 2),
        },
    }


# ───────────────────────── PDF rendering ─────────────────────────
def render_pl_pdf(data: Dict[str, Any], brand_name: str = "Sit Happens") -> bytes:
    """Render the P&L dataset to a PDF and return raw bytes."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        rightMargin=0.5 * inch, leftMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
        title=f"P&L · {data['start_date']} → {data['end_date']}",
        author=brand_name,
    )
    styles = getSampleStyleSheet()
    BRAND = colors.HexColor("#8cc63f")
    BLUE = colors.HexColor("#00a9e0")
    INK = colors.HexColor("#0f172a")
    MUTED = colors.HexColor("#64748b")
    LINE = colors.HexColor("#e2e8f0")

    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=INK,
                        fontName="Helvetica-Bold", fontSize=22, leading=26, spaceAfter=4)
    sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=MUTED,
                         fontSize=10, leading=14, spaceAfter=12)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=INK,
                        fontName="Helvetica-Bold", fontSize=13, leading=18,
                        spaceBefore=14, spaceAfter=6,
                        borderPadding=4, borderColor=LINE, borderWidth=0)
    small = ParagraphStyle("small", parent=styles["Normal"], textColor=MUTED,
                           fontSize=8, leading=11)
    money_med = ParagraphStyle("money_med", parent=styles["Normal"],
                               fontSize=14, leading=16, alignment=1,
                               textColor=INK, fontName="Helvetica-Bold")
    label = ParagraphStyle("label", parent=styles["Normal"], textColor=MUTED,
                           fontSize=8, leading=10, alignment=1,
                           fontName="Helvetica-Bold")

    story: List[Any] = []

    # ── Header
    title_text = f"<b>{brand_name}</b> · Profit &amp; Loss Report"
    story.append(Paragraph(title_text, h1))
    story.append(Paragraph(
        f"{_fmt_date(data['start_date'])} &nbsp;→&nbsp; {_fmt_date(data['end_date'])} "
        f"&nbsp;·&nbsp; generated {data['generated_at'][:10]}",
        sub,
    ))

    # ── KPI tiles (5 across — adds Payroll so the bottom-line NET is clearly
    # backed by real labor cost from clocked-in hours, not just expenses).
    service_income = data["income"]["completed_total"]
    retail_income = float(data.get("retail", {}).get("total") or 0)
    income_total = data["income"].get("gross_total") or (service_income + retail_income)
    exp_total = data["expenses"]["total"]
    payroll_total = float(data.get("payroll", {}).get("total_cost") or 0)
    net = data["net"]
    net_color = colors.HexColor("#16a34a") if net >= 0 else colors.HexColor("#dc2626")
    active_days = max(len(data["income"]["by_day"]), 1)
    avg_per_day = income_total / active_days

    def tile(label_text, value_text, value_color=INK):
        return Table(
            [[Paragraph(label_text, label)],
             [Paragraph(value_text, ParagraphStyle("v", parent=money_med, textColor=value_color))]],
            colWidths=[1.4 * inch],
            style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]),
        )

    kpi_row = Table(
        [[
            tile("INCOME (GROSS)", _fmt_money(income_total), BRAND),
            tile("EXPENSES", _fmt_money(exp_total), colors.HexColor("#dc2626")),
            tile("PAYROLL COST", _fmt_money(payroll_total), colors.HexColor("#dc2626")),
            tile("NET PROFIT", _fmt_money(net), net_color),
            tile("AVG / ACTIVE DAY", _fmt_money(avg_per_day), BLUE),
        ]],
        colWidths=[1.5 * inch] * 5,
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
    )
    story.append(kpi_row)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"<b>Services:</b> {_fmt_money(service_income)} ({data['income']['completed_count']} bookings) &nbsp;·&nbsp; "
        f"<b>Retail:</b> {_fmt_money(retail_income)} ({data.get('retail',{}).get('count',0)} sales) &nbsp;·&nbsp; "
        f"<b>{_fmt_money(data['income']['paid_total'])}</b> received · "
        f"<b>{_fmt_money(data['income']['unpaid_total'])}</b> outstanding",
        small,
    ))

    # ── Daily revenue bar chart (simple ascii-ish bars built with Table for portability)
    by_day = data["income"]["by_day"]
    if by_day:
        story.append(Paragraph("Daily Revenue", h2))
        max_total = max((d["total"] for d in by_day), default=1) or 1
        # Bar table: date | bar | $
        bar_rows = []
        for d in by_day[-31:]:  # last 31 days max
            bar_width = max(int((d["total"] / max_total) * 200), 2)
            bar = Table([[" "]], colWidths=[bar_width],
                        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND)]))
            bar_rows.append([d["date"], bar, _fmt_money(d["total"])])
        bar_table = Table(bar_rows, colWidths=[0.9 * inch, 2.5 * inch, 1.0 * inch])
        bar_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("FONT", (0, 0), (0, -1), "Helvetica", 8),
            ("FONT", (2, 0), (2, -1), "Helvetica-Bold", 9),
            ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
            ("TEXTCOLOR", (2, 0), (2, -1), INK),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(bar_table)

    # ── Income by service
    story.append(Paragraph("Income by Service", h2))
    bs = data["income"]["by_service"]
    if bs:
        rows = [["Service", "Count", "Total"]] + [
            [s["name"], str(s["count"]), _fmt_money(s["total"])] for s in bs
        ]
        rows.append(["TOTAL", str(sum(s["count"] for s in bs)), _fmt_money(sum(s["total"] for s in bs))])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(_table_style(INK, LINE, BRAND))
        story.append(t)
    else:
        story.append(Paragraph("<i>No completed bookings in this period.</i>", small))

    # ── Retail sales (external POS)
    rc = data.get("retail", {}).get("by_category") or []
    if rc or retail_income > 0:
        story.append(Paragraph("Retail Sales (External POS)", h2))
        if rc:
            rows = [["Category", "Items", "Total"]] + [
                [c["name"], str(c["count"]), _fmt_money(c["total"])] for c in rc
            ]
            rows.append(["TOTAL", str(data["retail"]["count"]), _fmt_money(data["retail"]["total"])])
            t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
            t.setStyle(_table_style(INK, LINE, colors.HexColor("#a855f7")))
            story.append(t)
        else:
            story.append(Paragraph("<i>No retail sales logged.</i>", small))

    # ── Expenses by category
    story.append(Paragraph("Expenses by Category", h2))
    ec = data["expenses"]["by_category"]
    if ec:
        rows = [["Category", "Items", "Total"]] + [
            [c["name"], str(c["count"]), _fmt_money(c["total"])] for c in ec
        ]
        rows.append(["TOTAL", str(sum(c["count"] for c in ec)), _fmt_money(data["expenses"]["total"])])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(_table_style(INK, LINE, colors.HexColor("#dc2626")))
        story.append(t)
    else:
        story.append(Paragraph("<i>No expenses logged.</i>", small))

    # ── Top 5 clients
    story.append(Paragraph("Top 5 Clients by Revenue", h2))
    tc = data["top_clients"]
    if tc:
        rows = [["Client", "Visits", "Revenue"]] + [
            [c["name"], str(c["visits"]), _fmt_money(c["total"])] for c in tc
        ]
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(_table_style(INK, LINE, BLUE))
        story.append(t)
    else:
        story.append(Paragraph("<i>No client revenue in this period.</i>", small))

    # ── Per-dog visit counts (top 10)
    story.append(Paragraph("Most Active Dogs (Top 10)", h2))
    td = data["top_dogs"]
    if td:
        rows = [["Dog", "Visits", "Revenue"]] + [
            [d["name"], str(d["visits"]), _fmt_money(d["total"])] for d in td
        ]
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(_table_style(INK, LINE, BRAND))
        story.append(t)
    else:
        story.append(Paragraph("<i>No dog visits in this period.</i>", small))

    # ── Staff hours
    story.append(Paragraph("Estimated Staff Hours", h2))
    sh = data["staff_hours"]
    sh_rows = [
        ["On-site shift hours (min check-in → max check-out)", f"{sh['shift_hours']:.1f}"],
        ["Boarding overnight care", f"{sh['boarding_hours']:.1f}"],
        ["TOTAL", f"{sh['total']:.1f}"],
    ]
    t = Table(sh_rows, colWidths=[3.5 * inch, 2.5 * inch])
    t.setStyle(_table_style(INK, LINE, BLUE, header=False))
    story.append(t)
    story.append(Paragraph(
        f"Shift rule: one employee covers all on-site dogs each day; daily hours = "
        f"latest check-out minus earliest check-in. Boarding adds "
        f"<b>{sh['assumptions']['boarding_hours_per_night']}h</b> per night for overnight rounds. "
        + (f"{sh['untimed_bookings']} completed booking(s) lacked check-in/out timestamps and were excluded."
           if sh['untimed_bookings'] else ""),
        small,
    ))

    # Daily breakdown table — useful for spotting outliers
    if sh.get("daily_shifts"):
        daily_rows = [["Date", "First in", "Last out", "Hours"]]
        for d in sh["daily_shifts"][-31:]:  # last 31 days max
            first_in = d["first_in"][11:16] if len(d["first_in"]) >= 16 else d["first_in"]
            last_out = d["last_out"][11:16] if len(d["last_out"]) >= 16 else d["last_out"]
            daily_rows.append([d["date"], first_in, last_out, f"{d['hours']:.2f}"])
        t2 = Table(daily_rows, colWidths=[1.4 * inch, 1.3 * inch, 1.3 * inch, 1.0 * inch])
        t2.setStyle(_table_style(INK, LINE, BLUE))
        story.append(Spacer(1, 4))
        story.append(t2)

    # ── Payroll cost (clocked-in staff) — actual time_clock_entries × rate +
    # employer burden, mirrors the Income page's labor tile.
    pay = data.get("payroll") or {}
    story.append(Paragraph("Payroll Cost · clocked-in staff", h2))
    if pay.get("entry_count"):
        pay_rows = [
            ["Total clocked-in hours", f"{pay['total_hours']:.1f}"],
            ["Gross wages", _fmt_money(pay["gross"])],
            ["Employer burden (FICA · FUTA · SUTA · Workers' comp · Medicare)", _fmt_money(pay["employer_burden"])],
            ["TOTAL PAYROLL COST", _fmt_money(pay["total_cost"])],
        ]
        t = Table(pay_rows, colWidths=[4.5 * inch, 1.5 * inch])
        t.setStyle(_table_style(INK, LINE, colors.HexColor("#dc2626"), header=False))
        story.append(t)
        if pay.get("per_employee"):
            story.append(Spacer(1, 6))
            emp_rows = [["Employee", "Hours", "Rate", "Gross", "Burden", "Total"]]
            for e in pay["per_employee"]:
                emp_rows.append([
                    e["name"],
                    f"{e['hours']:.1f}",
                    _fmt_money(e["rate"]),
                    _fmt_money(e["gross"]),
                    _fmt_money(e["employer_burden"]),
                    _fmt_money(e["total_cost"]),
                ])
            t = Table(emp_rows, colWidths=[1.8 * inch, 0.7 * inch, 0.8 * inch, 1.0 * inch, 0.9 * inch, 1.0 * inch])
            t.setStyle(_table_style(INK, LINE, colors.HexColor("#dc2626")))
            story.append(t)
        story.append(Paragraph(
            "Payroll cost is computed from real time-clock entries × each employee's hourly rate, "
            "with employer FICA/FUTA/SUTA/workers'-comp added on top using the rates configured in "
            "Admin → Payroll-tax settings. Numbers reconcile with the live Income tile.",
            small,
        ))
    else:
        story.append(Paragraph(
            "<i>No completed time-clock entries in this window — payroll cost is $0. "
            "Make sure your staff clock in/out via the Time tab so this line reflects reality.</i>",
            small,
        ))

    # ── YTD running totals
    ytd = data["ytd"]
    story.append(Paragraph("Year-to-Date", h2))
    ytd_rows = [
        ["YTD service income (since " + ytd["start_date"] + ")", _fmt_money(ytd.get("service_income") or ytd["income"])],
        ["YTD retail income", _fmt_money(ytd.get("retail_income") or 0)],
        ["YTD gross income", _fmt_money(ytd["income"])],
        ["YTD expenses", _fmt_money(ytd["expenses"])],
        ["YTD payroll cost", _fmt_money(ytd.get("payroll") or 0)],
        ["YTD net", _fmt_money(ytd["net"])],
    ]
    t = Table(ytd_rows, colWidths=[3.5 * inch, 2.5 * inch])
    t.setStyle(_table_style(INK, LINE, BRAND, header=False))
    story.append(t)

    # ── Footer
    story.append(Spacer(1, 18))
    story.append(Paragraph(
        f"Generated by {brand_name} CRM · {data['generated_at'][:10]}",
        small,
    ))

    doc.build(story)
    return buf.getvalue()


def _table_style(ink, line, accent, header: bool = True):
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle
    styles = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), ink),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, line),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        styles += [
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("BACKGROUND", (0, 0), (-1, 0), accent),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 9),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f1f5f9")),
        ]
    return TableStyle(styles)
