"""One receipt email per credit-pack sale (audit #37 follow-up).

A bulk credit-pack sale (POST /clients/{id}/sell-packs, the screen the
Register and Clients pages use) used to send the client TWO emails for one
sale: the hand-built pack receipt (notify_client_pack_receipt, a direct send
that ignored Settings -> Receipts) and the automatic, settings-gated receipt
(_maybe_auto_email_bulk_credit_pack_receipt). The owner decided the client
gets the automatic receipt only. A Front Desk cart (POST /pos/sales, which
can mix retail, credit packs and training programs) already produced one
receipt, and these tests lock that in.

Receipts are counted at both places they can leave the server:
  - a direct send through email_service._send (the old hand-built receipt);
  - a queued receipt through server.queue_receipt_email (the automatic one).

Calls the async server functions directly on the shared test loop against
the disposable test database, same harness as test_pos_checkout_integrity.py.
Disposable rows are tagged TEST_PACK_RECEIPT_ONCE and removed in `finally`.
"""
import asyncio
import uuid
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import email_service
import pytest
import server
from _test_loop import run

TAG = "TEST_PACK_RECEIPT_ONCE"
FAKE_ADMIN = {"id": "test-user", "name": "QA Tester", "email": "qa@test", "role": "admin"}


@pytest.fixture
def receipts(monkeypatch):
    """Records every receipt-type email that leaves the server."""
    direct, queued = [], []

    async def _capture_direct(to_email, subject, html, *args, **kwargs):
        direct.append(to_email)
        return True

    async def _capture_queued(payload, to_email, attempt_key):
        queued.append(to_email)
        return True

    monkeypatch.setattr(email_service, "_send", _capture_direct)
    monkeypatch.setattr(server, "queue_receipt_email", _capture_queued)
    return {"direct": direct, "queued": queued}


@pytest.fixture
def auto_email_on(monkeypatch):
    """Settings -> Receipts -> 'Automatically email receipts' is ON."""
    real_settings = server.get_receipt_settings

    async def _settings_on():
        return {**(await real_settings()), "auto_email_receipts": True}

    monkeypatch.setattr(server, "get_receipt_settings", _settings_on)


async def _settle(coro):
    """Runs a server call and waits for the fire-and-forget receipt tasks it
    spawns (asyncio.create_task), so the counts below are final."""
    before = set(asyncio.all_tasks())
    result = await coro
    spawned = [t for t in asyncio.all_tasks() if t not in before and t is not asyncio.current_task()]
    if spawned:
        await asyncio.gather(*spawned, return_exceptions=True)
    return result


async def _noop(*args, **kwargs):
    return None


def _receipts_to(receipts, email):
    return receipts["direct"].count(email) + receipts["queued"].count(email)


class _RegisterDay:
    """Makes sure today's register is open for the duration of a test, the
    same precondition the sell-packs and POS endpoints check. Creates the
    drawer session only if absent and removes only the row it created."""

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-register-{uuid.uuid4()}"
        before = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {
                "date": self.date, "opening_cash": 0.0,
                "notes": f"{TAG} disposable test register day",
                "suggested_opening_cash": None, "suggested_opening_from_date": None,
                "suggested_opening_from_closeout_id": None,
                "opening_override_reason": "", "opening_was_overridden": False,
                "opened_at": server.now_iso(), "opened_by": self.marker,
                "opened_by_name": f"{TAG} fixture",
            }},
            upsert=True,
            projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _client():
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} client", "role": "client",
        "email": f"{uuid.uuid4().hex[:8]}@example.invalid",
        "credits": 0, "training_credits": 0, "boarding_credits": 0,
    }
    run(server.db.clients.insert_one(dict(doc)))
    return doc


def _pack(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "slug": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}",
        "name": f"{TAG} 5-pack", "price": 100.0, "qty": 5, "active": True,
        "show_at_register": True, "service_type": "daycare", "taxable": False,
    }
    doc.update(overrides)
    run(server.db.credit_packs.insert_one(dict(doc)))
    return doc


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": 20.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": True,
    }
    doc.update(overrides)
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _program(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} program", "price": 300.0,
        "format": {"count": 6, "unit": "sessions"}, "active": True, "show_at_register": True,
        "type": "private_lessons", "min_age_months": 0, "category_id": None,
        "subcategory_id": None, "featured": False, "image_id": None, "taxable": False,
    }
    doc.update(overrides)
    run(server.db.programs.insert_one(dict(doc)))
    return doc


def _cleanup(client=None, packs=(), products=(), programs=()):
    async def go():
        cid = client["id"] if client else None
        lot_ids, sale_ids = [], []
        if cid:
            lot_ids = [d["id"] for d in await server.db.credit_lots.find({"client_id": cid}, {"_id": 0, "id": 1}).to_list(200)]
            sale_ids = [d["id"] for d in await server.db.pos_sales.find({"client_id": cid}, {"_id": 0, "id": 1}).to_list(200)]
            await server.db.clients.delete_many({"id": cid})
            await server.db.credit_lots.delete_many({"client_id": cid})
            await server.db.retail_sales.delete_many({"client_id": cid})
            await server.db.pos_sales.delete_many({"client_id": cid})
            await server.db.pos_sale_claims.delete_many({"client_id": cid})
            await server.db.payment_ledger.delete_many({"client_id": cid})
        if lot_ids or sale_ids:
            await server.db.auto_receipt_email_claims.delete_many({"ref_id": {"$in": lot_ids + sale_ids}})
        if packs:
            await server.db.credit_packs.delete_many({"id": {"$in": list(packs)}})
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if programs:
            await server.db.programs.delete_many({"id": {"$in": list(programs)}})
    run(go())


def _bulk_sale(client, items, payment_method="check"):
    body = server.SellCreditPacksBulkIn(
        items=[server.SellCreditPackItem(pack_id=pid, quantity=qty) for pid, qty in items],
        payment_method=payment_method,
        note=TAG,
    )
    return run(_settle(server.sell_credit_packs_bulk(client["id"], body, FAKE_ADMIN)))


def test_a_single_pack_sale_sends_one_receipt(receipts, auto_email_on):
    client = _client()
    pack = _pack()
    try:
        with _RegisterDay():
            _bulk_sale(client, [(pack["id"], 1)])
        assert _receipts_to(receipts, client["email"]) == 1, receipts
    finally:
        _cleanup(client=client, packs=[pack["id"]])


def test_a_multi_pack_cart_sends_one_receipt_not_one_per_pack(receipts, auto_email_on):
    client = _client()
    daycare = _pack()
    boarding = _pack(name=f"{TAG} boarding", service_type="boarding", price=250.0, qty=5)
    try:
        with _RegisterDay():
            _bulk_sale(client, [(daycare["id"], 2), (boarding["id"], 1)])
        assert _receipts_to(receipts, client["email"]) == 1, receipts
    finally:
        _cleanup(client=client, packs=[daycare["id"], boarding["id"]])


def test_with_auto_email_off_a_pack_sale_sends_no_receipt(receipts):
    """Settings default: automatic receipts are off. The pack sale now behaves
    like every other sale kind — no email at sale time unless the owner turns
    automatic receipts on or staff resend one by hand."""
    client = _client()
    pack = _pack()
    try:
        with _RegisterDay():
            _bulk_sale(client, [(pack["id"], 1)])
        assert _receipts_to(receipts, client["email"]) == 0, receipts
    finally:
        _cleanup(client=client, packs=[pack["id"]])


def test_a_mixed_front_desk_cart_sends_one_receipt(receipts, auto_email_on):
    product = _product(price=20.0)
    pack = _pack(price=100.0, qty=5)
    program = _program(price=300.0)
    client = _client()
    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[
            server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1),
            server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1),
            server.PosSaleLineIn(kind="training_program", program_id=program["id"], qty=1),
        ],
        tenders=[server.PosSaleTenderIn(method="card", amount=420.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )
    try:
        with _RegisterDay(), patch.object(server, "_issue_pos_token", new=_noop):
            run(_settle(server.create_pos_sale(body, FAKE_ADMIN)))
        assert _receipts_to(receipts, client["email"]) == 1, receipts
        assert receipts["direct"] == []
    finally:
        _cleanup(client=client, packs=[pack["id"]], products=[product["id"]], programs=[program["id"]])
