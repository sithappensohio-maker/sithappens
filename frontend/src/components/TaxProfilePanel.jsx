// Step 4D-2A — Tax Profile (owner-entered personal tax-planning inputs).
//
// The backend is authoritative for completeness (GET /admin/tax-profile
// returns `completeness.federal/.ohio` with exact missing-field labels);
// this panel never infers readiness from field values. Unset-vs-zero is
// explicit: a BLANK input means "not provided", typing 0 stores an
// owner-confirmed zero. PUT uses patch semantics — only edited fields are
// sent, so untouched fields stay unset.
//
// No dollar "you owe" numbers live here or downstream of here until the
// 4D-2B (federal) / 4D-2C (Ohio) engines exist.

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

const FILING_STATUS_LABELS = {
  single: "Single",
  married_filing_jointly: "Married filing jointly",
  married_filing_separately: "Married filing separately",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

const inputCls = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-shTextMuted mt-0.5">{hint}</span>}
    </label>
  );
}

/** Numeric input with explicit unset semantics: "" ⇒ null (unset), "0" ⇒ 0. */
function NumField({ label, hint, value, onChange, testid }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" step="0.01" value={value ?? ""} data-testid={testid}
             placeholder="not provided"
             onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
             className={inputCls} />
    </Field>
  );
}

function TriState({ label, value, onChange, testid, labels = ["Yes", "No"] }) {
  return (
    <Field label={label}>
      <div className="flex gap-2" data-testid={testid}>
        {[[true, labels[0]], [false, labels[1]]].map(([v, l]) => (
          <button key={l} type="button" onClick={() => onChange(v)}
                  data-testid={`${testid}-${l.toLowerCase()}`}
                  className={`px-3 py-1.5 rounded border text-[11px] font-black uppercase tracking-widest ${
                    value === v ? "bg-shPrimary/15 border-shPrimary/40 text-shPrimary"
                                : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted"}`}>
            {l}
          </button>
        ))}
        {value === null && <span className="text-[11px] text-shTextMuted italic self-center">not provided</span>}
      </div>
    </Field>
  );
}

export function CompletenessBadge({ state, testid }) {
  if (!state) return null;
  return state.fields_complete ? (
    <span data-testid={testid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest text-shGreen bg-shGreen/10">
      <i className="fas fa-check" />
      {state.ready_for_calculation ? "Profile complete — ready" : "Profile complete — engine not yet available"}
    </span>
  ) : (
    <span data-testid={testid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/10">
      <i className="fas fa-circle-exclamation" />Tax profile incomplete
    </span>
  );
}

export default function TaxProfilePanel({ year, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);   // {federal:{...}, ohio:{...}, school_district:{...}} — edited keys only

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/tax-profile?year=${year}`);
      setData(r.data); setDraft({ federal: {}, ohio: {}, school_district: {}, projection: {} }); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load tax profile");
    }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  if (err && !data) return <div className="text-red-400 bg-red-500/10 rounded p-3 text-sm" data-testid="taxprofile-error">{err}</div>;
  if (!data) return <div className="text-shTextMuted text-sm" data-testid="taxprofile-loading">Loading tax profile…</div>;

  const p = data.profile;
  const val = (section, key) => (draft[section] && key in draft[section]) ? draft[section][key] : (p[section] || {})[key];
  const set = (section, key) => (v) => setDraft((d) => ({ ...d, [section]: { ...d[section], [key]: v } }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const body = {};
      for (const s of ["federal", "ohio", "school_district", "projection"]) {
        if (Object.keys(draft[s]).length) body[s] = draft[s];
      }
      const r = await api.put(`/admin/tax-profile/${year}`, body);
      setData(r.data); setDraft({ federal: {}, ohio: {}, school_district: {}, projection: {} });
      onChanged?.(r.data);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not save tax profile");
    } finally { setSaving(false); }
  };

  const dirty = ["federal", "ohio", "school_district", "projection"].some((s) => Object.keys(draft[s] || {}).length);

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4" data-testid="tax-profile-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-shText font-black uppercase italic"><i className="fas fa-id-card text-shPrimary mr-2" />Tax Profile — {year}</h4>
        <p className="text-[11px] text-shTextMuted italic">Blank = not provided · typing 0 records a confirmed zero. No SSNs or portal logins are ever stored.</p>
      </div>

      {/* Confirmed business classification — a fact, not a setting */}
      <div className="bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3" data-testid="tax-profile-entity">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-shPrimary mb-1">Business tax classification</p>
        <p className="text-shText font-black">{p.entity.entity_label} <span className="text-shTextMuted font-bold">— {p.entity.treatment_label}</span></p>
        <p className="text-[11px] text-shTextMuted mt-0.5">
          Status: <b className="text-shGreen">Confirmed</b> · No S-corp or C-corp election · Business activity flows to the owner's individual return (Schedule C / Schedule SE).
          Changing federal classification is a deliberate future step, not a casual setting.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Federal */}
        <div className="space-y-2" data-testid="tax-profile-federal">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Federal</p>
            <CompletenessBadge state={data.completeness.federal} testid="taxprofile-federal-badge" />
          </div>
          {!data.completeness.federal.fields_complete && (
            <ul className="text-[12px] text-amber-300 list-disc ml-4" data-testid="taxprofile-federal-missing">
              {data.completeness.federal.missing_fields.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <Field label="Filing status (2026 federal statuses)">
            <select value={val("federal", "filing_status") ?? ""} data-testid="taxprofile-filing-status"
                    onChange={(e) => set("federal", "filing_status")(e.target.value || null)} className={inputCls}>
              <option value="">— not provided —</option>
              {(data.filing_statuses || []).map((s) => <option key={s} value={s}>{FILING_STATUS_LABELS[s] || s}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Prior-year AGI" hint="From last year's federal return" testid="taxprofile-py-agi"
                      value={val("federal", "prior_year_agi")} onChange={set("federal", "prior_year_agi")} />
            <NumField label="Prior-year total tax" hint="Total tax from last year's return" testid="taxprofile-py-tax"
                      value={val("federal", "prior_year_total_tax")} onChange={set("federal", "prior_year_total_tax")} />
          </div>
          <TriState label="Prior-year return covered a full 12 months?" testid="taxprofile-py-12mo"
                    value={val("federal", "prior_year_full_12_months")} onChange={set("federal", "prior_year_full_12_months")} />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Federal withholding YTD" hint="Enter 0 if none" testid="taxprofile-fed-wh-ytd"
                      value={val("federal", "withholding_ytd")} onChange={set("federal", "withholding_ytd")} />
            <NumField label="Expected additional withholding" hint="Rest of this year — 0 if none" testid="taxprofile-fed-wh-rem"
                      value={val("federal", "withholding_expected_remaining")} onChange={set("federal", "withholding_expected_remaining")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="W-2 wages" testid="taxprofile-w2" value={val("federal", "w2_wages")} onChange={set("federal", "w2_wages")} />
            <NumField label="W-2 wages subject to Social Security" hint="Needed for the SE-tax wage-base interaction" testid="taxprofile-w2ss"
                      value={val("federal", "w2_ss_wages")} onChange={set("federal", "w2_ss_wages")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Spouse wages (if joint)" testid="taxprofile-spouse" value={val("federal", "spouse_wages")} onChange={set("federal", "spouse_wages")} />
            <NumField label="Other taxable income" testid="taxprofile-other-income" value={val("federal", "other_taxable_income")} onChange={set("federal", "other_taxable_income")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Other self-employment income" testid="taxprofile-other-se" value={val("federal", "other_se_income")} onChange={set("federal", "other_se_income")} />
            <NumField label="Prior-year overpayment applied" testid="taxprofile-py-over" value={val("federal", "prior_year_overpayment_applied")} onChange={set("federal", "prior_year_overpayment_applied")} />
          </div>
          <Field label="Deduction approach">
            <select value={val("federal", "deduction_method") ?? ""} data-testid="taxprofile-deduction-method"
                    onChange={(e) => set("federal", "deduction_method")(e.target.value || null)} className={inputCls}>
              <option value="">— not provided —</option>
              <option value="standard">Standard deduction</option>
              <option value="itemized">Itemized (enter amount)</option>
            </select>
          </Field>
          {val("federal", "deduction_method") === "itemized" && (
            <NumField label="Itemized deduction amount" testid="taxprofile-itemized"
                      value={val("federal", "itemized_deduction_amount")} onChange={set("federal", "itemized_deduction_amount")} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumField label="SE health insurance" testid="taxprofile-se-health" value={val("federal", "se_health_insurance")} onChange={set("federal", "se_health_insurance")} />
            <NumField label="Retirement / HSA adjustments" testid="taxprofile-retirement" value={val("federal", "retirement_hsa_adjustments")} onChange={set("federal", "retirement_hsa_adjustments")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Other adjustments (lump)" testid="taxprofile-adjustments" value={val("federal", "other_adjustments")} onChange={set("federal", "other_adjustments")} />
            <NumField label="Expected federal credits (nonrefundable, lump)" testid="taxprofile-credits" value={val("federal", "credits_estimate")} onChange={set("federal", "credits_estimate")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Expected refundable credits (EIC, ACTC…)" testid="taxprofile-refundable"
                      value={val("federal", "refundable_credits_estimate")} onChange={set("federal", "refundable_credits_estimate")} />
            <NumField label="Other expected federal taxes (lump)" testid="taxprofile-other-taxes"
                      value={val("federal", "other_expected_federal_taxes")} onChange={set("federal", "other_expected_federal_taxes")} />
          </div>
          <TriState label="Expect material qualified dividends / net capital gains?" testid="taxprofile-qualified-gains"
                    value={val("federal", "expects_qualified_investment_income")} onChange={set("federal", "expects_qualified_investment_income")} />
          <TriState label="Unusual tax situation this year?" testid="taxprofile-unusual"
                    value={val("federal", "unusual_tax_situation")} onChange={set("federal", "unusual_tax_situation")} />

          <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary pt-2">Business projection ({year})</p>
          <NumField label="Expected REMAINING-year Sit Happens profit"
                    hint="Confirm a number (0 is valid). YTD profit is derived from the books automatically; this is your expectation for the rest of the year — a run-rate suggestion may be shown but is never used until you confirm."
                    testid="taxprofile-remaining-profit"
                    value={val("projection", "remaining_business_profit")} onChange={set("projection", "remaining_business_profit")} />
        </div>

        {/* Ohio + School district */}
        <div className="space-y-2" data-testid="tax-profile-ohio">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Ohio</p>
            <CompletenessBadge state={data.completeness.ohio} testid="taxprofile-ohio-badge" />
          </div>
          {!data.completeness.ohio.fields_complete && (
            <ul className="text-[12px] text-amber-300 list-disc ml-4" data-testid="taxprofile-ohio-missing">
              {data.completeness.ohio.missing_fields.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <TriState label="Ohio resident?" testid="taxprofile-oh-resident"
                    value={val("ohio", "resident")} onChange={set("ohio", "resident")} />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Prior-year Ohio tax" hint="From last year's IT 1040" testid="taxprofile-oh-py-tax"
                      value={val("ohio", "prior_year_tax")} onChange={set("ohio", "prior_year_tax")} />
            <NumField label="Prior-year Ohio overpayment applied" testid="taxprofile-oh-py-over"
                      value={val("ohio", "prior_year_overpayment_applied")} onChange={set("ohio", "prior_year_overpayment_applied")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Ohio withholding YTD" hint="Enter 0 if none" testid="taxprofile-oh-wh-ytd"
                      value={val("ohio", "withholding_ytd")} onChange={set("ohio", "withholding_ytd")} />
            <NumField label="Expected additional Ohio withholding" testid="taxprofile-oh-wh-rem"
                      value={val("ohio", "withholding_expected_remaining")} onChange={set("ohio", "withholding_expected_remaining")} />
          </div>

          <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary pt-2">School district income tax</p>
          <Field label="Does an Ohio school-district income tax apply where you live?"
                 hint="Based on your HOME district — never guessed from the business address.">
            <div className="flex gap-2" data-testid="taxprofile-sd-applicable">
              {["yes", "no", "unknown"].map((v) => (
                <button key={v} type="button" onClick={() => set("school_district", "applicable")(v)}
                        data-testid={`taxprofile-sd-${v}`}
                        className={`px-3 py-1.5 rounded border text-[11px] font-black uppercase tracking-widest ${
                          val("school_district", "applicable") === v
                            ? "bg-shPrimary/15 border-shPrimary/40 text-shPrimary"
                            : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted"}`}>
                  {v}
                </button>
              ))}
            </div>
          </Field>
          {val("school_district", "applicable") === "yes" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="District name">
                  <input value={val("school_district", "district_name") ?? ""} data-testid="taxprofile-sd-name"
                         onChange={(e) => set("school_district", "district_name")(e.target.value || null)} className={inputCls} />
                </Field>
                <Field label="District number">
                  <input value={val("school_district", "district_number") ?? ""} data-testid="taxprofile-sd-number"
                         onChange={(e) => set("school_district", "district_number")(e.target.value || null)} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tax base type">
                  <select value={val("school_district", "tax_base_type") ?? ""} data-testid="taxprofile-sd-base"
                          onChange={(e) => set("school_district", "tax_base_type")(e.target.value || null)} className={inputCls}>
                    <option value="">— not provided —</option>
                    <option value="traditional">Traditional</option>
                    <option value="earned_income">Earned income</option>
                  </select>
                </Field>
                <NumField label="District rate %" hint="From official Ohio district tables" testid="taxprofile-sd-rate"
                          value={val("school_district", "rate_pct")} onChange={set("school_district", "rate_pct")} />
              </div>
              <NumField label="School-district withholding YTD" testid="taxprofile-sd-wh"
                        value={val("school_district", "withholding_ytd")} onChange={set("school_district", "withholding_ytd")} />
            </>
          )}
        </div>
      </div>

      {err && <p className="text-red-400 text-[12px]" data-testid="taxprofile-save-err"><i className="fas fa-circle-exclamation mr-1" />{err}</p>}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-shTextMuted italic">
          Changes are audit-logged (who/when/what). Values are for tax year {year} only — a new year starts from a fresh profile.
        </p>
        <button onClick={save} disabled={saving || !dirty} data-testid="taxprofile-save"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? <><i className="fas fa-circle-notch fa-spin mr-1" />Saving…</> : "Save profile"}
        </button>
      </div>
    </div>
  );
}
