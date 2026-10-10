"""Theme Studio Stage 1 (2026-10-10): the extended fields ThemePresetIn
grew on top of the original Theme Gallery (assets, enabled_targets,
scheduling, intensity, animation) and the new theme_assets upload/serve/
delete endpoints those assets live in.

Same disposable-DB convention as test_theme_presets.py: `import _test_env`
before `import server`, `httpx.ASGITransport`, the same `_mk_user`/`_call`
helper pair, and the `_clean_active_theme` fixture so no test leaks
`active_theme_id` into another.
"""
import datetime
import io
import json as _json
import uuid
import zipfile

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_THEME_STUDIO"

# 1x1 pixel, smallest valid real files — same bytes used in the live smoke
# test, chosen so Pillow (PNG) and the raw-bytes path (GIF) both accept them.
PNG_DATA_URL = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YA"
    "AAAASUVORK5CYII="
)
GIF_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="


def _mk_user(role, staff_role=None, client_id=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _call(method, path, user=None, json_body=None):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, json=json_body)
    return run(_go())


def _call_upload(method, path, user, files):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, files=files)
    return run(_go())


def _make_pack_zip(manifest, asset_files=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", _json.dumps(manifest))
        for fname, content in (asset_files or {}).items():
            zf.writestr(fname, content)
    return buf.getvalue()


def _cleanup(*, user_ids=(), theme_ids=(), asset_ids=()):
    if user_ids:
        run(server.db.users.delete_many({"id": {"$in": list(user_ids)}}))
    if theme_ids:
        run(server.db.theme_presets.delete_many({"id": {"$in": list(theme_ids)}}))
    if asset_ids:
        run(server.db.theme_assets.delete_many({"id": {"$in": list(asset_ids)}}))


@pytest.fixture(autouse=True)
def _clean_active_theme():
    """Snapshots and restores every field `activate_theme_preset` can write
    onto the shared global settings doc — active_theme_id AND the extended
    fields (assets/enabled_targets/dates/intensity/animation) this file's
    tests exercise. test_theme_presets.py's fixture only tracks
    active_theme_id because its tests only ever mirror color fields and
    restore those by hand (see its backward-compat test); this file mirrors
    assets/targets/scheduling instead, so the snapshot needs to cover those
    too or a later test inherits whatever an earlier activate() left behind."""
    keys = ("active_theme_id",) + server.THEME_EXTENDED_FIELD_KEYS
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, **{k: 1 for k in keys}})) or {}
    run(server.db.settings.update_one({"id": "global"}, {"$unset": {k: "" for k in keys}}, upsert=True))
    yield
    to_set = {k: prev[k] for k in keys if k in prev}
    to_unset = {k: "" for k in keys if k not in prev}
    update = {}
    if to_set:
        update["$set"] = to_set
    if to_unset:
        update["$unset"] = to_unset
    if update:
        run(server.db.settings.update_one({"id": "global"}, update))


# ───────────────────────────── extended preset fields ─────────────────────

def test_create_fills_extended_field_defaults():
    owner = _mk_user("admin")
    theme_id = None
    try:
        r = _call("POST", "/settings/themes", owner, {"name": "Extended Defaults"})
        assert r.status_code == 200, r.text
        body = r.json()
        theme_id = body["id"]
        assert body["assets"] == {k: None for k in server.THEME_ASSET_SLOTS}
        assert body["enabled_targets"] == {"client_portal": True, "staff_portal": True, "login": True}
        assert body["start_date"] is None
        assert body["end_date"] is None
        assert body["intensity"] == "standard"
        assert body["animation_enabled"] is True
        assert body["slug"] == "extended-defaults"
        assert body["version"] == "1.0"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_create_merges_a_partial_assets_dict_onto_full_defaults():
    owner = _mk_user("admin")
    theme_id = None
    try:
        r = _call("POST", "/settings/themes", owner, {
            "name": "Partial Assets", "assets": {"heroBackground": "fake-id-1"},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        theme_id = body["id"]
        assert body["assets"]["heroBackground"] == "fake-id-1"
        # Every other slot still defaults to None — a partial dict must not
        # drop the other eleven slots.
        others = {k: v for k, v in body["assets"].items() if k != "heroBackground"}
        assert all(v is None for v in others.values()), others
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_partial_merges_assets_without_wiping_other_slots():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Merge Me", "assets": {"heroBackground": "hero-1", "cornerSticker": "sticker-1"},
        }).json()
        theme_id = created["id"]

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {"assets": {"eventBanner": "banner-1"}})
        assert r.status_code == 200, r.text
        assets = r.json()["assets"]
        assert assets["heroBackground"] == "hero-1"
        assert assets["cornerSticker"] == "sticker-1"
        assert assets["eventBanner"] == "banner-1"

        # Setting a slot to None clears just that one slot.
        r2 = _call("PUT", f"/settings/themes/{theme_id}", owner, {"assets": {"heroBackground": None}})
        assert r2.status_code == 200, r2.text
        assets2 = r2.json()["assets"]
        assert assets2["heroBackground"] is None
        assert assets2["cornerSticker"] == "sticker-1"
        assert assets2["eventBanner"] == "banner-1"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_on_the_active_theme_takes_effect_on_branding_immediately():
    """activate_theme_preset only COPIES a preset's fields onto settings at
    the moment of activation — a snapshot, not a live join. Without this,
    saving an edit to the theme that's ALREADY active would silently not
    reach /branding until someone re-activated it, and Theme Studio doesn't
    even offer a re-activate button once a theme is already active."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Already Live", "brand_primary": "#111111", "assets": {"heroBackground": "hero-v1"},
        }).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        before = _call("GET", "/branding").json()
        assert before["brand_primary"] == "#111111"
        assert before["assets"]["heroBackground"] == "hero-v1"

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {
            "brand_primary": "#222222", "assets": {"heroBackground": "hero-v2"},
        })
        assert r.status_code == 200, r.text

        after = _call("GET", "/branding").json()
        assert after["brand_primary"] == "#222222"
        assert after["assets"]["heroBackground"] == "hero-v2"
        # The other eleven slots stay untouched by this same live mirror.
        assert after["assets"]["cornerSticker"] is None
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_on_a_non_active_theme_does_not_touch_branding():
    owner = _mk_user("admin")
    active_id = None
    other_id = None
    try:
        active = _call("POST", "/settings/themes", owner, {"name": "Stays Live", "brand_primary": "#333333"}).json()
        active_id = active["id"]
        act = _call("POST", f"/settings/themes/{active_id}/activate", owner)
        assert act.status_code == 200, act.text

        other = _call("POST", "/settings/themes", owner, {"name": "Not Live Yet", "brand_primary": "#444444"}).json()
        other_id = other["id"]

        r = _call("PUT", f"/settings/themes/{other_id}", owner, {"brand_primary": "#555555"})
        assert r.status_code == 200, r.text

        branding = _call("GET", "/branding").json()
        assert branding["brand_primary"] == "#333333"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[t for t in (active_id, other_id) if t])


def test_put_partial_merges_enabled_targets():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Target Merge"}).json()
        theme_id = created["id"]

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {"enabled_targets": {"login": False}})
        assert r.status_code == 200, r.text
        targets = r.json()["enabled_targets"]
        assert targets == {"client_portal": True, "staff_portal": True, "login": False}
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_can_explicitly_clear_a_scheduled_date():
    """Regression: `exclude_unset=True` tells apart "never sent" from "sent
    as null", but the patch comprehension used to throw every None value
    away regardless — so once a date was set there was no way to send it
    back to null again through this endpoint. Deployment Settings' date
    inputs do exactly that when an admin clears the field."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Clearable Dates", "start_date": "2026-10-01", "end_date": "2026-11-01",
        }).json()
        theme_id = created["id"]
        assert created["start_date"] == "2026-10-01"

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {"start_date": None})
        assert r.status_code == 200, r.text
        assert r.json()["start_date"] is None
        # The field this call didn't mention stays exactly as it was.
        assert r.json()["end_date"] == "2026-11-01"

        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert stored["start_date"] is None
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_does_not_let_a_stray_null_clear_the_name():
    """The opposite side of the same fix: null-clearing is only honored for
    the handful of fields where it's a real action (dates, extends_theme_id)
    — name/colors/etc. never legitimately get set to null through this
    endpoint, so a None there is still silently ignored rather than wiping
    the field."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Keep My Name", "brand_primary": "#112233"}).json()
        theme_id = created["id"]

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {"name": None, "brand_primary": None})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Keep My Name"
        assert r.json()["brand_primary"] == "#112233"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_activate_mirrors_extended_fields_onto_branding():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Full Activate", "assets": {"loginAccent": "accent-id"},
            "enabled_targets": {"staff_portal": False}, "start_date": "2026-10-01",
            "end_date": "2026-11-01", "intensity": "bold", "animation_enabled": False,
        }).json()
        theme_id = created["id"]

        r = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert r.status_code == 200, r.text

        branding = _call("GET", "/branding").json()
        assert branding["assets"]["loginAccent"] == "accent-id"
        assert branding["enabled_targets"] == {"client_portal": True, "staff_portal": False, "login": True}
        assert branding["start_date"] == "2026-10-01"
        assert branding["end_date"] == "2026-11-01"
        assert branding["theme_intensity"] == "bold"
        assert branding["theme_animation_enabled"] is False
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_theme_glow_color_is_independent_of_accent():
    """Stage 2's 4th quick-palette swatch — must round-trip separately from
    brand_accent, and default to the accent value for a preset that never
    set it (every preset saved before this field existed)."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        r = _call("POST", "/settings/themes", owner, {
            "name": "Glow Theme", "brand_accent": "#111111", "theme_glow_color": "#ff00ff",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        theme_id = body["id"]
        assert body["brand_accent"] == "#111111"
        assert body["theme_glow_color"] == "#ff00ff"

        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text
        branding = _call("GET", "/branding").json()
        assert branding["brand_accent"] == "#111111"
        assert branding["theme_glow_color"] == "#ff00ff"

        r2 = _call("POST", "/settings/themes", owner, {"name": "No Glow Set"})
        theme_id_2 = r2.json()["id"]
        try:
            assert r2.json()["theme_glow_color"] == "#00a9e0"
        finally:
            _cleanup(theme_ids=[theme_id_2])
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_branding_extended_defaults_when_no_theme_active():
    owner = _mk_user("admin")
    try:
        branding = _call("GET", "/branding").json()
        assert branding["assets"] == {k: None for k in server.THEME_ASSET_SLOTS}
        assert branding["enabled_targets"] == {"client_portal": True, "staff_portal": True, "login": True}
        assert branding["theme_intensity"] == "standard"
        assert branding["theme_animation_enabled"] is True
    finally:
        _cleanup(user_ids=[owner["id"]])


# ───────────────────────────── theme-assets endpoints ──────────────────────

def test_upload_still_image_builds_derivatives_and_serves_unauthenticated():
    owner = _mk_user("admin")
    asset_id = None
    try:
        r = _call("POST", "/theme-assets", owner,
                   {"data": PNG_DATA_URL, "filename": "sticker.png", "slot": "cornerSticker"})
        assert r.status_code == 200, r.text
        body = r.json()
        asset_id = body["asset_id"]
        assert body["slot"] == "cornerSticker"
        assert body["mime"] == "image/png"
        assert set(body["sizes"].keys()) == {"thumb", "card", "pdp", "zoom"}

        # Public — no Authorization header at all.
        g = _call("GET", f"/theme-assets/{asset_id}/thumb")
        assert g.status_code == 200, g.text
        assert g.headers["content-type"] == "image/webp"
        assert g.headers.get("cache-control", "").startswith("public")

        g404 = _call("GET", f"/theme-assets/{asset_id}/not-a-real-size")
        assert g404.status_code == 404
    finally:
        _cleanup(user_ids=[owner["id"]], asset_ids=[asset_id] if asset_id else ())


def test_upload_animation_slot_keeps_original_bytes_no_derivatives():
    owner = _mk_user("admin")
    asset_id = None
    try:
        r = _call("POST", "/theme-assets", owner,
                   {"data": GIF_DATA_URL, "filename": "wag.gif", "slot": "ambientAnimation"})
        assert r.status_code == 200, r.text
        body = r.json()
        asset_id = body["asset_id"]
        assert body["mime"] == "image/gif"
        assert body["sizes"] == {}

        g = _call("GET", f"/theme-assets/{asset_id}/original")
        assert g.status_code == 200, g.text
        assert g.headers["content-type"] == "image/gif"

        # Any size other than "original" 404s for an animation asset — there
        # are no resized derivatives to serve (resizing would drop frames).
        g2 = _call("GET", f"/theme-assets/{asset_id}/thumb")
        assert g2.status_code == 404
    finally:
        _cleanup(user_ids=[owner["id"]], asset_ids=[asset_id] if asset_id else ())


def test_animation_slot_rejects_a_non_gif_non_webp_upload():
    owner = _mk_user("admin")
    try:
        r = _call("POST", "/theme-assets", owner,
                   {"data": PNG_DATA_URL, "filename": "not-animated.png", "slot": "ambientAnimation"})
        assert r.status_code == 400, r.text
        assert "unsupported animation type" in r.text.lower()
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_still_image_slot_rejects_a_gif_upload():
    """The reverse of the animation test: a GIF handed to any OTHER slot is
    refused rather than silently flattened to a still frame — it must go
    through the ambientAnimation slot to keep its animation."""
    owner = _mk_user("admin")
    try:
        r = _call("POST", "/theme-assets", owner,
                   {"data": GIF_DATA_URL, "filename": "nope.gif", "slot": "cornerSticker"})
        assert r.status_code == 400, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_upload_rejects_an_unknown_slot_name():
    owner = _mk_user("admin")
    try:
        r = _call("POST", "/theme-assets", owner,
                   {"data": PNG_DATA_URL, "filename": "x.png", "slot": "notARealSlot"})
        assert r.status_code == 422, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_get_nonexistent_asset_is_404():
    g = _call("GET", "/theme-assets/does-not-exist/thumb")
    assert g.status_code == 404


def test_non_admin_gets_403_on_upload_and_delete_but_get_stays_public():
    employee = _mk_user("employee", "daycare_staff")
    owner = _mk_user("admin")
    asset_id = None
    try:
        r = _call("POST", "/theme-assets", employee,
                   {"data": PNG_DATA_URL, "filename": "x.png", "slot": "cornerSticker"})
        assert r.status_code == 403, r.text

        uploaded = _call("POST", "/theme-assets", owner,
                          {"data": PNG_DATA_URL, "filename": "x.png", "slot": "cornerSticker"}).json()
        asset_id = uploaded["asset_id"]

        assert _call("DELETE", f"/theme-assets/{asset_id}", employee).status_code == 403

        # GET needs no admin and no auth at all.
        g = _call("GET", f"/theme-assets/{asset_id}/thumb")
        assert g.status_code == 200, g.text
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]], asset_ids=[asset_id] if asset_id else ())


def test_delete_blocked_while_referenced_by_a_theme_then_succeeds_once_cleared():
    owner = _mk_user("admin")
    asset_id = None
    theme_id = None
    try:
        uploaded = _call("POST", "/theme-assets", owner,
                          {"data": PNG_DATA_URL, "filename": "x.png", "slot": "cornerSticker"}).json()
        asset_id = uploaded["asset_id"]

        theme = _call("POST", "/settings/themes", owner, {
            "name": "References The Asset", "assets": {"cornerSticker": asset_id},
        }).json()
        theme_id = theme["id"]

        r = _call("DELETE", f"/theme-assets/{asset_id}", owner)
        assert r.status_code == 400, r.text
        assert "references the asset" in r.text.lower() or "still used by" in r.text.lower()
        assert run(server.db.theme_assets.find_one({"id": asset_id})) is not None

        cleared = _call("PUT", f"/settings/themes/{theme_id}", owner, {"assets": {"cornerSticker": None}})
        assert cleared.status_code == 200, cleared.text

        r2 = _call("DELETE", f"/theme-assets/{asset_id}", owner)
        assert r2.status_code == 200, r2.text
        assert run(server.db.theme_assets.find_one({"id": asset_id})) is None
        asset_id = None
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (),
                 asset_ids=[asset_id] if asset_id else ())


def test_delete_nonexistent_asset_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("DELETE", "/theme-assets/does-not-exist", owner)
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


# ───────────────────────────── theme pack export/import ────────────────────

def test_export_contains_manifest_and_referenced_asset_files():
    owner = _mk_user("admin")
    theme_id = None
    asset_id = None
    try:
        asset_id = _call("POST", "/theme-assets", owner,
                          {"data": PNG_DATA_URL, "filename": "sticker.png", "slot": "cornerSticker"}).json()["asset_id"]
        created = _call("POST", "/settings/themes", owner, {
            "name": "Export Me", "brand_primary": "#123123", "assets": {"cornerSticker": asset_id},
        }).json()
        theme_id = created["id"]

        r = _call("GET", f"/settings/themes/{theme_id}/export", owner)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/zip"

        zf = zipfile.ZipFile(io.BytesIO(r.content))
        manifest = _json.loads(zf.read("manifest.json"))
        assert manifest["name"] == "Export Me"
        assert manifest["brand_primary"] == "#123123"
        assert manifest["pack_format"] == 1
        assert "cornerSticker" in manifest["assets"]
        asset_fname = manifest["assets"]["cornerSticker"]
        assert asset_fname in zf.namelist()
        assert len(zf.read(asset_fname)) > 0
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (),
                 asset_ids=[asset_id] if asset_id else ())


def test_export_animation_slot_round_trips_original_bytes():
    owner = _mk_user("admin")
    theme_id = None
    asset_id = None
    try:
        asset_id = _call("POST", "/theme-assets", owner,
                          {"data": GIF_DATA_URL, "filename": "wag.gif", "slot": "ambientAnimation"}).json()["asset_id"]
        created = _call("POST", "/settings/themes", owner, {
            "name": "Animated Export", "assets": {"ambientAnimation": asset_id},
        }).json()
        theme_id = created["id"]

        r = _call("GET", f"/settings/themes/{theme_id}/export", owner)
        assert r.status_code == 200, r.text
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        manifest = _json.loads(zf.read("manifest.json"))
        fname = manifest["assets"]["ambientAnimation"]
        assert fname.endswith(".gif")

        import base64
        original_blob = base64.b64decode(GIF_DATA_URL.split(",", 1)[1])
        assert zf.read(fname) == original_blob
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (),
                 asset_ids=[asset_id] if asset_id else ())


def test_export_on_a_nonexistent_theme_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("GET", f"/settings/themes/{TAG}-nonexistent/export", owner)
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_import_creates_a_new_theme_with_fresh_asset_ids_not_the_originals():
    owner = _mk_user("admin")
    theme_id = None
    new_theme_id = None
    try:
        png_bytes = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YA"
            "AAAASUVORK5CYII="
        )
        import base64
        raw_png = base64.b64decode(png_bytes)
        manifest = {
            "name": "Imported Theme", "brand_primary": "#ff00aa", "brand_accent": "#00aaff",
            "theme_glow_color": "#ffaa00", "intensity": "bold", "animation_enabled": False,
            "enabled_targets": {"client_portal": True, "staff_portal": False, "login": True},
            "assets": {"cornerSticker": "assets/cornerSticker.png"},
        }
        pack = _make_pack_zip(manifest, {"assets/cornerSticker.png": raw_png})

        r = _call_upload("POST", "/settings/themes/import", owner, {"file": ("pack.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        created = r.json()
        new_theme_id = created["id"]
        assert created["name"] == "Imported Theme"
        assert created["brand_primary"] == "#ff00aa"
        assert created["theme_glow_color"] == "#ffaa00"
        assert created["intensity"] == "bold"
        assert created["animation_enabled"] is False
        assert created["enabled_targets"] == {"client_portal": True, "staff_portal": False, "login": True}

        new_asset_id = created["assets"]["cornerSticker"]
        assert new_asset_id  # a real, freshly-minted id — never the literal zip path
        assert new_asset_id != "assets/cornerSticker.png"

        g = _call("GET", f"/theme-assets/{new_asset_id}/thumb")
        assert g.status_code == 200, g.text
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[t for t in (theme_id, new_theme_id) if t])


def test_export_then_import_round_trip_preserves_colors_and_repopulates_assets():
    owner = _mk_user("admin")
    original_id = None
    original_asset_id = None
    imported_id = None
    try:
        original_asset_id = _call("POST", "/theme-assets", owner,
                                   {"data": PNG_DATA_URL, "filename": "x.png", "slot": "heroBackground"}).json()["asset_id"]
        original = _call("POST", "/settings/themes", owner, {
            "name": "Round Trip Source", "brand_primary": "#445566", "theme_glow_color": "#998877",
            "assets": {"heroBackground": original_asset_id},
        }).json()
        original_id = original["id"]

        exported = _call("GET", f"/settings/themes/{original_id}/export", owner)
        assert exported.status_code == 200, exported.text

        r = _call_upload("POST", "/settings/themes/import", owner,
                          {"file": ("pack.zip", exported.content, "application/zip")})
        assert r.status_code == 200, r.text
        imported = r.json()
        imported_id = imported["id"]

        assert imported["name"] == "Round Trip Source"
        assert imported["brand_primary"] == "#445566"
        assert imported["theme_glow_color"] == "#998877"
        # Same SLOT is populated, but with a brand-new id — not the source
        # install's id, which this install's /theme-assets wouldn't have.
        assert imported["assets"]["heroBackground"]
        assert imported["assets"]["heroBackground"] != original_asset_id
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[t for t in (original_id, imported_id) if t],
                 asset_ids=[original_asset_id] if original_asset_id else ())


def test_import_rejects_a_zip_with_no_manifest():
    owner = _mk_user("admin")
    try:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("readme.txt", "not a theme pack")
        r = _call_upload("POST", "/settings/themes/import", owner, {"file": ("pack.zip", buf.getvalue(), "application/zip")})
        assert r.status_code == 400, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_import_rejects_a_manifest_with_no_name():
    owner = _mk_user("admin")
    try:
        pack = _make_pack_zip({"brand_primary": "#111111"})
        r = _call_upload("POST", "/settings/themes/import", owner, {"file": ("pack.zip", pack, "application/zip")})
        assert r.status_code == 400, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_import_rejects_a_file_that_is_not_a_zip_at_all():
    owner = _mk_user("admin")
    try:
        r = _call_upload("POST", "/settings/themes/import", owner,
                          {"file": ("pack.zip", b"definitely not a zip file", "application/zip")})
        assert r.status_code == 400, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_export_and_import_non_admin_is_403():
    employee = _mk_user("employee", "daycare_staff")
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Guarded"}).json()
        theme_id = created["id"]

        assert _call("GET", f"/settings/themes/{theme_id}/export", employee).status_code == 403

        pack = _make_pack_zip({"name": "Whatever"})
        r = _call_upload("POST", "/settings/themes/import", employee, {"file": ("pack.zip", pack, "application/zip")})
        assert r.status_code == 403, r.text
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]], theme_ids=[theme_id] if theme_id else ())


# ───────────────────────────── Active Dates scheduling (Stage 5) ───────────
# Relative offsets (±3 days) rather than mocking business_today(), so these
# never flake near the Eastern-time midnight boundary the way a ±1 day
# window could.
_TODAY = server.business_today()
_PAST = (_TODAY - datetime.timedelta(days=3)).isoformat()
_FUTURE = (_TODAY + datetime.timedelta(days=3)).isoformat()


def test_no_schedule_dates_means_always_active():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "No Schedule", "brand_primary": "#101010"}).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        branding = _call("GET", "/branding").json()
        assert branding["theme_schedule_active"] is True
        assert branding["brand_primary"] == "#101010"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_schedule_window_currently_open_shows_the_theme():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Currently Live", "brand_primary": "#202020",
            "start_date": _PAST, "end_date": _FUTURE,
        }).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        branding = _call("GET", "/branding").json()
        assert branding["theme_schedule_active"] is True
        assert branding["brand_primary"] == "#202020"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_schedule_window_not_yet_started_falls_back_to_defaults():
    owner = _mk_user("admin")
    theme_id = None
    asset_id = None
    try:
        asset_id = _call("POST", "/theme-assets", owner,
                          {"data": PNG_DATA_URL, "filename": "x.png", "slot": "heroBackground"}).json()["asset_id"]
        created = _call("POST", "/settings/themes", owner, {
            "name": "Not Yet", "brand_primary": "#303030", "intensity": "bold",
            "start_date": _FUTURE, "assets": {"heroBackground": asset_id},
        }).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        branding = _call("GET", "/branding").json()
        assert branding["theme_schedule_active"] is False
        # Falls back to the hardcoded baseline, not just "no color at all".
        assert branding["brand_primary"] == "#8cc63f"
        assert branding["theme_intensity"] == "standard"
        assert branding["assets"]["heroBackground"] is None
        # But the real schedule/active id are still reported honestly, so
        # Theme Studio can show "scheduled, not live yet" instead of
        # looking like activation silently failed.
        assert branding["active_theme_id"] == theme_id
        assert branding["start_date"] == _FUTURE
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (),
                 asset_ids=[asset_id] if asset_id else ())


def test_schedule_window_already_ended_falls_back_to_defaults():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Already Over", "brand_primary": "#404040", "end_date": _PAST,
        }).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        branding = _call("GET", "/branding").json()
        assert branding["theme_schedule_active"] is False
        assert branding["brand_primary"] == "#8cc63f"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_schedule_fallback_resets_derived_colors_too():
    """theme_btn_primary_bg/theme_input_focus/theme_calendar_active all
    fall back to brand_primary when unset on the preset itself — that
    derived fallback must ALSO use the baseline brand_primary once the
    schedule has closed, not the scheduled-out theme's brand_primary
    (which would otherwise leak through as a half-reverted, mismatched
    palette)."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Derived Colors", "brand_primary": "#ff00ff", "end_date": _PAST,
        }).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        branding = _call("GET", "/branding").json()
        assert branding["theme_btn_primary_bg"] == "#8cc63f"
        assert branding["theme_input_focus"] == "#8cc63f"
        assert branding["theme_calendar_active"] == "#8cc63f"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


# ───────────────────────────── bulk image upload (filename matching) ───────

def test_match_asset_slot_exact_and_fuzzy_cases():
    # Exact, case/punctuation-insensitive.
    assert server._match_asset_slot("heroBackground.png") == ("heroBackground", None)
    assert server._match_asset_slot("Hero-Background (v2).PNG") == ("heroBackground", None)
    assert server._match_asset_slot("my photos/herobackground.jpg") == ("heroBackground", None)
    # Short name uniquely contained BY one slot.
    assert server._match_asset_slot("sticker.png") == ("cornerSticker", None)
    # Ambiguous: this short name is a substring of multiple slot names.
    slot, reason = server._match_asset_slot("accent.png")
    assert slot is None
    assert "ambiguous between" in reason
    # No match at all.
    slot, reason = server._match_asset_slot("vacation-photo-42.jpg")
    assert slot is None
    assert "doesn't match any slot" in reason


def test_bulk_upload_matches_named_files_and_creates_assets():
    owner = _mk_user("admin")
    theme_id = None
    asset_ids = []
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Target"}).json()
        theme_id = created["id"]

        import base64
        png_bytes = base64.b64decode(PNG_DATA_URL.split(",", 1)[1])
        gif_bytes = base64.b64decode(GIF_DATA_URL.split(",", 1)[1])
        pack = _make_pack_zip(
            {"name": "unused"},  # manifest.json present but irrelevant — bulk upload ignores it
            {
                "heroBackground.png": png_bytes,
                "cornerSticker.png": png_bytes,
                "ambientAnimation.gif": gif_bytes,
                "readme.txt": b"not an image, should be ignored",
            },
        )
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["matched"].keys()) == {"heroBackground", "cornerSticker", "ambientAnimation"}
        asset_ids = list(body["matched"].values())

        # Doesn't touch theme_presets at all — caller is responsible for the save.
        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert stored["assets"]["heroBackground"] is None

        # But the assets themselves are real and fetchable.
        g = _call("GET", f"/theme-assets/{body['matched']['heroBackground']}/thumb")
        assert g.status_code == 200, g.text
        g2 = _call("GET", f"/theme-assets/{body['matched']['ambientAnimation']}/original")
        assert g2.status_code == 200, g2.text
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (), asset_ids=asset_ids)


def test_bulk_upload_reports_unmatched_and_ambiguous_files_without_erroring():
    owner = _mk_user("admin")
    theme_id = None
    asset_ids = []
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Messy"}).json()
        theme_id = created["id"]

        import base64
        png_bytes = base64.b64decode(PNG_DATA_URL.split(",", 1)[1])
        pack = _make_pack_zip({}, {
            "heroBackground.png": png_bytes,       # matches
            "accent.png": png_bytes,               # ambiguous across 4 slots
            "vacation.jpg": png_bytes,              # no match at all
        })
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        asset_ids = list(body["matched"].values())
        assert list(body["matched"].keys()) == ["heroBackground"]
        skipped_names = {s["filename"] for s in body["skipped"]}
        assert "accent.png" in skipped_names
        assert "vacation.jpg" in skipped_names
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (), asset_ids=asset_ids)


def test_bulk_upload_second_file_for_same_slot_is_skipped_not_overwritten():
    owner = _mk_user("admin")
    theme_id = None
    asset_ids = []
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Dupe Slot"}).json()
        theme_id = created["id"]

        import base64
        png_bytes = base64.b64decode(PNG_DATA_URL.split(",", 1)[1])
        pack = _make_pack_zip({}, {
            "heroBackground.png": png_bytes,
            "hero-background-alt.png": png_bytes,  # also matches heroBackground
        })
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        asset_ids = list(body["matched"].values())
        assert list(body["matched"].keys()) == ["heroBackground"]
        assert len(body["skipped"]) == 1
        assert "already matched this slot" in body["skipped"][0]["reason"]
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (), asset_ids=asset_ids)


def test_bulk_upload_rejects_a_non_zip_file():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Not A Zip"}).json()
        theme_id = created["id"]
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", b"not a zip", "application/zip")})
        assert r.status_code == 400, r.text
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_bulk_upload_on_a_nonexistent_theme_is_404():
    owner = _mk_user("admin")
    try:
        pack = _make_pack_zip({})
        r = _call_upload("POST", f"/settings/themes/{TAG}-nonexistent/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_bulk_upload_non_admin_is_403():
    employee = _mk_user("employee", "daycare_staff")
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Guarded"}).json()
        theme_id = created["id"]
        pack = _make_pack_zip({})
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", employee,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 403, r.text
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]], theme_ids=[theme_id] if theme_id else ())


def test_bulk_upload_parses_colors_json_alongside_images():
    owner = _mk_user("admin")
    theme_id = None
    asset_ids = []
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk With Colors"}).json()
        theme_id = created["id"]

        import base64, json as _json
        png_bytes = base64.b64decode(PNG_DATA_URL.split(",", 1)[1])
        colors_payload = _json.dumps({
            "primary": "#ff7518", "secondary": "#7a3bff",
            "glow": "#ffb347", "textAccent": "#ffffff",
        }).encode()
        pack = _make_pack_zip({}, {
            "heroBackground.png": png_bytes,
            "colors.json": colors_payload,
        })
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        asset_ids = list(body["matched"].values())
        assert body["colors"] == {
            "brand_primary": "#ff7518", "brand_accent": "#7a3bff",
            "theme_glow_color": "#ffb347", "theme_text_display": "#ffffff",
        }
        assert body["color_warnings"] == []
        assert list(body["matched"].keys()) == ["heroBackground"]
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else (), asset_ids=asset_ids)


def test_bulk_upload_warns_on_unrecognized_or_invalid_colors_but_keeps_the_good_ones():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Bulk Bad Colors"}).json()
        theme_id = created["id"]

        import json as _json
        colors_payload = _json.dumps({
            "primary": "#ff7518",       # good
            "primary_color": "not-a-hex",  # recognized key, bad value
            "banana": "#123456",        # unrecognized key
        }).encode()
        pack = _make_pack_zip({}, {"colors.json": colors_payload})
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["colors"] == {"brand_primary": "#ff7518"}
        assert len(body["color_warnings"]) == 2
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_bulk_upload_colors_only_with_no_images_still_works():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Colors Only"}).json()
        theme_id = created["id"]
        import json as _json
        pack = _make_pack_zip({}, {"colors.json": _json.dumps({"primary": "#001122"}).encode()})
        r = _call_upload("POST", f"/settings/themes/{theme_id}/bulk-upload", owner,
                          {"file": ("bulk.zip", pack, "application/zip")})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["matched"] == {}
        assert body["colors"] == {"brand_primary": "#001122"}
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())
