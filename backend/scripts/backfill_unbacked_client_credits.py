"""Backfill — mint a backing credit_lots record for any client whose
credits/training_credits/boarding_credits balance exceeds the sum of their
own active lots.

Real bug: redemption is entirely FIFO-lot-based (see server.py's
_consume_credit_lots). A client's displayed balance can be manually set
(client edit form's Credits field) with no matching credit_lots document —
checkout then silently finds nothing to consume and falls back to a full
cash charge, with no error and no balance change. server.py's
create_client/update_client now mint a backing lot automatically going
forward (see _mint_manual_credit_lot) — this script is the one-time catch-up
for clients already in that state.

IMPORTANT — do this FIRST if you know a specific client's displayed number
is wrong (e.g. because checkouts silently failed to deduct since the
balance was set): correct that client's number in the UI to what it should
actually be BEFORE running this script. This script backfills a lot
matching whatever is CURRENTLY displayed — it has no way to know a number
should be lower than what's shown. Running it before correcting a client
would lock in the wrong (too-high) number with a matching lot; correcting
the number afterward would not shrink that lot back down.

Dry-run by default (prints what it would change). Pass --apply to write.
Mints $0-value "Manual balance adjustment" lots (recognize_at_sale=True) —
identical in shape to what update_client/create_client mint automatically,
so no revenue is fabricated and future redemption works exactly like a
purchased pack.

Usage (matches the existing scripts/*.py convention — run from inside the
backend container, or point MONGO_URL/DB_NAME at whatever environment
you're targeting):

    python scripts/backfill_unbacked_client_credits.py            # dry run, all clients
    python scripts/backfill_unbacked_client_credits.py --apply     # writes, all clients
    python scripts/backfill_unbacked_client_credits.py --client-id <id> --apply   # one client only
"""
import asyncio
import os
import sys
import uuid

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


def _flag(name):
    return name in sys.argv


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def main():
    apply = _flag("--apply")
    client_id_filter = _opt("--client-id")

    env = _load_env()
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    query = {"id": client_id_filter} if client_id_filter else {}
    clients = await db.clients.find(query, {"_id": 0, "id": 1, "name": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1}).to_list(100000)
    if client_id_filter and not clients:
        print(f"No client with id={client_id_filter!r} found in {db_name}.")
        sys.exit(1)

    total_minted = 0.0
    affected_clients = 0
    for client in clients:
        client_shortfalls = []
        for pool_field, service_type in POOL_TO_SERVICE_TYPE.items():
            displayed = round(float(client.get(pool_field) or 0), 2)
            if displayed <= 0:
                continue
            lots = await db.credit_lots.find(
                {"client_id": client["id"], "service_type": service_type, "qty_remaining": {"$gt": 0}},
                {"_id": 0, "qty_remaining": 1},
            ).to_list(1000)
            backed = round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)
            shortfall = round(displayed - backed, 2)
            if shortfall > 0.0001:
                client_shortfalls.append((pool_field, service_type, displayed, backed, shortfall))

        if not client_shortfalls:
            continue
        affected_clients += 1
        print(f"Client: {client.get('name')!r} (id={client['id']})")
        for pool_field, service_type, displayed, backed, shortfall in client_shortfalls:
            print(f"  {pool_field}: displayed={displayed}  backed_by_lots={backed}  shortfall={shortfall}")
            print(f"  {'Minting' if apply else 'Would mint'} a {shortfall}-credit backing lot ({service_type}).")
            if apply:
                await db.credit_lots.insert_one({
                    "id": str(uuid.uuid4()),
                    "client_id": client["id"],
                    "pack_id": None,
                    "pack_name": "Manual balance adjustment",
                    "service_type": service_type,
                    "qty_total": shortfall,
                    "qty_remaining": shortfall,
                    "price_paid": 0.0,
                    "list_price": 0.0,
                    "price_override_id": None,
                    "value_each": 0.0,
                    "payment_method": None,
                    "note": "Backfilled — displayed balance had no backing lot (see backfill_unbacked_client_credits.py).",
                    "sold_by": "backfill_script",
                    "purchased_at": _now_iso(),
                    "recognize_at_sale": True,
                })
            total_minted += shortfall

    print()
    print(f"Clients affected: {affected_clients}")
    print(f"Total credit-units {'minted' if apply else 'that would be minted'}: {total_minted}")
    if not apply:
        print("\nDry run only — no writes made. Re-run with --apply to write.")


asyncio.run(main())
