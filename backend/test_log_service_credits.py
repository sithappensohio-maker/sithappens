"""Item 21 — a service logged as paid with Credits (POST /transactions,
server.log_service) spends one credit from the client's pool, the same way
checkout does: the FIFO credit lots plus the client's balance field. It is
therefore not counted as cash revenue. A client with no credit left for that
pool is refused with a 400, and nothing is written.

Same fixture/cleanup convention as test_shared_credit_mutation_service.py
(direct calls into server.py on the disposable test database, see
_test_env.py).
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_LOG_CREDITS"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


def _lots_remaining(client_id, service_type):
    lots = run(server.db.credit_lots.find({"client_id": client_id, "service_type": service_type}, {"_id": 0}).to_list(50))
    return round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)


def _balance(client_id, field):
    doc = run(server.db.clients.find_one({"id": client_id}, {"_id": 0, field: 1})) or {}
    return round(float(doc.get(field) or 0), 2)


def _bookings_for_dog(dog_id):
    return run(server.db.bookings.count_documents({"dog_id": dog_id}))


@pytest.fixture
def client_and_dog():
    admin = _admin_user()
    client = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield client, dog
    finally:
        run(server.db.dogs.delete_many({"owner_id": client["id"]}))
        run(server.db.clients.delete_one({"id": client["id"]}))
        run(server.db.credit_lots.delete_many({"client_id": client["id"]}))
        run(server.db.credit_adjustments.delete_many({"client_id": client["id"]}))
        run(server.db.rewards_ledger.delete_many({"client_id": client["id"]}))
        run(server.db.bookings.delete_many({"client_id": client["id"]}))


@pytest.fixture
def service_factory():
    created = []

    def _make(service_type, base_price=40.0):
        svc = run(server.create_service(server.ServiceIn(
            name=f"{TAG} {service_type} {uuid.uuid4().hex[:6]}", service_type=service_type,
            base_price=base_price, active=True,
        ), _admin_user()))
        created.append(svc["id"])
        return svc

    yield _make
    for sid in created:
        run(server.db.services.delete_one({"id": sid}))


def test_paid_with_credits_draws_one_credit_and_is_not_cash(client_and_dog, service_factory):
    client, dog = client_and_dog
    run(server._mutate_client_credits(client["id"], "training", 5, source="test", reason=TAG))
    svc = service_factory("training", base_price=40.0)

    doc = run(server.log_service(
        server.LogServiceIn(dog_id=dog["id"], service_id=svc["id"], payment_status="paid", payment_method="credits"),
        _admin_user(),
    ))

    assert doc["payment_method"] == "credits"
    assert doc["amount_paid"] == 0.0, "credits settled the visit; no cash was taken"
    assert doc["cash_revenue"] == 0.0, "a visit paid with a credit is not cash revenue"
    assert doc["credits_deducted"] == 1
    assert doc["credit_service_type"] == "training"
    assert doc["credit_covered_value"] == 40.0
    assert doc["credit_lot_redemptions"] and doc["credit_lot_ids"]

    assert _balance(client["id"], "training_credits") == 4.0
    assert _lots_remaining(client["id"], "training") == 4.0

    stored = run(server.db.bookings.find_one({"id": doc["id"]}, {"_id": 0}))
    assert stored["cash_revenue"] == 0.0
    assert stored["amount_paid"] == 0.0


def test_paid_with_credits_refused_when_client_has_no_credit(client_and_dog, service_factory):
    client, dog = client_and_dog
    svc = service_factory("training", base_price=40.0)

    with pytest.raises(HTTPException) as err:
        run(server.log_service(
            server.LogServiceIn(dog_id=dog["id"], service_id=svc["id"], payment_status="paid", payment_method="credits"),
            _admin_user(),
        ))

    assert err.value.status_code == 400
    assert "credit" in str(err.value.detail).lower()
    assert _bookings_for_dog(dog["id"]) == 0, "a refused payment writes no visit"
    assert _balance(client["id"], "training_credits") == 0.0


def test_paid_with_credits_refused_when_balance_has_no_lot_behind_it(client_and_dog, service_factory):
    client, dog = client_and_dog
    # A balance field with no credit_lots row cannot be redeemed; it must not be spent.
    run(server.db.clients.update_one({"id": client["id"]}, {"$set": {"training_credits": 1}}))
    svc = service_factory("training", base_price=40.0)

    with pytest.raises(HTTPException) as err:
        run(server.log_service(
            server.LogServiceIn(dog_id=dog["id"], service_id=svc["id"], payment_status="paid", payment_method="credits"),
            _admin_user(),
        ))

    assert err.value.status_code == 400
    assert _bookings_for_dog(dog["id"]) == 0
    assert _balance(client["id"], "training_credits") == 1.0


def test_paid_with_credits_refused_for_a_service_without_a_credit_pool(client_and_dog, service_factory):
    client, dog = client_and_dog
    run(server._mutate_client_credits(client["id"], "daycare", 3, source="test", reason=TAG))
    svc = service_factory("grooming", base_price=40.0)

    with pytest.raises(HTTPException) as err:
        run(server.log_service(
            server.LogServiceIn(dog_id=dog["id"], service_id=svc["id"], payment_status="paid", payment_method="credits"),
            _admin_user(),
        ))

    assert err.value.status_code == 400
    assert _bookings_for_dog(dog["id"]) == 0
    assert _balance(client["id"], "credits") == 3.0


def test_paid_in_cash_is_unchanged(client_and_dog, service_factory, monkeypatch):
    client, dog = client_and_dog
    run(server._mutate_client_credits(client["id"], "training", 5, source="test", reason=TAG))
    svc = service_factory("training", base_price=40.0)

    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)

    doc = run(server.log_service(
        server.LogServiceIn(dog_id=dog["id"], service_id=svc["id"], payment_status="paid", payment_method="cash"),
        _admin_user(),
    ))

    assert doc["amount_paid"] == 40.0
    assert doc["cash_revenue"] == 40.0
    assert _balance(client["id"], "training_credits") == 5.0
    assert _lots_remaining(client["id"], "training") == 5.0
