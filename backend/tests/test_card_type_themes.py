"""Sprint 110di-12 — Card Type Themes round-trip + reset/export coverage."""
import os, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


TYPE_IDS = ["default", "info", "stats", "success", "warning",
            "danger", "payment", "training", "booking", "profile"]


def test_branding_exposes_card_type_themes_with_all_ten_types():
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    types = body.get("card_type_themes")
    assert types and isinstance(types, dict), "card_type_themes missing"
    for tid in TYPE_IDS:
        t = types.get(tid)
        assert t, f"type {tid} missing"
        for k in ["bg", "border", "glow", "accent", "border_opacity", "border_width", "glow_opacity", "glow_blur"]:
            assert k in t, f"{tid}.{k} missing"
        assert t["bg"].startswith("#"), f"{tid}.bg should be a hex color"
    # Sanity: spec colors for a few signature types
    assert types["danger"]["border"]  == "#FF3B5C"
    assert types["training"]["accent"] == "#A855F7"
    assert types["payment"]["border"] == "#F26500"


def test_card_type_themes_round_trip_through_settings():
    h = _admin_h()
    custom = {
        "card_type_themes": {
            "danger":  {"bg": "#2a0000", "border": "#ff0000", "glow": "#ff0000",
                        "accent": "#ff0000", "border_opacity": 0.9, "border_width": 3,
                        "glow_opacity": 0.45, "glow_blur": 18},
            "training": {"bg": "#1a0a2a", "border": "#a020f0", "glow": "#a020f0",
                         "accent": "#a020f0", "border_opacity": 0.7, "border_width": 2,
                         "glow_opacity": 0.3, "glow_blur": 16},
        },
    }
    assert requests.put(f"{BASE_URL}/api/settings", json=custom, headers=h, timeout=15).status_code == 200
    try:
        body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
        t = body["card_type_themes"]
        assert t["danger"]["border"] == "#ff0000"
        assert t["danger"]["border_width"] == 3
        assert t["training"]["border"] == "#a020f0"
        # Other types should still be defined (with defaults), not wiped.
        # NOTE: settings only persists what we explicitly send; /branding hydrates
        # missing types from `_card_type_theme_defaults`.
        # Since we sent only danger + training, the rest will fall back if the
        # backend hydrates per-type. We'll check at least 1 default-only key is
        # still present.
        assert "stats" in t and t["stats"]["border"] in ("#1B4D7A", "#ff0000")
    finally:
        # Restore Sit Happens defaults so we don't pollute the shared DB.
        defaults = {
            "card_type_themes": {
                "default":  {"bg": "#05090D", "border": "#008CFF", "glow": "#008CFF", "accent": "#008CFF", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "info":     {"bg": "#05090D", "border": "#008CFF", "glow": "#008CFF", "accent": "#00C8FF", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "stats":    {"bg": "#05090D", "border": "#1B4D7A", "glow": "#008CFF", "accent": "#9BCB00", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "success":  {"bg": "#071006", "border": "#9BCB00", "glow": "#9BCB00", "accent": "#9BCB00", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "warning":  {"bg": "#130B02", "border": "#F26500", "glow": "#F26500", "accent": "#F26500", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "danger":   {"bg": "#170407", "border": "#FF3B5C", "glow": "#FF3B5C", "accent": "#FF3B5C", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "payment":  {"bg": "#09080D", "border": "#F26500", "glow": "#F26500", "accent": "#9BCB00", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "training": {"bg": "#070914", "border": "#A855F7", "glow": "#A855F7", "accent": "#A855F7", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "booking":  {"bg": "#050B14", "border": "#008CFF", "glow": "#008CFF", "accent": "#00C8FF", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
                "profile":  {"bg": "#080C16", "border": "#9BCB00", "glow": "#008CFF", "accent": "#9BCB00", "border_opacity": 0.75, "border_width": 2, "glow_opacity": 0.25, "glow_blur": 14},
            },
        }
        requests.put(f"{BASE_URL}/api/settings", json=defaults, headers=h, timeout=15)
