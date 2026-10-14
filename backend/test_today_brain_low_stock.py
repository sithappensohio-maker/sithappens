"""Low-stock products surface on the Today / Action Center feed.

Before this, "low stock" was a passive badge a staff member only saw if they
happened to open Shop Manager and look. Now it's a Today Brain item — same
"derived live from the real catalog every read" discipline as waitlist spots
and renewal misses, so it's never stale and needs no separate alert job.

Disposable tag TEST_TODAY_BRAIN_LOW_STOCK.
"""
import re
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_TODAY_BRAIN_LOW_STOCK"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "lowstock@test"}


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": 10.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": True, "stock_on_hand": 10.0,
        "low_stock_threshold": None, "category_id": None, "subcategory_id": None,
        "featured": False, "image_id": None, "taxable": True,
    }
    doc.update(overrides)
    return doc


def _cleanup(ids):
    run(server.db.pos_products.delete_many({"id": {"$in": ids}}))


def _low_stock_item():
    items = run(server.admin_today_brain(ADMIN))["items"]
    return next((i for i in items if i["kind"] == "low_stock"), None)


def _low_stock_count():
    """The real dev DB this runs against may already have other low-stock
    products on it, so tests checking the COUNT compare against this
    baseline rather than asserting an absolute number."""
    item = _low_stock_item()
    if not item:
        return 0
    m = re.search(r"\d+", item["title"])
    return int(m.group()) if m else 0


def test_a_product_at_or_below_its_threshold_is_surfaced():
    before = _low_stock_count()
    p = _product(stock_on_hand=2.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        item = _low_stock_item()
        assert item is not None
        assert item["priority"] == "warn"
        assert _low_stock_count() == before + 1
        assert item["cta"] == {"type": "open_screen", "screen": "shop_manager"}
    finally:
        _cleanup([p["id"]])


def test_stock_exactly_at_the_threshold_still_counts():
    p = _product(stock_on_hand=5.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        assert _low_stock_item() is not None
    finally:
        _cleanup([p["id"]])


def test_a_product_above_its_threshold_is_not_surfaced():
    p = _product(stock_on_hand=20.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        assert _low_stock_item() is None
    finally:
        _cleanup([p["id"]])


def test_a_product_with_no_threshold_set_is_never_flagged():
    """No threshold means the admin never opted this product into the check
    — zero stock on an untracked-threshold item must not spam the feed."""
    p = _product(stock_on_hand=0.0, low_stock_threshold=None)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        assert _low_stock_item() is None
    finally:
        _cleanup([p["id"]])


def test_untracked_inventory_products_are_never_flagged():
    p = _product(track_inventory=False, stock_on_hand=0.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        assert _low_stock_item() is None
    finally:
        _cleanup([p["id"]])


def test_archived_and_inactive_products_are_never_flagged():
    archived = _product(archived=True, stock_on_hand=0.0, low_stock_threshold=5.0)
    inactive = _product(active=False, stock_on_hand=0.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_many([dict(archived), dict(inactive)]))
    try:
        assert _low_stock_item() is None
    finally:
        _cleanup([archived["id"], inactive["id"]])


def test_the_count_covers_every_low_product_not_just_one():
    before = _low_stock_count()
    a = _product(stock_on_hand=1.0, low_stock_threshold=5.0)
    b = _product(stock_on_hand=2.0, low_stock_threshold=5.0)
    run(server.db.pos_products.insert_many([dict(a), dict(b)]))
    try:
        assert _low_stock_count() == before + 2
    finally:
        _cleanup([a["id"], b["id"]])


def test_a_product_with_options_is_judged_on_summed_variant_stock_not_the_zero_top_level_field():
    """A product with options carries zero stock at its own top level —
    every unit lives on a variant row instead. Comparing the (always-zero)
    top-level field against a configured threshold would wrongly flag
    every such product as low stock regardless of its real variant stock."""
    before = _low_stock_count()
    well_stocked = _product(
        stock_on_hand=0.0, low_stock_threshold=5.0,
        variants=[{"id": "v1", "name": "Small", "stock_on_hand": 20.0}, {"id": "v2", "name": "Large", "stock_on_hand": 0.0}],
    )
    run(server.db.pos_products.insert_one(dict(well_stocked)))
    try:
        assert _low_stock_count() == before  # 20 summed units, well above the threshold of 5
    finally:
        _cleanup([well_stocked["id"]])

    low = _product(
        stock_on_hand=0.0, low_stock_threshold=5.0,
        variants=[{"id": "v1", "name": "Small", "stock_on_hand": 2.0}, {"id": "v2", "name": "Large", "stock_on_hand": 0.0}],
    )
    run(server.db.pos_products.insert_one(dict(low)))
    try:
        assert _low_stock_count() == before + 1  # 2 summed units, at/below the threshold of 5
    finally:
        _cleanup([low["id"]])
