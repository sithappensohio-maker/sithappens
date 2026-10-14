"""Barcode generation for printable product labels.

A product's "Barcode / SKU" field is free text set by an admin, or scanned
in from a factory barcode — fine for products that already have one, but
a house-branded item (repackaged treats, a bandana) often doesn't. These
two endpoints generate a short, scanner-friendly, collision-free code ONLY
when one doesn't already exist, so a "Print Label" button can always reach
a real code to render without ever silently overwriting an admin-entered
or factory barcode.

Disposable tag TEST_POS_BARCODE_LABELS.
"""
import uuid
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_POS_BARCODE_LABELS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "barcode@test"}


def _create(**overrides):
    body = {"name": f"{TAG} Item", "price": 10.0, "track_inventory": False}
    body.update(overrides)
    return run(server.create_pos_product(server.PosProductCreateIn(**body), ADMIN))


def _cleanup(product_ids):
    run(server.db.pos_products.delete_many({"id": {"$in": product_ids}}))


def test_generates_a_scanner_safe_code_and_persists_it():
    p = _create()
    try:
        assert not p.get("sku")
        result = run(server.generate_pos_product_sku(p["id"], ADMIN))
        sku = result["sku"]
        assert len(sku) == 10
        assert sku.isdigit()
        assert sku.startswith("2")  # GS1 in-store-use prefix — never a real manufacturer range
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["sku"] == sku
    finally:
        _cleanup([p["id"]])


def test_calling_it_again_is_idempotent_not_a_second_code():
    p = _create()
    try:
        first = run(server.generate_pos_product_sku(p["id"], ADMIN))["sku"]
        second = run(server.generate_pos_product_sku(p["id"], ADMIN))["sku"]
        assert first == second
    finally:
        _cleanup([p["id"]])


def test_never_overwrites_an_existing_sku():
    p = _create(sku=f"{TAG}-REAL-UPC")
    try:
        result = run(server.generate_pos_product_sku(p["id"], ADMIN))
        assert result["sku"] == f"{TAG}-REAL-UPC"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert fresh["sku"] == f"{TAG}-REAL-UPC"
    finally:
        _cleanup([p["id"]])


def test_refused_for_a_product_with_options():
    p = _create(variants=[{"name": "Small", "starting_stock": 1}])
    try:
        try:
            run(server.generate_pos_product_sku(p["id"], ADMIN))
            assert False, "expected a refusal"
        except server.HTTPException as e:
            assert e.status_code == 400
            assert "options" in e.detail.lower()
    finally:
        _cleanup([p["id"]])


def test_unknown_product_is_404():
    try:
        run(server.generate_pos_product_sku(f"{TAG}-does-not-exist", ADMIN))
        assert False, "expected 404"
    except server.HTTPException as e:
        assert e.status_code == 404


def test_variant_gets_its_own_code_independent_of_its_sibling():
    p = _create(variants=[
        {"name": "Small", "starting_stock": 1},
        {"name": "Medium", "sku": f"{TAG}-M-REAL", "starting_stock": 1},
    ])
    try:
        small = next(v for v in p["variants"] if v["name"] == "Small")
        medium = next(v for v in p["variants"] if v["name"] == "Medium")
        assert not small.get("sku")

        result = run(server.generate_pos_product_variant_sku(p["id"], small["id"], ADMIN))
        sku = result["sku"]
        assert sku.startswith("2") and len(sku) == 10

        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        fresh_small = next(v for v in fresh["variants"] if v["id"] == small["id"])
        fresh_medium = next(v for v in fresh["variants"] if v["id"] == medium["id"])
        assert fresh_small["sku"] == sku
        assert fresh_medium["sku"] == f"{TAG}-M-REAL"  # untouched sibling
    finally:
        _cleanup([p["id"]])


def test_variant_generation_is_idempotent_and_never_overwrites():
    p = _create(variants=[{"name": "Small", "sku": f"{TAG}-S-REAL", "starting_stock": 1}])
    try:
        small = p["variants"][0]
        result = run(server.generate_pos_product_variant_sku(p["id"], small["id"], ADMIN))
        assert result["sku"] == f"{TAG}-S-REAL"
    finally:
        _cleanup([p["id"]])


def test_unknown_variant_is_404():
    p = _create(variants=[{"name": "Small", "starting_stock": 1}])
    try:
        try:
            run(server.generate_pos_product_variant_sku(p["id"], f"{TAG}-no-such-variant", ADMIN))
            assert False, "expected 404"
        except server.HTTPException as e:
            assert e.status_code == 404
    finally:
        _cleanup([p["id"]])


def test_retries_past_a_collision_instead_of_assigning_a_duplicate():
    """A duplicate SKU would be a real functional bug — the register's
    barcode scanner matches by exact sku, so two products sharing one code
    would make scanning pick whichever the lookup happens to find first."""
    p1 = _create(sku="2111111111")
    p2 = _create()
    try:
        # Force the first candidate to collide with p1's real sku, then
        # succeed on the second attempt.
        calls = {"n": 0}

        def fake_randbelow(_upper):
            calls["n"] += 1
            # First 9 calls build "111111111" (colliding with p1's "2"+that),
            # the next 9 build "222222222".
            digit_index = (calls["n"] - 1) % 9
            return 1 if calls["n"] <= 9 else 2
        with patch.object(server.secrets, "randbelow", side_effect=fake_randbelow):
            result = run(server.generate_pos_product_sku(p2["id"], ADMIN))
        assert result["sku"] != "2111111111"
        assert result["sku"] == "2222222222"
    finally:
        _cleanup([p1["id"], p2["id"]])


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
