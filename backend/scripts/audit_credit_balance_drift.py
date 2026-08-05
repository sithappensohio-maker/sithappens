"""Read-only audit — for every client, compares their displayed balance
(credits/training_credits/boarding_credits) against the sum of their own
active credit_lots.qty_remaining for that pool, and reports every mismatch
in EITHER direction.

Two known causes so far:
  - displayed HIGHER than lots (e.g. 13 vs 0): a balance manually set via
    the client edit form with no backing lot minted (see
    _mint_manual_credit_lot in server.py, and
    scripts/backfill_unbacked_client_credits.py for the fix/backfill).
  - displayed LOWER than lots (e.g. 9 vs 10, lot untouched): something
    decremented the aggregate balance WITHOUT going through
    _consume_credit_lots (which always pairs a lot decrement with the
    matching client decrement in the same call). Root cause not yet
    isolated — this audit exists to find every instance so the pattern
    can be spotted from real data instead of one client at a time.

Makes NO writes. Safe to run anytime, as often as needed, against
production or any environment.

Usage:
    python scripts/audit_credit_balance_drift.py
    python scripts/audit_credit_balance_drift.py --client-id <id>   # one client only
    python scripts/audit_credit_balance_drift.py --csv out.csv      # also write a CSV
"""
import asyncio
import csv as csv_module
import os
import sys

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient

POOL_TO_SERVICE_TYPE = {"credits": "daycare", "training_credits": "training", "boarding_credits": "boarding"}


def _load_env():
    env = dict(os.environ)
    for candidate in ("/app/backend/.env", os.path.join(os.path.dirname(__file__), "..", ".env")):
        if os.path.isfile(candidate):
            for line in open(candidate):
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    env.setdefault(k, v.strip('"'))
            break
    return env


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


async def main():
    client_id_filter = _opt("--client-id")
    csv_path = _opt("--csv")

    env = _load_env()
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    query = {"id": client_id_filter} if client_id_filter else {}
    clients = await db.clients.find(query, {"_id": 0, "id": 1, "name": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1}).to_list(100000)
    if client_id_filter and not clients:
        print(f"No client with id={client_id_filter!r} found in {db_name}.")
        sys.exit(1)

    rows = []
    over_count = 0    # displayed > lots (unbacked balance — can't redeem)
    under_count = 0   # displayed < lots (lot has more than client shows — some other bug)
    for client in clients:
        for pool_field, service_type in POOL_TO_SERVICE_TYPE.items():
            displayed = round(float(client.get(pool_field) or 0), 2)
            lots = await db.credit_lots.find(
                {"client_id": client["id"], "service_type": service_type, "qty_remaining": {"$gt": 0}},
                {"_id": 0, "qty_remaining": 1},
            ).to_list(1000)
            backed = round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)
            diff = round(displayed - backed, 2)
            if abs(diff) <= 0.0001:
                continue
            direction = "OVER (unbacked balance)" if diff > 0 else "UNDER (lot has more than shown)"
            if diff > 0:
                over_count += 1
            else:
                under_count += 1
            rows.append({
                "client_id": client["id"], "client_name": client.get("name") or "",
                "pool": pool_field, "displayed": displayed, "backed_by_lots": backed,
                "diff": diff, "direction": direction,
            })
            print(f"{client.get('name')!r} (id={client['id']})  {pool_field}: displayed={displayed}  lots={backed}  diff={diff:+}  [{direction}]")

    print()
    print(f"Total mismatches: {len(rows)}  (over: {over_count}, under: {under_count})")

    if csv_path:
        with open(csv_path, "w", newline="") as f:
            w = csv_module.DictWriter(f, fieldnames=["client_id", "client_name", "pool", "displayed", "backed_by_lots", "diff", "direction"])
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {csv_path}")


asyncio.run(main())
