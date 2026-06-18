"""Sprint 110di-10 — Card border + glow controls round-trip."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


CARD_KEYS = [
    "card_border_color", "card_border_opacity", "card_border_width",
    "card_glow_color",   "card_glow_strength",
]


def test_branding_exposes_card_border_and_glow_with_defaults():
    """/api/branding (unauthed) must surface all 5 new card keys so the login
    screen + client portal can paint them before auth."""
    r = requests.get(f"{BASE_URL}/api/branding", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in CARD_KEYS:
        assert k in body, f"missing {k}"
    assert body["card_border_color"]   == "#008CFF"
    assert body["card_glow_color"]     == "#008CFF"
    assert float(body["card_border_opacity"]) == 0.85
    assert float(body["card_border_width"])   == 2
    # New explicit glow opacity + blur (replacing the old `strength` slider).
    assert float(body["card_glow_opacity"]) == 0.35
    assert float(body["card_glow_blur"])    == 14


def test_settings_persists_card_border_and_glow():
    h = _admin_h()
    custom = {
        "card_border_color":   "#39FF14",   # neon green
        "card_border_opacity": 0.4,
        "card_border_width":   2,
        "card_glow_color":     "#FF00FF",   # magenta
        "card_glow_strength":  1.2,
    }
    r = requests.put(f"{BASE_URL}/api/settings", json=custom, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    try:
        body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
        assert body["card_border_color"] == "#39FF14"
        assert float(body["card_border_opacity"]) == 0.4
        assert float(body["card_border_width"]) == 2
        assert body["card_glow_color"] == "#FF00FF"
        assert float(body["card_glow_strength"]) == 1.2
    finally:
        # Reset back to Sit Happens defaults so we don't pollute the shared DB.
        requests.put(f"{BASE_URL}/api/settings", headers=h, timeout=15, json={
            "card_border_color":   "#1B4D7A",
            "card_border_opacity": 0.65,
            "card_border_width":   1,
            "card_glow_color":     "#008CFF",
            "card_glow_strength":  0.5,
        })
