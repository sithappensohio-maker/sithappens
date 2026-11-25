"""Taking payment at drop-off (domains/bookings/dropoff_pay.py).

The desk sells the credits that cover a checked-in visit through the
Register; pickup then uses them and collects nothing. These tests run the
whole loop through the REAL register sale (server.create_pos_sale) and the
REAL staff checkout (server.check_out / check_out_group).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException
from test_late_day_checkout import ADMIN  # noqa: F401 — shared helper
from test_pos_checkout_integrity import FAKE_USER, _noop, _open_register_day

TAG = "TEST_DROPOFF_PAY"
DAY_PRICE = 25.0


@contextlib.contextmanager
def _world(dogs=("Rex",), credits=0, group=False, packs=((1, 25.0),), service_type="daycare", checked_in=True, **booking_extra):
    """A family with dogs checked in today and the packs the register sells.
    Yields {fam, bookings, packs}."""
    parked = run(server.db.services.find({"service_type": "daycare", "is_default": True}, {"_id": 0, "id": 1}).to_list(500))
    run(server.db.services.update_many({"service_type": "daycare"}, {"$set": {"is_default": False}}))
    svc = f"{TAG}-svc-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": svc, "name": f"{TAG} daycare", "service_type": "daycare",
                                       "base_price": DAY_PRICE, "active": True, "is_default": True}))
    fam, gid = str(uuid.uuid4()), (str(uuid.uuid4()) if group else None)
    run(server.db.clients.insert_one({"id": fam, "name": f"{TAG} family", "email": f"{fam}@example.com",
                                      "credits": credits, "boarding_credits": 0, "account_balance": 0.0}))
    if credits:
        # Credits a family really holds sit in a credit lot; checkout spends lots, not the bare number.
        run(server.db.credit_lots.insert_one({
            "id": str(uuid.uuid4()), "client_id": fam, "service_type": "daycare", "qty_total": credits, "qty_remaining": credits,
            "price_paid": DAY_PRICE * credits, "value_each": DAY_PRICE, "purchased_at": server.now_iso(), "pack_name": TAG}))
    pack_docs = []
    for qty, price in packs:
        doc = {"id": str(uuid.uuid4()), "slug": f"{TAG}-{uuid.uuid4().hex[:6]}", "name": f"{TAG} {qty}-credit pack", "qty": qty,
               "price": price, "service_type": "daycare", "active": True, "show_at_register": True, "available_online": False,
               "taxable": False, "created_at": server.now_iso()}
        run(server.db.credit_packs.insert_one(dict(doc)))
        pack_docs.append(doc)
    today = server.business_today().isoformat()
    bookings = []
    for i, name in enumerate(dogs):
        did, bid = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "owner_id": fam, "name": name, "vaccines": {"rabies": "2099-01-01"}}))
        doc = {"id": bid, "client_id": fam, "client_name": f"{TAG} family", "dog_id": did, "dog_name": name,
               "service_type": service_type, "service_id": svc if service_type == "daycare" else None,
               "date": today, "end_date": today, "status": "approved", "group_id": gid,
               "estimated_price": DAY_PRICE, "unit_price": DAY_PRICE, "pricing_snapshot": {"unit_price": DAY_PRICE},
               "credit_units_required": 1 if (i == 0 or not group) else 0.5,
               "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat() if checked_in else None,
               "checked_in_by": "test", "checked_out_at": None, "created_at": server.now_iso(), "add_ons": [], **booking_extra}
        if group and i > 0:
            doc["pricing_snapshot"]["group_dog_index"] = i
        run(server.db.bookings.insert_one(dict(doc)))
        bookings.append(doc)
    sales = []
    try:
        yield {"fam": fam, "bookings": bookings, "packs": pack_docs, "sales": sales}
    finally:
        async def tidy():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events", "checkout_groups",
                      "credit_lots", "pos_sales", "retail_sales"):
                await server.db[c].delete_many({"client_id": fam})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": sales}})
            await server.db.dogs.delete_many({"owner_id": fam})
            await server.db.clients.delete_many({"id": fam})
            await server.db.credit_packs.delete_many({"id": {"$in": [p["id"] for p in pack_docs]}})
            await server.db.services.delete_many({"id": svc})
            for row in parked:
                await server.db.services.update_one({"id": row["id"]}, {"$set": {"is_default": True}})
        run(tidy())


def _options(w, i=0, user=ADMIN):
    return run(server.dropoff_pay_options(w["bookings"][i]["id"], user))


def _mine(out, w):
    ids = {p["id"] for p in w["packs"]}
    return [p for p in out["packs"] if p["id"] in ids]


def _sell(w, option):
    """Sell the offered pack at the register for cash — the real sale path."""
    body = server.PosSaleIn(
        client_id=w["fam"],
        lines=[server.PosSaleLineIn(kind="credit_pack", pack_id=option["id"], qty=option["quantity"])],
        tenders=[server.PosSaleTenderIn(method="cash", amount=option["total"], tendered_amount=option["total"])],
        idempotency_key=f"{TAG}-{uuid.uuid4()}")
    with patch.object(server, "_issue_pos_token", new=_noop):
        sale = run(server.create_pos_sale(body, FAKE_USER))
    w["sales"].append(sale["pos_sale_id"])
    return sale


def _credits(w):
    return run(server.db.clients.find_one({"id": w["fam"]}, {"_id": 0}))["credits"]


def test_one_dog_one_day_sells_one_single_day_and_pickup_collects_nothing():
    with _open_register_day(), _world(packs=((1, 25.0), (10, 220.0))) as w:
        out = _options(w)
        assert out["offer"] is True and out["credits_short"] == 1 and out["dogs"] == ["Rex"]
        offered = _mine(out, w)
        assert [(p["quantity"], p["total"]) for p in offered] == [(1, 25.0), (1, 220.0)]
        assert offered[0]["best_match"] is True
        _sell(w, offered[0])
        assert _credits(w) == 1
        # Asked again after paying: nothing more to sell.
        again = _options(w)
        assert again["offer"] is False and again["covered"] is True and "already covered by credits" in again["reason"]
        # Pickup: the real checkout uses the credit and takes no money.
        done = run(server.check_out(w["bookings"][0]["id"], server.CheckoutIn(use_credits=True), ADMIN))
        assert done["payment_method"] == "credits"
        assert float(done.get("amount_paid") or 0) == 0 and float(done.get("cash_revenue") or 0) == 0
        assert float(done.get("balance_due") or 0) == 0 and _credits(w) == 0


def test_two_dogs_here_together_are_covered_by_the_two_dog_pack():
    with _open_register_day(), _world(dogs=("Moss", "Pip"), group=True, packs=((1, 25.0), (1.5, 37.5), (10, 220.0))) as w:
        out = _options(w, 1)   # asked from the second dog's row: still the whole family
        assert out["credits_needed"] == 1.5 and sorted(out["dogs"]) == ["Moss", "Pip"]
        offered = _mine(out, w)
        assert (offered[0]["qty"], offered[0]["quantity"], offered[0]["total"]) == (1.5, 1, 37.5)
        _sell(w, offered[0])
        run(server.check_out_group(w["bookings"][0]["id"], server.CheckoutIn(use_credits=True), user=ADMIN))
        rows = [run(server.db.bookings.find_one({"id": b["id"]}, {"_id": 0})) for b in w["bookings"]]
        assert all(r.get("checked_out_at") and r.get("payment_method") == "credits" for r in rows)
        assert round(sum(float(r.get("cash_revenue") or 0) + float(r.get("balance_due") or 0) for r in rows), 2) == 0,             "nothing collected and nothing left owing at pickup"
        assert _credits(w) == 0


def test_credits_already_on_the_account_count_and_only_the_gap_is_sold():
    with _open_register_day(), _world(dogs=("Moss", "Pip"), group=True, credits=1, packs=((1, 25.0), (1.5, 37.5))) as w:
        out = _options(w)
        assert out["credits_needed"] == 1.5 and out["credits_available"] == 1 and out["credits_short"] == 0.5
        assert _mine(out, w)[0]["total"] == 25.0, "one single day covers the half credit that is missing"
    with _open_register_day(), _world(credits=3) as w:
        out = _options(w)
        assert out["offer"] is False and out["covered"] is True


def test_two_dogs_booked_separately_are_still_paid_for_together():
    # Not one group, but one family: both draw on the same credits, so one
    # press sells what the family needs, and asking from either dog — or
    # twice — gives the same answer (never one pack for two dogs).
    with _open_register_day(), _world(dogs=("Moss", "Pip"), group=False, credits=1, packs=((1, 25.0),)) as w:
        a, b = _options(w, 0), _options(w, 1)
        for out in (a, b):
            assert out["credits_needed"] == 2 and out["credits_short"] == 1 and sorted(out["dogs"]) == ["Moss", "Pip"]
            assert sorted(out["booking_ids"]) == sorted(x["id"] for x in w["bookings"])
        _sell(w, _mine(a, w)[0])
        assert _options(w, 1)["covered"] is True
        for row in w["bookings"]:
            done = run(server.check_out(row["id"], server.CheckoutIn(use_credits=True), ADMIN))
            assert done["payment_method"] == "credits", "paid by a credit, not left owing"
            assert float(done.get("cash_revenue") or 0) == 0 and float(done.get("balance_due") or 0) == 0
        assert _credits(w) == 0


def test_an_extra_dog_that_came_alone_needs_a_whole_credit_as_checkout_will_take():
    # Booked as dog #2 of a pair (half a credit), but dog #1 never arrived:
    # checkout charges it a full credit, so that is what is sold.
    with _open_register_day(), _world(dogs=("Moss", "Pip"), group=True, packs=((1, 25.0),)) as w:
        run(server.db.bookings.update_one({"id": w["bookings"][0]["id"]}, {"$set": {"checked_in_at": None}}))
        out = _options(w, 1)
        assert out["dogs"] == ["Pip"] and out["credits_needed"] == 1 and out["credits_short"] == 1
        _sell(w, _mine(out, w)[0])
        done = run(server.check_out(w["bookings"][1]["id"], server.CheckoutIn(use_credits=True), ADMIN))
        assert done["payment_method"] == "credits" and float(done.get("balance_due") or 0) == 0
        assert float(done.get("cash_revenue") or 0) == 0 and _credits(w) == 0


def test_what_credits_do_not_cover_is_said_before_selling():
    bath = {"service_id": "svc-bath", "name": "Bath", "price": 15.0, "qty": 1, "added_at": "2026-11-25T10:00:00+00:00"}
    with _world(add_ons=[bath]) as w:
        out = _options(w)
        assert out["offer"] is True and out["still_due_at_pickup"] == 15.0
        assert any("Add-ons ($15.00) are still paid at pickup" in n for n in out["notes"])
        assert any("hours or less" in n for n in out["notes"]), "short daycare days are half price only at pickup"
    with _world(credits=1, add_ons=[bath]) as w:
        out = _options(w)
        assert out["covered"] is True and "Add-ons ($15.00) are still paid at pickup" in out["reason"]


def test_a_pack_that_only_covers_part_is_not_sold_here():
    # 25 visits' worth is past the most of one pack offered; nothing half-covering is put forward.
    with _world(packs=((1, 25.0),), credit_units_required=25) as w:
        out = _options(w)
        if not out["packs"]:   # the disposable DB may hold other register packs
            assert out["offer"] is False and "Take payment at pickup" in out["reason"]
        assert all(p["covers"] for p in out["packs"])


def test_visits_it_cannot_cover_say_why():
    with _world(checked_in=False) as w:
        assert "isn't checked in" in _options(w)["reason"]
    with _world(service_type="grooming") as w:
        out = _options(w)
        assert out["offer"] is False and "paid in dollars at pickup" in out["reason"]
    with _world(is_prepaid_program_session=True) as w:
        assert "part of a program" in _options(w)["reason"]
    with _world(bill_to_client_id="someone-else") as w:
        assert "friends & family bill" in _options(w)["reason"]
    # The payer's OWN dog on a friends & family booking carries the same mark
    # and is never paid with credits either: selling a pack would charge twice.
    with _world() as w:
        run(server.db.bookings.update_one({"id": w["bookings"][0]["id"]}, {"$set": {"bill_to_client_id": w["fam"]}}))
        out = _options(w)
        assert out["offer"] is False and "friends & family bill" in out["reason"]
    # …and such a visit does not use up this family's credits for another dog.
    with _world(dogs=("Moss", "Pip"), credits=1) as w:
        run(server.db.bookings.update_one({"id": w["bookings"][0]["id"]}, {"$set": {"bill_to_client_id": "another-family"}}))
        out = _options(w, 1)
        assert out["covered"] is True and out["dogs"] == ["Pip"]
    with _world(packs=()) as w:
        out = _options(w)
        if not out["packs"]:   # the disposable DB may hold other register packs
            assert "Take payment at pickup" in out["reason"]


def test_only_staff_who_can_take_payments_may_ask():
    with _world() as w:
        try:
            run(server.dropoff_pay_options(w["bookings"][0]["id"], {"id": "x", "role": "employee", "staff_role": "read_only", "permissions": {}}))
            assert False, "expected a refusal"
        except HTTPException as e:
            assert e.status_code == 403
        try:
            run(server.dropoff_pay_options("no-such-booking", ADMIN))
            assert False, "expected 404"
        except HTTPException as e:
            assert e.status_code == 404
