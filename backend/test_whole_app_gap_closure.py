"""Whole-app gap-closure regression suite.

Focused coverage for the operational/safety additions made on branch
whole-app-gap-closure. The full existing backend suite remains the release
regression gate; these tests pin the new money/security/compliance invariants.
All Mongo writes use _test_env's disposable database. No real Stripe money is
moved: Stripe network methods are mocked where needed.
"""
import base64
import time
import uuid

import _test_env  # noqa: F401 — must run before importing server
import pytest
from starlette.requests import Request

import server
from _test_loop import run

TAG = "TEST_GAP"


def _id(prefix: str) -> str:
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:10]}"


def _admin(uid=None):
    return {"id": uid or _id("admin"), "name": "Gap Admin", "email": f"{_id('admin')}@example.invalid", "role": "admin"}


def _client_user(client_id: str):
    return {"id": _id("user"), "name": "Gap Client", "email": f"{_id('client')}@example.invalid", "role": "client", "client_id": client_id}


def _request(path="/"):
    return Request({
        "type": "http", "method": "POST", "path": path,
        "headers": [(b"user-agent", b"gap-closure-test")],
        "client": ("127.0.0.1", 12345), "scheme": "http", "server": ("test", 80),
        "query_string": b"",
    })


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    # Every inserted fixture uses a TAG-bearing id/name/email/ref. Keep cleanup
    # intentionally broad within the disposable DB so a failed test cannot
    # poison a later test in the same process.
    for coll in (
        "users", "clients", "dogs", "bookings", "client_files",
        "intake_form_templates", "intake_submissions", "agreement_templates",
        "agreement_signatures", "payments", "retail_sales", "stripe_disputes",
        "stripe_balance_transactions", "stripe_payouts", "expenses",
        "shop_orders", "credit_lots", "pos_products", "inventory_movements",
        "stripe_refund_attempts", "dog_programs", "school_enrollments",
    ):
        run(server.db[coll].delete_many({"$or": [
            {"id": {"$regex": TAG}}, {"name": {"$regex": TAG}},
            {"email": {"$regex": TAG}}, {"client_id": {"$regex": TAG}},
            {"dog_id": {"$regex": TAG}}, {"payment_id": {"$regex": TAG}},
            {"shop_order_id": {"$regex": TAG}}, {"fulfillment_ref": {"$regex": TAG}},
            {"stripe_dispute_id": {"$regex": TAG}},
        ]}))


# ── Settings truth / vaccine enforcement ────────────────────────────────────

def test_per_service_vaccines_override_global_and_empty_falls_back():
    settings = {
        "required_vaccines": ["rabies", "dhpp"],
        "day_to_day": {"compliance": {"vaccines_per_service": {
            "daycare": ["rabies", "bordetella"], "boarding": [],
        }}},
    }
    assert server._required_vaccines_for_service(settings, "daycare") == ["rabies", "bordetella"]
    assert server._required_vaccines_for_service(settings, "boarding") == ["rabies", "dhpp"]


def test_vaccine_expiry_day_and_document_controls_are_real(monkeypatch):
    today = server.business_today().isoformat()
    dog = {"vaccines": {"rabies": today}, "vaccine_certs": {"rabies": {"status": "approved"}}}
    # Expiration day can be allowed when the setting says so.
    run(server._validate_dog_vaccines(dog, ["rabies"], block_on_expiry_day=False, document_required=True))
    with pytest.raises(server.HTTPException) as exc:
        run(server._validate_dog_vaccines(dog, ["rabies"], block_on_expiry_day=True, document_required=True))
    assert exc.value.status_code == 400
    dog["vaccines"]["rabies"] = "2099-01-01"
    dog["vaccine_certs"]["rabies"] = {"status": "pending_review"}
    with pytest.raises(server.HTTPException):
        run(server._validate_dog_vaccines(dog, ["rabies"], document_required=True))


# ── MFA ─────────────────────────────────────────────────────────────────────

def test_mfa_secret_encryption_and_totp_round_trip():
    secret = base64.b32encode(b"01234567890123456789").decode().rstrip("=")
    encrypted = server._mfa_encrypt_secret(secret)
    assert encrypted != secret
    assert server._mfa_decrypt_secret(encrypted) == secret
    now = int(time.time())
    code = server._totp_code(secret, now // 30)
    assert server._verify_totp(secret, code, at=now)


def test_mfa_enable_hashes_recovery_codes_and_bumps_token_version(monkeypatch):
    uid = _id("mfa")
    secret = base64.b32encode(b"abcdefghijklmnopqrst").decode().rstrip("=")
    user = {"id": uid, "email": f"{uid}@example.invalid", "name": "MFA Admin", "role": "admin", "token_version": 4}
    run(server.db.users.insert_one({**user, "password_hash": server.hash_password("Password123!"), "mfa_pending_secret_enc": server._mfa_encrypt_secret(secret), "active": True}))
    now = int(time.time())
    code = server._totp_code(secret, now // 30)
    # Pin verifier time to avoid a 30-second boundary race.
    monkeypatch.setattr(server, "_verify_totp", lambda sec, supplied, **kw: sec == secret and supplied == code)
    out = run(server.mfa_enable(server.MfaCodeIn(code=code), user))
    assert out["ok"] is True and len(out["recovery_codes"]) == 8
    fresh = run(server.db.users.find_one({"id": uid}, {"_id": 0}))
    assert fresh["mfa_enabled"] is True
    assert fresh["token_version"] == 5
    assert secret not in fresh["mfa_secret_enc"]
    assert out["recovery_codes"][0] not in fresh["mfa_recovery_hashes"]
    assert server._mfa_recovery_hash(out["recovery_codes"][0]) in fresh["mfa_recovery_hashes"]


def test_mfa_recovery_code_is_one_time():
    uid = _id("mfarecovery")
    recovery = "ABC123-DEF456"
    run(server.db.users.insert_one({
        "id": uid, "email": f"{uid}@example.invalid", "name": "Recovery Admin", "role": "admin", "active": True,
        "mfa_enabled": True, "mfa_secret_enc": server._mfa_encrypt_secret(base64.b32encode(b"zzzzzzzzzzzzzzzzzzzz").decode().rstrip("=")),
        "mfa_recovery_hashes": [server._mfa_recovery_hash(recovery)],
    }))
    user = run(server.db.users.find_one({"id": uid}, {"_id": 0}))
    assert run(server._verify_mfa_user_code(user, recovery)) is True
    fresh = run(server.db.users.find_one({"id": uid}, {"_id": 0}))
    assert server._mfa_recovery_hash(recovery) not in (fresh.get("mfa_recovery_hashes") or [])
    assert run(server._verify_mfa_user_code(fresh, recovery)) is False


# ── Versioned agreements ────────────────────────────────────────────────────

def test_agreement_version_change_invalidates_old_signature_but_preserves_snapshot():
    admin = _admin()
    cid = _id("agreement-client")
    run(server.db.clients.insert_one({"id": cid, "name": TAG + " Agreement Client", "email": f"{cid}@example.invalid"}))
    tpl = run(server.admin_create_agreement_template(server.AgreementTemplateIn(
        name=TAG + " Board Train", title="Board & Train Terms", body="Version one", scope_type="service_type", scope_value="boarding", required=True,
    ), admin))
    user = _client_user(cid)
    sig = run(server.portal_sign_agreement(tpl["id"], server.AgreementSignIn(typed_name="Test Client"), _request("/portal/agreements/sign"), user))
    assert sig["template_version"] == 1 and sig["template_snapshot"]["body"] == "Version one"
    assert run(server._unsigned_required_agreements(cid, service_type="boarding")) == []
    updated = run(server.admin_update_agreement_template(tpl["id"], server.AgreementTemplateIn(
        name=tpl["name"], title=tpl["title"], body="Version two", scope_type="service_type", scope_value="boarding", required=True,
    ), admin))
    assert updated["version"] == 2
    missing = run(server._unsigned_required_agreements(cid, service_type="boarding"))
    assert [m["id"] for m in missing] == [tpl["id"]]
    old = run(server.db.agreement_signatures.find_one({"id": sig["id"]}, {"_id": 0}))
    assert old["template_snapshot"]["body"] == "Version one"


def test_agreement_scope_matches_only_intended_service_or_program():
    service = {"scope_type": "service_type", "scope_value": "boarding"}
    program = {"scope_type": "program_id", "scope_value": "prog-1"}
    assert server._agreement_scope_matches(service, service_type="boarding")
    assert not server._agreement_scope_matches(service, service_type="daycare")
    assert server._agreement_scope_matches(program, program_id="prog-1")
    assert not server._agreement_scope_matches(program, program_id="prog-2")


# ── Intake document upload/privacy ──────────────────────────────────────────

def _seed_intake(client_id: str, *, field_id="upload", required=True):
    tid, sid = _id("tpl"), _id("submission")
    run(server.db.intake_form_templates.insert_one({
        "id": tid, "name": TAG + " Intake", "form_type": "general", "active": True,
        "fields": [
            {"id": field_id, "label": "Vet record", "field_type": "file_upload", "required": required, "staff_only": False},
            {"id": "staff-secret", "label": "Staff", "field_type": "text", "required": False, "staff_only": True},
        ],
    }))
    run(server.db.intake_submissions.insert_one({
        "id": sid, "template_id": tid, "template_name": TAG + " Intake", "client_id": client_id,
        "status": "sent", "created_at": server.now_iso(),
    }))
    return tid, sid


def test_intake_upload_is_owned_by_exact_client_submission_and_field():
    cid = _id("intake-client")
    _tid, sid = _seed_intake(cid)
    user = _client_user(cid)
    payload = base64.b64encode(b"fake pdf bytes").decode()
    uploaded = run(server.portal_upload_intake_file(sid, "upload", server.PortalIntakeFileUploadIn(
        name="../vet.pdf", content_type="application/pdf", data=payload,
    ), user))
    assert uploaded["name"] == "vet.pdf"
    assert uploaded["source"] == "client_intake_upload"
    assert uploaded["intake_submission_id"] == sid and uploaded["intake_field_id"] == "upload"
    out = run(server.portal_submit_intake(sid, server.PortalIntakeSubmitIn(answers={"upload": {"file_id": uploaded["id"]}}), user))
    assert out["status"] == "submitted"


def test_intake_submit_rejects_fabricated_or_cross_client_file_reference():
    cid = _id("intake-owner")
    other = _id("intake-other")
    _tid, sid = _seed_intake(cid)
    run(server.db.client_files.insert_one({
        "id": _id("foreign-file"), "client_id": other, "source": "client_intake_upload",
        "intake_submission_id": sid, "intake_field_id": "upload", "name": "foreign.pdf",
    }))
    foreign = run(server.db.client_files.find_one({"client_id": other}, {"_id": 0, "id": 1}))
    with pytest.raises(server.HTTPException) as exc:
        run(server.portal_submit_intake(sid, server.PortalIntakeSubmitIn(answers={"upload": {"file_id": foreign["id"]}}), _client_user(cid)))
    assert exc.value.status_code == 400


def test_intake_upload_rejects_unsupported_mime():
    cid = _id("intake-mime")
    _tid, sid = _seed_intake(cid)
    with pytest.raises(server.HTTPException) as exc:
        run(server.portal_upload_intake_file(sid, "upload", server.PortalIntakeFileUploadIn(
            name="script.exe", content_type="application/x-msdownload", data=base64.b64encode(b"MZ").decode(),
        ), _client_user(cid)))
    assert exc.value.status_code == 415


# ── Medication Action Required + care-ID persistence ────────────────────────

def _seed_checked_in_med_booking(*, checked_in=True, checked_out=False, care_items=None):
    cid, did, bid = _id("care-client"), _id("care-dog"), _id("care-booking")
    run(server.db.clients.insert_one({"id": cid, "name": TAG + " Care Client"}))
    run(server.db.dogs.insert_one({
        "id": did, "name": TAG + " Care Dog", "owner_id": cid,
        "medications": [{"name": "Apoquel", "dosage": "1 tablet", "times": ["00:00"], "notes": "with food"}],
    }))
    doc = {
        "id": bid, "client_id": cid, "client_name": TAG + " Care Client", "dog_id": did, "dog_name": TAG + " Care Dog",
        "service_type": "boarding", "date": server.business_today().isoformat(), "end_date": server.business_today().isoformat(),
        "status": "approved", "checked_in_at": server.now_iso() if checked_in else None,
    }
    if checked_out:
        doc["checked_out_at"] = server.now_iso()
    if care_items is not None:
        doc["care_items"] = care_items
    run(server.db.bookings.insert_one(doc))
    return cid, did, bid


def test_overdue_medication_alert_seeds_stable_id_and_clears_after_completion(monkeypatch):
    monkeypatch.setattr(server, "_now_business_minutes", lambda: 600)
    _cid, _did, bid = _seed_checked_in_med_booking(care_items=None)
    actions = run(server._collect_overdue_medication_actions())
    mine = [a for a in actions if a.get("deep_link", {}).get("booking_id") == bid]
    assert len(mine) == 1
    item_id = mine[0]["deep_link"]["care_item_id"]
    persisted = run(server.db.bookings.find_one({"id": bid}, {"_id": 0, "care_items": 1}))
    assert persisted["care_items"][0]["id"] == item_id
    run(server.complete_care_item(bid, item_id, server.CareCompleteIn(initials="QA"), _admin()))
    after = run(server._collect_overdue_medication_actions())
    assert not any(a.get("deep_link", {}).get("booking_id") == bid for a in after)


def test_medication_alert_requires_actual_checkin_and_ignores_checkout(monkeypatch):
    monkeypatch.setattr(server, "_now_business_minutes", lambda: 600)
    _c1, _d1, not_arrived = _seed_checked_in_med_booking(checked_in=False, care_items=[{
        "id": _id("med"), "kind": "medication", "time": "00:00", "label": "Med", "status": "pending",
    }])
    _c2, _d2, checked_out = _seed_checked_in_med_booking(checked_in=True, checked_out=True, care_items=[{
        "id": _id("med"), "kind": "medication", "time": "00:00", "label": "Med", "status": "pending",
    }])
    actions = run(server._collect_overdue_medication_actions())
    ids = {a.get("deep_link", {}).get("booking_id") for a in actions}
    assert not_arrived not in ids and checked_out not in ids


# ── Shop refunds ─────────────────────────────────────────────────────────────

def test_shop_partial_product_refund_is_penny_exact_across_all_units():
    line = {"name": TAG + " Product", "quantity": 3, "line_total": 10.00, "allocated_tax": 0.67,
            "quantity_refunded": 0, "amount_refunded": 0.0, "tax_refunded": 0.0}
    g1, t1 = server._shop_line_refund_amount(line, 1)
    line.update(quantity_refunded=1, amount_refunded=g1, tax_refunded=t1)
    g2, t2 = server._shop_line_refund_amount(line, 1)
    line.update(quantity_refunded=2, amount_refunded=round(g1 + g2, 2), tax_refunded=round(t1 + t2, 2))
    g3, t3 = server._shop_line_refund_amount(line, 1)
    assert round(g1 + g2 + g3, 2) == 10.00
    assert round(t1 + t2 + t3, 2) == 0.67


def test_consumed_credit_entitlement_blocks_automatic_shop_refund():
    oid, item = _id("order"), _id("pack")
    order = {"id": oid, "lines": [{"item_id": item, "kind": "credit_pack", "name": TAG + " Pack", "quantity": 1,
                                    "quantity_refunded": 0, "line_total": 50.0, "allocated_tax": 0.0}]}
    ref = f"{server._shop_inventory_ref(oid, item)}:unit:0"
    run(server.db.credit_lots.insert_one({"id": _id("lot"), "fulfillment_ref": ref, "qty_total": 10, "qty_remaining": 8}))
    with pytest.raises(server.HTTPException) as exc:
        run(server._build_shop_refund_plan(order, [server.ShopRefundLineIn(item_id=item, quantity=1)]))
    assert exc.value.status_code == 409
    assert "already been used" in str(exc.value.detail)


def test_external_shop_refund_never_guesses_entitlement_reversal():
    oid = _id("external-order")
    run(server.db.shop_orders.insert_one({"id": oid, "status": "paid", "refund_reconciliation_required": False}))
    run(server._apply_shop_refund_fulfillment({"id": _id("attempt"), "shop_order_id": oid, "shop_refund": False}))
    fresh = run(server.db.shop_orders.find_one({"id": oid}, {"_id": 0}))
    assert fresh["refund_reconciliation_required"] is True


# ── Stripe disputes / fees / payouts ────────────────────────────────────────

def test_dispute_loss_and_win_are_idempotent_finance_adjustments():
    pid, intent, did = _id("payment"), _id("pi"), _id("dp")
    original = {"id": pid, "amount": 100.0, "method": "stripe_online", "status": "succeeded",
                "processor": "stripe", "processor_payment_id": intent, "client_id": _id("client")}
    run(server.db.payments.insert_one(original.copy()))
    lost = {"id": did, "amount": 10000, "currency": "usd", "status": "lost", "reason": "fraudulent", "payment_intent": intent}
    run(server._handle_stripe_dispute_event(lost))
    run(server._handle_stripe_dispute_event(lost))
    rows = run(server.db.retail_sales.find({"stripe_dispute_id": did}, {"_id": 0}).to_list(10))
    assert len(rows) == 1 and rows[0]["amount"] == -100.0
    won = {**lost, "status": "won"}
    run(server._handle_stripe_dispute_event(won))
    run(server._handle_stripe_dispute_event(won))
    rows = run(server.db.retail_sales.find({"stripe_dispute_id": did}, {"_id": 0}).to_list(10))
    assert sorted(r["amount"] for r in rows) == [-100.0, 100.0]
    payment = run(server.db.payments.find_one({"id": pid}, {"_id": 0}))
    assert payment["amount"] == 100.0 and payment["status"] == "succeeded"


def test_stripe_fee_reconciliation_creates_one_merchant_fee_expense(monkeypatch):
    bt_id, charge_id = _id("bt"), _id("ch")
    class FakeBT:
        def to_dict(self):
            return {"id": bt_id, "amount": 10000, "fee": 320, "net": 9680, "currency": "usd",
                    "type": "charge", "status": "available", "created": int(time.time()), "reporting_category": "charge"}
    monkeypatch.setattr(server.stripe.BalanceTransaction, "retrieve", lambda _bt: FakeBT())
    obj = {"id": charge_id, "balance_transaction": bt_id}
    run(server._record_stripe_balance_transaction(obj, object_type="charge"))
    run(server._record_stripe_balance_transaction(obj, object_type="charge"))
    expenses = run(server.db.expenses.find({"stripe_balance_transaction_id": bt_id}, {"_id": 0}).to_list(10))
    assert len(expenses) == 1
    assert expenses[0]["category"] == "Merchant fees" and expenses[0]["amount"] == 3.20


def test_stripe_payout_replay_updates_one_reconciliation_record():
    payout_id = _id("po")
    obj = {"id": payout_id, "status": "paid", "amount": 9000, "currency": "usd", "arrival_date": int(time.time()), "method": "standard", "type": "bank_account"}
    run(server._handle_stripe_reconciliation_event("payout.paid", obj))
    run(server._handle_stripe_reconciliation_event("payout.paid", obj))
    assert run(server.db.stripe_payouts.count_documents({"id": payout_id})) == 1
    row = run(server.db.stripe_payouts.find_one({"id": payout_id}, {"_id": 0}))
    assert row["amount"] == 90.0 and row["status"] == "paid"


# ── Marketing suppression ───────────────────────────────────────────────────

def test_bulk_marketing_suppresses_opted_out_client_but_not_other_client():
    opted_id, ok_id = _id("opted"), _id("ok")
    run(server.db.clients.insert_many([
        {"id": opted_id, "name": TAG + " Opted Out", "email": f"{opted_id}@example.invalid", "marketing_email_opt_out": True},
        {"id": ok_id, "name": TAG + " Marketing OK", "email": f"{ok_id}@example.invalid", "marketing_email_opt_out": False},
    ]))
    rows = run(server._bulk_email_resolve_recipients([]))
    ids = {r["id"] for r in rows}
    assert opted_id not in ids and ok_id in ids


def test_unsubscribe_token_only_changes_marketing_preference():
    cid = _id("unsubscribe")
    email = f"{cid}@example.invalid"
    run(server.db.clients.insert_one({"id": cid, "name": TAG + " Unsubscribe", "email": email, "credits": 7}))
    token = server._marketing_unsubscribe_token(cid, email)
    resp = run(server.marketing_email_unsubscribe(token))
    assert resp.status_code == 200
    fresh = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
    assert fresh["marketing_email_opt_out"] is True
    assert fresh["credits"] == 7  # transactional/account state is untouched
