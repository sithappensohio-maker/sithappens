"""Read-only — dumps everything relevant to one client's credit accounting:
their balance fields, EVERY credit_lots row (including fully-drained ones),
and every booking with any credit-related field set. Makes no writes.

Usage:
    python dump_client_credit_history.py --client-id <id>
"""
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


async def main():
    client_id = _opt("--client-id")
    if not client_id:
        print("Usage: python dump_client_credit_history.py --client-id <id>")
        sys.exit(1)

    env = dict(os.environ)
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        print(f"No client with id={client_id!r}")
        sys.exit(1)

    print("=" * 70)
    print(f"CLIENT: {client.get('name')!r} (id={client_id})")
    print(f"  credits={client.get('credits')}  training_credits={client.get('training_credits')}  boarding_credits={client.get('boarding_credits')}")
    print("=" * 70)

    print("\n--- ALL CREDIT LOTS (including fully drained) ---")
    lots = await db.credit_lots.find({"client_id": client_id}, {"_id": 0}).sort("purchased_at", 1).to_list(500)
    if not lots:
        print("  (none)")
    for l in lots:
        print(
            f"  [{l.get('service_type')}] {l.get('pack_name')!r}  "
            f"qty_total={l.get('qty_total')}  qty_remaining={l.get('qty_remaining')}  "
            f"purchased_at={l.get('purchased_at')}  price_paid={l.get('price_paid')}  "
            f"recognize_at_sale={l.get('recognize_at_sale')}  voided_at={l.get('voided_at')}"
        )

    print("\n--- BOOKINGS with any credit-related field set ---")
    bookings = await db.bookings.find(
        {
            "client_id": client_id,
            "$or": [
                {"credit_value": {"$gt": 0}},
                {"credits_deducted": {"$gt": 0}},
                {"credit_lot_ids": {"$exists": True, "$ne": []}},
            ],
        },
        {"_id": 0},
    ).sort("date", 1).to_list(500)
    if not bookings:
        print("  (none)")
    for b in bookings:
        print(
            f"  {b.get('date')}  [{b.get('service_type')}]  status={b.get('status')}  "
            f"checked_in_at={b.get('checked_in_at')}  checked_out_at={b.get('checked_out_at')}  "
            f"credit_value={b.get('credit_value')}  credits_deducted={b.get('credits_deducted')}  "
            f"actual_price={b.get('actual_price')}  payment_method={b.get('payment_method')}  "
            f"credit_lot_ids={b.get('credit_lot_ids')}"
        )
        redemptions = b.get("credit_lot_redemptions")
        if redemptions:
            print(f"    redemptions: {redemptions}")


asyncio.run(main())
