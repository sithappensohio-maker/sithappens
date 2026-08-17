// Step 4D-2A — jurisdiction-split estimated-tax payment history.
//
// Federal, Ohio, and Ohio school-district payments are SEPARATE ledgers —
// one can never reduce another. Legacy combined rows (recorded before
// jurisdictions existed) appear under "Legacy — jurisdiction unassigned"
// and count toward nothing. New rows are append-only: corrections are
// audit-visible voids, never deletes. The app records what the owner paid
// externally (EFTPS / Ohio ePayment) — it never pays anything itself, and
// during 4D-2A it deliberately shows NO required amounts.

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { fmtDate } from "../lib/format";

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const JURISDICTION_META = {
  federal: { label: "Federal", icon: "fa-flag-usa", hint: "IRS estimated payments (EFTPS, check…)" },
  ohio: { label: "Ohio", icon: "fa-landmark", hint: "Ohio IT 1040ES / OUPC payments" },
  ohio_school_district: { label: "Ohio School District", icon: "fa-school", hint: "SD 100ES / OUPC school-district payments" },
};

export default function EstimatedTaxPayments({ year, refreshKey = null, onChanged = null }) {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [recOpen, setRecOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/estimated-tax/payments?year=${year}`);
      setData(r.data); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load payment history");
    }
    // refreshKey re-runs the load when payments are recorded elsewhere
    // (e.g. the federal card's Record Federal Payment).
  }, [year, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const voidPayment = async (p) => {
    const ok = await confirm({
      title: "Void this payment record?",
      body: "The row stays visible and audit-logged as voided — payment history is never deleted.",
      confirmText: "Void record",
    });
    if (!ok) return;
    try {
      await api.post(`/admin/estimated-tax/payments/${p.id}/void`, { reason: "Voided from payment history" });
      load(); onChanged?.();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Could not void"); }
  };

  if (err && !data) return <div className="text-red-400 bg-red-500/10 rounded p-3 text-sm" data-testid="estpay-error">{err}</div>;
  if (!data) return <div className="text-shTextMuted text-sm" data-testid="estpay-loading">Loading payments…</div>;

  const legacy = data.legacy_unassigned || { payments: [], total: 0 };

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4" data-testid="estimated-tax-payments">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-shText font-black uppercase italic"><i className="fas fa-money-check-dollar text-shPrimary mr-2" />Estimated payments — {year}</h4>
        <button onClick={() => setRecOpen(true)} data-testid="estpay-record-btn"
                className="bg-shPrimary text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
          <i className="fas fa-plus mr-1" />Record payment
        </button>
      </div>
      {err && <p className="text-red-400 text-[12px]">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Object.entries(JURISDICTION_META).map(([j, meta]) => {
          const slot = data.jurisdictions[j] || { payments: [], total: 0 };
          return (
            <div key={j} className="border border-shBorder rounded-lg p-3" data-testid={`estpay-${j}`}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className={`fas ${meta.icon} mr-1`} />{meta.label}</p>
                <p className="text-shText font-black" data-testid={`estpay-${j}-total`}>{money(slot.total)}</p>
              </div>
              <p className="text-[10px] text-shTextMuted mb-2">{meta.hint}</p>
              {slot.payments.length === 0 ? (
                <p className="text-[12px] text-shTextMuted italic">No payments recorded.</p>
              ) : slot.payments.map((p) => (
                <div key={p.id} className={`flex items-center justify-between text-[12px] py-1 border-t border-shBorder/40 ${p.voided ? "opacity-50" : ""}`}
                     data-testid={`estpay-row-${p.id}`}>
                  <span className="text-shTextMuted">
                    P{p.period} · {fmtDate(p.payment_date)}{p.reference ? ` · ${p.reference}` : ""}
                    {p.voided && <b className="text-red-400 ml-1 uppercase">voided</b>}
                  </span>
                  <span className="flex items-center gap-2">
                    <b className={p.voided ? "line-through text-shTextMuted" : "text-shText"}>{money(p.amount)}</b>
                    {!p.voided && (
                      <button onClick={() => voidPayment(p)} data-testid={`estpay-void-${p.id}`}
                              title="Void (audit-visible; never deletes)"
                              className="text-shTextMuted hover:text-red-400"><i className="fas fa-ban" /></button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {legacy.payments.length > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-3" data-testid="estpay-legacy">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-300">
            <i className="fas fa-clock-rotate-left mr-1" />Legacy — jurisdiction unassigned · {money(legacy.total)}
          </p>
          <p className="text-[11px] text-shTextMuted mb-1">{legacy.note}</p>
          {legacy.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[12px] py-1 border-t border-amber-500/20" data-testid={`estpay-legacy-row-${p.id}`}>
              <span className="text-shTextMuted">Q{p.quarter} · {fmtDate(p.payment_date)} · {p.payment_method}{p.memo ? ` · ${p.memo}` : ""}</span>
              <b className="text-shText">{money(p.amount)}</b>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-shTextMuted italic">
        Required FEDERAL amounts come from the federal card above; the Ohio engine arrives in 4D-2C.
        Municipal (city) income tax is separate and is not part of any federal or Ohio figure here.
      </p>

      {recOpen && <RecordPaymentModal year={year} onClose={() => setRecOpen(false)} onSaved={() => { setRecOpen(false); load(); onChanged?.(); }} />}
    </div>
  );
}

export function RecordPaymentModal({ year, onClose, onSaved, lockJurisdiction = null }) {
  const [jurisdiction, setJurisdiction] = useState(lockJurisdiction || "federal");
  const [period, setPeriod] = useState(1);
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState("");
  const [method, setMethod] = useState("EFTPS");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (allowDuplicate = false) => {
    if (!(Number(amount) > 0)) { setErr("Enter an amount > 0"); return; }
    setSaving(true); setErr("");
    try {
      await api.post("/admin/estimated-tax/payments", {
        tax_year: year, jurisdiction, period: Number(period), amount: Number(amount),
        payment_date: payDate || null, method: method || null,
        reference: reference || null, memo: memo || null, allow_duplicate: allowDuplicate,
      });
      onSaved();
    } catch (e) {
      const status = e.response?.status;
      setErr(formatErr(e.response?.data?.detail) || "Could not record payment");
      if (status === 409) setErr((prev) => prev); // surfaced; explicit re-record via API allow_duplicate
    } finally { setSaving(false); }
  };

  const inputCls = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm";
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid="estpay-modal" onClick={onClose}>
      <div className="bg-[var(--sh-card-base)] border border-shPrimary/40 rounded-xl p-5 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-black text-shText">Record estimated payment — {year}</h3>
        <p className="text-[12px] text-shTextMuted">Documents a payment you already made externally. This app never files or pays anything itself.</p>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Jurisdiction</span>
          <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}
                  disabled={!!lockJurisdiction}
                  data-testid="estpay-modal-jurisdiction" className={inputCls}>
            <option value="federal">Federal (IRS)</option>
            <option value="ohio">Ohio</option>
            <option value="ohio_school_district">Ohio School District</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Installment</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="estpay-modal-period" className={inputCls}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Amount</span>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="estpay-modal-amount" className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Payment date</span>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} style={{ colorScheme: "dark" }} data-testid="estpay-modal-date" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Method</span>
            <input value={method} onChange={(e) => setMethod(e.target.value)} data-testid="estpay-modal-method" className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Confirmation / reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} data-testid="estpay-modal-reference" className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-widest text-shTextMuted">Memo</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} data-testid="estpay-modal-memo" className={inputCls} />
        </label>
        {err && <p className="text-red-400 text-[12px]" data-testid="estpay-modal-err"><i className="fas fa-circle-exclamation mr-1" />{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">Cancel</button>
          <button onClick={() => save(false)} disabled={saving} data-testid="estpay-modal-save"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
            {saving ? "Recording…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
