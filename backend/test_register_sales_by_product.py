"""Register sales-by-product report.

The Shop Manager's Insights tab only ever reads shop_orders — the online
channel. A walk-up register sale never shows up there at all, so this is
the register's own "what sells" answer, built straight from pos_sales.
Also covers the "dead stock" companion view: active, tracked-inventory,
register-visible products that sold zero units in the period despite
having stock to sell.

Disposable tag TEST_REG_SALES_BY_PRODUCT. All sales/products use a fixed
historical business_date range far from any real activity, and the
sales-by-product endpoint is date-scoped, so this file never has to touch
real dev-DB register data.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_REG_SALES_BY_PRODUCT"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin"}
DAY = "2001-12-01"
OUTSIDE_DAY = "2001-12-15"


def _retail_line(**overrides):
    line = {
        "kind": "retail", "product_id": str(uuid.uuid4()), "variant_id": None,
        "description": f"{TAG} product", "qty": 1.0, "unit_price": 10.0, "amount": 10.0,
        "net_amount": 10.0, "allocated_tax": 0.0, "line_total": 10.0, "taxable": True,
    }
    line.update(overrides)
    return line


def _sale(business_date=DAY, status="completed", line_items=None, **overrides):
    doc = {
        "id": str(uuid.uuid4()), "business_date": business_date, "status": status,
        "line_items": line_items or [_retail_line()], "total": 10.0,
        "tenders": [{"method": "cash", "amount": 10.0}],
        "created_at": f"{business_date}T10:00:00",
    }
    doc.update(overrides)
    return doc


def _report(start=DAY, end=DAY):
    return run(server.admin_register_sales_by_product(start_date=start, end_date=end, _=ADMIN))


def _cleanup(sale_ids=(), product_ids=()):
    if sale_ids:
        run(server.db.pos_sales.delete_many({"id": {"$in": list(sale_ids)}}))
    if product_ids:
        run(server.db.pos_products.delete_many({"id": {"$in": list(product_ids)}}))


def test_a_basic_sale_reports_units_and_net_amount_revenue():
    pid = str(uuid.uuid4())
    sale = _sale(line_items=[_retail_line(product_id=pid, description=f"{TAG} Leash", qty=2.0,
                                           amount=20.0, net_amount=20.0, line_total=20.0)])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        report = _report()
        row = next(r for r in report["products"] if r["product_id"] == pid)
        assert row["units"] == 2.0
        assert row["revenue"] == 20.0
        assert row["name"] == f"{TAG} Leash"
        assert report["totals"]["units"] >= 2.0
        assert report["totals"]["revenue"] >= 20.0
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_b_voided_sale_is_excluded_entirely():
    pid = str(uuid.uuid4())
    sale = _sale(status="voided", line_items=[_retail_line(product_id=pid)])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        report = _report()
        assert not any(r["product_id"] == pid for r in report["products"])
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_c_partial_return_prorates_units_and_revenue():
    """3 sold, 1 returned -> net 2 units, 2/3 of the line's net_amount."""
    pid = str(uuid.uuid4())
    sale = _sale(line_items=[_retail_line(
        product_id=pid, qty=3.0, amount=30.0, net_amount=30.0, line_total=30.0, returned_qty=1.0,
    )])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        row = next(r for r in _report()["products"] if r["product_id"] == pid)
        assert row["units"] == 2.0
        assert row["revenue"] == 20.0
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_d_fully_returned_line_contributes_nothing():
    pid = str(uuid.uuid4())
    sale = _sale(line_items=[_retail_line(product_id=pid, qty=1.0, returned_qty=1.0)])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        assert not any(r["product_id"] == pid for r in _report()["products"])
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_e_non_retail_lines_are_never_counted_as_product_sales():
    pid = str(uuid.uuid4())
    sale = _sale(line_items=[
        {"kind": "credit_pack", "product_id": pid, "description": f"{TAG} pack", "qty": 1.0, "net_amount": 50.0},
        {"kind": "custom", "description": f"{TAG} custom charge", "qty": 1.0, "net_amount": 15.0},
    ])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        assert not any(r["product_id"] == pid for r in _report()["products"])
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_f_variant_lines_are_kept_separate_by_option():
    pid = str(uuid.uuid4())
    sale = _sale(line_items=[
        _retail_line(product_id=pid, variant_id="small", description=f"{TAG} Shirt — Small", qty=2.0, amount=20.0, net_amount=20.0, line_total=20.0),
        _retail_line(product_id=pid, variant_id="large", description=f"{TAG} Shirt — Large", qty=1.0, amount=10.0, net_amount=10.0, line_total=10.0),
    ])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        rows = {(r["product_id"], r["variant_id"]): r for r in _report()["products"]}
        assert rows[(pid, "small")]["units"] == 2.0
        assert rows[(pid, "small")]["name"] == f"{TAG} Shirt — Small"
        assert rows[(pid, "large")]["units"] == 1.0
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_g_a_sale_outside_the_range_is_excluded():
    pid = str(uuid.uuid4())
    sale = _sale(business_date=OUTSIDE_DAY, line_items=[_retail_line(product_id=pid)])
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        assert not any(r["product_id"] == pid for r in _report(start=DAY, end=DAY)["products"])
        assert any(r["product_id"] == pid for r in _report(start=OUTSIDE_DAY, end=OUTSIDE_DAY)["products"])
    finally:
        _cleanup(sale_ids=[sale["id"]])


def test_h_not_sold_lists_active_tracked_in_stock_products_with_zero_sales():
    quiet = str(uuid.uuid4())
    product = {
        "id": quiet, "name": f"{TAG} Quiet Shelf Item", "price": 5.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": True, "stock_on_hand": 12.0,
    }
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        row = next((r for r in _report()["not_sold"] if r["product_id"] == quiet), None)
        assert row is not None
        assert row["stock_on_hand"] == 12.0
    finally:
        _cleanup(product_ids=[quiet])


def test_i_not_sold_excludes_a_product_that_actually_sold():
    pid = str(uuid.uuid4())
    product = {
        "id": pid, "name": f"{TAG} Sold Item", "price": 5.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": True, "stock_on_hand": 5.0,
    }
    sale = _sale(line_items=[_retail_line(product_id=pid)])
    run(server.db.pos_products.insert_one(dict(product)))
    run(server.db.pos_sales.insert_one(dict(sale)))
    try:
        report = _report()
        assert any(r["product_id"] == pid for r in report["products"])
        assert not any(r["product_id"] == pid for r in report["not_sold"])
    finally:
        _cleanup(sale_ids=[sale["id"]], product_ids=[pid])


def test_j_not_sold_excludes_out_of_stock_products_nothing_to_sell_isnt_dead_stock():
    pid = str(uuid.uuid4())
    product = {
        "id": pid, "name": f"{TAG} Empty Shelf", "price": 5.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": True, "stock_on_hand": 0.0,
    }
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        assert not any(r["product_id"] == pid for r in _report()["not_sold"])
    finally:
        _cleanup(product_ids=[pid])


def test_k_not_sold_sums_variant_stock_not_the_zero_top_level_field():
    pid = str(uuid.uuid4())
    product = {
        "id": pid, "name": f"{TAG} Variant Shelf", "price": 5.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": True, "stock_on_hand": 0.0,
        "variants": [{"id": "a", "name": "A", "stock_on_hand": 4.0}, {"id": "b", "name": "B", "stock_on_hand": 3.0}],
    }
    run(server.db.pos_products.insert_one(dict(product)))
    try:
        row = next((r for r in _report()["not_sold"] if r["product_id"] == pid), None)
        assert row is not None
        assert row["stock_on_hand"] == 7.0
    finally:
        _cleanup(product_ids=[pid])


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
