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
import uuid

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
