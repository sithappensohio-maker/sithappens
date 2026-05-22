"""Verify the full checkout flow → P&L accuracy:
1. Inject an 'approved' booking with NO price (worst case = relying on fallback)
2. Verify P&L picks up the estimate
3. Set actual_price on the booking (simulates checkout completion)
4. Verify P&L uses the real actual_price, not the fallback estimate

This is the user's actual concern: "make sure it's right once they get checked out".
"""
import asyncio, os, sys, uuid
from datetime import date
import httpx
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, "/app/backend")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
API_URL = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


async def get_token():
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{API_URL}/api/auth/login",
                         json={"email": "admin@sithappens.com", "password": "admin123"})
        return r.json()["token"]


async def get_pnl(token):
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{API_URL}/api/admin/today-pnl",
                        headers={"Authorization": f"Bearer {token}"})
        return r.json()


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    token = await get_token()
    today = date.today().isoformat()

    baseline = await get_pnl(token)
    base_rev = baseline["revenue"]
    print(f"Baseline:         ${base_rev:.2f}")

    # Step 1: Inject approved daycare with NO price set (fallback = $35)
    bid = str(uuid.uuid4())
    await db.bookings.insert_one({
        "id": bid, "_checkout_test": True, "date": today, "status": "approved",
        "service_type": "daycare", "dog_name": "CheckoutBuddy",
        "client_name": "Test", "dog_id": "x", "client_id": "x",
    })
    after_approve = await get_pnl(token)
    contrib_estimate = after_approve["revenue"] - base_rev
    print(f"After approved (no price set):  ${after_approve['revenue']:.2f}  → contribution: ${contrib_estimate:.2f}  (fallback estimate)")

    # Step 2: Simulate checkout — set actual_price + status=completed
    await db.bookings.update_one({"id": bid}, {"$set": {
        "actual_price": 42.50,  # an unusual amount that differs from $35 fallback
        "status": "completed",
        "checked_out_at": "2026-05-22T17:00:00Z",
    }})
    after_checkout = await get_pnl(token)
    contrib_real = after_checkout["revenue"] - base_rev
    print(f"After checkout (actual_price=$42.50, status=completed):  ${after_checkout['revenue']:.2f}  → contribution: ${contrib_real:.2f}")
    print(f"Completed count: {after_checkout['completed_count']} (should be ≥1)")

    # Cleanup
    await db.bookings.delete_many({"_checkout_test": True})

    estimate_ok = abs(contrib_estimate - 35.00) < 0.01
    real_ok = abs(contrib_real - 42.50) < 0.01
    completed_counted = after_checkout["completed_count"] > baseline["completed_count"]
    all_ok = estimate_ok and real_ok and completed_counted

    print(f"\nFallback estimate correct ($35): {'PASS' if estimate_ok else 'FAIL'}")
    print(f"Checkout overrides with $42.50:  {'PASS' if real_ok else 'FAIL'}")
    print(f"Completed booking counted:       {'PASS' if completed_counted else 'FAIL'}")
    print(f"\nOverall: {'PASS' if all_ok else 'FAIL'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
