"""What the Audit Log may keep of a request body (audit #7).

Owner decision 2026-09-27 (option A). The Audit Log stores a copy of every
change request's body and blanked only a fixed list of exact key names —
`pin` was not on it, so setting a register PIN, or a No-Sale, stored the
staff member's 4-digit PIN in plain text for anyone with Audit Log access
to read (and then open No-Sales under their name). A client's photo-gallery
PIN and the codes typed on the password-reset page leaked the same way.

`is_sensitive` is the one rule (exact names plus the families they belong
to — anything ending _pin, _password, _token, _secret, recovery codes, and
a bare `code` on the two-step sign-in routes). A claim/reset link's secret
also rides in the request PATH (`/claim/<token>`), so `redact_path` blanks
it there too. `redact` applies the rule to new entries; `clean_row` to a
stored entry — used by `scrub_existing` (once, as a scheduler job, marker in
system_runs) and by every backup restore, so restoring an older backup can
never bring a PIN back.
"""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("sithappens.audit_redact")

REDACTED = "[REDACTED]"
SCRUB_MARKER = "audit_log_redact_v2"

_EXACT = {
    "password", "current_password", "new_password", "confirm_password",
    "token", "access_token", "refresh_token", "challenge_token",
    "secret", "api_key", "credit_card", "card_number", "cvv", "ssn",
    "pin", "mfa_code", "recovery_code", "recovery_codes",
}
_SUFFIXES = ("_pin", "_pin_hash", "_password", "_token", "_secret")


def is_sensitive(key: Any, path: str = "") -> bool:
    k = str(key or "").lower()
    if k in _EXACT or k.endswith(_SUFFIXES):
        return True
    if "recovery" in k and "code" in k:
        return True
    # The two-step sign-in routes send the authenticator code as plain `code`.
    return k == "code" and "/mfa" in (path or "")


_PATH_SECRET = re.compile(r"(/claim/)[^/]+")


def redact_path(path: str) -> str:
    """`/api/claim/<token>...` -> `/api/claim/[REDACTED]...` — a failed reset
    attempt must not leave a live link on the Audit Log screen."""
    return _PATH_SECRET.sub(r"\1" + REDACTED, path or "")


def redact(payload: Any, path: str = "", depth: int = 0) -> Any:
    if depth > 4:
        return "[…]"
    if isinstance(payload, dict):
        return {k: (REDACTED if is_sensitive(k, path) else redact(v, path, depth + 1))
                for k, v in payload.items()}
    if isinstance(payload, list):
        return [redact(x, path, depth + 1) for x in payload[:50]]
    if isinstance(payload, str) and len(payload) > 500:
        return payload[:500] + "…"
    return payload


def clean_row(doc: dict) -> dict:
    """A stored Audit Log entry with every secret blanked (payload, and a
    claim link in the path / action / record id). Safe to run twice."""
    out = dict(doc)
    raw_path = doc.get("path") or ""
    safe_path = redact_path(raw_path)
    if doc.get("payload"):
        out["payload"] = redact(doc["payload"], safe_path)
    if safe_path != raw_path:
        out["path"] = safe_path
        out["action"] = f"{(doc.get('method') or 'post').lower()}_{REDACTED}"
        out["record_id"] = None
    return out


async def scrub_existing(db, *, batch: int = 500) -> int:
    """Blank secrets in Audit Log entries saved before this rule. Runs once
    (a scheduler job — one worker at a time — cheap once the marker is
    written); returns how many entries changed."""
    if await db.system_runs.find_one({"_id": SCRUB_MARKER}):
        return 0
    changed = 0
    cursor = db.audit_log.find(
        {"$or": [{"payload": {"$nin": [None, {}]}}, {"path": {"$regex": "/claim/"}}]},
        {"_id": 1, "payload": 1, "path": 1, "method": 1, "action": 1, "record_id": 1}).batch_size(batch)
    async for row in cursor:
        clean = clean_row(row)
        diff = {k: clean[k] for k in ("payload", "path", "action", "record_id")
                if k in clean and clean.get(k) != row.get(k)}
        if diff:
            await db.audit_log.update_one({"_id": row["_id"]}, {"$set": diff})
            changed += 1
    await db.system_runs.update_one({"_id": SCRUB_MARKER},
                                    {"$set": {"_id": SCRUB_MARKER, "changed": changed}}, upsert=True)
    if changed:
        logger.info("Audit Log: blanked secrets in %d earlier entries", changed)
    return changed
