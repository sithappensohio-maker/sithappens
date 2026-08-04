"""Credit-pack customer-facing quantity fix — backend regression tests.

Proves `display_quantity`/`display_unit`/`display_dog_count` are pure
presentation metadata: they flow through every credit-pack catalog shape
(authenticated Shop catalog, register catalog, public catalog, admin list)
as computed `display_price_each`/`credits_per_display_unit`, while `qty`
(the actual credits granted at sale time) is completely unaffected by their
presence — same fixture/cleanup convention as test_shop_checkout_eligibility.py
(see test_shop_appearance_settings.py's docstring for the repo-wide
ad-hoc-fixture rationale).
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from pydantic import ValidationError

TAG = "TEST_PACK_DISPLAY"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


@contextlib.contextmanager
def _client(name=None, **extra_fields):
    cid = str(uuid.uuid4())
    doc = {
        "id": cid, "name": name or f"{TAG} Client {uuid.uuid4().hex[:6]}",
        "email": f"{uuid.uuid4().hex[:8]}@example.com", "phone": "555-0100",
        "created_at": "2026-01-01T00:00:00Z",
    }
    doc.update(extra_fields)
    run(server.db.clients.insert_one(doc))
    try:
        yield doc
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.credit_lots.delete_many({"client_id": cid}))
        run(server.db.price_overrides.delete_many({"client_id": cid}))


@contextlib.contextmanager
def _pack(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=15, price=375.0,
                     service_type="daycare", available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


class _OpenRegisterDay:
    """Same pattern as test_shop_checkout_eligibility.py's helper of the
    same name — opens today's cash_drawer_sessions row only if none exists
    yet, closes it back out on exit only if this instance created it."""

    def __init__(self, tag: str):
        self.tag = tag
        self.date = None
        self.marker = None
        self.created = False

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{self.tag}-register-{uuid.uuid4()}"
        before = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {
                "date": self.date, "opening_cash": 0.0,
                "notes": f"{self.tag} disposable test register day",
                "suggested_opening_cash": None, "suggested_opening_from_date": None,
                "suggested_opening_from_closeout_id": None,
                "opening_override_reason": "", "opening_was_overridden": False,
                "opened_at": server.now_iso(), "opened_by": self.marker,
                "opened_by_name": f"{self.tag} fixture",
            }},
            upsert=True, projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _find(items, item_id):
    return next((i for i in items if i["id"] == item_id), None)


# The pack from the user's report: $375, 15 internal credits, sold to
# customers as "10 daycare days for 2 dogs" ($37.50/day, 1.5 credits/day).
DAYCARE_2DOG_KW = dict(qty=15, price=375.0, service_type="daycare",
                        display_quantity=10, display_unit="day", display_dog_count=2)


# ---------------------------------------------------------------------------
# Display fields never affect qty
# ---------------------------------------------------------------------------

def test_creating_pack_with_display_fields_leaves_qty_authoritative():
    with _pack(**DAYCARE_2DOG_KW) as pack:
        assert pack["qty"] == 15
        assert pack["display_quantity"] == 10
        assert pack["display_unit"] == "day"
        assert pack["display_dog_count"] == 2


def test_purchasing_pack_grants_exactly_qty_credits_not_display_quantity():
    """Purchasing the pack still grants exactly 15 credits — the sell-pack
    flow reads pack["qty"], never display_quantity, and the resulting
    credit_lot never even carries the display fields (they're catalog-only
    metadata, not copied onto the accounting record)."""
    with _client() as client, _pack(**DAYCARE_2DOG_KW) as pack, _OpenRegisterDay(TAG):
        before = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1})) or {}
        credits_before = int(before.get("credits") or 0)
        admin = _admin_user()
        lot = run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        assert lot["qty_total"] == 15
        assert lot["qty_remaining"] == 15
        assert "display_quantity" not in lot
        after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1})) or {}
        credits_after = int(after.get("credits") or 0)
        assert credits_after - credits_before == 15, (
            f"Expected exactly 15 credits granted (pack['qty']), got {credits_after - credits_before} — "
            "display_quantity=10 must never leak into the accounting path."
        )


def test_voids_still_key_off_internal_qty_never_display_quantity():
    """A voided lot's qty_remaining clawback reads the credit_lot's own
    qty_remaining (stamped from pack["qty"]=15 at sell-time) — proving the
    internal accounting figure a void/refund would reverse is 15, not the
    display_quantity=10 a customer sees."""
    with _client() as client, _pack(**DAYCARE_2DOG_KW) as pack, _OpenRegisterDay(TAG):
        admin = _admin_user()
        run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        lot = run(server.db.credit_lots.find_one({"client_id": client["id"], "pack_id": pack["id"]}, {"_id": 0}))
        assert lot["qty_remaining"] == 15
        # The exact figure void_pos_sale's clawback would subtract from the
        # client's balance — confirmed here directly off the lot record,
        # which never received display_quantity in the first place.
        clawback_amount = int(float(lot.get("qty_remaining") or 0))
        assert clawback_amount == 15


# ---------------------------------------------------------------------------
# Catalog wiring — authenticated Shop / register / admin list
# ---------------------------------------------------------------------------

def test_authenticated_catalog_computes_display_price_and_credits_per_unit():
    with _pack(**DAYCARE_2DOG_KW) as pack:
        catalog = run(server._build_shop_catalog(None))
        item = _find(catalog["items"], pack["id"])
        assert item is not None
        assert item["display_quantity"] == 10
        assert item["display_unit"] == "day"
        assert item["display_dog_count"] == 2
        assert item["display_price_each"] == 37.50
        assert item["credits_per_display_unit"] == 1.5


def test_register_catalog_computes_display_fields_too():
    with _pack(**DAYCARE_2DOG_KW) as pack:
        catalog = run(server._build_register_catalog(None))
        item = _find(catalog["items"], pack["id"])
        assert item is not None
        assert item["display_price_each"] == 37.50
        assert item["credits_per_display_unit"] == 1.5


def test_item_detail_reuses_catalog_and_carries_display_fields():
    with _pack(**DAYCARE_2DOG_KW) as pack:
        user = {"id": str(uuid.uuid4()), "role": "client", "client_id": None, "name": f"{TAG} shopper"}
        item = run(server.get_shop_item_detail("credit_pack", pack["id"], user))
        assert item["display_quantity"] == 10
        assert item["display_price_each"] == 37.50


def test_admin_list_credit_packs_carries_display_and_computed_fields():
    with _pack(**DAYCARE_2DOG_KW) as pack:
        user = _admin_user()
        packs = run(server.list_credit_packs(user, include_inactive=True))
        row = _find(packs, pack["id"])
        assert row is not None
        assert row["display_quantity"] == 10
        assert row["display_price_each"] == 37.50
        assert row["credits_per_display_unit"] == 1.5
        assert row["value_each"] == round(375.0 / 15, 2)


def test_display_quantity_must_be_positive_when_supplied():
    try:
        server.CreditPackIn(name="x", qty=5, price=50, display_quantity=0, display_unit="day")
        assert False, "expected a validation error for display_quantity=0"
    except ValidationError:
        pass
    try:
        server.CreditPackIn(name="x", qty=5, price=50, display_quantity=-1, display_unit="day")
        assert False, "expected a validation error for negative display_quantity"
    except ValidationError:
        pass


def test_display_dog_count_must_be_at_least_one_when_supplied():
    try:
        server.CreditPackIn(name="x", qty=5, price=50, display_dog_count=0)
        assert False, "expected a validation error for display_dog_count=0"
    except ValidationError:
        pass


def test_display_unit_required_when_display_quantity_present():
    try:
        server.CreditPackIn(name="x", qty=5, price=50, display_quantity=10)
        assert False, "expected a validation error for display_quantity without display_unit"
    except ValidationError:
        pass


def test_display_quantity_required_when_display_unit_present():
    try:
        server.CreditPackIn(name="x", qty=5, price=50, display_unit="day")
        assert False, "expected a validation error for display_unit without display_quantity"
    except ValidationError:
        pass


def test_display_dog_count_alone_is_valid_without_quantity_or_unit():
    """display_dog_count has no pairing requirement — a pack can legitimately
    advertise a dog count with no quantity/unit at all."""
    pack = server.CreditPackIn(name="x", qty=5, price=50, display_dog_count=2)
    assert pack.display_dog_count == 2
    assert pack.display_quantity is None
    assert pack.display_unit is None


def test_pack_without_display_metadata_has_null_display_fields():
    """Existing packs without display metadata fall back to null display
    fields everywhere — never a fabricated 0/1 value."""
    with _pack(qty=10, price=200.0) as pack:
        catalog = run(server._build_shop_catalog(None))
        item = _find(catalog["items"], pack["id"])
        assert item["display_quantity"] is None
        assert item["display_price_each"] is None
        assert item["credits_per_display_unit"] is None


# ---------------------------------------------------------------------------
# Grandfathered pricing recalculates the displayed per-unit price
# ---------------------------------------------------------------------------

def test_grandfathered_price_recalculates_display_price_each():
    """A client-specific price override changes display_price_each for that
    client, always derived from resolve_client_price's effective_price —
    never the raw list price."""
    with _client() as client, _pack(**DAYCARE_2DOG_KW) as pack:
        admin = _admin_user()
        run(server.create_client_price_override(
            client["id"],
            server.PriceOverrideIn(target_kind="credit_pack", target_code=pack["id"], override_price=300.0),
            admin,
        ))
        catalog = run(server._build_shop_catalog(client["id"]))
        item = _find(catalog["items"], pack["id"])
        assert item["effective_price"] == 300.0
        # $300 / 10 days = $30.00/day (not the standard $37.50/day)
        assert item["display_price_each"] == 30.0
        assert item["credits_per_display_unit"] == 1.5  # unaffected by price — it's qty/display_quantity


# ---------------------------------------------------------------------------
# Public/signed-out storefront — display fields shown, price gated
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _public_shop_on(**extra):
    original = run(server.get_settings()).get("shop_page") or {}
    base = {
        "public_shop_enabled": True, "public_browsing_enabled": True,
        "show_public_prices": True, "show_public_merch": True,
        "show_public_prepaid": True, "show_public_training": True,
        "show_out_of_stock": True, "hide_empty_categories": True,
    }
    base.update(extra)
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"shop_page": {**original, **base}}}, upsert=True))
    try:
        yield
    finally:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"shop_page": original}}, upsert=True))


def test_public_catalog_includes_display_fields():
    with _public_shop_on(), _pack(publicly_visible=True, **DAYCARE_2DOG_KW) as pack:
        items = run(server._public_visible_shop_items())
        item = _find(items, pack["id"])
        assert item is not None
        assert item["display_quantity"] == 10
        assert item["display_unit"] == "day"
        assert item["display_dog_count"] == 2
        assert item["credits_per_display_unit"] == 1.5
        assert item["display_price_each"] == 37.50


def test_public_catalog_hides_display_price_when_price_hidden():
    """display_price_each is derived from effective_price, so it must be
    gated behind show_public_price exactly like every other price field —
    a price-hidden pack must not leak its per-day rate through this
    side-channel. display_quantity/unit/dog_count (quantity, not price)
    stay visible, same precedent as raw qty."""
    with _public_shop_on(), _pack(publicly_visible=True, show_public_price=False, **DAYCARE_2DOG_KW) as pack:
        items = run(server._public_visible_shop_items())
        item = _find(items, pack["id"])
        assert item is not None
        assert item["display_quantity"] == 10  # quantity — not price-gated
        assert "display_price_each" not in item
        assert "value_each" not in item
        assert "price" not in item and "effective_price" not in item
