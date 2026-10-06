"""The same-day sibling discount comes off a dog's total exactly once.

When a family's first dog has already checked out today at full price, the
second dog (booked separately) is the extra dog and gets the multi-dog
discount. The group checkout preview must show that dog's total as the list
price minus ONE discount. The checkout modal used to take the discount off a
second time on top of this figure; the modal side is covered in
frontend/src/components/checkoutSecondDogDiscount.test.js.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

from test_stale_price_snapshot_fix import (  # noqa: E402
    _admin_user, _booking, _check_in, _daycare_service,
)

TAG = "TEST_SECOND_DOG_DISCOUNT"
PRICE = 40.0


@contextlib.contextmanager
def _family_with_two_dogs():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com",
        "created_at": server.now_iso(),
    }))
    dog_ids = []
    for i in range(2):
        did = str(uuid.uuid4())
        run(server.db.dogs.insert_one({
            "id": did, "name": f"{TAG} Dog {i}", "owner_id": cid, "breed": "Mix", "age_y": 3,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
        }))
        dog_ids.append(did)
    try:
        yield cid, dog_ids
    finally:
        run(server.db.bookings.delete_many({"client_id": cid}))
        run(server.db.invoices.delete_many({"client_id": cid}))
        run(server.db.dogs.delete_many({"owner_id": cid}))
        run(server.db.clients.delete_one({"id": cid}))


def test_the_second_dog_preview_is_its_list_price_less_one_discount():
    with _daycare_service(PRICE), _family_with_two_dogs() as (_cid, (first_dog, second_dog)):
        with _booking(first_dog) as first, _booking(second_dog) as second:
            # The first dog came and left at full price earlier today.
            _check_in(first["id"])
            run(server._check_out_locked(first["id"], None, _admin_user()))

            _check_in(second["id"])
            preview = run(server.checkout_group_preview(second["id"], _admin_user()))
            row = preview["bookings"][0]

            assert float(row["estimated_price"]) == PRICE
            discount = float(row["checkout_preview_discount"])
            assert discount == PRICE / 2                                  # the 50% sibling discount
            assert float(row["checkout_preview_total"]) == PRICE - discount
