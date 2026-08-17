// Step 4C — Ohio Sales Tax Due & Filing Tracker (Finance → Sales Tax tab).
//
// One screen-level fetch: GET /admin/sales-tax/tracker. Every mutating
// endpoint (record filing, record payment, save settings) returns the full
// tracker payload, so responses feed setData directly — no refetch dance.
// The backend is authoritative for ALL dollar math (net liability comes
// from the canonical 4B-1/4B-9 helper); this component never computes tax.
//
// Failed fetches render an explicit error state — never a fake "$0.00 due"
// (RegisterHub doctrine: a failed request must not impersonate good news).

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { SALES_TAX_FILING_STATUS } from "../lib/statusDefs";
import { todayISO } from "../lib/date";
import { fmtDate } from "../lib/format";

function money(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

const URGENCY_CLS = {
  overdue: "text-red-400 border-red-500/50 bg-red-500/10",
  urgent: "text-red-300 border-red-500/40 bg-red-500/10",
  warning: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  due_soon: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  normal: "text-shText border-shBorder bg-[var(--sh-card-base)]",
};

function StatusPill({ status, testid }) {
  const def = SALES_TAX_FILING_STATUS[status] || { label: status, icon: "fa-circle", cls: "text-gray-400 bg-gray-500/10" };
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${def.cls}`}>
      <i className={`fas ${def.icon}`} />{def.label}
    </span>
  );
}

function dueLine(p) {
  if (!p?.effective_due_date) return null;
  if (p.status === "overdue") return `Due ${fmtDate(p.effective_due_date)} · ${p.days_overdue} day${p.days_overdue === 1 ? "" : "s"} overdue`;
  if (p.days_until_due != null) return `Due ${fmtDate(p.effective_due_date)} · ${p.days_until_due} day${p.days_until_due === 1 ? "" : "s"} remaining`;
  return `Due ${fmtDate(p.effective_due_date)}`;
}

export default function SalesTaxFilingTab() {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [fileFor, setFileFor] = useState(null);   // period state → filing modal
  const [payFor, setPayFor] = useState(null);     // period state → payment modal
  const [detailsFor, setDetailsFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/sales-tax/tracker");
      setData(r.data); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load sales tax tracker");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="text-shTextMuted text-sm py-8 text-center" data-testid="stt-loading"><i className="fas fa-circle-notch fa-spin mr-2" />Loading sales tax…</div>;
  }
  if (err && !data) {
    return (
      <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 text-sm" data-testid="stt-error">
        <i className="fas fa-triangle-exclamation mr-2" />{err}
        <button onClick={load} className="ml-3 underline font-bold" data-testid="stt-retry">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const applied = (payload) => { setData(payload); setErr(""); };

  if (data.setup_required) {
    const prev = data.unconfigured_preview;
    return (
      <div className="space-y-4" data-testid="stt-setup-card">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 space-y-3">
          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-landmark mr-2" />Ohio Sales Tax</p>
          <h3 className="text-xl font-black text-shText">Set up Ohio Sales Tax Tracking</h3>
          <p className="text-sm text-shTextMuted max-w-xl">
            Choose the filing schedule assigned to your business by Ohio so Sit Happens can
            calculate your filing periods and due dates. The Department of Taxation assigns
            the filing interval — it is never guessed from your sales volume.
          </p>
          {prev && (
            <p className="text-sm text-shText" data-testid="stt-preview-liability">
              {prev.label} net sales-tax liability so far: <b>{money(prev.liability)}</b>
              <span className="block text-[12px] text-shTextMuted mt-1">Filing schedule needs setup — no due date is shown until Ohio's assigned frequency is configured.</span>
            </p>
          )}
          <button onClick={() => setSetupOpen(true)} data-testid="stt-setup-btn"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/90 transition">
            <i className="fas fa-gear mr-1" />Set Filing Schedule
          </button>
        </div>
        {setupOpen && <SettingsModal current={null} onClose={() => setSetupOpen(false)} onSaved={() => { setSetupOpen(false); load(); }} />}
      </div>
    );
  }

  const primary = data.primary;
  const current = data.current;
  const showCurrentSecondary = current && primary && current.period_key !== primary.period_key;
  const periodsNewestFirst = [...(data.periods || [])].reverse();

  return (
    <div className="space-y-4" data-testid="stt-tracker">
      {err && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm" data-testid="stt-error">
          <i className="fas fa-triangle-exclamation mr-2" />{err}
        </div>
      )}

      {data.late_warning && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl px-4 py-2.5 text-[13px] font-bold" data-testid="stt-late-warning">
          <i className="fas fa-triangle-exclamation mr-2" />{data.late_warning}
        </div>
      )}

      {(data.needs_review_periods || []).length > 0 && (
        <div className="bg-purple-500/10 border border-purple-500/40 text-purple-300 rounded-xl px-4 py-2.5 text-[13px]" data-testid="stt-needs-review-banner">
          <i className="fas fa-magnifying-glass-dollar mr-2" />
          <b>Needs review:</b> the ledger changed after filing for {(data.needs_review_periods || []).join(", ")}. Open the period details to see the variance.
        </div>
      )}

      {primary && <PrimaryCard p={primary} onDetails={() => setDetailsFor(primary)}
                               onFile={() => setFileFor(primary)} onPay={() => setPayFor(primary)} />}

      {showCurrentSecondary && (
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-2" data-testid="stt-current-card">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Current period · {current.label}</p>
            <p className="text-sm text-shText">Tax accrued so far: <b data-testid="stt-current-liability">{money(current.liability)}</b> <span className="text-shTextMuted">· not yet closed{current.effective_due_date ? ` · files by ${fmtDate(current.effective_due_date)}` : ""}</span></p>
          </div>
          <button onClick={() => setDetailsFor(current)} className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline" data-testid="stt-current-details">Details<i className="fas fa-arrow-right ml-1" /></button>
        </div>
      )}

      <HistoryList periods={periodsNewestFirst} onDetails={setDetailsFor} onFile={setFileFor} onPay={setPayFor} />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-shTextMuted italic">
          Amounts are an accounting aid computed from your Sit Happens ledger — the Ohio
          Department of Taxation's return is authoritative. Recording a filing here does not
          file anything with Ohio.
        </p>
        <button onClick={() => setSetupOpen(true)} data-testid="stt-open-settings"
                className="text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
          <i className="fas fa-gear mr-1" />Filing schedule settings
        </button>
      </div>

      {setupOpen && <SettingsModal current={data.settings} onClose={() => setSetupOpen(false)} onSaved={() => { setSetupOpen(false); load(); }} />}
      {fileFor && <RecordFilingModal p={fileFor} settings={data.settings} onClose={() => setFileFor(null)} onSaved={(payload) => { setFileFor(null); applied(payload); }} />}
      {payFor && <RecordPaymentModal p={payFor} confirm={confirm} onClose={() => setPayFor(null)} onSaved={(payload) => { setPayFor(null); applied(payload); }} />}
      {detailsFor && <DetailsModal p={detailsFor} onClose={() => setDetailsFor(null)} />}
    </div>
  );
}

function PrimaryCard({ p, onDetails, onFile, onPay }) {
  const urgency = URGENCY_CLS[p.urgency] || URGENCY_CLS.normal;
  const filed = !!p.filing_id;
  const isZero = p.status === "zero_return_filed";
  const headline = filed
    ? (isZero ? money(0) : money(p.remaining_balance > 0.005 ? p.remaining_balance : (p.snapshot?.amount_to_remit ?? 0)))
    : money(p.projected_amount_to_remit ?? p.liability);
  const headlineLabel = filed
    ? (p.remaining_balance > 0.005 ? "Payment remaining" : "Amount remitted")
    : (p.status === "open" ? "Estimated sales tax accrued so far" : "Estimated amount to remit");
  return (
    <div className={`rounded-xl border p-5 space-y-3 ${urgency}`} data-testid="stt-primary-card">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[0.3em]"><i className="fas fa-landmark mr-2" />Ohio Sales Tax</p>
          <p className="text-[13px] text-shTextMuted mt-0.5" data-testid="stt-primary-period">
            {p.status === "open" ? "Current filing period" : "Filing period"} · {p.label} ({fmtDate(p.period_start)} – {fmtDate(p.period_end)})
          </p>
        </div>
        <StatusPill status={p.status} testid="stt-primary-status" />
      </div>
      {p.status === "overdue" && (
        <p className="text-[15px] font-black uppercase tracking-widest text-red-400" data-testid="stt-overdue-flag">
          <i className="fas fa-triangle-exclamation mr-2" />Overdue — {p.days_overdue} day{p.days_overdue === 1 ? "" : "s"} past due
        </p>
      )}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-4xl font-black" data-testid="stt-primary-amount">{headline}</p>
          <p className="text-[12px] text-shTextMuted uppercase tracking-widest font-bold mt-1">{headlineLabel}</p>
          {!filed && !isZero && (
            <p className="text-[12px] text-shTextMuted mt-1" data-testid="stt-primary-breakdown">
              Net sales-tax liability {money(p.liability)}
              {(p.projected_timely_discount || 0) !== 0 && <> · timely-filing discount {money(p.projected_timely_discount)}</>}
            </p>
          )}
          {filed && (
            <p className="text-[12px] text-shTextMuted mt-1" data-testid="stt-primary-filed-line">
              Filed {fmtDate(p.filed_date)}{p.confirmation_ref ? <> · Confirmation {p.confirmation_ref}</> : null} · Paid {money(p.total_paid)} of {money(p.snapshot?.amount_to_remit)}
            </p>
          )}
        </div>
        <div className="text-right">
          {dueLine(p) && <p className="text-[14px] font-black" data-testid="stt-primary-due">{dueLine(p)}</p>}
          {p.adjusted_due_date && (
            <p className="text-[11px] text-shTextMuted" data-testid="stt-primary-due-override">
              Statutory due date {fmtDate(p.statutory_due_date)} · adjusted{p.due_date_override_reason ? `: ${p.due_date_override_reason}` : ""}
            </p>
          )}
        </div>
      </div>
      {p.needs_review && p.variance && (
        <div className="bg-purple-500/10 border border-purple-500/40 text-purple-300 rounded px-3 py-2 text-[12px]" data-testid="stt-primary-variance">
          <b>Needs review:</b> filed tax liability {money(p.variance.filed_liability)} · current ledger liability {money(p.variance.current_liability)} · difference {money(p.variance.difference)}. {p.variance.message}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button onClick={onDetails} data-testid="stt-primary-view-details"
                className="bg-[var(--sh-card-base)] border border-shBorder text-shText px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:border-shSecondary transition">
          <i className="fas fa-list mr-1" />View Details
        </button>
        {!filed && (
          <button onClick={onFile} data-testid="stt-primary-record-filing"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shPrimary/90 transition">
            <i className="fas fa-file-signature mr-1" />Record Filing / Payment
          </button>
        )}
        {filed && !isZero && p.remaining_balance > 0.005 && (
          <button onClick={onPay} data-testid="stt-primary-record-payment"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shPrimary/90 transition">
            <i className="fas fa-coins mr-1" />Record Payment
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryList({ periods, onDetails, onFile, onPay }) {
  if (!periods.length) return null;
  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden" data-testid="stt-history">
      <p className="px-4 pt-3 pb-2 text-[12px] font-black uppercase tracking-[0.3em] text-shTextMuted"><i className="fas fa-clock-rotate-left mr-2" />Filing history</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm md:min-w-[720px]">
          <thead>
            <tr className="text-left text-[10px] font-black uppercase tracking-widest text-shTextMuted border-b border-shBorder">
              <th className="px-4 py-2">Period</th>
              <th className="px-2 py-2 text-left md:text-right hidden md:table-cell">Net liability</th>
              <th className="px-2 py-2 text-left md:text-right hidden md:table-cell">Adjustments</th>
              <th className="px-2 py-2 text-left md:text-right">To remit</th>
              <th className="px-2 py-2 text-left md:text-right">Paid</th>
              <th className="px-2 py-2">Due</th>
              <th className="px-2 py-2">Filed</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const snap = p.snapshot;
              const adjTotal = snap
                ? (snap.adjustments || []).reduce((s, a) => s + (Number(a.amount) || 0), 0) + (Number(snap.timely_discount) || 0)
                : (Number(p.projected_timely_discount) || 0);
              const untracked = p.status === "historical_untracked";
              return (
                <tr key={p.period_key} className="border-b border-shBorder/50 hover:bg-white/[0.02]" data-testid={`stt-history-row-${p.period_key}`}>
                  <td className="px-4 py-2 font-bold text-shText whitespace-nowrap">
                    {p.label}
                    {p.needs_review && <i className="fas fa-magnifying-glass-dollar text-purple-300 ml-2" title="Needs review — ledger changed after filing" data-testid={`stt-history-review-${p.period_key}`} />}
                  </td>
                  <td className="px-2 py-2 text-left md:text-right hidden md:table-cell"><MobileCellLabel text="Liability" />{money(snap ? snap.liability : p.liability)}</td>
                  <td className="px-2 py-2 text-left md:text-right hidden md:table-cell"><MobileCellLabel text="Adjust." />{adjTotal !== 0 ? money(adjTotal) : "—"}</td>
                  <td className="px-2 py-2 text-left md:text-right"><MobileCellLabel text="To remit" />{snap ? money(snap.amount_to_remit) : (p.projected_amount_to_remit != null ? money(p.projected_amount_to_remit) : "—")}</td>
                  <td className="px-2 py-2 text-left md:text-right"><MobileCellLabel text="Paid" />{p.filing_id ? money(p.total_paid) : (untracked ? "—" : money(0))}</td>
                  <td className="px-2 py-2 whitespace-nowrap"><MobileCellLabel text="Due" />{p.effective_due_date ? fmtDate(p.effective_due_date) : "—"}</td>
                  <td className="px-2 py-2 whitespace-nowrap"><MobileCellLabel text="Filed" />{p.filed_date ? fmtDate(p.filed_date) : (untracked ? <span className="text-shTextMuted italic">No filing record</span> : "—")}</td>
                  <td className="px-2 py-2"><StatusPill status={p.status} testid={`stt-history-status-${p.period_key}`} /></td>
                  <td className="px-2 py-2 text-left md:text-right whitespace-nowrap">
                    <button onClick={() => onDetails(p)} className="text-shSecondary text-[11px] font-black uppercase tracking-widest hover:underline mr-2" data-testid={`stt-history-details-${p.period_key}`}>Details</button>
                    {!p.filing_id && !untracked && p.status !== "open" && (
                      <button onClick={() => onFile(p)} className="text-shPrimary text-[11px] font-black uppercase tracking-widest hover:underline" data-testid={`stt-history-file-${p.period_key}`}>Record</button>
                    )}
                    {p.filing_id && p.remaining_balance > 0.005 && p.status !== "zero_return_filed" && (
                      <button onClick={() => onPay(p)} className="text-shPrimary text-[11px] font-black uppercase tracking-widest hover:underline" data-testid={`stt-history-pay-${p.period_key}`}>Pay</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCellLabel({ text }) {
  // index.css's app-wide "tables → mobile cards" rule stacks td cells as
  // unlabeled blocks below md; this inline label keeps the values readable
  // on a phone and disappears on desktop where the thead does the job.
  return <span className="md:hidden inline-block w-20 text-[10px] font-black uppercase tracking-widest text-shTextMuted">{text}</span>;
}

function ModalShell({ title, testid, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid={testid} onClick={onClose}>
      <div className="bg-[var(--sh-card-base)] border border-shPrimary/40 rounded-xl p-5 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-shText">{title}</h3>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText" data-testid={`${testid}-close`}><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm";

function SettingsModal({ current, onClose, onSaved }) {
  const [freq, setFreq] = useState(current?.filing_frequency || "monthly");
  const [trackStart, setTrackStart] = useState(current?.tracking_start_date || `${todayISO().slice(0, 7)}-01`);
  const [discount, setDiscount] = useState(!!current?.timely_discount_enabled);
  const [license, setLicense] = useState(current?.vendor_license_ref || "");
  const [notes, setNotes] = useState(current?.notes || "");
  const [custom, setCustom] = useState(current?.custom || { period_start: "", period_end: "", due_date: "", label: "", note: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      await api.put("/admin/sales-tax/filing-settings", {
        filing_frequency: freq,
        tracking_start_date: freq === "custom" ? null : trackStart,
        timely_discount_enabled: discount,
        vendor_license_ref: license || null,
        notes: notes || null,
        custom: freq === "custom" ? custom : null,
        due_date_overrides: current?.due_date_overrides || {},
      });
      onSaved();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not save settings");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title="Ohio Sales Tax filing schedule" testid="stt-settings-modal" onClose={onClose}>
      <p className="text-[12px] text-shTextMuted">
        Ohio assigns each vendor a filing interval (monthly is the normal default; the Tax
        Commissioner may authorize semiannual). Save the schedule your business was actually
        assigned — nothing is stored until you save.
      </p>
      <Field label="Filing frequency (assigned by Ohio)">
        <select value={freq} onChange={(e) => setFreq(e.target.value)} className={inputCls} data-testid="stt-settings-frequency">
          <option value="monthly">Monthly — normal Ohio default</option>
          <option value="semiannual">Semiannual — if authorized by the Tax Commissioner</option>
          <option value="custom">Custom / special assignment</option>
        </select>
      </Field>
      {freq !== "custom" ? (
        <Field label="Track filings starting with (first day of first tracked period)">
          <input type="date" value={trackStart} onChange={(e) => setTrackStart(e.target.value)} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-settings-track-start" />
          <span className="block text-[11px] text-shTextMuted mt-1">Periods before this date show as “Historical — not tracked” instead of overdue.</span>
        </Field>
      ) : (
        <div className="space-y-2 border border-shBorder rounded p-3">
          <p className="text-[11px] text-shTextMuted">Escape hatch for an unusual Ohio-assigned schedule: define the next filing period explicitly.</p>
          <Field label="Label"><input value={custom.label || ""} onChange={(e) => setCustom({ ...custom, label: e.target.value })} className={inputCls} data-testid="stt-settings-custom-label" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period start"><input type="date" value={custom.period_start || ""} onChange={(e) => setCustom({ ...custom, period_start: e.target.value })} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-settings-custom-start" /></Field>
            <Field label="Period end"><input type="date" value={custom.period_end || ""} onChange={(e) => setCustom({ ...custom, period_end: e.target.value })} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-settings-custom-end" /></Field>
          </div>
          <Field label="Due date (per your Ohio assignment)"><input type="date" value={custom.due_date || ""} onChange={(e) => setCustom({ ...custom, due_date: e.target.value })} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-settings-custom-due" /></Field>
          <Field label="Explanatory note"><input value={custom.note || ""} onChange={(e) => setCustom({ ...custom, note: e.target.value })} className={inputCls} data-testid="stt-settings-custom-note" /></Field>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-shText" data-testid="stt-settings-discount">
        <input type="checkbox" checked={discount} onChange={(e) => setDiscount(e.target.checked)} />
        <span>Timely-filing vendor discount (0.75% — Ohio R.C. 5739.12)</span>
      </label>
      <p className="text-[11px] text-shTextMuted -mt-1">Off by default. When enabled, timely filings show the 0.75% discount as a separate filing adjustment — your ledger tax liability is never changed. Confirm eligibility with your CPA.</p>
      <Field label="Vendor's license reference (optional nickname — never a password)">
        <input value={license} onChange={(e) => setLicense(e.target.value)} className={inputCls} data-testid="stt-settings-license" />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} data-testid="stt-settings-notes" />
      </Field>
      {err && <p className="text-red-400 text-[12px]" data-testid="stt-settings-err"><i className="fas fa-circle-exclamation mr-1" />{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">Cancel</button>
        <button onClick={save} disabled={saving} data-testid="stt-settings-save"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? <><i className="fas fa-circle-notch fa-spin mr-1" />Saving…</> : "Save schedule"}
        </button>
      </div>
    </ModalShell>
  );
}

function RecordFilingModal({ p, settings, onClose, onSaved }) {
  const [filedDate, setFiledDate] = useState(todayISO());
  const [isZero, setIsZero] = useState(Math.abs(p.liability || 0) < 0.005);
  const [liability, setLiability] = useState(String(p.liability ?? 0));
  const [adjustments, setAdjustments] = useState([]);
  const [amountPaid, setAmountPaid] = useState("");
  const [payRef, setPayRef] = useState("");
  const [confRef, setConfRef] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const discountOn = !!settings?.timely_discount_enabled;
  const timely = p.effective_due_date ? filedDate <= p.effective_due_date : true;
  const liabNum = Number(liability) || 0;
  const projDiscount = (discountOn && timely && !isZero && liabNum > 0) ? -Math.round(liabNum * 0.75) / 100 : 0;
  const adjSum = adjustments.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const projRemit = isZero ? 0 : Math.round((liabNum + adjSum + projDiscount) * 100) / 100;

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const r = await api.post("/admin/sales-tax/filings", {
        period_key: p.period_key,
        filed_date: filedDate,
        is_zero_return: isZero,
        filed_liability: isZero ? 0 : liabNum,
        adjustments: isZero ? [] : adjustments.filter((a) => Number(a.amount)).map((a) => ({ label: a.label || "Filing adjustment", amount: Number(a.amount), note: a.note || null })),
        amount_paid: !isZero && amountPaid !== "" ? Number(amountPaid) : null,
        payment_date: !isZero && amountPaid !== "" ? filedDate : null,
        payment_reference: payRef || null,
        confirmation_ref: confRef || null,
        notes: notes || null,
      });
      onSaved(r.data);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not record filing");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={`Record Filing — ${p.label}`} testid="stt-file-modal" onClose={onClose}>
      <p className="text-[12px] text-shTextMuted">
        Document the return you already submitted to Ohio (this does not file anything).
        The ledger numbers below are frozen as a snapshot with the record.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date filed">
          <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-file-date" />
        </Field>
        <Field label="Confirmation / reference #">
          <input value={confRef} onChange={(e) => setConfRef(e.target.value)} className={inputCls} data-testid="stt-file-confirmation" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-shText" data-testid="stt-file-zero">
        <input type="checkbox" checked={isZero} onChange={(e) => setIsZero(e.target.checked)} />
        <span>Record $0 Filing (zero return — required by Ohio even with no tax due)</span>
      </label>
      {!isZero && (
        <>
          <Field label={`Net sales-tax liability (ledger: ${money(p.liability)})`}>
            <input type="number" step="0.01" value={liability} onChange={(e) => setLiability(e.target.value)} className={inputCls} data-testid="stt-file-liability" />
          </Field>
          <div className="space-y-1" data-testid="stt-file-adjustments">
            <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Other filing adjustments (credits, prior-period adjustment…)</span>
            {adjustments.map((a, i) => (
              <div key={i} className="flex gap-2">
                <input placeholder="Label" value={a.label} onChange={(e) => setAdjustments(adjustments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className={inputCls} />
                <input type="number" step="0.01" placeholder="± amount" value={a.amount} onChange={(e) => setAdjustments(adjustments.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className={`${inputCls} w-28`} />
                <button onClick={() => setAdjustments(adjustments.filter((_, j) => j !== i))} className="text-shTextMuted hover:text-red-400"><i className="fas fa-trash" /></button>
              </div>
            ))}
            <button onClick={() => setAdjustments([...adjustments, { label: "", amount: "" }])} className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline" data-testid="stt-file-add-adjustment">
              <i className="fas fa-plus mr-1" />Add adjustment
            </button>
          </div>
          <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded p-3 text-sm space-y-0.5" data-testid="stt-file-summary">
            <p className="flex justify-between"><span className="text-shTextMuted">Net Sales-Tax Liability</span><b>{money(liabNum)}</b></p>
            {projDiscount !== 0 && <p className="flex justify-between"><span className="text-shTextMuted">Timely-Filing Discount (0.75%)</span><b>{money(projDiscount)}</b></p>}
            {adjSum !== 0 && <p className="flex justify-between"><span className="text-shTextMuted">Other Filing Adjustments</span><b>{money(adjSum)}</b></p>}
            <p className="flex justify-between border-t border-shBorder pt-1 mt-1"><span className="text-shTextMuted">Estimated Amount to Remit</span><b data-testid="stt-file-remit">{money(projRemit)}</b></p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount paid now (optional)">
              <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={String(projRemit)} className={inputCls} data-testid="stt-file-paid" />
            </Field>
            <Field label="Payment reference">
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} className={inputCls} data-testid="stt-file-payref" />
            </Field>
          </div>
        </>
      )}
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} data-testid="stt-file-notes" />
      </Field>
      {err && <p className="text-red-400 text-[12px]" data-testid="stt-file-err"><i className="fas fa-circle-exclamation mr-1" />{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">Cancel</button>
        <button onClick={save} disabled={saving} data-testid="stt-file-save"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? <><i className="fas fa-circle-notch fa-spin mr-1" />Recording…</> : (isZero ? "Record $0 Filing" : "Record Filing")}
        </button>
      </div>
    </ModalShell>
  );
}

function RecordPaymentModal({ p, confirm, onClose, onSaved }) {
  const [amount, setAmount] = useState(String(p.remaining_balance ?? ""));
  const [payDate, setPayDate] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (allowDuplicate = false) => {
    setSaving(true); setErr("");
    try {
      const r = await api.post(`/admin/sales-tax/filings/${p.filing_id}/payments`, {
        amount: Number(amount), payment_date: payDate,
        reference: reference || null, note: note || null,
        allow_duplicate: allowDuplicate,
      });
      onSaved(r.data);
    } catch (e) {
      const detail = formatErr(e.response?.data?.detail) || "Could not record payment";
      if (e.response?.status === 409 && !allowDuplicate) {
        const ok = await confirm({
          title: "Identical payment already recorded",
          body: "A payment with this exact amount, date, and reference is already on this filing. Record it again anyway?",
          confirmText: "Record anyway",
        });
        if (ok) { await save(true); return; }
      }
      setErr(detail);
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={`Record Payment — ${p.label}`} testid="stt-pay-modal" onClose={onClose}>
      <p className="text-[13px] text-shText">Remaining balance: <b data-testid="stt-pay-remaining">{money(p.remaining_balance)}</b> of {money(p.snapshot?.amount_to_remit)}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount paid">
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} data-testid="stt-pay-amount" />
        </Field>
        <Field label="Payment date">
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} style={{ colorScheme: "dark" }} data-testid="stt-pay-date" />
        </Field>
      </div>
      <Field label="Confirmation / reference #">
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} data-testid="stt-pay-reference" />
      </Field>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} data-testid="stt-pay-note" />
      </Field>
      {err && <p className="text-red-400 text-[12px]" data-testid="stt-pay-err"><i className="fas fa-circle-exclamation mr-1" />{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">Cancel</button>
        <button onClick={() => save(false)} disabled={saving || !(Number(amount) > 0)} data-testid="stt-pay-save"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? <><i className="fas fa-circle-notch fa-spin mr-1" />Recording…</> : "Record Payment"}
        </button>
      </div>
    </ModalShell>
  );
}

function DetailsModal({ p, onClose }) {
  const d = p.liability_detail || {};
  const snap = p.snapshot;
  return (
    <ModalShell title={`Sales Tax Details — ${p.label}`} testid="stt-details-modal" onClose={onClose}>
      <div className="space-y-0.5 text-sm" data-testid="stt-details-breakdown">
        <p className="flex justify-between"><span className="text-shTextMuted">Gross tax charged</span><b>{money(d.gross_tax_charged)}</b></p>
        <p className="flex justify-between"><span className="text-shTextMuted">Tax reversed (voids / refunds)</span><b>{money(d.tax_reversed)}</b></p>
        <p className="flex justify-between border-t border-shBorder pt-1 mt-1"><span className="text-shTextMuted">Net Sales-Tax Liability</span><b data-testid="stt-details-net">{money(d.total_tax_collected)}</b></p>
        <p className="flex justify-between mt-2"><span className="text-shTextMuted">· from bookings / services</span><span>{money(d.bookings_tax_total)}</span></p>
        <p className="flex justify-between"><span className="text-shTextMuted">· from retail / shop / POS (net)</span><span>{money(d.retail_tax_total)}</span></p>
      </div>
      {snap && (
        <div className="border-t border-shBorder pt-2 space-y-0.5 text-sm" data-testid="stt-details-snapshot">
          <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Snapshot at filing ({fmtDate(p.filed_date)})</p>
          <p className="flex justify-between"><span className="text-shTextMuted">Net Sales-Tax Liability</span><b>{money(snap.liability)}</b></p>
          {(snap.timely_discount || 0) !== 0 && <p className="flex justify-between"><span className="text-shTextMuted">Timely-Filing Discount</span><b>{money(snap.timely_discount)}</b></p>}
          {(snap.adjustments || []).map((a, i) => (
            <p key={i} className="flex justify-between"><span className="text-shTextMuted">{a.label}</span><b>{money(a.amount)}</b></p>
          ))}
          <p className="flex justify-between"><span className="text-shTextMuted">Estimated Amount to Remit</span><b>{money(snap.amount_to_remit)}</b></p>
          <p className="flex justify-between"><span className="text-shTextMuted">Amount Paid</span><b>{money(p.total_paid)}</b></p>
          <p className="flex justify-between"><span className="text-shTextMuted">Remaining Balance</span><b>{money(p.remaining_balance)}</b></p>
        </div>
      )}
      {p.needs_review && p.variance && (
        <div className="bg-purple-500/10 border border-purple-500/40 text-purple-300 rounded px-3 py-2 text-[12px]" data-testid="stt-details-variance">
          <b>Needs review:</b> filed {money(p.variance.filed_liability)} vs current ledger {money(p.variance.current_liability)} ({money(p.variance.difference)}). {p.variance.message}
        </div>
      )}
      <p className="text-[11px] text-shTextMuted italic">
        Net liability = tax collected minus valid reversals (voids, refunds, Stripe refunds)
        from the Sit Happens ledger for {fmtDate(p.period_start)} – {fmtDate(p.period_end)}.
      </p>
    </ModalShell>
  );
}
