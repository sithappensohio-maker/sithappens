"""Public "Tell us about your dog" questionnaire.

Covers the contract the landing page and the operator rely on:
  * a valid submission is saved, becomes a prospect client, lands in Action
    Required and produces a durable operator email;
  * a second submission from the same email merges into the same client;
  * the honeypot swallows bots without saving anything;
  * bad vocabulary is rejected before anything is written;
  * marking it contacted removes it from Action Required.
"""
import uuid

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CONTACT_INQUIRY"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _email():
    return f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.com"


def _payload(email, **over):
    body = {
        "name": f"{TAG} Owner", "email": email, "phone": "555-0199", "preferred_contact": "text",
        "dog_name": "Waffles", "breed": "Golden mix", "dog_age": "5 months",
        "interests": ["daycare", "in_person_training"], "concerns": ["puppy_basics", "leash_pulling"],
        "message": "She is sweet but pulls like a freight train.",
        "vaccines_current": "yes", "start_timing": "asap", "zip": "43201",
    }
    body.update(over)
    return body


@pytest.fixture(scope="module", autouse=True)
def _module_cleanup():
    yield
    rx = {"$regex": f"^{TAG.lower()}"}
    run(server.db.inquiries.delete_many({"email": rx}))
    run(server.db.clients.delete_many({"email": rx}))
    run(server.db.email_outbox.delete_many({"key": {"$regex": "^admin_contact_inquiry:"}}))
    run(server.db.notification_log.delete_many({"key": {"$regex": "^admin_contact_inquiry:"}}))


def _submit(email, **over):
    r = run(_http.post("/api/public/contact-inquiry", json=_payload(email, **over)))
    return r


def test_valid_submission_is_saved_becomes_a_prospect_and_alerts_the_operator():
    email = _email()
    r = _submit(email)
    assert r.status_code == 200, r.text
    inquiry_id = r.json()["id"]

    row = run(server.db.inquiries.find_one({"id": inquiry_id}, {"_id": 0}))
    assert row and row["status"] == "new"
    assert row["interests"] == ["daycare", "in_person_training"]
    assert row["concerns"] == ["puppy_basics", "leash_pulling"]
    assert row["email"] == email and row["dog_name"] == "Waffles"
    assert "website" not in row, "the honeypot value is never stored"

    client = run(server.db.clients.find_one({"email": email}, {"_id": 0}))
    assert client and client["client_status"] == "prospect"
    assert client["id"] == row["client_id"] and row["client_merged"] is False
    assert "Contact inquiry" in client["evaluation_notes"] and "Daycare" in client["evaluation_notes"]

    # Operator alert is durable: either delivered (notification_log stamp) or
    # waiting in the outbox with the real failure reason — never silently gone.
    key = f"admin_contact_inquiry:{inquiry_id}"
    stamped = run(server.db.notification_log.find_one({"key": key}))
    queued = run(server.db.email_outbox.find_one({"key": key}))
    assert stamped or queued, "admin email must be stamped as sent or queued for retry"

    # It is in Action Required for anyone who can see clients, counted and listed.
    actions = run(server._collect_pending_actions(_admin_user()))
    mine = [a for a in actions["items"] if a["id"] == f"contact_inquiry:{inquiry_id}"]
    assert mine, "new inquiry must appear in Action Required"
    a = mine[0]
    assert a["type"] == "contact_inquiry" and a["type_label"] == "New Inquiry"
    assert a["client_name"] == f"{TAG} Owner" and a["dog_name"] == "Waffles"
    assert a["service_name"] == "Daycare, In-person training"
    assert a["deep_link"] == {"screen": "inquiries", "inquiry_id": inquiry_id}
    assert a["required_permission"] == "clients_edit"
    counts = run(server.admin_pending_actions_count(_admin_user()))
    assert counts["contact_inquiries"] >= 1 and counts["total"] >= counts["contact_inquiries"]


def test_second_submission_from_the_same_email_merges_into_one_client():
    email = _email()
    assert _submit(email).status_code == 200
    assert _submit(email, dog_name="Biscuit", interests=["boarding"], concerns=["barking"]).status_code == 200
    clients = run(server.db.clients.find({"email": email}, {"_id": 0}).to_list(10))
    assert len(clients) == 1, "no duplicate prospect record"
    assert clients[0]["evaluation_notes"].count("Contact inquiry") == 2
    rows = run(server.db.inquiries.find({"email": email}, {"_id": 0}).to_list(10))
    assert len(rows) == 2
    assert all(r["client_id"] == clients[0]["id"] for r in rows)
    assert sorted(r["client_merged"] for r in rows) == [False, True]


def test_honeypot_swallows_bots_without_saving_anything():
    email = _email()
    r = _submit(email, website="http://spam.example")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert run(server.db.inquiries.find_one({"email": email})) is None
    assert run(server.db.clients.find_one({"email": email})) is None


def test_bad_vocabulary_and_missing_required_answers_are_rejected_before_writing():
    email = _email()
    assert _submit(email, interests=["dog_walking"]).status_code == 422
    assert _submit(email, concerns=[]).status_code == 422
    assert _submit(email, message="").status_code == 422
    assert _submit(email, preferred_contact="carrier pigeon").status_code == 422
    assert run(server.db.inquiries.find_one({"email": email})) is None
    assert run(server.db.clients.find_one({"email": email})) is None


def test_marking_contacted_removes_it_from_action_required_and_the_list_reads_back():
    email = _email()
    inquiry_id = _submit(email).json()["id"]
    admin = _admin_user()
    listed = run(server.list_inquiries(status="new", _=admin))
    assert any(i["id"] == inquiry_id for i in listed["items"])
    assert listed["labels"]["interests"]["online_school"] == "Online School"
    assert all("source_ip" not in i for i in listed["items"])

    updated = run(server.update_inquiry(inquiry_id, server.InquiryPatchIn(status="contacted", admin_notes="Texted Tue"), admin))
    assert updated["status"] == "contacted" and updated["admin_notes"] == "Texted Tue" and updated.get("contacted_at")
    actions = run(server._collect_pending_actions(admin))
    assert not any(a["id"] == f"contact_inquiry:{inquiry_id}" for a in actions["items"])

    with pytest.raises(server.HTTPException):
        run(server.update_inquiry("nope", server.InquiryPatchIn(status="closed"), admin))
    with pytest.raises(server.HTTPException):
        run(server.list_inquiries(status="bogus", _=admin))


def test_public_options_match_the_server_vocabulary():
    r = run(_http.get("/api/public/contact-inquiry-options"))
    assert r.status_code == 200
    opts = r.json()
    assert set(opts["interests"]) == set(server.INQUIRY_INTERESTS)
    assert set(opts["concerns"]) == set(server.INQUIRY_CONCERNS)
    assert opts["statuses"] == ["new", "contacted", "closed"]
