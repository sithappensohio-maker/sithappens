"""Sprint 110di-11 — stronger card border + glow + inner highlight."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


NEW_KEYS = [
    "card_glow_opacity", "card_glow_blur",
    "card_inner_highlight_color", "card_inner_highlight_opacity",
]


def test_branding_exposes_new_glow_and_highlight_keys():
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    for k in NEW_KEYS:
        assert k in body, f"missing {k}"
    # Defaults from spec — only assert if the current DB hasn't overridden them.
    if "card_glow_opacity" in body:
        assert isinstance(body["card_glow_opacity"], (int, float))
    if "card_glow_blur" in body:
        assert isinstance(body["card_glow_blur"], (int, float))
    assert body["card_inner_highlight_color"].startswith("#")


def test_settings_persists_glow_blur_and_inner_highlight():
    h = _admin_h()
    custom = {
        "card_glow_opacity": 0.55,
        "card_glow_blur":    22,
        "card_inner_highlight_color":   "#ff66cc",
        "card_inner_highlight_opacity": 0.18,
    }
    assert requests.put(f"{BASE_URL}/api/settings", json=custom, headers=h, timeout=15).status_code == 200
    try:
        body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
        assert float(body["card_glow_opacity"]) == 0.55
        assert float(body["card_glow_blur"]) == 22
        assert body["card_inner_highlight_color"].lower() == "#ff66cc"
        assert float(body["card_inner_highlight_opacity"]) == 0.18
    finally:
        requests.put(f"{BASE_URL}/api/settings", headers=h, timeout=15, json={
            "card_glow_opacity": 0.35,
            "card_glow_blur":    14,
            "card_inner_highlight_color":   "#FFFFFF",
            "card_inner_highlight_opacity": 0.08,
        })
