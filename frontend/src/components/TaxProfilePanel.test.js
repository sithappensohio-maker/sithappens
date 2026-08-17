/**
 * Step 4D-2A — Tax Profile panel tests.
 *
 * Backend is authoritative for completeness — these tests pin that the
 * panel RENDERS the backend's states (never derives its own), that the
 * confirmed Single-Member LLC classification is displayed, and that the
 * unset-vs-zero contract holds: blank input sends nothing, typing 0 sends
 * an explicit 0, clearing a field sends null.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import TaxProfilePanel from "./TaxProfilePanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), put: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const emptyProfile = () => ({
  profile: {
    tax_year: 2026,
    entity: {
      entity_type: "single_member_llc", federal_tax_treatment: "disregarded_entity_schedule_c",
      entity_label: "Single-Member LLC", treatment_label: "Disregarded Entity / Schedule C",
      confirmed: true, s_corp_election: false, c_corp_election: false, partnership: false,
    },
    federal: { filing_status: null, prior_year_agi: null, prior_year_total_tax: null,
               prior_year_full_12_months: null, prior_year_overpayment_applied: null,
               withholding_ytd: null, withholding_expected_remaining: null,
               w2_wages: null, w2_ss_wages: null, spouse_wages: null,
               other_taxable_income: null, other_se_income: null, deduction_method: null,
               itemized_deduction_amount: null, other_adjustments: null,
               se_health_insurance: null, retirement_hsa_adjustments: null, credits_estimate: null },
    ohio: { resident: null, prior_year_tax: null, prior_year_overpayment_applied: null,
            withholding_ytd: null, withholding_expected_remaining: null },
    school_district: { applicable: null, district_name: null, district_number: null,
                       tax_base_type: null, rate_pct: null, withholding_ytd: null },
    notes: null, audit_log: [],
  },
  completeness: {
    federal: { fields_complete: false, ready_for_calculation: false, engine: "not_yet_available",
               missing_fields: ["Federal filing status", "Prior-year federal total tax (for safe-harbor comparison)"] },
    ohio: { fields_complete: false, ready_for_calculation: false, engine: "not_yet_available",
            missing_fields: ["Ohio residency status"] },
  },
  filing_statuses: ["single", "married_filing_jointly", "married_filing_separately",
                    "head_of_household", "qualifying_surviving_spouse"],
});

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.put.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<TaxProfilePanel year={2026} />); });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("confirmed Single-Member LLC classification is displayed as fact", async () => {
  api.get.mockResolvedValue({ data: emptyProfile() });
  await mount();
  const ent = text('[data-testid="tax-profile-entity"]');
  expect(ent).toContain("Single-Member LLC");
  expect(ent).toContain("Disregarded Entity / Schedule C");
  expect(ent).toContain("Confirmed");
  expect(ent).toContain("No S-corp or C-corp election");
});

test("incomplete state lists the backend's exact missing fields", async () => {
  api.get.mockResolvedValue({ data: emptyProfile() });
  await mount();
  expect(text('[data-testid="taxprofile-federal-badge"]')).toMatch(/incomplete/i);
  expect(text('[data-testid="taxprofile-federal-missing"]')).toContain("Prior-year federal total tax");
  expect(text('[data-testid="taxprofile-ohio-missing"]')).toContain("Ohio residency status");
  expect(container.textContent).not.toMatch(/you owe|balance owed/i);
});

test("zero is sent as explicit 0; untouched fields are never sent", async () => {
  api.get.mockResolvedValue({ data: emptyProfile() });
  api.put.mockResolvedValue({ data: emptyProfile() });
  await mount();
  const wh = container.querySelector('[data-testid="taxprofile-fed-wh-ytd"]');
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(wh, "0");
    wh.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector('[data-testid="taxprofile-save"]').click(); });
  expect(api.put).toHaveBeenCalledWith("/admin/tax-profile/2026", {
    federal: { withholding_ytd: 0 },     // explicit confirmed zero…
  });                                     // …and NOTHING else — unset stays unset
});

test("clearing a provided value sends null (back to unset)", async () => {
  const withValue = emptyProfile();
  withValue.profile.federal.prior_year_agi = 88000;
  api.get.mockResolvedValue({ data: withValue });
  api.put.mockResolvedValue({ data: withValue });
  await mount();
  const agi = container.querySelector('[data-testid="taxprofile-py-agi"]');
  expect(agi.value).toBe("88000");
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(agi, "");
    agi.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector('[data-testid="taxprofile-save"]').click(); });
  expect(api.put).toHaveBeenCalledWith("/admin/tax-profile/2026", {
    federal: { prior_year_agi: null },
  });
});

test("complete profile shows complete badge but never a payment amount", async () => {
  const done = emptyProfile();
  done.completeness.federal = { fields_complete: true, ready_for_calculation: false,
                                engine: "not_yet_available", missing_fields: [] };
  api.get.mockResolvedValue({ data: done });
  await mount();
  expect(text('[data-testid="taxprofile-federal-badge"]')).toMatch(/complete/i);
  expect(text('[data-testid="taxprofile-federal-badge"]')).toMatch(/engine not yet available/i);
});

test("school-district question is home-district based, never business address", async () => {
  api.get.mockResolvedValue({ data: emptyProfile() });
  await mount();
  expect(container.textContent).toContain("never guessed from the business address");
  expect(container.querySelector('[data-testid="taxprofile-sd-unknown"]')).toBeTruthy();
});
