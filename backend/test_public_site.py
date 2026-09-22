"""Public website data: /public/site and /public/training-programs.

The logged-out sithappens.app reads business info from settings and training
programs from the same `programs` rows admins manage — nothing is duplicated
for the website. These tests pin the visibility rules and the defaults that
replace the old sithappensohiodogtraining.com content.
"""
import uuid

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_PUBLIC_SITE"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    run(server.db.programs.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.settings.update_one({"id": "global"}, {"$unset": {"public_site": 1}}))
    server.invalidate_settings_cache() if hasattr(server, "invalidate_settings_cache") else None


def _program(name, **over):
    doc = {
        "id": str(uuid.uuid4()), "slug": f"{TAG.lower()}_{uuid.uuid4().hex[:6]}", "name": f"{TAG} {name}",
        "type": "private_lessons", "description": "desc", "focus": "focus", "format": {"count": 5, "unit": "sessions"},
        "min_age_months": 4, "prereq_slugs": [], "modules": [], "active": True, "is_default": True,
        "owner_dog_id": None, "price": 450.0, "show_public_price": True, "created_at": server.now_iso(),
        # Publication is opt-in since Stage 2. Fixtures say so explicitly;
        # `publicly_visible` is overridden per-test where that is the point.
        "publicly_visible": True,
        "public_price_mode": "package", "public_price_amount": 450.0,
    }
    doc.update(over)
    run(server.db.programs.insert_one(dict(doc)))
    return doc


def _public_programs():
    r = run(_http.get("/api/public/training-programs"))
    assert r.status_code == 200, r.text
    return {p["name"]: p for p in r.json()["programs"] if p["name"].startswith(TAG)}


def test_site_info_defaults_replace_the_old_website_and_settings_override_them():
    r = run(_http.get("/api/public/site"))
    assert r.status_code == 200, r.text
    body = r.json()
    site = body["site"]
    assert site["phone"] == "(330) 978-5575"
    assert site["email"] == "sithappensohio@gmail.com"
    assert site["address_line"] == "137 North St NW" and site["city"] == "Warren" and site["state"] == "OH" and site["zip"] == "44483"
    assert site["map_url"].startswith("https://www.google.com/maps/search/?api=1&query=137")
    assert "business_hours" in body and "feature_visibility" in body and "photography_page" in body
    assert isinstance(body["meet_greet_enabled"], bool)

    # An operator edit in Settings wins over the seeded default.
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"public_site": {"phone": "(330) 555-0100", "service_area": "Trumbull County"}}}, upsert=True))
    try:
        server.invalidate_settings_cache()
    except AttributeError:
        pass
    site2 = run(_http.get("/api/public/site")).json()["site"]
    assert site2["phone"] == "(330) 555-0100"
    # The Settings → Public Website panel saves through PUT /settings.
    admin = {"id": str(uuid.uuid4()), "role": "admin", "staff_role": "owner", "name": f"{TAG} owner", "email": f"{TAG.lower()}@example.com"}
    run(server.save_settings(server.SettingsIn(public_site={"phone": "(330) 555-0100", "service_area": "Trumbull County", "hero_headline": "Calm dogs. Happy people."}), admin))
    try:
        server.invalidate_settings_cache()
    except AttributeError:
        pass
    site3 = run(_http.get("/api/public/site")).json()["site"]
    assert site3["hero_headline"] == "Calm dogs. Happy people."
    assert site3["service_area"] == "Trumbull County"
    assert site2["service_area"] == "Trumbull County"
    assert site2["email"] == "sithappensohio@gmail.com", "untouched fields keep their defaults"


def test_training_programs_come_from_the_programs_collection_with_visibility_rules():
    shown = _program("Level 1")
    prereq = _program("Level 2", prereq_slugs=[shown["slug"]], type="board_train",
                      format={"count": 2, "unit": "weeks"},
                      public_price_mode="per_unit", public_price_amount=950.0, public_price_unit="week")
    _program("Inactive", active=False)
    _program("Dog specific", owner_dog_id="dog-123")
    _program("Hidden", publicly_visible=False)
    _program("Online only", type="self_guided", delivery_mode="self_guided")
    _program("Unpriced", public_price_mode=None, public_price_amount=None)
    _program("Price hidden", show_public_price=False)
    # The Stage 2 rule: a program nobody has published is not on the website,
    # even though it is active and operationally normal. This used to be the
    # DEFAULT, which is how 805 internal rows ended up publicly listed.
    never_published = _program("Never published")
    run(server.db.programs.update_one({"id": never_published["id"]},
                                      {"$unset": {"publicly_visible": ""}}))

    got = _public_programs()
    assert f"{TAG} Level 1" in got and f"{TAG} Level 2" in got
    for hidden in ("Inactive", "Dog specific", "Hidden", "Online only", "Never published"):
        assert f"{TAG} {hidden}" not in got, hidden

    # Pricing is explicit or it is an invitation — never $0 and never derived.
    assert got[f"{TAG} Level 1"]["pricing"]["display"] == "$450 program"
    assert got[f"{TAG} Level 1"]["price"] == 450.0
    assert got[f"{TAG} Level 2"]["pricing"]["display"] == "$950 / week"
    for unpriced in (f"{TAG} Unpriced", f"{TAG} Price hidden"):
        assert got[unpriced]["price"] is None
        assert got[unpriced]["pricing"]["display"] == "Contact us for pricing"
        assert got[unpriced]["pricing"]["has_price"] is False

    l2 = got[f"{TAG} Level 2"]
    assert l2["prerequisites"] == [shown["name"]], "prerequisite slugs resolve to names"
    assert l2["type_label"] == "Board & Train" and l2["format"] == {"count": 2, "unit": "weeks"}