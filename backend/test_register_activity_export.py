"""Step 4B-3 — register activity CSV tender-reporting tests.

Locks in the export invariant:

    An exported activity row must let a human determine how the transaction
    was actually paid. Splits export their true composition ("Cash $40.00 +
    Card $60.00"), voids identify the reversal AND the original tenders —
    never just "other"/"void" when the authoritative pos_sales.tenders
    linkage exists. The raw normalized "Payment Method" column is preserved
    for existing consumers; the human-readable "Tender Details" column is
    the Step 4B-3 addition, reusing the SAME payment_method_label the
    register UI shows (one formatting algorithm, not two).

Covers both entry points that export activity rows: /admin/register/export.csv
(kind=activity) and the tax-packet ZIP's register-activity CSV. Accounting is
untouched — these tests only read. Disposable tag TEST_ACT_CSV.
"""
import csv
import io
import uuid
import zipfile

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ACT_CSV"
ADMIN = {"id": "csv-test", "name": "CSV QA", "email": "csv@test", "role": "admin"}

EXPECTED_HEADER = ["Date", "Created At", "Kind", "Label", "Description",
                   "Client/Vendor", "Payment Method", "Tender Details", "Amount"]


def _export_rows(date):
    resp = run(server.admin_register_export_csv(
        kind="activity", start_date=date, end_date=date, user=ADMIN))
    text = resp.body.decode("utf-8")
    parsed = list(csv.reader(io.StringIO(text)))
    header, rows = parsed[0], parsed[1:]
    assert header == EXPECTED_HEADER, header
    return [dict(zip(header, r)) for r in rows]


def _packet_rows(date):
    resp = run(server.admin_register_tax_packet_zip(start_date=date, end_date=date, user=ADMIN))
    zf = zipfile.ZipFile(io.BytesIO(resp.body))
    name = next(n for n in zf.namelist() if n.startswith("register-activity"))
    parsed = list(csv.reader(io.StringIO(zf.read(name).decode("utf-8"))))
    assert parsed[0] == EXPECTED_HEADER, parsed[0]
    return [dict(zip(parsed[0], r)) for r in parsed[1:]]


def _methods_csv_row(date):
    resp = run(server.admin_register_export_csv(
        kind="payment-methods", start_date=date, end_date=date, user=ADMIN))
    parsed = list(csv.reader(io.StringIO(resp.body.decode("utf-8"))))
    return dict(zip(parsed[0], parsed[1]))


def _product(price):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
           "category": "", "price": price, "active": True, "archived": False,
           "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
           "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
           "taxable": False}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _sell(product, tenders):
    body = server.PosSaleIn(
        lines=[{"kind": "retail", "product_id": product["id"], "qty": 1}],
        tenders=tenders, idempotency_key=uuid.uuid4().hex)
    return run(server.create_pos_sale(body, ADMIN))


def _void(sale_id):
    return run(server.void_pos_sale(
        sale_id, server.PosSaleVoidIn(reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex), ADMIN))


class _OpenRegisterDay:
    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-{uuid.uuid4()}"
        self.created = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {"date": self.date, "opening_cash": 100.0, "opened_at": server.now_iso(),
                              "opened_by": self.marker, "opened_by_name": TAG, "notes": TAG}},
            upsert=True, projection={"_id": 0},
        )) is None
        return self

    def __exit__(self, *exc):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _cleanup(products=(), sale_ids=(), retail_ids=(), pos_ids=()):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if pos_ids:
            await server.db.pos_sales.delete_many({"id": {"$in": list(pos_ids)}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
    run(go())


def _sale_row(rows, sale, positive=True):
    receipt = f"#{sale['receipt_number']}"
    matches = [r for r in rows if receipt in r["Description"]
               and (float(r["Amount"]) > 0) == positive]
    assert len(matches) == 1, (receipt, matches)
    return matches[0]


# ── Test A — cash sale exports Cash ─────────────────────────────────────────
def test_a_cash_sale_exports_cash():
    p = _product(25.0)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            r = _sell(p, [{"method": "cash", "amount": 25.0, "tendered_amount": 25.0}])
            sale_id = r["sale"]["id"]
            row = _sale_row(_export_rows(day.date), r["sale"])
            assert row["Tender Details"] == "Cash $25.00"
            assert row["Payment Method"] == "cash"
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test B — card sale exports Card ─────────────────────────────────────────
def test_b_card_sale_exports_card():
    p = _product(25.0)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            r = _sell(p, [{"method": "card", "amount": 25.0}])
            sale_id = r["sale"]["id"]
            row = _sale_row(_export_rows(day.date), r["sale"])
            assert row["Tender Details"] == "Card $25.00"
            assert row["Payment Method"] == "card"
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test C — split sale exports its true composition ────────────────────────
def test_c_split_sale_exports_composition():
    p = _product(100.0)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            r = _sell(p, [{"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                          {"method": "card", "amount": 60.0}])
            sale_id = r["sale"]["id"]
            row = _sale_row(_export_rows(day.date), r["sale"])
            assert row["Tender Details"] == "Cash $40.00 + Card $60.00", row
            # Raw machine value preserved for existing consumers.
            assert row["Payment Method"] == "other"
            # The same row also comes out of the tax packet's activity CSV.
            prow = _sale_row(_packet_rows(day.date), r["sale"])
            assert prow["Tender Details"] == "Cash $40.00 + Card $60.00"
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test D — split void exports reversal + original composition ─────────────
def test_d_split_void_exports_reversal_composition():
    p = _product(100.0)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            r = _sell(p, [{"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                          {"method": "card", "amount": 60.0}])
            sale_id = r["sale"]["id"]
            _void(sale_id)
            rows = _export_rows(day.date)
            vrow = _sale_row(rows, r["sale"], positive=False)
            assert vrow["Kind"] == "pos_sale_void"
            assert vrow["Label"] == "POS void"
            assert vrow["Tender Details"] == "Void — Cash $40.00 + Card $60.00", vrow
            assert float(vrow["Amount"]) == -100.0  # not misrepresented as a payment
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test E — single cash void names the tender ──────────────────────────────
def test_e_single_cash_void_names_tender():
    p = _product(25.0)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            r = _sell(p, [{"method": "cash", "amount": 25.0, "tendered_amount": 25.0}])
            sale_id = r["sale"]["id"]
            _void(sale_id)
            vrow = _sale_row(_export_rows(day.date), r["sale"], positive=False)
            assert vrow["Tender Details"] == "Void — Cash $25.00"
            assert vrow["Tender Details"] not in ("void", "other")
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test F — ordinary refund stays a clear Cash refund ──────────────────────
def test_f_refund_stays_cash():
    with _OpenRegisterDay() as day:
        r = run(server.admin_register_refund(server.RegisterRefundIn(
            reason=f"{TAG} refund", amount=15.0, payment_method="cash", date=day.date), ADMIN))
        try:
            rows = _export_rows(day.date)
            rrow = next(x for x in rows if x["Kind"] == "refund" and TAG in x["Description"])
            assert rrow["Tender Details"] == "Cash"
            assert float(rrow["Amount"]) == -15.0
        finally:
            _cleanup(retail_ids=[r["refund"]["id"]])


# ── Test G — manual non-POS transaction keeps its ordinary label ────────────
def test_g_manual_transaction_keeps_label():
    d = "2001-11-01"
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "date": d, "amount": 30.0, "payment_method": "venmo",
        "description": f"{TAG} manual sale", "created_at": f"{d}T10:00:00",
    }))
    try:
        rows = _export_rows(d)
        row = next(x for x in rows if TAG in x["Description"])
        assert row["Tender Details"] == "Venmo"
        assert row["Payment Method"] == "venmo"
    finally:
        _cleanup(retail_ids=[rid])


# ── Test H — historical split resolves composition read-time ────────────────
def test_h_historical_split_resolves_read_time():
    d = "2001-11-02"
    pos_id = f"{TAG}-hist-{uuid.uuid4().hex[:6]}"
    rid = str(uuid.uuid4())
    run(server.db.pos_sales.insert_one({
        "id": pos_id, "business_date": d, "total": 100.0, "status": "completed",
        "tenders": [{"method": "cash", "amount": 40.0}, {"method": "card", "amount": 60.0}],
        "created_at": f"{d}T10:00:00",
    }))
    run(server.db.retail_sales.insert_one({
        "id": rid, "date": d, "amount": 100.0, "payment_method": "split",
        "pos_sale_id": pos_id, "description": f"{TAG} historical split",
        "created_at": f"{d}T10:00:00",
    }))
    try:
        row = next(x for x in _export_rows(d) if TAG in x["Description"])
        assert row["Tender Details"] == "Cash $40.00 + Card $60.00"
    finally:
        _cleanup(retail_ids=[rid], pos_ids=[pos_id])


# ── Test I — missing POS linkage: safe fallback, no fabrication ─────────────
def test_i_missing_linkage_safe_fallback():
    d = "2001-11-03"
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "date": d, "amount": 100.0, "payment_method": "split",
        "pos_sale_id": f"{TAG}-gone-{uuid.uuid4().hex[:6]}",  # pos_sales doc does not exist
        "description": f"{TAG} orphaned split", "created_at": f"{d}T10:00:00",
    }))
    try:
        row = next(x for x in _export_rows(d) if TAG in x["Description"])
        # Falls back to the labeled normalized method — never invents amounts.
        assert row["Tender Details"] == "Other"
        assert "$" not in row["Tender Details"]
    finally:
        _cleanup(retail_ids=[rid])


# ── Test J — payment-methods CSV regression (Step 1 decomposition intact) ───
def test_j_payment_methods_csv_regression():
    d = "2001-11-04"
    pos_id = f"{TAG}-pm-{uuid.uuid4().hex[:6]}"
    ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    run(server.db.cash_drawer_sessions.insert_one({
        "date": d, "opening_cash": 0.0, "opened_at": f"{d}T08:00:00",
        "opened_by": TAG, "opened_by_name": TAG,
    }))
    run(server.db.pos_sales.insert_one({
        "id": pos_id, "business_date": d, "total": 100.0, "status": "completed",
        "tenders": [{"method": "cash", "amount": 40.0}, {"method": "card", "amount": 60.0}],
        "created_at": f"{d}T10:00:00",
    }))
    run(server.db.retail_sales.insert_one({
        "id": ids[0], "date": d, "amount": 100.0, "payment_method": "split",
        "pos_sale_id": pos_id, "description": f"{TAG} split", "created_at": f"{d}T10:00:00",
    }))
    try:
        row = _methods_csv_row(d)
        assert float(row["Cash"]) == 40.0 and float(row["Card"]) == 60.0
        # Full void → both buckets return to zero.
        run(server.db.retail_sales.insert_one({
            "id": ids[1], "date": d, "amount": -100.0, "payment_method": "void",
            "source_kind": "pos_sale_void", "pos_sale_id": pos_id,
            "reversed_retail_sales_id": ids[0], "tax_amount": 0.0,
            "description": f"{TAG} void", "created_at": f"{d}T11:00:00",
        }))
        row = _methods_csv_row(d)
        assert float(row["Cash"]) == 0.0 and float(row["Card"]) == 0.0
    finally:
        run(server.db.cash_drawer_sessions.delete_many({"date": d, "opened_by": TAG}))
        _cleanup(retail_ids=ids, pos_ids=[pos_id])


# ── CSV structure: stable columns, correct quoting for commas ───────────────
def test_structure_column_count_and_comma_quoting():
    d = "2001-11-05"
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "date": d, "amount": 10.0, "payment_method": "cash",
        "description": f"{TAG} leash, collar, and treats",  # commas must survive quoting
        "created_at": f"{d}T10:00:00",
    }))
    try:
        resp = run(server.admin_register_export_csv(
            kind="activity", start_date=d, end_date=d, user=ADMIN))
        parsed = list(csv.reader(io.StringIO(resp.body.decode("utf-8"))))
        assert parsed[0] == EXPECTED_HEADER
        assert all(len(r) == len(EXPECTED_HEADER) for r in parsed), parsed
        row = next(dict(zip(parsed[0], r)) for r in parsed[1:] if TAG in r[4])
        assert row["Description"] == f"{TAG} leash, collar, and treats"
        float(row["Amount"])  # currency parses
    finally:
        _cleanup(retail_ids=[rid])
