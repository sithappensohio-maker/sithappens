"""Uploaded artwork reaches every renderer: the Portal trophy ladder
projection carries the upload, the thermal receipt payload carries a
server-rasterised logo, the birthday email carries the branded birthday
graphic, and the dog timeline counts the profile photo.
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


def test_birthday_email_always_carries_the_branded_hero_image():
    """The birthday card's image is the fixed branded graphic, not a per-dog
    photo — shown the same way whether or not the dog has one, and full
    width/auto height (never object-fit) so Outlook's Word renderer, which
    ignores object-fit, doesn't crop or distort it. It travels via
    body_html, not intro — see the next test for why that matters."""
    captured = {}

    async def capture(*, body_html, **kw):
        captured["body_html"] = body_html
        return True

    orig_dispatch = email_service._dispatch
    orig_url = email_service.APP_PUBLIC_URL
    email_service._dispatch = capture
    email_service.APP_PUBLIC_URL = "https://sithappens.example"
    try:
        client = {"name": "Jamie Owner", "email": "jamie@example.com"}
        with_photo = {"name": "Fido", "breed": "Beagle", "photos": ["https://example.com/fido.jpg"]}
        without_photo = {"name": "Rex", "breed": ""}
        run(email_service.notify_client_dog_birthday(client, with_photo))
        body_with_photo = captured["body_html"]
        run(email_service.notify_client_dog_birthday(client, without_photo))
        body_without_photo = captured["body_html"]
    finally:
        email_service._dispatch = orig_dispatch
        email_service.APP_PUBLIC_URL = orig_url

    hero_src = f"https://sithappens.example{email_service.BIRTHDAY_CARD_IMAGE_PATH}"
    assert hero_src in body_with_photo
    assert hero_src in body_without_photo
    assert "https://example.com/fido.jpg" not in body_with_photo  # never the dog's own photo
    assert "object-fit" not in body_with_photo  # no CSS crop Outlook would ignore


def test_birthday_email_skips_the_image_without_a_configured_public_url():
    """A relative src means nothing inside an email client — no page origin
    to resolve against — so an unconfigured APP_PUBLIC_URL must degrade to
    no image, never a broken icon in every birthday card sent."""
    captured = {}

    async def capture(*, body_html, **kw):
        captured["body_html"] = body_html
        return True

    orig_dispatch = email_service._dispatch
    orig_url = email_service.APP_PUBLIC_URL
    email_service._dispatch = capture
    email_service.APP_PUBLIC_URL = ""
    try:
        run(email_service.notify_client_dog_birthday(
            {"name": "Jamie Owner", "email": "jamie@example.com"}, {"name": "Fido", "breed": "Beagle"}))
    finally:
        email_service._dispatch = orig_dispatch
        email_service.APP_PUBLIC_URL = orig_url
    assert "<img" not in captured["body_html"]


def test_birthday_image_survives_an_admin_customized_intro():
    """Regression guard: _render() lets an admin override intro_html (and the
    registry itself ships its own default_intro_html, which already differs
    from notify_client_dog_birthday's own fallback_intro — see
    email_templates_registry.py) — so a birthday-card image placed in
    fallback_intro would silently vanish from every real send the moment
    either of those took priority. body_html is the one slot _render never
    swaps out, so it has to still be there through the FULL render pipeline,
    not just in what notify_client_dog_birthday hands to _dispatch."""
    email_service.APP_PUBLIC_URL = "https://sithappens.example"
    try:
        _, html_with_registry_default = run(email_service._render(
            slug="client_dog_birthday",
            ctx={"first_name": "Jamie", "client_name": "Jamie Owner", "dog_name": "Fido", "age": "3"},
            rows=[("Birthday Pup", "Fido · Beagle"), ("From", "The Sit Happens crew 🐾")],
            body_html=(
                f'<div style="margin:4px 0 20px 0;">'
                f'<img src="https://sithappens.example{email_service.BIRTHDAY_CARD_IMAGE_PATH}" alt="Happy Birthday, Fido!" '
                f'style="display:block;width:100%;height:auto;border-radius:10px;" />'
                f"</div>"
            ),
            fallback_title="unused", fallback_intro="unused — the registry default wins over this",
            fallback_subject="unused",
        ))
    finally:
        email_service.APP_PUBLIC_URL = ""
    # The registry's own copy (not notify_client_dog_birthday's fallback_intro) won.
    assert "Wishing Fido the happiest birthday" in html_with_registry_default
    assert "unused" not in html_with_registry_default
    # ...and the image still made it through anyway, via body_html.
    assert f"https://sithappens.example{email_service.BIRTHDAY_CARD_IMAGE_PATH}" in html_with_registry_default


def test_timeline_counts_profile_photo():
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": "nobody", "photo": TINY_PNG, "photos": []}))
    try:
        events = run(server.dog_timeline(did, 80, _admin_user()))
        photo = [e for e in events if e["kind"] == "photos_added"]
        assert photo and photo[0]["count"] == 1
    finally:
        run(server.db.dogs.delete_one({"id": did}))
