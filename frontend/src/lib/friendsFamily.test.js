import {
  friendsFamilyOn, isFriendsFamily, isFriendsDog, activeRows, rankOf, byRank, bookedServicePrice, waitingForBill,
  friendsPaidFor,
} from "./friendsFamily";

const payerDog = { id: "a", client_id: "pat", bill_to_client_id: "pat", status: "approved",
  pricing_snapshot: { group_dog_index: 0 }, estimated_price: 30 };
const friendDog = { id: "b", client_id: "sam", bill_to_client_id: "pat", status: "approved",
  pricing_snapshot: { group_dog_index: 1 }, multi_dog_discount: { pre_applied: true, amount: 15 },
  estimated_price: 20, add_ons: [{ price: 5, qty: 1 }] };

test("the controls need the server's switch AND the permission", () => {
  const can = () => true;
  expect(friendsFamilyOn({ can, features: { friends_family: true } })).toBe(true);
  expect(friendsFamilyOn({ can, features: { friends_family: false } })).toBe(false);
  expect(friendsFamilyOn({ can })).toBe(false);
  expect(friendsFamilyOn({ can: () => false, features: { friends_family: true } })).toBe(false);
  expect(friendsFamilyOn(null)).toBe(false);
});

test("the paying family's own dog is friends & family but not a friend's dog", () => {
  expect(isFriendsFamily(payerDog) && !isFriendsDog(payerDog)).toBe(true);
  expect(isFriendsDog(friendDog)).toBe(true);
  expect(isFriendsFamily({ client_id: "x" })).toBe(false);
});

test("cancelled dogs are not on the booking; dogs are ordered as the server ranks them", () => {
  const gone = { ...friendDog, id: "c", status: "cancelled" };
  expect(activeRows([payerDog, gone, friendDog]).map((r) => r.id)).toEqual(["a", "b"]);
  expect(rankOf({ multi_dog_discount: { pre_applied: true } })).toBe(1);
  expect(rankOf({})).toBe(0);
  expect(byRank([friendDog, payerDog]).map((r) => r.id)).toEqual(["a", "b"]);
});

test("the booked service price is the stored price without the extras", () => {
  expect(bookedServicePrice(friendDog)).toBe(15);
  expect(bookedServicePrice({})).toBe(null);
});

test("waiting for the one bill: a dog gone home and not billed yet", () => {
  expect(waitingForBill([{ status: "completed", group_bill_pending: true }])).toBe(true);
  expect(waitingForBill([{ status: "completed", group_bill_claim: "x" }])).toBe(true);
  expect(waitingForBill([{ status: "approved", group_bill_pending: true }, { status: "completed" }])).toBe(false);
});

test("a family's page lists the friends' dogs it pays for, and any booking waiting for its bill", () => {
  const ff = { groups: [
    { group_id: "g1", waiting: false, dogs: [{ dog_id: "a", client_id: "pat" }, { dog_id: "b", client_id: "sam" }] },
    { group_id: "g2", waiting: true, dogs: [{ dog_id: "c", client_id: "pat" }] },
    { group_id: "g3", waiting: false, dogs: [{ dog_id: "d", client_id: "pat" }] },
  ] };
  const got = friendsPaidFor(ff, "pat");
  expect(got.map((g) => g.group_id)).toEqual(["g1", "g2"]);
  expect(got[0].friends.map((d) => d.dog_id)).toEqual(["b"]);
  expect(friendsPaidFor(null, "pat")).toEqual([]);
});
