"""The Shop image pipeline: derivatives, delivery, galleries, compatibility.

The defect this replaces, measured on a 3000x2000 product photo before any
of this existed:

    original JPEG on disk          2,455,378 bytes
    the same image as base64       3,273,863 bytes   (+33%)
    GET /shop/media/{id} response  3,273,959 bytes

3.12 MB was what a 44-pixel list thumbnail downloaded, and none of it could
be cached as an image because it arrived inside JSON.

Disposable tag TEST_IMG.
"""
import base64
import io as _io
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from PIL import Image
from _test_loop import run

from domains.shop import media as shop_media

TAG = "TEST_IMG"
ADMIN = {"id": "img-admin", "name": "Img QA", "email": "img@test", "role": "admin"}


def _photo(w=1200, h=800, mode="RGB", fmt="JPEG"):
    """A real encoded image, not a coloured rectangle — a flat fill
    compresses to almost nothing and would make every size look identical."""
    import random
    random.seed(11)
    im = Image.new(mode, (w, h))
    px = im.load()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            v = ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256)
            c = v + ((255,) if mode == "RGBA" else ())
            for dy in range(2):
                for dx in range(2):
                    if x + dx < w and y + dy < h:
                        px[x + dx, y + dy] = c
    buf = _io.BytesIO()
    im.save(buf, fmt)
    return buf.getvalue()


def _data_url(blob, mime="image/jpeg"):
    return f"data:{mime};base64," + base64.b64encode(blob).decode()


def _store(blob=None, mime="image/jpeg", derivatives=True):
    """Put an image in the database the way an upload would — or, with
    derivatives=False, the way one looked BEFORE this pipeline existed."""
    blob = blob if blob is not None else _photo()
    mid = f"{TAG}-{uuid.uuid4()}"
    doc = {"id": mid, "mime": mime, "data": _data_url(blob, mime),
           "filename": "p.jpg", "size_bytes": len(blob)}
    if derivatives:
        doc["derivatives"] = shop_media.build_derivatives(blob)
    run(server.db.shop_media.insert_one(doc))
    return mid, blob


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.shop_media.delete_many({"id": {"$regex": f"^{TAG}"}}))
    run(server.db.pos_products.delete_many({"name": {"$regex": TAG}}))


# ─────────────────────────────────────────────────────────── derivatives

def test_every_named_size_is_produced():
    out = shop_media.build_derivatives(_photo())
    assert set(out) == {"thumb", "card", "pdp", "zoom"}
    for name, box in shop_media.SIZES.items():
        assert max(out[name]["w"], out[name]["h"]) <= box


def test_a_card_derivative_is_a_fraction_of_the_original():
    # The whole point. If this ever stops holding, the pipeline is decorative.
    blob = _photo(3000, 2000)
    out = shop_media.build_derivatives(blob)
    assert out["card"]["bytes"] < len(blob) * 0.05, (
        f"card is {out['card']['bytes']} of {len(blob)} — no real saving")
    assert out["thumb"]["bytes"] < out["card"]["bytes"] < out["pdp"]["bytes"] < out["zoom"]["bytes"]


def test_a_small_image_is_never_blown_up():
    # Upscaling a 100px logo to 1600px wastes bytes and looks worse.
    out = shop_media.build_derivatives(_photo(100, 60))
    for name in shop_media.SIZES:
        assert out[name]["w"] <= 100 and out[name]["h"] <= 60


def test_aspect_ratio_is_preserved_so_nothing_is_squashed():
    out = shop_media.build_derivatives(_photo(1200, 400))
    for name in shop_media.SIZES:
        ratio = out[name]["w"] / out[name]["h"]
        assert abs(ratio - 3.0) < 0.05, f"{name} is distorted ({ratio:.2f})"


def test_derivatives_are_webp_and_content_addressed():
    out = shop_media.build_derivatives(_photo())
    for name, d in out.items():
        assert d["mime"] == "image/webp"
        assert len(d["etag"]) == 32
    # different sizes are different bytes, so different etags
    assert len({d["etag"] for d in out.values()}) == 4


def test_the_same_image_always_produces_the_same_etag():
    blob = _photo()
    assert (shop_media.build_derivatives(blob)["card"]["etag"]
            == shop_media.build_derivatives(blob)["card"]["etag"])


def test_a_png_with_transparency_survives():
    out = shop_media.build_derivatives(_photo(600, 400, mode="RGBA", fmt="PNG"))
    assert out["card"]["bytes"] > 0


def test_portrait_orientation_is_honoured():
    # Phones record rotation in EXIF instead of rotating pixels; without
    # exif_transpose a portrait photo is served on its side.
    im = Image.open(_io.BytesIO(_photo(800, 400)))
    buf = _io.BytesIO()
    exif = im.getexif()
    exif[274] = 6                     # "rotate 90 CW"
    im.save(buf, "JPEG", exif=exif)
    out = shop_media.build_derivatives(buf.getvalue())
    assert out["card"]["h"] > out["card"]["w"], "EXIF orientation was ignored"


# ──────────────────────────────────────────────────────────── validation

def test_a_file_that_only_claims_to_be_an_image_is_refused():
    # The declared mime is not evidence. This is what stops a renamed script
    # being stored and later served.
    fake = _data_url(b"#!/bin/sh\necho not an image\n", "image/jpeg")
    with pytest.raises(HTTPException) as e:
        shop_media.decode_data_url(fake)  # decodes fine...
        shop_media.build_derivatives(b"#!/bin/sh\n")
    assert e.value.status_code == 400


def test_an_unreadable_image_is_refused_with_a_clear_message():
    with pytest.raises(HTTPException) as e:
        shop_media.build_derivatives(b"\xff\xd8\xff\xe0 not really a jpeg")
    assert e.value.status_code == 400
    assert "not a readable image" in str(e.value.detail)


def test_an_unsupported_type_is_refused():
    with pytest.raises(HTTPException) as e:
        shop_media.decode_data_url(_data_url(b"x", "image/gif"))
    assert e.value.status_code == 400
    assert "gif" in str(e.value.detail).lower()


def test_something_that_is_not_a_data_url_at_all_is_refused():
    for bad in ("", "https://example.com/x.jpg", "data:", "notadataurl"):
        with pytest.raises(HTTPException):
            shop_media.decode_data_url(bad)


def test_an_oversized_image_is_refused_on_real_decoded_bytes():
    # Measured from the DECODED bytes, never from a client-supplied number.
    big = b"\x00" * (shop_media.MAX_BYTES + 10)
    with pytest.raises(HTTPException) as e:
        shop_media.decode_data_url(_data_url(big))
    assert e.value.status_code == 400
    assert "too large" in str(e.value.detail).lower()


def test_a_decompression_bomb_is_refused_before_it_is_allocated():
    # A tiny file can describe an enormous canvas.
    im = Image.new("RGB", (9000, 9000))
    buf = _io.BytesIO()
    im.save(buf, "PNG")
    if len(buf.getvalue()) < shop_media.MAX_BYTES:
        with pytest.raises(HTTPException) as e:
            shop_media.build_derivatives(buf.getvalue())
        assert "too large" in str(e.value.detail).lower()


# ──────────────────────────────────────────────── legacy compatibility

def test_a_legacy_image_gains_derivatives_on_first_use():
    # Nothing is migrated by hand and nothing is re-uploaded: the first
    # request builds the set from the archived base64 and saves it.
    mid, _blob = _store(derivatives=False)
    assert "derivatives" not in run(server.db.shop_media.find_one({"id": mid}))
    d = run(shop_media.derivative(mid, "card"))
    assert d and d["mime"] == "image/webp"
    saved = run(server.db.shop_media.find_one({"id": mid}))
    assert sorted(saved["derivatives"]) == ["card", "pdp", "thumb", "zoom"]


def test_a_legacy_image_keeps_its_original_bytes():
    # `data` stays the archival original, so the old JSON endpoints and any
    # future reprocessing still have something to work from.
    mid, _ = _store(derivatives=False)
    run(shop_media.derivative(mid, "thumb"))
    assert run(server.db.shop_media.find_one({"id": mid}))["data"].startswith("data:image/")


def test_converting_a_legacy_image_happens_once_not_per_request():
    mid, _ = _store(derivatives=False)
    run(shop_media.derivative(mid, "card"))
    first = run(server.db.shop_media.find_one({"id": mid}))["derivatives_built_at"]
    run(shop_media.derivative(mid, "pdp"))
    assert run(server.db.shop_media.find_one({"id": mid}))["derivatives_built_at"] == first


def test_an_undecodable_legacy_row_does_not_take_the_page_down():
    mid = f"{TAG}-{uuid.uuid4()}"
    run(server.db.shop_media.insert_one({"id": mid, "mime": "image/jpeg",
                                         "data": "data:image/jpeg;base64,####"}))
    assert run(shop_media.derivative(mid, "card")) is None


def test_a_missing_image_is_none_rather_than_an_error():
    assert run(shop_media.derivative("nope-" + str(uuid.uuid4()), "card")) is None


def test_an_unknown_size_is_refused_rather_than_guessed():
    mid, _ = _store()
    with pytest.raises(HTTPException) as e:
        run(shop_media.derivative(mid, "../../etc/passwd"))
    assert e.value.status_code == 404


# ──────────────────────────────────────────────────────────── galleries

def test_a_legacy_one_image_product_reads_as_a_one_image_gallery():
    # The compatibility promise: no migration, no manual recreation.
    assert shop_media.gallery_ids({"image_id": "abc"}) == ["abc"]
    assert shop_media.primary_image_id({"image_id": "abc"}) == "abc"


def test_a_product_with_no_image_is_an_empty_gallery():
    assert shop_media.gallery_ids({}) == []
    assert shop_media.gallery_ids({"image_id": None}) == []
    assert shop_media.primary_image_id({}) is None


def test_a_gallery_keeps_the_order_the_admin_chose():
    doc = {"image_ids": ["c", "a", "b"], "image_id": "c"}
    assert shop_media.gallery_ids(doc) == ["c", "a", "b"]
    assert shop_media.primary_image_id(doc) == "c"


def test_the_gallery_wins_over_a_stale_primary_field():
    assert shop_media.gallery_ids({"image_ids": ["x"], "image_id": "old"}) == ["x"]


def test_the_same_image_twice_is_stored_once():
    assert shop_media.normalize_gallery(["a", "b", "a"]) == ["a", "b"]


def test_an_empty_gallery_falls_back_to_the_single_image():
    assert shop_media.normalize_gallery([], "solo") == ["solo"]
    assert shop_media.normalize_gallery(None, "solo") == ["solo"]


def test_blank_entries_never_reach_storage():
    assert shop_media.normalize_gallery(["", "  ", "a", None]) == ["a"]


def test_saving_a_gallery_keeps_the_primary_field_in_step():
    # Everything still reading image_id — Shop Manager tables, the register
    # grid, an old receipt — must see the first gallery image.
    fields = server._product_image_fields(
        type("B", (), {"image_ids": ["g1", "g2"], "image_id": "stale"})())
    assert fields["image_ids"] == ["g1", "g2"]
    assert fields["image_id"] == "g1"


def test_saving_only_a_single_image_still_produces_a_gallery():
    fields = server._product_image_fields(
        type("B", (), {"image_ids": None, "image_id": "solo"})())
    assert fields == {"image_ids": ["solo"], "image_id": "solo"}


def test_saving_no_image_clears_both_fields():
    fields = server._product_image_fields(
        type("B", (), {"image_ids": [], "image_id": None})())
    assert fields == {"image_ids": [], "image_id": None}


# ───────────────────────────────────────────────── deletion protection

def test_an_image_used_only_in_a_gallery_cannot_be_deleted():
    # Without this an admin could delete a picture still on a product,
    # because only the primary field was ever checked.
    mid, _ = _store()
    run(server.db.pos_products.insert_one({
        "id": str(uuid.uuid4()), "name": f"{TAG} galleried", "price": 1.0,
        "image_id": "something-else", "image_ids": ["something-else", mid]}))
    assert run(server._shop_media_referenced_by(mid)) == "a product gallery"


def test_an_unreferenced_image_is_deletable():
    mid, _ = _store()
    assert run(server._shop_media_referenced_by(mid)) is None


# ────────────────────────────── public authorization covers the gallery

def _public_product(image_ids):
    run(server.db.settings.update_one(
        {"id": "global"},
        {"$set": {"shop_page.public_shop_enabled": True,
                  "shop_page.public_browsing_enabled": True}}, upsert=True))
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} public", "price": 10.0, "active": True,
        "archived": False, "show_online": True, "publicly_visible": True,
        "image_id": image_ids[0], "image_ids": image_ids,
        "category_id": None, "subcategory_id": None}))
    return pid


def test_every_photo_on_a_public_product_is_publicly_readable():
    """Checking only image_id meant every picture after the first 404'd on
    the public storefront: the product page showed one image and two broken
    thumbnails. Found in the browser, not by a test — hence this one."""
    ids = [_store()[0] for _ in range(3)]
    _public_product(ids)
    for i, mid in enumerate(ids):
        assert run(server._is_public_shop_media(mid)) is True, f"image {i + 1} was not public"


def test_an_image_on_a_hidden_product_stays_hidden():
    ids = [_store()[0] for _ in range(2)]
    pid = _public_product(ids)
    run(server.db.pos_products.update_one({"id": pid}, {"$set": {"publicly_visible": False}}))
    for mid in ids:
        assert run(server._is_public_shop_media(mid)) is False


def test_an_image_on_no_product_is_not_public():
    mid, _ = _store()
    assert run(server._is_public_shop_media(mid)) is False


# ───────────────── what the fast image route will serve without a session
# The rule is PUBLIC VISIBILITY, not mere existence. "Referenced by
# anything" was the earlier, wrong rule: it handed out an account-only
# product's photography to anyone who knew the id.

def _product(**kw):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} p", "price": 10.0,
           "active": True, "archived": False, "show_online": True,
           "publicly_visible": True}
    doc.update(kw)
    run(server.db.pos_products.insert_one(doc))
    return doc


def test_a_public_products_photo_is_servable_without_a_session():
    mid, _ = _store()
    _product(image_id=mid, image_ids=[mid])
    assert run(shop_media.is_catalog_public_image(mid)) is True


def test_every_photo_in_a_public_gallery_is_servable():
    ids = [_store()[0] for _ in range(3)]
    _product(image_id=ids[0], image_ids=ids)
    for i, mid in enumerate(ids):
        assert run(shop_media.is_catalog_public_image(mid)) is True, f"image {i + 1}"


def test_an_account_only_products_photo_is_NOT_servable():
    # THE hardening. This returned True under the old "is it referenced"
    # rule, so a private product's photography was public to anyone with
    # the id.
    mid, _ = _store()
    _product(image_id=mid, image_ids=[mid], publicly_visible=False)
    assert run(shop_media.is_catalog_public_image(mid)) is False


def test_an_unpublished_products_photo_is_NOT_servable():
    for hidden in ({"show_online": False}, {"active": False}, {"archived": True}):
        mid, _ = _store()
        _product(image_id=mid, image_ids=[mid], **hidden)
        assert run(shop_media.is_catalog_public_image(mid)) is False, hidden


def test_an_orphan_image_is_NOT_servable():
    mid, _ = _store()
    assert run(shop_media.is_catalog_public_image(mid)) is False


def test_a_photo_on_BOTH_a_public_and_a_private_product_stays_servable():
    # One public home is enough — the picture is already on the open shelf.
    mid, _ = _store()
    _product(image_id=mid, image_ids=[mid], publicly_visible=False)
    _product(image_id=mid, image_ids=[mid], publicly_visible=True)
    assert run(shop_media.is_catalog_public_image(mid)) is True


def test_storefront_chrome_is_public_by_nature():
    mid, _ = _store()
    cid = str(uuid.uuid4())
    run(server.db.shop_categories.insert_one(
        {"id": cid, "name": f"{TAG} cat", "image_id": mid, "active": True}))
    try:
        assert run(shop_media.is_catalog_public_image(mid)) is True
    finally:
        run(server.db.shop_categories.delete_many({"id": cid}))


def test_turning_the_public_storefront_off_does_not_blank_the_signed_in_shop():
    # Whether guests may browse is a merchandising decision. Tying image
    # delivery to it would break every picture in the client Shop the
    # moment somebody switched the public site off.
    prev = run(server.get_settings()).get("shop_page") or {}
    mid, _ = _store()
    _product(image_id=mid, image_ids=[mid])
    run(server.db.settings.update_one(
        {"id": "global"}, {"$set": {"shop_page.public_shop_enabled": False}}, upsert=True))
    try:
        assert run(shop_media.is_catalog_public_image(mid)) is True
        assert run(server._is_public_shop_media(mid)) is False   # guest route still closed
    finally:
        run(server.db.settings.update_one(
            {"id": "global"}, {"$set": {"shop_page": prev}}, upsert=True))
