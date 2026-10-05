"""Replacing the settings from a config file needs the same permission as exporting
them (audit #89: "Managers, who can't change Settings, can replace every setting through
Restore Config"). A manager, who holds data export but not settings, is refused before
anything is replaced. Disposable tag none (no writes reach the database: the refusal
comes first)."""
import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

MANAGER = {"id": "dec-manager", "role": "admin", "staff_role": "manager", "name": "Manager", "email": "mgr@test"}


def test_a_manager_cannot_replace_settings_through_restore_config():
    with pytest.raises(HTTPException) as err:
        run(server.backup_restore_config(None, MANAGER))
    assert err.value.status_code == 403
    assert "settings" in err.value.detail
