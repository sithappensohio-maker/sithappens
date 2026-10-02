"""Settings → Data Export files hold the real data (audit: "Data Export CSVs
have empty money columns and stop at 90 days").

The income file read ts / total / method, which no income row has ever
stored (they keep date / amount / payment_method), so its money, date and
method columns were blank. The bookings file read "price" (visits keep
estimated_price and actual_price) and only the live collection, so every
visit archived after 90 days was missing. Clients' city/state/zip/notes and
dogs' spayed_neutered were always blank too, and every file stopped silently
at 50,000 rows. The owner chose A (2026-10-02): real fields, archived visits
included, never a silent cut.

Disposable tag TEST_DATA_EXPORT.
"""
import csv
import io
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_DATA_EXPORT"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _user(role="admin", staff_role=None):
    u = {"id": f"{TAG}-u-{uuid.uuid4().hex[:6]}", "email": f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.com",
         "name": f"{TAG} user", "role": role, "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        u["staff_role"] = staff_role
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], 0)}"}


def _get(path, user=None):
    return run(_http.get(f"/api{path}", headers=_auth(user or _user())))


def _csv(res):
    rows = list(csv.reader(io.StringIO(res.text)))
    return rows[0], rows[1:]


def _by_id(res):
    header, rows = _csv(res)
    return header, {r[0]: dict(zip(header, r)) for r in rows}


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    rx = {"$regex": f"^{TAG}"}
    for coll in ("retail_sales", "bookings", "bookings_archive", "clients", "dogs", "users", "client_communications"):
        run(server.db[coll].delete_many({"id": rx}))


# ─────────────────────────────── income ───────────────────────────────

INCOME_HEADER = ["id", "date", "source_kind", "category", "description", "client_id", "client_name", "booking_id",
                 "amount", "sales_tax", "gift_card_paid_pre_tax", "business_revenue", "payment_method", "notes",
                 "created_at"]


def test_the_income_file_holds_the_real_money_date_and_method():
    rows = [
        {"id": f"{TAG}-sale", "date": "2026-03-02", "description": "Rope Leash", "category": "Retail", "amount": 107.0,
         "tax_amount": 7.0, "pre_tax_amount": 100.0, "payment_method": "card", "notes": "front desk",
         "client_id": "c1", "client_name": "Dana Doe", "created_at": "2026-03-02T15:00:00+00:00"},
        {"id": f"{TAG}-refund", "date": "2026-03-03", "description": "Refund", "category": "Refund", "amount": -25.0,
         "tax_amount": -1.64, "payment_method": "cash", "source_kind": "refund", "booking_id": "b-77",
         "created_at": "2026-03-03T15:00:00+00:00"},
        {"id": f"{TAG}-card", "date": "2026-03-04", "description": "Treats", "amount": 50.0, "tax_amount": 0.0,
         "gift_card_funded": 50.0, "payment_method": "gift_card", "created_at": "2026-03-04T15:00:00+00:00"},
        {"id": f"{TAG}-taxcard", "date": "2026-03-04", "description": "Harness", "amount": 53.5, "tax_amount": 3.5,
         "gift_card_funded": 50.0, "payment_method": "gift_card", "created_at": "2026-03-04T16:00:00+00:00"},
        {"id": f"{TAG}-pack", "date": "2026-03-05", "amount": 200.0, "payment_method": "card",
         "source_kind": "credit_pack_sale", "pack_name": "10 Daycare Days", "note": "birthday gift",
         "created_at": "2026-03-05T15:00:00+00:00"},
        {"id": f"{TAG}-plan", "date": "2026-03-06", "amount": 150.0, "payment_method": "cash",
         "source_kind": "payment_plan_installment", "item_name": "Puppy Program · payment 2 of 4",
         "created_at": "2026-03-06T15:00:00+00:00"},
        {"id": f"{TAG}-void", "date": "2026-03-07", "description": "POS void", "amount": -40.0,
         "payment_method": "void", "source_kind": "pos_sale_void", "created_at": "2026-03-07T15:00:00+00:00"},
    ]
    run(server.db.retail_sales.insert_many([dict(r) for r in reversed(rows)]))   # stored newest first
    res = _get("/export/income")
    assert res.status_code == 200
    header, got = _by_id(res)
    assert header == INCOME_HEADER, "ts / total / method were always blank"
    sale = got[f"{TAG}-sale"]
    assert (sale["date"], sale["amount"], sale["payment_method"]) == ("2026-03-02", "107.0", "card")
    assert (sale["sales_tax"], sale["business_revenue"], sale["description"], sale["notes"]) == ("7.0", "100.0", "Rope Leash", "front desk")
    refund = got[f"{TAG}-refund"]
    assert (refund["amount"], refund["sales_tax"], refund["booking_id"]) == ("-25.0", "-1.64", "b-77")
    assert float(refund["amount"]) == -25.0, "a refund keeps its minus sign"
    assert (got[f"{TAG}-card"]["gift_card_paid_pre_tax"], got[f"{TAG}-card"]["business_revenue"]) == ("50.0", "0.0"), \
        "card money was income when the card was sold"
    taxcard = got[f"{TAG}-taxcard"]   # the card paid 53.50; 50.00 of it is the pre-tax part
    assert (taxcard["sales_tax"], taxcard["gift_card_paid_pre_tax"], taxcard["business_revenue"]) == ("3.5", "50.0", "0.0")
    for r in rows:   # amount - sales_tax - gift_card_paid_pre_tax = business_revenue (a sale never goes below 0)
        g = got[r["id"]]
        net = round(float(g["amount"]) - float(g["sales_tax"]) - float(g["gift_card_paid_pre_tax"]), 2)
        assert float(g["business_revenue"]) == (net if net < 0 and float(g["amount"]) < 0 else max(net, 0.0))
    assert (got[f"{TAG}-pack"]["description"], got[f"{TAG}-pack"]["notes"]) == ("10 Daycare Days", "birthday gift")
    assert got[f"{TAG}-plan"]["description"] == "Puppy Program · payment 2 of 4"
    assert got[f"{TAG}-void"]["sales_tax"] == "0.0", "old rows with no tax detail never get tax made up"
    for r in rows:   # the P&L's own per-row rule
        assert float(got[r["id"]]["business_revenue"]) == server._business_revenue_net_of_sales_tax(r)
    mine = [r[0] for r in _csv(res)[1] if r[0].startswith(TAG)]
    assert mine == [r["id"] for r in rows], "in date order"


# ─────────────────────────────── bookings ───────────────────────────────

def test_the_bookings_file_has_archived_visits_and_the_real_prices():
    live = [
        {"id": f"{TAG}-b-up", "dog_name": "Rex", "service_type": "daycare", "date": "2026-11-10", "status": "approved",
         "estimated_price": 40.0, "created_at": "2026-10-01T10:00:00+00:00"},
        {"id": f"{TAG}-b-done", "dog_name": "Rex", "service_type": "daycare", "date": "2026-09-20", "status": "completed",
         "estimated_price": 40.0, "actual_price": 45.0, "created_at": "2026-09-01T10:00:00+00:00"},
        {"id": f"{TAG}-b-both", "dog_name": "Rex", "service_type": "boarding", "date": "2026-08-01", "status": "completed",
         "actual_price": 99.0, "created_at": "2026-07-01T10:00:00+00:00"},
    ]
    archived = [
        {"id": f"{TAG}-b-old", "dog_name": "Rex", "service_type": "boarding", "date": "2000-01-05", "end_date": "2000-01-07",
         "status": "completed", "actual_price": 30.0, "created_at": "1999-12-20T10:00:00+00:00"},
        {"id": f"{TAG}-b-both", "dog_name": "Rex", "service_type": "boarding", "date": "2026-08-01", "status": "completed",
         "actual_price": 11.0, "created_at": "2026-07-01T10:00:00+00:00"},
    ]
    run(server.db.bookings.insert_many([dict(r) for r in live]))
    run(server.db.bookings_archive.insert_many([dict(r) for r in archived]))
    res = _get("/export/bookings")
    header, rows = _csv(res)
    assert "price" not in header and header[14:16] == ["estimated_price", "actual_price"]
    mine = [dict(zip(header, r)) for r in rows if r[0].startswith(TAG)]
    assert [r["id"] for r in mine] == [f"{TAG}-b-old", f"{TAG}-b-both", f"{TAG}-b-done", f"{TAG}-b-up"], \
        "archived visits included, once each, in date order"
    by = {r["id"]: r for r in mine}
    assert by[f"{TAG}-b-old"]["actual_price"] == "30.0", "visits archived after 90 days used to be missing"
    assert by[f"{TAG}-b-both"]["actual_price"] == "99.0", "the live copy wins"
    assert (by[f"{TAG}-b-done"]["estimated_price"], by[f"{TAG}-b-done"]["actual_price"]) == ("40.0", "45.0")
    assert (by[f"{TAG}-b-up"]["estimated_price"], by[f"{TAG}-b-up"]["actual_price"]) == ("40.0", "")
    assert int(res.headers["x-row-count"]) == len(rows)
    index = _get("/export-index").json()
    assert index["bookings"] == len(rows), "the panel's count is the file's count"


def test_a_bookings_count_of_only_archived_visits_is_not_nothing_to_export():
    run(server.db.bookings_archive.insert_one({"id": f"{TAG}-b-arch", "date": "2000-02-01", "status": "completed",
                                               "actual_price": 12.0}))
    live = run(server.db.bookings.count_documents({}))
    archived_only = run(server.db.bookings_archive.count_documents(
        {"id": {"$nin": run(server.db.bookings.distinct("id"))}}))
    assert _get("/export-index").json()["bookings"] == live + archived_only >= 1


# ─────────────────────────────── no silent cut ───────────────────────────────

def test_no_file_stops_at_50000_rows():
    n = 50_005
    for start in range(0, n, 10_000):
        run(server.db.client_communications.insert_many([
            {"id": f"{TAG}-cc-{i}", "client_name": "x", "type": "call", "summary": "s"}
            for i in range(start, min(n, start + 10_000))]))
    res = _get("/export/communications")
    _header, rows = _csv(res)
    total = run(server.db.client_communications.count_documents({}))
    assert total >= n
    assert int(res.headers["x-row-count"]) == len(rows) == total, "it stopped at 50,000 without saying so"


# ─────────────────────────────── clients + dogs ───────────────────────────────

def test_clients_and_dogs_read_the_fields_the_app_stores():
    run(server.db.clients.insert_one({"id": f"{TAG}-c", "name": "Dana Doe", "email": "dana@example.com",
                                      "phone": "614-555-0100", "address": "12 Elm St, Warren OH 44483",
                                      "evaluation_notes": "Shy at first", "created_at": "2026-01-01T00:00:00+00:00"}))
    header, got = _by_id(_get("/export/clients"))
    assert header == ["id", "name", "email", "phone", "address", "notes", "created_at"]
    assert (got[f"{TAG}-c"]["address"], got[f"{TAG}-c"]["notes"]) == ("12 Elm St, Warren OH 44483", "Shy at first")
    for i, fixed in enumerate([True, "spayed", "No", None]):
        doc = {"id": f"{TAG}-d{i}", "name": f"Dog {i}", "owner_id": f"{TAG}-c", "breed": "Mix",
               "photo": "data:image/png;base64,AAAA"}
        if fixed is not None:
            doc["fixed"] = fixed
        run(server.db.dogs.insert_one(doc))
    header, got = _by_id(_get("/export/dogs"))
    assert "photo" not in header
    from domains.operations import data_export
    proj = data_export._projection(data_export.ENTITIES["dogs"][1])
    assert proj.get("fixed") == 1 and not {"photo", "photos", "vaccine_certs"} & set(proj),         "only the fields the file needs are read: a dog's photos never load"
    assert [got[f"{TAG}-d{i}"]["spayed_neutered"] for i in range(4)] == ["Yes", "Yes", "No", "No"], \
        "spayed_neutered was always blank"


# ─────────────────────────────── the contract stays ───────────────────────────────

def test_the_download_contract_is_unchanged():
    res = _get("/export/clients")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    cd = res.headers["content-disposition"]
    assert "sithappens-clients-" in cd and ".csv" in cd and "x-row-count" in res.headers
    bad = _get("/export/not_a_real_thing")
    assert bad.status_code == 400 and "Allowed" in bad.json()["detail"]
    assert run(_http.get("/api/export/clients")).status_code in (401, 403)
    assert run(_http.get("/api/export-index")).status_code in (401, 403)
    desk = _user(role="employee", staff_role="front_desk")
    assert _get("/export/income", desk).status_code == 403
    assert _get("/export-index", desk).status_code == 403
    index = _get("/export-index").json()
    assert set(index) == {"clients", "dogs", "bookings", "waitlist", "intake_templates", "intake_submissions",
                          "incidents", "safety_flags", "vaccines", "income", "communications", "timeclock"}
    assert all(isinstance(v, int) for v in index.values())
    for ent in index:
        r = _get(f"/export/{ent}")
        assert r.status_code == 200 and _csv(r)[0][0] == "id"



def test_the_row_count_is_readable_when_the_api_is_on_another_origin():
    """A split deployment (frontend and API on two origins): the browser only
    lets the panel read X-Row-Count when the API exposes it."""
    if not server._cors:
        pytest.skip("this run has no cross-origin API")
    res = run(_http.get("/api/export/clients", headers={**_auth(_user()), "Origin": server._cors[0]}))
    assert "x-row-count" in res.headers.get("access-control-expose-headers", "").lower()
