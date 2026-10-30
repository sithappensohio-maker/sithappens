import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, parseAmount } from "../lib/format";
import { parseLocalISO, todayISO } from "../lib/date";
import { useConfirm } from "../lib/useConfirm";
import { newUploadId, replyWasLost } from "../lib/vaccineUpload";

/* Staff → Payroll: the pay schedule, and on payday who is owed what.
 * Amounts come from GET /admin/payroll/payday, which reuses the Payroll Tax
 * estimate for the pay period, so they match that tab and the CSV. Mark paid
 * records each payment (not an expense: the P&L counts payroll from
 * timecards). A payment settles gross pay; anything withheld for taxes stays
 * with the business, and only the cash handed over leaves the register drawer. */

const CADENCES = [["biweekly", "Every 2 weeks"], ["weekly", "Every week"]];
const METHODS = [["cash", "Cash"], ["check", "Check"], ["transfer", "Bank transfer"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["card", "Card"], ["other", "Other"]];
const METHOD_LABEL = Object.fromEntries(METHODS);
// Paid means a payment covers what's owed, never just "owed nothing" (no pay rate gives $0).
const owesNothing = (u) => (u.paid || 0) > 0.005 && (u.remaining ?? u.gross) <= 0.005;
// No reply, a gateway page, or a server error: it may or may not have been recorded.
const unsure = (e) => replyWasLost(e) || (e?.response?.status || 0) >= 500;

export function dayLabel(iso) {
  if (!iso) return "";
  return `${parseLocalISO(iso).toLocaleDateString("en-US", { weekday: "short" })} ${fmtDate(iso)}`;
}

const money = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What Mark paid starts with: what's still owed, and for a W-2 employee the
// estimated withholding on it, so the cash handed over is their take-home.
export function payDefaults(u) {
  const owed = Math.max(Number(u.remaining ?? u.gross) || 0, 0);
  const share = u.gross > 0 ? Math.min(Math.max(1 - (u.estimated_take_home || 0) / u.gross, 0), 1) : 0;
  const withheld = u.tax_status === "w2" ? Math.round(owed * share * 100) / 100 : 0;
  return { amount: owed.toFixed(2), withheld: withheld.toFixed(2) };
}

function MarkPaidForm({ person, payday, requestIdFor, saving, onSaving, onDone, onUnsure, onCancel }) {
  const [f, setF] = useState(() => ({ ...payDefaults(person), payment_method: "cash", paid_on: todayISO(), from_cash_drawer: false }));
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const amount = parseAmount(f.amount);
  const withheld = String(f.withheld ?? "").trim() === "" ? 0 : parseAmount(f.withheld);
  const valid = !!amount && withheld !== null && withheld < amount;
  const handedOver = valid ? Math.round((amount - withheld) * 100) / 100 : null;
  const send = async () => {
    if (saving || !valid) return;
    const body = { user_id: person.user_id, amount, withheld, payment_method: f.payment_method, paid_on: f.paid_on,
                   from_cash_drawer: f.payment_method === "cash" && f.from_cash_drawer };
    // The same payment always carries the same id, so sending it again records it once.
    const request = { ...body, request_id: requestIdFor(body) };
    const post = () => api.post(`/admin/payroll/payday/${payday}/payments`, request);
    onSaving(true); setErr("");
    try {
      let res;
      try { res = await post(); }
      catch (e) {
        if (!unsure(e)) throw e;
        await new Promise((r) => setTimeout(r, 1500));
        res = await post();
      }
      onDone(res.data);
    } catch (e) {
      if (unsure(e) && await onUnsure(request.request_id)) return;
      setErr(unsure(e)
        ? "Couldn't confirm this payment. If it went through it shows above; pressing Mark paid again won't record it twice."
        : formatErr(e));
    } finally { onSaving(false); }
  };
  const input = "bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm";
  const label = "text-[12px] font-black uppercase tracking-widest text-shTextMuted";
  return (
    <div className="mt-2 rounded-lg border border-shBorder p-3 space-y-2" data-testid={`payday-pay-form-${person.user_id}`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}><span className="block mb-1">Pay</span>
          <input type="text" inputMode="decimal" value={f.amount} onChange={set("amount")} disabled={saving}
                 data-testid="payday-pay-amount" className={`${input} w-28`}/>
        </label>
        <label className={label}><span className="block mb-1">Withheld for taxes</span>
          <input type="text" inputMode="decimal" value={f.withheld} onChange={set("withheld")} disabled={saving}
                 data-testid="payday-pay-withheld" className={`${input} w-28`}/>
        </label>
        <label className={label}><span className="block mb-1">How</span>
          <select value={f.payment_method} onChange={set("payment_method")} disabled={saving} data-testid="payday-pay-method"
                  className={`${input} normal-case tracking-normal`}>
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={label}><span className="block mb-1">Paid on</span>
          <input type="date" value={f.paid_on} max={todayISO()} onChange={set("paid_on")} disabled={saving}
                 style={{ colorScheme: "dark" }} data-testid="payday-pay-date" className={input}/>
        </label>
      </div>
      {handedOver !== null && (
        <p className="text-[13px] text-shText" data-testid="payday-pay-handed">
          You hand over <span className="font-black">{money(handedOver)}</span>
          {withheld > 0 && <span className="text-shTextMuted"> · the {money(withheld)} withheld goes to the IRS and Ohio with your payroll taxes</span>}
        </p>
      )}
      {f.payment_method === "cash" && (
        <label className="flex items-center gap-2 text-[13px] text-shText">
          <input type="checkbox" checked={f.from_cash_drawer} onChange={set("from_cash_drawer")} disabled={saving} data-testid="payday-pay-drawer"/>
          Taken from the register drawer (lowers the drawer's expected cash by what you hand over)
        </label>
      )}
      {f.amount && !amount && <p className="text-red-400 text-[13px]">Enter the pay like 122.25</p>}
      {amount && (withheld === null || withheld >= amount) && <p className="text-red-400 text-[13px]">Withheld must be less than the pay.</p>}
      {err && <p className="text-red-400 text-[13px]" data-testid="payday-pay-error">{err}</p>}
      <div className="flex gap-2">
        <button onClick={send} disabled={saving || !valid} data-testid="payday-pay-save"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? "Saving…" : "Mark paid"}
        </button>
        <button onClick={onCancel} disabled={saving}
                className="px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">Cancel</button>
      </div>
    </div>
  );
}

export default function PaydayCard() {
  const confirm = useConfirm();
  const { can } = useAuth() || {};
  const canUndo = !!can?.("delete_records");   // the server asks for it too
  const [data, setData] = useState(null);
  const [paying, setPaying] = useState(null);       // user_id whose Mark paid form is open
  const [savingFor, setSavingFor] = useState(null); // user_id whose payment is being sent
  const [undoing, setUndoing] = useState(null);
  const [undoErr, setUndoErr] = useState(null);     // { id, msg } for the payment it belongs to
  const ids = useRef({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ cadence: "biweekly", anchor_payday: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchPayday = useCallback(async (payday) => (payday
    ? await api.get("/admin/payroll/payday", { params: { payday } })
    : await api.get("/admin/payroll/payday")).data, []);
  const load = useCallback(async (payday) => {
    setErr("");
    try { setData(await fetchPayday(payday)); }
    catch (e) {
      // Without finance_reports there is nothing here this person may see.
      if (e?.response?.status === 403) setData({ forbidden: true });
      else setErr(formatErr(e));
    }
  }, [fetchPayday]);
  useEffect(() => { load(); }, [load]);

  const openEditor = () => {
    setForm({ cadence: data?.schedule?.cadence || "biweekly", anchor_payday: data?.schedule?.anchor_payday || todayISO() });
    setErr("");
    setEditing(true);
  };
  const save = async () => {
    setSaving(true); setErr("");
    try {
      setData((await api.put("/admin/payroll/schedule", form)).data);
      setEditing(false);
    } catch (e) { setErr(formatErr(e)); }
    finally { setSaving(false); }
  };

  const shell = "bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 space-y-3";
  if (data?.forbidden) return null;
  if (!data) {
    return (
      <div className={shell} data-testid="payday-card">
        <p className="text-shTextMuted text-[14px]">{err || "Loading payday…"}</p>
        {err && (
          <button onClick={load} data-testid="payday-retry"
                  className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary">
            <i className="fas fa-rotate-right mr-1"/>Try again
          </button>
        )}
      </div>
    );
  }

  if (!data.configured || editing) {
    return (
      <div className={shell} data-testid="payday-card">
        <h4 className="text-shText font-black uppercase italic"><i className="fas fa-calendar-check text-shPrimary mr-2"/>Pay schedule</h4>
        <p className="text-[14px] text-shTextMuted">
          {data.configured ? "Change how often you pay staff. Paydays before today count as paid." : "Set when you pay staff and the app will tell you on each payday what you owe each person."}
          {" "}Each payday pays every hour worked since the last payday, up to the day before.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
            <span className="block mb-1">How often</span>
            <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} data-testid="payday-cadence"
                    className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm normal-case tracking-normal">
              {CADENCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
            <span className="block mb-1">One payday (past or next)</span>
            <input type="date" value={form.anchor_payday} onChange={(e) => setForm({ ...form, anchor_payday: e.target.value })}
                   style={{ colorScheme: "dark" }} data-testid="payday-anchor"
                   className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm"/>
          </label>
          <button onClick={save} disabled={saving || !form.anchor_payday} data-testid="payday-save"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            {saving ? "Saving…" : "Save schedule"}
          </button>
          {data.configured && (
            <button onClick={() => setEditing(false)} data-testid="payday-cancel"
                    className="px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
              Cancel
            </button>
          )}
        </div>
        {err && <p className="text-red-400 text-[14px]">{err}</p>}
      </div>
    );
  }

  const requestIdFor = (body) => {
    const key = JSON.stringify(body);
    if (!ids.current[key]) ids.current[key] = newUploadId();
    return ids.current[key];
  };
  const forgetIds = (userId) => {
    for (const key of Object.keys(ids.current)) if (JSON.parse(key).user_id === userId) delete ids.current[key];
  };
  const paid = (userId) => (next) => {
    setData(next); forgetIds(userId); setUndoErr(null);
    setPaying((cur) => (cur === userId ? null : cur));
  };
  // A reply that never came: look again, and if the payment is there, it's done.
  const checkSaved = (userId) => async (requestId) => {
    try {
      const next = await fetchPayday(data.payday);
      const saved = (next.per_user || []).some((u) => (u.payments || []).some((p) => p.request_id === requestId));
      if (saved) { paid(userId)(next); return true; }
      setData(next);
    } catch { /* still unsure: the form says so */ }
    return false;
  };

  const undo = async (p) => {
    const ok = await confirm({ title: "Undo this payment?", confirmText: "Undo", tone: "warning",
      body: `${money(p.amount)} to ${p.name} on ${dayLabel(p.paid_on)} will no longer count as paid.${p.from_cash_drawer ? " The cash goes back into the register drawer's expected count." : ""}` });
    if (!ok) return;
    setUndoing(p.id); setUndoErr(null);
    try { setData((await api.delete(`/admin/payroll/payments/${p.id}`)).data); }
    catch (e) {
      setUndoErr({ id: p.id, msg: formatErr(e) });
      if (e?.response?.status === 404) load(data.payday);   // already undone elsewhere
    }
    finally { setUndoing(null); }
  };

  const staff = data.per_user || [];
  const remaining = data.totals?.remaining ?? data.totals?.gross;
  return (
    <div className={shell} data-testid="payday-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[11px] font-black uppercase tracking-[0.25em] ${data.is_today ? "text-shAccent" : "text-shTextMuted"}`}>
            <i className="fas fa-money-check-dollar mr-1"/>{data.is_today ? "Payday is today" : data.is_latest === false ? "Earlier payday" : "Last payday"}
          </p>
          <h4 className="text-shText font-black text-xl" data-testid="payday-date">{dayLabel(data.payday)}</h4>
          <p className="text-[13px] text-shTextMuted" data-testid="payday-period">
            {data.before_schedule_change
              ? "This payday came before you changed your schedule"
              : `Pays hours worked ${dayLabel(data.period_start)} – ${dayLabel(data.period_end)}`}
            {" "}· Next payday {dayLabel(data.next_payday)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.previous_payday && (
            <button onClick={() => load(data.previous_payday)} disabled={!!savingFor} data-testid="payday-earlier"
                    className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary disabled:opacity-50">
              <i className="fas fa-chevron-left mr-1"/>Earlier payday
            </button>
          )}
          {data.is_latest === false && (
            <button onClick={() => load()} disabled={!!savingFor} data-testid="payday-latest"
                    className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary disabled:opacity-50">
              Latest payday<i className="fas fa-chevron-right ml-1"/>
            </button>
          )}
          <button onClick={openEditor} data-testid="payday-edit"
                  className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary">
            <i className="fas fa-sliders mr-1"/>Change schedule
          </button>
        </div>
      </div>

      {data.open_shifts > 0 && (
        <div className="bg-shAccent/10 border border-shAccent/40 rounded-lg p-3 text-[13px] text-shText" data-testid="payday-open-shifts">
          <i className="fas fa-triangle-exclamation text-shAccent mr-1"/>
          {data.open_shifts} shift{data.open_shifts !== 1 ? "s" : ""} in this pay period {data.open_shifts !== 1 ? "are" : "is"} still clocked in, so {data.open_shifts !== 1 ? "they aren't" : "it isn't"} counted below. Clock {data.open_shifts !== 1 ? "them" : "it"} out under Timecards first.
        </div>
      )}

      {staff.length === 0 ? (
        <p className="text-[14px] text-shTextMuted" data-testid="payday-empty">
          {data.before_schedule_change
            ? `Nothing is owed on it. Hours worked since your last payday are paid on ${dayLabel(data.next_payday)}.`
            : "No hours were clocked in this pay period, so nobody is owed pay."}
        </p>
      ) : (
        <div className="divide-y divide-shBorder/50" data-testid="payday-list">
          {staff.map((u) => (
            <div key={u.user_id} className="py-2" data-testid={`payday-row-${u.user_id}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-shText font-black break-words">{u.name}</p>
                  <p className="text-[12px] text-shTextMuted">{u.hours} hrs
                    {u.no_rate ? <span className="text-shAccent"> · no pay rate set (add one under Employees)</span> : <> · est. take-home {money(u.estimated_take_home)}</>}
                    {u.paid > 0 && !owesNothing(u) && <> · {money(u.gross)} owed, {money(u.paid)} paid so far</>}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {owesNothing(u) ? (
                    <p className="text-shPrimary font-black text-lg" data-testid={`payday-paid-${u.user_id}`}><i className="fas fa-circle-check mr-1"/>Paid</p>
                  ) : (
                    <>
                      <p className={`font-black text-lg ${u.no_rate ? "text-shAccent text-[14px]" : "text-shPrimary"}`}>{u.no_rate ? "No pay rate" : money(u.remaining ?? u.gross)}</p>
                      {paying !== u.user_id && ((u.remaining ?? u.gross) > 0.005 || u.no_rate) && (
                        <button onClick={() => setPaying(u.user_id)} disabled={!!savingFor} data-testid={`payday-mark-paid-${u.user_id}`}
                                className="bg-shPrimary text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
                          Mark paid
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {(u.payments || []).map((p) => (
                <div key={p.id}>
                  <p className="text-[12px] text-shTextMuted mt-1" data-testid={`payday-payment-${p.id}`}>
                    <i className="fas fa-check text-shPrimary mr-1"/>Paid {money(p.amount)}
                    {p.withheld > 0 && <> ({money(p.withheld)} withheld, {money(p.handed_over)} handed over)</>}
                    {" "}· {METHOD_LABEL[p.payment_method] || p.payment_method}
                    {p.from_cash_drawer ? " from the register drawer" : ""} · {dayLabel(p.paid_on)}
                    {canUndo && (
                      <button onClick={() => undo(p)} disabled={undoing === p.id || !!savingFor} data-testid={`payday-undo-${p.id}`}
                              className="ml-2 underline hover:text-shText disabled:opacity-50">{undoing === p.id ? "Undoing…" : "Undo"}</button>
                    )}
                  </p>
                  {undoErr?.id === p.id && <p className="text-red-400 text-[12px]" data-testid={`payday-undo-error-${p.id}`}>{undoErr.msg}</p>}
                </div>
              ))}
              {u.remaining < -0.005 && (
                <p className="text-[12px] text-shAccent mt-1">Paid {money(-u.remaining)} more than this pay period's hours come to.</p>
              )}
              {paying === u.user_id && (
                <MarkPaidForm key={`${u.user_id}:${u.remaining}`} person={u} payday={data.payday} requestIdFor={requestIdFor}
                              saving={savingFor === u.user_id} onSaving={(on) => setSavingFor(on ? u.user_id : null)}
                              onDone={paid(u.user_id)} onUnsure={checkSaved(u.user_id)} onCancel={() => setPaying(null)}/>
              )}
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-2">
            <p className="text-shText font-black uppercase tracking-widest text-[13px]">{remaining > 0.005 ? "You owe" : "All paid"}</p>
            <p className="text-shPrimary font-black text-xl" data-testid="payday-total">{remaining > 0.005 ? money(remaining) : <i className="fas fa-circle-check"/>}</p>
          </div>
          {data.totals?.paid > 0 && (
            <p className="text-[12px] text-shTextMuted text-right" data-testid="payday-paid-total">{money(data.totals.paid)} paid{remaining > 0.005 ? " so far" : ""}</p>
          )}
        </div>
      )}
      <p className="text-[12px] text-shTextMuted">
        Owed is gross pay: hours × the rate each shift was worked at. Take-home is an estimate from your Payroll Tax rates. Your own hours as owner aren't here, since they're your draw.
      </p>
    </div>
  );
}
