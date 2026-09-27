"""Per-collection rules for the in-app backup.

Most collections round-trip by `id` (or by a string `_id`, see
STRING_ID_COLLECTIONS in server.py). The few below need more, and each rule
is pinned by backend/test_backup_coverage_guard.py.
"""
from typing import Dict, Tuple

from domains.operations import audit_redact

# Fields left out of the backup file. Shop photo derivatives (thumb / card /
# pdp / zoom) are raw bytes that JSON cannot carry: the download crashed on
# them and the auto-backup wrote them as "b'\\xff..'" text, which a restore
# then served as broken pictures. The original upload (`data`) is kept, and
# shop/media.ensure_derivatives rebuilds the sizes the first time a photo is
# viewed.
OMIT_FIELDS: Dict[str, Tuple[str, ...]] = {
    "shop_media": ("derivatives", "derivatives_built_at"),
}

# Rows stored without an `id`. A merge matches them on their natural key (the
# one the code itself writes them by). The old fallback inserted a second
# copy: a unique index refused it (favourites), or — found by a full-size
# restore drill — every merge doubled the drawer sessions, email templates,
# sign-in links and notification log.
MERGE_KEYS: Dict[str, Tuple[str, ...]] = {
    "shop_favorites": ("client_id", "kind", "ref_id"),
    "cash_drawer_sessions": ("date",),
    "claim_tokens": ("token",),
    "email_templates": ("slug",),
    "notification_log": ("key",),
    "settings": ("key",),            # the key/value rows; the main row has an id
    "task_dismissals": ("item_id",),
    "vaccine_dismissals": ("dog_id",),
}


def merge_filter(collection: str, doc: dict, is_string_id: bool):
    """How a merge finds the live copy of `doc`, or None when it can't."""
    if is_string_id:
        return None
    if doc.get("id"):
        return {"id": doc["id"]}
    natural = MERGE_KEYS.get(collection)
    if natural and all(doc.get(f) is not None for f in natural):
        return {f: doc[f] for f in natural}
    return None


# Sequences a merge may only raise. Records made after the backup stay in the
# database during a merge, so putting the counter back would hand their
# confirmation / contestant / photo-order numbers out a second time.
MERGE_MAX_FIELDS: Dict[str, str] = {
    "event_counters": "seq",
}

# A backed-up row whose natural key a different live row already holds. On a
# fresh server, startup seeds Trunk or Treat under a new id, so the backup's
# real event collided on its slug. The backup's row takes the live one over,
# but only while nothing points at the live one yet (its registrations or
# photo orders would be orphaned); otherwise the live row is kept and
# reported.
MERGE_TAKEOVER: Dict[str, Tuple[str, Tuple[Tuple[str, str], ...]]] = {
    "events": ("slug", (("event_registrations", "event_id"), ("event_photo_orders", "event_id"))),
}


def strip_omitted(collection: str, doc: dict) -> dict:
    """The document without the fields this collection never carries."""
    omit = OMIT_FIELDS.get(collection)
    if not omit:
        return doc
    return {k: v for k, v in doc.items() if k not in omit}


def restore_row(collection: str, doc: dict) -> dict:
    """What a restore writes: strip_omitted, and an Audit Log entry never
    comes back holding a PIN, a sign-in code or a reset link (audit #7) —
    an older backup predates the scrub."""
    doc = strip_omitted(collection, doc)
    if collection == "audit_log":
        doc = audit_redact.clean_row(doc)
    return doc
