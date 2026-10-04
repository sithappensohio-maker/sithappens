"""The sign-in limit stops a guesser, the right password included (audit #6:
"The sign-in attempt limit never stops a correct password guess"). The limit
used to be checked only after a wrong password, so once it was used up a
correct one still signed in. Now a used-up allowance refuses before the
password is checked. Disposable tag TEST_LOGIN_LIMIT."""
import uuid

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_LOGIN_LIMIT"
RIGHT = "right-pass-" + TAG


def _user():
    email = f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.com"
    run(server.db.users.insert_one({
        "id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} owner", "email": email,
        "password_hash": server.hash_password(RIGHT), "active": True, "token_version": 0}))
    return email


@pytest.fixture(autouse=True)
def _fresh_allowance():
    run(server.db.auth_rate_limits.delete_many({"scope": {"$in": ["login_ip", "login_email_ip"]}}))
    yield
    run(server.db.auth_rate_limits.delete_many({"scope": {"$in": ["login_ip", "login_email_ip"]}}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))


def _login(email, password):
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.post("/api/auth/login", json={"email": email, "password": password})
    return run(_go())


def test_the_right_password_works_while_the_allowance_lasts():
    email = _user()
    assert _login(email, "wrong-guess").status_code == 401
    r = _login(email, RIGHT)
    assert r.status_code == 200 and r.json().get("token")


def test_once_the_allowance_is_used_up_the_right_password_is_refused_too():
    email = _user()
    for _ in range(10):
        assert _login(email, "wrong-guess").status_code == 401
    r = _login(email, RIGHT)
    assert r.status_code == 429, "the correct password is refused while the window is used up"
    assert "token" not in r.json()
    assert r.headers.get("retry-after")


def test_the_eleventh_wrong_guess_is_still_refused_with_429():
    email = _user()
    for _ in range(10):
        _login(email, "wrong-guess")
    assert _login(email, "wrong-guess").status_code == 429


def test_one_email_using_up_its_allowance_does_not_lock_out_another():
    locked, other = _user(), _user()
    for _ in range(10):
        _login(locked, "wrong-guess")
    assert _login(other, RIGHT).status_code == 200
