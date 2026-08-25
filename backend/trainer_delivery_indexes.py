"""Database integrity for enforced trainer delivery.

The session-draft collection already owns its own concurrency guard.  These
indexes cover only the additive trainer-delivery records so retries/double taps
cannot create duplicate excuses, daily closeouts, or audit rows.
"""
import logging

logger = logging.getLogger("sithappens")


def install_trainer_delivery_indexes(*, app, db) -> None:
    async def _ensure_indexes() -> None:
        try:
            await db.trainer_delivery_excuses.create_index(
                [("enrollment_id", 1), ("session_date", 1), ("slot", 1)],
                unique=True,
                name="uniq_trainer_delivery_excuse",
            )
            await db.trainer_delivery_day_closeouts.create_index(
                [("enrollment_id", 1), ("session_date", 1)],
                unique=True,
                name="uniq_trainer_delivery_day_closeout",
            )
            await db.trainer_delivery_audit.create_index(
                [("draft_id", 1)], unique=True, name="uniq_trainer_delivery_audit_draft"
            )
            await db.trainer_delivery_audit.create_index(
                [("occurrence_date", 1), ("trainer_id", 1)],
                name="trainer_delivery_compliance_by_day",
            )
        except Exception as exc:
            # Index setup should be visible, but a transient migration issue
            # should not take the entire self-hosted app offline at boot.
            logger.warning("Trainer Delivery index setup skipped (non-fatal): %s", exc)

    app.add_event_handler("startup", _ensure_indexes)
