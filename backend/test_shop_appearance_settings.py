"""Focused regression tests for Checkpoint 1 (Phases 1a-1c) of the Shop
Appearance & Organization + public no-account storefront work:
  - shop_page settings default/backfill (whole-key-missing and
    partial-sections-missing cases), mirroring the day_to_day deep-merge
    pattern rather than clobbering saved section overrides.
  - _public_purchase_state's kind-based hard rule, requirement-flag
    override of guest_cart_allowed, and price-visibility gating.
  - _validate_banner_cta_url's safe-scheme allowlist.
  - Category CRUD round-trip for the new image_id/mobile_image_id/
    is_featured/hide_when_empty fields, reflected in the client-facing
    taxonomy payload.

Calls the async server functions directly via the shared event loop (see
_test_loop.py's docstring), same pattern as test_shop_manager_polish.py.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_SHOP_APPEARANCE"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


# ---------------------------------------------------------------------------
# shop_page settings backfill
# ---------------------------------------------------------------------------

def test_get_settings_backfills_full_shop_page_block_when_entirely_missing():
    run(server.db.settings.update_one({"id": "global"}, {"$unset": {"shop_page": ""}}, upsert=True))
    settings = run(server.get_settings())
    sp = settings["shop_page"]
    assert sp["title"] == "Shop"
    assert sp["landing_mode"] == "section_cards"
    assert set(sp["sections"].keys()) == {"merch", "prepaid_visits", "training"}
    assert sp["sections"]["merch"]["label"] == "Merch & Gear"
    assert sp["public_shop_enabled"] is False
    assert sp["allow_guest_merch_checkout"] is False


def test_get_settings_backfills_only_the_missing_section_without_clobbering_a_saved_override():
    run(server.db.settings.update_one({"id": "global"}, {"$set": {
        "shop_page": {
            "title": "Custom Title",
            "sections": {
                "merch": {"label": "Custom Merch Label", "description": "", "image_id": None, "visible": True, "order": 0},
                # prepaid_visits and training deliberately omitted
            },
        },
    }}, upsert=True))
    settings = run(server.get_settings())
    sp = settings["shop_page"]
    assert sp["title"] == "Custom Title"  # untouched
    assert sp["sections"]["merch"]["label"] == "Custom Merch Label"  # untouched — never clobbered
    assert sp["sections"]["prepaid_visits"]["label"] == "Prepaid Visits"  # backfilled
    assert sp["sections"]["training"]["label"] == "Training"  # backfilled


# ---------------------------------------------------------------------------
# _public_purchase_state
# ---------------------------------------------------------------------------

def test_public_purchase_state_credit_pack_and_program_always_account_required():
    for kind in ("credit_pack", "training_program"):
        state = server._public_purchase_state(kind, {"guest_cart_allowed": True})
        assert state["account_required"] is True
        assert state["guest_cart_allowed"] is False  # kind-based hard rule can't be overridden


def test_public_purchase_state_product_guest_cart_allowed_when_flag_set_and_no_requirements():
    state = server._public_purchase_state("product", {"guest_cart_allowed": True})
    assert state["account_required"] is False
    assert state["guest_cart_allowed"] is True


def test_public_purchase_state_requirement_flags_override_guest_cart_allowed():
    for flag in ("requires_dog", "requires_approval", "requires_completed_onboarding"):
        state = server._public_purchase_state("product", {"guest_cart_allowed": True, flag: True})
        assert state["account_required"] is True, f"{flag} should force account_required"
        assert state["guest_cart_allowed"] is False, f"{flag} should override guest_cart_allowed"


def test_public_purchase_state_price_hidden_disables_guest_cart_and_reports_show_public_price_false():
    # Item-level show_public_price False
    state = server._public_purchase_state("product", {"guest_cart_allowed": True, "show_public_price": False})
    assert state["show_public_price"] is False
    assert state["guest_cart_allowed"] is False
    # Global show_public_prices False (passed via kwarg)
    state2 = server._public_purchase_state("product", {"guest_cart_allowed": True}, global_show_public_prices=False)
    assert state2["show_public_price"] is False
    assert state2["guest_cart_allowed"] is False


def test_public_purchase_state_publicly_visible_defaults_true_when_field_missing():
    state = server._public_purchase_state("product", {})
    assert state["publicly_visible"] is True
    state2 = server._public_purchase_state("product", {"publicly_visible": False})
    assert state2["publicly_visible"] is False


# ---------------------------------------------------------------------------
# _validate_banner_cta_url
# ---------------------------------------------------------------------------

def test_validate_banner_cta_url_accepts_internal_path_and_https():
    server._validate_banner_cta_url("/shop")  # must not raise
    server._validate_banner_cta_url("https://example.com/promo")  # must not raise


def test_validate_banner_cta_url_rejects_unsafe_schemes():
    for bad in ("javascript:alert(1)", "http://example.com", "data:text/html,x", "//evil.example.com", "file:///etc/passwd"):
        try:
            server._validate_banner_cta_url(bad)
            assert False, f"expected rejection for {bad!r}"
        except HTTPException as e:
            assert e.status_code == 422


# ---------------------------------------------------------------------------
# Category CRUD round-trip for new fields
# ---------------------------------------------------------------------------

def test_category_new_fields_round_trip_through_create_update_and_taxonomy():
    user = _admin_user()
    body = server.ShopCategoryIn(
        name=f"{TAG} Category", description="desc", section="merch",
        mobile_image_id="mob-1", is_featured=True, hide_when_empty=False,
    )
    created = run(server.create_shop_category(body, user))
    try:
        assert created["mobile_image_id"] == "mob-1"
        assert created["is_featured"] is True
        assert created["hide_when_empty"] is False

        patch = server.ShopCategoryPatch(mobile_image_id="mob-2", is_featured=False, hide_when_empty=None)
        updated = run(server.update_shop_category(created["id"], patch, user))
        assert updated["mobile_image_id"] == "mob-2"
        assert updated["is_featured"] is False

        payload = run(server._shop_taxonomy_payload())
        row = next(c for c in payload["categories"] if c["id"] == created["id"])
        assert row["mobile_image_id"] == "mob-2"
        assert row["is_featured"] is False
    finally:
        run(server.db.shop_categories.delete_one({"id": created["id"]}))


# ---------------------------------------------------------------------------
# Category/subcategory image-clearing regression tests — covers the bug
# where update_shop_category/update_shop_subcategory treated a `null`
# image_id/mobile_image_id as "field omitted" (patch semantics) rather than
# "clear it", so the Remove Image control silently no-op'd on the DB while
# the frontend still deleted the underlying media doc, leaving a dangling
# reference. Fix: an explicit "" now clears to None; omitting the field
# (None) still means "leave unchanged".
# ---------------------------------------------------------------------------

def test_category_image_id_empty_string_clears_to_null():
    user = _admin_user()
    created = run(server.create_shop_category(server.ShopCategoryIn(
        name=f"{TAG} Clear Image", section="merch", image_id="img-1",
    ), user))
    try:
        assert created["image_id"] == "img-1"
        updated = run(server.update_shop_category(created["id"], server.ShopCategoryPatch(image_id=""), user))
        assert updated["image_id"] is None
        stored = run(server.db.shop_categories.find_one({"id": created["id"]}, {"_id": 0}))
        assert stored["image_id"] is None
    finally:
        run(server.db.shop_categories.delete_one({"id": created["id"]}))


def test_category_mobile_image_id_empty_string_clears_to_null():
    user = _admin_user()
    created = run(server.create_shop_category(server.ShopCategoryIn(
        name=f"{TAG} Clear Mobile Image", section="merch", mobile_image_id="mob-1",
    ), user))
    try:
        assert created["mobile_image_id"] == "mob-1"
        updated = run(server.update_shop_category(created["id"], server.ShopCategoryPatch(mobile_image_id=""), user))
        assert updated["mobile_image_id"] is None
        stored = run(server.db.shop_categories.find_one({"id": created["id"]}, {"_id": 0}))
        assert stored["mobile_image_id"] is None
    finally:
        run(server.db.shop_categories.delete_one({"id": created["id"]}))


def test_category_omitting_image_fields_preserves_existing_images():
    user = _admin_user()
    created = run(server.create_shop_category(server.ShopCategoryIn(
        name=f"{TAG} Preserve Images", section="merch", image_id="img-1", mobile_image_id="mob-1",
    ), user))
    try:
        # Patch some unrelated field, image fields entirely omitted (None).
        updated = run(server.update_shop_category(created["id"], server.ShopCategoryPatch(is_featured=True), user))
        assert updated["image_id"] == "img-1"
        assert updated["mobile_image_id"] == "mob-1"
        assert updated["is_featured"] is True
    finally:
        run(server.db.shop_categories.delete_one({"id": created["id"]}))


def test_category_clearing_one_image_does_not_clear_the_other():
    user = _admin_user()
    created = run(server.create_shop_category(server.ShopCategoryIn(
        name=f"{TAG} Clear One Only", section="merch", image_id="img-1", mobile_image_id="mob-1",
    ), user))
    try:
        updated = run(server.update_shop_category(created["id"], server.ShopCategoryPatch(image_id=""), user))
        assert updated["image_id"] is None
        assert updated["mobile_image_id"] == "mob-1"  # untouched

        created2 = run(server.update_shop_category(created["id"], server.ShopCategoryPatch(mobile_image_id="", image_id="img-2"), user))
        assert created2["mobile_image_id"] is None
        assert created2["image_id"] == "img-2"
    finally:
        run(server.db.shop_categories.delete_one({"id": created["id"]}))


def test_subcategory_image_id_empty_string_clears_to_null():
    user = _admin_user()
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=f"{TAG} Sub Parent", section="merch"), user))
    try:
        sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(
            category_id=cat["id"], name=f"{TAG} Sub", image_id="img-1",
        ), user))
        assert sub["image_id"] == "img-1"
        updated = run(server.update_shop_subcategory(sub["id"], server.ShopSubcategoryPatch(image_id=""), user))
        assert updated["image_id"] is None
        stored = run(server.db.shop_subcategories.find_one({"id": sub["id"]}, {"_id": 0}))
        assert stored["image_id"] is None
    finally:
        run(server.db.shop_subcategories.delete_many({"category_id": cat["id"]}))
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))


def test_subcategory_mobile_image_id_empty_string_clears_to_null():
    user = _admin_user()
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=f"{TAG} Sub Parent Mobile", section="merch"), user))
    try:
        sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(
            category_id=cat["id"], name=f"{TAG} Sub Mobile", mobile_image_id="mob-1",
        ), user))
        assert sub["mobile_image_id"] == "mob-1"
        updated = run(server.update_shop_subcategory(sub["id"], server.ShopSubcategoryPatch(mobile_image_id=""), user))
        assert updated["mobile_image_id"] is None
        stored = run(server.db.shop_subcategories.find_one({"id": sub["id"]}, {"_id": 0}))
        assert stored["mobile_image_id"] is None
    finally:
        run(server.db.shop_subcategories.delete_many({"category_id": cat["id"]}))
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))


def test_subcategory_omitting_image_fields_preserves_existing_images_and_clearing_one_preserves_other():
    user = _admin_user()
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=f"{TAG} Sub Parent Both", section="merch"), user))
    try:
        sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(
            category_id=cat["id"], name=f"{TAG} Sub Both", image_id="img-1", mobile_image_id="mob-1",
        ), user))
        # Omitting both image fields (unrelated patch) preserves both.
        updated = run(server.update_shop_subcategory(sub["id"], server.ShopSubcategoryPatch(active=True), user))
        assert updated["image_id"] == "img-1"
        assert updated["mobile_image_id"] == "mob-1"

        # Clearing only image_id leaves mobile_image_id untouched.
        updated2 = run(server.update_shop_subcategory(sub["id"], server.ShopSubcategoryPatch(image_id=""), user))
        assert updated2["image_id"] is None
        assert updated2["mobile_image_id"] == "mob-1"
    finally:
        run(server.db.shop_subcategories.delete_many({"category_id": cat["id"]}))
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))


# ---------------------------------------------------------------------------
# DELETE /shop/media last-line-of-defense: must refuse to delete media still
# referenced by a category or subcategory's image_id/mobile_image_id, not
# just product/pack/program image_id — closing the gap that let the
# frontend's already-correct clear-then-delete sequencing be bypassed by any
# direct call to delete_shop_media while a category/subcategory still
# pointed at that media_id.
# ---------------------------------------------------------------------------

def test_delete_shop_media_refuses_when_referenced_by_category_image_or_mobile_image():
    user = _admin_user()
    media_a = str(uuid.uuid4())
    media_b = str(uuid.uuid4())
    run(server.db.shop_media.insert_one({"id": media_a, "mime": "image/png", "data": "x", "filename": "a.png", "size_bytes": 1, "uploaded_at": "now", "uploaded_by": user["id"]}))
    run(server.db.shop_media.insert_one({"id": media_b, "mime": "image/png", "data": "x", "filename": "b.png", "size_bytes": 1, "uploaded_at": "now", "uploaded_by": user["id"]}))
    cat = run(server.create_shop_category(server.ShopCategoryIn(
        name=f"{TAG} Media Guard", section="merch", image_id=media_a, mobile_image_id=media_b,
    ), user))
    try:
        try:
            run(server.delete_shop_media(media_a, user))
            assert False, "expected refusal while referenced as image_id"
        except HTTPException as e:
            assert e.status_code == 409

        try:
            run(server.delete_shop_media(media_b, user))
            assert False, "expected refusal while referenced as mobile_image_id"
        except HTTPException as e:
            assert e.status_code == 409

        # Clear the references, then deletion succeeds.
        run(server.update_shop_category(cat["id"], server.ShopCategoryPatch(image_id="", mobile_image_id=""), user))
        result_a = run(server.delete_shop_media(media_a, user))
        result_b = run(server.delete_shop_media(media_b, user))
        assert result_a["deleted"] == 1
        assert result_b["deleted"] == 1
    finally:
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))
        run(server.db.shop_media.delete_many({"id": {"$in": [media_a, media_b]}}))


def test_delete_shop_media_refuses_when_referenced_by_subcategory_image_or_mobile_image():
    user = _admin_user()
    media_a = str(uuid.uuid4())
    media_b = str(uuid.uuid4())
    run(server.db.shop_media.insert_one({"id": media_a, "mime": "image/png", "data": "x", "filename": "a.png", "size_bytes": 1, "uploaded_at": "now", "uploaded_by": user["id"]}))
    run(server.db.shop_media.insert_one({"id": media_b, "mime": "image/png", "data": "x", "filename": "b.png", "size_bytes": 1, "uploaded_at": "now", "uploaded_by": user["id"]}))
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=f"{TAG} Sub Media Guard Parent", section="merch"), user))
    try:
        sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(
            category_id=cat["id"], name=f"{TAG} Sub Media Guard", image_id=media_a, mobile_image_id=media_b,
        ), user))
        try:
            run(server.delete_shop_media(media_a, user))
            assert False, "expected refusal while referenced as subcategory image_id"
        except HTTPException as e:
            assert e.status_code == 409

        try:
            run(server.delete_shop_media(media_b, user))
            assert False, "expected refusal while referenced as subcategory mobile_image_id"
        except HTTPException as e:
            assert e.status_code == 409

        run(server.update_shop_subcategory(sub["id"], server.ShopSubcategoryPatch(image_id="", mobile_image_id=""), user))
        result_a = run(server.delete_shop_media(media_a, user))
        result_b = run(server.delete_shop_media(media_b, user))
        assert result_a["deleted"] == 1
        assert result_b["deleted"] == 1
    finally:
        run(server.db.shop_subcategories.delete_many({"category_id": cat["id"]}))
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))
        run(server.db.shop_media.delete_many({"id": {"$in": [media_a, media_b]}}))
