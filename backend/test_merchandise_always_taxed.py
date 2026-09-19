"""One sales-tax rule, in every checkout there is.

Only physical merchandise is sales-taxable; everything Sit Happens does as a
service is not. The rule has no per-category switch, because the switch is
what broke it: `sales_tax.applies_to.retail` could be off while everything in
Settings looked configured, and goods went out untaxed with nothing on screen
to say why.

So these tests are adversarial about configuration. They set `applies_to` to
the worst thing it could say — retail explicitly OFF, every service explicitly
ON — and prove the answer does not move. If someone re-introduces a category
toggle, this file fails.

Disposable tag TEST_MERCHTAX.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

import sales_tax_policy as policy

TAG = "TEST_MERCHTAX"
RATE = 6.75  # Summit County, Ohio


@pytest.fixture(autouse=True)
def _hostile_tax_settings():
    """Tax on, at a real rate, with applies_to saying the exact opposite of
    the truth: goods exempt, services taxable."""
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax",
        "applies_to": {"retail": False, "daycare": True, "boarding": True,
                       "training": True, "grooming": True, "photography": True,
                       "credit_packs": True},
    }}}, upsert=True))
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))


# ------------------------------------------------------------------ the rule

def test_merchandise_is_taxed_whenever_tax_is_switched_on():
    for cfg in ({"enabled": True, "rate_pct": RATE},
                {"enabled": True, "rate_pct": RATE, "applies_to": {"retail": False}},
                {"enabled": True, "rate_pct": RATE, "applies_to": {}}):
        assert policy.merchandise_tax_rate(cfg) == RATE, cfg


def test_no_tax_when_it_is_switched_off_or_has_no_rate():
    for cfg in ({"enabled": False, "rate_pct": RATE},
                {"enabled": True, "rate_pct": 0},
                {"enabled": True, "rate_pct": None},
                {"enabled": True, "rate_pct": "not a number"},
                {}, None):
        assert policy.merchandise_tax_rate(cfg) == 0.0, cfg


def test_a_service_is_never_taxable_whatever_the_settings_say():
    assert policy.service_tax_rate({"enabled": True, "rate_pct": RATE,
                                    "applies_to": {"grooming": True, "daycare": True}}) == 0.0
    assert server._service_type_sales_taxable("grooming", {"applies_to": {"grooming": True}}) is False


def test_tax_is_added_on_top_and_rounded_to_the_cent():
    assert policy.tax_on(100.0, RATE) == 6.75
    assert policy.tax_on(19.99, RATE) == 1.35   # 1.349325
    assert policy.tax_on(0, RATE) == 0.0
    assert policy.tax_on(50.0, 0) == 0.0


# ------------------------------------------------------- the Register's cart

def _product(price, taxable=True):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} bag of treats", "description": "", "sku": "",
           "category": "", "price": price, "active": True, "archived": False,
           "show_at_register": True, "show_online": False, "track_inventory": False,
           "stock_on_hand": 0, "category_id": None, "subcategory_id": None,
           "featured": False, "image_id": None, "taxable": taxable}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _priced(lines):
    out, _ = run(server._price_pos_cart(
        [server.PosSaleLineIn(**line) for line in lines], None, can_price=True, client_id=None))
    return out


def _drop(*products):
    run(server.db.pos_products.delete_many({"id": {"$in": [p["id"] for p in products]}}))


def test_a_product_in_the_register_is_taxed_even_with_retail_switched_off():
    # The reported bug, as a test: this is the exact configuration that made
    # a bag of treats ring up untaxed.
    p = _product(20.00)
    try:
        priced = _priced([{"kind": "retail", "product_id": p["id"], "qty": 1}])
        assert priced["subtotal"] == 20.00
        assert priced["tax_amount"] == 1.35
        assert priced["tax_rate_pct"] == RATE
        assert priced["total"] == 21.35
        assert priced["line_items"][0]["allocated_tax"] == 1.35
    finally:
        _drop(p)


def test_a_product_explicitly_marked_exempt_is_still_honoured():
    # The per-ITEM flag is a real exemption and survives; only the per-CATEGORY
    # switch is gone.
    p = _product(20.00, taxable=False)
    try:
        priced = _priced([{"kind": "retail", "product_id": p["id"], "qty": 1}])
        assert priced["tax_amount"] == 0.0
        assert priced["total"] == 20.00
    finally:
        _drop(p)


def test_a_mixed_cart_taxes_only_the_goods():
    goods, exempt = _product(100.00), _product(50.00, taxable=False)
    try:
        priced = _priced([
            {"kind": "retail", "product_id": goods["id"], "qty": 1},
            {"kind": "retail", "product_id": exempt["id"], "qty": 1},
            {"kind": "custom", "custom_amount": 30.0, "custom_kind": "service",
             "custom_reason": TAG, "description": f"{TAG} nail trim"},
            {"kind": "custom", "custom_amount": 10.0, "custom_kind": "merchandise",
             "custom_reason": TAG, "description": f"{TAG} loose toy"},
        ])
        assert priced["subtotal"] == 190.00
        # taxable base is the $100 product + the $10 merchandise line only
        assert priced["tax_amount"] == policy.tax_on(110.0, RATE) == 7.43
        by_desc = {li["description"]: li for li in priced["line_items"]}
        assert by_desc[f"{TAG} nail trim"]["allocated_tax"] == 0.0
        assert by_desc[f"{TAG} nail trim"]["taxable"] is False
        assert by_desc[f"{TAG} loose toy"]["taxable"] is True
        assert priced["total"] == 197.43
    finally:
        _drop(goods, exempt)


def test_the_tax_the_cart_shows_is_the_tax_the_customer_pays():
    # Tax is added ON TOP of the shelf price — not carved out of it — so the
    # total is what the register asks for.
    p = _product(14.99)
    try:
        priced = _priced([{"kind": "retail", "product_id": p["id"], "qty": 2}])
        assert priced["subtotal"] == 29.98
        assert priced["tax_amount"] == 2.02
        assert priced["total"] == 32.00
    finally:
        _drop(p)


def test_the_cart_reports_how_much_of_it_is_taxable():
    # The register needs this to tell "nothing taxable here" apart from
    # "taxable goods and no tax being charged", which is the failure that
    # went unnoticed.
    goods, service_only = _product(40.00), _product(25.00, taxable=False)
    try:
        assert _priced([{"kind": "retail", "product_id": goods["id"], "qty": 1}])["taxable_subtotal"] == 40.00
        assert _priced([{"kind": "retail", "product_id": service_only["id"], "qty": 1}])["taxable_subtotal"] == 0.0
    finally:
        _drop(goods, service_only)


def test_taxable_goods_with_tax_switched_off_are_still_reported_as_taxable():
    run(server.db.settings.update_one({}, {"$set": {"sales_tax.enabled": False}}))
    p = _product(40.00)
    try:
        priced = _priced([{"kind": "retail", "product_id": p["id"], "qty": 1}])
        assert priced["tax_amount"] == 0.0
        assert priced["taxable_subtotal"] == 40.00, "the register can see it should have been taxed"
    finally:
        _drop(p)
