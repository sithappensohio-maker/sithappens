"""A mistyped password or code while turning off two-step sign-in is a 400 with the
reason, not a 401, which the app reads as an expired session and signs the owner out
(audit #90). Disposable tag TEST_MFA_TYPO."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
from fastapi import HTTPException
import server
from _test_loop import run

TAG = "TEST_MFA_TYPO"


@pytest.fixture()
def owner():
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({"id": uid, "role": "admin", "name": TAG, "email": f"{uid}@example.com",
                                    "password_hash": server.hash_password("right-pass-" + TAG), "active": True,
                                    "mfa_enabled": True, "token_version": 0, "tag": TAG}))
    yield {"id": uid, "role": "admin"}
    run(server.db.users.delete_many({"tag": TAG}))


def test_a_wrong_password_is_a_400_with_the_reason(owner):
    with pytest.raises(HTTPException) as err:
        run(server.mfa_disable(server.MfaDisableIn(current_password="wrong", code="123456"), owner))
    assert err.value.status_code == 400
    assert err.value.detail == "Current password is incorrect"


def test_a_wrong_code_is_a_400_with_the_reason(owner, monkeypatch):
    async def no(*_a, **_k):
        return False
    monkeypatch.setattr(server, "_verify_mfa_user_code", no)
    with pytest.raises(HTTPException) as err:
        run(server.mfa_disable(server.MfaDisableIn(current_password="right-pass-" + TAG, code="000000"), owner))
    assert err.value.status_code == 400
