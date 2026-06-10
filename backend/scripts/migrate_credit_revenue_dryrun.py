"""Sprint 110cs — Credit pack revenue recognition migration (DRY RUN, v2).

Correct field names:
  • credit_lots.price_paid  (full pack price)
  • credit_lots.purchased_at  (sale timestamp)
  • credit_lots.value_each   (per-credit nominal value)

NO WRITES. Just reports.
"""
import asyncio
import csv
import sys
from collections import defaultdict

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    env = {}
    for line in open("/app/backend/.env"):
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            env[k] = v.strip('"')
    db = AsyncIOMotorClient(env["MONGO_URL"])[env["DB_NAME"]]

    lots = await db.credit_lots.find({}, {"_id": 0}).to_list(100000)

    # Which lots are ALREADY accounted for in retail_sales (training programs)?
    # The sell-program flow stores `source_kind=training_program_sale` with a
    # reference back. We match by (client_id, price, purchased date) to be safe.
    existing_sales = await db.retail_sales.find(
        {"source_kind": "training_program_sale"}, {"_id": 0}
    ).to_list(100000)
    already_recognized_keys = set()
    for s in existing_sales:
        key = (s.get("client_id", ""),
               round(float(s.get("amount") or s.get("price") or 0), 2),
               (s.get("date") or "")[:10])
        already_recognized_keys.add(key)

    # Lots that need a new retail_sales row
    to_backfill = []
    skipped_already_recognized = 0
    for lot in lots:
        purchased_iso = lot.get("purchased_at") or ""
        purchased_date = purchased_iso[:10]
        key = (lot.get("client_id", ""),
               round(float(lot.get("price_paid") or 0), 2),
               purchased_date)
        if key in already_recognized_keys:
            skipped_already_recognized += 1
            continue
        to_backfill.append(lot)

    # Lookup client names
    cids = list({lot.get("client_id") for lot in to_backfill if lot.get("client_id")})
    cmap = {c["id"]: c for c in await db.clients.find(
        {"id": {"$in": cids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}
    ).to_list(100000)}

    # Bookings paid via credits that would be tagged. We use the SAME lot
    # set to avoid double-tagging training-program redemptions (which the
    # existing _is_program_credit_redemption already handles).
    target_lot_ids = {lot["id"] for lot in to_backfill}
    cred_bookings = await db.bookings.find(
        {"payment_method": "credits"}, {"_id": 0}
    ).to_list(100000)
    to_tag = [
        b for b in cred_bookings
        if any(lid in target_lot_ids for lid in (b.get("credit_lot_ids") or []))
        and not b.get("is_prepaid_program_session")
        and not b.get("is_prepaid_credit_session")
    ]

    # Aggregate per-client
    per_client = defaultdict(lambda: {
        "name": "", "email": "",
        "lots_count": 0, "total_pack_value": 0.0,
        "bookings_to_tag": 0, "booking_total_to_skip": 0.0,
    })
    total_backfill = 0.0
    sold_dates = []
    for lot in to_backfill:
        cid = lot.get("client_id", "")
        row = per_client[cid]
        row["name"] = cmap.get(cid, {}).get("name", "")
        row["email"] = cmap.get(cid, {}).get("email", "")
        val = float(lot.get("price_paid") or 0)
        row["lots_count"] += 1
        row["total_pack_value"] += val
        total_backfill += val
        d = (lot.get("purchased_at") or "")[:10]
        if d:
            sold_dates.append(d)

    bookings_total_currently_in_income = 0.0
    for b in to_tag:
        cid = b.get("client_id", "")
        row = per_client[cid]
        if not row["name"]:
            row["name"] = cmap.get(cid, {}).get("name", "")
            row["email"] = cmap.get(cid, {}).get("email", "")
        row["bookings_to_tag"] += 1
        ap = float(b.get("actual_price") or 0)
        row["booking_total_to_skip"] += ap
        bookings_total_currently_in_income += ap

    sold_dates.sort()
    earliest = sold_dates[0] if sold_dates else "—"
    latest = sold_dates[-1] if sold_dates else "—"

    print("=" * 70)
    print("CREDIT-PACK REVENUE RECOGNITION — DRY RUN SUMMARY (v2)")
    print("=" * 70)
    print(f"Total credit_lots in DB:                    {len(lots)}")
    print(f"  ├── Already in retail_sales (skip):       {skipped_already_recognized}")
    print(f"  └── To backfill:                          {len(to_backfill)}")
    print()
    print(f"$ to backfill into retail_sales:            ${total_backfill:,.2f}")
    print(f"Sale dates range:                           {earliest} → {latest}")
    print()
    print(f"Credit-paid bookings to tag (stop double-count):  {len(to_tag)}")
    print(f"$ currently in income that will leave:      ${bookings_total_currently_in_income:,.2f}")
    print()
    print(f"NET LIFETIME INCOME CHANGE:")
    print(f"  + ${total_backfill:,.2f}   (sales backfilled to original dates)")
    print(f"  - ${bookings_total_currently_in_income:,.2f}  (redemptions stop counting)")
    print(f"  = ${total_backfill - bookings_total_currently_in_income:+,.2f}")
    print()
    print(f"Distinct clients affected: {len(per_client)}")
    print()
    print("CREDIT BALANCES: ZERO CHANGE")
    print("  • credit_lots.qty_remaining: untouched")
    print("  • Client portal credit count: identical")
    print()
    print("CSV: /tmp/credit_migration_dryrun.csv")
    print("=" * 70)

    with open("/tmp/credit_migration_dryrun.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "client_id", "client_name", "client_email",
            "lots_to_backfill", "total_pack_value_$",
            "bookings_to_tag", "booking_value_leaving_income_$",
            "net_change_$",
        ])
        rows = sorted(per_client.items(), key=lambda kv: kv[1]["total_pack_value"], reverse=True)
        for cid, r in rows:
            w.writerow([
                cid, r["name"], r["email"],
                r["lots_count"], f"{r['total_pack_value']:.2f}",
                r["bookings_to_tag"], f"{r['booking_total_to_skip']:.2f}",
                f"{r['total_pack_value'] - r['booking_total_to_skip']:+.2f}",
            ])

    print(f"\nTop 10 clients by pack value:")
    for cid, r in rows[:10]:
        if r["lots_count"] == 0 and r["bookings_to_tag"] == 0:
            continue
        print(f"  {r['name'][:30]:30}  packs=${r['total_pack_value']:8.2f}  bookings_to_tag={r['bookings_to_tag']:3d}  net=${r['total_pack_value']-r['booking_total_to_skip']:+8.2f}")


asyncio.run(main())
