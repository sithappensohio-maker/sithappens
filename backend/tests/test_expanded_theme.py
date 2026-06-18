"""Sprint 110di-8 — Verify expanded Brand & Theme settings round-trip
through /api/settings + /api/branding.
"""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


THEME_KEYS = [
    "theme_bg_base", "theme_bg_panel", "theme_bg_header", "theme_bg_hover",
    "theme_text_primary", "theme_text_muted", "theme_text_display",
    "theme_btn_primary_bg", "theme_btn_primary_fg",
    "theme_btn_secondary_border", "theme_btn_secondary_fg",
    "theme_btn_danger_bg", "theme_btn_danger_fg",
    "theme_input_bg", "theme_input_border", "theme_input_focus",
    "theme_calendar_active", "theme_table_hover", "theme_row_border",
]


def test_branding_endpoint_exposes_all_new_theme_keys_with_defaults():
    """/api/branding (unauthenticated) must return all 19 new theme keys with
    sensible Sit Happens defaults so the login screen + portal can apply them
    before the user even logs in."""
    r = requests.get(f"{BASE_URL}/api/branding", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in THEME_KEYS:
        assert k in body, f"/branding missing key {k}"
        v = body[k]
        # Each should be a non-empty CSS color string.
        assert isinstance(v, str) and v.startswith("#") and len(v) in (4, 7, 9), f"bad value {k}={v!r}"
    # Sit Happens canonical defaults — should be present out of the box.
    assert body["theme_bg_base"]   == "#060c2e"
    assert body["theme_bg_panel"]  == "#0c143e"
    assert body["theme_bg_header"] == "#03061a"
    assert body["theme_bg_hover"]  == "#1a225a"
    # brand_* keys still present (no regression).
    for legacy in ["brand_primary", "brand_accent", "brand_warning",
                   "brand_font_family", "grad_hero_color"]:
        assert legacy in body


def test_settings_persists_expanded_theme_keys_round_trip():
    h = _admin_h()
    # Save a custom palette
    custom = {
        "theme_bg_base":              "#1a1a2e",
        "theme_bg_panel":             "#16213e",
        "theme_bg_header":            "#0f0f1e",
        "theme_bg_hover":             "#2c2c4a",
        "theme_text_primary":         "#f1f5f9",
        "theme_text_muted":           "#94a3b8",
        "theme_text_display":         "#ffffff",
        "theme_btn_primary_bg":       "#facc15",
        "theme_btn_primary_fg":       "#1a1a2e",
        "theme_btn_secondary_border": "#facc15",
        "theme_btn_secondary_fg":     "#facc15",
        "theme_btn_danger_bg":        "#dc2626",
        "theme_btn_danger_fg":        "#ffffff",
        "theme_input_bg":             "#1a1a2e",
        "theme_input_border":         "#2c2c4a",
        "theme_input_focus":          "#facc15",
        "theme_calendar_active":      "#facc15",
        "theme_table_hover":          "#2c2c4a",
        "theme_row_border":           "#2c2c4a",
    }
    r = requests.put(f"{BASE_URL}/api/settings", json=custom, headers=h, timeout=15)
    assert r.status_code == 200, r.text

    try:
        # Read back via /branding (unauth)
        r2 = requests.get(f"{BASE_URL}/api/branding", timeout=15)
        body = r2.json()
        for k, v in custom.items():
            assert body[k] == v, f"{k} did not persist: got {body[k]!r}"
    finally:
        # Restore Sit Happens defaults so we don't leave the test DB in a
        # weird-looking state for other tests / screenshots.
        defaults = {
            "theme_bg_base":              "#060c2e",
            "theme_bg_panel":             "#0c143e",
            "theme_bg_header":            "#03061a",
            "theme_bg_hover":             "#1a225a",
            "theme_text_primary":         "#e2e8f0",
            "theme_text_muted":           "#94a3b8",
            "theme_text_display":         "#ffffff",
            "theme_btn_primary_bg":       "#8cc63f",
            "theme_btn_primary_fg":       "#03061a",
            "theme_btn_secondary_border": "#1a225a",
            "theme_btn_secondary_fg":     "#e2e8f0",
            "theme_btn_danger_bg":        "#ef4444",
            "theme_btn_danger_fg":        "#ffffff",
            "theme_input_bg":             "#060c2e",
            "theme_input_border":         "#1a225a",
            "theme_input_focus":          "#8cc63f",
            "theme_calendar_active":      "#8cc63f",
            "theme_table_hover":          "#1a225a",
            "theme_row_border":           "#1a225a",
        }
        requests.put(f"{BASE_URL}/api/settings", json=defaults, headers=h, timeout=15)
