"""Editing a client can't undo money or notes that changed meanwhile.

Audit #3 (2026-09-25): PUT /clients/{id} compared the edit form's credit
numbers with the database NOW and wrote the difference, and $set the tab
balance and every other field straight from the form. The form is filled
from the client list, which can be hours old. So:

  * a checkout used 2 daycare credits → the owner fixes a phone number on a
    form opened earlier → the 2 credits come back;
  * a visit went on the tab ($60) → the same save wipes the tab to the old $0;
  * a partial save (just name/email/phone) zeroed every credit pool and the
    tab, because the missing fields defaulted to 0;
  * a note the contact form appended meanwhile was overwritten.

Now the form sends the record as it showed it (`base`); only fields the
operator changed are written, a credit edit moves the live balance by the
operator's change, and the tab is never written from the profile form.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CLIENT_EDIT_STALE"
ADMIN = {"id": "stale-admin", "role": "admin", "name": "Pat Owner", "email": "stale-admin@example.com"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    ids = [c["id"] for c in run(server.db.clients.find({"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(200))]
    run(server.db.credit_lots.delete_many({"client_id": {"$in": ids}}))
    run(server.db.clients.delete_many({"id": {"$in": ids}}))


def _client(daycare=10, boarding=2):
    c = {
        "id": str(uuid.uuid4()), "name": f"{TAG} {uuid.uuid4().hex[:5]}", "email": "owner@example.com",
        "phone": "614-555-0100", "address": "", "emerg": "", "credits": 0, "training_credits": 0,
        "boarding_credits": 0, "account_balance": 0.0, "evaluation_notes": "Met on Monday.",
        "client_status": "active", "created_at": server.now_iso(),
    }
    run(server.db.clients.insert_one(dict(c)))
    for field, qty in (("credits", daycare), ("boarding_credits", boarding)):
        if qty:
            run(server._mutate_client_credits(c["id"], server.CREDIT_POOL_FIELD_TO_SERVICE_TYPE[field], qty,
                                              source="test", reason="setup"))
    return run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0}))


def _meanwhile(c):
    """What happens between opening the form and saving it: a checkout uses
    2 daycare credits and 1 boarding credit, a visit goes on the tab, and
    the contact form appends a note."""
    run(server._mutate_client_credits(c["id"], "daycare", -2, source="checkout", reason="visit"))
    run(server._mutate_client_credits(c["id"], "boarding", -1, source="checkout", reason="stay"))
    run(server.db.clients.update_one({"id": c["id"]}, {"$inc": {"account_balance": 60.0},
                                                      "$set": {"evaluation_notes": "Met on Monday.\nInquiry: leash pulling."}}))


def _save(c, form, base=True):
    model = getattr(server, "ClientUpdateIn", server.ClientIn)  # the old code had no base (and ignored it)
    body = model(**form, **({"base": c} if base else {}))
    return run(server.update_client(c["id"], body, ADMIN))


def _now(c):
    return run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0}))


def test_a_stale_form_saving_a_phone_change_undoes_nothing():
    c = _client()
    _meanwhile(c)
    _save(c, {**c, "phone": "614-555-0199"})          # the whole (stale) record, one field changed
    now = _now(c)
    assert now["phone"] == "614-555-0199"
    assert now["credits"] == 8, "the 2 credits the checkout used don't come back"
    assert now["boarding_credits"] == 1
    assert now["account_balance"] == 60.0, "the tab isn't wiped back to the old $0"
    assert "leash pulling" in now["evaluation_notes"], "a note added meanwhile survives"


def test_a_credit_edit_is_the_operators_change_applied_to_the_live_balance():
    c = _client()
    _meanwhile(c)                                      # live: 8 daycare credits
    _save(c, {**c, "credits": 12})                     # the form showed 10; the owner typed 12 (+2)
    assert _now(c)["credits"] == 10, "+2 on the live 8 — not back to a stale 12"
    lots = run(server.db.credit_lots.find({"client_id": c["id"], "service_type": "daycare"}, {"_id": 0}).to_list(50))
    assert round(sum(l.get("qty_remaining", 0) for l in lots), 2) == 10, "the lot ledger agrees with the balance"


def test_a_partial_save_leaves_what_it_didnt_send_alone():
    c = _client()
    run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"account_balance": 45.0}}))
    run(server.update_client(c["id"], server.ClientIn.model_construct(
        _fields_set={"name", "email", "phone"}, name=c["name"], email="", phone="555-555-0000"), ADMIN))
    now = _now(c)
    assert now["email"] == "" and now["phone"] == "555-555-0000"
    assert now["credits"] == 10 and now["boarding_credits"] == 2, "missing pools used to be zeroed"
    assert now["account_balance"] == 45.0, "…and the tab"
    assert now["evaluation_notes"] == "Met on Monday."


def test_the_tab_is_never_written_from_the_profile_form():
    c = _client()
    run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"account_balance": 30.0}}))
    _save(c, {**c, "account_balance": 0.0}, base=False)
    assert _now(c)["account_balance"] == 30.0


def test_without_a_base_the_api_still_sets_credits_to_the_number_given():
    c = _client()
    run(server.update_client(c["id"], server.ClientIn(name=c["name"], email=c["email"], credits=4), ADMIN))
    assert _now(c)["credits"] == 4


def test_an_unchanged_form_writes_nothing():
    c = _client()
    _meanwhile(c)
    before = _now(c)
    _save(c, dict(c))
    assert _now(c) == before


def test_a_double_click_or_retry_applies_a_credit_change_once():
    c = _client()
    body = server.ClientUpdateIn(**{**c, "credits": 12}, base=c, edit_id="form-1")
    run(server.update_client(c["id"], body, ADMIN))
    run(server.update_client(c["id"], body, ADMIN))      # the same form, saved again
    assert _now(c)["credits"] == 12, "+2 once — not +4"
    again = server.ClientUpdateIn(**{**c, "credits": 12}, base=c, edit_id="form-2")
    run(server.update_client(c["id"], again, ADMIN))     # a NEW form with its own +2 is a new change
    assert _now(c)["credits"] == 14
