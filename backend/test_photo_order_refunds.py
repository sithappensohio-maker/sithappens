"""A photo order follows its register sale when the money goes back (audit #28).

A photo package is rung through the real register. When that sale was voided,
returned, or refunded against its receipt, the order used to stay "Paid": its
money stayed in the panel's Revenue, it stayed in Waiting to send, and it could
be neither paid again nor deleted. Now (owner's choice B) money given back in
full makes the order Refunded — kept as the record, never paid, sent or printed
again — and a part refund stays paid with only what was kept counted.

Disposable tag TEST_PO_REFUND.
"""
import _test_env  # noqa: F401 — must run before `import server`
import datetime as dt
import uuid
from unittest.mock import patch

import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_PO_REFUND"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
_day_seq = iter(range(703, 990, 3))   # clear of the other photo-special suites' days

PACKAGES = [
    {"name": "3 Edited Digitals", "price": 30, "digitals": 3},
    {"name": "5 Digitals + 8x10", "price": 60, "digitals": 5, "print": "8×10"},
]


class _Req:
    def __init__(self):
        self.client = type("C", (), {"host": f"198.51.100.{uuid.uuid4().int % 250 + 1}"})()
        self.headers = {}
        self.url = type("U", (), {"path": "/api/public/photo-specials/x/reserve"})()
        self.method = "POST"


def _email():
    return f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.com"


def _staff():
    u = {"id": str(uuid.uuid4()), "email": _email(), "name": f"{TAG} owner", "role": "admin",
         "password_hash": "x", "active": True}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


async def _noop(*a, **k):
    return None


RATE = 6.75


@pytest.fixture(scope="module", autouse=True)
def _drawer_and_cleanup():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 500.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    ids = [s["id"] for s in run(server.db.photo_specials.find({"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(100))]
    sale_ids = [o["pos_sale_id"] for o in run(server.db.photo_special_orders.find(
        {"photo_special_id": {"$in": ids}, "pos_sale_id": {"$nin": [None, ""]}}, {"_id": 0, "pos_sale_id": 1}).to_list(1000))]
    run(server.db.retail_sales.delete_many({"pos_sale_id": {"$in": sale_ids}}))
    run(server.db.pos_sale_returns.delete_many({"pos_sale_id": {"$in": sale_ids}}))
    run(server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": sale_ids}}))
    run(server.db.pos_sales.delete_many({"id": {"$in": sale_ids}}))
    run(server.db.photo_special_orders.delete_many({"photo_special_id": {"$in": ids}}))
    run(server.db.bookings.delete_many({"photo_special_id": {"$in": ids}}))
    run(server.db.pos_products.delete_many({"photo_special_package.photo_special_id": {"$in": ids}}))
    run(server.db.event_counters.delete_many({"_id": {"$in": [f"{i}:photo" for i in ids]}}))
    run(server.db.photo_specials.delete_many({"id": {"$in": ids}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))
    run(server.db.clients.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))


def _special(owner):
    day = (dt.date.today() + dt.timedelta(days=next(_day_seq))).isoformat()
    body = {"name": f"{TAG} Howl-O-Ween {uuid.uuid4().hex[:6]}", "dates": [day], "start_time": "09:00", "end_time": "10:00",
            "slot_minutes": 15, "booking_open": True, "published": True,
            "photos_title": "Howl-O-Ween Portraits", "order_prefix": "HOW", "photo_packages": PACKAGES}
    r = run(_http.post("/api/admin/photo-specials", json=body, headers=_auth(owner)))
    assert r.status_code == 200, r.text
    return r.json()


def _paid_order(owner, sp=None, package_key="3-edited-digitals", **extra):
    sp = sp or _special(owner)
    base = f"/api/admin/photo-specials/{sp['id']}/photo-orders"
    body = {"primary_contact": "Walk Up", "email": _email(), "package_key": package_key, **extra}
    o = run(_http.post(base, json=body, headers=_auth(owner))).json()["order"]
    total = run(_http.post(f"{base}/{o['id']}/preview", headers=_auth(owner))).json()["total"]
    with patch.object(server, "_issue_pos_token", new=_noop):
        pay = run(_http.post(f"{base}/{o['id']}/checkout", headers=_auth(owner),
                             json={"tenders": [{"method": "cash", "amount": total, "tendered_amount": total}],
                                   "idempotency_key": f"{TAG}-{uuid.uuid4().hex}"}))
    assert pay.status_code == 200, pay.text
    paid = pay.json()["order"]
    assert paid["status"] == "paid" and paid["total"] == total
    return sp, base, paid


def _void(owner, sale_id):
    with patch.object(server, "_issue_pos_token", new=_noop):
        run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
            reason=f"{TAG} rung wrong", idempotency_key=f"{TAG}-{uuid.uuid4()}"), owner))


def _refund(owner, amount, receipt):
    return run(server.admin_register_refund(server.RegisterRefundIn(
        amount=amount, reason=f"{TAG} photo refund", payment_method="cash", sale_id=receipt), owner))["refund"]


def _get(owner, base, oid):
    return run(_http.get(f"{base}/{oid}", headers=_auth(owner))).json()["order"]


# ---------------------------------------------------------------- the audit case

def test_a_voided_photo_sale_makes_its_order_refunded_and_takes_it_out_of_the_money():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    _void(owner, o["pos_sale_id"])

    # Straight to Send, nothing else looked first: the photos are not sent.
    r = run(_http.post(f"{base}/{o['id']}/send", json={"delivery_link": "https://drive.example/x"}, headers=_auth(owner)))
    assert r.status_code == 409 and "refunded" in r.text

    got = _get(owner, base, o["id"])
    assert got["status"] == "refunded" and got["refunded_amount"] == o["total"]
    sm = run(_http.get(f"{base}/summary", headers=_auth(owner))).json()
    assert sm["revenue"] == 0 and sm["to_send"] == 0 and sm["refunded"] == 1 and sm["prints_pending"] == 0
    listed = run(_http.get(base, params={"status": "refunded"}, headers=_auth(owner))).json()["orders"]
    assert [x["id"] for x in listed] == [o["id"]]


def test_a_refunded_order_is_kept_as_the_record_and_never_paid_sent_or_printed_again():
    owner = _staff()
    sp, base, o = _paid_order(owner, package_key="5-digitals-8x10")
    a = _auth(owner)
    assert run(_http.get(f"{base}/summary", headers=a)).json()["prints_pending"] == 1
    _void(owner, o["pos_sale_id"])
    assert run(_http.get(f"{base}/summary", headers=a)).json()["prints_pending"] == 0, "no print owed on a refunded order"
    assert run(_http.patch(f"{base}/{o['id']}", json={"status": "ready"}, headers=a)).status_code == 409
    assert run(_http.patch(f"{base}/{o['id']}", json={"print_status": "ready"}, headers=a)).status_code == 409
    d = run(_http.delete(f"{base}/{o['id']}", headers=a))
    assert d.status_code == 409 and "record" in d.text
    assert run(_http.patch(f"{base}/{o['id']}", json={"notes": "customer changed their mind"}, headers=a)).status_code == 200
    with patch.object(server, "_issue_pos_token", new=_noop):
        again = run(_http.post(f"{base}/{o['id']}/checkout", headers=a,
                               json={"tenders": [{"method": "cash", "amount": o["total"], "tendered_amount": o["total"]}],
                                     "idempotency_key": f"{TAG}-{uuid.uuid4().hex}"}))
    assert again.status_code == 409 and "Start a new order" in again.text, "a stale Take payment must not look paid"
    pid = o["package"]["product_id"]
    assert run(server.db.pos_sales.count_documents({"line_items.product_id": pid})) == 1, "no second charge"


def test_an_order_already_sent_is_refunded_when_its_sale_is_voided():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    sent = run(_http.post(f"{base}/{o['id']}/send", json={"delivery_link": "https://drive.example/y"}, headers=_auth(owner)))
    assert sent.status_code == 200 and sent.json()["order"]["status"] == "sent"
    _void(owner, o["pos_sale_id"])
    got = _get(owner, base, o["id"])
    assert got["status"] == "refunded" and got["status_before_refund"] == "sent"
    assert run(_http.get(f"{base}/summary", headers=_auth(owner))).json()["sent"] == 0


# -------------------------------------------------- every way money goes back

def test_a_full_return_at_the_register_refunds_the_order():
    from domains.pos import services as pos
    owner = _staff()
    sp, base, o = _paid_order(owner)
    run(server.return_pos_sale(o["pos_sale_id"], pos.PosSaleReturnIn(
        lines=[{"line_index": 0, "qty": 1, "restock": False}],
        reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), owner))
    assert _get(owner, base, o["id"])["status"] == "refunded"


def test_a_refund_against_its_receipt_refunds_the_order():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    _refund(owner, o["total"], f"#{o['receipt_number'].lower()}")
    assert _get(owner, base, o["id"])["status"] == "refunded"


def test_a_part_refund_keeps_the_order_paid_and_counts_only_what_was_kept():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    _refund(owner, 10.00, o["receipt_number"])
    got = _get(owner, base, o["id"])
    assert got["status"] == "paid" and got["refunded_amount"] == 10.00
    sm = run(_http.get(f"{base}/summary", headers=_auth(owner))).json()
    assert sm["revenue"] == round(o["total"] - 10.00, 2) and sm["to_send"] == 1 and sm["refunded"] == 0
    snd = run(_http.post(f"{base}/{o['id']}/send", json={"delivery_link": "https://drive.example/z"}, headers=_auth(owner)))
    assert snd.status_code == 200, "a part refund is still a sale: the photos go out"
    csvr = run(_http.get(f"{base}.csv", headers=_auth(owner)))
    head, row = csvr.text.splitlines()[0].split(","), next(l for l in csvr.text.splitlines() if o["order_number"] in l).split(",")
    assert row[head.index("Given back")] == "10.0" and row[head.index("Status")] == "sent"


# ------------------------------------------------ wherever the order is read

def test_the_reservation_list_shows_the_order_refunded():
    owner = _staff()
    sp = _special(owner)
    res = run(server.public_photo_special_reserve(sp["slug"], server.PhotoSpecialReserveIn(
        date=sp["dates"][0], time="09:00", first_name="Pat", last_name="Refund", email=_email(),
        phone=f"330555{uuid.uuid4().int % 10_000:04d}", dog_name="Biscuit"), _Req()))["reservation"]
    sp, base, o = _paid_order(owner, sp=sp, booking_id=res["booking_id"])
    _void(owner, o["pos_sale_id"])
    roster = run(_http.get(f"/api/admin/photo-specials/{sp['id']}/reservations", headers=_auth(owner))).json()
    row = next(x for x in roster["reservations"] if x["booking_id"] == res["booking_id"])
    assert [p["status"] for p in row["photo_orders"]] == ["refunded"]


def test_a_refunded_order_something_flipped_back_heals_on_the_next_look():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    _void(owner, o["pos_sale_id"])
    _get(owner, base, o["id"])
    run(server.db.photo_special_orders.update_one({"id": o["id"]}, {"$set": {"status": "sent"}}))
    listed = run(_http.get(base, headers=_auth(owner))).json()["orders"]
    assert next(x for x in listed if x["id"] == o["id"])["status"] == "refunded"


def test_an_unpaid_order_and_an_untouched_paid_order_are_left_alone():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    walk = run(_http.post(base, json={"primary_contact": "Walk Up", "email": _email(), "package_key": "3-edited-digitals"},
                          headers=_auth(owner))).json()["order"]
    listed = {x["id"]: x for x in run(_http.get(base, headers=_auth(owner))).json()["orders"]}
    assert listed[o["id"]]["status"] == "paid" and listed[o["id"]]["refunded_amount"] == 0
    assert listed[walk["id"]]["status"] == "ordered"
    sm = run(_http.get(f"{base}/summary", headers=_auth(owner))).json()
    assert sm["revenue"] == o["total"] and sm["unpaid"] == 1


def test_every_copy_returned_one_at_a_time_refunds_exactly_what_was_charged():
    # 2 x $30 at 6.75% = $64.05. Each single return is pro-rata; the last copy
    # takes the remainder, so the order comes back to the cent, not a cent short.
    from domains.pos import services as pos
    owner = _staff()
    sp, base, o = _paid_order(owner, qty=2)
    assert o["total"] == 64.05
    for _ in range(2):
        run(server.return_pos_sale(o["pos_sale_id"], pos.PosSaleReturnIn(
            lines=[{"line_index": 0, "qty": 1, "restock": False}],
            reason=f"{TAG} returned", idempotency_key=f"{TAG}-{uuid.uuid4()}"), owner))
    got = _get(owner, base, o["id"])
    assert got["refunded_amount"] == 64.05 and got["status"] == "refunded"


def test_a_refund_deleted_as_a_mistake_puts_the_order_back_how_it_was():
    owner = _staff()
    sp, base, o = _paid_order(owner)
    ready = run(_http.patch(f"{base}/{o['id']}", json={"status": "ready"}, headers=_auth(owner)))
    assert ready.status_code == 200
    row = _refund(owner, o["total"], o["receipt_number"])
    assert _get(owner, base, o["id"])["status"] == "refunded"
    run(server.db.retail_sales.delete_one({"id": row["id"]}))       # Income → Retail Sales → delete
    got = _get(owner, base, o["id"])
    assert got["status"] == "ready" and got["refunded_amount"] == 0 and "refunded_at" not in got
