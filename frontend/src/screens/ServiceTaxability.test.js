/**
 * Step 4C-1 — service vs merchandise taxability: frontend contract pins.
 *
 * The tax MATH is entirely server-side (pinned by backend
 * test_service_taxability.py A–T); what the frontend owns is:
 *   1. the register's custom-item merchandise/service structured selection
 *      (and that it reaches the checkout payload as custom_kind);
 *   2. Settings no longer offering per-service tax toggles the server would
 *      ignore, and stating the service exemption;
 *   3. the Sales Tax detail describing tax-oriented numbers, never implying
 *      service revenue is tax.
 * Source-pin pattern (see pendingActions.test.js) — these are contracts on
 * component source, cheap and unambiguous, no mount required.
 */
import fs from "fs";
import path from "path";

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

describe("POS custom items carry the structured merchandise/service choice", () => {
  const src = read("./Pos.jsx");

  test("selector offers both kinds explicitly", () => {
    expect(src).toMatch(/Merchandise — taxable/);
    expect(src).toMatch(/Service — no sales tax/);
    expect(src).toMatch(/data-testid=\{`pos-custom-kind-\$\{k\}`\}/);
  });

  test("custom_kind reaches the checkout payload (defaulting merchandise)", () => {
    expect(src).toMatch(/custom_kind: l\.custom_kind \|\| "merchandise"/);
    expect(src).toMatch(/custom_kind: customKind/);
  });
});

describe("Settings sales-tax panel matches the server policy", () => {
  const src = read("./Settings.jsx");

  test("service toggles are gone; grooming/photography/retail remain", () => {
    const panel = src.slice(src.indexOf("function SalesTaxPanel"));
    const services = panel.slice(panel.indexOf("const services"), panel.indexOf("];"));
    expect(services).not.toMatch(/daycare/);
    expect(services).not.toMatch(/boarding/);
    expect(services).not.toMatch(/"training"/);
    expect(services).not.toMatch(/credit_packs/);
    expect(services).toMatch(/grooming/);
    expect(services).toMatch(/photography/);
    expect(services).toMatch(/retail/);
  });

  test("the exemption is stated to the owner", () => {
    expect(src).toMatch(/sales-tax-services-exempt-note/);
    expect(src).toMatch(/never\s*charged sales tax/);
  });
});

describe("Sales Tax detail speaks in tax dollars, not service revenue", () => {
  const src = read("./SalesTaxFiling.jsx");

  test("source lines are labeled as tax by origin", () => {
    expect(src).toMatch(/booking tax \(grooming\/photography or historical\)/);
    expect(src).toMatch(/merchandise tax — retail \/ shop \/ POS/);
    expect(src).not.toMatch(/from bookings \/ services/);
  });
});
