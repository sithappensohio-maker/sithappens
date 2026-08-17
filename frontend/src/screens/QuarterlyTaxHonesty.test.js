/**
 * Step 4D-2A — honesty-gate contract pins on the quarterly-tax UI source
 * (pendingActions.test.js precedent: pin wording contracts without a mount).
 * The flat-rate reserve must never read as a federal/Ohio amount due, and
 * the deadline cards must use official payment periods without "Due $X".
 */
import fs from "fs";
import path from "path";

const staff = fs.readFileSync(path.join(__dirname, "./Staff.jsx"), "utf8");
const mileage = fs.readFileSync(path.join(__dirname, "../components/MileageDashTile.jsx"), "utf8");

describe("quarterly tab honesty gate", () => {
  test("misleading labels are gone", () => {
    expect(staff).not.toMatch(/Est\. Tax Owed YTD/);
    expect(staff).not.toMatch(/"BALANCE OWED"/);
    expect(staff).not.toMatch(/label="TOTAL TAX YTD"/);
    expect(staff).not.toMatch(/Mark paid/);
  });

  test("reserve is labeled as planning, never tax due", () => {
    expect(staff).toMatch(/Planning Reserve YTD \(not tax due\)/);
    expect(staff).toMatch(/RESERVE REMAINING \(PLANNING — NOT TAX DUE\)/);
    expect(staff).toMatch(/Legacy planning reserve\./);
    expect(staff).toMatch(/NOT Ohio tax law/);
  });

  test("quarter cards show deadlines with no required dollar", () => {
    expect(staff).toMatch(/Deadline \{q\.due\}/);
    expect(staff).toMatch(/Required amount: <b className="text-shText">not calculated<\/b>/);
    expect(staff).not.toMatch(/Due \{q\.due\}/);
  });

  test("federal engine card is mounted; Ohio stays gated until 4D-2C", () => {
    // Step 4D-2B — the federal card is now the real engine component
    // (FederalEstimatedTaxCard, tested in its own suite); Ohio remains an
    // honesty-gated placeholder in Staff.jsx.
    expect(staff).toMatch(/qt-jurisdiction-status/);
    expect(staff).toMatch(/<FederalEstimatedTaxCard year=\{year\}/);
    expect(staff).toMatch(/Tax profile incomplete/);
    expect(staff).toMatch(/arrives in 4D-2C/);
    expect(staff).toMatch(/The legacy flat 2\.75% figure is NOT Ohio tax/);
  });

  test("municipal tax is explicitly excluded", () => {
    expect(staff).toMatch(/Municipal \(city\) income tax is separate/);
  });

  test("jurisdiction-split payments panel replaced the combined ledger UI", () => {
    expect(staff).toMatch(/<EstimatedTaxPayments year=\{year\} refreshKey=\{payVersion\}/);
    expect(staff).not.toMatch(/TaxPaymentModal/);
  });
});

describe("mileage tile honesty", () => {
  test("deduction is shown; fabricated tax savings are gone", () => {
    expect(mileage).toMatch(/Mileage deduction recorded/);
    expect(mileage).not.toMatch(/tax savings/i);
    expect(mileage).not.toMatch(/combined_tax_rate_pct/);
    expect(mileage).not.toMatch(/tax saved/);
  });
});
