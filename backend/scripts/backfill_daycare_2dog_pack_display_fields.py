"""Credit-pack customer-facing quantity fix — one-time backfill.

Sets display_quantity=10 / display_unit="day" / display_dog_count=2 on the
"Daycare 2 dogs 10 days" credit pack (qty=15 internal credits, since a
two-dog daycare day costs 1.5 credits). Never touches `qty`, `price`, or
any accounting field — see CreditPackIn's display_quantity docstring in
server.py for why these are presentation-only.

Safety guards (all enforced before any write):
  - Dry-run by default. Pass --apply to actually write.
  - No-op (exit 0, no write) if the pack already has the target fields.
  - Refuses to touch more than one matching pack automatically — if the
    name pattern matches multiple packs, it prints all of them and exits
    without writing. Re-run with --pack-id <id> to target exactly one.
  - Refuses to write if qty != 15 unless --allow-qty-mismatch is passed —
    a qty mismatch means this probably isn't the pack the bug report
    described, and applying the fix anyway would advertise a package size
    unrelated to the actual credit grant.

Usage (matches the existing scripts/migrate_credit_revenue_dryrun.py
convention — run from inside the backend container, or point MONGO_URL/
DB_NAME at whatever environment you're targeting):

    python scripts/backfill_daycare_2dog_pack_display_fields.py                       # dry run
    python scripts/backfill_daycare_2dog_pack_display_fields.py --apply               # writes
    python scripts/backfill_daycare_2dog_pack_display_fields.py --pack-id <id> --apply  # target one pack directly
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient

NAME_PATTERN = re.compile(r"daycare.*2\s*dogs?.*10\s*days?", re.IGNORECASE)
TARGET_FIELDS = {"display_quantity": 10, "display_unit": "day", "display_dog_count": 2}
EXPECTED_QTY = 15


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


async def main():
    apply = _flag("--apply")
    allow_qty_mismatch = _flag("--allow-qty-mismatch")
    pack_id = _opt("--pack-id")

    env = _load_env()
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    if pack_id:
        pack = await db.credit_packs.find_one({"id": pack_id}, {"_id": 0})
        if not pack:
            print(f"No credit pack with id={pack_id!r} found in {db_name}.")
            sys.exit(1)
        matches = [pack]
    else:
        candidates = await db.credit_packs.find({}, {"_id": 0}).to_list(2000)
        matches = [p for p in candidates if NAME_PATTERN.search(p.get("name") or "")]

        if not matches:
            print(f"No credit pack matching name pattern {NAME_PATTERN.pattern!r} found in {db_name}.")
            print("Nothing changed. Re-check the pack's exact name and re-run.")
            sys.exit(1)

        if len(matches) > 1:
            print(f"REFUSING: {len(matches)} packs matched {NAME_PATTERN.pattern!r} — refusing to update more than one automatically.")
            for p in matches:
                print(f"  id={p['id']}  name={p['name']!r}  qty={p.get('qty')}  price={p.get('price')}")
            print("\nNothing changed. Re-run with --pack-id <id> to target exactly one of the packs above.")
            sys.exit(2)

    pack = matches[0]
    print(f"Pack: {pack['name']!r} (id={pack['id']})  qty={pack.get('qty')}  price={pack.get('price')}")

    current = {k: pack.get(k) for k in TARGET_FIELDS}
    if current == TARGET_FIELDS:
        print("  Already backfilled — no change needed.")
        sys.exit(0)

    if pack.get("qty") != EXPECTED_QTY and not allow_qty_mismatch:
        print(f"  REFUSING: qty is {pack.get('qty')}, not the expected {EXPECTED_QTY} — this doesn't look like the pack from the bug report.")
        print("  Nothing changed. Re-run with --allow-qty-mismatch if you've confirmed this is the right pack.")
        sys.exit(3)
    if pack.get("qty") != EXPECTED_QTY:
        print(f"  WARNING: qty is {pack.get('qty')}, not the expected {EXPECTED_QTY} — proceeding because --allow-qty-mismatch was passed.")

    print(f"  Current display fields: {current}")
    print(f"  {'Setting' if apply else 'Would set'}: {TARGET_FIELDS}")
    if apply:
        await db.credit_packs.update_one({"id": pack["id"]}, {"$set": TARGET_FIELDS})
        print("  Done.")
    else:
        print("\nDry run only — no writes made. Re-run with --apply to write.")


asyncio.run(main())
