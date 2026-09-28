"""Sign-up with an email that is already on file must prove the inbox first.

POST /auth/register used to attach a new login to any client record whose
email matched what was typed — so anyone who knew a client's address could
take over that family's account. These pin the fix:

  * an on-file email with no login gets a one-time link sent TO THAT ADDRESS;
    no login, no token, no change to the record;
  * the link (password or passwordless) finishes it on the existing record,
    applies a referral code typed at sign-up, and only then tells the operator;
  * the password typed at sign-up is never stored;
  * repeat sign-ups can't flood the inbox, and a failed send says so;
  * a brand-new email, an already-registered email and a client that already
    has a login all behave exactly as before;
  * the claim email — and a forgot-password reset — go out even during
    quiet hours (both have someone waiting on them);
  * a Photo Special reservation never lands on a family matched by phone alone.
"""
import contextlib
import uuid

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import email_service
import server
from _test_loop import run

TAG = "test_signup_claim"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
PASSWORD = "typed-at-signup-1"


def _email():
    return f"{TAG}-{uuid.uuid4().hex[:8]}@example.com"


def _client(email, **over):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} Owner", "email": email, "phone": "614-555-0142",
        "credits": 7, "account_balance": 12.5, "waiver": True, "referred_by_code": None,
        "client_status": "active", "created_at": server.now_iso(),
    }
    doc.update(over)
    run(server.db.clients.insert_one(dict(doc)))
    return doc


@pytest.fixture(autouse=True)
def _clean_limits():
    run(server.db.auth_rate_limits.delete_many({"scope": {"$regex": "^(register|claim|forgot)"}}))
    yield


@pytest.fixture(scope="module", autouse=True)
def _module_cleanup():
    yield
    rx = {"$regex": f"^{TAG}"}
    ids = [c["id"] for c in run(server.db.clients.find({"email": rx}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.claim_tokens.delete_many({"client_id": {"$in": ids}}))
    run(server.db.users.delete_many({"email": rx}))
    run(server.db.clients.delete_many({"email": rx}))
    run(server.db.clients.delete_many({"name": {"$regex": f"^{TAG}"}}))


@pytest.fixture()
def mail():
    """Capture the claim emails and operator alerts instead of sending them."""
    box = {"claims": [], "admin": [], "result": True}
    orig_claim, orig_admin = server.send_account_claim, server.notify_admin_new_client

    async def fake_claim(**kw):
        box["claims"].append(kw)
        return box["result"]

    async def fake_admin(user, client):
        box["admin"].append((user, client))

    server.send_account_claim = fake_claim
    server.notify_admin_new_client = fake_admin
    try:
        yield box
    finally:
        server.send_account_claim = orig_claim
        server.notify_admin_new_client = orig_admin


def _register(email, **over):
    body = {"email": email, "password": PASSWORD, "name": "Somebody Else"}
    body.update(over)
    return run(_http.post("/api/auth/register", json=body))


def _tokens(client_id):
    return run(server.db.claim_tokens.find({"client_id": client_id}, {"_id": 0}).to_list(50))


# ------------------------------------------------------------ the takeover

def test_an_on_file_email_gets_a_link_not_a_login(mail):
    email = _email()
    client = _client(email.upper())  # stored in different case — still the same inbox
    before = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))

    r = _register(email)

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "check_email" and email in body["message"]
    assert "token" not in body and "user" not in body, "nobody is signed in"
    assert run(server.db.users.find_one({"email": email})) is None, "no login created"
    assert run(server.db.users.find_one({"client_id": client["id"]})) is None, "nothing linked to the record"
    assert run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0})) == before, "record untouched"
    assert run(server.db.clients.count_documents({"email": {"$regex": f"^{email}$", "$options": "i"}})) == 1, "no twin"

    [tok] = _tokens(client["id"])
    assert tok["source"] == "register" and tok["is_reset"] is False and tok["used"] is False
    assert not any("pass" in k for k in tok), "the typed password is never stored"
    [sent] = mail["claims"]
    assert sent["to_email"] == email and tok["token"] in sent["claim_url"]
    assert sent["critical"] is True, "a waiting person's link ignores quiet hours"
    assert mail["admin"] == [], "the operator hears about it when the link is used, not before"


def test_the_link_finishes_it_on_the_existing_record_and_applies_the_referral(mail):
    code = f"R{uuid.uuid4().hex[:5].upper()}"
    _client(_email(), name=f"{TAG} Referrer", referral_code=code)
    email = _email()
    client = _client(email)

    assert _register(email, referred_by_code=code.lower()).status_code == 202
    assert run(server.db.clients.find_one({"id": client["id"]}))["referred_by_code"] is None, "not applied yet"
    [tok] = _tokens(client["id"])

    r = run(_http.post(f"/api/claim/{tok['token']}", json={"password": "chosen-later-9"}))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["client_id"] == client["id"]

    user = run(server.db.users.find_one({"client_id": client["id"]}, {"_id": 0}))
    assert user["email"] == email and user["role"] == "client"
    assert server.verify_password("chosen-later-9", user["password_hash"])
    assert not server.verify_password(PASSWORD, user["password_hash"]), "the sign-up password was discarded"
    after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
    assert after["referred_by_code"] == code and after["credits"] == 7 and after["name"] == client["name"]
    assert len(mail["admin"]) == 1 and mail["admin"][0][1]["id"] == client["id"]


def test_the_passwordless_link_also_finishes_it(mail):
    email = _email()
    client = _client(email)
    assert _register(email).status_code == 202
    [tok] = _tokens(client["id"])

    r = run(_http.post(f"/api/claim/{tok['token']}/login"))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["needs_password"] is True
    user = run(server.db.users.find_one({"client_id": client["id"]}, {"_id": 0}))
    assert user["email"] == email
    assert len(mail["admin"]) == 1


def test_a_referral_never_overwrites_one_already_on_the_record(mail):
    code = f"R{uuid.uuid4().hex[:5].upper()}"
    _client(_email(), name=f"{TAG} Referrer", referral_code=code)
    email = _email()
    client = _client(email, referred_by_code="ORIGINAL")
    assert _register(email, referred_by_code=code).status_code == 202
    [tok] = _tokens(client["id"])
    assert run(_http.post(f"/api/claim/{tok['token']}/login")).status_code == 200
    assert run(server.db.clients.find_one({"id": client["id"]}))["referred_by_code"] == "ORIGINAL"


def test_an_admin_sent_link_does_not_trigger_the_sign_up_follow_up(mail):
    email = _email()
    client = _client(email)
    token = "t-" + uuid.uuid4().hex
    run(server.db.claim_tokens.insert_one({
        "token": token, "client_id": client["id"], "email": email, "is_reset": False, "used": False,
        "created_at": server.now_iso(), "expires_at": "2999-01-01T00:00:00+00:00",
    }))
    assert run(_http.post(f"/api/claim/{token}", json={"password": "chosen-later-9"})).status_code == 200
    assert mail["admin"] == [], "only sign-up links carry the deferred new-client alert"


def test_repeat_sign_ups_do_not_flood_the_inbox(mail):
    email = _email()
    client = _client(email)
    assert _register(email).status_code == 202
    again = _register(email)
    assert again.status_code == 202 and again.json()["status"] == "check_email"
    assert len(mail["claims"]) == 1 and len(_tokens(client["id"])) == 1, "the first link still works"


def test_a_failed_send_says_so_and_leaves_nothing_behind(mail):
    mail["result"] = False
    email = _email()
    client = _client(email)
    r = _register(email)
    assert r.status_code == 503 and "couldn't send" in r.json()["detail"]
    assert _tokens(client["id"]) == [], "a link nobody received must not block the retry"
    mail["result"] = True
    assert _register(email).status_code == 202 and len(_tokens(client["id"])) == 1


# ------------------------------------------------------------ unchanged paths

def test_a_brand_new_email_still_signs_up_and_logs_in_at_once(mail):
    code = f"R{uuid.uuid4().hex[:5].upper()}"
    _client(_email(), name=f"{TAG} Referrer", referral_code=code)
    email = _email()
    r = _register(email, name=f"{TAG} New Person", referred_by_code=code)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["token"] and data["user"]["email"] == email
    client = run(server.db.clients.find_one({"id": data["user"]["client_id"]}, {"_id": 0}))
    assert client["email"] == email and client["referred_by_code"] == code
    assert mail["claims"] == [] and len(mail["admin"]) == 1


def test_an_already_registered_email_is_still_refused(mail):
    email = _email()
    assert _register(email, name=f"{TAG} First").status_code == 200
    r = _register(email)
    assert r.status_code == 400 and "already registered" in r.json()["detail"].lower()
    assert mail["claims"] == []


def test_a_client_that_already_has_a_login_is_not_offered_a_link(mail):
    email = _email()
    client = _client(email)
    run(server.db.users.insert_one({
        "id": str(uuid.uuid4()), "email": _email(), "password_hash": "x", "role": "client",
        "client_id": client["id"], "created_at": server.now_iso(),
    }))
    r = _register(email, name=f"{TAG} Separate")
    assert r.status_code == 200, "same as before: a separate new account"
    assert r.json()["user"]["client_id"] != client["id"]
    assert mail["claims"] == []


# ------------------------------------------------------------ email delivery

@contextlib.contextmanager
def _provider(quiet: bool):
    sent = []
    orig = (email_service.RESEND_API_KEY, email_service.resend.Emails.send, email_service._is_in_quiet_hours)

    async def is_quiet():
        return quiet

    email_service.RESEND_API_KEY = "test-key"
    email_service.resend.Emails.send = lambda params, options=None: sent.append(params) or {"id": "x"}
    email_service._is_in_quiet_hours = is_quiet
    try:
        yield sent
    finally:
        email_service.RESEND_API_KEY, email_service.resend.Emails.send, email_service._is_in_quiet_hours = orig


def test_a_critical_claim_email_goes_out_during_quiet_hours():
    with _provider(quiet=True) as sent:
        ok = run(email_service.send_account_claim(
            to_email="someone@example.com", client_name="Sam", claim_url="https://x/claim/t", critical=True))
    assert ok is True and len(sent) == 1
    assert "at least 8 characters" in sent[0]["html"], "matches what the claim page actually requires"


def test_a_forgot_password_reset_goes_out_during_quiet_hours():
    email = _email()
    user_id = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": user_id, "email": email, "name": f"{TAG} Reset", "password_hash": "x",
        "role": "client", "client_id": None, "created_at": server.now_iso(),
    }))
    with _provider(quiet=True) as sent:
        r = run(_http.post("/api/auth/forgot-password", json={"email": email}))
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert [m["to"] for m in sent] == [[email]], "the reset used to vanish silently during quiet hours"
    assert "Reset" in sent[0]["subject"]
    tok = run(server.db.claim_tokens.find_one({"user_id": user_id, "used": False}, {"_id": 0}))
    assert tok and tok["token"] in sent[0]["html"]
    run(server.db.claim_tokens.delete_many({"user_id": user_id}))


def test_other_claim_emails_still_respect_quiet_hours():
    with _provider(quiet=True) as sent:
        ok = run(email_service.send_account_claim(
            to_email="someone@example.com", client_name="Sam", claim_url="https://x/claim/t"))
    assert ok is False and sent == []


# ------------------------------------------------------------ Photo Specials

def test_a_photo_special_phone_match_never_touches_that_family():
    import test_photo_specials as ps

    sp = ps._special()
    phone = f"614555{uuid.uuid4().int % 10_000_000:07d}"
    client = _client("", name=f"{TAG} Phone Only", phone=phone)
    typed = _email()
    sent = []
    orig = email_service._dispatch

    async def capture(*, slug, to_email, **kw):
        sent.append((slug, to_email))
        return True

    email_service._dispatch = capture
    try:
        res = ps._reserve(sp, email=typed, phone=phone)["reservation"]
        booked = run(server.db.bookings.find_one({"id": res["booking_id"]}, {"_id": 0}))
    finally:
        email_service._dispatch = orig
        run(server.db.bookings.delete_many({"photo_special_id": sp["id"]}))
        run(server.db.dogs.delete_many({"owner_id": client["id"]}))
        run(server.db.photo_specials.delete_one({"id": sp["id"]}))
    assert booked and booked["client_id"] != client["id"], "a phone number alone never picks the family (audit #5)"
    assert run(server.db.clients.find_one({"id": client["id"]}))["email"] == "", "typed email not saved on it"
    assert [to for _, to in sent] == [typed], "the confirmation reaches the person who booked"
    # …so signing up with that address can only reach the booker's own new record.
    owner = run(server.db.clients.find_one({"email": typed}, {"_id": 0}))
    assert owner and owner["id"] != client["id"] and owner["client_status"] == "walk_in"
