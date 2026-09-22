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
from typing import Any, Dict


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
