"""Monthly Profit & Loss report generator for Sit Happens.

Builds a JSON snapshot first (`build_pl_data`) so the same data can power
both the JSON preview endpoint and the PDF render. PDF is rendered with
ReportLab — no external binaries needed.

Staff hours estimate is calculated from booking counts using these rules:
    daycare day      -> 9 hours
    boarding night   -> 4 hours (overnight care includes feeding + walks)
    training session -> 1 hour
    grooming session -> 1 hour
This is documented inline in the PDF so the reader knows where it came from.
"""
from __future__ import annotations

import io
import logging
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

STAFF_HOURS_PER = {
    "daycare": 9,
    "boarding": 4,
    "training": 1,
    "grooming": 1,
    "photography": 1,
}


def _fmt_money(n: float) -> str:
    return f"${n:,.2f}" if n >= 0 else f"-${abs(n):,.2f}"


def _fmt_date(iso: str) -> str:
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%b %-d, %Y")
    except Exception:
        return iso


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

    # ── Income totals
    completed = [b for b in bookings if b.get("status") == "completed"]
    paid = [b for b in bookings if b.get("payment_status") == "paid"]
    unpaid = [b for b in bookings if b.get("payment_status") == "unpaid" and b.get("actual_price")]

    completed_total = round(sum(float(b.get("actual_price") or 0) for b in completed), 2)
    paid_total = round(sum(float(b.get("actual_price") or 0) for b in paid), 2)
    unpaid_total = round(sum(float(b.get("actual_price") or 0) for b in unpaid), 2)

    # ── Daily revenue (completed bookings only)
    by_day_map: Dict[str, float] = defaultdict(float)
    for b in completed:
        by_day_map[b["date"]] += float(b.get("actual_price") or 0)
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
    staff_hours = 0.0
    staff_breakdown: Dict[str, float] = defaultdict(float)
    for b in completed:
        svc = b.get("service_type", "other")
        rate = STAFF_HOURS_PER.get(svc, 0)
        if svc == "boarding":
            hours = rate * _booking_nights(b)
        else:
            hours = rate
        staff_hours += hours
        staff_breakdown[svc] += hours
    staff_hours = round(staff_hours, 1)

    # ── Expenses
    expenses_total = round(sum(float(e.get("amount") or 0) for e in expenses), 2)
    exp_by_cat_map: Dict[str, Dict[str, Any]] = {}
    for e in expenses:
        cat = (e.get("category") or "Uncategorized").strip() or "Uncategorized"
        c = exp_by_cat_map.setdefault(cat, {"name": cat, "count": 0, "total": 0.0})
        c["count"] += 1
        c["total"] = round(c["total"] + float(e.get("amount") or 0), 2)
    expenses_by_category = sorted(exp_by_cat_map.values(), key=lambda x: -x["total"])

    # ── Year-to-date totals (Jan 1 of end_date's year through end_date)
    try:
        end_year = datetime.strptime(end_date, "%Y-%m-%d").year
        ytd_start = f"{end_year}-01-01"
        ytd_bookings = await db.bookings.find(
            {"date": {"$gte": ytd_start, "$lte": end_date}, "status": "completed"},
            {"_id": 0, "actual_price": 1, "date": 1},
        ).to_list(50000)
        ytd_income = round(sum(float(b.get("actual_price") or 0) for b in ytd_bookings), 2)
        ytd_exp_rows = await db.expenses.find(
            {"date": {"$gte": ytd_start, "$lte": end_date}},
            {"_id": 0, "amount": 1},
        ).to_list(50000)
        ytd_expenses = round(sum(float(e.get("amount") or 0) for e in ytd_exp_rows), 2)
    except Exception:
        ytd_start, ytd_income, ytd_expenses = end_date, 0.0, 0.0

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
        },
        "expenses": {
            "total": expenses_total,
            "count": len(expenses),
            "by_category": expenses_by_category,
        },
        "net": round(completed_total - expenses_total, 2),
        "top_clients": top_clients,
        "top_dogs": top_dogs,
        "staff_hours": {
            "total": staff_hours,
            "by_service": {k: round(v, 1) for k, v in staff_breakdown.items()},
            "assumptions": STAFF_HOURS_PER,
        },
        "ytd": {
            "start_date": ytd_start,
            "income": ytd_income,
            "expenses": ytd_expenses,
            "net": round(ytd_income - ytd_expenses, 2),
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

    # ── KPI tiles (4 across)
    income_total = data["income"]["completed_total"]
    exp_total = data["expenses"]["total"]
    net = data["net"]
    net_color = colors.HexColor("#16a34a") if net >= 0 else colors.HexColor("#dc2626")
    active_days = max(len(data["income"]["by_day"]), 1)
    avg_per_day = income_total / active_days

    def tile(label_text, value_text, value_color=INK):
        return Table(
            [[Paragraph(label_text, label)],
             [Paragraph(value_text, ParagraphStyle("v", parent=money_med, textColor=value_color))]],
            colWidths=[1.7 * inch],
            style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]),
        )

    kpi_row = Table(
        [[
            tile("INCOME (COMPLETED)", _fmt_money(income_total), BRAND),
            tile("EXPENSES", _fmt_money(exp_total), colors.HexColor("#dc2626")),
            tile("NET PROFIT", _fmt_money(net), net_color),
            tile("AVG / ACTIVE DAY", _fmt_money(avg_per_day), BLUE),
        ]],
        colWidths=[1.85 * inch] * 4,
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
    )
    story.append(kpi_row)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"<b>{data['income']['completed_count']}</b> completed bookings · "
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
    sh_rows = [["Service", "Hours"]]
    for svc, hrs in sh["by_service"].items():
        sh_rows.append([svc.title(), f"{hrs:.1f}"])
    sh_rows.append(["TOTAL", f"{sh['total']:.1f}"])
    t = Table(sh_rows, colWidths=[3.5 * inch, 2.5 * inch])
    t.setStyle(_table_style(INK, LINE, BLUE))
    story.append(t)
    assumptions = ", ".join(f"{k}={v}h" for k, v in sh["assumptions"].items())
    story.append(Paragraph(f"Assumptions per session: {assumptions}", small))

    # ── YTD running totals
    ytd = data["ytd"]
    story.append(Paragraph("Year-to-Date", h2))
    ytd_rows = [
        ["YTD income (since " + ytd["start_date"] + ")", _fmt_money(ytd["income"])],
        ["YTD expenses", _fmt_money(ytd["expenses"])],
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
