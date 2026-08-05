"""For every client with an unbacked ("OVER") credit balance — displayed
higher than what any active lot backs — prints their current balance
alongside their recent COMPLETED bookings for that service type, showing
the date and how each was actually paid.

This does NOT compute a definitive "correct" number — a cash-paid visit
isn't always a missed deduction (a client can legitimately choose to pay
cash even with credits available), so only a human who knows the real
context can read this list and say "yes, these N visits should have used
credits." What this script guarantees is that you're looking at the
complete, real visit history for each affected client in one place instead
of hunting through the UI client by client.

Read-only. Makes no writes.

Usage:
    python suggest_over_client_corrections.py
    python suggest_over_client_corrections.py --client-id <id>   # one client only
"""
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

POOL_TO_SERVICE_TYPE = {"credits": "daycare", "training_credits": "training", "boarding_credits": "boarding"}


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


async def main():
    client_id_filter = _opt("--client-id")

    env = dict(os.environ)
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    query = {"id": client_id_filter} if client_id_filter else {}
    clients = await db.clients.find(query, {"_id": 0, "id": 1, "name": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1}).to_list(100000)

    any_found = False
    for client in clients:
        for pool_field, service_type in POOL_TO_SERVICE_TYPE.items():
            displayed = round(float(client.get(pool_field) or 0), 2)
            if displayed <= 0:
                continue
            lots = await db.credit_lots.find(
                {"client_id": client["id"], "service_type": service_type, "qty_remaining": {"$gt": 0}},
                {"_id": 0, "qty_remaining": 1},
            ).to_list(1000)
            backed = round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)
            if displayed - backed <= 0.0001:
                continue  # not an OVER case

            any_found = True
            print("=" * 70)
            print(f"{client.get('name')!r} (id={client['id']})  {pool_field}: displayed={displayed}  backed_by_lots={backed}  UNBACKED={round(displayed - backed, 2)}")
            print("-" * 70)
            bookings = await db.bookings.find(
                {"client_id": client["id"], "service_type": service_type, "status": "completed"},
                {"_id": 0, "date": 1, "payment_method": 1, "credits_deducted": 1, "actual_price": 1, "checked_out_at": 1},
            ).sort("date", 1).to_list(500)
            if not bookings:
                print("  (no completed bookings for this service type)")
            non_credit_count = 0
            for b in bookings:
                pm = b.get("payment_method")
                flag = ""
                if pm != "credits" and float(b.get("credits_deducted") or 0) <= 0:
                    non_credit_count += 1
                    flag = "  <-- paid cash/other, not credits"
                print(f"  {b.get('date')}  payment_method={pm}  actual_price={b.get('actual_price')}  credits_deducted={b.get('credits_deducted')}{flag}")
            print(f"\n  Total completed {service_type} visits: {len(bookings)}  |  Paid cash/other (not credits): {non_credit_count}")
            print(f"  If ALL {non_credit_count} of those were meant to use credits: displayed {displayed} - {non_credit_count} = suggested {round(displayed - non_credit_count, 2)}")
            print(f"  (This is a starting point, not a verdict — only you know if all/some/none of those cash visits were actually meant to draw from this balance.)")
            print()

    if not any_found:
        print("No unbacked ('OVER') client balances found.")


asyncio.run(main())
