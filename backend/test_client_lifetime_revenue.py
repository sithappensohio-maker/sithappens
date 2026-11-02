"""Admin "how much have we made from this client" — lifetime revenue per
client (owner request 2026-11-02).

Covers the three real risks in reusing the canonical Finance helpers for a
per-client rollup: friends & family payer attribution, gift-card-funded
double counting, and training-program credit-redemption double counting
(audit #38). Self-contained fixtures (never import another test module).
"""
import uuid

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run

TAG = "TEST_CLIENT_LIFETIME_REVENUE"


def _client(name="owner"):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} {name}", "email": f"{cid}@example.com",
        "credits": 0, "boarding_credits": 0, "account_balance": 0.0,
        "created_at": server.now_iso(),
    }))
    return cid


def _dog(owner_id, name="Pip"):
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "owner_id": owner_id, "name": name,
                                    "vaccines": {"rabies": "2099-01-01"}}))
    return did


def _legacy_paid_booking(client_id, dog_id, price, bill_to_client_id=None, **extra):
    """A completed, paid booking with no paid_at/ledger history — the
    legacy fallback branch of _booking_collection_events, the simplest way
    to put a dollar of booking revenue on the books for a test."""
    bid = str(uuid.uuid4())
    doc = {
        "id": bid, "client_id": client_id, "client_name": "owner", "dog_id": dog_id,
        "dog_name": "Pip", "service_type": "daycare", "date": server.business_today().isoformat(),
        "status": "completed", "payment_status": "paid", "payment_method": "cash",
        "actual_price": price, "amount_paid": price, "created_at": server.now_iso(),
    }
    if bill_to_client_id:
        doc["bill_to_client_id"] = bill_to_client_id
        doc["bill_to_client_name"] = "payer"
    doc.update(extra)
    run(server.db.bookings.insert_one(doc))
    return bid


def _retail_row(client_id, amount, tax_amount=0.0, gift_card_funded=0.0, source_kind=None):
    rid = str(uuid.uuid4())
    row = {"id": rid, "client_id": client_id, "amount": amount, "tax_amount": tax_amount,
           "gift_card_funded": gift_card_funded, "date": server.business_today().isoformat(),
           "created_at": server.now_iso()}
    if source_kind:
        row["source_kind"] = source_kind
    run(server.db.retail_sales.insert_one(row))
    return rid


def _cleanup(*client_ids):
    async def go():
        for cid in client_ids:
            for coll in ("bookings", "retail_sales"):
                await server.db[coll].delete_many({"client_id": cid})
            await server.db.bookings.delete_many({"bill_to_client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
    run(go())


def test_booking_revenue_counts_toward_the_client_who_paid():
    owner = _client("owner")
    dog = _dog(owner)
    try:
        _legacy_paid_booking(owner, dog, 50.0)
        result = run(server.client_revenue(owner, _=None))
        assert result["bookings"] == 50.0
        assert result["total"] == 50.0
    finally:
        _cleanup(owner)


def test_friends_and_family_booking_counts_toward_the_payer_not_the_dogs_owner():
    owner = _client("dog-owner")
    payer = _client("payer")
    dog = _dog(owner)
    try:
        _legacy_paid_booking(owner, dog, 30.0, bill_to_client_id=payer)
        owner_result = run(server.client_revenue(owner, _=None))
        payer_result = run(server.client_revenue(payer, _=None))
        assert owner_result["bookings"] == 0.0, "the dog's owner didn't pay for this visit"
        assert payer_result["bookings"] == 30.0, "the friends & family payer did"
    finally:
        _cleanup(owner, payer)


def test_retail_sales_net_of_tax_and_gift_card_funded():
    client_id = _client("shopper")
    try:
        _retail_row(client_id, amount=107.0, tax_amount=7.0)       # $100 merchandise + $7 tax (pass-through)
        _retail_row(client_id, amount=30.0, gift_card_funded=30.0)  # fully paid by a gift card already recognized at its sale
        result = run(server.client_revenue(client_id, _=None))
        assert result["retail"] == 100.0, "sales tax is a liability, not revenue; gift-card-funded sales already counted at card sale"
        assert result["total"] == 100.0
    finally:
        _cleanup(client_id)


def test_bulk_totals_isolate_each_client_and_zero_fill_the_rest():
    a = _client("bulk-a")
    b = _client("bulk-b")
    c = _client("bulk-c")  # asked for, but has no revenue at all
    dog_a = _dog(a)
    try:
        _legacy_paid_booking(a, dog_a, 20.0)
        _retail_row(b, amount=50.0)
        result = run(server.client_revenue_totals(client_ids=f"{a},{b},{c}", _=None))
        assert result[a]["total"] == 20.0
        assert result[b]["total"] == 50.0
        assert result[c]["total"] == 0.0, "a client with no activity still gets a zero row, not a missing key"
        # single-client and bulk paths must agree — same canonical helper underneath
        assert run(server.client_revenue(a, _=None))["total"] == result[a]["total"]
    finally:
        _cleanup(a, b, c)


def test_training_program_credit_redemption_does_not_double_count():
    client_id = _client("program-client")
    dog = _dog(client_id)
    lot_id = str(uuid.uuid4())
    try:
        run(server.db.credit_lots.insert_one({"id": lot_id, "pack_kind": "training_program", "client_id": client_id}))
        # The program sale itself is the one place this revenue is recognized.
        _retail_row(client_id, amount=200.0, source_kind="training_program_sale")
        # A session that redeems a program credit, with a touch of residual
        # cash on top (not flagged is_prepaid_program_session) — per the
        # same rule pl_report.py's top-clients tally uses, this must not
        # ALSO count toward this client's booking revenue (audit #38).
        _legacy_paid_booking(client_id, dog, 5.0, payment_method="credits",
                              credit_lot_ids=[lot_id], credit_value=0.0)
        result = run(server.client_revenue(client_id, _=None))
        assert result["bookings"] == 0.0, "the program credit redemption must not add a second slice of revenue"
        assert result["retail"] == 200.0, "the program sale is the one place this $200 counts"
        assert result["total"] == 200.0
    finally:
        run(server.db.credit_lots.delete_many({"id": lot_id}))
        _cleanup(client_id)
