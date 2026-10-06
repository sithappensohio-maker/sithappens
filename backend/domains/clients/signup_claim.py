"""Sign-up for someone we already have on file: prove the inbox first.

POST /auth/register used to attach a brand-new login to any existing client
record whose email matched what was typed — no check that the person typing
owned that inbox. Anyone who knew a client's address could sign up with it
and walk straight into that family's dogs, credits, balance and history.

Now, when the typed email belongs to a client record that has no login yet,
register creates nothing. It mints a one-time claim link (the same
claim_tokens the "Send claim email" button uses) and emails it to that
address. Only someone who can open that inbox can finish; the /claim page
then creates the login on the existing record exactly as an admin-sent claim
does. The password typed at sign-up is discarded, never stored.

The brand-new-customer path (no client with that email) is unchanged: a new
client and login are created and signed in at once.

A referral code typed at sign-up rides on the token and is applied when the
link is used (only if the record has none). The operator's "new client
signed up" email is sent then too — not when somebody merely asked.

server.py is at its line ceiling, so this module reads the server helpers it
needs live (same pattern as domains.bookings.late_day).
"""
from __future__ import annotations
from domains.backup import deletion_log

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import JSONResponse

# One sign-up can't be used to flood someone's inbox: at most one link per
# client per COOLDOWN, and MAX_PER_DAY in any 24 hours. Asking again inside
# the cooldown gets the same answer and no new email — the earlier link
# still works.
COOLDOWN = timedelta(minutes=15)
MAX_PER_DAY = 3
SOURCE = "register"

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def check_email_message(email: str) -> str:
    return (
        f"You're already in our system, so we've emailed a link to {email}. "
        "Open it to finish setting up your login. It can take a minute to arrive — check spam too."
    )


async def _unclaimed_client(email: str) -> Optional[dict]:
    """The client record with this email that has no login yet, if any."""
    db = _g("db")
    pattern = {"$regex": f"^{re.escape(email)}$", "$options": "i"}
    for client in await db.clients.find({"email": pattern}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(20):
        if not await db.users.find_one({"client_id": client["id"]}, {"_id": 0, "id": 1}):
            return client
    return None


async def divert_existing_client(email: str, ref_code: Optional[str]) -> Optional[JSONResponse]:
    """Called by register() after the "already registered" check.

    Returns None when nothing on file matches (register carries on and
    creates a new account). Otherwise emails a claim link to the address on
    file and returns the "check your email" response — no login, no token,
    no change to the client record.
    """
    client = await _unclaimed_client(email)
    if not client:
        return None
    db = _g("db")
    now = datetime.now(timezone.utc)
    recent = await db.claim_tokens.find(
        {"client_id": client["id"], "source": SOURCE, "created_at": {"$gte": (now - timedelta(days=1)).isoformat()}},
        {"_id": 0, "created_at": 1},
    ).to_list(MAX_PER_DAY + 1)
    body = {"status": "check_email", "email": email, "message": check_email_message(email)}
    if len(recent) >= MAX_PER_DAY or any(r["created_at"] >= (now - COOLDOWN).isoformat() for r in recent):
        return JSONResponse(status_code=202, content=body)

    days = _g("CLAIM_TOKEN_EXPIRY_DAYS")
    token = secrets.token_urlsafe(32)
    # Earlier unused links are left alone on purpose: they went to this same
    # inbox, and a stranger's sign-up must not cancel a link the owner has.
    await db.claim_tokens.insert_one({
        "token": token,
        "client_id": client["id"],
        "email": email,
        "is_reset": False,
        "used": False,
        "source": SOURCE,
        "referred_by_code": ref_code,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=days)).isoformat(),
    })
    to_email = (client.get("email") or email).strip().lower()
    try:
        sent = await _g("send_account_claim")(
            to_email=to_email, client_name=client.get("name", ""),
            claim_url=_g("_build_claim_url")(token), is_reset=False,
            expires_days=days, critical=True,
        )
    except Exception as e:
        _g("logger").warning("signup_claim: email to %s failed: %s", to_email, e)
        sent = False
    if sent is False:
        # Nothing reached them — don't let this attempt count toward the
        # cooldown, and say so rather than promise an email that isn't coming.
        await deletion_log.delete_one(db, "claim_tokens", {"token": token})
        raise HTTPException(
            status_code=503,
            detail="You're already in our system, but we couldn't send your sign-in email just now. Please try again in a few minutes, or contact us.",
        )
    return JSONResponse(status_code=202, content=body)


async def on_claimed(rec: dict, client: dict, user: dict) -> None:
    """A login was just created from a claim link. For links minted by a
    sign-up, finish what register used to do at once: apply the referral
    code (never overwriting one already on the record) and tell the
    operator a client signed up. Best-effort — never blocks the sign-in."""
    if rec.get("source") != SOURCE:
        return
    db = _g("db")
    try:
        code = rec.get("referred_by_code")
        if code and not client.get("referred_by_code"):
            await db.clients.update_one(
                {"id": client["id"], "referred_by_code": {"$in": [None, ""]}},
                {"$set": {"referred_by_code": code}},
            )
            client = {**client, "referred_by_code": code}
        await _g("notify_admin_new_client")(user, {**client, "_merged": True})
    except Exception as e:
        _g("logger").warning("signup_claim: post-claim follow-up failed for client %s: %s", client.get("id"), e)
