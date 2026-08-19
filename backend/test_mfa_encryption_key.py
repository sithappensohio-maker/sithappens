"""MFA secret encryption is decoupled from JWT_SECRET.

Rotating JWT_SECRET is a routine session-invalidation operation. Before this
change it ALSO derived the MFA encryption key, so a rotation would silently
make every stored authenticator secret undecryptable and lock out every
MFA-enabled admin with no path back except recovery codes.

These tests pin the decoupling, the backward-compatible fallback that makes
adopting MFA_ENCRYPTION_KEY a no-migration change, and the fact that neither
secret is ever emitted.
"""
import importlib
import os
import time

import _test_env  # noqa: F401 — must run before `import server`
import base64
import secrets as _secrets

import pytest
import server


def _new_secret():
    """Same shape the enrolment endpoint generates — no extra dependency;
    the app implements TOTP itself with hmac."""
    return base64.b32encode(_secrets.token_bytes(20)).decode().rstrip("=")


def _reload_with(**env):
    """Re-import server with a patched environment and hand back the module.

    server reads its secrets at import time, so an env change only takes
    effect on reload — which is exactly what a real key rotation or a
    process restart with a new key looks like.
    """
    old = {k: os.environ.get(k) for k in env}
    os.environ.update({k: v for k, v in env.items() if v is not None})
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
    try:
        return importlib.reload(server)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@pytest.fixture(autouse=True)
def _restore_module():
    """Always leave the shared server module back on the real environment —
    otherwise a reloaded module would leak into every later test file."""
    yield
    importlib.reload(server)


DEDICATED = "qa-dedicated-mfa-key-0123456789"
OTHER_JWT = "qa-rotated-jwt-secret-9876543210"


def test_dedicated_key_encrypts_and_decrypts_a_totp_secret():
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    secret = _new_secret()
    token = mod._mfa_encrypt_secret(secret)
    assert token and token != secret, "the secret must not be stored in plaintext"
    assert mod._mfa_decrypt_secret(token) == secret


def test_enrollment_and_authentication_work_with_the_dedicated_key():
    """A full round trip: enrol a secret, then verify a live TOTP code
    against what was decrypted from storage."""
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    secret = _new_secret()
    stored = mod._mfa_encrypt_secret(secret)

    recovered = mod._mfa_decrypt_secret(stored)
    assert recovered == secret
    # A live code generated from the DECRYPTED secret must verify against the
    # app's own verifier — i.e. enrolment -> storage -> authentication works.
    code = mod._totp_code(recovered, int(time.time()) // 30)
    assert mod._verify_totp(secret, code), "authenticator flow still works end to end"


def test_rotating_jwt_secret_does_not_invalidate_mfa_secrets():
    """THE point of this change.

    Encrypt with the dedicated key, then restart with a completely different
    JWT_SECRET while MFA_ENCRYPTION_KEY stays the same. The stored secret
    must still decrypt — i.e. a session-invalidation rotation no longer
    destroys anyone's authenticator enrolment.
    """
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    secret = _new_secret()
    stored = mod._mfa_encrypt_secret(stored_secret := secret)

    rotated = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED, JWT_SECRET=OTHER_JWT)
    assert rotated.JWT_SECRET == OTHER_JWT, "the rotation actually took effect"
    assert rotated._mfa_decrypt_secret(stored) == stored_secret, \
        "rotating JWT_SECRET must not invalidate stored MFA secrets"


def test_rotating_jwt_secret_WOULD_break_mfa_without_the_dedicated_key():
    """The pre-change behaviour, kept as the contrast case so the value of
    setting MFA_ENCRYPTION_KEY stays visible and provable."""
    mod = _reload_with(MFA_ENCRYPTION_KEY=None)
    stored = mod._mfa_encrypt_secret(_new_secret())

    rotated = _reload_with(MFA_ENCRYPTION_KEY=None, JWT_SECRET=OTHER_JWT)
    assert rotated._mfa_decrypt_secret(stored) is None, \
        "without a dedicated key the JWT rotation still loses the secret — this is why the key matters"


def test_adopting_the_dedicated_key_still_reads_previously_enrolled_secrets():
    """No data migration required: a secret enrolled BEFORE the dedicated key
    existed was written with the JWT-derived key and must keep working once
    the dedicated key is introduced."""
    legacy = _reload_with(MFA_ENCRYPTION_KEY=None)
    secret = _new_secret()
    stored_before = legacy._mfa_encrypt_secret(secret)

    upgraded = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    assert upgraded._mfa_decrypt_secret(stored_before) == secret, \
        "existing enrolments survive adopting MFA_ENCRYPTION_KEY"
    # …and anything written from now on uses the dedicated key, so it survives
    # a later JWT rotation.
    stored_after = upgraded._mfa_encrypt_secret(secret)
    rotated = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED, JWT_SECRET=OTHER_JWT)
    assert rotated._mfa_decrypt_secret(stored_after) == secret


def test_a_wrong_dedicated_key_does_not_silently_succeed():
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    stored = mod._mfa_encrypt_secret(_new_secret())
    wrong = _reload_with(MFA_ENCRYPTION_KEY="qa-completely-different-key-abc", JWT_SECRET=OTHER_JWT)
    assert wrong._mfa_decrypt_secret(stored) is None


def test_neither_secret_is_exposed_by_the_mfa_helpers():
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    secret = _new_secret()
    token = mod._mfa_encrypt_secret(secret)
    for leaked in (DEDICATED, mod.JWT_SECRET):
        assert leaked not in token, "key material must never appear in the stored ciphertext"
    assert mod._mfa_decrypt_secret("not-a-valid-token") is None, "garbage input fails closed, no raise"


def test_jwt_signing_is_unchanged_by_the_dedicated_key():
    """The MFA key must not touch session behaviour in either direction."""
    mod = _reload_with(MFA_ENCRYPTION_KEY=DEDICATED)
    token = mod.create_access_token("u1", "u1@example.com", "admin", 0)
    decoded = mod.jwt.decode(token, mod.JWT_SECRET, algorithms=[mod.JWT_ALG])
    assert decoded["sub"] == "u1" and decoded["type"] == "access"
