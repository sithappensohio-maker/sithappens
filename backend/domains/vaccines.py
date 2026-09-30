"""Where a vaccine record has got to — the server-side half of the vocabulary.

A dog's approved vaccine dates live in ``dog.vaccines``. A certificate the
client has uploaded but nobody has reviewed yet lives in ``dog.vaccine_certs``.
The portal only ever received the first of those, so a client who had just
photographed and submitted their rabies certificate was told on the very next
screen that it was missing — and the booking gate, which does read both,
refused the booking for a reason the client had already dealt with.

``pending_review`` is the shared test. ``_compute_setup_status_for_client`` in
server.py applies the same conditions; if these two ever disagree, the client
sees one thing and the gate enforces another.
"""
from typing import Any, Dict, List, Optional

import bson
from fastapi import HTTPException


def is_cert_pending(cert: Any) -> bool:
    """True when a stored certificate is a client upload awaiting review."""
    if not isinstance(cert, dict):
        return False
    if cert.get("reviewed_at") or cert.get("uploaded_by_admin"):
        return False
    return cert.get("status") in ("pending_review", "pending") or bool(cert.get("pending_expires_on"))


def pending_review(dog: Dict[str, Any]) -> Dict[str, bool]:
    """Which of this dog's vaccines have a certificate sitting in the queue.

    Booleans only, on purpose: a certificate carries a base64 photo and has no
    business travelling in a list payload just so a card can show a badge.
    """
    certs = (dog or {}).get("vaccine_certs")
    if not isinstance(certs, dict):
        return {}
    return {key: True for key, cert in certs.items() if is_cert_pending(cert)}


# ───────────────────────────── a renewal keeps the approved certificate (audit #40)
#
# ``vaccine_certs[v]`` is the upload waiting for review whenever one waits — so
# every "is something waiting" reader (review queue, Today, badges) is unchanged.
# The certificate already approved rides inside it as ``approved_before`` until
# a person decides: approving swaps the new one in (the stash goes), rejecting
# puts the stash back exactly as it was. The dog keeps booking on it meanwhile.

MAX_DOG_BYTES = 15_500_000   # Mongo refuses a document over 16 MB


def was_reviewed(cert: Any) -> bool:
    """A certificate a person already decided on (or staff attached)."""
    return isinstance(cert, dict) and bool(cert.get("reviewed_at") or cert.get("uploaded_by_admin")
                                           or cert.get("status") == "approved")


def is_legacy_unreviewed(cert: Any) -> bool:
    """An upload from before July 2026, which wrote its own date onto the dog."""
    return isinstance(cert, dict) and not any(cert.get(k) for k in ("status", "pending_expires_on", "reviewed_at", "uploaded_by_admin"))


def approved_cert_on_file(cert: Any) -> Optional[Dict[str, Any]]:
    """The approved certificate this entry stands for: itself, or — while a
    renewal waits — the one it replaces. Same test as a top-level cert."""
    if not isinstance(cert, dict):
        return None
    if cert.get("status") == "approved":
        return cert
    before = cert.get("approved_before")
    if is_cert_pending(cert) and isinstance(before, dict) and before.get("status") == "approved":
        return before
    return None


def renewal_entry(prior: Any, *, photos: List[str], expires_on: str, uploader: str, now: str) -> Dict[str, Any]:
    """A client upload awaiting review, carrying the certificate it would
    replace. A second upload while one waits carries the same stash forward;
    an entry nobody approved is never stashed (it would come back on reject)."""
    entry: Dict[str, Any] = {
        "photo": photos[0], "photos": photos, "uploaded_at": now, "uploaded_by": uploader,
        "expires_on": expires_on,          # shown in admin queue
        "pending_expires_on": expires_on,  # only applied on review
        "status": "pending_review",
    }
    stash = None
    if was_reviewed(prior):
        stash = {k: v for k, v in prior.items() if k != "approved_before"}
    elif is_cert_pending(prior):
        stash = prior.get("approved_before")
    if isinstance(stash, dict) and stash:
        entry["approved_before"] = stash
    return entry


def cert_filter(vaccine: str, cert: Any) -> Dict[str, Any]:
    """Match this vaccine's entry only while it is still the one we read."""
    path = f"vaccine_certs.{vaccine}"
    if not isinstance(cert, dict):
        return {path: cert}   # None also matches a missing entry
    return {f"{path}.uploaded_at": cert.get("uploaded_at"), f"{path}.reviewed_at": cert.get("reviewed_at"),
            f"{path}.status": cert.get("status")}


def review_context(cert: Dict[str, Any], on_file: Any) -> Dict[str, Any]:
    """What the reviewer needs beside the upload (no photos)."""
    before = cert.get("approved_before") if isinstance(cert, dict) else None
    return {"approved_on_file": isinstance(before, dict) and bool(before),
            "approved_before_expires_on": str((before or {}).get("expires_on") or "")[:10] if isinstance(before, dict) else "",
            "on_file_expires_on": str(on_file or "")[:10]}


async def store_client_upload(db, dog_id: str, vaccine: str, *, photos: List[str], expires_on: str,
                              uploader: str, now_iso) -> Dict[str, Any]:
    """Write one vaccine's renewal without touching the others, and never over
    a change made since we read it (a review, another upload)."""
    for _ in range(3):
        dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
        if not dog:
            raise HTTPException(status_code=404, detail="Dog not found")
        certs = dog.get("vaccine_certs")
        if not isinstance(certs, dict):
            await db.dogs.update_one({"id": dog_id, "vaccine_certs": {"$not": {"$type": "object"}}}, {"$set": {"vaccine_certs": {}}})
            certs = {}
        prior = certs.get(vaccine)
        entry = renewal_entry(prior, photos=photos, expires_on=expires_on, uploader=uploader, now=now_iso())
        if len(bson.encode({**dog, "vaccine_certs": {**certs, vaccine: entry}})) > MAX_DOG_BYTES:
            raise HTTPException(status_code=400, detail="These files are too large to keep next to the certificate already on file. "
                                                        "Please upload smaller photos (or a photo instead of a large PDF).")
        res = await db.dogs.update_one({"id": dog_id, **cert_filter(vaccine, prior)}, {"$set": {f"vaccine_certs.{vaccine}": entry}})
        if res.matched_count:
            return entry
    raise HTTPException(status_code=409, detail="This dog's record changed while you were uploading. Please try again.")
