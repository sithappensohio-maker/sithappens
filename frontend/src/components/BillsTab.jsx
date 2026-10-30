import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayISO } from "../lib/date";
import { useConfirm } from "../lib/useConfirm";
import { dayLabel } from "./PaydayCard";

/* Finance → Bills: recurring bills with due dates. Mark paid logs the payment
 * as an expense (POST /admin/bills/{id}/pay) and moves the bill to its next
 * due date; the newest payment can be undone. */

const FREQUENCIES = [["monthly", "Every month"], ["weekly", "Every week"], ["quarterly", "Every 3 months"], ["yearly", "Every year"]];
const METHODS = [["card", "Card"], ["transfer", "Bank transfer"], ["check", "Check"], ["cash", "Cash"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["other", "Other"]];
const label = (pairs, key) => (pairs.find(([k]) => k === key) || [key, key])[1];

// Money boxes are text with a decimal keypad: a focused number box changes its value under
// the scroll wheel. A leading "$" and thousands commas (1,200.00) are allowed; a comma
// anywhere else ("89,99") is refused rather than read as 8999.
export function parseAmount(v) {
  const s = String(v ?? "").trim().replace(/^\$\s*/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  return Number(s.replace(/,/g, ""));
}
const money = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const input = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm";
const fieldLabel = "block text-[12px] font-black uppercase tracking-widest text-shTextMuted";
const ghostBtn = "px-3 py-2 rounded border border-shBorder text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary disabled:opacity-50";
const primaryBtn = "bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50";

export function dueText(bill) {
  const d = bill.days_until_due;
  if (d < 0) return `Overdue ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

const STATUS_TONE = {
  overdue: "bg-red-500/15 text-red-300 border-red-400/40",
  due_today: "bg-shAccent/15 text-shAccent border-shAccent/40",
  due_soon: "bg-amber-500/15 text-amber-300 border-amber-400/40",
  upcoming: "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder",
};

function AmountHint({ value, testid }) {
  if (!String(value ?? "").trim() || parseAmount(value) !== null) return null;
  return <span className="block mt-1 text-[12px] normal-case tracking-normal font-normal text-red-300" data-testid={testid}>Numbers only, like 1200.00</span>;
}

function BillForm({ initial, categories, busy, onSave, onCancel }) {
  const ref = useRef(null);
  const [f, setF] = useState(() => ({
    name: initial?.name || "", payee: initial?.payee || "", amount: initial?.amount ?? "",
    category: initial ? (initial.category || "") : "Utilities", payment_method: initial?.payment_method || "card",
    frequency: initial?.frequency || "monthly", next_due: initial?.next_due || "", notes: initial?.notes || "",
  }));
  // The form opens above the list; on a phone the row's Edit button is often far below it.
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amount = parseAmount(f.amount);
  const ready = f.name.trim() && amount !== null && f.next_due;
  return (
    <div ref={ref} className="bg-[var(--sh-card-base)] border border-shPrimary/40 rounded-xl p-4 space-y-3 scroll-mt-24" data-testid="bill-form">
      <h4 className="text-shText font-black uppercase italic">{initial ? `Edit ${initial.name}` : "Add a bill"}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={fieldLabel}>Bill<input value={f.name} onChange={set("name")} placeholder="Electric, rent, insurance…" className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-name"/></label>
        <label className={fieldLabel}>Paid to<input value={f.payee} onChange={set("payee")} placeholder="Company name" className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-payee"/></label>
        <label className={fieldLabel}>Usual amount
          <input type="text" inputMode="decimal" value={f.amount} onChange={set("amount")} className={`${input} mt-1`} data-testid="bill-form-amount"/>
          <AmountHint value={f.amount} testid="bill-form-amount-hint"/>
        </label>
        <label className={fieldLabel}>How often
          <select value={f.frequency} onChange={set("frequency")} className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-frequency">
            {FREQUENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Next due date<input type="date" value={f.next_due} onChange={set("next_due")} style={{ colorScheme: "dark" }} className={`${input} mt-1`} data-testid="bill-form-next-due"/></label>
        <label className={fieldLabel}>Expense category
          <select value={f.category} onChange={set("category")} className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-category">
            {[...new Set([f.category, ...categories])].map((c) => <option key={c || "none"} value={c}>{c || "No category"}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Usually paid with
          <select value={f.payment_method} onChange={set("payment_method")} className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-method">
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Notes<input value={f.notes} onChange={set("notes")} placeholder="Account number, autopay, etc." className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-form-notes"/></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !ready} onClick={() => onSave({ ...f, amount })} className={primaryBtn} data-testid="bill-form-save">
          {busy ? "Saving…" : initial ? "Save changes" : "Add bill"}
        </button>
        <button onClick={onCancel} className={ghostBtn} data-testid="bill-form-cancel">Cancel</button>
      </div>
    </div>
  );
}

function PayForm({ bill, busy, onPay, onCancel }) {
  // The due date being paid is the one shown when the form opened: if the list reloads
  // after another device paid it, the server refuses instead of paying the next one.
  const [f, setF] = useState(() => ({ due_date: bill.next_due, amount: bill.amount, paid_date: todayISO(),
    payment_method: bill.payment_method || "card", from_cash_drawer: false, notes: "" }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amount = parseAmount(f.amount);
  return (
    <div className="mt-3 bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3 space-y-3" data-testid="bill-pay-form">
      <p className="text-[13px] text-shTextMuted">
        Adds this payment to your expense list and moves {bill.name} to its next due date.
      </p>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 gap-2">
        <label className={fieldLabel}>Amount paid
          <input type="text" inputMode="decimal" value={f.amount} onChange={set("amount")} className={`${input} mt-1`} data-testid="bill-pay-amount"/>
          <AmountHint value={f.amount} testid="bill-pay-amount-hint"/>
        </label>
        <label className={fieldLabel}>Paid on<input type="date" value={f.paid_date} onChange={set("paid_date")} style={{ colorScheme: "dark" }} className={`${input} mt-1`} data-testid="bill-pay-date"/></label>
        <label className={fieldLabel}>Paid with
          <select value={f.payment_method} onChange={set("payment_method")} className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-pay-method">
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      {f.payment_method === "cash" && (
        <label className="flex items-center gap-2 text-[13px] text-shText">
          <input type="checkbox" checked={f.from_cash_drawer} onChange={(e) => setF({ ...f, from_cash_drawer: e.target.checked })} data-testid="bill-pay-from-drawer"/>
          Taken out of the register's cash drawer (so the close-out count expects less)
        </label>
      )}
      <label className={fieldLabel}>Note (optional)<input value={f.notes} onChange={set("notes")} className={`${input} mt-1 normal-case tracking-normal font-normal`} data-testid="bill-pay-notes"/></label>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || amount === null || !f.paid_date}
                onClick={() => onPay({ due_date: f.due_date, amount, paid_date: f.paid_date, payment_method: f.payment_method,
                                       from_cash_drawer: f.payment_method === "cash" && f.from_cash_drawer, notes: f.notes })}
                className={primaryBtn} data-testid="bill-pay-save">
          {busy ? "Saving…" : amount === null ? "Log payment" : `Log ${money(amount)} payment`}
        </button>
        <button onClick={onCancel} className={ghostBtn} data-testid="bill-pay-cancel">Cancel</button>
      </div>
    </div>
  );
}

export default function BillsTab({ onExpensesChanged }) {
  const confirm = useConfirm();
  const canDelete = !!useAuth()?.can?.("delete_records");   // undo deletes an expense; delete removes a bill
  const [bills, setBills] = useState(null);
  const [dueNext30, setDueNext30] = useState(0);
  const [categories, setCategories] = useState([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);   // null | "new" | the bill as it was when Edit was clicked
  const [paying, setPaying] = useState(null);     // bill id
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/bills");
      setBills(data.bills); setDueNext30(data.due_next_30 || 0); setErr("");
    } catch (e) { setErr(formatErr(e)); }
  }, []);
  useEffect(() => {
    load();
    api.get("/expenses/categories").then((r) => setCategories(r.data?.categories || [])).catch(() => {});
  }, [load]);

  const run = async (key, fn, onConflict) => {
    setBusy(key); setErr("");
    try { await fn(); await load(); return true; }
    catch (e) {
      // A toast too: the form being used can be far below the list's error line.
      const msg = formatErr(e);
      if (e?.response?.status === 409) {   // the bill changed elsewhere: show it as it is now
        onConflict?.();
        await load();
      }
      setErr(msg); toast.error(msg);
      return false;
    }
    finally { setBusy(""); }
  };

  const save = (body) => run("form", async () => {
    if (editing === "new") await api.post("/admin/bills", body);
    else await api.put(`/admin/bills/${editing.id}`, { ...body, expected_next_due: editing.next_due });
    toast.success(editing === "new" ? `Added ${body.name}` : `Saved ${body.name}`);
    setEditing(null);
  });

  // Close only this bill's forms, as they are when the request finishes: a form opened for
  // another bill while it was in flight stays open.
  const closeFormsFor = (bill) => {
    setEditing((cur) => (cur && cur !== "new" && cur.id === bill.id ? null : cur));
    setPaying((cur) => (cur === bill.id ? null : cur));
  };

  const pay = (bill, body) => run(`pay-${bill.id}`, async () => {
    const { data } = await api.post(`/admin/bills/${bill.id}/pay`, body);
    toast.success(`Logged ${money(body.amount)} for ${bill.name}. Next due ${dayLabel(data.bill.next_due)}.`);
    closeFormsFor(bill);
    onExpensesChanged?.();
  }, () => closeFormsFor(bill));

  const undo = async (bill) => {
    const last = bill.last_payment;
    if (!(await confirm({
      title: `Undo the last ${bill.name} payment?`,
      body: `Removes the ${money(last.amount)} expense logged ${dayLabel(last.date)} and puts ${bill.name} back to due ${dayLabel(last.bill_due_date)}.`,
      confirmText: "Undo payment", tone: "danger",
    }))) return;
    run(`undo-${bill.id}`, async () => {
      await api.post(`/admin/bills/${bill.id}/undo-payment`, { expense_id: last.id });
      closeFormsFor(bill);   // an open edit form still holds the due date from before the undo
      toast.success(`Undid the ${bill.name} payment`);
      onExpensesChanged?.();
    });
  };

  const remove = async (bill) => {
    if (!(await confirm({
      title: `Delete ${bill.name}?`, body: "Payments already logged for it stay in your expense list.",
      confirmText: "Delete bill", tone: "danger",
    }))) return;
    run(`del-${bill.id}`, async () => { await api.delete(`/admin/bills/${bill.id}`); closeFormsFor(bill); });
  };

  const overdue = (bills || []).filter((b) => b.days_until_due < 0);

  return (
    <div className="space-y-4" data-testid="bills-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-shText font-black uppercase italic text-lg"><i className="fas fa-file-invoice-dollar text-shPrimary mr-2"/>Bills</h3>
          {bills && bills.length > 0 && (
            <p className="text-[13px] text-shTextMuted" data-testid="bills-summary">
              {overdue.length > 0 && <span className="text-red-300 font-black">{overdue.length} overdue ({money(overdue.reduce((s, b) => s + b.amount, 0))}) · </span>}
              {money(dueNext30)} due in the next 30 days
            </p>
          )}
        </div>
        {editing === null && (
          <button onClick={() => setEditing("new")} className={primaryBtn} data-testid="bills-add"><i className="fas fa-plus mr-1"/>Add bill</button>
        )}
      </div>

      {err && <div className="text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3 text-[14px]" data-testid="bills-error">{err}</div>}

      {editing !== null && (
        <BillForm key={editing === "new" ? "new" : `${editing.id}:${editing.next_due}`} initial={editing === "new" ? null : editing}
                  categories={categories} busy={busy === "form"} onSave={save} onCancel={() => { setEditing(null); setErr(""); }}/>
      )}

      {bills === null ? (
        !err && <p className="text-shTextMuted text-[14px]">Loading bills…</p>
      ) : bills.length === 0 ? (
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 text-[14px] text-shTextMuted" data-testid="bills-empty">
          No bills yet. Add the ones that repeat, like rent, utilities, insurance and software, and the app will remind you on Today when one is due.
        </div>
      ) : (
        <div className="space-y-2" data-testid="bills-list">
          {bills.map((b) => (
            <div key={b.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4" data-testid={`bill-row-${b.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-shText font-black break-words">{b.name}</p>
                  <p className="text-[12px] text-shTextMuted break-words">
                    {[b.payee, label(FREQUENCIES, b.frequency), b.category].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="text-shText font-black text-lg shrink-0">{money(b.amount)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
                <span className={`px-2 py-0.5 rounded border font-black uppercase tracking-widest text-[11px] ${STATUS_TONE[b.status]}`} data-testid={`bill-status-${b.id}`}>
                  {dueText(b)}
                </span>
                <span className="text-shTextMuted">Due {dayLabel(b.next_due)}</span>
                {b.last_payment && (
                  <span className="text-shTextMuted" data-testid={`bill-last-paid-${b.id}`}>· Last paid {dayLabel(b.last_payment.date)} · {money(b.last_payment.amount)}</span>
                )}
              </div>
              {paying === b.id ? (
                <PayForm bill={b} busy={busy === `pay-${b.id}`} onPay={(body) => pay(b, body)} onCancel={() => { setPaying(null); setErr(""); }}/>
              ) : (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => { setPaying(b.id); setEditing(null); }} className={primaryBtn} data-testid={`bill-pay-${b.id}`}>
                    <i className="fas fa-check mr-1"/>Mark paid
                  </button>
                  <button onClick={() => { setEditing(b); setPaying(null); }} className={ghostBtn} data-testid={`bill-edit-${b.id}`}>Edit</button>
                  {canDelete && b.can_undo && (
                    <button onClick={() => undo(b)} disabled={busy === `undo-${b.id}`} className={ghostBtn} data-testid={`bill-undo-${b.id}`}>Undo last payment</button>
                  )}
                  {canDelete && (
                    <button onClick={() => remove(b)} disabled={busy === `del-${b.id}`} className={`${ghostBtn} hover:border-red-400 hover:text-red-300`} data-testid={`bill-delete-${b.id}`}>Delete</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
