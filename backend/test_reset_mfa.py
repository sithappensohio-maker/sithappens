"""A password-reset link never gets around two-step sign-in (audit #6).

Before: the reset link set a new password and signed the clicker straight in,
even on an owner account with an authenticator app turned on — so anyone in
the owner's email could take over the app without the phone.

Now: for an account with two-step sign-in, the reset asks for the
authenticator code (or a recovery code) and nothing changes until it is right
— not the password, not the link. Accounts without it are unchanged.

Self-contained fixtures (never import another test module).
"""
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_RESET_MFA"


class _Req:
    def __init__(self):
        ip = f"198.21.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = {}
        self.url = type("U", (), {"path": "/api/claim/x"})()


def _secret():
    import base64
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret):
    return server._totp_code(secret, int(time.time()) // 30)


@pytest.fixture
def owner():
    """An admin with an authenticator app and one recovery code."""
    secret = _secret()
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-{uid[:6]}@example.com", "name": f"{TAG} Owner", "role": "admin",
        "password_hash": server.hash_password("old-password-123"), "token_version": 0,
        "mfa_enabled": True, "mfa_secret_enc": server._mfa_encrypt_secret(secret),
        "mfa_recovery_hashes": [server._mfa_recovery_hash("ABC123-DEF456")],
    }))
    try:
        yield {"id": uid, "secret": secret}
    finally:
        run(server.db.users.delete_one({"id": uid}))
        run(server.db.claim_tokens.delete_many({"user_id": uid}))


def _reset_link(user_id, email="owner@example.com"):
    token = secrets.token_urlsafe(24)
    run(server.db.claim_tokens.insert_one({
        "token": token, "user_id": user_id, "email": email, "is_reset": True, "used": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "created_at": server.now_iso(),
    }))
    return token


def _consume(token, password="new-password-456", code=None):
    return run(server.consume_claim_token(token, server.ClaimSetIn(password=password, mfa_code=code), _Req()))


def _password_is(uid, pw):
    return server.verify_password(pw, run(server.db.users.find_one({"id": uid}))["password_hash"])


def _used(token):
    return run(server.db.claim_tokens.find_one({"token": token}))["used"]


def test_the_reset_page_is_told_to_ask_for_the_code(owner):
    token = _reset_link(owner["id"])
    assert run(server.verify_claim_token(token, _Req())).mfa_required is True


def test_a_reset_without_the_code_changes_nothing(owner):
    token = _reset_link(owner["id"])
    with pytest.raises(HTTPException) as e:
        _consume(token)
    assert e.value.status_code == 401 and "two-step" in e.value.detail
    assert _password_is(owner["id"], "old-password-123") and _used(token) is False


def test_a_wrong_code_changes_nothing(owner):
    token = _reset_link(owner["id"])
    with pytest.raises(HTTPException) as e:
        _consume(token, code="000000" if _code(owner["secret"]) != "000000" else "111111")
    assert e.value.status_code == 401
    assert _password_is(owner["id"], "old-password-123") and _used(token) is False


def test_the_right_code_resets_and_signs_in(owner):
    token = _reset_link(owner["id"])
    out = _consume(token, code=_code(owner["secret"]))
    assert out.token and out.user.id == owner["id"]
    assert _password_is(owner["id"], "new-password-456") and _used(token) is True


def test_a_recovery_code_works_once(owner):
    token = _reset_link(owner["id"])
    assert _consume(token, code="abc123-def456").token
    second = _reset_link(owner["id"])
    with pytest.raises(HTTPException):
        _consume(second, code="ABC123-DEF456")
    assert _used(second) is False


def test_an_account_without_two_step_sign_in_resets_as_before():
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-staff-{uid[:6]}@example.com", "name": f"{TAG} Staff", "role": "admin",
        "password_hash": server.hash_password("old-password-123"), "token_version": 0}))
    try:
        token = _reset_link(uid)
        assert run(server.verify_claim_token(token, _Req())).mfa_required is False
        assert _consume(token).token
        assert _password_is(uid, "new-password-456")
    finally:
        run(server.db.users.delete_one({"id": uid}))
        run(server.db.claim_tokens.delete_many({"user_id": uid}))


def test_a_client_link_for_an_account_with_two_step_sign_in_cannot_skip_it():
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Client", email=f"{uuid.uuid4().hex[:8]}@example.com"),
                                 {"id": "x", "role": "admin", "name": "QA"}))
    secret = _secret()
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": c["email"], "name": c["name"], "role": "client", "client_id": c["id"],
        "password_hash": server.hash_password("old-password-123"), "token_version": 0,
        "mfa_enabled": True, "mfa_secret_enc": server._mfa_encrypt_secret(secret)}))
    token = secrets.token_urlsafe(24)
    run(server.db.claim_tokens.insert_one({
        "token": token, "client_id": c["id"], "email": c["email"], "is_reset": True, "used": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}))
    try:
        with pytest.raises(HTTPException):
            run(server.claim_token_login(token, _Req()))      # no passwordless way in
        with pytest.raises(HTTPException):
            _consume(token)
        assert _used(token) is False
        assert _consume(token, code=_code(secret)).token
    finally:
        run(server.db.users.delete_one({"id": uid}))
        run(server.db.clients.delete_one({"id": c["id"]}))
        run(server.db.claim_tokens.delete_many({"token": token}))


# ───────────────────────────── review follow-ups: guessing is capped per account

def _wrong(secret):
    right = _code(secret)
    return "000000" if right != "000000" else "111111"


def test_after_five_tries_even_the_right_code_is_refused(owner):
    token = _reset_link(owner["id"])
    for _ in range(5):
        with pytest.raises(HTTPException) as e:
            _consume(token, code=_wrong(owner["secret"]))          # each from a different IP (_Req)
        assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:
        _consume(token, code=_code(owner["secret"]))
    assert e.value.status_code == 429
    assert _password_is(owner["id"], "old-password-123") and _used(token) is False


def test_a_fresh_reset_link_does_not_reset_the_guess_count(owner):
    for _ in range(5):
        with pytest.raises(HTTPException):
            _consume(_reset_link(owner["id"]), code=_wrong(owner["secret"]))
    with pytest.raises(HTTPException) as e:
        _consume(_reset_link(owner["id"]), code=_code(owner["secret"]))
    assert e.value.status_code == 429


def test_sign_in_codes_are_capped_per_account_too(owner):
    user = run(server.db.users.find_one({"id": owner["id"]}))
    for _ in range(10):
        challenge = server._create_mfa_challenge(user)
        with pytest.raises(HTTPException) as e:
            run(server.verify_mfa_login(server.MfaLoginVerifyIn(challenge_token=challenge, code=_wrong(owner["secret"])), _Req()))
        assert e.value.status_code == 401
    challenge = server._create_mfa_challenge(user)
    with pytest.raises(HTTPException) as e:
        run(server.verify_mfa_login(server.MfaLoginVerifyIn(challenge_token=challenge, code=_code(owner["secret"])), _Req()))
    assert e.value.status_code == 429
