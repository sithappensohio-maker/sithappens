"""Printify POD products — Phase 1 (foundation): a new sales_destination,
"printify", that is still sold and paid for here (register + eventually
the client Shop) unlike the existing shopify_external link-out card.

Covers: create/update validation (needs a Printify product id and a
Printify variant id per size), duplicate clears those ids, register
catalog includes it with variants always "in stock" (Printify makes each
on demand), register checkout skips the variant stock check for it, and
the client Shop (no size-picker yet) keeps it off the catalog and refuses
it defensively at cart-pricing time.

Disposable tag TEST_PRINTIFY_PRODUCTS.
"""
import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_PRINTIFY_PRODUCTS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "printify@test"}


def _printify_body(**overrides):
    body = {
        "name": f"{TAG} Hoodie",
        "sales_destination": "printify",
        "printify_product_id": "pf-prod-1",
        "price": 40.0,
        "variants": [
            {"name": "Small", "printify_variant_id": "pf-var-s"},
            {"name": "Medium", "printify_variant_id": "pf-var-m"},
        ],
    }
    body.update(overrides)
    return body


def _create(**overrides):
    return run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(**overrides)), ADMIN))


def _cleanup(product_ids):
    run(server.db.pos_products.delete_many({"id": {"$in": product_ids}}))


def test_create_requires_a_printify_product_id():
    try:
        run(server.create_pos_product(
            server.PosProductCreateIn(**_printify_body(printify_product_id="")), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Printify product ID" in e.detail


def test_create_requires_at_least_one_variant():
    try:
        run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(variants=[])), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "size/option" in e.detail


def test_create_requires_a_printify_variant_id_on_every_size():
    try:
        run(server.create_pos_product(server.PosProductCreateIn(**_printify_body(
            variants=[{"name": "Small", "printify_variant_id": "pf-var-s"}, {"name": "Medium"}],
        )), ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Medium" in e.detail


def test_create_keeps_price_variants_and_forces_off_stock_tracking():
    p = _create()
    try:
        assert p["sales_destination"] == "printify"
        assert p["printify_product_id"] == "pf-prod-1"
        assert p["price"] == 40.0
        assert p["track_inventory"] is False
        assert p["low_stock_threshold"] is None
        assert len(p["variants"]) == 2
        names_to_pfid = {v["name"]: v["printify_variant_id"] for v in p["variants"]}
        assert names_to_pfid == {"Small": "pf-var-s", "Medium": "pf-var-m"}
        # Unlike shopify_external, a printify listing never touches these.
        assert p["shopify_product_url"] is None
    finally:
        _cleanup([p["id"]])


def test_update_re_validates_printify_variants():
    p = _create()
    try:
        patch = {**_printify_body(), "variants": [
            {"id": p["variants"][0]["id"], "name": "Small", "printify_variant_id": "pf-var-s"},
            {"id": p["variants"][1]["id"], "name": "Medium"},  # dropped its printify_variant_id
        ]}
        try:
            run(server.update_pos_product(p["id"], server.PosProductIn(**patch), ADMIN))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "Medium" in e.detail
    finally:
        _cleanup([p["id"]])


def test_update_can_add_a_new_size_with_its_own_printify_variant_id():
    p = _create()
    try:
        patch = {**_printify_body(), "variants": [
            {"id": p["variants"][0]["id"], "name": "Small", "printify_variant_id": "pf-var-s"},
            {"id": p["variants"][1]["id"], "name": "Medium", "printify_variant_id": "pf-var-m"},
            {"name": "Large", "printify_variant_id": "pf-var-l"},
        ]}
        updated = run(server.update_pos_product(p["id"], server.PosProductIn(**patch), ADMIN))
        assert len(updated["variants"]) == 3
        large = next(v for v in updated["variants"] if v["name"] == "Large")
        assert large["printify_variant_id"] == "pf-var-l"
        assert large["stock_on_hand"] == 0.0
    finally:
        _cleanup([p["id"]])


def test_duplicate_clears_printify_links_so_two_listings_never_share_one_printify_product():
    p = _create()
    try:
        dup = run(server.duplicate_pos_product(p["id"], ADMIN))
        try:
            assert dup["sales_destination"] == "printify"
            assert dup["printify_product_id"] is None
            assert all(v.get("printify_variant_id") is None for v in dup["variants"])
            assert all(v["id"] != orig["id"] for v, orig in zip(dup["variants"], p["variants"]))
        finally:
            _cleanup([dup["id"]])
    finally:
        _cleanup([p["id"]])


def test_register_catalog_includes_it_with_every_size_always_in_stock():
    p = _create()
    try:
        catalog = run(server.get_register_catalog(client_id=None, user=ADMIN))
        item = next(i for i in catalog["items"] if i["id"] == p["id"])
        assert item["track_inventory"] is False
        assert item["in_stock"] is True
        assert len(item["variants"]) == 2
        assert all(v["in_stock"] is True for v in item["variants"])
    finally:
        _cleanup([p["id"]])


def test_register_checkout_skips_the_variant_stock_check_for_printify():
    p = _create()
    try:
        variant_id = p["variants"][0]["id"]
        line = server.PosSaleLineIn(kind="retail", product_id=p["id"], variant_id=variant_id, qty=500)
        # 500 units of a variant with stock_on_hand == 0 would refuse for any
        # ordinary variant product — it must NOT refuse here.
        priced, _caches = run(server._price_pos_cart([line], None, can_price=True, client_id=None))
        line_item = priced["line_items"][0]
        assert line_item["qty"] == 500
        assert line_item["unit_price"] == 40.0
    finally:
        _cleanup([p["id"]])


def test_client_shop_catalog_leaves_it_out():
    p = _create(show_online=True)
    try:
        catalog = run(server._build_shop_catalog(None))
        assert not any(i["id"] == p["id"] for i in catalog["items"])
    finally:
        _cleanup([p["id"]])


def test_client_shop_checkout_refuses_it_defensively():
    p = _create(show_online=True)
    try:
        cart_item = server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=1)
        try:
            run(server._price_shop_cart([cart_item], client_id=None))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 400
            assert "register" in e.detail
    finally:
        _cleanup([p["id"]])
