"""Saved-matrix fixture for the test files.

Every request now reads the saved permission matrix (audit #7), so a test that
needs a role's rules saves them to settings, the way the app does, instead of
patching the in-memory copy, which the next request would overwrite. The saved
matrix is put back when the test ends. Imported by name into a test module:
`from matrix_support import saved_matrix  # noqa: F401`.
"""
import pytest

import server
from _test_loop import run


@pytest.fixture()
def saved_matrix():
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "staff_role_permissions": 1})) or {}

    def save(role, perms):
        cur = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "staff_role_permissions": 1})) or {}
        matrix = dict(cur.get("staff_role_permissions") or {})
        matrix[role] = dict(perms)
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": matrix}}, upsert=True))
        run(server._load_role_overrides_from_settings())

    yield save
    if "staff_role_permissions" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": prev["staff_role_permissions"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"staff_role_permissions": ""}}))
    run(server._load_role_overrides_from_settings())
