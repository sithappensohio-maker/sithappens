"""Sprint 110ce — Sell Training Program auto-creates weekly bookings.

The operator picks a day-of-week + time when selling a training program; the
system auto-creates N prepaid weekly bookings (one per credit) on that slot.
Closed business dates are skipped (rolling +7 days) unless the admin overrides.
Reschedule moves a session to the next available same-weekday slot without
touching the credit lot."""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def fx(admin_headers):
    """Client + dog + 4-session private-lessons program (so qty=4 weekly sessions)."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Schedule Pytest {suffix}",
        "email": f"sched-{suffix}@sithappens.com",
    }, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "name": f"Sched Dog {suffix}",
        "owner_id": client["id"],
        "breed": "Mix",
        "age_y": 2,
    }, timeout=15).json()
    program = requests.post(f"{API}/programs", headers=admin_headers, json={
        "name": f"Pytest Sched Program {suffix}",
        "type": "private_lessons",
        "format": {"count": 4, "unit": "sessions"},
        "price": 400.00,
        "modules": [],
    }, timeout=15).json()
    # Board-and-train sibling so we can prove the scheduler is suppressed
    bt_program = requests.post(f"{API}/programs", headers=admin_headers, json={
        "name": f"Pytest BT {suffix}",
        "type": "board_train",
        "format": {"count": 14, "unit": "days"},
        "price": 2000.00,
    }, timeout=15).json()

    yield {
        "client_id": client["id"], "dog_id": dog["id"],
        "program_id": program["id"], "bt_program_id": bt_program["id"],
        "qty": 4,
    }

    try:
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv("/app/backend/.env")

        async def _wipe():
            mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = mc[os.environ["DB_NAME"]]
            await db.clients.delete_one({"id": client["id"]})
            await db.dogs.delete_many({"owner_id": client["id"]})
            await db.credit_lots.delete_many({"client_id": client["id"]})
            await db.dog_programs.delete_many({"dog_id": dog["id"]})
            await db.bookings.delete_many({"client_id": client["id"]})
            await db.retail_sales.delete_many({"client_id": client["id"]})
            await db.programs.delete_one({"id": program["id"]})
            await db.programs.delete_one({"id": bt_program["id"]})
            mc.close()

        asyncio.run(_wipe())
    except Exception:
        pass


# ----------------------------------------------------------------------

def test_sell_program_without_schedule_does_not_create_bookings(admin_headers, fx):
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={"program_id": fx["program_id"], "dog_id": fx["dog_id"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scheduled_bookings"] == []
    assert body["schedule_warnings"] == []


def test_sell_program_with_schedule_creates_n_weekly_bookings(admin_headers, fx):
    """Picking day-of-week + time should create exactly `qty` bookings, each
    7 days apart, all $0 (prepaid), tagged with the lot id + session index."""
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={
                          "program_id": fx["program_id"],
                          "dog_id": fx["dog_id"],
                          "schedule_day_of_week": 1,   # Tuesday
                          "schedule_time": "10:00",
                      }, timeout=15)
    assert r.status_code == 200, r.text
    bks = r.json()["scheduled_bookings"]
    assert len(bks) == fx["qty"], f"Expected {fx['qty']} bookings, got {len(bks)}"

    # All on Tuesday, all 10:00, all $0, all linked to the lot, indexed 1..N
    lot_id = r.json()["lot"]["id"]
    dates = [b["date"] for b in bks]
    sorted_dates = sorted(dates)
    for i, d in enumerate(sorted_dates):
        dt = date.fromisoformat(d)
        assert dt.weekday() == 1, f"Booking {d} is not a Tuesday (weekday={dt.weekday()})"
    # Each consecutive pair must be exactly 7 days apart
    for a, b in zip(sorted_dates, sorted_dates[1:]):
        assert (date.fromisoformat(b) - date.fromisoformat(a)).days == 7
    for b in bks:
        assert b["time"] == "10:00"
        assert b["actual_price"] == 0.0
        assert b["payment_status"] == "paid"
        assert b["payment_method"] == "credits"
        assert b["is_prepaid_program_session"] is True
        assert b["credit_lot_id"] == lot_id
        assert b["program_sale_session_total"] == fx["qty"]
        assert 1 <= b["program_sale_session_index"] <= fx["qty"]
        assert b["status"] == "approved"


def test_board_and_train_schedule_fields_are_ignored(admin_headers, fx):
    """Even if the operator passes scheduling fields for a Board & Train
    program, no weekly bookings should be created — the dog is on-site."""
    r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                      headers=admin_headers,
                      json={
                          "program_id": fx["bt_program_id"],
                          "dog_id": fx["dog_id"],
                          "schedule_day_of_week": 1,
                          "schedule_time": "10:00",
                      }, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["scheduled_bookings"] == []


def test_closed_dates_are_skipped_with_warnings(admin_headers, fx):
    """If a generated date falls on a business-closed day, it's pushed forward
    7 days. The response includes a warning per skipped date so the operator
    sees what happened."""
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv("/app/backend/.env")

    # Pick a Tuesday 2-3 weeks out and mark it closed
    today = date.today()
    tues = today + timedelta(days=((1 - today.weekday()) % 7) + 14)  # 2 Tuesdays out
    closed_iso = tues.isoformat()

    async def _add_closed():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        cur = await db.settings.find_one({"_id": "main"}, {"_id": 0, "closed_dates": 1}) or {}
        closed = list(cur.get("closed_dates") or [])
        if closed_iso not in closed:
            closed.append(closed_iso)
        await db.settings.update_one(
            {"_id": "main"},
            {"$set": {"closed_dates": closed}},
            upsert=True,
        )
        mc.close()
        return closed

    async def _remove_closed():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        cur = await db.settings.find_one({"_id": "main"}, {"_id": 0, "closed_dates": 1}) or {}
        closed = [d for d in (cur.get("closed_dates") or []) if d != closed_iso]
        await db.settings.update_one({"_id": "main"}, {"$set": {"closed_dates": closed}})
        mc.close()

    asyncio.run(_add_closed())
    try:
        # Start scheduling from today's Tuesday so the closed Tuesday lands in range
        start = (today + timedelta(days=((1 - today.weekday()) % 7))).isoformat()
        r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                          headers=admin_headers,
                          json={
                              "program_id": fx["program_id"],
                              "dog_id": fx["dog_id"],
                              "schedule_day_of_week": 1,
                              "schedule_time": "10:00",
                              "schedule_start_date": start,
                          }, timeout=15)
        assert r.status_code == 200, r.text
        bks = r.json()["scheduled_bookings"]
        warns = r.json()["schedule_warnings"]
        assert len(bks) == fx["qty"], "Should still get qty bookings after rolling past closure"
        # The closed date must not appear in any booking
        for b in bks:
            assert b["date"] != closed_iso
        # And the warning should reference the closed date
        assert any(w["date"] == closed_iso and w["reason"] == "business_closed" for w in warns)
    finally:
        asyncio.run(_remove_closed())


def test_override_closures_books_anyway(admin_headers, fx):
    """When override_closures=True, the closed date is included in the
    weekly bookings (admin took responsibility)."""
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv("/app/backend/.env")

    today = date.today()
    tues = today + timedelta(days=((1 - today.weekday()) % 7) + 7)  # next Tuesday +1 week
    closed_iso = tues.isoformat()

    async def _add():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        cur = await db.settings.find_one({"_id": "main"}, {"_id": 0, "closed_dates": 1}) or {}
        closed = list(cur.get("closed_dates") or [])
        if closed_iso not in closed:
            closed.append(closed_iso)
        await db.settings.update_one({"_id": "main"}, {"$set": {"closed_dates": closed}}, upsert=True)
        mc.close()

    async def _remove():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        cur = await db.settings.find_one({"_id": "main"}, {"_id": 0, "closed_dates": 1}) or {}
        closed = [d for d in (cur.get("closed_dates") or []) if d != closed_iso]
        await db.settings.update_one({"_id": "main"}, {"$set": {"closed_dates": closed}})
        mc.close()

    asyncio.run(_add())
    try:
        start = (today + timedelta(days=((1 - today.weekday()) % 7))).isoformat()
        r = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                          headers=admin_headers,
                          json={
                              "program_id": fx["program_id"],
                              "dog_id": fx["dog_id"],
                              "schedule_day_of_week": 1,
                              "schedule_time": "10:00",
                              "schedule_start_date": start,
                              "schedule_override_closures": True,
                          }, timeout=15)
        assert r.status_code == 200
        dates_out = [b["date"] for b in r.json()["scheduled_bookings"]]
        assert closed_iso in dates_out, "Override should include the closed date"
        assert r.json()["schedule_warnings"] == []
    finally:
        asyncio.run(_remove())


def test_reschedule_moves_to_next_available_week(admin_headers, fx):
    """Reschedule endpoint moves a prepaid session forward to the next open
    same-weekday date, without touching the credit lot."""
    sell = requests.post(f"{API}/clients/{fx['client_id']}/sell-program",
                         headers=admin_headers,
                         json={
                             "program_id": fx["program_id"],
                             "dog_id": fx["dog_id"],
                             "schedule_day_of_week": 1,
                             "schedule_time": "10:00",
                         }, timeout=15).json()
    first_booking = sorted(sell["scheduled_bookings"], key=lambda b: b["date"])[0]
    lot_id_before = sell["lot"]["id"]
    credits_before = sell["client_balance"]

    r = requests.post(f"{API}/bookings/{first_booking['id']}/reschedule-next-week",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    moved = r.json()["booking"]
    assert moved["date"] != first_booking["date"]
    # Must still be a Tuesday
    assert date.fromisoformat(moved["date"]).weekday() == 1

    # Credits unchanged
    cur_client = requests.get(f"{API}/clients/{fx['client_id']}",
                              headers=admin_headers, timeout=15).json()
    assert (cur_client.get("training_credits") or 0) == credits_before

    # Lot still has the same qty_remaining
    breakdown = requests.get(f"{API}/admin/clients/{fx['client_id']}/training-credits",
                             headers=admin_headers, timeout=15).json()
    matching = [p for p in breakdown["by_program"] if p["program_id"] == fx["program_id"]]
    assert matching and matching[0]["qty_remaining"] >= fx["qty"], \
        "Reschedule must not consume any credits"
    # Sanity: lot id back-link is still on the moved booking
    assert moved["credit_lot_id"] == lot_id_before


def test_reschedule_only_works_on_prepaid_program_sessions(admin_headers, fx):
    """Calling reschedule on a normal (non-program) booking should 400."""
    # Create a plain booking using the fixture dog (so client lookup succeeds)
    far_date = (date.today() + timedelta(days=30)).isoformat()
    bk_resp = requests.post(f"{API}/bookings", headers=admin_headers, json={
        "dog_id": fx["dog_id"],
        "date": far_date,
        "service_type": "daycare",
        "override_vaccines": True,
        "override_capacity": True,
    }, timeout=15)
    assert bk_resp.status_code == 200, bk_resp.text
    bk = bk_resp.json()
    # Some endpoints return the row directly, others wrap it; be defensive
    bk_id = bk.get("id") or (bk.get("booking") or {}).get("id")
    assert bk_id, f"Could not find booking id in response: {bk}"
    r = requests.post(f"{API}/bookings/{bk_id}/reschedule-next-week",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 400, r.text


def test_admin_required():
    r = requests.post(f"{API}/bookings/abc/reschedule-next-week", timeout=15)
    assert r.status_code in (401, 403)
