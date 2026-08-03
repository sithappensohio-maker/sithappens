"""Checkpoint 2 (Phase 2a/2b) backend tests for the public no-account
storefront: the allowlisted public catalog/taxonomy/item-detail endpoints
and the layered public media authorization + ETag revalidation.

Every test that needs the public shop "on" wraps itself in `_public_shop_on()`
which snapshots and restores the exact prior `shop_page` sub-keys it touches,
so tests never leak state into each other or into the real settings doc.
Fixtures (categories/subcategories/products/packs/programs) are tagged with
TAG and always cleaned up in `finally`, per this repo's ad-hoc test
convention (see test_shop_appearance_settings.py's docstring).
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from fastapi import HTTPException
from fastapi.responses import Response

TAG = "TEST_PUBLIC_SHOP"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    """Minimal stand-in for fastapi.Request — only `_client_ip` and the
    conditional-GET `If-None-Match` check ever touch this in the code under
    test, and `_enforce_rate_limit` itself never reads `request` at all."""
    def __init__(self, ip="127.0.0.1", headers=None):
        self.headers = headers or {}
        self.client = _FakeClient(ip)


_ip_counter = [0]


def _req(headers=None):
    """A fresh, never-before-used IP per call so each test's rate-limit
    bucket starts clean regardless of other tests/processes hitting the same
    scope concurrently."""
    _ip_counter[0] += 1
    return _FakeRequest(ip=f"10.77.0.{_ip_counter[0] % 250 + 1}", headers=headers)


def _flatten(prefix, d, out):
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            _flatten(key, v, out)
        else:
            out[key] = v
    return out


def _get_nested(d, dotted):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


@contextlib.contextmanager
def _shop_page_patch(**patch):
    """Applies a (possibly nested) partial patch to shop_page, restoring the
    exact prior values (including None/absent) on exit."""
    original = run(server.get_settings()).get("shop_page") or {}
    flat_patch = _flatten("", patch, {})
    flat_original = {k: _get_nested(original, k) for k in flat_patch}
    run(server.db.settings.update_one({"id": "global"}, {"$set": {f"shop_page.{k}": v for k, v in flat_patch.items()}}, upsert=True))
    try:
        yield
    finally:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {f"shop_page.{k}": v for k, v in flat_original.items()}}, upsert=True))


def _public_shop_on(**extra):
    """Baseline: public shop fully on, all three sections public, prices
    shown, out-of-stock shown — the sane default most tests build on top of."""
    base = {
        "public_shop_enabled": True, "public_browsing_enabled": True,
        "show_public_prices": True, "show_public_merch": True,
        "show_public_prepaid": True, "show_public_training": True,
        "show_out_of_stock": True, "hide_empty_categories": True,
    }
    base.update(extra)
    return _shop_page_patch(**base)


@contextlib.contextmanager
def _category(name=None, section="merch", **kw):
    user = _admin_user()
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=name or f"{TAG} Category {uuid.uuid4().hex[:6]}", section=section, **kw), user))
    try:
        yield cat
    finally:
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))


@contextlib.contextmanager
def _subcategory(category_id, name=None, **kw):
    user = _admin_user()
    sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(category_id=category_id, name=name or f"{TAG} Sub {uuid.uuid4().hex[:6]}", **kw), user))
    try:
        yield sub
    finally:
        run(server.db.shop_subcategories.delete_one({"id": sub["id"]}))


@contextlib.contextmanager
def _product(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Product {uuid.uuid4().hex[:6]}", price=19.99, show_online=True, active=True, starting_stock=0)
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _pack(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=5, price=99.0, available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _program(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons", available_online=True, active=True, price=250.0)
    defaults.update(kw)
    created = run(server.create_program(server.ProgramIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.programs.delete_one({"id": created["id"]}))


def _find(items, item_id):
    return next((i for i in items if i["id"] == item_id), None)


# ---------------------------------------------------------------------------
# Gate 1 — public shop disabled/enabled
# ---------------------------------------------------------------------------

def test_shop_disabled_returns_404_from_catalog_taxonomy_item_and_media():
    with _shop_page_patch(public_shop_enabled=False, public_browsing_enabled=False):
        try:
            run(server.get_public_shop_catalog(_req()))
            assert False, "expected 404"
        except HTTPException as e:
            assert e.status_code == 404
        try:
            run(server.get_public_shop_taxonomy(_req()))
            assert False, "expected 404"
        except HTTPException as e:
            assert e.status_code == 404
        try:
            run(server.get_public_shop_item_detail("product", "nonexistent", _req()))
            assert False, "expected 404"
        except HTTPException as e:
            assert e.status_code == 404
        assert run(server._is_public_shop_media("nonexistent-media-id")) is False


def test_shop_enabled_with_no_matching_items_returns_empty_list_not_error():
    with _public_shop_on():
        result = run(server.get_public_shop_catalog(_req()))
        assert result == {"items": []} or isinstance(result["items"], list)


# ---------------------------------------------------------------------------
# Gate 1/2 — explicit allowlist, no cost/overrides/internal fields/stock counts
# ---------------------------------------------------------------------------

def test_public_item_never_leaks_invented_internal_field_or_cost_or_overrides():
    with _public_shop_on():
        with _product(cost=5.0, price=25.0, publicly_visible=True) as p:
            # Simulate an "invented" internal field that must never appear in
            # any public response — proves the builder is an allowlist, not
            # a redaction of a copied internal dict.
            run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"totally_internal_field_xyz": "secret"}}))
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            assert row is not None
            assert "totally_internal_field_xyz" not in row
            assert "cost" not in row
            assert "pricing_source" not in row
            assert "price_override_id" not in row
            assert "has_price_override" not in row
            assert "legacy_price" not in row
            assert "has_legacy_override" not in row
            assert row["effective_price"] == row["list_price"] == 25.0


def test_public_item_never_contains_raw_stock_fields_only_availability():
    with _public_shop_on():
        with _product(track_inventory=True, starting_stock=3, low_stock_threshold=10) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            assert row is not None
            assert "stock_on_hand" not in row
            assert "track_inventory" not in row
            assert "in_stock" not in row
            assert row["availability"] in ("in_stock", "low_stock", "out_of_stock")


def test_guest_cart_allowed_always_false_for_credit_pack_and_training_program():
    with _public_shop_on():
        with _pack() as pk:
            run(server.db.credit_packs.update_one({"id": pk["id"]}, {"$set": {"guest_cart_allowed": True}}))
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, pk["id"])
            assert row["guest_cart_allowed"] is False
        with _program() as prog:
            run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"guest_cart_allowed": True}}))
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, prog["id"])
            assert row["guest_cart_allowed"] is False


def test_requirement_flags_override_guest_cart_allowed_in_public_response():
    with _public_shop_on():
        for flag in ("requires_dog", "requires_approval", "requires_completed_onboarding"):
            with _product(guest_cart_allowed=True, **{flag: True}) as p:
                items = run(server.get_public_shop_catalog(_req()))["items"]
                row = _find(items, p["id"])
                assert row["account_required"] is True, flag
                assert row["guest_cart_allowed"] is False, flag


# ---------------------------------------------------------------------------
# Gate 2 — price-hidden behavior + hidden Shopify prices
# ---------------------------------------------------------------------------

def test_price_hidden_item_has_no_price_fields_and_guest_cart_disabled():
    with _public_shop_on():
        with _product(show_public_price=False, guest_cart_allowed=True) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            for f in ("price", "list_price", "effective_price"):
                assert f not in row
            assert row["guest_cart_allowed"] is False


def test_global_show_public_prices_false_strips_price_from_every_item():
    with _public_shop_on(show_public_prices=False):
        with _product() as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            for f in ("price", "list_price", "effective_price"):
                assert f not in row


def test_hidden_shopify_prices_stripped_but_view_options_fields_remain():
    with _public_shop_on(show_public_prices=False):
        with _product(sales_destination="shopify_external", shopify_product_url="https://example.myshopify.com/products/x", shopify_display_price=42.0) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            assert row is not None
            assert "shopify_display_price" not in row
            assert "shopify_from_price" not in row
            assert row["sales_destination"] == "shopify_external"
            assert row["shopify_product_url"] == "https://example.myshopify.com/products/x"


def test_shopify_prices_visible_when_pricing_enabled():
    with _public_shop_on():
        with _product(sales_destination="shopify_external", shopify_product_url="https://example.myshopify.com/products/y", shopify_display_price=42.0) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            assert row["shopify_display_price"] == 42.0
            assert row["sales_destination"] == "shopify_external"


# ---------------------------------------------------------------------------
# Gate 3 — hidden sections / inactive categories / inactive subcategories
# ---------------------------------------------------------------------------

def test_section_off_removes_only_that_kind_from_catalog_and_item_detail():
    with _public_shop_on():
        with _product() as p, _pack() as pk:
            with _shop_page_patch(sections={"merch": {"visible": False}}):
                items = run(server.get_public_shop_catalog(_req()))["items"]
                assert _find(items, p["id"]) is None
                assert _find(items, pk["id"]) is not None
                try:
                    run(server.get_public_shop_item_detail("product", p["id"], _req()))
                    assert False, "expected 404 for hidden-section item"
                except HTTPException as e:
                    assert e.status_code == 404
                # unaffected kind still resolves fine
                detail = run(server.get_public_shop_item_detail("credit_pack", pk["id"], _req()))
                assert detail["id"] == pk["id"]


def test_show_public_section_flag_removes_kind_independent_of_internal_visible():
    with _public_shop_on(show_public_merch=False):
        with _product() as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            assert _find(items, p["id"]) is None
            try:
                run(server.get_public_shop_item_detail("product", p["id"], _req()))
                assert False
            except HTTPException as e:
                assert e.status_code == 404


def test_inactive_category_item_absent_from_catalog_and_404s_from_detail():
    with _public_shop_on():
        with _category() as cat:
            with _product(category_id=cat["id"]) as p:
                run(server.db.shop_categories.update_one({"id": cat["id"]}, {"$set": {"active": False}}))
                items = run(server.get_public_shop_catalog(_req()))["items"]
                assert _find(items, p["id"]) is None
                try:
                    run(server.get_public_shop_item_detail("product", p["id"], _req()))
                    assert False
                except HTTPException as e:
                    assert e.status_code == 404


def test_inactive_subcategory_item_absent_from_catalog_and_404s_from_detail():
    with _public_shop_on():
        with _category() as cat:
            with _subcategory(cat["id"]) as sub:
                with _product(category_id=cat["id"], subcategory_id=sub["id"]) as p:
                    run(server.db.shop_subcategories.update_one({"id": sub["id"]}, {"$set": {"active": False}}))
                    items = run(server.get_public_shop_catalog(_req()))["items"]
                    assert _find(items, p["id"]) is None
                    try:
                        run(server.get_public_shop_item_detail("product", p["id"], _req()))
                        assert False
                    except HTTPException as e:
                        assert e.status_code == 404


# ---------------------------------------------------------------------------
# Gate 4 — out-of-stock catalog-vs-detail split
# ---------------------------------------------------------------------------

def test_out_of_stock_hidden_from_catalog_but_direct_detail_still_works():
    with _public_shop_on(show_out_of_stock=False):
        with _product(track_inventory=True, starting_stock=0) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            assert _find(items, p["id"]) is None
            detail = run(server.get_public_shop_item_detail("product", p["id"], _req()))
            assert detail["id"] == p["id"]
            assert detail["availability"] == "out_of_stock"


def test_out_of_stock_visible_in_catalog_when_show_out_of_stock_true():
    with _public_shop_on(show_out_of_stock=True):
        with _product(track_inventory=True, starting_stock=0) as p:
            items = run(server.get_public_shop_catalog(_req()))["items"]
            row = _find(items, p["id"])
            assert row is not None
            assert row["availability"] == "out_of_stock"


def test_category_with_only_out_of_stock_items_treated_as_empty_when_hiding_oos():
    with _public_shop_on(show_out_of_stock=False):
        with _category(hide_when_empty=True) as cat:
            with _product(category_id=cat["id"], track_inventory=True, starting_stock=0):
                taxonomy = run(server.get_public_shop_taxonomy(_req()))
                assert _find(taxonomy["categories"], cat["id"]) is None


# ---------------------------------------------------------------------------
# Gate 3/continued — taxonomy hide-when-empty consistency
# ---------------------------------------------------------------------------

def test_taxonomy_hides_effectively_empty_category_and_shows_nonempty_one():
    with _public_shop_on():
        with _category(hide_when_empty=True) as empty_cat, _category(hide_when_empty=True) as full_cat:
            with _product(category_id=full_cat["id"]):
                taxonomy = run(server.get_public_shop_taxonomy(_req()))
                assert _find(taxonomy["categories"], empty_cat["id"]) is None
                assert _find(taxonomy["categories"], full_cat["id"]) is not None


def test_taxonomy_keeps_empty_category_when_hide_when_empty_false():
    with _public_shop_on():
        with _category(hide_when_empty=False) as cat:
            taxonomy = run(server.get_public_shop_taxonomy(_req()))
            assert _find(taxonomy["categories"], cat["id"]) is not None


# ---------------------------------------------------------------------------
# Gate 5 — public media authorization rechecked on every request
# ---------------------------------------------------------------------------

async def _mk_media(suffix="a"):
    media_id = str(uuid.uuid4())
    await server.db.shop_media.insert_one({
        "id": media_id, "mime": "image/png", "data": f"data:image/png;base64,{suffix}",
        "filename": f"{suffix}.png", "size_bytes": 1, "uploaded_at": "now", "uploaded_by": "test",
    })
    return media_id


def test_banner_media_is_public_when_shop_enabled():
    with _public_shop_on():
        media_id = run(_mk_media("banner"))
        try:
            with _shop_page_patch(banner_image_id=media_id):
                assert run(server._is_public_shop_media(media_id)) is True
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_section_media_hidden_when_section_toggled_off():
    with _public_shop_on():
        media_id = run(_mk_media("section"))
        try:
            with _shop_page_patch(sections={"merch": {"image_id": media_id}}):
                assert run(server._is_public_shop_media(media_id)) is True
                with _shop_page_patch(sections={"merch": {"visible": False}}):
                    assert run(server._is_public_shop_media(media_id)) is False
                with _shop_page_patch(show_public_merch=False):
                    assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_category_media_404s_once_category_deactivated():
    with _public_shop_on():
        media_id = run(_mk_media("cat"))
        try:
            with _category(image_id=media_id, hide_when_empty=False) as cat:
                assert run(server._is_public_shop_media(media_id)) is True
                run(server.db.shop_categories.update_one({"id": cat["id"]}, {"$set": {"active": False}}))
                assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_category_mobile_image_also_authorized_when_category_public():
    with _public_shop_on():
        media_id = run(_mk_media("catmobile"))
        try:
            with _category(mobile_image_id=media_id, hide_when_empty=False) as cat:
                assert run(server._is_public_shop_media(media_id)) is True
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_subcategory_media_404s_once_subcategory_deactivated_even_if_category_active():
    with _public_shop_on():
        media_id = run(_mk_media("sub"))
        try:
            with _category(hide_when_empty=False) as cat:
                with _subcategory(cat["id"], image_id=media_id) as sub:
                    assert run(server._is_public_shop_media(media_id)) is True
                    run(server.db.shop_subcategories.update_one({"id": sub["id"]}, {"$set": {"active": False}}))
                    assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_category_media_404s_when_only_referencing_item_is_under_inactive_subcategory():
    """Proves the non-empty check mirrors the two-level _shop_org_visible
    rule, not just a category-active check: the category and the item's own
    `active` are both still True, but the item's subcategory is inactive, so
    the category is effectively empty and its image must not resolve."""
    with _public_shop_on():
        media_id = run(_mk_media("catemptyviasub"))
        try:
            with _category(image_id=media_id, hide_when_empty=True) as cat:
                with _subcategory(cat["id"]) as sub:
                    with _product(category_id=cat["id"], subcategory_id=sub["id"]):
                        assert run(server._is_public_shop_media(media_id)) is True
                        run(server.db.shop_subcategories.update_one({"id": sub["id"]}, {"$set": {"active": False}}))
                        assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_hidden_empty_category_media_404s_even_though_category_record_active():
    with _public_shop_on():
        media_id = run(_mk_media("emptycat"))
        try:
            with _category(image_id=media_id, hide_when_empty=True) as cat:
                assert cat["active"] is True
                assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_category_media_404s_when_only_items_are_out_of_stock_and_oos_hidden():
    with _public_shop_on(show_out_of_stock=False):
        media_id = run(_mk_media("catoos"))
        try:
            with _category(image_id=media_id, hide_when_empty=True) as cat:
                with _product(category_id=cat["id"], track_inventory=True, starting_stock=0):
                    assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_item_media_authorized_only_when_category_and_subcategory_both_active():
    with _public_shop_on():
        media_id = run(_mk_media("item"))
        try:
            with _category(hide_when_empty=False) as cat:
                with _subcategory(cat["id"]) as sub:
                    with _product(image_id=media_id, category_id=cat["id"], subcategory_id=sub["id"]):
                        assert run(server._is_public_shop_media(media_id)) is True
                        run(server.db.shop_subcategories.update_one({"id": sub["id"]}, {"$set": {"active": False}}))
                        assert run(server._is_public_shop_media(media_id)) is False
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


def test_media_auth_never_rebuilds_the_full_catalog():
    """_is_public_shop_media must be targeted point lookups only — never a
    call to _build_shop_catalog. Patch it to explode if invoked."""
    orig = server._build_shop_catalog

    async def _boom(*a, **kw):
        raise AssertionError("_is_public_shop_media must never call _build_shop_catalog")

    server._build_shop_catalog = _boom
    try:
        with _public_shop_on():
            result = run(server._is_public_shop_media("some-nonexistent-id"))
            assert result is False
    finally:
        server._build_shop_catalog = orig


# ---------------------------------------------------------------------------
# Gate 6 — ETag revalidation: 304 only while public, 404 (never 304) once hidden
# ---------------------------------------------------------------------------

def test_etag_revalidation_200_then_304_then_404_once_hidden_never_304_again():
    with _public_shop_on():
        media_id = run(_mk_media("etag"))
        try:
            with _category(image_id=media_id, hide_when_empty=False) as cat:
                resp1 = Response()
                out1 = run(server.get_public_shop_media(media_id, _req(), resp1))
                assert resp1.headers.get("etag") == f'"{media_id}"'
                assert out1["data"]

                resp2 = Response()
                out2 = run(server.get_public_shop_media(media_id, _req(headers={"if-none-match": f'"{media_id}"'}), resp2))
                assert isinstance(out2, Response)
                assert out2.status_code == 304

                run(server.db.shop_categories.update_one({"id": cat["id"]}, {"$set": {"active": False}}))
                try:
                    run(server.get_public_shop_media(media_id, _req(headers={"if-none-match": f'"{media_id}"'}), Response()))
                    assert False, "expected 404, not a 304, once media is no longer public"
                except HTTPException as e:
                    assert e.status_code == 404
        finally:
            run(server.db.shop_media.delete_one({"id": media_id}))


# ---------------------------------------------------------------------------
# Gate 7 — catalog and media rate limits use separate scopes
# ---------------------------------------------------------------------------

def test_catalog_and_media_rate_limits_are_independent_scopes():
    ip = f"10.88.0.{uuid.uuid4().int % 250 + 1}"
    fake = _FakeRequest(ip=ip)
    for _ in range(60):
        run(server._enforce_rate_limit(fake, "public_shop_catalog", ip, limit=60, window_seconds=60))
    try:
        run(server._enforce_rate_limit(fake, "public_shop_catalog", ip, limit=60, window_seconds=60))
        assert False, "expected 429 after exceeding the catalog scope's limit"
    except HTTPException as e:
        assert e.status_code == 429

    # Same subject/IP, different scope name — must not be rate-limited yet,
    # proving the two scopes never share a bucket.
    ok = run(server._enforce_rate_limit(fake, "public_shop_media", ip, limit=300, window_seconds=60))
    assert ok is True
