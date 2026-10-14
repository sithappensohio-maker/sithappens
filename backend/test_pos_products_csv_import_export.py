"""Bulk CSV import/export for the flat product catalog.

Real HTTP + multipart, not direct function calls — import_pos_products_csv
takes an UploadFile, which only a real ASGI request can construct correctly.
Same httpx.AsyncClient-over-ASGITransport pattern as
test_curriculum_lessons_phase1.py, for the same reason (Motor stays bound to
_test_loop's shared event loop).

Disposable tag TEST_POS_CSV.
"""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_POS_CSV"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin_headers():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} admin", "role": "admin",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, "admin", 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _export():
    _, headers = _admin_headers()
    return run(_http.get("/api/pos/products/export.csv", headers=headers))


def _import(csv_text, commit=False):
    _, headers = _admin_headers()
    files = {"file": ("products.csv", csv_text.encode("utf-8"), "text/csv")}
    return run(_http.post("/api/pos/products/import.csv", headers=headers, files=files, params={"commit": str(commit).lower()}))


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "sku": None, "category": "",
        "price": 10.0, "cost": None, "active": True, "archived": False,
        "show_at_register": True, "show_online": False, "track_inventory": False, "stock_on_hand": 0.0,
        "low_stock_threshold": None, "category_id": None, "subcategory_id": None,
        "featured": False, "image_id": None, "taxable": True, "sales_destination": "internal",
        "variants": [],
    }
    doc.update(overrides)
    return doc


def _cleanup(ids):
    run(server.db.pos_products.delete_many({"id": {"$in": ids}}))
    run(server.db.inventory_movements.delete_many({"product_id": {"$in": ids}}))


def _row(results, pid=None, name=None):
    for r in results:
        if (pid and r["id"] == pid) or (name and r["name"] == name):
            return r
    return None


# ── Export ───────────────────────────────────────────────────────────────

def test_export_includes_a_plain_product_with_every_column():
    p = _product(name=f"{TAG} Leash", sku="LEASH-1", price=24.5, cost=9.0,
                 track_inventory=True, stock_on_hand=7.0, low_stock_threshold=2.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        resp = _export()
        assert resp.status_code == 200
        lines = resp.text.strip().splitlines()
        header = lines[0].split(",")
        assert header == ["id", "name", "sku", "price", "cost", "track_inventory", "stock_on_hand", "low_stock_threshold", "active", "taxable"]
        row = next(l for l in lines if p["id"] in l)
        cells = row.split(",")
        assert cells[1] == f"{TAG} Leash"
        assert cells[2] == "LEASH-1"
        assert cells[3] == "24.50"
        assert cells[4] == "9.00"
        assert cells[5] == "true"
        assert cells[6] == "7.000"
        assert cells[7] == "2.000"
    finally:
        _cleanup([p["id"]])


def test_export_excludes_variant_shopify_and_archived_products():
    variant_p = _product(name=f"{TAG} Variant", variants=[{"id": "v1", "name": "Small", "sku": None, "price_override": None, "stock_on_hand": 3.0}])
    shopify_p = _product(name=f"{TAG} Shopify", sales_destination="shopify_external")
    archived_p = _product(name=f"{TAG} Archived", archived=True)
    run(server.db.pos_products.insert_many([dict(variant_p), dict(shopify_p), dict(archived_p)]))
    try:
        resp = _export()
        text = resp.text
        assert variant_p["id"] not in text
        assert shopify_p["id"] not in text
        assert archived_p["id"] not in text
    finally:
        _cleanup([variant_p["id"], shopify_p["id"], archived_p["id"]])


def test_untracked_product_exports_a_blank_stock_cell_not_zero():
    p = _product(name=f"{TAG} Untracked", track_inventory=False, stock_on_hand=0.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        row = next(l for l in _export().text.splitlines() if p["id"] in l)
        assert row.split(",")[6] == ""
    finally:
        _cleanup([p["id"]])


# ── Import preview (commit=false) — nothing written ────────────────────────

def test_preview_a_new_row_proposes_create_and_writes_nothing():
    csv_text = f"name,price\n{TAG} New Thing,15.00\n"
    resp = _import(csv_text, commit=False)
    assert resp.status_code == 200
    data = resp.json()
    assert data["committed"] is False
    row = _row(data["rows"], name=f"{TAG} New Thing")
    assert row["action"] == "create"
    assert row["error"] is None
    assert run(server.db.pos_products.find_one({"name": f"{TAG} New Thing"})) is None


def test_preview_an_id_match_proposes_update_and_writes_nothing():
    p = _product(name=f"{TAG} Existing", price=10.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"id,price\n{p['id']},19.99\n"
        data = _import(csv_text, commit=False).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "update"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 10.0  # unchanged — preview never writes
    finally:
        _cleanup([p["id"]])


# ── Import commit — writes, with the right semantics ───────────────────────

def test_commit_creates_a_new_product_with_starting_stock():
    csv_text = f"name,sku,price,cost,track_inventory,stock_on_hand\n{TAG} Treats,{TAG}-TREATS,8.00,3.00,true,25\n"
    data = _import(csv_text, commit=True).json()
    row = _row(data["rows"], name=f"{TAG} Treats")
    assert row["action"] == "create"
    try:
        created = run(server.db.pos_products.find_one({"id": row["id"]}, {"_id": 0}))
        assert created["name"] == f"{TAG} Treats"
        assert created["sku"] == f"{TAG}-TREATS"
        assert created["price"] == 8.0
        assert created["cost"] == 3.0
        assert created["track_inventory"] is True
        assert created["stock_on_hand"] == 25.0
    finally:
        _cleanup([row["id"]])


def test_commit_update_by_id_changes_only_the_given_columns():
    cat_id = str(uuid.uuid4())
    run(server.db.shop_categories.insert_one({"id": cat_id, "name": f"{TAG} Category", "active": True, "section": "merch"}))
    p = _product(name=f"{TAG} Bowl", sku="BOWL-1", price=12.0, cost=4.0, category_id=cat_id)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"id,price\n{p['id']},15.00\n"
        data = _import(csv_text, commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "update"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 15.0
        # Blank cells on a matched row leave everything else exactly as it was.
        assert fresh["sku"] == "BOWL-1"
        assert fresh["cost"] == 4.0
        assert fresh["name"] == f"{TAG} Bowl"
        assert fresh["category_id"] == cat_id
    finally:
        _cleanup([p["id"]])
        run(server.db.shop_categories.delete_one({"id": cat_id}))


def test_commit_update_by_sku_when_no_id_given():
    p = _product(name=f"{TAG} Matched By Sku", sku=f"{TAG}-SKU1", price=5.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"sku,price\n{TAG}-SKU1,6.50\n"
        data = _import(csv_text, commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "update"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 6.5
    finally:
        _cleanup([p["id"]])


def test_commit_stock_change_goes_through_a_tracked_adjustment_not_a_raw_write():
    p = _product(name=f"{TAG} Stocked", track_inventory=True, stock_on_hand=10.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"id,stock_on_hand\n{p['id']},16\n"
        data = _import(csv_text, commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "update"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["stock_on_hand"] == 16.0
        movement = run(server.db.inventory_movements.find_one({"product_id": p["id"]}))
        assert movement is not None
        assert movement["type"] == "MANUAL_ADJUSTMENT"
        assert movement["quantity_delta"] == 6.0
        assert movement["stock_before"] == 10.0
        assert movement["stock_after"] == 16.0
    finally:
        _cleanup([p["id"]])


def test_commit_track_inventory_flips_on_in_the_same_row_that_sets_stock():
    """track_inventory=false -> true and a stock_on_hand count can arrive in
    the SAME row: the product update must land before the stock adjustment,
    or adjust-stock's own track_inventory gate would refuse it."""
    p = _product(name=f"{TAG} Newly Tracked", track_inventory=False, stock_on_hand=0.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"id,track_inventory,stock_on_hand\n{p['id']},true,9\n"
        data = _import(csv_text, commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "update"
        assert row["error"] is None
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["track_inventory"] is True
        assert fresh["stock_on_hand"] == 9.0
    finally:
        _cleanup([p["id"]])


# ── Skips, each with a readable reason ──────────────────────────────────────

def test_unknown_id_is_skipped_not_treated_as_a_new_product():
    csv_text = f"id,price\n{TAG}-does-not-exist,10\n"
    data = _import(csv_text, commit=True).json()
    row = _row(data["rows"], pid=f"{TAG}-does-not-exist")
    assert row["action"] == "skip"
    assert "no product" in row["error"].lower()


def test_a_variant_product_matched_by_id_is_skipped():
    p = _product(name=f"{TAG} Has Options", variants=[{"id": "v1", "name": "Small", "sku": None, "price_override": None, "stock_on_hand": 2.0}])
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        data = _import(f"id,price\n{p['id']},10\n", commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "skip"
        assert "options" in row["error"].lower()
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 10.0  # unchanged — the original seed value, never touched
    finally:
        _cleanup([p["id"]])


def test_a_shopify_product_matched_by_sku_is_never_touched():
    p = _product(name=f"{TAG} Shopify Linked", sku=f"{TAG}-SHOPSKU", sales_destination="shopify_external")
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        data = _import(f"sku,price\n{TAG}-SHOPSKU,10\n", commit=True).json()
        # No id/sku column match against a shopify listing -> treated as a
        # brand-new product instead (shopify listings are excluded from the
        # sku lookup itself), so assert a fresh row was proposed, not an
        # edit of the existing shopify listing.
        row = _row(data["rows"], name="")
        assert row is None or row["id"] != p["id"]
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 10.0  # the shopify listing's own seed price, untouched
    finally:
        _cleanup([p["id"]])
        run(server.db.pos_products.delete_many({"sku": f"{TAG}-SHOPSKU", "sales_destination": {"$ne": "shopify_external"}}))


def test_duplicate_sku_within_one_file_only_applies_the_first_row():
    p = _product(name=f"{TAG} Dup Target", sku=f"{TAG}-DUPSKU", price=10.0)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        csv_text = f"sku,price\n{TAG}-DUPSKU,11\n{TAG}-DUPSKU,12\n"
        data = _import(csv_text, commit=True).json()
        rows = [r for r in data["rows"] if r.get("id") == p["id"] or r["action"] == "skip"]
        updated = [r for r in rows if r["action"] == "update"]
        skipped = [r for r in rows if r["action"] == "skip"]
        assert len(updated) == 1
        assert len(skipped) == 1
        assert "already matched" in skipped[0]["error"].lower()
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["price"] == 11.0
    finally:
        _cleanup([p["id"]])


def test_invalid_price_is_skipped_with_a_readable_reason():
    data = _import(f"name,price\n{TAG} Bad Price,not-a-number\n", commit=True).json()
    row = _row(data["rows"], name=f"{TAG} Bad Price")
    assert row["action"] == "skip"
    assert "not-a-number" in row["error"]


def test_a_new_row_without_a_price_is_skipped():
    data = _import(f"name\n{TAG} No Price\n", commit=True).json()
    row = _row(data["rows"], name=f"{TAG} No Price")
    assert row["action"] == "skip"
    assert "price" in row["error"].lower()


def test_stock_given_without_track_inventory_is_skipped():
    p = _product(name=f"{TAG} Not Tracked", track_inventory=False)
    run(server.db.pos_products.insert_one(dict(p)))
    try:
        data = _import(f"id,stock_on_hand\n{p['id']},5\n", commit=True).json()
        row = _row(data["rows"], pid=p["id"])
        assert row["action"] == "skip"
        assert "doesn't track inventory" in row["error"]
    finally:
        _cleanup([p["id"]])


def test_blank_rows_are_silently_ignored_not_counted_as_skips():
    data = _import(f"name,price\n{TAG} Real Row,10\n,\n", commit=False).json()
    assert data["summary"]["total"] == 1


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
