"""Sprint 110cv — Trivia leaderboard activity filter + rewards-progress + recent-winners.

Validates:
  1. /portal/trivia/leaderboard hides players inactive >7 days.
  2. Caller's own row surfaces as `me` even when inactive or never played.
  3. /portal/trivia/rewards-progress returns the milestone ladder + the
     caller's progress toward the next reward.
  4. /admin/trivia/recent-winners returns only pending (un-redeemed) perks
     earned within the requested window.
  5. New `admin_trivia_milestone` template is registered.
"""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import date, timedelta
from motor.motor_asyncio import AsyncIOMotorClient


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mongo():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _seed_player(name, attempt_dates, today_d):
    """Create a client + user + dog and seed their trivia_attempts. Returns
    (client_id, user_id, password)."""
    suffix = uuid.uuid4().hex[:6]
    cid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    email = f"{name.lower()}-{suffix}@e.com"
    password = "test1234"

    async def _do():
        import bcrypt
        db = _mongo()
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        await db.users.insert_one({
            "id": uid, "email": email, "name": name, "role": "client",
            "password_hash": hashed, "client_id": cid,
        })
        await db.clients.insert_one({
            "id": cid, "name": name, "email": email, "user_id": uid,
            "credits": 0, "training_credits": 0, "boarding_credits": 0,
            "created_at": "2026-06-10T00:00:00+00:00",
        })
        await db.dogs.insert_one({
            "id": str(uuid.uuid4()), "name": f"{name}Dog", "client_id": cid,
            "owner_id": cid, "breed": "Mix", "age_y": 3,
            "created_at": "2026-06-10T00:00:00+00:00",
        })
        for d in attempt_dates:
            await db.trivia_attempts.insert_one({
                "id": str(uuid.uuid4()), "client_id": cid,
                "date": d, "question_id": "seed-q",
                "chosen_index": 0, "correct": True,
                "answered_at": d + "T12:00:00",
            })

    asyncio.run(_do())
    return cid, uid, email, password


def _login(email, password):
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": password},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_leaderboard_filters_inactive_players(admin_headers):
    today_d = date.today()
    # Active player: answered today + yesterday (2-day streak)
    active_dates = [(today_d - timedelta(days=i)).isoformat() for i in range(2)]
    _, _, active_email, active_pw = _seed_player("LBActive", active_dates, today_d)

    # Inactive player: only answered 10 days ago
    stale_d = [(today_d - timedelta(days=10)).isoformat()]
    inactive_cid, _, inactive_email, inactive_pw = _seed_player("LBStale", stale_d, today_d)

    # Active player logs in + reads the board — should see themself, NOT the
    # stale one.
    active_hdrs = _login(active_email, active_pw)
    lb = requests.get(f"{API}/portal/trivia/leaderboard", headers=active_hdrs, timeout=15).json()
    top_cids = {r["client_id"] for r in lb.get("top", [])}
    assert inactive_cid not in top_cids, "Inactive player must be filtered from the top"
    # The activity hint should be in the response
    assert lb.get("inactive_after_days") == 7


def test_leaderboard_me_surfaces_for_inactive_caller(admin_headers):
    today_d = date.today()
    stale_d = [(today_d - timedelta(days=15)).isoformat()]
    _, _, stale_email, stale_pw = _seed_player("LBSelf", stale_d, today_d)

    hdrs = _login(stale_email, stale_pw)
    lb = requests.get(f"{API}/portal/trivia/leaderboard", headers=hdrs, timeout=15).json()
    me = lb.get("me")
    assert me is not None, "Inactive caller must still see their own `me` row"
    # Either rank is None (filtered out) or set — both are acceptable; the
    # critical guarantee is that `me` is present.
    assert me.get("is_me") is True


def test_rewards_progress_returns_ladder_and_next(admin_headers):
    today_d = date.today()
    # Seed a player with a 5-day streak (today + 4 prior consecutive days)
    streak_dates = [(today_d - timedelta(days=i)).isoformat() for i in range(5)]
    _, _, email, pw = _seed_player("RPLadder", streak_dates, today_d)

    hdrs = _login(email, pw)
    rp = requests.get(f"{API}/portal/trivia/rewards-progress", headers=hdrs, timeout=15).json()
    assert isinstance(rp.get("rewards"), list) and len(rp["rewards"]) > 0
    assert rp.get("current_streak") == 5, (
        f"Expected 5-day current streak, got {rp.get('current_streak')}"
    )
    # Next milestone must be the smallest reward whose days > 5 (default
    # ladder starts at 7).
    nxt = rp.get("next_milestone")
    assert nxt and nxt["days"] >= 7, f"Expected next milestone ≥7d, got {nxt}"
    assert nxt["days_remaining"] == nxt["days"] - 5


def test_recent_winners_lists_pending_only(admin_headers):
    today_d = date.today()
    today_iso = today_d.isoformat()
    cid = str(uuid.uuid4())
    suffix = uuid.uuid4().hex[:6]

    async def _seed():
        db = _mongo()
        await db.clients.insert_one({
            "id": cid, "name": f"PerkPending {suffix}", "credits": 0,
            "created_at": "2026-06-10T00:00:00+00:00",
            "trivia_milestones": [
                {"days": 7, "earned_on": today_iso, "label": "🐾 7-day"},
                {"days": 14, "earned_on": today_iso, "label": "🦴 14-day",
                 "redeemed_at": today_iso + "T10:00:00"},
            ],
        })

    asyncio.run(_seed())

    rw = requests.get(f"{API}/admin/trivia/recent-winners",
                      headers=admin_headers,
                      params={"days_back": 30, "limit": 50},
                      timeout=15).json()
    pending = rw.get("pending", [])
    # Our pending perk must be present, the already-redeemed one must not.
    matching = [p for p in pending
                if p.get("client_id") == cid and p.get("days") == 7]
    assert len(matching) == 1, (
        f"Expected one pending 7-day perk for our seeded client, "
        f"got {matching}"
    )
    redeemed_listed = any(p.get("client_id") == cid and p.get("days") == 14
                          for p in pending)
    assert not redeemed_listed, "Redeemed perks must NOT appear in pending list"


def test_admin_trivia_milestone_template_registered(admin_headers):
    templates = requests.get(f"{API}/admin/email-templates",
                             headers=admin_headers, timeout=15).json()
    slugs = {t.get("slug") for t in (templates or [])}
    assert "admin_trivia_milestone" in slugs, \
        "admin_trivia_milestone email template must be registered"
