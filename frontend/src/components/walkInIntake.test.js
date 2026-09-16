/* Walk-in intake — the person at the desk with a dog we do not have on file.
 *
 * Pins the operator-facing half of the contract: two names are all that is
 * required, the record is honest about what it does not have (no vaccines),
 * creating one leads straight into serving the dog, and a walk-in can be
 * booked ahead without leaving the booking modal. */
const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const modalSrc = read("WalkInModal.jsx");
const posSrc = read("..", "screens", "Pos.jsx");
const bookingSrc = read("AdminBookingModal.jsx");
const clientsSrc = read("..", "screens", "Clients.jsx");

test("only the two names are required — everything else is optional", () => {
  // A walk-in kept waiting while staff type is a walk-in who goes elsewhere.
  expect(modalSrc).toMatch(/const ready = ownerName\.trim\(\) && dogName\.trim\(\)/);
  expect(modalSrc).toMatch(/disabled=\{!ready \|\| busy\}/);
  for (const optional of ["walk-in-phone", "walk-in-email", "walk-in-breed", "walk-in-notes"]) {
    expect(modalSrc).toContain(optional);
  }
});

test("the form has both required fields and a save gated on them", () => {
  expect(modalSrc).toContain('data-testid="walk-in-owner-name"');
  expect(modalSrc).toContain('data-testid="walk-in-dog-name"');
  expect(modalSrc).toContain('data-testid="walk-in-save"');
  // the save button cannot be pressed until both names are filled in
  expect(modalSrc).toMatch(/data-testid="walk-in-save"[\s\S]{0,200}disabled=\{!ready \|\| busy\}|disabled=\{!ready \|\| busy\}[\s\S]{0,200}data-testid="walk-in-save"/);
});

test("it is honest that a walk-in has handed in no vaccine paperwork", () => {
  expect(modalSrc).toMatch(/No vaccine records are on file/i);
  expect(modalSrc).toMatch(/unvaccinated/i);
});

test("it posts to the walk-in endpoint and hands the created pair back", () => {
  expect(modalSrc).toMatch(/api\.post\("\/clients\/walk-in"/);
  expect(modalSrc).toMatch(/owner_name: ownerName\.trim\(\), dog_name: dogName\.trim\(\)/);
  expect(modalSrc).toMatch(/onCreated\?\.\(data\)/);
});

test("Front Desk offers walk-in intake under clients_edit, not booking_edit", () => {
  // Creating an owner and a dog is a client-hub action; Front Desk holds it.
  expect(posSrc).toMatch(/const canClientsEdit = can\("clients_edit"\)/);
  const at = posSrc.indexOf('testid="pos-quick-walk-in"');
  expect(at).toBeGreaterThan(-1);
  const tile = posSrc.slice(at - 400, at + 60);
  expect(tile).toMatch(/canClientsEdit &&/);
});

test("creating a walk-in from Front Desk leads straight into serving the dog", () => {
  // The record is never the goal on its own — the booking modal opens with the
  // new pair preselected and check-in already ticked.
  expect(posSrc).toMatch(/setWalkInBooking\(\{ clientId: client\.id, dogId: dog\.id \}\)/);
  const handoff = posSrc.slice(posSrc.indexOf("{walkInBooking && ("), posSrc.indexOf("{walkInBooking && (") + 500);
  expect(handoff).toMatch(/defaultCheckIn=\{true\}/);
  expect(handoff).toMatch(/presetClientId=\{walkInBooking\.clientId\}/);
  expect(handoff).toMatch(/presetDogId=\{walkInBooking\.dogId\}/);
});

test("a walk-in can be created without leaving the booking modal, and is then selected", () => {
  // This is what makes "schedule a non-client ahead" possible in one pass.
  expect(bookingSrc).toMatch(/data-testid="ab-new-walk-in"/);
  const onCreated = bookingSrc.slice(bookingSrc.indexOf("<WalkInModal"), bookingSrc.indexOf("<WalkInModal") + 900);
  expect(onCreated).toMatch(/setClients\(prev =>/);
  expect(onCreated).toMatch(/setDogs\(prev =>/);
  expect(onCreated).toMatch(/setClientId\(client\.id\)/);
  expect(onCreated).toMatch(/setDogId\(dog\.id\)/);
});

test("walk-ins are shown as walk-ins and are not counted as families on file", () => {
  expect(clientsSrc).toMatch(/walk_in: \{ text: "Walk-In"/);
  // The headline count comes from the server's client-only total.
  expect(clientsSrc).toMatch(/\$\{clientMeta\.total_clients \?\? clientMeta\.total\} families on file/);
  // and converting one is just picking a normal status
  expect(clientsSrc).toMatch(/\["evaluation_scheduled", "evaluated", "active", "rejected", "walk_in"\]/);
});
