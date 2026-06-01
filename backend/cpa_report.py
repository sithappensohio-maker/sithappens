"""Quarterly Tax CPA hand-off PDF for Sit Happens.

Generates a one-page Schedule C-style summary the operator can email to their
CPA at tax time. Pulls from the same data the Quarterly Tax admin tab shows
(income, expenses by category, labor, SE tax, income tax, recorded payments)
and renders with ReportLab — no external binaries needed.
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List


def _fmt_money(n: float) -> str:
    n = float(n or 0)
    return f"${n:,.2f}" if n >= 0 else f"-${abs(n):,.2f}"


def _fmt_pct(n: float) -> str:
    return f"{float(n or 0):.2f}%"


def render_cpa_pdf(
    data: Dict[str, Any],
    expenses_by_category: List[Dict[str, Any]],
    payments: List[Dict[str, Any]],
    brand_name: str = "Sit Happens",
) -> bytes:
    """Render the CPA hand-off PDF as raw bytes.

    Args:
        data: payload from GET /api/admin/quarterly-tax
        expenses_by_category: [{"name": str, "count": int, "total": float}, ...]
        payments: full list from tax_payments collection for this year
        brand_name: business name for header
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        rightMargin=0.4 * inch, leftMargin=0.4 * inch,
        topMargin=0.4 * inch, bottomMargin=0.4 * inch,
        title=f"Tax Year {data['year']} — CPA hand-off",
        author=brand_name,
    )
    styles = getSampleStyleSheet()
    INK = colors.HexColor("#0f172a")
    BRAND = colors.HexColor("#8cc63f")
    BLUE = colors.HexColor("#00a9e0")
    ORANGE = colors.HexColor("#f26522")
    MUTED = colors.HexColor("#64748b")
    LINE = colors.HexColor("#e2e8f0")
    BG = colors.HexColor("#f8fafc")
    RED = colors.HexColor("#dc2626")

    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=INK,
                        fontName="Helvetica-Bold", fontSize=20, leading=22,
                        spaceAfter=2)
    sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=MUTED,
                         fontSize=9, leading=12, spaceAfter=8)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=INK,
                        fontName="Helvetica-Bold", fontSize=11, leading=14,
                        spaceBefore=6, spaceAfter=3)
    small = ParagraphStyle("small", parent=styles["Normal"], textColor=MUTED,
                           fontSize=7.5, leading=10)
    foot = ParagraphStyle("foot", parent=styles["Normal"], textColor=MUTED,
                          fontSize=7, leading=9, alignment=1, spaceBefore=8)

    story: List[Any] = []

    # ── Header ──
    story.append(Paragraph(
        f"<b>{brand_name}</b> &nbsp;·&nbsp; Schedule C Tax Summary",
        h1,
    ))
    story.append(Paragraph(
        f"Tax Year <b>{data['year']}</b> &nbsp;·&nbsp; "
        f"Period: {data['period']['start']} → {data['period']['end']} &nbsp;·&nbsp; "
        f"As of {data['as_of']} &nbsp;·&nbsp; "
        f"Filing: Sole Proprietor",
        sub,
    ))

    # ── Top KPIs (4 across) ──
    def tile(label_text, value_text, value_color=INK):
        label = ParagraphStyle("label", parent=styles["Normal"], textColor=MUTED,
                               fontSize=7, leading=9, alignment=1,
                               fontName="Helvetica-Bold")
        money = ParagraphStyle("money", parent=styles["Normal"],
                               fontSize=13, leading=15, alignment=1,
                               textColor=value_color, fontName="Helvetica-Bold")
        return Table(
            [[Paragraph(label_text, label)],
             [Paragraph(value_text, money)]],
            colWidths=[1.78 * inch],
            style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), BG),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]),
        )

    net = data["net_profit"]
    net_color = BRAND if net >= 0 else RED
    bal = data["balance_owed_ytd"]
    bal_color = ORANGE if bal > 0 else BRAND
    story.append(Table(
        [[
            tile("GROSS INCOME", _fmt_money(data["income"]["gross"]), INK),
            tile("TOTAL EXPENSES", _fmt_money(data["expenses"]["total"]), RED),
            tile("NET PROFIT", _fmt_money(net), net_color),
            tile("EST. BALANCE OWED", _fmt_money(bal), bal_color),
        ]],
        colWidths=[1.85 * inch] * 4,
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
    ))
    story.append(Spacer(1, 4))

    # ── Income detail ──
    story.append(Paragraph("Income (Schedule C, Line 1)", h2))
    inc = data["income"]
    inc_table = Table(
        [
            ["Source", "Amount"],
            ["Service bookings (daycare, boarding, training)", _fmt_money(inc["service_bookings"])],
            ["Retail sales", _fmt_money(inc["retail_sales"])],
            ["GROSS RECEIPTS", _fmt_money(inc["gross"])],
        ],
        colWidths=[5.6 * inch, 1.95 * inch],
        style=TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), BG),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), BG),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
            ("LINEABOVE", (0, -1), (-1, -1), 0.5, LINE),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]),
    )
    story.append(inc_table)

    # ── Expenses by category ──
    story.append(Paragraph("Deductible Expenses (Schedule C, Part II)", h2))
    exp_rows = [["Category", "# Items", "Amount"]]
    sorted_cats = sorted(expenses_by_category, key=lambda c: -float(c.get("total") or 0))
    cat_total = 0.0
    for c in sorted_cats:
        amt = float(c.get("total") or 0)
        cat_total += amt
        exp_rows.append([c.get("name", "Uncategorized"), str(c.get("count", 0)), _fmt_money(amt)])
    exp_rows.append(["RECORDED EXPENSES SUBTOTAL", "", _fmt_money(cat_total)])
    exp_rows.append(["Labor — gross wages", "", _fmt_money(data["expenses"]["labor_gross"])])
    exp_rows.append(["Labor — employer burden (FICA/FUTA/SUTA/WC)", "", _fmt_money(data["expenses"]["labor_burden"])])
    exp_rows.append(["TOTAL DEDUCTIBLE EXPENSES", "", _fmt_money(data["expenses"]["total"])])
    exp_table = Table(
        exp_rows,
        colWidths=[5.0 * inch, 0.75 * inch, 1.8 * inch],
        style=TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), BG),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), BG),
            ("FONTNAME", (0, -4), (-1, -4), "Helvetica-Bold"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
            ("LINEABOVE", (0, -1), (-1, -1), 0.5, LINE),
            ("LINEABOVE", (0, -3), (-1, -3), 0.25, LINE),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]),
    )
    story.append(exp_table)

    # ── Net Profit ──
    story.append(Paragraph("Net Profit (Schedule C, Line 31)", h2))
    net_table = Table(
        [
            [Paragraph("<b>Gross receipts − Total deductible expenses</b>", styles["Normal"]),
             Paragraph(f"<font color='{net_color.hexval()}'><b>{_fmt_money(net)}</b></font>", styles["Normal"])],
        ],
        colWidths=[5.6 * inch, 1.95 * inch],
        style=TableStyle([
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("BACKGROUND", (0, 0), (-1, -1), BG),
            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]),
    )
    story.append(net_table)

    # ── Tax breakdown (SE + Income) ──
    story.append(Paragraph("Estimated Tax Liability (informational — verify with CPA)", h2))
    se = data["se_tax"]
    it = data["income_tax"]
    s = data["settings"]
    tax_rows = [
        ["Component", "Rate", "Base", "Amount"],
        [f"Social Security ({_fmt_pct(s['ss_rate_pct'])}, capped at {_fmt_money(s['ss_wage_base'])})",
         _fmt_pct(s["ss_rate_pct"]), _fmt_money(se["taxable_base"]), _fmt_money(se["social_security"])],
        [f"Medicare ({_fmt_pct(s['medicare_rate_pct'])})",
         _fmt_pct(s["medicare_rate_pct"]), _fmt_money(se["taxable_base"]), _fmt_money(se["medicare"])],
        ["SELF-EMPLOYMENT TAX SUBTOTAL", "", "", _fmt_money(se["total"])],
        [f"Federal income tax ({_fmt_pct(s['federal_income_pct'])} of net less ½ SE)",
         _fmt_pct(s["federal_income_pct"]), _fmt_money(it["taxable_income"]), _fmt_money(it["federal"])],
        [f"State income tax — Ohio ({_fmt_pct(s['state_income_pct'])})",
         _fmt_pct(s["state_income_pct"]), _fmt_money(it["taxable_income"]), _fmt_money(it["state"])],
        [f"Local income tax — Warren ({_fmt_pct(s['local_income_pct'])})",
         _fmt_pct(s["local_income_pct"]), _fmt_money(it["taxable_income"]), _fmt_money(it["local"])],
        ["INCOME TAX SUBTOTAL", "", "", _fmt_money(it["total"])],
        ["TOTAL ESTIMATED TAX (YTD)", "", "", _fmt_money(data["total_tax_ytd"])],
    ]
    tax_table = Table(
        tax_rows,
        colWidths=[3.55 * inch, 0.85 * inch, 1.4 * inch, 1.75 * inch],
        style=TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), BG),
            ("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold"),
            ("FONTNAME", (0, 7), (-1, 7), "Helvetica-Bold"),
            ("FONTNAME", (0, 8), (-1, 8), "Helvetica-Bold"),
            ("BACKGROUND", (0, 3), (-1, 3), BG),
            ("BACKGROUND", (0, 7), (-1, 7), BG),
            ("BACKGROUND", (0, 8), (-1, 8), BG),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
            ("LINEABOVE", (0, 8), (-1, 8), 0.5, LINE),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]),
    )
    story.append(tax_table)

    # ── Payments table ──
    story.append(Paragraph("Quarterly Estimated Payments Made", h2))
    if not payments:
        story.append(Paragraph(
            "No quarterly payments logged for this tax year.", small,
        ))
    else:
        pay_rows = [["Date", "Quarter", "Method", "Memo", "Amount"]]
        total = 0.0
        for p in sorted(payments, key=lambda x: x.get("payment_date", "")):
            amt = float(p.get("amount") or 0)
            total += amt
            pay_rows.append([
                p.get("payment_date", ""),
                f"Q{p.get('quarter', '?')}",
                p.get("payment_method", ""),
                (p.get("memo") or "")[:50],
                _fmt_money(amt),
            ])
        pay_rows.append(["", "", "", "TOTAL PAID", _fmt_money(total)])
        pay_table = Table(
            pay_rows,
            colWidths=[0.9 * inch, 0.7 * inch, 0.9 * inch, 3.6 * inch, 1.45 * inch],
            style=TableStyle([
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (-1, 0), BG),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, -1), (-1, -1), BG),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
                ("LINEABOVE", (0, -1), (-1, -1), 0.5, LINE),
                ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (1, 0), (2, -1), "CENTER"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]),
        )
        story.append(pay_table)

    # ── Bottom-line balance ──
    bal_label = "BALANCE STILL OWED (YTD)"
    bal_box = Table(
        [[
            Paragraph(f"<b>{bal_label}</b>", ParagraphStyle("bl", parent=styles["Normal"], fontSize=10, textColor=INK)),
            Paragraph(f"<font color='{bal_color.hexval()}' size='14'><b>{_fmt_money(bal)}</b></font>",
                      ParagraphStyle("br", parent=styles["Normal"], alignment=2)),
        ]],
        colWidths=[5.6 * inch, 1.95 * inch],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BG),
            ("BOX", (0, 0), (-1, -1), 1, bal_color),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]),
    )
    story.append(Spacer(1, 4))
    story.append(bal_box)

    # ── Footer disclaimer ──
    story.append(Paragraph(
        f"Generated {datetime.now().strftime('%b %-d, %Y at %-I:%M %p')} from Sit Happens CRM. "
        "This is an estimate based on bookkeeping data — not a tax filing. "
        "Self-employment and income tax rates are configurable defaults; please "
        "verify all figures against your CPA's calculations and your W-4/1040-ES history.",
        foot,
    ))

    doc.build(story)
    return buf.getvalue()
