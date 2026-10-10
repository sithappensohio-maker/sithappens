"""Theme Gallery (2026-10-09): saved, named Brand & Theme presets on top of
the single live palette `db.settings` has always held. Additive only — an
install that never touches `active_theme_id` must see zero behavior change
from a plain `PUT /settings` with theme_* fields (see the backward-compat
test below, the single most important one in this file).

Same disposable-DB convention as test_permission_overrides.py: `import
_test_env` before `import server`, `httpx.ASGITransport`, and the same
`_mk_user`/`_call` helper pair.
"""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_THEME_PRESETS"


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


def _cleanup(*, user_ids=(), theme_ids=()):
    if user_ids:
        run(server.db.users.delete_many({"id": {"$in": list(user_ids)}}))
    if theme_ids:
        run(server.db.theme_presets.delete_many({"id": {"$in": list(theme_ids)}}))


@pytest.fixture(autouse=True)
def _clean_active_theme():
    """Every test starts from `active_theme_id` unset (the universal
    fresh-install state) and restores whatever was there afterward, so tests
    never leak active-theme state into each other."""
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "active_theme_id": 1})) or {}
    run(server.db.settings.update_one({"id": "global"}, {"$unset": {"active_theme_id": ""}}, upsert=True))
    yield
    if "active_theme_id" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"active_theme_id": prev["active_theme_id"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"active_theme_id": ""}}))


def _seeded_built_ins():
    return run(server.db.theme_presets.find({"built_in": True}, {"_id": 0}).to_list(10))


def test_get_themes_returns_the_3_seeded_built_ins():
    owner = _mk_user("admin")
    try:
        r = _call("GET", "/settings/themes", owner)
        assert r.status_code == 200, r.text
        rows = r.json()
        built_ins = [t for t in rows if t.get("built_in")]
        names = {t["name"] for t in built_ins}
        assert names == {"Classic Sit Happens", "Halloween", "Christmas"}, names
        # Fixed order: Classic, Halloween, Christmas, then any custom themes.
        built_in_names_in_order = [t["name"] for t in rows if t.get("built_in")]
        assert built_in_names_in_order == ["Classic Sit Happens", "Halloween", "Christmas"]
        classic = next(t for t in rows if t["name"] == "Classic Sit Happens")
        assert classic["brand_primary"] == "#8cc63f"
        assert classic["theme_bg_base"] == "#060c2e"
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_post_creates_a_custom_theme_with_defaults_filled_in():
    owner = _mk_user("admin")
    theme_id = None
    try:
        r = _call("POST", "/settings/themes", owner, {"name": "My Theme", "brand_primary": "#123456"})
        assert r.status_code == 200, r.text
        body = r.json()
        theme_id = body["id"]
        assert body["built_in"] is False
        assert body["name"] == "My Theme"
        assert body["brand_primary"] == "#123456"
        # Omitted fields fill from the exact same defaults GET /branding uses.
        assert body["brand_accent"] == "#00a9e0"
        assert body["theme_bg_base"] == "#060c2e"
        assert body["interface_style"] == "standard"

        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert stored["name"] == "My Theme"
        assert stored["built_in"] is False
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_post_requires_a_name():
    owner = _mk_user("admin")
    try:
        r = _call("POST", "/settings/themes", owner, {"brand_primary": "#123456"})
        assert r.status_code == 400, r.text
        assert "name is required" in r.text.lower()

        r2 = _call("POST", "/settings/themes", owner, {"name": "   ", "brand_primary": "#123456"})
        assert r2.status_code == 400, r2.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_put_updates_a_custom_theme_but_400s_on_a_built_in():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Editable"}).json()
        theme_id = created["id"]

        r = _call("PUT", f"/settings/themes/{theme_id}", owner, {"brand_primary": "#abcdef"})
        assert r.status_code == 200, r.text
        assert r.json()["brand_primary"] == "#abcdef"
        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert stored["brand_primary"] == "#abcdef"

        classic = next(t for t in _seeded_built_ins() if t["name"] == "Classic Sit Happens")
        r2 = _call("PUT", f"/settings/themes/{classic['id']}", owner, {"brand_primary": "#abcdef"})
        assert r2.status_code == 400, r2.text
        assert "duplicate it first" in r2.text.lower()
        unchanged = run(server.db.theme_presets.find_one({"id": classic["id"]}, {"_id": 0}))
        assert unchanged["brand_primary"] == "#8cc63f"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_put_on_a_nonexistent_theme_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("PUT", f"/settings/themes/{TAG}-nonexistent", owner, {"brand_primary": "#abcdef"})
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_delete_a_custom_theme_succeeds_but_not_a_built_in_or_the_active_one():
    owner = _mk_user("admin")
    theme_id = None
    active_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Deletable"}).json()
        theme_id = created["id"]
        r = _call("DELETE", f"/settings/themes/{theme_id}", owner)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}
        assert run(server.db.theme_presets.find_one({"id": theme_id})) is None
        theme_id = None  # already gone, nothing to clean up

        classic = next(t for t in _seeded_built_ins() if t["name"] == "Classic Sit Happens")
        r2 = _call("DELETE", f"/settings/themes/{classic['id']}", owner)
        assert r2.status_code == 400, r2.text
        assert "can't be deleted" in r2.text.lower()

        created2 = _call("POST", "/settings/themes", owner, {"name": "Currently Active"}).json()
        active_id = created2["id"]
        act = _call("POST", f"/settings/themes/{active_id}/activate", owner)
        assert act.status_code == 200, act.text
        r3 = _call("DELETE", f"/settings/themes/{active_id}", owner)
        assert r3.status_code == 400, r3.text
        assert "switch to a different one first" in r3.text.lower()
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[t for t in (theme_id, active_id) if t])


def test_delete_on_a_nonexistent_theme_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("DELETE", f"/settings/themes/{TAG}-nonexistent", owner)
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_activate_copies_the_presets_colors_onto_branding_and_sets_active_theme_id():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {
            "name": "Activate Me", "brand_primary": "#111111", "theme_bg_base": "#222222",
        }).json()
        theme_id = created["id"]

        r = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "active_theme_id": theme_id}

        branding = _call("GET", "/branding").json()
        assert branding["active_theme_id"] == theme_id
        assert branding["brand_primary"] == "#111111"
        assert branding["theme_bg_base"] == "#222222"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_activate_on_a_nonexistent_theme_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("POST", f"/settings/themes/{TAG}-nonexistent/activate", owner)
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_auto_fork_editing_an_active_built_in_forks_a_custom_copy_and_leaves_the_built_in_untouched():
    owner = _mk_user("admin")
    fork_id = None
    try:
        classic = next(t for t in _seeded_built_ins() if t["name"] == "Classic Sit Happens")
        act = _call("POST", f"/settings/themes/{classic['id']}/activate", owner)
        assert act.status_code == 200, act.text

        r = _call("PUT", "/settings", owner, {"brand_primary": "#fedcba"})
        assert r.status_code == 200, r.text

        # The built-in's OWN stored doc is unchanged.
        unchanged = run(server.db.theme_presets.find_one({"id": classic["id"]}, {"_id": 0}))
        assert unchanged["brand_primary"] == "#8cc63f"
        assert unchanged["built_in"] is True

        # A new, non-built-in fork now exists, named "... (Custom)", carrying
        # the edited field plus the rest of the built-in's original palette.
        forks = run(server.db.theme_presets.find(
            {"built_in": False, "name": "Classic Sit Happens (Custom)"}, {"_id": 0}).to_list(10))
        assert len(forks) == 1, forks
        fork = forks[0]
        fork_id = fork["id"]
        assert fork["brand_primary"] == "#fedcba"
        assert fork["theme_bg_base"] == classic["theme_bg_base"]

        # GET /branding's active_theme_id now points at the new fork.
        branding = _call("GET", "/branding").json()
        assert branding["active_theme_id"] == fork_id
        assert branding["brand_primary"] == "#fedcba"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[fork_id] if fork_id else ())


def test_auto_mirror_editing_an_active_custom_theme_updates_that_same_preset_no_fork():
    owner = _mk_user("admin")
    theme_id = None
    try:
        created = _call("POST", "/settings/themes", owner, {"name": "Mirror Me"}).json()
        theme_id = created["id"]
        act = _call("POST", f"/settings/themes/{theme_id}/activate", owner)
        assert act.status_code == 200, act.text

        before_count = run(server.db.theme_presets.count_documents({}))

        r = _call("PUT", "/settings", owner, {"brand_primary": "#010203"})
        assert r.status_code == 200, r.text

        after_count = run(server.db.theme_presets.count_documents({}))
        assert after_count == before_count, "no new preset should have been created"

        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert stored["brand_primary"] == "#010203"
        assert stored["built_in"] is False

        branding = _call("GET", "/branding").json()
        assert branding["active_theme_id"] == theme_id
        assert branding["brand_primary"] == "#010203"
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())


def test_backward_compat_no_active_theme_means_plain_put_settings_is_unaffected():
    """The single most important test in this file: with active_theme_id
    never set (the state of every existing install, including every
    existing test), a raw PUT /settings with theme_* fields behaves exactly
    as it does today — no preset is created or mutated."""
    owner = _mk_user("admin")
    try:
        assert run(server.db.settings.find_one({"id": "global"}, {"_id": 0})).get("active_theme_id") is None
        before_count = run(server.db.theme_presets.count_documents({}))
        before_docs = {d["id"]: d for d in run(server.db.theme_presets.find({}, {"_id": 0}).to_list(100))}

        r = _call("PUT", "/settings", owner, {
            "brand_primary": "#999999", "theme_bg_base": "#888888", "interface_style": "bold",
        })
        assert r.status_code == 200, r.text
        assert r.json()["brand_primary"] == "#999999"

        after_count = run(server.db.theme_presets.count_documents({}))
        assert after_count == before_count, "no preset should be created when no theme is active"
        after_docs = {d["id"]: d for d in run(server.db.theme_presets.find({}, {"_id": 0}).to_list(100))}
        assert after_docs == before_docs, "no existing preset should be mutated when no theme is active"

        branding = _call("GET", "/branding").json()
        assert branding["active_theme_id"] is None
        assert branding["brand_primary"] == "#999999"

        # Restore the live palette back to the seeded defaults so this test
        # doesn't leak state into others sharing the disposable DB.
        run(server.db.settings.update_one({"id": "global"}, {"$set": {
            "brand_primary": "#8cc63f", "theme_bg_base": "#060c2e", "interface_style": "standard",
        }}))
    finally:
        _cleanup(user_ids=[owner["id"]])


def test_non_admin_gets_403_on_all_5_endpoints():
    employee = _mk_user("employee", "daycare_staff")
    try:
        classic = next(t for t in _seeded_built_ins() if t["name"] == "Classic Sit Happens")

        assert _call("GET", "/settings/themes", employee).status_code == 403
        assert _call("POST", "/settings/themes", employee, {"name": "Nope"}).status_code == 403
        assert _call("PUT", f"/settings/themes/{classic['id']}", employee, {"brand_primary": "#000000"}).status_code == 403
        assert _call("DELETE", f"/settings/themes/{classic['id']}", employee).status_code == 403
        assert _call("POST", f"/settings/themes/{classic['id']}/activate", employee).status_code == 403
    finally:
        _cleanup(user_ids=[employee["id"]])


def test_import_style_creation_drops_unknown_fields():
    """Proves ThemePresetIn's strict allowlist actually works, unlike
    SettingsIn's extra="allow"."""
    owner = _mk_user("admin")
    theme_id = None
    try:
        r = _call("POST", "/settings/themes", owner, {"name": "x", "not_a_real_field": "evil"})
        assert r.status_code == 200, r.text
        body = r.json()
        theme_id = body["id"]
        assert "not_a_real_field" not in body

        stored = run(server.db.theme_presets.find_one({"id": theme_id}, {"_id": 0}))
        assert "not_a_real_field" not in stored
    finally:
        _cleanup(user_ids=[owner["id"]], theme_ids=[theme_id] if theme_id else ())
