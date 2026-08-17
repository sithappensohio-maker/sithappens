"""Step 4B-11P — run the READ-ONLY historical Stripe refund audit.

One command, safe anywhere (dev machine or the production box):

    python run_stripe_refund_audit.py

On the production Bazzite box, from the project folder, after `git pull`
(no rebuild needed — this never touches the running app):

    docker compose exec backend python run_stripe_refund_audit.py

STRICTLY READ-ONLY. This script and the reconciliation module it calls
contain no write path: no repair, no _finalize_stripe_refund call, no
insert/update/delete, no Stripe API call. It proves that itself by
fingerprinting (count + amount-sum) every collection it reads before and
after, running the audit TWICE, and refusing to emit artifacts unless the
fingerprints are identical and both runs match.

Artifacts are written next to this script, named for the audited database
so a dev run can never masquerade as production:

    stripe_refund_reconciliation_<DBNAME>_dry_run.json / .csv

No secrets, card data, or keys are included — only the structured
identifiers the Step 4B-11 report format requires.
"""
import asyncio
import csv
import json
import os
import sys

import server  # noqa: E402 — loads .env config; NEVER run with _test_env here
from stripe_refund_reconciliation import run_dry_run_audit

CSV_COLUMNS = [
    "payment_id", "classification", "reason", "original_amount",
    "recorded_refunded_amount", "proven_refunded_amount",
    "represented_reversal_amount", "missing_reversal_amount",
    "safe_tax_reversal", "tax_resolution", "original_revenue_row_exists",
    "payment_source_kind", "stripe_refund_ids", "missing_attempt_ids",
    "refund_succeeded_timestamps", "proposed_repair",
]


async def _fingerprint():
    out = {}
    for coll, sum_field in (("payments", "refunded_amount"),
                            ("retail_sales", "amount"),
                            ("stripe_refund_attempts", "amount_cents")):
        c = await getattr(server.db, coll).count_documents({})
        agg = await getattr(server.db, coll).aggregate(
            [{"$group": {"_id": None, "s": {"$sum": f"${sum_field}"}}}]).to_list(1)
        out[coll] = (c, round(float((agg[0]["s"] if agg else 0) or 0), 4))
    return out


async def main() -> int:
    db_name = server.db.name
    print("== Sit Happens Stripe refund reconciliation DRY RUN (read-only) ==")
    print(f"database: {db_name}")
    print(f"collections: payments / retail_sales / stripe_refund_attempts")

    before = await _fingerprint()
    for coll, (count, checksum) in before.items():
        print(f"  before  {coll}: count={count} amount_sum={checksum}")

    first = await run_dry_run_audit(server.db)
    second = await run_dry_run_audit(server.db)
    after = await _fingerprint()

    zero_writes = before == after
    repeatable = first == second
    print(f"zero-write proof (fingerprints identical): {zero_writes}")
    print(f"repeatable (two runs identical): {repeatable}")
    if not (zero_writes and repeatable):
        print("❌ Aborting artifact write — audit invariants violated.")
        return 1

    print(json.dumps(first["summary"], indent=1))
    out_dir = os.path.dirname(os.path.abspath(__file__))
    base = os.path.join(out_dir, f"stripe_refund_reconciliation_{db_name}_dry_run")
    payload = {"database": db_name, "fingerprints_before": {k: list(v) for k, v in before.items()},
               "fingerprints_after": {k: list(v) for k, v in after.items()},
               **first}
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    with open(base + ".csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for r in first["results"]:
            w.writerow([r.get(c) for c in CSV_COLUMNS])
    print(f"artifacts: {base}.json / .csv")
    return 0


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    sys.exit(loop.run_until_complete(main()))
