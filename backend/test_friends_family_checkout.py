"""Friends & family groups: checking a dog out puts every dollar on the
payer (build step 5; owner request 2026-09-28). The switch is on in these
tests only.

The owner's rules: one family pays for every dog in the group. Checking the
friend's dog out — on its own, whenever it is picked up — prices it at the
payer's rates and puts the charge, the bill, its payment records, the tab and
anything bought at pickup on the payer. The friend's family's account never
moves. Prepaid credits are not used on a friends & family visit (first
release). A visit someone else paid for earns no referral reward.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import friends_family

TAG = "TEST_FF_CHECKOUT"
OWNER = {"id": "ffc-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


@contextlib.contextmanager
def _group():
    """The payer ($30 special rate on a $40 daycare) and a friend's family
    that holds prepaid daycare credits, one dog each, checked in 8 hours ago."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    fams = {}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "account_balance": 0.0, "credits": 5,
                                          "referral_code": f"R{uuid.uuid4().hex[:6].upper()}"}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did}
    payer, friend = fams["payer"], fams["friend"]
    run(server.db.clients.update_one({"id": friend["client"]}, {"$set": {
        "referred_by_code": run(server.db.clients.find_one({"id": payer["client"]}))["referral_code"]}}))
    run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": payer["client"], "target_kind": "service",
                                              "target_code": svc["id"], "override_price": 30.0, "created_at": server.now_iso()}))
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=server.business_today().isoformat(), service_type="daycare", service_id=svc["id"],
                                 override_capacity=True, override_vaccines=True, payer_client_id=payer["client"])
    rows = {r["dog_id"]: r for r in run(server.create_booking_group(body, OWNER))["bookings"]}
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    for f in fams.values():
        f["booking"] = rows[f["dog"]]["id"]
        run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
        run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": earlier}}))
    try:
        yield payer, friend
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "pos_sales", "credit_lots",
                         "referrals", "checkout_groups"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
            run(server.db.referrals.delete_many({"referred_id": f["client"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _checkout(booking_id, **body):
    payload = {"use_credits": True, "payment_method": "check", "payment_status": "paid"}
    payload.update(body)
    return run(server.check_out(booking_id, server.CheckoutIn(**payload), OWNER))


def _client(cid):
    return run(server.db.clients.find_one({"id": cid}, {"_id": 0}))


def _money_of(cid):
    """Everything that says money moved for this family."""
    return {
        "balance": round(float(_client(cid).get("account_balance") or 0), 2),
        "credits": _client(cid).get("credits"),
        "ledger": run(server.db.payment_ledger.count_documents({"client_id": cid})),
        "bills": run(server.db.invoices.count_documents({"client_id": cid})),
        "payments": run(server.db.payments.count_documents({"client_id": cid})),
        "sales": run(server.db.retail_sales.count_documents({"client_id": cid})),
    }


def test_the_friends_dog_is_billed_to_the_payer_at_the_payers_rate():
    with _group() as (payer, friend):
        friend_before = _money_of(friend["client"])
        _checkout(friend["booking"])
        row = run(server.db.bookings.find_one({"id": friend["booking"]}))
        assert row["actual_price"] == 15.0, "the multi-dog discount off the payer's $30 rate"
        assert row["payment_method"] == "check", "paid with money, not the friend's prepaid credits"
        [bill] = run(server.db.invoices.find({"booking_ids": friend["booking"]}, {"_id": 0}).to_list(5))
        assert bill["client_id"] == payer["client"] and bill["client_name"].endswith("payer")
        assert {p["client_id"] for p in run(server.db.payments.find({"invoice_id": bill["id"]}).to_list(10))} == {payer["client"]}
        assert _money_of(friend["client"]) == friend_before, "the friend's family's account never moves"


def test_a_friends_dog_put_on_the_tab_goes_on_the_payers_tab():
    with _group() as (payer, friend):
        friend_before = _money_of(friend["client"])
        _checkout(friend["booking"], payment_status="paid_partial", amount_paid=0.0)
        assert _money_of(payer["client"])["balance"] == 15.0
        assert {r["client_id"] for r in run(server.db.payment_ledger.find({"booking_id": friend["booking"]}).to_list(10))} \
            == {payer["client"]}
        assert _money_of(friend["client"]) == friend_before


def test_neither_familys_prepaid_credits_pay_for_the_friends_dog():
    """(The payer's own dog may use the payer's credits like any visit.)"""
    with _group() as (payer, friend):
        _checkout(friend["booking"], use_credits=True)
        assert _client(friend["client"])["credits"] == 5 and _client(payer["client"])["credits"] == 5
        assert run(server.db.bookings.find_one({"id": friend["booking"]}))["payment_method"] == "check"


def test_food_bought_at_the_friends_dogs_pickup_is_sold_to_the_payer():
    with _group() as (payer, friend):
        pid = str(uuid.uuid4())
        run(server.db.pos_products.insert_one({
            "id": pid, "name": f"{TAG} treats", "price": 10.0, "active": True, "archived": False, "show_at_register": True,
            "track_inventory": False, "stock_on_hand": 0, "taxable": False, "category": "", "description": "", "sku": "",
            "category_id": None, "subcategory_id": None}))
        try:
            _checkout(friend["booking"], retail_lines=[{"kind": "retail", "product_id": pid, "qty": 1}],
                      retail_idempotency_key=f"{TAG}-{uuid.uuid4()}")
            sale = run(server.db.pos_sales.find_one({"line_items.product_id": pid}, {"_id": 0}))
            assert sale["client_id"] == payer["client"]
            assert run(server.db.retail_sales.count_documents({"client_id": friend["client"]})) == 0
        finally:
            run(server.db.pos_products.delete_one({"id": pid}))


def test_a_visit_someone_else_paid_for_earns_no_referral_reward():
    with _group() as (payer, friend):
        _checkout(friend["booking"])
        assert run(server.db.referrals.find_one({"referred_id": friend["client"]})) is None
        assert _client(payer["client"])["credits"] == 5, "no free day for the payer"


def test_report_cards_and_visits_stay_with_the_dogs_own_family():
    with _group() as (_payer, friend):
        _checkout(friend["booking"])
        row = run(server.db.bookings.find_one({"id": friend["booking"]}))
        assert row["client_id"] == friend["client"] and row["status"] == "completed"
