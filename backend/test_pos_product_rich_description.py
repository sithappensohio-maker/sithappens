"""Product descriptions are now edited as real rich text (RichTextEditor,
ManageProductsPanel.jsx) — owner: "the textbox" "with formatting and headers
and color and text options", 2026-10-17. The stored value is sanitized HTML
from the admin's point of view; the server just stores whatever string it's
given (sanitization happens client-side — see frontend/src/lib/sanitizeHtml.js
and its own doc comment), so this proves the one thing the SERVER is
responsible for: the length cap no longer refuses realistic rich content
that would have comfortably fit as plain text.

Disposable tag TEST_RICH_DESCRIPTION.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_RICH_DESCRIPTION"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "richdesc@test"}

RICH_DESCRIPTION = (
    "<h2>About this leash</h2>"
    "<p>Soft and <strong>strong</strong> — built for everyday walks. "
    + "Trusted by trainers for a decade. " * 30  # pads well past the old 1000-char plain-text cap
    + "</p>"
    "<ul><li>Six feet long</li><li>Brass clip</li><li><span style=\"color: #e07a1f;\">Orange</span> stitching</li></ul>"
)


def _create(**overrides):
    body = {"name": f"{TAG} Item", "price": 24.0, "track_inventory": False}
    body.update(overrides)
    return run(server.create_pos_product(server.PosProductCreateIn(**body), ADMIN))


def _cleanup(product_ids):
    run(server.db.pos_products.delete_many({"id": {"$in": product_ids}}))


def test_a_realistic_rich_text_description_over_the_old_1000_char_cap_now_saves():
    assert len(RICH_DESCRIPTION) > 1000  # would have been refused before this change
    p = _create(description=RICH_DESCRIPTION, online_description=RICH_DESCRIPTION)
    try:
        assert p["description"] == RICH_DESCRIPTION
        assert p["online_description"] == RICH_DESCRIPTION
        assert "<h2>" in p["description"]
        assert "color: #e07a1f" in p["description"]
    finally:
        _cleanup([p["id"]])


def test_update_also_accepts_a_realistic_rich_description():
    p = _create()
    try:
        patch = {"name": p["name"], "price": p["price"], "description": RICH_DESCRIPTION}
        updated = run(server.update_pos_product(p["id"], server.PosProductIn(**patch), ADMIN))
        assert updated["description"] == RICH_DESCRIPTION
    finally:
        _cleanup([p["id"]])


def test_the_cap_is_raised_not_removed():
    too_long = "<p>" + ("x" * 20000) + "</p>"
    try:
        server.PosProductCreateIn(name=f"{TAG} Too Long", price=10.0, description=too_long)
        assert False, "should have been refused — the field is bounded, not unlimited"
    except Exception as e:
        # Pydantic's own ValidationError, not an HTTPException — this never
        # reaches create_pos_product at all.
        assert "description" in str(e).lower()
