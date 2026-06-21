"""Sprint 105 — Homework redesign: minutes, resources, step events, settings."""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
CLIENT_EMAIL = "testclient@sithappens.com"
CLIENT_PASSWORD = "test1234"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"client login failed: {r.text}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def a_dog(admin_headers, client_headers):
    me = requests.get(f"{BASE}/api/auth/me", headers=client_headers).json()
    dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers).json()
    dog = next((d for d in dogs if d.get("owner_id") == me["client_id"]), None)
    if not dog:
        pytest.skip("client has no dog")
    return dog


def _create_plan(headers, dog_id, with_resources=False):
    body = {
        "dog_id": dog_id,
        "title": f"Plan {uuid.uuid4().hex[:6]}",
        "instructions": "Sprint 105 test",
        "days": [
            {
                "day_number": 1,
                "day_focus": "Day 1 focus",
                "instructions": "",
                "fields": [],
                "steps": [
                    {"id": "s1a", "label": "Step 1A", "minutes": 5},
                    {"id": "s1b", "label": "Step 1B", "minutes": 10},
                ],
                "resources": [{"name": "Day-1 cheat sheet.pdf", "kind": "file", "media_id": "m1"}] if with_resources else [],
            }
        ],
        "resources": [{"name": "Plan summary.pdf", "kind": "file", "media_id": "m0"}] if with_resources else [],
    }
    r = requests.post(f"{BASE}/api/homework/daily-tracker", headers=headers, json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_step_minutes_persist(admin_headers, a_dog):
    hw = _create_plan(admin_headers, a_dog["id"])
    try:
        d = requests.get(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers).json()
        steps = d["daily_progress"][0]["steps"]
        assert {s["id"]: s.get("minutes") for s in steps} == {"s1a": 5, "s1b": 10}
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_resources_persist_on_create(admin_headers, a_dog):
    hw = _create_plan(admin_headers, a_dog["id"], with_resources=True)
    try:
        d = requests.get(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers).json()
        assert len(d.get("resources") or []) == 1
        assert d["resources"][0]["name"] == "Plan summary.pdf"
        prog = d["daily_progress"]
        assert len(prog[0].get("resources") or []) == 1
        assert prog[0]["resources"][0]["name"] == "Day-1 cheat sheet.pdf"
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_plan_resource_upload_and_delete(admin_headers, a_dog):
    hw = _create_plan(admin_headers, a_dog["id"])
    hwid = hw["id"]
    try:
        # Upload
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/resource",
            headers=admin_headers,
            json={"name": "Quick reference.pdf", "kind": "file", "media_id": "media-xyz"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["resources"]) == 1
        res_id = r.json()["resources"][0]["id"]
        # Delete
        r = requests.delete(f"{BASE}/api/homework/{hwid}/resource/{res_id}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["resources"] == []
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_day_resource_upload_and_delete(admin_headers, a_dog):
    hw = _create_plan(admin_headers, a_dog["id"])
    hwid = hw["id"]
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/resource",
            headers=admin_headers,
            json={"name": "Day-1 handout.pdf", "kind": "file", "media_id": "media-1"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        res_id = r.json()["resources"][0]["id"]
        r = requests.delete(f"{BASE}/api/homework/{hwid}/day/1/resource/{res_id}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["resources"] == []
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_step_event_recorded_on_toggle(admin_headers, client_headers, a_dog):
    """Toggling a step as a client should write to step_events collection,
    surfaced via /api/admin/homework/recent-steps."""
    hw = _create_plan(admin_headers, a_dog["id"])
    hwid = hw["id"]
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/toggle-step",
            headers=client_headers,
            json={"step_id": "s1a", "done": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        feed = requests.get(f"{BASE}/api/admin/homework/recent-steps?since_hours=1", headers=admin_headers).json()
        assert feed["count"] >= 1
        ours = next((e for e in feed["events"] if e["homework_id"] == hwid), None)
        assert ours, f"step event missing · events={feed['events'][:3]}"
        assert ours["step_id"] == "s1a"
        assert ours["done"] is True
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_admin_step_toggle_does_not_emit_event(admin_headers, a_dog):
    """Admin toggling steps should NOT spam the event feed."""
    hw = _create_plan(admin_headers, a_dog["id"])
    hwid = hw["id"]
    try:
        before = requests.get(f"{BASE}/api/admin/homework/recent-steps?since_hours=1", headers=admin_headers).json()["count"]
        requests.post(
            f"{BASE}/api/homework/{hwid}/day/1/toggle-step",
            headers=admin_headers,
            json={"step_id": "s1a", "done": True},
            timeout=15,
        )
        after = requests.get(f"{BASE}/api/admin/homework/recent-steps?since_hours=1", headers=admin_headers).json()["count"]
        assert after == before, "admin toggle should not record event"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_today_plan_exposes_resources_and_minutes(admin_headers, client_headers, a_dog):
    hw = _create_plan(admin_headers, a_dog["id"], with_resources=True)
    try:
        plan = requests.get(f"{BASE}/api/portal/today-plan", headers=client_headers).json()
        ours = next((i for i in plan["items"] if i["homework_id"] == hw["id"]), None)
        assert ours is not None
        # Per-step minutes flow through
        minutes = {s["id"]: s.get("minutes") for s in ours["steps"]}
        assert minutes == {"s1a": 5, "s1b": 10}
        # Day-level + plan-level resources both expose
        assert len(ours["resources"]) == 1
        assert len(ours["plan_resources"]) == 1
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


def test_settings_email_per_step_toggle(admin_headers):
    r = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
    orig = r.get("email_per_step")
    try:
        for val in [True, False]:
            r = requests.put(f"{BASE}/api/settings", headers=admin_headers, json={"email_per_step": val})
            assert r.status_code == 200, r.text
            r2 = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
            assert r2.get("email_per_step") == val
    finally:
        requests.put(f"{BASE}/api/settings", headers=admin_headers, json={"email_per_step": bool(orig)})


def test_recent_steps_admin_only():
    r = requests.get(f"{BASE}/api/admin/homework/recent-steps", timeout=10)
    assert r.status_code in (401, 403)


def test_resource_upload_rejects_empty(admin_headers, a_dog):
    """Posting a resource with neither media_id nor url must 400."""
    hw = _create_plan(admin_headers, a_dog["id"])
    try:
        r = requests.post(
            f"{BASE}/api/homework/{hw['id']}/resource",
            headers=admin_headers,
            json={"name": "empty", "kind": "file"},
            timeout=15,
        )
        assert r.status_code == 400
    finally:
        requests.delete(f"{BASE}/api/homework/{hw['id']}", headers=admin_headers)


# ─── Sprint 106 — direct file upload ───

import base64


def _b64(prefix, payload_bytes):
    return f"{prefix}{base64.b64encode(payload_bytes).decode('ascii')}"


def test_resource_file_upload_pdf(admin_headers):
    """Upload a tiny PDF, get back a media_id + auto-kind."""
    pdf_bytes = b"%PDF-1.4\n%fake test pdf\n"
    payload = {
        "data": _b64("data:application/pdf;base64,", pdf_bytes),
        "filename": "test-handout.pdf",
    }
    r = requests.post(f"{BASE}/api/homework/resource-upload", headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "file"
    assert body["mime"] == "application/pdf"
    assert body["media_id"]
    assert body["size_bytes"] > 0


def test_resource_file_upload_image(admin_headers):
    """JPG should map to kind=image."""
    img_bytes = b"\xff\xd8\xff\xe0" + b"x" * 20  # JPEG header + filler
    r = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=admin_headers,
        json={"data": _b64("data:image/jpeg;base64,", img_bytes), "filename": "diagram.jpg"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "image"


def test_resource_file_upload_rejects_bad_mime(admin_headers):
    """Word docs, mp4, etc. must be rejected (allow-list)."""
    r = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=admin_headers,
        json={"data": _b64("data:application/msword;base64,", b"xxx"), "filename": "x.doc"},
        timeout=15,
    )
    assert r.status_code == 400
    assert "Unsupported" in r.json()["detail"]


def test_resource_file_upload_rejects_too_large(admin_headers):
    """11 MB payload should 400."""
    big = b"a" * (11 * 1024 * 1024)
    r = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=admin_headers,
        json={"data": _b64("data:application/pdf;base64,", big), "filename": "big.pdf"},
        timeout=60,
    )
    assert r.status_code == 400
    assert "too large" in r.json()["detail"].lower()


def test_resource_file_upload_admin_only(client_headers):
    r = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=client_headers,
        json={"data": "data:application/pdf;base64,JVBE", "filename": "x.pdf"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_uploaded_resource_attaches_to_plan_and_streams(admin_headers, client_headers, a_dog):
    """End-to-end: upload a file → create plan with that media_id → client can stream it back."""
    pdf = b"%PDF-1.4\nstream-back test\n"
    up = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=admin_headers,
        json={"data": _b64("data:application/pdf;base64,", pdf), "filename": "stream-test.pdf"},
        timeout=15,
    ).json()
    media_id = up["media_id"]
    # Create plan with this file as a day-1 resource
    body = {
        "dog_id": a_dog["id"], "title": "stream test", "instructions": "",
        "days": [{
            "day_number": 1, "day_focus": "x", "instructions": "", "fields": [],
            "steps": [{"id": "s1a", "label": "y", "minutes": 1}],
            "resources": [{"id": "r1", "name": "stream-test.pdf", "kind": "file", "media_id": media_id}],
        }],
    }
    hw = requests.post(f"{BASE}/api/homework/daily-tracker", headers=admin_headers, json=body, timeout=20).json()
    hwid = hw["id"]
    try:
        # Client can stream back
        r = requests.get(f"{BASE}/api/homework/resource/{media_id}", headers=client_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["mime"] == "application/pdf"
    finally:
        requests.delete(f"{BASE}/api/homework/{hwid}", headers=admin_headers)


def test_unrelated_client_cannot_stream_resource(admin_headers, a_dog):
    """A client who doesn't own a homework referencing the media_id must get 403."""
    pdf = b"%PDF-1.4\nperm test\n"
    up = requests.post(
        f"{BASE}/api/homework/resource-upload",
        headers=admin_headers,
        json={"data": _b64("data:application/pdf;base64,", pdf), "filename": "private.pdf"},
        timeout=15,
    ).json()
    # Don't attach to any homework — just an orphan upload
    other = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": f"perm-{uuid.uuid4().hex[:8]}@x.com", "password": "abc12345", "name": "Perm Tester"},
        timeout=15,
    )
    if other.status_code != 200:
        pytest.skip("could not create unrelated client")
    h = {"Authorization": f"Bearer {other.json()['token']}"}
    r = requests.get(f"{BASE}/api/homework/resource/{up['media_id']}", headers=h, timeout=15)
    assert r.status_code == 403
