"""A password-reset link never gets around two-step sign-in (audit #6).

Owner decision 2026-09-27 (option A). Before, the "forgot password" link let
whoever clicked it choose a new password and signed them straight in — even
on an account with an authenticator app turned on. Anyone who got into the
owner's email could take over the whole app without the phone.

Now, when the account a link resets has two-step sign-in on, the reset page
asks for the authenticator code (or a recovery code) and nothing changes
until it is right: not the password, not the link. Someone holding only the
email can neither get in nor lock the owner out. The passwordless claim
login is refused for such an account (it must take the password path).
Accounts without two-step sign-in are unchanged.

server.py is at its line ceiling, so this reads the server helpers it needs
live (same pattern as domains.clients.signup_claim).
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

_server_globals: Optional[dict] = None

CODE_NEEDED = ("This account uses two-step sign-in. Enter the 6-digit code from your authenticator app "
               "(or one of your recovery codes) to reset the password.")
CODE_WRONG = "That code isn't right. Check your authenticator app, or use one of your recovery codes."


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


async def target_user(rec: dict) -> Optional[dict]:
    """The account this claim/reset link would set a password for."""
    db = _g("db")
    if rec.get("client_id"):
        return await db.users.find_one({"client_id": rec["client_id"]}, {"_id": 0})
    if rec.get("user_id"):
        return await db.users.find_one({"id": rec["user_id"]}, {"_id": 0})
    return None


async def needs_code(rec: dict) -> bool:
    user = await target_user(rec)
    return bool(user and user.get("mfa_enabled"))


async def require_code(rec: dict, code: Optional[str], request) -> None:
    """Refuse (before anything is written) unless the account has no
    two-step sign-in or `code` is its authenticator/recovery code. A used
    recovery code is spent, exactly as at sign-in."""
    user = await target_user(rec)
    if not (user and user.get("mfa_enabled")):
        return
    clean = (code or "").strip()
    if not clean:
        raise HTTPException(status_code=401, detail=CODE_NEEDED)
    # Per ACCOUNT and BEFORE the check, counting every try: past the limit
    # even the right code is refused, so more IPs or fresh reset links cannot
    # speed up guessing. (A limit applied only after a wrong code never stops
    # the lucky guess.) The owner's normal sign-in has its own limit.
    enforce = _g("_enforce_rate_limit")
    await enforce(request, "mfa_reset_user", user["id"], limit=5, window_seconds=900)
    await enforce(request, "mfa_reset_user_day", user["id"], limit=20, window_seconds=86400)
    if not await _g("_verify_mfa_user_code")(user, clean):
        raise HTTPException(status_code=401, detail=CODE_WRONG)
