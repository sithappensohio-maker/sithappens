// Quick Check-In walked existing clients past their own special pricing.
//
// An individual client price is keyed to ONE exact `services.id`. Quick
// Check-In picks the service for the operator, and it used to pick the
// catalogue default for the service type:
//
//   activeBaseServices.find(s => s.service_type === wantedType && s.is_default)
//     || activeBaseServices.find(s => s.service_type === wantedType)
//
// So a client whose $20 rate sits on "Daycare A" was auto-booked onto the
// default "Daycare B" and rang at B's full $40. Nothing downstream could fix
// it: the resolver correctly finds no override for B, and checkout's refresh
// sees a booking that legitimately holds B's id.
//
// These exercise the real rule, not its source text — the previous rule read
// perfectly and was still wrong. What the client PAYS is never decided here;
// the server does that with resolve_client_price. This only chooses which
// service is booked.
import fs from "fs";
import path from "path";
import { pickCheckInService } from "./AdminBookingModal";

const src = fs.readFileSync(path.join(__dirname, "AdminBookingModal.jsx"), "utf8");

const A = { id: "svc-a", name: "Daycare A", service_type: "daycare", base_price: 30, is_default: false };
const B = { id: "svc-b", name: "Daycare B", service_type: "daycare", base_price: 40, is_default: true };
const C = { id: "svc-c", name: "Daycare C", service_type: "daycare", base_price: 35, is_default: false };
const BOARD = { id: "svc-board", name: "Boarding X", service_type: "boarding", base_price: 60, is_default: true };

const std = (s) => ({ service_id: s.id, service_type: s.service_type, list_price: s.base_price,
                      effective_price: s.base_price, pricing_source: "standard", override_id: null });
const own = (s, price) => ({ service_id: s.id, service_type: s.service_type, list_price: s.base_price,
                             effective_price: price, pricing_source: "client_override", override_id: "ovr-1" });
const tier = (s, price) => ({ service_id: s.id, service_type: s.service_type, list_price: s.base_price,
                              effective_price: price, pricing_source: "tier", override_id: null });

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("one matching override selects that exact service, not the default", () => {
  const prices = { [A.id]: own(A, 20), [B.id]: std(B) };
  const pick = pickCheckInService([A, B], prices, "daycare");
  expect(pick.serviceId).toBe(A.id);          // the $20 service, not the $40 default
  expect(pick.reason).toBe("client_override");
});

test("no override keeps today's behaviour: the catalogue default", () => {
  const prices = { [A.id]: std(A), [B.id]: std(B) };
  const pick = pickCheckInService([A, B], prices, "daycare");
  expect(pick.serviceId).toBe(B.id);
  expect(pick.reason).toBe("default");
});

test("no override and no default falls back to the first of the type", () => {
  const prices = { [A.id]: std(A), [C.id]: std(C) };
  const pick = pickCheckInService([A, C], prices, "daycare");
  expect(pick.serviceId).toBe(A.id);
  expect(pick.reason).toBe("default");
});

test("an override for a different service type is ignored", () => {
  const prices = { [B.id]: std(B), [BOARD.id]: own(BOARD, 45) };
  const pick = pickCheckInService([B, BOARD], prices, "daycare");
  expect(pick.serviceId).toBe(B.id);
  expect(pick.reason).toBe("default");
});

test("two matching overrides are never guessed between", () => {
  const prices = { [A.id]: own(A, 20), [C.id]: own(C, 22), [B.id]: std(B) };
  const pick = pickCheckInService([A, C, B], prices, "daycare");
  expect(pick.serviceId).toBeNull();          // nothing auto-selected
  expect(pick.reason).toBe("ambiguous");
  expect(pick.options.map(o => o.id).sort()).toEqual([A.id, C.id]);
});

test("tier pricing does not steer selection", () => {
  // A tier price applies to a service, but it is not an INDIVIDUAL override
  // and must not change which service is booked.
  const prices = { [A.id]: tier(A, 24), [B.id]: std(B) };
  const pick = pickCheckInService([A, B], prices, "daycare");
  expect(pick.serviceId).toBe(B.id);
  expect(pick.reason).toBe("default");
});

test("selection never falls back to matching on service_type alone", () => {
  // Two daycare services, override on neither -> the default wins on identity,
  // never "some daycare service will do".
  const prices = { [A.id]: std(A), [C.id]: std(C), [B.id]: std(B) };
  const pick = pickCheckInService([A, C, B], prices, "daycare");
  expect(pick.serviceId).toBe(B.id);
});

test("missing or empty price data degrades to the old behaviour", () => {
  expect(pickCheckInService([A, B], null, "daycare").serviceId).toBe(B.id);
  expect(pickCheckInService([A, B], {}, "daycare").serviceId).toBe(B.id);
  expect(pickCheckInService([], {}, "daycare").serviceId).toBeNull();
});

// ---------------------------------------------------------------------------
// Wiring — the rule has to actually reach the modal
// ---------------------------------------------------------------------------

test("quick check-in asks the server what this client pays", () => {
  expect(src).toMatch(/api\.get\(`\/clients\/\$\{clientId\}\/service-prices`\)/);
  expect(src).toMatch(/if \(!isQuickCheckin \|\| !clientId\)/);
});

test("the modal applies the rule instead of the old type-only default", () => {
  expect(src).toMatch(/pickCheckInService\(catalogServices, clientServicePrices, serviceType\)/);
});

test("a manual service choice is never overridden by auto-selection", () => {
  expect(src).toMatch(/serviceTouchedRef\.current = true;/);
  expect(src).toMatch(/if \(!isQuickCheckin \|\| !clientServicePrices \|\| serviceTouchedRef\.current\) return;/);
});

test("ambiguity clears the selection rather than picking one", () => {
  expect(src).toMatch(/if \(pick\.reason === "ambiguous"\) \{ setServiceId\(""\); return; \}/);
});

// ---------------------------------------------------------------------------
// Staff must SEE it
// ---------------------------------------------------------------------------

test("the client price and the standard price are both shown", () => {
  expect(src).toMatch(/data-testid="ab-client-price"/);
  expect(src).toMatch(/Client price/);
  expect(src).toMatch(/Standard \$\{Number\(checkInPricing\.selected\.list_price/);
});

test("a mismatch warns instead of silently showing standard price", () => {
  expect(src).toMatch(/data-testid="ab-price-mismatch"/);
  expect(src).toMatch(/has special pricing for another \{serviceType\} service/);
  expect(src).toMatch(/Choose the correct service before check-in/);
});

test("ambiguity asks the operator to choose and shows each price", () => {
  expect(src).toMatch(/data-testid="ab-price-ambiguous"/);
  expect(src).toMatch(/Choose the exact service/);
  expect(src).toMatch(/effective_price/);
});

// ---------------------------------------------------------------------------
// Server authority
// ---------------------------------------------------------------------------

test("the frontend chooses a service identity, never a dollar amount", () => {
  // the booking/quote payloads still send service_id and let the server price it
  expect(src).toMatch(/service_id: serviceId \|\| undefined/);
  // no client-side arithmetic inventing an override price
  expect(src).not.toMatch(/effective_price\s*\*/);
  expect(src).not.toMatch(/override_price\s*=/);
});

test("the price endpoint is the canonical resolver, not a second formula", () => {
  const backend = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "backend", "server.py"), "utf8");
  const fn = backend.slice(backend.indexOf("async def client_service_prices"),
                           backend.indexOf("@api.post(\"/clients/{client_id}/price-overrides\")"));
  expect(fn).toMatch(/await resolve_client_price\(/);
  expect(fn).not.toMatch(/override_price/);
});
