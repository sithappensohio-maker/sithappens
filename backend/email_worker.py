"""Dedicated email-outbox worker.

Runs as its OWN single-instance process, separate from the FastAPI backend
(`uvicorn server:app --workers 2`) and separate from `daily_jobs.automation_loop`
(dead code, never started) / `maybe_run_daily` (birthdays, vaccines, homework
reminders, trainer digests, P&L jobs — triggered lazily from server.py's
/dashboard/stats handler). This process calls ONLY `process_email_outbox()`.
"""
import asyncio
import logging
import os
import signal
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import email_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("email_worker")

INTERVAL_SECONDS = int(os.environ.get("EMAIL_WORKER_INTERVAL_SECONDS", "60"))

_shutdown = asyncio.Event()


def _handle_signal(signum, frame):
    logger.info("Received signal %s — finishing current cycle then stopping", signum)
    _shutdown.set()


async def run() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    email_service.set_db(db)
    logger.info("Email outbox worker started (interval=%ss, db=%s)", INTERVAL_SECONDS, db_name)

    while not _shutdown.is_set():
        try:
            result = await email_service.process_email_outbox(db)
            if result.get("sent") or result.get("failed") or result.get("stamped"):
                logger.info("Outbox cycle: %s", result)
        except Exception:
            logger.exception("Outbox processing cycle failed — worker will retry next cycle")

        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass

    client.close()
    logger.info("Email outbox worker stopped")


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    asyncio.run(run())


if __name__ == "__main__":
    main()
