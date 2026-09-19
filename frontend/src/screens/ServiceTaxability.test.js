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

  test("there is no category toggle left to switch merchandise tax off", () => {
    // A per-category switch is what let a bag of treats ring up untaxed while
    // Settings looked correct. The only controls are on/off and the rate.
    const panel = src.slice(src.indexOf("function SalesTaxPanel"));
    expect(panel).not.toMatch(/toggleAt/);
    expect(panel).not.toMatch(/sales-tax-applies-/);
    expect(panel).not.toMatch(/const services =/);
    expect(panel).toMatch(/data-testid="sales-tax-enabled"/);
    expect(panel).toMatch(/data-testid="sales-tax-rate"/);
  });

  test("the rule is stated to the owner in plain words", () => {
    expect(src).toMatch(/sales-tax-services-exempt-note/);
    expect(src).toMatch(/Merchandise only/);
    expect(src).toMatch(/never charged sales tax/);
    // and it names the services, so nobody has to guess what counts
    for (const svc of ["daycare", "boarding", "training", "grooming", "photography"]) {
      expect(src).toMatch(new RegExp(svc));
    }
  });

  test("the panel no longer promises tax is carved out of the price", () => {
    // Tax is added on top at the register; saying otherwise taught staff to
    // expect the shelf price to be the total.
    const panel = src.slice(src.indexOf("function SalesTaxPanel"));
    expect(panel).not.toMatch(/back-calculated/);
    expect(panel).toMatch(/added on top/);
  });
});

describe("a product's own tax exemption is reachable", () => {
  const src = read("../components/ManageProductsPanel.jsx");

  test("the editor has the flag at all", () => {
    // It was supported by the model and honoured by the pricer, but there was
    // no field and the endpoints never wrote it — so an exempt item could not
    // be configured, and one set by any other route could not be undone.
    expect(src).toContain('data-testid="product-taxable"');
    expect(src).toMatch(/Charge sales tax on this item/);
  });

  test("it defaults to taxable, and an old product reads back as taxable", () => {
    expect(src).toMatch(/taxable: true, tax_exempt_reason: ""/);
    // absent means taxable — the same default the pricing engine uses
    expect(src).toMatch(/taxable: p\.taxable !== false/);
  });

  test("turning it off asks why, and turning it back on clears the answer", () => {
    expect(src).toContain('data-testid="product-tax-exempt-reason"');
    expect(src).toMatch(/\{!form\.taxable \? \(/);
    expect(src).toMatch(/tax_exempt_reason: form\.taxable \? null : \(form\.tax_exempt_reason\.trim\(\) \|\| null\)/);
  });

  test("an exempt product is visible in the list, not just in its editor", () => {
    // "which of my products are not taxed?" is the question you ask when a
    // filing looks wrong; it should take one glance.
    expect(src).toContain("data-testid={`product-no-tax-${p.id}`}");
    expect(src).toMatch(/p\.taxable === false &&/);
    expect(src).toMatch(/title=\{p\.tax_exempt_reason \|\| "No reason recorded"\}/);
  });
});

describe("the register cannot quietly sell merchandise untaxed", () => {
  const src = read("./Pos.jsx");

  test("a cart with goods and no tax says so", () => {
    // The original bug was invisible: no tax line simply looked like a cart
    // with no tax. Now the cart states it and names where to fix it.
    expect(src).toContain('data-testid="pos-no-tax-notice"');
    expect(src).toMatch(/priced\?\.taxable_subtotal > 0 && !\(priced\?\.tax_amount > 0\)/);
    expect(src).toMatch(/Settings → Sales Tax/);
  });

  test("the tax line shows the rate it charged", () => {
    expect(src).toMatch(/Tax\{priced\.tax_rate_pct > 0 \? ` \(\$\{priced\.tax_rate_pct\}%\)`/);
  });
});

describe("Sales Tax detail speaks in tax dollars, not service revenue", () => {
  const src = read("./SalesTaxFiling.jsx");

  test("source lines are labeled as tax by origin", () => {
    expect(src).toMatch(/booking tax \(historical only — services are not taxed\)/);
    expect(src).toMatch(/merchandise tax — retail \/ shop \/ POS/);
    expect(src).not.toMatch(/from bookings \/ services/);
  });
});
