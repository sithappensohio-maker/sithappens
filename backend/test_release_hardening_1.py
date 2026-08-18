"""Release Hardening 1 — the four accepted release-audit defects.

A–G   Finance must treat collected sales tax as a pass-through liability,
      never business revenue, and every Finance surface must agree.
H–L   The accountant CSV must keep refunds, categorize canonically, and
      report an honest gross/refunds/net trio.
M–O   In-app backup/restore must cover the three Tax Center collections.
P–U   The CPA hand-off must show jurisdiction-split estimated payments.

No tax-engine behavior is exercised or changed here. Rows tagged TEST_RH1.
"""
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_RH1"
ADMIN = {"id": "rh1-admin", "name": "RH1 Owner", "email": "rh1@test", "role": "admin"}
YEAR = 2026

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clean():
    yield
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.expenses.delete_many({"description": {"$regex": TAG}}))
    run(server.db.tax_payments.delete_many({"memo": TAG}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.tax_profiles.delete_many({"tax_year": 9001}))
    run(server.db.sales_tax_filings.delete_many({"notes": TAG}))
    run(server.db.users.delete_many({"email": {"$regex": TAG.lower()}}))


def _row(amount, tax=0.0, kind=None, desc="merch", day=None):
    """One retail_sales row shaped exactly like the real writers produce."""
    r = {"id": str(uuid.uuid4()), "date": (day or server.business_today().isoformat()),
         "description": f"{TAG} {desc}", "amount": amount, "tax_amount": tax,
         "created_at": server.now_iso()}
    if kind:
        r["source_kind"] = kind
    return r


def _insert(rows):
    if rows:
        run(server.db.retail_sales.insert_many([dict(r) for r in rows]))


# ═══════════ A–F — canonical business-revenue helper ═══════════

def test_a_taxable_sale_excludes_collected_tax():
    """$100 merchandise + $7 tax is $100 of revenue and $7 of liability."""
    r = _row(107.0, 7.0)
    assert server._business_revenue_net_of_sales_tax(r) == 100.0
    assert server._sales_tax_collected_on_row(r) == 7.0


def test_b_non_taxable_service_full_amount_is_revenue():
    r = _row(100.0, 0.0, desc="service")
    assert server._business_revenue_net_of_sales_tax(r) == 100.0
    assert server._sales_tax_collected_on_row(r) == 0.0


def test_c_mixed_transaction():
    """$100 service + $100 merchandise + $7 tax → $200 revenue, $7 tax."""
    rows = [_row(100.0, 0.0, desc="service"), _row(107.0, 7.0, desc="merch")]
    assert round(sum(server._business_revenue_net_of_sales_tax(r) for r in rows), 2) == 200.0
    assert round(sum(server._sales_tax_collected_on_row(r) for r in rows), 2) == 7.0


def test_d_taxable_void_nets_to_zero():
    """Sale then POS void → revenue $0 and collected tax $0, exactly once."""
    rows = [_row(107.0, 7.0), _row(-107.0, -7.0, kind="pos_sale_void", desc="void")]
    assert round(sum(server._business_revenue_net_of_sales_tax(r) for r in rows), 2) == 0.0
    assert round(sum(server._sales_tax_collected_on_row(r) for r in rows), 2) == 0.0


def test_e_full_refund_no_double_tax_subtraction():
    """The refund row carries its OWN signed tax; the original tax must not
    be subtracted a second time."""
    sale, refund = _row(107.0, 7.0), _row(-107.0, -7.0, kind="refund", desc="refund")
    assert server._business_revenue_net_of_sales_tax(sale) == 100.0
    assert server._business_revenue_net_of_sales_tax(refund) == -100.0   # not -114
    assert round(sum(server._business_revenue_net_of_sales_tax(r) for r in (sale, refund)), 2) == 0.0


def test_f_partial_refund():
    """Half of a $107 sale refunded → $50 revenue remains, $3.50 tax remains."""
    rows = [_row(107.0, 7.0), _row(-53.5, -3.5, kind="refund", desc="partial refund")]
    assert round(sum(server._business_revenue_net_of_sales_tax(r) for r in rows), 2) == 50.0
    assert round(sum(server._sales_tax_collected_on_row(r) for r in rows), 2) == 3.5


def test_f2_legacy_row_without_tax_detail_is_not_fabricated():
    """A legacy row with no tax_amount counts fully as revenue — historical
    tax is never invented to force a reconciliation."""
    legacy = {"id": str(uuid.uuid4()), "date": server.business_today().isoformat(),
              "description": f"{TAG} legacy", "amount": 50.0}
    assert server._business_revenue_net_of_sales_tax(legacy) == 50.0
    assert server._sales_tax_collected_on_row(legacy) == 0.0


def test_f3_schedule_c_alias_is_the_same_helper():
    r = _row(107.0, 7.0)
    assert server._schedule_c_retail_income(r) == server._business_revenue_net_of_sales_tax(r)


# ═══════════ G — cross-surface parity ═══════════

def test_g_summary_range_pl_and_schedule_c_agree():
    """The SAME fixture must produce the SAME business revenue in the range
    summary, the P&L, and the Schedule C / quarterly projection.

    DELTA-based: the disposable DB is shared with every other test file, so
    absolute totals are not stable (same convention as the 4C suite).
    """
    import pl_report
    day = server.business_today().isoformat()
    yr = int(day[:4])

    def _snap():
        rng = run(server.summary_range(start_date=day, end_date=day, _=ADMIN))
        pl = run(pl_report.build_pl_data(server.db, day, day))
        q = run(server.admin_quarterly_tax(_={"role": "admin"}, year=yr))
        return (rng["completed_total"], rng["sales_tax_collected"],
                pl["income"]["net_total"], pl["income"]["sales_tax_collected"],
                q["income"]["sales_tax_collected"])

    before = _snap()
    _insert([_row(100.0, 0.0, desc="service"),      # non-taxable service
             _row(107.0, 7.0, desc="merch")])       # taxable merchandise
    after = _snap()
    d = [round(a - b, 2) for a, b in zip(after, before)]

    # +200.00 of business revenue and +7.00 of pass-through tax — never +207.
    assert d[0] == 200.0, "range summary business revenue"
    assert d[1] == 7.0, "range summary sales tax reported separately"
    assert d[2] == 200.0, "P&L business revenue"
    assert d[3] == 7.0, "P&L sales tax reported separately"
    assert d[4] == 7.0, "Schedule C sales tax excluded from income"
    # All three surfaces moved by the SAME business-revenue amount.
    assert d[0] == d[2]


def test_g2_gross_minus_reversals_equals_net():
    import pl_report
    day = server.business_today().isoformat()

    def _inc():
        return run(pl_report.build_pl_data(server.db, day, day))["income"]

    b = _inc()
    _insert([_row(107.0, 7.0), _row(-53.5, -3.5, kind="refund", desc="refund")])
    a = _inc()
    # The identity holds on the absolute figures…
    assert round(a["gross_total"] - a["refunds_reversals_total"], 2) == a["net_total"]
    # …and this fixture contributed +100 gross, +50 reversals, +50 net.
    assert round(a["gross_total"] - b["gross_total"], 2) == 100.0
    assert round(a["refunds_reversals_total"] - b["refunds_reversals_total"], 2) == 50.0
    assert round(a["net_total"] - b["net_total"], 2) == 50.0


# ═══════════ H–L — accountant CSV ═══════════

def _csv(year=None):
    yr = year or int(server.business_today().isoformat()[:4])
    resp = run(server.admin_income_csv(year=yr, user={**ADMIN, "role": "admin"}))
    return resp.body.decode()


def test_h_csv_keeps_refund_rows():
    _insert([_row(107.0, 7.0), _row(-107.0, -7.0, kind="refund", desc="refund")])
    body = _csv()
    assert f"{TAG} refund" in body, "refund row must not be filtered out"
    assert "-100.00" in body, "refund must stay a SIGNED NEGATIVE revenue row"


def _csv_footer(body, label, col=5):
    row = next(l for l in body.splitlines() if l.strip() and label in l)
    cell = row.split(",")[col]
    return float(cell) if cell else 0.0


def test_i_csv_gross_refunds_net_footer():
    """Honest trio, delta-measured on the shared disposable DB."""
    b0 = _csv()
    _insert([_row(107.0, 7.0), _row(-53.5, -3.5, kind="refund", desc="refund")])
    body = _csv()
    assert "GROSS BUSINESS REVENUE" in body
    assert "REFUNDS & REVERSALS" in body
    assert "NET BUSINESS REVENUE" in body
    # The old misleading "NET TOTAL" label is gone.
    assert "NET TOTAL," not in body

    g = _csv_footer(body, "GROSS BUSINESS REVENUE") - _csv_footer(b0, "GROSS BUSINESS REVENUE")
    r = _csv_footer(body, "REFUNDS & REVERSALS") - _csv_footer(b0, "REFUNDS & REVERSALS")
    n = _csv_footer(body, "NET BUSINESS REVENUE") - _csv_footer(b0, "NET BUSINESS REVENUE")
    assert round(g, 2) == 100.0        # tax excluded from income
    assert round(r, 2) == -50.0        # refund preserved, not dropped
    assert round(n, 2) == 50.0
    # The identity holds on the absolute footer too.
    assert round(_csv_footer(body, "GROSS BUSINESS REVENUE")
                 + _csv_footer(body, "REFUNDS & REVERSALS"), 2) == \
        _csv_footer(body, "NET BUSINESS REVENUE")


def test_j_csv_canonical_categories():
    _insert([
        _row(60.0, 0.0, kind="credit_pack_sale", desc="pack"),
        _row(300.0, 0.0, kind="training_program_sale", desc="program"),
        _row(75.0, 0.0, kind="invoice_payment", desc="acct payment"),
        _row(107.0, 7.0, desc="merch"),
    ])
    body = _csv()
    assert "Credit Packs" in body
    assert "Training Programs" in body
    assert "Invoice / Account Payments" in body
    assert "Retail (items)" in body
    # An account payment must NOT be mislabeled as retail merchandise.
    acct = next(l for l in body.splitlines() if "acct payment" in l)
    assert "Invoice / Account Payments" in acct


def test_k_csv_sales_tax_separate_from_income():
    b0 = _csv()
    _insert([_row(107.0, 7.0, desc="merch")])
    body = _csv()
    assert "Sales Tax Collected (USD)" in body
    assert "SALES TAX COLLECTED (liability" in body
    # Row level: revenue and tax are in SEPARATE columns.
    row = next(l for l in body.splitlines() if f"{TAG} merch" in l)
    cells = row.split(",")
    assert float(cells[5]) == 100.0    # business revenue column
    assert float(cells[6]) == 7.0      # sales-tax column
    # Footer level: the $107 charge added $100 of income and $7 of liability.
    g = _csv_footer(body, "GROSS BUSINESS REVENUE") - _csv_footer(b0, "GROSS BUSINESS REVENUE")
    t = _csv_footer(body, "SALES TAX COLLECTED (liability", col=6) - \
        _csv_footer(b0, "SALES TAX COLLECTED (liability", col=6)
    assert round(g, 2) == 100.0        # tax NOT in income
    assert round(t, 2) == 7.0


def test_l_csv_split_tender_single_revenue_event():
    """A split-tender sale is ONE retail row — it must appear exactly once."""
    _insert([_row(107.0, 7.0, desc="split tender sale")])
    body = _csv()
    assert body.count("split tender sale") == 1


def test_l2_csv_no_dead_credit_lot_section():
    """The dead credit_lots query (sold_at/paid_amount — fields no writer
    sets) is gone; packs come from the retail ledger, counted once."""
    _insert([_row(60.0, 0.0, kind="credit_pack_sale", desc="pack once")])
    body = _csv()
    assert body.count("pack once") == 1


# ═══════════ M–O — in-app backup coverage ═══════════

def test_m_backup_manifest_includes_tax_collections():
    for c in ("tax_profiles", "estimated_tax_payments", "sales_tax_filings"):
        assert c in server.BACKUP_COLLECTIONS, f"{c} missing from in-app backup"


def test_n_restore_round_trip_preserves_tax_records():
    """Export → wipe → restore must return every tax record intact, including
    audit logs, void state, and filing payment events."""
    prof = {"id": str(uuid.uuid4()), "tax_year": 9001,
            "audit_log": [{"at": "2026-01-01T00:00:00Z", "by": "rh1", "action": "profile_updated",
                           "detail": "audit trail must survive"}]}
    pay_ok = {"id": str(uuid.uuid4()), "tax_year": 9001, "jurisdiction": "federal",
              "period": 3, "amount": 1234.56, "payment_date": "2026-09-15",
              "memo": TAG, "voided": False}
    pay_void = {"id": str(uuid.uuid4()), "tax_year": 9001, "jurisdiction": "ohio",
                "period": 3, "amount": 99.0, "payment_date": "2026-09-15",
                "memo": TAG, "voided": True, "void_reason": "audit"}
    filing = {"id": str(uuid.uuid4()), "period_key": "9001-01", "notes": TAG,
              "snapshot": {"liability": 26.0, "amount_to_remit": 26.0},
              "payments": [{"amount": 10.0, "payment_date": "2026-02-01"},
                           {"amount": 16.0, "payment_date": "2026-02-15"}]}
    run(server.db.tax_profiles.insert_one(dict(prof)))
    run(server.db.estimated_tax_payments.insert_many([dict(pay_ok), dict(pay_void)]))
    run(server.db.sales_tax_filings.insert_one(dict(filing)))

    payload = run(server.backup_export(user=ADMIN))
    data = payload if isinstance(payload, dict) else payload.body
    coll = (data.get("collections") or {}) if isinstance(data, dict) else {}
    assert len(coll.get("tax_profiles") or []) >= 1
    assert len(coll.get("estimated_tax_payments") or []) >= 2
    assert len(coll.get("sales_tax_filings") or []) >= 1

    run(server.db.tax_profiles.delete_many({"tax_year": 9001}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.sales_tax_filings.delete_many({"notes": TAG}))

    run(server.backup_restore(body=server.BackupRestoreIn(**data), _=ADMIN))

    got_prof = run(server.db.tax_profiles.find_one({"tax_year": 9001}, {"_id": 0}))
    got_ok = run(server.db.estimated_tax_payments.find_one({"id": pay_ok["id"]}, {"_id": 0}))
    got_void = run(server.db.estimated_tax_payments.find_one({"id": pay_void["id"]}, {"_id": 0}))
    got_filing = run(server.db.sales_tax_filings.find_one({"id": filing["id"]}, {"_id": 0}))
    assert got_prof and got_prof["audit_log"][0]["detail"] == "audit trail must survive"
    assert got_ok and got_ok["amount"] == 1234.56 and not got_ok.get("voided")
    assert got_void and got_void.get("voided") is True
    assert got_filing and len(got_filing["payments"]) == 2
    assert got_filing["snapshot"]["amount_to_remit"] == 26.0


def test_o_old_backup_without_tax_collections_restores_safely():
    """A backup taken BEFORE Tax Center existed has no such keys — restoring
    it must succeed, not raise a missing-collection error."""
    old = {"version": 1, "exported_at": server.now_iso(),
           "collections": {"clients": [], "dogs": []}}
    res = run(server.backup_restore(body=server.BackupRestoreIn(**old), _=ADMIN))
    assert res is not None
    # The tax collections are deliberately NOT "critical", so their absence
    # in an older payload can never raise a missing-collection error.
    for c in ("tax_profiles", "estimated_tax_payments", "sales_tax_filings"):
        assert c not in server._CRITICAL_BACKUP_COLLECTIONS


# ═══════════ P–U — CPA hand-off payments ═══════════

def _cpa_pdf_text():
    """Render the CPA PDF and return its extractable text."""
    resp = run(server.quarterly_tax_cpa_pdf(year=YEAR, _=ADMIN))
    from pypdf import PdfReader
    import io
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(resp.body)).pages)


def _est_pay(jur, amount, day, voided=False, ref=None):
    run(server.db.estimated_tax_payments.insert_one({
        "id": str(uuid.uuid4()), "tax_year": YEAR, "jurisdiction": jur, "period": 3,
        "amount": amount, "payment_date": day, "memo": TAG, "voided": voided,
        "reference": ref}))


def test_pqr_cpa_shows_each_jurisdiction_separately():
    _est_pay("federal", 2500.0, "2026-09-15")
    _est_pay("ohio", 425.0, "2026-09-15")
    _est_pay("ohio_school_district", 180.0, "2026-09-15")
    txt = _cpa_pdf_text()
    assert "Federal Estimated Payments" in txt                     # (P)
    assert "Ohio Estimated Payments" in txt                        # (Q)
    assert "Ohio School-District Estimated Payments" in txt        # (R)
    assert "2,500.00" in txt or "2500.00" in txt
    assert "425.00" in txt
    assert "180.00" in txt
    # never combined into one unexplained number
    assert "not combined into a single total" in txt


def test_s_voided_payment_not_counted_as_paid():
    _est_pay("federal", 1000.0, "2026-09-15")
    _est_pay("federal", 750.0, "2026-09-15", voided=True)
    txt = _cpa_pdf_text()
    assert "VOIDED" in txt
    assert "NOT included in TOTAL PAID" in txt
    # total paid is the live payment only
    assert "1,000.00" in txt or "1000.00" in txt


def test_s2_future_dated_payment_not_shown_as_paid():
    _est_pay("federal", 500.0, "2099-12-15")
    txt = _cpa_pdf_text()
    assert "SCHEDULED (not yet paid)" in txt
    assert "has NOT" in txt and "been paid yet" in txt


def test_t_legacy_unassigned_shown_separately():
    run(server.db.tax_payments.insert_one({
        "id": str(uuid.uuid4()), "year": YEAR, "quarter": 2, "amount": 750.0,
        "payment_date": "2026-06-10", "payment_method": "EFTPS", "memo": TAG}))
    txt = _cpa_pdf_text()
    assert "Legacy / Unassigned Estimated-Tax Payments" in txt
    assert "not automatically assigned" in txt.lower()
    assert "TOTAL (UNASSIGNED)" in txt


def test_u_sales_tax_payment_never_enters_estimated_totals():
    """A sales-tax filing payment must not appear in the income-tax
    estimated-payment tables."""
    run(server.db.sales_tax_filings.insert_one({
        "id": str(uuid.uuid4()), "period_key": "2026-07", "notes": TAG,
        "snapshot": {"liability": 296.93, "amount_to_remit": 296.93},
        "payments": [{"amount": 296.93, "payment_date": "2026-08-20"}]}))
    _est_pay("ohio", 425.0, "2026-09-15")
    txt = _cpa_pdf_text()
    assert "425.00" in txt
    assert "296.93" not in txt, "sales-tax remittance must not appear in estimated-tax tables"


def test_v_cpa_reserve_wording_not_regressed():
    """The accepted honesty wording must survive this patch."""
    txt = _cpa_pdf_text()
    import re
    # PDF text extraction inserts line breaks mid-phrase — normalize first.
    low = re.sub(r"\s+", " ", txt).lower()
    assert "planning reserve" in low
    # The reserve is still disclaimed as planning-only, never "tax due".
    assert "planning estimate only" in low
    assert "not a federal or ohio estimated-tax calculation" in low
    assert "verify all figures with your cpa" in low


# ═══════════ permissions ═══════════

def test_front_desk_403_on_export_and_cpa():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-fd-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "employee", "staff_role": "front_desk",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    h = {"Authorization": f"Bearer {server.create_access_token(uid, email, 'employee', 0)}"}
    for path in (f"/api/admin/income/export.csv?year={YEAR}",
                 f"/api/admin/quarterly-tax/cpa.pdf?year={YEAR}",
                 f"/api/transactions/summary-range?start_date=2026-08-01&end_date=2026-08-31"):
        r = run(_http.get(path, headers=h))
        assert r.status_code == 403, path
        assert "GROSS BUSINESS REVENUE" not in r.text
