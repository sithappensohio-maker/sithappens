"""Photo Specials — photo orders (packages sold after the portrait session).

The contract these pin: each special carries its own editable price list; an
order can be tied to the reservation it came from (and so to the customer);
payment rings through the real register exactly like the event photo booth;
fulfilment ends with an emailed download link; and the whole thing is the
shared photo-order engine, so the next special needs no new code.
"""
import _test_env  # noqa: F401 — must run before `import server`
import datetime as dt
import uuid
from unittest.mock import patch

import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_PS_ORDERS"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
# Far enough out that no other suite's portrait slots or lessons share the day.
_day_seq = iter(range(430, 700, 3))

PACKAGES = [
    {"name": "3 Edited Digitals", "price": 30, "digitals": 3, "popular": True},
    {"name": "8x10 Framed Print", "price": 35, "digitals": 0, "print": "8×10"},
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


def _staff(role="admin", staff_role=None):
    u = {"id": str(uuid.uuid4()), "email": _email(), "name": f"{TAG} {staff_role or role}", "role": role,
         "password_hash": "x", "active": True}
    if staff_role:
        u["staff_role"] = staff_role
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    token = server.create_access_token(u["id"], u["email"], u["role"], server._token_version(u))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    ids = [s["id"] for s in run(server.db.photo_specials.find({"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(100))]
    run(server.db.photo_special_orders.delete_many({"photo_special_id": {"$in": ids}}))
    run(server.db.bookings.delete_many({"photo_special_id": {"$in": ids}}))
    run(server.db.pos_products.delete_many({"photo_special_package.photo_special_id": {"$in": ids}}))
    run(server.db.event_counters.delete_many({"_id": {"$in": [f"{i}:photo" for i in ids]}}))
    run(server.db.photo_specials.delete_many({"id": {"$in": ids}}))
    run(server.db.cash_drawer_sessions.delete_many({"opened_by": TAG}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))
    run(server.db.clients.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))


def _special_body(**over):
    n = next(_day_seq)
    day = (dt.date.today() + dt.timedelta(days=n)).isoformat()
    body = {"name": f"{TAG} Howl-O-Ween {uuid.uuid4().hex[:6]}", "dates": [day], "start_time": "09:00", "end_time": "10:00",
            "slot_minutes": 15, "booking_open": True, "published": True,
            "photos_title": "Howl-O-Ween Portraits", "order_prefix": "HOW", "photo_packages": PACKAGES}
    body.update(over)
    return body


def _create(owner, **over):
    r = run(_http.post("/api/admin/photo-specials", json=_special_body(**over), headers=_auth(owner)))
    assert r.status_code == 200, r.text
    return r.json()


def _reserve(sp, time="09:00"):
    body = server.PhotoSpecialReserveIn(date=sp["dates"][0], time=time, first_name="Pat", last_name="Order",
                                        email=_email(), phone=f"330555{uuid.uuid4().int % 10_000:04d}", dog_name="Biscuit")
    return run(server.public_photo_special_reserve(sp["slug"], body, _Req()))["reservation"]


def test_each_special_has_its_own_editable_price_list_shown_publicly():
    owner = _staff()
    sp = _create(owner)
    keys = [pk["key"] for pk in sp["photo_packages"]]
    assert keys == ["3-edited-digitals", "8x10-framed-print", "5-digitals-8x10"]
    assert sp["order_prefix"] == "HOW"
    pub = run(_http.get(f"/api/public/photo-specials/{sp['slug']}")).json()
    assert [p["name"] for p in pub["packages"]] == [p["name"] for p in PACKAGES]
    assert all("product_id" not in p and "key" not in p for p in pub["packages"]), "no internal ids on the public page"
    # a bad order prefix is refused, duplicate package keys are refused
    assert run(_http.post("/api/admin/photo-specials", json=_special_body(order_prefix="no good"), headers=_auth(owner))).status_code == 422
    dup = _special_body(photo_packages=[{"key": "a", "name": "A", "price": 1}, {"key": "a", "name": "B", "price": 2}])
    assert run(_http.post("/api/admin/photo-specials", json=dup, headers=_auth(owner))).status_code == 422


def test_an_order_for_a_reservation_rings_through_the_register_and_is_delivered():
    owner = _staff()
    front = _staff(role="employee", staff_role="front_desk")
    ro = _staff(role="employee", staff_role="read_only")
    sp = _create(owner)
    res = _reserve(sp)
    base = f"/api/admin/photo-specials/{sp['id']}/photo-orders"
    body = {"booking_id": res["booking_id"], "primary_contact": "Pat Order", "email": _email(), "dogs": ["Biscuit"],
            "shot_ref": "IMG_2001", "package_key": "5-digitals-8x10"}
    assert run(_http.post(base, json=body, headers=_auth(ro))).status_code == 403
    r = run(_http.post(base, json=body, headers=_auth(front)))
    assert r.status_code == 200, r.text
    o = r.json()["order"]
    assert o["order_number"] == "HOW-P0001" and o["status"] == "ordered" and o["list_total"] == 60.0
    assert o["booking_id"] == res["booking_id"] and o["client_id"] == res["client_id"]
    assert o["reservation_date"] == sp["dates"][0] and o["print_status"] == "pending"

    # the roster shows who has ordered what
    roster = run(_http.get(f"/api/admin/photo-specials/{sp['id']}/reservations", headers=_auth(front))).json()
    row = next(x for x in roster["reservations"] if x["booking_id"] == res["booking_id"])
    assert [p["order_number"] for p in row["photo_orders"]] == ["HOW-P0001"]
    # the desk can start an order from the row without retyping contact details
    assert row["client_email"].endswith("@example.com") and row["client_phone"].startswith("330555")

    # a reservation from somewhere else cannot be attached
    other = _create(owner)
    stranger = _reserve(other)
    assert run(_http.post(base, json={**body, "booking_id": stranger["booking_id"]}, headers=_auth(front))).status_code == 404

    # the package sells through a hidden register product tagged to this special
    fresh = run(server.db.photo_specials.find_one({"id": sp["id"]}, {"_id": 0}))
    pkg = next(pk for pk in fresh["photo_packages"] if pk["key"] == "5-digitals-8x10")
    prod = run(server.db.pos_products.find_one({"id": pkg["product_id"]}, {"_id": 0}))
    assert prod["price"] == 60.0 and prod["show_at_register"] is False and prod["photo_special_package"]["photo_special_id"] == sp["id"]

    pv = run(_http.post(f"{base}/{o['id']}/preview", headers=_auth(front))).json()
    assert pv["subtotal"] == 60.0
    total = pv["total"]
    run(server.db.cash_drawer_sessions.insert_one({"date": server.business_today().isoformat(), "opened_by": TAG,
                                                   "opening_cash": 100.0, "opened_at": server.now_iso()}))

    async def _noop(*a, **k):
        return None
    with patch.object(server, "_issue_pos_token", new=_noop):
        pay = run(_http.post(f"{base}/{o['id']}/checkout", headers=_auth(front),
                             json={"tenders": [{"method": "cash", "amount": total, "tendered_amount": total}], "idempotency_key": "ps-order-0001"}))
    assert pay.status_code == 200, pay.text
    paid = pay.json()["order"]
    assert paid["status"] == "paid" and paid["receipt_number"]
    sale = run(server.db.pos_sales.find_one({"id": paid["pos_sale_id"]}, {"_id": 0}))
    assert sale["total"] == total and sale["line_items"][0]["product_id"] == pkg["product_id"]
    assert run(_http.delete(f"{base}/{o['id']}", headers=_auth(owner))).status_code == 409

    snd = run(_http.post(f"{base}/{o['id']}/send", json={"delivery_link": "https://drive.example/howl"}, headers=_auth(front)))
    assert snd.status_code == 200 and snd.json()["order"]["status"] == "sent"
    sm = run(_http.get(f"{base}/summary", headers=_auth(front))).json()
    assert sm == {**sm, "orders": 1, "sent": 1, "unpaid": 0} and sm["revenue"] == total
    csvr = run(_http.get(f"{base}.csv", headers=_auth(owner)))
    assert csvr.status_code == 200 and "Reservation date" in csvr.text and "HOW-P0001" in csvr.text
    assert f"{sp['slug']}-photo-orders.csv" in csvr.headers["content-disposition"]

    # a special with orders cannot be deleted out from under them
    run(server.db.bookings.update_many({"photo_special_id": sp["id"]}, {"$set": {"status": "cancelled"}}))
    assert run(_http.delete(f"/api/admin/photo-specials/{sp['id']}", headers=_auth(owner))).status_code == 409


def test_repricing_a_package_keeps_its_register_product_and_the_next_order_uses_the_new_price():
    owner = _staff()
    sp = _create(owner)
    base = f"/api/admin/photo-specials/{sp['id']}/photo-orders"
    walk_up = {"primary_contact": "Walk Up", "email": _email(), "package_key": "3-edited-digitals"}
    first = run(_http.post(base, json=walk_up, headers=_auth(owner))).json()["order"]
    assert first["booking_id"] is None and first["list_total"] == 30.0
    pid = first["package"]["product_id"]

    edited = [dict(pk) for pk in run(server.db.photo_specials.find_one({"id": sp["id"]}, {"_id": 0}))["photo_packages"]]
    edited[0]["price"] = 35
    body = {**_special_body(), "name": sp["name"], "dates": sp["dates"], "photo_packages": edited}
    r = run(_http.put(f"/api/admin/photo-specials/{sp['id']}", json=body, headers=_auth(owner)))
    assert r.status_code == 200, r.text
    assert r.json()["photo_packages"][0]["product_id"] == pid, "an edit never orphans the package's register product"

    second = run(_http.post(base, json=walk_up, headers=_auth(owner))).json()["order"]
    assert second["package"]["product_id"] == pid and second["list_total"] == 35.0
    assert run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))["price"] == 35.0
    assert second["order_number"] == "HOW-P0002", "numbers run per special"


def test_orders_are_the_shared_engine_not_a_copy():
    from pathlib import Path
    here = Path(__file__).parent
    specials = (here / "domains" / "photo_specials" / "routes.py").read_text(encoding="utf-8")
    events = (here / "events_domain.py").read_text(encoding="utf-8")
    for src in (specials, events):
        assert "register_photo_order_routes(" in src
        assert "_create_pos_sale" not in src or "create_pos_sale=create_pos_sale" in src
