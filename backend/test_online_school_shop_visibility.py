"""Feature Flags → Online School toggle: its own description says it hides
School from "the portal nav, public site nav/homepage, and shop" — the
portal-nav and public-site checks exist (Sprint 110di-17), but the Shop
catalog itself never checked it: _build_shop_catalog gated ALL training
programs (in-person classes included) on the single "training" Shop-
Appearance section, never on this global flag, so an online_school program
stayed visible/purchasable in the Shop with the flag off.

Disposable tag TEST_ONLINE_SCHOOL_SHOP_VISIBILITY.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ONLINE_SCHOOL_SHOP_VISIBILITY"


def _program(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} Program", "slug": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}",
        "active": True, "available_online": True, "price": 89.0,
        "format": {"count": 6, "unit": "sessions"}, "purchase_fulfillment": "credits_only",
        "category_id": None, "subcategory_id": None, "publicly_visible": True,
        "show_public_price": True, "requires_dog": False, "requires_approval": False,
        "requires_completed_onboarding": False, "featured": False,
        "modules": [], "helps_with": [], "welcome_outcomes": [],
    }
    doc.update(overrides)
    run(server.db.programs.insert_one(doc.copy()))
    return doc


def _cleanup(ids):
    run(server.db.programs.delete_many({"id": {"$in": ids}}))


def _set_online_school_flag(value):
    run(server.db.settings.update_one(
        {"id": "global"}, {"$set": {"feature_visibility.online_school": value}}, upsert=True))


def _clear_online_school_override():
    run(server.db.settings.update_one({"id": "global"}, {"$unset": {"feature_visibility.online_school": ""}}))


def test_online_school_off_hides_only_online_school_programs_from_the_shop():
    online_prog = _program(name=f"{TAG} Online Course", purchase_fulfillment="online_school")
    in_person_prog = _program(name=f"{TAG} In-Person Class", purchase_fulfillment="credits_only")
    try:
        _set_online_school_flag(False)
        try:
            catalog = run(server._build_shop_catalog(None))
            ids = {i["id"] for i in catalog["items"]}
            assert online_prog["id"] not in ids, "an online_school program must be hidden when the flag is off"
            assert in_person_prog["id"] in ids, "an ordinary in-person program must stay visible"
        finally:
            _clear_online_school_override()
    finally:
        _cleanup([online_prog["id"], in_person_prog["id"]])


def test_online_school_on_shows_the_online_school_program_again():
    online_prog = _program(name=f"{TAG} Online Course 2", purchase_fulfillment="online_school")
    try:
        _set_online_school_flag(True)
        try:
            catalog = run(server._build_shop_catalog(None))
            ids = {i["id"] for i in catalog["items"]}
            assert online_prog["id"] in ids
        finally:
            _clear_online_school_override()
    finally:
        _cleanup([online_prog["id"]])


def test_default_with_no_override_is_visible():
    online_prog = _program(name=f"{TAG} Online Course 3", purchase_fulfillment="online_school")
    try:
        _clear_online_school_override()
        catalog = run(server._build_shop_catalog(None))
        ids = {i["id"] for i in catalog["items"]}
        assert online_prog["id"] in ids
    finally:
        _cleanup([online_prog["id"]])
