"""Test that today-pnl correctly prices bookings of every service_type
even when service_id/actual_price are missing (quick-add scenario).
"""
import asyncio, os, sys, uuid, json
from datetime import date, timedelta
import httpx
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, "/app/backend")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
API_URL = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


async def get_admin_token():
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{API_URL}/api/auth/login",
                         json={"email": "admin@sithappens.com", "password": "admin123"})
        return r.json()["token"]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    three_nights = (date.today() + timedelta(days=3)).isoformat()

    # Scenarios — bookings with service_type set but NO service_id, NO actual_price
    scenarios = [
        {"service_type": "daycare", "expected": 35.0, "end_date": None},
        {"service_type": "boarding", "expected": 55.0, "end_date": today},   # 1 night
        {"service_type": "boarding", "expected": 55.0 * 3, "end_date": three_nights},  # 3 nights
        {"service_type": "training", "expected": 150.0, "end_date": None},   # default = Service Dog Eval $150
        {"service_type": "grooming", "expected": 20.0, "end_date": None},    # default = Nail Trim $20
        {"service_type": "photography", "expected": 175.0, "end_date": None},
        {"service_type": "other", "expected": 22.0, "end_date": None},
    ]
    # Also verify priority chain: actual_price > credit_value > service_id > service_type default
    chain_scenarios = [
        {"label": "actual_price wins", "actual_price": 99.99, "credit_value": 50, "service_type": "daycare", "expected": 99.99},
        {"label": "credit_value when no actual", "credit_value": 42.50, "service_type": "daycare", "expected": 42.50},
    ]

    # Snapshot existing today-revenue to subtract from result
    token = await get_admin_token()
    async with httpx.AsyncClient() as c:
        # Measure baseline BEFORE inserting
        r0 = await c.get(f"{API_URL}/api/admin/today-pnl",
                         headers={"Authorization": f"Bearer {token}"})
        baseline = r0.json()
        pre_revenue = baseline["revenue"]
        pre_booked = baseline["booked_count"]
        print(f"Baseline (before injecting tests): ${pre_revenue:.2f} from {pre_booked} bookings")

    # Now inject test bookings
    test_ids = []
    expected_total = 0.0
    inserted = []
    for i, s in enumerate(scenarios):
        bid = str(uuid.uuid4())
        test_ids.append(bid)
        doc = {
            "id": bid, "_pnl_test": True, "date": today,
            "end_date": s.get("end_date"), "status": "approved",
            "service_type": s["service_type"], "dog_name": f"TestDog{i}",
            "client_name": "PnL Test", "dog_id": "test", "client_id": "test",
        }
        await db.bookings.insert_one(doc)
        expected_total += s["expected"]
        inserted.append((s, s["expected"]))

    for cs in chain_scenarios:
        bid = str(uuid.uuid4()); test_ids.append(bid)
        doc = {
            "id": bid, "_pnl_test": True, "date": today, "status": "approved",
            "service_type": cs["service_type"], "dog_name": cs["label"],
            "client_name": "Chain Test", "dog_id": "test", "client_id": "test",
        }
        if cs.get("actual_price") is not None: doc["actual_price"] = cs["actual_price"]
        if cs.get("credit_value") is not None: doc["credit_value"] = cs["credit_value"]
        await db.bookings.insert_one(doc)
        expected_total += cs["expected"]
        inserted.append((cs, cs["expected"]))

    async with httpx.AsyncClient() as c:
        r = await c.get(f"{API_URL}/api/admin/today-pnl",
                        headers={"Authorization": f"Bearer {token}"})
        data = r.json()
        total_revenue = data["revenue"]
        booked = data["booked_count"]

    print(f"\nAfter injecting {len(test_ids)} test bookings: ${total_revenue:.2f} from {booked} bookings")
    actual_contribution = total_revenue - pre_revenue
    print(f"Test contribution actual:   ${actual_contribution:.2f}")
    print(f"Test contribution expected: ${expected_total:.2f}")
    delta = abs(actual_contribution - expected_total)
    print(f"Delta: ${delta:.2f}")
    passed = delta < 0.01

    print("\n=== PER-SCENARIO EXPECTATIONS ===")
    for s in scenarios:
        et = s.get("end_date") or "—"
        print(f"  {s['service_type']:12} end_date={et:11} -> expected ${s['expected']:.2f}")
    for cs in chain_scenarios:
        print(f"  {cs['label']:30} -> expected ${cs['expected']:.2f}")

    # Cleanup
    res = await db.bookings.delete_many({"_pnl_test": True})
    print(f"\nCleaned up {res.deleted_count} test bookings.")

    print(f"\nResult: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
