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
import { pickCheckInService, serviceOptionLabel } from "./AdminBookingModal";

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

test("the modal asks the server what this client pays", () => {
  // Now fetched wherever a client is known — the scheduled flow showed the
  // same misleading catalogue price the check-in flow did.
  expect(src).toMatch(/api\.get\(`\/clients\/\$\{clientId\}\/service-prices`\)/);
  expect(src).toMatch(/if \(!clientId\) \{ setClientServicePrices\(null\)/);
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
  // Phase 5 moved the price-overrides route decorator into the pricing
  // domain, so the slice now ends at the next function definition instead of
  // the old @api.post marker.
  const fn = backend.slice(backend.indexOf("async def client_service_prices"),
                           backend.indexOf("async def create_client_price_override"));
  expect(fn.length).toBeGreaterThan(0);
  expect(fn).toMatch(/await resolve_client_price\(/);
  expect(fn).not.toMatch(/override_price/);
});


// ---------------------------------------------------------------------------
// The picker itself must show the price the client will actually pay
//
// The Exact Service dropdown hardcoded the catalogue `base_price`, so a client
// with a $20 rate on a $30 service read "Daycare A · daycare · $30.00" in the
// primary control while a separate badge underneath said $20. The most
// prominent number in the form was the one they would NOT be charged — which
// is what "Quick Check-In still brings up the whole price" describes.
// ---------------------------------------------------------------------------

test("a service with a client override shows the client price, not the list price", () => {
  const prices = { [A.id]: own(A, 20) };
  expect(serviceOptionLabel(A, prices))
    .toBe("Daycare A · daycare · $20.00 client price (standard $30.00)");
});

test("a service without an override reads exactly as before", () => {
  expect(serviceOptionLabel(B, { [B.id]: std(B) })).toBe("Daycare B · daycare · $40.00");
});

test("a tier price is shown too — it is still not the list price", () => {
  expect(serviceOptionLabel(A, { [A.id]: tier(A, 24) }))
    .toBe("Daycare A · daycare · $24.00 client price (standard $30.00)");
});

test("an override that happens to equal the list price is not dressed up", () => {
  const same = { ...own(A, 30) };
  expect(serviceOptionLabel(A, { [A.id]: same })).toBe("Daycare A · daycare · $30.00");
});

test("with no price data it falls back to the catalogue price", () => {
  expect(serviceOptionLabel(A, null)).toBe("Daycare A · daycare · $30.00");
  expect(serviceOptionLabel(A, {})).toBe("Daycare A · daycare · $30.00");
});

test("the amount is never computed in React — it comes from the server row", () => {
  // effective_price is used verbatim; nothing multiplies or subtracts here
  const fn = src.slice(src.indexOf("export function serviceOptionLabel"),
                       src.indexOf("export default function AdminBookingModal"));
  expect(fn).toMatch(/p\.effective_price/);
  expect(fn).toMatch(/p\.list_price/);
  expect(fn).not.toMatch(/[-*/+]\s*p\.(effective_price|list_price)/);
});

test("the dropdown renders through the helper, not base_price", () => {
  expect(src).toMatch(/\{serviceOptionLabel\(s, clientServicePrices\)\}/);
  const picker = src.slice(src.indexOf('data-testid="ab-service-id"'),
                           src.indexOf("Selecting the exact catalog service"));
  expect(picker).not.toMatch(/s\.base_price/);
});

// ---------------------------------------------------------------------------
// A failed pricing lookup must never look like "no special pricing"
// ---------------------------------------------------------------------------

test("a service-prices failure is surfaced, not swallowed", () => {
  const fn = src.slice(src.indexOf("api.get(`/clients/${clientId}/service-prices`)"),
                       src.indexOf("// ...and once we know"));
  // the old silent fallback set an EMPTY map, indistinguishable from
  // "this client has no overrides"
  expect(fn).not.toMatch(/setClientServicePrices\(\{\}\)/);
  expect(fn).toMatch(/setClientServicePrices\(null\)/);
  expect(fn).toMatch(/setClientPriceError\(/);
});

test("the operator is told not to check in on unknown pricing", () => {
  expect(src).toMatch(/data-testid="ab-price-error"/);
  expect(src).toMatch(/Client pricing unavailable/);
  expect(src).toMatch(/may be charged the wrong amount/);
});

test("unknown pricing cannot auto-select a service", () => {
  // the selection effect bails while prices are null, so a failed lookup
  // never silently books the catalogue default as if it were correct
  expect(src).toMatch(/if \(!isQuickCheckin \|\| !clientServicePrices \|\| serviceTouchedRef\.current\) return;/);
});


// ---------------------------------------------------------------------------
// Dog-first must name the owner it resolved
//
// GET /clients is capped (1,000 rows against ~13,400 clients on file), and dog
// rows carry only `owner_id` — no name. So the owner of a dog picked at
// runtime is usually NOT in the loaded window and the Client readout showed
// "—" on a dog-first check-in. The file already back-fills an out-of-window
// client for `existing`/`presetClientId`; the same has to happen for one
// chosen during the session.
// ---------------------------------------------------------------------------

test("an owner outside the loaded window is fetched and named", () => {
  expect(src).toMatch(/if \(!clientId \|\| clients\.some\(c => c\.id === clientId\)\) return;/);
  expect(src).toMatch(/api\.get\(`\/clients\/\$\{clientId\}`\)/);
});

test("the resolved owner joins the SAME clients state, not a second one", () => {
  // one source of truth: readout, dog labels and credits all read `clients`
  expect(src).toMatch(/setClients\(prev => \(prev\.some\(c => c\.id === data\.id\) \? prev : \[data, \.\.\.prev\]\)\)/);
  expect(src).not.toMatch(/const \[ownerName, setOwnerName\]/);
  expect(src).not.toMatch(/const \[resolvedClient, setResolvedClient\]/);
});

test("the readout and the pricing request use the same client id", () => {
  // readout reads `clients.find(c => c.id === clientId)`; pricing uses clientId
  expect(src).toMatch(/clients\.find\(c => c\.id === clientId\)\?\.name/);
  expect(src).toMatch(/api\.get\(`\/clients\/\$\{clientId\}\/service-prices`\)/);
});

// ---------------------------------------------------------------------------
// The same truthful labels in the scheduled Admin flow
// ---------------------------------------------------------------------------

test("client prices are fetched whenever a client is known, not only at check-in", () => {
  const fx = src.slice(src.indexOf("// What does THIS client actually pay"),
                       src.indexOf("// ...and once we know"));
  expect(fx).toMatch(/if \(!clientId\)/);
  expect(fx).not.toMatch(/!isQuickCheckin \|\| !clientId/);
});

test("auto-selecting a service stays Quick Check-In only", () => {
  // the scheduled flow gets truthful labels but must not have its service
  // silently changed underneath the operator
  expect(src).toMatch(/if \(!isQuickCheckin \|\| !clientServicePrices \|\| serviceTouchedRef\.current\) return;/);
  expect(src).toMatch(/if \(!isQuickCheckin \|\| !clientServicePrices\) return null;/);
});

test("switching client cannot leave the previous client's prices on screen", () => {
  // the effect re-runs on clientId and clears before refetching
  const fx = src.slice(src.indexOf("// What does THIS client actually pay"),
                       src.indexOf("// ...and once we know"));
  expect(fx).toMatch(/setClientServicePrices\(null\); setClientPriceError\(""\); return;/);
  expect(fx).toMatch(/\}, \[clientId\]\);/);
});

test("an unverified price blocks the booking, not just warns", () => {
  expect(src).toMatch(/disabled=\{saving \|\| !dogId \|\| \(isMultiDate && multiDates\.length === 0\) \|\| !!clientPriceError\}/);
});

test("the failure copy suits both flows", () => {
  expect(src).toMatch(/do not continue until\s+this loads/);
  expect(src).not.toMatch(/do not check in until/);
});
