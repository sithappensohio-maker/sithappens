"""A vaccine renewal keeps the approved certificate on file (audit #40).

A client's renewal upload used to replace the approved certificate: with
"certificate required" on the dog couldn't book while it waited, a rejected
renewal left no certificate at all, and a renewal carrying the same date as
the approved one took that date off the dog. Now the approved certificate
rides inside the waiting upload until a person decides: approve swaps the new
one in, reject puts the old one back exactly as it was.

Disposable tag TEST_BOOKING_BLOCKS (shared helpers).
"""
import os

import pymongo
import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from domains import vaccines as vaccines_domain
from domains.operations import routes as ops
from test_booking_block_messages import VACCINES_OK, _book, _client_user, _future_weekday, _household, _refusal, _settings
from test_stale_price_snapshot_fix import _daycare_service

APPROVED = {"photo": "data:image/png;base64,T0xE", "photos": ["data:image/png;base64,T0xE"], "uploaded_at": "2026-01-05T10:00:00+00:00",
            "uploaded_by": "Pat", "expires_on": "2030-01-01", "status": "approved", "reviewed_at": "2026-01-06T09:00:00+00:00",
            "reviewed_by": "Owner"}
BORDETELLA = {**APPROVED, "photo": "data:image/png;base64,Qk9S", "photos": ["data:image/png;base64,Qk9S"]}
DOC_REQUIRED = {"day_to_day__compliance__vaccine_doc_upload_required": True}


def _dog(dog):
    return run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0}))


def _with_certs(dog, **certs):
    run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"vaccine_certs": certs}}))


def _upload(client, dog, expires_on, photo="data:image/png;base64,TkVX"):
    return run(server.portal_update_vaccine(dog["id"], server.VaccineUpdateIn(vaccine="rabies", expires_on=expires_on, photos=[photo]),
                                            _client_user(client)))


def _approve(dog, **kw):
    return run(ops.approve_vaccine_cert(server.db, dog["id"], "rabies", "Owner", server.now_iso, **kw))


def _reject(dog, **kw):
    return run(ops.reject_vaccine_cert(server.db, dog["id"], "rabies", **kw))


# ───────────────────────────────────────── the upload keeps what's approved

def test_a_renewal_keeps_the_approved_certificate_and_its_date():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED, bordetella=BORDETELLA)
        _upload(client, dogs[0], "2031-01-01")
        d = _dog(dogs[0])
        assert d["vaccine_certs"]["rabies"]["status"] == "pending_review"
        assert d["vaccine_certs"]["rabies"]["approved_before"] == APPROVED
        assert d["vaccines"]["rabies"] == VACCINES_OK["rabies"] and d["vaccine_certs"]["bordetella"] == BORDETELLA


def test_a_second_upload_while_one_waits_keeps_the_same_approved_certificate():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        _upload(client, dogs[0], "2031-02-02", photo="data:image/png;base64,QUdBSU4=")
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert cert["pending_expires_on"] == "2031-02-02" and cert["approved_before"] == APPROVED
        assert "approved_before" not in cert["approved_before"]


def test_an_upload_nobody_approved_is_never_kept_as_the_approved_one():
    legacy = {"photo": "data:image/png;base64,TEVH", "expires_on": "2029-01-01", "uploaded_at": "2026-05-01T00:00:00+00:00"}
    assert "approved_before" not in vaccines_domain.renewal_entry(legacy, photos=["x"], expires_on="2031-01-01", uploader="c", now="n")
    assert "approved_before" not in vaccines_domain.renewal_entry(None, photos=["x"], expires_on="2031-01-01", uploader="c", now="n")


# ───────────────────────────────────── the dog keeps booking meanwhile

def test_with_certificates_required_the_dog_books_while_its_renewal_is_reviewed():
    with _daycare_service() as svc, _household() as (client, dogs), _settings(**DOC_REQUIRED):
        _with_certs(dogs[0], rabies=APPROVED, bordetella=BORDETELLA, dhpp=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        assert run(_book(_client_user(client), dogs[0], svc, _future_weekday()))["id"]
        settings = run(server.get_settings())
        assert server._booking_vaccine_block(settings, _dog(dogs[0]), "daycare") is None


def test_with_certificates_required_an_upload_with_nothing_approved_behind_it_still_waits():
    with _daycare_service() as svc, _household() as (client, dogs), _settings(**DOC_REQUIRED):
        _with_certs(dogs[0], bordetella=BORDETELLA, dhpp=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        e = _refusal(_book(_client_user(client), dogs[0], svc, _future_weekday()))
        assert e.block["code"] == "vaccine_pending"


def test_check_in_doesnt_warn_about_a_renewal_while_the_approved_vaccine_is_valid():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        assert server._dog_vaccine_checkin_warning(_dog(dogs[0]), ["rabies"]) is None
    with _household(vaccines={**VACCINES_OK, "rabies": "2020-01-01"}) as (client, dogs):
        _upload(client, dogs[0], "2031-01-01")
        assert server._dog_vaccine_checkin_warning(_dog(dogs[0]), ["rabies"]) == "Rabies vaccine is pending admin review."


# ─────────────────────────────── reject throws away only the new upload

def test_rejecting_a_renewal_puts_the_approved_certificate_back_exactly_date_and_all():
    with _household(vaccines={**VACCINES_OK, "rabies": APPROVED["expires_on"]}) as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], APPROVED["expires_on"])          # the client re-sent the same certificate
        out = _reject(dogs[0])
        d = _dog(dogs[0])
        assert out["kept_approved"] is True and d["vaccine_certs"]["rabies"] == APPROVED
        assert d["vaccines"]["rabies"] == APPROVED["expires_on"]


def test_rejecting_a_first_upload_leaves_a_date_staff_typed():
    with _household() as (client, dogs):
        _upload(client, dogs[0], VACCINES_OK["rabies"])
        _reject(dogs[0])
        d = _dog(dogs[0])
        assert "rabies" not in (d.get("vaccine_certs") or {}) and d["vaccines"]["rabies"] == VACCINES_OK["rabies"]


def test_rejecting_an_old_style_upload_still_takes_its_own_date_back_off():
    legacy = {"photo": "data:image/png;base64,TEVH", "expires_on": "2030-01-01", "uploaded_at": "2026-05-01T00:00:00+00:00"}
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=legacy)
        _reject(dogs[0])
        assert _dog(dogs[0])["vaccines"]["rabies"] == ""


# ─────────────────────────────────────── approve swaps the new one in

def test_approving_a_renewal_swaps_it_in_and_the_next_one_keeps_it():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        _approve(dogs[0])
        d = _dog(dogs[0])
        cert = d["vaccine_certs"]["rabies"]
        assert cert["status"] == "approved" and cert["expires_on"] == "2031-01-01" and "approved_before" not in cert
        assert "pending_expires_on" not in cert and d["vaccines"]["rabies"] == "2031-01-01"
        _upload(client, dogs[0], "2032-01-01")
        again = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert again["approved_before"] == cert, "the newly approved one — never a chain"


def test_a_decided_certificate_cant_be_rejected_or_approved_again():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        _approve(dogs[0])
        run(server.db.dogs.update_one({"id": dogs[0]["id"]}, {"$set": {"vaccines.rabies": "2031-06-30"}}))   # staff corrected the date
        with pytest.raises(server.HTTPException) as e:
            _reject(dogs[0])
        assert e.value.status_code == 409
        with pytest.raises(server.HTTPException) as e:
            _approve(dogs[0])
        assert e.value.status_code == 409
        d = _dog(dogs[0])
        assert d["vaccine_certs"]["rabies"]["status"] == "approved" and d["vaccines"]["rabies"] == "2031-06-30"


def test_a_reviewer_never_decides_on_an_upload_they_didnt_see():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        seen = _dog(dogs[0])["vaccine_certs"]["rabies"]["uploaded_at"]
        run(server.db.dogs.update_one({"id": dogs[0]["id"]}, {"$set": {"vaccine_certs.rabies.uploaded_at": "2099-01-01T00:00:00+00:00"}}))
        for act in (_approve, _reject):
            with pytest.raises(server.HTTPException) as e:
                act(dogs[0], uploaded_at=seen)
            assert e.value.status_code == 409
        assert _approve(dogs[0], uploaded_at="2099-01-01T00:00:00+00:00")["expires_on"] == "2031-01-01"


def test_bulk_approval_uses_the_same_rule():
    with _household(dogs=2) as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        _with_certs(dogs[1], rabies=APPROVED)
        body = ops.BulkVaccineReviewIn(items=[{"dog_id": dogs[0]["id"], "vaccine": "rabies"}, {"dog_id": dogs[1]["id"], "vaccine": "rabies"}])
        route = next(r for r in server.app.routes if getattr(r, "path", "") == "/api/admin/vaccine-uploads/bulk-review")
        out = run(route.endpoint(body, {"id": "o", "role": "admin", "name": "Owner"}))
        assert out["approved_count"] == 1 and out["skipped"][0]["dog_id"] == dogs[1]["id"]
        assert "approved_before" not in _dog(dogs[0])["vaccine_certs"]["rabies"]


def test_the_review_list_says_an_approved_certificate_stays_on_file():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        rows = [r for r in run(server.admin_list_vaccine_uploads(False, {"role": "admin"})) if r["dog_id"] == dogs[0]["id"]]
        assert len(rows) == 1 and rows[0]["approved_on_file"] is True
        assert rows[0]["approved_before_expires_on"] == "2030-01-01" and rows[0]["on_file_expires_on"] == VACCINES_OK["rabies"]
        assert "approved_before" not in rows[0] and rows[0]["photo"] == "data:image/png;base64,TkVX"


# ───────────────────────────────────────────── writes stay one vaccine wide

def test_an_upload_that_meets_a_review_mid_way_is_rebuilt_on_what_the_review_left(monkeypatch):
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        real, calls = vaccines_domain.renewal_entry, []
        sync = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017"))[server.db.name]

        def reviewed_meanwhile(prior, **kw):
            if not calls:   # staff approve the waiting upload while the client sends another
                sync.dogs.update_one({"id": dogs[0]["id"]}, {
                    "$set": {"vaccine_certs.rabies.status": "approved", "vaccine_certs.rabies.reviewed_at": server.now_iso(),
                             "vaccine_certs.rabies.expires_on": "2031-01-01", "vaccines.rabies": "2031-01-01"},
                    "$unset": {"vaccine_certs.rabies.pending_expires_on": "", "vaccine_certs.rabies.approved_before": ""}})
            calls.append(prior)
            return real(prior, **kw)
        monkeypatch.setattr(vaccines_domain, "renewal_entry", reviewed_meanwhile)
        _upload(client, dogs[0], "2032-01-01")
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert len(calls) == 2 and cert["approved_before"]["expires_on"] == "2031-01-01"
        assert cert["approved_before"]["status"] == "approved"


def test_an_upload_too_big_to_keep_beside_the_approved_one_is_refused_plainly(monkeypatch):
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        monkeypatch.setattr(vaccines_domain, "MAX_DOG_BYTES", 600)
        with pytest.raises(server.HTTPException) as e:
            _upload(client, dogs[0], "2031-01-01")
        assert e.value.status_code == 400 and "too large" in e.value.detail
        assert _dog(dogs[0])["vaccine_certs"]["rabies"] == APPROVED


def test_staff_attaching_one_vaccine_leave_the_others_alone():
    with _household() as (client, dogs):
        run(server.db.dogs.update_one({"id": dogs[0]["id"]}, {"$unset": {"vaccine_certs": ""}}))
        _upload(client, dogs[0], "2031-01-01")
        run(server.admin_attach_vaccine_cert(dogs[0]["id"], server.VaccineUpdateIn(vaccine="bordetella", expires_on="2031-03-03",
                                                                                     photos=["data:image/png;base64,Qk9S"]),
                                             {"id": "o", "role": "admin", "name": "Owner"}))
        d = _dog(dogs[0])
        assert d["vaccine_certs"]["rabies"]["status"] == "pending_review" and d["vaccine_certs"]["bordetella"]["status"] == "approved"
        assert d["vaccines"]["bordetella"] == "2031-03-03" and d["vaccines"]["rabies"] == VACCINES_OK["rabies"]


def test_a_reject_that_meets_a_new_upload_leaves_the_new_upload_alone(monkeypatch):
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        sync = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017"))[server.db.name]
        real, n = ops._waiting_upload, []

        async def client_uploads_again(*a, **kw):
            out = await real(*a, **kw)
            n.append(1)
            sync.dogs.update_one({"id": dogs[0]["id"]}, {"$set": {"vaccine_certs.rabies.uploaded_at": f"2099-01-0{len(n)}T00:00:00+00:00",
                                                                  "vaccine_certs.rabies.pending_expires_on": "2032-02-02"}})
            return out
        monkeypatch.setattr(ops, "_waiting_upload", client_uploads_again)
        for act in (_reject, _approve):
            with pytest.raises(server.HTTPException) as e:
                act(dogs[0])
            assert e.value.status_code == 409
        cert = _dog(dogs[0])["vaccine_certs"]["rabies"]
        assert cert["pending_expires_on"] == "2032-02-02" and cert["approved_before"] == APPROVED


def test_bulk_approval_skips_an_upload_that_changed_since_the_list_loaded():
    with _household() as (client, dogs):
        _with_certs(dogs[0], rabies=APPROVED)
        _upload(client, dogs[0], "2031-01-01")
        body = ops.BulkVaccineReviewIn(items=[{"dog_id": dogs[0]["id"], "vaccine": "rabies", "uploaded_at": "2000-01-01T00:00:00+00:00"}])
        route = next(r for r in server.app.routes if getattr(r, "path", "") == "/api/admin/vaccine-uploads/bulk-review")
        out = run(route.endpoint(body, {"id": "o", "role": "admin", "name": "Owner"}))
        assert out["approved_count"] == 0 and "newer certificate" in out["skipped"][0]["reason"]
        assert _dog(dogs[0])["vaccine_certs"]["rabies"]["status"] == "pending_review"


def test_an_old_approval_without_a_status_counts_the_same_as_before_the_upload():
    old = {k: v for k, v in APPROVED.items() if k != "status"}          # approved before July 2026: reviewed_at only
    waiting = vaccines_domain.renewal_entry(old, photos=["x"], expires_on="2031-01-01", uploader="c", now="n")
    assert waiting["approved_before"] == old
    assert vaccines_domain.approved_cert_on_file(old) is None and vaccines_domain.approved_cert_on_file(waiting) is None
    assert vaccines_domain.approved_cert_on_file(vaccines_domain.renewal_entry(APPROVED, photos=["x"], expires_on="2031-01-01",
                                                                               uploader="c", now="n")) == APPROVED
