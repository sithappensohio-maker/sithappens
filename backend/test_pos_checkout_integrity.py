"""Front Desk checkout financial-integrity regression tests.

Locks in the mixed-cart checkout audit: a cart containing retail products,
credit packs, and training programs must commit as ONE financial
transaction (one pos_sales doc, one set of tenders, one receipt) — never
several unrelated sales. Also locks in: idempotent retries never duplicate
a sale/charge/entitlement, a mid-commit failure rolls back EVERYTHING
(sale doc, entitlements, client balances, stock), and voiding a mixed sale
claws back every entitlement it granted, not just the retail portion.

Calls the async server functions directly via a single shared event loop
(no pytest-asyncio dependency, no HTTP layer, no auth token plumbing)
against this environment's real MongoDB. Every test creates its own
disposable rows, tagged "TEST_POS_CHECKOUT", and deletes them in a
`finally` block.
"""
import uuid
from unittest.mock import patch

import server
from _test_loop import run  # shared across every test_*.py file — see its docstring


TAG = "TEST_POS_CHECKOUT"
FAKE_USER = {"id": "test-user", "name": "QA Tester", "email": "qa@test", "role": "admin"}


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": 20.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": True,
    }
    doc.update(overrides)
    return doc


def _pack(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} pack", "price": 100.0, "qty": 5,
        "active": True, "show_at_register": True, "service_type": "daycare",
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": False,
    }
    doc.update(overrides)
    return doc


def _program(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} program", "price": 300.0,
        "format": {"count": 6, "unit": "sessions"}, "active": True, "show_at_register": True,
        "type": "private_lessons", "min_age_months": 0, "category_id": None,
        "subcategory_id": None, "featured": False, "image_id": None, "taxable": False,
    }
    doc.update(overrides)
    return doc


def _client(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} client", "role": "client",
        "credits": 0, "training_credits": 0, "boarding_credits": 0,
    }
    doc.update(overrides)
    return doc


def _register_open():
    """The real _require_register_day_open needs a live cash_drawer_sessions
    row for today; tests don't care about that concern, so it's patched out
    everywhere below (matches how other endpoints' tests in this codebase
    isolate unrelated preconditions)."""
    return patch.object(server, "_require_register_day_open", new=_noop)


async def _noop(*args, **kwargs):
    return None


def _cleanup(*, products=(), packs=(), programs=(), clients=(), sale_ids=()):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if packs:
            await server.db.credit_packs.delete_many({"id": {"$in": list(packs)}})
        if programs:
            await server.db.programs.delete_many({"id": {"$in": list(programs)}})
        if clients:
            await server.db.clients.delete_many({"id": {"$in": list(clients)}})
        if sale_ids:
            await server.db.pos_sales.delete_many({"id": {"$in": list(sale_ids)}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
            await server.db.credit_lots.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
    run(go())


def test_mixed_cart_produces_exactly_one_sale_one_entitlement_set():
    """Core requirement: retail + credit pack + training program in one cart
    must be ONE pos_sales document, ONE tenders list, credits granted for
    both pack and program, and revenue rows split by kind but all tagged to
    the same pos_sale_id."""
    product = _product(price=20.0)
    pack = _pack(price=100.0, qty=5, service_type="daycare")
    program = _program(price=300.0)
    client = _client()
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.programs.insert_one(dict(program)))
    run(server.db.clients.insert_one(dict(client)))

    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[
            server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1),
            server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1),
            server.PosSaleLineIn(kind="training_program", program_id=program["id"], qty=1),
        ],
        tenders=[server.PosSaleTenderIn(method="cash", amount=420.0, tendered_amount=420.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )
    sale_id = None
    try:
        with _register_open(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(body, FAKE_USER))
        sale_id = result["pos_sale_id"]
        assert result["sale"]["total"] == 420.0
        assert len(result["sale"]["line_items"]) == 3
        assert len(result["sale"]["tenders"]) == 1  # ONE tender, not split across 3 calls

        # Exactly one pos_sales doc for the whole cart.
        n_sales = run(server.db.pos_sales.count_documents({"id": sale_id}))
        assert n_sales == 1

        # Entitlements actually granted.
        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_after["credits"] == 5
        assert client_after["training_credits"] == 6

        lots = run(server.db.credit_lots.find({"pos_sale_id": sale_id}, {"_id": 0}).to_list(50))
        assert len(lots) == 2  # one pack lot + one program lot

        # Revenue rows: one retail_sales row for the retail line, one each
        # for the pack/program lots — all tagged to the SAME pos_sale_id.
        revenue_rows = run(server.db.retail_sales.find({"pos_sale_id": sale_id}, {"_id": 0}).to_list(50))
        assert len(revenue_rows) == 3
        total_recognized = round(sum(r["amount"] for r in revenue_rows), 2)
        assert total_recognized == 420.0
    finally:
        _cleanup(products=[product["id"]], packs=[pack["id"]], programs=[program["id"]],
                 clients=[client["id"]], sale_ids=[sale_id] if sale_id else [])


def test_retry_with_same_idempotency_key_never_duplicates():
    """Requirement: retrying the exact same checkout request must replay the
    already-completed sale instead of creating a second sale, a second
    charge, or a second set of credits."""
    pack = _pack(price=50.0, qty=3)
    client = _client()
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.clients.insert_one(dict(client)))

    idem_key = f"test-{uuid.uuid4()}"
    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1)],
        tenders=[server.PosSaleTenderIn(method="cash", amount=50.0, tendered_amount=50.0)],
        idempotency_key=idem_key,
    )
    sale_id = None
    try:
        with _register_open(), patch.object(server, "_issue_pos_token", new=_noop):
            first = run(server.create_pos_sale(body, FAKE_USER))
            sale_id = first["pos_sale_id"]
            second = run(server.create_pos_sale(body, FAKE_USER))  # exact same request replayed
        assert second["pos_sale_id"] == sale_id  # replayed, not a new sale

        n_sales = run(server.db.pos_sales.count_documents({"id": sale_id}))
        assert n_sales == 1
        n_claims = run(server.db.pos_sale_claims.count_documents({"idempotency_key": idem_key}))
        assert n_claims == 1

        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_after["credits"] == 3  # granted ONCE, not twice
        n_lots = run(server.db.credit_lots.count_documents({"pos_sale_id": sale_id}))
        assert n_lots == 1
    finally:
        _cleanup(packs=[pack["id"]], clients=[client["id"]], sale_ids=[sale_id] if sale_id else [])


def test_mismatched_tender_total_rejects_before_any_write():
    """A cart whose tenders don't sum to the unified total (across ALL
    kinds, not just retail) must be rejected outright — this is exactly the
    bug the audit flagged: a mixed cart's tender must cover the WHOLE cart,
    not just one kind's slice of it."""
    product = _product(price=30.0)
    pack = _pack(price=100.0, qty=2)
    client = _client()
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.clients.insert_one(dict(client)))

    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[
            server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1),
            server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1),
        ],
        # Only covers the retail slice ($30), not the full $130 — must fail.
        tenders=[server.PosSaleTenderIn(method="cash", amount=30.0, tendered_amount=30.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )
    try:
        with _register_open():
            try:
                run(server.create_pos_sale(body, FAKE_USER))
                assert False, "expected HTTPException for mismatched tender total"
            except server.HTTPException as exc:
                assert exc.status_code == 400
                assert "130.00" in exc.detail  # names the REAL unified total

        # Nothing was written — no sale, no lot, no balance change.
        n_sales = run(server.db.pos_sales.count_documents({"client_id": client["id"]}))
        assert n_sales == 0
        n_lots = run(server.db.credit_lots.count_documents({"client_id": client["id"]}))
        assert n_lots == 0
        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_after["credits"] == 0
    finally:
        _cleanup(products=[product["id"]], packs=[pack["id"]], clients=[client["id"]])


def test_walk_in_cannot_buy_entitlement_lines():
    """Server-side enforcement (not just the frontend button guard): a cart
    with a credit-pack/program line and no client_id must be rejected."""
    pack = _pack()
    try:
        body = server.PosSalePreviewIn(
            client_id=None,
            lines=[server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1)],
        )
        run(server.db.credit_packs.insert_one(dict(pack)))
        try:
            run(server._price_pos_cart(body.lines, None, can_price=False, client_id=None))
            assert False, "expected HTTPException for walk-in buying a credit pack"
        except server.HTTPException as exc:
            assert exc.status_code == 400
            assert "client" in exc.detail.lower()
    finally:
        _cleanup(packs=[pack["id"]])


def test_rollback_on_mid_commit_failure_leaves_no_partial_state():
    """Simulates a failure AFTER the sale doc + entitlements are written but
    before the transaction fully completes (stock mutation raises) — every
    side effect already applied (credit_lots, client balance, retail_sales
    rows, the sale doc itself) must be reversed, not left half-done."""
    product = _product(price=20.0, track_inventory=True, stock_on_hand=5)
    pack = _pack(price=100.0, qty=4)
    client = _client()
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.clients.insert_one(dict(client)))

    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[
            server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1),
            server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1),
        ],
        tenders=[server.PosSaleTenderIn(method="cash", amount=120.0, tendered_amount=120.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )
    try:
        with _register_open(), patch.object(server, "_mutate_product_stock", side_effect=RuntimeError("simulated failure")):
            try:
                run(server.create_pos_sale(body, FAKE_USER))
                assert False, "expected the simulated failure to propagate"
            except RuntimeError:
                pass

        # Nothing survives the rollback: no sale, no lot, no balance change,
        # no orphaned revenue rows, no claim left "processing" forever.
        n_sales = run(server.db.pos_sales.count_documents({"client_id": client["id"]}))
        assert n_sales == 0
        n_lots = run(server.db.credit_lots.count_documents({"client_id": client["id"]}))
        assert n_lots == 0
        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_after["credits"] == 0
        n_revenue = run(server.db.retail_sales.count_documents({"client_id": client["id"]}))
        assert n_revenue == 0
        n_claims = run(server.db.pos_sale_claims.count_documents({"idempotency_key": body.idempotency_key}))
        assert n_claims == 0
    finally:
        _cleanup(products=[product["id"]], packs=[pack["id"]], clients=[client["id"]])


def test_void_reverses_retail_and_entitlement_lines_together():
    """Voiding a mixed sale must claw back the credit-pack entitlement it
    granted (client balance decremented, lot marked voided) in addition to
    the existing retail-side reversal — not just the retail slice."""
    product = _product(price=20.0)
    pack = _pack(price=100.0, qty=5)
    client = _client()
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.credit_packs.insert_one(dict(pack)))
    run(server.db.clients.insert_one(dict(client)))

    body = server.PosSaleIn(
        client_id=client["id"],
        lines=[
            server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1),
            server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1),
        ],
        tenders=[server.PosSaleTenderIn(method="cash", amount=120.0, tendered_amount=120.0)],
        idempotency_key=f"test-{uuid.uuid4()}",
    )
    sale_id = None
    try:
        with _register_open(), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(body, FAKE_USER))
        sale_id = result["pos_sale_id"]
        client_mid = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_mid["credits"] == 5

        void_body = server.PosSaleVoidIn(reason="QA test void", idempotency_key=f"void-{uuid.uuid4()}")
        with patch.object(server, "_active_register_closeout", new=_none), \
             patch.object(server, "_issue_pos_token", new=_noop), \
             patch.object(server, "_mutate_product_stock", new=_noop):
            run(server.void_pos_sale(sale_id, void_body, FAKE_USER))

        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        assert client_after["credits"] == 0  # clawed back

        lot = run(server.db.credit_lots.find_one({"pos_sale_id": sale_id}, {"_id": 0}))
        assert lot["qty_remaining"] == 0
        assert lot.get("voided_at") is not None

        # Offsetting rows exist for BOTH the retail slice and the pack lot —
        # never deleting the originals.
        void_offsets = run(server.db.retail_sales.find({"pos_sale_id": sale_id, "source_kind": "pos_sale_void"}, {"_id": 0}).to_list(50))
        assert len(void_offsets) == 2
        assert round(sum(r["amount"] for r in void_offsets), 2) == -120.0
    finally:
        _cleanup(products=[product["id"]], packs=[pack["id"]], clients=[client["id"]], sale_ids=[sale_id] if sale_id else [])


async def _none(*args, **kwargs):
    return None


def test_per_line_tax_fields_present_and_configurable():
    """Tax handling requirement: each line retains its own taxable status,
    rate, amount, and exemption reason — driven by the item's OWN
    `taxable` field, not hardcoded by kind. A pack explicitly marked
    taxable=True must actually be taxed even though packs default to
    non-taxable."""
    taxable_pack = _pack(price=100.0, qty=5, taxable=True)  # explicit override
    normal_program = _program(price=300.0)  # default non-taxable
    run(server.db.credit_packs.insert_one(dict(taxable_pack)))
    run(server.db.programs.insert_one(dict(normal_program)))
    try:
        with patch.object(server, "get_settings", new=_settings_with_tax):
            priced, _caches = run(server._price_pos_cart(
                [
                    server.PosSaleLineIn(kind="credit_pack", pack_id=taxable_pack["id"], qty=1),
                    server.PosSaleLineIn(kind="training_program", program_id=normal_program["id"], qty=1),
                ],
                None, can_price=False, client_id="dummy-client-id",
            ))
        pack_line = next(li for li in priced["line_items"] if li["kind"] == "credit_pack")
        program_line = next(li for li in priced["line_items"] if li["kind"] == "training_program")

        assert pack_line["taxable"] is True
        assert pack_line["tax_rate_pct"] == 8.0
        assert pack_line["allocated_tax"] > 0
        assert pack_line["tax_exempt_reason"] is None

        assert program_line["taxable"] is False
        assert program_line["tax_rate_pct"] == 0.0
        assert program_line["allocated_tax"] == 0.0
        assert program_line["tax_exempt_reason"]  # a real reason string is present

        # Total tax matches sum of allocated per-line tax exactly.
        assert round(pack_line["allocated_tax"] + program_line["allocated_tax"], 2) == priced["tax_amount"]
    finally:
        _cleanup(packs=[taxable_pack["id"]], programs=[normal_program["id"]])


async def _settings_with_tax():
    return {"sales_tax": {"enabled": True, "rate_pct": 8.0, "applies_to": {"retail": True}}}


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
