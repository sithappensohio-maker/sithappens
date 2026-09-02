"""Uploaded artwork reaches every renderer: the Portal trophy ladder
projection carries the upload, the thermal receipt payload carries a
server-rasterised logo, the birthday email falls back to the profile photo,
and the dog timeline counts the profile photo.
"""
import base64
import contextlib
import io
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
import email_service
from _test_loop import run
from PIL import Image

TAG = "TEST_RENDER_ART"
TINY_PNG = ("data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pgi9HgAAAABJRU5ErkJggg==")


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _png(w, h, color=(0, 0, 0, 255)):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for x in range(w):
        for y in range(h):
            if x < w // 2:
                im.putpixel((x, y), color)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_incentives_projection_carries_uploaded_artwork():
    code = f"test_art_{uuid.uuid4().hex[:6]}"
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Client", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    run(server.db.trophies.insert_one({"id": str(uuid.uuid4()), "code": code, "name": "Art", "category": "client", "tier": "gold",
                                       "icon": "fa-star", "trigger_type": "auto", "trigger_kind": "homework_completed", "threshold": 5,
                                       "active": True, "custom_image": TINY_PNG, "image_fit": "contain", "image_offset_x": 20, "image_offset_y": 80}))
    try:
        out = run(server.portal_incentives({"id": "u", "role": "client", "client_id": c["id"], "name": c["name"]}))
        rows = [t for group in out.values() if isinstance(group, list) for t in group if isinstance(t, dict) and t.get("code") == code]
        assert rows, f"trophy missing from incentives payload keys={list(out.keys())}"
        t = rows[0]
        assert t["custom_image"] == TINY_PNG and t["image_fit"] == "contain" and t["image_offset_x"] == 20 and t["image_offset_y"] == 80
    finally:
        run(server.db.trophies.delete_one({"code": code}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def test_logo_rasterizes_to_escpos_rows_and_attaches_to_pos_payload():
    raster = server._rasterize_logo_for_thermal(_png(1000, 100))
    assert raster["width_dots"] == server.RECEIPT_LOGO_MAX_DOTS and raster["row_bytes"] == 48
    assert raster["height"] == 38
    data = base64.b64decode(raster["data_b64"])
    assert len(data) == raster["row_bytes"] * raster["height"]
    # Left half black → first row starts with 0xFF bytes, ends with 0x00.
    assert data[0] == 0xFF and data[raster["row_bytes"] - 1] == 0x00
    assert server._rasterize_logo_for_thermal("data:image/png;base64,not-an-image") is None

    media_id = str(uuid.uuid4())
    run(server.db.shop_media.insert_one({"id": media_id, "mime": "image/png", "data": _png(64, 16), "filename": "logo.png"}))
    try:
        server._LOGO_RASTER_CACHE.pop(media_id, None)
        payload = run(server._attach_receipt_logo_raster({"business_logo_image_id": media_id, "business_name": "X"}))
        assert payload["business_logo_raster"]["width_dots"] == 64 and payload["business_logo_raster"]["row_bytes"] == 8
        assert run(server._attach_receipt_logo_raster({"business_logo_image_id": None})).get("business_logo_raster") is None
        assert run(server._attach_receipt_logo_raster({"business_logo_image_id": "missing-id"})).get("business_logo_raster") is None
    finally:
        run(server.db.shop_media.delete_one({"id": media_id}))
        server._LOGO_RASTER_CACHE.pop(media_id, None)


def test_birthday_hero_falls_back_to_profile_photo():
    assert email_service._dog_hero_photo({"photos": ["gallery"], "photo": "profile"}) == "gallery"
    assert email_service._dog_hero_photo({"photos": [], "photo": "profile"}) == "profile"
    assert email_service._dog_hero_photo({"photo": "profile"}) == "profile"
    assert email_service._dog_hero_photo({"photos": [None], "photo": None}) == ""


def test_timeline_counts_profile_photo():
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": "nobody", "photo": TINY_PNG, "photos": []}))
    try:
        events = run(server.dog_timeline(did, 80, _admin_user()))
        photo = [e for e in events if e["kind"] == "photos_added"]
        assert photo and photo[0]["count"] == 1
    finally:
        run(server.db.dogs.delete_one({"id": did}))
