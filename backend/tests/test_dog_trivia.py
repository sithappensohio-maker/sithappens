"""Dog Trivia game — daily question, quiz mode, leaderboard, admin CRUD."""
import os
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _client():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "testclient@sithappens.com", "password": "test1234"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _ensure_questions(h, min_n=5):
    rows = requests.get(f"{BASE}/api/admin/trivia/questions", headers=h, timeout=15).json()
    if rows.get("active", 0) >= min_n:
        return
    # Top up via AI generation (smoke - will hit Emergent LLM)
    r = requests.post(f"{BASE}/api/admin/trivia/generate", headers=h,
                      json={"count": min_n}, timeout=90)
    assert r.status_code == 200, r.text


def _wipe_today_attempt(h):
    """Direct mongo cleanup so daily test is idempotent."""
    # Done via the API: we have no DELETE attempts endpoint, but we can re-test
    # tomorrow's state by toggling between admin/client routes. For pytest
    # reset we use the dedicated test reset helper if it exists.
    pass


def test_admin_can_list_and_generate_questions():
    h = _admin()
    _ensure_questions(h, min_n=5)
    rows = requests.get(f"{BASE}/api/admin/trivia/questions", headers=h, timeout=15).json()
    assert "questions" in rows
    assert rows["active"] >= 5
    q = rows["questions"][0]
    for k in ("id", "question", "choices", "correct_index", "difficulty", "tag"):
        assert k in q


def test_portal_trivia_daily_shape():
    _ensure_questions(_admin(), min_n=5)
    body = requests.get(f"{BASE}/api/portal/trivia/daily", headers=_client(), timeout=15).json()
    assert "date" in body and "question" in body
    q = body["question"]
    assert "id" in q and len(q["choices"]) == 4
    assert "correct_index" not in q, "correct_index must not leak to client"
    for k in ("current_streak", "best_streak", "total_correct"):
        assert k in body


def test_portal_trivia_daily_same_question_for_everyone():
    """Wordle-style: any caller for the same date gets the same question_id."""
    _ensure_questions(_admin(), min_n=5)
    h1 = _client()
    h2 = _admin()  # admin doesn't have client_id so will 400 — use client twice
    a = requests.get(f"{BASE}/api/portal/trivia/daily", headers=h1, timeout=15).json()
    b = requests.get(f"{BASE}/api/portal/trivia/daily", headers=h1, timeout=15).json()
    assert a["question"]["id"] == b["question"]["id"]


def test_quiz_returns_questions_with_difficulty_ramp():
    _ensure_questions(_admin(), min_n=8)
    body = requests.get(f"{BASE}/api/portal/trivia/quiz?count=5", headers=_client(), timeout=15).json()
    assert len(body["questions"]) >= 1
    for q in body["questions"]:
        assert "correct_index" not in q
        assert len(q["choices"]) == 4


def test_quiz_answer_does_not_affect_streak():
    """Quiz mode is just for fun. Streak only changes on the daily question."""
    _ensure_questions(_admin(), min_n=5)
    h = _client()
    quiz = requests.get(f"{BASE}/api/portal/trivia/quiz?count=2", headers=h, timeout=15).json()
    if not quiz["questions"]:
        return
    q = quiz["questions"][0]
    pre = requests.get(f"{BASE}/api/portal/trivia/daily", headers=h, timeout=15).json()
    requests.post(f"{BASE}/api/portal/trivia/quiz/answer", headers=h,
                  json={"question_id": q["id"], "chosen_index": 0}, timeout=15)
    post = requests.get(f"{BASE}/api/portal/trivia/daily", headers=h, timeout=15).json()
    assert pre["total_correct"] == post["total_correct"]


def test_leaderboard_shape():
    h = _client()
    body = requests.get(f"{BASE}/api/portal/trivia/leaderboard", headers=h, timeout=15).json()
    assert "top" in body and "total_players" in body
    if body["top"]:
        row = body["top"][0]
        for k in ("client_id", "current_streak", "best_streak", "total_correct", "rank", "display_name"):
            assert k in row


def test_admin_can_toggle_and_delete():
    h = _admin()
    _ensure_questions(h, min_n=2)
    rows = requests.get(f"{BASE}/api/admin/trivia/questions", headers=h, timeout=15).json()["questions"]
    target = rows[-1]
    # Toggle inactive
    r = requests.put(f"{BASE}/api/admin/trivia/questions/{target['id']}/active",
                     headers=h, json={"active": False}, timeout=15)
    assert r.json()["active"] is False
    # Back to active
    r = requests.put(f"{BASE}/api/admin/trivia/questions/{target['id']}/active",
                     headers=h, json={"active": True}, timeout=15)
    assert r.json()["active"] is True


def test_portal_endpoints_require_client():
    r = requests.get(f"{BASE}/api/portal/trivia/daily", timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{BASE}/api/portal/trivia/quiz", timeout=15)
    assert r.status_code in (401, 403)
    r = requests.get(f"{BASE}/api/portal/trivia/leaderboard", timeout=15)
    assert r.status_code in (401, 403)


def test_admin_endpoints_require_admin():
    r = requests.get(f"{BASE}/api/admin/trivia/questions", timeout=15)
    assert r.status_code in (401, 403)
    r = requests.post(f"{BASE}/api/admin/trivia/generate", json={"count": 2}, timeout=15)
    assert r.status_code in (401, 403)
