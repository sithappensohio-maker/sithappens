"""Monthly Financial Report — one complete, printable snapshot per calendar
month, built for year-end accounting and tax prep.

This module adds no new revenue/expense math of its own. Every dollar comes
from the SAME canonical helpers Finance/Analytics/the Sales Tax Tracker
already use (`pl_report.build_pl_data`, `_sales_tax_window_summary`,
`_register_range_summary`) so a monthly report can never disagree with the
rest of the app. It only assembles those pieces per calendar month and adds
the few things no existing report breaks out: recurring-bills-paid detail,
payment-method split, gift card activity, and the mileage deduction.
"""
from __future__ import annotations

import calendar
import io
from datetime import date
from typing import Any, Dict, List, Optional


def month_bounds(year: int, month: int) -> tuple[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


async def build_monthly_report_data(db, year: int, month: int) -> Dict[str, Any]:
    """Full report payload for one calendar month."""
    import pl_report
    from server import _sales_tax_window_summary, _payment_method_totals_for_range, mileage_rate_for_year

    start_date, end_date = month_bounds(year, month)
    pl = await pl_report.build_pl_data(db, start_date, end_date)
    sales_tax = await _sales_tax_window_summary(start_date, end_date)
    payment_methods = await _payment_method_totals_for_range(start_date, end_date)

    # Recurring bills paid this month — a labeled subset of the expenses
    # pl_report already totaled (bills.py tags every bill payment with
    # bill_id when it writes the expense row), broken out for vendor-level
    # detail without re-deriving anything from the raw expense ledger.
    bills_paid = await db.expenses.find(
        {"date": {"$gte": start_date, "$lte": end_date}, "bill_id": {"$exists": True}},
        {"_id": 0, "date": 1, "vendor": 1, "category": 1, "amount": 1, "payment_method": 1, "name": 1},
    ).sort("date", 1).to_list(2000)
    bills_paid_total = round(sum(float(b.get("amount") or 0) for b in bills_paid), 2)
    one_off_expenses_total = round(float(pl["expenses"]["total"]) - bills_paid_total, 2)

    # Gift card activity — sold vs. redeemed this month. Informational only:
    # gift card sales already fall into the generic "retail" bucket in
    # pl.retail (there's no dedicated gift-card income category), so this
    # section itemizes the activity without changing any revenue total above.
    gc_sold_rows = await db.retail_sales.find(
        {"date": {"$gte": start_date, "$lte": end_date}, "source_kind": "gift_card_sale"},
        {"_id": 0, "amount": 1},
    ).to_list(5000)
    gc_sold_total = round(sum(float(r.get("amount") or 0) for r in gc_sold_rows), 2)
    gc_redeemed_rows = await db.retail_sales.find(
        {"date": {"$gte": start_date, "$lte": end_date}, "gift_card_funded": {"$gt": 0}},
        {"_id": 0, "gift_card_funded": 1},
    ).to_list(5000)
    gc_redeemed_total = round(sum(float(r.get("gift_card_funded") or 0) for r in gc_redeemed_rows), 2)

    # Mileage deduction (Schedule C vehicle expense) for the month, using the
    # same IRS-rate lookup the Quarterly Tax estimate uses.
    mileage_rows = await db.mileage_log.find(
        {"date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0, "miles": 1},
    ).to_list(5000)
    miles_total = round(sum(float(r.get("miles") or 0) for r in mileage_rows), 2)
    mileage_rate = mileage_rate_for_year(year)
    mileage_deduction = round(miles_total * mileage_rate, 2)

    return {
        "year": year,
        "month": month,
        "label": date(year, month, 1).strftime("%B %Y"),
        "start_date": start_date,
        "end_date": end_date,
        "generated_at": pl["generated_at"],
        "pl": pl,
        "sales_tax": sales_tax,
        "payment_methods": payment_methods,
        "bills_paid": {"rows": bills_paid, "total": bills_paid_total},
        "one_off_expenses_total": one_off_expenses_total,
        "gift_cards": {
            "sold_total": gc_sold_total,
            "sold_count": len(gc_sold_rows),
            "redeemed_total": gc_redeemed_total,
            "redeemed_count": len(gc_redeemed_rows),
        },
        "mileage": {"miles": miles_total, "rate": mileage_rate, "deduction": mileage_deduction},
    }


async def build_year_overview(db, year: int) -> Dict[str, Any]:
    """Quick per-month totals for the 12-month grid. Months in the future
    (relative to today) come back as not-yet-available rather than querying."""
    import pl_report
    from server import business_today

    today = business_today()
    months: List[Dict[str, Any]] = []
    for m in range(1, 13):
        start_date, end_date = month_bounds(year, m)
        label = date(year, m, 1).strftime("%b")
        if start_date > today.isoformat():
            months.append({
                "year": year, "month": m, "label": label,
                "revenue": None, "expenses": None, "payroll": None, "net": None,
                "available": False,
            })
            continue
        pl = await pl_report.build_pl_data(db, start_date, end_date)
        months.append({
            "year": year, "month": m, "label": label,
            "revenue": pl["income"]["net_total"],
            "expenses": round(float(pl["expenses"]["total"]) + float(pl["payroll"]["total_cost"]), 2),
            "payroll": pl["payroll"]["total_cost"],
            "net": pl["net"],
            "available": True,
        })
    return {"year": year, "months": months}


# ───────────────────────── PDF rendering ─────────────────────────

def _fmt_money(n: float) -> str:
    return f"${n:,.2f}" if n >= 0 else f"-${abs(n):,.2f}"


def _build_month_story(data: Dict[str, Any], brand_name: str, *, lead_with_page_break: bool) -> List[Any]:
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak
    import pl_report

    styles = getSampleStyleSheet()
    BRAND = colors.HexColor("#8cc63f")
    BLUE = colors.HexColor("#00a9e0")
    INK = colors.HexColor("#0f172a")
    MUTED = colors.HexColor("#64748b")
    LINE = colors.HexColor("#e2e8f0")
    RED = colors.HexColor("#dc2626")

    h1 = ParagraphStyle("mr_h1", parent=styles["Heading1"], textColor=INK,
                         fontName="Helvetica-Bold", fontSize=20, leading=24, spaceAfter=4)
    sub = ParagraphStyle("mr_sub", parent=styles["Normal"], textColor=MUTED,
                          fontSize=10, leading=14, spaceAfter=10)
    h2 = ParagraphStyle("mr_h2", parent=styles["Heading2"], textColor=INK,
                         fontName="Helvetica-Bold", fontSize=12, leading=16,
                         spaceBefore=12, spaceAfter=5)
    small = ParagraphStyle("mr_small", parent=styles["Normal"], textColor=MUTED,
                            fontSize=8, leading=11)
    money_med = ParagraphStyle("mr_money", parent=styles["Normal"],
                                fontSize=13, leading=15, alignment=1,
                                textColor=INK, fontName="Helvetica-Bold")
    tile_label = ParagraphStyle("mr_label", parent=styles["Normal"], textColor=MUTED,
                                 fontSize=7.5, leading=9, alignment=1,
                                 fontName="Helvetica-Bold")

    def tile(label_text, value_text, value_color=INK):
        return Table(
            [[Paragraph(label_text, tile_label)],
             [Paragraph(value_text, ParagraphStyle("mr_v", parent=money_med, textColor=value_color))]],
            colWidths=[1.33 * inch],
            style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        )

    story: List[Any] = []
    if lead_with_page_break:
        story.append(PageBreak())

    pl = data["pl"]
    tax = data["sales_tax"]
    gc = data["gift_cards"]
    mi = data["mileage"]

    story.append(Paragraph(f"<b>{brand_name}</b> · Monthly Financial Report", h1))
    story.append(Paragraph(
        f"{data['label']} &nbsp;·&nbsp; {data['start_date']} &rarr; {data['end_date']} "
        f"&nbsp;·&nbsp; generated {data['generated_at'][:10]}",
        sub,
    ))

    net = pl["net"]
    net_color = colors.HexColor("#16a34a") if net >= 0 else RED
    kpi_row = Table(
        [[
            tile("REVENUE", _fmt_money(pl["income"]["net_total"]), BRAND),
            tile("EXPENSES", _fmt_money(pl["expenses"]["total"]), RED),
            tile("PAYROLL", _fmt_money(pl["payroll"]["total_cost"]), RED),
            tile("SALES TAX COLLECTED", _fmt_money(tax["total_tax_collected"]), BLUE),
            tile("NET PROFIT", _fmt_money(net), net_color),
        ]],
        colWidths=[1.4 * inch] * 5,
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
    )
    story.append(kpi_row)
    story.append(Spacer(1, 10))

    # ── Income by service / retail / training (reuse pl_report's table style)
    story.append(Paragraph("Income by Service", h2))
    bs = pl["income"]["by_service"]
    if bs:
        rows = [["Service", "Count", "Total"]] + [[s["name"], str(s["count"]), _fmt_money(s["total"])] for s in bs]
        rows.append(["TOTAL", str(sum(s["count"] for s in bs)), _fmt_money(sum(s["total"] for s in bs))])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, BRAND))
        story.append(t)
    else:
        story.append(Paragraph("<i>No completed bookings this month.</i>", small))

    rc = pl.get("retail", {}).get("by_category") or []
    if rc:
        story.append(Paragraph("Retail Sales", h2))
        rows = [["Category", "Items", "Total"]] + [[c["name"], str(c["count"]), _fmt_money(c["total"])] for c in rc]
        rows.append(["TOTAL", str(pl["retail"]["count"]), _fmt_money(pl["retail"]["total"])])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, colors.HexColor("#a855f7")))
        story.append(t)

    tp = pl.get("training_revenue", {}).get("by_program") or []
    if tp:
        story.append(Paragraph("Training Program Revenue", h2))
        rows = [["Program", "Sales", "Total"]] + [[p["name"], str(p["count"]), _fmt_money(p["total"])] for p in tp]
        rows.append(["TOTAL", str(pl["training_revenue"]["count"]), _fmt_money(pl["training_revenue"]["total"])])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, BLUE))
        story.append(t)

    if pl["income"].get("refunds_reversals_total"):
        story.append(Paragraph(
            f"<b>Refunds &amp; reversals this month:</b> {_fmt_money(pl['income']['refunds_reversals_total'])} "
            f"(already subtracted from revenue above)",
            small,
        ))

    # ── Payment method breakdown (NEW)
    pm = data["payment_methods"] or {}
    pm_rows = [[k.replace("_", " ").title(), _fmt_money(float(v))] for k, v in pm.items() if abs(float(v or 0)) >= 0.005]
    if pm_rows:
        story.append(Paragraph("Payment Method Breakdown", h2))
        rows = [["Method", "Amount"]] + pm_rows
        rows.append(["TOTAL", _fmt_money(sum(float(v or 0) for v in pm.values()))])
        t = Table(rows, colWidths=[3.5 * inch, 2.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, colors.HexColor("#00a9e0")))
        story.append(t)

    # ── Sales tax detail (NEW)
    story.append(Paragraph("Sales Tax Detail", h2))
    tax_rows = [
        ["Tax collected on bookings/services", _fmt_money(tax["bookings_tax_total"])],
        ["Tax collected on retail sales", _fmt_money(tax["retail_tax_total"])],
        ["Tax reversed (refunds/voids)", _fmt_money(tax["tax_reversed"])],
        ["NET TAX LIABILITY", _fmt_money(tax["total_tax_collected"])],
    ]
    t = Table(tax_rows, colWidths=[4.5 * inch, 1.5 * inch])
    t.setStyle(pl_report._table_style(INK, LINE, BLUE, header=False))
    story.append(t)
    story.append(Paragraph(
        "Sales tax collected is a pass-through liability — it is excluded from every revenue figure "
        "above and is owed to the state, not business income. See the Sales Tax Tracker for filing deadlines.",
        small,
    ))

    # ── Expenses: recurring bills vs one-off
    story.append(Paragraph("Expenses by Category", h2))
    ec = pl["expenses"]["by_category"]
    if ec:
        rows = [["Category", "Items", "Total"]] + [[c["name"], str(c["count"]), _fmt_money(c["total"])] for c in ec]
        rows.append(["TOTAL", str(sum(c["count"] for c in ec)), _fmt_money(pl["expenses"]["total"])])
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, RED))
        story.append(t)
    else:
        story.append(Paragraph("<i>No expenses logged this month.</i>", small))

    bp = data["bills_paid"]
    if bp["rows"]:
        story.append(Paragraph("Recurring Bills Paid", h2))
        rows = [["Date", "Bill", "Category", "Amount"]] + [
            [b.get("date", ""), b.get("vendor") or b.get("name") or "—", b.get("category") or "—", _fmt_money(float(b.get("amount") or 0))]
            for b in bp["rows"]
        ]
        rows.append(["", "", "TOTAL", _fmt_money(bp["total"])])
        t = Table(rows, colWidths=[1.0 * inch, 2.2 * inch, 1.5 * inch, 1.3 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, RED))
        story.append(t)
        story.append(Paragraph(
            f"One-off (non-recurring) expenses this month: {_fmt_money(data['one_off_expenses_total'])}",
            small,
        ))

    # ── Payroll (reuse pl_report's per-employee detail)
    pay = pl.get("payroll") or {}
    story.append(Paragraph("Payroll Cost · clocked-in staff", h2))
    if pay.get("entry_count"):
        pay_rows = [
            ["Total clocked-in hours", f"{pay['total_hours']:.1f}"],
            ["Gross wages", _fmt_money(pay["gross"])],
            ["Employer burden (FICA · FUTA · SUTA · Workers' comp · Medicare)", _fmt_money(pay["employer_burden"])],
            ["TOTAL PAYROLL COST", _fmt_money(pay["total_cost"])],
        ]
        t = Table(pay_rows, colWidths=[4.5 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, RED, header=False))
        story.append(t)
        if pay.get("per_employee"):
            story.append(Spacer(1, 4))
            emp_rows = [["Employee", "Hours", "Rate", "Gross", "Burden", "Total"]]
            for e in pay["per_employee"]:
                emp_rows.append([e["name"], f"{e['hours']:.1f}", _fmt_money(e["rate"]), _fmt_money(e["gross"]),
                                  _fmt_money(e["employer_burden"]), _fmt_money(e["total_cost"])])
            t = Table(emp_rows, colWidths=[1.8 * inch, 0.7 * inch, 0.8 * inch, 1.0 * inch, 0.9 * inch, 1.0 * inch])
            t.setStyle(pl_report._table_style(INK, LINE, RED))
            story.append(t)
    else:
        story.append(Paragraph("<i>No completed time-clock entries this month — payroll cost is $0.</i>", small))

    # ── Gift card activity (NEW)
    story.append(Paragraph("Gift Card Activity", h2))
    gc_rows = [
        ["Gift cards sold", str(gc["sold_count"]), _fmt_money(gc["sold_total"])],
        ["Gift cards redeemed (used as payment)", str(gc["redeemed_count"]), _fmt_money(gc["redeemed_total"])],
    ]
    t = Table([["Activity", "Count", "Amount"]] + gc_rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
    t.setStyle(pl_report._table_style(INK, LINE, colors.HexColor("#a855f7")))
    story.append(t)
    story.append(Paragraph(
        "Gift card sales already appear in Retail Sales above (no separate income category exists for "
        "them yet); this section is informational, showing cards sold vs. redeemed as payment this month.",
        small,
    ))

    # ── Mileage deduction (NEW)
    if mi["miles"] or mi["deduction"]:
        story.append(Paragraph("Mileage Deduction (Schedule C)", h2))
        rows = [
            ["Business miles logged", f"{mi['miles']:.1f}"],
            ["IRS standard mileage rate", f"${mi['rate']:.3f}/mi"],
            ["MILEAGE DEDUCTION", _fmt_money(mi["deduction"])],
        ]
        t = Table(rows, colWidths=[4.5 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, BRAND, header=False))
        story.append(t)

    # ── Top clients / dogs
    tc = pl.get("top_clients") or []
    if tc:
        story.append(Paragraph("Top 5 Clients by Revenue", h2))
        rows = [["Client", "Visits", "Revenue"]] + [[c["name"], str(c["visits"]), _fmt_money(c["total"])] for c in tc]
        t = Table(rows, colWidths=[3.5 * inch, 1.0 * inch, 1.5 * inch])
        t.setStyle(pl_report._table_style(INK, LINE, BLUE))
        story.append(t)

    return story


def render_monthly_report_pdf(data: Dict[str, Any], brand_name: str = "Sit Happens") -> bytes:
    """Render one month's report to a standalone PDF."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        rightMargin=0.5 * inch, leftMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
        title=f"Monthly Report · {data['label']}",
        author=brand_name,
    )
    story = _build_month_story(data, brand_name, lead_with_page_break=False)
    doc.build(story)
    return buf.getvalue()


def render_year_report_pdf(months_data: List[Dict[str, Any]], year: int, brand_name: str = "Sit Happens") -> bytes:
    """Render a full year's worth of monthly reports into ONE PDF — built for
    handing the whole year to an accountant or filing taxes in one pass."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        rightMargin=0.5 * inch, leftMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
        title=f"{year} Monthly Financial Reports",
        author=brand_name,
    )
    story: List[Any] = []
    for i, data in enumerate(months_data):
        story.extend(_build_month_story(data, brand_name, lead_with_page_break=(i > 0)))
    doc.build(story)
    return buf.getvalue()
