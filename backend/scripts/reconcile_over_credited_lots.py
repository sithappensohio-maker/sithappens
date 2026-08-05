"""Reconciliation — for clients where the sum of active credit_lots.qty_remaining
EXCEEDS the displayed client.credits/training_credits/boarding_credits balance
(the "UNDER" case from audit_credit_balance_drift.py), reduces the OLDEST
active lot(s) first (matching normal FIFO consumption order) until the lot
total matches the displayed balance.

Treats the displayed client balance as authoritative — real production data
showed it tracking 1-for-1 with actual completed bookings, while specific
lots had stopped decrementing despite genuine, correctly-recorded
redemptions against them (see _rollback_checkout_finances's new logging in
server.py for the leading theory: an HTTPException raised after a checkout
already committed its real work silently triggers a compensating rollback
that undoes the lot decrement, invisible in logs because the global
exception handler skips HTTPException). This script does NOT touch
client.credits/training_credits/boarding_credits at all — only credit_lots.

Dry-run by default. Pass --apply to write.

Usage:
    python reconcile_over_credited_lots.py                          # dry run, all clients
    python reconcile_over_credited_lots.py --apply                   # writes, all clients
    python reconcile_over_credited_lots.py --client-id <id> --apply   # one client only
"""
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

POOL_TO_SERVICE_TYPE = {"credits": "daycare", "training_credits": "training", "boarding_credits": "boarding"}


def _flag(name):
    return name in sys.argv


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


async def main():
    apply = _flag("--apply")
    client_id_filter = _opt("--client-id")

    env = dict(os.environ)
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    query = {"id": client_id_filter} if client_id_filter else {}
    clients = await db.clients.find(query, {"_id": 0, "id": 1, "name": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1}).to_list(100000)
    if client_id_filter and not clients:
        print(f"No client with id={client_id_filter!r} found in {db_name}.")
        sys.exit(1)

    affected = 0
    total_removed = 0.0
    for client in clients:
        for pool_field, service_type in POOL_TO_SERVICE_TYPE.items():
            displayed = round(float(client.get(pool_field) or 0), 2)
            lots = await db.credit_lots.find(
                {"client_id": client["id"], "service_type": service_type, "qty_remaining": {"$gt": 0}},
                {"_id": 0, "id": 1, "qty_remaining": 1, "purchased_at": 1, "pack_name": 1},
            ).sort("purchased_at", 1).to_list(1000)
            backed = round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)
            shortfall = round(backed - displayed, 2)  # positive = lots have MORE than displayed
            if shortfall <= 0.0001:
                continue

            affected += 1
            print(f"Client: {client.get('name')!r} (id={client['id']})  {pool_field}: displayed={displayed}  lots={backed}  excess={shortfall}")
            remaining_to_remove = shortfall
            for lot in lots:
                if remaining_to_remove <= 0.0001:
                    break
                current = round(float(lot.get("qty_remaining") or 0), 2)
                take = round(min(current, remaining_to_remove), 2)
                if take <= 0:
                    continue
                new_remaining = round(current - take, 2)
                print(f"  {'Reducing' if apply else 'Would reduce'} lot {lot['id']} ({lot.get('pack_name')!r}, purchased {lot.get('purchased_at')}): {current} -> {new_remaining}")
                if apply:
                    await db.credit_lots.update_one({"id": lot["id"]}, {"$set": {"qty_remaining": new_remaining}})
                remaining_to_remove = round(remaining_to_remove - take, 2)
                total_removed += take
            if remaining_to_remove > 0.0001:
                print(f"  WARNING: {remaining_to_remove} of the excess could not be absorbed by any active lot (ran out of lots to reduce).")

    print()
    print(f"Clients affected: {affected}")
    print(f"Total credit-units {'removed' if apply else 'that would be removed'} from lots: {round(total_removed, 2)}")
    if not apply:
        print("\nDry run only — no writes made. Re-run with --apply to write.")


asyncio.run(main())
