"""Sprint 110di — Verify portal profile email persists + multi-photo vaccine
uploads work end-to-end.

Covers:
  - PUT /api/portal/me now accepts/persists `email`.
  - Invalid email shape is rejected with 400.
  - POST /api/portal/dogs/{dog_id}/vaccine-update accepts `photos: []`
    (multi-photo) and stores all of them on the cert record while still
    populating the legacy single `photo` field for back-compat.
"""
import os
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


def _make_client_with_dog():
    h = _admin_h()
    # Create a client
    cname = f"V110di {uuid.uuid4().hex[:6]}"
    cli = requests.post(f"{BASE_URL}/api/clients",
                        json={"name": cname, "address": "", "phone": ""},
                        headers=h, timeout=15)
    assert cli.status_code == 200, cli.text
    client_id = cli.json()["id"]

    # Portal account
    email = f"v110di_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "test1234"
    pa = requests.post(f"{BASE_URL}/api/clients/{client_id}/portal-account",
                       json={"email": email, "password": pwd},
                       headers=h, timeout=15)
    assert pa.status_code == 200, pa.text

    # Add a dog under that client (admin side)
    dog_body = {
        "name": "Bandit",
        "breed": "Mutt",
        "owner_id": client_id,
        "age_y": 4, "age_m": 0,
        "sex": "Male", "fixed": "Yes",
        "vaccines": {"rabies": "2030-01-01", "bordetella": "2030-01-01", "dhpp": "2030-01-01"},
    }
    d = requests.post(f"{BASE_URL}/api/dogs", json=dog_body, headers=h, timeout=15)
    assert d.status_code == 200, d.text
    dog_id = d.json()["id"]

    token = _login(email, pwd)
    return {"client_id": client_id, "dog_id": dog_id, "client_token": token, "client_email": email}


def test_portal_me_persists_email():
    ctx = _make_client_with_dog()
    h = {"Authorization": f"Bearer {ctx['client_token']}"}

    new_email = f"contact_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.put(f"{BASE_URL}/api/portal/me",
                     json={"name": "V110di Tester", "email": new_email,
                           "address": "", "phone": "", "emerg": ""},
                     headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["client"]["email"] == new_email.lower()

    # Re-fetch via /portal/me to confirm persistence.
    me = requests.get(f"{BASE_URL}/api/portal/me", headers=h, timeout=15)
    assert me.status_code == 200
    assert me.json()["client"]["email"] == new_email.lower()


def test_portal_me_rejects_bad_email():
    ctx = _make_client_with_dog()
    h = {"Authorization": f"Bearer {ctx['client_token']}"}

    r = requests.put(f"{BASE_URL}/api/portal/me",
                     json={"name": "V110di Tester", "email": "notanemail"},
                     headers=h, timeout=15)
    assert r.status_code == 400, r.text


def test_portal_me_allows_blank_email():
    ctx = _make_client_with_dog()
    h = {"Authorization": f"Bearer {ctx['client_token']}"}

    r = requests.put(f"{BASE_URL}/api/portal/me",
                     json={"name": "V110di Tester", "email": ""},
                     headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["client"]["email"] == ""


# Tiny 1x1 png data URL — enough to verify storage without uploading a real cert.
_PNG_DATA = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def test_vaccine_update_accepts_multi_photo():
    ctx = _make_client_with_dog()
    h_client = {"Authorization": f"Bearer {ctx['client_token']}"}
    h_admin = _admin_h()

    body = {
        "vaccine": "rabies",
        "expires_on": "2031-04-15",
        "photos": [_PNG_DATA, _PNG_DATA, _PNG_DATA],
    }
    r = requests.post(f"{BASE_URL}/api/portal/dogs/{ctx['dog_id']}/vaccine-update",
                      json=body, headers=h_client, timeout=20)
    assert r.status_code == 200, r.text

    # Inspect via the admin upload-review listing — DogOut filters out
    # vaccine_certs, so we have to query the dedicated endpoint to verify.
    listed = requests.get(f"{BASE_URL}/api/admin/vaccine-cert-uploads",
                          headers=h_admin, timeout=15)
    assert listed.status_code == 200, listed.text
    mine = [x for x in listed.json() if x.get("dog_id") == ctx["dog_id"] and x.get("vaccine") == "rabies"]
    assert mine, "uploaded rabies cert not surfaced in admin review list"
    cert = mine[0]
    assert cert["expires_on"] == "2031-04-15"
    assert isinstance(cert.get("photos"), list)
    assert len(cert["photos"]) == 3
    # Back-compat: legacy single `photo` should still equal photos[0]
    assert cert.get("photo") == cert["photos"][0]


def test_vaccine_update_legacy_single_photo_still_works():
    ctx = _make_client_with_dog()
    h_client = {"Authorization": f"Bearer {ctx['client_token']}"}
    h_admin = _admin_h()

    body = {"vaccine": "bordetella", "expires_on": "2031-05-20", "photo": _PNG_DATA}
    r = requests.post(f"{BASE_URL}/api/portal/dogs/{ctx['dog_id']}/vaccine-update",
                      json=body, headers=h_client, timeout=20)
    assert r.status_code == 200, r.text

    listed = requests.get(f"{BASE_URL}/api/admin/vaccine-cert-uploads",
                          headers=h_admin, timeout=15)
    assert listed.status_code == 200, listed.text
    mine = [x for x in listed.json() if x.get("dog_id") == ctx["dog_id"] and x.get("vaccine") == "bordetella"]
    assert mine, "uploaded bordetella cert not surfaced"
    cert = mine[0]
    # Legacy path: `photo` populated, `photos` normalized to single-entry list.
    assert cert.get("photo") == _PNG_DATA
    assert cert.get("photos") == [_PNG_DATA]
